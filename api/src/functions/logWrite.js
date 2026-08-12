const { app } = require('@azure/functions');
const { CosmosClient } = require('@azure/cosmos');
const { randomUUID } = require('node:crypto');

const DATABASE_ID = 'WeatherApp';
const CONTAINER_ID = 'Log';
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

let container;
function getContainer() {
  if (!container) {
    const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
    container = client.database(DATABASE_ID).container(CONTAINER_ID);
  }
  return container;
}

function isValidReading(body) {
  if (!body || typeof body !== 'object') return false;
  const { latitude, longitude, temperature, wind, description, timezone, localTime, city } = body;
  if (typeof latitude !== 'number' || latitude < -90 || latitude > 90) return false;
  if (typeof longitude !== 'number' || longitude < -180 || longitude > 180) return false;
  if (typeof temperature !== 'number' || Math.abs(temperature) > 100) return false;
  if (typeof wind !== 'number' || wind < 0 || wind > 500) return false;
  if (typeof description !== 'string' || description.length > 100) return false;
  if (typeof timezone !== 'string' || timezone.length > 100) return false;
  if (typeof localTime !== 'string' || localTime.length > 100) return false;
  if (city !== null && city !== undefined && (typeof city !== 'string' || city.length > 200)) return false;
  return true;
}

app.http('logWrite', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'log',
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: 'Invalid JSON body' } };
    }

    if (!isValidReading(body)) {
      return { status: 400, jsonBody: { error: 'Invalid reading payload' } };
    }

    const entry = {
      id: randomUUID(),
      city: body.city ?? null,
      latitude: body.latitude,
      longitude: body.longitude,
      temperature: body.temperature,
      description: body.description,
      wind: body.wind,
      timezone: body.timezone,
      localTime: body.localTime,
      loggedAt: new Date().toISOString(),
      ttl: TTL_SECONDS
    };

    try {
      await getContainer().items.create(entry);
    } catch (err) {
      context.error('Failed to write log entry', err);
      return { status: 500, jsonBody: { error: 'Failed to save entry' } };
    }

    return { status: 201, jsonBody: { ok: true } };
  }
});
