# Model Switching

Model IDs are selected in `src/app/api/chat/route.ts`. Retrieval rewriting and final answer generation are separate calls, so they can use different models and be changed independently.

## Current Selection

| Stage | Current API ID | Call behavior |
| --- | --- | --- |
| Query rewrite | `claude-haiku-4-5` | Non-streaming Messages API call; rewrites the user's question before embedding |
| Answer generation | `claude-sonnet-5-5` | Streaming Messages API call; answers from retrieved excerpts and chat history |
| Embeddings | `text-embedding-3-small` | OpenAI embedding API; fixed at 1536 dimensions to match `vector(1536)` |

Check Anthropic's [models overview](https://platform.claude.com/docs/en/about-claude/models/overview) for valid Claude API IDs and the [model deprecations page](https://platform.claude.com/docs/en/about-claude/model-deprecations) before deploying a change. Model availability can depend on the API workspace and account access. Anthropic currently commits to keeping Haiku 4.5 available no earlier than October 15, 2026; recheck lifecycle status before relying on it beyond that date.

## Change a Claude Model

1. Pick an ID supported by the Anthropic Messages API and enabled for the API key's workspace.
2. In `src/app/api/chat/route.ts`, change only the `model` field for the stage being switched. Keep the Haiku call for query rewriting and the Sonnet call for streamed answer generation unless intentionally changing the pipeline design.
3. Keep request options compatible with the selected model. This implementation uses `max_tokens`; answer generation also relies on the SDK stream iterator and text-delta events.
4. Restart the dev server and send a representative policy question. Confirm the route completes both the model call and vector retrieval, renders the answer, and saves the response/citations.
5. Check latency, output quality, token use, citations, and refusal behavior before deploying.

The IDs are code constants today; there are no model-specific environment variables. This keeps the deployment env small and makes a model change an explicit code review. If the app needs per-environment model routing later, introduce validated server-only model settings and document their allowed values rather than accepting arbitrary client-supplied IDs.

## Change the Embedding Model

Changing the embedding model is a separate migration, not just a string replacement. The chosen model must produce vectors with the same dimension as the database column, and query/document vectors must come from the same model. If changing dimensions or model family, re-embed every policy chunk and update the vector column, RPC signature, and indexes together before switching query embeddings.

The current pipeline uses OpenAI `text-embedding-3-small` with 1536 dimensions in both `scripts/ingest.ts` and `src/app/api/chat/route.ts`. Re-ingest all policies after any embedding-model change; mixing vector spaces produces meaningless similarity scores.

## Diagnose Model Errors

- **404 `model: ...` not found:** verify the exact API ID, platform, and workspace access. Do not assume a display name or Bedrock/Vertex ID is valid for Anthropic's direct API.
- **401/403:** verify `ANTHROPIC_API_KEY`, its workspace, and model access. Do not log or paste the key into diagnostics.
- **429:** respect retry guidance and rate limits; consider reducing simultaneous requests or choosing an appropriate model tier.
- **Answer call succeeds but output is poor:** inspect retrieved excerpts and citations first. A model change cannot correct missing or incorrectly embedded policy chunks.