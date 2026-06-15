// app.js — Opportunity Radar Dashboard

const DATA_URL = './data/opportunities.json';
const COLS_KEY  = 'opr_cols';
const DEL_KEY   = 'opr_deleted';

let allOpps = [];
let meta    = {};
let activeFilter = 'all';
let deleted = new Set(JSON.parse(localStorage.getItem(DEL_KEY) || '[]'));
let selected = new Set();
let showHidden = false;
let sortDir = null; // null = default order, 'asc' = soonest first, 'desc' = latest first

// ── Category class name (CSS-safe) ────────────────────────
function catClass(c) {
  return 'cat-' + (c || 'Other').replace(/[^a-zA-Z]/g, '');
}

// ── Deadline date parsing (shared by formatter + sorter) ──
function parseDeadlineTs(dl) {
  if (!dl) return null;
  if (/rolling|ongoing|open/i.test(dl)) return null;
  let date = new Date(dl);
  if (isNaN(date)) {
    const m1 = dl.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
    if (m1) date = new Date(`${m1[2]} ${m1[1]} ${m1[3]}`);
    const m2 = dl.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (m2 && isNaN(date)) date = new Date(`${m2[1]} ${m2[2]} ${m2[3]}`);
  }
  return isNaN(date) ? null : date.getTime();
}

// ── Deadline formatter ────────────────────────────────────
function fmtDeadline(dl) {
  if (!dl) return '<span class="dl-done">—</span>';
  if (/rolling|ongoing|open/i.test(dl)) return '<span class="dl-done">Rolling</span>';
  const ts = parseDeadlineTs(dl);
  if (ts === null) return `<span class="dl-ok">${esc(dl)}</span>`;
  const d = Math.ceil((ts - Date.now()) / 86400000);
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

// ── Toast (temporary status message) ──────────────────────
let toastTimer = null;
function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = isError ? 'on err' : 'on';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 4000);
}

// ── Load data ────────────────────────────────────────────
async function loadData(isManual = false) {
  const btn = document.getElementById('btn-reload');
  const label = btn?.querySelector('.btn-label');

  if (isManual) {
    btn.disabled = true;
    if (label) label.textContent = 'Checking…';
    btn.classList.add('spinning');
  }

  const prevUpdated = meta.last_updated;
  const prevTotal   = allOpps.length;

  try {
    const r = await fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const db = await r.json();
    allOpps = Array.isArray(db) ? db : (db.opportunities || []);
    meta    = Array.isArray(db) ? {} : (db.meta || {});
    updateStatus();
    render();

    if (isManual) {
      if (meta.last_updated && meta.last_updated !== prevUpdated) {
        const diff = allOpps.length - prevTotal;
        showToast(`Updated — ${meta.new_today || diff || 0} new item${(meta.new_today || diff) === 1 ? '' : 's'}`);
      } else {
        showToast('Up to date — no changes since last check');
      }
    }
  } catch (e) {
    if (isManual) {
      showToast('Reload failed — check your connection', true);
    } else {
      document.getElementById('tbody').innerHTML = `
        <tr><td colspan="11"><div id="empty">
          <strong>Could not load opportunities.json</strong>
          This dashboard must be opened via GitHub Pages, not from your local file system.<br>
          Your GitHub Pages URL: <code>https://YOUR_USERNAME.github.io/opportunity-radar/</code><br><br>
          If you just set things up, run the GitHub Action once manually to populate the database.
        </div></td></tr>`;
    }
  } finally {
    if (isManual) {
      btn.disabled = false;
      btn.classList.remove('spinning');
      if (label) label.textContent = 'Reload';
    }
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
  selected.clear();
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('on'));
  if (btn) btn.classList.add('on');
  render();
}

// ── Search clear ───────────────────────────────────────────
function clearSearch() {
  const si = document.getElementById('si');
  si.value = '';
  si.focus();
  render();
}

// ── Sort ─────────────────────────────────────────────────
function toggleSort() {
  // cycle: null -> asc (soonest first) -> desc (latest first) -> null
  sortDir = sortDir === null ? 'asc' : sortDir === 'asc' ? 'desc' : null;
  const arrow = document.getElementById('sort-arrow');
  arrow.textContent = sortDir === 'asc' ? ' ▲' : sortDir === 'desc' ? ' ▼' : '';
  render();
}

function sortByDeadline(items) {
  if (!sortDir) return items;
  return [...items].sort((a, b) => {
    const va = parseDeadlineTs(a.deadline);
    const vb = parseDeadlineTs(b.deadline);
    // Items with no parseable deadline always sink to the bottom
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return sortDir === 'asc' ? va - vb : vb - va;
  });
}

// ── Hidden items toggle ────────────────────────────────────
function toggleShowHidden() {
  showHidden = !showHidden;
  selected.clear();
  render();
}

function restoreOne(id) {
  deleted.delete(id);
  localStorage.setItem(DEL_KEY, JSON.stringify([...deleted]));
  render();
}

function restoreAllHidden() {
  if (!deleted.size) return;
  if (!confirm(`Restore all ${deleted.size} hidden item(s)?`)) return;
  deleted.clear();
  localStorage.setItem(DEL_KEY, JSON.stringify([]));
  showHidden = false;
  render();
}

// ── Selection / bulk hide ──────────────────────────────────
function toggleSelect(id, checked) {
  if (checked) selected.add(id); else selected.delete(id);
  updateBulkUI();
}

