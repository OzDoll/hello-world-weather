const { getResponsesClient, getAiClient } = require('./aiClient');
const { getTrafficIncidents } = require('./mapsClient');

async function generateNews(lat, lon) {
  const response = await getResponsesClient().responses.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT,
    input: `Search the web for notable local news within about 5km of latitude ${lat}, longitude ${lon}, from the last 24-48 hours. Write a concise 2-4 sentence summary for a general audience, mentioning specific stories where possible. If nothing notable is found, say so briefly rather than inventing anything.`,
    tools: [{ type: 'web_search' }]
  });
  return response.output_text || 'No notable news found nearby right now.';
}

async function generateEvents(lat, lon) {
  const response = await getResponsesClient().responses.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT,
    input: `Search the web for notable upcoming local events (this week) within about 5km of latitude ${lat}, longitude ${lon} — concerts, markets, festivals, sports, community events. Write a concise 2-4 sentence summary for a general audience, mentioning specific events where possible. If nothing notable is found, say so briefly rather than inventing anything.`,
    tools: [{ type: 'web_search' }]
  });
  return response.output_text || 'No notable events found nearby right now.';
}

async function generateTraffic(lat, lon) {
  const incidents = await getTrafficIncidents(lat, lon);

  if (!incidents.length) {
    return 'No significant traffic incidents reported within 5km right now.';
  }

  const response = await getAiClient().chat.completions.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT,
    messages: [
      {
        role: 'user',
        content: `Summarize these real-time traffic incidents for a general audience in 2-4 sentences, prioritizing the most severe/impactful ones. Data:\n\n${JSON.stringify(incidents)}`
      }
    ],
    max_completion_tokens: 1000,
    reasoning_effort: 'low'
  });

  return response.choices[0]?.message?.content || 'Traffic incidents found nearby, but the summary could not be generated.';
}

module.exports = { generateNews, generateEvents, generateTraffic };
