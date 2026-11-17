// The page's route to the AI Living World Atlas: through the Worker, which holds the atlas key
// (the key never reaches the browser). If the Worker doesn't offer the route yet, the atlas is
// switched off for this tab after one try, and searches say "not checked" for it.
import { CONFIG } from "./config.js";

let unavailable = null;
export async function atlasViaWorker(tool, args) {
  if (unavailable) throw new Error(unavailable);
  let r;
  // One retry after a short random pause: when ten layers are asked at once, a few calls can fail at the Worker.
  for (let attempt = 0; ; attempt++) try {
    r = await fetch(CONFIG.proxyUrl.replace(/\/$/, "") + "/atlas", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
      signal: AbortSignal.timeout(30000),
    });
    if (r.status >= 500 && attempt === 0) { await new Promise((ok) => setTimeout(ok, 500 + Math.random() * 1500)); continue; }
    break;
  } catch (e) {
    if (attempt === 0 && e.name !== "TimeoutError") { await new Promise((ok) => setTimeout(ok, 500 + Math.random() * 1500)); continue; }
    throw new Error(`the atlas didn't answer (${e.name === "TimeoutError" ? "timed out" : e.message})`);
  }
  if (r.status === 404 || r.status === 405) { unavailable = "the atlas isn't connected to this site yet"; throw new Error(unavailable); }
  if (!r.ok) throw new Error(`the atlas answered ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  if (j.result?.isError) throw new Error(j.result.content?.[0]?.text || "atlas error");
  return j.result.structuredContent;
}
