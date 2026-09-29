# RAG Pipeline Setup

This guide covers the policy indexing and question-answering path implemented in this repository.

## Components

1. `scripts/ingest.ts` reads PDFs from `policies/`, extracts text, infers Markdown headings, splits sections into overlapping chunks, creates OpenAI embeddings, and writes the documents and chunks through the Supabase service API.
2. `src/app/api/chat/route.ts` checks the signed-in user, stores the question, rewrites it with Claude Haiku, embeds the rewritten query, and calls the Supabase `match_document_chunks` RPC.
3. The API supplies the retrieved excerpts and recent conversation history to Claude Sonnet, streams answer deltas to the browser as SSE, and stores the answer and citations.
4. The browser renders Markdown and document/section citations. Database and model credentials remain server-side.

## Configure Supabase

1. Create a Supabase project with the `vector` extension available.
2. Run [`supabase/migrations/01_init.sql`](../supabase/migrations/01_init.sql) in the Supabase SQL editor. It creates the users, documents, chunks, sessions, and messages tables; enables row-level security; creates the cosine search function and index; and seeds the prototype admin account.
3. Keep the service key private. The app uses it on the server for authentication, ingestion, and database operations. Never add it to a `NEXT_PUBLIC_` variable.

The function uses `OPERATOR(extensions.<=>)` because this migration installs pgvector in the `extensions` schema. If changing the extension schema, update the type, operator, index operator class, and RPC together.

## Environment

The current app reads these keys:

| Variable | Used by | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Web app and ingestion | Supabase project endpoint |
| `SUPABASE_SECRET_KEY` | Server and ingestion | Privileged Supabase access and JWT signing key material |
| `ANTHROPIC_API_KEY` | Chat API | Query rewrite and answer generation |
| `OPENAI_API_KEY` | Chat API and ingestion | Query and document embeddings |

`DATABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are present in the sample environment for direct database tooling or future browser-side Supabase usage; current application code does not read them. Do not expose `SUPABASE_SECRET_KEY` to client code.

The web application and ingestion script both load Next.js environment files from the repository root. Put the values in `.env.local` (or `.env`) and keep that file untracked; do not paste actual credentials into committed scripts or documentation.

## Index Policy PDFs

Place `.pdf` files directly in `policies/`, configure `.env.local`, and run `npm run ingest`. Each file is keyed by its filename in `documents`; re-ingestion replaces that document's existing chunks.

The script splits extracted text at inferred `#`, `##`, and `###` headings, then uses 500-character chunks with a 50-character overlap. It embeds with `text-embedding-3-small` at 1536 dimensions and attaches `source` and `section` metadata. The heading inference is heuristic, not a layout-preserving PDF conversion. Image-only/scanned files need OCR before ingestion.

After ingestion, check the Supabase table editor for a `documents` row and related `document_chunks` rows. If retrieval returns no citations, check that ingestion completed, that the chunk vectors have 1536 dimensions, and that the RPC threshold in the chat route is appropriate for the corpus.

## Run and Smoke-Test

1. Ensure the web app's `.env.local` contains `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, and `OPENAI_API_KEY`.
2. Start with `npm run dev`, sign in, and ask a question that should be directly answered by an ingested policy.
3. Confirm the answer cites the expected source and section, then refresh or select the chat in history to verify persistence.

The retrieval route requests up to six matches with a cosine-similarity threshold of `0.25`. Tune these in `src/app/api/chat/route.ts` only after inspecting retrieval quality. A low threshold increases recall but may add weakly related text; a high threshold can leave relevant questions without context.

## Troubleshooting

- **No document chunks:** confirm `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `OPENAI_API_KEY` are in the root `.env.local`, then check the ingestion terminal output for PDF or API errors.
- **No citations:** check the stored vectors and RPC permissions, then inspect the threshold and returned matches.
- **Database operator error:** confirm pgvector's actual extension schema and use that schema for the cosine operator (`<=>`).
- **401 in browser APIs:** sign in again; the session uses a 12-hour HTTP-only cookie.
- **Assistant reports service configuration trouble:** inspect the Next.js server terminal for the upstream Anthropic/OpenAI or Supabase error. The browser response intentionally does not reveal service details.