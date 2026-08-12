@description('Name of the Application Insights component (Azure creates this by default alongside a Function App; modeled explicitly here since it now exists).')
param appInsightsName string

@description('Azure region for Application Insights.')
param location string

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
  }
}

output connectionString string = appInsights.properties.ConnectionString
