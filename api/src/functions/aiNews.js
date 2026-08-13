const { app } = require('@azure/functions');
const { generateNews } = require('../lib/generators');
const { getCachedOrGenerate, parseLatLon } = require('../lib/cache');

app.http('aiNews', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'ai/news',
  handler: async (request, context) => {
    const coords = parseLatLon(request.query);
    if (!coords) return { status: 400, jsonBody: { error: 'Invalid lat/lon' } };

    try {
      const { text, cached } = await getCachedOrGenerate(
        'news', coords.lat, coords.lon,
        () => generateNews(coords.lat, coords.lon)
      );
      return { status: 200, jsonBody: { text, cached } };
    } catch (err) {
      context.error('aiNews failed', err);
      return { status: 500, jsonBody: { error: 'Failed to generate news summary' } };
    }
  }
});
