// The workspace page: map, drawing and editing tools, and the conversation.
// Step 1 of the public build: shapes are measured and placed with the reference layers. The agent comes next.
import { TerraDraw, TerraDrawMapLibreGLAdapter, TerraDrawSelectMode, TerraDrawPointMode, TerraDrawLineStringMode,
  TerraDrawPolygonMode, TerraDrawRectangleMode, TerraDrawCircleMode } from "./vendor/draw.js";
import * as turf from "./vendor/turf.js";
import * as G from "./geometry.js";
import * as R from "./reference.js";

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

// ---- drawing ------------------------------------------------------------------------
let draw;
const shapes = new Map(); // id -> { n, kind, feature, card, scale, scaleFrom }
const counts = { Point: 0, Line: 0, Area: 0 };
let selectedId = null;

function start() {
  if (started) return;
  started = true;
  clearTimeout(fallbackTimer);

  // Your shapes, drawn as ranging-pole bands. Terra Draw's own layers sit above these, for handles.
  map.addSource("aoi", { type: "geojson", data: turf.featureCollection([]) });
  map.addLayer({ id: "aoi-fill", type: "fill", source: "aoi", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": C.pole, "fill-opacity": 0.07 } });
  map.addLayer({ id: "aoi-halo", type: "line", source: "aoi", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": C.ink, "line-width": 6.5, "line-opacity": 0.85 } });
  map.addLayer({ id: "aoi-white", type: "line", source: "aoi", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": C.white, "line-width": 4.5 } });
  map.addLayer({ id: "aoi-red", type: "line", source: "aoi", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": C.pole, "line-width": 4.5, "line-dasharray": [1.6, 1.6] } });
  if (map.getStyle().glyphs) map.addLayer({ id: "aoi-label", type: "symbol", source: "aoi", layout: { "text-field": ["get", "label"], "text-size": 12, "text-font": ["Noto Sans Bold"], "text-offset": [0, 1.4], "text-anchor": "top", "text-optional": true }, paint: { "text-color": C.ink, "text-halo-color": C.white, "text-halo-width": 1.6 } });

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
  window.__ws = { map, draw, shapes, ref }; // for testing in the browser console
}

let refreshQueued = false;
function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    const feats = draw.getSnapshot().filter((f) => shapes.has(f.id) || !isGuide(f))
      .map((f) => ({ type: "Feature", geometry: f.geometry, properties: { label: shapes.get(f.id)?.label || "" } }));
    map.getSource("aoi")?.setData(turf.featureCollection(feats));
  });
}
const isGuide = (f) => ["selectionPoint", "midPoint", "closingPoint", "snappingPoint", "coordinatePoint"].some((k) => f.properties?.[k]);

// ---- modes and hints ---------------------------------------------------------------
const HINTS = {
  select: "", // shown only when something is selected
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
  document.querySelectorAll(".tools [data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode && mode !== "select") ));
  document.querySelector('.tools [data-mode="select"]').setAttribute("aria-pressed", String(mode === "select"));
  hint(mode === "select" ? (selectedId ? SELECTED_HINT : "") : HINTS[mode]);
}
function hint(text) { const h = $("hint"); h.textContent = text; h.hidden = !text; }

document.querySelectorAll(".tools [data-mode]").forEach((b) => b.addEventListener("click", () => draw && setMode(b.dataset.mode)));
document.querySelector('.tools [data-action="delete"]').addEventListener("click", () => { if (selectedId) removeShape(selectedId); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && draw && draw.getMode() !== "select") setMode("select");
});

// ---- shapes: new, edited, selected, deleted ------------------------------------------
function kindOf(geom) { return geom.type === "Point" ? "Point" : /LineString/.test(geom.type) ? "Line" : "Area"; }
const featureOf = (id) => { const f = draw.getSnapshotFeature(id); return f && { type: "Feature", properties: {}, geometry: f.geometry }; };

function onFinish(id, ctx) {
  const feature = featureOf(id);
  if (!feature) return;
  if (ctx?.action === "draw" && !shapes.has(id)) {
    const kind = kindOf(feature.geometry);
    const s = { id, kind, n: ++counts[kind], feature, scaleFrom: "size" };
    s.label = `${kind} ${s.n}`;
    shapes.set(id, s);
    s.card = makeCard(s);
    setMode("select");
    draw.selectFeature(id);
    refreshCard(s);
    scheduleRefresh();
    return;
  }
  const s = shapes.get(id);
  if (!s) return;
  const change = G.describeChange(s.feature, feature);
  s.feature = feature;
  if (change) logEdit(s, change);
  refreshCard(s);
}

function onSelect(id) {
  selectedId = id && shapes.has(id) ? id : null;
  document.querySelector('.tools [data-action="delete"]').disabled = !selectedId;
  shapes.forEach((s) => s.card.classList.toggle("active", s.id === selectedId));
  if (selectedId) shapes.get(selectedId).card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (draw.getMode() === "select") hint(selectedId ? SELECTED_HINT : "");
}

function onDeleted(id) {
  const s = shapes.get(id);
  if (!s) return;
  s.card.classList.add("gone");
  s.card.classList.remove("active");
  s.card.querySelector(".summary").textContent = "Deleted.";
  shapes.delete(id);
  if (selectedId === id) onSelect(null);
}
function removeShape(id) { draw.removeFeatures([id]); onDeleted(id); scheduleRefresh(); }

// Editing from the card goes through the same deterministic functions the agent will use.
function applyGeometry(s, raw, words) {
  const feature = G.roundCoords(raw);
  try { draw.updateFeatureGeometry(s.id, feature.geometry); } catch (e) { activity(`That edit didn't work: ${e.message}`); return; }
  s.feature = { type: "Feature", properties: {}, geometry: feature.geometry };
  logEdit(s, words);
  refreshCard(s);
  scheduleRefresh();
}

function logEdit(s, words) {
  const li = document.createElement("li");
  li.textContent = words;
  s.card.querySelector(".history").append(li);
  (s.edits ||= []).push({ at: new Date().toISOString(), change: words });
}

// ---- cards ----------------------------------------------------------------------------
function makeCard(s) {
  const card = $("shape-card").content.firstElementChild.cloneNode(true);
  card.dataset.id = s.id;
  const sw = document.createElement("span");
  sw.className = `swatch ${s.kind === "Line" ? "line" : s.kind === "Point" ? "point" : ""}`;
  card.querySelector("h2").append(sw, s.label);
  if (s.kind === "Point") card.querySelectorAll('[data-op="rotate"], .resize').forEach((el) => el.remove());
  else card.querySelector(".unit").textContent = s.kind === "Area" ? "km²" : "km";

  card.querySelector('[data-op="zoom"]').addEventListener("click", () => zoomTo(s));
  card.querySelectorAll('[data-op="rotate"]').forEach((b) => b.addEventListener("click", () => {
    const deg = +b.dataset.deg;
    applyGeometry(s, G.rotate(s.feature, deg), `rotated ${Math.abs(deg)}° ${deg > 0 ? "clockwise" : "anticlockwise"}`);
  }));
  card.querySelector(".resize")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = parseFloat(e.target.querySelector("input").value);
    if (!(v > 0)) return;
    const before = s.kind === "Area" ? turf.area(s.feature) / 1e6 : turf.length(s.feature);
    applyGeometry(s, G.resizeTo(s.feature, v), `resized from ${R.fmtNum(before)} to ${R.fmtNum(v)} ${s.kind === "Area" ? "km²" : "km"}`);
  });
  card.querySelectorAll(".scale button").forEach((b) => b.addEventListener("click", () => {
    if (s.scale === b.dataset.scale) return;
    s.scale = b.dataset.scale; s.scaleFrom = "you";
    logEdit(s, `scale set to ${R.SCALES[s.scale].label.toLowerCase()}`);
    paintScale(s);
  }));
  card.addEventListener("click", (e) => {
    if (e.target.closest("button, input, form") || !shapes.has(s.id)) return;
    draw.selectFeature(s.id);
  });
  $("conversation").append(card);
  card.scrollIntoView({ block: "end", behavior: "smooth" });
  expandSheet();
  return card;
}

function paintScale(s) {
  s.card.querySelectorAll(".scale button").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.scale === s.scale));
    b.title = b.dataset.scale === s.scale && s.scaleFrom === "size" ? `Worked out from the size: ${R.SCALES[s.scale].hint}` : R.SCALES[b.dataset.scale].hint;
  });
}

