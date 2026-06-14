// collector/cleanup.js
// Re-applies the latest filters to items ALREADY in the database.
// This makes the database self-correcting: when extract.js or gemini.js
// filters improve, old items that should have been excluded get removed
// or fixed on the next run — without needing a full re-scrape.

import {
  extractDeadline, extractFee, extractPrize,
  isExpired, isHomepageUrl, looksLikeNews,
} from './extract.js';

const EXPIRY_GRACE_DAYS = 1;

export function cleanupExisting(existing) {
  let removedNews = 0, removedHomepage = 0, removedExpired = 0, filledFields = 0;

  const cleaned = existing.filter(item => {
    const text = `${item.title} ${item.description || ''}`;

    if (looksLikeNews(text)) { removedNews++; return false; }
    if (isHomepageUrl(item.url)) { removedHomepage++; return false; }

    // Try to fill in missing deadline/fee/prize from title + description
    let changed = false;
    if (!item.deadline) {
      const dl = extractDeadline(text);
      if (dl) { item.deadline = dl; changed = true; }
    }
    if (!item.fee || item.fee === 'Unknown') {
      const fee = extractFee(text);
      if (fee !== 'Unknown') { item.fee = fee; changed = true; }
    }
    if (!item.prize) {
      const prize = extractPrize(text);
      if (prize) { item.prize = prize; changed = true; }
    }
    if (changed) filledFields++;

    // Now check expiry with whatever deadline we have (original or just-filled)
    if (isExpired(item.deadline, EXPIRY_GRACE_DAYS)) { removedExpired++; return false; }

    return true;
  });

  const totalRemoved = removedNews + removedHomepage + removedExpired;
  if (totalRemoved > 0 || filledFields > 0) {
    console.log('\n🧹 Cleanup of existing database');
    if (removedNews)     console.log(`  ${removedNews} removed — news/winner/results articles`);
    if (removedHomepage) console.log(`  ${removedHomepage} removed — homepage/listing links`);
    if (removedExpired)  console.log(`  ${removedExpired} removed — deadline already passed`);
    if (filledFields)    console.log(`  ${filledFields} items had deadline/fee/prize filled in`);
    console.log(`  ${existing.length} → ${cleaned.length} items`);
  }

  return cleaned;
}
