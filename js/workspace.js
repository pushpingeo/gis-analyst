// The workspace page: map, drawing and editing tools, and the conversation with the analyst.
// Places are the record; cards are views of them. The analyst sees a compact project summary each turn.
import { TerraDraw, TerraDrawMapLibreGLAdapter, TerraDrawSelectMode, TerraDrawPointMode, TerraDrawLineStringMode,
  TerraDrawPolygonMode, TerraDrawRectangleMode, TerraDrawCircleMode } from "./vendor/draw.js";
import * as turf from "./vendor/turf.js";
import * as G from "./geometry.js";
import * as R from "./reference.js";
import { placeToolDefs, createPlaceTools, projectSummary } from "./placetools.js";
import { parseSkill, systemPrompt, buildMessages, runTurn, activityFor } from "./converse.js";
import { callClaude, LimitReached } from "./claude.js?v=m2b";

const $ = (id) => document.getElementById(id);
const C = { ink: "#15303c", pole: "#d1352a", white: "#ffffff", sea: "#2b6a80" };
const BASEMAP = "https://tiles.openfreemap.org/styles/positron";

// ---- reference data -------------------------------------------------------------
const ref = R.createReference(async (name) => {
  activity(`Loading ${name === "places" ? "towns and cities" : name}…`, true);
  const r = await fetch(`data/ref/${name}.json`);
  if (!r.ok) throw new Error(`Couldn't load the ${name} layer (${r.status}).`);
  return r.json();
});

// ---- map ---------------------------------------------------------------------------
const map = new maplibregl.Map({
  container: "map", style: BASEMAP, center: [8, 30], zoom: 1.6, attributionControl: false,
  boxZoom: false, // Shift-drag rotates a selected shape instead
});
// On a phone the sheet covers the bottom of the map, so the attribution moves to the top.
const phone = innerWidth <= 720;
map.addControl(new maplibregl.AttributionControl({ compact: true }), phone ? "top-right" : "bottom-right");
if (!phone) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

// If the basemap can't be reached, fall back to the reference countries on a plain background so the tools still work.
// Start on "style.load", not "load": a hidden tab doesn't render, so "load" may never come (lesson from demo 1).
let started = false, fellBack = false;
// A hidden tab may not finish loading the style at all, so the wait only counts while the page is visible.
let fallbackTimer = setTimeout(fallbackIfVisible, 15000);
function fallbackIfVisible() {
  if (document.hidden) fallbackTimer = setTimeout(fallbackIfVisible, 15000);
  else useFallbackBasemap();
}
map.on("error", (e) => { if (!started && /style|fetch|Failed|NetworkError/i.test(String(e?.error?.message || ""))) useFallbackBasemap(); });
map.once("style.load", start);

async function useFallbackBasemap() {
  if (started || fellBack || map.isStyleLoaded()) return;
  fellBack = true;
  map.off("style.load", start);
  const countries = await ref.get("countries").catch(() => null);
  map.setStyle({
    version: 8, sources: countries ? { ne: { type: "geojson", data: countries, attribution: "Natural Earth" } } : {},
    layers: [{ id: "bg", type: "background", paint: { "background-color": "#dce7ea" } },
      ...(countries ? [{ id: "land", type: "fill", source: "ne", paint: { "fill-color": "#f6f7f5" } },
        { id: "borders", type: "line", source: "ne", paint: { "line-color": "#b9c6c9", "line-width": 0.6 } }] : [])],
  });
  map.once("style.load", start);
  note("The background map couldn't be loaded, so a plain outline map is shown. Drawing still works.");
  activity("");
}

// ---- places ---------------------------------------------------------------------------
// A place: { id (Terra Draw id), name, kind, feature, status: drawn | proposed | accepted, origin, edits, scale, scaleFrom, card }
let draw;
const places = new Map();
const counts = { Point: 0, Line: 0, Area: 0 };
let selectedId = null;
let focusName = null;

const kindOf = (geom) => (geom.type === "Point" ? "Point" : /LineString/.test(geom.type) ? "Line" : "Area");
const placeByName = (name) => [...places.values()].find((p) => p.name.toLowerCase() === String(name).trim().toLowerCase());
const featureOf = (id) => { const f = draw.getSnapshotFeature(id); return f && { type: "Feature", properties: {}, geometry: f.geometry }; };

