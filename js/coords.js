// Coordinates typed or pasted into the chat, read in code (Rob, 20 Nov: "55.522759, -5.650122" went to the place-name
// search, came back as the Argyll and Bute county centre 100 km away, and the analyst told him to drop the pin
// himself). Reads decimal degrees, degrees-minutes-seconds and British National Grid (letters or eastings and
// northings). Everything comes back as WGS84 longitude/latitude with how it was read. No DOM, no network.

const RAD = Math.PI / 180;
const num = (s) => parseFloat(String(s).replace(/[−–]/g, "-"));

export function formatLatLon(lon, lat, dp = 5) {
  return `${Math.abs(lat).toFixed(dp)}° ${lat < 0 ? "S" : "N"}, ${Math.abs(lon).toFixed(dp)}° ${lon < 0 ? "W" : "E"}`;
}

// ---- British National Grid -------------------------------------------------------------------
// Grid letters to eastings and northings (metres); the centre of the square the digits describe.
export function gridRefToEN(letters, digits) {
  const L = letters.toUpperCase();
  let l1 = L.charCodeAt(0) - 65, l2 = L.charCodeAt(1) - 65;
  if (l1 > 7) l1--; if (l2 > 7) l2--; // no I
  const e100 = ((l1 - 2) % 5) * 5 + (l2 % 5);
  const n100 = 19 - Math.floor(l1 / 5) * 5 - Math.floor(l2 / 5);
  if (e100 < 0 || e100 > 6 || n100 < 0 || n100 > 12) return null;
  const d = digits.replace(/\s+/g, "");
  if (d.length % 2 || d.length > 10) return null;
  const half = d.length / 2;
  const size = 10 ** (5 - half); // the square's side in metres
  const e = e100 * 1e5 + (half ? parseInt(d.slice(0, half), 10) * size : 0) + size / 2;
  const n = n100 * 1e5 + (half ? parseInt(d.slice(half), 10) * size : 0) + size / 2;
  return { e, n, square_m: size };
}

// OSGB36 eastings and northings to WGS84 longitude/latitude: inverse Transverse Mercator on the Airy 1830 ellipsoid,
// then a Helmert transformation (good to about 5 m; OSTN15 would be better, and screening doesn't need it).
export function osgbToWgs84(E, N) {
  const a = 6377563.396, b = 6356256.909, F0 = 0.9996012717, lat0 = 49 * RAD, lon0 = -2 * RAD, N0 = -100000, E0 = 400000;
  const e2 = 1 - (b * b) / (a * a), n = (a - b) / (a + b), n2 = n * n, n3 = n2 * n;
  const M = (phi) => b * F0 * ((1 + n + 1.25 * n2 + 1.25 * n3) * (phi - lat0)
    - (3 * n + 3 * n2 + 2.625 * n3) * Math.sin(phi - lat0) * Math.cos(phi + lat0)
    + (1.875 * n2 + 1.875 * n3) * Math.sin(2 * (phi - lat0)) * Math.cos(2 * (phi + lat0))
    - (35 / 24) * n3 * Math.sin(3 * (phi - lat0)) * Math.cos(3 * (phi + lat0)));
  let phi = lat0, m = 0;
  do { phi = (N - N0 - m) / (a * F0) + phi; m = M(phi); } while (Math.abs(N - N0 - m) >= 0.00001);
  const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const nu = a * F0 / Math.sqrt(1 - e2 * s * s), rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5), eta2 = nu / rho - 1;
  const VII = t / (2 * rho * nu), VIII = t / (24 * rho * nu ** 3) * (5 + 3 * t * t + eta2 - 9 * t * t * eta2);
  const IX = t / (720 * rho * nu ** 5) * (61 + 90 * t * t + 45 * t ** 4);
  const X = 1 / (c * nu), XI = 1 / (c * 6 * nu ** 3) * (nu / rho + 2 * t * t);
  const XII = 1 / (c * 120 * nu ** 5) * (5 + 28 * t * t + 24 * t ** 4);
  const XIIA = 1 / (c * 5040 * nu ** 7) * (61 + 662 * t * t + 1320 * t ** 4 + 720 * t ** 6);
  const dE = E - E0;
  const lat = phi - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6;
  const lon = lon0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7;
  // Airy 1830 geographic → cartesian → Helmert (OSGB36 → WGS84) → WGS84 geographic.
  const sl = Math.sin(lat), cl = Math.cos(lat);
  const nuA = a / Math.sqrt(1 - e2 * sl * sl);
  const x = nuA * cl * Math.cos(lon), y = nuA * cl * Math.sin(lon), z = (1 - e2) * nuA * sl;
  const tx = 446.448, ty = -125.157, tz = 542.06, sc = -20.4894e-6;
  const rx = (0.1502 / 3600) * RAD, ry = (0.247 / 3600) * RAD, rz = (0.8421 / 3600) * RAD;
  const x2 = tx + x * (1 + sc) - y * rz + z * ry, y2 = ty + x * rz + y * (1 + sc) - z * rx, z2 = tz - x * ry + y * rx + z * (1 + sc);
  const aW = 6378137, bW = 6356752.314245, e2W = 1 - (bW * bW) / (aW * aW);
  const p = Math.hypot(x2, y2);
  let latW = Math.atan2(z2, p * (1 - e2W)), prev;
  do { prev = latW; const sn = Math.sin(latW); const nuW = aW / Math.sqrt(1 - e2W * sn * sn); latW = Math.atan2(z2 + e2W * nuW * sn, p); } while (Math.abs(latW - prev) > 1e-12);
  return [Math.atan2(y2, x2) / RAD, latW / RAD];
}

