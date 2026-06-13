// collector/gemini.js
// Classifies and filters items using Google Gemini Flash (free tier)
//
// Rate limit strategy:
//   Free tier = 15 RPM. We use a RateLimiter that measures real elapsed
//   time between calls so we never guess — we calculate the exact wait needed.
//   Batch size = 40 items per call, so 600 items classified per minute maximum.
//   On a 429 error we back off and retry automatically.

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const BATCH_SIZE  = 40;   // items per API call — large batches = fewer calls = less rate limiting
const MAX_RPM     = 14;   // stay just under the 15 RPM free limit (safe buffer)
const MAX_RETRIES = 3;

// ── Real-time rate limiter ─────────────────────────────────────────────────
class RateLimiter {
  constructor(requestsPerMinute) {
    this.minGap = Math.ceil((60 / requestsPerMinute) * 1000); // ms between calls
    this.callTimes = []; // timestamps of recent calls
  }

  async wait() {
    const now = Date.now();
    // Remove timestamps older than 60 seconds
    this.callTimes = this.callTimes.filter(t => now - t < 60000);

    if (this.callTimes.length >= MAX_RPM) {
      // We've hit the limit — wait until oldest call is 60s ago
      const oldestInWindow = this.callTimes[0];
      const waitMs = 60000 - (now - oldestInWindow) + 200; // +200ms buffer
      if (waitMs > 0) {
        console.log(`  ⏳ Rate limit pause: ${(waitMs / 1000).toFixed(1)}s`);
        await sleep(waitMs);
      }
    } else if (this.callTimes.length > 0) {
      // Spread calls evenly even when under the limit
      const lastCall = this.callTimes[this.callTimes.length - 1];
      const sinceLastCall = Date.now() - lastCall;
      if (sinceLastCall < this.minGap) {
        await sleep(this.minGap - sinceLastCall);
      }
    }

    this.callTimes.push(Date.now());
  }
}

const rateLimiter = new RateLimiter(MAX_RPM);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Regex pre-filter (runs before Gemini — free and instant) ──────────────
// Items that fail this check never reach the API, saving quota and time
const REQUIRE = /\b(architect(?:ure|ural|s)?|urban design|urban planning|landscape architect|interior design|built environment|design competition|open call|call for (?:entries|submissions|papers|proposals|abstracts|projects)|design grant|architecture grant|design fellow(?:ship)?|design residen(?:cy|t)|design award|architecture award|public art|art commission|biennale|pavilion|design prize|architecture prize|housing design|sustainable design|heritage architecture|adaptive reuse|spatial design)\b/i;

const BLOCK = /\b(archery|bow and arrow|sports? competition|football|basketball|soccer|baseball|cricket|golf tournament|swimming competition|tennis tournament|esports|gaming competition|cooking competition|beauty contest|fashion show|car competition|automobile review|stock market|cryptocurrency|job listing|now hiring|we.?re hiring)\b/i;

// News about completed/awarded things — not something you can enter
const NEWS = /\b(wins? (?:the )?(?:competition|award|prize)|is awarded|has been (?:selected|awarded|shortlisted|unveiled)|opens? to (?:the )?public|recently (?:opened|completed|unveiled)|breaks? ground|under construction|just completed|celebrates opening)\b/i;

function preFilter(item) {
  const text = `${item.title} ${item.text}`;
  if (BLOCK.test(text)) return false;
  if (NEWS.test(text))  return false;
  if (!REQUIRE.test(text)) return false;
  return true;
}

// ── Gemini prompt — one call, up to 40 items ──────────────────────────────
function buildPrompt(items) {
  const today = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  });

  return `Today is ${today}.

You are reviewing ${items.length} items scraped from architecture and design RSS feeds, websites, and search results. Your job is to filter and classify them.

SET keep TO TRUE only if the item is a CURRENTLY OPEN opportunity that a professional architect or designer can actively APPLY TO, ENTER, or SUBMIT WORK TO. This means:
- Architecture / urban / landscape / interior design competitions
- Grants and funding calls
- Fellowship or residency programs with open applications
- Calls for papers or journal submissions
- Award nomination calls (where you submit work for consideration)
- Exhibition or biennale open calls (where you submit a proposal to participate)
- Public art commissions or RFQ/RFPs

SET keep TO FALSE if the item is ANY of these — these are the most common mistakes to avoid:
- News article about a building, renovation, or design project that has been completed
- Article about who won or was shortlisted for a competition (competition results ≠ open competition)
- Interview with an architect
- Project showcase or portfolio feature
- Product or material review
- Blog post about architecture trends, history, or criticism
- Anything where the deadline has clearly already passed before today
- Job listing or recruitment post
- Completely unrelated to architecture/design

For each item where keep is true, also extract:
- category: EXACTLY one of: Competition, Grant, Fellowship, Residency, Journal/CFP, Award, Exhibition/Biennale, Public Art/RFQ, Conference, Other
- description: One sentence — what is it, who can enter, what is the benefit
- deadline: The deadline date as written (e.g. "30 Jun 2026"). Empty string if not mentioned.
- fee: "Free" if explicitly stated as free. The fee amount if stated (e.g. "€60"). "Unknown" if unclear.
- prize: Prize or benefit (e.g. "€10,000 cash", "Funded 3-month residency"). Empty string if none stated.

Items (title + snippet of source text):
${JSON.stringify(
  items.map(i => ({
    id: i.id,
    title: i.title,
    text: (i.text || '').slice(0, 350),
  })),
  null, 0
)}

Return ONLY a valid JSON array with exactly ${items.length} objects in the same order as the input. No markdown, no explanation, no extra text. Start your response with [ and end with ].

Each object must have: {"id":"...","keep":true,"category":"...","description":"...","deadline":"...","fee":"...","prize":"..."}
For items where keep is false, you only need: {"id":"...","keep":false}`;
}

