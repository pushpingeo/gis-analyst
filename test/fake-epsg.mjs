// A small EPSG registry shaped like apps.epsg.org/api/v1 (real codes and accuracies, simplified areas), for tests.
export const box = (w, s, e, n) => ({ BoundingBoxWestBoundLongitude: w, BoundingBoxSouthBoundLatitude: s, BoundingBoxEastBoundLongitude: e, BoundingBoxNorthBoundLatitude: n });
export const rect = (w, s, e, n) => ({ type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
// Scotland and England boxes overlap along the border (as in EPSG); their outlines don't.
const EXTENTS = {
  4390: { Name: "UK - Britain and UKCS", Description: "Britain onshore and offshore", ...box(-9, 49.75, 2.01, 61.01) },
  2395: { Name: "UK - England and Wales", Description: "England and Wales onshore", ...box(-6.5, 49.81, 1.84, 55.85) },
  2397: { Name: "UK - Scotland", Description: "Scotland onshore", ...box(-8.2, 54.6, -0.7, 60.9) },
  1264: { Name: "UK - Great Britain", Description: "GB onshore", ...box(-6.5, 49.75, 1.84, 60.9) },
};
const POLYS = { 2395: rect(-6.5, 49.81, 1.84, 55.6), 2397: rect(-8.2, 55.6, -0.7, 60.9) };
const tf = (Code, Name, Accuracy, ext, { method = 9606, grid = false } = {}) => ({
  Code, Name, Accuracy, Method: { Code: method, Name: method === 9615 ? "NTv2" : "Position Vector transformation" },
  SourceCrs: { Code: 4277 }, TargetCrs: { Code: 4326 },
  Usage: [{ Extent: { Code: ext }, Scope: { Name: "Oil and gas exploration." } }],
  ParameterValues: grid ? [{ ParamValueFileRef: "OSTN15_NTv2_OSGBtoETRS.gsb" }] : [{ ParameterValue: 446.448, ParamValueFileRef: null }],
});
export const TF = {
  1314: tf(1314, "OSGB36 to WGS 84 (6)", 2, 4390),
  1196: tf(1196, "OSGB36 to WGS 84 (2)", 10, 2395, { method: 9603 }),
  1198: tf(1198, "OSGB36 to WGS 84 (4)", 18, 2397, { method: 9603 }),
  5339: tf(5339, "OSGB36 to WGS 84 (7)", 1, 1264, { method: 9615, grid: true }),
  1197: tf(1197, "OSGB36 to WGS 84 (3)", 21, 2397, { method: 9603 }),
  7710: tf(7710, "OSGB36 to WGS 84 (9)", 1, 4390, { method: 9615, grid: true }),
};
const CRS = {
  27700: { Kind: "projected", Name: "OSGB36 / British National Grid" },
  4277: { Kind: "geographic 2D", Name: "OSGB36", Usage: [{ Extent: { Code: 1264 } }], CoordSys: { Name: "Ellipsoidal 2D CS. Axes: latitude, longitude." } },
  4326: { Kind: "geographic 2D", Name: "WGS 84", Usage: [{ Extent: { Code: 4390 } }] },
  4230: { Kind: "geographic 2D", Name: "ED50", Usage: [{ Extent: { Code: 4390 } }] },
  4258: { Kind: "geographic 2D", Name: "ETRS89", Deprecations: [] },
  4135: { Kind: "geographic 2D", Name: "Old Hawaiian", Deprecations: [{ Reason: "test", Replacement: { Code: 4136, Name: "New" } }] },
};
// Full records for the transform tool (parameters as EPSG publishes them; real ellipsoids).
const pv = (vals, units = [9001, 9001, 9001, 9104, 9104, 9104, 9202]) => vals.map((v, i) => ({ ParameterCode: 8605 + i, Name: ["X-axis translation", "Y-axis translation", "Z-axis translation", "X-axis rotation", "Y-axis rotation", "Z-axis rotation", "Scale difference"][i], ParameterValue: v, ParamValueFileRef: null, Unit: { Code: units[i], Name: String(units[i]) }, SignReversible: true }));
TF[1314].ParameterValues = pv([446.448, -125.157, 542.06, 0.15, 0.247, 0.842, -20.489]);
TF[1314].Method = { Code: 9606, Name: "Position Vector transformation (geog2D domain)" };
export const TFX = {
  1311: { Code: 1311, Name: "ED50 to WGS 84 (18)", Accuracy: 1, CoordTfmVersion: "UKOOA-CO", Method: { Code: 9606, Name: "Position Vector transformation (geog2D domain)" },
    SourceCrs: { Code: 4230, Name: "ED50" }, TargetCrs: { Code: 4326, Name: "WGS 84" }, Usage: [{ Extent: { Code: 2342, Name: "Europe - common offshore" } }],
    ParameterValues: pv([-89.5, -93.8, -123.1, 0, 0, -0.156, 1.2]) },
  15929: { Code: 15929, Name: "BD72 to WGS 84 (3)", Accuracy: 1, Method: { Code: 9607, Name: "Coordinate Frame rotation (geog2D domain)" },
    SourceCrs: { Code: 4313, Name: "BD72" }, TargetCrs: { Code: 4326, Name: "WGS 84" }, Usage: [{ Extent: { Code: 1347, Name: "Belgium - onshore" } }],
    // rotations given in milliarc-seconds here, to test unit conversion through the Unit records
    ParameterValues: pv([-106.8686, 52.2978, -103.7239, -336.6, 457, -1842.2, -1.2747], [9001, 9001, 9001, 1031, 1031, 1031, 9202]) },
  1613: { Code: 1613, Name: "ED50 to WGS 84 (24)", Accuracy: 1, Method: { Code: 9615, Name: "NTv2" }, SourceCrs: { Code: 4230 }, TargetCrs: { Code: 4326 },
    Usage: [{ Extent: { Code: 2342 } }], ParameterValues: [{ ParameterCode: 8656, ParamValueFileRef: "ed50.gsb" }] },
};
const GCRS = { 4277: 6277, 4230: 6230, 4313: 6313, 4326: 6326, 4807: 6807 };
const DATUM_NAMES = { 6277: "Ordnance Survey of Great Britain 1936", 6230: "European Datum 1950", 6313: "Reseau National Belge 1972", 6326: "World Geodetic System 1984 ensemble" };
const DATUMS = { 6277: [7001, 8901], 6230: [7022, 8901], 6313: [7022, 8901], 6326: [7030, 8901], 6807: [7011, 8903] };
const ELLS = { 7001: { Name: "Airy 1830", SemiMajorAxis: 6377563.396, InverseFlattening: 299.3249646, SemiMinorAxis: "NaN" },
  7022: { Name: "International 1924", SemiMajorAxis: 6378388, InverseFlattening: 297 }, 7030: { Name: "WGS 84", SemiMajorAxis: 6378137, InverseFlattening: 298.257223563 },
  7011: { Name: "Clarke 1880 (IGN)", SemiMajorAxis: 6378249.2, SemiMinorAxis: 6356515, InverseFlattening: "NaN" } };
const UNITS = { 9001: { Type: "length", FactorB: 1, FactorC: 1 }, 9104: { Type: "angle", FactorB: 3.14159265358979, FactorC: 648000 },
  1031: { Type: "angle", FactorB: 3.14159265358979, FactorC: 648000000 }, 9202: { Type: "scale", FactorB: 1, FactorC: 1000000 } };
EXTENTS[2342] = { Name: "Europe - common offshore", ...box(-16.1, 25.71, 32.88, 84.73) };
EXTENTS[1347] = { Name: "Belgium - onshore", ...box(2.5, 49.5, 6.4, 51.51) };
export const calls = [];
TF[5339].Supersessions = [{ SupersededBy: { Code: 7710, Name: "OSGB36 to WGS 84 (9)" }, Year: 2016 }];
export function fakeEpsg(tfs = TF) {
  return async ({ path, query }) => {
    calls.push(path);
    let m;
    if ((m = path.match(/^CoordRefSystem\/(\d+)$/))) { if (!CRS[m[1]]) throw new Error("EPSG answered 404 (no such record)."); return { Code: +m[1], ...CRS[m[1]] }; }
    if (path === "ProjectedCoordRefSystem/27700") return { BaseCoordRefSystem: { Code: 4277, Name: "OSGB36" }, Projection: { Name: "British National Grid" } };
    if ((m = path.match(/^GeodeticCoordRefSystem\/(\d+)$/))) return +m[1] === 4326 ? { Datum: { Code: 6326, Name: "World Geodetic System 1984 ensemble" } } : { Datum: { Code: GCRS[m[1]] || 6277, Name: DATUM_NAMES[GCRS[m[1]] || 6277] || `Datum ${GCRS[m[1]]}` } };
    if ((m = path.match(/^Datum\/(\d+)$/))) { const d = DATUMS[m[1]]; if (!d) throw new Error("EPSG answered 404 (no such record)."); return { Code: +m[1], Name: DATUM_NAMES[m[1]] || `Datum ${m[1]}`, Ellipsoid: { Code: d[0], Name: ELLS[d[0]].Name }, PrimeMeridian: { Code: d[1] } }; }
    if ((m = path.match(/^Ellipsoid\/(\d+)$/))) return { Code: +m[1], ...ELLS[m[1]], Unit: { Code: 9001, Name: "metre" } };
    if ((m = path.match(/^PrimeMeridian\/(\d+)$/))) return +m[1] === 8903 ? { Name: "Paris", GreenwichLongitude: 2.5969213, Unit: { Code: 9105 } } : { Name: "Greenwich", GreenwichLongitude: 0 };
    if ((m = path.match(/^Unit\/(\d+)$/))) { if (!UNITS[m[1]]) throw new Error("EPSG answered 404 (no such record)."); return { Code: +m[1], ...UNITS[m[1]] }; }
    if (path === "VersionHistory") return query.page ? { Results: [{ Code: 446, Name: "13.106", RevisionDate: "2026-10-15T00:00:00" }], TotalResults: 401 } : { Results: [{ Code: 1, Name: "1.0" }], TotalResults: 401 };
    if (path === "CoordRefSystem") return { Results: [{ Code: 4230, Name: "ED50", Type: "geographic 2D", Area: "Europe", Deprecated: false }] };
    if (path === "Transformation/crs") {
      const pair = [query.sourceCRSCode, query.targetCRSCode].sort().join();
      if (pair === "4277,4326")
        return { Results: [...Object.values(tfs).map((x) => ({ Code: x.Code, Name: x.Name, Deprecated: false })), { Code: 1195, Name: "OSGB36 to WGS 84 (1)", Deprecated: true }] };
      return { Results: [] };
    }
    if ((m = path.match(/^Transformation\/(\d+)$/))) { const r = tfs[m[1]] || TFX[m[1]]; if (!r) throw new Error("EPSG answered 404 (no such record)."); return r; }
    if ((m = path.match(/^Extent\/(\d+)\/polygon$/))) return JSON.stringify(POLYS[m[1]] || rect(-180, -90, 180, 90));
    if ((m = path.match(/^Extent\/(\d+)$/))) return { Code: +m[1], ...EXTENTS[m[1]] };
    throw new Error(`unexpected ${path}`);
  };
}
