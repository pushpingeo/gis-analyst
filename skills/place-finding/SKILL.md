---
name: place-finding
version: 1
description: Turn words into a place on the map. Use when someone names a place, an asset or a project ("the Jackdaw platform", "solar farm 10 km north of Mocuba"), or describes an area ("a 3 km² block around…", "a 5 km corridor along…"), so the result is a pin, line or area with its evidence and a confidence rating.
---

# Place finding and area definition

Finding where something is, and building the area someone means, the way a careful GIS analyst would: from evidence, with the method written down, and without guessing. Every later analysis depends on this step: a pin 30 km out puts the buffers on the wrong protected areas and communities.

You never do geometry in your head. Tools find anchors and build shapes; you choose which tool, with which numbers, and explain why.

## Steps
1. **Read the request for every clue:** named places, the asset and its type (platform, field, block, dam, mine, solar or wind farm, port, town), distances and bearings ("10 km north of"), sizes ("3 km²", "5 km wide"), and the country or sea.
2. **Find the anchor** with `find_place`. Search for the asset itself before the nearest town: *an asset matched as a mapped feature is far more precise than a settlement.*
   - Prefer authoritative sources where they exist (e.g. NSTA installations, fields and blocks on the UK Continental Shelf) over OpenStreetMap; say which you used.
   - If the asset isn't found by name, find the town or feature it's described from, then use `find_features_near` to look for the asset by type around it (e.g. solar farms within 15 km of Mocuba). A feature of the right type, size and bearing is strong evidence.
3. **Triangulate** when there are two or more clues: the candidate should fit all of them (name, type, country, distance and bearing). Say which clues agree and which don't.
4. **Build the shape** with `make_place`, using the anchor's id. Choose the shape from the words:
   - "around", "centred on" with an area or size → square, circle or rectangle centred on the anchor. "Block" or "box" means a square unless the context says otherwise; "radius" or "within X km" means a circle.
   - A named area (a field, a licence block, a park) → the feature's own outline (`shape: "feature"`).
   - "X km north of" → offset from the anchor by distance and bearing.
   - "Along", "corridor" → a buffer around a line.
   - A bare point anchor with no size → a point.
5. **Show it and ask** whether it's what they meant. One short question, only about what's genuinely uncertain.
6. **Adjust** with `edit_place` when asked ("make it 5 km²", "rotate it 30°", "move it 2 km east").

## Ambiguity: ask, don't guess
- **Several candidates fit** (two platforms of the same name, a town name in several countries): list the top two or three with what distinguishes them, and ask.
- **Words with two meanings:** in UK offshore work, "block" can mean a licensing block (e.g. 30/2). If someone says "the block around X" near a licensed area, offer both: the square they described and the licensing block the anchor sits in.
- **Only one vague anchor** (a district or region name) for something that needs a precise site: say the site can't be located from that, give the region as a low-confidence area if useful, and say what would pin it down.
- Never invent a location, and never move a pin to "where it probably is" without a found feature.

## Confidence (from rules, not feel)
- **High:** the asset itself matched as a mapped feature by name or by type and position (an authoritative or OSM feature).
- **Medium:** two or more clues triangulate on a position, but the asset itself isn't mapped.
- **Low:** a single anchor (a town or region) with an offset or a guess at the footprint.
State the confidence and the reason in one line.

## Reporting
- Name the anchor the way the source names it, with its source and licence ("JACKDAW, platform, NSTA").
- Give the shape's size and where it is in plain words; the tools return these.
- Keep it short. The map shows the shape; the card holds the detail.
- Coordinate data you're given is WGS84. If a source states another datum (e.g. ED50 positions in older North Sea data), mention it: ED50 and WGS84 differ by about 100 m there.
