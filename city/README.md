# City Edition (draft)

A second look-and-feel for the same directory, living side by side with the original at
the repo root rather than replacing it. Both are live at once:

- `hellophong.github.io/holiday-map/` — the original
- `hellophong.github.io/holiday-map/city/` — this one

## What's shared vs. what's this folder's own

| Shared from the parent folder | Owned by `/city/` |
|---|---|
| `../vendor/leaflet/`, `../vendor/fonts/` | `css/styles.css` — starts as a copy of the root's, meant to diverge |
| `../js/app.js` — same map/popup/filter logic | The header image (once one exists) |
| `../data/businesses.json` — same 11 listings | This `index.html` |

`index.html` sets `window.DATA_URL = "../data/businesses.json"` before loading the shared
`app.js`, so both pages read the same business data — add a listing once, it shows up in
both looks. There's no copy of `app.js` here on purpose: the interactive behavior isn't
what's meant to change between "looks," so nothing here should ever need to reimplement it.
If City Edition ever needs its own data or its own behavior, that's the point where it'd
need its own `app.js` / `data/businesses.json` instead of pointing back at the parent's.

## What's still a placeholder

The header band is a dashed box reading "New header image goes here" — deliberately not a
copy of the original artwork, so this page can't be mistaken for a finished second look
before it has one. To finish it:

1. Supply a header image (SVG or PNG) — drop it in `city/assets/`.
2. Swap the `.banner__scene--placeholder` div in `index.html` for an `<img>` pointing at it,
   following the pattern in the root `index.html`.
3. Remove the `.banner__scene--placeholder` rule from `css/styles.css` once nothing
   references it.

Beyond the header, `css/styles.css` is the file to restyle for the actual "look and feel" —
palette, type, pin style, card style — whatever the new theme calls for.
