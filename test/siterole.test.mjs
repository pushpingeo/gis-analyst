// Site footprint vs search area (js/siterole.js), from Rob's Cnoc Buidhe screen (20 Nov).
import assert from "node:assert/strict";
import * as turf from "../js/vendor/turf.js";
import { placeRole, coverageIn, whereText, reword, applySearchArea, searchHeadline, SEARCH_BAND, LOW_COVERAGE, positionIn, applyApproximateSite, approxHeadline, edgeText, EDGE_BAND, CORE_SHARE } from "../js/siterole.js";
import { seaMatters } from "../js/seavalues.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${name}`); };
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

await test("roles come from how the place was built, not from the model", () => {
  const poly = { type: "Polygon" };
  assert.equal(placeRole({ method: "drawn" }, poly).role, "footprint");
  assert.equal(placeRole({}, { type: "Point" }).role, "point");
  assert.equal(placeRole({ method: "words", match: "name_and_type", shape: "feature", anchor: { name: "Rosebank" } }, poly).role, "footprint");
  assert.equal(placeRole({ method: "words", match: "named_place", steps: ["outline of 30/2"] }, poly).role, "footprint");
  assert.equal(placeRole({ method: "words", match: "named_place", shape: "square", anchor: { name: "Jackdaw" } }, poly).role, "area");
  // Cnoc Buidhe: a circle 2.5 km east of a village, standing in for a wind farm nobody found.
  const cb = placeRole({ method: "words", match: "type_near_clues", shape: "circle", offset: true, anchor: { name: "Bellochantuy" } }, poly);
  assert.equal(cb.role, "search_area");
  assert.equal(cb.why, "built from clues round Bellochantuy");
  // A published outline moved somewhere else isn't the outline any more; a region's outline stands in for a site.
  assert.equal(placeRole({ method: "words", match: "name_and_type", shape: "feature", offset: true }, poly).role, "search_area");
  assert.equal(placeRole({ method: "words", match: "settlement_or_region", shape: "feature" }, poly).role, "search_area");
  // A role already recorded wins.
  assert.equal(placeRole({ method: "words", role: "footprint", role_why: "x", match: "none" }, poly).role, "footprint");
});

await test("coverage: equal-area share of the search area, and which side", () => {
  const site = turf.circle([-5.66, 55.517], 2.5, { units: "kilometers", steps: 64 });
  const east = turf.circle([-5.62, 55.517], 1, { units: "kilometers", steps: 32 }); // centred on the east edge
  const c = coverageIn(site, east.geometry);
  near(c.km2, 1.4, 0.15, "a bit under half the small circle lies inside");
  near(c.coverage, c.km2 / (Math.PI * 2.5 ** 2), 0.01, "share of the search area");
  assert.equal(c.side, "eastern");
  assert.match(whereText(c), /^in the search area \(covers 7(\.\d)?% of it, on its eastern side\)$/);
  const half = coverageIn(site, turf.bboxPolygon([-5.66, 55.4, -5.5, 55.6]).geometry);
  near(half.coverage, 0.5, 0.02, "half");
  assert.equal(coverageIn(site, turf.bboxPolygon([-6, 55, -5, 56]).geometry).side, "most");
  assert.equal(whereText(coverageIn(site, turf.point([-5.66, 55.518]).geometry)), "in the search area (in its middle)");
  assert.equal(coverageIn(site, turf.point([-5, 55.5]).geometry), null, "outside");
  assert.equal(coverageIn(site, turf.circle([-5.3, 55.5], 1, { units: "kilometers" }).geometry), null, "an area outside");
  assert.match(whereText(coverageIn(site, turf.lineString([[-5.7, 55.517], [-5.6, 55.517]]).geometry)), /^in the search area/);
  // Same answer at high latitude: the overlay is equal-area wherever it is.
  const north = turf.circle([20, 70], 2.5, { units: "kilometers", steps: 64 });
  const nhalf = turf.polygon([[[20, 69], [21, 69], [21, 71], [20, 71], [20, 69]]]);
  near(coverageIn(north, nhalf.geometry).coverage, 0.5, 0.02, "half at 70°N");
});

