// Sealed NTR runs: a screening runs as its own short agent loop (skill, fixed inputs, read-only data tools,
// structured result), never inside the conversation. The result is a run record: GeoJSON with provenance, the one
// source for the card, the map and later exports. No DOM, so the page, the scripts and the tests share it.
import * as turf from "./vendor/turf.js";
import * as R from "./reference.js";
import { FENCE_RULE } from "./fence.js";
import { runTurn } from "./converse.js";
import { createPlaceTools, placeToolDefs } from "./placetools.js";
import { bandFor, distancesLine, chooseDistances, ASSET_TYPES, MAX_KM } from "./distances.js";
import { nearestBoundaries } from "./boundaries.js";
import { DISCLAIMER } from "./disclaimer.js";

export const RUN_SCHEMA = "tobler-run/1";
export const SCREEN_TOOLS = ["get_place", "find_data", "get_data", "find_features_near"];
const THEME_OF = { PS4: "community", PS5: "land", PS6: "biodiversity", PS7: "indigenous", PS8: "heritage", context: "context" };
export const THEME_CODE = Object.fromEntries(Object.entries(THEME_OF).map(([k, v]) => [v, k]));
const CONF_ORDER = { high: 0, medium: 1, low: 2 };
const round = (v, d = 2) => (v == null || !Number.isFinite(+v) ? null : Math.round(+v * 10 ** d) / 10 ** d);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// The site as screened: a point gets a footprint circle (radius from the distance table); lines and areas as they are.
export function footprintOf(feature, d) {
  if (feature.geometry.type !== "Point") return { feature, note: null };
  const f = turf.circle(feature.geometry.coordinates, d.footprint_km, { units: "kilometers", steps: 48 });
  return { feature: { type: "Feature", properties: {}, geometry: f.geometry }, note: `a point, screened as a ${d.footprint_km} km footprint round it (default for a ${d.asset_label})` };
}

export function systemFor(skill) {
  return `You are Tobler's screening analyst, running one sealed non-technical risk (NTR) screen of one site. Nobody is chatting with you: do the screen, then write the result.

- ${FENCE_RULE}
- The site, its footprint, the asset type, the stage and the distances are fixed by this run and given in the first message. Use them as given; don't ask about them and don't change them. If the stage or asset type was assumed, say so in the summary.
- The tools fetch every dataset out to the wider band and measure from the footprint edge. Never work out a distance yourself: use the distances the tools return.
- Put independent searches in the same step: they run at the same time. Aim to finish within about ten steps.
- Name features and datasets as the data names them. Ids (C3, D2) are for tool calls only.
- Your last message is the result: the short summary, then the JSON block, exactly as the method's Output section says. Use the distances given (not the skill's table) in "distances_km".
- Keep the result compact so it fits in one reply: summary under 300 words; at most 8 flags; at most 4 evidence items per flag (the nearest or strongest, and say in "why" how many more there are); "data_gaps" at most 12 short lines; leave "checked" as an empty list, because the run records what the tools checked itself. Keep your thinking before the result short: the reply limit (8,000 tokens) includes it.

<method skill="${skill.name}" version="${skill.version}">
${skill.body}
</method>`;
}

export function firstMessage({ siteName, describe, inputs, distances, footprintNote, origin, baseline = null }) {
  const lines = [
    `Screen ${siteName}.`,
    `Site: ${R.summaryLine(describe)}${footprintNote ? `; ${footprintNote}` : ""}.`,
    origin ? `How the site was found: ${origin}.` : null,
    `Setting: ${describe.offshore ? "offshore" : "onshore"}${describe.coast_km != null && describe.coast_km < 10 ? " (coastal: screen both ways)" : ""}.`,
    `Asset type: ${inputs.asset_label}${inputs.asset_assumed ? " (assumed: say so)" : ""}. Stage: ${inputs.stage || "greenfield (assumed: say so)"}.`,
    inputs.capacity_mw ? `Capacity: ${inputs.capacity_mw} MW.` : null,
    inputs.tip_height_m ? `Turbine tip height: ${inputs.tip_height_m} m.` : null,
    `Distances from the footprint edge: ${distancesLine(distances)}. Why: ${distances.reasons.join("; ")}.`,
    inputs.focus ? `The person asked especially about: ${inputs.focus}.` : null,
    baseline ? `Already checked by the run before you started (don't fetch these again; they are evidence like anything you fetch, and failures are gaps):\n${baseline}` : null,
    `Refer to the site as "${siteName}" in tool calls.`,
  ];
  return lines.filter(Boolean).join("\n");
}

