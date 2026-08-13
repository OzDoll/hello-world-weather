const { app } = require('@azure/functions');
const { generateEvents } = require('../lib/generators');
const { getCachedOrGenerate, parseLatLon, parseLang } = require('../lib/cache');

app.http('aiEvents', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'ai/events',
  handler: async (request, context) => {
    const coords = parseLatLon(request.query);
    if (!coords) return { status: 400, jsonBody: { error: 'Invalid lat/lon' } };
    const lang = parseLang(request.query);

    try {
      const { text, cached } = await getCachedOrGenerate(
        'events', coords.lat, coords.lon, lang,
        () => generateEvents(coords.lat, coords.lon, lang)
      );
      return { status: 200, jsonBody: { text, cached } };
    } catch (err) {
      context.error('aiEvents failed', err);
      return { status: 500, jsonBody: { error: 'Failed to generate events summary' } };
    }
  }
});
