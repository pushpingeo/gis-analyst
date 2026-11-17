// The workspace page: map, drawing and editing tools, and the conversation with the analyst.
// Places are the record; cards are views of them. The analyst sees a compact project summary each turn.
import { TerraDraw, TerraDrawMapLibreGLAdapter, TerraDrawSelectMode, TerraDrawPointMode, TerraDrawLineStringMode,
  TerraDrawPolygonMode, TerraDrawRectangleMode, TerraDrawCircleMode } from "./vendor/draw.js";
import * as turf from "./vendor/turf.js";
import * as G from "./geometry.js";
import * as R from "./reference.js";
import { placeToolDefs, createPlaceTools, projectSummary } from "./placetools.js";
import { parseSkill, systemPrompt, buildMessages, runTurn, activityFor } from "./converse.js";
import { callClaude, LimitReached } from "./claude.js";
import { atlasViaWorker, firmsViaWorker } from "./atlasclient.js";
import { CONFIG } from "./config.js";
import { THEMES, themeFor, bandOf, BAND_OPACITY, BIG_AREA_KM2, chooseLabels, ringDistances } from "./findings.js";

const $ = (id) => document.getElementById(id);
// Version-stamped URLs for fetched files (written into the page by scripts/stamp.mjs).
const ASSETS = (() => { try { return JSON.parse($("asset-versions")?.textContent || "{}"); } catch { return {}; } })();
const asset = (path) => ASSETS[path] || path;
const C = { ink: "#15303c", pole: "#d1352a", white: "#ffffff", sea: "#2b6a80" };
const BASEMAP = "https://tiles.openfreemap.org/styles/positron";