function newPlace(id, feature, { status = "drawn", origin = { method: "drawn", at: new Date().toISOString() } } = {}) {
  const kind = kindOf(feature.geometry);
  const p = { id, kind, name: `${kind} ${++counts[kind]}`, feature, status, origin, edits: [], scaleFrom: "size" };
  places.set(id, p);
  p.card = makeCard(p);
  focusName = p.name;
  refreshCard(p);
  scheduleRefresh();
  return p;
}

function start() {
  if (started) return;
  started = true;
  clearTimeout(fallbackTimer);

  // Your places, drawn as ranging-pole bands. Terra Draw's own layers sit above these, for handles.
  map.addSource("aoi", { type: "geojson", data: turf.featureCollection([]) });
  const proposed = ["==", ["get", "status"], "proposed"];
  map.addLayer({ id: "aoi-fill", type: "fill", source: "aoi", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": C.pole, "fill-opacity": ["case", proposed, 0.04, 0.07] } });
  map.addLayer({ id: "aoi-halo", type: "line", source: "aoi", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": C.ink, "line-width": 6.5, "line-opacity": ["case", proposed, 0.45, 0.85] } });
  map.addLayer({ id: "aoi-white", type: "line", source: "aoi", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": C.white, "line-width": 4.5 } });
  map.addLayer({ id: "aoi-red", type: "line", source: "aoi", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": C.pole, "line-width": 4.5, "line-dasharray": [1.6, 1.6], "line-opacity": ["case", proposed, 0.6, 1] } });
  // Candidates the analyst found: small, quiet markers so you can see what it was choosing between.
  map.addSource("cands", { type: "geojson", data: turf.featureCollection([]) });
  map.addLayer({ id: "cands-line", type: "line", source: "cands", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": C.sea, "line-width": 1.2, "line-dasharray": [2, 2] } });
  map.addLayer({ id: "cands-pt", type: "circle", source: "cands", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 4, "circle-color": C.white, "circle-stroke-color": C.sea, "circle-stroke-width": 2 } });
  if (map.getStyle().glyphs) {
    const text = { "text-size": 12, "text-font": ["Noto Sans Bold"], "text-offset": [0, 1.3], "text-anchor": "top", "text-optional": true };
    map.addLayer({ id: "cands-label", type: "symbol", source: "cands", layout: { ...text, "text-field": ["get", "label"], "text-size": 11 }, paint: { "text-color": C.sea, "text-halo-color": C.white, "text-halo-width": 1.4 } });
    map.addLayer({ id: "aoi-label", type: "symbol", source: "aoi", layout: { ...text, "text-field": ["get", "label"] }, paint: { "text-color": C.ink, "text-halo-color": C.white, "text-halo-width": 1.6 } });
  }

  const thin = { outlineWidth: 1, outlineColor: C.ink, fillOpacity: 0, fillColor: C.pole };
  const handle = { closingPointColor: C.white, closingPointOutlineColor: C.pole, closingPointOutlineWidth: 2, closingPointWidth: 6 };
  draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      new TerraDrawSelectMode({
        flags: Object.fromEntries(["point", "linestring", "polygon", "rectangle", "circle"].map((m) => [m, {
          feature: {
            draggable: true, rotateable: m !== "point", scaleable: m !== "point",
            coordinates: m === "point" ? undefined : m === "polygon" || m === "linestring"
              ? { midpoints: true, draggable: true, deletable: true }
              : { draggable: true, resizable: "center" },
          },
        }])),
        keyEvents: { deselect: "Escape", delete: "Delete", rotate: ["Shift"], scale: null },
        styles: {
          selectedPolygonColor: C.pole, selectedPolygonFillOpacity: 0.12, selectedPolygonOutlineColor: C.ink, selectedPolygonOutlineWidth: 1.5,
          selectedLineStringColor: C.ink, selectedLineStringWidth: 1.5,
          selectedPointColor: C.pole, selectedPointOutlineColor: C.ink, selectedPointWidth: 9, selectedPointOutlineWidth: 2,
          selectionPointColor: C.white, selectionPointOutlineColor: C.ink, selectionPointWidth: 5, selectionPointOutlineWidth: 2,
          midPointColor: C.pole, midPointOutlineColor: C.white, midPointWidth: 4, midPointOutlineWidth: 1.5,
        },
      }),
      new TerraDrawPointMode({ styles: { pointColor: C.pole, pointOutlineColor: C.white, pointWidth: 8, pointOutlineWidth: 2.5 } }),
      new TerraDrawLineStringMode({ styles: { lineStringColor: C.ink, lineStringWidth: 1.5, closingPointColor: C.white, closingPointOutlineColor: C.pole, closingPointOutlineWidth: 2 } }),
      new TerraDrawPolygonMode({ styles: { ...thin, ...handle } }),
      new TerraDrawRectangleMode({ styles: thin }),
      new TerraDrawCircleMode({ styles: thin }),
    ],
  });
  draw.start();
  draw.on("finish", onFinish);
  draw.on("change", (ids, type) => { scheduleRefresh(); if (type === "delete") ids.forEach(onDeleted); });
  draw.on("select", onSelect);
  draw.on("deselect", () => onSelect(null));
  setMode("select");
  window.__ws = { map, draw, places, ref, host }; // for testing in the browser console
}

let refreshQueued = false;
function scheduleRefresh() {
  if (refreshQueued || !draw) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    const feats = draw.getSnapshot().filter((f) => places.has(f.id) || !isGuide(f)).map((f) => {
      const p = places.get(f.id);
      return { type: "Feature", geometry: f.geometry, properties: { label: p ? `${p.name}${p.status === "proposed" ? " (proposed)" : ""}` : "", status: p?.status || "" } };
    });
    map.getSource("aoi")?.setData(turf.featureCollection(feats));
  });
}
const isGuide = (f) => ["selectionPoint", "midPoint", "closingPoint", "snappingPoint", "coordinatePoint"].some((k) => f.properties?.[k]);

function showCandidates(list) {
  const feats = list.map((c) => ({ type: "Feature", geometry: c.geometry.type === "Point" ? c.geometry : c.geometry, properties: { label: `${c.id} ${c.name || ""}`.trim() } }));
  map.getSource("cands")?.setData(turf.featureCollection(feats));
}

// ---- modes and hints ---------------------------------------------------------------
const HINTS = {
  select: "",
  point: "Click the map to drop a point.",
  linestring: "Click to add points. Click the last point again to finish.",
  polygon: "Click to add corners. Click the first corner to close the area.",
  rectangle: "Click one corner, then the opposite corner.",
  circle: "Click the centre, then click again to set the size.",
};
const SELECTED_HINT = matchMedia("(pointer: coarse)").matches
  ? "Drag to move. Drag a corner to reshape, or a midpoint to add one. Rotate and resize from the card."
  : "Drag to move. Drag a corner to reshape, or a midpoint to add one. Shift-drag to rotate.";

function setMode(mode) {
  draw.setMode(mode);
  document.querySelectorAll(".tools [data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  hint(mode === "select" ? (selectedId ? SELECTED_HINT : "") : HINTS[mode]);
}
function hint(text) { const h = $("hint"); h.textContent = text; h.hidden = !text; }

document.querySelectorAll(".tools [data-mode]").forEach((b) => b.addEventListener("click", () => draw && setMode(b.dataset.mode)));
document.querySelector('.tools [data-action="delete"]').addEventListener("click", () => { if (selectedId) removePlace(selectedId); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && draw && draw.getMode() !== "select") setMode("select"); });

// ---- drawing events ----------------------------------------------------------------------
function onFinish(id, ctx) {
  const feature = featureOf(id);
  if (!feature) return;
  if (ctx?.action === "draw" && !places.has(id)) {
    newPlace(id, feature);
    setMode("select");
    draw.selectFeature(id);
    return;
  }
  const p = places.get(id);
  if (!p) return;
  const change = G.describeChange(p.feature, feature);
  p.feature = feature;
  if (change) logEdit(p, `${change} (on the map)`);
  refreshCard(p);
}

function onSelect(id) {
  selectedId = id && places.has(id) ? id : null;
  if (selectedId) focusName = places.get(selectedId).name;
  document.querySelector('.tools [data-action="delete"]').disabled = !selectedId;
  places.forEach((p) => p.card.classList.toggle("active", p.id === selectedId));
  if (selectedId) places.get(selectedId).card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (draw.getMode() === "select") hint(selectedId ? SELECTED_HINT : "");
}

function onDeleted(id) {
  const p = places.get(id);
  if (!p) return;
  p.card.classList.add("gone");
  p.card.classList.remove("active");
  p.card.querySelector(".summary").textContent = "Deleted.";
  places.delete(id);
  remember("user", `(I deleted ${p.name}.)`);
  if (selectedId === id) onSelect(null);
}
function removePlace(id) { draw.removeFeatures([id]); onDeleted(id); scheduleRefresh(); }

// Editing from the card or the analyst goes through the same deterministic functions.
function applyGeometry(p, raw, words) {
  const feature = G.roundCoords(raw);
  try { draw.updateFeatureGeometry(p.id, feature.geometry); } catch (e) { activity(`That edit didn't work: ${e.message}`); return false; }
  p.feature = { type: "Feature", properties: {}, geometry: feature.geometry };
  logEdit(p, words);
  refreshCard(p);
  scheduleRefresh();
  return true;
}

function logEdit(p, words) {
  const li = document.createElement("li");
  li.textContent = words;
  p.card.querySelector(".history").append(li);
  p.edits.push({ at: new Date().toISOString(), change: words });
}

// ---- the host: what the analyst's tools can see and do -------------------------------------
const skills = {};
let anchors = [];
const host = {
  ref,
  get anchors() { return anchors; },
  fetchFn: (...a) => fetch(...a),
  headers: {},
  places: () => [...places.values()],
  findPlace: placeByName,
  skillText: (name) => skills[name]?.body || "",
  onCandidates: showCandidates,
  offerChoices: (o) => makeChoiceCard(o),
  addPlace({ feature, origin }) {
    const id = crypto.randomUUID();
    const mode = feature.geometry.type === "Point" ? "point" : /LineString/.test(feature.geometry.type) ? "linestring" : "polygon";
    const bad = draw.addFeatures([{ id, type: "Feature", geometry: feature.geometry, properties: { mode } }]).find((v) => !v.valid);
    if (bad) throw new Error(`The shape couldn't be drawn: ${bad.reason}`);
    const p = newPlace(id, feature, { status: "proposed", origin });
    zoomTo(p);
    return p;
  },
  updatePlace(name, feature, words) {
    const p = placeByName(name);
    if (!p) return;
    applyGeometry(p, feature, words);
    // A changed proposal is asked about again, next to the reply that asks.
    if (p.status !== "drawn") {
      p.status = "proposed"; paintStatus(p); scheduleRefresh();
      if (pendingReply?.isConnected) $("conversation").insertBefore(p.card, pendingReply);
    }
  },
  renamePlace(name, to) {
    const p = placeByName(name);
    if (!p) return;
    logEdit(p, `renamed from ${p.name} to ${to}`);
    p.name = to;
    p.card.querySelector("h2 .name").textContent = to;
    scheduleRefresh();
  },
};
const tools = createPlaceTools(host);

Promise.all([
  fetch("skills/place-finding/SKILL.md").then((r) => r.text()).then((t) => { const s = parseSkill(t); skills[s.name] = s; }),
  fetch("catalogue/anchors.json").then((r) => r.json()).then((j) => { anchors = j.sources; }),
]).catch((e) => note(`Something the analyst needs didn't load: ${e.message}`));

// ---- cards ----------------------------------------------------------------------------
function makeCard(p) {
  const card = $("shape-card").content.firstElementChild.cloneNode(true);
  card.dataset.id = p.id;
  const sw = document.createElement("span");
  sw.className = `swatch ${p.kind === "Line" ? "line" : p.kind === "Point" ? "point" : ""}`;
  const nm = el("span", p.name, "name");
  card.querySelector("h2").append(sw, nm);
  if (p.kind === "Point") card.querySelectorAll('[data-op="rotate"], .resize').forEach((e) => e.remove());
  else card.querySelector(".unit").textContent = p.kind === "Area" ? "km²" : "km";
  paintOrigin(p, card);
  paintStatus(p, card);

  card.querySelector('[data-op="zoom"]').addEventListener("click", () => zoomTo(p));
  card.querySelectorAll('[data-op="rotate"]').forEach((b) => b.addEventListener("click", () => {
    const deg = +b.dataset.deg;
    applyGeometry(p, G.rotate(p.feature, deg), `rotated ${Math.abs(deg)}° ${deg > 0 ? "clockwise" : "anticlockwise"}`);
  }));
  card.querySelector(".resize")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = parseFloat(e.target.querySelector("input").value);
    if (!(v > 0)) return;
    const before = p.kind === "Area" ? turf.area(p.feature) / 1e6 : turf.length(p.feature);
    applyGeometry(p, G.resizeTo(p.feature, v), `resized from ${R.fmtNum(before)} to ${R.fmtNum(v)} ${p.kind === "Area" ? "km²" : "km"}`);
  });
  card.querySelectorAll(".scale button").forEach((b) => b.addEventListener("click", () => {
    if (p.scale === b.dataset.scale) return;
    p.scale = b.dataset.scale; p.scaleFrom = "you";
    logEdit(p, `scale set to ${R.SCALES[p.scale].label.toLowerCase()}`);
    paintScale(p);
  }));
  // The answer buttons count as a reply in the conversation.
  card.querySelector('[data-op="accept"]').addEventListener("click", () => {
    if (busy) return;
    p.status = "accepted"; paintStatus(p); scheduleRefresh();
    send(`Yes, use ${p.name}.`);
  });
  card.querySelector('[data-op="revise"]').addEventListener("click", () => {
    if (busy) return;
    p.status = "revising"; paintStatus(p);
    send(`${p.name} isn't quite right.`);
  });
  card.addEventListener("click", (e) => {
    if (e.target.closest("button, input, form, a, summary") || !places.has(p.id)) return;
    draw.selectFeature(p.id);
  });
  // A place the analyst makes goes above its reply, so the reply reads as the caption.
  if (pendingReply?.isConnected) $("conversation").insertBefore(card, pendingReply);
  else $("conversation").append(card);
  card.scrollIntoView({ block: "end", behavior: "smooth" });
  expandSheet();
  return card;
}

// A carousel of candidates: flick through them on the map, each with its source; the pick is your reply.
function makeChoiceCard({ choices, recommended, reason, question }) {
  const card = $("choice-card").content.firstElementChild.cloneNode(true);
  let i = 0;
  card.querySelector(".question").textContent = question || "Which one do you mean?";
  const show = () => {
    const c = choices[i];
    card.querySelector("h2").textContent = c.name || c.id;
    card.querySelector(".kind").textContent = c.type || "";
    const src = card.querySelector(".src");
    src.replaceChildren(document.createTextNode("Source: "), Object.assign(el("a", `${c.source.publisher}, ${c.source.title}`), { href: c.source.url, target: "_blank", rel: "noopener" }), document.createTextNode(` (${c.source.licence})`));
    const bits = [c.extra?.place || c.extra?.description, c.extra?.country, c.area_km2 != null ? R.fmtArea(c.area_km2) : null, c.distance_km != null ? `${R.fmtNum(c.distance_km)} km from the reference` : null].filter(Boolean);
    card.querySelector(".detail").textContent = bits.join(" · ");
    const isRec = c === recommended;
    card.querySelector(".rec").hidden = !isRec;
    card.querySelector(".why").textContent = isRec ? reason : "";
    card.querySelector('[data-op="lucky"]').hidden = isRec;
    card.querySelector(".count").textContent = `${i + 1} of ${choices.length}`;
    showCandidates([c]);
    const f = { type: "Feature", properties: {}, geometry: c.geometry };
    if (c.geometry.type === "Point") map.flyTo({ center: c.geometry.coordinates, zoom: Math.max(map.getZoom(), 12), padding: fitPadding() });
    else map.fitBounds(turf.bbox(f), { padding: fitPadding(), maxZoom: 14 });
  };
  card.querySelector('[data-op="prev"]').addEventListener("click", () => { i = (i - 1 + choices.length) % choices.length; show(); });
  card.querySelector('[data-op="next"]').addEventListener("click", () => { i = (i + 1) % choices.length; show(); });
  card.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") card.querySelector('[data-op="prev"]').click(); if (e.key === "ArrowRight") card.querySelector('[data-op="next"]').click(); });
  const pick = (c) => {
    if (busy) return;
    card.classList.add("done");
    send(`Use ${c.id}: ${c.name || "that one"} (${c.source.publisher}).`);
  };
  card.querySelector('[data-op="use"]').addEventListener("click", () => pick(choices[i]));
  card.querySelector('[data-op="lucky"]').addEventListener("click", () => pick(recommended));
  if (pendingReply?.isConnected) $("conversation").insertBefore(card, pendingReply);
  else $("conversation").append(card);
  i = Math.max(0, choices.indexOf(recommended));
  show();
  expandSheet();
}

function paintStatus(p, card = p.card) {
  card.classList.toggle("proposed", p.status === "proposed");
  card.querySelector(".proposal").hidden = p.status !== "proposed";
  card.querySelector(".badge").textContent = p.status === "proposed" ? "Proposed" : "";
}

function paintOrigin(p, card = p.card) {
  const o = p.origin, box = card.querySelector(".origin");
  if (o?.method !== "words") { box.remove(); return; }
  const a = o.anchor || {};
  const src = a.source ? Object.assign(el("a", `${a.source.publisher}, ${a.source.title}`), { href: a.source.url, target: "_blank", rel: "noopener" }) : null;
  box.querySelector("summary").textContent = `From your words, ${o.confidence} confidence`;
  const body = box.querySelector("div");
  body.append(el("p", `“${o.words}”`, "words"));
  if (a.name) {
    const line = el("p", `Anchor: ${a.name}${a.type ? ` (${a.type})` : ""}`);
    if (src) line.append(document.createTextNode(", from "), src);
    if (a.source?.licence) line.append(document.createTextNode(`, licence: ${a.source.licence}`));
    body.append(line);
  } else if (a.place) body.append(el("p", `Anchor: ${a.place}`));
  body.append(el("p", `Built: ${o.steps.join(", then ")}.`), el("p", `Why: ${o.reason}`));
  if (a.extra?.CRS_NAME && /ED50/i.test(a.extra.CRS_NAME)) body.append(el("p", `The source position was surveyed in ${a.extra.CRS_NAME}; the publisher supplies it in WGS84.`, "quiet"));
}

function paintScale(p) {
  p.card.querySelectorAll(".scale button").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.scale === p.scale));
    b.title = b.dataset.scale === p.scale && p.scaleFrom === "size" ? `Worked out from the size: ${R.SCALES[p.scale].hint}` : R.SCALES[b.dataset.scale].hint;
  });
}

