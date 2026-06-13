const fs = require('fs');
const path = require('path');
const { fetchRSS } = require('./rss');
const { fetchSearchQueries } = require('./search');
const { analyzeOpportunity } = require('./gemini');
const { loadExistingData, isDuplicate, saveData } = require('./dedupe');

// Load configurations
const sourcesPath = path.join(__dirname, '../config/sources.json');
const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));

// Define your daily safety limit (15 is safe for a 20 RPD limit)
const MAX_BATCH_SIZE = 15; 

async function runPipeline() {
  console.log('🚀 Starting Opportunity Radar Pipeline...\n');
  
  let existingData = loadExistingData();
  let newOpportunities = [];
  let allScrapedItems = [];

  // Step 1: Gather all raw items
  for (const feed of sources.rssFeeds) {
    console.log(`📡 Fetching feed: ${feed.name}`);
    const items = await fetchRSS(feed.url, feed.name);
    allScrapedItems = allScrapedItems.concat(items);
  }

  const searchItems = await fetchSearchQueries(sources.searchQueries);
  allScrapedItems = allScrapedItems.concat(searchItems);

  // Filter out duplicates BEFORE starting the AI process to save quota
  const itemsToProcess = allScrapedItems.filter(item => 
    !isDuplicate(item, existingData) && !isDuplicate(item, newOpportunities)
  );

  // Step 2: Process only a BATCH of items through AI
  const batch = itemsToProcess.slice(0, MAX_BATCH_SIZE);
  
  console.log(`\n🧠 Found ${itemsToProcess.length} new items. Processing a batch of ${batch.length} through Gemini AI...`);
  
  for (const item of batch) {
    console.log(`\n    Analyzing: ${item.title.substring(0, 50)}...`);
    const aiData = await analyzeOpportunity(item.title, item.description, item.link);

    if (aiData && aiData.relevant) {
      console.log(`    ✅ Kept: ${aiData.type}`);
      newOpportunities.push({
        id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
        title: aiData.title || item.title,
        url: item.link,
        source: item.source,
        type: aiData.type || "Opportunity",
        deadline: aiData.deadline || "",
        fee: aiData.fee || "",
        prize: aiData.prize || "",
        description: aiData.description || "",
        dateAdded: new Date().toISOString()
      });
    } else {
      console.log(`    ❌ Discarded (Irrelevant/News)`);
      existingData.push({ url: item.link, title: item.title, isJunk: true });
    }

    // Mandatory delay
    await new Promise(r => setTimeout(r, 3500));
  }

  // Step 3: Merge and Save
  const validNew = newOpportunities;
  const finalDatabase = [...validNew, ...existingData];
  
  saveData(finalDatabase);

  console.log(`\n🎉 Pipeline Complete! Processed ${batch.length} items.`);
  console.log(`Added ${validNew.length} new actionable opportunities.`);
}

runPipeline();