// ---- reading text ----------------------------------------------------------------------------
const HEMI = "[NSEWnsew]";
// Degrees, minutes, optional seconds, then a hemisphere: 55°31'22.1"N, 55 31 22 N, 55°31.37'N.
const DMS_ONE = String.raw`(\d{1,3})\s*(?:[°º]\s*|\s+)(\d{1,2}(?:\.\d+)?)\s*(?:['′’]\s*|\s+)?(?:(\d{1,2}(?:\.\d+)?)\s*(?:["″”]|'')?\s*)?(${HEMI})\b`;
const DMS = new RegExp(`${DMS_ONE}[\\s,;/]+${DMS_ONE}`);
// Decimal degrees, with optional hemisphere letters before or after: 55.522759, -5.650122 · N55.5228 W5.6501.
const DEC_ONE = String.raw`(${HEMI})?\s*([-+−]?\d{1,3}\.\d+)\s*°?\s*(${HEMI})?`;
const DEC = new RegExp(String.raw`(?:^|[^\w.])${DEC_ONE}(?:\s*[,;/]\s*|\s+)${DEC_ONE}(?![\w.])`);
const LABELLED = /\b(lat|latitude|y|lon|lng|long|longitude|x)\s*[:=]?\s*([-+−]?\d{1,3}(?:\.\d+)?)\s*°?\s*[,;]?\s*(lat|latitude|y|lon|lng|long|longitude|x)\s*[:=]?\s*([-+−]?\d{1,3}(?:\.\d+)?)/i;
// Grid letters and digits: NR 6853 2836, NR68532836, nt002774. Lower case only when written as one word, so "so
// 2026" in a sentence isn't read as a grid reference.
const GRID = /\b([HJNOST][A-HJ-Z])\s*(\d{2,5})\s+(\d{2,5})\b|\b([HJNOST][A-HJ-Z])(\d{4,10})\b|\b([hjnost][a-hj-z])(\d{4,10})\b/;
// Eastings and northings: 168530, 628360 · E 168530 N 628360.
const EN = /(?:\b[Ee](?:asting)?:?\s*)?\b(\d{5,6}(?:\.\d+)?)\s*(?:m\b)?\s*[,;/\s]\s*(?:[Nn](?:orthing)?:?\s*)?(\d{5,7}(?:\.\d+)?)\b/;

// The same with the letters after the numbers: 169700 E, 630800 N · 169700mE 630800mN (Rob, 20 Nov).
const EN_AFTER = /\b(\d{5,6}(?:\.\d+)?)\s*m?\s*[Ee](?:asting)?s?\b\s*[,;/]?\s*(\d{5,7}(?:\.\d+)?)\s*m?\s*[Nn](?:orthing)?s?\b/;

function hemiSign(v, h) { return h && /[SWsw]/.test(h) ? -Math.abs(v) : h ? Math.abs(v) : v; }
const isLat = (h) => h && /[NSns]/.test(h);
const isLon = (h) => h && /[EWew]/.test(h);
const inGB = (lon, lat) => lon > -9 && lon < 2.5 && lat > 49.7 && lat < 61.1;

function fromPair(v1, h1, v2, h2, before) {
  let lat, lon, order;
  if (isLon(h1) || isLat(h2)) { lon = hemiSign(v1, h1); lat = hemiSign(v2, h2); order = "lon, lat"; }
  else if (isLat(h1) || isLon(h2)) { lat = hemiSign(v1, h1); lon = hemiSign(v2, h2); order = "lat, lon"; }
  else if (Math.abs(v1) > 90 && Math.abs(v2) <= 90) { lon = v1; lat = v2; order = "lon, lat"; }
  else if (/\b(?:lon|lng|long|longitude|x)\b[^\d-]*$/i.test(before)) { lon = v1; lat = v2; order = "lon, lat"; }
  else { lat = v1; lon = v2; order = "lat, lon"; }
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  // Both numbers would make a valid latitude and nothing says which is which: read as latitude first (as Google Maps
  // and most people write them), and keep the other reading so it can be offered.
  const ambiguous = !h1 && !h2 && Math.abs(v1) <= 90 && Math.abs(v2) <= 90 && v1 !== v2;
  return { lon, lat, order, ...(ambiguous ? { alternative: { lon: lat, lat: lon, read: formatLatLon(lat, lon) } } : {}) };
}

