const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '../data/opportunities.json');

function loadExistingData() {
  if (!fs.existsSync(dataPath)) return [];
  try {
    const rawData = fs.readFileSync(dataPath, 'utf8');
    return JSON.parse(rawData);
  } catch (e) {
    console.error("Error reading data file, starting fresh.");
    return [];
  }
}

function isDuplicate(newItem, existingItems) {
  return existingItems.some(item => 
    item.url === newItem.link || 
    item.title.toLowerCase() === newItem.title.toLowerCase()
  );
}

function saveData(data) {
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

module.exports = { loadExistingData, isDuplicate, saveData };
