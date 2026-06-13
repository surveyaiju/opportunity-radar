// app.js — Opportunity Radar Dashboard

const DATA_URL = './data/opportunities.json';
const COLS_KEY  = 'opr_cols';
const DEL_KEY   = 'opr_deleted';

let allOpps = [];
let meta    = {};
let activeFilter = 'all';
let deleted = new Set(JSON.parse(localStorage.getItem(DEL_KEY) || '[]'));

// ── Category class name (CSS-safe) ────────────────────────
function catClass(c) {
  return 'cat-' + (c || 'Other').replace(/[^a-zA-Z]/g, '');
}

// ── Deadline formatter ────────────────────────────────────
function fmtDeadline(dl) {
  if (!dl) return '<span class="dl-done">—</span>';
  if (/rolling|ongoing|open/i.test(dl)) return '<span class="dl-done">Rolling</span>';
  let date = new Date(dl);
  if (isNaN(date)) {
    const m1 = dl.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
    if (m1) date = new Date(`${m1[2]} ${m1[1]} ${m1[3]}`);
    const m2 = dl.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (m2 && isNaN(date)) date = new Date(`${m2[1]} ${m2[2]} ${m2[3]}`);
  }
  if (isNaN(date)) return `<span class="dl-ok">${esc(dl)}</span>`;
  const d = Math.ceil((date - new Date()) / 86400000);
  if (d < 0)  return `<span class="dl-done" title="${esc(dl)}">Expired</span>`;
  if (d === 0) return `<span class="dl-urg"  title="${esc(dl)}">Today!</span>`;
  if (d <= 7)  return `<span class="dl-urg"  title="${esc(dl)}">${d}d ⚠</span>`;
  if (d <= 30) return `<span class="dl-soon" title="${esc(dl)}">${d}d</span>`;
  return `<span class="dl-ok" title="${esc(dl)}">${d}d</span>`;
}

function fmtFee(f) {
  if (!f || f === 'Unknown') return '<span class="fee-unk">?</span>';
  if (/^free$/i.test(f.trim())) return '<span class="fee-free">Free</span>';
  return `<span class="fee-cost">${esc(f)}</span>`;
}

function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
  catch { return d; }
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Load data ────────────────────────────────────────────
async function loadData() {
  try {
    const r = await fetch(DATA_URL + '?t=' + Date.now());
    if (!r.ok) throw new Error(r.status);
    const db = await r.json();
    allOpps = Array.isArray(db) ? db : (db.opportunities || []);
    meta    = Array.isArray(db) ? {} : (db.meta || {});
    updateStatus();
    render();
  } catch (e) {
    document.getElementById('tbody').innerHTML = `
      <tr><td colspan="10"><div id="empty">
        <strong>Could not load opportunities.json</strong>
        This dashboard must be opened via GitHub Pages, not from your local file system.<br>
        Your GitHub Pages URL: <code>https://YOUR_USERNAME.github.io/opportunity-radar/</code><br><br>
        If you just set things up, run the GitHub Action once manually to populate the database.
      </div></td></tr>`;
  }
}

function updateStatus() {
  const el = document.getElementById('hdr-status');
  if (!el) return;
  const parts = [];
  if (meta.last_updated) parts.push(`Updated ${new Date(meta.last_updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`);
  if (meta.new_today > 0) parts.push(`${meta.new_today} new today`);
  el.textContent = parts.join(' · ');
}

// ── Filter ───────────────────────────────────────────────
function setFilter(f, btn) {
  activeFilter = f;
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('on'));
  if (btn) btn.classList.add('on');
  render();
}

