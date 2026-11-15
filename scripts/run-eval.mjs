// Run the evaluation: each site through each arm, scored against IFC's own screening.
// Arms: rules (no AI), off (agent, no skill), on (agent + skill), web (agent + skill + web search).
//
//   ANTHROPIC_API_KEY=... node scripts/run-eval.mjs --label=v1 --arms=rules,off,on,web --repeats=1 --sites=all
//
// Writes eval/runs/<label>/<arm>/r<k>/<site>.json (full trace) and eval/runs/<label>/summary.json,
// and adds the label to eval/index.json for the results page.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { runAgent, prepareData, findLeak } from "../js/agent.js";
import { FOOTPRINT_KM, screen, summarise, summariseGbif } from "../js/tools.js";
import { rules } from "../js/rules.js";

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const label = arg("label", "dev");
const arms = arg("arms", "rules,off,on").split(",");
const repeats = +arg("repeats", "1");
const concurrency = +arg("concurrency", "4");
const onlySites = arg("sites", "all");
const MODEL = arg("model", "claude-haiku-5-5");
const MAX_TOKENS = 8000; // same cap as the public Worker

const catalogue = JSON.parse(readFileSync("catalogue/catalogue.json"));
const skillText = readFileSync("skills/ntr-screening/SKILL.md", "utf8");
const skillSha = createHash("sha256").update(skillText).digest("hex").slice(0, 12);
let { sites } = JSON.parse(readFileSync("data/eval-sites.json"));
if (onlySites !== "all") sites = sites.filter((s) => onlySites.split(",").includes(s.id));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f)) : null);

// ---- Claude API with retries ----------------------------------------------------
const usageTotal = { requests: 0, input_tokens: 0, output_tokens: 0, web_searches: 0 };
async function callClaude({ system, messages, tools }) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, messages, tools }),
    }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
    usageTotal.requests++;
    if (res.ok) return res.json();
    const body = await res.text();
    if ((res.status === 429 || res.status >= 500 || res.status === 0) && attempt < 6) {
      const wait = Math.min(60000, 2000 * 2 ** attempt);
      console.log(`  retry after ${res.status} in ${wait / 1000} s`);
      await sleep(wait);
      continue;
    }
    throw new Error(`API ${res.status}: ${body.slice(0, 300)}`);
  }
}

// ---- One site, one arm -----------------------------------------------------------
function siteInputs(s) {
  const r = FOOTPRINT_KM[s.asset_type];
  const osmSnap = readJson(`data/osm/${s.id}.json`);
  const gbifSnap = readJson(`data/gbif/${s.id}.json`);
  const wdSnap = readJson(`data/wikidata/${s.id}.json`);
  const data = prepareData({ catalogue, site: s, footprintKm: r, osm: osmSnap?.osm, osmQuery: osmSnap?.query,
    gbif: gbifSnap && { near: gbifSnap.near, wide: gbifSnap.wide }, wikidata: wdSnap?.wikidata });
  return { r, data, versions: { osm: osmSnap?.catalogue_version || null, osm_fetched: osmSnap?.fetched, gbif: gbifSnap?.fetched, wikidata: wdSnap?.fetched } };
}

// Keep traces readable and small: drop encrypted search payloads and signatures.
function slimEvents(events) {
  return JSON.parse(JSON.stringify(events, (k, v) => (k === "encrypted_content" || k === "signature" || k === "encrypted_index" ? undefined : v)));
}

