# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running it

Static site, no build step, no package manager, no test suite. `data/businesses.json` is
loaded with `fetch`, so it must be served over HTTP — opening `index.html` as a `file://`
URL fails:

```bash
python3 -m http.server 8899        # then http://127.0.0.1:8899
```

There is nothing to lint or compile. `node --check js/app.js` and
`python3 -c "import json; json.load(open('data/businesses.json'))"` are the only syntax
gates worth running before a commit.

## Verifying changes

With no tests, the way to check work is to drive the page in a real browser. If Playwright
and a Chromium build are available, load the page, then assert against the DOM — pin count
vs. listing count, sidebar numbers vs. `.pin text`, popup contents, computed colours and
contrast ratios. Two things that need explicit setup:

- **Tile requests will fail** unless the environment can reach `tiles.stadiamaps.com`.
  Intercept `**://tiles.stadiamaps.com/**` and fulfil with a flat placeholder PNG so
  layout and pin contrast can still be judged. Screenshots taken this way show a blank
  map area — say so rather than implying the basemap was seen.
- **Popups auto-pan.** Opening one shifts the map, so measure the opening view *before*
  hovering anything.

Geocoding services and most third-party sites are typically blocked here. Do not derive
coordinates by interpolating street numbers — ask for them (Google Maps right-click →
copy coordinates) rather than shipping a guessed pin.

## Architecture

`js/app.js` is one IIFE with no modules or framework. `data/businesses.json` drives
everything — categories generate the filter chips, legend, and pin colours; no business
or category is hard-coded in HTML, CSS, or JS. Adding a listing or a category is a JSON
edit alone.

`state` holds `markers` (id → Leaflet marker), `numbers` (id → directory number),
`activeId` (clicked/pinned), `hoverId`, plus the filter set and query. The sidebar and the
map are two views over the same state, kept in sync through `syncActiveStyles()`.

## Invariants worth preserving

These encode decisions that took iteration; changing them silently regresses behaviour.

**Numbering is assigned once over the whole directory.** `assignNumbers()` runs at load
over every listing sorted alphabetically. Filtering and searching hide rows — they never
renumber. A pin labelled 7 must stay 7 when the sidebar shows one row. Any change that
numbers listings at render time breaks the pin↔list correspondence.

`sortKey()` strips a leading "The" so "The Byrd Theatre" files under B. Only "The" — "A"
and "An" are far likelier to be a real first word.

**Hover cards are popups, not tooltips.** A Leaflet tooltip disappears the moment the
pointer moves toward it, making the link unclickable. The card is a popup with a
`HOVER_CLOSE_DELAY` grace period that `bindPopupHoverKeepAlive()` cancels while the
pointer is over the card itself. Clicking pins it open until `Esc` or a map click.

**All colour-on-colour pairs go through `numberStyle()`.** It picks white or deep purple
for a number label by contrast, and where neither reaches 4.5:1 it deepens the fill until
white does. Pins, sidebar badges, popup badges, chips and legend dots all use its output,
so a pin and its legend dot always match. Categories added later inherit this
automatically — do not hardcode a label colour.

**The map does not fit its pins.** `meta.center` / `meta.zoom` are used as given.
`fitBounds` was removed deliberately: outlying listings (Louisa, the Northern Neck) pulled
the view back ~100 miles and squashed the Richmond cluster where most of the guide lives.
Retune the opening view in the JSON, not in code.

**Everything is vendored.** Leaflet and both typefaces live in `vendor/`; there are no CDN
or Google Fonts requests. A weight used in CSS needs a matching `@font-face` and file —
asking for `font-weight: 500` with only 400 and 700 present renders the 400.

**The header artwork is referenced with `<img>`, never inlined.** The Illustrator export
carries a `<style>` block of generic `.st0`–`.st15` class names that would leak into the
page. `.banner__scene` is sized in `vw` because the drawn content occupies a fixed
fraction of the canvas width — that keeps figures, chimneys and skates uncropped at any
viewport. Its background matches `--greige` exactly, so the band blends seamlessly.

**Stacked layout needs `.layout { flex: 0 0 auto; min-height: auto; }`.** Without it the
grid shrinks to the leftover viewport height, the sidebar's flex column collapses its card
list to a few pixels, and `overflow: hidden` clips the directory after the first row. This
regressed twice. When checking mobile, measure the *sidebar's* height against its content,
not just the list's.

**Text from JSON is escaped** via `esc()` before insertion. Keep new fields going through
it.

## Map tiles

Single layer, `alidade_smooth`, zoom 1–20, `{r}` for HiDPI. It carries its own street
lettering, so no labels overlay. Stadia serves key-free on `localhost`/`127.0.0.1` only;
any other origin needs an API key in `STADIA_API_KEY` or an allowlisted domain, or every
tile returns 401. The tile-failure notice waits for three failures with nothing painted —
so one unlucky tile doesn't trigger it — and removes itself if tiles start arriving.
Attribution for Stadia, OpenMapTiles and OpenStreetMap must stay visible.

## Content conventions

Supplied business copy is usually several sentences of marketing text; blurbs are
condensed to one or two while keeping the distinctive specifics. Publish `hours` only when
they come from the business's own copy — hours scraped from a third-party listing may be
stale, and a wrong time in a holiday guide sends someone to a locked door.

## Deploying

GitHub Pages serves `main`. Development happens on `claude/christmas-business-map-h7galy`;
both branches are kept at the same commit. The repo owner also pushes directly to the
branch, so fetch before pushing and merge rather than rebase if it has moved.