// The last ```json block in the reply (or the last {...} that parses).
export function parseResult(text) {
  const t = String(text || "");
  const re = /```(?:json)?\s*([\s\S]*?)```/g;
  const blocks = [];
  for (let m; (m = re.exec(t));) blocks.push({ body: m[1], start: m.index });
  for (const b of blocks.reverse()) { try { return { json: JSON.parse(b.body), summary: t.slice(0, b.start).trim() }; } catch { /* try the one before */ } }
  const i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i >= 0 && j > i) { try { return { json: JSON.parse(t.slice(i, j + 1)), summary: t.slice(0, i).trim() }; } catch { /* fall through */ } }
  return { json: null, summary: t.trim() };
}

// Match each evidence item the model gave to a feature the tools actually returned in this run.
export function traceFlags(flags, evidence, d) {
  const feats = evidence.map((f) => ({ f, n: norm(f.properties.name), ds: norm(f.properties.dataset) }));
  return (flags || []).map((flag) => {
    const ev = (flag.evidence || []).map((e) => {
      const n = norm(e.name), ds = norm(e.dataset);
      const near = (f) => e.distance_km == null || f.properties.distance_km == null || Math.abs(f.properties.distance_km - e.distance_km) <= Math.max(0.5, 0.15 * f.properties.distance_km);
      const named = feats.filter((x) => n && x.n && (x.n === n || (n.length >= 4 && (x.n.includes(n) || n.includes(x.n)))));
      const hit = named.find((x) => near(x.f) && ds && x.ds && (x.ds.includes(ds) || ds.includes(x.ds))) || named.find((x) => near(x.f)) || null;
      if (!hit) return { ...e, distance_km: round(e.distance_km), traced: false };
      const p = hit.f.properties;
      return { ...e, name: p.name, distance_km: p.distance_km, band: bandFor(p.distance_km, d), dataset: p.dataset, publisher: p.publisher, licence: p.licence, checked: p.checked_at, fid: p.fid, traced: true };
    });
    const traced = ev.filter((e) => e.traced);
    const dists = (traced.length ? traced : ev).map((e) => e.distance_km).filter((v) => v != null);
    return {
      risk: String(flag.risk || "").trim(), theme: THEME_OF[flag.theme] || THEME_OF[String(flag.theme || "").toUpperCase()] || (THEME_CODE[flag.theme] ? flag.theme : "context"),
      confidence: CONF_ORDER[flag.confidence] != null ? flag.confidence : "low", why: flag.why || "", evidence: ev,
      fids: traced.map((e) => e.fid), nearest_km: dists.length ? Math.min(...dists) : null, traced: traced.length, untraced: ev.length - traced.length,
    };
  }).sort((a, b) => CONF_ORDER[a.confidence] - CONF_ORDER[b.confidence] || (a.nearest_km ?? 1e9) - (b.nearest_km ?? 1e9));
}

