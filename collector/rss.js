import RSSParser from 'rss-parser';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(readFileSync(join(__dir, '../config/sources.json'), 'utf8'));

const parser = new RSSParser({
  timeout: 15000,
  headers: { 'User-Agent': 'OpportunityRadar/1.0 RSS Reader' },
  customFields: { item: ['description', 'content:encoded', 'summary'] }
});

function makeId(str) {
  return createHash('md5').update(str).digest('hex').slice(0, 16);
}

function stripHtml(str) {
  return (str || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function extractSnippet(item) {
  const raw = item['content:encoded'] || item.content || item.description || item.summary || '';
  return stripHtml(raw).slice(0, 800);
}

function quickFilter(title, snippet, sources) {
  const text = (title + ' ' + snippet).toLowerCase();

  // Reject obvious non-opportunities
  for (const kw of sources.reject_keywords) {
    if (text.includes(kw.toLowerCase())) return false;
  }

  // Must have at least one opportunity keyword
  const hasOpportunity = sources.opportunity_keywords.some(kw => text.includes(kw.toLowerCase()));
  if (!hasOpportunity) return false;

  // Must have at least one architecture keyword
  const hasArchitecture = sources.architecture_keywords.some(kw => text.includes(kw.toLowerCase()));
  if (!hasArchitecture) return false;

  return true;
}

export async function fetchAllFeeds() {
  const enabled = sources.rss_feeds.filter(f => f.enabled);
  const items = [];
  const today = new Date().toISOString().slice(0, 10);

  console.log(`[RSS] Fetching ${enabled.length} feeds…`);

  for (const feed of enabled) {
    try {
      const result = await parser.parseURL(feed.url);
      let added = 0;

      for (const item of (result.items || []).slice(0, 50)) {
        const title = stripHtml(item.title || '').slice(0, 200);
        const url   = (item.link || item.guid || '').trim();
        if (!title || !url) continue;

        const snippet = extractSnippet(item);

        if (!quickFilter(title, snippet, sources)) continue;

        items.push({
          id:         makeId(url || title),
          title,
          url,
          snippet,
          source:     feed.name,
          found_date: today,
          pub_date:   item.pubDate || item.isoDate || '',
          // will be filled by Gemini
          organization: '',
          category:     '',
          description:  '',
          deadline:     '',
          fee:          'Unknown',
          prize:        '',
          is_new:       true
        });
        added++;
      }

      console.log(`[RSS] ${feed.name}: ${added} relevant items`);
    } catch (err) {
      console.warn(`[RSS] FAILED ${feed.name}: ${err.message}`);
    }

    // Small delay between feeds to be polite
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[RSS] Total from feeds: ${items.length} items`);
  return items;
}
