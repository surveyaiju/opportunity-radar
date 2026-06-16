// collector/gemini.js
// Classifies and filters items using Google Gemini 1.5 Flash (free tier)
//
// Pipeline for every item:
//   1. Pre-filter (regex) — drop sports/jobs/news/winner-announcements/homepage links
//   2. Regex extraction — fill deadline/fee/prize/category for ALL items (free, instant)
//   3. AI classification — only for items regex couldn't confidently categorise,
//      capped per run to respect free tier limits
//   4. Expiry filter — drop anything whose deadline has already passed
//
// Free tier rate limit strategy:
//   - Batch size: 20 items per call (~6,000 tokens, safe)
//   - 10s delay between batches = 6 calls/min, safe under 15 RPM
//   - Cap: max 80 ambiguous items sent to Gemini per run

import {
  extractDeadline, extractFee, extractPrize,
  isExpired, isHomepageUrl, looksLikeNews, isLikelyOutdatedYear, isGenericListingTitle,
} from './extract.js';

// Tried in order. gemini-2.0-flash consistently 429s on the free tier even
// with tiny batches — gemini-flash-latest works reliably, so it goes first.
const MODEL_CANDIDATES = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];
const geminiUrl = model => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const BATCH_SIZE  = 20;
const BATCH_DELAY = 10000;
const MAX_PER_RUN = 200;
const MAX_RETRIES = 2;
const EXPIRY_GRACE_DAYS = 1; // keep items whose deadline was "yesterday" — likely timezone noise

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Pre-filter ──────────────────────────────────────────────────────────
const REQUIRE = /\b(architect(?:ure|ural|s)?|urban design|urban planning|landscape architect|interior design|built environment|design competition|open call|call for (?:entries|submissions|papers|proposals|abstracts|projects)|design grant|architecture grant|design fellow(?:ship)?|design residen(?:cy|t)|design award|architecture award|public art|art commission|biennale|pavilion|design prize|architecture prize|housing design|sustainable design|heritage architecture|adaptive reuse|spatial design)\b/i;

const BLOCK = /\b(archery|bow and arrow|sports? competition|football|basketball|soccer|baseball|cricket|golf tournament|swimming competition|tennis tournament|esports|gaming|cooking competition|beauty contest|fashion show|automobile review|stock market|cryptocurrency|job listing|now hiring|we.?re hiring|javascript|typescript|python (?:competition|challenge)|coding (?:competition|challenge|contest)|programming (?:competition|challenge|contest)|hackathon|software development (?:competition|challenge)|web development (?:competition|challenge)|app development (?:competition|challenge)|developer challenge|algorithm competition|data science competition|game jam|machine learning competition)\b/i;

function preFilter(item) {
  const text = `${item.title} ${item.text}`;
  if (BLOCK.test(text))                 return false;
  if (looksLikeNews(text))              return false; // winners, results, shortlists, completed projects
  if (isHomepageUrl(item.url))          return false; // links to a site's main listing page, not a specific opportunity
  if (isGenericListingTitle(item.title)) return false; // title is just "Competitions and Grants" etc — a category page
  if (isLikelyOutdatedYear(item.title)) return false; // title's newest year is before this year, no other deadline found
  if (!REQUIRE.test(text))              return false;
  return true;
}

// ── Regex category ─────────────────────────────────────────────────────
function regexCategory(item) {
  const t = `${item.title} ${item.text}`.toLowerCase();
  if (/call for paper|call for abstract|journal|special issue/.test(t)) return 'Journal/CFP';
  if (/\bconference\b|\bsymposium\b/.test(t)) return 'Conference';
  if (/\bfellowship\b/.test(t))   return 'Fellowship';
  if (/\bresidency\b/.test(t))    return 'Residency';
  if (/\bgrant\b|\bfunding\b/.test(t)) return 'Grant';
  if (/\baward\b|\bnominat/.test(t)) return 'Award';
  if (/biennale|pavilion|exhibition/.test(t)) return 'Exhibition/Biennale';
  if (/public art|\brfq\b|\brfp\b/.test(t)) return 'Public Art/RFQ';
  if (/competition|challenge|contest|prize/.test(t)) return 'Competition';
  return ''; // empty = ambiguous, prioritised for AI
}

