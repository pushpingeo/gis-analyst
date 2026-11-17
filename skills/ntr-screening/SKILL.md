---
name: ntr-screening
version: 3.2-draft
description: Screen a site, onshore or offshore, for non-technical risk (NTR) from published spatial data. Flags anything that could become a risk, concern or delay (land and livelihoods, biodiversity, Indigenous Peoples, cultural heritage, community health and safety, and the operating context), with traced evidence and what wasn't checked. Use when someone asks what risks, sensitivities or constraints a site, block, field, route or area might raise.
---

# NTR screening

A desk-based first look at a site, the way a GIS analyst supports an opportunity manager: **flag anything that might be a risk, a concern or a cause of delay**, show the evidence, and say how confident you are. The person decides what to act on. A missed risk costs far more than a flag that turns out not to matter, so when in doubt, flag it and say the evidence is weak.

It is a screen, not an impact assessment. The themes follow IFC's Performance Standards (PS4–PS8), because they give the result a structure people recognise; the screen is not an IFC review and doesn't need IFC's language unless asked. This version works onshore and offshore, and finds its own data: it says *what evidence to look for*, and the analyst searches for the best published sources for this place. (The IFC-calibrated, evaluated version is `ntr-screening-ifc`.)

## Inputs
- **Site:** a point, line or area that's already been found or drawn. If there's none yet, find it first (place-finding skill).
- **Asset type:** e.g. solar, wind (onshore or offshore), hydro, thermal plant, mine, oil and gas field or platform, pipeline or cable, port or terminal, exploration block, seismic survey. Ask if it isn't clear and it changes the answer; otherwise say what you assumed.
- **Stage:** greenfield, expansion of an existing site, or an existing asset. If it isn't given, assume **greenfield** and say so. *Most risk comes from new land or sea-bed take and construction.*
- **Onshore or offshore:** from the site itself (the place's details say whether it's offshore). A coastal site screens both ways.
- **Footprint:** if there's only a point, use a footprint radius and say so: thermal, substation or terminal 0.5 km; solar 1 km; oil and gas plant or platform 1 km; wind 3 km; mine 3 km; hydro 5 km (the reservoir and the dried-out reach run along the river); oil and gas field 5 km. Screen linear assets along the whole line.

## Distances (defaults; the person can change any of them)
Distances are measured from the footprint edge. Use these unless the person gives others; when they do, use theirs, say so, and keep them for the rest of the conversation.

| Band | Onshore | Offshore | Why |
|---|---|---|---|
| On site | 0 km | 0 km | Direct take, direct impact |
| Near | up to 1 km | up to 2 km | Construction, safety zones (500 m around installations), anchor spreads |
| Close | 1–5 km | 2–10 km | Noise, dust or discharges, traffic and vessel movements, influx of workers |
| Wider | 5–20 km | 10–50 km | Context: protected sites, communities, fisheries and spill reach are named, not flagged as direct |

State the distances used at the top of the result, and offer to change them.

## Steps
1. **Confirm the site:** location, onshore/offshore, asset type, stage, footprint and distances used.
2. **Plan the evidence.** For each theme below, decide which kinds of evidence apply to this site (onshore, offshore or both).
3. **Find the data.** For each kind of evidence, search for datasets with short, distinctive words (the "search words" below), two or three wordings at a time. Choose, in this order: trusted services and national or intergovernmental publishers; open licences; datasets whose features can be fetched; the most specific coverage (a national layer beats a global one where both exist). Use the everyday feature search for settlements, schools, hospitals, places of worship and cemeteries.
4. **Fetch and measure.** Fetch each chosen dataset for the footprint **out to the wider band** (20 km onshore, 50 km offshore, unless the person set others), then sort what comes back into bands; don't fetch a shorter distance and call the rest clear. A protected area at 20 km offshore is still named. Say which theme each fetch is for (biodiversity, land, indigenous, heritage, community, context), so the result can be shown by theme. Record name, distance, band, source, licence and date for every feature used.
5. **Raise flags** (below), one per distinct risk, most serious first.
6. **State the gaps:** every kind of evidence that applies but wasn't found, failed, or was left out for licence reasons.

Stop searching a kind of evidence after two or three tries with different words. Say what was searched.

If a dataset returns no features at all where you'd expect some (a field's own pipelines, a coast's settlements), suspect the dataset before the site: read its title again ("removed", "proposed", "historic" layers hold something else) and try another source.

## Evidence to look for, by theme
Search words are starting points; adapt them to the place and language (e.g. "Natura 2000", "SSSI", "parque nacional").

**Land and livelihoods (PS5)**
- Onshore: settlements and homes; farmland, orchards, grazing (land cover); forest use; mining or other concessions; customary or community land. *Search words:* land cover, cropland, settlement, concession, cadastre.
- Offshore: fishing grounds and fishing effort; fisheries closures; aquaculture sites; other licences or leases overlapping the site (oil and gas, wind, cables, aggregates). *Search words:* fishing effort, fisheries, aquaculture, lease, licence, block.
- *PS5 covers physical displacement (homes) and economic displacement (farming, grazing, fishing, forest use, business). Most new land and sea has someone using it.*

