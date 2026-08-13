@description('Name of the Azure Maps account.')
param mapsAccountName string

// This module intentionally does NOT manage the role assignment granting Traffic API
// access to the Function App's managed identity — see infra/README.md. The CI deploy
// identity only has Contributor on this resource group, which deliberately excludes
// Microsoft.Authorization/roleAssignments/write (an Azure RBAC guardrail against
// privilege escalation via Contributor). A first attempt defined the role assignment
// here, which worked when applied manually (an Owner-level session) but failed in CI
// with "does not have permission to perform action
// 'Microsoft.Authorization/roleAssignments/write'". The assignment is created once via
// `az role assignment create` instead, same as the cross-resource-group OpenAI grant.

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

output accountName string = mapsAccount.name
output clientId string = mapsAccount.properties.uniqueId
