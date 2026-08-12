# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A weather/location demo app: a static frontend (`index.html`) that shows the visitor's current weather, local time, and location on load, with a map and an admin-only activity log backed by a small Azure API. Three independently deployed parts:

- **Frontend** — `index.html`, single file, no build step. Live at https://ozdoll.github.io/hello-world-weather/, deployed via GitHub Pages' built-in deployment, which rebuilds automatically on *any* push to `main` — no workflow file involved.
- **Backend** — `api/`, an Azure Functions (Node.js v4 programming model) project backed by Cosmos DB. Deployed by `.github/workflows/deploy-api.yml`, which only triggers on pushes touching `api/**`.
- **Infrastructure** — `infra/`, Bicep templates for the Azure resources the backend runs on. Deployed by `.github/workflows/deploy-infra.yml`, which only triggers on pushes touching `infra/**`.

Pushing to `main` is the deploy step for all three — there's no separate manual build/publish command for any of them, and each workflow is path-filtered so changing one part doesn't redeploy the others. The Azure resources were originally created by hand via one-off `az` CLI commands, then retrofitted into `infra/` afterward (Bicep written to match live state, verified with `az deployment group what-if`) — see Architecture below for what's actually provisioned and the two known quirks worth knowing before touching it again.

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

Infra: validate/preview/deploy manually with (also normally automatic via GitHub Actions on push to `infra/**`):
```
az deployment group validate --resource-group hello-world-weather-rg --template-file infra/main.bicep --parameters infra/main.bicepparam
az deployment group what-if   --resource-group hello-world-weather-rg --template-file infra/main.bicep --parameters infra/main.bicepparam
az deployment group create    --resource-group hello-world-weather-rg --template-file infra/main.bicep --parameters infra/main.bicepparam
```
Always read the `what-if` diff before `create`. See `infra/README.md` for what a clean diff looks like (some cosmetic drift from Azure's own auto-populated defaults is expected and harmless).

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

**Provisioned Azure resources** (subscription `personal`) — provisioned by hand originally, now codified in `infra/` (see below):
- Resource group `hello-world-weather-rg`
- Storage account `helloworldweathersa` (West Europe) — required by the Functions runtime, not used directly by app code
- Function App `hello-world-weather-api` (West Europe, Consumption/Y1 plan, **Windows** — `az functionapp create` defaults to Windows when `--os-type` isn't passed — Node 22, Functions v4) — https://hello-world-weather-api.azurewebsites.net/api/log
- Application Insights `hello-world-weather-api` — auto-created alongside the Function App by `az functionapp create`, not something explicitly requested; it's real and wired up (`APPLICATIONINSIGHTS_CONNECTION_STRING`), so it's modeled in `infra/` too
- Cosmos DB account `hello-world-weather-cosmos` — **Sweden Central**, not West Europe like the rest: West Europe *and* North Europe both rejected zone-redundant free-tier account creation with `ServiceUnavailable` (regional capacity, not a config issue) when this was set up, so Cosmos ended up in a different region from the Function App. Cross-region calls between them are negligible for this workload; if this is ever revisited, re-check whether West/North Europe capacity has freed up.
  - Free tier enabled (first 1000 RU/s + 25GB storage free forever — this workload should stay entirely inside it)
  - Database `WeatherApp`, container `Log`, partition key `/id`, container-level TTL `2592000` seconds (30 days) so entries self-prune
- CORS on the Function App allows `https://ozdoll.github.io` and `http://localhost:8000`

**CI/CD:** `.github/workflows/deploy-api.yml` runs `Azure/functions-action@v1` against `hello-world-weather-api`, authenticated via the `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` GitHub secret (a publish profile downloaded once via `az functionapp deployment list-publishing-profiles`). Triggers only on pushes touching `api/**`, plus manual `workflow_dispatch`. This deploys *app code only* — it does not touch the underlying resources; that's `infra/`'s job.

### Infrastructure (`infra/`) — Bicep

`infra/main.bicep` orchestrates four modules (`infra/modules/`): `storage.bicep`, `monitoring.bicep` (Application Insights), `cosmos.bicep` (account + database + container), `functionApp.bicep` (plan + Function App, pulls in the storage/Cosmos/App Insights outputs). `infra/main.bicepparam` holds the parameter values. Full resource inventory, the Sweden Central rationale, and what's intentionally left unmanaged (Azure's default Application Insights smart-detection alert resources) are documented in `infra/README.md` rather than duplicated here.

**CI/CD:** `.github/workflows/deploy-infra.yml` runs `az deployment group validate` then `az deployment group create` against `hello-world-weather-rg` on pushes touching `infra/**`, plus manual `workflow_dispatch`. Auth is OIDC via `azure/login@v2` — no client secret stored anywhere, just three identifier secrets (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`). The backing Azure AD app registration is `hello-world-weather-infra-deploy` (app ID `c3908590-6c04-44fb-a0fe-097a904b7b98`), with a `Contributor` role assignment scoped to only `hello-world-weather-rg`, not the subscription.

**OIDC subject claim gotcha:** the federated identity credential's `subject` is **not** the commonly-documented plain format `repo:<owner>/<repo>:ref:refs/heads/<branch>`. The token GitHub actually issues for this repo includes immutable org/repo IDs appended after `@`:
```
repo:OzDoll@82967682/hello-world-weather@1332474030:ref:refs/heads/main
```
The credential was first created with the plain format, which produced `AADSTS700213: No matching federated identity record found` on the first workflow run — the plain format simply didn't match what GitHub presented. If a federated credential is ever recreated (for this repo or a new one), don't assume the plain format: run the workflow once, pull the exact subject from the `azure/login` step's log (it prints `subject claim - ...` right before any mismatch error), and set the credential to match that verbatim rather than guessing.
