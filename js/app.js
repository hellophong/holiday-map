/* -----------------------------------------------------------------
   The Merry Mile — an interactive Christmas business directory
   Leaflet + Stadia's Alidade Smooth tiles. No build step.
   ----------------------------------------------------------------- */

(function () {
  "use strict";

  /* Stadia Maps serves the basemap tiles. They work key-free on
     localhost / 127.0.0.1; for any other domain, register a free key at
     https://client.stadiamaps.com and drop it in here (or set
     window.STADIA_API_KEY before this script runs), or allowlist the domain
     on your Stadia property. */
  var STADIA_API_KEY = window.STADIA_API_KEY || "";
  /* Overridable so a second themed page (e.g. /city/) can point back at this
     one's data — see window.STADIA_API_KEY just above for the same pattern.
     Fetch URLs resolve relative to the HTML document that loaded this
     script, not to app.js's own location, which is why a shared script
     needs this rather than a hardcoded relative path. */
  var DATA_URL = window.DATA_URL || "data/businesses.json";
  var HOVER_CLOSE_DELAY = 260; // ms of grace to travel from pin to card

  /* Mirrors the CSS breakpoint that stacks the sidebar above the map. Used
     to gate the mobile-only scroll-to-map and back-to-list behaviour. */
  var MOBILE_QUERY = window.matchMedia("(max-width: 860px)");

  function reducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /* scrollToEl slides pins (or sidebar rows) across whatever the mouse
     happens to be resting on. A stationary cursor still gets a genuine
     mouseover from the browser when content moves underneath it, so a smooth
     scroll can fire a real hover on every marker or card it sweeps past —
     opening a trail of cards that never received an actual mouseleave to
     close them. Hover handling is suppressed for the rough duration of the
     scroll so only deliberate hovers open a card. */
  var HOVER_SUPPRESS_MS = 700;
  var suppressHoverUntil = 0;

  function hoverSuppressed() {
    return Date.now() < suppressHoverUntil;
  }

  function scrollToEl(el) {
    if (!el) return;
    suppressHoverUntil = Date.now() + (reducedMotion() ? 0 : HOVER_SUPPRESS_MS);
    el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  }

  var state = {
    data: null,
    markers: {},          // id -> L.Marker
    numbers: {},          // id -> directory number (alphabetical, stable)
    activeId: null,       // pinned (clicked) business
    hoverId: null,        // business under the cursor
    filters: new Set(),   // empty === show everything
    query: "",
    closeTimers: {}       // business id -> pending hover-close timeout, one per marker
  };

  var map;

  /* --------------------------- Tiles --------------------------- */

  function key(suffix) {
    return STADIA_API_KEY ? suffix + "?api_key=" + encodeURIComponent(STADIA_API_KEY) : suffix;
  }

  function addTiles() {
    var attribution =
      '&copy; <a href="https://stadiamaps.com/" target="_blank" rel="noopener">Stadia Maps</a> ' +
      '&copy; <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

    /* Alidade Smooth carries its own lettering, so it needs no separate
       labels overlay. */
    var base = L.tileLayer(key("https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png"), {
      minZoom: 1,
      maxZoom: 20,
      attribution: attribution
    }).addTo(map);

    base.on("tileload", onTileLoad);
    base.on("tileerror", onTileError);
  }

  /* ----------------------- Tile health notice --------------------- */
  /* A single failed tile at the edge of the view is just noise. Only say
     something once several requests have failed AND nothing has painted at
     all — that pattern means the layer is being refused outright, not that
     one request got unlucky. */

  var TILE_ERROR_THRESHOLD = 3;
  var tileErrors = 0;
  var tilesPainted = 0;
  var tileWarning = null;

  function onTileLoad() {
    tilesPainted += 1;
    if (tileWarning) {           // tiles came back after all — take the notice down
      map.removeControl(tileWarning);
      tileWarning = null;
    }
  }

  function onTileError() {
    tileErrors += 1;
    if (tileWarning || tilesPainted > 0 || tileErrors < TILE_ERROR_THRESHOLD) return;

    tileWarning = L.control({ position: "topright" });
    tileWarning.onAdd = function () {
      var div = L.DomUtil.create("div", "map-legend tile-warning");
      div.innerHTML =
        "<h2>The map didn't arrive</h2>" +
        "<p style='margin:0 0 .35rem;max-width:15rem'>No map tiles are loading. " +
        "Stadia Maps serves them key-free on <code>localhost</code> only — anywhere else an " +
        "unauthenticated request comes back <code>401</code>.</p>" +
        "<p style='margin:0;max-width:15rem'>Add an API key in <code>js/app.js</code> or " +
        "allow this domain on your Stadia property. If neither applies, check the network " +
        "tab — an ad blocker or proxy may be swallowing the requests.</p>";
      L.DomEvent.disableClickPropagation(div);
      return div;
    };
    tileWarning.addTo(map);
  }

  /* --------------------------- Pins ---------------------------- */

  /* Every listing carries a number, assigned once over the whole directory in
     alphabetical order. Filtering and searching hide rows but never renumber
     them, so the number beside a name always matches the pin on the map. */
  function sortKey(name) {
    return name.replace(/^the\s+/i, "");   // "The Nutmeg Nook" files under N
  }

  function assignNumbers() {
    state.data.businesses
      .slice()
      .sort(function (a, b) { return sortKey(a.name).localeCompare(sortKey(b.name)); })
      .forEach(function (business, index) {
        state.numbers[business.id] = index + 1;
      });
  }

  function orderedBusinesses() {
    return state.data.businesses.slice().sort(function (a, b) {
      return state.numbers[a.id] - state.numbers[b.id];
    });
  }

  /* The numbers sit on the category colour, which ranges from a pale pink to a
     deep blue, so the label colour is chosen per category rather than fixed. */
  function luminance(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [16, 8, 0]
      .map(function (shift, i) {
        var c = ((n >> shift) & 255) / 255;
        c = c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        return c * [0.2126, 0.7152, 0.0722][i];
      })
      .reduce(function (a, b) { return a + b; }, 0);
  }

  function contrast(a, b) {
    var hi = Math.max(a, b), lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }

  var INK = "#3e2a56";
  var INK_DEEP = "#2a1838";
  var AA = 4.5;

  function mix(hex, towards, amount) {
    var a = parseInt(hex.slice(1), 16), b = parseInt(towards.slice(1), 16), out = "#";
    for (var shift = 16; shift >= 0; shift -= 8) {
      var ca = (a >> shift) & 255, cb = (b >> shift) & 255;
      var c = Math.round(ca + (cb - ca) * amount);
      out += (c < 16 ? "0" : "") + c.toString(16);
    }
    return out;
  }

  /* Numbers sit directly on the category colour, and a couple of those — the
     coral and the green — are mid-tone enough that neither white nor deep
     purple reaches AA on them. Where that happens the fill is deepened just
     until white text clears the threshold. Chips and legend dots use the same
     adjusted colour, so a pin and its dot in the legend always match. */
  function numberStyle(hex) {
    var bg = luminance(hex);
    var onWhite = contrast(bg, 1);
    var onInk = contrast(bg, luminance(INK));

    if (Math.max(onWhite, onInk) >= AA) {
      return { bg: hex, fg: onWhite >= onInk ? "#ffffff" : INK };
    }

    for (var t = 0.05; t <= 0.9; t += 0.05) {
      var deeper = mix(hex, INK_DEEP, t);
      if (contrast(luminance(deeper), 1) >= AA) return { bg: deeper, fg: "#ffffff" };
    }
    return { bg: mix(hex, INK_DEEP, 0.9), fg: "#ffffff" };
  }

  function pinIcon(business, category) {
    var number = state.numbers[business.id];
    var digits = String(number).length;
    var style = numberStyle(category.color);

    var svg =
      '<svg class="pin__svg" width="42" height="54" viewBox="0 0 42 54" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<ellipse cx="21" cy="50" rx="9" ry="2.6" fill="#fff" opacity=".85"/>' +
        '<path d="M21 2a14 14 0 0 1 14 14c0 9.5-14 30-14 30S7 25.5 7 16A14 14 0 0 1 21 2z" fill="' + style.bg + '"/>' +
        '<text x="21" y="' + (digits > 2 ? 20.5 : 21.5) + '" text-anchor="middle" ' +
          'font-family="Fredoka, ui-rounded, system-ui, sans-serif" font-weight="600" ' +
          'font-size="' + (digits > 2 ? 12 : 16) + '" fill="' + style.fg + '">' +
          number +
        "</text>" +
      "</svg>";

    return L.divIcon({
      className: "pin",
      html: svg,
      iconSize: [42, 54],
      iconAnchor: [21, 50],
      popupAnchor: [0, -42]
    });
  }

  var PIN_ICON =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
    '<path d="M6 1a3.6 3.6 0 0 1 3.6 3.6C9.6 7.1 6 11 6 11S2.4 7.1 2.4 4.6A3.6 3.6 0 0 1 6 1z" ' +
    'stroke="currentColor" stroke-width="1.3"/></svg>';

  var CLOCK_ICON =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
    '<circle cx="6" cy="6" r="4.6" stroke="currentColor" stroke-width="1.3"/>' +
    '<path d="M6 3.6V6l1.8 1.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

  var PHONE_ICON =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
    '<path d="M3 1.6h2l1 2.3-1.2.9a7 7 0 0 0 3.4 3.4l.9-1.2 2.3 1v2A1.4 1.4 0 0 1 10 11 8.6 8.6 0 0 1 1 2a1.4 1.4 0 0 1 1.4-1.4z" ' +
    'stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';

  function popupHtml(business, category) {
    var details = [];
    if (business.address) details.push("<span>" + PIN_ICON + esc(business.address) + "</span>");
    if (business.hours) details.push("<span>" + CLOCK_ICON + esc(business.hours) + "</span>");
    if (business.phone) {
      details.push("<span>" + PHONE_ICON +
        '<a class="pop__phone" href="tel:' + esc(business.phone.replace(/[^0-9+]/g, "")) + '">' +
        esc(business.phone) + "</a></span>");
    }

    return (
      '<div class="pop" style="--pop-color:' + category.color + '">' +
        '<p class="pop__ribbon"><span class="pop__num" style="background:' + numberStyle(category.color).bg +
          ';color:' + numberStyle(category.color).fg + '">' + state.numbers[business.id] + "</span>" +
          esc(category.label) + "</p>" +
        '<h2 class="pop__name">' + esc(business.name) + "</h2>" +
        '<p class="pop__blurb">' + esc(business.blurb) + "</p>" +
        (details.length ? '<p class="pop__details">' + details.join("") + "</p>" : "") +
        (business.url
          ? '<a class="pop__link" href="' + esc(business.url) + '" target="_blank" rel="noopener noreferrer">' +
              "Visit their site</a>"
          : "") +
      "</div>"
    );
  }

  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ------------------------ Hover behaviour --------------------- */
  /* A tooltip would vanish the moment you reached for the link, so the
     card is a popup that opens on hover and lingers while the pointer is
     on it. Clicking a pin keeps it open until you dismiss it. */

  /* Exactly one popup is ever open: whatever is being hovered, or failing
     that, whatever is pinned, or failing that, nothing. Two cards were able
     to show at once — hovering a different pin while one was pinned left
     both open, since the old code explicitly spared the pinned id from the
     "close everyone else" sweep. Routing every state change through this
     one function instead of closing/opening ad hoc means there is no path
     that can leave two cards up: it always closes every id but the winner
     before opening it. Ending a hover doesn't lose the pin either — with
     nothing left hovered, the winner falls back to activeId and its card
     reopens on its own. */
  function displayedId() {
    return state.hoverId || state.activeId;
  }

  function cancelClose(id) {
    if (state.closeTimers[id]) {
      clearTimeout(state.closeTimers[id]);
      delete state.closeTimers[id];
    }
  }

  function closeCard(id) {
    cancelClose(id);
    var marker = state.markers[id];
    if (marker) marker.closePopup();
  }

  /* The map's rounded corners come from .map-frame's overflow:hidden, which
     clips anything inside it uniformly — including a popup, if the popup
     is taller than the box. That's a real case: the longest business copy
     (address + hours + phone) renders around 440px tall, and the map area
     can be shorter than that on a short viewport, or on desktop, which is a
     fixed one-viewport layout with no scroll to fall back on. Rather than
     let the overflow clip invisibly cut the card off, the popup's maxHeight
     is set fresh from the map's own current size right before it opens —
     comfortably enough room and it's identical to today; too little and
     Leaflet gives the content itself a small internal scrollbar instead of
     losing it, which is the one on today's business copy this should never
     actually trigger, but keeps a future longer listing from disappearing
     rather than merely scrolling. */
  function popupMaxHeight() {
    var frame = document.querySelector(".map-frame");
    if (!frame) return null;
    return Math.max(120, frame.getBoundingClientRect().height - 32);
  }

  function refreshDisplay(opts) {
    var showId = displayedId();

    Object.keys(state.markers).forEach(function (otherId) {
      if (otherId !== showId) closeCard(otherId);
    });

    if (showId) {
      var marker = state.markers[showId];
      if (marker) {
        cancelClose(showId);
        /* Pan before opening, not after: panTo updates the map's internal
           centre synchronously even though the visual animation is still
           catching up, but it recentres on the marker with no idea how
           tall the popup about to open is. Opening the popup afterward
           lets Leaflet's own autoPan — which does know the popup's size —
           make the last, popup-aware adjustment. Doing it in the other
           order let a plain recentre undo autoPan's fix a moment later,
           leaving a tall card's top pushed out past the map entirely. */
        if (opts && opts.pan) map.panTo(marker.getLatLng(), { animate: true });

        /* Only call openPopup() when this marker's card isn't already the
           one on screen. Leaflet's openPopup doesn't no-op on an
           already-open popup the way it looks like it should — it runs
           _prepareOpen() -> update() -> _updateContent() unconditionally,
           which does contentNode.innerHTML = sameString and silently
           rebuilds every child node. bindPopupHoverKeepAlive's own
           "mouseenter" on the popup calls back into here on every hover,
           including hovering from one part of an already-open card to
           another (the pin's own icon isn't involved at all) — so without
           this guard, moving the pointer toward "Visit their site" or the
           phone number tore out and replaced the very link it was headed
           for, sometimes mid-click. The rebuilt link is identical HTML,
           so nothing *looked* wrong — the popup just quietly ate the
           click. */
        if (!marker.isPopupOpen()) {
          var popup = marker.getPopup();
          if (popup) popup.options.maxHeight = popupMaxHeight();
          marker.openPopup();
        }
        bindPopupHoverKeepAlive(marker, showId);
      }
    }

    syncActiveStyles();
  }

  function scheduleClose(id) {
    cancelClose(id);
    state.closeTimers[id] = setTimeout(function () {
      delete state.closeTimers[id];
      if (state.hoverId !== id) return; // superseded by a newer hover already
      state.hoverId = null;
      refreshDisplay();
    }, HOVER_CLOSE_DELAY);
  }

  function bindPopupHoverKeepAlive(marker, id) {
    var el = marker.getPopup() && marker.getPopup().getElement();
    if (!el || el._merryBound) return;
    el._merryBound = true;
    L.DomEvent.on(el, "mouseenter", function () { showCard(id); });
    L.DomEvent.on(el, "mouseleave", function () { scheduleClose(id); });
  }

  function showCard(id, opts) {
    if (!state.markers[id]) return;
    cancelClose(id);
    state.hoverId = id;
    refreshDisplay(opts);
  }

  function pinCard(id) {
    state.activeId = state.activeId === id ? null : id;
    refreshDisplay({ pan: !!state.activeId });
  }

  function syncActiveStyles() {
    Object.keys(state.markers).forEach(function (id) {
      var el = state.markers[id].getElement();
      if (!el) return;
      el.classList.toggle("is-active", id === state.activeId || id === state.hoverId);
    });

    document.querySelectorAll(".card").forEach(function (card) {
      card.classList.toggle("is-active", card.dataset.id === state.activeId);
    });
  }

  /* --------------------------- Filtering ------------------------ */

  function isVisible(business) {
    var byCategory = state.filters.size === 0 || state.filters.has(business.category);
    if (!byCategory) return false;
    if (!state.query) return true;

    var category = state.data.categories[business.category] || {};
    var haystack = [business.name, business.blurb, business.address, category.label, business.category]
      .join(" ")
      .toLowerCase();
    return haystack.indexOf(state.query) !== -1;
  }

  function applyFilters() {
    var visible = orderedBusinesses().filter(isVisible);
    var visibleIds = new Set(visible.map(function (b) { return b.id; }));

    state.data.businesses.forEach(function (business) {
      var marker = state.markers[business.id];
      if (!marker) return;
      if (visibleIds.has(business.id)) {
        if (!map.hasLayer(marker)) marker.addTo(map);
      } else {
        if (state.activeId === business.id) state.activeId = null;
        if (state.hoverId === business.id) state.hoverId = null;
        map.removeLayer(marker);
      }
    });

    renderCards(visible);
    syncActiveStyles();
  }

  /* ---------------------------- Sidebar ------------------------- */

  function renderFilters() {
    var host = document.getElementById("filters");
    host.innerHTML = "";

    Object.keys(state.data.categories).forEach(function (id) {
      var category = state.data.categories[id];
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.style.setProperty("--chip-color", numberStyle(category.color).bg);
      chip.setAttribute("aria-pressed", "false");
      chip.innerHTML = "<span class='chip__dot' aria-hidden='true'></span>" + esc(category.label);

      chip.addEventListener("click", function () {
        if (state.filters.has(id)) state.filters.delete(id);
        else state.filters.add(id);
        chip.setAttribute("aria-pressed", state.filters.has(id) ? "true" : "false");
        applyFilters();
      });

      host.appendChild(chip);
    });
  }

  function renderCards(businesses) {
    var host = document.getElementById("cards");
    host.innerHTML = "";

    if (!businesses.length) {
      var empty = document.createElement("li");
      empty.className = "cards__empty";
      empty.textContent = "Nothing under the tree for that one.";
      host.appendChild(empty);
      return;
    }

    businesses.forEach(function (business) {
      var category = state.data.categories[business.category];
      var item = document.createElement("li");
      item.className = "card";
      item.dataset.id = business.id;
      var badge = numberStyle(category.color);
      item.style.setProperty("--card-color", badge.bg);
      item.style.setProperty("--card-ink", badge.fg);
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.setAttribute("aria-label",
        business.name + ", number " + state.numbers[business.id] + ", " + category.label +
        ". Show on the map.");

      item.innerHTML =
        '<span class="card__num" aria-hidden="true">' + state.numbers[business.id] + "</span>" +
        '<span class="card__name">' + esc(business.name) + "</span>";

      /* On the stacked mobile layout the sidebar sits well above the map, so
         a click needs to bring the map (and the popup it just opened) into
         view. Desktop already shows both at once — nothing to scroll to. */
      item.addEventListener("mouseenter", function () { if (!hoverSuppressed()) showCard(business.id); });
      item.addEventListener("mouseleave", function () { scheduleClose(business.id); });
      item.addEventListener("click", function () {
        pinCard(business.id);
        if (MOBILE_QUERY.matches) scrollToEl(document.querySelector(".map-frame"));
      });
      item.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          pinCard(business.id);
          if (MOBILE_QUERY.matches) scrollToEl(document.querySelector(".map-frame"));
        }
      });

      host.appendChild(item);
    });
  }

  /* ---------------------------- Legend -------------------------- */

  function legendItems() {
    return Object.keys(state.data.categories).map(function (id) {
      var category = state.data.categories[id];
      return { label: category.label, color: numberStyle(category.color).bg };
    });
  }

  function addLegend() {
    var legend = L.control({ position: "bottomleft" });

    legend.onAdd = function () {
      var div = L.DomUtil.create("div", "map-legend");
      var items = legendItems().map(function (item) {
        return '<li><span class="swatch" style="--swatch:' + item.color + '"></span>' +
               esc(item.label) + "</li>";
      });
      div.innerHTML = "<h2>Who's who</h2><ul>" + items.join("") + "</ul>";
      L.DomEvent.disableClickPropagation(div);
      return div;
    };

    legend.addTo(map);
  }

  /* The same key, laid out as a wrapping strip under the map for mobile —
     see .legend-strip in the CSS for why it exists. */
  function renderLegendStrip() {
    var host = document.getElementById("legendStrip");
    if (!host) return;

    host.innerHTML = legendItems().map(function (item) {
      return '<span class="legend-item" role="listitem"><span class="swatch" style="--swatch:' +
        item.color + '"></span>' + esc(item.label) + "</span>";
    }).join("");
  }

  /* ------------------------- Back to list ------------------------- */
  /* A fixed button that appears once the map has scrolled into view on
     mobile, and returns to the sidebar in one tap rather than a long swipe. */

  function initBackToTop() {
    var btn = document.getElementById("backToTop");
    var mapFrame = document.querySelector(".map-frame");
    if (!btn || !mapFrame) return;

    function updateVisibility() {
      if (!MOBILE_QUERY.matches) {
        btn.classList.remove("is-visible");
        return;
      }
      btn.classList.toggle("is-visible", mapFrame.getBoundingClientRect().top < window.innerHeight * 0.5);
    }

    btn.addEventListener("click", function () { scrollToEl(document.querySelector(".sidebar")); });
    window.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", updateVisibility);
    updateVisibility();
  }

  /* ----------------------------- Boot --------------------------- */

  function buildMarkers() {
    state.data.businesses.forEach(function (business) {
      var category = state.data.categories[business.category];
      if (!category) {
        console.warn('Unknown category "' + business.category + '" on ' + business.name);
        category = { label: business.category, color: "#2cac84", icon: "bauble" };
      }

      var marker = L.marker(business.coords, {
        icon: pinIcon(business, category),
        title: business.name,
        alt: business.name,
        riseOnHover: true,
        keyboard: true
      });

      marker.bindPopup(popupHtml(business, category), {
        className: "merry-popup",
        closeButton: false,
        autoClose: false,
        closeOnClick: false,
        offset: [0, 0]
      });

      marker.on("mouseover", function () { if (!hoverSuppressed()) showCard(business.id); });
      marker.on("mouseout", function () { scheduleClose(business.id); });
      marker.on("click", function () { pinCard(business.id); });
      marker.on("keypress", function () { pinCard(business.id); });
      marker.on("popupopen", function () { bindPopupHoverKeepAlive(marker, business.id); });

      state.markers[business.id] = marker;
      marker.addTo(map);
    });
  }

  function hydrateChrome() {
    var meta = state.data.meta || {};
    var lead = document.getElementById("siteTitleLead");

    if (meta.titleLead) lead.textContent = meta.titleLead;
    else lead.remove();

    if (meta.title) document.getElementById("siteTitleMain").textContent = meta.title;

    var fullTitle = [meta.titleLead, meta.title].filter(Boolean).join(" ");
    if (fullTitle) document.title = fullTitle;

    if (meta.subtitle) document.getElementById("siteSubtitle").textContent = meta.subtitle;
    document.getElementById("sidebarNote").textContent =
      meta.attributionNote || "Hover a pin or a card to peek inside.";
  }

  function wireSearch() {
    document.getElementById("search").addEventListener("input", function (event) {
      state.query = event.target.value.trim().toLowerCase();
      applyFilters();
    });
  }

  function start(data) {
    state.data = data;
    var meta = data.meta || {};

    /* The opening view comes from meta.center/meta.zoom rather than fitting
       every pin: listings out in Louisa and on the Northern Neck would pull the
       view back a hundred miles and squash the Richmond cluster, where most of
       the guide is. */
    map = L.map("map", {
      center: meta.center || [37.5407, -77.4360],
      zoom: meta.zoom || 11,
      scrollWheelZoom: true,
      zoomControl: true
    });

    addTiles();
    assignNumbers();
    hydrateChrome();
    renderFilters();
    buildMarkers();
    renderCards(orderedBusinesses());
    addLegend();
    renderLegendStrip();
    initBackToTop();
    wireSearch();

    /* Clicking the paper itself puts the pinned card away. */
    map.on("click", function () {
      if (state.activeId) {
        state.activeId = null;
        refreshDisplay();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && state.activeId) {
        state.activeId = null;
        refreshDisplay();
      }
    });
  }

  function fail(error) {
    console.error(error);
    document.getElementById("map").innerHTML =
      '<p class="noscript">The directory got lost in the post. 📮<br>' +
      "<small style='font-size:.8rem'>Serve this folder over HTTP so " +
      DATA_URL + " can load.</small></p>";
  }

  fetch(DATA_URL, { cache: "no-cache" })
    .then(function (response) {
      if (!response.ok) throw new Error("Failed to load " + DATA_URL + " (" + response.status + ")");
      return response.json();
    })
    .then(start)
    .catch(fail);
})();
