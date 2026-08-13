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

// GPT-5 can spend its entire max_completion_tokens budget on internal reasoning and
// return empty content with zero errors — hit repeatedly during development (at 20,
// 300, 500, and 1000-token ceilings, with reasoning_effort: 'low' set). Raising the
// ceiling alone isn't reliable since this is non-deterministic per call, not a fixed
// shortfall — so retry once on empty content rather than guessing at ever-higher
// numbers. Shared by every plain (non-search) chat completion call.
async function completeChat(messages, opts = {}) {
  const params = {
    model: process.env.AZURE_OPENAI_DEPLOYMENT,
    messages,
    max_completion_tokens: 2000,
    reasoning_effort: 'low',
    ...opts
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await getAiClient().chat.completions.create(params);
    const content = response.choices[0]?.message?.content;
    if (content) return content;
  }

  return null;
}

module.exports = { getAiClient, getResponsesClient, completeChat };
