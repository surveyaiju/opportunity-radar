# Opportunity Radar

A personal daily dashboard that automatically discovers and organizes architecture & design professional opportunities.

## What it does

Every morning at 6 AM UTC, a GitHub Action:
1. Scrapes 20 RSS feeds from architecture sites
2. Runs 40+ DuckDuckGo searches using opportunity keywords
3. Runs a Gemini knowledge search for well-known recurring programs
4. Uses Gemini AI to classify each item, extract deadline/fee/prize, and filter out non-opportunities (blog posts, news, sports, etc.)
5. Deduplicates against everything already in the database
6. Commits the updated `data/opportunities.json`
7. The dashboard reads this file — no server needed

---

## Setup (one time, ~15 minutes)

### 1. Fork or upload this repo to GitHub
- Go to github.com → New repository → name it `opportunity-radar`
- Upload all these files

### 2. Add your Gemini API key as a secret
- In your repo: **Settings → Secrets and variables → Actions → New repository secret**
- Name: `GEMINI_API_KEY`
- Value: your Gemini API key (get one free at aistudio.google.com)

### 3. Enable GitHub Actions
- Go to **Actions** tab in your repo
- Click "I understand my workflows, go ahead and enable them"

### 4. Enable GitHub Pages (for the dashboard)
- Go to **Settings → Pages**
- Source: **Deploy from a branch**
- Branch: `main`, folder: `/ (root)`
- Save — your dashboard will be at `https://yourusername.github.io/opportunity-radar`

### 5. Run the first collection manually
- Go to **Actions → Daily Opportunity Update → Run workflow**
- This runs the full pipeline immediately rather than waiting for 6 AM

---

## File structure

```
OpportunityRadar/
├── index.html              ← Dashboard (open this in browser)
├── styles.css              ← Dashboard styles
├── app.js                  ← Dashboard logic
├── package.json            ← Node.js dependencies
│
├── collector/
│   ├── main.js             ← Orchestrator (runs the full pipeline)
│   ├── rss.js              ← RSS feed fetcher
│   ├── search.js           ← DuckDuckGo + Gemini knowledge search
│   ├── gemini.js           ← AI classifier and data extractor
│   └── dedupe.js           ← Deduplication logic
│
├── config/
│   └── sources.json        ← RSS feeds, search phrases, keywords
│
├── data/
│   └── opportunities.json  ← Database (auto-updated by GitHub Action)
│
└── .github/
    └── workflows/
        └── daily-update.yml ← GitHub Actions schedule
```

---

## Adding your Google Alerts as RSS feeds

1. Go to [alerts.google.com](https://alerts.google.com)
2. Edit an existing alert (pencil icon)
3. Change **"Deliver to"** from Email to **RSS feed**
4. Save → click the RSS icon → copy the URL
5. Add to `config/sources.json` under `rss_feeds`:

```json
{
  "id": "alert_comp",
  "name": "Alert: architecture competition",
  "url": "https://www.google.com/alerts/feeds/YOURCODE/...",
  "enabled": true
}
```

---

## Running locally (optional)

```bash
npm install
GEMINI_API_KEY=your_key_here node collector/main.js
```

Then open `index.html` in your browser.

---

## Customizing

- **Add/remove RSS feeds:** edit `config/sources.json` → `rss_feeds`
- **Add search phrases:** edit `config/sources.json` → `search_phrases`
- **Change schedule:** edit `.github/workflows/daily-update.yml` → `cron`
- **Adjust AI filtering:** edit the prompt in `collector/gemini.js`

---

## Free tier limits

| Service | Free limit | Usage |
|---|---|---|
| GitHub Actions | 2,000 min/month | ~5–10 min/day = ~200 min/month ✓ |
| GitHub Pages | Unlimited | Static site ✓ |
| Gemini 1.5 Flash | 15 RPM / 1M tokens/day | ~200–500 tokens per batch ✓ |
| DuckDuckGo | No official limit | 3s delay between requests ✓ |