async function runOne(s, arm, rep) {
  const out = `eval/runs/${label}/${arm}/r${rep}/${s.id}.json`;
  if (existsSync(out)) return readJson(out); // resumable
  const { r, data, versions } = siteInputs(s);
  const base = { site_id: s.id, arm, repeat: rep, label, skill_sha: skillSha, catalogue_version: catalogue.version, data_versions: versions, started: new Date().toISOString() };
  let rec;
  if (arm === "rules") {
    rec = { ...base, result: rules(data.osmSummary || {}, s.asset_type, data.species), usage: null };
  } else {
    const events = [];
    const t0 = Date.now();
    try {
      const res = await runAgent({ site: s, footprintKm: r, skillOn: arm !== "off", skillText, deskResearch: arm === "web",
        data, callClaude, onEvent: (e) => events.push(e), maxRounds: 10 });
      rec = { ...base, model: MODEL, result: res.result, text: res.text, usage: res.usage, seconds: Math.round((Date.now() - t0) / 1000),
        leak: arm === "web" ? findLeak(s.name, events) : null, events: slimEvents(events) };
      usageTotal.input_tokens += res.usage.input_tokens; usageTotal.output_tokens += res.usage.output_tokens; usageTotal.web_searches += res.usage.web_searches;
    } catch (e) {
      rec = { ...base, model: MODEL, result: null, error: e.message, events: slimEvents(events) };
    }
  }
  mkdirSync(out.replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(out, JSON.stringify(rec));
  const res = rec.result;
  console.log(`${arm.padEnd(5)} r${rep} ${s.id} ${s.name.slice(0, 24).padEnd(25)} ` +
    (res ? ["ps5", "ps6", "ps7", "ps8"].map((k) => (res[k] === s.ifc[k] ? "✓" : "✗")).join("") + ` ${res.category}${s.ifc.category}` : `ERROR ${rec.error?.slice(0, 80)}`) +
    (rec.leak ? "  LEAK" : ""));
  return rec;
}

// ---- Scoring ---------------------------------------------------------------------
const PS = ["ps5", "ps6", "ps7", "ps8"];
function stats(pairs) {
  const n = pairs.length;
  const tp = pairs.filter(([g, p]) => g && p === true).length, tn = pairs.filter(([g, p]) => !g && p === false).length;
  const fp = pairs.filter(([g, p]) => !g && p === true).length, fn = pairs.filter(([g, p]) => g && p !== true).length;
  const po = n ? (tp + tn) / n : NaN, pg = (tp + fn) / n, pp = (tp + fp) / n, pe = pg * pp + (1 - pg) * (1 - pp);
  const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
  return { n, positives: tp + fn, agree: r2(po), kappa: r2(pe < 1 ? (po - pe) / (1 - pe) : NaN),
    precision: r2(tp + fp ? tp / (tp + fp) : NaN), recall: r2(tp + fn ? tp / (tp + fn) : NaN), fp, fn };
}
function scoreArm(recs, excludeLeaks = false) {
  const use = recs.filter((x) => !(excludeLeaks && x.leak));
  const bySite = Object.fromEntries(sites.map((s) => [s.id, s]));
  const per_ps = {};
  for (const k of PS) per_ps[k] = stats(use.map((x) => [bySite[x.site_id].ifc[k], x.result ? x.result[k] : null]));
  const all = stats(use.flatMap((x) => PS.map((k) => [bySite[x.site_id].ifc[k], x.result ? x.result[k] : null])));
  const catAgree = use.filter((x) => x.result?.category === bySite[x.site_id].ifc.category).length / (use.length || 1);
  return { runs: use.length, failed: use.filter((x) => !x.result).length, leaks: recs.filter((x) => x.leak).length,
    overall: all, per_ps, category_agree: Math.round(catAgree * 100) / 100 };
}
// Consistency: for each site and standard, do all repeats give the same answer?
function consistency(recs) {
  const groups = {};
  for (const x of recs) (groups[x.site_id] ||= []).push(x.result);
  const cells = Object.values(groups).filter((g) => g.length > 1).flatMap((g) => PS.map((k) => g.every((r) => r && r[k] === g[0]?.[k])));
  return cells.length ? Math.round((cells.filter(Boolean).length / cells.length) * 100) / 100 : null;
}

// ---- Main ------------------------------------------------------------------------
if (arms.some((a) => a !== "rules") && !process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
const usable = sites.filter((s) => existsSync(`data/osm/${s.id}.json`));
console.log(`Label ${label}, skill ${skillSha}, catalogue ${catalogue.version}, ${usable.length} sites with data, arms ${arms.join(",")}, repeats ${repeats}`);
const jobs = [];
for (const arm of arms) for (let rep = 1; rep <= (arm === "rules" ? 1 : repeats); rep++) for (const s of usable) jobs.push([s, arm, rep]);
const records = [];
let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < jobs.length) { const [s, arm, rep] = jobs[next++]; records.push(await runOne(s, arm, rep)); }
}));

const summary = { label, created: new Date().toISOString(), model: MODEL, skill_sha: skillSha, catalogue_version: catalogue.version,
  sites: usable.length, repeats, arms: {}, usage_this_run: usageTotal };
for (const arm of arms) {
  const recs = records.filter((x) => x.arm === arm);
  summary.arms[arm] = { ...scoreArm(recs), without_leaks: arm === "web" ? scoreArm(recs, true) : undefined,
    consistency: consistency(recs),
    usage: recs.reduce((a, x) => (x.usage ? { input_tokens: a.input_tokens + x.usage.input_tokens, output_tokens: a.output_tokens + x.usage.output_tokens, web_searches: a.web_searches + (x.usage.web_searches || 0) } : a), { input_tokens: 0, output_tokens: 0, web_searches: 0 }) };
}
// Per-site table for the results page.
summary.per_site = usable.map((s) => ({ id: s.id, name: s.name, country: s.country, asset_type: s.asset_type, ifc: s.ifc,
  arms: Object.fromEntries(arms.map((arm) => [arm, records.filter((x) => x.arm === arm && x.site_id === s.id).map((x) => ({ result: x.result && { ...Object.fromEntries(PS.map((k) => [k, x.result[k]])), category: x.result.category }, leak: !!x.leak, repeat: x.repeat }))])) }));
mkdirSync(`eval/runs/${label}`, { recursive: true });
writeFileSync(`eval/runs/${label}/summary.json`, JSON.stringify(summary, null, 1));
const index = readJson("eval/index.json") || { runs: [] };
index.runs = [...index.runs.filter((r) => r.label !== label), { label, created: summary.created, skill_sha: skillSha, arms }];
writeFileSync("eval/index.json", JSON.stringify(index, null, 1));

console.log("\narm    sites  agree  kappa  PS5   PS6   PS7   PS8   cat   consistency");
for (const [arm, a] of Object.entries(summary.arms)) {
  console.log(`${arm.padEnd(6)} ${String(a.runs).padStart(5)}  ${a.overall.agree}   ${a.overall.kappa}  ` + PS.map((k) => String(a.per_ps[k].agree).padEnd(5)).join(" ") + ` ${a.category_agree}  ${a.consistency ?? "-"}${a.leaks ? `  (${a.leaks} leaks)` : ""}`);
}
const cost = (usageTotal.input_tokens * 0.1 + usageTotal.output_tokens * 0.5) / 1e6 + usageTotal.web_searches * 0.01;
console.log(`\nThis run: ${usageTotal.requests} API requests, ${usageTotal.input_tokens} input / ${usageTotal.output_tokens} output tokens, ${usageTotal.web_searches} searches, about $${cost.toFixed(2)}`);