// What the tools actually checked, from their replies (ground truth for the card, beside the model's own list).
function checkedFrom(tool, input, out) {
  if (tool === "get_data") {
    if (!out) return null;
    return { evidence: input.theme || "", dataset: out.dataset || input.dataset, publisher: out.publisher || "", licence: out.licence || "", checked_at: out.checked_at,
      result: out.not_checked ? "not checked" : out.within_distance ? "features" : "none in dataset", count: out.within_distance || 0, ...(out.not_checked ? { why: out.not_checked } : {}) };
  }
  if (tool === "find_features_near") {
    if (!out) return null;
    const srcs = out.sources || [];
    const failed = srcs.filter((s) => s.not_checked || s.error).map((s) => `${s.source}: ${s.not_checked || s.error}`);
    return { evidence: input.theme || "", dataset: `${input.feature_type} (atlas and OpenStreetMap)`, publisher: srcs.map((s) => s.source).join(", "), licence: "",
      result: out.found ? "features" : failed.length === srcs.length && srcs.length ? "not checked" : "none in dataset", count: out.found || 0, ...(failed.length ? { why: failed.join("; ").slice(0, 300) } : {}) };
  }
  if (tool === "find_data" && out?.not_checked) return { evidence: input.text, dataset: `catalogue search "${input.text}"`, publisher: "AI Living World Atlas", result: "not checked", why: out.not_checked };
  return null;
}

