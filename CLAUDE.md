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

**Load flow (`loadWeather()`, runs immediately on page load):** gets geolocation → fetches weather and city name concurrently via `Promise.all` → renders into `#result` → stores the rendered fields in the `lastReading` object → calls `initMap()` and `saveLogEntry()` directly (see below). No button gates any of this anymore — everything fires automatically once geolocation resolves.

**Map:** always visible, laid out in `.map-row` next to the "Nearby" tabs panel (`.intel-panel`) rather than behind a toggle. `initMap(lat, lon)` creates the Leaflet map once (guarded by `if (leafletMap) return`) and is called directly from `loadWeather()`'s success path. Tiles are CartoDB Positron (`{s}.basemaps.cartocdn.com/light_all/...`), not raw OpenStreetMap tiles — chosen for a more modern look; attribution string credits both OSM and CARTO since Positron is OSM data with CARTO's styling.

**"Nearby" tabs panel and "Overview" block — real AI-generated content, not placeholders.** `loadIntel(lat, lon)` (called from `loadWeather()`'s success path, same point as `initMap`/`saveLogEntry`) fires four independent, parallel fetches to `GET /api/ai/{news,traffic,events,overview}`, each showing its own "Loading…" state and rendering (or erroring) independently as it resolves — Overview typically finishes last since it depends on the other three server-side. `initIntelTabs()` still just handles which `.intel-pane` is visible (click a `.intel-tab`, toggle `.active`); it doesn't know anything about loading state. **Security note baked into the render functions (`loadIntelPane`, `loadOverview`):** AI-generated text is always inserted via `textContent`, never `innerHTML` — this content flows from live web search results through an LLM, an untrusted-content pipeline, so treating it as HTML would be a real XSS vector.

**Theming:** light/dark via CSS custom properties on `:root`, switched by a `data-theme` attribute (`applyTheme()`), defaulting to `prefers-color-scheme` when no explicit choice has been saved. Preference persists in `localStorage` under `theme`.

**Activity log (shared, not per-browser):** every page load now logs automatically — `saveLogEntry(lastReading)` is called directly in `loadWeather()`'s success path (fire-and-forget POST), no user action required. This changed from the earlier "log only when the map is revealed" behavior once the map stopped being something a visitor had to click to see. The viewer (`#log-btn` / `#log-panel`, `renderLog()`) stays `hidden` for normal visitors and only reveals the button when the page is loaded with `?admin=1` (`isAdmin` check) — that part is still just UI obscurity. What's real is the read path: `renderLog()` calls the backend's key-protected `GET /api/log`, prompting once for the Function key and caching it in `sessionStorage`; a missing/wrong key gets a real 401 from Azure, enforced server-side.

### Backend (`api/`) — Azure Functions + Cosmos DB + Azure OpenAI + Azure Maps
Node.js v4 programming model. HTTP-triggered functions:
- `src/functions/logWrite.js` — `POST /api/log`, `authLevel: 'anonymous'`. Validates the payload server-side (numeric ranges, string length caps), sets `id`/`loggedAt` server-side (never trusts client-supplied values for those), writes one item to Cosmos.
- `src/functions/logRead.js` — `GET /api/log`, `authLevel: 'function'`. Requires Azure's function key (sent as `x-functions-key`); queries the top 50 items ordered by `loggedAt DESC`.
- `src/functions/aiPing.js` — `GET /api/ai/ping`, `authLevel: 'function'` (not public). Minimal connectivity check for the Azure OpenAI integration — kept around post-launch as a diagnostic, not part of the real feature.
- `src/functions/aiNews.js`, `aiEvents.js` — `GET /api/ai/{news,events}`, `authLevel: 'anonymous'` (must be — called automatically for every visitor, same reasoning as `logWrite`; no key can live in shipped frontend JS). Each is a thin wrapper: `getCachedOrGenerate(category, lat, lon, generatorFn)` around `generateNews`/`generateEvents` from `src/lib/generators.js`, which call the Responses API's `web_search` tool.
- `src/functions/aiTraffic.js` — same shape, wraps `generateTraffic`, which calls Azure Maps' Traffic Incident API (`src/lib/mapsClient.js`) for real-time incidents, then summarizes that structured data with a plain (non-search) chat completion — general web search doesn't index live traffic, so this category *needs* real data, not search.
- `src/functions/aiOverview.js` — `GET /api/ai/overview`, same auth. Fetches/generates all three category summaries via the same `getCachedOrGenerate` (so it reuses cache hits from `aiNews`/`aiTraffic`/`aiEvents` rather than re-generating), then one more plain chat completion synthesizes them into one narrative.

**`src/lib/` shared modules** (avoid duplicating setup across the 5 AI functions):
- `aiClient.js` exports **two different clients** — this split exists because they hit different Azure OpenAI API surfaces and it wasn't obvious going in:
  - `getAiClient()` — `AzureOpenAI` class, classic dated-`apiVersion` REST surface. Used for plain chat completions (traffic summarization, overview synthesis) — no web search.
  - `getResponsesClient()` — plain `OpenAI` class (**not** `AzureOpenAI`) pointed at `{endpoint}openai/v1/` with a *different* Entra token scope (`https://ai.azure.com/.default` vs. the classic client's `https://cognitiveservices.azure.com/.default`). Required for `.responses.create()` with the `web_search` tool — the classic `AzureOpenAI` client 404s on it, because Responses/web_search only exists on Azure's newer unversioned `/openai/v1/` surface, not the dated-`api-version` one. Discovered by testing live, not from docs alone.
- `generators.js` — `generateNews`/`generateEvents` (Responses API + `web_search`) and `generateTraffic` (Maps data + chat completion). The single source of truth for prompts/logic, imported by both the individual endpoints and `aiOverview.js`.
- `cache.js` — `getCachedOrGenerate(category, lat, lon, generatorFn)`: rounds lat/lon to a `locationKey` (~1km grid via `.toFixed(2)`), reads/writes the `AiCache` Cosmos container (`id` = `${category}:${locationKey}`, partition key `/locationKey`). Cache existing → return it; else call `generatorFn()`, upsert, return. No item-level `ttl` needed — the container's `defaultTtl` (1200s) applies automatically. This is what stands between the anonymous AI endpoints and an open door to loop-call paid AI/search — not auth, which isn't practically possible here.
- `mapsClient.js` — Azure Maps Traffic Incident API (`GET https://atlas.microsoft.com/traffic/incident?api-version=2025-01-01&bbox=...`), Managed Identity auth (scope `https://atlas.microsoft.com/.default`) **plus a required `x-ms-client-id` header** (the Maps account's `properties.uniqueId`, stored as the `AZURE_MAPS_CLIENT_ID` app setting — not a secret, just an identifier). The API takes a bounding box, not point+radius — `boundingBox(lat, lon, radiusKm)` converts using the ~111km/degree-latitude approximation.

**GPT-5 reasoning-token gotcha, hit repeatedly during development:** GPT-5 spends tokens on internal reasoning before any visible output. A low `max_completion_tokens` can burn the *entire* budget on reasoning and return an empty `content` with **zero errors** — this happened at 20, then again at 300 (`aiPing`), then again at 500 *and* 1000 (`aiTraffic`/`aiOverview`) before being fixed. Raising the token ceiling alone was not reliable. The actual fix: pass **`reasoning_effort: 'low'`** on chat completions calls that don't need deep reasoning (traffic summarization, overview synthesis are both straightforward text tasks) — this is the principled control, not blindly raising `max_completion_tokens`. `aiTraffic`/`aiOverview` both set `max_completion_tokens: 1000` *and* `reasoning_effort: 'low'`; if this resurfaces elsewhere, reach for `reasoning_effort` first.

`logWrite`/`logRead` read the Cosmos connection string from the `COSMOS_CONNECTION_STRING` app setting (local: `api/local.settings.json`; deployed: a Function App setting, not committed anywhere). The AI functions read `AZURE_OPENAI_ENDPOINT`/`AZURE_OPENAI_DEPLOYMENT`/`AZURE_MAPS_CLIENT_ID` app settings (all non-secret — no API keys involved anywhere in this backend) and authenticate via the Function App's system-assigned managed identity, granted `Cognitive Services OpenAI User` on `medirian-resource` (**an existing resource this app does not own**, cross-resource-group — see `infra/README.md`) and `Azure Maps Data Reader` on `hello-world-weather-maps` (same-resource-group, Bicep-managed).

**Provisioned Azure resources** (subscription `personal`) — provisioned by hand originally, now codified in `infra/` (see below):
- Resource group `hello-world-weather-rg`
- Storage account `helloworldweathersa` (West Europe) — required by the Functions runtime, not used directly by app code
- Function App `hello-world-weather-api` (West Europe, Consumption/Y1 plan, **Windows** — `az functionapp create` defaults to Windows when `--os-type` isn't passed — Node 22, Functions v4) — https://hello-world-weather-api.azurewebsites.net/api/log
- Application Insights `hello-world-weather-api` — auto-created alongside the Function App by `az functionapp create`, not something explicitly requested; it's real and wired up (`APPLICATIONINSIGHTS_CONNECTION_STRING`), so it's modeled in `infra/` too
- Cosmos DB account `hello-world-weather-cosmos` — **Sweden Central**, not West Europe like the rest: West Europe *and* North Europe both rejected zone-redundant free-tier account creation with `ServiceUnavailable` (regional capacity, not a config issue) when this was set up, so Cosmos ended up in a different region from the Function App. Cross-region calls between them are negligible for this workload; if this is ever revisited, re-check whether West/North Europe capacity has freed up.
  - Free tier enabled (first 1000 RU/s + 25GB storage free forever — this workload should stay entirely inside it)
  - Database `WeatherApp`, container `Log` (partition key `/id`, TTL `2592000`s/30 days) and container `AiCache` (partition key `/locationKey`, TTL `1200`s/20 min — see the AI caching note above)
- Azure Maps account `hello-world-weather-maps` (`Microsoft.Maps/accounts`, kind `Gen2`, SKU `G2`, `disableLocalAuth: true` — Managed Identity only, no shared key auth) — Azure Maps accounts are a **global** resource, `location: 'global'` in Bicep, not region-pinned like the rest
- CORS on the Function App allows `https://ozdoll.github.io` and `http://localhost:8000`

**CI/CD:** `.github/workflows/deploy-api.yml` runs `Azure/functions-action@v1` against `hello-world-weather-api`, authenticated via the `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` GitHub secret (a publish profile downloaded once via `az functionapp deployment list-publishing-profiles`). Triggers only on pushes touching `api/**`, plus manual `workflow_dispatch`. This deploys *app code only* — it does not touch the underlying resources; that's `infra/`'s job.

### Infrastructure (`infra/`) — Bicep

`infra/main.bicep` orchestrates five modules (`infra/modules/`): `storage.bicep`, `monitoring.bicep` (Application Insights), `cosmos.bicep` (account + `Log`/`AiCache` containers), `functionApp.bicep` (plan + Function App — shape only, see below), `maps.bicep` (Azure Maps account + its own RBAC role assignment). `infra/main.bicepparam` holds the parameter values. Full resource inventory, the Sweden Central rationale, and what's intentionally left unmanaged (Azure's default Application Insights smart-detection alert resources) are documented in `infra/README.md` rather than duplicated here.

**The Function App has a system-assigned managed identity** (`identity: { type: 'SystemAssigned' }`, safe to manage via Bicep — it's a top-level resource property, not the `appSettings` sub-resource that caused the incident below). **Every role assignment granting that identity access to something is CLI-managed, not Bicep** — both the cross-resource-group one on `medirian-resource` and the same-resource-group one on `hello-world-weather-maps`. The Maps one was briefly Bicep-native (reasoning: same-resource-group, role assignments don't carry the appSettings full-replace risk, a new resource has no live traffic to break — all true) but that missed a different axis: `hello-world-weather-infra-deploy` (the CI OIDC identity) only holds `Contributor` on this resource group, and `Contributor` **deliberately excludes** `Microsoft.Authorization/roleAssignments/write` (an Azure guardrail against Contributor-based privilege escalation) — so it worked when applied manually (an Owner-level session) but failed in CI with `does not have permission to perform action 'Microsoft.Authorization/roleAssignments/write'`. Fixed by moving it back out of Bicep rather than widening CI's permissions. **The general lesson:** whether a resource is safe to manage in Bicep needs two independent checks — replace-vs-merge risk on the resource type (the appSettings lesson) *and* whether the CI identity actually holds the ARM permission that resource type requires (this one) — passing one doesn't imply the other. See `infra/README.md` for the recreate command if either grant is ever lost.

**App settings are deliberately NOT managed by Bicep.** An earlier version set them inline via `siteConfig.appSettings`, which is a full-replace in ARM, not a merge — it wiped `WEBSITE_RUN_FROM_PACKAGE` (owned by the app-code deploy pipeline) and took the site down (`FAILED TO INITIALIZE RUN FROM PACKAGE`). A read-then-`union()` fix hit a second wall: ARM rejects a resource `list()`-ing itself within its own deployment as a circular dependency, even split across differently-named Bicep resource blocks. Settings — including `COSMOS_CONNECTION_STRING` — are instead synced with `az functionapp config appsettings set` (genuinely additive, can't repeat this), run manually; full incident writeup and the exact command are in `infra/README.md`. **If you're ever tempted to move app settings back into this Bicep template, don't — re-read that section first.**

**CI/CD:** `.github/workflows/deploy-infra.yml` runs `az deployment group validate` then `az deployment group create` against `hello-world-weather-rg` on pushes touching `infra/**`, plus manual `workflow_dispatch`. Auth is OIDC via `azure/login@v2` — no client secret stored anywhere, just three identifier secrets (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`). The backing Azure AD app registration is `hello-world-weather-infra-deploy` (app ID `c3908590-6c04-44fb-a0fe-097a904b7b98`), with a `Contributor` role assignment scoped to only `hello-world-weather-rg`, not the subscription.

**OIDC subject claim gotcha:** the federated identity credential's `subject` is **not** the commonly-documented plain format `repo:<owner>/<repo>:ref:refs/heads/<branch>`. The token GitHub actually issues for this repo includes immutable org/repo IDs appended after `@`:
```
repo:OzDoll@82967682/hello-world-weather@1332474030:ref:refs/heads/main
```
The credential was first created with the plain format, which produced `AADSTS700213: No matching federated identity record found` on the first workflow run — the plain format simply didn't match what GitHub presented. If a federated credential is ever recreated (for this repo or a new one), don't assume the plain format: run the workflow once, pull the exact subject from the `azure/login` step's log (it prints `subject claim - ...` right before any mismatch error), and set the credential to match that verbatim rather than guessing.
