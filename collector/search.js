import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(readFileSync(join(__dir, '../config/sources.json'), 'utf8'));

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=';

function makeId(str) {
  return createHash('md5').update(str).digest('hex').slice(0, 16);
}

// ── DuckDuckGo HTML search ──────────────────────────────────────────
async function searchDDG(query) {
  try {
    const params = new URLSearchParams({ q: query, kl: 'us-en' });
    const res = await fetch(`https://html.duckduckgo.com/html/?${params}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(12000)
    });

    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results = [];

    $('.result__body').each((i, el) => {
      if (i >= 5) return false; // top 5 per query
      const $el = $(el);
      const titleEl = $el.find('.result__a');
      const title = titleEl.text().trim();
      const href = titleEl.attr('href') || '';
      const snippet = $el.find('.result__snippet').text().trim();

      // DDG wraps URLs in redirect links — extract actual URL
      const match = href.match(/uddg=([^&]+)/);
      const url = match ? decodeURIComponent(match[1]) : href;

      if (url && title && !url.includes('duckduckgo.com')) {
        results.push({ title: title.slice(0, 200), url, snippet: snippet.slice(0, 500) });
      }
    });

    return results;
  } catch {
    return [];
  }
}

// ── Gemini knowledge search (catches recurring annual competitions) ──
async function geminiKnowledgeSearch(apiKey) {
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const prompt = `Today is ${today}.

List every architecture and design professional opportunity you know about that is currently open, opening soon, or a well-known recurring annual program. Be comprehensive. Include:
- Architecture competitions (free and paid)
- Design competitions  
- Architecture grants and fellowships
- Architecture and design residencies
- Calls for papers or submissions for architecture journals
- Biennale and triennial open calls
- Pavilion proposal calls
- Public art commissions and RFQs
- Architecture awards accepting nominations

For each opportunity you know, provide:
- title
- organization (who runs it)
- url (official website or call page — use your best knowledge, leave empty if unsure)
- deadline (if you know it, else "")
- fee ("Free" if free, else amount or "Unknown")
- category (one of: Competition, Grant, Fellowship, Residency, Journal/CFP, Award, Exhibition/Biennale, Public Art/RFQ, Conference, Other)
- description (1 sentence on what applicants must do)

Return ONLY a valid JSON array. No markdown. No explanation. Start with [`;

  try {
    const res = await fetch(`${GEMINI_BASE}${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, response_mime_type: 'application/json' }
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (!res.ok) return [];
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const parsed = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || '[]');

    const today = new Date().toISOString().slice(0, 10);
    return parsed.filter(i => i.title && i.url).map(i => ({
      id:           makeId(i.url || i.title),
      title:        String(i.title || '').slice(0, 200),
      url:          String(i.url || ''),
      snippet:      String(i.description || ''),
      source:       'Gemini Knowledge Search',
      found_date:   today,
      pub_date:     '',
      organization: String(i.organization || ''),
      category:     String(i.category || 'Other'),
      description:  String(i.description || ''),
      deadline:     String(i.deadline || ''),
      fee:          String(i.fee || 'Unknown'),
      prize:        '',
      is_new:       true
    }));
  } catch (err) {
    console.warn('[SEARCH] Gemini knowledge search failed:', err.message);
    return [];
  }
}

// ── Main search runner ──────────────────────────────────────────────
export async function runSearchDiscovery(apiKey) {
  const today = new Date().toISOString().slice(0, 10);
  const allResults = [];
  const seenUrls = new Set();

  // 1. DuckDuckGo searches
  console.log(`[SEARCH] Running ${sources.search_phrases.length} DuckDuckGo queries…`);
  let ddgCount = 0;

  for (const phrase of sources.search_phrases) {
    const results = await searchDDG(phrase);
    for (const r of results) {
      if (!seenUrls.has(r.url)) {
        seenUrls.add(r.url);
        allResults.push({
          id:           makeId(r.url),
          title:        r.title,
          url:          r.url,
          snippet:      r.snippet,
          source:       `Web Search`,
          found_date:   today,
          pub_date:     '',
          organization: '',
          category:     '',
          description:  '',
          deadline:     '',
          fee:          'Unknown',
          prize:        '',
          is_new:       true
        });
        ddgCount++;
      }
    }
    // Polite delay between searches to avoid rate limiting
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log(`[SEARCH] DuckDuckGo: ${ddgCount} unique results`);

  // 2. Gemini knowledge search (uses Gemini's training data)
  if (apiKey) {
    console.log('[SEARCH] Running Gemini knowledge search…');
    const knowledgeItems = await geminiKnowledgeSearch(apiKey);
    let kgCount = 0;
    for (const item of knowledgeItems) {
      if (!seenUrls.has(item.url)) {
        seenUrls.add(item.url);
        allResults.push(item);
        kgCount++;
      }
    }
    console.log(`[SEARCH] Gemini knowledge: ${kgCount} items`);
  }

  console.log(`[SEARCH] Total discovered: ${allResults.length} items`);
  return allResults;
}
