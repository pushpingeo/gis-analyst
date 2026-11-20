// Checks Tobler's datum transformations against the IOGP GIGS Test Dataset (github.com/IOGP-GIGS/GIGSTestDataset):
// test 5203 (Position Vector, OSGB36 → WGS 84, as EPSG:1314) and 5204 (Coordinate Frame, BD72 → WGS 84, as
// EPSG:15929), forward, reverse and round trip, 2D and 3D.
//
// The GIGS files are test data only and are NOT in this repo (GIGS licence): pass the path of a local clone, or let
// the "GIGS check" Action clone it. Nothing from them is written back. GIGS Test Dataset © IOGP, used under its licence.
//
//   node scripts/gigs-check.mjs <GIGSTestDataset path>          parameters from GIGS's own user-defined objects (3208)
//   node scripts/gigs-check.mjs <GIGSTestDataset path> --live   the transform tool itself, reading the EPSG registry
//                                                              (apps.epsg.org, or EPSG_PROXY=<Worker /epsg URL>)
//
// Tolerances are GIGS's own, from each output file's header. Longitude differences are scaled by cos(latitude) so
// the geographic tolerance (0.0000003°, about 3 cm) means the same distance everywhere: unscaled it would ask for
// millimetres at ±80°, finer than GIGS prints its own values (PROJ 9 misses it there too).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ellipsoid, applyTransformation, readParameters, ellipsoidFromRecord, unitCodes } from "../js/transform.js";
import { createEpsgTools } from "../js/epsgtools.js";

const root = process.argv[2];
if (!root) { console.error("Usage: node scripts/gigs-check.mjs <GIGSTestDataset path> [--live]"); process.exit(2); }
const LIVE = process.argv.includes("--live");

