# Watch Log — Anime Tracker

A personal anime watch tracker, split into plain HTML/CSS/JS so it's easy to read, edit, and host. It's a multi-page site now — each major section is its own HTML file (faster to load, easier to navigate) sharing one stylesheet and one script.

## Files

- `index.html` — your anime list (search/add, filters, the card grid)
- `stats.html` — stats dashboard + share-image download
- `schedule.html` — weekly airing schedule for what you're watching
- `discover.html` — recommendations based on your highly-rated titles
- `settings.html` — theme, accent color, and data export/import
- `style.css` — all styling
- `script.js` — all app logic (each page only runs the parts relevant to it)
- `manifest.json`, `service-worker.js`, `icons/` — PWA support (installable, works offline)
- `robots.txt`, `sitemap.xml` — basic SEO/crawlability

All pages share the same `localStorage` data, so your list, ratings, etc. show up consistently no matter which page you're on — navigate between them with the nav bar at the top of every page.

## SEO

Each page has a unique `<title>`, meta description, `robots` tag, canonical link, and Open Graph/Twitter Card tags (so links shared on social media or chat apps show a proper title/description/icon preview instead of a blank box). `index.html` also has basic JSON-LD structured data describing the app. `robots.txt` and `sitemap.xml` are included for search engine crawlers.

The canonical/Open Graph URLs and `sitemap.xml` point at `https://list.nexosites.xyz/` (matching `CNAME`). If you ever move this to a different domain, update the absolute URLs in each page's `<head>` plus `sitemap.xml` and `robots.txt` to match.

Worth knowing: this is a client-side, localStorage-only personal tool — there's no server-rendered content that changes per visitor, so it won't rank for searches the way a content site would. The SEO additions here are mainly about making links to it look right when shared, and giving search engines accurate metadata if someone does search for it directly.

## Features

