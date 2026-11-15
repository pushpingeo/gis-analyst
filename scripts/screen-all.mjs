// Run the tools on every saved snapshot and apply the skill's distance rules mechanically (no AI).
// This gives a "rules only" baseline for the evaluation, and a quick check that the tools behave.
// Usage: node scripts/screen-all.mjs   -> eval/rules-baseline.json (for test/score) and a printed table
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { screen, summarise, summariseGbif } from "../js/tools.js";
import { rules } from "../js/rules.js";

const catalogue = JSON.parse(readFileSync("catalogue/catalogue.json"));
const { sites } = JSON.parse(readFileSync("data/eval-sites.json"));

const results = [];
const rows = [];
for (const site of sites) {
  const f = `data/osm/${site.id}.json`;
  if (!existsSync(f)) { rows.push(`${site.id.padEnd(6)} ${site.name.slice(0, 26).padEnd(27)} no snapshot`); continue; }
  const snap = JSON.parse(readFileSync(f));
  const s = summarise(screen(snap.osm, catalogue, snap.lon, snap.lat, snap.footprint_km), 3);
  const g = existsSync(`data/gbif/${site.id}.json`) ? JSON.parse(readFileSync(`data/gbif/${site.id}.json`)) : null;
  const r = rules(s, site.asset_type, g && summariseGbif(g.near, g.wide, snap.lon, snap.lat, snap.footprint_km));
  results.push({ project_number: site.id, ...r });
  const yn = (k) => `${r[k] ? "Y" : "-"}${site.ifc[k] ? "Y" : "-"}`;
  rows.push(`${site.id.padEnd(6)} ${site.name.slice(0, 26).padEnd(27)} ${String(snap.osm.elements.length).padStart(5)}  ` +
    `${yn("ps5")}  ${yn("ps6")}  ${yn("ps7")}  ${yn("ps8")}  ${r.category}${site.ifc.category}`);
}
mkdirSync("eval", { recursive: true });
writeFileSync("eval/rules-baseline.json", JSON.stringify({ label: "rules only (no AI)", results }, null, 1));
console.log("id     site                         elems  PS5 PS6 PS7 PS8 cat   (rules then IFC; Y = triggered)");
console.log(rows.join("\n"));