// host: the same host the page gives createPlaceTools (atlas, firms, ref, trusted, fetchFn…). The run gets its own
// tools, with a host whose only place is the site footprint and whose findings go into the run, not the map.
export async function runScreening({ host, site, inputs, distances, skill, callClaude, model = "", runId = "R1", maxRounds = 14, onEvent = () => {}, now = () => new Date().toISOString() }) {
  const started = now();
  const fp = footprintOf(site.feature, distances);
  const screenPlace = { name: site.name, feature: fp.feature, origin: site.origin, status: "accepted", edits: [] };
  const evidence = [];
  const seen = new Map();
  const capture = (list, meta = {}) => {
    for (const c of list) {
      const dataset = c.source?.title || meta.dataset || "";
      const key = `${norm(dataset)}|${norm(c.name)}|${round(c.distance_km, 2)}`;
      if (seen.has(key)) continue;
      const fid = `E${evidence.length + 1}`;
      seen.set(key, fid);
      evidence.push({ type: "Feature", geometry: c.geometry, properties: {
        role: "evidence", fid, run: runId, name: c.name || c.type || "Unnamed feature", type: c.type || "", theme: meta.theme || "context",
        distance_km: round(c.distance_km, 2), band: bandFor(c.distance_km, distances), area_km2: c.area_km2 ?? null,
        dataset, publisher: meta.publisher || c.source?.publisher || "", licence: c.source?.licence || "",
        checked_at: now(), ...(c.extra && Object.keys(c.extra).length ? { details: c.extra } : {}),
      } });
    }
  };
  const sealedHost = {
    ...host,
    places: () => [screenPlace],
    // One place in a sealed run: any place name means the site.
    findPlace: () => screenPlace,
    addPlace() { throw new Error("A screening run can't add places."); },
    updatePlace() { throw new Error("A screening run can't change places."); },
    renamePlace() { throw new Error("A screening run can't rename places."); },
    offerChoices: undefined, onCandidates: undefined, showFindings: undefined, clearFindings: undefined,
    addFindings: capture,
  };
  const tools = createPlaceTools(sealedHost);
  const defs = placeToolDefs([]).filter((t) => SCREEN_TOOLS.includes(t.name));
  const checked = [];
  const calls = [];
  const exec = async (name, input) => {
    if (!SCREEN_TOOLS.includes(name)) throw new Error(`${name} isn't available in a screening run.`);
    const i = { ...input };
    // Fetch once, out to the wider band, so the card's slider can work inside it without new queries.
    if (name === "get_data") { i.place = site.name; i.within_km = Math.min(MAX_KM, Math.max(+i.within_km || 0, distances.wider)); }
    if (name === "find_features_near") { i.anchor = /^C\d+$/i.test(String(i.anchor || "")) ? i.anchor : site.name; i.radius_km = Math.min(MAX_KM, Math.max(+i.radius_km || 0, distances.wider)); }
    const t0 = Date.now();
    try {
      const out = await tools.exec(name, i);
      calls.push({ tool: name, input: i, ms: Date.now() - t0 });
      const c = checkedFrom(name, i, out); if (c) checked.push(c);
      return out;
    } catch (e) {
      calls.push({ tool: name, input: i, ms: Date.now() - t0, error: String(e.message || e).slice(0, 200) });
      if (name === "get_data" || name === "find_features_near") checked.push({ evidence: i.theme || "", dataset: i.dataset || i.feature_type, result: "not checked", why: String(e.message || e).slice(0, 200) });
      throw e;
    }
  };
  const describe = await R.describe(host.ref, fp.feature);
  const offshore = !!describe.offshore;
  // Baseline, in code, before the analyst starts: boundaries (land and maritime) and the layers every screen must
  // check (catalogue/trusted.json "baseline"), so the essentials never depend on a lucky catalogue search.
  const sea = offshore || (describe.coast_km != null && describe.coast_km <= distances.wider);
  const baselineLines = [];
  const summarise = (c) => {
    const near = evidence.filter((f) => f.properties.dataset === c.dataset).sort((a, b) => a.properties.distance_km - b.properties.distance_km).slice(0, 3)
      .map((f) => `${f.properties.name}${f.properties.details?.sides ? ` [${f.properties.details.sides}${f.properties.details.line_type ? `, ${f.properties.details.line_type}` : ""}]` : ""} ${f.properties.distance_km} km`);
    return `- ${c.dataset} (${c.publisher || "?"}): ${c.result === "features" ? `${c.count} within ${distances.wider} km; nearest ${near.join("; ")}` : c.result}${c.why ? ` (${c.why})` : ""}`;
  };
  try {
    const nb = await nearestBoundaries({ ref: host.ref, site: fp.feature, withinKm: distances.wider, atlas: host.atlas || null, sea, now });
    capture(nb.evidence, { theme: "context" });
    for (const c of nb.checked) { checked.push(c); baselineLines.push(summarise(c)); }
  } catch (e) { checked.push({ evidence: "transboundary", dataset: "boundaries", result: "not checked", why: String(e.message || e).slice(0, 160) }); }
  const sb = turf.bbox(fp.feature);
  const layers = (host.trusted?.baseline || []).filter((b) => (b.setting !== "sea" || sea) && !(sb[2] < b.where[0] || sb[0] > b.where[2] || sb[3] < b.where[1] || sb[1] > b.where[3]));
  const before = checked.length;
  await Promise.allSettled(layers.map((b) => {
    const id = tools.useDataset({ id: b.atlas_id, title: b.title, publisher: b.publisher, licence: b.licence, capabilities: ["query"], concepts: [] }, "B");
    return exec("get_data", { dataset: id, place: site.name, theme: b.theme }).catch(() => null);
  }));
  for (const c of checked.slice(before)) baselineLines.push(summarise(c));
  const baselineCalls = calls.length;
  const origin = site.origin?.method === "words"
    ? `from the words "${site.origin.words}", anchored on ${site.origin.anchor?.name || site.origin.anchor?.place || "a found feature"}${site.origin.anchor?.source?.publisher ? ` (${site.origin.anchor.source.publisher})` : ""}, ${site.origin.confidence} confidence`
    : "drawn on the map by the person";
  const res = await runTurn({
    system: systemFor(skill),
    messages: [{ role: "user", content: firstMessage({ siteName: site.name, describe, inputs, distances, footprintNote: fp.note, origin, baseline: baselineLines.join("\n") || null }) }],
    tools: defs, exec, callClaude, maxRounds,
    onEvent: (ev) => { if (ev.type === "tool_start") onEvent({ type: "tool_start", name: ev.name, input: ev.input }); if (ev.type === "tool" || ev.type === "round" || ev.type === "warning") onEvent(ev); },
  });
  let parsed = parseResult(res.text);
  const usage = { ...res.usage };
  let repaired = false;
  const lastMsg = res.history.at(-1);
  const debug = { final_chars: String(res.text || "").length, final_blocks: Array.isArray(lastMsg?.content) ? lastMsg.content.map((b) => b.type).join(",") : typeof lastMsg?.content };
  if (!parsed.json) {
    // Cut off (the reply hit the length cap) or no JSON block: ask once for the JSON alone, from the same history.
    // Thinking blocks are signed to the request they came from, so they're dropped (as in the conversation loop);
    // the cut-off message keeps only its text. Haiku thinks by default, and on a big screen the thinking can use
    // most of the 8,000-token cap before the write-up ends (Rosebank, 18 Nov).
    const last = res.history.length - 1;
    const history = res.history.map((m, i) => {
      if (m.role !== "assistant" || !Array.isArray(m.content)) return m;
      const keep = m.content.filter((b) => (i === last ? b.type === "text" : b.type !== "thinking" && b.type !== "redacted_thinking"));
      return { ...m, content: keep.length ? keep : [{ type: "text", text: "…" }] };
    });
    if (history.at(-1)?.role === "user") history.pop();
    try {
      const resp = await callClaude({ system: systemFor(skill), tools: defs, messages: [...history, { role: "user", content: "Your result was cut off or had no JSON block. Reply now with only the JSON block, compact: at most 6 flags, at most 3 evidence items each (name, distance_km, dataset only), data_gaps at most 10 short lines, checked as []. Keep any thinking brief." }] });
      usage.input_tokens += resp.usage?.input_tokens || 0; usage.output_tokens += resp.usage?.output_tokens || 0;
      const t2 = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      debug.repair_stop = resp.stop_reason; debug.repair_chars = t2.length; debug.repair_head = t2.slice(0, 300);
      const again = parseResult(t2);
      if (again.json) { parsed = { json: again.json, summary: String(res.text || "").split("```")[0].trim() }; repaired = true; }
    } catch (e) { debug.repair_error = String(e.message || e).slice(0, 300); }
    debug.raw_tail = String(res.text || "").slice(-1500);
  }
  const flags = traceFlags(parsed.json?.flags, evidence, distances);
  const siteFeature = { type: "Feature", geometry: fp.feature.geometry, properties: { role: "site", name: site.name, run: runId } };
  return {
    type: "FeatureCollection",
    tobler_run: {
      schema: RUN_SCHEMA, id: runId, kind: "ntr-screen", skill: { name: skill.name, version: skill.version }, model,
      started_at: started, finished_at: now(),
      site: {
        name: site.name, how_found: origin, confidence: site.origin?.method === "words" ? site.origin.confidence : "drawn",
        anchor_source: site.origin?.anchor?.source ? { title: site.origin.anchor.source.title, publisher: site.origin.anchor.source.publisher, licence: site.origin.anchor.source.licence } : null,
        footprint: fp.note || `screened on the ${/Line/.test(site.feature.geometry.type) ? "line" : "area"} itself`,
        setting: offshore ? "offshore" : "onshore", summary: R.summaryLine(describe),
        asset_type: inputs.asset_type, asset_label: inputs.asset_label, asset_assumed: !!inputs.asset_assumed,
        stage: inputs.stage || "greenfield (assumed)", capacity_mw: inputs.capacity_mw ?? null, tip_height_m: inputs.tip_height_m ?? null,
      },
      distances, fetched_to_km: distances.wider, assessed_within_km: distances.wider,
      method: "Distances geodesic on WGS84, measured from the footprint edge (0 = on site); features fetched once out to the wider band. Coordinates WGS84 (EPSG:4326).",
      flags, checked, data_gaps: Array.isArray(parsed.json?.data_gaps) ? parsed.json.data_gaps.map(String) : [],
      model_checked: Array.isArray(parsed.json?.checked) ? parsed.json.checked : [],
      summary: parsed.summary, ...(parsed.json ? {} : { parse_error: "The analyst's result had no readable JSON block, so there are no structured flags. The summary is kept as written." }),
      baseline: { layers: layers.map((b) => b.title), calls: baselineCalls }, disclaimer: DISCLAIMER,
      calls, usage, ...(parsed.json && !repaired ? {} : { debug }), ...(repaired ? { note: "The first result was cut off; the structured result was asked for again from the same evidence." } : {}), assessments: [],
    },
    features: [siteFeature, ...evidence],
  };
}

