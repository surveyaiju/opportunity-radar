const { fetchRSS } = require('./rss');

async function fetchSearchQueries(queries) {
  let allResults = [];
  
  for (const query of queries) {
    // Wrap the text query into a free Google RSS search URL
    const searchUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const sourceName = `Search: ${query.replace(/"/g, '').substring(0, 20)}...`;
    
    const results = await fetchRSS(searchUrl, sourceName);
    allResults = allResults.concat(results);
  }
  
  return allResults;
}

module.exports = { fetchSearchQueries };
