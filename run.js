// run.js — main entry point
// Called by GitHub Actions every morning at 8am UTC
// Run manually: node run.js

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { collectRss } from './collector/rss.js';
import { collectScrape } from './collector/scrape.js';
import { collectSearch } from './collector/search.js';
import { classifyWithGemini } from './collector/gemini.js';
import { dedupeSelf, dedupeAgainstExisting, makeId } from './collector/dedupe.js';
import { cleanupExisting } from './collector/cleanup.js';
import { enrichMissingDeadlines } from './collector/enrich.js';
import { isExpired } from './collector/extract.js';
import { loadDismissedIds } from './collector/dismissed.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dir, 'data/opportunities.json');
const GEMINI_KEY = process.env.GEMINI_KEY || '';
const SERPER_KEY = process.env.SERPER_KEY || '';

function loadDatabase() {
  if (!existsSync(DATA_PATH)) return { meta: {}, opportunities: [] };
  try {
    const raw = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
    // Handle both array format and {meta, opportunities} format
    if (Array.isArray(raw)) return { meta: {}, opportunities: raw };
    return raw;
  } catch {
    return { meta: {}, opportunities: [] };
  }
}

const MAX_ITEMS = 600; // hard cap — keeps file small enough for GitHub Pages deployment

function saveDatabase(opportunities) {
  // Trim to cap — newest items (at the front) are kept, oldest dropped
  const trimmed = opportunities.slice(0, MAX_ITEMS);
  if (trimmed.length < opportunities.length) {
    console.log(`  ✂️  Trimmed database from ${opportunities.length} to ${trimmed.length} items (cap: ${MAX_ITEMS})`);
  }
  const db = {
    meta: {
      last_updated: new Date().toISOString(),
      total: trimmed.length,
      new_today: trimmed.filter(o => o.is_new).length,
    },
    opportunities: trimmed,
  };
  // Compact JSON (no indentation) keeps file size small for GitHub Pages
  writeFileSync(DATA_PATH, JSON.stringify(db), 'utf8');
  return db.meta;
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  Opportunity Radar — Daily Collection');
  console.log(`  ${new Date().toUTCString()}`);
  console.log('═══════════════════════════════════════');

  // Load existing database
  const { opportunities: existingRaw } = loadDatabase();
  console.log(`\nDatabase: ${existingRaw.length} existing opportunities`);

  // Permanently-dismissed items (via dashboard "Delete" with GitHub token)
  const dismissedIds = loadDismissedIds();
  if (dismissedIds.size > 0) console.log(`Dismissed list: ${dismissedIds.size} item(s) will be excluded`);

  // Mark all existing as not-new before this run
  existingRaw.forEach(o => { o.is_new = false; });

  // Re-apply latest filters to existing items (self-correcting database)
  // and drop anything the user has permanently dismissed
  const existing = cleanupExisting(existingRaw).filter(o => !dismissedIds.has(o.id));

  // ── COLLECT ──────────────────────────────────────────────
  const rssItems    = await collectRss();
  const scrapeItems = await collectScrape();
  const searchItems = await collectSearch(SERPER_KEY);

  // ── DEDUPLICATE RAW ──────────────────────────────────────
  console.log('\n🔄 Deduplication');
  const allRaw = [...rssItems, ...scrapeItems, ...searchItems];
  console.log(`  ${allRaw.length} total raw items collected`);
  const selfDeduped = dedupeSelf(allRaw);
  console.log(`  ${selfDeduped.length} after removing cross-source duplicates`);
  const genuinelyNew = dedupeAgainstExisting(selfDeduped, existing).filter(i => !dismissedIds.has(i.id));
  console.log(`  ${genuinelyNew.length} genuinely new (not in existing database, not dismissed)`);

  if (!genuinelyNew.length) {
    console.log('\n✓ Nothing new today — database unchanged');
    // Still save to update last_updated timestamp
    const meta = saveDatabase(existing);
    console.log(`\nSaved: ${meta.total} total opportunities`);
    return;
  }

  // ── CLASSIFY WITH GEMINI ─────────────────────────────────
  const classified = await classifyWithGemini(genuinelyNew, GEMINI_KEY);

  // ── ENRICH ───────────────────────────────────────────────
  // Items still missing a deadline: fetch the page itself and re-extract
  // from full content (catches truncated snippets, Instagram/social
  // captions in og:description, etc.)
  await enrichMissingDeadlines(classified);

  // Re-check expiry — a deadline found during enrichment might already be past
  const afterEnrich = classified.filter(i => !isExpired(i.deadline, 1));
  const expiredAfterEnrich = classified.length - afterEnrich.length;
  if (expiredAfterEnrich > 0) {
    console.log(`  🗑  ${expiredAfterEnrich} more removed after enrichment — deadline already passed`);
  }

  // ── FINALISE RECORDS ─────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];
  const newOpportunities = afterEnrich.map(item => ({
    id:          item.id || makeId(item),
    title:       item.title,
    url:         item.url,
    source:      item.source,
    source_type: item.source_type,
    found_date:  today,
    pub_date:    item.date || today,
    description: item.description || '',
    category:    item.category || 'Other',
    deadline:    item.deadline || '',
    fee:         item.fee || 'Unknown',
    prize:       item.prize || '',
    is_new:      true,
    ai_verified: item.ai_verified !== false,
  }));

  // Merge: new items at the top, existing after
  const merged = [...newOpportunities, ...existing];

  // ── SAVE ─────────────────────────────────────────────────
  const meta = saveDatabase(merged);

  // ── SUMMARY ──────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('  Run complete');
  console.log(`  New opportunities added: ${meta.new_today}`);
  console.log(`  Total in database:       ${meta.total}`);
  console.log(`  Last updated:            ${meta.last_updated}`);
  console.log('═══════════════════════════════════════\n');
}

main().catch(e => {
  console.error('\n❌ Fatal error:', e);
  process.exit(1);
});
