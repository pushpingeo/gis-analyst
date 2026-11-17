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
- **Tobler:** `get_data`.

## Everyday features near the site
- **Does:** settlements, schools, hospitals and clinics, places of worship, cemeteries, main roads, railways, rivers,
  parks, power lines and pipelines near the site, from the catalogue and OpenStreetMap, with distance and bearing.
- **Tobler:** `find_features_near`.

## Failures, in any setting
A source that fails or isn't reached is reported as *not checked*, never as *nothing found*. Say which.
