const { DefaultAzureCredential, getBearerTokenProvider } = require('@azure/identity');

let tokenProvider;
function getTokenProvider() {
  if (!tokenProvider) {
    tokenProvider = getBearerTokenProvider(new DefaultAzureCredential(), 'https://atlas.microsoft.com/.default');
  }
  return tokenProvider;
}

// ~5km bounding box around a point. 1 degree latitude ≈ 111km; longitude scales by cos(lat).
function boundingBox(lat, lon, radiusKm = 5) {
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  return [lon - lonDelta, lat - latDelta, lon + lonDelta, lat + latDelta].join(',');
}

async function getTrafficIncidents(lat, lon) {
  const token = await getTokenProvider()();
  const bbox = boundingBox(lat, lon);
  const url = `https://atlas.microsoft.com/traffic/incident?api-version=2025-01-01&bbox=${bbox}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-ms-client-id': process.env.AZURE_MAPS_CLIENT_ID
    }
  });

  if (!res.ok) {
    throw new Error(`Azure Maps traffic request failed: ${res.status}`);
  }

  const data = await res.json();
  return (data.features || []).map((f) => ({
    title: f.properties?.title,
    description: f.properties?.description,
    type: f.properties?.incidentType,
    severity: f.properties?.severity,
    delaySeconds: f.properties?.delay,
    roadClosed: f.properties?.isRoadClosed
  }));
}

async function getTrafficFlowTile(z, x, y) {
  const token = await getTokenProvider()();
  // "relative" colors by how current speed compares to that road's own free-flow
  // speed, not raw absolute speed — "absolute" made e.g. slow residential streets
  // show red/orange even at 4am with zero real congestion, since their normal speed
  // is just objectively low. "relative" is Microsoft's own recommended default for
  // visualizing genuine congestion.
  const url = `https://atlas.microsoft.com/traffic/flow/tile/png?api-version=1.0&style=relative&zoom=${z}&x=${x}&y=${y}&thickness=10`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-ms-client-id': process.env.AZURE_MAPS_CLIENT_ID
    }
  });

  if (!res.ok) {
    throw new Error(`Azure Maps tile request failed: ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

module.exports = { getTrafficIncidents, getTrafficFlowTile };
