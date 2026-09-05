/* -----------------------------------------------------------------
   The Merry Mile — an interactive Christmas business directory
   Leaflet + Stadia's Stamen Watercolor tiles. No build step.
   ----------------------------------------------------------------- */

(function () {
  "use strict";

  /* Stadia Maps serves the watercolor tiles. They work key-free on
     localhost / 127.0.0.1; for any other domain, register a free key at
     https://client.stadiamaps.com and drop it in here (or set
     window.STADIA_API_KEY before this script runs). */
  var STADIA_API_KEY = window.STADIA_API_KEY || "";
  var DATA_URL = "data/businesses.json";
  var HOVER_CLOSE_DELAY = 260; // ms of grace to travel from pin to card

  var state = {
    data: null,
    markers: {},          // id -> L.Marker
    activeId: null,       // pinned (clicked) business
    hoverId: null,        // business under the cursor
    filters: new Set(),   // empty === show everything
    query: "",
    closeTimer: null
  };

  var map;

  /* --------------------------- Tiles --------------------------- */

  function key(suffix) {
    return STADIA_API_KEY ? suffix + "?api_key=" + encodeURIComponent(STADIA_API_KEY) : suffix;
  }

  function addTiles() {
    var attribution =
      '&copy; <a href="https://www.stadiamaps.com/" target="_blank" rel="noopener">Stadia Maps</a> ' +
      '&copy; <a href="https://www.stamen.com/" target="_blank" rel="noopener">Stamen Design</a> ' +
      '&copy; <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

    /* Watercolor is only painted as deep as z16. maxNativeZoom lets Leaflet
       upscale those tiles past that instead of hiding the layer, so zooming
       in doesn't strand the labels on blank paper. */
    var watercolor = L.tileLayer(key("https://tiles.stadiamaps.com/tiles/stamen_watercolor/{z}/{x}/{y}.jpg"), {
      minZoom: 1,
      maxNativeZoom: 16,
      maxZoom: 18,
      attribution: attribution
    }).addTo(map);

    watercolor.on("tileload", onTileLoad);
    watercolor.on("tileerror", onTileError);

    /* Watercolor has no lettering of its own — this overlay puts the
       street and place names back on top without spoiling the paint. */
    L.tileLayer(key("https://tiles.stadiamaps.com/tiles/stamen_terrain_labels/{z}/{x}/{y}{r}.png"), {
      minZoom: 1,
      maxNativeZoom: 18,
      maxZoom: 18,
      opacity: 0.85,
      attribution: ""
    }).addTo(map);
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
        "<h2>The paint didn't arrive</h2>" +
        "<p style='margin:0 0 .35rem;max-width:15rem'>No watercolor tiles are loading. " +
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

  /* Flat vector glyphs, drawn white inside the pin's head. Keyed by the
     category's "icon" in the JSON so new categories can pick one. */
  var GLYPHS = {
    tree:
      '<path d="M21 8l4.5 6.5h-9z" fill="#fff"/>' +
      '<path d="M21 12.5l6 8h-12z" fill="#fff"/>' +
      '<rect x="20" y="19.5" width="2" height="3" fill="#fff"/>',
    cookie:
      '<circle cx="21" cy="15" r="6.5" fill="#fff"/>' +
      '<circle cx="19" cy="13" r="1.3" fill="{c}"/>' +
      '<circle cx="23.2" cy="14.6" r="1.1" fill="{c}"/>' +
      '<circle cx="20.4" cy="17.6" r="1.2" fill="{c}"/>',
    cup:
      '<path d="M15.5 10.5h9v5.5a4.5 4.5 0 0 1-9 0z" fill="#fff"/>' +
      '<path d="M24.7 12h1.6a1.9 1.9 0 0 1 0 3.8h-1.6" stroke="#fff" stroke-width="1.5" fill="none"/>' +
      '<rect x="14.3" y="20.6" width="11.4" height="1.8" rx=".9" fill="#fff"/>',
    star:
      '<path d="M21 8.4l2 4.2 4.6.7-3.3 3.2.8 4.5-4.1-2.2-4.1 2.2.8-4.5-3.3-3.2 4.6-.7z" fill="#fff"/>',
    gift:
      '<rect x="14.6" y="13.4" width="12.8" height="8.6" rx="1" fill="#fff"/>' +
      '<rect x="19.8" y="13.4" width="2.4" height="8.6" fill="{c}"/>' +
      '<path d="M21 13.2c-1.7-3.3-5.4-1.8-3.4.7M21 13.2c1.7-3.3 5.4-1.8 3.4.7" stroke="#fff" stroke-width="1.5" fill="none"/>',
    bauble:
      '<circle cx="21" cy="16.2" r="6.2" fill="#fff"/>' +
      '<rect x="19.4" y="8.2" width="3.2" height="2.8" rx=".7" fill="#fff"/>' +
      '<path d="M21 11v1.8" stroke="#fff" stroke-width="1.4"/>' +
      '<path d="M15.7 14.8c3.4 1.9 6.8 1.9 10.6 0" stroke="{c}" stroke-width="1.4" fill="none"/>'
  };

  function pinIcon(business, category) {
    /* A flat teardrop standing on a little patch of snow — no outline, no
       gradient, no drop shadow, matching the illustration style. */
    var glyph = (GLYPHS[category.icon] || GLYPHS.bauble).replace(/\{c\}/g, category.color);

    var svg =
      '<svg class="pin__svg" width="42" height="54" viewBox="0 0 42 54" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<ellipse cx="21" cy="50" rx="9" ry="2.6" fill="#fff" opacity=".85"/>' +
        '<path d="M21 2a14 14 0 0 1 14 14c0 9.5-14 30-14 30S7 25.5 7 16A14 14 0 0 1 21 2z" fill="' + category.color + '"/>' +
        glyph +
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
    '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
    '<path d="M6 1a3.6 3.6 0 0 1 3.6 3.6C9.6 7.1 6 11 6 11S2.4 7.1 2.4 4.6A3.6 3.6 0 0 1 6 1z" ' +
    'stroke="currentColor" stroke-width="1.3"/></svg>';

  var CLOCK_ICON =
    '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
    '<circle cx="6" cy="6" r="4.6" stroke="currentColor" stroke-width="1.3"/>' +
    '<path d="M6 3.6V6l1.8 1.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

  function popupHtml(business, category) {
    var details = [];
    if (business.address) details.push("<span>" + PIN_ICON + esc(business.address) + "</span>");
    if (business.hours) details.push("<span>" + CLOCK_ICON + esc(business.hours) + "</span>");

    return (
      '<div class="pop" style="--pop-color:' + category.color + '">' +
        '<p class="pop__ribbon"><span class="pop__dot"></span>' + esc(category.label) + "</p>" +
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

  function cancelClose() {
    if (state.closeTimer) {
      clearTimeout(state.closeTimer);
      state.closeTimer = null;
    }
  }

  function scheduleClose(id) {
    cancelClose();
    state.closeTimer = setTimeout(function () {
      if (state.activeId === id) return; // pinned open by a click
      var marker = state.markers[id];
      if (marker) marker.closePopup();
      if (state.hoverId === id) state.hoverId = null;
      syncActiveStyles();
    }, HOVER_CLOSE_DELAY);
  }

  function bindPopupHoverKeepAlive(marker, id) {
    var el = marker.getPopup() && marker.getPopup().getElement();
    if (!el || el._merryBound) return;
    el._merryBound = true;
    L.DomEvent.on(el, "mouseenter", cancelClose);
    L.DomEvent.on(el, "mouseleave", function () { scheduleClose(id); });
  }

  function showCard(id, opts) {
    var marker = state.markers[id];
    if (!marker) return;
    cancelClose();
    state.hoverId = id;
    marker.openPopup();
    bindPopupHoverKeepAlive(marker, id);
    if (opts && opts.pan) map.panTo(marker.getLatLng(), { animate: true });
    syncActiveStyles();
  }

  function pinCard(id) {
    state.activeId = state.activeId === id ? null : id;
    if (state.activeId) {
      showCard(id, { pan: true });
    } else {
      var marker = state.markers[id];
      if (marker) marker.closePopup();
    }
    syncActiveStyles();
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
    var visible = state.data.businesses.filter(isVisible);
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
      chip.style.setProperty("--chip-color", category.color);
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
      item.style.setProperty("--card-color", category.color);
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.setAttribute("aria-label", "Show " + business.name + " on the map");

      item.innerHTML =
        '<p class="card__meta"><span class="card__dot" aria-hidden="true"></span>' + esc(category.label) + "</p>" +
        '<h2 class="card__name">' + esc(business.name) + "</h2>" +
        '<p class="card__blurb">' + esc(business.blurb) + "</p>" +
        (business.url
          ? '<a class="card__link" href="' + esc(business.url) +
            '" target="_blank" rel="noopener noreferrer">Visit their site →</a>'
          : "");

      item.addEventListener("mouseenter", function () { showCard(business.id); });
      item.addEventListener("mouseleave", function () { scheduleClose(business.id); });
      item.addEventListener("click", function (event) {
        if (event.target.closest("a")) return; // let the link do its job
        pinCard(business.id);
      });
      item.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          pinCard(business.id);
        }
      });

      host.appendChild(item);
    });
  }

  /* ---------------------------- Legend -------------------------- */

  function addLegend() {
    var legend = L.control({ position: "bottomleft" });

    legend.onAdd = function () {
      var div = L.DomUtil.create("div", "map-legend");
      var items = Object.keys(state.data.categories).map(function (id) {
        var category = state.data.categories[id];
        return '<li><span class="swatch" style="--swatch:' + category.color + '"></span>' +
               esc(category.label) + "</li>";
      });
      div.innerHTML = "<h2>Who's who</h2><ul>" + items.join("") + "</ul>";
      L.DomEvent.disableClickPropagation(div);
      return div;
    };

    legend.addTo(map);
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

      marker.on("mouseover", function () { showCard(business.id); });
      marker.on("mouseout", function () { scheduleClose(business.id); });
      marker.on("click", function () { pinCard(business.id); });
      marker.on("keypress", function () { pinCard(business.id); });
      marker.on("popupopen", function () { bindPopupHoverKeepAlive(marker, business.id); });

      state.markers[business.id] = marker;
      marker.addTo(map);
    });
  }

  function fitToBusinesses() {
    var coords = state.data.businesses.map(function (b) { return b.coords; });
    if (coords.length) map.fitBounds(L.latLngBounds(coords).pad(0.18));
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

    map = L.map("map", {
      center: meta.center || [44.4759, -73.2121],
      zoom: meta.zoom || 15,
      scrollWheelZoom: true,
      zoomControl: true
    });

    addTiles();
    hydrateChrome();
    renderFilters();
    buildMarkers();
    renderCards(data.businesses);
    addLegend();
    fitToBusinesses();
    wireSearch();

    /* Clicking the paper itself puts the pinned card away. */
    map.on("click", function () {
      if (state.activeId) {
        var marker = state.markers[state.activeId];
        state.activeId = null;
        if (marker) marker.closePopup();
        syncActiveStyles();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && state.activeId) {
        var marker = state.markers[state.activeId];
        state.activeId = null;
        if (marker) marker.closePopup();
        syncActiveStyles();
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
