// collector/scrape.js
// Scrapes website pages that list competitions / open calls
// Uses cheerio to parse HTML and extract links with context

import * as cheerio from 'cheerio';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(readFileSync(join(__dir, '../config/sources.json'), 'utf8'));

// Words that indicate a link is a pagination/nav element, not a competition
const NAV_WORDS = /\b(next|prev|previous|page \d|load more|show more|home|about|contact|login|sign|menu|search|category|tag|archive|sitemap)\b/i;

// Minimum title length to be considered a real opportunity listing
const MIN_TITLE = 12;

async function scrapePage(site) {
  try {
    const r = await fetch(site.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OpportunityRadar/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return [];
    const html = await r.text();
    const $ = cheerio.load(html);
    const today = new Date().toISOString().split('T')[0];
    const baseUrl = new URL(site.url);
    const seen = new Set();
    const results = [];

    // Remove nav, footer, header, sidebar noise
    $('nav, footer, header, aside, .sidebar, .menu, .nav, script, style').remove();

    // Find all links
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const title = $(el).text().trim();

      if (!title || title.length < MIN_TITLE) return;
      if (NAV_WORDS.test(title)) return;

      // Resolve URL
      let url;
      try {
        url = href.startsWith('http') ? href : new URL(href, baseUrl.origin).toString();
      } catch { return; }

      // Skip if same domain as the source listing page (it's likely a detail link, good)
      // But skip anchors and non-http
      if (!url.startsWith('http')) return;
      if (seen.has(url)) return;
      seen.add(url);

      // Get surrounding context text (from parent article/li/div)
      const parent = $(el).closest('article, .item, .post, .entry, li, tr, .card, .result').first();
      const context = parent.text().replace(/\s+/g, ' ').trim().slice(0, 400) || title;

      results.push({
        title: title.slice(0, 200),
        url,
        text: context,
        date: today,
        source: site.name,
        source_type: 'site_scrape',
      });
    });

    return results;
  } catch (e) {
    console.log(`  ✗ ${site.name} — ${e.message}`);
    return [];
  }
}

export async function collectScrape() {
  const sites = sources.scrape_sites.filter(s => s.active);
  console.log(`\n🌐 Scrape — checking ${sites.length} sites`);
  const results = [];

  for (const site of sites) {
    const items = await scrapePage(site);
    console.log(`  ${items.length > 0 ? '✓' : '○'} ${site.name} — ${items.length} links extracted`);
    results.push(...items);
    // Small delay between scrapes to be polite
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`  Total from scrape: ${results.length} raw items`);
  return results;
}
