# Opportunity Radar

Automatically discovers open architecture competitions, grants, fellowships, residencies, journal CFPs, awards, and exhibitions — and serves them in a filterable dashboard.

**Runs entirely free:**
- GitHub Actions (free tier) — runs the collector daily
- GitHub Pages (free) — hosts the dashboard
- Gemini Flash (free tier) — AI classification
- Serper.dev (free tier, 2,500 searches/month) — web search

---

## What it does

Every morning at 8am UTC, GitHub Actions:
1. Fetches 22 RSS feeds + 11 Google Alerts
2. Scrapes 13 key websites for new listings
3. Runs 40+ Google searches via Serper.dev
4. Sends all new items to Gemini for classification and filtering
5. Removes blog posts, news articles, completed projects, irrelevant content
6. Deduplicates against existing database
7. Saves to `data/opportunities.json`
8. Dashboard at your GitHub Pages URL updates automatically

---

## File structure

```
OpportunityRadar/
├── config/
│   └── sources.json          ← All feeds, sites, search queries (EDIT THIS)
├── collector/
│   ├── rss.js                ← Fetches RSS + Google Alerts feeds
│   ├── search.js             ← Runs web searches via Serper.dev
│   ├── scrape.js             ← Scrapes sites without RSS
│   ├── gemini.js             ← Classifies + filters via Gemini AI
│   └── dedupe.js             ← Deduplicates against existing data
├── data/
│   └── opportunities.json    ← The database (auto-updated by Actions)
├── dashboard/
│   ├── index.html            ← Dashboard UI
│   ├── app.js                ← Table, filters, search, export
│   └── styles.css            ← Styling
├── .github/
│   └── workflows/
│       └── daily-update.yml  ← Scheduled GitHub Action
├── run.js                    ← Main entry point (called by Action)
├── package.json
└── README.md
```

---

## Setup (one-time, ~15 minutes)

### 1. Create a GitHub repository

1. Go to github.com → New repository
2. Name it `opportunity-radar` (or anything you like)
3. Set to **Public** (required for free GitHub Pages)
4. Don't initialise with a README — you'll push this code

### 2. Get your API keys (both free)

**Gemini API key:**
- Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
- Click "Create API key"
- Copy it

**Serper.dev API key** (for web searches):
- Go to [serper.dev](https://serper.dev) → Sign up free
- Go to Dashboard → API Key
- Copy it (you get 2,500 free searches/month — plenty)

### 3. Add secrets to GitHub

In your repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret name      | Value               |
|-----------------|---------------------|
| `GEMINI_KEY`    | Your Gemini API key |
| `SERPER_KEY`    | Your Serper API key |

### 4. Push the code

Open VS Code terminal in the project folder:

```bash
git init
git remote add origin https://github.com/YOUR_USERNAME/opportunity-radar.git
git add .
git commit -m "Initial setup"
git push -u origin main
```

### 5. Enable GitHub Pages

Repo → Settings → Pages → Source: **GitHub Actions**

### 6. Run it once manually

Repo → Actions → "Daily Opportunity Update" → Run workflow

Your dashboard will be live at:
`https://YOUR_USERNAME.github.io/opportunity-radar/`

---

## Customising sources

Edit `config/sources.json`:
- **Add an RSS feed:** add an entry to `rss_feeds` array
- **Add a Google Alert:** add an entry to `google_alerts` array
- **Add a search query:** add a string to the relevant array in `search_queries`
- **Disable a source:** set `"active": false`
- **Rename Google Alerts:** change the `name` field (the URL doesn't change)

> **Tip:** To find out what each Google Alert watches, go to google.com/alerts — your alerts are listed there.

---

## Stages being built

- [x] Stage 1 — `config/sources.json` + README ← **you are here**
- [ ] Stage 2 — `collector/rss.js` + `collector/scrape.js`
- [ ] Stage 3 — `collector/search.js` (Serper.dev web searches)
- [ ] Stage 4 — `collector/gemini.js` + `collector/dedupe.js`
- [ ] Stage 5 — `run.js` + `package.json`
- [ ] Stage 6 — `dashboard/index.html` + `app.js` + `styles.css`
- [ ] Stage 7 — `.github/workflows/daily-update.yml`