// ── Apply regex extraction to fill gaps (used for both AI and non-AI items) ─
function applyExtraction(item) {
  const text = `${item.title} ${item.text}`;
  return {
    ...item,
    deadline: item.deadline || extractDeadline(text),
    fee:      (item.fee && item.fee !== 'Unknown') ? item.fee : extractFee(text),
    prize:    item.prize || extractPrize(text),
  };
}

// ── Prioritise which items get the Gemini quota ──────────────────────────
function prioritise(items) {
  const score = i => {
    let s = 0;
    if (!regexCategory(i))              s += 3; // ambiguous — AI needed most
    if (i.source_type === 'web_search') s += 2;
    if (i.source_type === 'site_scrape') s += 1;
    return s;
  };
  return [...items].sort((a, b) => score(b) - score(a));
}

// ── Gemini prompt ─────────────────────────────────────────────────────────
function buildPrompt(items) {
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return `Today is ${today}.

You are reviewing ${items.length} items from architecture and design RSS feeds, search results, and websites.

SET keep=true ONLY if this is a currently OPEN opportunity someone can apply to right now:
  Competition, grant, fellowship, residency, call for papers, award nomination call,
  exhibition open call, public art commission, conference call for papers.

SET keep=false if it is:
  - A news article about a completed or newly opened building
  - An article about WHO WON a competition, shortlist/finalist announcements, results, or honourable mentions
  - A project feature, portfolio showcase, or architect profile
  - A product review, interview, or trend piece
  - A job listing
  - An opportunity whose deadline has CLEARLY ALREADY PASSED relative to today (${today})
  - A link to a website's general homepage or listings page rather than one specific opportunity
  - Unrelated to architecture or design

For keep=true items extract:
  category: ONE of: Competition, Grant, Fellowship, Residency, Journal/CFP, Award,
    Exhibition/Biennale, Public Art/RFQ, Conference, Other
  description: One sentence — what it is, who can enter, what they gain
  deadline: Exact date as written ("30 Jun 2026") or "" if not mentioned
  fee: "Free" / fee amount (e.g. "€60") / "Unknown"
  prize: Prize or benefit (e.g. "€10,000") or ""

Items:
${JSON.stringify(items.map(i => ({ id: i.id, title: i.title, text: (i.text || '').slice(0, 300) })))}

Return ONLY a JSON array, ${items.length} objects, same order as input.
keep=true:  {"id":"...","keep":true,"category":"...","description":"...","deadline":"...","fee":"...","prize":"..."}
keep=false: {"id":"...","keep":false}`;
}

