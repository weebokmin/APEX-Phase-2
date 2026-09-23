import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { validatePublished } from './validate-content.mjs';

const candidatesPath = 'data/editorial-candidates.json';
const contentPath = 'data/published-content.json';
const registryPath = 'data/source-registry.json';
const engineeringNotesPath = 'data/engineering-notes.json';
const technicalGuidePath = 'data/technical-source-guide.json';
const [registry, candidates, published, engineeringLibrary, technicalGuide] = await Promise.all([
  readFile(registryPath, 'utf8').then(JSON.parse),
  readFile(candidatesPath, 'utf8').then(JSON.parse),
  readFile(contentPath, 'utf8').then(JSON.parse),
  readFile(engineeringNotesPath, 'utf8').then(JSON.parse),
  readFile(technicalGuidePath, 'utf8').then(JSON.parse)
]);
const sources = new Map(registry.sources.map(source => [source.id, source]));
const technicalSources = new Map(technicalGuide.sources.map(source => [source.id, source]));
const requireCandidate = item => {
  for (const field of ['clusterId', 'sourceId', 'canonicalUrl', 'publishedAt', 'title', 'licensedBrief']) {
    if (typeof item[field] !== 'string' || !item[field].trim()) throw new Error(`Editorial candidate is missing ${field}.`);
  }
  try { new URL(item.canonicalUrl); } catch { throw new Error(`Editorial candidate has invalid canonicalUrl: ${item.canonicalUrl}`); }
  if (item.technicalReferences !== undefined && !Array.isArray(item.technicalReferences)) throw new Error('Editorial candidate technicalReferences must be an array.');
  for (const reference of item.technicalReferences || []) {
    const guide = technicalSources.get(reference.sourceId);
    if (!guide) throw new Error(`Unknown technical reference source: ${reference.sourceId}`);
    if (guide.approvedForUse !== true) throw new Error(`Technical reference ${reference.sourceId} is not approved for APEX use yet.`);
    try { if (new URL(guide.termsUrl).protocol !== 'https:') throw new Error(); } catch { throw new Error(`Technical reference ${reference.sourceId} needs a recorded HTTPS termsUrl before use.`); }
    for (const field of ['canonicalUrl', 'licensedBrief']) if (typeof reference[field] !== 'string' || !reference[field].trim()) throw new Error(`Technical reference ${reference.sourceId} is missing ${field}.`);
    if (reference.termsReviewed !== true) throw new Error(`Technical reference ${reference.sourceId} must have termsReviewed: true before use.`);
    try {
      const actualHost = new URL(reference.canonicalUrl).hostname.replace(/^www\./, '');
      const expectedHost = new URL(guide.url).hostname.replace(/^www\./, '');
      if (actualHost !== expectedHost) throw new Error();
    } catch { throw new Error(`Technical reference ${reference.sourceId} URL must match ${guide.url}.`); }
  }
};
candidates.forEach(requireCandidate);

const knownSourceUrls = new Set(published.stories.flatMap(story => (story.sources?.length ? story.sources : [{ sourceId: story.sourceId, url: story.canonicalUrl }]).map(source => `${source.sourceId}:${source.url}`.toLowerCase())));
const eligible = candidates.filter(item => {
  const source = sources.get(item.sourceId);
  return source?.enabled && source.kind === 'news' && !knownSourceUrls.has(`${item.sourceId}:${item.canonicalUrl}`.toLowerCase());
});
const clusterMap = new Map();
for (const item of eligible) clusterMap.set(item.clusterId, [...(clusterMap.get(item.clusterId) || []), item]);
// A published story may come from one report or a group of reports. Keep every
// source attached to its own claim context; the editor must attribute single-source
// reporting instead of turning it into an independently confirmed fact.
const clusters = [...clusterMap.entries()].map(([clusterId, items]) => ({ clusterId, items }));

if (!clusters.length) {
  console.log('No eligible editorial clusters from approved sources.');
  process.exit(0);
}
if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required to generate review candidates; no source content was sent.');

