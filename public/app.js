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

const TYPE_LABEL = { skill: '技能', agent: '智能体', 'design-doc': '设计' };
const TYPE_LABEL_ICON = { skill: '🔧 技能', agent: '🤖 智能体', 'design-doc': '🎨 设计' };
const TYPE_CLASS = { skill: 'badge-skill', agent: 'badge-agent', 'design-doc': 'badge-design' };
const FAV_KEY    = 'skill-dashboard-favs';

// 「我想…」意图入口 → 直达对应功能域。这是渐进披露里「给一个清晰的下一步」的落地。
const INTENTS = [
  { label: '写代码',     domain: 'coding' },
  { label: '审查代码',   domain: 'review' },
  { label: '调试排错',   domain: 'debugging' },
  { label: '做规划',     domain: 'planning' },
  { label: '做研究',     domain: 'research' },
  { label: '写文档',     domain: 'writing' },
  { label: '做设计',     domain: 'design' },
  { label: '智能体/流程', domain: 'agent-workflow' },
];

const DOMAIN_FALLBACK = { id: 'other', label: '其它/未分类', color: '#9ca3af', icon: '📦', desc: '暂未归类' };

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  all:        [],        // full SkillEntry[]
  filtered:   [],        // after filters
  search:     '',
  activeDomain:'',       // '' = 概览;否则进入该功能域视图
  hiddenCols: new Set(), // collections to HIDE (次级过滤)
  hiddenTypes:new Set(), // types to HIDE
  activeTag:  '',        // tag filter (single tag from cloud)
  favOnly:    false,     // show only favorites
  selectedId: null,      // open drawer entry id
  favorites:  loadFavs(),// Set<id>
  colors:     {},        // collection id → color, populated from index
  domains:    [],        // functional-domain taxonomy from index.json
};

// 当前视图：搜索/收藏中 → 跨域结果;选中某域 → 该域卡片;否则 → 功能域概览。
function currentView() {
  if (state.search || state.favOnly) return 'list';
  if (state.activeDomain)            return 'domain';
  return 'overview';
}

function domainMeta(id) {
  return state.domains.find(d => d.id === id) || DOMAIN_FALLBACK;
}

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
// Format: #domain=coding&q=search&col=gstack,pua&type=skill&tag=design
// Only non-default values are written to keep URLs clean.

function hashToState() {
  const params = new URLSearchParams(location.hash.slice(1));
  state.search       = params.get('q')      || '';
  state.activeDomain = params.get('domain') || '';
  state.activeTag    = params.get('tag')    || '';
  state.favOnly      = params.get('fav')    === '1';

  const colStr  = params.get('col')  || '';
  const typeStr = params.get('type') || '';
  state.hiddenCols  = colStr  ? new Set(colStr.split(','))  : new Set();
  state.hiddenTypes = typeStr ? new Set(typeStr.split(','))  : new Set();
}

