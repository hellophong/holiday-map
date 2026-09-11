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

**Exactly one popup is ever open.** `refreshDisplay()` is the only place that opens or
closes a marker's popup; `displayedId()` (hover if any, else the pinned id, else none)
decides which one, and every other marker is explicitly closed before that one opens.
Hovering a different marker while one is pinned used to leave both open, because the old
code spared the pinned id from its "close everyone else" sweep — two cards could overlap
on the map. Don't special-case an id out of that sweep again; ending a hover with nothing
else to show falls back to the pinned card on its own, so nothing needs to reopen it by
hand.

**Pan before opening the popup, never after.** `map.panTo()` recentres on the marker's
raw coordinates with no idea how tall the popup about to open is; Leaflet's own `autoPan`
does know, but only if it runs last. Calling `panTo` after `openPopup()` — even though
the pan is still animating — updates the map's centre immediately and undoes autoPan's
adjustment, which could leave a tall card's top pushed out above the map entirely with
nothing to say so. `refreshDisplay()` calls `panTo` first, then opens.

**Popups get a live `maxHeight`, recomputed at open time.** `.map-frame`'s rounded
corners come from `overflow: hidden`, which clips a popup taller than the box exactly
the way it clips everything else. The longest real listing (address + hours + phone)
renders around 440px; desktop is a fixed one-viewport layout with no scroll to fall back
on, so a short window can be shorter than that. `popupMaxHeight()` caps the popup to the
map's current rendered height minus a margin right before each open, so a card that
doesn't fit gets Leaflet's own small internal scrollbar instead of losing content to an
invisible clip. On today's business copy this shouldn't ever actually trigger except on
an unusually short desktop window — it's a safety net for a future longer listing, not
the normal path.

**`bindPopupHoverKeepAlive()`'s "mouseenter" checks `hoverSuppressed()` too, same as
every other hover entry point.** It didn't used to: its whole job is letting the pointer
travel from a pin onto its own just-opened card without losing it, which needs to keep
working even mid `HOVER_CLOSE_DELAY`, so it seemed exempt from the suppression every other
hover path respects. But a *previous* selection's card keeps this same handler bound while
it's still open, and on mobile, tapping a sidebar row scrolls the page via `scrollToEl()`
— if a still cursor ends up sweeping across that stale, not-yet-closed card as the page
animates underneath it, that's a real mouseenter, and it fired `showCard()` for whatever
the cursor landed on, silently redirecting the display to a row nobody touched. Nothing
ever sent a matching mouseleave afterward (the cursor doesn't move again once the scroll
settles), so this wasn't a one-frame flicker — the display stayed wrong until the next
real interaction. `hoverSuppressed()` is only ever true in that same mobile scroll window
(`scrollToEl` is the one thing that sets it, and it only runs on mobile), so gating on it
here costs nothing on desktop's legitimate pin-to-card hover, which never runs under
suppression.

**The mobile "click a row, scroll to the map" sequence runs `scrollToEl()` before
`pinCard()`, not after.** `scrollToEl()` is what sets `suppressHoverUntil`; calling
`pinCard()` first left a gap — its own synchronous work — during which the page could
already be sliding a *different* sidebar row under a still cursor with nothing yet
guarding against it. Leaflet's own panning doesn't care about page scroll order (it
reasons entirely in the map container's own coordinates, never the page's), so swapping
the two costs nothing there.

**A selected card gets nudged to sit centred in the frame, not just inside it —
`centerDisplayedGroup()`, mobile only.** Fitting (`popupMaxHeight`, `autoPan`) isn't the
same as looking centred: `autoPan` only pans the minimum needed to satisfy its own
padding, so a card can end up flush against the frame's top edge with all the slack left
below it — technically uncropped, but visually lopsided, especially once the map is the
whole screen a moment after tapping a row. This runs once the initial pan (and whatever
correction `autoPan` made when the popup opened) has already landed — by the time
`openPopup()` returns, both have, since `_adjustPan` always stops any in-flight `panTo`
animation the instant a popup opens, whether or not it ends up needing its own correction
— and nudges the map so the popup+marker group sits in the middle of the frame instead of
wherever `autoPan` happened to leave it, clamped to never ask for more than the slack
that's actually there. It also runs a second time, timed just past
`HOVER_SUPPRESS_MS + HOVER_CLOSE_DELAY`: idempotent and staleness-checked (skips outright
if a different card is displayed by the time it fires), so it's a no-op once the first
pass already centred things, and a real correction if a stray hover in that window nudged
them since — see the `hoverSuppressed()` invariant above for exactly how that happens.

