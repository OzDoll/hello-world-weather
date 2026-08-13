const { app } = require('@azure/functions');
const { generateTraffic } = require('../lib/generators');
const { getCachedOrGenerate, parseLatLon, parseLang } = require('../lib/cache');

app.http('aiTraffic', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'ai/traffic',
  handler: async (request, context) => {
    const coords = parseLatLon(request.query);
    if (!coords) return { status: 400, jsonBody: { error: 'Invalid lat/lon' } };
    const lang = parseLang(request.query);

    try {
      const { text, cached } = await getCachedOrGenerate(
        'traffic', coords.lat, coords.lon, lang,
        () => generateTraffic(coords.lat, coords.lon, lang)
      );
      return { status: 200, jsonBody: { text, cached } };
    } catch (err) {
      context.error('aiTraffic failed', err);
      return { status: 500, jsonBody: { error: 'Failed to generate traffic summary' } };
    }
  }
});
