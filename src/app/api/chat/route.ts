import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

type RetrievedChunk = {
  id: string;
  document_id: string;
  content: string;
  metadata: { source?: string; section?: string };
  similarity: number;
};

type HistoryMessage = { role: "user" | "assistant"; content: string };

function eventData(value: unknown) {
  return `data: ${JSON.stringify(value)}\n\n`;
}

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  let body: { message?: string; sessionId?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message || message.length > 8000) {
    return NextResponse.json({ error: "Enter a message under 8,000 characters." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  let sessionId = body.sessionId ?? null;
  if (sessionId) {
    const { data: existing, error } = await supabase
      .from("chat_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: "Could not access conversation." }, { status: 503 });
    if (!existing) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  } else {
    const { data: created, error } = await supabase
      .from("chat_sessions")
      .insert({ user_id: user.id, title: message.slice(0, 72) })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: "Could not create conversation." }, { status: 503 });
    sessionId = created.id;
  }

  const activeSessionId = sessionId;
  const { data: priorMessages } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("session_id", activeSessionId)
    .order("created_at", { ascending: false })
    .limit(12);

  const { error: saveUserError } = await supabase.from("chat_messages").insert({
    session_id: activeSessionId,
    role: "user",
    content: message,
  });
  if (saveUserError) {
    return NextResponse.json({ error: "Could not save your message." }, { status: 503 });
  }

  const history = ((priorMessages ?? []).reverse() as HistoryMessage[]).map((item) => ({
    role: item.role,
    content: item.content,
  }));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: unknown) => controller.enqueue(encoder.encode(eventData(data)));
      let assistantText = "";
      try {
        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        const openAiKey = process.env.OPENAI_API_KEY;
        if (!anthropicKey || !openAiKey) throw new Error("Model API keys are not configured.");

        const anthropic = new Anthropic({ apiKey: anthropicKey });
        const openai = new OpenAI({ apiKey: openAiKey });
        const rewrite = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 180,
          messages: [{
            role: "user",
            content: `Rewrite this company policy question as a concise search query. Preserve the policy topic and important qualifiers. Return only the query.\n\nQuestion: ${message}`,
          }],
        });
        const retrievalQuery = rewrite.content.find((part) => part.type === "text")?.text.trim() || message;
        const embedding = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: retrievalQuery,
          dimensions: 1536,
        });
        const { data: matches, error: retrievalError } = await supabase.rpc("match_document_chunks", {
          query_embedding: embedding.data[0].embedding,
          match_threshold: 0.25,
          match_count: 6,
        });
        if (retrievalError) throw retrievalError;

        const chunks = (matches ?? []) as RetrievedChunk[];
        const citations = chunks.map((chunk) => ({
          source: chunk.metadata?.source ?? "Company policy",
          section: chunk.metadata?.section ?? "Policy text",
        }));
        const context = chunks.map((chunk, index) =>
          `[${index + 1}] ${chunk.metadata?.source ?? "Policy"} / ${chunk.metadata?.section ?? "Section"}\n${chunk.content}`,
        ).join("\n\n---\n\n");

        send({ type: "session", sessionId: activeSessionId });
        send({ type: "citations", citations });
        const generationMessages = [
          ...history,
          { role: "user" as const, content: message },
        ];
        const generation = anthropic.messages.stream({
          model: "claude-sonnet-5-5",
          max_tokens: 1800,
          system: `You are the company's policy assistant. Answer using only the supplied policy excerpts. If the excerpts do not answer the question, say so plainly and recommend contacting People Operations or IT as appropriate. Do not invent policy details. Cite supporting sources inline as [1], [2], matching the numbered excerpts. Be concise and practical.\n\nPOLICY EXCERPTS:\n${context || "No matching policy excerpts were found."}`,
          messages: generationMessages,
        });

        for await (const event of generation) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            assistantText += event.delta.text;
            send({ type: "delta", text: event.delta.text });
          }
        }

        const { error: saveAssistantError } = await supabase.from("chat_messages").insert({
          session_id: activeSessionId,
          role: "assistant",
          content: assistantText,
          citations,
        });
        if (saveAssistantError) console.error("Could not persist assistant response:", saveAssistantError);
        await supabase.from("chat_sessions").update({ updated_at: new Date().toISOString() }).eq("id", activeSessionId);
        send({ type: "done" });
      } catch (error) {
        console.error("Chat generation failed:", error);
        send({ type: "error", error: "I couldn't complete that answer. Check the service configuration and try again." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}