// ── Single Gemini API call with retry ─────────────────────────────────────
async function geminiCall(prompt, apiKey) {
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    await rateLimiter.wait(); // enforces rate limit before every call
    try {
      const r = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.05,         // very low temperature = consistent, factual outputs
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(45000),
      });

      // Rate limited — back off and retry
      if (r.status === 429) {
        const retryAfter = parseInt(r.headers.get('retry-after') || '30', 10);
        const wait = (retryAfter + 2) * 1000;
        console.log(`  ⚠ 429 rate limit. Waiting ${retryAfter + 2}s then retrying… (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(wait);
        attempt++;
        continue;
      }

      if (!r.ok) {
        const err = await r.text().catch(() => r.status);
        throw new Error(`Gemini ${r.status}: ${String(err).slice(0, 120)}`);
      }

      const data = await r.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Parse JSON — strip markdown fences if Gemini adds them despite instructions
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const m = raw.match(/\[[\s\S]*\]/);
        if (m) parsed = JSON.parse(m[0]);
        else throw new Error('Could not parse Gemini response as JSON');
      }

      if (!Array.isArray(parsed)) throw new Error('Gemini returned non-array JSON');
      return parsed;

    } catch (e) {
      if (attempt === MAX_RETRIES - 1) throw e;
      const wait = Math.pow(2, attempt) * 2000; // exponential backoff: 2s, 4s, 8s
      console.log(`  ✗ Error: ${e.message}. Retrying in ${wait / 1000}s…`);
      await sleep(wait);
      attempt++;
    }
  }
  throw new Error(`Failed after ${MAX_RETRIES} attempts`);
}

// ── Regex category fallback (used when AI is unavailable) ────────────────
function regexCategory(item) {
  const t = `${item.title} ${item.text}`.toLowerCase();
  if (/call for paper|call for abstract|journal|special issue/.test(t)) return 'Journal/CFP';
  if (/\bconference\b|\bsymposium\b/.test(t)) return 'Conference';
  if (/\bfellowship\b/.test(t)) return 'Fellowship';
  if (/\bresidency\b/.test(t)) return 'Residency';
  if (/\bgrant\b|\bfunding\b/.test(t)) return 'Grant';
  if (/\baward\b|\bnominat/.test(t)) return 'Award';
  if (/biennale|pavilion|exhibition/.test(t)) return 'Exhibition/Biennale';
  if (/public art|\brfq\b|\brfp\b/.test(t)) return 'Public Art/RFQ';
  if (/competition|challenge|contest|prize/.test(t)) return 'Competition';
  return 'Other';
}

// ── Main export ────────────────────────────────────────────────────────────
export async function classifyWithGemini(items, apiKey) {
  if (!apiKey) {
    console.log('\n🤖 Gemini — skipped (no GEMINI_KEY). Using regex classification only.');
    return items.map(item => ({
      ...item,
      description: '',
      category: regexCategory(item),
      ai_verified: false,
    }));
  }

  // Stage 1: pre-filter with regex (free, instant, removes obvious noise)
  const preFiltered = items.filter(preFilter);
  const preRejected = items.length - preFiltered.length;

  console.log(`\n🤖 Gemini classification`);
  console.log(`  ${items.length} items in`);
  console.log(`  ${preRejected} removed by pre-filter (news/sports/jobs/irrelevant)`);
  console.log(`  ${preFiltered.length} sent to Gemini API`);
  console.log(`  Batch size: ${BATCH_SIZE} items per call`);
  console.log(`  Estimated calls: ${Math.ceil(preFiltered.length / BATCH_SIZE)}`);

  if (!preFiltered.length) return [];

  // Stage 2: split into large batches, send to Gemini
  const batches = [];
  for (let i = 0; i < preFiltered.length; i += BATCH_SIZE) {
    batches.push(preFiltered.slice(i, i + BATCH_SIZE));
  }

  const verified = [];

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const batchNum = `${b + 1}/${batches.length}`;
    console.log(`  Batch ${batchNum} — ${batch.length} items`);

    let results;
    try {
      results = await geminiCall(buildPrompt(batch), apiKey);
    } catch (e) {
      console.log(`  ✗ Batch ${batchNum} failed: ${e.message}. Using regex fallback for this batch.`);
      batch.forEach(item => verified.push({
        ...item,
        description: '',
        category: regexCategory(item),
        ai_verified: false,
      }));
      continue;
    }

    // Match results back to original items by id
    const idMap = new Map(batch.map(i => [i.id, i]));
    let kept = 0, removed = 0;

    for (const r of results) {
      if (!r?.id || !idMap.has(r.id)) continue;
      const original = idMap.get(r.id);
      if (r.keep === false) {
        removed++;
        continue;
      }
      kept++;
      verified.push({
        ...original,
        category:    r.category    || regexCategory(original),
        description: r.description || '',
        deadline:    r.deadline    || original.deadline || '',
        fee:         r.fee         || original.fee      || 'Unknown',
        prize:       r.prize       || '',
        ai_verified: true,
      });
    }
    console.log(`    ✓ kept ${kept}, removed ${removed}`);
  }

  console.log(`  ✅ ${verified.length} opportunities after AI filter`);
  return verified;
}