await test("words: nothing claims 'on site' for a search area", () => {
  assert.equal(reword("Special Protection Area on site: collision risk"), "Special Protection Area in the search area: collision risk");
  assert.equal(reword("On-site works need consent"), "In the search area works need consent");
  assert.equal(reword("Deep peat across the footprint"), "Deep peat across the search area");
  assert.equal(reword("Pipelines on and near site"), "Pipelines in and near the search area");
  assert.equal(reword("Scheduled monuments on the site"), "Scheduled monuments in the search area");
  assert.equal(reword("Two km from the site edge"), "Two km from the site edge");
  assert.equal(reword(null), null);
});

await test("flags inside a search area: relation, coverage, confidence capped (low when a sliver)", () => {
  const ev = new Map([
    ["E1", { fid: "E1", in_search_area: true, coverage: 0.04, side: "eastern" }],
    ["E2", { fid: "E2", in_search_area: true, coverage: 0.3 }],
    ["E3", { fid: "E3", in_search_area: true }], // a point inside: no share
    ["E4", { fid: "E4", distance_km: 2 }],
  ]);
  const out = applySearchArea([
    { risk: "SPA on site", confidence: "high", fids: ["E1"], nearest_km: 0 },
    { risk: "Deep peat across the footprint", confidence: "high", fids: ["E2"], nearest_km: 0 },
    { risk: "Monument on site", confidence: "high", fids: ["E3", "E1"], nearest_km: 0 },
    { risk: "Wind farm 2 km away", confidence: "high", fids: ["E4"], nearest_km: 2 },
    { risk: "Low already", confidence: "low", fids: ["E1"], nearest_km: 0 },
  ], ev);
  assert.equal(out[0].relation, SEARCH_BAND);
  assert.equal(out[0].confidence, "low", `under ${LOW_COVERAGE * 100}% covered`);
  assert.equal(out[0].risk, "SPA in the search area");
  assert.equal(out[1].confidence, "medium");
  assert.equal(out[1].coverage, 0.3);
  assert.equal(out[2].confidence, "medium", "a point inside can't be sized, so medium");
  assert.equal(out[3].confidence, "high");
  assert.equal(out[3].relation, "outside the search area");
  assert.equal(out[4].confidence, "low");
  assert.equal(out[4].confidence_capped, undefined, "already at or below the cap");
});

await test("headline and when the sea belongs in the write-up", () => {
  assert.match(searchHeadline({ area_km2: 19.62, role_why: "built from clues round Bellochantuy" }),
    /^Screened a 19\.6 km² search area \(built from clues round Bellochantuy\), because the site's outline wasn't found\./);
  assert.match(searchHeadline({ area_km2: 0.4, role_why: "x" }), /a 40 ha search area/);
  const traffic = { busiest: { distance_km: 5 } };
  assert.equal(seaMatters({ site: { setting: "onshore" }, sea: { traffic }, flags: [] }), false, "onshore, no flag on traffic");
  assert.equal(seaMatters({ site: { setting: "onshore" }, sea: { traffic }, flags: [{ evidence: [{ from_values: "vessel traffic" }] }] }), true);
  assert.equal(seaMatters({ site: { setting: "offshore" }, sea: { traffic }, flags: [] }), true);
  assert.equal(seaMatters({ site: { setting: "offshore" }, flags: [] }), false);
});

