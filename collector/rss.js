const fs = require("fs");
const Parser = require("rss-parser");

const parser = new Parser({
  timeout: 30000
});

const sources = require("../config/sources.json");

async function fetchFeed(feed) {
  try {
    const data = await parser.parseURL(feed.url);

    return (data.items || []).map(item => ({
      id: item.guid || item.link || item.title,
      title: item.title || "",
      url: item.link || "",
      description:
        item.contentSnippet ||
        item.content ||
        item.summary ||
        "",
      source: feed.name,
      sourceType: feed.type,
      published:
        item.pubDate ||
        item.isoDate ||
        new Date().toISOString(),
      discovered: new Date().toISOString()
    }));

  } catch (err) {
    console.log(`RSS failed: ${feed.name}`);
    return [];
  }
}

function scoreOpportunity(item) {

  const text = (
    item.title +
    " " +
    item.description
  ).toLowerCase();

  let score = 0;

  sources.positive_keywords.forEach(word => {
    if (text.includes(word.toLowerCase())) {
      score += 1;
    }
  });

  sources.negative_keywords.forEach(word => {
    if (text.includes(word.toLowerCase())) {
      score -= 5;
    }
  });

  return score;
}

function categorize(item) {

  const text = (
    item.title +
    " " +
    item.description
  ).toLowerCase();

  if (
    text.includes("call for papers") ||
    text.includes("journal")
  ) {
    return "Journal";
  }

  if (
    text.includes("conference")
  ) {
    return "Conference";
  }

  if (
    text.includes("grant")
  ) {
    return "Grant";
  }

  if (
    text.includes("fellowship")
  ) {
    return "Fellowship";
  }

  if (
    text.includes("residency")
  ) {
    return "Residency";
  }

  if (
    text.includes("award")
  ) {
    return "Award";
  }

  if (
    text.includes("public art") ||
    text.includes("rfq") ||
    text.includes("rfp")
  ) {
    return "Public Art / RFQ";
  }

  if (
    text.includes("landscape")
  ) {
    return "Landscape";
  }

  if (
    text.includes("urban")
  ) {
    return "Urban Design";
  }

  return "Competition";
}

function extractDeadline(text) {

  const patterns = [

    /\b\d{1,2}\s(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s\d{4}\b/i,

    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s\d{1,2},?\s\d{4}\b/i,

    /\b\d{4}-\d{2}-\d{2}\b/
  ];

  for (const pattern of patterns) {

    const match = text.match(pattern);

    if (match) {
      return match[0];
    }
  }

  return "";
}

function extractFee(text) {

  const t = text.toLowerCase();

  if (
    t.includes("free entry") ||
    t.includes("no fee") ||
    t.includes("free of charge")
  ) {
    return "Free";
  }

  if (
    /\$\d+/.test(text) ||
    /€\d+/.test(text)
  ) {
    return "Has Fee";
  }

  return "";
}

async function run() {

  let results = [];

  for (const feed of sources.rss_sources) {

    console.log(`Fetching ${feed.name}`);

    const entries = await fetchFeed(feed);

    results.push(...entries);
  }

  results = results
    .map(item => {

      const fullText =
        item.title +
        " " +
        item.description;

      return {

        ...item,

        score: scoreOpportunity(item),

        category: categorize(item),

        deadline: extractDeadline(fullText),

        fee: extractFee(fullText),

        status: "New"
      };
    })
    .filter(item => item.score >= 1);

  fs.writeFileSync(
    "./opportunities-rss.json",
    JSON.stringify(results, null, 2)
  );

  console.log(
    `${results.length} opportunities saved`
  );
}

run();  for (const kw of sources.reject_keywords) {
    if (text.includes(kw.toLowerCase())) return false;
  }

  // Must have at least one opportunity keyword
  const hasOpportunity = sources.opportunity_keywords.some(kw => text.includes(kw.toLowerCase()));
  if (!hasOpportunity) return false;

  // Must have at least one architecture keyword
  const hasArchitecture = sources.architecture_keywords.some(kw => text.includes(kw.toLowerCase()));
  if (!hasArchitecture) return false;

  return true;
}

export async function fetchAllFeeds() {
  const enabled = sources.rss_feeds.filter(f => f.enabled);
  const items = [];
  const today = new Date().toISOString().slice(0, 10);

  console.log(`[RSS] Fetching ${enabled.length} feeds…`);

  for (const feed of enabled) {
    try {
      const result = await parser.parseURL(feed.url);
      let added = 0;

      for (const item of (result.items || []).slice(0, 50)) {
        const title = stripHtml(item.title || '').slice(0, 200);
        const url   = (item.link || item.guid || '').trim();
        if (!title || !url) continue;

        const snippet = extractSnippet(item);

        if (!quickFilter(title, snippet, sources)) continue;

        items.push({
          id:         makeId(url || title),
          title,
          url,
          snippet,
          source:     feed.name,
          found_date: today,
          pub_date:   item.pubDate || item.isoDate || '',
          // will be filled by Gemini
          organization: '',
          category:     '',
          description:  '',
          deadline:     '',
          fee:          'Unknown',
          prize:        '',
          is_new:       true
        });
        added++;
      }

      console.log(`[RSS] ${feed.name}: ${added} relevant items`);
    } catch (err) {
      console.warn(`[RSS] FAILED ${feed.name}: ${err.message}`);
    }

    // Small delay between feeds to be polite
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[RSS] Total from feeds: ${items.length} items`);
  return items;
}
