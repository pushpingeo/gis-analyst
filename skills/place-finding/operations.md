# Operations used by the place-finding skill

What each operation must do in any setting, then the Tobler tool that does it. All coordinates are WGS84
longitude/latitude; distances and areas are geodesic; shapes are built by code, never by the model.

## find_place: find a named place, asset or feature
- **Does:** searches gazetteers (OpenStreetMap, Wikidata, a world towns list) and authoritative layers for a name,
  in several spellings at once; optionally, for a *kind* of thing (licence block, field, well, wind lease, protected
  area, admin area, road…) in an *area*, asks a catalogue of published map layers which layers hold that kind of
  thing there and searches them for the name.
- **Returns:** candidates with an id, name, type, source (publisher, title, licence), position, and size or outline
  where known; which layers or sources were searched, which failed and which weren't reached.
- **Tobler:** `find_place` (`js/placetools.js`), using the AI Living World Atlas through `tobler-api`.

## find_features_near: features of a type near an anchor
- **Does:** finds features of a given type (mine, solar farm, main road, river, protected area, school…) within a
  radius of a found place, from the catalogue and OpenStreetMap at once.
- **Returns:** candidates with distance (to the nearest edge for areas and lines) and bearing; which sources answered.
- **Tobler:** `find_features_near`.

## make_place: build the shape
- **Does:** builds a point, square, circle, rectangle, buffer or corridor, or takes a feature's own outline, from an
  anchor, optionally offset by a distance and bearing and rotated; measures every distance clue given as a check;
  rates confidence by fixed rules (see the skill's "Confidence" section), not by the model.
- **Returns:** the place's size and location in words, the construction steps, the confidence and the rules behind it.
- **Tobler:** `make_place`; shapes in a local projection (`js/geometry.js`), confidence in `js/confidence.js`.

## offer_choices: let the person pick
- **Does:** shows two to five candidates with their sources and a recommendation, and waits for the person's choice.
- **Tobler:** `offer_choices` (a carousel on the map).

## edit_place, get_place: change or read a place
- **Does:** rotate, resize to an area or length, move along a bearing, rename; or return a place's details and how it
  was made.
- **Tobler:** `edit_place`, `get_place`.

## find_data, get_data: data about a topic (used alongside this skill)
- **Does:** searches a catalogue of published layers by words in titles and publishers for an area; fetches one
  layer's features in or near a place, measured from its edge, with dates, publisher and licence.
- **Tobler:** `find_data`, `get_data` (`js/datatools.js`).

## Failures, in any setting
A source that fails or isn't reached is reported as *not checked*, never as *nothing found*. Say which.
