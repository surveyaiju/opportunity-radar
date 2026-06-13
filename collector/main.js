import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { fetchAllFeeds }       from './rss.js';
import { runSearchDiscovery }  from './search.js';
import { classifyItems }       from './gemini.js';
import { dedupeAgainstExisting, dedupeWithinBatch } from './dedupe.js';

const __dir    = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dir, '../data');
const DATA_PATH = join(DATA_DIR, 'opportunities.json');

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('ERROR: GEMINI_API_KEY environment variable is not set.');
  process.exit(1);
}

// ── Load / Save ──────────────────────────────────────────────────────
function loadData() {
  if (!existsSync(DATA_PATH)) {
    return { last_updated: '', total: 0, opportunities: [] };
  }
  return JSON.parse(readFileSync(DATA_PATH, 'utf8'));
}

function saveData(data) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// ── Prune expired items ──────────────────────────────────────────────
function pruneExpired(opps) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30); // keep items for 30 days after deadline

  return opps.filter(opp => {
    if (!opp.deadline) return true; // keep if no deadline known
    const dl = new Date(opp.deadline);
    if (isNaN(dl.getTime())) return true; // keep if unparseable
    return dl >= cutoff;
  });
}

// ── Merge Gemini results back into items ────────────────────────────
function mergeClassification(items, classified) {
  const byId = new Map(classified.map(c => [c.id, c]));
  const kept = [];

  for (const item of items) {
    const c = byId.get(item.id);
    if (!c) { kept.push(item); continue; } // no classification result, keep as-is
    if (c.keep === false) continue;         // Gemini said not an opportunity — remove

    kept.push({
      ...item,
      organization: c.organization || item.organization || '',
      category:     c.category     || item.category     || 'Other',
      description:  c.description  || item.description  || '',
      deadline:     c.deadline     || item.deadline      || '',
      fee:          c.fee          || item.fee           || 'Unknown',
      prize:        c.prize        || item.prize         || ''
    });
  }

  return kept;
}

// ── Main pipeline ────────────────────────────────────────────────────
async function run() {
  console.log('\n=== Opportunity Radar — Daily Run ===');
  console.log('Time:', new Date().toISOString());

  // 1. Load existing database
  const db = loadData();
  const existing = db.opportunities || [];
  console.log(`\n[LOAD] Existing opportunities: ${existing.length}`);

  // Mark all existing as not-new
  existing.forEach(o => o.is_new = false);

  // 2. Collect from RSS feeds
  console.log('\n--- RSS Collection ---');
  const rssItems = await fetchAllFeeds();

  // 3. Search discovery
  console.log('\n--- Search Discovery ---');
  const searchItems = await runSearchDiscovery(API_KEY);

  // 4. Combine + internal dedupe
  const combined = dedupeWithinBatch([...rssItems, ...searchItems]);
  console.log(`\n[DEDUPE] Combined unique items: ${combined.length}`);

  // 5. Dedupe against existing database
  const newItems = dedupeAgainstExisting(combined, existing);
  console.log(`[DEDUPE] After dedup vs existing: ${newItems.length} genuinely new`);

  if (newItems.length === 0) {
    console.log('\nNo new items found today. Database unchanged.');
  } else {
    // 6. Classify with Gemini
    console.log('\n--- Gemini Classification ---');
    const classified = await classifyItems(newItems, API_KEY);

    // 7. Merge classification results (also removes non-opportunities)
    const merged = mergeClassification(newItems, classified);
    console.log(`[CLASSIFY] Kept: ${merged.length}, Removed: ${newItems.length - merged.length}`);

    // 8. Add to database (newest first)
    db.opportunities = [...merged, ...existing];
  }

  // 9. Prune expired items
  const beforePrune = db.opportunities.length;
  db.opportunities = pruneExpired(db.opportunities);
  const pruned = beforePrune - db.opportunities.length;
  if (pruned > 0) console.log(`\n[PRUNE] Removed ${pruned} expired opportunities`);

  // 10. Cap at 5000 records (historical archive)
  if (db.opportunities.length > 5000) {
    db.opportunities = db.opportunities.slice(0, 5000);
  }

  // 11. Save
  db.last_updated = new Date().toISOString();
  db.total = db.opportunities.length;
  saveData(db);

  console.log('\n=== Done ===');
  console.log(`Total in database: ${db.total}`);
  console.log(`New today: ${db.opportunities.filter(o => o.is_new).length}`);
  console.log(`Database saved to: ${DATA_PATH}`);
}

run().catch(err => {
  console.error('\nFATAL ERROR:', err);
  process.exit(1);
});
