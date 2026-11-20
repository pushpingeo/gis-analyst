// Calls atlas tools from GitHub Actions: one JSON array of [tool, args] pairs. Diagnostic only.
import { atlasCall } from "./atlas-client.mjs";
const calls = JSON.parse(process.env.CALLS || "[]");
for (const [tool, args] of calls) {
  try { console.log(`\n>>> ${tool} ${JSON.stringify(args)}\n${JSON.stringify(await atlasCall(tool, args)).slice(0, 60000)}`); }
  catch (e) { console.log(`\n>>> ${tool} ${JSON.stringify(args)}\nERROR ${e.message}`); }
}
// Raw GET of a URL from the runner, for checking a service directly.
for (const u of JSON.parse(process.env.URLS || "[]")) {
  try { const r = await fetch(u, { signal: AbortSignal.timeout(25000), headers: { Origin: "https://asktobler.com" } }); console.log(`\n>>> GET ${u}\n${r.status} cors=${r.headers.get("access-control-allow-origin")} type=${r.headers.get("content-type")} ${(await r.text()).slice(0, 3000)}`); }
  catch (e) { console.log(`\n>>> GET ${u}\nERROR ${e.message}`); }
}
// Run Tobler's own searches against the real atlas: SEARCHES = [["named", name, kind, bbox], ["near", [lon,lat], type, km, name]].
const { atlasFindNamed, atlasFeaturesNear, describeChecked } = await import("../js/atlasfeatures.js");
for (const s of JSON.parse(process.env.SEARCHES || "[]")) {
  const t0 = Date.now();
  try {
    const r = s[0] === "named" ? await atlasFindNamed(s[1], s[2], s[3], { call: atlasCall }) : await atlasFeaturesNear(s[1], s[2], s[3], { call: atlasCall, name: s[4] });
    console.log(`\n>>> ${JSON.stringify(s)} in ${((Date.now() - t0) / 1000).toFixed(1)} s\nfound ${r.candidates.length}; layers found ${r.layers_found ?? r.datasets_found}; not checked ${r.layers_not_checked}`);
    for (const c of r.candidates.slice(0, 8)) console.log(`  * ${c.name} | ${c.type} | ${c.source.title} (${c.source.publisher}) | ${c.geometry.type} ${c.area_km2 ?? c.length_km ?? ""}`);
    console.log(`  summary: ${JSON.stringify(describeChecked(r.checked))}`);
    for (const x of r.checked) console.log(`  - ${x.dataset} (${x.publisher}): ${x.error || (x.kept ?? x.returned)}`);
  } catch (e) { console.log(`\n>>> ${JSON.stringify(s)}\nERROR ${e.stack}`); }
}
