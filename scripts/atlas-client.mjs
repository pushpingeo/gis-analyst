// Minimal client for the AI Living World Atlas MCP server (JSON-RPC over HTTP POST).
// Node only: the key comes from the environment and never reaches a browser.
const URL_ = process.env.ATLAS_MCP_URL || "https://atlas-mcp.robdunfey.workers.dev/mcp";
let n = 0;
export async function atlasCall(name, args, { key = process.env.ATLAS_MCP_KEY, timeoutMs = 30000 } = {}) {
  if (!key) throw new Error("ATLAS_MCP_KEY is not set");
  const r = await fetch(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`atlas ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`atlas: ${j.error.message}`);
  if (j.result?.isError) throw new Error(`atlas: ${j.result.content?.[0]?.text}`);
  return j.result.structuredContent;
}