function stateToHash() {
  const p = new URLSearchParams();
  if (state.activeDomain) p.set('domain', state.activeDomain);
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
    state.all     = json.entries || [];
    state.domains = json.domains || [];

    // Build color map from index (server embeds collection colors via scan-config)
    // Fallback: derive from COLLECTION_COLORS map below
    state.colors = json.collectionColors || {};

    $('stats').textContent = `${state.all.length} 条 · 扫描于 ${
      new Date(json.scannedAt).toLocaleString('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
    }`;

    $('loading').style.display = 'none';
    buildSidebar();
    applyFilters();
    syncSearchInput();
  } catch (e) {
    $('loading').textContent = `加载索引失败：${e.message}。服务器是否在 10010 端口运行？`;
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

/** Build the stable sidebar sections. Domain + collection are rebuilt on each
 *  applyFilters() so the active-domain highlight stays in sync; type + tag are
 *  rendered reactively against the current scope. */
function buildSidebar() {
  buildDomainFilter();
  buildCollectionFilter();
}

// ── Navigation helpers (progressive disclosure) ───────────────────────────────

/** Return to the functional-domain overview (clears drill-in + search + fav). */
function goOverview() {
  state.activeDomain = '';
  state.search       = '';
  state.favOnly      = false;
  state.activeTag    = '';
  $('search').value  = '';
  syncFavBtn();
  stateToHash();
  applyFilters();
}

/** Drill into a single functional domain. */
function enterDomain(id) {
  state.activeDomain = id;
  state.search       = '';
  state.favOnly      = false;
  state.activeTag    = '';
  $('search').value  = '';
  syncFavBtn();
  stateToHash();
  applyFilters();
}

/**
 * Primary sidebar nav: functional domains (single-select). Rebuilt on every
 * applyFilters() to keep the active highlight correct. Counts are over ALL
 * entries (stable), shown in taxonomy order, hiding empty domains.
 */
function buildDomainFilter() {
  const sec = $('section-domains');
  if (!sec) return;

  const counts = {};
  for (const e of state.all) counts[e.domain] = (counts[e.domain] || 0) + 1;
  const doms = state.domains.filter(d => counts[d.id]);

  const onOverview = currentView() === 'overview';
  const rows = doms.map(d => {
    const active = !onOverview && !state.search && !state.favOnly && state.activeDomain === d.id;
    return `<button class="domain-row${active ? ' active' : ''}" data-domain="${esc(d.id)}" title="${esc(d.desc || d.label)}">
      <span class="dm-icon">${esc(d.icon || '•')}</span>
      <span class="dm-label">${esc(d.label)}</span>
      <span class="fr-count">${counts[d.id]}</span>
    </button>`;
  }).join('');

  sec.innerHTML = `
    <div class="sb-label-row">
      <span class="sb-label">功能域</span>
      <button class="sb-selectall" id="btn-domain-home" title="返回功能域概览">概览</button>
    </div>
    <div class="domain-rows">${rows}</div>`;

  sec.querySelector('#btn-domain-home')?.addEventListener('click', goOverview);
  sec.querySelectorAll('[data-domain]').forEach(btn => {
    btn.addEventListener('click', () => enterDomain(btn.dataset.domain));
  });
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
      <span class="sb-label">来源集合</span>
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
  const TYPE_LABELS = TYPE_LABEL_ICON;

  const counts = {};
  for (const e of colVisible) counts[e.type] = (counts[e.type] || 0) + 1;
  const types = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  if (!types.length) {
    sec.innerHTML = `<div class="sb-label-row"><span class="sb-label">类型</span></div>
      <div class="filter-rows"><span class="sb-empty">暂无</span></div>`;
    return;
  }

  const allTypesSelected = state.hiddenTypes.size === 0;
  sec.innerHTML = `
    <div class="sb-label-row">
      <span class="sb-label">类型</span>
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
      <span class="sb-label">常用标签</span>
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
  // Keep the domain nav highlight in sync with the current view.
  buildDomainFilter();

  const view = currentView();

  // ── Overview (功能域着陆页) — progressive disclosure: no 705-card wall ────
  if (view === 'overview') {
    showOverview(true);
    renderOverview();
    return;
  }
  showOverview(false);

  const q = state.search.toLowerCase();

  // Scope = collection filter + (functional domain, when drilled in).
  // Drives the reactive Type / Tag sidebar sections too.
  const scope = state.all.filter(e =>
    !state.hiddenCols.has(e.collection) &&
    (view !== 'domain' || e.domain === state.activeDomain)
  );

  state.filtered = scope.filter(e => {
    if (state.hiddenTypes.has(e.type))                        return false;
    if (state.activeTag && !e.tags.includes(state.activeTag)) return false;
    if (state.favOnly  && !state.favorites.has(e.id))         return false;
    if (!q) return true;
    return (
      e.name.toLowerCase().includes(q)                      ||
      e.description.toLowerCase().includes(q)               ||
      (e.summaryZh && e.summaryZh.toLowerCase().includes(q)) ||
      e.collection.toLowerCase().includes(q)                ||
      e.tags.some(t => t.includes(q))                        ||
      e.triggerKeywords.some(k => k.includes(q))
    );
  });

  // Reactive sidebar sections scoped to the current domain/collection view.
  renderTypeFilter(scope);
  renderTagCloud(scope);

  renderBreadcrumb(view);
  renderCards();
  renderFilterBar();
}

// ── View switching (overview ⇄ card list) ─────────────────────────────────────

function showOverview(on) {
  $('overview').style.display   = on ? '' : 'none';
  $('breadcrumb').style.display = on ? 'none' : '';
  $('filter-bar').style.display = on ? 'none' : '';
  $('cards').style.display      = on ? 'none' : '';  // empty grid would still grab flex:1 height
  // 概览模式下隐藏次级过滤区（类型/集合/标签），侧栏只留功能域导航。
  document.body.classList.toggle('overview-mode', on);
  if (on) {
    $('cards').innerHTML = '';
    $('empty').classList.remove('visible');
  }
}

/** Breadcrumb: 「← 功能域概览 / <当前位置>」 */
function renderBreadcrumb(view) {
  const bc = $('breadcrumb');
  let label = '';
  if (view === 'domain') {
    const d = domainMeta(state.activeDomain);
    label = `${d.icon || ''} ${d.label}`;
  } else if (state.search) {
    label = `搜索 “${state.search}”`;
  } else if (state.favOnly) {
    label = '★ 收藏';
  }
  bc.innerHTML =
    `<button class="bc-home" id="bc-home">← 功能域概览</button>` +
    (label ? `<span class="bc-sep">/</span><span class="bc-current">${esc(label)}</span>` : '');
  $('bc-home')?.addEventListener('click', goOverview);
}

// ── Overview: intent bar + functional-domain tiles ────────────────────────────

function renderOverview() {
  const counts = {};
  const examples = {};
  for (const d of state.domains) examples[d.id] = [];
  for (const e of state.all) {
    counts[e.domain] = (counts[e.domain] || 0) + 1;
    const arr = examples[e.domain];
    if (arr && arr.length < 3) arr.push(e.name);
  }

  const intentHtml = INTENTS
    .filter(it => counts[it.domain])
    .map(it => `<button class="intent-btn" data-domain="${esc(it.domain)}">${esc(it.label)}</button>`)
    .join('');

  const tilesHtml = state.domains.filter(d => counts[d.id]).map(d => {
    const ex = (examples[d.id] || []).map(esc).join(' · ');
    return `<button class="domain-tile" data-domain="${esc(d.id)}" style="--tile-accent:${esc(d.color || '#888')}">
      <div class="tile-top">
        <span class="tile-icon">${esc(d.icon || '•')}</span>
        <span class="tile-count">${counts[d.id]}</span>
      </div>
      <div class="tile-label">${esc(d.label)}</div>
      <div class="tile-desc">${esc(d.desc || '')}</div>
      ${ex ? `<div class="tile-examples">${ex}</div>` : ''}
    </button>`;
  }).join('');

  $('overview').innerHTML = `
    <div class="intent-bar">
      <span class="intent-lead">我想…</span>
      ${intentHtml}
    </div>
    <h2 class="overview-heading">按功能域浏览</h2>
    <div class="overview-grid">${tilesHtml}</div>`;

  $('overview').querySelectorAll('[data-domain]').forEach(el => {
    el.addEventListener('click', () => enterDomain(el.dataset.domain));
  });
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function renderFilterBar() {
  let html = '';
  if (state.search)
    html += `<span class="chip">搜索：“${esc(state.search)}” <span class="chip-remove" data-clear="search">×</span></span>`;
  if (state.activeTag)
    html += `<span class="chip">标签：${esc(state.activeTag)} <span class="chip-remove" data-clear="tag">×</span></span>`;
  if (state.favOnly)
    html += `<span class="chip">★ 收藏 <span class="chip-remove" data-clear="fav">×</span></span>`;

  html += `<span id="result-count">${state.filtered.length} 条</span>`;
  $('filter-bar').innerHTML = html;

  $('filter-bar').querySelectorAll('[data-clear]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.clear;
      if (k === 'search') { state.search = ''; $('search').value = ''; }
      if (k === 'tag')    { state.activeTag = ''; }
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
    const dm      = domainMeta(e.domain);
    const domChip = `<span class="domain-chip" style="--tile-accent:${esc(dm.color || '#888')}">${esc(dm.icon || '')} ${esc(dm.label)}</span>`;
    const tools   = e.tools?.length ? `<span class="tools-count">${e.tools.length} 个工具</span>` : '';
    const dupBadge = e.duplicates?.length
      ? `<span class="dup-badge" title="同名条目，共 ${e.duplicates.length + 1} 个">⚠ ${e.duplicates.length + 1}</span>`
      : '';
    const dot = `<span class="col-dot" style="background:${colColor(e.collection)};display:inline-block"></span>`;

    // 英文条目优先显示中文说明（summaryZh），原文作次要展示。
    const descHtml = e.summaryZh
      ? `<p class="card-desc card-desc-zh">${esc(e.summaryZh)}</p><p class="card-desc card-desc-en">${esc(e.description)}</p>`
      : `<p class="card-desc">${esc(e.description)}</p>`;

    return `<article class="card${isSel ? ' selected' : ''}${isFav ? ' fav' : ''}"
        role="listitem" data-id="${esc(e.id)}" tabindex="0"
        title="${esc(e.name)}${e.triggerKeywords.length ? '\n\n触发词：' + e.triggerKeywords.join('、') : ''}">
      ${dupBadge}
      <div class="card-header">
        ${e.emoji ? `<span class="card-emoji">${esc(e.emoji)}</span>` : ''}
        <div class="card-title-area">
          <div class="card-name">${esc(e.name)}</div>
          <div class="card-collection">${dot}<span>${esc(e.collection)}</span>${e.version ? `<span>· v${esc(e.version)}</span>` : ''}</div>
        </div>
      </div>
      ${descHtml}
      <div class="card-footer">
        <span class="badge ${TYPE_CLASS[e.type] || ''}">${TYPE_LABEL[e.type] || esc(e.type)}</span>
        ${domChip}
        ${tools}
      </div>
      <button class="card-fav-star${isFav ? ' on' : ''}" data-fav="${esc(e.id)}" title="${isFav ? '取消收藏' : '加入收藏'}">★</button>
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
  pushDrawerHistory();           // 手机：Back/返回手势可关闭抽屉
  if (isTablet()) {              // 抽屉浮层化时把焦点移入抽屉（a11y）
    _drawerReturnFocusId = id;
    requestAnimationFrame(() => $('drawer-close').focus({ preventScroll: true }));
  }

  $('drawer-title').textContent = (entry.emoji ? entry.emoji + ' ' : '') + entry.name;
  syncDrawerFavBtn();

  // Meta
  const dm = domainMeta(entry.domain);
  let metaHtml = `<span class="badge ${TYPE_CLASS[entry.type]}">${TYPE_LABEL[entry.type]}</span>`;
  metaHtml += `<span class="domain-chip" style="--tile-accent:${esc(dm.color || '#888')}">${esc(dm.icon || '')} ${esc(dm.label)}</span>`;
  metaHtml += `<span class="tag" style="border-color:${colColor(entry.collection)};color:${colColor(entry.collection)}">${esc(entry.collection)}</span>`;
  if (entry.version) metaHtml += `<span class="tag">v${esc(entry.version)}</span>`;
  entry.tools?.slice(0, 4).forEach(t => { metaHtml += `<span class="tag">🔧 ${esc(t)}</span>`; });
  if ((entry.tools?.length || 0) > 4) metaHtml += `<span class="tag">+${entry.tools.length - 4} 个</span>`;
  entry.tags.forEach(t => { metaHtml += `<span class="tag">${esc(t)}</span>`; });
  $('drawer-meta').innerHTML = metaHtml;

  // Actions
  const isLocalHost = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname);
  const explorerBtn = isLocalHost
    ? `<button class="action-btn" id="btn-open-explorer" title="在文件管理器中显示">在文件管理器打开</button>`
    : `<button class="action-btn" id="btn-open-explorer" title="远程模式：改为复制路径">复制路径（远程）</button>`;
  $('drawer-actions').innerHTML = `
    <button class="action-btn" id="btn-copy-path" title="复制文件路径">复制路径</button>
    <button class="action-btn" id="btn-copy-name" title="复制名称">复制名称</button>
    ${explorerBtn}
    <button class="action-btn" id="btn-copy-context" title="复制完整 Markdown 内容" disabled>复制全文</button>
  `;
  $('btn-copy-path')?.addEventListener('click', () =>
    copyAndFlash('btn-copy-path', entry.filePath));
  $('btn-copy-name')?.addEventListener('click', () =>
    copyAndFlash('btn-copy-name', entry.name));
  $('btn-open-explorer')?.addEventListener('click', () => {
    if (isLocalHost) {
      fetch('/api/open', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ path: entry.filePath }) }).catch(() => {});
    } else {
      copyAndFlash('btn-open-explorer', entry.filePath);
    }
  });

  // Load raw content
  const body = $('drawer-body');
  body.innerHTML = '<p style="color:var(--text-2);font-size:12px">加载中…</p>';

  // 英文条目的中文说明，置顶展示。
  const glossHtml = entry.summaryZh
    ? `<div class="drawer-gloss">${esc(entry.summaryZh)}</div>`
    : '';

  try {
    const res  = await fetch(`/api/raw?path=${encodeURIComponent(entry.filePath)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    // Enable Copy context now that we have raw content
    const ctxBtn = $('btn-copy-context');
    if (ctxBtn) {
      ctxBtn.disabled = false;
      ctxBtn.addEventListener('click', () => copyAndFlash('btn-copy-context', json.content));
    }

    let bodyHtml = glossHtml + `<div class="md">${renderMd(json.content)}</div>`;

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
          <div class="similar-title">⚠ 其它集合中的同名条目（${entry.duplicates.length}）</div>
          ${links}
        </div>`;
      }
    }

    body.innerHTML = bodyHtml;
    body.querySelectorAll('[data-id]').forEach(a => {
      a.addEventListener('click', () => openDrawer(a.dataset.id));
    });
  } catch (e) {
    body.innerHTML = glossHtml + `<p style="color:var(--danger);font-size:12px">加载内容失败：${esc(e.message)}</p>`;
  }
}

