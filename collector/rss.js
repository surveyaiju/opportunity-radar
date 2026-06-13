// collector/rss.js
// Fetches RSS 2.0 feeds and Atom feeds (Google Alerts use Atom)
// Returns raw items before deduplication or AI classification

import { XMLParser } from 'fast-xml-parser';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(readFileSync(join(__dir, '../config/sources.json'), 'utf8'));

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  allowBooleanAttributes: true,
});

function stripHtml(s) {
  return (s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url) {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'OpportunityRadar/1.0 (architecture opportunity aggregator)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

function parseAtom(feed, sourceName) {
  // Google Alerts and some others use Atom
  const today = new Date().toISOString().split('T')[0];
  const raw = feed.entry || [];
  const entries = Array.isArray(raw) ? raw : [raw];
  return entries.map(e => {
    const link = e.link?.['@_href'] || (Array.isArray(e.link) ? e.link[0]?.['@_href'] : '') || '';
    const title = e.title?.['#text'] || e.title || '';
    const text = stripHtml(e.content?.['#text'] || e.content || e.summary?.['#text'] || e.summary || '');
    return {
      title: String(title).slice(0, 200),
      url: String(link),
      text: text.slice(0, 600),
      date: e.updated || e.published || today,
      source: sourceName,
      source_type: 'rss',
    };
  }).filter(e => e.title && e.url);
}

function parseRss(channel, sourceName) {
  const today = new Date().toISOString().split('T')[0];
  const raw = channel.item || [];
  const items = Array.isArray(raw) ? raw : [raw];
  return items.map(it => {
    const text = stripHtml(it['content:encoded'] || it.description || '');
    const guid = it.guid?.['#text'] || it.guid || '';
    return {
      title: String(it.title || '').slice(0, 200),
      url: String(it.link || guid),
      text: text.slice(0, 600),
      date: it.pubDate || today,
      source: sourceName,
      source_type: 'rss',
    };
  }).filter(e => e.title && e.url);
}

function parseXml(xmlText, sourceName) {
  try {
    const parsed = parser.parse(xmlText);
    if (parsed.feed) return parseAtom(parsed.feed, sourceName);
    if (parsed.rss?.channel) return parseRss(parsed.rss.channel, sourceName);
    if (parsed['rdf:RDF']?.item) return parseRss(parsed['rdf:RDF'], sourceName);
    return [];
  } catch {
    return [];
  }
}

export async function collectRss() {
  const allFeeds = [
    ...sources.rss_feeds.filter(f => f.active),
    ...sources.google_alerts.filter(f => f.active),
  ];

  console.log(`\n📡 RSS — checking ${allFeeds.length} feeds`);
  const results = [];

  for (const feed of allFeeds) {
    const xml = await fetchText(feed.url);
    if (!xml) {
      console.log(`  ✗ ${feed.name} — failed`);
      continue;
    }
    const items = parseXml(xml, feed.name);
    if (!items.length) {
      console.log(`  ○ ${feed.name} — empty`);
      continue;
    }
    console.log(`  ✓ ${feed.name} — ${items.length} items`);
    results.push(...items);
  }

  console.log(`  Total from RSS: ${results.length} raw items`);
  return results;
}
