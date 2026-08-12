const { app } = require('@azure/functions');
const { CosmosClient } = require('@azure/cosmos');

const DATABASE_ID = 'WeatherApp';
const CONTAINER_ID = 'Log';
const MAX_RESULTS = 50;

let container;
function getContainer() {
  if (!container) {
    const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
    container = client.database(DATABASE_ID).container(CONTAINER_ID);
  }
  return container;
}

app.http('logRead', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'log',
  handler: async (request, context) => {
    try {
      const { resources } = await getContainer()
        .items.query({
          query: 'SELECT TOP @limit * FROM c ORDER BY c.loggedAt DESC',
          parameters: [{ name: '@limit', value: MAX_RESULTS }]
        })
        .fetchAll();
      return { status: 200, jsonBody: resources };
    } catch (err) {
      context.error('Failed to read log', err);
      return { status: 500, jsonBody: { error: 'Failed to read log' } };
    }
  }
});
