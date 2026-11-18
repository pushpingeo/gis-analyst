// Tools the conversation agent uses to find places and build areas from words.
// The model works with ids (C3 for a found candidate, "Area 1" for a place); geometry stays here.
// A host object supplies the project's places and reference data, so the same code runs in the page and in the evaluation.
import * as turf from "./vendor/turf.js";
import * as G from "./geometry.js";
import * as R from "./reference.js";
import { rateConfidence, runCheck, MATCHES } from "./confidence.js";
import { atlasFindNamed, NAMED_KINDS, describeChecked } from "./atlasfeatures.js";
import { DATA_TOOL_DEFS, createDataTools, geometryDistanceKm } from "./datatools.js";
import { themeFor, THEME_IDS } from "./findings.js";
import { ASSET_TYPES } from "./distances.js";
import { searchAnchors, searchNominatim, searchNaturalEarth, searchWikidata, findFeaturesNear, featureOutline, FEATURE_TYPES } from "./gazetteer.js";

// Common names that aren't Natural Earth's own, and seas (energy basins especially) by rough box.
const COUNTRY_ALIASES = { "united states": "united states of america", us: "usa", america: "united states of america", "u.s.": "usa", "u.s.a.": "usa",
  uk: "united kingdom", britain: "united kingdom", "great britain": "united kingdom", "russian federation": "russia",
  "democratic republic of the congo": "dem. rep. congo", drc: "dem. rep. congo", "ivory coast": "côte d'ivoire", "south korea": "south korea", uae: "united arab emirates" };
const box = (label, bbox) => ({ label, bbox });
const GOM = box("the Gulf of Mexico (Gulf of America)", [-98, 17.5, -80, 31]);
const SEAS = {
  "gulf of mexico": GOM, "gulf of america": GOM, gom: GOM,
  "north sea": box("the North Sea", [-4.5, 50.5, 12, 62]), "central north sea": box("the central North Sea", [-2, 55, 6, 58.5]),
  "irish sea": box("the Irish Sea", [-7, 51.5, -2.5, 55]), "celtic sea": box("the Celtic Sea", [-11, 48, -4, 52]),
  "norwegian sea": box("the Norwegian Sea", [-5, 62, 20, 72]), "barents sea": box("the Barents Sea", [15, 68, 60, 81]),
  "baltic sea": box("the Baltic Sea", [9, 53, 31, 66]), "mediterranean": box("the Mediterranean", [-6, 30, 36.5, 46]), "mediterranean sea": box("the Mediterranean", [-6, 30, 36.5, 46]),
  "gulf of guinea": box("the Gulf of Guinea", [-10, -6, 12, 7]), "persian gulf": box("the Persian Gulf", [47.5, 23, 57, 31]), "arabian gulf": box("the Persian Gulf", [47.5, 23, 57, 31]),
  "red sea": box("the Red Sea", [32, 12, 44, 30]), "caspian sea": box("the Caspian Sea", [46, 36, 55.5, 47.5]), "black sea": box("the Black Sea", [27, 40.5, 42, 47.5]),
  "caribbean": box("the Caribbean", [-88, 9, -59, 23]), "caribbean sea": box("the Caribbean", [-88, 9, -59, 23]),
  "south china sea": box("the South China Sea", [99, -3, 122, 25]), "timor sea": box("the Timor Sea", [122, -15.5, 133, -8]), "bass strait": box("Bass Strait", [143, -41.5, 149, -38]),
  "bay of bengal": box("the Bay of Bengal", [79, 5, 95, 23]), "arabian sea": box("the Arabian Sea", [51, 5, 77, 26]),
  "gulf of thailand": box("the Gulf of Thailand", [99, 5, 105.5, 14]), "java sea": box("the Java Sea", [105, -7.5, 119, -3]),
  "santos basin": box("the Santos Basin", [-49, -28, -40, -22]), "campos basin": box("the Campos Basin", [-42.5, -24, -39, -20.5]),
};

const GENERIC_WORDS = /^(the|of|a|an|platform|platforms|field|fields|block|blocks|licen[cs]e|lease|mine|mines|farm|wind|solar|offshore|onshore|oil|gas|plant|power|station|project|site|terminal|port|harbour|harbor|tlp|spar|fpso|installation|facility|development|area|park|reserve)$/i;

const walkCoords = (g) => { const out = []; const w = (c) => (typeof c[0] === "number" ? out.push(c) : c.forEach(w)); w(g.coordinates); return out; };

const round = (v, d = 3) => (v == null ? v : Math.round(v * 10 ** d) / 10 ** d);

