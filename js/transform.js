// Datum transformations applied in code, from an EPSG record's own parameters (IOGP Guidance Note 7-2, section 4.4).
// No numbers here are copied from EPSG: the parameters, ellipsoids and units all come from the registry at run time.
// Pure maths, no I/O: js/epsgtools.js reads the records and calls these.
//
// Methods applied:
//   geocentric translations: 1031 (geocentric), 1035 (geog3D), 9603 (geog2D)
//   Position Vector:         1033 (geocentric), 1037 (geog3D), 9606 (geog2D)
//   Coordinate Frame:        1032 (geocentric), 1038 (geog3D), 9607 (geog2D)
//   Molodensky:              9604; abridged Molodensky: 9605 (geog2D domain, formulae on the ellipsoid)
// Grid-based methods (NTv2, NADCON, OSTN15) are not applied here.

export const METHODS = {
  1031: { kind: "translation", domain: "geocentric" },
  1035: { kind: "translation", domain: "geog3D" },
  9603: { kind: "translation", domain: "geog2D" },
  1033: { kind: "position_vector", domain: "geocentric" },
  1037: { kind: "position_vector", domain: "geog3D" },
  9606: { kind: "position_vector", domain: "geog2D" },
  1032: { kind: "coordinate_frame", domain: "geocentric" },
  1038: { kind: "coordinate_frame", domain: "geog3D" },
  9607: { kind: "coordinate_frame", domain: "geog2D" },
  9604: { kind: "molodensky", domain: "geog2D" },
  9605: { kind: "abridged_molodensky", domain: "geog2D" },
};
export const canApply = (methodCode) => Object.prototype.hasOwnProperty.call(METHODS, +methodCode);

const D2R = Math.PI / 180;
const AS2R = Math.PI / (180 * 3600);

// An ellipsoid from a and either 1/f or b (EPSG gives one or the other).
export function ellipsoid({ a, invf, b }) {
  if (!(a > 0)) throw new Error("Ellipsoid needs a semi-major axis.");
  const f = invf ? 1 / invf : b ? (a - b) / a : 0;
  return { a, f, b: a * (1 - f), e2: f * (2 - f) };
}

// Geographic (degrees, metres) ↔ geocentric (metres). GN 7-2 §4.1.1.
export function toGeocentric(lat, lon, h, E) {
  const p = lat * D2R, l = lon * D2R;
  const nu = E.a / Math.sqrt(1 - E.e2 * Math.sin(p) ** 2);
  return [(nu + h) * Math.cos(p) * Math.cos(l), (nu + h) * Math.cos(p) * Math.sin(l), ((1 - E.e2) * nu + h) * Math.sin(p)];
}
// Iterated to well below a micrometre; exact enough at any height GIGS tests (to -10 km).
export function toGeographic([X, Y, Z], E) {
  const lon = Math.atan2(Y, X);
  const p = Math.hypot(X, Y);
  let lat = Math.atan2(Z, p * (1 - E.e2)), h = 0;
  for (let i = 0; i < 20; i++) {
    const nu = E.a / Math.sqrt(1 - E.e2 * Math.sin(lat) ** 2);
    h = Math.abs(Math.cos(lat)) > 1e-9 ? p / Math.cos(lat) - nu : Math.abs(Z) - E.b;
    const next = Math.atan2(Z, p * (1 - E.e2 * nu / (nu + h)));
    if (Math.abs(next - lat) < 1e-15) { lat = next; break; }
    lat = next;
  }
  const nu = E.a / Math.sqrt(1 - E.e2 * Math.sin(lat) ** 2);
  h = Math.abs(Math.cos(lat)) > 1e-9 ? p / Math.cos(lat) - nu : Math.abs(Z) - E.b;
  return [lat / D2R, lon / D2R, h];
}