let refreshSeq = 0;
async function refreshCard(p) {
  const seq = ++refreshSeq; p.seq = seq;
  const sum = p.card.querySelector(".summary");
  sum.classList.add("loading");
  if (!p.described) sum.textContent = "Measuring…";
  try {
    const d = await R.describe(ref, p.feature);
    if (p.seq !== seq) return; // a newer edit overtook this one
    p.described = d;
    if (p.scaleFrom === "size") p.scale = d.scale;
    paintScale(p);
    sum.textContent = R.summaryLine(d);
    sum.classList.remove("loading");
    const [lon, lat] = d.centroid;
    const rows = [
      [p.kind === "Point" ? "Location" : "Centre", `${lat.toFixed(4)}, ${lon.toFixed(4)}`],
      d.area_km2 != null && ["Area", R.fmtArea(d.area_km2)],
      d.length_km != null && ["Length", `${R.fmtNum(d.length_km)} km`],
      d.extent_km != null && ["Across", `${R.fmtNum(d.extent_km)} km`],
      ["Country", d.offshore ? "None (offshore)" : d.countries.join(", ")],
      d.coast_km != null && ["Coast", `${R.fmtNum(d.coast_km)} km`],
      d.nearest_places.length && ["Towns", d.nearest_places.map((x) => `${x.name} ${R.fmtNum(x.km)} km`).join(", ")],
      d.places_inside && ["Cities", d.places_inside.count ? `${d.places_inside.largest.map((x) => x.name).join(", ")}${d.places_inside.count > 3 ? ` and ${d.places_inside.count - 3} more` : ""}` : "None mapped at this scale"],
    ].filter(Boolean);
    p.card.querySelector(".facts").replaceChildren(...rows.flatMap(([k, v]) => [el("dt", k), el("dd", v)]), el("dd", "Places, coast and borders from Natural Earth (1:10m), good to about a kilometre.", "src"));
    const input = p.card.querySelector(".resize input");
    if (input && document.activeElement !== input) input.value = p.kind === "Area" ? +d.area_km2.toPrecision(4) : +d.length_km.toPrecision(4);
    if (!busy) activity(`${p.name}: ${R.summaryLine(d)}`);
  } catch (e) {
    sum.textContent = `Couldn't place this shape: ${e.message}`;
  }
}

