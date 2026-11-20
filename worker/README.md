# tobler-api: Tobler's Worker

Address: `https://tobler-api.robdunfey.workers.dev`. The page uses it through `proxyUrl` in `js/config.js`.

## What it does
- `POST /v1/messages`: Claude proxy. Adds the Anthropic key, pins the model (`MODEL`), caps `max_tokens` at `MAX_TOKENS`, forwards only `system`, `messages` and `tools`. Refuses bodies over 120 kB.
- `POST /atlas`: one atlas tool call (`find_datasets`, `get_dataset`, `fetch_features` or `vocabulary` only), with the atlas key added, through the `ATLAS` service binding to `atlas-mcp`. (Fetching it by its workers.dev address fails with Cloudflare error 1042.)
- `POST /logs`: one finished turn's log from the page, trimmed in the page (`js/sharelog.js`), while "Share my sessions" is on (on by default; the welcome card says so). Stored in a Durable Object (`LogStore`, SQLite), one per day, with a hash of the IP as the visitor (no IP stored); each day is deleted 90 days after its first log (`LOG_RETENTION_DAYS`). 300 per visitor a day (`LOGS_PER_VISITOR_DAILY`). `LOGS_ENABLED = "no"` stops storing at once.
- `GET /logs?day=YYYY-MM-DD[&after=id&limit=n]`: reads a day's logs back for the weekly digest (`scripts/log-digest.mjs`). No origin needed; needs `Authorization: Bearer <read key>`, where the read key is the hex SHA-256 of `tobler-logs:` + `ATLAS_MCP_KEY`, so no new repo secret is needed (the proxy here can't set one).
- `GET /health`: liveness, no counters.
- Serves only `ALLOWED_ORIGINS` (asktobler.com, www.asktobler.com, pushpingeo.github.io, localhost:8000). No Origin header means refused.

## Limits
Set as vars in `wrangler.toml`: 200 Claude calls per visitor a day, 5,000 in total a day, 2,000 atlas calls per visitor a day. A call is counted before it goes upstream, so failed calls count too.

Counters are a Durable Object (`Counter`): one object per visitor per day (keyed by a hash of the IP, so no IP is stored) and one for the day's total. An object handles its calls one at a time, so counts are exact even with many calls at once (KV allowed one write a second per key, which broke the atlas route on 17 Nov). Each object deletes its data two days after first use.

## Deploying
Push a change under `worker/` to main, or run the **Worker deploy** Action by hand. It runs the local tests, `wrangler deploy`, loads `ANTHROPIC_API_KEY` and `ATLAS_MCP_KEY` from the repo secrets into the Worker (`wrangler secret bulk`), then checks the live Worker (health, a refused origin, one atlas call, one 5-token Claude call, one test log in and read back, marked `deploy-check` so the digest skips it). Uses the repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Nothing is pasted into the dashboard.

To switch the page back to demo 1's Worker: set `proxyUrl` in `js/config.js` to `https://north-sea-geo-demo.robdunfey.workers.dev`, run `node scripts/stamp.mjs`, push.

## Testing locally
```
cd worker && npm install && npm test
```
Runs `worker.js` in workerd (Miniflare, what `wrangler dev` uses) with real Durable Object counters and fake Claude and atlas upstreams: CORS, refused origins and tools, model pin and token cap, exact limits under parallel calls, separate Claude and atlas allowances. No network, no cost. `npm run dev` starts `wrangler dev` (the atlas binding isn't available locally unless atlas-mcp runs too).

Note: workerd in the current Miniflare 4 supports compatibility dates up to 2026-08-06, so `compatibility_date` is 2026-08-01.