// Seven parameters in metres, arc-seconds and ppm (convert from the record's units first).
// Position Vector: GN 7-2 §4.4.3.1, X' = M·R·X + T with the small-angle rotation matrix R; Coordinate Frame is the
// same with the rotations negated. Reverse: the exact inverse, X = R⁻¹·(X' − T)/M. EPSG also allows reversing by
// changing the signs of all seven parameters, but that's an approximation (about 1.5 cm for OSGB36 → WGS 84 (6),
// whose scale is 20 ppm), so a round trip wouldn't come back within GIGS's 6 mm; the exact inverse does, and agrees
// with GIGS's reverse points as closely as the sign change does.
function rotation({ rx = 0, ry = 0, rz = 0 }, kind) {
  const k = (kind === "coordinate_frame" ? -1 : 1) * AS2R;
  const r1 = rx * k, r2 = ry * k, r3 = rz * k;
  return [[1, -r3, r2], [r3, 1, -r1], [-r2, r1, 1]];
}
const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
export function helmert([X, Y, Z], P, kind = "position_vector", reverse = false) {
  const { tx, ty, tz, ds = 0 } = P;
  const R = rotation(P, kind), M = 1 + ds * 1e-6;
  if (!reverse) {
    return [0, 1, 2].map((i) => M * (R[i][0] * X + R[i][1] * Y + R[i][2] * Z) + [tx, ty, tz][i]);
  }
  const v = [(X - tx) / M, (Y - ty) / M, (Z - tz) / M];
  const D = det3(R);
  return [0, 1, 2].map((c) => det3(R.map((row, i) => row.map((x, j) => (j === c ? v[i] : x)))) / D); // Cramer's rule
}

// Molodensky (9604) and abridged Molodensky (9605): GN 7-2 §4.4.4. Source ellipsoid, source→target dA and dF.
export function molodensky(lat, lon, h, { tx, ty, tz }, Es, Et, abridged = false) {
  const p = lat * D2R, l = lon * D2R;
  const da = Et.a - Es.a, df = Et.f - Es.f;
  const { a, f, e2 } = Es;
  const sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
  const rho = a * (1 - e2) / (1 - e2 * sp * sp) ** 1.5;
  const nu = a / Math.sqrt(1 - e2 * sp * sp);
  let dphi, dlam, dh;
  if (abridged) {
    dphi = (-tx * sp * cl - ty * sp * sl + tz * cp + (a * df + f * da) * Math.sin(2 * p)) / (rho * Math.sin(AS2R)) * AS2R;
    dlam = (-tx * sl + ty * cl) / (nu * cp * Math.sin(AS2R)) * AS2R;
    dh = tx * cp * cl + ty * cp * sl + tz * sp + (a * df + f * da) * sp * sp - da;
  } else {
    dphi = (-tx * sp * cl - ty * sp * sl + tz * cp + da * (nu * e2 * sp * cp) / a + df * (rho * (a / Es.b) + nu * (Es.b / a)) * sp * cp)
      / (rho + h);
    dlam = (-tx * sl + ty * cl) / ((nu + h) * cp);
    dh = tx * cp * cl + ty * cp * sl + tz * sp - da * a / nu + df * (Es.b / a) * nu * sp * sp;
  }
  return [lat + dphi / D2R, lon + dlam / D2R, h + dh];
}

// Parameters from an EPSG record's ParameterValues ([{ ParameterCode, Name, ParameterValue, Unit: { Code, Name } }]),
// matched by parameter code (name as a fallback). Units are converted with the registry's own Unit records
// (value × FactorB / FactorC gives metres, radians or unity): units = { [code]: { Type, FactorB, FactorC } }.
// Without a record for a unit, only metre, arc-second and parts per million are known; anything else is refused.
const PARAMS = { 8605: "tx", 8606: "ty", 8607: "tz", 8608: "rx", 8609: "ry", 8610: "rz", 8611: "ds" };
const BY_NAME = [
  [/^x-axis translation/i, 8605], [/^y-axis translation/i, 8606], [/^z-axis translation/i, 8607],
  [/^x-axis rotation/i, 8608], [/^y-axis rotation/i, 8609], [/^z-axis rotation/i, 8610], [/^scale difference/i, 8611],
];
const KNOWN_UNITS = { 9001: { Type: "length", FactorB: 1, FactorC: 1 }, 9104: { Type: "angle", FactorB: Math.PI, FactorC: 648000 }, 9202: { Type: "scale", FactorB: 1, FactorC: 1e6 } };
export function readParameters(values = [], units = {}) {
  const out = {};
  for (const v of values) {
    const code = v.ParameterCode ?? v.Code ?? BY_NAME.find(([re]) => re.test(v.Name || ""))?.[1];
    const key = PARAMS[code];
    if (!key) continue;
    const val = typeof v.ParameterValue === "number" ? v.ParameterValue : parseFloat(v.ParameterValue);
    if (!Number.isFinite(val)) throw new Error(`Parameter ${v.Name} has no numeric value.`);
    const uc = v.Unit?.Code ?? v.Unit;
    const u = units[uc] || KNOWN_UNITS[uc];
    if (!u || !(u.FactorC > 0)) throw new Error(`The unit of ${v.Name} (${v.Unit?.Name || uc}) couldn't be read.`);
    const base = (val * u.FactorB) / u.FactorC; // metres, radians or unity
    const want = key.startsWith("t") ? "length" : key.startsWith("r") ? "angle" : "scale";
    if (String(u.Type).toLowerCase() !== want) throw new Error(`${v.Name} is in ${v.Unit?.Name || uc}, not a ${want} unit.`);
    out[key] = want === "angle" ? base / AS2R : want === "scale" ? base * 1e6 : base;
  }
  return out;
}
// Units a record's parameters use, so the caller can fetch their Unit records.
export const unitCodes = (values = []) => [...new Set(values.map((v) => v.Unit?.Code).filter((c) => c != null))];