function zoomTo(p) {
  if (p.kind === "Point") map.flyTo({ center: p.feature.geometry.coordinates, zoom: Math.max(map.getZoom(), 11), padding: fitPadding() });
  else map.fitBounds(turf.bbox(p.feature), { padding: fitPadding(), maxZoom: 15 });
  if (places.has(p.id) && draw.getMode() === "select") draw.selectFeature(p.id);
}
function fitPadding() {
  if (innerWidth <= 720) return { top: 130, bottom: Math.min(innerHeight * 0.55, 420), left: 50, right: 50 };
  return { top: 140, bottom: 140, left: 560, right: 200 };
}

// ---- conversation ---------------------------------------------------------------------
function el(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
function note(text) { $("conversation").append(el("p", text, "msg note")); }
function activity(text, isBusy = false) { const a = $("activity"); a.textContent = text; a.classList.toggle("busy", isBusy); }

// The last few exchanges as plain text; tool results are never replayed (see converse.js).
const recent = [];
function remember(role, text) { recent.push({ role, text }); while (recent.length > 8) recent.shift(); }

// Plain text with **bold** and "- " lists, safely.
function renderText(text) {
  const box = document.createElement("div");
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*[-*] /.test(l))) {
      const ul = el("ul");
      lines.forEach((l) => ul.append(inline(el("li"), l.replace(/^\s*[-*] /, ""))));
      box.append(ul);
    } else box.append(inline(el("p"), lines.join("\n")));
  }
  return box;
}
function inline(node, text) {
  text.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) node.append(el("strong", part.slice(2, -2)));
    else node.append(document.createTextNode(part));
  });
  return node;
}

