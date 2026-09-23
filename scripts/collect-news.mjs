import { readFile, writeFile } from 'node:fs/promises';

const registryPath = 'data/source-registry.json';
const candidatesPath = 'data/editorial-candidates.json';
const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const existing = JSON.parse(await readFile(candidatesPath, 'utf8'));
const decode = value => value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const field = (block, name) => {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decode(match[1]) : '';
};
const clusterKey = title => `rss:${title.toLowerCase().replace(/[^a-z0-9가-힣]+/g, ' ').trim().split(/\s+/).slice(0, 10).join('-')}`;
const approvedFeeds = registry.sources.filter(source => source.enabled && source.kind === 'news' && source.connector === 'rss' && typeof source.feedUrl === 'string' && source.feedUrl.startsWith('https://') && source.permittedFields?.includes('licensedBrief'));

if (!approvedFeeds.length) {
  console.log('No approved RSS feeds are enabled; no request was made.');
  process.exit(0);
}
const known = new Set(existing.map(item => `${item.sourceId}:${item.canonicalUrl}`.toLowerCase()));
const collected = [];
for (const source of approvedFeeds) {
  const response = await fetch(source.feedUrl, { headers: { accept: 'application/rss+xml, application/xml, text/xml', 'user-agent': 'APEX-editorial-review/1.0' } });
  if (!response.ok) throw new Error(`RSS request failed for ${source.id}: ${response.status}`);
  const xml = await response.text();
  const items = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];
  for (const item of items.slice(0, source.maxItems || 30)) {
    const title = field(item, 'title');
    const canonicalUrl = field(item, 'link');
    const publishedAt = field(item, 'pubDate') || field(item, 'published') || field(item, 'updated');
    const licensedBrief = field(item, 'description') || field(item, 'summary');
    if (!title || !canonicalUrl || !publishedAt || !licensedBrief || known.has(`${source.id}:${canonicalUrl}`.toLowerCase())) continue;
    const parsedDate = new Date(publishedAt);
    if (Number.isNaN(parsedDate.valueOf())) continue;
    collected.push({ clusterId: clusterKey(title), sourceId: source.id, canonicalUrl, publishedAt: parsedDate.toISOString(), title, licensedBrief, componentKey: null });
    known.add(`${source.id}:${canonicalUrl}`.toLowerCase());
  }
}
if (!collected.length) {
  console.log('No new licensed RSS candidates found.');
  process.exit(0);
}
await writeFile(candidatesPath, `${JSON.stringify([...existing, ...collected], null, 2)}\n`);
console.log(`Collected ${collected.length} licensed RSS candidates for review.`);
