# I See You

Is a location aware app. On load, it geolocates the user and shows current weather, hourly forecast, a live map with traffic, and AI enriched local news/traffic/events within a 5km radius of its location — all localized to the user's language based on their country and coordinates.

**Live at:** https://ozdoll.github.io/i-see-you/

## Stack

**Frontend** — `index.html`, single static file, no build step, no framework. Deployed via GitHub Pages (auto-rebuilds on push to `main`).

**Backend** - `api/`, Azure Functions (Node.js v4 programming model). Deployed via GitHub Actions on push to `api/**`.

**Data store** - Azure Cosmos DB (SQL API): a `Log` container (visit history) and an `AiCache` container (AI response caching, keyed by location + language, 20 min TTL).

**Infrastructure** - `infra/`, Bicep templates, deployed via GitHub Actions on push to `infra/**`. Auth throughout is Managed Identity - no API keys stored anywhere.

## APIs & services used

| Service | Used for | Auth |
|---|---|---|
| Browser Geolocation API | Visitor's lat/lon | - |
| [Open-Meteo](https://open-meteo.com/) | Current weather + hourly forecast | Keyless |
| [Nominatim](https://nominatim.org/) (OpenStreetMap) | Reverse geocoding → city/country | Keyless |
| Leaflet + OpenStreetMap tiles | Interactive map | Keyless |
| Google Fonts | Typography | Keyless |
| **Azure OpenAI (GPT-5)** | AI-generated news/events summaries via the Responses API's `web_search` tool; traffic summaries and a synthesized overview via plain chat completions | Managed Identity |
| **Azure Maps** | Real-time traffic incidents (feeds the traffic summary) and traffic-flow tile overlay on the map (proxied server-side, since tile auth is header-only) | Managed Identity |
| Azure Cosmos DB | Visit log + AI response cache | Managed Identity |
| Azure Functions | All backend API endpoints | - |
| Application Insights | Backend telemetry | - |

## Agents

There's no persistent/autonomous agent - each AI endpoint is a single stateless request per visitor, generated once per location+language then cached:

- **News / Events** - GPT-5 with the Responses API's `web_search` tool, live web search grounded in the visitor's coordinates.
- **Traffic** - GPT-5 chat completion summarizing structured real-time incident data pulled from Azure Maps (not search-grounded - general web search doesn't index live traffic).
- **Overview** - GPT-5 chat completion synthesizing the three summaries above into one short narrative.

All AI output is localized (English, Spanish, Portuguese, French, German, or Italian) based on the visitor's country, and rendered client-side via `textContent`/DOM APIs only - never `innerHTML` - since it's untrusted content flowing from live search results through an LLM.

## Next step: agentic concierge

A chat box on top of the existing services - "What should I do in Munich
this evening?" - answered by an agent-shaped Claude call that gets the
current endpoints as tools:

- `get_weather(lat, lon, hours)`
- `get_events(lat, lon, lang)`
- `get_traffic(lat, lon)`
- optionally `web_search`

Given a real goal, the model orchestrates these itself: check the
forecast, notice rain from 19:00, decide to look for indoor events,
check traffic to the venue, compose a plan. That decide–act–reassess
loop is the difference between the current setup (single-shot
generation, cached) and agency (goal-driven tool orchestration).

Architecturally it's cheap to add: the tools already exist as
functions - they just get exposed to the model instead of being called
in a fixed order. One new Azure Function hosts the agent loop (natively
supported by the Claude API: define tools, execute the model's tool-use
requests, feed results back until it stops), or the Claude Agent SDK if
the loop should be managed.

This also turns the app into a before/after comparison of the two
patterns - same data, same services: the dashboard as cheap, predictable
single-shot generation; the concierge as flexible but costlier agentic
orchestration - plus a natural place to add an eval harness for tool
selection quality.

## Repo layout

```
index.html       # live frontend
old/index.html    # previous design, kept for comparison
api/              # Azure Functions backend
infra/            # Bicep infrastructure-as-code
```

See `CLAUDE.md` for detailed architecture notes, known gotchas, and incident history.
