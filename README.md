# Watch Log — Anime Tracker

A single-file anime watch tracker. Search for a title (pulled live from MyAnimeList via the Jikan API), add it to your log, and track season/episode progress with simple +/− controls. Everything is stored in your browser's local storage, with one-click export/import for backups or moving to another device.

## Host it on GitHub Pages

1. Create a new GitHub repository (public or private).
2. Add `index.html` to the **root** of the repo (exactly as named — GitHub Pages looks for `index.html`).
3. Commit and push.
4. In the repo, go to **Settings → Pages**.
5. Under "Build and deployment", set **Source** to "Deploy from a branch", choose your default branch (e.g. `main`) and `/ (root)` folder, then **Save**.
6. After a minute, your site will be live at `https://<your-username>.github.io/<repo-name>/`.

No build step, no dependencies to install — it's plain HTML/CSS/JS.

## Notes

- **Data lives in your browser.** Clearing site data/cookies for this URL, or opening the site in a different browser/device, starts you with an empty log. Use **Export JSON** regularly to back up, and **Import JSON** to restore or transfer.
- **Search** uses the free, public [Jikan API](https://jikan.moe/) (no API key needed). If a title isn't on MyAnimeList or the search is briefly unavailable, use "Add manually" in the search panel.
- Works entirely client-side, so it's compatible with GitHub Pages' static hosting.
