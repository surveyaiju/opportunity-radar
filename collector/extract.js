// collector/extract.js
// Regex-based extraction — runs on EVERY item, independent of AI.
// This is what fills in deadline/fee/prize when an item is regex-classified
// (most items) and acts as a fallback when AI doesn't extract a field.

const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)';

// Date patterns, ordered by specificity
const DATE_PATTERNS = [
  new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+20\\d{2}\\b`, 'i'),   // "June 30, 2026" / "Jun 30 2026"
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\.?,?\\s+20\\d{2}\\b`, 'i'),   // "30 June 2026" / "30th Jun, 2026"
  /\b20\d{2}-\d{2}-\d{2}\b/,                                                          // "2026-06-30"
  new RegExp(`\\b\\d{1,2}\\/\\d{1,2}\\/20\\d{2}\\b`, 'i'),                            // "06/30/2026"
];

// Phrases that typically precede a deadline date
const DEADLINE_CONTEXT = /\b(deadline|due date|due by|due on|closes?|closing date|submission date|submit(?:ted)? by|apply by|application deadline|entries close|entry deadline|registration closes?|registration deadline|applications? (?:close|due)|proposals? due)\b[\s:–—-]{0,15}/i;

// ── Deadline ────────────────────────────────────────────────────────────
export function extractDeadline(text) {
  if (!text) return '';

  // Priority 1: a date that appears shortly after a "deadline"-type phrase
  const ctx = DEADLINE_CONTEXT.exec(text);
  if (ctx) {
    const windowText = text.slice(ctx.index, ctx.index + ctx[0].length + 40);
    for (const pat of DATE_PATTERNS) {
      const m = pat.exec(windowText);
      if (m) return cleanDateStr(m[0]);
    }
  }

  // Priority 2: any 2025+ date found anywhere (lower confidence, but better than nothing)
  for (const pat of DATE_PATTERNS) {
    const m = pat.exec(text);
    if (m && /20(2[5-9]|[3-9]\d)/.test(m[0])) return cleanDateStr(m[0]);
  }

  return '';
}

function cleanDateStr(s) {
  return s.replace(/(\d{1,2})(st|nd|rd|th)/i, '$1').replace(/\s+/g, ' ').trim();
}

// Parses a deadline string into a Date object, or null if unparseable/rolling
export function parseDeadlineDate(dl) {
  if (!dl) return null;
  if (/rolling|ongoing|continuous|year[\s-]?round|open[\s-]?ended/i.test(dl)) return null;

  let d = new Date(dl);
  if (!isNaN(d)) return d;

  // "30 June 2026" → "June 30, 2026"
  const m = dl.match(/(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})/);
  if (m) {
    d = new Date(`${m[2]} ${m[1]}, ${m[3]}`);
    if (!isNaN(d)) return d;
  }
  return null;
}

// True if the deadline date is in the past (with optional grace period in days)
export function isExpired(dl, graceDays = 1) {
  const d = parseDeadlineDate(dl);
  if (!d) return false; // unknown or rolling → never expired
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - graceDays);
  cutoff.setHours(0, 0, 0, 0);
  return d < cutoff;
}

// ── Fee ─────────────────────────────────────────────────────────────────
export function extractFee(text) {
  if (!text) return 'Unknown';
  if (/\b(no (?:entry|registration|submission|application)\s*fee|free (?:to enter|entry|registration|to apply|to submit|to participate|of charge|submission)|without (?:a )?fee|at no cost|no cost to (?:enter|apply|submit|participate)|gratuit)\b/i.test(text)) {
    return 'Free';
  }
  const m = text.match(/(?:entry|registration|submission|application)\s*fee\s*(?:of|is|:)?\s*([€$£]\s?\d[\d,.]*|\d[\d,.]*\s?(?:EUR|USD|GBP))/i);
  if (m) return m[1].replace(/\s+/g, '');
  return 'Unknown';
}

// ── Prize ───────────────────────────────────────────────────────────────
export function extractPrize(text) {
  if (!text) return '';
  const m = text.match(/(?:prize(?:\s+(?:money|pool|fund))?|cash prize|award(?:ed)?(?:\s+(?:of|amount))?|grant(?:ed)?(?:\s+(?:of|amount))?|funding(?:\s+(?:of|amount))?|stipend|honorarium)\s*(?:of|is|:)?\s*([€$£]\s?\d[\d,.]*\s?(?:k|K|thousand|million)?|\d[\d,.]*\s?(?:EUR|USD|GBP)\s?(?:k|K)?)/i);
  if (m) return m[1].replace(/\s+/g, '').replace(/[.,]+$/, '');
  return '';
}

// ── Homepage / category / listing page detection ──────────────────────────
// Catches links to a site's main listing page rather than one specific opportunity.
// Logic:
//   - A numeric ID segment (3+ digits) ⇒ specific article (e.g. /123456/title) → keep
//   - A long, multi-hyphen slug ⇒ specific article title → keep
//   - Otherwise, if every path segment is a generic listing word ⇒ homepage/listing → drop
const GENERIC_SEGMENTS = /^(en|category|categories|tag|tags|topics?|page\d*|competitions?|news|announcements|opportunities|search|all|latest|cat|agenda|index|home|archive|feed)$/i;