export const evidenceOf = (record) => record.features.filter((f) => f.properties.role === "evidence");

// The slider: findings up to km, nearest first.
export function evidenceWithin(record, km) {
  return evidenceOf(record).filter((f) => f.properties.distance_km != null && f.properties.distance_km <= km + 1e-9)
    .sort((a, b) => a.properties.distance_km - b.properties.distance_km);
}

// "First school at 1.3 km": the nearest finding of each theme within km.
export function nearestByTheme(record, km) {
  const out = new Map();
  for (const f of evidenceWithin(record, km)) if (!out.has(f.properties.theme)) out.set(f.properties.theme, f.properties);
  return [...out.entries()].map(([theme, p]) => ({ theme, name: p.name, distance_km: p.distance_km }));
}

// Whether a flag's traced evidence is all beyond km (the flag still stands as written; the card says so).
export function flagBeyond(flag, km) {
  if (!flag.fids?.length) return false;
  return flag.nearest_km != null && flag.nearest_km > km + 1e-9;
}

// Re-assess on tap: the stored evidence within km, no new fetching, one model call without tools.
export async function reassess({ record, km, skill, callClaude, now = () => new Date().toISOString() }) {
  const run = record.tobler_run;
  const d = { ...run.distances, wider: km, close: Math.min(run.distances.close, km), near: Math.min(run.distances.near, km), set_by: "person",
    reasons: [`re-assessed from the stored evidence within ${km} km (fetched to ${run.fetched_to_km} km)`, ...run.distances.reasons] };
  const ev = evidenceWithin(record, km).map((f) => {
    const p = f.properties;
    return { name: p.name, type: p.type, theme: THEME_CODE[p.theme] || p.theme, distance_km: p.distance_km, band: bandFor(p.distance_km, d), dataset: p.dataset, publisher: p.publisher, licence: p.licence, checked: p.checked_at, ...(p.details ? { details: p.details } : {}) };
  });
  const message = [
    `Re-assess the screen of ${run.site.name} for findings within ${km} km of the footprint edge. No tools: use only the evidence below, which was fetched in the original run.`,
    `Site: ${run.site.summary}; ${run.site.footprint}. Setting: ${run.site.setting}. Asset type: ${run.site.asset_label}. Stage: ${run.site.stage}.`,
    `Distances now: ${distancesLine(d)}.`,
    `Evidence within ${km} km (${ev.length} features):\n${JSON.stringify(ev)}`,
    `What the original run checked:\n${JSON.stringify(run.checked.map((c) => ({ dataset: c.dataset, publisher: c.publisher, result: c.result, ...(c.why ? { why: c.why } : {}) })))}`,
    `Gaps from the original run:\n${JSON.stringify(run.data_gaps)}`,
    "Write the short summary and the JSON block as the method says. Features beyond the new distance are out of scope; gaps still stand.",
  ].join("\n\n");
  const resp = await callClaude({ system: systemFor(skill), messages: [{ role: "user", content: message }] });
  const text = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  const parsed = parseResult(text);
  if (!parsed.json) throw new Error("The re-assessment came back without a readable result. The earlier flags are unchanged.");
  run.assessments.push({ at: now(), within_km: run.assessed_within_km, flags: run.flags, summary: run.summary, distances: run.distances });
  run.flags = traceFlags(parsed.json.flags, evidenceOf(record), d);
  run.data_gaps = Array.isArray(parsed.json.data_gaps) ? parsed.json.data_gaps.map(String) : run.data_gaps;
  run.summary = parsed.summary;
  run.distances = d;
  run.assessed_within_km = km;
  for (const f of evidenceOf(record)) f.properties.band = bandFor(f.properties.distance_km, d);
  run.usage = { input_tokens: (run.usage?.input_tokens || 0) + (resp.usage?.input_tokens || 0), output_tokens: (run.usage?.output_tokens || 0) + (resp.usage?.output_tokens || 0) };
  return record;
}

