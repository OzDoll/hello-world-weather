const { app } = require('@azure/functions');
const { getAiClient } = require('../lib/aiClient');

app.http('aiPing', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'ai/ping',
  handler: async (request, context) => {
    try {
      const response = await getAiClient().chat.completions.create({
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
