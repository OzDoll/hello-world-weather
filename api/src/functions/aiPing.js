const { app } = require('@azure/functions');
const { AzureOpenAI } = require('openai');
const { DefaultAzureCredential, getBearerTokenProvider } = require('@azure/identity');

let client;
function getClient() {
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

app.http('aiPing', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'ai/ping',
  handler: async (request, context) => {
    try {
      const response = await getClient().chat.completions.create({
        model: process.env.AZURE_OPENAI_DEPLOYMENT,
        messages: [
          { role: 'user', content: 'Reply with exactly: "connection ok".' }
        ],
        max_completion_tokens: 300
      });

      return {
        status: 200,
        jsonBody: {
          reply: response.choices[0]?.message?.content ?? null,
          model: response.model,
          usage: response.usage
        }
      };
    } catch (err) {
      context.error('AI ping failed', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  }
});
