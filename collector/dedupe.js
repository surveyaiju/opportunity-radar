// collector/dedupe.js
// Deduplication in two stages:
// 1. Cross-source dedup of raw items (before Gemini)
// 2. Against existing database (after Gemini)

function makeId(item) {
  // Hash URL as primary key — same URL = same opportunity
  const url = (item.url || '').toLowerCase().replace(/\/$/, '').replace(/\?.*$/, '');
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h) ^ url.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function normaliseTitle(t) {
  return (t || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
}

// Deduplicate a batch of raw items against each other
export function dedupeSelf(items) {
  const seenUrls = new Set();
  const seenTitles = new Set();
  const out = [];
  for (const item of items) {
    const url = (item.url || '').replace(/\/$/, '');
    const title = normaliseTitle(item.title);
    if (!url || seenUrls.has(url)) continue;
    if (title && seenTitles.has(title)) continue;
    seenUrls.add(url);
    if (title) seenTitles.add(title);
    out.push({ ...item, id: makeId(item) });
  }
  return out;
}

// Remove items that already exist in the database
export function dedupeAgainstExisting(newItems, existing) {
  const existingIds = new Set(existing.map(e => e.id));
  const existingUrls = new Set(
    existing.map(e => (e.url || '').toLowerCase().replace(/\/$/, '').replace(/\?.*$/, ''))
  );
  const existingTitles = new Set(existing.map(e => normaliseTitle(e.title)));

  return newItems.filter(item => {
    if (existingIds.has(item.id)) return false;
    const url = (item.url || '').toLowerCase().replace(/\/$/, '').replace(/\?.*$/, '');
    if (existingUrls.has(url)) return false;
    const title = normaliseTitle(item.title);
    if (title && existingTitles.has(title)) return false;
    return true;
  });
}

export { makeId };
