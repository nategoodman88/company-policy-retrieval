# Company Policy Retrieval Assistant

A Next.js policy Q&A prototype with Supabase/pgvector retrieval, Anthropic generation, OpenAI embeddings, chat history, and PDF ingestion.

## Local setup

1. Install Node.js 20 or later and npm.
2. Copy `.env.example` to `.env.local` and fill in the Supabase project URL, publishable and secret keys, Postgres connection string, Anthropic key, and OpenAI key.
3. Run the SQL in `supabase/migrations/01_init.sql` in the Supabase SQL editor. It enables pgvector, creates the schema and cosine search RPC, and seeds `admin@company.com` with `Password123!`.
4. Install and start the application:

	```bash
	npm install
	npm run dev
	```

5. Sign in at `http://localhost:3000`. Change or remove the seeded admin account before deploying beyond a private prototype.

## Ingest policies

Place PDF files in `policies/`, configure `.env.local`, then run:

```bash
npm run ingest
```

The script extracts PDF text, converts page/heading structure to Markdown, splits on Markdown headers and into approximately 500-character chunks with 50-character overlap, generates 1536-dimensional embeddings, and replaces each source document's indexed chunks. Re-running ingestion is supported.

## Deployment

Configure these values in Vercel for the production environment: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `ANTHROPIC_API_KEY`, and `OPENAI_API_KEY`. The publishable key is included for Supabase client configuration; privileged server operations use only `SUPABASE_SECRET_KEY`. Never commit `.env.local` or expose the secret key to browser code.

Pushes to `main` run TypeScript, ESLint, and production build checks before deployment. CI creates a transient lockfile if one is absent and then runs `npm ci`; generate and commit `package-lock.json` with `npm install` to make dependency versions reproducible across builds.

For details, see [RAG pipeline setup](docs/rag-pipeline-setup.md) and [model switching](docs/model-switching.md).

## Prototype boundaries

Authentication uses an application-owned `users` table and a 12-hour HTTP-only JWT cookie. The seeded admin credentials are for first-run evaluation only; add account provisioning, password reset, rate limiting, and an organization-approved identity provider before production use. Policy answers are grounded in retrieved text and include document/section citations, but remain subject to human verification.