// What the conversation agent gets back: the headline only. Detail stays in the run (get_run).
export function headline(record) {
  const r = record.tobler_run;
  const byConf = { high: 0, medium: 0, low: 0 };
  r.flags.forEach((f) => { byConf[f.confidence]++; });
  const notChecked = r.checked.filter((c) => c.result === "not checked");
  return {
    run: r.id, site: r.site.name, distances: distancesLine(r.distances), asset: `${r.site.asset_label}${r.site.asset_assumed ? " (assumed)" : ""}`, stage: r.site.stage,
    flags: r.flags.length, by_confidence: byConf,
    top_flags: r.flags.slice(0, 5).map((f) => ({ risk: f.risk, confidence: f.confidence, theme: f.theme, nearest_km: f.nearest_km })),
    evidence_features: evidenceOf(record).length, sources_checked: r.checked.length, not_checked: notChecked.map((c) => c.dataset).slice(0, 6), gaps: r.data_gaps.length,
    ...(r.parse_error ? { problem: r.parse_error } : {}),
    note: "The run card under your reply shows the flags, evidence, distances (with a slider) and gaps, and the map shows the evidence. Reply in two or three sentences: the most serious flags and the main gaps. Don't repeat the card.",
  };
}

// The screening service the conversation's screen_site and get_run tools call. table: catalogue/distances.json;
// skill: the parsed NTR skill. onRun(record, place) shows the card; onEvent reports progress.
export function createScreening({ host, table, skill, callClaude, model = "", onRun = () => {}, onEvent = () => {}, now }) {
  const runs = new Map();
  let n = 0;
  return {
    runs,
    async screen(i, place) {
      const sk = typeof skill === "function" ? skill() : skill;
      const tb = typeof table === "function" ? table() : table;
      if (!sk?.body || !tb?.assets) throw new Error("The screening method or the distance table hasn't loaded yet; try again in a moment.");
      const d0 = await R.describe(host.ref, place.feature);
      const asset = ASSET_TYPES.includes(i.asset_type) && i.asset_type !== "other" ? i.asset_type : null;
      const num = (v) => (Number.isFinite(+v) && +v > 0 ? +v : null);
      const site = { asset_type: asset, offshore: !!d0.offshore, capacity_mw: num(i.capacity_mw), tip_height_m: num(i.tip_height_m), area_km2: d0.area_km2 ?? null };
      const distances = chooseDistances(tb, site, i.distances || {});
      const id = `R${++n}`;
      const record = await runScreening({
        host, site: { name: place.name, feature: place.feature, origin: place.origin }, distances, skill: sk, callClaude, model, runId: id, onEvent, ...(now ? { now } : {}),
        inputs: { asset_type: asset || "other", asset_label: asset ? tb.assets[asset].label : "site of unknown type", asset_assumed: !asset || !!i.assumed,
          stage: i.stage || "", capacity_mw: site.capacity_mw, tip_height_m: site.tip_height_m, focus: i.focus || "" },
      });
      record.tobler_run.place_id = place.id ?? null;
      record.tobler_run.place_geometry_at_run = JSON.stringify(place.feature.geometry);
      runs.set(id, record);
      onRun(record, place);
      return headline(record);
    },
    getRun(id) {
      const rec = runs.get(String(id || "").trim().toUpperCase()) || [...runs.values()].at(-1);
      if (!rec) throw new Error("No screening runs yet in this conversation.");
      const r = rec.tobler_run;
      return {
        run: r.id, site: r.site.name, asset: r.site.asset_label, stage: r.site.stage, distances: distancesLine(r.distances), assessed_within_km: r.assessed_within_km,
        flags: r.flags.map((f) => ({ risk: f.risk, theme: THEME_CODE[f.theme] || f.theme, confidence: f.confidence, why: f.why,
          evidence: f.evidence.map((e) => ({ name: e.name, distance_km: e.distance_km, band: e.band, dataset: e.dataset, publisher: e.publisher, traced: e.traced })) })),
        checked: r.checked.map((c) => ({ dataset: c.dataset, publisher: c.publisher, result: c.result, ...(c.count ? { count: c.count } : {}), ...(c.why ? { why: c.why.slice(0, 160) } : {}) })),
        data_gaps: r.data_gaps,
      };
    },
  };
}
