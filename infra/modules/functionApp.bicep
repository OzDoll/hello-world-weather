@description('Name of the Function App.')
param functionAppName string

@description('Name of the (Windows) Consumption App Service Plan.')
param planName string

@description('Azure region.')
param location string

@description('Origins allowed to call the Function App\'s HTTP endpoints.')
param corsAllowedOrigins array = [
  'https://ozdoll.github.io'
  'http://localhost:8000'
]

// This module intentionally does NOT manage app settings (COSMOS_CONNECTION_STRING,
// AzureWebJobsStorage, etc.) — see infra/README.md. `Microsoft.Web/sites/config@appsettings`
// is a full replace in ARM, not a merge; writing a fixed list here once wiped
// WEBSITE_RUN_FROM_PACKAGE (owned by the app-code deploy pipeline, not infra) and took
// the site down with "FAILED TO INITIALIZE RUN FROM PACKAGE". A read-current-then-union
// fix was attempted and hit an ARM "circular dependency" error (a resource can't list()
// itself within its own deployment, even split across differently-named Bicep resource
// blocks pointing at the same address). App settings are instead synced with
// `az functionapp config appsettings set`, which is genuinely additive/merge-safe.

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  kind: 'functionapp'
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp'
  properties: {
    serverFarmId: plan.id
    httpsOnly: false
    siteConfig: {
      cors: {
        allowedOrigins: corsAllowedOrigins
      }
    }
  }
}

output functionAppName string = functionApp.name
output defaultHostName string = functionApp.properties.defaultHostName
