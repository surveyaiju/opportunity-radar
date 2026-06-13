// ─────────────────────────────────────────────────────────────────────
// Opportunity Radar — Dashboard JS
// Reads from data/opportunities.json (committed daily by GitHub Actions)
// ─────────────────────────────────────────────────────────────────────

const DATA_URL  = './data/opportunities.json';
const COLS_KEY  = 'opr_cols';
const FEEDS_KEY = 'opr_feeds';

let DB          = { opportunities: [], last_updated: '', total: 0 };
let activeFilter = 'All';
let searchQuery  = '';

// Default extra RSS feeds the user can manage in settings
// (collector/rss.js has its own list baked in — these are dashboard-only additions)
let extraFeeds = JSON.parse(localStorage.getItem(FEEDS_KEY) || '[]');

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function catClass(c) {
  const m = {
    'Competition':        'cat-Competition',
    'Grant':              'cat-Grant',
    'Fellowship':         'cat-Fellowship',
    'Residency':          'cat-Residency',
    'Journal/CFP':        'cat-JournalCFP',
    'Award':              'cat-Award',
    'Exhibition/Biennale':'cat-ExhibitionBiennale',
    'Public Art/RFQ':     'cat-PublicArtRFQ',
    'Conference':         'cat-Conference',
  };
  return m[c] || 'cat-Other';
}

function daysLeft(dateStr) {
  if (!dateStr || /rolling|ongoing|tbd/i.test(dateStr)) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return Math.ceil((d - new Date()) / 86400000);
}

function fmtDeadline(dl) {
  if (!dl) return '<span class="dead-roll">—</span>';
  if (/rolling|ongoing|tbd/i.test(dl)) return '<span class="dead-roll">Rolling</span>';
  const n = daysLeft(dl);
  if (n === null) return `<span class="dead-ok">${esc(dl)}</span>`;
  if (n < 0)  return `<span class="dead-expired">Expired</span>`;
  if (n <= 7) return `<span class="dead-urgent" title="${esc(dl)}">${n}d left</span>`;
  if (n <= 30)return `<span class="dead-soon"   title="${esc(dl)}">${n}d</span>`;
  return `<span class="dead-ok" title="${esc(dl)}">${n}d</span>`;
}

function fmtFee(f) {
  if (!f || f === 'Unknown') return '<span class="fee-unk">?</span>';
  if (/^free$/i.test(f))     return '<span class="fee-free">Free</span>';
  return `<span class="fee-cost">${esc(f)}</span>`;
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
}

