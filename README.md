# Watch Log — Anime Tracker

A personal anime watch tracker, split into plain HTML/CSS/JS so it's easy to read, edit, and host.

- `index.html` — page structure
- `style.css` — all styling
- `script.js` — all app logic

## Features

- **Search & add** — looks up titles live via the [AniList](https://anilist.co) API (no key needed) and pulls in the poster + episode count automatically. If a title isn't found, there's an "Add manually" fallback.
- **Per-episode checklist** — every season gets a grid of episode numbers you can tap individually, so you can mark exactly which episodes you've seen (not just a running count) — handy for rewatches, skipped episodes, etc.
- **Multiple seasons per show** — add as many season/arc blocks as you like under one entry (e.g. "Season 1", "Season 2", "Movie"), each with its own episode checklist and total.
- **Ratings** — a quick 1–10 score per title (click a bar to set it, click the same one again to clear it).
- **Status tracking** — Watching / Completed / Plan to Watch / Dropped, with gentle automatic nudges (e.g. finishing every known episode flips it to Completed) that you can always override.
- **Export / Import JSON** — back up your log or move it to another browser/device.

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
