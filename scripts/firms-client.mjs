// NASA FIRMS from scripts and Actions (the page goes through the Worker's /firms route instead).
// Needs FIRMS_MAP_KEY in the environment. Same reply shape as the Worker: GeoJSON points.
export async function firmsCall({ source, bbox, days = 7 }) {
  const key = process.env.FIRMS_MAP_KEY;
  if (!key) throw new Error("FIRMS_MAP_KEY isn't set");
  const r = await fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${source}/${bbox.join(",")}/${days}`);
  const text = await r.text();
  if (!r.ok || (text.trim() && !/latitude/i.test(text.slice(0, 200)))) throw new Error(`FIRMS: ${text.replaceAll(key, "…").slice(0, 160)}`);
  const lines = text.trim().split(/\r?\n/);
  if (!lines[0] || !/latitude/i.test(lines[0])) return { type: "FeatureCollection", features: [] };
  const head = lines[0].split(","), iLat = head.indexOf("latitude"), iLon = head.indexOf("longitude");
  const features = lines.slice(1).map((line) => {
    const v = line.split(","), p = {};
    head.forEach((h, i) => { if (i !== iLat && i !== iLon) p[h] = v[i] !== "" && !isNaN(+v[i]) && !/date|time|satellite|instrument|version|daynight|confidence/.test(h) ? +v[i] : v[i]; });
    if (p.acq_date && p.acq_time) { const t = String(p.acq_time).padStart(4, "0"); p.acquired_utc = `${p.acq_date} ${t.slice(0, 2)}:${t.slice(2)} UTC`; }
    return { type: "Feature", geometry: { type: "Point", coordinates: [+v[iLon], +v[iLat]] }, properties: p };
  });
  return { type: "FeatureCollection", features };
}
