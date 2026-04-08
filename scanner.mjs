/**
 * scanner.mjs
 * Scans the skill root directory and produces data/index.json.
 *
 * Usage:
 *   node scanner.mjs            # incremental (skips unchanged files)
 *   node scanner.mjs --rebuild  # force full rescan
 *
 * Extension: To add a new skill collection, edit scan-config.json only.
 * No code changes needed.
 *
 * Output schema (data/index.json):
 * {
 *   "version": 2,
 *   "scannedAt": "<ISO>",
 *   "total": <number>,
 *   "byCollection": { "<id>": <count> },
 *   "entries": [ SkillEntry, ... ]
 * }
 *
 * SkillEntry fields:
 *   id             - stable relative path key (forward slashes)
 *   collection     - collection id from scan-config
 *   name           - display name (frontmatter.name or path-derived)
 *   description    - short description, max 400 chars
 *   filePath       - absolute path (forward slashes)
 *   type           - "skill" | "agent" | "design-doc"
 *   tags           - string[] from path segments + frontmatter color
 *   tools          - string[] allowed-tools
 *   triggerKeywords- string[] short phrases to show on hover
 *   version        - semver string or ""
 *   emoji          - single emoji char or ""
 *   duplicates     - id[] of same-named entries in OTHER collections
 */

import {
  readFileSync, readdirSync, statSync,
  writeFileSync, mkdirSync, existsSync,
} from 'node:fs';
import { join, resolve, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFrontmatter,
  extractFirstParagraph,
  extractTriggerKeywords,
  normalizeArray,
} from './lib/frontmatter.mjs';

// ── Paths ──────────────────────────────────────────────────────────────────

const __dirname    = fileURLToPath(new URL('.', import.meta.url));
export const SKILL_ROOT  = resolve(__dirname, '..');
const DATA_DIR     = join(__dirname, 'data');
export const INDEX_FILE  = join(DATA_DIR, 'index.json');
const CACHE_FILE   = join(DATA_DIR, 'scan-cache.json');
const CONFIG_FILE  = join(__dirname, 'scan-config.json');

// ── Config loading ─────────────────────────────────────────────────────────

/** @returns {{ collections: CollectionDef[], skipDirs: string[], version: number }} */
function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch (e) {
    console.error('Failed to load scan-config.json:', e.message);
    process.exit(1);
  }
}

// ── Incremental cache ──────────────────────────────────────────────────────

/** @returns {Map<string, {mtime:number, size:number}>} filePath → stat */
function loadCache() {
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

/** @param {Map<string, {mtime:number, size:number}>} cache */
function saveCache(cache) {
  writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(cache)), 'utf-8');
}

// ── Path / name helpers ────────────────────────────────────────────────────

/** Normalize a path to forward slashes. */
function fwd(p) { return p.replace(/\\/g, '/'); }

/**
 * Derive a display name from the file path when frontmatter has no name.
 * Rules:
 *   SKILL.md   → parent directory name (e.g. "autoplan")
 *   DESIGN.md  → grandparent brand folder (e.g. "airbnb")
 *   other *.md → filename without extension, strip leading "category-" prefix,
 *                title-case (e.g. "engineering-frontend-developer" → "Frontend Developer")
 */
