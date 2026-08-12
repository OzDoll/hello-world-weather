@description('Name of the storage account backing the Function App runtime (required by Azure Functions, not used directly by app code).')
param storageAccountName string

@description('Azure region for the storage account.')
param location string

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
}

output storageAccountName string = storageAccount.name
