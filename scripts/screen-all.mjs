// Run the tools on every saved snapshot and apply the skill's distance rules mechanically (no AI).
// This gives a "rules only" baseline for the evaluation, and a quick check that the tools behave.
// Usage: node scripts/screen-all.mjs   -> eval/rules-baseline.json (for test/score) and a printed table
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { screen, summarise } from "../js/tools.js";

const catalogue = JSON.parse(readFileSync("catalogue/catalogue.json"));
const { sites } = JSON.parse(readFileSync("data/eval-sites.json"));

const within = (s, concept, km) => (s[concept]?.nearest?.[0]?.distance_km ?? Infinity) <= km;
const any = (s, concepts, km) => concepts.some((c) => within(s, c, km));

// Mechanical reading of skills/ntr-screening/SKILL.md. The agent should do better than this.
function rules(s, asset) {
  const ps5 = any(s, ["settlement", "residential-land", "farmland"], 1) && !within(s, "industrial-land", 0);
  const ps6 = within(s, "protected-area", 5) || any(s, ["wetland", "river"], 1) || asset === "wind" || asset === "hydro";
  const ps7 = within(s, "indigenous-land", 5);
  const ps8 = any(s, ["heritage-site", "place-of-worship"], 1);
  const high = within(s, "protected-area", 0) || within(s, "settlement", 0) || within(s, "indigenous-land", 0) || asset === "hydro";
  const medium = [ps5, ps6, ps7, ps8].filter(Boolean).length;
  const big = ["hydro", "mine", "thermal", "wind"].includes(asset);
  const category = high || (medium >= 2 && big) ? "A" : medium ? "B" : "C";
  return { ps5, ps6, ps7, ps8, category };
}

const results = [];
const rows = [];
for (const site of sites) {
  const f = `data/osm/${site.id}.json`;
  if (!existsSync(f)) { rows.push(`${site.id.padEnd(6)} ${site.name.slice(0, 26).padEnd(27)} no snapshot`); continue; }
  const snap = JSON.parse(readFileSync(f));
  const s = summarise(screen(snap.osm, catalogue, snap.lon, snap.lat, snap.footprint_km), 3);
  const r = rules(s, site.asset_type);
  results.push({ project_number: site.id, ...r });
  const yn = (k) => `${r[k] ? "Y" : "-"}${site.ifc[k] ? "Y" : "-"}`;
  rows.push(`${site.id.padEnd(6)} ${site.name.slice(0, 26).padEnd(27)} ${String(snap.osm.elements.length).padStart(5)}  ` +
    `${yn("ps5")}  ${yn("ps6")}  ${yn("ps7")}  ${yn("ps8")}  ${r.category}${site.ifc.category}`);
}
mkdirSync("eval", { recursive: true });
writeFileSync("eval/rules-baseline.json", JSON.stringify({ label: "rules only (no AI)", results }, null, 1));
console.log("id     site                         elems  PS5 PS6 PS7 PS8 cat   (rules then IFC; Y = triggered)");
console.log(rows.join("\n"));
