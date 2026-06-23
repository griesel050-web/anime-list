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
    addedApiIds: {},
    knownCardIds: {},      // ids already rendered once — used to gate the entrance animation
    lastTouchedEntryId: null,
    lastToggledEps: null,  // {seasonId, eps:[...]} — used for the brief "pop" feedback
    lastAddedSeasonId: null,
    draggedId: null,
    sortMode: "manual",
    airingInfo: {} // apiId -> { episode, airingAt } — refreshed once per session, not persisted
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

  function stripHtml(html){
    if(!html) return "";
    var div = document.createElement("div");
    div.innerHTML = html;
    return (div.textContent || "").replace(/\s+\n/g, "\n").trim();
  }

  function pickTitle(titleObj){
    if(!titleObj) return "Untitled";
    return titleObj.english || titleObj.romaji || "Untitled";
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

  function makeSeason(label, total, duration){
    var season = {
      id: uid(),
      label: label || "Season 1",
      total: total || null,
      watched: [],
      length: null,
      apiId: null,
      sourceTitle: "",
      duration: (typeof duration === "number" && duration > 0) ? duration : null
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
      banner: raw.banner || "",
      description: raw.description || "",
      genres: Array.isArray(raw.genres) ? raw.genres : [],
      communityScore: (typeof raw.communityScore === "number") ? raw.communityScore : null,
      status: statusMeta[raw.status] ? raw.status : "plan",
      rating: (typeof raw.rating === "number") ? raw.rating : null,
      collapsed: (typeof raw.collapsed === "boolean") ? raw.collapsed : true,
      notes: raw.notes || "",
      seasons: [],
      discovering: false,
      updatedAt: raw.updatedAt || Date.now()
    };

    if(Array.isArray(raw.seasons) && raw.seasons.length){
      entry.seasons = raw.seasons.map(function(s){
        var season = {
          id: s.id || uid(),
          label: s.label || "Season 1",
          total: (typeof s.total === "number") ? s.total : null,
          watched: Array.isArray(s.watched) ? s.watched.slice().filter(function(n){ return Number.isFinite(n); }) : [],
          length: (typeof s.length === "number") ? s.length : null,
          apiId: s.apiId || null,
          sourceTitle: s.sourceTitle || "",
          duration: (typeof s.duration === "number" && s.duration > 0) ? s.duration : null
        };
        recomputeSeasonLength(season);
        return season;
      });
    } else if(raw.currentEpisode != null || raw.totalEpisodes != null){
      // migrate from the original single-counter shape
      var cur = Number(raw.currentEpisode) || 0;
      var watchedArr = [];
      for(var i = 1; i <= cur; i++){ watchedArr.push(i); }
      var season2 = makeSeason(raw.season || "Season 1", raw.totalEpisodes || null);
      season2.watched = watchedArr;
      recomputeSeasonLength(season2);
      entry.seasons = [season2];
    }
    return entry;
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
      // discovery in-flight state is transient — don't persist it
      var snapshot = state.entries.map(function(e){
        var copy = Object.assign({}, e);
        delete copy.discovering;
        return copy;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
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
  var FALLBACK_EP_MINUTES = 24; // typical TV anime episode length, used when AniList has no duration on file (e.g. manual entries)

  function formatWatchTime(totalMinutes){
    if(totalMinutes < 60) return totalMinutes + "m";
    var totalHours = Math.floor(totalMinutes / 60);
    var remM = totalMinutes % 60;
    if(totalHours < 24) return totalHours + "h" + (remM ? " " + remM + "m" : "");
    var days = Math.floor(totalHours / 24);
    var remH = totalHours % 24;
    return days + "d" + (remH ? " " + remH + "h" : "");
  }

  function renderStats(){
    var totalTitles = state.entries.length;
    var totalEpisodes = 0, totalMinutes = 0;
    state.entries.forEach(function(e){
      e.seasons.forEach(function(season){
        totalEpisodes += season.watched.length;
        totalMinutes += season.watched.length * (season.duration || FALLBACK_EP_MINUTES);
      });
    });
    document.getElementById("statsLine").innerHTML =
      '<strong class="stat-pulse">' + totalTitles + "</strong> title" + (totalTitles === 1 ? "" : "s") +
      ' · <strong class="stat-pulse">' + totalEpisodes + "</strong> episode" + (totalEpisodes === 1 ? "" : "s") + " watched" +
      ' · <strong class="stat-pulse">' + formatWatchTime(totalMinutes) + "</strong> watch time";
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
    if(state.sortMode === "title"){
      list.sort(function(a, b){ return a.title.toLowerCase().localeCompare(b.title.toLowerCase()); });
    } else if(state.sortMode === "rating"){
      list.sort(function(a, b){ return (b.rating == null ? -1 : b.rating) - (a.rating == null ? -1 : a.rating); });
    } else if(state.sortMode === "updated"){
      list.sort(function(a, b){ return (b.updatedAt || 0) - (a.updatedAt || 0); });
    }
    // "manual" mode (default): no sort — order follows state.entries, which drag-and-drop mutates directly
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
      var justToggled = state.lastToggledEps && state.lastToggledEps.seasonId === season.id && state.lastToggledEps.eps.indexOf(i) !== -1;
      cells += '<button type="button" class="ep-cell' + (watched ? " watched" : "") + (justToggled ? " ep-pop" : "") + '" data-action="ep-toggle" data-season-id="' + season.id +
        '" data-ep="' + i + '" aria-pressed="' + watched + '" title="Episode ' + i + (watched ? " — watched" : " — not watched yet") + '">' + i + "</button>";
    }
    if(!total){
      cells += '<button type="button" class="ep-cell add-ep" data-action="ep-extend" data-season-id="' + season.id +
        '" title="Add another episode slot" aria-label="Add episode slot">+</button>';
    }
    var totalLabel = total ? total : "?";
    var aniLink = season.apiId
      ? '<a class="season-ani-link" href="https://anilist.co/anime/' + encodeURIComponent(season.apiId) + '" target="_blank" rel="noopener" title="View on AniList">↗</a>'
      : "";
    var titleAttr = season.sourceTitle ? (' title="' + escapeHtml(season.sourceTitle) + '"') : "";
    var seasonEnter = (state.lastAddedSeasonId === season.id) ? " season-enter" : "";

    return (
      '<div class="season' + seasonEnter + '" data-season-id="' + season.id + '">' +
        '<div class="season-head">' +
          '<input class="season-label-input" data-action="season-label" data-season-id="' + season.id +
            '" value="' + escapeHtml(season.label) + '"' + titleAttr + ' aria-label="Season label">' +
          '<input class="season-total-input" data-action="season-total" data-season-id="' + season.id +
            '" type="number" min="0" value="' + (total != null ? total : "") + '" placeholder="eps" aria-label="Total episodes">' +
          aniLink +
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

  function relevantApiId(entry){
    if(entry.seasons.length){
      var last = entry.seasons[entry.seasons.length - 1];
      if(last.apiId) return last.apiId;
    }
    return entry.apiId;
  }

  function formatCountdown(airingAtSeconds){
    var diffMs = airingAtSeconds * 1000 - Date.now();
    if(diffMs <= 0) return null;
    var mins = Math.floor(diffMs / 60000);
    if(mins < 60) return mins + "m";
    var hours = Math.floor(mins / 60);
    var remM = mins % 60;
    if(hours < 24) return hours + "h" + (remM ? " " + remM + "m" : "");
    var days = Math.floor(hours / 24);
    var remH = hours % 24;
    return days + "d" + (remH ? " " + remH + "h" : "");
  }

  function airingChipHtml(entry){
    var id = relevantApiId(entry);
    var info = id != null ? state.airingInfo[id] : null;
    if(!info) return "";
    var countdown = formatCountdown(info.airingAt);
    if(!countdown) return "";
    return '<span class="chip chip-airing">Ep ' + info.episode + " in " + countdown + "</span>";
  }

  var DESC_TRUNCATE = 150;

  function descriptionZoneHtml(entry){
    var chips = airingChipHtml(entry);
    (entry.genres || []).slice(0, 4).forEach(function(g){
      chips += '<span class="chip">' + escapeHtml(g) + "</span>";
    });
    if(entry.communityScore != null){
      chips += '<span class="chip chip-score">AniList ' + entry.communityScore + "%</span>";
    }

    var hasDesc = !!entry.description;
    var text = hasDesc ? entry.description : "No synopsis available yet.";
    var isLong = hasDesc && entry.description.length > DESC_TRUNCATE;

    return (
      '<div class="description-zone">' +
        '<div class="chip-row">' + chips + "</div>" +
        '<div class="description-wrap">' +
          '<p class="description-text' + (hasDesc ? "" : " placeholder") + '">' + escapeHtml(text) + "</p>" +
        "</div>" +
        '<button type="button" class="btn-link desc-toggle" data-action="toggle-description"' +
          (isLong ? "" : ' style="visibility:hidden" tabindex="-1"') + ">Show more</button>" +
      "</div>"
    );
  }

  function cardHtml(entry){
    var isNew = !state.knownCardIds[entry.id];
    state.knownCardIds[entry.id] = true;
    var pulse = (state.lastTouchedEntryId === entry.id) ? " card-pulse" : "";
    var enter = isNew ? " card-enter" : "";

    var bannerStyle = entry.banner ? (' style="background-image:url(\'' + escapeHtml(entry.banner) + '\');"') : "";

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

    var discoveringHtml = entry.discovering
      ? '<p class="discovering-note">Looking for more seasons…</p>'
      : "";

    var malLink = entry.apiId
      ? '<a class="mal-link" href="https://anilist.co/anime/' + encodeURIComponent(entry.apiId) + '" target="_blank" rel="noopener">View on AniList ↗</a>'
      : "<span></span>";

    var isOpen = !entry.collapsed;

    return (
      '<article class="card' + pulse + enter + '" draggable="true" data-id="' + entry.id + '" data-status="' + entry.status + '">' +
        '<div class="card-banner"' + bannerStyle + '>' +
          '<span class="drag-handle" draggable="true" title="Drag to reorder">⠿</span>' +
        "</div>" +
        '<div class="card-top">' +
          posterHtml +
          '<div class="card-meta">' +
            '<h3 class="card-title">' + titleInner + "</h3>" +
            '<div class="card-meta-row">' +
              '<select class="status-select" data-action="status" data-status="' + entry.status + '">' + statusOptions + "</select>" +
              '<div class="rating">' +
                '<div class="rating-bars">' + ratingBars + "</div>" +
                '<span class="rating-text">' + ratingText + "</span>" +
              "</div>" +
            "</div>" +
          "</div>" +
        "</div>" +
        progressHtml(entry) +
        '<div class="card-body">' +
          descriptionZoneHtml(entry) +
          discoveringHtml +
          '<div class="body-spacer"></div>' +
          '<button type="button" class="details-toggle" data-action="toggle-collapse" aria-expanded="' + isOpen + '">' +
            '<span class="details-toggle-label">' + (isOpen ? "Hide seasons &amp; episodes" : "Show seasons &amp; episodes") + "</span>" +
            '<span class="chevron">▾</span>' +
          "</button>" +
          '<div class="card-collapsible' + (isOpen ? " open" : "") + '">' +
            '<div class="collapsible-inner">' +
              '<div class="section-label">Seasons</div>' +
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
              '<div class="notes-zone">' +
                '<div class="section-label">Your notes</div>' +
                '<textarea class="notes-input" data-action="notes" placeholder="Thoughts, rewatch plans, where you left off…">' + escapeHtml(entry.notes) + "</textarea>" +
              "</div>" +
              '<div class="card-footer">' +
                malLink +
                '<button type="button" class="remove-btn" data-action="remove-anime">Remove</button>' +
              "</div>" +
            "</div>" +
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
      state.lastTouchedEntryId = null;
      state.lastToggledEps = null;
      state.lastAddedSeasonId = null;
      return;
    }

    if(list.length === 0){
      grid.innerHTML = '<div class="empty-state"><div class="big">No matches</div><p>Try a different filter or search term.</p></div>';
      state.lastTouchedEntryId = null;
      state.lastToggledEps = null;
      state.lastAddedSeasonId = null;
      return;
    }

    grid.innerHTML = list.map(cardHtml).join("");
    // one-shot animation flags consumed — clear so they don't replay on unrelated re-renders
    state.lastTouchedEntryId = null;
    state.lastToggledEps = null;
    state.lastAddedSeasonId = null;
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
    var season = makeSeason(defaultSeasonLabel(data.format), data.episodes || null, data.duration || null);
    if(data.apiId){ season.apiId = data.apiId; }
    var entry = {
      id: uid(),
      apiId: data.apiId || null,
      title: data.title,
      image: data.image || "",
      banner: "",
      description: "",
      genres: [],
      communityScore: null,
      status: "plan",
      rating: null,
      collapsed: true,
      notes: "",
      seasons: [season],
      discovering: !!data.apiId,
      updatedAt: Date.now()
    };
    state.entries.push(entry);
    saveEntries();
    render();
    if(data.apiId){ runDiscovery(entry.id, data.apiId); }
    return entry;
  }

  function removeEntry(id){
    var entry = findEntry(id);
    if(!entry) return;
    if(!confirm('Remove "' + entry.title + '" from your log?')) return;
    state.entries = state.entries.filter(function(e){ return e.id !== id; });
    delete state.knownCardIds[id];
    saveEntries();
    render();
    showToast("Removed from your log.");
  }

  // Moves draggedId next to targetId in the master array. Works regardless of any active
  // filter/search, since those only ever render a sub-view of state.entries' own order.
  function reorderEntries(draggedId, targetId, insertAfter){
    if(draggedId === targetId) return;
    var fromIdx = state.entries.findIndex(function(e){ return e.id === draggedId; });
    if(fromIdx === -1) return;
    var item = state.entries.splice(fromIdx, 1)[0];
    var toIdx = state.entries.findIndex(function(e){ return e.id === targetId; });
    if(toIdx === -1){ state.entries.splice(fromIdx, 0, item); return; } // target vanished — put it back
    var insertIdx = insertAfter ? toIdx + 1 : toIdx;
    state.entries.splice(insertIdx, 0, item);
    saveEntries();
    render();
  }

  // ---------- AniList detail + relation-chain discovery ----------
  function fetchMediaDetail(id){
    var gql =
      "query ($id: Int) { Media(id: $id, type: ANIME) { id title { romaji english } " +
      "description(asHtml: true) coverImage { large medium } bannerImage episodes duration format seasonYear genres averageScore " +
      "relations { edges { relationType node { id type format episodes seasonYear title { romaji english } } } } } }";

    return fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query: gql, variables: { id: id } })
    }).then(function(res){
      if(!res.ok){ throw new Error("bad-response"); }
      return res.json();
    }).then(function(json){
      if(json.errors || !json.data || !json.data.Media){ throw new Error("api-error"); }
      return json.data.Media;
    });
  }

  function relationOf(media, type){
    if(!media || !media.relations || !media.relations.edges) return null;
    var edge = media.relations.edges.find(function(e){
      return e.relationType === type && e.node.type === "ANIME" &&
        (e.node.format === "TV" || e.node.format === "ONA");
    });
    return edge ? edge.node : null;
  }

  // Walks AniList's PREQUEL/SEQUEL relation chain to build a chronological list of seasons.
  // Only follows TV/ONA entries, so spin-offs/specials/movies don't get pulled in as "seasons".
  function discoverChain(rootMedia){
    var chain = [{ id: rootMedia.id, title: pickTitle(rootMedia.title), episodes: rootMedia.episodes, duration: rootMedia.duration || null }];
    if(rootMedia.format !== "TV" && rootMedia.format !== "ONA") return Promise.resolve(chain);

    function walk(direction, cursor, guard){
      if(guard > 10) return Promise.resolve();
      var node = relationOf(cursor, direction);
      if(!node) return Promise.resolve();
      return fetchMediaDetail(node.id).then(function(detail){
        var item = { id: detail.id, title: pickTitle(detail.title), episodes: detail.episodes, duration: detail.duration || null };
        if(direction === "PREQUEL"){ chain.unshift(item); } else { chain.push(item); }
        return walk(direction, detail, guard + 1);
      }).catch(function(){ /* stop this direction quietly on any error */ });
    }

    return walk("PREQUEL", rootMedia, 0).then(function(){
      return walk("SEQUEL", rootMedia, 0);
    }).then(function(){ return chain; });
  }

  function applyDiscoveredChain(entry, chain){
    var newSeasons = chain.map(function(c, i){
      var label = chain.length > 1 ? ("Season " + (i + 1)) : "Season 1";
      var season = makeSeason(label, c.episodes, c.duration);
      season.apiId = c.id;
      season.sourceTitle = c.title;
      var existing = entry.seasons.find(function(s){ return s.apiId === c.id; });
      if(existing){
        season.watched = existing.watched.slice();
        recomputeSeasonLength(season);
      }
      return season;
    });
    entry.seasons = newSeasons;
  }

  function runDiscovery(entryId, apiId){
    fetchMediaDetail(apiId).then(function(root){
      var entry = findEntry(entryId);
      if(!entry) return; // removed while we were looking it up

      entry.description = stripHtml(root.description || "");
      entry.genres = root.genres || [];
      entry.communityScore = (typeof root.averageScore === "number") ? root.averageScore : null;
      entry.banner = root.bannerImage || "";
      if(!entry.image && root.coverImage){ entry.image = root.coverImage.large || root.coverImage.medium || ""; }

      return discoverChain(root).then(function(chain){
        var entry2 = findEntry(entryId);
        if(!entry2) return;
        if(chain.length > 1){
          applyDiscoveredChain(entry2, chain);
          autoStatus(entry2);
        } else if(entry2.seasons[0]){
          entry2.seasons[0].sourceTitle = chain[0].title;
        }
        entry2.discovering = false;
        entry2.updatedAt = Date.now();
        saveEntries();
        render();
      });
    }).catch(function(){
      var entry = findEntry(entryId);
      if(entry){
        entry.discovering = false;
        saveEntries();
        render();
      }
    });
  }

  // ---------- grid: click delegation ----------
  document.getElementById("grid").addEventListener("click", function(ev){
    // description expand/collapse is purely local UI state — no re-render needed
    var descToggle = ev.target.closest('[data-action="toggle-description"]');
    if(descToggle){
      var zone = descToggle.closest(".description-zone");
      var wrap = zone.querySelector(".description-wrap");
      var expanded = wrap.classList.toggle("expanded");
      descToggle.textContent = expanded ? "Show less" : "Show more";
      return;
    }

    // seasons/episodes collapse toggle — also a local DOM toggle, so the open/close animates smoothly
    var collapseToggle = ev.target.closest('[data-action="toggle-collapse"]');
    if(collapseToggle){
      var cardEl = collapseToggle.closest(".card");
      var collapsible = cardEl.querySelector(".card-collapsible");
      var isOpen = collapsible.classList.toggle("open");
      collapseToggle.setAttribute("aria-expanded", String(isOpen));
      var label = collapseToggle.querySelector(".details-toggle-label");
      if(label) label.textContent = isOpen ? "Hide seasons & episodes" : "Show seasons & episodes";
      var entryForCollapse = findEntry(cardEl.getAttribute("data-id"));
      if(entryForCollapse){
        entryForCollapse.collapsed = !isOpen;
        saveEntries(); // persist the preference without triggering a full re-render
      }
      return;
    }

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
      state.lastTouchedEntryId = entry.id;
      saveEntries(); render();

    } else if(action === "ep-toggle" && season){
      var ep = parseInt(actionEl.getAttribute("data-ep"), 10);
      var idx = season.watched.indexOf(ep);
      if(idx === -1){
        // marking watched — fill in any earlier gaps too, so progress reads as "watched through ep N"
        var newlyFilled = [];
        for(var fillEp = 1; fillEp <= ep; fillEp++){
          if(season.watched.indexOf(fillEp) === -1){ season.watched.push(fillEp); newlyFilled.push(fillEp); }
        }
        state.lastToggledEps = { seasonId: season.id, eps: newlyFilled };
      } else {
        season.watched.splice(idx, 1);
        state.lastToggledEps = null;
      }
      season.watched.sort(function(a, b){ return a - b; });
      autoStatus(entry);
      entry.updatedAt = Date.now();
      state.lastTouchedEntryId = entry.id;
      saveEntries(); render();

    } else if(action === "ep-extend" && season){
      season.length = (season.length || 12) + 1;
      state.lastTouchedEntryId = entry.id;
      saveEntries(); render();

    } else if(action === "season-mark-all" && season){
      var len = season.total || season.length || 12;
      var arr = [];
      for(var i = 1; i <= len; i++){ arr.push(i); }
      season.watched = arr;
      autoStatus(entry);
      entry.updatedAt = Date.now();
      state.lastTouchedEntryId = entry.id;
      saveEntries(); render();

    } else if(action === "season-clear-all" && season){
      season.watched = [];
      autoStatus(entry);
      entry.updatedAt = Date.now();
      state.lastTouchedEntryId = entry.id;
      saveEntries(); render();

    } else if(action === "season-remove" && season){
      if(!confirm('Remove "' + season.label + '" and its progress?')) return;
      entry.seasons = entry.seasons.filter(function(s){ return s.id !== seasonId; });
      autoStatus(entry);
      entry.updatedAt = Date.now();
      state.lastTouchedEntryId = entry.id;
      saveEntries(); render();

    } else if(action === "toggle-add-season"){
      ev.preventDefault();
      var azone = actionEl.closest(".add-season-zone");
      azone.querySelector(".add-season-form").classList.toggle("open");

    } else if(action === "submit-add-season"){
      var zone2 = actionEl.closest(".add-season-zone");
      var labelInput = zone2.querySelector(".as-label");
      var totalInput = zone2.querySelector(".as-total");
      var label = labelInput.value.trim() || ("Season " + (entry.seasons.length + 1));
      var totalVal = totalInput.value ? Math.max(0, parseInt(totalInput.value, 10)) : null;
      var newSeason = makeSeason(label, totalVal);
      entry.seasons.push(newSeason);
      entry.updatedAt = Date.now();
      state.lastTouchedEntryId = entry.id;
      state.lastAddedSeasonId = newSeason.id;
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
      state.lastTouchedEntryId = entry.id;
      saveEntries(); render();

    } else if(action === "notes"){
      entry.notes = ev.target.value;
      entry.updatedAt = Date.now();
      saveEntries(); render();

    } else if(action === "season-label" && season){
      season.label = ev.target.value.trim() || season.label;
      entry.updatedAt = Date.now();
      state.lastTouchedEntryId = entry.id;
      saveEntries(); render();

    } else if(action === "season-total" && season){
      var v = ev.target.value;
      season.total = v ? Math.max(0, parseInt(v, 10)) : null;
      recomputeSeasonLength(season);
      autoStatus(entry);
      entry.updatedAt = Date.now();
      state.lastTouchedEntryId = entry.id;
      saveEntries(); render();
    }
  });

  // ---------- drag-and-drop reordering ----------
  // Drag is only allowed to start from the grip handle — dragstart is cancelled otherwise,
  // so buttons, inputs, and links inside the card keep working normally.
  var grid = document.getElementById("grid");

  grid.addEventListener("dragstart", function(ev){
    var card = ev.target.closest(".card");
    if(!card) return;
    var handle = ev.target.closest(".drag-handle");
    if(!handle){ ev.preventDefault(); return; }
    if(state.sortMode !== "manual"){
      ev.preventDefault();
      showToast('Switch to "Manual order" to drag and reorder.');
      return;
    }
    state.draggedId = card.getAttribute("data-id");
    card.classList.add("dragging");
    ev.dataTransfer.effectAllowed = "move";
    try{ ev.dataTransfer.setData("text/plain", state.draggedId); }catch(e){ /* some browsers are picky here — harmless */ }
  });

  grid.addEventListener("dragover", function(ev){
    if(!state.draggedId) return;
    var targetCard = ev.target.closest(".card");
    if(!targetCard) return;
    ev.preventDefault(); // required to allow dropping
    Array.prototype.forEach.call(grid.querySelectorAll(".drag-over-top, .drag-over-bottom"), function(c){
      c.classList.remove("drag-over-top", "drag-over-bottom");
    });
    if(targetCard.getAttribute("data-id") === state.draggedId) return;
    var rect = targetCard.getBoundingClientRect();
    var after = (ev.clientY - rect.top) > rect.height / 2;
    targetCard.classList.add(after ? "drag-over-bottom" : "drag-over-top");
  });

  grid.addEventListener("drop", function(ev){
    if(!state.draggedId) return;
    var targetCard = ev.target.closest(".card");
    if(!targetCard) return;
    ev.preventDefault();
    var targetId = targetCard.getAttribute("data-id");
    var rect = targetCard.getBoundingClientRect();
    var after = (ev.clientY - rect.top) > rect.height / 2;
    reorderEntries(state.draggedId, targetId, after);
    state.draggedId = null;
  });

  grid.addEventListener("dragend", function(){
    Array.prototype.forEach.call(grid.querySelectorAll(".dragging"), function(c){ c.classList.remove("dragging"); });
    Array.prototype.forEach.call(grid.querySelectorAll(".drag-over-top, .drag-over-bottom"), function(c){
      c.classList.remove("drag-over-top", "drag-over-bottom");
    });
    state.draggedId = null;
  });


  document.getElementById("tabs").addEventListener("click", function(ev){
    var btn = ev.target.closest(".tab");
    if(!btn) return;
    state.filterStatus = btn.getAttribute("data-filter");
    renderTabs();
    renderGrid();
  });

  document.getElementById("searchMine").addEventListener("input", function(ev){
    state.searchQuery = ev.target.value.trim();
    renderGrid();
  });

  document.getElementById("sortSelect").addEventListener("change", function(ev){
    state.sortMode = ev.target.value;
    renderGrid();
  });

  document.getElementById("randomPickBtn").addEventListener("click", function(){
    if(state.entries.length === 0){
      showToast("Add something to your log first!");
      return;
    }
    var pool = state.entries.filter(function(e){ return e.status === "plan"; });
    if(pool.length === 0){ pool = state.entries.filter(function(e){ return e.status === "watching"; }); }
    if(pool.length === 0){ pool = state.entries.slice(); }
    var pick = pool[Math.floor(Math.random() * pool.length)];

    state.filterStatus = "all";
    state.searchQuery = "";
    document.getElementById("searchMine").value = "";
    renderTabs();
    renderGrid();

    var el = document.querySelector('.card[data-id="' + pick.id + '"]');
    if(el){
      if(typeof el.scrollIntoView === "function"){ el.scrollIntoView({ behavior: "smooth", block: "center" }); }
      el.classList.add("pick-highlight");
      setTimeout(function(){ el.classList.remove("pick-highlight"); }, 1800);
    }
    showToast('How about "' + pick.title + '"?');
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
    if(ev.key === "Escape"){
      if(modalBackdrop.classList.contains("open")) closeModal();
      if(importModalBackdrop && importModalBackdrop.classList.contains("open")) closeImportModal();
    }
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

  function resultRowHtml(item, index){
    var img = item.image
      ? '<img src="' + escapeHtml(item.image) + '" alt="">'
      : '<div class="poster-fallback" aria-hidden="true">🎬</div>';
    var sub = [item.format, item.year, item.episodes ? (item.episodes + " ep") : "ongoing/unknown"]
      .filter(Boolean).join(" · ");
    var already = state.entries.some(function(e){ return e.apiId === item.apiId; }) || state.addedApiIds[item.apiId];
    return (
      '<div class="result-row" style="animation-delay:' + Math.min(index * 40, 280) + 'ms">' +
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
    showToast('Added "' + item.title + '" to your log — looking for more seasons and details…');
  });

  // AniList GraphQL search — public, CORS-enabled, no API key required.
  function searchAniList(query){
    searchStatus.textContent = "Searching…";
    resultsList.innerHTML = "";

    var gql =
      "query ($s: String) { Page(perPage: 8) { media(search: $s, type: ANIME, sort: SEARCH_MATCH) { " +
      "id title { romaji english } coverImage { large medium } episodes duration format seasonYear } } }";

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
            title: pickTitle(m.title),
            image: m.coverImage ? (m.coverImage.large || m.coverImage.medium || "") : "",
            episodes: m.episodes || null,
            duration: m.duration || null,
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

  // ---------- import from AniList ----------
  var importModalBackdrop = document.getElementById("importModalBackdrop");
  var importUsernameInput = document.getElementById("importUsernameInput");
  var importStatusEl = document.getElementById("importStatus");
  var importPreviewEl = document.getElementById("importPreview");
  var pendingImportItems = [];

  var IMPORT_STATUS_MAP = {
    CURRENT: "watching", REPEATING: "watching", PLANNING: "plan",
    COMPLETED: "completed", DROPPED: "dropped", PAUSED: "watching"
  };

  function normalizeImportScore(score){
    if(!score) return null;
    var n = score <= 10 ? Math.round(score) : Math.round(score / 10);
    return Math.max(0, Math.min(10, n)) || null;
  }

  function openImportModal(){
    importModalBackdrop.classList.add("open");
    importUsernameInput.value = "";
    importStatusEl.textContent = "";
    importPreviewEl.innerHTML = "";
    pendingImportItems = [];
    setTimeout(function(){ importUsernameInput.focus(); }, 30);
  }
  function closeImportModal(){
    importModalBackdrop.classList.remove("open");
  }

  document.getElementById("importAniListBtn").addEventListener("click", openImportModal);
  document.getElementById("closeImportModalBtn").addEventListener("click", closeImportModal);
  importModalBackdrop.addEventListener("click", function(ev){
    if(ev.target === importModalBackdrop) closeImportModal();
  });
  importUsernameInput.addEventListener("keydown", function(ev){
    if(ev.key === "Enter"){ ev.preventDefault(); document.getElementById("importFetchBtn").click(); }
  });

  function renderImportPreview(flatEntries){
    var existingIds = {};
    state.entries.forEach(function(e){ if(e.apiId != null){ existingIds[e.apiId] = true; } });

    var fresh = flatEntries.filter(function(e){ return !existingIds[e.media.id]; });
    var skipped = flatEntries.length - fresh.length;
    pendingImportItems = fresh;

    importStatusEl.textContent = "";
    var summary = '<p class="import-summary">Found ' + flatEntries.length + " title" + (flatEntries.length === 1 ? "" : "s") + ". " +
      fresh.length + " new, " + skipped + " already in your log.</p>";

    if(fresh.length === 0){
      importPreviewEl.innerHTML = summary + '<p class="search-status">Nothing new to import.</p>';
      return;
    }

    var rows = fresh.slice(0, 30).map(function(e){
      var label = statusMeta[IMPORT_STATUS_MAP[e.status] || "plan"].label;
      return '<div class="import-list-row"><span>' + escapeHtml(pickTitle(e.media.title)) + "</span><span>" + label + "</span></div>";
    }).join("");
    var more = fresh.length > 30 ? '<div class="import-list-row skip">…and ' + (fresh.length - 30) + " more</div>" : "";

    importPreviewEl.innerHTML = summary +
      '<div class="import-list">' + rows + more + "</div>" +
      '<button type="button" class="btn btn-primary btn-small" id="confirmImportBtn">Import ' + fresh.length + " title" + (fresh.length === 1 ? "" : "s") + "</button>";

    document.getElementById("confirmImportBtn").addEventListener("click", function(){
      runImport(pendingImportItems);
    });
  }

  function runImport(items){
    items.forEach(function(e){
      var m = e.media;
      var status = IMPORT_STATUS_MAP[e.status] || "plan";
      var season = makeSeason(defaultSeasonLabel(m.format), m.episodes || null, m.duration || null);
      season.apiId = m.id;
      var progress = Number(e.progress) || 0;
      var watchedArr = [];
      for(var i = 1; i <= progress; i++){ watchedArr.push(i); }
      season.watched = watchedArr;
      recomputeSeasonLength(season);

      state.entries.push({
        id: uid(),
        apiId: m.id,
        title: pickTitle(m.title),
        image: m.coverImage ? (m.coverImage.large || m.coverImage.medium || "") : "",
        banner: m.bannerImage || "",
        description: stripHtml(m.description || ""),
        genres: m.genres || [],
        communityScore: (typeof m.averageScore === "number") ? m.averageScore : null,
        status: status,
        rating: normalizeImportScore(e.score),
        collapsed: true,
        notes: "",
        seasons: [season],
        discovering: false,
        updatedAt: Date.now()
      });
    });
    saveEntries();
    render();
    closeImportModal();
    showToast("Imported " + items.length + " title" + (items.length === 1 ? "" : "s") + ".");
  }

  function fetchAniListImport(username){
    importStatusEl.textContent = "Fetching " + username + "'s list…";
    importPreviewEl.innerHTML = "";

    var gql =
      "query ($name: String) { MediaListCollection(userName: $name, type: ANIME) { lists { entries { status progress score " +
      "media { id title { romaji english } coverImage { large medium } bannerImage episodes duration format genres averageScore description(asHtml: true) } } } } }";

    fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query: gql, variables: { name: username } })
    }).then(function(res){
      if(!res.ok){ throw new Error("bad-response"); }
      return res.json();
    }).then(function(json){
      if(json.errors || !json.data || !json.data.MediaListCollection){ throw new Error("not-found"); }
      var lists = json.data.MediaListCollection.lists || [];
      var flat = [];
      lists.forEach(function(l){ (l.entries || []).forEach(function(e){ flat.push(e); }); });
      if(flat.length === 0){
        importStatusEl.textContent = "No anime found on that list (or the profile/list is private).";
        return;
      }
      renderImportPreview(flat);
    }).catch(function(){
      importStatusEl.textContent = "Couldn't find that user, or their list is private.";
    });
  }

  document.getElementById("importFetchBtn").addEventListener("click", function(){
    var name = importUsernameInput.value.trim();
    if(!name){ showToast("Enter a username first."); return; }
    fetchAniListImport(name);
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
        state.knownCardIds = {};
        saveEntries();
        render();
        showToast("Import complete.");
      }catch(err){
        showToast("That file doesn't look like a valid Watch Log export.");
      }
    };
    reader.readAsText(file);
  });

  // ---------- theme toggle ----------
  var THEME_KEY = "watchlog.theme";
  function applyThemeButtonLabel(){
    var isLight = document.documentElement.getAttribute("data-theme") === "light";
    document.getElementById("themeToggle").textContent = isLight ? "☀️" : "🌙";
  }
  document.getElementById("themeToggle").addEventListener("click", function(){
    var isLight = document.documentElement.getAttribute("data-theme") === "light";
    if(isLight){
      document.documentElement.removeAttribute("data-theme");
      try{ localStorage.setItem(THEME_KEY, "dark"); }catch(e){}
    } else {
      document.documentElement.setAttribute("data-theme", "light");
      try{ localStorage.setItem(THEME_KEY, "light"); }catch(e){}
    }
    applyThemeButtonLabel();
  });
  applyThemeButtonLabel();

  // ---------- air-date countdown ----------
  function fetchAiringInfo(){
    var ids = [];
    state.entries.forEach(function(e){
      if(e.status === "watching"){
        var id = relevantApiId(e);
        if(id != null && ids.indexOf(id) === -1){ ids.push(id); }
      }
    });
    if(ids.length === 0) return;
    ids = ids.slice(0, 50); // AniList Page perPage cap — plenty for any realistic "currently watching" count

    var gql = "query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { id status nextAiringEpisode { episode airingAt } } } }";
    fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query: gql, variables: { ids: ids } })
    }).then(function(res){
      if(!res.ok){ throw new Error("bad-response"); }
      return res.json();
    }).then(function(json){
      if(json.errors){ throw new Error("api-error"); }
      var list = (json.data && json.data.Page && json.data.Page.media) || [];
      list.forEach(function(m){
        if(m.nextAiringEpisode){
          state.airingInfo[m.id] = { episode: m.nextAiringEpisode.episode, airingAt: m.nextAiringEpisode.airingAt };
        }
      });
      renderGrid();
    }).catch(function(){ /* non-critical — countdown just won't show this session */ });
  }

  // ---------- ad slots ----------
  function injectAd(slot, key, width, height){
    slot.style.width = width + "px";
    slot.style.height = height + "px";

    var configScript = document.createElement("script");
    configScript.text = "atOptions = " + JSON.stringify({ key: key, format: "iframe", height: height, width: width, params: {} }) + ";";
    slot.appendChild(configScript);

    var invokeScript = document.createElement("script");
    invokeScript.src = "https://www.highperformanceformat.com/" + key + "/invoke.js";
    slot.appendChild(invokeScript);
  }

  function loadAds(){
    // Bottom banner — always shown, responsive between two sizes.
    var bottomSlot = document.getElementById("adSlot");
    if(bottomSlot){
      var wide = window.innerWidth >= 480;
      if(wide){ injectAd(bottomSlot, "6a7a0c4964d3e8660fc91b19f382dc41", 728, 90); }
      else{ injectAd(bottomSlot, "34bafde07c6959c9246755341eedb0e5", 320, 50); }
    }

    // Top banner — desktop/tablet only, so mobile isn't sandwiched between two ads.
    var topZone = document.getElementById("adZoneTop");
    var topSlot = document.getElementById("adSlotTop");
    if(topZone && topSlot){
      if(window.innerWidth >= 700){
        injectAd(topSlot, "f11f05d413b772304e0656d5b23010e7", 468, 60);
      } else {
        topZone.classList.add("ad-hidden");
      }
    }
  }

  // ---------- init ----------
  state.entries = loadEntries();
  render();
  loadAds();
  fetchAiringInfo();
})();
