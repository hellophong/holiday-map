# City Edition

A second look-and-feel for the same directory, living side by side with the original at
the repo root rather than replacing it. Both are live at once:

- `hellophong.github.io/holiday-map/` — the original
- `hellophong.github.io/holiday-map/city/` — this one

## What's shared vs. what's this folder's own

| Shared from the parent folder | Owned by `/city/` |
|---|---|
| `../vendor/leaflet/`, `../vendor/fonts/` | `css/styles.css` — a snowy Richmond storefront street, not the original's flat illustrated scene |
| `../js/app.js` — same map/popup/filter logic | The header artwork — `assets/holiday-header2.svg` (desktop), `assets/holiday-header2-mobile.svg` (≤860px) |
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

Both files are transparent (no sky rect of their own) and drawn at a genuinely
banner-shaped ratio already — 2000×300 desktop, 500×260 mobile, wide and short rather
than a taller scene that would need cropping down to that shape. That's what makes a
plain `width: 100%; height: auto` enough to show either one whole, at whatever width it's
given, with no `object-fit` gymnastics: the ratio itself is already right for a header.
(Earlier versions of both this file and this asset were a much taller illustration
needing real cropping or letterboxing to fit a banner — if a future asset swap ever goes
back to something that tall, expect to reintroduce that.)

**The art's width matches `.banner__inner` — same `max-width: 1400px`, same horizontal
padding — which is deliberately also `.layout`'s own content width (the sidebar + map
below it), not the window's.** An earlier version of this spanned the full browser
window edge to edge; this one lines up with the directory instead, so the banner reads as
part of the same content column rather than a full-bleed hero strip. Mobile matches
`.layout`'s own mobile padding specifically (`.8rem`, not `.banner__inner`'s `1rem`) since
the two differ slightly and matching the sidebar's actual width is the point.

Night mode does **not** darken this artwork — an earlier version ran it through
`filter: brightness() saturate() hue-rotate()` to read as dusk, but that just made the art
look off rather than intentionally nocturnal, so night/day mode now only restyles the
surrounding chrome (CSS variables, map tiles) and leaves the header image's own
brightness/saturation untouched in both themes. If a real night-sky illustration ever
gets drawn, swap it in via the same `[data-theme="dark"]` / `prefers-color-scheme` pair
already used for the CSS variables below — that's the place for a theme-driven header
look, not a filter on the daytime art.

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
`"dark"`, persisted in `localStorage` under `cityTheme`. The toggle's visible label reads
"Night mode" / "Day mode" (desktop only — the label text is hidden ≤560px, leaving just
the sun/moon icon) even though the underlying attribute value, storage key and CSS guards
all still say `light`/`dark`; only the user-facing wording changed. A visitor who's never touched it
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
