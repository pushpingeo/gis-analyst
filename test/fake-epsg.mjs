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
export const calls = [];
TF[5339].Supersessions = [{ SupersededBy: { Code: 7710, Name: "OSGB36 to WGS 84 (9)" }, Year: 2016 }];
export function fakeEpsg(tfs = TF) {
  return async ({ path, query }) => {
    calls.push(path);
    let m;
    if ((m = path.match(/^CoordRefSystem\/(\d+)$/))) { if (!CRS[m[1]]) throw new Error("EPSG answered 404 (no such record)."); return { Code: +m[1], ...CRS[m[1]] }; }
    if (path === "ProjectedCoordRefSystem/27700") return { BaseCoordRefSystem: { Code: 4277, Name: "OSGB36" }, Projection: { Name: "British National Grid" } };
    if ((m = path.match(/^GeodeticCoordRefSystem\/(\d+)$/))) return +m[1] === 4326 ? { DatumEnsemble: { Code: 6326, Name: "World Geodetic System 1984 ensemble" } } : { Datum: { Code: 6277, Name: "Ordnance Survey of Great Britain 1936" } };
    if (path === "CoordRefSystem") return { Results: [{ Code: 4230, Name: "ED50", Type: "geographic 2D", Area: "Europe", Deprecated: false }] };
    if (path === "Transformation/crs") {
      const pair = [query.sourceCRSCode, query.targetCRSCode].sort().join();
      if (pair === "4277,4326")
        return { Results: [...Object.values(tfs).map((x) => ({ Code: x.Code, Name: x.Name, Deprecated: false })), { Code: 1195, Name: "OSGB36 to WGS 84 (1)", Deprecated: true }] };
      return { Results: [] };
    }
    if ((m = path.match(/^Transformation\/(\d+)$/))) return tfs[m[1]];
    if ((m = path.match(/^Extent\/(\d+)\/polygon$/))) return JSON.stringify(POLYS[m[1]] || rect(-180, -90, 180, 90));
    if ((m = path.match(/^Extent\/(\d+)$/))) return { Code: +m[1], ...EXTENTS[m[1]] };
    throw new Error(`unexpected ${path}`);
  };
}
