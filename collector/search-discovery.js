const fs = require("fs");
const sources = require("../config/sources.json");

async function discoverFromSearchPhrases() {

  const opportunities = [];

  for (const phrase of sources.search_phrases) {

    opportunities.push({
      title: phrase,
      type: "SEARCH_SEED"
    });

  }

  return opportunities;
}

async function buildSearchQueue() {

  const phrases = await discoverFromSearchPhrases();

  const queue = [];

  for (const p of phrases) {

    queue.push({
      query: p.title,
      created: new Date().toISOString()
    });

  }

  return queue;
}

async function run() {

  const queue = await buildSearchQueue();

  fs.writeFileSync(
    "./search-queue.json",
    JSON.stringify(queue, null, 2)
  );

  console.log(
    `Created ${queue.length} search queries`
  );

}

run();