function inferNameFromPath(filePath) {
  const fname = basename(filePath);
  const rel   = fwd(relative(SKILL_ROOT, filePath));
  const parts = rel.split('/');

  if (fname === 'SKILL.md') {
    return parts[parts.length - 2] || parts[0];
  }
  if (fname === 'DESIGN.md') {
    // e.g. awesome-design-md/design-md/airbnb/DESIGN.md → "airbnb"
    return parts[parts.length - 2] || parts[0];
  }

  // Generic: strip leading "category-" prefix then title-case
  const stem = basename(filePath, '.md');
  const dashIdx = stem.indexOf('-');
  const cleaned = dashIdx > 0 ? stem.slice(dashIdx + 1) : stem;
  return cleaned.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Build a deduplicated tag array from path segments + frontmatter color.
 * Only intermediate path segments (not the filename or the collection root)
 * are used as tags.
 * @param {string} filePath
 * @param {Record<string,any>} data  - parsed frontmatter
 * @param {string[]} skipDirs
 * @returns {string[]}
 */
function buildTags(filePath, data, skipDirs) {
  const skipSet = new Set([...skipDirs, 'skills', 'codebuddy', 'codex', 'design-md', '.claude']);
  const rel     = fwd(relative(SKILL_ROOT, filePath));
  const parts   = rel.split('/');

  const tags = new Set();
  // Skip [0] = collection root dir, skip last = filename
  for (const seg of parts.slice(1, -1)) {
    if (!seg || seg.startsWith('.') || skipSet.has(seg)) continue;
    const clean = seg.toLowerCase().replace(/[^a-z0-9\-]/g, '');
    if (clean.length > 1) tags.add(clean);
  }
  if (data.color) tags.add(data.color.toLowerCase().replace(/[^a-z]/g, ''));
  if (data['preamble-tier']) tags.add(`tier-${data['preamble-tier']}`);

  return [...tags].slice(0, 8);
}

// ── Entry parser ───────────────────────────────────────────────────────────

/**
 * Parse a single markdown file into a SkillEntry (without duplicates field).
 * @param {string} filePath
 * @param {string} collectionId
 * @param {string} type
 * @param {string[]} skipDirs
 * @returns {object|null}
 */
function parseEntry(filePath, collectionId, type, skipDirs) {
  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (e) {
    console.warn(`  [skip] cannot read ${filePath}: ${e.message}`);
    return null;
  }

  const { data, body } = parseFrontmatter(content);

  // Name: frontmatter.name (string only) or path-derived
  const name = (typeof data.name === 'string' && data.name.trim())
    ? data.name.trim()
    : inferNameFromPath(filePath);

  if (!name) return null;

  // Description: prefer frontmatter, fall back to first paragraph
  const descRaw = typeof data.description === 'string'
    ? data.description
    : extractFirstParagraph(body);
  const description = descRaw.replace(/\s+/g, ' ').trim().slice(0, 400);

  const tools           = normalizeArray(data['allowed-tools'] || data['tools']);
  const tags            = buildTags(filePath, data, skipDirs);
  const triggerKeywords = extractTriggerKeywords(description);
  const version         = data.version  ? String(data.version).trim()  : '';
  const emoji           = data.emoji    ? String(data.emoji).trim()     : '';

  return {
    id:              fwd(relative(SKILL_ROOT, filePath)),
    collection:      collectionId,
    name,
    description,
    filePath:        fwd(filePath),
    type,
    tags,
    tools,
    triggerKeywords,
    version,
    emoji,
    // duplicates added in post-processing
  };
}

// ── Directory walker ───────────────────────────────────────────────────────

/**
 * Recursively walk a directory, calling visitor(filePath) for each file.
 * @param {string}   dir
 * @param {Set<string>} skipSet - dir names to skip
 * @param {(f:string)=>void} visitor
 */
function walk(dir, skipSet, visitor) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return; }

  for (const entry of entries) {
    if (skipSet.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, skipSet, visitor);
    } else if (entry.isFile()) {
      visitor(full);
    }
  }
}

// ── Main scan logic ────────────────────────────────────────────────────────

/**
 * Run the scan and write data/index.json.
 * @param {{ rebuild?: boolean }} opts
 * @returns {object[]}  entries array
 */
