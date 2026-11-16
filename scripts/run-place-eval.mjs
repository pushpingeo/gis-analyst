// Place-finding evaluation: can the analyst, with the place-finding skill, put each IFC project on the map?
// Input per site: project name, sector, site type and country (what a desk analyst starts from).
// Ground truth: the locations Rob verified against satellite imagery (data/eval_set.csv).
// Usage: ANTHROPIC_API_KEY=... node scripts/run-place-eval.mjs --label=pf-v1 [--sites=10] [--model=claude-haiku-5-5]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import * as turf from "@turf/turf";
import * as R from "../js/reference.js";
import { createPlaceTools, placeToolDefs, projectSummary } from "../js/placetools.js";
import { parseSkill, systemPrompt, buildMessages, runTurn } from "../js/converse.js";

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d;
const LABEL = arg("label", "pf-dev");
const MODEL = arg("model", "claude-haiku-5-5");
const LIMIT = +arg("sites", "0");
const MAX_TOKENS = 8000;
const UA = { "User-Agent": "gis-analyst-eval/1.0 (+https://github.com/pushpingeo/gis-analyst)" };

const csv = readFileSync("data/eval_set.csv", "utf8").trim().split("\n");
const head = csv[0].split(",");
const rows = csv.slice(1).map((l) => {
  const cells = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
  return Object.fromEntries(head.map((h, i) => [h, cells[i]]));
}).filter((r) => ["correct", "moved"].includes(r.location_status) && r.lat && r.lon);
const sites = LIMIT ? rows.slice(0, LIMIT) : rows;

const ref = R.createReference(async (n) => JSON.parse(readFileSync(`data/ref/${n}.json`, "utf8")));
const anchors = JSON.parse(readFileSync("catalogue/anchors.json", "utf8")).sources;
const skill = parseSkill(readFileSync("skills/place-finding/SKILL.md", "utf8"));

async function callClaude({ system, messages, tools }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, messages, tools }),
    });
    if (r.ok) return r.json();
    if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 5000 * (attempt + 1))); continue; }
    throw new Error(`API ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
  throw new Error("API kept failing");
}

function memoryHost() {
  const list = [];
  return {
    ref, anchors, headers: UA, list,
    fetchFn: (url, opts = {}) => fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) } }),
    places: () => list,
    findPlace: (n) => list.find((p) => p.name.toLowerCase() === String(n).toLowerCase()),
    skillText: () => skill.body,
    addPlace({ feature, origin }) { const p = { name: `Area ${list.length + 1}`, feature, origin, status: "proposed", edits: [] }; list.push(p); return p; },
    updatePlace(name, feature, words) { const p = this.findPlace(name); p.feature = feature; p.edits.push({ change: words }); },
    renamePlace(name, to) { this.findPlace(name).name = to; },
  };
}

const outDir = `eval/places/${LABEL}`;
mkdirSync(outDir, { recursive: true });
const results = [];
for (const s of sites) {
  const host = memoryHost();
  const tools = createPlaceTools(host);
  const userText = `Locate this project site and mark it on the map: ${s.name} (${s.sector}; ${s.site_type}), ${s.country}.`;
  const events = [];
  const t0 = Date.now();
  let rec;
  try {
    const res = await runTurn({
      system: systemPrompt({ skills: [skill], comingSoon: [] }),
      messages: buildMessages({ recent: [], summary: await projectSummary(ref, [], null), userText }),
      tools: placeToolDefs([skill]),
      exec: (n, i) => tools.exec(n, i),
      callClaude,
      onEvent: (e) => { if (e.type === "tool" || e.type === "warning") events.push(e); },
    });
    const p = host.list[0];
    const truth = [+s.lon, +s.lat];
    const at = p ? (p.feature.geometry.type === "Point" ? p.feature.geometry.coordinates : turf.centroid(p.feature).geometry.coordinates) : null;
    const inside = p && /Polygon/.test(p.feature.geometry.type) ? turf.booleanPointInPolygon(truth, p.feature) : false;
    rec = {
      project: s.project_number, name: s.name, country: s.country, site_type: s.site_type,
      placed: !!p, error_km: at ? Math.round(turf.distance(at, truth) * 100) / 100 : null, truth_inside_shape: inside,
      shape: p?.feature.geometry.type, confidence: p?.origin.confidence, reason: p?.origin.reason,
      anchor: p?.origin.anchor?.name, anchor_source: p?.origin.anchor?.source?.id, steps: p?.origin.steps,
      text: res.text, usage: res.usage, seconds: Math.round((Date.now() - t0) / 1000),
      tools: events.map((e) => ({ name: e.name, input: e.input, error: e.error, n: e.output?.candidates?.length })),
      earlier_pin: { method: s.pin_method, error_km: s.pin_error_km === "" ? null : +s.pin_error_km },
    };
  } catch (e) {
    rec = { project: s.project_number, name: s.name, error: e.message, tools: events.map((x) => ({ name: x.name, error: x.error })) };
  }
  results.push(rec);
  console.log(`${s.name}: ${rec.error || (rec.placed ? `${rec.error_km} km, ${rec.confidence}` : "not placed")}`);
  writeFileSync(`${outDir}/results.json`, JSON.stringify(results, null, 1));
}

// ---- summary ----
const placed = results.filter((r) => r.placed);
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : null; };
const share = (a, km) => (a.length ? Math.round((100 * a.filter((x) => x <= km).length) / a.length) : null);
const errs = placed.map((r) => r.error_km);
const byConf = Object.fromEntries(["high", "medium", "low"].map((c) => {
  const e = placed.filter((r) => r.confidence === c).map((r) => r.error_km);
  return [c, { n: e.length, median_km: med(e), within_1km: share(e, 1), within_10km: share(e, 10) }];
}));
const earlier = results.filter((r) => r.earlier_pin?.error_km != null).map((r) => r.earlier_pin.error_km);
const summary = {
  label: LABEL, model: MODEL, skill_version: skill.version, created: new Date().toISOString(),
  sites: results.length, placed: placed.length, errors: results.filter((r) => r.error).length,
  median_error_km: med(errs), within_1km: share(errs, 1), within_5km: share(errs, 5), within_10km: share(errs, 10),
  truth_inside_shape: placed.filter((r) => r.truth_inside_shape).length,
  by_confidence: byConf,
  earlier_pins: { note: "The original pins in the evaluation set, before Rob checked them against imagery", n: earlier.length, median_error_km: med(earlier), within_1km: share(earlier, 1), within_10km: share(earlier, 10) },
  tokens: results.reduce((a, r) => ({ input: a.input + (r.usage?.input_tokens || 0), output: a.output + (r.usage?.output_tokens || 0) }), { input: 0, output: 0 }),
};
writeFileSync(`${outDir}/summary.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
