// collector/search.js
// Runs web searches via Serper.dev (free tier: 2,500 searches/month)
// This is the "google it like a person would" layer

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(readFileSync(join(__dir, '../config/sources.json'), 'utf8'));

async function serperSearch(query, apiKey) {
  try {
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: 10, gl: 'us', hl: 'en' }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      console.log(`    ✗ Search API error ${r.status} for: "${query.slice(0, 40)}"`);
      return [];
    }
    const data = await r.json();
    const today = new Date().toISOString().split('T')[0];
    return (data.organic || []).map(item => ({
      title: (item.title || '').slice(0, 200),
      url: item.link || '',
      text: (item.snippet || '').slice(0, 400),
      date: today,
      source: `Web Search`,
      source_type: 'web_search',
    })).filter(i => i.title && i.url);
  } catch (e) {
    console.log(`    ✗ Search failed: ${e.message}`);
    return [];
  }
}

export async function collectSearch(serperKey) {
  if (!serperKey) {
    console.log('\n🔍 Search — skipped (no SERPER_KEY set)');
    return [];
  }

  // Flatten all queries from all categories
  const queryCategories = sources.search_queries;
  const allQueries = [];
  for (const [cat, queries] of Object.entries(queryCategories)) {
    if (cat.startsWith('_')) continue;
    if (Array.isArray(queries)) allQueries.push(...queries);
  }

  console.log(`\n🔍 Search — running ${allQueries.length} queries via Serper.dev`);
  const results = [];

  for (const query of allQueries) {
    const items = await serperSearch(query, serperKey);
    if (items.length) {
      console.log(`  ✓ "${query.slice(0, 55)}…" — ${items.length} results`);
      results.push(...items);
    } else {
      console.log(`  ○ "${query.slice(0, 55)}…" — no results`);
    }
    // Rate limit: ~4 searches/second max on free tier
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`  Total from search: ${results.length} raw items`);
  return results;
}