**Biodiversity (PS6)**
- Both: protected areas, national and international (Ramsar, World Heritage natural sites, marine protected areas, Natura 2000); important bird areas.
- Onshore: natural habitat in the footprint (forest, wetland, grassland, rivers, coast); threatened species records.
- Offshore: sensitive seabed habitats (coral, seagrass, sponge grounds, chemosynthetic communities); essential fish habitat and spawning or nursery grounds; marine mammal areas; seabird colonies on nearby coasts. *Search words:* protected, marine protected, Ramsar, coral, seagrass, sensitive, habitat, fish habitat, spawning, marine mammal, seabird.
- Always list "Key Biodiversity Areas not checked" in the gaps. *KBA boundaries are licensed through IBAT, which Tobler doesn't hold.*

**Indigenous Peoples (PS7)**
- Mapped Indigenous, tribal or community land and waters (reserves, native title, customary marine tenure). *Search words:* indigenous, tribal, native title, reserve, community land.
- Nothing mapped but a strong regional signal: flag at low or medium confidence, labelled *regional knowledge, not mapped data* (highland South and Southeast Asia; forest peoples of central Africa and the Amazon; Andean highlands; pastoralist drylands of East Africa and the Sahel; Arctic and boreal regions; coastal and island communities with customary fishing). *Absence from the map is not evidence of absence.*

**Cultural heritage (PS8)**
- Onshore: listed buildings, scheduled monuments, World Heritage (cultural), graves, cemeteries, shrines and places of worship on site.
- Offshore: shipwrecks, war graves and protected wrecks, submerged archaeology, sea-bed obstructions of historic interest. *Search words:* heritage, monument, listed, wreck, war grave, archaeology.
- Large earthworks or sea-bed works in areas with long settlement history: flag the need for a heritage survey and a chance-finds procedure.

**Community health, safety and security (PS4)**
- Onshore: schools, hospitals and clinics within the near band or by the likely access road; settlements in the close band; no main road within 10 km (new access needed).
- Offshore: shipping lanes and traffic density; ports and anchorages; other installations, pipelines and cables (simultaneous operations); military practice areas; unexploded ordnance; coastal communities in the wider band (spill reach).
- Both: existing industry nearby (cumulative effects); **thermal hotspots and gas flaring** from satellite detections as a sign of existing operations and emissions; international or disputed boundaries (land or maritime) within the wider band. *Search words:* shipping, AIS, vessel density, port, platform, pipeline, cable, military, ordnance, thermal, flaring, boundary.

**Context (no PS):** country risk only with a dated source; who lives and works around the site, especially sharp contrasts in wealth or land and sea use (*a common cause of conflict over jobs and compensation*).

## Raising flags
Each flag says: **the risk** in plain words; **the evidence** (feature name as the data gives it, type, distance and band, dataset, publisher, licence, date checked); **why it matters** (cost, delay, conflict, reputation, legal); **confidence**; and the **theme** (PS4–PS8 or context).

Confidence: **high** = a mapped feature on site or in the near band, from a trusted or national source; **medium** = mapped but in the close or wider band, or several weak signals, or a source of unknown licence or quality; **low** = regional knowledge, or a gap in a place where the risk is common.

- **Industrial use on or near site is not a reason to lower the risk on its own.** Today's data may show the planned project itself, or a neighbour of the same kind, already built. *Hindsight is everywhere in screening data: say so when it matters.*
- **Satellite detections are recent only** (days, not years): say "none detected in the last N days", never "none".
- A theme with no flags and no gaps is rare; if it happens, say what was checked.

## Data rules
- Prefer trusted services, national and intergovernmental publishers, and open licences. Data under Esri's Master License Agreement is not used unless the person holds an Esri licence; if the only source is one of those, say so as a gap.
- Every feature used keeps its dataset, publisher, licence (as stated) and date checked. "Licence not stated" stays not stated.
- A source that fails, times out or can't be fetched is **not checked**, never "nothing found". A dataset that answers with nothing means nothing *in that dataset*, not nothing at all.
- Never invent a feature, name, distance or dataset. Never say data doesn't exist unless you searched for it, and then say what words and area you searched.

## Output
A short summary for the person, no more than 400 words: the site and distances used (one line), then the flags, most serious first, then the gaps. Then one JSON block:

```json
{
  "site": {"place": "", "onshore_offshore": "onshore|offshore|both", "asset_type": "", "stage": "", "footprint": ""},
  "distances_km": {"near": 1, "close": 5, "wider": 20, "set_by": "default|person"},
  "flags": [{"risk": "", "theme": "PS4|PS5|PS6|PS7|PS8|context", "confidence": "high|medium|low",
             "evidence": [{"name": "", "distance_km": 0, "band": "on site|near|close|wider", "dataset": "", "publisher": "", "licence": "", "checked": ""}],
             "why": ""}],
  "checked": [{"evidence": "", "dataset": "", "publisher": "", "result": "features|none in dataset|not checked"}],
  "data_gaps": [""]
}
```

## Operations
The operations this method uses (finding datasets, fetching and measuring features, the everyday feature search, reading the site's details) are described in general terms in `operations.md`, beside this file, so the method can run in other settings with their own tools.
