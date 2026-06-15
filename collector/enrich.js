// collector/enrich.js
// For kept items still missing a deadline, fetch the linked page and try
// extracting deadline/fee/prize from its FULL content — not just the
// short RSS/search snippet.
//
// Why this helps: many platforms (including Instagram, Facebook, X) populate
// og:description/og:title meta tags with the post caption for link previews,
// even without authentication. A regular news article's full body almost
// always has more deadline detail than its RSS summary. This pass catches
// both cases with one fetch per item.
//
// Capped to keep GitHub Actions runtime reasonable.

import { extractDeadline, extractFee, extractPrize } from './extract.js';

const MAX_ENRICH  = 30;     // max pages fetched per run
const CONCURRENCY = 5;      // parallel fetches
const TIMEOUT_MS  = 10000;

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMeta(html, property) {
  // Matches both <meta property="og:description" content="..."> and
  // <meta content="..." property="og:description"> attribute orderings
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return '';
}

async function fetchPageText(url) {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OpportunityRadar/1.0; +https://github.com)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) return '';
    const html = await r.text();

    const ogDesc  = extractMeta(html, 'og:description');
    const ogTitle = extractMeta(html, 'og:title');
    const desc    = extractMeta(html, 'description');
    const body    = stripHtml(html).slice(0, 4000);

    return [ogTitle, ogDesc, desc, body].filter(Boolean).join(' ');
  } catch {
    return '';
  }
}

// Mutates items in place — fills deadline/fee/prize where found
export async function enrichMissingDeadlines(items) {
  const candidates = items
    .filter(i => !i.deadline && i.url && /^https?:\/\//.test(i.url))
    .slice(0, MAX_ENRICH);

  if (!candidates.length) return { enriched: 0, checked: 0 };

  console.log(`\n🔎 Enrichment — fetching ${candidates.length} pages for missing deadlines`);
  let enriched = 0;

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const chunk = candidates.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async item => {
      const pageText = await fetchPageText(item.url);
      if (!pageText) return;

      const fullText = `${item.title} ${item.text || ''} ${pageText}`;

      const dl = extractDeadline(fullText);
      if (dl) { item.deadline = dl; enriched++; }

      if (!item.fee || item.fee === 'Unknown') {
        const fee = extractFee(fullText);
        if (fee !== 'Unknown') item.fee = fee;
      }
      if (!item.prize) {
        const prize = extractPrize(fullText);
        if (prize) item.prize = prize;
      }
    }));
  }

  console.log(`  ✓ Found deadlines for ${enriched}/${candidates.length} items`);
  return { enriched, checked: candidates.length };
}
