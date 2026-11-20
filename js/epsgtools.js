// Coordinate reference tools, read from the EPSG Geodetic Parameter Dataset (IOGP) through the Worker's /epsg route.
// The method is in skills/coordinate-reference/SKILL.md; these tools do the lookups and the choosing in code, so the
// analyst never picks a transformation from memory. EPSG is evergreen: nothing here is a copied table.
//
// host.epsg({ path, query }) → parsed JSON (or text for exports). host.transformationChoice() → "choose" | "ask".
// locate(ref) → [lon, lat] for a candidate id, place name or "lon,lat".

export const ASK_ABOVE_M = 25; // "choose for me" still asks when the best option is worse than this (skill, section 4)
const APPLY_IN_PAGE = new Set([9603, 9606, 9607, 1031, 1032, 1033, 9604, 9605]); // translations, Helmert, Molodensky
const MAX_CANDIDATES = 40;
const MAX_POLYGONS = 6;

export const EPSG_TOOL_DEFS = [
  {
    name: "crs_lookup",
    description: "Look up a coordinate reference system in the EPSG registry: by code (e.g. 27700, 'EPSG:4230') or by words (e.g. 'ED50 UTM 31', 'Nigeria Minna'). Returns its name, kind (geographic, projected…), base geographic CRS and datum, axes and units, area of use with its bounding box, and whether it's deprecated (and what replaces it). Use it before trusting a CRS you were told or guessed. Load the coordinate-reference skill first.",
    input_schema: {
      type: "object",
      properties: {
        code: { type: "string", description: "An EPSG code, e.g. '27700' or 'EPSG:23031'" },
        search: { type: "string", description: "Words to search for when there's no code, e.g. 'ED50 UTM zone 31'" },
      },
    },
  },
  {
    name: "transformation_options",
    description: "Which datum transformation to use between two CRSs at a given place, from the EPSG registry, chosen in code. Keeps only transformations whose area of use contains the place (its outline, not just its name), drops deprecated ones, and ranks by stated accuracy, then by smaller area. Returns the options, the recommended one, whether it can be applied here, and, depending on the person's setting, either the one chosen for them or a note that they want to be asked. Projected CRSs are resolved to their base geographic CRS. Load the coordinate-reference skill first and follow its section 4.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", description: "EPSG code of the CRS the data is in, e.g. '27700' or '4230'" },
        target: { type: "string", description: "EPSG code to change to; usually '4326' (WGS 84)" },
        at: { type: "string", description: "Where: a candidate id, a place name, or coordinates (read like typed coordinates)" },
      },
      required: ["source", "at"],
    },
  },
];

const codeOf = (v) => {
  const m = String(v ?? "").trim().match(/^(?:epsg\s*:\s*)?(\d{3,6})$/i);
  return m ? +m[1] : null;
};

