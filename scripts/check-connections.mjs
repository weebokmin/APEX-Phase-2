import { readFile } from 'node:fs/promises';

const registry = JSON.parse(await readFile('data/source-registry.json', 'utf8'));
const enabled = registry.sources.filter(source => source.enabled);
const enabledNews = enabled.filter(source => source.kind === 'news');
const errors = [];
const isHttps = value => {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
};

for (const source of enabled) {
  if (!source.displayName) errors.push(`${source.id}: displayName is required.`);
  if (!source.license || /pending|set after|do not ingest/i.test(source.license)) errors.push(`${source.id}: a confirmed licence record is required.`);
  if (!isHttps(source.termsUrl)) errors.push(`${source.id}: an HTTPS termsUrl is required.`);
  if (source.kind === 'news') {
    if (source.connector !== 'rss') errors.push(`${source.id}: connector must be rss.`);
    if (!isHttps(source.feedUrl)) errors.push(`${source.id}: an HTTPS feedUrl is required.`);
    if (!source.permittedFields?.includes('licensedBrief')) errors.push(`${source.id}: licensedBrief permission must be recorded.`);
  }
  if (source.id === 'official-f1') errors.push('official-f1: direct ingestion remains blocked without an express Formula 1 licence.');
  if (source.id === 'jolpica' && process.env.APEX_JOLPICA_NONCOMMERCIAL_CONFIRMED !== 'true') errors.push('jolpica: set APEX_JOLPICA_NONCOMMERCIAL_CONFIRMED=true only after confirming non-commercial compliance.');
}
if (errors.length) throw new Error(`Connection preflight failed:\n- ${errors.join('\n- ')}`);
console.log(`Connection preflight passed: ${enabled.length} enabled sources (${enabledNews.length} news).`);