function syncDrawerFavBtn() {
  const btn = $('btn-drawer-fav');
  if (!btn || !state.selectedId) return;
  const isFav = state.favorites.has(state.selectedId);
  btn.textContent = isFav ? '★' : '☆';
  btn.title       = isFav ? '取消收藏' : '加入收藏';
  btn.classList.toggle('on', isFav);
}

function closeDrawer() {
  $('drawer').classList.remove('open');
  state.selectedId = null;
  consumeDrawerHistory();
  renderCards();
  // 抽屉浮层模式下，关闭后把焦点交还触发的卡片（renderCards 重建了 DOM，按 id 重新定位）
  if (_drawerReturnFocusId) {
    const card = $('cards').querySelector(`.card[data-id="${CSS.escape(_drawerReturnFocusId)}"]`);
    card?.focus({ preventScroll: true });
    _drawerReturnFocusId = null;
  }
}

// ── 手机：返回键/返回手势关闭抽屉 ───────────────────────────────────────────────
// 抽屉在手机上是全屏浮层，系统 Back 应关闭它而非离开页面。开启时压入一个哨兵
// history 条目，关闭时弹出。仅作用于「抽屉」「手机断点」：
//   · 侧栏是筛选面板，其选择会调用 history.replaceState(stateToHash)，会冲掉哨兵
//     条目 → 故不对侧栏启用，与筛选 hash 完全隔离；
//   · 手机断点下抽屉打开会自动收起侧栏（见下方 observer），二者不会并存，
//     因此抽屉打开期间不会有 replaceState 冲突。
let _drawerHistoryActive = false;   // 已为打开的抽屉压入哨兵
let _drawerPopClosing    = false;   // 当前正因 Back 导航而关闭
let _drawerReturnFocusId = null;    // 关闭后需归还焦点的卡片 id

