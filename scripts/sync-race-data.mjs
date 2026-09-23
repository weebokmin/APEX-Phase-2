import { readFile, writeFile } from 'node:fs/promises';
import { validatePublished } from './validate-content.mjs';

const contentPath = 'data/published-content.json';
const registryPath = 'data/source-registry.json';
const season = process.env.APEX_SEASON || new Date().getUTCFullYear();
const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const jolpica = registry.sources.find(source => source.id === 'jolpica');

if (!jolpica?.enabled || process.env.APEX_JOLPICA_NONCOMMERCIAL_CONFIRMED !== 'true') {
  console.log('Race sync skipped: Jolpica is disabled or non-commercial confirmation is absent.');
  process.exit(0);
}
// The public Jolpica endpoint may apply short burst limits. Keep calls gentle
// and respect Retry-After when it asks us to slow down.
const minimumRequestIntervalMs = 1200;
let lastRequestStartedAt = 0;
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const request = async path => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const remainingDelay = minimumRequestIntervalMs - (Date.now() - lastRequestStartedAt);
    if (remainingDelay > 0) await wait(remainingDelay);
    lastRequestStartedAt = Date.now();
    const response = await fetch(`${jolpica.baseUrl}/${path}`, { headers: { accept: 'application/json', 'user-agent': 'APEX-editorial/1.0 contact: repository-owner' } });
    if (response.ok) return response.json();

    const retryable = [429, 500, 502, 503, 504].includes(response.status);
    if (!retryable || attempt === 4) throw new Error(`Jolpica request failed for ${path}: ${response.status} after ${attempt + 1} attempt(s)`);

    const retryAfter = Number(response.headers.get('retry-after'));
    const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(30000, 3000 * (2 ** attempt));
    console.warn(`Jolpica returned ${response.status} for ${path}; retrying in ${Math.ceil(backoffMs / 1000)}s (attempt ${attempt + 2}/5).`);
    await wait(backoffMs);
  }
};
const calendarPayload = await request(`${season}.json`);
const sourceRaces = calendarPayload?.MRData?.RaceTable?.Races;
if (!Array.isArray(sourceRaces)) throw new Error('Jolpica calendar did not match the Ergast-compatible schema. No data was written.');

const now = new Date();
const slugFor = race => `${season}-${race.round}-${race.raceName}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const calendar = sourceRaces.map(race => ({
  round: Number(race.round),
  slug: slugFor(race),
  name: race.raceName,
  country: race.Circuit?.Location?.country || '—',
  date: race.date,
  status: new Date(`${race.date}T23:59:59Z`) < now ? 'completed' : 'upcoming',
  sourceId: 'jolpica'
}));
const completed = sourceRaces.filter(race => new Date(`${race.date}T23:59:59Z`) < now);
const raceDetails = {};
for (const race of completed) {
  const resultsPayload = await request(`${season}/${race.round}/results.json?limit=100`);
  const pitStopsPayload = await request(`${season}/${race.round}/pitstops.json?limit=2000`);
  const resultRace = resultsPayload?.MRData?.RaceTable?.Races?.[0];
  const resultRows = resultRace?.Results;
  if (!Array.isArray(resultRows) || !resultRows.length) continue;
  const pitStops = pitStopsPayload?.MRData?.RaceTable?.Races?.[0]?.PitStops || [];
  const fastestLap = resultRows.filter(row => row.FastestLap?.Time?.time).sort((a, b) => a.FastestLap.Time.time.localeCompare(b.FastestLap.Time.time))[0];
  const fastestStop = pitStops.filter(stop => Number.isFinite(Number(stop.duration))).sort((a, b) => Number(a.duration) - Number(b.duration))[0];
  raceDetails[slugFor(race)] = {
    sourceId: 'jolpica',
    results: resultRows.map(row => `${row.position || '—'}|${[row.Driver?.givenName, row.Driver?.familyName].filter(Boolean).join(' ') || '—'}|${row.Constructor?.name || '—'}|${row.Time?.time || row.status || '—'}`),
    overview: {
      fastestLap: fastestLap ? { value: fastestLap.FastestLap.Time.time, label: `${[fastestLap.Driver?.givenName, fastestLap.Driver?.familyName].filter(Boolean).join(' ')} · Lap ${fastestLap.FastestLap.lap}` } : null,
      fastestPitStop: fastestStop ? { value: `${fastestStop.duration} sec`, label: fastestStop.driverId || '—' } : null,
      raceDistance: resultRows[0]?.laps ? { value: `${resultRows[0].laps} laps`, label: 'Classified winner laps' } : null
    },
    dataAvailability: { sectorTimes: false, topSpeed: false, tyreStints: false, lapTelemetry: false }
  };
}
const prior = JSON.parse(await readFile(contentPath, 'utf8'));
const retrievedAt = new Date().toISOString();
const next = {
  ...prior,
  generatedAt: retrievedAt,
  calendar,
  raceDetails,
  provenance: [...prior.provenance.filter(item => item.sourceId !== 'jolpica'), {
    sourceId: 'jolpica',
    retrievedAt,
    termsUrl: jolpica.termsUrl,
    transform: `Calendar, race classifications, fastest lap and pit-stop duration candidates from ${jolpica.baseUrl}; fields without an approved provider remain unavailable.`
  }]
};
validatePublished(next, registry);
await writeFile(contentPath, `${JSON.stringify(next, null, 2)}\n`);
console.log(`Race candidate written: ${calendar.length} calendar rounds and ${Object.keys(raceDetails).length} completed race details for ${season}.`);
