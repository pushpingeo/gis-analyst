# Operations used by the NTR screening skill

What each operation must do in any setting, then the tool that does it in Tobler's lab agent (`js/agent.js`,
`js/tools.js`). The SKILL.md method (v2) is the evaluated text and doesn't name these; it says "gather the evidence
with the tools: list the catalogue, then check every concept, the threatened species records and the named places".
In step 4 the workspace version will also use the catalogue tools (`find_data`, `get_data`).

## List the catalogue
- **Does:** lists the concepts (kinds of evidence) the catalogue can search for the site: id, label, the IFC
  Performance Standard each informs, source, search radius and caveats.
- **Tobler:** `list_concepts`.

## Check a concept
- **Does:** finds map features for one or more concepts near the site: counts by distance band (on site, within
  1 km, 1–5 km, 5–20 km) and the nearest named features with distances from the footprint edge.
- **Returns:** features, or "not checked" with the reason when the source fails.
- **Tobler:** `find_features` (OpenStreetMap today; the atlas in step 4).

## Threatened species records
- **Does:** occurrence records (GBIF) within 5 km of the footprint for species the IUCN Red List rates Critically
  Endangered or Endangered, grouped by species, plus a species count within 20 km. Records are sightings and
  specimens, not ranges.
- **Tobler:** `threatened_species_records`.

## Named places
- **Does:** named places and features within 20 km (settlements, municipalities, rivers, protected and heritage
  sites) with types, distances and encyclopaedia links; point locations only. Useful for desk research.
- **Tobler source:** Wikidata.
- **Tobler:** `named_places`.

## Desk research (optional)
- **Does:** a handful of web searches about the place (not the project), each finding cited with URL and date and
  labelled *desk research*.
- **Tobler:** the model's web search tool, off by default.

## Failures, in any setting
A concept the catalogue lacks, or a source that fails, is a data gap, not an absence. Report it as *not checked*.