// ── Single Gemini API call with model fallback + retry ────────────────────
// - 404 (model not found/retired) → try the next model in MODEL_CANDIDATES
// - 429 (rate limited) → the model exists; wait and retry the SAME model
async function geminiCall(prompt, apiKey) {
  let lastError;

  for (const model of MODEL_CANDIDATES) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const r = await fetch(`${geminiUrl(model)}?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.05, maxOutputTokens: 4096, responseMimeType: 'application/json' },
          }),
          signal: AbortSignal.timeout(45000),
        });

        if (r.status === 404) {
          console.log(`  ⚠ Model "${model}" not available (404). Trying next model…`);
          lastError = new Error(`${model}: 404 not found`);
          break; // stop retrying this model, move to next in MODEL_CANDIDATES
        }

        if (r.status === 429) {
          console.log(`  ⏳ "${model}" rate limited (429). Trying next model…`);
          lastError = new Error(`${model}: 429 rate limited`);
          break; // don't waste time retrying — try the next model immediately
        }

        if (!r.ok) {
          const err = await r.text().catch(() => String(r.status));
          throw new Error(`${model} ${r.status}: ${err.slice(0, 120)}`);
        }

        const data = await r.json();
        const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        try { return JSON.parse(raw); } catch {
          const m = raw.match(/\[[\s\S]*\]/);
          if (m) return JSON.parse(m[0]);
          throw new Error('Response was not valid JSON');
        }

      } catch (e) {
        lastError = e;
        if (attempt === MAX_RETRIES - 1) break; // give up on this model, try next
        const wait = (attempt + 1) * 15000;
        console.log(`  ✗ Error with "${model}": ${e.message}. Waiting ${wait / 1000}s…`);
        await sleep(wait);
      }
    }
  }

  throw lastError || new Error('All models failed');
}

// ── Main export ────────────────────────────────────────────────────────────
export async function classifyWithGemini(items, apiKey) {
  // Stage 1: pre-filter (regex, free, instant)
  const preFiltered = items.filter(preFilter);
  console.log(`\n🤖 Classification`);
  console.log(`  ${items.length} in → ${items.length - preFiltered.length} removed by pre-filter (news/winners/homepage/irrelevant) → ${preFiltered.length} passed`);

  // Stage 2: regex extraction applied to EVERY item (fills deadline/fee/prize/category)
  const extracted = preFiltered.map(applyExtraction);

  const needsAI     = extracted.filter(i => !regexCategory(i));
  const hasCategory = extracted.filter(i =>  regexCategory(i));
  console.log(`  ${hasCategory.length} regex-classified · ${needsAI.length} need AI for category`);

  const regexClassified = hasCategory.map(i => ({
    ...i, category: regexCategory(i), description: i.description || '', ai_verified: false,
  }));

  let combined;

  if (!apiKey) {
    console.log('  No GEMINI_KEY set — regex classification only.');
    combined = [
      ...regexClassified,
      ...needsAI.map(i => ({ ...i, category: 'Other', description: '', ai_verified: false })),
    ];
  } else {
    const toSend = prioritise(needsAI).slice(0, MAX_PER_RUN);
    const capped = needsAI.length - toSend.length;
    console.log(`  Sending ${toSend.length} to Gemini (${BATCH_SIZE}/batch, 10s gap)${capped > 0 ? `, ${capped} deferred to next run` : ''}`);

    const batches = [];
    for (let i = 0; i < toSend.length; i += BATCH_SIZE) batches.push(toSend.slice(i, i + BATCH_SIZE));

    const aiVerified = [];
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      console.log(`  Batch ${b + 1}/${batches.length} — ${batch.length} items`);
      if (b > 0) await sleep(BATCH_DELAY);

      let results;
      try {
        results = await geminiCall(buildPrompt(batch), apiKey);
      } catch (e) {
        console.log(`  ✗ Batch ${b + 1} failed: ${e.message}. Regex fallback.`);
        batch.forEach(i => aiVerified.push({ ...i, category: 'Other', description: '', ai_verified: false }));
        continue;
      }
      if (!Array.isArray(results)) {
        console.log(`  ✗ Batch ${b + 1}: unexpected response. Regex fallback.`);
        batch.forEach(i => aiVerified.push({ ...i, category: 'Other', description: '', ai_verified: false }));
        continue;
      }

      const idMap = new Map(batch.map(i => [i.id, i]));
      let kept = 0, removed = 0;
      for (const r of results) {
        if (!r?.id || !idMap.has(r.id)) continue;
        const orig = idMap.get(r.id);
        if (r.keep === false) { removed++; continue; }
        kept++;
        aiVerified.push(applyExtraction({
          ...orig,
          category:    r.category    || 'Other',
          description: r.description || '',
          deadline:    r.deadline    || orig.deadline || '',
          fee:         r.fee         || orig.fee      || 'Unknown',
          prize:       r.prize       || orig.prize    || '',
          ai_verified: true,
        }));
      }
      console.log(`    ✓ kept ${kept}, removed ${removed}`);
    }

    // Items deferred past the cap: keep with regex classification so they're not lost
    const deferred = needsAI
      .filter(i => !toSend.includes(i))
      .map(i => ({ ...i, category: 'Other', description: '', ai_verified: false }));

    combined = [...regexClassified, ...aiVerified, ...deferred];
  }

  // Stage 3: expiry filter — drop anything whose deadline has clearly passed
  const notExpired = combined.filter(i => !isExpired(i.deadline, EXPIRY_GRACE_DAYS));
  const expiredCount = combined.length - notExpired.length;
  if (expiredCount > 0) console.log(`  🗑  ${expiredCount} removed — deadline already passed`);

  console.log(`  ✅ ${notExpired.length} total opportunities after classification`);
  return notExpired;
}
