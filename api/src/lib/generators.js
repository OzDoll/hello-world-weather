const { getResponsesClient, getAiClient } = require('./aiClient');
const { getTrafficIncidents } = require('./mapsClient');

async function generateNews(lat, lon, lang) {
  const response = await getResponsesClient().responses.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT,
    input: `Search the web for notable local news within about 5km of latitude ${lat}, longitude ${lon}, from the last 24-48 hours. Format your response as a bulleted list: one item per line, each starting with "- ". Keep each bullet to one sentence, mentioning specific stories where possible. If nothing notable is found, say so briefly rather than inventing anything. Respond in ${lang}.`,
    tools: [{ type: 'web_search' }]
  });
  return response.output_text || 'No notable news found nearby right now.';
}

async function generateEvents(lat, lon, lang) {
  const response = await getResponsesClient().responses.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT,
    input: `Search the web for notable upcoming local events (this week) within about 5km of latitude ${lat}, longitude ${lon} — concerts, markets, festivals, sports, community events. Format your response as a bulleted list: one item per line, each starting with "- ". Keep each bullet to one sentence, mentioning specific events where possible. If nothing notable is found, say so briefly rather than inventing anything. Respond in ${lang}.`,
    tools: [{ type: 'web_search' }]
  });
  return response.output_text || 'No notable events found nearby right now.';
}

async function generateTraffic(lat, lon, lang) {
  const incidents = await getTrafficIncidents(lat, lon);

  if (!incidents.length) {
    return 'No significant traffic incidents reported within 5km right now.';
  }

  const response = await getAiClient().chat.completions.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT,
    messages: [
      {
        role: 'user',
        content: `Summarize these real-time traffic incidents for a general audience, prioritizing the most severe/impactful ones. Format your response as a bulleted list: one item per line, each starting with "- ". Keep each bullet to one sentence. Respond in ${lang}. Data:\n\n${JSON.stringify(incidents)}`
      }
    ],
    max_completion_tokens: 1000,
    reasoning_effort: 'low'
  });

  return response.choices[0]?.message?.content || 'Traffic incidents found nearby, but the summary could not be generated.';
}

module.exports = { generateNews, generateEvents, generateTraffic };