// ---- reference data -------------------------------------------------------------
const ref = R.createReference(async (name) => {
  activity(`Loading ${name === "places" ? "towns and cities" : name}…`, true);
  const r = await fetch(asset(`data/ref/${name}.json`));
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

const viewBounds = () => map.getBounds().toArray().flat();

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

// Scale is worked out, never asked: from the request if it says, else the shape's size; a point has no size,
// so a drawn point takes its scale from the zoom level when it was dropped. The person can change it on the card.
function newPlace(id, feature, { status = "drawn", origin = { method: "drawn", at: new Date().toISOString() }, scale = null } = {}) {
  const kind = kindOf(feature.geometry);
  const p = { id, kind, name: `${kind} ${++counts[kind]}`, feature, status, origin, edits: [], scaleFrom: "size" };
  if (scale && R.SCALES[scale]) { p.scale = scale; p.scaleFrom = "request"; }
  else if (kind === "Point" && origin.method === "drawn") { p.scale = R.scaleForKm(R.viewKm(viewBounds())); p.scaleFrom = "zoom"; }
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
  // Findings: features from data searches, drawn by screening theme (js/findings.js). They stay for the session,
  // until the person clears them; a later search never wipes them (Rosebank, 17 Nov). Big areas sit underneath,
  // quiet; distance from the site sets the emphasis.
  const themeColour = ["match", ["get", "theme"], ...Object.entries(THEMES).flatMap(([k, t]) => [k, t.colour]), THEMES.context.colour];
  const emphasis = ["match", ["get", "band"], "near", BAND_OPACITY.near, "close", BAND_OPACITY.close, BAND_OPACITY.wider];
  const big = [">", ["coalesce", ["get", "area_km2"], 0], BIG_AREA_KM2];
  map.addSource("rings", { type: "geojson", data: turf.featureCollection([]) });
  map.addLayer({ id: "rings-line", type: "line", source: "rings", paint: { "line-color": C.ink, "line-width": 1, "line-opacity": 0.35, "line-dasharray": [3, 3] } });
  map.addSource("findings", { type: "geojson", data: turf.featureCollection([]) });
  map.addLayer({ id: "find-fill", type: "fill", source: "findings", filter: ["==", ["geometry-type"], "Polygon"],
    layout: { "fill-sort-key": ["-", 0, ["coalesce", ["get", "area_km2"], 0]] },
    paint: { "fill-color": themeColour, "fill-opacity": ["case", big, 0.03, ["*", 0.14, emphasis]] } });
  map.addLayer({ id: "find-line", type: "line", source: "findings", filter: ["!=", ["geometry-type"], "Point"],
    paint: { "line-color": themeColour, "line-width": ["case", big, 1, 2], "line-opacity": emphasis } });
  map.addLayer({ id: "find-pt", type: "circle", source: "findings", filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": ["match", ["get", "band"], "near", 6, 5], "circle-color": themeColour, "circle-opacity": emphasis, "circle-stroke-color": C.white, "circle-stroke-width": 1.5 } });
  // Tap a point or an outline to see what it is (not a big area's inside: that would get in the way of the site).
  for (const id of ["find-pt", "find-line"]) map.on("click", id, (e) => findingPopup(e));
  if (map.getStyle().glyphs) {
    const text = { "text-size": 12, "text-font": ["Noto Sans Bold"], "text-offset": [0, 1.3], "text-anchor": "top", "text-optional": true };
    map.addLayer({ id: "find-label", type: "symbol", source: "findings", filter: ["==", ["get", "label_on"], true], layout: { ...text, "text-field": ["get", "label"], "text-size": 11 }, paint: { "text-color": C.ink, "text-halo-color": C.white, "text-halo-width": 1.6 } });
    map.addLayer({ id: "rings-label", type: "symbol", source: "rings", layout: { "symbol-placement": "line", "text-field": ["get", "label"], "text-size": 10, "text-font": ["Noto Sans Bold"] }, paint: { "text-color": C.ink, "text-opacity": 0.6, "text-halo-color": C.white, "text-halo-width": 1.4 } });
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
  const feats = list.map((c) => ({ type: "Feature", geometry: c.geometry, properties: { label: c.name || c.type || "" } }));
  map.getSource("cands")?.setData(turf.featureCollection(feats));
}

// Findings stay until cleared, one entry per feature id, drawn by theme; the analyst can bring them into view with
// show_on_map. The legend (#key) lists the themes with counts and lets the person switch each off.
const findings = new Map();
const hiddenThemes = new Set();
let ringsAround = null;
function drawFindings() {
  const feats = [...findings.values()].filter((f) => !hiddenThemes.has(f.properties.theme));
  chooseLabels(feats);
  map.getSource("findings")?.setData(turf.featureCollection(feats));
  drawKey();
}
function addFindings(list, meta = {}) {
  const theme = meta.theme || themeFor({});
  for (const c of list) {
    findings.set(c.id, { type: "Feature", geometry: c.geometry, properties: {
      id: c.id, label: c.name || c.type || "", theme, band: bandOf(c.distance_km), distance_km: c.distance_km ?? null,
      area_km2: c.area_km2 ?? null, dataset: meta.dataset || "", publisher: meta.publisher || c.source?.publisher || "",
    } });
  }
  if (meta.place) drawRings(meta.place);
  drawFindings();
}
async function drawRings(place) {
  const key = JSON.stringify(place.geometry).slice(0, 200);
  if (ringsAround === key) return;
  ringsAround = key;
  let offshore = false;
  try { offshore = !!(await R.describe(ref, place)).offshore; } catch { /* reference not loaded */ }
  const rings = ringDistances(offshore).map((km) => {
    const b = turf.buffer(place, km, { units: "kilometers", steps: 32 });
    const line = turf.polygonToLine(b);
    const f = line.type === "FeatureCollection" ? line.features[0] : line;
    f.properties = { label: `${km} km` };
    return f;
  });
  map.getSource("rings")?.setData(turf.featureCollection(rings));
}
function clearFindings() {
  findings.clear(); hiddenThemes.clear(); ringsAround = null;
  map.getSource("rings")?.setData(turf.featureCollection([]));
  drawFindings();
}
function showFindings(ids) {
  const feats = ids?.length ? ids.map((id) => findings.get(String(id).toUpperCase())).filter(Boolean) : [...findings.values()];
  if (!feats.length) return { shown: 0 };
  feats.forEach((f) => hiddenThemes.delete(f.properties.theme));
  drawFindings();
  const focus = places.get(selectedId) || [...places.values()].at(-1);
  const all = turf.featureCollection([...feats, ...(focus ? [focus.feature] : [])]);
  map.fitBounds(turf.bbox(all), { padding: fitPadding(), maxZoom: 14 });
  return { shown: feats.length, on_map: findings.size };
}
// The map key: one row per theme on the map, with a count and a switch; doubles as the list of what's shown.
function drawKey() {
  const key = $("key");
  if (!key) return;
  const counts = new Map();
  for (const f of findings.values()) counts.set(f.properties.theme, (counts.get(f.properties.theme) || 0) + 1);
  key.hidden = !counts.size;
  if (!counts.size) return;
  const list = key.querySelector("ul");
  list.replaceChildren(...Object.entries(THEMES).filter(([k]) => counts.has(k)).map(([k, t]) => {
    const li = document.createElement("li");
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox"; box.checked = !hiddenThemes.has(k);
    box.addEventListener("change", () => { box.checked ? hiddenThemes.delete(k) : hiddenThemes.add(k); drawFindings(); });
    const sw = document.createElement("span"); sw.className = "swatch"; sw.style.background = t.colour;
    label.append(box, sw, document.createTextNode(` ${t.label} `), Object.assign(document.createElement("span"), { className: "count", textContent: counts.get(k) }));
    li.append(label);
    return li;
  }));
}

$("key-clear")?.addEventListener("click", () => clearFindings());
if (phone) $("key")?.removeAttribute("open");

// Tap a finding: its name, theme, distance and source.
function findingPopup(e) {
  if (draw && draw.getMode() !== "select") return;
  const f = e.features?.[0];
  if (!f) return;
  const p = f.properties;
  const box = document.createElement("div");
  box.className = "finding-pop";
  const name = document.createElement("b"); name.textContent = p.label || "Unnamed feature";
  const what = document.createElement("span");
  const km = p.distance_km == null || p.distance_km === "null" ? "" : +p.distance_km === 0 ? "on site · " : `${p.distance_km} km from the site · `;
  what.textContent = `${THEMES[p.theme]?.label || ""} · ${km}${p.dataset}${p.publisher ? ` (${p.publisher})` : ""}`;
  box.append(name, what);
  new maplibregl.Popup({ closeButton: true, maxWidth: "280px" }).setLngLat(e.lngLat).setDOMContent(box).addTo(map);
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
let trusted = { services: [], publishers: { patterns: [] } };
const host = {
  ref,
  get anchors() { return anchors; },
  fetchFn: (...a) => fetch(...a),
  atlas: atlasViaWorker,
  firms: firmsViaWorker,
  get trusted() { return trusted; },
  // Settings (step 4 adds the gear): whether the person holds an Esri licence, so Esri-licensed layers can be used.
  esriLicence: () => { try { return localStorage.getItem("tobler.esriLicence") === "yes"; } catch { return false; } },
  view: () => viewBounds(),
  headers: {},
  places: () => [...places.values()],
  findPlace: placeByName,
  skillText: (name) => skills[name]?.body || "",
  onCandidates: showCandidates,
  addFindings,
  showFindings,
  clearFindings,
  offerChoices: (o) => makeChoiceCard(o),
  addPlace({ feature, origin, scale }) {
    const id = crypto.randomUUID();
    const mode = feature.geometry.type === "Point" ? "point" : /LineString/.test(feature.geometry.type) ? "linestring" : "polygon";
    const bad = draw.addFeatures([{ id, type: "Feature", geometry: feature.geometry, properties: { mode } }]).find((v) => !v.valid);
    if (bad) throw new Error(`The shape couldn't be drawn: ${bad.reason}`);
    const p = newPlace(id, feature, { status: "proposed", origin, scale });
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
  ...["skills/place-finding/SKILL.md", "skills/ntr-screening/SKILL.md"].map((f) => fetch(asset(f)).then((r) => r.text()).then((t) => { const s = parseSkill(t); skills[s.name] = s; })),
  fetch(asset("catalogue/anchors.json")).then((r) => r.json()).then((j) => { anchors = j.sources; }),
  fetch(asset("catalogue/trusted.json")).then((r) => r.json()).then((j) => { trusted = j; }),
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
  if (o.confidence_rules?.length) body.append(el("p", `Confidence: ${o.confidence_rules.join("; ")}.`));
  for (const c of o.checks || []) {
    const verdict = c.pass === true ? "fits" : c.pass === false ? `doesn't fit (${c.why})` : "not checked";
    body.append(el("p", `Check: ${c.against} about ${c.expected_km} km${c.direction ? ` ${c.direction}` : ""}: measured ${c.actual_km ?? "?"} km, ${verdict}.`, c.pass === false ? "warn" : "quiet"));
  }
  if (a.extra?.CRS_NAME && /ED50/i.test(a.extra.CRS_NAME)) body.append(el("p", `The source position was surveyed in ${a.extra.CRS_NAME}; the publisher supplies it in WGS84.`, "quiet"));
}

function paintScale(p) {
  p.card.querySelectorAll(".scale button").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.scale === p.scale));
    b.title = b.dataset.scale === p.scale && p.scaleFrom !== "you" ? `${R.SCALE_FROM[p.scaleFrom]}: ${R.SCALES[p.scale].hint}` : R.SCALES[b.dataset.scale].hint;
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
// Once a skill is loaded, later turns carry it in the system prompt instead of spending a round on load_skill.
const loadedSkills = new Set();
$("ask").addEventListener("submit", (e) => { e.preventDefault(); send(say.value.trim()); });
document.querySelectorAll("[data-example]").forEach((b) => b.addEventListener("click", () => send(b.textContent.trim())));

// The whole session, tool inputs and outputs included, for checking what the analyst did. Kept in the page only;
// "Download the log" in any "How I worked this out" saves it as JSON, and window.toblerLog holds it for tests.
const sessionLog = [];
window.toblerLog = sessionLog;
function downloadLog() {
  const blob = new Blob([JSON.stringify({ page: location.href, saved: new Date().toISOString(), turns: sessionLog }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `tobler-log-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

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
  const save = el("button", "Download the log", "log-link");
  save.type = "button";
  save.addEventListener("click", downloadLog);
  trace.append(save);
  const turnLog = { at: new Date().toISOString(), user: text, events: [] };
  sessionLog.push(turnLog);
  try {
    const summary = await projectSummary(ref, host.places(), focusName, viewBounds());
    const skillList = Object.values(skills);
    const res = await runTurn({
      system: systemPrompt({ skills: skillList, loaded: skillList.filter((s) => loadedSkills.has(s.name)), comingSoon: ["net developable area and constraints-and-access analysis"] }),
      messages: buildMessages({ recent, summary, userText: text }),
      tools: placeToolDefs(skillList),
      maxRounds: CONFIG.workspaceRounds || 10,
      exec: (name, input) => tools.exec(name, input),
      callClaude,
      onEvent: (ev) => {
        if (ev.type === "tool_start") activity(`${activityFor(ev.name, ev.input)}…`, true);
        if (ev.type === "tool" && ev.name === "load_skill" && !ev.error) loadedSkills.add(ev.input?.name);
        if (ev.type === "tool") {
          turnLog.events.push({ tool: ev.name, input: ev.input, ...(ev.error ? { error: ev.error } : { output: ev.output }) });
          steps.append(el("li", traceLine(ev), ev.error ? "err" : ""));
          activity("Thinking…", true);
        }
        if (ev.type === "warning") { steps.append(el("li", ev.message, "err")); turnLog.events.push({ warning: ev.message }); }
      },
    });
    turnLog.reply = res.text;
    turnLog.usage = res.usage;
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
    turnLog.error = String(err.message || err);
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
    case "find_features_near": return `Looked for ${i.feature_type} within ${i.radius_km} km of ${o.anchor}: ${o.found} found${o.not_listed ? ` (nearest ${o.listed} listed)` : ""}`;
    case "make_place": return `Built ${o.place}: ${o.how}`;
    case "edit_place": return `Changed ${o.place}: ${o.changed}`;
    case "get_place": return `Read ${i.place}`;
    default: return ev.name;
  }
}

// Chips: "Find a place" starts a request; "Draw an area" switches the map to drawing;
// the "soon" chips answer locally (nothing goes to the model).
document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => {
  if (c.dataset.soon !== undefined) {
    const m = el("div", null, "msg analyst");
    m.append(el("p", "That's coming next. For now I can find and outline the area so it's ready."));
    $("conversation").append(m); m.scrollIntoView({ block: "end", behavior: "smooth" });
    return;
  }
  if (c.dataset.draw) {
    if (!draw) return;
    setMode(c.dataset.draw);
    if (innerWidth <= 720) setSheet(false);
    return;
  }
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
