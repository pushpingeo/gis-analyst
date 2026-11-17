# Requests to the atlas

Tobler and the atlas are worked on in separate chats (decided 17 Nov). Tobler doesn't edit the atlas repo.
What Tobler can rely on is written down in the atlas repo's `docs/mcp-tools.md`. When Tobler needs something
new from the atlas, add it here (newest first), tell Rob, and he passes it to the atlas chat.

- **17 Nov (night): EMODnet as feature services, with their licences.** All 169 EMODnet Human Activities records in
  the atlas are WMS only (picture services) with "licence not stated" (find_datasets "EMODnet" around Shetland). EMODnet
  publishes the same layers as WFS at `https://ows.emodnet-humanactivities.eu/wfs?`, and its GeoNetwork records give
  the licence: e.g. "EMODnet Human Activities, Cultural Heritage, Ship wrecks"
  (https://emodnet.ec.europa.eu/geonetwork/srv/api/records/e965088b-a265-4517-84df-c49b156af8a7): CC-BY 4.0, no
  limitations on public access, WFS layer `emodnet:heritageshipwrecks`. Rob found it after Tobler reported wrecks
  as unfetchable at Rosebank. Asks: (1) harvest the EMODnet WFS endpoints (Human Activities first; then the other
  EMODnet portals) so wrecks, pipelines, installations, wind farms, military areas, dumped munitions and fishing
  effort can be fetched; (2) take licences from the GeoNetwork (ISO) metadata where the service doesn't state one;
  (3) more generally, when a WMS layer has a WFS sibling on the same server, prefer the WFS record.
- **17 Nov (night): a mislabelled NSTA layer.** Atlas record `bdb5d0a70436343e`, titled "UKCS offshore infrastructure
  pipeline linear (WGS84)", points at NSTA's `UKCS_offshore_infrastructure_pipeline_linear_removed_(WGS84)` service:
  *removed* pipelines. It returns nothing at Rosebank, while `29a134d61746d7dc` (the ED50 layer) returns Rosebank's
  live flowlines. Tobler's analyst chose the WGS84 one (sensibly) and reported "no pipelines". Asks: keep words like
  "removed", "decommissioned", "proposed", "historic" in titles when they're in the service name; and check whether
  other NSTA "(WGS84)" records point at "removed" services.
- **17 Nov (late evening), URGENT: `fetch_features` says "No dataset with id …" for ids that `find_datasets`
  and `get_dataset` return.** Seen from GitHub Actions at about 20:30 UTC: `get_dataset {"id":"4611b4343153c1b9"}`
  (NatureScot, 30 x 30 Protected Areas) answers, but `fetch_features` with the same id and a bbox near Linlithgow
  fails with "No dataset with id 4611b4343153c1b9". Same for SEPA river flooding (ce6e59e44174bf68), Historic
  Environment Scotland Scheduled Monuments (25ffbbeec3836e1a), Hutton land capability (bd18c4d31d168bf4) and others.
  Earlier the same evening `fetch_features` worked for NOAA layers (9383353f552e9482). Reading `worker/src/index.js`,
  `fetchFeatures` looks the id up in the published shards (`DATA_BASE` + `d/<first two chars>.json`) while
  `find_datasets` and `get_dataset` read D1, so a rebuild that's in D1 but not yet in the shards (or the other way
  round) would do this. **Likely cause, found later:** atlas commit `daf3023` (20:10 UTC, "Viewer: gzipped detail
  shards keyed by 3 characters (dz/)") changed the published detail files; `details()` in the MCP server still reads
  `d/<2 chars>.json`. A NOAA layer that fetched fine at 19:40 (9383353f552e9482) fails the same way since. This breaks
  the contract in `docs/mcp-tools.md` (`fetch_features`), so it blocks Tobler's feature searches, named searches and
  screening. Asks: (1) make the two agree (or have `fetch_features` fall back to D1); (2) note in
  `docs/mcp-tools.md` that ids from `find_datasets` are always fetchable. Tobler reports these as "not checked", so
  nothing is wrong on screen, but most screens come back mostly not checked until it's fixed.
- **17 Nov (late evening): NASA FIRMS and other trusted global services.** Tobler now calls NASA FIRMS (VIIRS and
  MODIS thermal hotspots, open under NASA's data policy, free MAP_KEY) through its own Worker, because the atlas holds
  only Esri's copy (Esri Master License Agreement) and a regional Alaska service. Longer term it would be better in
  the atlas: (1) catalogue key-gated services like FIRMS, with the key held server-side; (2) a "trusted global
  service" tier for publishers such as NASA, ESA/Copernicus, NOAA, USGS, UNEP-WCMC, GEBCO, EMODnet, FAO, so agents
  can ask for them first; (3) prefer a publisher's own service over an Esri Living Atlas copy (e.g. NOAA's own
  Essential Fish Habitat services, if they exist, over Esri's copies), and record the Esri Master License Agreement
  as its own licence class, since Tobler leaves those out unless the person holds an Esri licence.
- **17 Nov (evening): catalogue text search that copes with world-wide searches.** Tobler is adding an open
  "find data" tool for its analyst, built on `find_datasets` with `text` (e.g. "VIIRS", "thermal", "essential fish
  habitat") and an area that can be large (an ocean, a country, sometimes the world). In a test from GitHub Actions,
  3 of 7 world-wide text searches failed with "D1_ERROR: D1 DB is overloaded. Too many resources consumed within a
  10 second window" (VIIRS, fire and thermal worked; hotspot, MODIS and a plain Gulf of Mexico bbox search failed,
  run one after another). Asks: (1) text search that holds up for world-wide and large areas; (2) results ranked so
  the authoritative copy comes first and duplicates are folded (Esri and an Ontario portal both list "Wildfire
  Response Points"); (3) if useful, say in `docs/mcp-tools.md` what `text` matches (title and publisher today) and
  any limits Tobler should respect.
- **17 Nov (evening), unparked by Rob: a name index.** A nightly harvest of feature names and outlines from
  named-feature layers (licence blocks, fields, protected areas, wind leases, marine sanctuaries) into the atlas
  database, so a named search is one query instead of asking up to 40 live services. Wanted for speed: Tobler is now
  a screening tool and named lookups ("block GC 807", "Flower Garden Banks") should be quick. Needs a licence check
  first: it copies names and outlines rather than pointing at the services. Rob's call on the licence question.
