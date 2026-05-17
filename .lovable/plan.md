Redeploy three edge functions to pick up the switch to Google AI Studio direct API (GEMINI_API_KEY):

1. `backfill-embeddings`
2. `vector-search`
3. `islamic-health`

Steps:
- Call `supabase--deploy_edge_functions` with `["backfill-embeddings", "vector-search", "islamic-health"]`.
- Verify `GEMINI_API_KEY` is present in secrets (via `fetch_secrets`); if missing, prompt to add it.
- Optionally hit `islamic-health` via `curl_edge_functions` to confirm a 200 response post-deploy.