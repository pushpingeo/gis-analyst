# Operations used by the coordinate reference skill

What each operation must do in any setting, then the Tobler tool that does it. The reference data behind all of them
is the EPSG Geodetic Parameter Dataset (IOGP, epsg.org), read live from its API or from a copy (PROJ's `proj.db`
carries the whole dataset as SQLite). Always report which version was used.

## read_coordinates: read coordinates from text
- **Does:** recognises decimal degrees (with or without hemisphere letters, labelled or not), degrees-minutes-seconds
  and degrees with decimal minutes, national grid references and eastings/northings; converts to WGS 84
  longitude/latitude; keeps the other reading when the axis order is ambiguous.
- **Returns:** the position, the form it was read as, the order, the datum (stated or assumed), the precision (a grid
  square's size), the operation used for any datum change, and the other reading if there is one.
- **Tobler:** `js/coords.js` (`parseCoordinates`), used by `find_place` and by the page before the analyst sees a
  message. British National Grid only so far (OSGB36 → WGS 84 by EPSG:1314); other grids follow the EPSG tools.

## crs_lookup: what a CRS is
- **Does:** finds a CRS by EPSG code or by name words.
- **Returns:** code, name, kind (geographic, projected, vertical, compound), datum and ellipsoid, axes with their order,
  directions and units, the conversion (method and parameters) for projected CRSs, area of use (description and
  bounding box), deprecation and replacement, remarks, and its WKT2. For a name search, the best few matches with
  their areas, deprecated ones last.
- **Tobler:** `crs_lookup`, through the Worker's `/epsg` route to the EPSG API (cached).

## transformation_options: which operations apply here
- **Does:** for a source CRS, a target CRS and a site (a point or an outline), lists the coordinate operations between
  them (transformations, concatenated operations), keeps those whose area of use contains the site, drops deprecated
  ones and follows supersessions, and ranks them: stated accuracy (best first), then whether it can be applied
  (grid files), then the smaller area of use, then the latest revision.
- **Returns:** the ranked options, each with code, name, method, stated accuracy, area of use and why it's in or out;
  the recommended one; where the tool can compute it, how far apart the options put the site, in metres; the dataset
  version.
- **Tobler:** `transformation_options`, through `/epsg`. Honours the person's `transformation_choice` setting
  (`choose` or `ask`).

## transform: apply an operation
- **Does:** moves coordinates from one CRS to another with a named operation (never an unnamed default), and records
  it.
- **Returns:** the coordinates, the operation applied and its stated accuracy.
- **Tobler:** British National Grid → WGS 84 in `js/coords.js` (EPSG:1314). General transformation in the page needs a
  projection library; until then, other datums are looked up and reported, not applied.

## measure_equal_area: share of an area, overlays
- **Does:** intersects and measures areas in a Lambert azimuthal equal-area projection centred on the area of
  interest.
- **Returns:** areas and shares, with the projection's centre recorded in the method.
- **Tobler:** `laea` and `coverageIn` in `js/siterole.js`.
