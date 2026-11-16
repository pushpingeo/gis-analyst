// Diagnostic: what does the atlas hold near the sites v3 missed? Uses the evaluation's ground truth,
// so it's for deciding what to build, never part of the product or the evaluation.
import { readFileSync } from "node:fs";
import { atlasCall } from "./atlas-client.mjs";

const csv = readFileSync("data/eval_set.csv", "utf8").trim().split(/\r?\n/);
const head = csv[0].split(",");
const rows = csv.slice(1).map((l) => {
  const cells = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
  return Object.fromEntries(head.map((h, i) => [h, cells[i]]));
});
const SITES = [["Reko Diq", "mineral-extraction"], ["Nachtigal", "power-plant"], ["Kinguél", "power-plant"], ["Sal de Vida", "mineral-extraction"], ["Sierra Rutile", "mineral-extraction"], ["Kipoi", "mineral-extraction"]];
for (const [name, concept] of SITES) {
  const s = rows.find((r) => (r.name || "").includes(name));
  if (!s) { console.log(`\n## ${name}: not in eval set`); continue; }
  const lon = +s.lon, lat = +s.lat;
  console.log(`\n## ${name} (${concept})`);
  try {
    const f = await atlasCall("find_datasets", { lon, lat, radius_km: 25, concept, limit: 8 });
    console.log(`  ${f.matches} datasets with concept; top:`);
    for (const d of f.results) console.log(`   - ${d.id} | ${d.title.slice(0, 70)} | ${d.publisher?.slice(0, 40)} | caps ${d.capabilities} | fit ${d.fit}`);
    for (const d of f.results.filter((d) => d.capabilities.includes("query")).slice(0, 3)) {
      try {
        const g = await atlasCall("fetch_features", { id: d.id, lon, lat, radius_km: 25, limit: 20, include_geometry: false });
        const props = (g.features || []).slice(0, 5).map((x) => Object.entries(x.properties || {}).filter(([k, v]) => typeof v === "string" && /name|title|site|project/i.test(k)).map(([, v]) => v).slice(0, 1).join("")).filter(Boolean);
        console.log(`     fetch ${d.id}: ${g.returned ?? g.features?.length} features ${JSON.stringify(props)}`);
      } catch (e) { console.log(`     fetch ${d.id}: ${e.message.slice(0, 120)}`); }
    }
  } catch (e) { console.log(`  find failed: ${e.message.slice(0, 200)}`); }
}
