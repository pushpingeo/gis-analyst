# Reference layers

Natural Earth (public domain, naturalearthdata.com), simplified for the browser by `scripts/build-reference.mjs`.

| File | Source | Kept |
|---|---|---|
| countries.json | 1:10m admin 0 countries | name, ISO code, sovereign state |
| coastline.json | 1:10m coastline | geometry |
| places.json | 1:10m populated places | name, country, region, population, rank |
| rivers.json | 1:50m rivers | name, rank |
| lakes.json | 1:50m lakes | name, rank |

These are made for regional and global views. Borders follow Natural Earth's de facto conventions, and the
coastline is accurate to roughly a kilometre, so site-scale work uses OpenStreetMap instead.