function toggleSelectAll(checked) {
  const rows = document.querySelectorAll('#tbody tr[data-id]');
  rows.forEach(r => {
    const id = r.dataset.id;
    if (checked) selected.add(id); else selected.delete(id);
    const cb = r.querySelector('.row-check');
    if (cb) cb.checked = checked;
  });
  updateBulkUI();
}

function updateBulkUI() {
  const btn = document.getElementById('hide-selected');
  if (selected.size > 0) {
    btn.style.display = '';
    btn.textContent = showHidden
      ? `Restore selected (${selected.size})`
      : `Hide selected (${selected.size})`;
  } else {
    btn.style.display = 'none';
  }
  const selectAll = document.getElementById('select-all');
  const rows = document.querySelectorAll('#tbody tr[data-id]');
  if (selectAll && rows.length) {
    const allChecked = [...rows].every(r => selected.has(r.dataset.id));
    selectAll.checked = allChecked;
    selectAll.indeterminate = !allChecked && [...rows].some(r => selected.has(r.dataset.id));
  }
}

function hideSelected() {
  if (!selected.size) return;
  if (showHidden) {
    // In "showing hidden" mode, this button restores instead
    selected.forEach(id => deleted.delete(id));
  } else {
    selected.forEach(id => deleted.add(id));
  }
  localStorage.setItem(DEL_KEY, JSON.stringify([...deleted]));
  selected.clear();
  render();
}

// ── Main render ──────────────────────────────────────────
function render() {
  const tbody = document.getElementById('tbody');
  const q = (document.getElementById('si')?.value || '').toLowerCase().trim();

  document.getElementById('si-clear').classList.toggle('show', q.length > 0);

  let visible = allOpps.filter(o => {
    const isHidden = deleted.has(o.id);
    if (showHidden) {
      if (!isHidden) return false; // only show hidden items in this mode
    } else {
      if (isHidden) return false; // normal mode: hidden items excluded
      if (activeFilter === 'new'  && !o.is_new) return false;
      if (activeFilter === 'free' && !/^free$/i.test((o.fee || '').trim())) return false;
      if (!['all','new','free'].includes(activeFilter) && o.category !== activeFilter) return false;
    }
    if (q) {
      const t = `${o.title} ${o.description} ${o.source}`.toLowerCase();
      if (!t.includes(q)) return false;
    }
    return true;
  });

  visible = sortByDeadline(visible);

  // Count + hidden toggle
  document.getElementById('count').textContent = visible.length + (showHidden ? ' hidden item' + (visible.length === 1 ? '' : 's') : ' items');

  const hiddenBtn = document.getElementById('hidden-toggle');
  const restoreAllBtn = document.getElementById('restore-all');
  if (showHidden) {
    hiddenBtn.style.display = '';
    hiddenBtn.textContent = '← Back to list';
    restoreAllBtn.style.display = deleted.size > 0 ? '' : 'none';
  } else {
    restoreAllBtn.style.display = 'none';
    if (deleted.size > 0) {
      hiddenBtn.style.display = '';
      hiddenBtn.textContent = `${deleted.size} hidden — show`;
    } else {
      hiddenBtn.style.display = 'none';
    }
  }

  if (!visible.length) {
    const msg = showHidden
      ? { strong: 'No hidden items', sub: 'Nothing to restore.' }
      : allOpps.length === 0
        ? { strong: 'No opportunities yet', sub: 'Run the GitHub Action once to populate the database, then refresh this page.' }
        : { strong: 'No matches', sub: 'Try a different filter or clear the search box.' };
    tbody.innerHTML = `<tr><td colspan="11"><div id="empty"><strong>${msg.strong}</strong>${msg.sub}</div></td></tr>`;
    updateBulkUI();
    return;
  }

  tbody.innerHTML = visible.map(o => `
    <tr data-id="${esc(o.id)}">
      <td class="ccheck"><input type="checkbox" class="row-check" ${selected.has(o.id) ? 'checked' : ''} onchange="toggleSelect('${esc(o.id)}', this.checked)"></td>
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
      <td class="cdel">${showHidden
        ? `<button class="delbtn restorebtn" onclick="restoreOne('${esc(o.id)}')" title="Restore this item">↺</button>`
        : `<button class="delbtn" onclick="hide('${esc(o.id)}')" title="Hide this item">✕</button>`}</td>
    </tr>`).join('');

  loadColWidths();
  updateBulkUI();
}

function patchPrize(id, val) {
  const opp = allOpps.find(o => o.id === id);
  if (opp) opp.prize = val;
}

function hide(id) {
  deleted.add(id);
  localStorage.setItem(DEL_KEY, JSON.stringify([...deleted]));
  selected.delete(id);
  render();
}

// ── Column resize ────────────────────────────────────────
function initColResize() {
  document.querySelectorAll('th[data-col]').forEach(th => {
    const h = document.createElement('div');
    h.className = 'rz';
    th.appendChild(h);
    let drag = false, sx = 0, sw = 0;
    h.addEventListener('mousedown', e => { drag = true; sx = e.clientX; sw = th.getBoundingClientRect().width; h.classList.add('act'); e.preventDefault(); e.stopPropagation(); });
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
window.restoreOne = restoreOne;
window.restoreAllHidden = restoreAllHidden;
window.patchPrize = patchPrize;
window.exportCSV = exportCSV;
window.loadData = loadData;
window.clearSearch = clearSearch;
window.toggleSort = toggleSort;
window.toggleShowHidden = toggleShowHidden;
window.toggleSelect = toggleSelect;
window.toggleSelectAll = toggleSelectAll;
window.hideSelected = hideSelected;

document.addEventListener('DOMContentLoaded', () => {
  initColResize();
  loadData();
});
