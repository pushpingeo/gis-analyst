// Calls atlas tools from GitHub Actions: one JSON array of [tool, args] pairs. Diagnostic only.
import { atlasCall } from "./atlas-client.mjs";
const calls = JSON.parse(process.env.CALLS || "[]");
for (const [tool, args] of calls) {
  try { console.log(`\n>>> ${tool} ${JSON.stringify(args)}\n${JSON.stringify(await atlasCall(tool, args)).slice(0, 60000)}`); }
  catch (e) { console.log(`\n>>> ${tool} ${JSON.stringify(args)}\nERROR ${e.message}`); }
}
// Raw GET of a URL from the runner, for checking a service directly.
for (const u of JSON.parse(process.env.URLS || "[]")) {
  try { const r = await fetch(u, { signal: AbortSignal.timeout(25000) }); console.log(`\n>>> GET ${u}\n${r.status} ${(await r.text()).slice(0, 3000)}`); }
  catch (e) { console.log(`\n>>> GET ${u}\nERROR ${e.message}`); }
}
