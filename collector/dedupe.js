import { createHash } from 'crypto';

function normalizeUrl(url) {
  return (url || '').replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase().trim();
}

function normalizeTitle(title) {
  return (title || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function similarity(a, b) {
  // Simple word overlap similarity
  const wordsA = new Set(a.split(' ').filter(w => w.length > 3));
  const wordsB = new Set(b.split(' ').filter(w => w.length > 3));
  if (!wordsA.size || !wordsB.size) return 0;
  let overlap = 0;
  for (const w of wordsA) if (wordsB.has(w)) overlap++;
  return overlap / Math.max(wordsA.size, wordsB.size);
}

export function dedupeAgainstExisting(newItems, existingOpportunities) {
  const existingUrls   = new Set(existingOpportunities.map(o => normalizeUrl(o.url)));
  const existingTitles = existingOpportunities.map(o => normalizeTitle(o.title));

  const deduped = [];
  const seenUrls   = new Set(existingUrls);
  const seenTitles = [];

  for (const item of newItems) {
    const normUrl   = normalizeUrl(item.url);
    const normTitle = normalizeTitle(item.title);

    // Skip if URL already exists
    if (seenUrls.has(normUrl)) continue;

    // Skip if title is very similar to an existing one (>75% word overlap)
    const isDuplicate = seenTitles.some(t => similarity(normTitle, t) > 0.75)
                     || existingTitles.some(t => similarity(normTitle, t) > 0.75);
    if (isDuplicate) continue;

    seenUrls.add(normUrl);
    seenTitles.push(normTitle);
    deduped.push(item);
  }

  return deduped;
}

export function dedupeWithinBatch(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = normalizeUrl(item.url) || item.id;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}
