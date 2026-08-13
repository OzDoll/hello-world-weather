const { OpenAI, AzureOpenAI } = require('openai');
const { DefaultAzureCredential, getBearerTokenProvider } = require('@azure/identity');

// Plain chat completions (no web search) — traffic summarization, overview synthesis.
let client;
function getAiClient() {
  if (!client) {
    const credential = new DefaultAzureCredential();
    const azureADTokenProvider = getBearerTokenProvider(credential, 'https://cognitiveservices.azure.com/.default');
    client = new AzureOpenAI({
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      azureADTokenProvider,
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
      apiVersion: '2024-10-21'
    });
  }
  return client;
}

// Responses API (web_search tool) — only reachable on Azure's newer unversioned
// /openai/v1/ surface, which needs the plain OpenAI client (not AzureOpenAI) pointed
// at that base URL, with a different Entra token scope. The classic AzureOpenAI client
// above 404s on .responses.create() — it targets the older dated-api-version surface,
// which doesn't route Responses/web_search at all.
let responsesClient;
function getResponsesClient() {
  if (!responsesClient) {
    const credential = new DefaultAzureCredential();
    const azureADTokenProvider = getBearerTokenProvider(credential, 'https://ai.azure.com/.default');
    responsesClient = new OpenAI({
      baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}openai/v1/`,
      apiKey: azureADTokenProvider
    });
  }
  return responsesClient;
}

module.exports = { getAiClient, getResponsesClient };