const say = $("say");
say.addEventListener("input", grow);
say.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("ask").requestSubmit(); } });
function grow() { say.style.height = "auto"; say.style.height = Math.min(say.scrollHeight, 140) + "px"; }

let busy = false;
let pendingReply = null;
$("ask").addEventListener("submit", (e) => { e.preventDefault(); send(say.value.trim()); });
document.querySelectorAll("[data-example]").forEach((b) => b.addEventListener("click", () => send(b.textContent.trim())));

async function send(text) {
  if (!text || busy || !draw) return;
  busy = true;
  $("ask").classList.add("busy");
  $("conversation").append(el("div", text, "msg user"));
  say.value = ""; grow();
  const reply = el("div", null, "msg analyst");
  const trace = el("details", null, "trace"); trace.append(el("summary", "How I worked this out"), el("ol"));
  $("conversation").append(reply);
  pendingReply = reply;
  reply.scrollIntoView({ block: "end", behavior: "smooth" });
  activity("Thinking…", true);
  showCandidates([]);
  const steps = trace.querySelector("ol");
  try {
    const summary = await projectSummary(ref, host.places(), focusName);
    const skillList = Object.values(skills);
    const res = await runTurn({
      system: systemPrompt({ skills: skillList, comingSoon: ["risk screening (NTR), net developable area and constraints-and-access analysis"] }),
      messages: buildMessages({ recent, summary, userText: text }),
      tools: placeToolDefs(skillList),
      exec: (name, input) => tools.exec(name, input),
      callClaude,
      onEvent: (ev) => {
        if (ev.type === "tool_start") activity(`${activityFor(ev.name, ev.input)}…`, true);
        if (ev.type === "tool") {
          steps.append(el("li", traceLine(ev), ev.error ? "err" : ""));
          activity("Thinking…", true);
        }
        if (ev.type === "warning") steps.append(el("li", ev.message, "err"));
      },
    });
    reply.replaceChildren(renderText(res.text || "Done."));
    if (steps.children.length) reply.append(trace);
    remember("user", text);
    remember("assistant", res.text);
    activity("");
  } catch (err) {
    // Leave no half exchange behind: nothing is remembered from a failed turn.
    reply.replaceChildren(el("p", err instanceof LimitReached
      ? `${err.message} You can carry on drawing and editing; the analyst will be back tomorrow.`
      : `That didn't work: ${err.message}. Nothing was changed by this request; try again.`));
    reply.classList.add("error");
    activity("");
  } finally {
    busy = false;
    pendingReply = null;
    $("ask").classList.remove("busy");
    reply.scrollIntoView({ block: "end", behavior: "smooth" });
  }
}

