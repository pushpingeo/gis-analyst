// Tools the conversation agent uses to find places and build areas from words.
// The model works with ids (C3 for a found candidate, "Area 1" for a place); geometry stays here.
// A host object supplies the project's places and reference data, so the same code runs in the page and in the evaluation.
import * as turf from "./vendor/turf.js";
import * as G from "./geometry.js";
import * as R from "./reference.js";
import { rateConfidence, runCheck, MATCHES } from "./confidence.js";
import { searchAnchors, searchNominatim, searchNaturalEarth, searchWikidata, findFeaturesNear, featureOutline, FEATURE_TYPES } from "./gazetteer.js";

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
      description: "Search for a named place, asset or feature: authoritative named-feature layers from the atlas (NSTA offshore installations, fields and licensing blocks; The Crown Estate and Crown Estate Scotland offshore wind farm lease areas), OpenStreetMap (Nominatim), Wikidata (good for named mines, dams, power plants and ports) and Natural Earth towns. Returns candidates with ids (C1, C2…), type, source, position and size. Give a block reference like 30/2 to find a UK licensing block.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The name to search for, e.g. 'Jackdaw', 'Mocuba', '30/2', 'Lake Turkana'" },
          near: { type: "string", description: "Optional: a candidate id or place name to search near" },
          country: { type: "string", description: "Optional ISO 3166 two-letter country code to restrict OpenStreetMap results" },
        },
        required: ["query"],
      },
    },
    {
      name: "find_features_near",
      description: `Find OpenStreetMap features of a type within a radius of an anchor (a candidate or a place), with distance and bearing from it. Assets come largest first, everything else nearest first. Use it for "schools near X" or "hospitals within 5 km of Area 1", and to find an asset once a town anchors the search. One call does the whole search: don't search by name for kinds of things. Types: ${Object.keys(FEATURE_TYPES).join(", ")}.`,
      input_schema: {
        type: "object",
        properties: {
          anchor: { type: "string", description: "Candidate id (e.g. C2) or place name (e.g. Area 1)" },
          feature_type: { type: "string", enum: Object.keys(FEATURE_TYPES) },
          radius_km: { type: "number", description: "Search radius, 0.5 to 50 km" },
          name: { type: "string", description: "Optional: part of the feature's name" },
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
          also: { type: "array", items: { type: "string" }, description: "With shape 'feature': more candidate ids whose outlines are joined with the anchor's, e.g. the A, B and C parts of one wind farm" },
          shape: { type: "string", enum: ["point", "square", "circle", "rectangle", "feature", "buffer"] },
          area_km2: { type: "number" }, side_km: { type: "number" }, radius_km: { type: "number" },
          width_km: { type: "number", description: "East–west size before rotation" }, height_km: { type: "number", description: "North–south size before rotation" },
          buffer_km: { type: "number" }, rotation_deg: { type: "number" },
          offset_km: { type: "number" }, bearing_deg: { type: "number", description: "Degrees clockwise from north for the offset" },
          words: { type: "string", description: "The person's own words that this place answers" },
          match: { type: "string", enum: MATCHES, description: "How the anchor relates to what the person wants. named_place: they asked for this place itself (a palace, a town, a block, a field). name_and_type: the asset itself, matched by name and of the right type (a mine for a mine). type_near_clues: a feature of the right type found where the clues point, its name not confirmed. name_only: the name matches but the type is wrong or unknown. settlement_or_region: a town, village or region stands in for the site. none: nothing specific." },
          checks: { type: "array", description: "Every distance clue in the request that the place can be checked against, e.g. 'Nok Kundi lies about 80 km south-east of the mine' → { against: <Nok Kundi's candidate id>, expected_km: 80, direction: 'SE' }. Direction is the way you travel FROM the site TO that feature. Give all you have; they are measured, not trusted.", items: { type: "object", properties: { against: { type: "string", description: "Candidate id" }, expected_km: { type: "number" }, direction: { type: "string", description: "Compass point from the site to it: N, NE, ENE… (optional)" } }, required: ["against", "expected_km"] } },
          reason: { type: "string", description: "One line: the evidence for the location" },
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
    ...(Object.keys(c.extra || {}).length ? { details: c.extra } : {}),
  });

  async function placeSummary(p) {
    const d = await R.describe(host.ref, p.feature);
    return { place: p.name, status: p.status, summary: R.summaryLine(d), scale: d.scale, area_km2: d.area_km2, length_km: d.length_km, countries: d.countries, offshore: d.offshore };
  }

  const run = {
    async load_skill({ name }) {
      return { skill: name, method: host.skillText(name) };
    },

    async find_place({ query, near, country }) {
      const nearAt = near ? resolve(near).lonlat : null;
      const results = [];
      const errors = [];
      const anchors = await searchAnchors(host.anchors, query, { near: nearAt, fetchFn: host.fetchFn });
      for (const a of anchors) (a.error ? errors.push(a.error) : results.push(a));
      try { results.push(...(await searchNominatim(query, { near: nearAt, country, fetchFn: host.fetchFn, headers: host.headers }))); }
      catch (e) { errors.push(`OpenStreetMap search: ${e.message}`); }
      try { results.push(...(await searchWikidata(query, { fetchFn: host.fetchFn, headers: host.headers }))); }
      catch (e) { errors.push(`Wikidata search: ${e.message}`); }
      try { results.push(...searchNaturalEarth(await host.ref.get("places"), query)); } catch { /* reference not loaded */ }
      const list = results.map((c) => {
        if (nearAt) { c.distance_km = round(turf.distance(nearAt, c.lonlat), 1); c.bearing = Math.round((turf.bearing(nearAt, c.lonlat) + 360) % 360); }
        return cands.get(keep(c));
      });
      host.onCandidates?.(list);
      return { query, candidates: list.slice(0, 12).map(compact), ...(errors.length ? { problems: errors } : {}),
        note: list.length ? undefined : "Nothing found. Try another spelling, a shorter name, or the nearest town and find_features_near." };
    },

    async find_features_near({ anchor, feature_type, radius_km, name }) {
      const a = resolve(anchor);
      const r = await findFeaturesNear(a.lonlat, feature_type, radius_km, { name, fetchFn: host.fetchFn, headers: host.headers });
      const list = r.candidates.map((c) => cands.get(keep(c)));
      host.onCandidates?.(list);
      return { anchor: a.label, feature_type, radius_km, found: r.total, wind_turbines: r.wind_turbines, ...(r.note ? { note: r.note } : {}), candidates: list.map(compact) };
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
          f = JSON.parse(JSON.stringify(a.feature));
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
          steps.push(`${i.buffer_km} km buffer around ${a.label}`); break;
        default: throw new Error(`Unknown shape ${i.shape}.`);
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
      const rated = rateConfidence({ cand: a.cand, match: i.match, checks: checks.filter((c) => c.pass !== null), offset: !!i.offset_km, shape: i.shape });
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

  return {
    candidates: cands,
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