const instructions = `You are the APEX editorial desk, not a reporter or analyst. Use ONLY the supplied source-approved briefs. A story may use one source or several sources about the same subject. Never imply independent confirmation when there is only one source: attribute reported, disputed, anonymous-source, and rumor claims explicitly to the named outlet and preserve uncertainty. Do not turn a report, allegation, prediction, or opinion into an established fact. Extract only factual claims explicitly present in the supplied briefs; do not add facts, context, opinion, inference, analysis, predictions, comparisons, performance estimates, or direct quotes. Do not say or imply that an outcome is expected, improved, better, faster, or likely. Return JSON with a stories array. Return at most one story for each cluster and omit a cluster when no clear, source-supported factual account can be written. Each story must contain clusterId, category (TECHNICAL or PADDOCK), title, summary, and tags. Write concise original Korean prose, no more than 550 Korean characters. Reorganize facts by topic rather than following a source's paragraph or sentence order. Do not reproduce distinctive phrasing or sentence structure from any brief. For TECHNICAL stories, optional technicalReferences are background evidence only when a source-specific approved brief is supplied. Use them only for claims explicitly contained in those briefs; the directory of source names and roles is not evidence. Return technicalReferenceIds listing only IDs whose supplied briefs actually support claims used in the story; never invent IDs. Keep reported team updates separate from general engineering explanation, and never infer a team's intent or performance effect. TECHNICAL requires a componentKey only when the supplied briefs identify the same component; choose only from the supplied allowedComponentKeys. PADDOCK categories may only be DRIVER, TEAM, or OTHER in tags.`;
const input = clusters.map(({ clusterId, items }) => ({
  clusterId,
  allowedComponentKeys: [...new Set(items.map(item => item.componentKey).filter(Boolean))],
  technicalReferenceGuide: technicalGuide.sources,
  sources: items.map(item => ({
    sourceId: item.sourceId,
    sourceName: sources.get(item.sourceId).displayName || item.sourceId,
    canonicalUrl: item.canonicalUrl,
    publishedAt: item.publishedAt,
    title: item.title,
    licensedBrief: item.licensedBrief,
    technicalReferences: (item.technicalReferences || []).map(reference => ({
      sourceId: reference.sourceId,
      sourceName: technicalSources.get(reference.sourceId).name,
      canonicalUrl: reference.canonicalUrl,
      licensedBrief: reference.licensedBrief
    }))
  }))
}));
const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const responseSchema = {
  type: 'object',
  properties: {
    stories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          clusterId: { type: 'string' },
          category: { type: 'string', enum: ['TECHNICAL', 'PADDOCK'] },
          title: { type: 'string' },
          summary: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          componentKey: { type: ['string', 'null'] },
          technicalReferenceIds: { type: 'array', items: { type: 'string' } }
        },
        required: ['clusterId', 'category', 'title', 'summary', 'tags', 'componentKey', 'technicalReferenceIds']
      }
    }
  },
  required: ['stories']
};
const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
  method: 'POST',
  headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'content-type': 'application/json' },
  signal: AbortSignal.timeout(90000),
  body: JSON.stringify({
    contents: [{ parts: [{ text: `${instructions}\n\nINPUT JSON:\n${JSON.stringify(input)}` }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 3000,
      responseFormat: { text: { mimeType: 'application/json', schema: responseSchema } }
    }
  })
});
if (!response.ok) {
  const detail = (await response.text()).slice(0, 800);
  throw new Error(`Gemini editorial review failed (${response.status}): ${detail}`);
}
const result = await response.json();
const generatedText = result.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
if (!generatedText) throw new Error(`Gemini returned no article JSON (finishReason: ${result.candidates?.[0]?.finishReason || 'unknown'}).`);
const generated = JSON.parse(generatedText).stories || [];
const clusterById = new Map(clusters.map(cluster => [cluster.clusterId, cluster]));
const stories = generated.flatMap(item => {
  const cluster = clusterById.get(item.clusterId);
  if (!cluster || !['TECHNICAL', 'PADDOCK'].includes(item.category) || typeof item.summary !== 'string' || item.summary.length > 550 || typeof item.title !== 'string') return [];
  const componentKey = item.category === 'TECHNICAL' ? item.componentKey : null;
  const notes = componentKey && engineeringLibrary.notes?.[componentKey];
  if (item.category === 'TECHNICAL' && !notes) return [];
  const primary = cluster.items[0];
  const citedSources = [...cluster.items.map(source => ({ sourceId: source.sourceId, name: sources.get(source.sourceId).displayName || source.sourceId, url: source.canonicalUrl }))];
  const availableReferences = cluster.items.flatMap(source => source.technicalReferences || []);
  const requestedReferenceIds = new Set(item.category === 'TECHNICAL' && Array.isArray(item.technicalReferenceIds) ? item.technicalReferenceIds : []);
  for (const reference of availableReferences.filter(reference => requestedReferenceIds.has(reference.sourceId))) {
    if (!citedSources.some(source => source.sourceId === reference.sourceId && source.url === reference.canonicalUrl)) citedSources.push({ sourceId: reference.sourceId, name: technicalSources.get(reference.sourceId).name, url: reference.canonicalUrl });
  }
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
    sources: citedSources,
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
    termsUrl: sources.get(sourceId)?.termsUrl || technicalSources.get(sourceId)?.termsUrl,
    transform: 'AI editor used only source-approved briefs; a single-source claim remains attributed to that source, multiple sources are combined only where claim contexts align; requires pull-request review before merge.'
  }))]
};
validatePublished(next, registry, technicalGuide);
await writeFile(contentPath, `${JSON.stringify(next, null, 2)}\n`);
console.log(`Editorial review candidate written: ${stories.length} stories from ${clusters.length} approved-source clusters.`);
