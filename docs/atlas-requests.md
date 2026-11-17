# Requests to the atlas

Tobler and the atlas are worked on in separate chats (decided 17 Nov). Tobler doesn't edit the atlas repo.
What Tobler can rely on is written down in the atlas repo's `docs/mcp-tools.md`. When Tobler needs something
new from the atlas, add it here (newest first), tell Rob, and he passes it to the atlas chat.

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
