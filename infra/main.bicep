@description('Short name/prefix used to derive resource names. Kept fixed to match already-provisioned resource names exactly (see infra/README.md) rather than a fresh uniqueString token.')
param appName string = 'hello-world-weather'

@description('Azure region for most resources (Function App, plan, storage, Application Insights). The Cosmos account\'s actual data region is separately controlled — see modules/cosmos.bicep.')
param location string = resourceGroup().location

var storageAccountName = 'helloworldweathersa'
var planName = 'WestEuropePlan'
var functionAppName = '${appName}-api'
var appInsightsName = '${appName}-api'
var cosmosAccountName = '${appName}-cosmos'
var mapsAccountName = '${appName}-maps'

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    storageAccountName: storageAccountName
    location: location
  }
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    appInsightsName: appInsightsName
    location: location
  }
}

module cosmos 'modules/cosmos.bicep' = {
  name: 'cosmos'
  params: {
    cosmosAccountName: cosmosAccountName
    location: location
  }
}

module functionApp 'modules/functionApp.bicep' = {
  name: 'functionApp'
  params: {
    functionAppName: functionAppName
    planName: planName
    location: location
  }
}

module maps 'modules/maps.bicep' = {
  name: 'maps'
  params: {
    mapsAccountName: mapsAccountName
    readerPrincipalId: functionApp.outputs.principalId
  }
}

output functionAppUrl string = 'https://${functionApp.outputs.defaultHostName}/api'
output functionAppName string = functionApp.outputs.functionAppName
output functionAppPrincipalId string = functionApp.outputs.principalId
output storageAccountName string = storage.outputs.storageAccountName
output cosmosAccountName string = cosmos.outputs.accountName
output appInsightsName string = appInsightsName
output mapsAccountName string = maps.outputs.accountName
output mapsClientId string = maps.outputs.clientId
