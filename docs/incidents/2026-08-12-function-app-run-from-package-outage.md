# Incident: Function App outage from an ARM app-settings full replace

**Date:** 2026-08-12
**Duration:** ~30 minutes (23:09–23:39 UTC), from the infra deploy that caused it to the verified fix
**Impact:** `hello-world-weather-api` (both `POST /api/log` and `GET /api/log`) returned `503 Service Unavailable` for all requests. Frontend weather/map features were unaffected (no backend dependency), but the activity log stopped working entirely — the specific symptom the user first reported ("app is failing to load log").

## Summary

The first version of `infra/main.bicep` managed the Function App's app settings (`AzureWebJobsStorage`, `COSMOS_CONNECTION_STRING`, `WEBSITE_RUN_FROM_PACKAGE`, etc.) as an inline `siteConfig.appSettings` array. `Microsoft.Web/sites` app settings are a **full replace** in ARM, not a merge. The fixed list in the template didn't account for `WEBSITE_RUN_FROM_PACKAGE`'s actual live value (owned by the app-code deploy pipeline, not infra), so deploying it overwrote that setting and corrupted the Function host's package-initialization state, taking the site down for every request.

## Timeline

- **23:09 UTC** — `infra/` retrofit pushed to `main`; `deploy-infra.yml` runs `az deployment group create`, which deploys the app-settings array including a hardcoded `WEBSITE_RUN_FROM_PACKAGE: '1'`.
- **23:09–23:21 UTC** — Function host repeatedly fails to start. Application Insights records the same trace on every cold-start attempt:
  ```
  Shutting down host due to presence of C:\home\site\wwwroot\FAILED TO INITIALIZE RUN FROM PACKAGE.txt.
  File content: Run From Package Initialization failed.
  ```
- User reports the app is failing to load the log.
- **Root cause found** via `az monitor app-insights query` against the `traces` table (`severityLevel >= 2`), which surfaced the exact host-shutdown message above within the first query.
- **First fix (restore service):** `func azure functionapp publish hello-world-weather-api` — a fresh code deploy re-establishes a valid `WEBSITE_RUN_FROM_PACKAGE` state. Verified via curl: `GET /api/log` went from a 47-second hang ending in `503` to a `401` in ~0.18s (correct behavior for an unauthenticated request). Cosmos data was intact throughout — the outage was host-startup only, no data loss.
- **Second attempt (fix the template):** tried the Microsoft-documented pattern of reading current app settings and `union()`-ing new values on top, to avoid wiping settings infra doesn't own. This failed template validation with `InvalidTemplate: Circular dependency detected` — ARM rejects a resource calling `list()` on itself within its own deployment, even when the read and write are declared as separately-named Bicep resources, because both resolve to the same underlying `.../config/appsettings` resource address.
- **Final fix:** removed app-settings management from Bicep entirely. `infra/modules/functionApp.bicep` now only manages the Function App's shape (existence, hosting plan, CORS). App settings — including `COSMOS_CONNECTION_STRING`, which does need to track the Cosmos account this template provisions — are synced separately via `az functionapp config appsettings set`, which only touches the keys passed to it and is genuinely additive/merge-safe, unlike the ARM resource type.
- **23:37–23:39 UTC** — Fix applied manually (`az deployment group create`, run by the user directly per the confirmation flow used for this action, since it's a live write to production resources) and verified via curl (`401`/`201`/`200` on the three request shapes, in milliseconds, not a hang) and via `az functionapp config appsettings list`, confirming `WEBSITE_RUN_FROM_PACKAGE` was left untouched. Pushed to `main`; the CI `deploy-infra.yml` run against the same fixed template also succeeded and the app remained healthy afterward.

## Root cause

Azure Resource Manager treats `Microsoft.Web/sites.properties.siteConfig.appSettings` (and the equivalent `Microsoft.Web/sites/config@appsettings` sub-resource) as a **complete replacement** on every deployment — not a merge with whatever's already live. Any app setting not explicitly listed in the template is deleted. This is a well-known ARM/Bicep footgun, distinct from how `az functionapp config appsettings set` behaves (that CLI command *is* additive).

`WEBSITE_RUN_FROM_PACKAGE` is set and managed by the app-code deployment tooling (`func azure functionapp publish` / `Azure/functions-action@v1`), not by infrastructure provisioning. Including it — or any code-deploy-owned setting — in an infra-only Bicep template creates a standing risk that the *next* infra deploy silently reverts it to whatever the template happens to say, independent of what the code-deploy pipeline most recently set it to.

## Fix

1. **Immediate:** redeploy app code (`func azure functionapp publish`) to restore a valid package-init state.
2. **Structural:** `infra/modules/functionApp.bicep` no longer declares any `Microsoft.Web/sites/config` app-settings resource. App settings that legitimately belong to infra (currently just `COSMOS_CONNECTION_STRING`) are synced with:
   ```bash
   az functionapp config appsettings set \
     --name hello-world-weather-api \
     --resource-group hello-world-weather-rg \
     --settings COSMOS_CONNECTION_STRING="$(az cosmosdb keys list --name hello-world-weather-cosmos --resource-group hello-world-weather-rg --type connection-strings --query "connectionStrings[0].connectionString" -o tsv)"
   ```
   This command only touches the key(s) it's given — settings owned by the deploy pipeline or by Azure itself are left alone regardless of how many times it's run.

## Prevention / follow-ups

- **Never manage `Microsoft.Web/sites` app settings via a full-replace ARM/Bicep resource when a deploy pipeline also owns some of those settings.** If infra genuinely needs to own a setting, use the CLI's additive `set` command (or an equivalent merge-safe mechanism) instead of the ARM resource type.
- `infra/README.md` carries the full version of this writeup alongside the rest of the infra documentation, and `CLAUDE.md` has a pointer telling future readers not to move app settings back into Bicep without re-reading it first.
- Open follow-up (not yet done): automate the `az functionapp config appsettings set` step — e.g. as a post-deploy step in `deploy-infra.yml`, sourcing resource names from the `az deployment group create` outputs rather than hardcoding them again — so a Cosmos key rotation doesn't require a manual command.
- Application Insights (auto-provisioned alongside the Function App, not something explicitly requested when it was first created) turned out to be exactly what made root-causing this fast — a `traces` query surfaced the real error on the first try, versus guessing from HTTP status codes alone.
