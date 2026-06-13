const Parser = require('rss-parser');
const parser = new Parser();

async function fetchRSS(feedUrl, sourceName) {
  try {
    const feed = await parser.parseURL(feedUrl);
    // Limit to the 10 most recent items per feed to avoid overloading the AI
    const recentItems = feed.items.slice(0, 10); 
    
    return recentItems.map(item => ({
      title: item.title || 'Untitled',
      link: item.link,
      description: item.contentSnippet || item.content || '',
      source: sourceName,
      pubDate: item.pubDate || new Date().toISOString()
    }));
  } catch (error) {
    console.error(`⚠️ Error fetching ${sourceName} (${feedUrl}):`, error.message);
    return [];
  }
}

module.exports = { fetchRSS };
