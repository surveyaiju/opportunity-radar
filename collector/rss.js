const fs = require("fs");
const path = require("path");
const Parser = require("rss-parser");

const parser = new Parser();

const ROOT = path.join(__dirname, "..");

const sources = require(path.join(ROOT, "config", "sources.json"));

const OUTPUT = path.join(ROOT, "opportunities.json");

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function buildId(item) {
  return slugify(
    `${item.title}-${item.link || item.guid || ""}`
  );
}

async function fetchFeed(url, sourceName) {
  try {
    const feed = await parser.parseURL(url);

    return feed.items.map(item => ({
      id: buildId(item),
      title: item.title || "",
      url: item.link || "",
      description:
        item.contentSnippet ||
        item.content ||
        "",
      source: sourceName,
      category: "",
      deadline: "",
      fee: "",
      prize: "",
      eligibility: "",
      organization: "",
      country: "",
      status: "new",
      discovered_at: new Date().toISOString(),
      published_at: item.pubDate || ""
    }));
  } catch (err) {
    console.error(`Failed: ${url}`);
    return [];
  }
}

async function run() {

  const all = [];

  const rssFeeds = [
    ...(sources.rss || []),
    ...(sources.google_alerts || [])
  ];

  for (const url of rssFeeds) {

    console.log(`Reading ${url}`);

    const items = await fetchFeed(url, url);

    all.push(...items);
  }

  const unique = [];

  const seen = new Set();

  for (const item of all) {

    if (seen.has(item.id)) continue;

    seen.add(item.id);

    unique.push(item);
  }

  unique.sort((a,b) => {
    return (
      new Date(b.published_at || 0) -
      new Date(a.published_at || 0)
    );
  });

  fs.writeFileSync(
    OUTPUT,
    JSON.stringify(unique,null,2)
  );

  console.log(
    `Saved ${unique.length} opportunities`
  );
}

run();