export function isHomepageUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/+|\/+$/g, '');
    if (path === '') return true; // bare domain root

    const segments = path.split('/').filter(Boolean);

    // Numeric ID segment (3+ digits) → specific article
    if (segments.some(seg => /^\d{3,}$/.test(seg))) return false;

    // Long multi-hyphen slug → specific article title
    if (segments.some(seg => (seg.match(/-/g) || []).length >= 2 && seg.length > 18)) return false;

    // Every segment is a generic listing word → homepage/listing page
    return segments.every(seg => GENERIC_SEGMENTS.test(seg));
  } catch {
    return false;
  }
}

// ── News / winner / results detection ─────────────────────────────────────
// Much broader than a simple "wins the competition" check — catches
// "X Wins ArchDaily's Building of the Year", "Winners of the 2025 XYZ Announced",
// "Shortlist Revealed for...", "Jury Selects...", etc.
export const NEWS_PATTERN = /\b(winners?\s+(?:of|are|have been|announced|revealed|selected|named)|\bwins?\b[\s\S]{0,60}\b(?:competition|award|prize|grant|fellowship|residency|challenge|of the year|title)\b|has been (?:selected|awarded|shortlisted|named)|shortlists?\s+(?:for|announced|revealed)|results?\s+(?:of|are|announced|revealed)|finalists?\s+(?:announced|revealed|selected|named)|jury\s+(?:selects?|announces?|has chosen|panel)|grand prize winner|first[\s-]place|runner[\s-]up|second[\s-]place|third[\s-]place|opens? to (?:the )?public|recently (?:opened|completed|unveiled|inaugurated)|breaks? ground|just completed|celebrates? (?:its )?opening|now open to visitors|honou?rable mention)\b/i;

export function looksLikeNews(text) {
  return NEWS_PATTERN.test(text || '');
}

// ── Stale year in title ────────────────────────────────────────────────
// "2023 Architecture Award — Call for Entries" with no extractable deadline
// would otherwise pass through forever. If the newest year mentioned in the
// TITLE is before the current year, treat it as a stale listing.
// Only checks the title (not body text) to avoid false positives from
// historical context like "since 2015" or "founded in 2010".
export function isLikelyOutdatedYear(title) {
  if (!title) return false;
  const years = [...title.matchAll(/\b(20[12]\d)\b/g)].map(m => parseInt(m[1], 10));
  if (!years.length) return false;
  const currentYear = new Date().getFullYear();
  return Math.max(...years) < currentYear;
}

// ── Generic listing/category page title ────────────────────────────────
// Catches titles like "Competitions and Grants", "Awards & Competitions",
// "AIA New York: Competitions + Grants" — these are section/category pages
// on a site (linking to MANY opportunities), not one specific opportunity.
const CAT_WORD = '(?:competitions?|grants?|awards?|fellowships?|residenc(?:y|ies)|open\\s+calls?|calls?\\s+for\\s+(?:entries|submissions|proposals|papers|abstracts)|opportunities|prizes?|exhibitions?)';
const CATEGORY_PHRASE = `${CAT_WORD}(?:\\s*(?:and|&|,|\\+)\\s*${CAT_WORD})*`;
const LISTING_TITLE_RE = new RegExp(`(?:^|[\\-|:•·»]\\s*)${CATEGORY_PHRASE}\\s*$`, 'i');

export function isGenericListingTitle(title) {
  if (!title) return false;
  return LISTING_TITLE_RE.test(title.trim());
}

// ── Non-authoritative domain blocklist ─────────────────────────────────
// Image boards, stock photo libraries, video sites, shopping marketplaces,
// and forums/wikis show up in general web searches for almost any topic,
// but are never themselves a place to submit to or apply through — they're
// someone's saved board, a stock photo, a video, or a discussion thread
// ABOUT the topic, not the opportunity itself. Block at the domain level so
// these never reach AI classification or the dashboard at all.
//
// Deliberately NOT blocked: instagram.com, facebook.com, x.com/twitter.com —
// organisations legitimately post real open calls and deadlines on social
// media (the enrichment pass specifically reads these for deadline info),
// so blocking them would remove genuine opportunities, not just noise.
const BLOCKED_DOMAINS = [
  /(^|\.)pinterest\.[a-z.]+$/i,
  /(^|\.)shutterstock\.com$/i,
  /(^|\.)gettyimages\.[a-z.]+$/i,
  /(^|\.)istockphoto\.com$/i,
  /(^|\.)alamy\.com$/i,
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtu\.be$/i,
  /(^|\.)tiktok\.com$/i,
  /(^|\.)reddit\.com$/i,
  /(^|\.)quora\.com$/i,
  /(^|\.)wikipedia\.org$/i,
  /(^|\.)wikimedia\.org$/i,
  /(^|\.)amazon\.[a-z.]+$/i,
  /(^|\.)ebay\.[a-z.]+$/i,
  /(^|\.)etsy\.com$/i,
];

export function isBlockedDomain(url) {
  try {
    const host = new URL(url).hostname;
    return BLOCKED_DOMAINS.some(re => re.test(host));
  } catch {
    return false;
  }
}