export function placeToolDefs(skills) {
  return [
    {
      name: "load_skill",
      description: `Load a skill: a written method for a kind of GIS work. Load it before doing that work and follow it. Available: ${skills.map((s) => `${s.name} (${s.description})`).join("; ")}`,
      input_schema: { type: "object", properties: { name: { type: "string", enum: skills.map((s) => s.name) } }, required: ["name"] },
    },
    {
      name: "find_place",
      description: "Search for a named place, asset or feature. Always searches OpenStreetMap (Nominatim), Wikidata (good for named mines, dams, power plants and ports), Natural Earth towns and a few fast layers (NSTA offshore installations, fields and UK licensing blocks; Crown Estate and Crown Estate Scotland offshore wind lease areas). Give `kind` and `area` to also search the AI Living World Atlas catalogue: it finds the published layers that hold that kind of thing in that area (any country) and searches them for the name. Do that for things OpenStreetMap rarely holds: licence blocks and concessions, fields, wells, leases, protected areas, official boundaries, numbered roads. The reply lists the layers searched, so you can say what was and wasn't checked. Returns candidates with ids (C1, C2…), type, source, position and size.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The name or reference to search for, e.g. 'Jackdaw', 'Mocuba', '30/2', 'OML 145', 'Lake Turkana'" },
          also: { type: "array", items: { type: "string" }, maxItems: 3, description: "Optional: up to three other spellings or forms searched at the same time, e.g. ['Tasiast mine', 'Tasiast gold'] or ['Oil Mining Lease 145']. Cheaper than separate calls." },
          near: { type: "string", description: "Optional: a candidate id or place name to search near" },
          country: { type: "string", description: "Optional ISO 3166 two-letter country code to restrict OpenStreetMap results" },
          kind: { type: "string", enum: Object.keys(NAMED_KINDS), description: "Optional: what kind of thing it is, to search the atlas catalogue for it" },
          area: { type: "string", description: "With kind: where to look. A country name (its waters are included), a candidate id or a place name. Leave it out to use the map view." },
        },
        required: ["query"],
      },
    },
    {
      name: "find_features_near",
      description: `Find features of a type (from the atlas catalogue and OpenStreetMap) within a radius of an anchor (a candidate or a place). For an area or line, distances are from its edge (0 = inside or touching); for a point, from the point, with bearing. Reports how many were found in all and how many are listed. Found features go on the map and stay there. Assets near a point come largest first, everything else nearest first. Use it for "schools near X" or "hospitals within 5 km of Area 1", and to find an asset once a town anchors the search. One call does the whole search: don't search by name for kinds of things. Types: ${Object.keys(FEATURE_TYPES).join(", ")}.`,
      input_schema: {
        type: "object",
        properties: {
          anchor: { type: "string", description: "Candidate id (e.g. C2) or place name (e.g. Area 1)" },
          feature_type: { type: "string", enum: Object.keys(FEATURE_TYPES) },
          radius_km: { type: "number", description: "Search radius, 0.5 to 50 km" },
          name: { type: "string", description: "Optional: part of the feature's name" },
          theme: { type: "string", enum: THEME_IDS, description: "Optional, when screening: which theme this search is for (sets the colour on the map)." },
        },
        required: ["anchor", "feature_type", "radius_km"],
      },
    },
    {
      name: "make_place",
      description: "Build a place on the map from an anchor, with a deterministic geometry tool. Shapes: point; square (area_km2 or side_km); circle (radius_km or area_km2); rectangle (width_km, height_km); feature (the anchor's own outline, e.g. a field or block); buffer (buffer_km around the anchor's geometry, e.g. a corridor along a line). Any shape can be offset from the anchor by offset_km along bearing_deg, and rotated by rotation_deg (clockwise). The place is shown as a proposal for the person to accept or adjust.",
      input_schema: {
        type: "object",
        properties: {
          anchor: { type: "string", description: "Candidate id or existing place name" },
          also: { type: "array", items: { type: "string" }, description: "With shape 'feature': more candidate ids whose outlines are joined with the anchor's, e.g. the A, B and C parts of one wind farm. With shape 'buffer': more pieces of the same thing (road or river segments) buffered and joined into one corridor." },
          shape: { type: "string", enum: ["point", "square", "circle", "rectangle", "feature", "buffer"] },
          area_km2: { type: "number" }, side_km: { type: "number" }, radius_km: { type: "number" },
          width_km: { type: "number", description: "East–west size before rotation" }, height_km: { type: "number", description: "North–south size before rotation" },
          buffer_km: { type: "number" }, rotation_deg: { type: "number" },
          offset_km: { type: "number" }, bearing_deg: { type: "number", description: "Degrees clockwise from north for the offset" },
          words: { type: "string", description: "The person's own words that this place answers" },
          match: { type: "string", enum: MATCHES, description: "How the anchor relates to what the person wants. named_place: they asked for this place itself (a palace, a town, a block, a field). name_and_type: the asset itself, matched by name and of the right type (a mine for a mine). type_near_clues: a feature of the right type found where the clues point, its name not confirmed. name_only: the name matches but the type is wrong or unknown. settlement_or_region: a town, village or region stands in for the site. none: nothing specific." },
          checks: { type: "array", description: "Every distance clue in the request that the place can be checked against, e.g. 'Nok Kundi lies about 80 km south-east of the mine' → { against: <Nok Kundi's candidate id>, expected_km: 80, direction: 'SE' }. Direction is the way you travel FROM the site TO that feature. Give all you have; they are measured, not trusted.", items: { type: "object", properties: { against: { type: "string", description: "Candidate id" }, expected_km: { type: "number" }, direction: { type: "string", description: "Compass point from the site to it: N, NE, ENE… (optional)" } }, required: ["against", "expected_km"] } },
          reason: { type: "string", description: "One line: the evidence for the location" },
          clip: { type: "object", description: "Optional: cut the shape to a limit, e.g. a corridor along the M9 'within 5 km of Linlithgow' → { to: <Linlithgow's candidate id>, within_km: 5 }. Without within_km it's cut to the outline of 'to' (a place or a candidate with an outline, e.g. 'only inside Fife').", properties: { to: { type: "string", description: "Candidate id or place name" }, within_km: { type: "number" } }, required: ["to"] },
          scale: { type: "string", enum: ["local", "regional", "global"], description: "Only when the request itself says the scale of the work (e.g. 'screen Mozambique' is global, 'the whole of the Moray Firth' regional) and it differs from the shape's size. Otherwise leave it out and the size decides." },
        },
        required: ["anchor", "shape", "words", "match", "reason"],
      },
    },
    {
      name: "offer_choices",
      description: "When several found candidates could be what the person means and the difference matters, show them as choices: the person flicks through them on the map, each with its source, and picks one or takes your recommendation. Give two to five candidate ids in order of preference, the one you recommend, and a one-line reason. Then end your turn with a short question; their pick comes back as their next message.",
      input_schema: {
        type: "object",
        properties: {
          candidates: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
          recommended: { type: "string", description: "The candidate id you recommend" },
          reason: { type: "string", description: "One line: why you recommend it" },
          question: { type: "string", description: "Optional: what the person is choosing, e.g. 'Which Linlithgow Palace do you mean?'" },
        },
        required: ["candidates", "recommended", "reason"],
      },
    },
    {
      name: "edit_place",
      description: "Change a place: rotate (degrees clockwise), resize to an area (km²) or length (km), move (km along a bearing) or rename. Rotation and resizing keep the centre and are done on the ground, not on the map projection.",
      input_schema: {
        type: "object",
        properties: {
          place: { type: "string", description: "Place name, e.g. Area 1" },
          rotate_deg: { type: "number" }, resize_to: { type: "number" },
          move_km: { type: "number" }, move_bearing_deg: { type: "number" },
          rename: { type: "string" },
        },
        required: ["place"],
      },
    },
    {
      name: "get_place",
      description: "Full details of a place: size, where it is, how it was made and its edit history.",
      input_schema: { type: "object", properties: { place: { type: "string" } }, required: ["place"] },
    },
    ...DATA_TOOL_DEFS,
    {
      name: "screen_site",
      description: "Screen a place for non-technical risk (NTR: land and livelihoods, biodiversity, Indigenous Peoples, cultural heritage, community health and safety, operating context). Runs the NTR method as its own sealed run with the data tools, then shows a run card (flags first, evidence on the map, the distances used with a slider, gaps) and returns the headline. Use it for any request to screen a site or ask what risks, sensitivities or constraints it raises. The place must already exist (find or build it first). Distances come from the asset type and size unless the person gives their own. Takes 30 to 90 seconds.",
      input_schema: {
        type: "object",
        properties: {
          place: { type: "string", description: "Place name, e.g. Area 1" },
          asset_type: { type: "string", enum: ASSET_TYPES, description: "What would be built or done there. Use 'other' if unknown." },
          assumed: { type: "boolean", description: "True if the person didn't say the asset type and you inferred it (e.g. an oil field's name)." },
          stage: { type: "string", enum: ["greenfield", "expansion", "existing asset"], description: "Only if the person said; otherwise leave out (greenfield is assumed and said)." },
          capacity_mw: { type: "number", description: "Only if the person gave it" },
          tip_height_m: { type: "number", description: "Wind turbine tip height, only if the person gave it" },
          distances: { type: "object", description: "Only if the person gave distances: near, close and/or wider in km (wider up to 50).", properties: { near: { type: "number" }, close: { type: "number" }, wider: { type: "number" } } },
          focus: { type: "string", description: "Optional: what the person is most concerned about, in their words" },
        },
        required: ["place", "asset_type"],
      },
    },
    {
      name: "get_run",
      description: "Details of a screening run (R1, R2…; leave out for the latest): flags with their evidence, what was checked and the gaps. For follow-up questions about a screen; don't re-run to answer them.",
      input_schema: { type: "object", properties: { run: { type: "string" } } },
    },
    {
      name: "show_on_map",
      description: "Bring findings into view: fits the map to the given feature ids (from find_features_near or get_data), or to everything found so far, together with the place in focus. Findings already stay on the map; use this when the person asks to see them. clear: true removes all findings from the map.",
      input_schema: { type: "object", properties: { ids: { type: "array", items: { type: "string" }, description: "Feature ids; leave out for all findings" }, clear: { type: "boolean" } } },
    },
  ];
}

