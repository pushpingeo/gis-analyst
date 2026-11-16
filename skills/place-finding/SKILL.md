---
name: place-finding
version: 3
description: Turn words into a place on the map. Use when someone names a place, an asset or a project ("the Jackdaw platform", "solar farm 10 km north of Mocuba"), or describes an area ("a 3 km² block around…", "a 5 km corridor along…"), so the result is a pin, line or area with its evidence and a confidence rating.
---

# Place finding and area definition

Finding where something is, and building the area someone means, the way a careful GIS analyst would: from evidence, with the method written down, and without guessing. Every later analysis depends on this step: a pin 30 km out puts the buffers on the wrong protected areas and communities.

You never do geometry in your head. Tools find anchors and build shapes; you choose which tool, with which numbers, and explain why.

## Steps
1. **Read the request for every clue:** named places, the asset and its type (platform, field, block, dam, mine, solar or wind farm, port, town), distances and bearings ("10 km north of"), sizes ("3 km²", "5 km wide"), and the country or sea.
   - **Decide what the main site is.** Many projects have several parts: a mine with a railway and a port, a dam with a power station and transmission line, a plant with a pipeline. Unless the person says otherwise, the main site is where the land is taken and the asset operates: the mine, the dam or reservoir, the plant or solar or wind farm. A port, an office, a capital city or a company's head office is not the site.
2. **Find the anchor** with `find_place`. Search for the asset itself before the nearest town: *an asset matched as a mapped feature is far more precise than a settlement.*
   - Try the asset's own name in a few forms: the distinctive word alone ("Tasiast"), with its type ("Tasiast mine", "Nachtigal dam"), and the operator if it's a company name. Wikidata often has named mines, dams, power plants and ports with coordinates; OpenStreetMap often doesn't name them.
   - Prefer authoritative sources where they exist (e.g. NSTA installations, fields and blocks on the UK Continental Shelf), then a Wikidata or OpenStreetMap item **of the right type** (a mine for a mine, a dam or reservoir for hydro). Say which you used.
   - A result of the wrong type (an airport, a viewpoint, an office, a village that shares the name) is only a clue for where to look next, never the site itself.
   - If the asset isn't found by name, find the town or feature it's described from, then use `find_features_near` to look for the asset by type around it (e.g. solar farms within 15 km of Mocuba). A feature of the right type, size and bearing is strong evidence. For big assets (mines, dams, large plants), the largest feature of the right type near the named place is usually the one.
   - You may use what you already know (for example that a company mines near a particular town) to decide **where to search**, but the place itself must come from a found feature. Say when a clue came from your own knowledge.
3. **Triangulate** when there are two or more clues: the candidate should fit all of them (name, type, country, distance and bearing). Say which clues agree and which don't.
   - **Once the asset itself is found, distances in the description are checks, not moves.** "Village X lies 25 km east of the mine" tells you where the village is relative to the mine; it doesn't mean the mine is 25 km from where you found it. Use offsets to *place* something only when the asset can't be found and you're working out where it is from a named reference.
   - **Gazetteer points can be rough.** A Wikidata or OpenStreetMap point for a mine, a salt flat, a reservoir or a port is sometimes the centre of a much larger feature, or a town's position reused. Check it against the other clues (distances to named villages, rivers, "the south-eastern part of the salar"). If it disagrees with them by more than about 5 km, look for a feature that fits all the clues (`find_features_near`), prefer that, and say why; if nothing better turns up, keep the point with low confidence.
4. **Build the shape** with `make_place`, using the anchor's id. Choose the shape from the words:
   - "around", "centred on" with an area or size → square, circle or rectangle centred on the anchor. "Block" or "box" means a square unless the context says otherwise; "radius" or "within X km" means a circle.
   - A named area (a field, a licence block, a park) → the feature's own outline (`shape: "feature"`).
   - "X km north of" → offset from the anchor by distance and bearing.
   - "Along", "corridor" → a buffer around a line.
   - A bare point anchor with no size → a point.
5. **Show it and ask** whether it's what they meant. One short question, only about what's genuinely uncertain.
6. **Adjust** with `edit_place` when asked ("make it 5 km²", "rotate it 30°", "move it 2 km east").

## Ambiguity: ask, don't guess
- **Several candidates fit** (two platforms of the same name, a town name in several countries, the same landmark in two sources): call `offer_choices` with the two to five best, in order, mark the one you recommend and give a one-line reason. The person flicks through them on the map, each with its source, and picks one or takes your recommendation. Don't build a place until they've chosen. Only offer choices when the difference matters: if two sources give the same thing within a few hundred metres, use the more authoritative one and say so.
- **Words with two meanings:** in UK offshore work, "block" can mean a licensing block (e.g. 30/2). If someone says "the block around X" near a licensed area, offer both: the square they described and the licensing block the anchor sits in.
- **Only one vague anchor** (a district or region name) for something that needs a precise site: say the site can't be located from that, give the region as a low-confidence area if useful, and say what would pin it down.
- Never invent a location, and never move a pin to "where it probably is" without a found feature.

## Confidence (from rules, not feel)
- **High:** the asset itself matched by name and type in an authoritative layer, Wikidata or OpenStreetMap, *and* no other clue contradicts it; or a feature of the right type and size exactly where two clues point.
- **Medium:** two or more clues triangulate on a position, but the asset itself isn't mapped.
- **Low:** a single anchor (a town or region) with an offset or a guess at the footprint.
State the confidence and the reason in one line.

## Reporting
- Name the anchor the way the source names it, with its source and licence ("JACKDAW, platform, NSTA").
- Give the shape's size and where it is in plain words; the tools return these.
- Keep it short. The map shows the shape; the card holds the detail.
- Coordinate data you're given is WGS84. If a source states another datum (e.g. ED50 positions in older North Sea data), mention it: ED50 and WGS84 differ by about 100 m there.
