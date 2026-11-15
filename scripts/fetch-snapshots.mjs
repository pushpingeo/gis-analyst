// Fetch an OpenStreetMap snapshot (one Overpass response) for each evaluation site.
// Runs in GitHub Actions, which can reach the public Overpass servers. Saved snapshots make the
// evaluation repeatable: skill-off and skill-on runs see exactly the same data.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { buildOverpassQuery, fetchOverpass, OVERPASS_ENDPOINTS, FOOTPRINT_KM } from "../js/tools.js";

const catalogue = JSON.parse(readFileSync("catalogue/catalogue.json"));
const { sites } = JSON.parse(readFileSync("data/eval-sites.json"));
const force = process.argv.includes("--force");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
mkdirSync("data/osm", { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
// Overpass servers ask scripts to identify themselves.
const UA = { "User-Agent": "gis-analyst/0.1 (+https://github.com/pushpingeo/gis-analyst; evaluation snapshots)" };

for (const s of sites) {
  if (only && !only.includes(s.id)) continue;
  const file = `data/osm/${s.id}.json`;
  if (existsSync(file) && !force) { console.log(`skip ${s.id} (exists)`); continue; }
  const r = FOOTPRINT_KM[s.asset_type];
  const q = buildOverpassQuery(catalogue, s.lon, s.lat, r);
  let ok = false;
  for (let attempt = 0; attempt < 2 && !ok; attempt++) {
    for (const ep of OVERPASS_ENDPOINTS) {
      const t0 = Date.now();
      try {
        const osm = await fetchOverpass(q, ep, fetch, 150000, UA);
        const out = { site_id: s.id, name: s.name, lon: s.lon, lat: s.lat, asset_type: s.asset_type, footprint_km: r,
          catalogue_version: catalogue.version, fetched: new Date().toISOString(), endpoint: ep,
          licence: "ODbL 1.0, © OpenStreetMap contributors", query: q, osm };
        writeFileSync(file, JSON.stringify(out));
        const msg = `ok   ${s.id} ${s.name}: ${osm.elements.length} elements, ${((Date.now() - t0) / 1000).toFixed(1)} s, ${new URL(ep).host}`;
        console.log(msg); log.push(msg); ok = true; break;
      } catch (e) {
        const msg = `fail ${s.id} ${new URL(ep).host}: ${e.message.slice(0, 120)}`;
        console.log(msg); log.push(msg);
        await sleep(5000);
      }
    }
    if (!ok) await sleep(30000);
  }
  await sleep(4000); // be polite to a shared public service
}
writeFileSync("data/osm/_fetch-log.txt", log.join("\n") + "\n");