function pushDrawerHistory() {
  if (_drawerHistoryActive || !isMobile()) return;
  history.pushState({ skillDrawer: true }, '');   // 空 URL → 不改 hash，不触发 hashchange
  _drawerHistoryActive = true;
}
function consumeDrawerHistory() {
  if (!_drawerHistoryActive) return;
  _drawerHistoryActive = false;
  // 若是 UI（X/Esc/backdrop）关闭，弹掉我们压入的哨兵以保持历史栈干净；
  // 若是 Back 触发的关闭，哨兵已被系统弹出，无需再 back。
  if (!_drawerPopClosing) history.back();
}

window.addEventListener('popstate', () => {
  if (!_drawerHistoryActive) return;   // 不是我们的哨兵 → 放行正常导航
  _drawerHistoryActive = false;
  if ($('drawer').classList.contains('open')) {
    _drawerPopClosing = true;
    closeDrawer();
    _drawerPopClosing = false;
  }
});

async function copyAndFlash(btnId, text) {
  const btn = $(btnId);
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      ok = true;
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    }
  } catch { ok = false; }
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = ok ? '已复制！' : '复制失败';
  btn.classList.add('copied');
  setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
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
  btn.textContent = '扫描中…';
  btn.classList.add('loading');
  try {
    await fetch('/api/rescan', { method: 'POST' });
    const res  = await fetch('/api/index');
    const json = await res.json();
    state.all     = json.entries || [];
    state.domains = json.domains || state.domains;
    $('stats').textContent = `${state.all.length} 条 · 刚刚扫描`;
    buildSidebar();
    applyFilters();
    btn.textContent = '✓ 完成';
    setTimeout(() => { btn.textContent = '⟳ 重新扫描'; }, 2500);
  } catch (e) {
    btn.textContent = '出错';
    setTimeout(() => { btn.textContent = '⟳ 重新扫描'; }, 2500);
    console.error('Rescan failed:', e);
  } finally {
    btn.classList.remove('loading');
  }
});

