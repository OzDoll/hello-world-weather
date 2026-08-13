const { CosmosClient } = require('@azure/cosmos');

const DATABASE_ID = 'WeatherApp';
const CONTAINER_ID = 'AiCache';

let container;
function getContainer() {
  if (!container) {
    const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
    container = client.database(DATABASE_ID).container(CONTAINER_ID);
  }
  return container;
}

// ~1km grid — same bucket for nearby visitors so cache hits are actually common.
function locationKey(lat, lon) {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function parseLatLon(query) {
  const lat = Number(query.get('lat'));
  const lon = Number(query.get('lon'));
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

// Cache is keyed by locationKey (partition) + category, no item-level ttl needed —
// the AiCache container's defaultTtl (1200s) applies automatically.
async function getCachedOrGenerate(category, lat, lon, generatorFn) {
  const key = locationKey(lat, lon);
  const id = `${category}:${key}`;

  try {
    const { resource } = await getContainer().item(id, key).read();
    if (resource) {
      return { text: resource.text, cached: true };
    }
  } catch (err) {
    if (err.code !== 404) throw err;
  }

  const text = await generatorFn();

  await getContainer().items.upsert({
    id,
    locationKey: key,
    category,
    text,
    generatedAt: new Date().toISOString()
  });

  return { text, cached: false };
}

module.exports = { getCachedOrGenerate, locationKey, parseLatLon };
