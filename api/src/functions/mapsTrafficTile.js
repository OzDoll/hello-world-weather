const { app } = require('@azure/functions');
const { getTrafficFlowTile } = require('../lib/mapsClient');

function isValidTileCoord(z, x, y) {
  if (!Number.isInteger(z) || z < 0 || z > 18) return false;
  const max = 2 ** z;
  if (!Number.isInteger(x) || x < 0 || x >= max) return false;
  if (!Number.isInteger(y) || y < 0 || y >= max) return false;
  return true;
}

app.http('mapsTrafficTile', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'maps/traffic-flow-tile/{z}/{x}/{y}',
  handler: async (request, context) => {
    const z = Number(request.params.z);
    const x = Number(request.params.x);
    const y = Number(request.params.y);

    if (!isValidTileCoord(z, x, y)) {
      return { status: 400, jsonBody: { error: 'Invalid tile coordinates' } };
    }

    try {
      const png = await getTrafficFlowTile(z, x, y);
      return {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=60'
        },
        body: png
      };
    } catch (err) {
      context.error('mapsTrafficTile failed', err);
      return { status: 502, jsonBody: { error: 'Failed to fetch traffic tile' } };
    }
  }
});
