# Watch Log — Anime Tracker

A personal anime watch tracker, split into plain HTML/CSS/JS so it's easy to read, edit, and host.

- `index.html` — page structure
- `style.css` — all styling
- `script.js` — all app logic

## Features

- **Search & auto-add seasons** — looks up titles live via the [AniList](https://anilist.co) API and pulls in the poster, banner art, description, genres, and community score automatically. For shows AniList splits into multiple seasonal entries (e.g. *Attack on Titan* Season 1/2/3/4), it walks the prequel/sequel chain and adds every season it finds — each with its own episode count — instead of just the one you searched for. If a title isn't found, there's an "Add manually" fallback.
- **Per-episode checklist** — every season gets a grid of episode numbers you can tap individually, so you can mark exactly which episodes you've seen (not just a running count) — handy for rewatches, skipped episodes, etc.
- **Multiple seasons per show** — add more season/arc blocks yourself too via "+ Add season", each with its own checklist and total.
- **Uniform card sizing** — cards are normalized to the same height regardless of title length, description length, or genre count, so the grid looks tidy instead of jagged.
- **Per-episode checklist with auto-fill** — tap an episode to mark it watched; everything before it fills in automatically (so tapping episode 6 marks 1–6). Unmarking only removes that one episode, so you can still poke holes for rewatches/skips afterward.
- **Watch-time estimate** — the header now shows roughly how much time you've spent watching, using each show's real per-episode runtime from AniList when available (falling back to ~24 min/episode otherwise).
- **Compact cards, expand for details** — each card shows just the poster, status, rating, genres, and description by default. Tap "Show seasons & episodes" to reveal the full episode checklist and remove/AniList-link controls.
- **Sort modes** — Manual order (drag-and-drop), Title A–Z, Rating (high first), or Recently updated. Switching away from Manual and back preserves your drag order underneath.
- **Random pick** — the 🎲 button suggests something from your Plan to Watch list (or Watching, or anything, if those are empty), scrolls to it, and gives it a little glow.
- **Personal notes** — a free-text notes box per title (inside the expanded view) for things like "watching with my sister" or "paused at the beach episode."
- **Drag to reorder** — grab the ⠿ handle in the top-right of any card's banner and drag it to reorder your list. Only works while sort mode is set to "Manual order."
- **Ratings** — a quick 1–10 score per title (click a bar to set it, click the same one again to clear it).
- **Status tracking** — Watching / Completed / Plan to Watch / Dropped, with gentle automatic nudges (e.g. finishing every known episode flips it to Completed) that you can always override.
- **Export / Import JSON** — back up your log or move it to another browser/device.

## Notes on season auto-discovery

- Only kicks in for titles added via search (not "Add manually"), and only follows TV/ONA entries — movies, OVAs, and specials are left as standalone seasons so they don't get folded into the main numbering.
- Runs in the background after you add a title — you'll briefly see "Looking for more seasons…" under the seasons list while it works. If it can't find anything (or the request fails), your title just keeps the one season you added it with.
- Uses a few extra AniList requests per add (one per season found), so adding a long-running franchise may take a couple of seconds.

## Host it on GitHub Pages

1. Create a new GitHub repository (public or private).
2. Add `index.html`, `style.css`, and `script.js` to the **root** of the repo.
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
