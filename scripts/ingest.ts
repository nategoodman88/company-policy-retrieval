import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import pdf from "pdf-parse";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import OpenAI from "openai";
import { getSupabaseAdmin } from "../src/lib/supabase";

const policyDirectory = path.resolve(process.cwd(), "policies");
loadEnvConfig(process.cwd());

function toMarkdown(text: string) {
  const pages = text.split("\f").map((page) => page.trim()).filter(Boolean);
  return pages.map((page, pageIndex) => {
    const lines = page.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const formatted = lines.map((line) => {
      const isHeading = line.length < 110 && (
        /^\d+(?:\.\d+)*\s+\S/.test(line) ||
        (/^[A-Z][A-Z0-9 ,&'’()/-]+$/.test(line) && line.length > 3)
      );
      return isHeading ? `### ${line}` : line;
    });
    return `## Page ${pageIndex + 1}\n\n${formatted.join("\n\n")}`;
  }).join("\n\n");
}

function splitMarkdownByHeaders(markdown: string): Document[] {
  const sections: Document[] = [];
  const headings: Record<string, string> = {};
  let lines: string[] = [];

  function flushSection() {
    const pageContent = lines.join("\n").trim();
    if (pageContent) {
      sections.push(new Document({ pageContent, metadata: { ...headings } }));
    }
    lines = [];
  }

  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (!match) {
      lines.push(line);
      continue;
    }

    flushSection();
    const level = match[1].length;
    for (let lowerLevel = level + 1; lowerLevel <= 3; lowerLevel += 1) {
      delete headings[`h${lowerLevel}`];
    }
    headings[`h${level}`] = match[2];
    lines.push(line);
  }

  flushSection();
  return sections;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required.");
  const files = (await readdir(policyDirectory)).filter((file) => file.toLowerCase().endsWith(".pdf"));
  if (!files.length) {
    console.log(`No PDF policy files found in ${policyDirectory}.`);
    return;
  }

  const openai = new OpenAI({ apiKey });
  const supabase = getSupabaseAdmin();
  const recursiveSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
  });

  for (const file of files) {
    const sourcePath = path.join(policyDirectory, file);
    const parsed = await pdf(await readFile(sourcePath));
    const markdown = toMarkdown(parsed.text);
    const sections = splitMarkdownByHeaders(markdown);
    const chunks = await recursiveSplitter.splitDocuments(sections);
    const title = path.basename(file, path.extname(file)).replace(/\s+/g, " ").trim();

    const { data: document, error: documentError } = await supabase
      .from("documents")
      .upsert({ title, source_file: file }, { onConflict: "source_file" })
      .select("id")
      .single();
    if (documentError) throw documentError;

    const { error: deleteError } = await supabase
      .from("document_chunks")
      .delete()
      .eq("document_id", document.id);
    if (deleteError) throw deleteError;

    const rows: Array<{
      id: string;
      document_id: string;
      content: string;
      metadata: { source: string; section: string };
      embedding: number[];
    }> = [];
    for (let start = 0; start < chunks.length; start += 100) {
      const batch = chunks.slice(start, start + 100);
      const embeddings = await openai.embeddings.create({
        model: "text-embedding-3-small",
        dimensions: 1536,
        input: batch.map((chunk) => chunk.pageContent),
      });

      batch.forEach((chunk, index) => {
        const section = [chunk.metadata.h1, chunk.metadata.h2, chunk.metadata.h3]
          .filter((value): value is string => typeof value === "string" && value.length > 0)
          .join(" / ") || "Policy text";
        const id = createHash("sha256")
          .update(`${file}:${start + index}:${chunk.pageContent}`)
          .digest("hex")
          .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");
        rows.push({
          id,
          document_id: document.id,
          content: chunk.pageContent,
          metadata: { source: file, section },
          embedding: embeddings.data[index].embedding,
        });
      });
    }

    for (let start = 0; start < rows.length; start += 100) {
      const { error } = await supabase
        .from("document_chunks")
        .upsert(rows.slice(start, start + 100), { onConflict: "id" });
      if (error) throw error;
    }
    console.log(`Ingested ${file}: ${rows.length} chunks.`);
  }
}

main().catch((error: unknown) => {
  console.error("Policy ingestion failed:", error);
  process.exitCode = 1;
});