// Ray casting on a GeoJSON Polygon or MultiPolygon in degrees; holes respected. Good enough for "is the site inside".
export function pointInGeoJSON([x, y], g) {
  const inRing = (ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const inPoly = (rings) => inRing(rings[0]) && !rings.slice(1).some(inRing);
  if (g?.type === "Polygon") return inPoly(g.coordinates);
  if (g?.type === "MultiPolygon") return g.coordinates.some(inPoly);
  if (g?.type === "GeometryCollection") return g.geometries.some((part) => pointInGeoJSON([x, y], part));
  return false;
}

// Bounding boxes in EPSG can cross the antimeridian (west > east).
export function inBox([lon, lat], e) {
  const s = e.BoundingBoxSouthBoundLatitude, n = e.BoundingBoxNorthBoundLatitude;
  const w = e.BoundingBoxWestBoundLongitude, ea = e.BoundingBoxEastBoundLongitude;
  if ([s, n, w, ea].some((v) => typeof v !== "number")) return false;
  if (lat < s || lat > n) return false;
  return w <= ea ? lon >= w && lon <= ea : lon >= w || lon <= ea;
}
const boxArea = (e) => {
  const w = e.BoundingBoxWestBoundLongitude, ea = e.BoundingBoxEastBoundLongitude;
  return ((w <= ea ? ea - w : 360 - w + ea) * (e.BoundingBoxNorthBoundLatitude - e.BoundingBoxSouthBoundLatitude)) || Infinity;
};
const boxOf = (e) => [e.BoundingBoxWestBoundLongitude, e.BoundingBoxSouthBoundLatitude, e.BoundingBoxEastBoundLongitude, e.BoundingBoxNorthBoundLatitude];

// Rank: contains the place, then best stated accuracy (unknown last), then the smaller area, then the higher code
// (newer records). Exported for tests.
export function rankOptions(opts) {
  return [...opts].sort((a, b) =>
    (b.contains === true) - (a.contains === true)
    || (a.accuracy_m ?? Infinity) - (b.accuracy_m ?? Infinity)
    || (a._area ?? Infinity) - (b._area ?? Infinity)
    || b.code - a.code);
}

// What to do with the ranked options, given the setting. Exported for tests.
export function decide(ranked, setting) {
  const usable = ranked.filter((o) => o.contains === true);
  const best = usable.find((o) => o.can_apply) || null;
  const top = usable[0] || null;
  const out = { recommended: top?.code ?? null, setting };
  if (!top) return { ...out, chosen: null, ask: true, why: "No transformation in the registry covers this place. Say so; don't apply one from elsewhere." };
  if (setting === "ask") return { ...out, chosen: null, ask: true, why: "The person asked to choose transformations themselves: offer the options, recommended first, with their accuracy and area." };
  if (!best) return { ...out, chosen: null, ask: true, why: `The best option (${top.name}) needs a grid file this page can't apply. Say so and ask before falling back to a less accurate one.` };
  if (best.accuracy_m == null || best.accuracy_m > ASK_ABOVE_M) return { ...out, chosen: null, ask: true, why: `The best option that can be applied here is only ${best.accuracy_m == null ? "of unknown accuracy" : `good to about ${best.accuracy_m} m`}, worse than the ${ASK_ABOVE_M} m accepted without asking. Ask.` };
  const note = best.code !== top.code ? ` (${top.name}, ${top.accuracy_m ?? "?"} m, is better but needs a grid file this page can't apply)` : "";
  return { ...out, chosen: best.code, ask: false, why: `Chosen for the person, as their setting allows: ${best.name}, good to about ${best.accuracy_m} m here${note}. Record it and the accuracy accepted.` };
}

export function createEpsgTools(host, locate) {
  const epsg = host.epsg;
  const missing = { not_checked: "The EPSG registry isn't connected here." };
  const get = (path, query) => epsg({ path, query });

  // A few calls at a time: the Worker caches, but EPSG is a shared public service.
  async function mapLimited(items, n, fn) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch((e) => ({ _error: String(e.message || e) })); }
    }));
    return out;
  }

  async function describeCrs(code) {
    const c = await get(`CoordRefSystem/${code}`);
    const kind = c.Kind || "";
    let base = null, datum = null, projection = null;
    if (kind === "projected") {
      const p = await get(`ProjectedCoordRefSystem/${code}`);
      base = p.BaseCoordRefSystem ? { code: p.BaseCoordRefSystem.Code, name: p.BaseCoordRefSystem.Name } : null;
      projection = p.Projection?.Name || null;
    }
    const geoCode = base?.code ?? (/^geo/.test(kind) ? code : null);
    if (geoCode) {
      const gcrs = await get(`GeodeticCoordRefSystem/${geoCode}`).catch(() => null);
      const d = gcrs?.Datum || gcrs?.DatumEnsemble;
      if (d) datum = { code: d.Code, name: d.Name, ensemble: !gcrs.Datum && !!gcrs.DatumEnsemble };
    }
    const ext = c.Usage?.[0]?.Extent;
    const area = ext ? await get(`Extent/${ext.Code}`).catch(() => null) : null;
    const dep = c.Deprecations?.[0];
    return {
      code, name: c.Name, kind, base, projection, datum,
      axes: c.CoordSys?.Name || null,
      area_of_use: area ? { code: ext.Code, name: area.Name, description: area.Description, bbox: boxOf(area) } : (ext ? { code: ext.Code, name: ext.Name } : null),
      deprecated: !!dep,
      ...(dep ? { replaced_by: dep.Replacement ? { code: dep.Replacement.Code, name: dep.Replacement.Name } : null, deprecation_reason: dep.Reason || null } : {}),
      source: `EPSG:${code}, EPSG Geodetic Parameter Dataset (IOGP)`,
    };
  }

  return {
    async crs_lookup({ code, search }) {
      if (!epsg) return missing;
      const c = codeOf(code);
      if (c) {
        try { return await describeCrs(c); }
        catch (e) { return { error: `EPSG:${c}: ${e.message}`, hint: /404|no such/i.test(e.message) ? "No such code in EPSG. Check it, or search by words." : undefined }; }
      }
      const words = String(search || code || "").trim();
      if (!words) return { error: "Give a code or some words to search for." };
      const j = await get("CoordRefSystem", { keywords: words, pageSize: 12 });
      return {
        query: words,
        results: (j.Results || []).map((r) => ({ code: r.Code, name: r.Name, kind: r.Type, area: r.Area, deprecated: !!r.Deprecated })),
        note: "Pick by area of use and kind, not name alone; prefer ones that aren't deprecated. Look one up by code for its details.",
      };
    },

    async transformation_options({ source, target = "4326", at }) {
      if (!epsg) return missing;
      let src = codeOf(source), tgt = codeOf(target);
      if (!src || !tgt) return { error: "source and target must be EPSG codes. Use crs_lookup to find one by name." };
      let lonlat;
      try { lonlat = locate(at); } catch (e) { return { error: e.message }; }
      if (!lonlat) return { error: `Couldn't place "${at}".` };

      // Transformations are between geographic CRSs: a projected CRS goes through its base.
      const resolved = {};
      for (const [k, c] of [["source", src], ["target", tgt]]) {
        const r = await get(`CoordRefSystem/${c}`);
        if (r.Kind === "projected") {
          const p = await get(`ProjectedCoordRefSystem/${c}`);
          resolved[k] = { given: c, given_name: r.Name, base: p.BaseCoordRefSystem.Code, base_name: p.BaseCoordRefSystem.Name };
        } else resolved[k] = { given: c, given_name: r.Name, base: c, base_name: r.Name };
      }
      src = resolved.source.base; tgt = resolved.target.base;
      if (src === tgt) return { source: resolved.source, target: resolved.target, same_base: true, note: "Same geographic CRS: only a conversion (projection) is needed, no datum transformation and no loss of accuracy." };

      // EPSG stores each transformation one way round; most are reversible, so look both ways.
      const [fwd, rev] = await Promise.all([
        get("Transformation/crs", { sourceCRSCode: src, targetCRSCode: tgt }).catch(() => ({ Results: [] })),
        get("Transformation/crs", { sourceCRSCode: tgt, targetCRSCode: src }).catch(() => ({ Results: [] })),
      ]);
      const listed = [...(fwd.Results || []).map((r) => ({ ...r, reversed: false })), ...(rev.Results || []).map((r) => ({ ...r, reversed: true }))];
      const live = listed.filter((r) => !r.Deprecated);
      const dropped = listed.length - live.length;
      if (!live.length) return { source: resolved.source, target: resolved.target, at: lonlat, options: [], ...decide([], host.transformationChoice?.() || "choose"), deprecated_dropped: dropped };

      const details = await mapLimited(live.slice(0, MAX_CANDIDATES), 6, (r) => get(`Transformation/${r.Code}`));
      const extentCodes = [...new Set(details.flatMap((d) => (d.Usage || []).map((u) => u.Extent?.Code)).filter(Boolean))];
      const extents = Object.fromEntries((await mapLimited(extentCodes, 6, (c) => get(`Extent/${c}`))).map((e, i) => [extentCodes[i], e]));

      let opts = details.map((d, i) => {
        if (d._error) return null;
        const usages = (d.Usage || []).map((u) => ({ code: u.Extent?.Code, scope: u.Scope?.Name, e: extents[u.Extent?.Code] })).filter((u) => u.e && !u.e._error);
        const hit = usages.filter((u) => inBox(lonlat, u.e));
        const grid = (d.ParameterValues || []).some((p) => p.ParamValueFileRef);
        const u = hit[0] || usages[0];
        return {
          code: d.Code, name: d.Name, accuracy_m: typeof d.Accuracy === "number" ? d.Accuracy : null,
          method: d.Method?.Name, method_code: d.Method?.Code,
          can_apply: !grid && APPLY_IN_PAGE.has(d.Method?.Code),
          ...(grid ? { grid_file: (d.ParameterValues || []).find((p) => p.ParamValueFileRef)?.ParamValueFileRef } : {}),
          reversed: live[i].reversed,
          area: u ? u.e.Name : null, area_description: u ? u.e.Description : null, area_bbox: u ? boxOf(u.e) : null,
          scope: u?.scope || null,
          contains: hit.length ? "box" : false,
          _area: hit.length ? Math.min(...hit.map((h) => boxArea(h.e))) : Infinity,
          _hits: hit.map((h) => h.code),
          remark: (d.Remark || "").slice(0, 240) || null,
        };
      }).filter(Boolean);

      // Boxes overlap (Scotland's box reaches into England): settle with the outlines when it matters.
      const inBoxes = opts.filter((o) => o.contains === "box");
      const needPoly = inBoxes.length > 1 ? [...new Set(inBoxes.flatMap((o) => o._hits))] : [];
      const polys = {};
      if (needPoly.length) {
        const got = await mapLimited(needPoly.slice(0, MAX_POLYGONS), 3, (c) => get(`Extent/${c}/polygon`));
        needPoly.slice(0, MAX_POLYGONS).forEach((c, i) => { polys[c] = got[i]; });
      }
      let outlineChecked = 0;
      opts = opts.map((o) => {
        if (o.contains !== "box") return o;
        if (inBoxes.length === 1) return { ...o, contains: true, checked_by: "bounding box (the only candidate)" };
        const checked = o._hits.filter((c) => polys[c] && !polys[c]._error);
        if (!checked.length) return { ...o, contains: true, checked_by: "bounding box only (outline not fetched)" };
        outlineChecked++;
        const inside = checked.some((c) => pointInGeoJSON(lonlat, typeof polys[c] === "string" ? JSON.parse(polys[c]) : polys[c]));
        return { ...o, contains: inside, checked_by: "area-of-use outline" };
      });

      const ranked = rankOptions(opts);
      const setting = host.transformationChoice?.() || "choose";
      const verdict = decide(ranked, setting);
      const covering = ranked.filter((o) => o.contains === true);
      const clean = (o) => { const { _area, _hits, ...rest } = o; return rest; };
      return {
        source: resolved.source, target: resolved.target, at: lonlat,
        options: covering.slice(0, 8).map(clean),
        not_covering: ranked.filter((o) => o.contains !== true).map((o) => `${o.name} (${o.area || "?"})`).slice(0, 12),
        ...verdict,
        listed: listed.length, deprecated_dropped: dropped, ...(live.length > MAX_CANDIDATES ? { only_first: MAX_CANDIDATES } : {}),
        outlines_checked: outlineChecked,
        ...(tgt === 4326 ? { wgs84_note: "WGS 84 (EPSG:4326) is a datum ensemble good to about 2 m; for screening that's below notice." } : {}),
        source_note: "EPSG Geodetic Parameter Dataset (IOGP), apps.epsg.org, read live. Cite the transformation code and accuracy in the run record.",
      };
    },
  };
}