export function runScan(opts = {}) {
  const config  = loadConfig();
  const skipSet = new Set(config.skipDirs || []);
  const cache   = opts.rebuild ? new Map() : loadCache();
  const newCache = new Map();

  const collectionMap = new Map(config.collections.map(c => [c.id, c]));
  const entries  = [];
  const seenPath = new Set();

  for (const col of config.collections) {
    const colDir = resolve(SKILL_ROOT, col.dir);
    if (!existsSync(colDir)) {
      console.warn(`  [warn] collection "${col.id}" dir not found: ${colDir}`);
      continue;
    }

    const excludeFiles = new Set(col.excludeFiles || []);

    walk(colDir, skipSet, (filePath) => {
      const fname = basename(filePath);

      // Apply scanRule
      let matches = false;
      if (col.scanRule === 'SKILL.md')    matches = fname === 'SKILL.md';
      else if (col.scanRule === 'DESIGN.md') matches = fname === 'DESIGN.md';
      else if (col.scanRule === '*.md')   matches = extname(fname) === '.md' && !excludeFiles.has(fname);
      // Extension: add more scanRule patterns here as needed

      if (!matches) return;
      if (seenPath.has(filePath)) return;
      seenPath.add(filePath);

      // Incremental: check mtime
      let stat;
      try { stat = statSync(filePath); }
      catch { return; }
      const cacheKey = fwd(filePath);
      const cached   = cache.get(cacheKey);
      const mtime    = stat.mtimeMs;
      const size     = stat.size;

      newCache.set(cacheKey, { mtime, size });

      // If unchanged and we have a cached entry, reuse it
      if (!opts.rebuild && cached && cached.mtime === mtime && cached.size === size) {
        // We still need the parsed entry from the previous index — handled below
        return;
      }

      const entry = parseEntry(filePath, col.id, col.type, config.skipDirs || []);
      if (entry) entries.push(entry);
    });
  }

  // For incremental: merge unchanged entries from previous index
  if (!opts.rebuild) {
    let prevEntries = [];
    try {
      const prev = JSON.parse(readFileSync(INDEX_FILE, 'utf-8'));
      prevEntries = prev.entries || [];
    } catch { /* no previous index */ }

    const newIds = new Set(entries.map(e => e.id));
    for (const prev of prevEntries) {
      if (newIds.has(prev.id)) continue; // already re-parsed
      const absPath = resolve(SKILL_ROOT, prev.id);
      const cacheKey = fwd(absPath);
      const inNew = newCache.has(cacheKey);
      if (!inNew) continue; // file was removed, skip
      // Restore cached entry (strip old duplicates, recalculate below)
      const { duplicates: _d, ...rest } = prev;
      entries.push(rest);
    }
  }

  // ── Duplicate detection ────────────────────────────────────────────────
  // Only mark entries as duplicates if they share the same name AND
  // belong to DIFFERENT collections. Design-docs sharing "DESIGN.md"
  // file name are handled by path-derived names, so this works naturally.
  const nameMap = new Map(); // normalizedName → id[]
  for (const e of entries) {
    const key = e.name.toLowerCase().trim();
    if (!nameMap.has(key)) nameMap.set(key, []);
    nameMap.get(key).push(e.id);
  }
  for (const e of entries) {
    const key      = e.name.toLowerCase().trim();
    const siblings = nameMap.get(key) || [];
    // Only flag cross-collection duplicates
    e.duplicates = siblings.filter(id => id !== e.id);
  }

  // ── Sort ──────────────────────────────────────────────────────────────
  const typeOrder = { skill: 0, agent: 1, 'design-doc': 2 };
  entries.sort((a, b) => {
    const td = (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9);
    if (td !== 0) return td;
    return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  });

  // ── Persist ───────────────────────────────────────────────────────────
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  const byCollection = {};
  for (const e of entries) {
    byCollection[e.collection] = (byCollection[e.collection] || 0) + 1;
  }

  const output = {
    version: 2,
    scannedAt: new Date().toISOString(),
    total: entries.length,
    byCollection,
    entries,
  };

  writeFileSync(INDEX_FILE, JSON.stringify(output, null, 2), 'utf-8');
  saveCache(newCache);

  // ── Report ────────────────────────────────────────────────────────────
  console.log(`\nScanned ${entries.length} entries → data/index.json`);
  for (const [col, count] of Object.entries(byCollection)) {
    console.log(`  ${col}: ${count}`);
  }
  console.log();

  return entries;
}

// ── CLI entry point ────────────────────────────────────────────────────────
// Only runs when invoked directly: `node scanner.mjs [--rebuild]`
// Does NOT run when imported by server.mjs.
const isMain = process.argv[1] && fwd(resolve(process.argv[1])) === fwd(fileURLToPath(import.meta.url));
if (isMain) {
  const rebuild = process.argv.includes('--rebuild');
  if (rebuild) console.log('Full rebuild requested — ignoring cache.');
  runScan({ rebuild });
}
