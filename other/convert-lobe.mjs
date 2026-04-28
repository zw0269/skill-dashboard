/**
 * convert-lobe.mjs
 * One-off: convert lobe-chat-agents/src/<id>.zh-CN.json → Skill研究/lobe-chat-agents/<id>.md
 *
 * Run from skill-dashboard directory:
 *   node other/convert-lobe.mjs
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC_DIR = '/Users/zw/work/project_test/lobe-chat-agents/src';
const OUT_DIR = resolve('/Users/zw/work/project_test/Skill研究/lobe-chat-agents');

mkdirSync(OUT_DIR, { recursive: true });

// YAML escape: replace newlines with spaces, escape backslashes and double quotes,
// strip control chars. Result is safe inside a double-quoted YAML scalar.
function yamlString(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\x00-\x1f]+/g, ' ')
    .trim();
}

// Tag tokens: simple [a-zA-Z0-9-_ ] only, drop anything weird, lowercase, dedupe.
function cleanTags(arr) {
  if (!Array.isArray(arr)) return [];
  const out = new Set();
  for (const raw of arr) {
    if (typeof raw !== 'string') continue;
    const cleaned = raw
      .toLowerCase()
      .replace(/[\s,\[\]'"`]+/g, '-')
      .replace(/[^a-z0-9一-龥\-]/g, '')
      .replace(/^-+|-+$/g, '');
    if (cleaned && cleaned.length <= 30) out.add(cleaned);
    if (out.size >= 8) break;
  }
  return [...out];
}

// Detect single emoji (very rough): short and contains no ascii letters/digits/colons/slashes.
function pickEmoji(avatar) {
  if (typeof avatar !== 'string') return '';
  const t = avatar.trim();
  if (!t || t.length > 8) return '';
  if (/[a-z0-9:\/.\-_]/i.test(t)) return ''; // looks like a URL or text
  return t;
}

const files = readdirSync(SRC_DIR).filter(f => f.endsWith('.zh-CN.json')).sort();
let written = 0, skipped = 0, failed = 0;
const seenIds = new Set();

for (const fname of files) {
  const src = join(SRC_DIR, fname);
  let j;
  try {
    j = JSON.parse(readFileSync(src, 'utf-8'));
  } catch (e) {
    console.warn(`[skip-parse] ${fname}: ${e.message}`);
    failed++;
    continue;
  }

  const meta = j.meta || {};
  const cfg = j.config || {};

  // Filename: strip .zh-CN.json suffix → identifier-style stem
  const stem = fname.replace(/\.zh-CN\.json$/, '');
  if (seenIds.has(stem)) {
    skipped++;
    continue;
  }
  seenIds.add(stem);

  const title = (meta.title && String(meta.title).trim()) || stem;
  const desc = (meta.description && String(meta.description).trim()) || '';
  const summary = (j.summary && String(j.summary).trim()) || '';
  const systemRole = (cfg.systemRole && String(cfg.systemRole).trim()) || '';
  const examples = Array.isArray(j.examples) ? j.examples : [];
  const tags = cleanTags(meta.tags);
  const emoji = pickEmoji(meta.avatar);
  const identifier = (j.identifier && String(j.identifier).trim()) || stem;
  const category = (meta.category && String(meta.category).trim()) || '';
  const author = (j.author && String(j.author).trim()) || '';
  const homepage = (j.homepage && String(j.homepage).trim()) || '';

  // Frontmatter
  const lines = ['---'];
  lines.push(`name: "${yamlString(title)}"`);
  if (desc) {
    // Use double-quoted scalar — frontmatter parser strips outer quotes.
    lines.push(`description: "${yamlString(desc)}"`);
  }
  if (tags.length) {
    lines.push(`tags: [${tags.map(t => yamlString(t)).join(', ')}]`);
  }
  if (emoji) lines.push(`emoji: "${yamlString(emoji)}"`);
  if (identifier) lines.push(`identifier: "${yamlString(identifier)}"`);
  if (category) lines.push(`category: "${yamlString(category)}"`);
  if (author) lines.push(`author: "${yamlString(author)}"`);
  if (homepage) lines.push(`homepage: "${yamlString(homepage)}"`);
  lines.push('source: lobe-chat-agents');
  lines.push('---');
  lines.push('');

  // Body
  lines.push(`# ${title}`);
  lines.push('');
  if (summary) {
    lines.push('## 摘要');
    lines.push('');
    lines.push(summary);
    lines.push('');
  }
  if (systemRole) {
    lines.push('## 系统提示词 (System Role)');
    lines.push('');
    lines.push('```text');
    lines.push(systemRole);
    lines.push('```');
    lines.push('');
  }
  if (examples.length) {
    lines.push('## 对话示例');
    lines.push('');
    for (const ex of examples) {
      const role = ex.role || 'user';
      const content = (ex.content || '').toString();
      lines.push(`**${role}**:`);
      lines.push('');
      lines.push(content);
      lines.push('');
    }
  }
  // Opening message (if available)
  const opening = cfg.openingMessage && String(cfg.openingMessage).trim();
  const openingQs = Array.isArray(cfg.openingQuestions) ? cfg.openingQuestions.filter(Boolean) : [];
  if (opening || openingQs.length) {
    lines.push('## 开场');
    lines.push('');
    if (opening) {
      lines.push(opening);
      lines.push('');
    }
    if (openingQs.length) {
      for (const q of openingQs) lines.push(`- ${q}`);
      lines.push('');
    }
  }

  const out = join(OUT_DIR, `${stem}.md`);
  writeFileSync(out, lines.join('\n'), 'utf-8');
  written++;
}

console.log(`Wrote ${written} files to ${OUT_DIR}`);
if (skipped) console.log(`Skipped ${skipped} (duplicate stems)`);
if (failed) console.log(`Failed ${failed}`);