- **Search & auto-add seasons** — looks up titles live via the [AniList](https://anilist.co) API and pulls in the poster, banner art, description, genres, and community score automatically. For shows AniList splits into multiple seasonal entries (e.g. *Attack on Titan* Season 1/2/3/4), it walks the prequel/sequel chain and adds every season it finds — each with its own episode count — instead of just the one you searched for. If a title isn't found, there's an "Add manually" fallback.
- **Per-episode checklist** — every season gets a grid of episode numbers you can tap individually, so you can mark exactly which episodes you've seen (not just a running count) — handy for rewatches, skipped episodes, etc.
- **Quick-bump from the collapsed card** — every card shows a "Next: Ep N · + Mark watched" row you can tap without expanding anything, for the common case of "I just watched the next episode." Switches to "All caught up ✓" once a season's finished.
- **Multiple seasons per show** — add more season/arc blocks yourself too via "+ Add season", each with its own checklist and total.
- **Uniform card sizing** — cards are normalized to the same height regardless of title length, description length, or genre count, so the grid looks tidy instead of jagged.
- **Per-episode checklist with auto-fill** — tap an episode to mark it watched; everything before it fills in automatically (so tapping episode 6 marks 1–6). Unmarking only removes that one episode, so you can still poke holes for rewatches/skips afterward.
- **Watch-time estimate** — the header now shows roughly how much time you've spent watching, using each show's real per-episode runtime from AniList when available (falling back to ~24 min/episode otherwise).
- **Compact cards, expand for details** — each card shows just the poster, status, rating, genres, and description by default. Tap "Show seasons & episodes" to reveal the full episode checklist and remove/AniList-link controls.
- **Import from AniList** — pull in your whole existing AniList list in one go (the ⇩ Import list button on your list page). Maps your AniList status/progress/score onto this app's fields, skips anything already in your log, and is safe to re-run any time you want to sync new additions. (MAL import isn't supported — the only public way to read an arbitrary MAL list without OAuth is through Jikan, which turned out to be unreliable for this project; if your list lives on MAL, AniList has an import tool that can migrate it over first.)
- **Air-date countdown** — anime you've marked "Watching" that's still airing gets a small "Ep N in 2d 3h" badge, refreshed once each time you load the page.
- **Light/dark theme** — the 🌙/☀️ toggle on the Settings page switches to a light theme; your choice is remembered and applied instantly on reload (no flash of the wrong theme), on every page.
- **Installable / works offline** — the site is a PWA now (manifest + service worker + icons). Browsers will offer to "install" it like an app, and the app shell (everything except live search/import, which need a connection) loads even offline once you've visited it before.
- **Stats dashboard** (its own page) — status breakdown, top genres, your rating distribution, and headline numbers (total titles, episodes, watch time, average rating).
- **Weekly airing schedule** (its own page) — a 7-day view of when your currently-Watching shows air next, built from the same airing data as the countdown badges.
- **Recommendations** (its own page) — suggests new titles based on AniList's recommendation graph for whatever you've rated 8/10 or higher, with one-click add.
- **Share image** (button on the Stats page) — generates and downloads a PNG snapshot of your stats (titles, episodes, watch time, top genres, top-rated shows) — no server involved, drawn entirely in your browser.
- **Tags** — free-form labels per title (e.g. "comfort rewatch," "watch with friends"), with a filter dropdown to view by tag.
- **Genre filter** — filter your list by any genre AniList has tagged a show with.
- **Compact view** — a denser single-column list layout (☷ Compact / ☰ Grid toggle) for browsing big lists faster.
- **Accent color picker** (on the Settings page) — pick any color for buttons/links/highlights, independent of light/dark mode.
- **Keyboard shortcuts** — `/` focuses the search box, `N` opens Add Anime, `R` triggers Random Pick (all skipped while you're typing in a field).
- **Undo instead of confirm popups** — removing a title or season is instant with a 5-second "Undo" toast, instead of a blocking "are you sure?" dialog.
- **Sort modes** — Manual order (drag-and-drop), Title A–Z, Rating (high first), or Recently updated. Switching away from Manual and back preserves your drag order underneath.
- **Random pick** — the 🎲 button suggests something from your Plan to Watch list (or Watching, or anything, if those are empty), scrolls to it, and gives it a little glow.
- **Personal notes** — a free-text notes box per title (inside the expanded view) for things like "watching with my sister" or "paused at the beach episode."
- **Drag to reorder** — grab the ⠿ handle in the top-right of any card's banner and drag it to reorder your list. Only works while sort mode is set to "Manual order."
- **Ratings** — a quick 1–10 score per title (click a bar to set it, click the same one again to clear it).
- **Status tracking** — Watching / Completed / Plan to Watch / Dropped, with gentle automatic nudges (e.g. finishing every known episode flips it to Completed) that you can always override.
- **Export / Import** (on the Settings page) — JSON backup (full data, re-importable) or CSV (a flattened, read-only spreadsheet summary — title, status, rating, episode counts, genres, tags) to back up your log or move it elsewhere.

## Notes on season auto-discovery

- Only kicks in for titles added via search (not "Add manually"), and only follows TV/ONA entries — movies, OVAs, and specials are left as standalone seasons so they don't get folded into the main numbering.
- Runs in the background after you add a title — you'll briefly see "Looking for more seasons…" under the seasons list while it works. If it can't find anything (or the request fails), your title just keeps the one season you added it with.
- Uses a few extra AniList requests per add (one per season found), so adding a long-running franchise may take a couple of seconds.

## Host it on GitHub Pages

1. Create a new GitHub repository (public or private).
2. Add all the files in this folder to the **root** of the repo — `index.html`, `stats.html`, `schedule.html`, `discover.html`, `settings.html`, `style.css`, `script.js`, `README.md`, `manifest.json`, `service-worker.js`, `robots.txt`, `sitemap.xml`, and the `icons/` folder. The relative paths matter (especially for the icons and service worker), so keep the folder structure as-is.
3. Commit and push.
4. In the repo, go to **Settings → Pages**.
5. Under "Build and deployment", set **Source** to "Deploy from a branch", choose your default branch (e.g. `main`) and `/ (root)` folder, then **Save**.
6. After a minute, your site will be live at `https://<your-username>.github.io/<repo-name>/`.

No build step, no dependencies to install.

## Notes

- **Data lives in your browser's local storage**, scoped to the exact URL you load it from. Clearing site data, or opening it from a different URL/browser/device, starts you with an empty log — use **Export JSON** regularly to back up.
- If you open `index.html` directly from your computer (double-click, `file://…`) before hosting it, some browsers restrict local storage for `file://` pages — this isn't an issue once it's actually hosted over `https://` via GitHub Pages.
- Search uses the free, public AniList GraphQL API, which is CORS-enabled for direct browser use. If it's ever briefly unreachable, use "Add manually" in the search panel.
- An earlier version of this tracker used the Jikan (MyAnimeList) API, which turned out to be unreliable for direct browser requests — this version switched to AniList for that reason.

## Ad slot

There are two banner placements: a 468×60 banner under the header (desktop/tablet only — skipped on narrow screens so mobile isn't sandwiched between two ads), and the responsive 728×90/320×50 banner below the grid. Both are labeled "Advertisement" so it's clear what they are. These use the network/keys from your `ads.txt` — specifically the plain iframe banner sizes, not the native-banner widget, since that format tends to render as a "recommended content" block that would clash with this site's look.

A couple of things worth knowing:
- Ad-blockers (uBlock Origin, Brave's built-in blocker, etc.) commonly block this particular network, so a chunk of visitors will just see an empty bordered box where the ad would be — that's expected and harmless, not a bug.
- This network (Adsterra/`highperformanceformat.com`) has a mixed reputation — display banners like the ones used here are generally fine, but the same network also sells more aggressive formats (popunders, etc.) that we deliberately didn't use. Worth keeping an eye on what actually renders once it's live.
