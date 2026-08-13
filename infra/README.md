# Infrastructure

Bicep templates for the Azure resources behind `hello-world-weather`'s backend (`../api`). This is a **retrofit**: every resource here was originally created by hand via one-off `az` CLI commands; these templates were written afterward to match what's actually live, verified with `az deployment group what-if`, so future infra changes can go through code review instead of more ad hoc CLI commands.

## What's provisioned

| Resource | Name | Notes |
|---|---|---|
| Resource group | `hello-world-weather-rg` | Not managed by this template — created before it, deploy targets it as scope. |
| Storage account | `helloworldweathersa` | West Europe, Standard_LRS. Required by the Functions runtime; app code doesn't use it directly. |
| App Service Plan | `WestEuropePlan` | Consumption (Y1/Dynamic), **Windows** — `az functionapp create` defaults to Windows when `--os-type` isn't passed, which is what happened here. |
| Function App | `hello-world-weather-api` | Node 22, Functions v4, HTTP-only not enforced (`httpsOnly: false`, matching what's live — see Known gaps below). CORS allows `https://ozdoll.github.io` and `http://localhost:8000`. Has a system-assigned managed identity (see below). **App settings are deliberately not managed by this Bicep** — see below. |
| Application Insights | `hello-world-weather-api` | Auto-created by `az functionapp create` alongside the Function App; not something explicitly asked for originally, but it exists and is wired up via `APPLICATIONINSIGHTS_CONNECTION_STRING`, so it's modeled here. |
| Cosmos DB account | `hello-world-weather-cosmos` | Free tier, Session consistency. **Data region is Sweden Central**, not West Europe like everything else — see below. |
| Cosmos SQL database | `WeatherApp` | — |
| Cosmos SQL container | `Log` | Partition key `/id`, default TTL 2,592,000s (30 days) so entries self-prune. |
| Cosmos SQL container | `AiCache` | Partition key `/locationKey`, default TTL 1,200s (20 min). Caches AI-generated News/Traffic/Events/Overview summaries by rounded location so repeat visitors near the same spot get a fast, free cache hit instead of a fresh (slow, paid) generation — see `api/src/lib/cache.js`. |
| Azure Maps account | `hello-world-weather-maps` | Kind `Gen2`, SKU `G2`, `disableLocalAuth: true` (Managed Identity only). **Global resource** — `location: 'global'`, not region-pinned. Backs the Traffic AI feature (`api/src/lib/mapsClient.js`). |

### Azure Maps RBAC is CLI-managed, like the OpenAI grant below — despite being same-resource-group

First attempt put the `Azure Maps Data Reader` role assignment (Function App identity → the Maps account) natively in `modules/maps.bicep`, reasoning that same-resource-group role assignments don't carry the appSettings-class risk (no full-replace, nothing to wipe) and a brand-new resource has no live traffic to break. That reasoning about *risk* was right but missed a different axis entirely: **the permissions of the identity doing the deploying.** Applying it manually (an Owner-level session) worked fine; the exact same template failed in CI with:
```
Authorization failed ... does not have permission to perform action 'Microsoft.Authorization/roleAssignments/write'
```
`hello-world-weather-infra-deploy` (the CI OIDC identity) only has `Contributor` on this resource group — and `Contributor` **deliberately excludes** `Microsoft.Authorization/roleAssignments/write`. This is a real Azure RBAC guardrail (Contributor can manage resources but can't grant access to them, to prevent privilege escalation), not a bug or an oversight in the role assignment. Widening CI's permissions to fix it would undercut the whole reason it's scoped to `Contributor` in the first place, so the role assignment moved back out of Bicep and is CLI-managed instead — same pattern as the OpenAI grant. `modules/maps.bicep` now only owns the Maps account's existence/shape. If the grant is ever lost:
```bash
MSYS_NO_PATHCONV=1 az role assignment create \
  --assignee-object-id <functionApp-principalId-from-`az functionapp identity show`> \
  --assignee-principal-type ServicePrincipal \
  --role "Azure Maps Data Reader" \
  --scope "/subscriptions/<sub>/resourceGroups/hello-world-weather-rg/providers/Microsoft.Maps/accounts/hello-world-weather-maps"
```

**Earlier gotcha, still relevant if this is ever retried:** the Maps account and role assignment were first created live via `az` (same "prove the novel resource works, then codify" approach used for Cosmos DB) before Bicep existed for either. Bicep's `guid()`-named role assignment then collided with the hand-created one (`RoleAssignmentExists`) — Azure enforces uniqueness on the principal+role+scope triple, not the assignment resource's own name, so two assignments for the same triple under different names still collide. Had to `az role assignment delete` the hand-created one first. Moot now that the assignment lives outside Bicep entirely, but the same trap applies to any future CLI-then-Bicep resource.

**Lesson for next time:** "is this safe to put in Bicep" needs two separate checks — whether the *resource type* carries replace-vs-merge risk (the appSettings lesson), and separately whether the *CI identity* actually has the ARM permission the resource type requires (this one). Both matter independently; passing one doesn't imply the other.

### AI features depend on a resource this template does not own

`hello-world-weather-api` has a system-assigned managed identity (`identity: { type: 'SystemAssigned' }` in `modules/functionApp.bicep`), granted the **`Cognitive Services OpenAI User`** role scoped to `medirian-resource` (Cognitive Services/AI Services account, resource group `rg-medirian`, Sweden Central) — an existing resource from other work, reused here rather than provisioning a dedicated Azure OpenAI resource for this app. It hosts the `gpt-5` model deployment the AI features (`api/src/functions/aiPing.js` and whatever's built on top of it) call.

**This is a one-directional dependency this template cannot see or protect.** `rg-medirian` and `medirian-resource` are entirely outside `hello-world-weather-rg` and this Bicep's scope. If that resource, its `gpt-5` deployment, or the role assignment is ever changed or removed by whatever else uses it, this app's AI endpoints break with zero warning from anything in this repo — `what-if` against `hello-world-weather-rg` will never surface it. The role assignment itself was created directly via `az role assignment create --scope <medirian-resource-id>`, not through this template (cross-resource-group role assignments from a resource-group-scoped Bicep deployment need extra scope plumbing not worth adding for a single role grant); if it's ever lost, recreate it with:
```bash
MSYS_NO_PATHCONV=1 az role assignment create \
  --assignee-object-id <functionApp-principalId-from-`az functionapp identity show`> \
  --assignee-principal-type ServicePrincipal \
  --role "Cognitive Services OpenAI User" \
  --scope "/subscriptions/<sub>/resourceGroups/rg-medirian/providers/Microsoft.CognitiveServices/accounts/medirian-resource"
```
(The `MSYS_NO_PATHCONV=1` prefix matters in Git Bash — without it, the leading `/subscriptions/...` in `--scope` gets silently rewritten into a broken Windows path.)

App settings `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_DEPLOYMENT` (both non-secret — no API key is used, auth is Managed Identity) are set the same safe way as `COSMOS_CONNECTION_STRING`: `az functionapp config appsettings set`, never Bicep's `appSettings`.

### Why Cosmos DB is in Sweden Central

Everything else in this app is West Europe. When the Cosmos account was first provisioned, **both West Europe and North Europe rejected zone-redundant free-tier Cosmos account creation** with `ServiceUnavailable` — a regional capacity issue on Azure's side, not a configuration mistake. Sweden Central worked. `modules/cosmos.bicep` documents this in a param description; re-check whether West/North Europe capacity has freed up before ever "fixing" this to match the other resources' region.

### App settings are not managed by this Bicep — incident writeup

Full incident report with timeline: [`docs/incidents/2026-08-12-function-app-run-from-package-outage.md`](../docs/incidents/2026-08-12-function-app-run-from-package-outage.md). Summary below.

The first version of this template *did* manage the Function App's app settings (`AzureWebJobsStorage`, `COSMOS_CONNECTION_STRING`, `WEBSITE_RUN_FROM_PACKAGE`, etc.) as an inline `siteConfig.appSettings` array. Deploying it took the site down: `Microsoft.Web/sites` app settings are a **full replace** in ARM, not a merge, and the fixed list didn't include `WEBSITE_RUN_FROM_PACKAGE` at its then-current (deploy-tool-owned) value, so the deployment wiped it. The Function host then failed to start on every request with:

```
Shutting down host due to presence of ...\FAILED TO INITIALIZE RUN FROM PACKAGE.txt.
File content: Run From Package Initialization failed.
```

Fixed in two steps: redeployed app code (`func azure functionapp publish`) to restore a valid `WEBSITE_RUN_FROM_PACKAGE`, immediately confirming service was back (root cause found via Application Insights — `traces | where severityLevel >= 2` surfaced the exact host-shutdown message). Then tried a read-current-and-`union()` fix in Bicep (Microsoft's documented pattern for "update settings without wiping others") — that hit a *different* wall: ARM rejects a resource calling `list()` on itself within its own deployment as a **circular dependency**, even when the read and write are declared as separately-named Bicep resources, since both resolve to the same underlying `.../config/appsettings` address.

Given two failed ARM-native attempts, app settings management was moved **out of Bicep entirely**. This template only creates/updates the Function App's shape (existence, plan, CORS). App settings — including `COSMOS_CONNECTION_STRING`, which does need to track this template's Cosmos account — are synced with:

```bash
az functionapp config appsettings set \
  --name hello-world-weather-api \
  --resource-group hello-world-weather-rg \
  --settings COSMOS_CONNECTION_STRING="$(az cosmosdb keys list --name hello-world-weather-cosmos --resource-group hello-world-weather-rg --type connection-strings --query "connectionStrings[0].connectionString" -o tsv)"
```

`az functionapp config appsettings set` only touches the keys you pass it — genuinely additive/merge-safe, unlike the ARM resource type — so it can't repeat this incident. Run it manually whenever the Cosmos key rotates or the account is recreated; there's no automated step for this yet (a candidate follow-up: add it as a post-deploy step in `deploy-infra.yml`, using the `az deployment group create` outputs for resource names rather than hardcoding them again). The same command sets the AI-related settings too — `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_MAPS_CLIENT_ID` — all non-secret, no API keys anywhere in this backend (everything's Managed Identity).

### Not modeled: default alerting resources

Two resources exist in the resource group that this template intentionally does **not** manage:
- `microsoft.insights/actiongroups/Application Insights Smart Detection`
- `microsoft.alertsmanagement/smartDetectorAlertRules/Failure Anomalies - hello-world-weather-api`

Both are Azure's automatic companions to Application Insights (smart-detection failure-anomaly alerting), created for free the moment App Insights exists. They show up as `* Ignore` in `what-if` because nothing in this template references them. Leaving them unmanaged is intentional — they're low-value boilerplate, not meaningful infra decisions.

### Known gaps (live state, not yet hardened)

- `httpsOnly` is `false` on the Function App — HTTPS isn't enforced. The template matches this on purpose (so `what-if` is clean against reality), but it's a reasonable follow-up hardening step: flip to `true` in `modules/functionApp.bicep` and redeploy.

## Deploying

**Automated:** `.github/workflows/deploy-infra.yml` runs `az deployment group validate` then `az deployment group create` on every push to `main` that touches `infra/**` (also triggerable manually via `workflow_dispatch`). It authenticates as an Azure AD app registration (`hello-world-weather-infra-deploy`, app ID `c3908590-6c04-44fb-a0fe-097a904b7b98`) via **OIDC federated credentials** — no client secret stored anywhere, GitHub's own token exchanges for an Azure AD token at run time. The federated credential trusts `repo:OzDoll@82967682/i-see-you@1332474030:ref:refs/heads/main` — note the current **repo name is embedded as live text alongside the immutable IDs**, not IDs alone (see the OIDC subject claim gotcha in `CLAUDE.md`, which now also covers what broke when this repo was renamed from `hello-world-weather`). The app's role assignment is `Contributor` scoped to just `hello-world-weather-rg` (the Azure resource group name — unrelated to and unaffected by the GitHub repo's name), not the whole subscription. The three GitHub secrets it uses (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`) are identifiers, not credentials — OIDC means there's no secret value to leak or rotate.

**Manual** (for local iteration/debugging before pushing):

```bash
az deployment group validate \
  --resource-group hello-world-weather-rg \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam

az deployment group what-if \
  --resource-group hello-world-weather-rg \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam

az deployment group create \
  --resource-group hello-world-weather-rg \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam
```

Always run `what-if` and read the diff before `create`. As of this writing, a clean run shows only cosmetic drift (Azure's own auto-populated defaults for indexing policy, TLS version, App Insights flow metadata, and the CORS block living in a separate `config/web` sub-resource that `what-if` can't correlate against the inline `siteConfig.cors` in this template) — no real resource creation/deletion.

The Function App's *code* (the seven functions in `../api`) deploys separately via `.github/workflows/deploy-api.yml` on push to `api/**` — this infra template only provisions the resources the code runs on top of, and redeploying it does not redeploy app code.

## Estimated cost

The Function App (Consumption plan, 1M free executions/month), Cosmos DB (free tier: first 1000 RU/s + 25GB storage free forever per account), and Application Insights (free monthly ingestion allowance) all stay entirely within Azure's free tiers for this workload.

**The AI features are not free**, unlike the rest of this app. GPT-5 chat completions/Responses calls and Grounding-with-Bing web search (used by News/Events) are billed per-token/per-call on `medirian-resource`, and Azure Maps Traffic API calls are billed per-transaction beyond its free tier — both outside this template's control since neither resource is provisioned here. The `AiCache` container (20-min TTL) exists specifically to bound how often these paid calls actually fire, since the endpoints that trigger them are necessarily anonymous/public (see `api/src/lib/cache.js`'s doc comment) — caching is the abuse/cost control here, not auth.
