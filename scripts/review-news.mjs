import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { validatePublished } from './validate-content.mjs';

const candidatesPath = 'data/editorial-candidates.json';
const contentPath = 'data/published-content.json';
const registryPath = 'data/source-registry.json';
const engineeringNotesPath = 'data/engineering-notes.json';
const [registry, candidates, published, engineeringLibrary] = await Promise.all([
  readFile(registryPath, 'utf8').then(JSON.parse),
  readFile(candidatesPath, 'utf8').then(JSON.parse),
  readFile(contentPath, 'utf8').then(JSON.parse),
  readFile(engineeringNotesPath, 'utf8').then(JSON.parse)
]);
const sources = new Map(registry.sources.map(source => [source.id, source]));
const requireCandidate = item => {
  for (const field of ['clusterId', 'sourceId', 'canonicalUrl', 'publishedAt', 'title', 'licensedBrief']) {
    if (typeof item[field] !== 'string' || !item[field].trim()) throw new Error(`Editorial candidate is missing ${field}.`);
  }
  try { new URL(item.canonicalUrl); } catch { throw new Error(`Editorial candidate has invalid canonicalUrl: ${item.canonicalUrl}`); }
};
candidates.forEach(requireCandidate);

const knownSourceUrls = new Set(published.stories.flatMap(story => (story.sources?.length ? story.sources : [{ sourceId: story.sourceId, url: story.canonicalUrl }]).map(source => `${source.sourceId}:${source.url}`.toLowerCase())));
const eligible = candidates.filter(item => {
  const source = sources.get(item.sourceId);
  return source?.enabled && source.kind === 'news' && !knownSourceUrls.has(`${item.sourceId}:${item.canonicalUrl}`.toLowerCase());
});
const clusterMap = new Map();
for (const item of eligible) clusterMap.set(item.clusterId, [...(clusterMap.get(item.clusterId) || []), item]);
const clusters = [...clusterMap.entries()].flatMap(([clusterId, items]) => new Set(items.map(item => item.sourceId)).size >= 2 ? [{ clusterId, items }] : []);

if (!clusters.length) {
  console.log('No eligible editorial clusters with two distinct approved sources.');
  process.exit(0);
}
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required to generate review candidates; no source content was sent.');

const instructions = `You are the APEX editorial desk, not a reporter or analyst. Use ONLY the supplied licensed briefs. For each cluster, retain only facts that are explicitly supported by at least two supplied briefs. Do not add facts, context, opinion, inference, analysis, predictions, comparisons, performance estimates, or direct quotes. Do not say or imply that an outcome is expected, improved, better, faster, or likely. Return JSON with a stories array. Return at most one story for each cluster and omit a cluster when there is no clear common factual core. Each story must contain clusterId, category (TECHNICAL or PADDOCK), title, summary, and tags. Write concise original Korean prose, no more than 550 Korean characters. TECHNICAL requires a componentKey only when every supplied brief identifies the same component; choose only from the supplied allowedComponentKeys. PADDOCK categories may only be DRIVER, TEAM, or OTHER in tags. Do not reproduce sentence structure from any brief.`;
const input = clusters.map(({ clusterId, items }) => ({
  clusterId,
  allowedComponentKeys: [...new Set(items.map(item => item.componentKey).filter(Boolean))],
  sources: items.map(item => ({
    sourceId: item.sourceId,
    sourceName: sources.get(item.sourceId).displayName || item.sourceId,
    canonicalUrl: item.canonicalUrl,
    publishedAt: item.publishedAt,
    title: item.title,
    licensedBrief: item.licensedBrief
  }))
}));
const response = await fetch('https://api.openai.com/v1/responses', {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
  body: JSON.stringify({ model: process.env.APEX_EDITORIAL_MODEL || 'gpt-5-mini', store: false, instructions, input: JSON.stringify(input), text: { format: { type: 'json_object' } } })
});
if (!response.ok) throw new Error(`OpenAI editorial review failed: ${response.status}`);
const result = await response.json();
const generated = JSON.parse(result.output_text || '{}').stories || [];
const clusterById = new Map(clusters.map(cluster => [cluster.clusterId, cluster]));
const stories = generated.flatMap(item => {
  const cluster = clusterById.get(item.clusterId);
  if (!cluster || !['TECHNICAL', 'PADDOCK'].includes(item.category) || typeof item.summary !== 'string' || item.summary.length > 550 || typeof item.title !== 'string') return [];
  const componentKey = item.category === 'TECHNICAL' ? item.componentKey : null;
  const notes = componentKey && engineeringLibrary.notes?.[componentKey];
  if (item.category === 'TECHNICAL' && !notes) return [];
  const primary = cluster.items[0];
  const id = createHash('sha256').update(cluster.items.map(source => `${source.sourceId}:${source.canonicalUrl}`).sort().join('|')).digest('hex').slice(0, 16);
  return [{
    id,
    sourceId: primary.sourceId,
    canonicalUrl: primary.canonicalUrl,
    publishedAt: primary.publishedAt,
    title: item.title,
    summary: item.summary,
    category: item.category,
    tags: Array.isArray(item.tags) ? item.tags.filter(tag => typeof tag === 'string').slice(0, 6) : [],
    sources: cluster.items.map(source => ({ sourceId: source.sourceId, name: sources.get(source.sourceId).displayName || source.sourceId, url: source.canonicalUrl })),
    ...(notes ? { engineeringNotes: notes } : {})
  }];
});
const retrievedAt = new Date().toISOString();
const next = {
  ...published,
  generatedAt: retrievedAt,
  stories: [...published.stories, ...stories],
  provenance: [...published.provenance, ...[...new Set(stories.flatMap(story => story.sources.map(source => source.sourceId)))].map(sourceId => ({
    sourceId,
    retrievedAt,
    termsUrl: sources.get(sourceId).termsUrl,
    transform: 'AI editor used only licensed briefs from a two-source cluster; kept common facts only; requires pull-request review before merge.'
  }))]
};
validatePublished(next, registry);
await writeFile(contentPath, `${JSON.stringify(next, null, 2)}\n`);
console.log(`Editorial review candidate written: ${stories.length} stories from ${clusters.length} multi-source clusters.`);