let refreshSeq = 0;
async function refreshCard(s) {
  const seq = ++refreshSeq; s.seq = seq;
  const sum = s.card.querySelector(".summary");
  sum.classList.add("loading");
  if (!s.described) sum.textContent = "Measuring…";
  try {
    const d = await R.describe(ref, s.feature);
    if (s.seq !== seq) return; // a newer edit overtook this one
    s.described = d;
    if (s.scaleFrom === "size") s.scale = d.scale;
    paintScale(s);
    sum.textContent = R.summaryLine(d);
    sum.classList.remove("loading");
    const [lon, lat] = d.centroid;
    const rows = [
      [s.kind === "Point" ? "Location" : "Centre", `${lat.toFixed(4)}, ${lon.toFixed(4)}`],
      d.area_km2 != null && ["Area", R.fmtArea(d.area_km2)],
      d.length_km != null && ["Length", `${R.fmtNum(d.length_km)} km`],
      d.extent_km != null && ["Across", `${R.fmtNum(d.extent_km)} km`],
      ["Country", d.offshore ? "None (offshore)" : d.countries.join(", ")],
      d.coast_km != null && ["Coast", `${R.fmtNum(d.coast_km)} km`],
      d.nearest_places.length && ["Towns", d.nearest_places.map((p) => `${p.name} ${R.fmtNum(p.km)} km`).join(", ")],
      d.places_inside && ["Cities", d.places_inside.count ? `${d.places_inside.largest.map((p) => p.name).join(", ")}${d.places_inside.count > 3 ? ` and ${d.places_inside.count - 3} more` : ""}` : "None mapped at this scale"],
    ].filter(Boolean);
    const dl = s.card.querySelector(".facts");
    dl.replaceChildren(...rows.flatMap(([k, v]) => [el("dt", k), el("dd", v)]), el("dd", "Places, coast and borders from Natural Earth (1:10m), good to about a kilometre.", "src"));
    const input = s.card.querySelector(".resize input");
    if (input && document.activeElement !== input) input.value = s.kind === "Area" ? +d.area_km2.toPrecision(4) : +d.length_km.toPrecision(4);
    activity(`${s.label}: ${R.summaryLine(d)}`);
  } catch (e) {
    sum.textContent = `Couldn't place this shape: ${e.message}`;
    activity("");
  }
}

