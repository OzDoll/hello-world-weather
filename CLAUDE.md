# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A weather/location demo app: a static frontend (`index.html`) that shows the visitor's current weather, local time, and location on load, with a map and an admin-only activity log backed by a small Azure API. Two independently deployed parts:

- **Frontend** — `index.html`, single file, no build step. Live at https://ozdoll.github.io/hello-world-weather/, deployed via GitHub Pages' built-in deployment, which rebuilds automatically on *any* push to `main` — no workflow file involved.
- **Backend** — `api/`, an Azure Functions (Node.js v4 programming model) project backed by Cosmos DB. Deployed by `.github/workflows/deploy-api.yml`, which only triggers on pushes touching `api/**`.

Pushing to `main` is the deploy step for both — there's no separate manual build/publish command for either half. **The Azure resources themselves (resource group, storage account, Function App, Cosmos DB account/database/container) are not managed by any pipeline or IaC file** — they were created once via one-off `az` CLI commands (see Architecture below) and any infrastructure change (region, TTL, new container, etc.) needs manual `az` commands again, not a git push.

## Commands

Frontend, run locally (any static file server works; Pages serves the file as-is):
```
python -m http.server 8000
```
Then open `http://localhost:8000`. No lint/build/test tooling — plain HTML/CSS/JS, no bundler.

Backend, run locally with Azure Functions Core Tools (`func`) — note the deployed Function App itself targets Node 22, and current Core Tools/SDK releases require Node ≥22 too, so use Node 22 locally for `api/`, not whatever older version happens to be on the machine:
```
cd api
npm install
func start
```
Needs `api/local.settings.json` (gitignored, not in the repo) with a `COSMOS_CONNECTION_STRING` value — fetch it with `az cosmosdb keys list --name hello-world-weather-cosmos --resource-group hello-world-weather-rg --type connection-strings`.

Backend deploy (normally automatic via the GitHub Actions workflow on push): manual fallback is
```
func azure functionapp publish hello-world-weather-api
```
from inside `api/`.

## Architecture

### Frontend (`index.html`)
Everything lives in one file: a `<style>` block, then markup, then a single `<script>` block.

**External services used directly from the browser, all keyless/free-tier:**
- Browser Geolocation API — source of `latitude`/`longitude`.
- Open-Meteo (`api.open-meteo.com`) — current weather + timezone, via `current_weather=true&timezone=auto`.
- Nominatim (`nominatim.openstreetmap.org`) — reverse geocoding coords → city/country for display.
- Leaflet + OpenStreetMap tiles (loaded from unpkg CDN) — the map shown by "Show on map".

**Load flow (`loadWeather()`, runs immediately on page load):** gets geolocation → fetches weather and city name concurrently via `Promise.all` → renders into `#result` → stores the rendered fields in the `lastReading` object (used later for logging) → enables the map button.

**Map:** Leaflet map is lazy-initialized on the first "Show on map" click (`toggleMap()`), then just shown/hidden on subsequent clicks rather than recreated.

**Theming:** light/dark via CSS custom properties on `:root`, switched by a `data-theme` attribute (`applyTheme()`), defaulting to `prefers-color-scheme` when no explicit choice has been saved. Preference persists in `localStorage` under `theme`.

**Activity log (shared, not per-browser):** every time the map is *shown* (not hidden) via `toggleMap()`, the current `lastReading` is POSTed to the backend (`saveLogEntry()`, fire-and-forget). The viewer (`#log-btn` / `#log-panel`, `renderLog()`) stays `hidden` for normal visitors and only reveals the button when the page is loaded with `?admin=1` (`isAdmin` check) — that part is still just UI obscurity. What's now real is the read path: `renderLog()` calls the backend's key-protected `GET /api/log`, prompting once for the Function key and caching it in `sessionStorage`; a missing/wrong key gets a real 401 from Azure, enforced server-side.

### Backend (`api/`) — Azure Functions + Cosmos DB
Node.js v4 programming model, two HTTP-triggered functions sharing the `/api/log` route, split by method + auth level:
- `src/functions/logWrite.js` — `POST`, `authLevel: 'anonymous'`. Validates the payload server-side (numeric ranges, string length caps), sets `id`/`loggedAt` server-side (never trusts client-supplied values for those), writes one item to Cosmos.
- `src/functions/logRead.js` — `GET`, `authLevel: 'function'`. Requires Azure's function key (sent as `x-functions-key`); queries the top 50 items ordered by `loggedAt DESC`.

Both read the Cosmos connection string from the `COSMOS_CONNECTION_STRING` app setting (local: `api/local.settings.json`; deployed: a Function App setting, not committed anywhere).

**Provisioned Azure resources** (subscription `personal`, all one-off `az` commands, no IaC):
- Resource group `hello-world-weather-rg`
- Storage account `helloworldweathersa` (West Europe) — required by the Functions runtime, not used directly by app code
- Function App `hello-world-weather-api` (West Europe, Consumption/Y1 plan, Node 22, Functions v4) — https://hello-world-weather-api.azurewebsites.net/api/log
- Cosmos DB account `hello-world-weather-cosmos` — **Sweden Central**, not West Europe like the rest: West Europe *and* North Europe both rejected zone-redundant free-tier account creation with `ServiceUnavailable` (regional capacity, not a config issue) when this was set up, so Cosmos ended up in a different region from the Function App. Cross-region calls between them are negligible for this workload; if this is ever revisited, re-check whether West/North Europe capacity has freed up.
  - Free tier enabled (first 1000 RU/s + 25GB storage free forever — this workload should stay entirely inside it)
  - Database `WeatherApp`, container `Log`, partition key `/id`, container-level TTL `2592000` seconds (30 days) so entries self-prune
- CORS on the Function App allows `https://ozdoll.github.io` and `http://localhost:8000` (`az functionapp cors add`)

**CI/CD:** `.github/workflows/deploy-api.yml` runs `Azure/functions-action@v1` against `hello-world-weather-api`, authenticated via the `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` GitHub secret (a publish profile downloaded once via `az functionapp deployment list-publishing-profiles`). Triggers only on pushes touching `api/**`, plus manual `workflow_dispatch`.
