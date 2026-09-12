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
banner read as seamless: `.banner__scene img` is sized by `max-width: 100%` /
`max-height` (260px desktop, 320px mobile) and nothing else, the plain "cap whichever
dimension would otherwise overflow" pattern an ordinary `<img>` already gives you for
free. Nothing here ever crops the art — nothing needed to, once it had no background of
its own to crop *down to* a band. A version with a background rect (the original
`holiday-header2.svg` / `-mobile.svg`, still in `assets/` but unused) would need cropping
again to avoid showing a mismatched rectangle of illustrated sky; don't switch back to one
without also reintroducing that `object-fit: cover` + `object-position` handling.

The max-height figures exist for desktop's sake, not the art's: the fixed one-viewport
layout below the banner (`.layout { flex: 1 1 auto }`, no page scroll) gets squeezed if
the banner is allowed to grow as tall as the illustration's own ratio implies on a wide
window, so it's capped — the image just renders smaller (and narrower, `max-width` and
`max-height` shrinking it together) rather than ever being cut off. Mobile has no such
fight (the page already scrolls), hence the taller cap there.

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
