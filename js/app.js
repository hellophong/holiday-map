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

    var watercolor = L.tileLayer(key("https://tiles.stadiamaps.com/tiles/stamen_watercolor/{z}/{x}/{y}.jpg"), {
      minZoom: 1,
      maxZoom: 16,
      attribution: attribution
    }).addTo(map);

    watercolor.on("tileerror", warnAboutTiles);

    /* Watercolor has no lettering of its own — this overlay puts the
       street and place names back on top without spoiling the paint. */
    L.tileLayer(key("https://tiles.stadiamaps.com/tiles/stamen_terrain_labels/{z}/{x}/{y}{r}.png"), {
      minZoom: 1,
      maxZoom: 18,
      opacity: 0.85,
      attribution: ""
    }).addTo(map);
  }

  var warnedAboutTiles = false;

  function warnAboutTiles() {
    /* Stadia serves watercolor key-free on localhost only; anywhere else a
       missing key comes back as a 401 and the paper stays blank. Say so
       rather than leaving people staring at an empty page. */
    if (warnedAboutTiles) return;
    warnedAboutTiles = true;

    var note = L.control({ position: "topright" });
    note.onAdd = function () {
      var div = L.DomUtil.create("div", "map-legend tile-warning");
      div.innerHTML =
        "<h2>The paint didn't arrive</h2>" +
        "<p style='margin:0;max-width:15rem'>The watercolor tiles wouldn't load. Off " +
        "<code>localhost</code>, Stadia Maps needs a free API key — add yours in " +
        "<code>js/app.js</code>.</p>";
      L.DomEvent.disableClickPropagation(div);
      return div;
    };
    note.addTo(map);
  }

  /* --------------------------- Pins ---------------------------- */

  function pinIcon(business, category) {
    /* A hand-drawn bauble hanging from a little cap, drawn inline so the
       colour can follow the category without shipping a dozen images. */
    var svg =
      '<svg class="pin__svg" width="44" height="56" viewBox="0 0 44 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<path d="M22 55 C21 47 20 44 20 41" stroke="#4a3226" stroke-width="2.5" stroke-linecap="round" fill="none"/>' +
        '<circle cx="22" cy="22" r="17" fill="' + category.color + '" stroke="#4a3226" stroke-width="2.5"/>' +
        '<path d="M8 15 Q22 24 36 15" stroke="rgba(255,255,255,.55)" stroke-width="2.5" fill="none" stroke-linecap="round"/>' +
        '<rect x="16" y="1.5" width="12" height="7" rx="2.5" fill="#d9a441" stroke="#4a3226" stroke-width="2.5"/>' +
        '<text x="22" y="28" font-size="16" text-anchor="middle">' + category.emoji + "</text>" +
      "</svg>";

    return L.divIcon({
      className: "pin",
      html: svg,
      iconSize: [44, 56],
      iconAnchor: [22, 54],
      popupAnchor: [0, -44]
    });
  }

  function popupHtml(business, category) {
    var details = [];
    if (business.address) details.push('<span>📍 ' + esc(business.address) + "</span>");
    if (business.hours) details.push('<span>🕰️ ' + esc(business.hours) + "</span>");

    return (
      '<div class="pop" style="--pop-color:' + category.color + '">' +
        '<span class="pop__ribbon">' + category.emoji + " " + esc(category.label) + "</span>" +
        '<h2 class="pop__name">' + esc(business.name) + "</h2>" +
        '<p class="pop__blurb">' + esc(business.blurb) + "</p>" +
        (details.length ? '<p class="pop__details">' + details.join("") + "</p>" : "") +
        (business.url
          ? '<a class="pop__link" href="' + esc(business.url) + '" target="_blank" rel="noopener noreferrer">' +
              "Visit their site →</a>"
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
      chip.innerHTML = "<span aria-hidden='true'>" + category.emoji + "</span>" + esc(category.label);

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
      empty.textContent = "Nothing under the tree for that one. 🎁";
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
        '<p class="card__meta">' + category.emoji + " " + esc(category.label) + "</p>" +
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
               category.emoji + " " + esc(category.label) + "</li>";
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
        category = { label: business.category, color: "#2f6f4e", emoji: "🎄" };
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
    if (meta.title) {
      document.getElementById("siteTitle").textContent = meta.title;
      document.title = meta.title + " — Christmas Business Map";
    }
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