// The first coordinates in a piece of text, or null.
export function parseCoordinates(text) {
  const t = String(text || "");
  let m;
  if ((m = DMS.exec(t))) {
    const dd = (d, mi, s) => num(d) + num(mi) / 60 + (s ? num(s) / 3600 : 0);
    const r = fromPair(dd(m[1], m[2], m[3]), m[4], dd(m[5], m[6], m[7]), m[8], t.slice(0, m.index));
    if (r) return { ...r, input: m[0].trim(), system: "degrees, minutes and seconds", datum: "WGS84 (assumed)", read: formatLatLon(r.lon, r.lat) };
  }
  // Labelled: "lat 55.52 lon -5.65", "lon: -5.65, lat: 55.52", "x=-5.65 y=55.52".
  if ((m = LABELLED.exec(t))) {
    const first = /^(?:lon|lng|long|longitude|x)$/i.test(m[1]);
    const a = num(m[2]), b = num(m[4]);
    const [lat, lon] = first ? [b, a] : [a, b];
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lon, lat, order: first ? "lon, lat" : "lat, lon", input: m[0].trim(), system: "decimal degrees", datum: "WGS84 (assumed)", read: formatLatLon(lon, lat) };
  }
  if ((m = DEC.exec(t))) {
    // Plain numbers ("make it 1.5, 2.5 km") aren't coordinates: without hemisphere letters, both need decimals
    // and no unit after them.
    const marked = m[1] || m[3] || m[4] || m[6];
    const dp = (x) => (String(x).split(".")[1] || "").length;
    const unit = /^\s*(?:km|m\b|mi|nm|ha|%|miles|metres|meters)/i.test(t.slice(m.index + m[0].length));
    if (marked || (dp(m[2]) >= 1 && dp(m[5]) >= 1 && !unit)) {
      const r = fromPair(num(m[2]), m[1] || m[3], num(m[5]), m[4] || m[6], t.slice(0, m.index + 1));
      if (r) return { ...r, input: m[0].replace(/^[^\w.+−-]/, "").trim(), system: "decimal degrees", datum: "WGS84 (assumed)", read: formatLatLon(r.lon, r.lat) };
    }
  }
  if ((m = GRID.exec(t))) {
    const letters = m[1] || m[4] || m[6], digits = m[1] ? m[2] + m[3] : m[5] || m[7];
    if (!m[1] || m[2].length === m[3].length) {
      const g = gridRefToEN(letters, digits);
      if (g) {
        const [lon, lat] = osgbToWgs84(g.e, g.n);
        return { lon, lat, input: m[0].trim(), system: "British National Grid reference", easting: Math.round(g.e), northing: Math.round(g.n),
          precision_m: g.square_m, datum: "OSGB36, converted to WGS84 (Helmert, about 5 m)", read: formatLatLon(lon, lat) };
      }
    }
  }
  if ((m = EN_AFTER.exec(t) || EN.exec(t))) {
    const e = num(m[1]), n = num(m[2]);
    // Unlabelled, both must look like grid metres (six figures or more); "E … N …" may be shorter (the far west).
    const labelled = /^[Ee]/.test(m[0].trim()) || /[Nn](orthing)?s?$/.test(m[0].trim());
    if (e <= 700000 && n <= 1300000 && (labelled || (Math.floor(e) >= 100000 && Math.floor(n) >= 100000))) {
      const [lon, lat] = osgbToWgs84(e, n);
      if (inGB(lon, lat)) return { lon, lat, input: m[0].trim(), system: "British National Grid eastings and northings", easting: e, northing: n,
        datum: "OSGB36, converted to WGS84 (Helmert, about 5 m)", read: formatLatLon(lon, lat) };
    }
  }
  return null;
}

// The line the analyst reads after a message that holds coordinates (the page and the replay harness both use it).
export function coordinateNote(text) {
  const c = parseCoordinates(text);
  if (!c) return null;
  return `(Read by the page: "${c.input}" is ${c.read}, ${c.system}${c.alternative ? `; or ${c.alternative.read} if the numbers were the other way round` : ""}. Pass "${c.input}" to find_place to use it as a place.)`;
}