// ─────────────────────────────────────────────────────────────────────
// Load data
// ─────────────────────────────────────────────────────────────────────
async function loadData() {
  try {
    const res = await fetch(DATA_URL + '?t=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    DB = await res.json();
  } catch (e) {
    console.warn('Could not load opportunities.json:', e.message);
    DB = { opportunities: [], last_updated: '', total: 0 };
  }
  updateMeta();
  renderStats();
  renderTable();
}

function updateMeta() {
  const el = document.getElementById('hdr-meta');
  if (!el) return;
  if (DB.last_updated) {
    const d = new Date(DB.last_updated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    el.textContent = 'Updated ' + d + ' · ' + (DB.total || DB.opportunities.length) + ' total';
  } else {
    el.textContent = 'No data yet — run the collector';
  }
}

// ─────────────────────────────────────────────────────────────────────
// Stats bar
// ─────────────────────────────────────────────────────────────────────
function renderStats() {
  const opps = DB.opportunities || [];
  const today = new Date().toISOString().slice(0, 10);

  const newToday  = opps.filter(o => o.found_date === today).length;
  const freeCount = opps.filter(o => /^free$/i.test(o.fee)).length;
  const urgent    = opps.filter(o => { const d = daysLeft(o.deadline); return d !== null && d >= 0 && d <= 7; }).length;
  const closing   = opps.filter(o => { const d = daysLeft(o.deadline); return d !== null && d >= 0 && d <= 30; }).length;

  document.getElementById('stat-new').textContent    = newToday;
  document.getElementById('stat-free').textContent   = freeCount;
  document.getElementById('stat-urgent').textContent = urgent;
  document.getElementById('stat-closing').textContent= closing;
}

// ─────────────────────────────────────────────────────────────────────
// Filter
// ─────────────────────────────────────────────────────────────────────
function setFilter(f, btn) {
  activeFilter = f;
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('on'));
  if (btn) btn.classList.add('on');
  renderTable();
}
window.setFilter = setFilter;

function getFiltered() {
  const q = searchQuery.toLowerCase().trim();
  const today = new Date().toISOString().slice(0, 10);

  return (DB.opportunities || []).filter(o => {
    // Search filter
    if (q) {
      const hay = [o.title, o.organization, o.source, o.description, o.category].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    // Category / special filter
    if (activeFilter === 'All')     return true;
    if (activeFilter === 'New')     return o.is_new || o.found_date === today;
    if (activeFilter === 'Free')    return /^free$/i.test(o.fee);
    if (activeFilter === 'Closing') { const d = daysLeft(o.deadline); return d !== null && d >= 0 && d <= 30; }
    return o.category === activeFilter;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Table render
// ─────────────────────────────────────────────────────────────────────
function renderTable() {
  const tbody   = document.getElementById('tbody');
  const visible = getFiltered();

  document.getElementById('count-lbl').textContent = visible.length + ' items';

  if (!visible.length) {
    const msg = !DB.opportunities.length
      ? '<strong>No data yet.</strong><br>The GitHub Action hasn\'t run yet, or run <code>npm run collect</code> locally first.'
      : '<strong>No matches.</strong><br>Try a different filter or clear the search.';
    tbody.innerHTML = `<tr><td colspan="11"><div id="empty">${msg}</div></td></tr>`;
    return;
  }

  tbody.innerHTML = visible.map(o => {
    const catCls = catClass(o.category);
    const catLabel = o.category || '—';
    return `<tr data-id="${esc(o.id)}">
      <td class="cn">${o.is_new ? '<span class="badge-new">New</span>' : ''}</td>
      <td class="cdate"><span class="cell-sm">${esc(fmtDate(o.found_date))}</span></td>
      <td class="ctitle">${o.url
        ? `<a href="${esc(o.url)}" target="_blank" rel="noopener" class="title-link">${esc(o.title)}</a>`
        : `<span class="title-link">${esc(o.title)}</span>`}</td>
      <td class="corg"><span class="cell-sm">${esc(o.organization || '—')}</span></td>
      <td class="csrc"><span class="cell-sm">${esc(o.source)}</span></td>
      <td class="cdesc"><div class="cell-desc" title="${esc(o.description || o.snippet || '')}">${esc(o.description || o.snippet?.slice(0,150) || '—')}</div></td>
      <td class="ccat">${o.category
        ? `<span class="cat ${catCls}">${esc(catLabel)}</span>`
        : '<span style="color:var(--text3);font-size:11px">—</span>'}</td>
      <td class="cdead">${fmtDeadline(o.deadline)}</td>
      <td class="cfee">${fmtFee(o.fee)}</td>
      <td class="cprize"><input class="iinput" value="${esc(o.prize || '')}" placeholder="—" onchange="patchPrize('${esc(o.id)}', this.value)"></td>
      <td class="cdel"><button class="del-btn" onclick="hideItem('${esc(o.id)}')" title="Hide">✕</button></td>
    </tr>`;
  }).join('');

  applyColWidths();
}

// Editable prize field — saves to localStorage as override
const OVERRIDES_KEY = 'opr_overrides';
function getOverrides() { return JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}'); }
function saveOverrides(obj) { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(obj)); }

window.patchPrize = function(id, val) {
  const ov = getOverrides();
  ov[id] = ov[id] || {};
  ov[id].prize = val;
  saveOverrides(ov);
  const opp = (DB.opportunities || []).find(o => o.id === id);
  if (opp) opp.prize = val;
};

// Hide an item (stored in localStorage so it survives reloads)
const HIDDEN_KEY = 'opr_hidden';
function getHidden() { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')); }

window.hideItem = function(id) {
  const hidden = getHidden();
  hidden.add(id);
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  DB.opportunities = DB.opportunities.filter(o => o.id !== id);
  renderStats();
  renderTable();
};

// ─────────────────────────────────────────────────────────────────────
// Column resize
// ─────────────────────────────────────────────────────────────────────
function initColResize() {
  document.querySelectorAll('th[data-col]').forEach(th => {
    const handle = document.createElement('div');
    handle.className = 'rz';
    th.appendChild(handle);

    let dragging = false, startX = 0, startW = 0;

    handle.addEventListener('mousedown', e => {
      dragging = true;
      startX = e.clientX;
      startW = th.getBoundingClientRect().width;
      handle.classList.add('on');
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const w = Math.max(50, startW + (e.clientX - startX));
      th.style.width = w + 'px';
      th.style.minWidth = w + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('on');
      saveColWidths();
    });
  });
}

function saveColWidths() {
  const w = {};
  document.querySelectorAll('th[data-col]').forEach(th => {
    w[th.dataset.col] = Math.round(th.getBoundingClientRect().width);
  });
  localStorage.setItem(COLS_KEY, JSON.stringify(w));
}

function applyColWidths() {
  const w = JSON.parse(localStorage.getItem(COLS_KEY) || '{}');
  Object.entries(w).forEach(([col, px]) => {
    const th = document.querySelector(`th[data-col="${col}"]`);
    if (th) { th.style.width = px + 'px'; th.style.minWidth = px + 'px'; }
  });
}

// ─────────────────────────────────────────────────────────────────────
// Export CSV
// ─────────────────────────────────────────────────────────────────────
window.exportCSV = function() {
  const headers = ['Date Found','Title','Organization','Source','Category','Deadline','Fee','Prize','Description','URL'];
  const rows = getFiltered().map(o => [
    o.found_date || '', o.title, o.organization || '', o.source,
    o.category || '', o.deadline || '', o.fee || '', o.prize || '',
    o.description || '', o.url || ''
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `OpportunityRadar_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
};

// ─────────────────────────────────────────────────────────────────────
// Settings panel
// ─────────────────────────────────────────────────────────────────────
window.toggleSettings = function() {
  const p = document.getElementById('settings');
  p.classList.toggle('on');
  if (p.classList.contains('on')) renderSettings();
};

function renderSettings() {
  const list = document.getElementById('feed-list');
  if (!extraFeeds.length) {
    list.innerHTML = '<p style="font-size:11px;color:var(--text3)">No extra feeds added yet.</p>';
    return;
  }
  list.innerHTML = extraFeeds.map((f, i) => `
    <div class="feed-row">
      <div class="feed-info">
        <div class="feed-name">${esc(f.name)}</div>
        <div class="feed-url">${esc(f.url)}</div>
      </div>
      <button class="del-btn" onclick="removeFeed(${i})" title="Remove">✕</button>
    </div>`).join('');
}

window.removeFeed = function(i) {
  extraFeeds.splice(i, 1);
  localStorage.setItem(FEEDS_KEY, JSON.stringify(extraFeeds));
  renderSettings();
};

window.addFeed = function() {
  const name = document.getElementById('nf-name').value.trim();
  const url  = document.getElementById('nf-url').value.trim();
  if (!url) return;
  extraFeeds.push({ name: name || url, url });
  localStorage.setItem(FEEDS_KEY, JSON.stringify(extraFeeds));
  document.getElementById('nf-name').value = '';
  document.getElementById('nf-url').value  = '';
  renderSettings();
};

window.clearHidden = function() {
  localStorage.removeItem(HIDDEN_KEY);
  loadData();
};

// ─────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('search-box').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderTable();
  });

  initColResize();
  loadData();
});
