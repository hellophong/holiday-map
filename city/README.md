# City Edition

A second look-and-feel for the same directory, living side by side with the original at
the repo root rather than replacing it. Both are live at once:

- `hellophong.github.io/holiday-map/` — the original
- `hellophong.github.io/holiday-map/city/` — this one

## What's shared vs. what's this folder's own

| Shared from the parent folder | Owned by `/city/` |
|---|---|
| `../vendor/leaflet/`, `../vendor/fonts/` | `css/styles.css` — a snowy Richmond storefront street, not the original's flat illustrated scene |
| `../js/app.js` — same map/popup/filter logic | The header artwork — `assets/holiday-header2-nobg.svg` (desktop), `assets/holiday-header2-mobile-nobg.svg` (≤860px) |
| `../data/businesses.json` — same 11 listings | This `index.html`, including the light/dark toggle |

`index.html` sets `window.DATA_URL = "../data/businesses.json"` before loading the shared
`app.js`, so both pages read the same business data — add a listing once, it shows up in
both looks. There's no copy of `app.js` here on purpose: the interactive behavior isn't
what's meant to change between "looks," so nothing here should ever need to reimplement it.
If City Edition ever needs its own data or its own behavior, that's the point where it'd
need its own `app.js` / `data/businesses.json` instead of pointing back at the parent's.

## The header art

Two separate illustrations, not one image resized — `index.html` uses `<picture>` with a
`(max-width: 860px)` source, since the mobile crop is composed differently (a roughly
square street-corner scene: the GIFTS shopfront, a snowman, the Richmond Magazine sign)
rather than a narrower slice of the wide desktop banner.

Both `-nobg` files are transparent — no sky rect of their own — which is what makes the
headline sit *overlapping* the art rather than stacked above it in its own block, on both
breakpoints: `.banner__scene` (or its img, on desktop — see below) is pulled up with a
small negative `margin-top` to tuck under the header text, and it only reads as "under the
text" instead of "on top of it" because the art carries a margin of plain sky above its
own rooflines and the negative value is kept smaller than that. That margin isn't
something you can read off the source file's viewBox — it's confirmed by literally
decoding the rendered art's alpha channel at its real on-page size and finding the first
non-transparent row. A version with a background rect (the original `holiday-header2.svg`
/ `-mobile.svg`, still in `assets/` but unused) couldn't do this at all: cropping it down
to a band (`object-fit: cover`) is what an older version of this file described, and that
crop is fundamentally at odds with an overlapping banner.

**Desktop and mobile size the art completely differently, though** — this isn't just a
breakpoint tweak, it's two different strategies:

- **Desktop** caps the whole banner (`.banner`) at `height: 25vh` (a `min-height` floor
  protects the headline text on very short windows) so the sidebar/map stay the visually
  dominant part of the page rather than competing with the header — an explicit ask after
  an earlier draft let the banner grow as tall as the art's own ratio implied on a wide
  window, which made the header the biggest thing on the screen. `.banner__scene` is
  `flex: 1 1 auto` inside that fixed-height column, so it only ever gets whatever's left
  after the headline text's own height, and the img is `object-fit: contain` within that —
  never cropped, but also usually well short of full window width, since there generally
  isn't much leftover height to work with at a 25vh cap. The overlap margin here is a small
  *positive* gap, not a pull-up: at this size the art's own clear-sky margin shrinks (in
  real pixels) right along with it, down to a few px — nowhere near enough room to safely
  pull it up under the text the way the taller, uncapped version could.
- **Mobile** doesn't have a fixed-viewport layout to protect (the page already scrolls), so
  none of that applies: the art renders at its full natural size, `width: 100%` of the
  window, and *does* get pulled up under the text with a real negative margin, the same way
  desktop's used to before the 25vh cap.

A short, wide desktop window (1280×720, say) still ends up with a visibly smaller map
underneath than a taller one — the fixed 25vh eats a bigger fraction of a short window —
but it stays fully usable, and the popup's own `maxHeight` safety net (see the root's
`CLAUDE.md`) is exactly the thing designed to cover a short desktop window regardless of
what's above the map.

Neither file was drawn with a night sky, so dark mode doesn't swap in a second image — it
darkens and cools the one it has (`filter: brightness() saturate() hue-rotate()`), which
reads as dusk well enough without needing a whole second illustration per theme. That's
the *only* treatment dark mode needs now: with no background rect to blend, there's no
seam left for a gradient overlay to hide (an earlier version of this had one, for the
previous background-carrying assets — removed along with them). If a real night-sky
version ever gets drawn, swap it in via the same `[data-theme="dark"]` /
`prefers-color-scheme` pair already used for the CSS variables below, rather than fighting
the filter approach further.

## Palette

Lifted from the header artwork itself rather than reusing the root's coral/mint/purple
scheme: brick red, mustard gold, evergreen and denim blue on a pale winter-sky ground.
`--ink` and `--ink-soft` stand in for the root's purple ink; `--title` is a separate denim
tone for the banner headline so it doesn't just read as body text at a larger size.

One known gap: pin and badge numbers still pick their text colour (white vs. a fixed deep
ink) via `numberStyle()` in the shared `js/app.js`, which is hardcoded to the root's own
purple rather than reading this page's `--ink`. That's shared *behavior* (contrast math),
not shared *look*, so it wasn't forked for this — pin numbers may occasionally land on a
faint purple-tinted dark rather than this theme's navy when a swatch colour needs the
deepen-for-contrast fallback. Fixing it properly means teaching `numberStyle()` to accept
an ink colour rather than hardcoding one, which is a `js/app.js` change and affects the
root too.

## Light/dark mode

A toggle in the banner (`#themeToggle`) flips `<html data-theme>` between `"light"` and
`"dark"`, persisted in `localStorage` under `cityTheme`. A visitor who's never touched it
gets `prefers-color-scheme` via CSS alone — nothing in `index.html`'s inline script writes
an attribute until the toggle is actually clicked, so an explicit pick is the only thing
that can override the OS setting, and it keeps doing so even if the OS setting changes
later in the same visit. The inline script in `<head>` (before the stylesheet link) applies
a saved choice before first paint, so there's no flash of the wrong theme on load.

Every colour token in `css/styles.css` is written three times on purpose: once bare on
`:root` (light, the default), once under `@media (prefers-color-scheme: dark)` guarded by
`:not([data-theme="light"])` (so a dark OS preference doesn't override an explicit light
pick), and once under `:root[data-theme="dark"]` (so an explicit dark pick applies
regardless of the OS setting). All three need updating together if a token's value ever
changes.

The basemap follows the same rule: `js/app.js` loads Stadia's `alidade_smooth_dark`
instead of `alidade_smooth` when the effective theme is dark, gated behind
`window.THEME_AWARE = true` (set in the `<script>` right before `js/app.js` loads, next
to `window.DATA_URL`) so the root page — which has no dark palette at all — never has its
map tiles follow a visitor's OS preference on its own. The toggle's click handler calls
`window.refreshMapTileStyle()` (defined by `js/app.js` once the map exists) right after
flipping `data-theme`, which swaps the live tile layer's URL via Leaflet's `setUrl()` —
no page reload, no rebuilding the layer. The OS-preference `change` listener calls it too,
for a visitor who never made an explicit pick and whose system flips theme mid-visit.
