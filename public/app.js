/**
 * app.js — Skill Dashboard client
 * Pure vanilla JS, zero dependencies.
 *
 * Architecture:
 *   state        — single source of truth (search, filters, selectedId, favorites)
 *   applyFilters — derives state.filtered from state.all + filters, then renders
 *   renderXxx    — pure render functions, read from state, write DOM
 *   URL hash     — #q=search&col=gstack,pua&type=skill&tag=design
 *
 * Extension points:
 *   - Add new filter types: push to FILTER_KEYS and handle in applyFilters()
 *   - Add new card fields: extend renderCards() card template
 *   - Add new drawer actions: extend openDrawer() drawerActs block
 */

'use strict';

// ── Mini Markdown renderer ───────────────────────────────────────────────────
// Handles the common subset needed for SKILL.md / agent docs.

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(text) {
  text = esc(text);
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return text;
}

function renderMd(raw) {
  const lines   = raw.split('\n');
  let html      = '';
  let inFence   = false;
  let fenceLines = [];
  let fenceLang  = '';
  let inTable    = false;
  let listType   = null; // 'ul' | 'ol' | null

  function closeList() {
    if (listType) { html += `</${listType}>\n`; listType = null; }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── Fenced code block
    if (/^```/.test(line)) {
      if (!inFence) {
        closeList();
        if (inTable) { html += '</tbody></table>\n'; inTable = false; }
        inFence   = true;
        fenceLang = line.slice(3).trim();
        fenceLines = [];
      } else {
        inFence = false;
        const code = fenceLines.join('\n')
          .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        html += `<pre><code class="lang-${esc(fenceLang)}">${code}</code></pre>\n`;
      }
      continue;
    }
    if (inFence) { fenceLines.push(line); continue; }

    // ── HR
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      closeList();
      if (inTable) { html += '</tbody></table>\n'; inTable = false; }
      html += '<hr>\n'; continue;
    }

    // ── Table rows
    if (/^\|/.test(line)) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      // Separator row
      if (cells.every(c => /^:?-+:?$/.test(c))) {
        html += '</thead><tbody>\n'; continue;
      }
      if (!inTable) {
        closeList();
        inTable = true;
        html += '<table><thead><tr>';
        cells.forEach(c => { html += `<th>${inline(c)}</th>`; });
        html += '</tr>\n';
      } else {
        html += '<tr>';
        cells.forEach(c => { html += `<td>${inline(c)}</td>`; });
        html += '</tr>\n';
      }
      continue;
    }
    if (inTable) { html += '</tbody></table>\n'; inTable = false; }

    // ── Heading
    const hm = line.match(/^(#{1,4})\s+(.+)$/);
    if (hm) {
      closeList();
      const lvl = hm[1].length;
      html += `<h${lvl}>${inline(hm[2])}</h${lvl}>\n`;
      continue;
    }

    // ── Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; }
      html += `<li>${inline(line.replace(/^\s*[-*+]\s+/, ''))}</li>\n`;
      continue;
    }

    // ── Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; }
      html += `<li>${inline(line.replace(/^\s*\d+\.\s+/, ''))}</li>\n`;
      continue;
    }

    // ── Empty line
    if (!line.trim()) { closeList(); html += '\n'; continue; }

    // ── Paragraph
    closeList();
    html += `<p>${inline(line)}</p>\n`;
  }

  if (inFence) {
    const code = fenceLines.join('\n').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    html += `<pre><code>${code}</code></pre>\n`;
  }
  if (inTable) html += '</tbody></table>\n';
  closeList();
  return html;
}

// ── Constants ────────────────────────────────────────────────────────────────

const TYPE_LABEL = { skill: 'SKILL', agent: 'AGENT', 'design-doc': 'DESIGN' };
const TYPE_CLASS = { skill: 'badge-skill', agent: 'badge-agent', 'design-doc': 'badge-design' };
const FAV_KEY    = 'skill-dashboard-favs';

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  all:       [],        // full SkillEntry[]
  filtered:  [],        // after filters
  search:    '',
  hiddenCols:new Set(), // collections to HIDE
  hiddenTypes:new Set(),// types to HIDE
  activeTag: '',        // tag filter (single tag from cloud)
  favOnly:   false,     // show only favorites
  selectedId:null,      // open drawer entry id
  favorites: loadFavs(),// Set<id>
  colors:    {},        // id → color, populated from index
};

// ── Favorites persistence ────────────────────────────────────────────────────

function loadFavs() {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); }
  catch { return new Set(); }
}

function saveFavs() {
  localStorage.setItem(FAV_KEY, JSON.stringify([...state.favorites]));
}

function toggleFav(id) {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  saveFavs();
}

// ── URL hash state sync ──────────────────────────────────────────────────────
// Format: #q=search&col=gstack,pua&type=skill&tag=design
// Only non-default values are written to keep URLs clean.

function hashToState() {
  const params = new URLSearchParams(location.hash.slice(1));
  state.search     = params.get('q')    || '';
  state.activeTag  = params.get('tag')  || '';
  state.favOnly    = params.get('fav')  === '1';

  const colStr  = params.get('col')  || '';
  const typeStr = params.get('type') || '';
  state.hiddenCols  = colStr  ? new Set(colStr.split(','))  : new Set();
  state.hiddenTypes = typeStr ? new Set(typeStr.split(','))  : new Set();
}

function stateToHash() {
  const p = new URLSearchParams();
  if (state.search)    p.set('q',    state.search);
  if (state.activeTag) p.set('tag',  state.activeTag);
  if (state.favOnly)   p.set('fav',  '1');
  if (state.hiddenCols.size)  p.set('col',  [...state.hiddenCols].join(','));
  if (state.hiddenTypes.size) p.set('type', [...state.hiddenTypes].join(','));
  const s = p.toString();
  history.replaceState(null, '', s ? '#' + s : location.pathname);
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  hashToState();
  window.addEventListener('hashchange', () => { hashToState(); renderAll(); });

  try {
    const res  = await fetch('/api/index');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    state.all  = json.entries || [];

    // Build color map from index (server embeds collection colors via scan-config)
    // Fallback: derive from COLLECTION_COLORS map below
    state.colors = json.collectionColors || {};

    $('stats').textContent = `${state.all.length} entries · scanned ${
      new Date(json.scannedAt).toLocaleString('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
    }`;

    $('loading').style.display = 'none';
    buildSidebar();
    applyFilters();
    syncSearchInput();
  } catch (e) {
    $('loading').textContent = `Failed to load index: ${e.message}. Is the server running on port 10010?`;
  }
}

// ── Collection colors ────────────────────────────────────────────────────────
// Matches scan-config.json. Kept here so the UI works even if server changes.
const COLORS = {
  'gstack':           '#6366f1',
  'pua':              '#ec4899',
  'ui-ux-pro-max':    '#f59e0b',
  'agency-agents':    '#22c55e',
  'awesome-design':   '#ef4444',
  'harness':          '#06b6d4',
  'tong-jincheng':    '#a855f7',
  'claude-code-guide':'#64748b',
  'edict':            '#f97316',
};
function colColor(id) { return state.colors[id] || COLORS[id] || '#64748b'; }

// ── Sidebar ───────────────────────────────────────────────────────────────────
// Design: collection filter is the "root" dimension.
// Changing collections re-renders type + tag sections to reflect available items.
// Each section has a "全选" button.

/** One-time build of the whole sidebar on init. */
function buildSidebar() {
  buildCollectionFilter();
  // type and tag are rendered reactively in applyFilters()
}

/**
 * Build the collection filter section (stable, never re-rendered after init).
 * Counts show totals across ALL entries, independent of other filters.
 */
function buildCollectionFilter() {
  const sec = $('section-collections');

  const counts = {};
  for (const e of state.all) counts[e.collection] = (counts[e.collection] || 0) + 1;
  const allCols = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  const allColsSelected = state.hiddenCols.size === 0;
  sec.innerHTML = `
    <div class="sb-label-row">
      <span class="sb-label">Collections</span>
      <button class="sb-selectall" id="btn-col-all" title="${allColsSelected ? '取消全选' : '全选'}">${allColsSelected ? '取消全选' : '全选'}</button>
    </div>
    <div class="filter-rows" id="col-rows">
      ${allCols.map(([col, n]) => {
        const checked = !state.hiddenCols.has(col);
        return `<label class="filter-row" title="${esc(col)}">
          <input type="checkbox" data-col="${esc(col)}" ${checked ? 'checked' : ''}>
          <span class="col-dot" style="background:${colColor(col)}"></span>
          <span class="fr-label">${esc(col)}</span>
          <span class="fr-count">${n}</span>
        </label>`;
      }).join('')}
    </div>`;

  const btnColAll = sec.querySelector('#btn-col-all');

  const updateColAllBtn = () => {
    const isAll = state.hiddenCols.size === 0;
    btnColAll.textContent = isAll ? '取消全选' : '全选';
    btnColAll.title       = isAll ? '取消全选' : '全选';
  };

  btnColAll.addEventListener('click', () => {
    if (state.hiddenCols.size === 0) {
      // 已全选 → 取消全选
      sec.querySelectorAll('input[data-col]').forEach(cb => {
        state.hiddenCols.add(cb.dataset.col);
        cb.checked = false;
      });
    } else {
      // 未全选 → 全选
      state.hiddenCols.clear();
      sec.querySelectorAll('input[data-col]').forEach(cb => { cb.checked = true; });
    }
    updateColAllBtn();
    stateToHash();
    applyFilters();
  });

  sec.querySelectorAll('input[data-col]').forEach(cb => {
    cb.addEventListener('change', () => {
      const col = cb.dataset.col;
      if (cb.checked) state.hiddenCols.delete(col);
      else            state.hiddenCols.add(col);
      updateColAllBtn();
      stateToHash();
      applyFilters();
    });
  });
}

/**
 * Re-render the type filter section based on currently collection-visible entries.
 * Called every time collection filter or types change.
 * @param {object[]} colVisible - entries passing the collection filter
 */
function renderTypeFilter(colVisible) {
  const sec = $('section-types');
  const TYPE_LABELS = { skill: '🔧 Skill', agent: '🤖 Agent', 'design-doc': '🎨 Design' };

  const counts = {};
  for (const e of colVisible) counts[e.type] = (counts[e.type] || 0) + 1;
  const types = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  if (!types.length) {
    sec.innerHTML = `<div class="sb-label-row"><span class="sb-label">Type</span></div>
      <div class="filter-rows"><span class="sb-empty">暂无</span></div>`;
    return;
  }

  const allTypesSelected = state.hiddenTypes.size === 0;
  sec.innerHTML = `
    <div class="sb-label-row">
      <span class="sb-label">Type</span>
      <button class="sb-selectall" id="btn-type-all" title="${allTypesSelected ? '取消全选' : '全选'}">${allTypesSelected ? '取消全选' : '全选'}</button>
    </div>
    <div class="filter-rows">
      ${types.map(([type, n]) => {
        const checked = !state.hiddenTypes.has(type);
        return `<label class="filter-row">
          <input type="checkbox" data-type="${esc(type)}" ${checked ? 'checked' : ''}>
          <span class="fr-label">${TYPE_LABELS[type] || esc(type)}</span>
          <span class="fr-count">${n}</span>
        </label>`;
      }).join('')}
    </div>`;

  const btnTypeAll = sec.querySelector('#btn-type-all');

  const updateTypeAllBtn = () => {
    const isAll = state.hiddenTypes.size === 0;
    btnTypeAll.textContent = isAll ? '取消全选' : '全选';
    btnTypeAll.title       = isAll ? '取消全选' : '全选';
  };

  btnTypeAll.addEventListener('click', () => {
    if (state.hiddenTypes.size === 0) {
      // 已全选 → 取消全选
      sec.querySelectorAll('input[data-type]').forEach(cb => {
        state.hiddenTypes.add(cb.dataset.type);
        cb.checked = false;
      });
    } else {
      // 未全选 → 全选
      state.hiddenTypes.clear();
      sec.querySelectorAll('input[data-type]').forEach(cb => { cb.checked = true; });
    }
    updateTypeAllBtn();
    stateToHash();
    applyFilters();
  });

  sec.querySelectorAll('input[data-type]').forEach(cb => {
    cb.addEventListener('change', () => {
      const t = cb.dataset.type;
      if (cb.checked) state.hiddenTypes.delete(t);
      else            state.hiddenTypes.add(t);
      stateToHash();
      applyFilters();
    });
  });
}

/**
 * Re-render the tag cloud based on currently collection-visible entries.
 * If no tags available → shows "暂无标签".
 * @param {object[]} colVisible - entries passing the collection filter
 */
function renderTagCloud(colVisible) {
  const sec   = $('section-tags');
  const freq  = {};
  for (const e of colVisible) {
    for (const t of e.tags) freq[t] = (freq[t] || 0) + 1;
  }
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([t]) => t);

  // If active tag is no longer available in this view, clear it
  if (state.activeTag && !top.includes(state.activeTag)) {
    state.activeTag = '';
    stateToHash();
  }

  const cloudHtml = top.length
    ? top.map(t =>
        `<span class="tag-chip${state.activeTag === t ? ' active' : ''}" data-tag="${esc(t)}">${esc(t)}</span>`
      ).join('')
    : '<span class="sb-empty">暂无标签</span>';

  sec.innerHTML = `
    <div class="sb-label-row">
      <span class="sb-label">Top Tags</span>
      ${top.length ? '<button class="sb-selectall" id="btn-tag-all" title="清除标签过滤">全选</button>' : ''}
    </div>
    <div id="tag-cloud">${cloudHtml}</div>`;

  sec.querySelector('#btn-tag-all')?.addEventListener('click', () => {
    state.activeTag = '';
    stateToHash();
    applyFilters();
  });

  sec.querySelectorAll('.tag-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      state.activeTag = state.activeTag === chip.dataset.tag ? '' : chip.dataset.tag;
      stateToHash();
      applyFilters(); // applyFilters calls renderTagCloud, which updates active state
    });
  });
}

// ── Filtering ─────────────────────────────────────────────────────────────────

function applyFilters() {
  const q = state.search.toLowerCase();

  // Step 1: entries visible after collection filter only (used to drive type+tag sections)
  const colVisible = state.all.filter(e => !state.hiddenCols.has(e.collection));

  // Step 2: fully filtered entries
  state.filtered = colVisible.filter(e => {
    if (state.hiddenTypes.has(e.type))                        return false;
    if (state.activeTag && !e.tags.includes(state.activeTag)) return false;
    if (state.favOnly  && !state.favorites.has(e.id))         return false;
    if (!q) return true;
    return (
      e.name.toLowerCase().includes(q)          ||
      e.description.toLowerCase().includes(q)   ||
      e.collection.toLowerCase().includes(q)    ||
      e.tags.some(t => t.includes(q))            ||
      e.triggerKeywords.some(k => k.includes(q))
    );
  });

  // Re-render reactive sidebar sections (linked to collection selection)
  renderTypeFilter(colVisible);
  renderTagCloud(colVisible);

  renderCards();
  renderFilterBar();
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function renderFilterBar() {
  let html = '';
  if (state.search)
    html += `<span class="chip">search: "${esc(state.search)}" <span class="chip-remove" data-clear="search">×</span></span>`;
  if (state.activeTag)
    html += `<span class="chip">tag: ${esc(state.activeTag)} <span class="chip-remove" data-clear="tag">×</span></span>`;
  if (state.favOnly)
    html += `<span class="chip">★ favorites <span class="chip-remove" data-clear="fav">×</span></span>`;

  html += `<span id="result-count">${state.filtered.length} / ${state.all.length}</span>`;
  $('filter-bar').innerHTML = html;

  $('filter-bar').querySelectorAll('[data-clear]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.clear;
      if (k === 'search') { state.search = ''; $('search').value = ''; }
      if (k === 'tag')    { state.activeTag = ''; buildTagCloud(); }
      if (k === 'fav')    { state.favOnly = false; syncFavBtn(); }
      stateToHash();
      applyFilters();
    });
  });
}

// ── Cards ─────────────────────────────────────────────────────────────────────

function renderCards() {
  const cards = $('cards');
  const empty = $('empty');

  if (!state.filtered.length) {
    cards.innerHTML = '';
    empty.classList.add('visible');
    return;
  }
  empty.classList.remove('visible');

  cards.innerHTML = state.filtered.map(e => {
    const isFav   = state.favorites.has(e.id);
    const isSel   = state.selectedId === e.id;
    const tags    = e.tags.slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join('');
    const tools   = e.tools?.length ? `<span class="tools-count">${e.tools.length} tools</span>` : '';
    const dupBadge = e.duplicates?.length
      ? `<span class="dup-badge" title="${e.duplicates.length + 1} entries with this name">⚠ ${e.duplicates.length + 1}</span>`
      : '';
    const dot = `<span class="col-dot" style="background:${colColor(e.collection)};display:inline-block"></span>`;

    return `<article class="card${isSel ? ' selected' : ''}${isFav ? ' fav' : ''}"
        role="listitem" data-id="${esc(e.id)}" tabindex="0"
        title="${esc(e.name)}${e.triggerKeywords.length ? '\n\nTriggers: ' + e.triggerKeywords.join(', ') : ''}">
      ${dupBadge}
      <div class="card-header">
        ${e.emoji ? `<span class="card-emoji">${esc(e.emoji)}</span>` : ''}
        <div class="card-title-area">
          <div class="card-name">${esc(e.name)}</div>
          <div class="card-collection">${dot}<span>${esc(e.collection)}</span>${e.version ? `<span>· v${esc(e.version)}</span>` : ''}</div>
        </div>
      </div>
      <p class="card-desc">${esc(e.description)}</p>
      <div class="card-footer">
        <span class="badge ${TYPE_CLASS[e.type] || ''}">${TYPE_LABEL[e.type] || esc(e.type)}</span>
        ${tags}
        ${tools}
      </div>
      <button class="card-fav-star${isFav ? ' on' : ''}" data-fav="${esc(e.id)}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">★</button>
    </article>`;
  }).join('');

  cards.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', e => {
      // Don't open drawer if clicking the fav star
      if (e.target.closest('.card-fav-star')) return;
      openDrawer(card.dataset.id);
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(card.dataset.id); }
    });
  });

  cards.querySelectorAll('.card-fav-star').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleFav(btn.dataset.fav);
      renderCards();
      if (state.selectedId === btn.dataset.fav) syncDrawerFavBtn();
    });
  });
}

// ── Favorites toggle button ───────────────────────────────────────────────────

function syncFavBtn() {
  const btn = $('btn-favorites-toggle');
  btn.classList.toggle('active', state.favOnly);
}

$('btn-favorites-toggle').addEventListener('click', () => {
  state.favOnly = !state.favOnly;
  syncFavBtn();
  stateToHash();
  applyFilters();
});

// ── Drawer ────────────────────────────────────────────────────────────────────

async function openDrawer(id) {
  const entry = state.all.find(e => e.id === id);
  if (!entry) return;
  state.selectedId = id;
  renderCards(); // highlight selected card

  const drawer = $('drawer');
  drawer.classList.add('open');

  $('drawer-title').textContent = (entry.emoji ? entry.emoji + ' ' : '') + entry.name;
  syncDrawerFavBtn();

  // Meta
  let metaHtml = `<span class="badge ${TYPE_CLASS[entry.type]}">${TYPE_LABEL[entry.type]}</span>`;
  metaHtml += `<span class="tag" style="border-color:${colColor(entry.collection)};color:${colColor(entry.collection)}">${esc(entry.collection)}</span>`;
  if (entry.version) metaHtml += `<span class="tag">v${esc(entry.version)}</span>`;
  entry.tools?.slice(0, 4).forEach(t => { metaHtml += `<span class="tag">🔧 ${esc(t)}</span>`; });
  if ((entry.tools?.length || 0) > 4) metaHtml += `<span class="tag">+${entry.tools.length - 4} more</span>`;
  entry.tags.forEach(t => { metaHtml += `<span class="tag">${esc(t)}</span>`; });
  $('drawer-meta').innerHTML = metaHtml;

  // Actions
  $('drawer-actions').innerHTML = `
    <button class="action-btn" id="btn-copy-path" title="Copy file path">Copy path</button>
    <button class="action-btn" id="btn-copy-name" title="Copy skill name">Copy name</button>
    <button class="action-btn" id="btn-open-explorer" title="Reveal in Explorer">Show in Explorer</button>
  `;
  $('btn-copy-path')?.addEventListener('click', () =>
    copyAndFlash('btn-copy-path', entry.filePath));
  $('btn-copy-name')?.addEventListener('click', () =>
    copyAndFlash('btn-copy-name', entry.name));
  $('btn-open-explorer')?.addEventListener('click', () =>
    fetch('/api/open', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ path: entry.filePath }) }).catch(() => {}));

  // Load raw content
  const body = $('drawer-body');
  body.innerHTML = '<p style="color:var(--text2);font-size:12px">Loading…</p>';

  try {
    const res  = await fetch(`/api/raw?path=${encodeURIComponent(entry.filePath)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    let bodyHtml = `<div class="md">${renderMd(json.content)}</div>`;

    // Similar / duplicate skills
    if (entry.duplicates?.length) {
      const links = entry.duplicates.map(dupId => {
        const dup = state.all.find(e => e.id === dupId);
        return dup
          ? `<a class="similar-link" data-id="${esc(dupId)}">${esc(dup.collection)} / ${esc(dup.name)}</a>`
          : '';
      }).filter(Boolean).join('');
      if (links) {
        bodyHtml += `<div class="similar-section">
          <div class="similar-title">⚠ Same name in other collections (${entry.duplicates.length})</div>
          ${links}
        </div>`;
      }
    }

    body.innerHTML = bodyHtml;
    body.querySelectorAll('[data-id]').forEach(a => {
      a.addEventListener('click', () => openDrawer(a.dataset.id));
    });
  } catch (e) {
    body.innerHTML = `<p style="color:var(--red);font-size:12px">Failed to load content: ${esc(e.message)}</p>`;
  }
}

function syncDrawerFavBtn() {
  const btn = $('btn-drawer-fav');
  if (!btn || !state.selectedId) return;
  const isFav = state.favorites.has(state.selectedId);
  btn.textContent = isFav ? '★' : '☆';
  btn.title       = isFav ? 'Remove from favorites' : 'Add to favorites';
  btn.classList.toggle('on', isFav);
}

function closeDrawer() {
  $('drawer').classList.remove('open');
  state.selectedId = null;
  renderCards();
}

async function copyAndFlash(btnId, text) {
  try {
    await navigator.clipboard.writeText(text);
    const btn = $(btnId);
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
  } catch {/* ignore clipboard errors */}
}

// ── Drawer events ─────────────────────────────────────────────────────────────

$('drawer-close').addEventListener('click', closeDrawer);

$('btn-drawer-fav').addEventListener('click', () => {
  if (!state.selectedId) return;
  toggleFav(state.selectedId);
  syncDrawerFavBtn();
  renderCards();
});

// ── Rescan ────────────────────────────────────────────────────────────────────

$('btn-rescan').addEventListener('click', async () => {
  const btn = $('btn-rescan');
  btn.textContent = 'Scanning…';
  btn.classList.add('loading');
  try {
    await fetch('/api/rescan', { method: 'POST' });
    const res  = await fetch('/api/index');
    const json = await res.json();
    state.all  = json.entries || [];
    $('stats').textContent = `${state.all.length} entries · scanned just now`;
    buildSidebar();
    applyFilters();
    btn.textContent = '✓ Done';
    setTimeout(() => { btn.textContent = '⟳ Rescan'; }, 2500);
  } catch (e) {
    btn.textContent = 'Error';
    setTimeout(() => { btn.textContent = '⟳ Rescan'; }, 2500);
    console.error('Rescan failed:', e);
  } finally {
    btn.classList.remove('loading');
  }
});

// ── Search input sync ─────────────────────────────────────────────────────────

function syncSearchInput() {
  $('search').value = state.search;
}

$('search').addEventListener('input', e => {
  state.search = e.target.value;
  stateToHash();
  applyFilters();
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  // / → focus search
  if (e.key === '/' && document.activeElement !== $('search')) {
    e.preventDefault();
    $('search').focus();
    $('search').select();
    return;
  }

  if (e.key === 'Escape') {
    if ($('drawer').classList.contains('open')) {
      closeDrawer(); return;
    }
    if (state.search) {
      state.search = '';
      $('search').value = '';
      stateToHash();
      applyFilters();
    }
  }
});

// ── Render all (used after hash change) ──────────────────────────────────────

function renderAll() {
  syncSearchInput();
  syncFavBtn();
  buildSidebar();
  applyFilters();
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
