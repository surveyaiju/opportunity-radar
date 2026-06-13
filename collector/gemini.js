import fetch from 'node-fetch';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=';
const BATCH_SIZE = 8;
const DELAY_MS   = 2500; // Stay under 15 RPM free limit

export async function classifyItems(items, apiKey) {
  if (!items.length) return [];

  const results = [];
  const batches = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE));
  }

  console.log(`[GEMINI] Classifying ${items.length} items in ${batches.length} batches…`);

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    console.log(`[GEMINI] Batch ${b + 1}/${batches.length} (${batch.length} items)…`);

    try {
      const classified = await classifyBatch(batch, apiKey);
      results.push(...classified);
    } catch (err) {
      console.warn(`[GEMINI] Batch ${b + 1} failed: ${err.message} — keeping with basic data`);
      // On failure, keep items as-is so we don't silently lose them
      batch.forEach(item => {
        results.push({
          id:           item.id,
          keep:         true,
          category:     item.category || 'Other',
          organization: item.organization || '',
          description:  item.description || item.snippet?.slice(0, 150) || '',
          deadline:     item.deadline || '',
          fee:          item.fee || 'Unknown',
          prize:        item.prize || ''
        });
      });
    }

    if (b < batches.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  return results;
}

async function classifyBatch(items, apiKey) {
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const prompt = `Today is ${today}.

You are reviewing ${items.length} items scraped from architecture RSS feeds and web searches.

YOUR JOB: Determine if each item is a genuine professional OPPORTUNITY and extract the key data.

=== WHAT IS A GENUINE OPPORTUNITY (keep: true) ===
The item must be directly INVITING someone to apply, enter, or submit for ONE of these:
• Architecture or design COMPETITION — submit a design entry
• GRANT — apply for funding
• FELLOWSHIP or SCHOLARSHIP — apply for a fellowship program  
• RESIDENCY — apply for a studio or residency program
• CALL FOR PAPERS / SUBMISSIONS — submit to a journal or conference
• AWARD — nominate yourself or someone else
• EXHIBITION OPEN CALL — submit work to be exhibited
• BIENNALE / TRIENNIAL call — submit proposals
• PUBLIC ART COMMISSION / RFQ / RFP — submit qualifications or proposals
• CONFERENCE — call for speakers or presentations

=== WHAT IS NOT AN OPPORTUNITY (keep: false — REMOVE THESE) ===
• News article about a project that has been built or completed
• Photo essay, project feature, or "built works" showcase
• Interview, profile, or opinion piece about an architect or firm
• Product announcement or building material review
• Coverage of a competition result (who WON, not who can enter)
• Architecture tour, walk, or public event announcement
• "Best buildings of 2026" style roundups
• General industry news with no call to action
• Anything where there is nothing to apply for, enter, or submit

=== EXTRACTION RULES ===
Extract ONLY what is explicitly written in the title or description text.
• deadline: if a specific date is mentioned (e.g. "30 June 2026"), extract it. Otherwise: ""
• fee: if text says "free", "no entry fee", "free to enter" → "Free". If a fee amount is mentioned → that amount. Otherwise → "Unknown"  
• prize: if a prize amount, grant value, or benefit is mentioned → extract it. Otherwise: ""
• organization: who is running or hosting this opportunity. If not clear: ""
• description: write ONE sentence describing what the applicant must DO (not what the project is about)

Items to analyze:
${JSON.stringify(items.map(i => ({ id: i.id, title: i.title, text: (i.snippet || '').slice(0, 600) })))}

Return ONLY a valid JSON array, one object per item, same order as input.
No markdown fences. No explanation. Start with [

Format:
[{"id":"...","keep":true,"category":"Competition","organization":"...","description":"...","deadline":"","fee":"Unknown","prize":""}]`;

  const res = await fetch(`${GEMINI_URL}${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        response_mime_type: 'application/json'
      }
    }),
    signal: AbortSignal.timeout(45000)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();

  if (data.error) {
    throw new Error(data.error.message || 'Gemini API error');
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

  // Parse the JSON — try direct parse first, fall back to regex extraction
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const m = text.match(/\[[\s\S]*\]/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { return []; }
    }
    return [];
  }
}