function zoomTo(s) {
  if (s.kind === "Point") map.flyTo({ center: s.feature.geometry.coordinates, zoom: Math.max(map.getZoom(), 11) });
  else map.fitBounds(turf.bbox(s.feature), { padding: fitPadding(), maxZoom: 15 });
  if (shapes.has(s.id)) draw.selectFeature(s.id);
}
function fitPadding() {
  if (innerWidth <= 720) return { top: 60, bottom: Math.min(innerHeight * 0.5, 360), left: 30, right: 70 };
  return { top: 60, bottom: 60, left: 440, right: 90 };
}

// ---- conversation ---------------------------------------------------------------------
function el(tag, text, cls) { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; }
function note(text) { $("conversation").append(el("p", text, "msg note")); }
function activity(text, busy = false) { const a = $("activity"); a.textContent = text; a.classList.toggle("busy", busy); }

const say = $("say");
say.addEventListener("input", grow);
say.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("ask").requestSubmit(); } });
function grow() { say.style.height = "auto"; say.style.height = Math.min(say.scrollHeight, 140) + "px"; }

$("ask").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = say.value.trim();
  if (!text) return;
  $("conversation").append(el("div", text, "msg user"));
  say.value = ""; grow();
  const reply = el("div", "", "msg analyst");
  reply.append(el("p", "The analyst isn't connected in this preview yet, so I can't act on that. For now, draw or edit a shape and I'll describe where it is and how big it is."));
  $("conversation").append(reply);
  reply.scrollIntoView({ block: "end", behavior: "smooth" });
});

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
    rec.onend = () => { rec = null; mic.classList.remove("on"); mic.title = "Speak"; say.focus(); };
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
// While drawing on a phone, get the sheet out of the way.
document.querySelectorAll(".tools [data-mode]").forEach((b) => b.addEventListener("click", () => {
  if (innerWidth <= 720 && b.dataset.mode !== "select") setSheet(false);
}));
