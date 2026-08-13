@description('Name of the Azure Maps account.')
param mapsAccountName string

@description('Principal ID of the identity to grant Traffic API read access (the Function App\'s managed identity).')
param readerPrincipalId string

@description('Built-in "Azure Maps Data Reader" role definition ID.')
var mapsDataReaderRoleId = '423170ca-a8f6-4b0f-8487-9e4eb8f49bfa'

// Azure Maps accounts are a global resource, but ARM still requires an explicit
// `location` — matches what `az maps account create` returned: "location": "global".
resource mapsAccount 'Microsoft.Maps/accounts@2023-06-01' = {
  name: mapsAccountName
  location: 'global'
  kind: 'Gen2'
  sku: {
    name: 'G2'
  }
  properties: {
    disableLocalAuth: true
  }
}

resource mapsRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(mapsAccount.id, readerPrincipalId, mapsDataReaderRoleId)
  scope: mapsAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', mapsDataReaderRoleId)
    principalId: readerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output accountName string = mapsAccount.name
output clientId string = mapsAccount.properties.uniqueId
