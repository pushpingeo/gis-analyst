// Fetch data snapshots for each evaluation site: OpenStreetMap (one Overpass response), GBIF threatened
// species records and Wikidata named places. Use --sources=osm,gbif,wikidata to pick (default: all).
// Runs in GitHub Actions, which can reach the public Overpass servers. Saved snapshots make the
// evaluation repeatable: skill-off and skill-on runs see exactly the same data.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { buildOverpassQuery, fetchOverpass, OVERPASS_ENDPOINTS, FOOTPRINT_KM, gbifUrl, slimGbif, wikidataUrl } from "../js/tools.js";

const catalogue = JSON.parse(readFileSync("catalogue/catalogue.json"));
const { sites } = JSON.parse(readFileSync("data/eval-sites.json"));
const force = process.argv.includes("--force");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const sources = (process.argv.find((a) => a.startsWith("--sources="))?.slice(10) || "osm,gbif,wikidata").split(",");
for (const d of ["osm", "gbif", "wikidata"]) mkdirSync(`data/${d}`, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
// Overpass servers ask scripts to identify themselves.
const UA = { "User-Agent": "gis-analyst/0.1 (+https://github.com/pushpingeo/gis-analyst; evaluation snapshots)" };

async function getJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 60000);
  try {
    const res = await fetch(url, { headers: { ...UA, Accept: "application/json" }, signal: ctl.signal });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 150)}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

// GBIF and Wikidata are quick, so do them first for every site.
for (const s of sites) {
  if (only && !only.includes(s.id)) continue;
  const r = FOOTPRINT_KM[s.asset_type];
  const meta = { site_id: s.id, name: s.name, lon: s.lon, lat: s.lat, asset_type: s.asset_type, footprint_km: r, fetched: new Date().toISOString() };
  if (sources.includes("gbif") && (force || !existsSync(`data/gbif/${s.id}.json`))) {
    try {
      const nearUrl = gbifUrl(s.lon, s.lat, r + 5);
      const wideUrl = gbifUrl(s.lon, s.lat, r + 20, { facetOnly: true });
      const near = slimGbif(await getJson(nearUrl));
      const wide = await getJson(wideUrl);
      writeFileSync(`data/gbif/${s.id}.json`, JSON.stringify({ ...meta, licence: "per record (see each record); GBIF.org", near_url: nearUrl, wide_url: wideUrl, near, wide: { count: wide.count, facets: wide.facets } }));
      const msg = `ok   gbif ${s.id}: ${near.count} records near, ${wide.count} within ${r + 20} km`;
      console.log(msg); log.push(msg);
    } catch (e) { const msg = `fail gbif ${s.id}: ${e.message.slice(0, 120)}`; console.log(msg); log.push(msg); }
    await sleep(1000);
  }
  if (sources.includes("wikidata") && (force || !existsSync(`data/wikidata/${s.id}.json`))) {
    try {
      const url = wikidataUrl(s.lon, s.lat, r + 20);
      const wd = await getJson(url);
      writeFileSync(`data/wikidata/${s.id}.json`, JSON.stringify({ ...meta, licence: "CC0 1.0, Wikidata", url, wikidata: wd }));
      const msg = `ok   wikidata ${s.id}: ${wd.results.bindings.length} rows`;
      console.log(msg); log.push(msg);
    } catch (e) { const msg = `fail wikidata ${s.id}: ${e.message.slice(0, 120)}`; console.log(msg); log.push(msg); }
    await sleep(2000);
  }
}

for (const s of sites) {
  if (!sources.includes("osm")) break;
  if (only && !only.includes(s.id)) continue;
  const file = `data/osm/${s.id}.json`;
  // Re-fetch when the catalogue has changed since the snapshot was taken, so a timed-out run can simply be rerun.
  if (existsSync(file) && !force && JSON.parse(readFileSync(file)).catalogue_version === catalogue.version) { console.log(`skip ${s.id} (current)`); continue; }
  const r = FOOTPRINT_KM[s.asset_type];
  const q = buildOverpassQuery(catalogue, s.lon, s.lat, r);
  let ok = false;
  for (let attempt = 0; attempt < 1 && !ok; attempt++) {
    for (const ep of OVERPASS_ENDPOINTS) {
      const t0 = Date.now();
      try {
        const osm = await fetchOverpass(q, ep, fetch, 200000, UA);
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
    if (!ok) await sleep(10000);
  }
  await sleep(4000); // be polite to a shared public service
}
writeFileSync("data/_fetch-log.txt", log.join("\n") + "\n");
