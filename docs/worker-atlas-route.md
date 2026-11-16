# Worker change for the atlas (for Rob to review and deploy)

Tobler's page asks the atlas for features through the same Cloudflare Worker that calls Claude
(`north-sea-geo-demo`), so the atlas key stays on the server. The page already tries `POST /atlas` and
quietly reports "the atlas isn't connected to this site yet" until this route exists.

Add to the Worker's `fetch` handler, before the existing routes. It needs the secret `ATLAS_MCP_KEY`
(already added on 16 Nov).

```js
// Forward atlas tool calls, adding the key. Only the read tools; one call per request.
if (url.pathname === "/atlas" && request.method === "POST") {
  const ALLOWED = new Set(["find_datasets", "get_dataset", "fetch_features", "vocabulary"]);
  let body;
  try { body = await request.json(); } catch { return cors(new Response("bad json", { status: 400 })); }
  if (body?.method !== "tools/call" || !ALLOWED.has(body?.params?.name)) return cors(new Response("not allowed", { status: 403 }));
  const r = await fetch("https://atlas-mcp.robdunfey.workers.dev/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.ATLAS_MCP_KEY}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: body.id ?? 1, method: "tools/call", params: body.params }),
  });
  return cors(new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } }));
}
```

`cors()` stands for however the Worker already adds `Access-Control-Allow-Origin` to responses (and the
`OPTIONS` preflight must allow `/atlas` too). If the Worker counts use per visitor for Claude calls, atlas
calls can share that counter or have their own, e.g. 300 a day per visitor. Atlas calls don't cost
Anthropic tokens; they only use the atlas's Cloudflare allowance.