**A marker's popup only calls `openPopup()` when it isn't already open, or when this call
is actually panning.** `refreshDisplay()` used to call `marker.openPopup()` every time, on
the theory that Leaflet no-ops if that marker's popup is already showing. It doesn't:
`openPopup()` goes through `_prepareOpen()`, which unconditionally calls `update()` →
`_updateContent()` → `contentNode.innerHTML = sameString`, rebuilding every child node
even when the content hasn't changed. `bindPopupHoverKeepAlive()`'s own "mouseenter" on
the popup calls back into `refreshDisplay()` on every hover — including hovering from one
part of an already-open card toward another, with no pin involved — so a cursor moving
from the card's edge toward "Visit their site" or the phone number tore out and replaced
that exact link mid-approach, sometimes mid-click. The rebuilt link is byte-identical
HTML, so nothing *looked* wrong; the popup just silently ate the click. `refreshDisplay()`
skips the reopen when `marker.isPopupOpen()` is already true — *unless* this call also
just panned: `panTo()` recentres on the marker's raw coordinates with no idea how tall the
popup is, and it's `openPopup()`'s own `autoPan` that makes the popup-aware correction
afterward. Skipping the reopen on every already-open popup, with no exception, silently
broke that correction on mobile: tapping a sidebar row fires that row's own hover-driven
open first (wherever the map already happened to be centred), so by the time the tap's
`pinCard()` runs, the popup is already open, and skipping its reopen skipped the only
`autoPan` call that knew the card's real height — leaving a plain recentre's crop
uncorrected. So: skip the reopen for a redundant same-marker hover, never for an actual
pan.

**On-map Leaflet controls that aren't the zoom/attribution chrome share a
`.map-panel` class, and it's `pointer-events: none`.** Popups render inside
`.leaflet-map-pane`, which Leaflet gives a CSS `transform` for panning — that transform
makes it a stacking context of its own, so no z-index on a pane inside it can ever
out-rank `.leaflet-control-container`, a later sibling entirely outside that context;
raising `.leaflet-popup-pane`'s z-index only reorders it among the map's *own* internal
layers, changing nothing relative to the controls. This class used to also style an
on-map category legend (bottomleft) — removed since the sidebar's filter chips already
carry a colour dot per category, making the legend a third rendering of the same key
(chips, the mobile strip, and the on-map box) — and that legend is exactly how this got
found: a popup opening in the same corner silently lost clicks on "Visit their site" and
the phone number to the legend sitting over it, because Leaflet's control stacking always
wins there regardless of the popup pane's own z-index. `.map-panel` currently styles just
the tile-failure notice, which is equally static and non-interactive, so the same
`pointer-events: none` applies pre-emptively. Any future on-map control built from this
class that similarly doesn't need clicks is already covered; one that does would need its
own exception.

**All colour-on-colour pairs go through `numberStyle()`.** It picks white or deep purple
for a number label by contrast, and where neither reaches 4.5:1 it deepens the fill until
white does. Pins, sidebar badges, popup badges, chips, and the mobile legend strip's dots
all use its output, so a pin and its chip dot always match. Categories added later inherit
this automatically — do not hardcode a label colour.

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

## Second look-and-feel: /city/

`city/` is a second theme for the same guide, live alongside the root at
`/holiday-map/city/` rather than replacing it — see `city/README.md` for the full
breakdown. It shares `../vendor/`, `../js/app.js`, and `../data/businesses.json` with the
root; it owns its `index.html` and `css/styles.css`. Nothing here is a copy-paste fork of
the whole site — only what's meant to actually differ (the look, eventually the header
image) lives in `city/` at all.

`js/app.js` reads `DATA_URL` from `window.DATA_URL || "data/businesses.json"` for exactly
this: `city/index.html` sets `window.DATA_URL = "../data/businesses.json"` before loading
the shared script, so both pages stay on one source of business data with no risk of the
two drifting apart. Fetch paths resolve against the *document* that loaded the script, not
against `app.js`'s own location — that's why this needed a variable rather than a
hardcoded relative path.

A `city/css/styles.css` `url()` path needs one more `../` than the same path in the root
stylesheet, since the file itself sits one directory deeper — this bit the vendored font
`@font-face` rules once already (they 404'd, invisibly falling back to a system font)
before being caught by checking the network tab, not just eyeballing the page.

If a future variant needs different behavior, not just a different look, that's the
signal it needs its own `app.js` (and possibly its own `data/businesses.json`) instead of
pointing back at the root's — the sharing exists because "look and feel" was explicitly
the only intended difference, not because every future page under this repo should share
logic with the root by default.

## Deploying

Development happens on `november-2026` (renamed from `main`, which still exists but is
no longer kept in sync — confirm in Settings → Pages which branch actually deploys
before assuming either one is live). The repo owner also pushes directly to
`november-2026`, so fetch before pushing and merge rather than rebase if it has moved.
