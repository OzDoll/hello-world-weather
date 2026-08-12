# Infrastructure

Bicep templates for the Azure resources behind `hello-world-weather`'s backend (`../api`). This is a **retrofit**: every resource here was originally created by hand via one-off `az` CLI commands; these templates were written afterward to match what's actually live, verified with `az deployment group what-if`, so future infra changes can go through code review instead of more ad hoc CLI commands.

## What's provisioned

| Resource | Name | Notes |
|---|---|---|
| Resource group | `hello-world-weather-rg` | Not managed by this template — created before it, deploy targets it as scope. |
| Storage account | `helloworldweathersa` | West Europe, Standard_LRS. Required by the Functions runtime; app code doesn't use it directly. |
| App Service Plan | `WestEuropePlan` | Consumption (Y1/Dynamic), **Windows** — `az functionapp create` defaults to Windows when `--os-type` isn't passed, which is what happened here. |
| Function App | `hello-world-weather-api` | Node 22, Functions v4, HTTP-only not enforced (`httpsOnly: false`, matching what's live — see Known gaps below). CORS allows `https://ozdoll.github.io` and `http://localhost:8000`. **App settings are deliberately not managed by this Bicep** — see below. |
| Application Insights | `hello-world-weather-api` | Auto-created by `az functionapp create` alongside the Function App; not something explicitly asked for originally, but it exists and is wired up via `APPLICATIONINSIGHTS_CONNECTION_STRING`, so it's modeled here. |
| Cosmos DB account | `hello-world-weather-cosmos` | Free tier, Session consistency. **Data region is Sweden Central**, not West Europe like everything else — see below. |
| Cosmos SQL database | `WeatherApp` | — |
| Cosmos SQL container | `Log` | Partition key `/id`, default TTL 2,592,000s (30 days) so entries self-prune. |

### Why Cosmos DB is in Sweden Central

Everything else in this app is West Europe. When the Cosmos account was first provisioned, **both West Europe and North Europe rejected zone-redundant free-tier Cosmos account creation** with `ServiceUnavailable` — a regional capacity issue on Azure's side, not a configuration mistake. Sweden Central worked. `modules/cosmos.bicep` documents this in a param description; re-check whether West/North Europe capacity has freed up before ever "fixing" this to match the other resources' region.

### App settings are not managed by this Bicep — incident writeup

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

`az functionapp config appsettings set` only touches the keys you pass it — genuinely additive/merge-safe, unlike the ARM resource type — so it can't repeat this incident. Run it manually whenever the Cosmos key rotates or the account is recreated; there's no automated step for this yet (a candidate follow-up: add it as a post-deploy step in `deploy-infra.yml`, using the `az deployment group create` outputs for resource names rather than hardcoding them again).

### Not modeled: default alerting resources

Two resources exist in the resource group that this template intentionally does **not** manage:
- `microsoft.insights/actiongroups/Application Insights Smart Detection`
- `microsoft.alertsmanagement/smartDetectorAlertRules/Failure Anomalies - hello-world-weather-api`

Both are Azure's automatic companions to Application Insights (smart-detection failure-anomaly alerting), created for free the moment App Insights exists. They show up as `* Ignore` in `what-if` because nothing in this template references them. Leaving them unmanaged is intentional — they're low-value boilerplate, not meaningful infra decisions.

### Known gaps (live state, not yet hardened)

- `httpsOnly` is `false` on the Function App — HTTPS isn't enforced. The template matches this on purpose (so `what-if` is clean against reality), but it's a reasonable follow-up hardening step: flip to `true` in `modules/functionApp.bicep` and redeploy.

## Deploying

**Automated:** `.github/workflows/deploy-infra.yml` runs `az deployment group validate` then `az deployment group create` on every push to `main` that touches `infra/**` (also triggerable manually via `workflow_dispatch`). It authenticates as an Azure AD app registration (`hello-world-weather-infra-deploy`, app ID `c3908590-6c04-44fb-a0fe-097a904b7b98`) via **OIDC federated credentials** — no client secret stored anywhere, GitHub's own token exchanges for an Azure AD token at run time. The federated credential trusts only `repo:OzDoll/hello-world-weather:ref:refs/heads/main`, and the app's role assignment is `Contributor` scoped to just `hello-world-weather-rg`, not the whole subscription. The three GitHub secrets it uses (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`) are identifiers, not credentials — OIDC means there's no secret value to leak or rotate.

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

The Function App's *code* (the two functions in `../api`) deploys separately via `.github/workflows/deploy-api.yml` on push to `api/**` — this infra template only provisions the resources the code runs on top of, and redeploying it does not redeploy app code.

## Estimated cost

Both the Function App (Consumption plan, 1M free executions/month) and Cosmos DB (free tier: first 1000 RU/s + 25GB storage free forever per account) are designed to stay entirely within Azure's free tiers for this workload. Application Insights has a free monthly data ingestion allowance too. Realistic ongoing cost for this app's traffic: effectively $0.