function traceLine(ev) {
  const i = ev.input || {};
  if (ev.error) return `${activityFor(ev.name, i)}: ${ev.error}`;
  const o = ev.output || {};
  switch (ev.name) {
    case "load_skill": return `Loaded the ${i.name} skill`;
    case "find_place": return `Searched for “${i.query}”: ${o.candidates?.length || 0} found${o.candidates?.length ? ` (${o.candidates.slice(0, 3).map((c) => `${c.name}, ${c.source.split(" – ")[0]}`).join("; ")})` : ""}`;
    case "find_features_near": return `Looked for ${i.feature_type} within ${i.radius_km} km of ${o.anchor}: ${o.found} found`;
    case "make_place": return `Built ${o.place}: ${o.how}`;
    case "edit_place": return `Changed ${o.place}: ${o.changed}`;
    case "get_place": return `Read ${i.place}`;
    default: return ev.name;
  }
}

document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => {
  say.value = c.dataset.prompt; grow(); say.focus();
  say.setSelectionRange(say.value.length, say.value.length);
}));

// Speech: the browser's own recognition where it exists (Chrome, Edge, Safari). Typing always works.
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Speech) {
  const mic = $("mic"); mic.hidden = false;
  let rec = null, base = "";
  mic.addEventListener("click", () => {
    if (rec) { rec.stop(); return; }
    rec = new Speech(); rec.lang = navigator.language || "en-GB"; rec.interimResults = true; rec.continuous = false;
    base = say.value ? say.value.replace(/\s*$/, " ") : "";
    rec.onresult = (e) => { say.value = base + Array.from(e.results).map((r) => r[0].transcript).join(""); grow(); };
    rec.onerror = (e) => activity(e.error === "not-allowed" ? "Microphone access was blocked. You can type instead." : `Speech stopped: ${e.error}.`);
    rec.onend = () => { rec = null; mic.classList.remove("on"); mic.title = "Speak"; say.focus(); if (!busy) activity(""); };
    rec.start(); mic.classList.add("on"); mic.title = "Stop listening";
    activity("Listening…", true);
  });
}

// ---- phone: the panel is a bottom sheet -------------------------------------------------
const panel = $("panel"), handleBtn = $("handle");
handleBtn.addEventListener("click", () => setSheet(panel.classList.contains("collapsed")));
function setSheet(open) { panel.classList.toggle("collapsed", !open); handleBtn.setAttribute("aria-expanded", String(open)); }
function expandSheet() { if (innerWidth <= 720) setSheet(true); }
if (innerWidth <= 720) setSheet(false);
document.querySelectorAll(".tools [data-mode]").forEach((b) => b.addEventListener("click", () => {
  if (innerWidth <= 720 && b.dataset.mode !== "select") setSheet(false);
}));
