// collector/dismissed.js
// Loads data/dismissed.json — items the dashboard's "Delete" button has
// permanently dismissed via the GitHub API. The workflow excludes these
// from both the existing database (cleanup) and any newly-collected items
// (dedupe), so a permanently-deleted item never comes back.

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const DISMISSED_PATH = join(__dir, '../data/dismissed.json');

export function loadDismissedIds() {
  if (!existsSync(DISMISSED_PATH)) return new Set();
  try {
    const raw = JSON.parse(readFileSync(DISMISSED_PATH, 'utf8'));
    const ids = Array.isArray(raw) ? raw : (raw.ids || []);
    return new Set(ids);
  } catch {
    return new Set();
  }
}
