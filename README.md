# 🎄 The 16th Annual Holiday Guide

*Shop Local For Gifts And More.*

An interactive, illustrated map of local Christmas businesses — tree farms, bakeries,
cocoa counters, toymakers and trim shops — built with [Leaflet](https://leafletjs.com)
on top of Stadia Maps' hand-painted **Stamen Watercolor** tiles, dressed in a flat
vector style that follows the illustrated header artwork.

Hover a pin (or a card in the sidebar) and a little paper card unfolds with the
business name, a short blurb, its address and hours, and a link to their site.
The card stays put while your cursor travels to it, so the link is actually
clickable — click a pin to keep the card pinned open, `Esc` or click the map to
put it away.

## Running it

Everything is static — no build step, no dependencies to install. Leaflet 1.9.4 and
both typefaces (Fredoka, Nunito Sans) are vendored in `vendor/`, so there are no CDN
or Google Fonts requests and the page works offline. Because the directory is loaded with
`fetch`, it does need to be served over HTTP rather than opened as a `file://` URL:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static host works for deployment — GitHub Pages, Netlify, S3, a folder on nginx.

## Map tiles and the Stadia API key

The watercolor tiles come from Stadia Maps, who host the Stamen designs. They serve
key-free on `localhost` / `127.0.0.1`, so local development needs no setup. **On any
other domain you need a free API key**, or the tiles come back 401 and the map stays
blank (the page will tell you so, in that case).

Register at [client.stadiamaps.com](https://client.stadiamaps.com), then pick either route:

- **API key** — create one and drop it into `js/app.js`:

  ```js
  var STADIA_API_KEY = "your-key-here";
  ```

- **Domain allowlist** — add your domain to your Stadia property's allowed domains, and
  keyless requests from that origin are authenticated by their `Origin` header. Nothing
  to put in the code, and no key to leak in a public repo.

If no tiles load at all, the map raises a notice explaining this rather than sitting
blank. It waits for several consecutive failures with nothing painted, so a single
unlucky tile won't trigger it, and it clears itself if the tiles start arriving.

Attribution for Stadia, Stamen, OpenMapTiles and OpenStreetMap is already wired into
the map's attribution control; their terms require you to keep it visible.

Two layers are stacked: `stamen_watercolor` for the painting, and a translucent
`stamen_terrain_labels` overlay so street names stay readable on top of it. Watercolor
is only painted down to zoom 16, so it is set to upscale past that (`maxNativeZoom: 16`)
rather than vanish and leave the labels floating on blank paper.

## The directory data

All content lives in [`data/businesses.json`](data/businesses.json) — nothing about a
business is hard-coded in the HTML or JS. Edit that file and reload.

```jsonc
{
  "meta": {
    "titleLead": "The 16th Annual",     // small line above the name; omit to drop it
    "title": "Holiday Guide",           // the name itself, set large
    "subtitle": "…",                    // banner tagline
    "center": [44.4759, -73.2121],      // initial view (the map then fits all pins)
    "zoom": 15,
    "attributionNote": "…"              // small print at the foot of the sidebar
  },

  "categories": {
    "bakery": {                         // key referenced by each business
      "label": "Bakeries",              // shown on chips, cards and the legend
      "color": "#e54b3c",               // colours the pin and its dot everywhere
      "icon": "cookie"                  // white glyph drawn inside the pin; one of
                                        // tree, cookie, cup, star, gift, bauble
    }
  },

  "businesses": [
    {
      "id": "sugarplum-bakehouse",      // unique; used internally to link pin ↔ card
      "name": "Sugarplum Bakehouse",
      "category": "bakery",             // must match a key in "categories"
      "blurb": "One or two sentences.",
      "url": "https://example.com",     // optional — the card's link button
      "address": "88 Church St",        // optional
      "hours": "Daily, 7am–4pm",        // optional
      "coords": [44.4771, -73.2126]     // [latitude, longitude]
    }
  ]
}
```

### Adding a business

Append an object to `businesses` with a unique `id`, a `category` that exists in
`categories`, and `coords` as `[lat, lng]` (right-click a spot in Google Maps to copy
them in that order). New categories only need a label, a colour and an icon
name — the filter chips, legend and pin colours all build themselves from that map.

Text from the JSON is HTML-escaped before rendering, so apostrophes and ampersands
in business names are safe.

> The businesses shipped here are sample data — fictional shops scattered around
> Burlington, Vermont. Swap in your own.

## What's in the box

```
index.html              page shell — masthead, illustrated band, sidebar, map frame
css/styles.css          the flat look: palette, masthead, cards, pins, snowfall
js/app.js               map setup, pins, hover cards, filtering, search, legend
data/businesses.json    the directory itself
assets/holiday-header2.svg   the header illustration (holiday-header.svg is the
                             earlier crop, kept but unused)
vendor/leaflet/         Leaflet 1.9.4 (BSD-2-Clause), vendored
vendor/fonts/           Fredoka + Nunito Sans (SIL OFL), vendored
```

The page palette is taken from the header artwork's own swatches — greige `#eae6e2`,
teal `#9fd0d2`, purple `#633d7a`, coral `#e54b3c`, pink `#e697aa`, gold `#f8a92d`,
green `#2cac84`, navy `#4d6998` — so the illustration sits flush against the page
with no visible seam. The band is sized in `vw` so the artwork's figures are never
cropped, whatever the viewport.

## Features

- **Illustrated hover cards** that survive the trip from pin to link, plus click-to-pin.
- **Category filter chips** and a **search box** matching name, blurb, address and category.
- **Sidebar directory** kept in sync with the map — hover a card to light up its pin.
- **Flat vector pins** drawn as inline SVG, coloured per category, each with a white glyph.
- **Keyboard support** — cards are focusable, `Enter`/`Space` opens a card, `Esc` closes it.
- **Falling snow**, respecting `prefers-reduced-motion`.
- **Responsive** — the sidebar stacks above the map on narrow screens and the page scrolls.
- **AA contrast** on every text/background pair, including the chips and card links.