// ── Feedback modal ───────────────────────────────────────────────────────────

const fbModal = $('fb-modal');
const fbText  = $('fb-text');
const fbStatus= $('fb-status');

function openFeedback() {
  fbModal.classList.remove('fb-hidden');
  fbStatus.textContent = '';
  setTimeout(() => fbText.focus(), 50);
}
function closeFeedback() { fbModal.classList.add('fb-hidden'); }

$('btn-feedback').addEventListener('click', openFeedback);
$('fb-close').addEventListener('click', closeFeedback);
fbModal.addEventListener('click', e => { if (e.target === fbModal) closeFeedback(); });

$('fb-submit').addEventListener('click', async () => {
  const content = fbText.value.trim();
  if (!content) { fbStatus.textContent = '内容不能为空'; return; }
  const btn = $('fb-submit');
  btn.disabled = true;
  fbStatus.textContent = '提交中…';
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fbStatus.textContent = '✓ 已保存到 feedback.md';
    fbText.value = '';
    setTimeout(closeFeedback, 900);
  } catch (e) {
    fbStatus.textContent = '提交失败: ' + e.message;
  } finally {
    btn.disabled = false;
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
    if (!fbModal.classList.contains('fb-hidden')) {
      closeFeedback(); return;
    }
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

// ── Mobile sidebar / backdrop ────────────────────────────────────────────────
// Sidebar slides off-canvas under 860px (see style.css media queries).
// `#backdrop` covers the main area while sidebar OR drawer is open on small
// screens; clicking it closes whichever is open.
//
// `openDrawer` and `closeDrawer` (declared above) call `syncBackdrop()` via
// the global hook below — we attach a MutationObserver to the relevant
// elements rather than monkey-patching the functions, to keep behavior
// transparent to the rest of the app.

const MOBILE_QUERY = window.matchMedia('(max-width: 860px)');
const TABLET_QUERY = window.matchMedia('(max-width: 1024px)');

function isMobile() { return MOBILE_QUERY.matches; }
function isTablet() { return TABLET_QUERY.matches; }

function syncBackdrop() {
  const sidebarOpen = $('sidebar').classList.contains('open');
  const drawerOpen  = $('drawer').classList.contains('open');
  const need = (sidebarOpen && isMobile()) || (drawerOpen && isTablet());
  $('backdrop').classList.toggle('visible', need);
}

function openSidebar()  { $('sidebar').classList.add('open');    syncBackdrop(); }
function closeSidebar() { $('sidebar').classList.remove('open'); syncBackdrop(); }

$('btn-menu').addEventListener('click', () => {
  if ($('sidebar').classList.contains('open')) closeSidebar();
  else openSidebar();
});

$('backdrop').addEventListener('click', () => {
  if ($('sidebar').classList.contains('open')) closeSidebar();
  if ($('drawer').classList.contains('open')  && isTablet()) closeDrawer();
});

// Watch for class changes on sidebar + drawer so that backdrop stays in
// sync no matter who toggles them (drawer can be closed via Esc, drawer
// close button, or auto-collapsed on hashchange / rescan).
const _classObserver = new MutationObserver(() => {
  syncBackdrop();
  // Auto-close sidebar when a card is selected on mobile (drawer just opened)
  if (isMobile() && $('drawer').classList.contains('open')) closeSidebar();
});
_classObserver.observe($('sidebar'), { attributes: true, attributeFilter: ['class'] });
_classObserver.observe($('drawer'),  { attributes: true, attributeFilter: ['class'] });

// Re-evaluate when viewport crosses breakpoints
MOBILE_QUERY.addEventListener?.('change', () => {
  if (!isMobile()) closeSidebar();
  syncBackdrop();
});
TABLET_QUERY.addEventListener?.('change', syncBackdrop);

// ── Render all (used after hash change) ──────────────────────────────────────

function renderAll() {
  syncSearchInput();
  syncFavBtn();
  buildSidebar();
  applyFilters();
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