function render() {
  const tbody = document.getElementById('tbody');
  const q = (document.getElementById('si')?.value || '').toLowerCase().trim();

  const visible = allOpps.filter(o => {
    if (deleted.has(o.id)) return false;
    if (activeFilter === 'new'  && !o.is_new) return false;
    if (activeFilter === 'free' && !/^free$/i.test((o.fee || '').trim())) return false;
    if (!['all','new','free'].includes(activeFilter) && o.category !== activeFilter) return false;
    if (q) {
      const t = `${o.title} ${o.description} ${o.source}`.toLowerCase();
      if (!t.includes(q)) return false;
    }
    return true;
  });

  document.getElementById('count').textContent = visible.length + ' items';

  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="10"><div id="empty">
      <strong>${allOpps.length === 0 ? 'No opportunities yet' : 'No matches'}</strong>
      ${allOpps.length === 0
        ? 'Run the GitHub Action once to populate the database, then refresh this page.'
        : 'Try a different filter or clear the search box.'}
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = visible.map(o => `
    <tr data-id="${esc(o.id)}">
      <td class="cn">${o.is_new ? '<span class="b-new">New</span>' : ''}</td>
      <td class="cdate" style="color:var(--text3);font-size:11px">${esc(fmtDate(o.found_date))}</td>
      <td class="ctit">${o.url
        ? `<a href="${esc(o.url)}" target="_blank" rel="noopener" class="ct">${esc(o.title)}</a>`
        : `<span class="ct">${esc(o.title)}</span>`}</td>
      <td class="csrc"><span class="csrct">${esc(o.source)}</span></td>
      <td class="cdesc"><div class="desct" title="${esc(o.description || '')}">${esc(o.description || o.title)}</div></td>
      <td class="ccat">${o.category
        ? `<span class="cat ${catClass(o.category)}">${esc(o.category)}</span>`
        : '<span style="color:var(--text3)">—</span>'}</td>
      <td class="cdead">${fmtDeadline(o.deadline)}</td>
      <td class="cfee">${fmtFee(o.fee)}</td>
      <td class="cpriz"><input class="ii" value="${esc(o.prize || '')}" placeholder="—"
        onchange="patchPrize('${esc(o.id)}', this.value)"></td>
      <td class="cdel"><button class="delbtn" onclick="hide('${esc(o.id)}')" title="Hide this item">✕</button></td>
    </tr>`).join('');

  loadColWidths();
}

function patchPrize(id, val) {
  const opp = allOpps.find(o => o.id === id);
  if (opp) opp.prize = val;
}

function hide(id) {
  deleted.add(id);
  localStorage.setItem(DEL_KEY, JSON.stringify([...deleted]));
  render();
}

// ── Column resize ────────────────────────────────────────
function initColResize() {
  document.querySelectorAll('th[data-col]').forEach(th => {
    const h = document.createElement('div');
    h.className = 'rz';
    th.appendChild(h);
    let drag = false, sx = 0, sw = 0;
    h.addEventListener('mousedown', e => { drag = true; sx = e.clientX; sw = th.getBoundingClientRect().width; h.classList.add('act'); e.preventDefault(); });
    document.addEventListener('mousemove', e => { if (!drag) return; const w = Math.max(40, sw + (e.clientX - sx)); th.style.width = w + 'px'; th.style.minWidth = w + 'px'; });
    document.addEventListener('mouseup', () => { if (!drag) return; drag = false; h.classList.remove('act'); saveColWidths(); });
  });
}
function saveColWidths() {
  const w = {};
  document.querySelectorAll('th[data-col]').forEach(th => { w[th.dataset.col] = Math.round(th.getBoundingClientRect().width); });
  localStorage.setItem(COLS_KEY, JSON.stringify(w));
}
function loadColWidths() {
  const w = JSON.parse(localStorage.getItem(COLS_KEY) || '{}');
  Object.entries(w).forEach(([col, px]) => {
    const th = document.querySelector(`th[data-col="${col}"]`);
    if (th) { th.style.width = px + 'px'; th.style.minWidth = px + 'px'; }
  });
}

// ── Export ────────────────────────────────────────────────
function exportCSV() {
  const hh = ['Date Found','Title','Source','Description','Category','Deadline','Fee','Prize','URL'];
  const rows = allOpps
    .filter(o => !deleted.has(o.id))
    .map(o => [o.found_date||'', o.title, o.source, o.description||'', o.category||'', o.deadline||'', o.fee||'', o.prize||'', o.url||'']
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const b = new Blob([[hh.join(','), ...rows].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = `OpportunityRadar_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// ── Init ──────────────────────────────────────────────────
window.setFilter = setFilter;
window.hide = hide;
window.patchPrize = patchPrize;
window.exportCSV = exportCSV;

document.addEventListener('DOMContentLoaded', () => {
  initColResize();
  loadData();
});
