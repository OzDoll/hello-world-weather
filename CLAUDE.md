# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file static web app (`index.html`) that shows the visitor's current weather, local time, and location on load, with an optional map and a hidden local activity log. No build step, no package manager, no server-side code — everything is inline HTML/CSS/JS in one file, plus one CDN dependency (Leaflet).

Live at https://ozdoll.github.io/hello-world-weather/, deployed via GitHub Pages from the `main` branch root — pushing to `main` is the deploy step, there is no separate build/publish command.

## Commands

Run locally (any static file server works; Pages serves the file as-is):
```
python -m http.server 8000
```
Then open `http://localhost:8000`. There is no lint, build, or test tooling in this repo — it's plain HTML/CSS/JS with no bundler.

Deploy: commit and `git push` to `main`; GitHub Pages rebuilds automatically from the repo root.

## Architecture

Everything lives in `index.html`: a `<style>` block, then markup, then a single `<script>` block. Read top to bottom — there's no module system or file-splitting to navigate.

**External services, all keyless/free-tier, no backend of our own:**
- Browser Geolocation API — source of `latitude`/`longitude`.
- Open-Meteo (`api.open-meteo.com`) — current weather + timezone, via `current_weather=true&timezone=auto`.
- Nominatim (`nominatim.openstreetmap.org`) — reverse geocoding coords → city/country for display.
- Leaflet + OpenStreetMap tiles (loaded from unpkg CDN) — the map shown by "Show on map".

**Load flow (`loadWeather()`, runs immediately on page load):** gets geolocation → fetches weather and city name concurrently via `Promise.all` → renders into `#result` → stores the rendered fields in the `lastReading` object (used later for logging) → enables the map button.

**Map:** Leaflet map is lazy-initialized on the first "Show on map" click (`toggleMap()`), then just shown/hidden on subsequent clicks rather than recreated.

**Theming:** light/dark via CSS custom properties on `:root`, switched by a `data-theme` attribute (`applyTheme()`), defaulting to `prefers-color-scheme` when no explicit choice has been saved. Preference persists in `localStorage` under `theme`.

**Local activity log:** every time the map is *shown* (not hidden) via `toggleMap()`, the current `lastReading` snapshot is appended to a capped (50-entry) array in `localStorage` under `weatherLog` (`saveLogEntry()`). The viewer for this log (`#log-btn` / `#log-panel`, `renderLog()`) stays `hidden` for normal visitors and is only revealed when the page is loaded with `?admin=1` in the URL (`isAdmin` check near the top of the script). This is obscurity, not access control — the data and the reveal logic are both fully visible in client-side source/devtools regardless of the query param.
