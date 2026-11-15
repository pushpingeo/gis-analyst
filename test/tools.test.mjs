// Unit tests for the spatial tools, using a made-up Overpass response round a site at (0, 0).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildOverpassQuery, screen, summarise, band } from "../js/tools.js";

const catalogue = JSON.parse(readFileSync(new URL("../catalogue/catalogue.json", import.meta.url)));
const km = (k) => k / 111.32; // degrees of latitude at the equator

const osm = {
  elements: [
    // Contains the site: comes back as tags only.
    { type: "relation", id: 1, tags: { boundary: "protected_area", name: "Big Park" } },
    // Village 1.5 km north: 0.5 km beyond a 1 km footprint, so "near".
    { type: "node", id: 2, lat: km(1.5), lon: 0, tags: { place: "village", name: "Northville" } },
    // Square nature reserve whose nearest edge is 4 km east (3 km from the footprint): "close".
    { type: "way", id: 3, tags: { leisure: "nature_reserve", name: "East Reserve" },
      geometry: [[4, -1], [6, -1], [6, 1], [4, 1], [4, -1]].map(([x, y]) => ({ lat: km(y), lon: km(x) })) },
    // River 2 km south, running east-west: 1 km from the footprint.
    { type: "way", id: 4, tags: { waterway: "river", name: "South River" },
      geometry: [[-5, -2], [5, -2]].map(([x, y]) => ({ lat: km(y), lon: km(x) })) },
    // Cemetery 10 km away: beyond the 2 km search radius for place-of-worship, so dropped.
    { type: "node", id: 5, lat: 0, lon: km(10), tags: { landuse: "cemetery" } },
    // Farmland polygon containing the site, also returned with geometry: should count once, on site.
    { type: "way", id: 6, tags: { landuse: "farmland" },
      geometry: [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([x, y]) => ({ lat: km(y), lon: km(x) })) },
  ],
};

const r = screen(osm, catalogue, 0, 0, 1);

assert.equal(r["protected-area"].features.length, 2);
assert.equal(r["protected-area"].features[0].name, "Big Park");
assert.equal(r["protected-area"].features[0].band, "on_site");
assert.equal(r["protected-area"].features[1].name, "East Reserve");
assert.ok(Math.abs(r["protected-area"].features[1].distance_km - 3) < 0.05, "reserve ~3 km from footprint");
assert.equal(r["protected-area"].features[1].band, "close");

assert.equal(r.settlement.features[0].name, "Northville");
assert.ok(Math.abs(r.settlement.features[0].distance_km - 0.5) < 0.02);
assert.equal(r.settlement.features[0].band, "near");

assert.ok(Math.abs(r.river.features[0].distance_km - 1) < 0.02);
assert.equal(r["place-of-worship"].features.length, 0, "cemetery outside its search radius");

assert.equal(r.farmland.features.length, 1);
assert.equal(r.farmland.features[0].band, "on_site");

assert.equal(band(0), "on_site");
assert.equal(band(0.9), "near");
assert.equal(band(4.9), "close");
assert.equal(band(19), "wider");

const s = summarise(r);
assert.equal(s["protected-area"].counts.on_site, 1);
assert.equal(s["protected-area"].ps, "PS6");

const q = buildOverpassQuery(catalogue, 10.287, 0.458, 5);
assert.ok(q.includes("is_in(0.458,10.287)"));
assert.ok(q.includes('rel(pivot.a)["boundary"="protected_area"]'));
assert.ok(q.includes('nwr["place"="village"](around:25000,0.458,10.287)'));
assert.ok(q.includes('nwr["historic"](around:'));

console.log("All tool tests passed.");
