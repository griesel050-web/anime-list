(function(){
  "use strict";

  var STORAGE_KEY = "watchlog.entries.v1";
  var statusMeta = {
    watching:  { label: "Watching",      color: "var(--watching)" },
    completed: { label: "Completed",     color: "var(--completed)" },
    plan:      { label: "Plan to Watch", color: "var(--plan)" },
    dropped:   { label: "Dropped",       color: "var(--dropped)" }
  };
  var statusOrder = ["watching", "completed", "plan", "dropped"];

  var state = {
    entries: [],
    filterStatus: "all",
    searchQuery: "",
    searchTimer: null,
    addedApiIds: {}
  };

  // ---------- helpers ----------
  function uid(){
    return "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(str){
    if(str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ---------- season helpers ----------
  // Keeps season.length (how many episode cells to render) consistent with
  // season.total (known episode count) and whatever has already been watched.
  function recomputeSeasonLength(season){
    var maxWatched = season.watched.length ? Math.max.apply(null, season.watched) : 0;
    if(season.total){
      season.length = season.total;
      season.watched = season.watched.filter(function(n){ return n <= season.total; });
    } else {
      season.length = Math.max(season.length || 0, maxWatched, 12);
    }
  }

  function makeSeason(label, total){
    var season = {
      id: uid(),
      label: label || "Season 1",
      total: total || null,
      watched: [],
      length: null
    };
    recomputeSeasonLength(season);
    return season;
  }

  function defaultSeasonLabel(format){
    switch(format){
      case "MOVIE": return "Movie";
      case "OVA": return "OVA";
      case "ONA": return "ONA";
      case "SPECIAL": return "Special";
      default: return "Season 1";
    }
  }

  // After episodes are toggled, gently nudge status — the person can always override manually.
  function autoStatus(entry){
    if(entry.status === "dropped") return;
    var watchedCount = 0, totalKnown = 0, anyUnknown = entry.seasons.length === 0;
    entry.seasons.forEach(function(s){
      watchedCount += s.watched.length;
      if(s.total){ totalKnown += s.total; } else { anyUnknown = true; }
    });
    if(entry.seasons.length && !anyUnknown && totalKnown > 0 && watchedCount >= totalKnown){
      entry.status = "completed";
    } else if(watchedCount > 0 && entry.status === "plan"){
      entry.status = "watching";
    } else if(watchedCount === 0 && entry.status === "completed"){
      entry.status = "plan";
    }
  }

  function aggregateProgress(entry){
    var watchedCount = 0, totalKnown = 0, anyUnknown = entry.seasons.length === 0;
    entry.seasons.forEach(function(s){
      watchedCount += s.watched.length;
      if(s.total){ totalKnown += s.total; } else { anyUnknown = true; }
    });
    return { watchedCount: watchedCount, totalKnown: totalKnown, anyUnknown: anyUnknown };
  }

  // ---------- storage & migration ----------
  function normalizeEntry(raw){
    var entry = {
      id: raw.id || uid(),
      apiId: raw.apiId || raw.malId || null,
      title: raw.title || "Untitled",
      image: raw.image || "",
      status: statusMeta[raw.status] ? raw.status : "plan",
      rating: (typeof raw.rating === "number") ? raw.rating : null,
      seasons: [],
      updatedAt: raw.updatedAt || Date.now()
    };

    if(Array.isArray(raw.seasons) && raw.seasons.length){
      entry.seasons = raw.seasons.map(function(s){
        var season = {
          id: s.id || uid(),
          label: s.label || "Season 1",
          total: (typeof s.total === "number") ? s.total : null,
          watched: Array.isArray(s.watched) ? s.watched.slice().filter(function(n){ return Number.isFinite(n); }) : [],
          length: (typeof s.length === "number") ? s.length : null
        };
        recomputeSeasonLength(season);
        return season;
      });
    } else if(raw.currentEpisode != null || raw.totalEpisodes != null){
      // migrate from the old single-counter shape
      var cur = Number(raw.currentEpisode) || 0;
      var watchedArr = [];
      for(var i = 1; i <= cur; i++){ watchedArr.push(i); }
      entry.seasons = [makeSeasonFromMigration(raw.season, raw.totalEpisodes, watchedArr)];
    }
    return entry;
  }

  function makeSeasonFromMigration(label, total, watched){
    var season = {
      id: uid(),
      label: label || "Season 1",
      total: total || null,
      watched: watched || [],
      length: null
    };
    recomputeSeasonLength(season);
    return season;
  }

  function loadEntries(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return [];
      var parsed = JSON.parse(raw);
      if(!Array.isArray(parsed)) return [];
      return parsed.map(normalizeEntry);
    }catch(e){
      console.error("Failed to load entries", e);
      return [];
    }
  }

  function saveEntries(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.entries));
    }catch(e){
      console.error("Failed to save entries", e);
      showToast("Couldn't save — your browser storage may be full.");
    }
  }

  // ---------- toast ----------
  var toastEl = document.getElementById("toast");
  var toastTimer = null;
  function showToast(msg){
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove("show"); }, 2600);
  }

  // ---------- stats & tabs ----------
  function renderStats(){
    var totalTitles = state.entries.length;
    var totalEpisodes = state.entries.reduce(function(sum, e){
      return sum + e.seasons.reduce(function(s2, season){ return s2 + season.watched.length; }, 0);
    }, 0);
    document.getElementById("statsLine").innerHTML =
      "<strong>" + totalTitles + "</strong> title" + (totalTitles === 1 ? "" : "s") +
      " · <strong>" + totalEpisodes + "</strong> episode" + (totalEpisodes === 1 ? "" : "s") + " watched";
  }

  function renderTabs(){
    var counts = { all: state.entries.length, watching: 0, completed: 0, plan: 0, dropped: 0 };
    state.entries.forEach(function(e){ if(counts[e.status] != null) counts[e.status]++; });

    var tabsEl = document.getElementById("tabs");
    var defs = [{ key: "all", label: "All" }].concat(statusOrder.map(function(k){
      return { key: k, label: statusMeta[k].label };
    }));

    tabsEl.innerHTML = defs.map(function(d){
      var active = state.filterStatus === d.key ? " active" : "";
      return '<button class="tab' + active + '" data-filter="' + d.key + '" role="tab" aria-selected="' +
        (state.filterStatus === d.key) + '">' + d.label + " (" + counts[d.key] + ")</button>";
    }).join("");
  }

  // ---------- grid ----------
  function visibleEntries(){
    var list = state.entries.slice();
    if(state.filterStatus !== "all"){
      list = list.filter(function(e){ return e.status === state.filterStatus; });
    }
    if(state.searchQuery){
      var q = state.searchQuery.toLowerCase();
      list = list.filter(function(e){ return e.title.toLowerCase().indexOf(q) !== -1; });
    }
    list.sort(function(a, b){ return (b.updatedAt || 0) - (a.updatedAt || 0); });
    return list;
  }

  function progressHtml(entry){
    var color = "var(--" + entry.status + ")";
    var agg = aggregateProgress(entry);
    if(!agg.anyUnknown && agg.totalKnown > 0){
      var pct = Math.min(100, Math.round((agg.watchedCount / agg.totalKnown) * 100));
      return '<div class="sprockets"></div>' +
        '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%;background:' + color + ';"></div></div>' +
        '<div class="sprockets"></div>';
    }
    return '<div class="sprockets"></div>' +
      '<div class="progress-track"><div class="progress-indeterminate" style="--bar-color:' + color + ';"></div></div>' +
      '<div class="sprockets"></div>';
  }

  function seasonHtml(season){
    var total = season.total;
    var length = season.length || (total || 12);
    var cells = "";
    for(var i = 1; i <= length; i++){
      var watched = season.watched.indexOf(i) !== -1;
      cells += '<button type="button" class="ep-cell' + (watched ? ' watched' : '') + '" data-action="ep-toggle" data-season-id="' + season.id +
        '" data-ep="' + i + '" aria-pressed="' + watched + '" title="Episode ' + i + (watched ? ' — watched' : ' — not watched yet') + '">' + i + "</button>";
    }
    if(!total){
      cells += '<button type="button" class="ep-cell add-ep" data-action="ep-extend" data-season-id="' + season.id +
        '" title="Add another episode slot" aria-label="Add episode slot">+</button>';
    }
    var totalLabel = total ? total : "?";
    return (
      '<div class="season" data-season-id="' + season.id + '">' +
        '<div class="season-head">' +
          '<input class="season-label-input" data-action="season-label" data-season-id="' + season.id +
            '" value="' + escapeHtml(season.label) + '" aria-label="Season label">' +
          '<input class="season-total-input" data-action="season-total" data-season-id="' + season.id +
            '" type="number" min="0" value="' + (total != null ? total : "") + '" placeholder="eps" aria-label="Total episodes">' +
          '<button type="button" class="season-remove" data-action="season-remove" data-season-id="' + season.id + '" aria-label="Remove season">&times;</button>' +
        "</div>" +
        '<div class="ep-grid">' + cells + "</div>" +
        '<div class="season-actions">' +
          '<span class="season-progress">' + season.watched.length + " / " + totalLabel + " watched</span>" +
          '<span class="season-actions-buttons">' +
            '<button type="button" class="btn-link" data-action="season-mark-all" data-season-id="' + season.id + '">Mark all watched</button>' +
            '<button type="button" class="btn-link" data-action="season-clear-all" data-season-id="' + season.id + '">Clear all</button>' +
          "</span>" +
        "</div>" +
      "</div>"
    );
  }

  function cardHtml(entry){
    var posterHtml = entry.image
      ? '<img class="poster" src="' + escapeHtml(entry.image) + '" alt="" loading="lazy">'
      : '<div class="poster-fallback" aria-hidden="true">🎬</div>';

    var titleInner = entry.apiId
      ? '<a href="https://anilist.co/anime/' + encodeURIComponent(entry.apiId) + '" target="_blank" rel="noopener">' + escapeHtml(entry.title) + "</a>"
      : escapeHtml(entry.title);

    var statusOptions = statusOrder.map(function(k){
      var sel = entry.status === k ? " selected" : "";
      return '<option value="' + k + '"' + sel + ">" + statusMeta[k].label + "</option>";
    }).join("");

    var ratingBars = "";
    for(var i = 1; i <= 10; i++){
      var filled = entry.rating != null && i <= entry.rating;
      ratingBars += '<button type="button" class="rating-bar' + (filled ? " filled" : "") + '" data-action="rating-bar" data-value="' + i +
        '" aria-label="Rate ' + i + ' out of 10" title="Rate ' + i + "/10\"></button>";
    }
    var ratingText = entry.rating != null ? (entry.rating + "/10") : "Not rated";

    var seasonsHtml = entry.seasons.length
      ? entry.seasons.map(seasonHtml).join("")
      : '<p class="no-seasons">No seasons added yet.</p>';

    var malLink = entry.apiId
      ? '<a class="mal-link" href="https://anilist.co/anime/' + encodeURIComponent(entry.apiId) + '" target="_blank" rel="noopener">View on AniList ↗</a>'
      : "<span></span>";

    return (
      '<article class="card" data-id="' + entry.id + '" data-status="' + entry.status + '">' +
        '<div class="card-top">' +
          posterHtml +
          '<div class="card-meta">' +
            '<h3 class="card-title">' + titleInner + "</h3>" +
            '<select class="status-select" data-action="status" data-status="' + entry.status + '">' + statusOptions + "</select>" +
            '<div class="rating">' +
              '<div class="rating-bars">' + ratingBars + "</div>" +
              '<span class="rating-text">' + ratingText + "</span>" +
            "</div>" +
          "</div>" +
        "</div>" +
        progressHtml(entry) +
        '<div class="card-body">' +
          '<div class="seasons">' + seasonsHtml + "</div>" +
          '<div class="add-season-zone">' +
            '<a href="#" class="mini-toggle" data-action="toggle-add-season">+ Add season</a>' +
            '<div class="mini-form add-season-form">' +
              '<div class="row">' +
                '<input class="as-label" type="text" placeholder="Label, e.g. Season 2">' +
                '<input class="as-total" type="number" min="0" placeholder="Total eps (optional)">' +
              "</div>" +
              '<button type="button" class="btn btn-primary btn-small" data-action="submit-add-season" style="align-self:flex-start;">Add season</button>' +
            "</div>" +
          "</div>" +
          '<div class="card-footer">' +
            malLink +
            '<button type="button" class="remove-btn" data-action="remove-anime">Remove</button>' +
          "</div>" +
        "</div>" +
      "</article>"
    );
  }

  function renderGrid(){
    var grid = document.getElementById("grid");
    var list = visibleEntries();

    if(state.entries.length === 0){
      grid.innerHTML =
        '<div class="empty-state">' +
          '<div class="big">Your log is empty</div>' +
          "<p>Search for the first anime you've watched and start tracking your progress.</p>" +
          '<button class="btn btn-primary" id="emptyAddBtn">+ Add Anime</button>' +
        "</div>";
      var btn = document.getElementById("emptyAddBtn");
      if(btn) btn.addEventListener("click", openModal);
      return;
    }

    if(list.length === 0){
      grid.innerHTML = '<div class="empty-state"><div class="big">No matches</div><p>Try a different filter or search term.</p></div>';
      return;
    }

    grid.innerHTML = list.map(cardHtml).join("");
  }

  function render(){
    renderStats();
    renderTabs();
    renderGrid();
  }

  // ---------- entry mutations ----------
  function findEntry(id){
    return state.entries.find(function(e){ return e.id === id; });
  }
  function findSeason(entry, seasonId){
    return entry ? entry.seasons.find(function(s){ return s.id === seasonId; }) : null;
  }

  function addEntry(data){
    var season = makeSeason(defaultSeasonLabel(data.format), data.episodes || null);
    var entry = {
      id: uid(),
      apiId: data.apiId || null,
      title: data.title,
      image: data.image || "",
      status: "plan",
      rating: null,
      seasons: [season],
      updatedAt: Date.now()
    };
    state.entries.push(entry);
    saveEntries();
    render();
    return entry;
  }

  function removeEntry(id){
    var entry = findEntry(id);
    if(!entry) return;
    if(!confirm('Remove "' + entry.title + '" from your log?')) return;
    state.entries = state.entries.filter(function(e){ return e.id !== id; });
    saveEntries();
    render();
    showToast("Removed from your log.");
  }

  // ---------- grid: click delegation ----------
  document.getElementById("grid").addEventListener("click", function(ev){
    var actionEl = ev.target.closest("[data-action]");
    if(!actionEl) return;
    var card = ev.target.closest(".card");
    if(!card) return;
    var entry = findEntry(card.getAttribute("data-id"));
    if(!entry) return;

    var action = actionEl.getAttribute("data-action");
    var seasonId = actionEl.getAttribute("data-season-id");
    var season = seasonId ? findSeason(entry, seasonId) : null;

    if(action === "remove-anime"){
      removeEntry(entry.id);

    } else if(action === "rating-bar"){
      var val = parseInt(actionEl.getAttribute("data-value"), 10);
      entry.rating = (entry.rating === val) ? null : val;
      entry.updatedAt = Date.now();
      saveEntries(); render();

    } else if(action === "ep-toggle" && season){
      var ep = parseInt(actionEl.getAttribute("data-ep"), 10);
      var idx = season.watched.indexOf(ep);
      if(idx === -1){ season.watched.push(ep); } else { season.watched.splice(idx, 1); }
      season.watched.sort(function(a, b){ return a - b; });
      autoStatus(entry);
      entry.updatedAt = Date.now();
      saveEntries(); render();

    } else if(action === "ep-extend" && season){
      season.length = (season.length || 12) + 1;
      saveEntries(); render();

    } else if(action === "season-mark-all" && season){
      var len = season.total || season.length || 12;
      var arr = [];
      for(var i = 1; i <= len; i++){ arr.push(i); }
      season.watched = arr;
      autoStatus(entry);
      entry.updatedAt = Date.now();
      saveEntries(); render();

    } else if(action === "season-clear-all" && season){
      season.watched = [];
      autoStatus(entry);
      entry.updatedAt = Date.now();
      saveEntries(); render();

    } else if(action === "season-remove" && season){
      if(!confirm('Remove "' + season.label + '" and its progress?')) return;
      entry.seasons = entry.seasons.filter(function(s){ return s.id !== seasonId; });
      autoStatus(entry);
      entry.updatedAt = Date.now();
      saveEntries(); render();

    } else if(action === "toggle-add-season"){
      ev.preventDefault();
      var zone = actionEl.closest(".add-season-zone");
      zone.querySelector(".add-season-form").classList.toggle("open");

    } else if(action === "submit-add-season"){
      var zone2 = actionEl.closest(".add-season-zone");
      var labelInput = zone2.querySelector(".as-label");
      var totalInput = zone2.querySelector(".as-total");
      var label = labelInput.value.trim() || ("Season " + (entry.seasons.length + 1));
      var totalVal = totalInput.value ? Math.max(0, parseInt(totalInput.value, 10)) : null;
      entry.seasons.push(makeSeason(label, totalVal));
      entry.updatedAt = Date.now();
      saveEntries(); render();
      showToast('Added "' + label + '".');
    }
  });

  // ---------- grid: change delegation (text/number/select inputs) ----------
  document.getElementById("grid").addEventListener("change", function(ev){
    var card = ev.target.closest(".card");
    if(!card) return;
    var entry = findEntry(card.getAttribute("data-id"));
    if(!entry) return;

    var action = ev.target.getAttribute("data-action");
    var seasonId = ev.target.getAttribute("data-season-id");
    var season = seasonId ? findSeason(entry, seasonId) : null;

    if(action === "status"){
      entry.status = ev.target.value;
      entry.updatedAt = Date.now();
      saveEntries(); render();

    } else if(action === "season-label" && season){
      season.label = ev.target.value.trim() || season.label;
      entry.updatedAt = Date.now();
      saveEntries(); render();

    } else if(action === "season-total" && season){
      var v = ev.target.value;
      season.total = v ? Math.max(0, parseInt(v, 10)) : null;
      recomputeSeasonLength(season);
      autoStatus(entry);
      entry.updatedAt = Date.now();
      saveEntries(); render();
    }
  });

  // ---------- tabs & filter search ----------
  document.getElementById("tabs").addEventListener("click", function(ev){
    var btn = ev.target.closest(".tab");
    if(!btn) return;
    state.filterStatus = btn.getAttribute("data-filter");
    render();
  });

  document.getElementById("searchMine").addEventListener("input", function(ev){
    state.searchQuery = ev.target.value.trim();
    renderGrid();
  });

  // ---------- modal: add anime ----------
  var modalBackdrop = document.getElementById("modalBackdrop");
  var searchInput = document.getElementById("searchInput");
  var resultsList = document.getElementById("resultsList");
  var searchStatus = document.getElementById("searchStatus");

  function openModal(){
    modalBackdrop.classList.add("open");
    state.addedApiIds = {};
    resultsList.innerHTML = "";
    searchStatus.textContent = "";
    searchInput.value = "";
    document.getElementById("manualForm").classList.remove("open");
    document.getElementById("manualTitle").value = "";
    document.getElementById("manualTotal").value = "";
    document.getElementById("manualImage").value = "";
    setTimeout(function(){ searchInput.focus(); }, 30);
  }
  function closeModal(){
    modalBackdrop.classList.remove("open");
  }

  document.getElementById("openAddBtn").addEventListener("click", openModal);
  document.getElementById("closeModalBtn").addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", function(ev){
    if(ev.target === modalBackdrop) closeModal();
  });
  document.addEventListener("keydown", function(ev){
    if(ev.key === "Escape" && modalBackdrop.classList.contains("open")) closeModal();
  });

  document.getElementById("manualToggle").addEventListener("click", function(ev){
    ev.preventDefault();
    document.getElementById("manualForm").classList.toggle("open");
  });

  document.getElementById("manualAddBtn").addEventListener("click", function(){
    var title = document.getElementById("manualTitle").value.trim();
    if(!title){
      showToast("Give it a title first.");
      return;
    }
    var totalRaw = document.getElementById("manualTotal").value;
    var image = document.getElementById("manualImage").value.trim();
    addEntry({
      title: title,
      episodes: totalRaw ? Math.max(0, parseInt(totalRaw, 10)) : null,
      image: image,
      format: ""
    });
    showToast('Added "' + title + '" to your log.');
    document.getElementById("manualTitle").value = "";
    document.getElementById("manualTotal").value = "";
    document.getElementById("manualImage").value = "";
  });

  function resultRowHtml(item){
    var img = item.image
      ? '<img src="' + escapeHtml(item.image) + '" alt="">'
      : '<div class="poster-fallback" aria-hidden="true">🎬</div>';
    var sub = [item.format, item.year, item.episodes ? (item.episodes + " ep") : "ongoing/unknown"]
      .filter(Boolean).join(" · ");
    var already = state.entries.some(function(e){ return e.apiId === item.apiId; }) || state.addedApiIds[item.apiId];
    return (
      '<div class="result-row">' +
        img +
        '<div class="result-info">' +
          '<div class="result-title">' + escapeHtml(item.title) + "</div>" +
          '<div class="result-sub">' + escapeHtml(sub) + "</div>" +
        "</div>" +
        '<button type="button" class="result-add-btn" data-apiid="' + item.apiId + '"' + (already ? " disabled" : "") + ">" +
          (already ? "Added ✓" : "Add") +
        "</button>" +
      "</div>"
    );
  }

  var lastResults = [];
  function renderResults(items){
    lastResults = items;
    if(items.length === 0){
      resultsList.innerHTML = "";
      searchStatus.textContent = "No matches. Try a different spelling, or add it manually below.";
      return;
    }
    searchStatus.textContent = "";
    resultsList.innerHTML = items.map(resultRowHtml).join("");
  }

  resultsList.addEventListener("click", function(ev){
    var btn = ev.target.closest(".result-add-btn");
    if(!btn || btn.disabled) return;
    var apiId = btn.getAttribute("data-apiid");
    var item = lastResults.find(function(r){ return String(r.apiId) === String(apiId); });
    if(!item) return;
    addEntry(item);
    state.addedApiIds[item.apiId] = true;
    btn.disabled = true;
    btn.textContent = "Added ✓";
    showToast('Added "' + item.title + '" to your log.');
  });

  // AniList GraphQL search — public, CORS-enabled, no API key required.
  function searchAniList(query){
    searchStatus.textContent = "Searching…";
    resultsList.innerHTML = "";

    var gql =
      "query ($s: String) { Page(perPage: 8) { media(search: $s, type: ANIME, sort: SEARCH_MATCH) { " +
      "id title { romaji english } coverImage { large medium } episodes format seasonYear } } }";

    fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query: gql, variables: { s: query } })
    })
      .then(function(res){
        if(res.status === 429){ throw new Error("rate-limited"); }
        if(!res.ok){ throw new Error("bad-response"); }
        return res.json();
      })
      .then(function(json){
        if(json.errors){ throw new Error("api-error"); }
        var media = (json.data && json.data.Page && json.data.Page.media) || [];
        var items = media.map(function(m){
          return {
            apiId: m.id,
            title: (m.title && (m.title.english || m.title.romaji)) || "Untitled",
            image: m.coverImage ? (m.coverImage.large || m.coverImage.medium || "") : "",
            episodes: m.episodes || null,
            format: m.format || "",
            year: m.seasonYear || null
          };
        });
        renderResults(items);
      })
      .catch(function(err){
        if(err.message === "rate-limited"){
          searchStatus.textContent = "Searching too fast — wait a second and try again.";
        } else {
          searchStatus.textContent = "Couldn't reach the anime database right now. You can add it manually below.";
        }
      });
  }

  searchInput.addEventListener("input", function(){
    var q = searchInput.value.trim();
    clearTimeout(state.searchTimer);
    if(q.length < 2){
      resultsList.innerHTML = "";
      searchStatus.textContent = "";
      return;
    }
    state.searchTimer = setTimeout(function(){ searchAniList(q); }, 450);
  });

  // ---------- export / import ----------
  document.getElementById("exportBtn").addEventListener("click", function(){
    var blob = new Blob([JSON.stringify(state.entries, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = "watch-log-" + date + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Backup downloaded.");
  });

  var importFile = document.getElementById("importFile");
  document.getElementById("importBtn").addEventListener("click", function(){
    importFile.value = "";
    importFile.click();
  });
  importFile.addEventListener("change", function(){
    var file = importFile.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(){
      try{
        var parsed = JSON.parse(reader.result);
        if(!Array.isArray(parsed)) throw new Error("not-array");
        var ok = confirm("Import " + parsed.length + " title(s)? This replaces your current log of " + state.entries.length + " title(s).");
        if(!ok) return;
        state.entries = parsed.map(normalizeEntry);
        saveEntries();
        render();
        showToast("Import complete.");
      }catch(err){
        showToast("That file doesn't look like a valid Watch Log export.");
      }
    };
    reader.readAsText(file);
  });

  // ---------- init ----------
  state.entries = loadEntries();
  render();
})();
