const { app } = require('@azure/functions');
const { getAiClient } = require('../lib/aiClient');
const { generateNews, generateEvents, generateTraffic } = require('../lib/generators');
const { getCachedOrGenerate, parseLatLon } = require('../lib/cache');

async function synthesizeOverview(lat, lon) {
  const [news, traffic, events] = await Promise.all([
    getCachedOrGenerate('news', lat, lon, () => generateNews(lat, lon)),
    getCachedOrGenerate('traffic', lat, lon, () => generateTraffic(lat, lon)),
    getCachedOrGenerate('events', lat, lon, () => generateEvents(lat, lon))
  ]);

  const response = await getAiClient().chat.completions.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT,
    messages: [
      {
        role: 'user',
        content: `Combine these three local summaries into one cohesive 3-5 sentence overview for a visitor to this area. Weave them into a natural narrative rather than just listing them.\n\nNews: ${news.text}\n\nTraffic: ${traffic.text}\n\nEvents: ${events.text}`
      }
    ],
    max_completion_tokens: 1000,
    reasoning_effort: 'low'
  });

  return response.choices[0]?.message?.content || 'Overview could not be generated.';
}

app.http('aiOverview', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'ai/overview',
  handler: async (request, context) => {
    const coords = parseLatLon(request.query);
    if (!coords) return { status: 400, jsonBody: { error: 'Invalid lat/lon' } };

    try {
      const { text, cached } = await getCachedOrGenerate(
        'overview', coords.lat, coords.lon,
        () => synthesizeOverview(coords.lat, coords.lon)
      );
      return { status: 200, jsonBody: { text, cached } };
    } catch (err) {
      context.error('aiOverview failed', err);
      return { status: 500, jsonBody: { error: 'Failed to generate overview' } };
    }
  }
});