const files = join(root, "GIGSTestDatasetFiles");
const find = (dir, re) => { const d = readdirSync(files).find((x) => x.startsWith(dir)); const a = join(files, d, "ASCII"); return join(a, readdirSync(a).find((f) => re.test(f))); };
const lines = (path) => readFileSync(path, "utf8").split(/\r?\n/);
const rows = (path) => lines(path).filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.split("\t").map((s) => s.trim()));
const tol = (path) => {
  const h = lines(path).filter((l) => l.startsWith("#")).join("\n");
  const n = (re) => +h.match(re)?.[1];
  return { cart: n(/# Cartesian Tolerance: ([\d.]+)/), geog: n(/# Geographic Tolerance: ([\d.]+)/), rtCart: n(/Round Trip Cartesian Tolerance: ([\d.]+)/), rtGeog: n(/Round Trip Geographic Tolerance: ([\d.]+)/) };
};

// The registry, for --live: straight to EPSG (GitHub's runners can reach it) or through Tobler's Worker.
const epsg = async ({ path, query = {} }) => {
  const q = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
  const r = process.env.EPSG_PROXY
    ? await fetch(process.env.EPSG_PROXY, { method: "POST", headers: { "content-type": "application/json", origin: "https://asktobler.com" }, body: JSON.stringify({ path, query }) })
    : await fetch(`https://apps.epsg.org/api/v1/${path}/${q.size ? `?${q}` : ""}`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`EPSG answered ${r.status} for ${path}`);
  return r.json();
};

// Offline: GIGS's user-defined transformation (3208) and the ellipsoids as EPSG defines them.
const PARAM_UNITS = { metre: 9001, "arc-second": 9104, "parts per million": 9202 };
function gigsParams(code) {
  const r = rows(find("GIGS 3200", /3208_CoordTfm/)).find((x) => x[0] === String(code));
  const starts = [8, ...Array.from({ length: 7 }, (_, k) => 12 + 3 * k)]; // parameter 1 has an extra column
  const vals = starts.filter((i) => r[i] && r[i] !== "NULL").map((i) => ({ Name: r[i], ParameterValue: +r[i + 1], Unit: { Code: PARAM_UNITS[r[i + 2]], Name: r[i + 2] } }));
  const tail = r.filter(Boolean).slice(-2);
  return { params: readParameters(vals), label: `GIGS ${r[0]} (= EPSG:${tail[0]} ${tail[1]}), parameters from GIGS 3208` };
}
const ELL = { 7001: { a: 6377563.396, invf: 299.3249646 }, 7022: { a: 6378388, invf: 297 }, 7030: { a: 6378137, invf: 298.257223563 } };

async function liveSetup(op) {
  const rec = await epsg({ path: `Transformation/${op}` });
  const units = Object.fromEntries(await Promise.all(unitCodes(rec.ParameterValues).map(async (c) => [c, await epsg({ path: `Unit/${c}` })])));
  const ell = async (crs) => {
    const g = await epsg({ path: `GeodeticCoordRefSystem/${crs}` });
    const d = await epsg({ path: `Datum/${(g.Datum || g.DatumEnsemble).Code}` });
    const e = await epsg({ path: `Ellipsoid/${d.Ellipsoid.Code}` });
    return ellipsoidFromRecord(e, await epsg({ path: `Unit/${e.Unit.Code}` }));
  };
  return { params: readParameters(rec.ParameterValues, units), from: await ell(rec.SourceCrs.Code), to: await ell(rec.TargetCrs.Code), label: `EPSG:${op} ${rec.Name}, read live` };
}

const tools = LIVE ? createEpsgTools({ epsg, transformationChoice: () => "choose" }, () => null) : null;

async function run({ test, op, gigs, ells, methods, srcCrs, tgtCrs }) {
  const s = LIVE ? await liveSetup(op) : { ...gigsParams(gigs), from: ellipsoid(ELL[ells[0]]), to: ellipsoid(ELL[ells[1]]) };
  const out = [];
  let version = null;
  for (const [part, method, dims] of [[1, methods[0], 2], [2, methods[1], 3]]) {
    const path = find("GIGS 5200", new RegExp(`${test}_.*_output_part${part}`));
    const T = tol(path);
    const pts = rows(path).map((r) => {
      const src = dims === 2 ? [+r[1], +r[2], null] : [+r[1], +r[2], +r[3]];
      const tgt = dims === 2 ? [+r[3], +r[4], null] : [+r[4], +r[5], +r[6]];
      const reverse = r[dims === 2 ? 6 : 8] === "REVERSE";
      return { id: r[0], reverse, input: reverse ? tgt : src, expect: reverse ? src : tgt, roundTrip: /Round Trip/i.test(r.join(" ")) };
    });
    // 2D points go through the transform tool itself when live (the record's own method); 3D through the 3D method.
    const apply = async (list, reverse) => {
      if (LIVE && dims === 2) {
        const r = await tools.transform({ operation: String(op), source: String(reverse ? tgtCrs : srcCrs), target: String(reverse ? srcCrs : tgtCrs), points: list.map((p) => p.slice(0, 2)) });
        if (!r.applied) throw new Error(r.error);
        version = r.epsg_version;
        return r.points.map((p) => [p.output.lat, p.output.lon, null]);
      }
      return applyTransformation(list, { method, params: s.params, from: s.from, to: s.to, reverse });
    };
    for (const dir of [false, true]) {
      const mine = pts.filter((p) => p.reverse === dir);
      const got = await apply(mine.map((p) => p.input), dir);
      const back = await apply(got, !dir);
      mine.forEach((p, i) => {
        const g = got[i], e = p.expect;
        const dLat = Math.abs(g[0] - e[0]), dLon = Math.abs(((g[1] - e[1] + 540) % 360) - 180) * Math.cos((e[0] * Math.PI) / 180);
        const dH = dims === 3 ? Math.abs(g[2] - e[2]) : null;
        out.push({ id: p.id, dir: dir ? "reverse" : "forward", ok: dLat <= T.geog && dLon <= T.geog && (dH == null || dH <= T.cart), dLat, dLon, dH });
        if (p.roundTrip) {
          const b = back[i], q = p.input;
          const rLat = Math.abs(b[0] - q[0]), rLon = Math.abs(((b[1] - q[1] + 540) % 360) - 180) * Math.cos((q[0] * Math.PI) / 180);
          // A 2D method drops the height on the way (the point sits 172 m above the OSGB36 ellipsoid there), so a 2D
          // round trip comes back along a slightly different normal; the 3D round trip is the clean test of the inverse.
          const rH = dims === 3 ? Math.abs(b[2] - q[2]) : null;
          out.push({ id: `${p.id} round trip (${dims}D)`, dir: "round trip", ok: rLat <= T.rtGeog && rLon <= T.rtGeog && (rH == null || rH <= T.rtCart), dLat: rLat, dLon: rLon, dH: rH, twoD: dims === 2 });
        }
      });
    }
  }
  return { test, label: s.label, out, version };
}

const m = (d) => (d * 111320).toFixed(4); // degrees of latitude → metres
let failed = 0;
for (const c of [
  { test: 5203, op: 1314, gigs: 61314, ells: [7001, 7030], methods: [9606, 1037], srcCrs: 4277, tgtCrs: 4326 },
  { test: 5204, op: 15929, gigs: 15929, ells: [7022, 7030], methods: [9607, 1038], srcCrs: 4313, tgtCrs: 4326 },
]) {
  const r = await run(c);
  const pts = r.out.filter((x) => x.dir !== "round trip"), rts = r.out.filter((x) => x.dir === "round trip");
  const worst = (list, k) => Math.max(0, ...list.map((x) => x[k] ?? 0));
  console.log(`GIGS ${r.test}: ${r.label}${r.version ? `; ${r.version}` : ""}`);
  console.log(`  points: ${pts.filter((x) => x.ok).length}/${pts.length} within tolerance (worst ${m(Math.max(worst(pts, "dLat"), worst(pts, "dLon")))} m horizontally, ${worst(pts, "dH").toFixed(4)} m in height)`);
  for (const x of rts) console.log(`  ${x.id}: ${x.ok ? "within" : "OUTSIDE"} tolerance (${m(Math.max(x.dLat, x.dLon))} m${x.dH != null ? `, height ${x.dH.toFixed(4)} m` : ""})`);
  for (const b of pts.filter((x) => !x.ok)) console.log(`  FAIL ${b.id} ${b.dir}: ${m(Math.max(b.dLat, b.dLon))} m${b.dH != null ? `, height ${b.dH.toFixed(4)} m` : ""}`);
  failed += pts.filter((x) => !x.ok).length + rts.filter((x) => !x.ok && !x.twoD).length;
}
console.log(failed ? `\n${failed} outside tolerance.` : "\nEvery point and 3D round trip within GIGS tolerances.");
process.exit(failed ? 1 : 0);
