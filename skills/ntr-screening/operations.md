# Operations used by the NTR screening skill (v3)

What each operation must do in any setting, then the Tobler tool that does it. All coordinates WGS84; distances
geodesic and measured from the footprint edge.

## Read the site
- **Does:** returns the site's geometry details: size, whether it's offshore, country, distance to coast, nearby towns.
- **Tobler:** `get_place` (and the project summary each turn).

## Find datasets about a topic for an area
- **Does:** searches a curated list of trusted services first (e.g. NASA FIRMS for thermal hotspots), then a catalogue
  of published map layers by words in titles and publishers, for the site's area. Returns each dataset's publisher,
  whether it's trusted, licence (as stated) and its class (open, non-commercial, not stated, Esri Master License),
  coverage, and whether its features can be fetched. Leaves out datasets the person isn't licensed to use, and says so.
- **Tobler:** `find_data` (`js/datatools.js`; trusted list `catalogue/trusted.json`; catalogue = AI Living World Atlas).

## Fetch a dataset's features for the site
- **Does:** fetches one dataset's features within a distance of the site, measures each from the site's edge (0 = on
  site), and returns them nearest first with name, distance, key attributes (dates, types), publisher, licence and when
  it was checked. Time-aware sources (satellite detections) take a number of recent days. Failures are "not checked".
  Takes the theme the evidence is for, so findings can be shown by theme.
- **Tobler:** `get_data`.

## Everyday features near the site
- **Does:** settlements, schools, hospitals and clinics, places of worship, cemeteries, main roads, railways, rivers,
  parks, power lines and pipelines near the site, from the catalogue and OpenStreetMap, with distance and bearing.
- **Tobler:** `find_features_near`.

## Elevation over a place (any skill)
- **Does:** reads elevation over a point, line or area from published elevation models: typical, lowest and highest
  of the points sampled, in **metres, positive up, relative to sea level** (land positive, seabed negative), whatever
  sign the source uses (some publish depths as positive numbers: they're converted). At sea, water depth is
  -elevation. Says the cell size and vertical datum. A service that fails is *not checked*, never zero.
- **Tobler:** `get_elevation` (`js/elevation.js`; sources in `catalogue/trusted.json` "values" → "elevation", each
  with its sign, units and datum). The screening baseline also runs it on every site: as water depth at sea, and on
  land only reported when low-lying or at high altitude.

## Vessel traffic at and around a site (at sea)
- **Does:** reads AIS vessel density (hours per km² a month, by vessel type) on the site and at points out to the
  close band. Outside the raster's coverage the answer is *no data*, never zero.
- **Tobler:** done in code before the analyst starts (`js/seavalues.js`; EMODnet's vessel density, 2023, in
  `catalogue/trusted.json` "values"), and given in the baseline.

## Failures, in any setting
A source that fails or isn't reached is reported as *not checked*, never as *nothing found*. Say which.

## Run a screen as its own run (Tobler)
- **Does:** runs this method as a sealed loop with only the operations above, on a fixed site, footprint and set of
  distances (chosen from the asset type and size, or set by the person), and keeps every feature the operations
  return, with its source, licence and date, as the run's evidence. The result is matched back to that evidence.
- **Tobler:** `screen_site` from the conversation (`js/ntrrun.js`; distances from `catalogue/distances.json`).
