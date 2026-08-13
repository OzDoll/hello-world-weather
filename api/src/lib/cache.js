const { CosmosClient } = require('@azure/cosmos');

const DATABASE_ID = 'WeatherApp';
const CONTAINER_ID = 'AiCache';

const SUPPORTED_LANGUAGES = ['English', 'Spanish', 'Portuguese', 'French', 'German', 'Italian'];

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

// These endpoints are anonymous/public, so `lang` is attacker-controllable input that
// flows directly into an LLM prompt — allow-list it rather than just defaulting when
// absent, both to close the prompt-injection surface and to keep the cache from being
// spammed with junk-language entries.
function parseLang(query) {
  const lang = query.get('lang');
  return SUPPORTED_LANGUAGES.includes(lang) ? lang : 'English';
}

// Cache is keyed by locationKey (partition) + category + lang, no item-level ttl
// needed — the AiCache container's defaultTtl (1200s) applies automatically.
async function getCachedOrGenerate(category, lat, lon, lang, generatorFn) {
  const key = locationKey(lat, lon);
  const id = `${category}:${key}:${lang}`;

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
    lang,
    text,
    generatedAt: new Date().toISOString()
  });

  return { text, cached: false };
}

module.exports = { getCachedOrGenerate, locationKey, parseLatLon, parseLang, SUPPORTED_LANGUAGES };