// host: { places(), addPlace({feature, origin}), updatePlace(name, feature, words), renamePlace(name, newName),
//         findPlace(name), ref, anchors (sources), fetchFn, headers, onCandidates(list), skillText(name) }
export function createPlaceTools(host) {
  const cands = new Map();
  let n = 0;
  const keep = (c) => { const id = `C${++n}`; cands.set(id, { ...c, id }); return id; };

  const resolve = (ref) => {
    if (!ref) throw new Error("No anchor given.");
    const c = cands.get(String(ref).trim().toUpperCase());
    if (c) return { feature: { type: "Feature", properties: {}, geometry: c.geometry }, lonlat: c.lonlat, label: c.name || c.id, cand: c };
    const p = host.findPlace(ref);
    if (!p) {
      // The model sometimes passes a name instead of an id: take the most recent candidate with that name.
      const byName = [...cands.values()].reverse().find((x) => x.name && x.name.toLowerCase() === String(ref).trim().toLowerCase());
      if (byName) return resolve(byName.id);
    }
    if (p) {
      const at = p.feature.geometry.type === "Point" ? p.feature.geometry.coordinates : turf.centroid(p.feature).geometry.coordinates;
      return { feature: p.feature, lonlat: at, label: p.name, place: p };
    }
    throw new Error(`"${ref}" isn't a candidate id from this conversation or a place name. Use find_place first.`);
  };

  const compact = (c) => ({
    id: c.id, name: c.name, type: c.type, source: `${c.source.publisher} – ${c.source.title}`, licence: c.source.licence,
    lat: round(c.lonlat[1], 4), lon: round(c.lonlat[0], 4),
    ...(c.area_km2 != null ? { area_km2: c.area_km2 } : {}), ...(c.length_km != null ? { length_km: c.length_km } : {}),
    ...(c.distance_km != null ? { distance_km: c.distance_km, bearing_deg: c.bearing } : {}),
    ...(c.edge_km != null ? { nearest_edge_km: c.edge_km } : {}), ...(c.contains_anchor ? { contains_anchor: true } : {}),
    ...(c.outline ? { has_outline: true, note: "Anchors on its centre; use shape \"feature\" for the area itself." } : {}),
    ...(Object.keys(c.extra || {}).length ? { details: c.extra } : {}),
  });

  async function placeSummary(p) {
    const d = await R.describe(host.ref, p.feature);
    return { place: p.name, status: p.status, summary: R.summaryLine(d), scale: d.scale, area_km2: d.area_km2, length_km: d.length_km, countries: d.countries, offshore: d.offshore };
  }

  // Where to search the catalogue: a country (with a margin for its waters), a sea, a candidate or place, any other
  // named area via OpenStreetMap, or the map view. (Mars, 17 Nov: "United States" and "Gulf of America" weren't
  // recognised, so the catalogue was never searched, and the USA's box spanned the date line, so it covered the world.)
  async function catalogueArea(area, nearAt) {
    if (area) {
      const want = String(area).trim().toLowerCase().replace(/^the\s+/, "");
      const sea = SEAS[want];
      if (sea) return { bbox: sea.bbox, label: sea.label };
      try {
        const countries = await host.ref.get("countries");
        const name = COUNTRY_ALIASES[want] || want;
        const hit = countries.features.filter((f) => [f.properties.name, f.properties.iso, f.properties.sovereign].some((v) => v && v.toLowerCase() === name));
        if (hit.length) {
          let b = turf.bbox({ type: "FeatureCollection", features: hit });
          let note = "";
          if (b[2] - b[0] > 180) {
            // Crosses the date line or has far-flung parts (USA, Russia, Fiji, New Zealand): use the largest part.
            const parts = hit.flatMap((f) => (f.geometry.type === "MultiPolygon" ? f.geometry.coordinates.map((c) => turf.polygon(c)) : [f]));
            const big = parts.reduce((a, x) => (turf.area(x) > turf.area(a) ? x : a));
            b = turf.bbox(big); note = " (main part only)";
          }
          return { bbox: [b[0] - 2.5, b[1] - 2.5, b[2] + 2.5, b[3] + 2.5].map((v, i) => round(Math.max(Math.min(v, i % 2 ? 85 : 180), i % 2 ? -85 : -180), 3)), label: `${hit[0].properties.name} and its waters${note}` };
        }
      } catch { /* reference not loaded */ }
      try {
        const a = resolve(area);
        const b = /Polygon|Line/.test(a.feature.geometry.type) ? turf.bbox(a.feature) : null;
        const pad = 0.5;
        return { bbox: b ? [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad] : [a.lonlat[0] - 1, a.lonlat[1] - 1, a.lonlat[0] + 1, a.lonlat[1] + 1], label: `around ${a.label}` };
      } catch { /* not a candidate or place */ }
      try {
        // Any other named area (a state, a province, a bay): OpenStreetMap's outline, or its centre ± 1.5°.
        const [g] = await searchNominatim(String(area), { fetchFn: host.fetchFn, headers: host.headers, limit: 1 });
        if (g) {
          const b = g.outline ? turf.bbox({ type: "Feature", properties: {}, geometry: g.outline }) : [g.lonlat[0] - 1.5, g.lonlat[1] - 1.5, g.lonlat[0] + 1.5, g.lonlat[1] + 1.5];
          if (b[2] - b[0] < 60) return { bbox: b.map((v) => round(v, 3)), label: `${g.name} (from OpenStreetMap)` };
        }
      } catch { /* OpenStreetMap down */ }
    }
    if (nearAt) return { bbox: [nearAt[0] - 1, nearAt[1] - 1, nearAt[0] + 1, nearAt[1] + 1], label: "around the 'near' anchor" };
    const v = host.view?.();
    if (v) return { bbox: v, label: `the map view${area ? ` ("${area}" wasn't recognised)` : ""}` };
    return null;
  }

  async function searchCatalogue(names, kind, area, nearAt) {
    if (!host.atlas) return { report: { not_checked: "The atlas isn't connected here." } };
    const where = await catalogueArea(area, nearAt);
    if (!where) return { report: { not_checked: `"${area}" isn't a country, candidate or place, and there's no map view: find the area first.` } };
    try {
      const r = await atlasFindNamed(names, kind, where.bbox, { call: host.atlas });
      return { candidates: r.candidates, report: {
        searched: `${kind} layers covering ${where.label}`, found: r.candidates.length,
        layers_checked: describeChecked(r.checked), layers_found: r.layers_found,
        ...(r.layers_not_checked ? { more_layers_not_checked: r.layers_not_checked } : {}),
        ...(r.layers_found ? {} : { note: `The catalogue has no ${kind} layers covering ${where.label}.` }),
      } };
    } catch (e) {
      return { report: { not_checked: String(e.message || e).slice(0, 160) } };
    }
  }

  const run = {
    async load_skill({ name }) {
      return { skill: name, method: host.skillText(name) };
    },

    async find_place({ query, also = [], near, country, kind, area }) {
      // "near" is a hint: if it isn't a candidate or place yet, search without it rather than fail the call.
      let nearAt = null, nearNote = null;
      if (near) { try { nearAt = resolve(near).lonlat; } catch { nearNote = `"${near}" isn't a candidate id or place yet, so the search wasn't narrowed to it. Find it first if you need it.`; } }
      const names = [...new Set([query, ...(Array.isArray(also) ? also : [])].map((x) => String(x || "").trim()).filter(Boolean))].slice(0, 4);
      const errors = [];
      // Every source and every spelling at once, the catalogue too; results keep this order (authoritative first).
      const perName = (q) => Promise.allSettled([
        searchAnchors(host.anchors, q, { near: nearAt, fetchFn: host.fetchFn }),
        searchNominatim(q, { near: nearAt, country, fetchFn: host.fetchFn, headers: host.headers }),
        searchWikidata(q, { fetchFn: host.fetchFn, headers: host.headers }),
      ]);
      // The catalogue also gets the name without words that describe the kind of thing ("Mars platform" → "Mars"),
      // because a publisher's record rarely repeats them ("A-Mars TLP"; Mars missed on 17 Nov when the analyst
      // didn't happen to try "Mars TLP").
      const core = (n) => n.split(/\s+/).filter((w) => !GENERIC_WORDS.test(w)).join(" ").trim();
      const catalogueNames = [...new Set([...names, ...names.map(core).filter((c) => c && c.length >= 3)])].slice(0, 6);
      const [atlas, ...byName] = await Promise.all([kind ? searchCatalogue(catalogueNames, kind, area, nearAt) : null, ...names.map(perName)]);
      const anchors = [], others = [];
      byName.forEach(([an, nom, wd], i) => {
        const q = names[i];
        if (an.status === "fulfilled") for (const x of an.value) (x.error ? errors.push(x.error) : anchors.push(x));
        if (nom.status === "fulfilled") others.push(...nom.value); else errors.push(`OpenStreetMap search for "${q}": ${nom.reason?.message}`);
        if (wd.status === "fulfilled") others.push(...wd.value); else errors.push(`Wikidata search for "${q}": ${wd.reason?.message}`);
      });
      try { const pl = await host.ref.get("places"); for (const q of names) others.push(...searchNaturalEarth(pl, q)); } catch { /* reference not loaded */ }
      // The same feature found under two spellings comes once.
      const seen = new Set();
      const results = [...(atlas?.candidates || []), ...anchors, ...others].filter((c) => {
        const k = `${c.source?.id}|${c.source?.url || c.source?.atlas_id || ""}|${(c.name || "").toLowerCase()}|${c.lonlat.map((v) => v.toFixed(3))}`;
        if (seen.has(k)) return false; seen.add(k); return true;
      });
      const list = results.map((c) => {
        if (nearAt) { c.distance_km = round(turf.distance(nearAt, c.lonlat), 1); c.bearing = Math.round((turf.bearing(nearAt, c.lonlat) + 360) % 360); }
        return cands.get(keep(c));
      });
      host.onCandidates?.(list);
      return { searched_for: names, candidates: list.slice(0, 12).map(compact), ...(list.length > 12 ? { more_candidates: list.length - 12 } : {}),
        ...(atlas ? { atlas: atlas.report } : {}), ...(errors.length ? { problems: [...new Set(errors)] } : {}), ...(nearNote ? { near_ignored: nearNote } : {}),
        note: list.length ? undefined : "Nothing found. Try another spelling, a shorter name, or the nearest town and find_features_near." };
    },

    async find_features_near({ anchor, feature_type, radius_km, name, theme }) {
      const a = resolve(anchor);
      const g = a.feature.geometry;
      const shaped = g.type !== "Point";
      // For an area or line, search a circle that covers the shape plus the radius, then measure each feature from
      // the shape's edge (Rosebank, 17 Nov: distances were from the field's centre and read as from its edge).
      const reach = shaped ? Math.max(...walkCoords(g).map((c) => turf.distance(a.lonlat, c))) : 0;
      const r = await findFeaturesNear(a.lonlat, feature_type, Math.min(radius_km + reach, 50), { name, fetchFn: host.fetchFn, headers: host.headers, atlas: host.atlas || null, limit: shaped ? 200 : 15 });
      let found = r.candidates;
      if (shaped) {
        for (const c of found) { const d = geometryDistanceKm(g, c.geometry); c.distance_km = d == null ? null : round(d, 2); delete c.bearing; delete c.edge_km; }
        found = found.filter((c) => c.distance_km != null && c.distance_km <= radius_km).sort((x, y) => x.distance_km - y.distance_km);
      }
      const total = shaped ? found.length : r.total;
      const list = found.slice(0, 15).map((c) => cands.get(keep(c)));
      if (list.length) (host.addFindings ? host.addFindings(list, { theme: themeFor({ theme, featureType: feature_type }), dataset: feature_type, place: a.feature }) : host.onCandidates?.(list));
      return {
        anchor: a.label, feature_type, radius_km, measured_from: shaped ? `the edge of ${a.label} (0 = inside or touching)` : `the point ${a.label}`,
        found: total, listed: list.length, ...(total > list.length ? { not_listed: `${total - list.length} more found but not listed (nearest ${list.length} shown). Say "${total} found", not ${list.length}.` } : {}),
        ...(shaped && reach + radius_km > 50 ? { note_reach: "The shape is large, so the search was capped at 50 km from its centre; features further along it may be missed." } : {}),
        sources: r.sources, wind_turbines: r.wind_turbines, ...(r.note ? { note: r.note } : {}), candidates: list.map(compact),
      };
    },

    async make_place(i) {
      const a = resolve(i.anchor);
      let centre = a.lonlat;
      const steps = [];
      if (i.offset_km) {
        centre = turf.destination(centre, i.offset_km, i.bearing_deg ?? 0).geometry.coordinates;
        steps.push(`moved ${i.offset_km} km on a bearing of ${i.bearing_deg ?? 0}° from ${a.label}`);
      }
      let f;
      switch (i.shape) {
        case "point": f = turf.point(centre); steps.push("point"); break;
        case "square": {
          const area = i.area_km2 ?? (i.side_km ? i.side_km ** 2 : null);
          if (!area) throw new Error("A square needs area_km2 or side_km.");
          f = G.squareAround(centre, area, i.rotation_deg || 0); steps.push(`square of ${round(area)} km² centred there`); break;
        }
        case "circle": {
          const r = i.radius_km ?? (i.area_km2 ? Math.sqrt(i.area_km2 / Math.PI) : null);
          if (!r) throw new Error("A circle needs radius_km or area_km2.");
          f = G.circleAround(centre, { radiusKm: r }); steps.push(`circle of radius ${round(r, 2)} km`); break;
        }
        case "rectangle":
          if (!i.width_km || !i.height_km) throw new Error("A rectangle needs width_km and height_km.");
          f = G.rectangleAround(centre, i.width_km, i.height_km, i.rotation_deg || 0); steps.push(`rectangle ${i.width_km} × ${i.height_km} km`); break;
        case "feature":
          if (a.cand?.approx && a.cand.osm) {
            const g = await featureOutline(a.cand.osm, { fetchFn: host.fetchFn, headers: host.headers }).catch(() => null);
            if (g) { a.cand.geometry = g; a.cand.approx = false; a.feature = { type: "Feature", properties: {}, geometry: g }; }
            else steps.push("outline unavailable, so its bounding box was used");
          }
          f = JSON.parse(JSON.stringify(a.cand?.outline ? { type: "Feature", properties: {}, geometry: a.cand.outline } : a.feature));
          if (i.also?.length) {
            const parts = i.also.map(resolve);
            for (const p of parts) {
              if (!/Polygon/.test(p.feature.geometry.type) || !/Polygon/.test(f.geometry.type)) throw new Error("Only outlines (polygons) can be joined.");
              f = turf.union(turf.featureCollection([f, p.feature])) || f;
            }
            steps.push(`outlines of ${[a.label, ...parts.map((p) => p.label)].join(", ")}, joined`);
          } else steps.push(`outline of ${a.label}`);
          if (i.offset_km) f = G.move(f, i.offset_km, i.bearing_deg ?? 0);
          break;
        case "buffer":
          if (!i.buffer_km) throw new Error("A buffer needs buffer_km.");
          f = turf.buffer(i.offset_km ? G.move(a.feature, i.offset_km, i.bearing_deg ?? 0) : a.feature, i.buffer_km, { units: "kilometers", steps: 16 });
          if (i.also?.length) {
            // Several pieces of one thing (the segments of a road or river): buffer each and join them.
            const parts = i.also.map(resolve);
            for (const p of parts) f = turf.union(turf.featureCollection([f, turf.buffer(p.feature, i.buffer_km, { units: "kilometers", steps: 16 })])) || f;
            steps.push(`${i.buffer_km} km buffer around ${[a.label, ...parts.map((p) => p.label)].join(", ")}, joined`);
          } else steps.push(`${i.buffer_km} km buffer around ${a.label}`);
          break;
        default: throw new Error(`Unknown shape ${i.shape}.`);
      }
      if (i.clip?.to) {
        // Cut to a circle (or buffer) round another feature, or to its outline: "within 5 km of Linlithgow".
        const lim = resolve(i.clip.to);
        const limGeom = lim.cand?.outline || lim.feature.geometry;
        let limit;
        if (i.clip.within_km) {
          limit = limGeom.type === "Point" ? turf.circle(limGeom.coordinates, i.clip.within_km, { units: "kilometers", steps: 64 })
            : turf.buffer({ type: "Feature", properties: {}, geometry: limGeom }, i.clip.within_km, { units: "kilometers", steps: 32 });
        } else if (/Polygon/.test(limGeom.type)) limit = { type: "Feature", properties: {}, geometry: limGeom };
        else throw new Error(`${lim.label} is a ${limGeom.type === "Point" ? "point" : "line"}, so it needs within_km to clip to.`);
        if (!/Polygon/.test(f.geometry.type)) throw new Error("Only areas can be clipped (build the corridor or shape first, then clip it).");
        const cut = turf.intersect(turf.featureCollection([f, limit]));
        if (!cut) throw new Error(`The shape doesn't reach ${i.clip.within_km ? `within ${i.clip.within_km} km of ` : ""}${lim.label}, so clipping would leave nothing.`);
        const before = turf.area(f) / 1e6;
        f = cut;
        steps.push(`clipped to ${i.clip.within_km ? `within ${i.clip.within_km} km of ${lim.label}` : `the outline of ${lim.label}`} (${round(before, 1)} km² → ${round(turf.area(f) / 1e6, 1)} km²)`);
      }
      {
        // The map editor can't hold holes. Fill them, and say so with the area it adds, rather than
        // let the analyst swap the publisher's outline for an invented shape (Beatrice, 16 Nov).
        const filled = G.fillHoles(f);
        if (filled.holes) { f = filled.feature; steps.push(`${filled.holes} hole${filled.holes > 1 ? "s" : ""} in the outline filled (adds ${round(filled.addedKm2, 2)} km²), because the map can't edit holes yet`); }
        const main = G.largestPart(f);
        if (main.dropped) { f = main.feature; steps.push(`kept the main part; ${main.dropped} smaller part${main.dropped > 1 ? "s" : ""} (${round(main.droppedKm2, 2)} km², e.g. islands) left out, because the map can't edit multi-part shapes yet`); }
      }
      if (i.rotation_deg && !["square", "rectangle", "point"].includes(i.shape)) { f = G.rotate(f, i.rotation_deg); steps.push(`rotated ${i.rotation_deg}°`); }
      else if (i.rotation_deg && ["square", "rectangle"].includes(i.shape)) steps.push(`rotated ${i.rotation_deg}°`);
      f = G.roundCoords({ type: "Feature", properties: {}, geometry: f.geometry });
      // Confidence from the evidence, in code: checks are measured from the place just built.
      const site = f.geometry.type === "Point" ? f.geometry.coordinates : turf.centroid(f).geometry.coordinates;
      const checks = [];
      for (const c of i.checks || []) {
        try { const t = resolve(c.against); checks.push(runCheck(site, { lonlat: t.lonlat, name: t.label }, c)); }
        catch { checks.push({ against: c.against, expected_km: c.expected_km, pass: null, why: "not a candidate id, so not checked" }); }
      }
      // Built on a place already on the map: it starts from that place's confidence (a person's drawing counts as high),
      // not from the anchor rules, which would read a platform point as "nothing specific" (Mars, 17 Nov).
      const inherit = !a.cand && a.place ? { name: a.place.name, confidence: a.place.origin?.method === "words" ? a.place.origin.confidence : "high", drawn: a.place.origin?.method !== "words" } : null;
      const rated = rateConfidence({ cand: a.cand, match: i.match, checks: checks.filter((c) => c.pass !== null), offset: !!i.offset_km, shape: i.shape, inherit });
      const origin = {
        method: "words", words: i.words, steps, confidence: rated.confidence, confidence_rules: rated.rules, match: i.match, checks, reason: i.reason,
        anchor: a.cand ? { name: a.cand.name, type: a.cand.type, source: a.cand.source, lonlat: a.cand.lonlat, extra: a.cand.extra } : { place: a.label },
        at: new Date().toISOString(),
      };
      const p = host.addPlace({ feature: f, origin, scale: i.scale });
      return { ...(await placeSummary(p)), how: steps.join(", then "), confidence: rated.confidence, why: rated.rules,
        ...(checks.length ? { checks } : {}),
        next: rated.confidence === "low" && checks.some((c) => c.pass === false)
          ? "Shown as a proposal, low confidence because a check failed. Say which, and look for a feature that fits all the clues (find_features_near) before asking the person."
          : "Shown on the map as a proposal. Report the confidence as given here, and ask the person if it's what they meant." };
    },

    async offer_choices({ candidates, recommended, reason, question }) {
      const list = (candidates || []).map((id) => cands.get(String(id).trim().toUpperCase())).filter(Boolean);
      if (list.length < 2) throw new Error("Give at least two candidate ids from this conversation.");
      const rec = cands.get(String(recommended).trim().toUpperCase());
      if (!rec || !list.includes(rec)) throw new Error("The recommended id must be one of the candidates.");
      host.offerChoices?.({ choices: list, recommended: rec, reason, question });
      return { offered: list.length, recommended: rec.id, next: "Shown to the person. End your turn with one short question; don't build a place until they choose." };
    },

    async edit_place(i) {
      const p = host.findPlace(i.place);
      if (!p) throw new Error(`No place called "${i.place}".`);
      let f = p.feature;
      const words = [];
      if (i.rotate_deg) { f = G.rotate(f, i.rotate_deg); words.push(`rotated ${i.rotate_deg}°`); }
      if (i.resize_to) { f = G.resizeTo(f, i.resize_to); words.push(`resized to ${i.resize_to} ${/Polygon/.test(f.geometry.type) ? "km²" : "km"}`); }
      if (i.move_km) { f = G.move(f, i.move_km, i.move_bearing_deg ?? 0); words.push(`moved ${i.move_km} km on a bearing of ${i.move_bearing_deg ?? 0}°`); }
      if (words.length) host.updatePlace(p.name, G.roundCoords(f), `${words.join(", ")} (asked in chat)`);
      if (i.rename) { host.renamePlace(p.name, i.rename); words.push(`renamed to ${i.rename}`); }
      return { ...(await placeSummary(host.findPlace(i.rename || p.name))), changed: words.join(", ") || "nothing" };
    },

    async get_place({ place }) {
      const p = host.findPlace(place);
      if (!p) throw new Error(`No place called "${place}".`);
      const d = await R.describe(host.ref, p.feature);
      return {
        place: p.name, status: p.status, summary: R.summaryLine(d), ...pickD(d),
        how_made: p.origin?.method === "words" ? { words: p.origin.words, anchor: p.origin.anchor?.name || p.origin.anchor?.place, source: p.origin.anchor?.source?.title, steps: p.origin.steps, confidence: p.origin.confidence } : { method: "drawn on the map" },
        edits: (p.edits || []).map((e) => e.change),
      };
    },
  };

  const data = createDataTools({
    atlas: host.atlas || null,
    firms: host.firms || null,
    get trusted() { return host.trusted; },
    esriLicence: () => !!host.esriLicence?.(),
    resolve,
    area: (ref) => catalogueArea(ref, null),
    keep: (c) => keep(c),
    onCandidates: (list, meta) => { const l = list.map((c) => cands.get(c.id)); host.addFindings ? host.addFindings(l, meta) : host.onCandidates?.(l); },
    now: host.now,
  });
  run.find_data = (i) => data.find_data(i);
  run.show_on_map = async ({ ids, clear }) => {
    if (clear) { host.clearFindings?.(); return { cleared: true }; }
    const r = host.showFindings ? host.showFindings(ids) : { shown: 0 };
    return r.shown ? { ...r, note: "The map now shows these with the place in focus." } : { shown: 0, note: "Nothing to show: no findings with those ids are on the map." };
  };
  run.get_data = (i) => data.get_data(i);
  run.screen_site = async (i) => {
    if (!host.screening) return { not_available: "Screening isn't connected here." };
    const p = host.findPlace(i.place);
    if (!p) throw new Error(`No place called "${i.place}". Find or build the site first.`);
    return host.screening.screen(i, p);
  };
  run.get_run = async ({ run: id }) => {
    if (!host.screening) return { not_available: "Screening isn't connected here." };
    return host.screening.getRun(id);
  };

  return {
    candidates: cands,
    datasets: data.datasets,
    useDataset: data.keepDataset,
    async exec(name, input) {
      if (!run[name]) throw new Error(`Unknown tool ${name}`);
      return run[name](input || {});
    },
  };
}

const pickD = (d) => ({ scale: d.scale, area_km2: d.area_km2, length_km: d.length_km, extent_km: d.extent_km, countries: d.countries, offshore: d.offshore, coast_km: d.coast_km, centre: { lat: round(d.centroid[1], 4), lon: round(d.centroid[0], 4) } });

// One line per place for the conversation agent's project summary. Coordinates stay out.
export async function projectSummary(ref, places, focus, view = null) {
  const viewLine = view ? `Map view: about ${Math.round(R.viewKm(view))} km across (${R.scaleForKm(R.viewKm(view))} scale).` : "";
  if (!places.length) return ["No places yet.", viewLine].filter(Boolean).join("\n");
  const lines = [];
  for (const p of places) {
    const d = await R.describe(ref, p.feature);
    const how = p.origin?.method === "words" ? `from words "${p.origin.words}" (anchor: ${p.origin.anchor?.name || p.origin.anchor?.place}, ${p.origin.confidence} confidence)` : "drawn on the map";
    const edits = p.edits?.length ? `; edited: ${p.edits.slice(-3).map((e) => e.change).join("; ")}` : "";
    lines.push(`- ${p.name}${p.name === focus ? " [in focus]" : ""} (${p.status}): ${R.summaryLine(d)}; scale ${p.scale || d.scale}${p.scaleFrom && p.scaleFrom !== "size" ? ` (from ${p.scaleFrom === "you" ? "the person" : p.scaleFrom})` : ""}; ${how}${edits}`);
  }
  if (viewLine) lines.push(viewLine);
  return lines.join("\n");
}
