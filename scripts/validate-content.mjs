import { readFile } from 'node:fs/promises';

const fail = message => { throw new Error(`Validation failed: ${message}`); };
const isUrl = value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };
const sourceById = registry => new Map(registry.sources.map(source => [source.id, source]));
const speculativeLanguage = /(?:예상|추정|전망|우수|향상될|개선될|증가할|감소할|likely|expected|prediction|better|faster)/i;
const requireString = (value, message) => { if (typeof value !== 'string' || !value.trim()) fail(message); };
const assertEditorialText = (value, label) => {
  requireString(value, `${label} must be a non-empty string.`);
  if (speculativeLanguage.test(value)) fail(`${label} contains speculative or comparative language.`);
};

export function validatePublished(content, registry, technicalGuide = { sources: [] }) {
  if (!Array.isArray(content.stories) || !Array.isArray(content.calendar) || !Array.isArray(content.provenance) || (content.raceDetails !== undefined && (content.raceDetails === null || Array.isArray(content.raceDetails) || typeof content.raceDetails !== 'object'))) fail('published-content requires stories, calendar, provenance arrays, and an optional raceDetails object.');
  const sources = sourceById(registry);
  const seenStories = new Set();
  for (const story of content.stories) {
    for (const field of ['id', 'title', 'summary', 'category', 'sourceId', 'canonicalUrl', 'publishedAt']) if (!story[field]) fail(`story is missing ${field}.`);
    if (!['TECHNICAL', 'PADDOCK'].includes(story.category)) fail(`story ${story.id} has an invalid category.`);
    if (!isUrl(story.canonicalUrl)) fail(`story ${story.id} has no valid canonical URL.`);
    assertEditorialText(story.title, `story ${story.id} title`);
    assertEditorialText(story.summary, `story ${story.id} summary`);
    if (story.summary.length > 550) fail(`story ${story.id} exceeds the 550-character concise-summary limit.`);
    if (!sources.get(story.sourceId)?.enabled) fail(`story ${story.id} uses a source that is not approved and enabled.`);
    if (!Array.isArray(story.sources) || story.sources.length < 1) fail(`story ${story.id} must identify at least one source.`);
    const seenSources = new Set();
    for (const source of story.sources) {
      requireString(source?.sourceId, `story ${story.id} source is missing sourceId.`);
      requireString(source?.name, `story ${story.id} source ${source?.sourceId || 'unknown'} is missing name.`);
      if (!isUrl(source?.url)) fail(`story ${story.id} source ${source.sourceId} has an invalid URL.`);
      const technicalReference = technicalGuide.sources?.find(item => item.id === source.sourceId && item.approvedForUse === true);
      if (!sources.get(source.sourceId)?.enabled && !(story.category === 'TECHNICAL' && technicalReference)) fail(`story ${story.id} source ${source.sourceId} is not approved and enabled.`);
      if (technicalReference) {
        try {
          const actualHost = new URL(source.url).hostname.replace(/^www\./, '');
          const expectedHost = new URL(technicalReference.url).hostname.replace(/^www\./, '');
          if (actualHost !== expectedHost) fail(`story ${story.id} technical reference ${source.sourceId} URL does not match its registered publisher.`);
        } catch { fail(`story ${story.id} technical reference ${source.sourceId} has an invalid publisher URL.`); }
      }
      const sourceFingerprint = `${source.sourceId}:${source.url}`.toLowerCase();
      if (seenSources.has(sourceFingerprint)) fail(`story ${story.id} repeats source URL ${source.url}.`);
      seenSources.add(sourceFingerprint);
    }
    if (story.sourceId !== story.sources[0]?.sourceId || story.canonicalUrl !== story.sources[0]?.url) fail(`story ${story.id} primary source fields must match the first source entry.`);
    if (story.category === 'TECHNICAL') {
      if (!story.engineeringNotes || typeof story.engineeringNotes !== 'object') fail(`technical story ${story.id} is missing engineeringNotes.`);
      requireString(story.engineeringNotes.part, `technical story ${story.id} engineeringNotes.part`);
      if (!Array.isArray(story.engineeringNotes.bullets) || story.engineeringNotes.bullets.length < 2 || story.engineeringNotes.bullets.length > 4) fail(`technical story ${story.id} needs 2–4 engineering notes.`);
      story.engineeringNotes.bullets.forEach((bullet, index) => {
        assertEditorialText(bullet, `technical story ${story.id} engineering note ${index + 1}`);
        if (bullet.length > 220) fail(`technical story ${story.id} engineering note ${index + 1} is too long.`);
      });
    }
    const fingerprint = `${story.sourceId}:${story.canonicalUrl}`.toLowerCase();
    if (seenStories.has(fingerprint)) fail(`duplicate canonical story: ${story.canonicalUrl}`);
    seenStories.add(fingerprint);
  }
  const rounds = new Set();
  for (const race of content.calendar) {
    for (const field of ['round', 'slug', 'name', 'date', 'sourceId']) if (race[field] === undefined || race[field] === '') fail(`calendar item is missing ${field}.`);
    if (!Number.isInteger(Number(race.round)) || Number(race.round) < 1) fail(`race ${race.slug} has an invalid round.`);
    if (rounds.has(Number(race.round))) fail(`duplicate calendar round ${race.round}.`);
    if (!sources.get(race.sourceId)?.enabled) fail(`race ${race.slug} uses a source that is not approved and enabled.`);
    rounds.add(Number(race.round));
  }
  for (const [slug, detail] of Object.entries(content.raceDetails || {})) {
    requireString(slug, 'race detail slug');
    requireString(detail?.sourceId, `race detail ${slug} sourceId`);
    if (!sources.get(detail.sourceId)?.enabled) fail(`race detail ${slug} uses a source that is not approved and enabled.`);
    if (!Array.isArray(detail.results)) fail(`race detail ${slug} results must be an array.`);
    detail.results.forEach((result, index) => requireString(result, `race detail ${slug} result ${index + 1}`));
    if (!detail.overview || typeof detail.overview !== 'object') fail(`race detail ${slug} overview is missing.`);
    for (const field of ['fastestLap', 'fastestPitStop', 'raceDistance']) {
      const value = detail.overview[field];
      if (value !== null && value !== undefined) {
        requireString(value.value, `race detail ${slug} ${field}.value`);
        requireString(value.label, `race detail ${slug} ${field}.label`);
      }
    }
    if (detail.dataAvailability && typeof detail.dataAvailability !== 'object') fail(`race detail ${slug} dataAvailability must be an object.`);
  }
  for (const item of content.provenance) {
    for (const field of ['sourceId', 'retrievedAt', 'termsUrl', 'transform']) if (!item[field]) fail('each provenance record needs sourceId, retrievedAt, termsUrl and transform.');
    if (!isUrl(item.termsUrl)) fail(`provenance ${item.sourceId} has an invalid terms URL.`);
  }
}

const [contentPath = 'data/published-content.json', registryPath = 'data/source-registry.json'] = process.argv.slice(2);
const [content, registry, technicalGuide] = await Promise.all([
  readFile(contentPath, 'utf8').then(JSON.parse),
  readFile(registryPath, 'utf8').then(JSON.parse),
  readFile('data/technical-source-guide.json', 'utf8').then(JSON.parse)
]);
validatePublished(content, registry, technicalGuide);
console.log(`Valid: ${content.stories.length} stories, ${content.calendar.length} races.`);