await test("approximate site: a known centre, an estimated size; the middle is on site, the outer part is the edge", () => {
  // Cnoc Buidhe's centre (169700 E, 630800 N) with a 3 km radius, as the default footprint round a point.
  const centre = [-5.6495, 55.5165];
  const site = turf.circle(centre, 3, { units: "kilometers", steps: 64 });
  assert.equal(CORE_SHARE, 0.5);
  const at = (km, bearing) => turf.destination(centre, km, bearing, { units: "kilometers" }).geometry;
  assert.equal(positionIn(site, centre, at(0.5, 0)).position, "core", "a point near the centre");
  assert.equal(positionIn(site, centre, at(1.4, 90)).position, "core", "just inside half the radius");
  const edge = positionIn(site, centre, at(2.5, 225));
  assert.equal(edge.position, "edge");
  assert.equal(edge.side, "south-western");
  assert.equal(edgeText(edge), "at the site's edge (its south-western side)");
  // An area clipping the eastern edge: edge. An area containing the centre: core (distance 0).
  const clip = turf.circle(turf.destination(centre, 3.5, 90, { units: "kilometers" }), 1, { units: "kilometers" }).geometry;
  assert.equal(positionIn(site, centre, clip).position, "edge");
  const big = turf.circle(turf.destination(centre, 2, 0, { units: "kilometers" }), 3, { units: "kilometers" }).geometry;
  const pb = positionIn(site, centre, big);
  assert.equal(pb.position, "core"); assert.equal(pb.from_centre_km, 0);
  // A line passing 1 km north of the centre, with no vertex near it: core (segment distance, not vertices).
  const line = turf.lineString([turf.destination(centre, 5, 270, { units: "kilometers" }).geometry.coordinates, turf.destination(centre, 5, 90, { units: "kilometers" }).geometry.coordinates].map((c) => turf.destination(c, 1, 0, { units: "kilometers" }).geometry.coordinates)).geometry;
  const pl = positionIn(site, centre, line);
  assert.equal(pl.position, "core"); near(pl.from_centre_km, 1, 0.05, "line distance");
  // Works the same far north (equal-area, centred on the site).
  const north = [20, 70];
  assert.equal(positionIn(turf.circle(north, 3, { units: "kilometers" }), north, turf.destination(north, 2.5, 0, { units: "kilometers" }).geometry).position, "edge");
});

await test("approximate site flags: core evidence keeps its confidence; edge-only is capped and reworded", () => {
  const ev = new Map([
    ["E1", { fid: "E1", site_position: "core" }],
    ["E2", { fid: "E2", site_position: "edge", side: "eastern" }],
    ["E3", { fid: "E3", distance_km: 2 }],
  ]);
  const out = applyApproximateSite([
    { risk: "SPA on site", confidence: "high", severity: "high", fids: ["E1", "E2"] },
    { risk: "Goose roost on site", why: "It lies on the site.", confidence: "high", severity: "high", fids: ["E2"] },
    { risk: "Houses nearby", confidence: "high", fids: ["E3"] },
    { risk: "Peat on site", confidence: "low", fids: ["E2"] },
  ], ev);
  assert.equal(out[0].confidence, "high"); assert.equal(out[0].relation, "on site");
  assert.equal(out[1].confidence, "medium"); assert.equal(out[1].relation, EDGE_BAND);
  assert.equal(out[1].severity, "high", "severity stays");
  assert.match(out[1].confidence_capped, /high → medium: only in the outer part/);
  assert.equal(out[1].risk, "Goose roost at the site's edge");
  assert.doesNotMatch(out[1].why, /on the site/);
  assert.deepEqual(out[2], { risk: "Houses nearby", confidence: "high", fids: ["E3"] }, "off-site flags untouched");
  assert.equal(out[3].confidence, "low"); assert.equal(out[3].confidence_capped, undefined);
  assert.match(approxHeadline({ area_km2: 28.27, role_why: "a 3 km radius round the point, the default for an onshore wind farm" }),
    /^Screened an approximate site of 28\.3 km² \(a 3 km radius round the point, the default for an onshore wind farm\), because the site's outline wasn't available\./);
  assert.equal(placeRole({ method: "words", role: "approximate_site", role_why: "x" }, { type: "Polygon" }).role, "approximate_site");
});

console.log(`${passed} siterole tests passed`);
