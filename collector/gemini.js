const { GoogleGenerativeAI } = require("@google/generative-ai");

// This pulls your API key safely from GitHub Secrets (we will set this up later)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function analyzeOpportunity(title, description, url) {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `
  You are an expert filter for an architecture and design studio. Analyze the following text and determine if it is an ACTIONABLE opportunity.
  
  CRITICAL EXCLUSIONS - Return {"relevant": false} IMMEDIATELY if the text is:
  - News about a completed project or building opening.
  - Announcements of past competition winners or exhibition reviews.
  - Products, software updates, or real estate news.
  
  Only proceed if this is an active call for entries, competition, grant, residency, or journal submission.
  
  Text Title: ${title}
  Text Body: ${description}
  URL: ${url}
  
  If relevant, extract the following into a STRICT JSON object (no markdown, no backticks). Leave fields as empty strings "" if not found.
  {
    "relevant": true,
    "title": "Cleaned up title of the opportunity",
    "type": "Must be exactly one of: Competition, Grant/Fellowship, Journal/CFP, Exhibition, Residency, RFQ/Public Art",
    "deadline": "Extract deadline date (e.g., Oct 24, 2026)",
    "fee": "Extract entry fee (e.g., $50, Free)",
    "prize": "Extract prize pool or grant amount (max 5 words)",
    "description": "Strictly 1-sentence summary of what is required to submit."
  }
  `;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text().replace(/```json|```/g, '').trim();
    return JSON.parse(responseText);
  } catch (error) {
    console.error(`Gemini API Error for ${title}:`, error.message);
    return null;
  }
}

module.exports = { analyzeOpportunity };
