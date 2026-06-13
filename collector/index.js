const fs = require('fs');
const path = require('path');
const { fetchRSS } = require('./rss');
const { fetchSearchQueries } = require('./search');
const { analyzeOpportunity } = require('./gemini');
const { loadExistingData, isDuplicate, saveData } = require('./dedupe');

// Load configurations
const sourcesPath = path.join(__dirname, '../config/sources.json');
const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));

async function runPipeline() {
  console.log('🚀 Starting Opportunity Radar Pipeline...\n');
  
  let existingData = loadExistingData();
  let newOpportunities = [];
  let allScrapedItems = [];

  // Step 1: Gather all raw items from RSS and Searches
  for (const feed of sources.rssFeeds) {
    console.log(`📡 Fetching feed: ${feed.name}`);
    const items = await fetchRSS(feed.url, feed.name);
    allScrapedItems = allScrapedItems.concat(items);
  }

  console.log(`\n🔍 Running Search Queries...`);
  const searchItems = await fetchSearchQueries(sources.searchQueries);
  allScrapedItems = allScrapedItems.concat(searchItems);

  // Step 2: Process items through AI
  console.log(`\n🧠 Processing ${allScrapedItems.length} total items through Gemini AI...`);
  
  for (const item of allScrapedItems) {
    if (isDuplicate(item, existingData) || isDuplicate(item, newOpportunities)) {
      continue; 
    }

    console.log(`\n   Analyzing: ${item.title.substring(0, 50)}...`);
    const aiData = await analyzeOpportunity(item.title, item.description, item.link);

    if (aiData && aiData.relevant) {
      console.log(`   ✅ Kept: ${aiData.type}`);
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
      console.log(`   ❌ Discarded (Irrelevant/News)`);
      // Save a "ghost" record so we don't waste API calls re-analyzing this exact junk link tomorrow
      existingData.push({ url: item.link, title: item.title, isJunk: true });
    }

    // Mandatory 3.5-second delay to avoid Gemini rate limits
    await new Promise(r => setTimeout(r, 3500));
  }

  // Step 3: Merge and Save
  const validNew = newOpportunities.filter(o => !o.isJunk);
  const cleanExisting = existingData.filter(o => !o.isJunk); 
  
  // Combine them (Newest first). Keep ghosts in existingData for deduping later.
  const finalDatabase = [...validNew, ...existingData];
  
  saveData(finalDatabase);

  console.log(`\n🎉 Pipeline Complete! Added ${validNew.length} new actionable opportunities.`);
}

runPipeline();
