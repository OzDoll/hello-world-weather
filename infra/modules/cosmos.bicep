@description('Name of the Cosmos DB account.')
param cosmosAccountName string

@description('ARM registration location for the Cosmos account resource (metadata location, distinct from the actual data region below).')
param location string

@description('Actual data region for the Cosmos account. Deliberately different from `location`/the rest of this app\'s resources: West Europe and North Europe both rejected zone-redundant free-tier Cosmos account creation with ServiceUnavailable (regional capacity, not a config issue) when this was first provisioned, so it landed in Sweden Central instead. Re-check whether West/North Europe capacity has freed up before ever changing this.')
param cosmosDataLocation string = 'swedencentral'

@description('Cosmos SQL database name.')
param databaseName string = 'WeatherApp'

@description('Cosmos SQL container name.')
param containerName string = 'Log'

@description('Container-level default TTL in seconds so log entries self-prune. 2592000 = 30 days.')
param defaultTtlSeconds int = 2592000

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableFreeTier: true
    enableAutomaticFailover: true
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: cosmosDataLocation
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmosAccount
  name: databaseName
  properties: {
    resource: {
      id: databaseName
    }
  }
}

resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: containerName
  properties: {
    resource: {
      id: containerName
      partitionKey: {
        paths: [
          '/id'
        ]
        kind: 'Hash'
      }
      defaultTtl: defaultTtlSeconds
    }
  }
}

@description('Cache container for AI-generated summaries, keyed by locationKey so all categories for one location share a partition.')
resource aiCacheContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: 'AiCache'
  properties: {
    resource: {
      id: 'AiCache'
      partitionKey: {
        paths: [
          '/locationKey'
        ]
        kind: 'Hash'
      }
      defaultTtl: 1200
    }
  }
}

output accountName string = cosmosAccount.name