// An ellipsoid from its EPSG record (SemiMajorAxis, InverseFlattening or SemiMinorAxis, Unit), in metres.
export function ellipsoidFromRecord(e, unit) {
  const u = unit || KNOWN_UNITS[e.Unit?.Code];
  if (!u || String(u.Type).toLowerCase() !== "length") throw new Error(`Ellipsoid ${e.Name}: its unit (${e.Unit?.Name}) couldn't be read.`);
  const k = u.FactorB / u.FactorC;
  const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const a = num(e.SemiMajorAxis), invf = num(e.InverseFlattening), b = num(e.SemiMinorAxis);
  if (!a) throw new Error(`Ellipsoid ${e.Name} has no semi-major axis.`);
  return ellipsoid({ a: a * k, ...(invf ? { invf } : b ? { b: b * k } : {}) });
}

// Apply one transformation to points [lat, lon, h?] (degrees, metres). from/to are ellipsoid() objects for the
// record's own source and target; reverse runs it target → source. Heights: geog2D methods treat input height as
// 0 and give none back (h: null); geog3D and geocentric carry ellipsoidal height through.
export function applyTransformation(points, { method, params, from, to, reverse = false }) {
  const m = METHODS[+method];
  if (!m) throw new Error(`Method ${method} isn't applied in this page.`);
  const Ein = reverse ? to : from, Eout = reverse ? from : to;
  const keepH = m.domain !== "geog2D";
  return points.map(([lat, lon, h0]) => {
    const h = keepH && Number.isFinite(h0) ? h0 : 0;
    let res;
    if (m.kind === "molodensky" || m.kind === "abridged_molodensky") {
      const t = reverse ? { tx: -params.tx, ty: -params.ty, tz: -params.tz } : params;
      res = molodensky(lat, lon, h, t, Ein, Eout, m.kind === "abridged_molodensky");
    } else {
      const P = m.kind === "translation" ? { tx: params.tx, ty: params.ty, tz: params.tz } : params;
      res = toGeographic(helmert(toGeocentric(lat, lon, h, Ein), P, m.kind === "translation" ? "position_vector" : m.kind, reverse), Eout);
    }
    return keepH ? res : [res[0], res[1], null];
  });
}

// Geodesic-ish shift in metres between two points on one ellipsoid (for reporting "moved by about X m").
export function shiftMetres([lat1, lon1], [lat2, lon2], E = ellipsoid({ a: 6378137, invf: 298.257223563 })) {
  const p = ((lat1 + lat2) / 2) * D2R;
  const nu = E.a / Math.sqrt(1 - E.e2 * Math.sin(p) ** 2);
  const rho = E.a * (1 - E.e2) / (1 - E.e2 * Math.sin(p) ** 2) ** 1.5;
  let dl = lon2 - lon1; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
  return Math.hypot((lat2 - lat1) * D2R * rho, dl * D2R * nu * Math.cos(p));
}
