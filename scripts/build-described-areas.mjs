// Builds the "areas from words" test set (test data only): requests in plain words, each with the shape it
// should produce. Anchors come from authoritative layers or hand-checked coordinates; shapes from js/geometry.js.
// Usage: node scripts/build-described-areas.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import * as turf from "@turf/turf";
import * as G from "../js/geometry.js";

const NSTA = "https://services-eu1.arcgis.com/OZMfUznmLTnWccBc/arcgis/rest/services";
async function nsta(layer, where) {
  const r = await fetch(`${NSTA}/${layer}/query?where=${encodeURIComponent(where)}&outFields=*&outSR=4326&f=geojson`);
  const j = await r.json();
  if (!j.features?.length) throw new Error(`nothing for ${where}`);
  return j.features[0];
}
const platform = (name) => nsta("UKCS%20offshore%20infrastructure%20surface%20points%20WGS84/FeatureServer/1", `NAME = '${name}' AND CURR_ROW = 'Y'`);

const jackdaw = (await platform("JACKDAW")).geometry.coordinates;
const fortiesA = (await platform("FORTIES ALPHA")).geometry.coordinates;
const block = await nsta("UKCS_blocks_(WGS84)/FeatureServer/0", "BLOCK_REF = '30/2'");
const brent = await nsta("Offshore_hydrocarbon_fields_(WGS84)/FeatureServer/0", "FIELDNAME = 'BRENT'");

const cases = [
  { id: "jackdaw-square", words: "A 3 km² square around the Jackdaw platform in the North Sea", anchor: "NSTA surface installations: JACKDAW", truth: G.squareAround(jackdaw, 3) },
  { id: "block-30-2", words: "North Sea licensing block 30/2", anchor: "NSTA UKCS blocks: 30/2", truth: block },
  { id: "brent-field", words: "The outline of the Brent oil field", anchor: "NSTA offshore hydrocarbon fields: BRENT", truth: brent },
  { id: "forties-offset", words: "A 2 km² square 10 km north of the Forties Alpha platform", anchor: "NSTA surface installations: FORTIES ALPHA", truth: G.squareAround(turf.destination(fortiesA, 10, 0).geometry.coordinates, 2) },
  { id: "linlithgow-palace", words: "Everything within 5 km of Linlithgow Palace in Scotland", anchor: "Linlithgow Palace, 55.9775 N 3.6011 W (checked on OpenStreetMap)", truth: G.circleAround([-3.6011, 55.9775], { radiusKm: 5 }) },
  { id: "edinburgh-castle", words: "A 2 km radius around Edinburgh Castle", anchor: "Edinburgh Castle, 55.9486 N 3.1999 W", truth: G.circleAround([-3.1999, 55.9486], { radiusKm: 2 }) },
  { id: "hoover-dam", words: "A 1 km circle centred on the Hoover Dam", anchor: "Hoover Dam crest, 36.0160 N 114.7377 W", truth: G.circleAround([-114.7377, 36.016], { radiusKm: 1 }) },
  { id: "kilimanjaro-rectangle", words: "A rectangle 10 km east–west by 4 km north–south centred on the summit of Kilimanjaro", anchor: "Uhuru Peak, 3.0758 S 37.3533 E", truth: G.rectangleAround([37.3533, -3.0758], 10, 4) },
];
for (const c of cases) c.truth = { type: "Feature", properties: {}, geometry: c.truth.geometry };
mkdirSync("eval/places/sets", { recursive: true });
writeFileSync("eval/places/sets/described-areas.json", JSON.stringify({ note: "Areas described in words, with the shape each should produce. Test data only.", built: new Date().toISOString(), cases }, null, 1));
console.log(cases.map((c) => `${c.id}: ${(turf.area(c.truth) / 1e6).toFixed(2)} km²`).join("\n"));
