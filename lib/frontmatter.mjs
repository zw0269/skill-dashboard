/**
 * lib/frontmatter.mjs
 * Zero-dependency YAML frontmatter parser + text extraction helpers.
 *
 * Supported YAML features:
 *   - String values (bare / single-quoted / double-quoted)
 *   - Block scalars: literal (|) and folded (>)
 *   - Inline arrays: [a, b, c]
 *   - Block arrays:
 *       key:
 *         - item1
 *         - item2
 *   - Numbers (kept as strings for simplicity)
 *   - Comments (#)
 *
 * Intentionally NOT supported (not needed for SKILL.md):
 *   - Nested maps  { key: { nested: value } }
 *   - Multi-document (---)
 *   - Anchors / aliases
 *
 * Extension point: If a new SKILL.md format needs a new YAML feature,
 * add a case in parseSimpleYaml() and document it above.
 */

/**
 * Split a markdown file into { data, body }.
 * @param {string} content - raw file content
 * @returns {{ data: Record<string,any>, body: string }}
 */
export function parseFrontmatter(content) {
  // Must start with --- (allow optional BOM)
  const stripped = content.startsWith('\uFEFF') ? content.slice(1) : content;
  if (!stripped.startsWith('---')) return { data: {}, body: stripped };

  // Find closing ---  (must be on its own line)
  const end = stripped.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: stripped };

  const yamlStr = stripped.slice(4, end).trimEnd();
  const body = stripped.slice(end + 4).replace(/^\n/, '');
  return { data: parseSimpleYaml(yamlStr), body };
}

function parseSimpleYaml(text) {
  const result = {};
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip blanks and comments
    if (!trimmed || trimmed.startsWith('#')) { i++; continue; }

    const m = line.match(/^([a-zA-Z0-9_\-]+)\s*:\s*(.*)/);
    if (!m) { i++; continue; }

    const key = m[1];
    const val = m[2].trim();

    // ── Block scalar  key: |  or  key: >
    if (val === '|' || val === '>') {
      i++;
      // Determine indentation from first non-empty line
      let indent = 2;
      while (i < lines.length && !lines[i].trim()) i++; // skip blank lines before content
      if (i < lines.length) {
        const indentMatch = lines[i].match(/^(\s+)/);
        indent = indentMatch ? indentMatch[1].length : 2;
      }
      const blockLines = [];
      while (i < lines.length) {
        const bl = lines[i];
        if (!bl.trim()) { blockLines.push(''); i++; continue; }
        if (bl.startsWith(' '.repeat(indent)) || bl.startsWith('\t')) {
          blockLines.push(bl.slice(indent)); i++;
        } else break;
      }
      // Trim trailing empty lines
      while (blockLines.length && !blockLines[blockLines.length - 1].trim()) blockLines.pop();
      result[key] = blockLines.join('\n');
      continue;
    }

    // ── Inline array  key: [a, b, c]
    if (val.startsWith('[')) {
      // Handle multi-character closing bracket (malformed but defensive)
      const close = val.lastIndexOf(']');
      const inner = close > 0 ? val.slice(1, close) : val.slice(1);
      result[key] = inner
        ? inner.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
        : [];
      i++; continue;
    }

    // ── Empty value — may be followed by block list
    if (val === '') {
      i++;
      const items = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        const item = lines[i].replace(/^\s*-\s+/, '').trim().replace(/^['"]|['"]$/g, '');
        items.push(item);
        i++;
      }
      result[key] = items.length ? items : null;
      continue;
    }

    // ── Simple scalar value
    result[key] = val.replace(/^['"]|['"]$/g, '');
    i++;
  }

  return result;
}

/**
 * Extract the first meaningful paragraph from markdown body.
 * Skips headings, fences, front-matter remnants, and blockquotes.
 * @param {string} body
 * @returns {string}  up to 400 chars
 */
export function extractFirstParagraph(body) {
  const lines = body.split('\n');
  const para = [];
  let started = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (started) break;
      continue;
    }
    // Skip structural lines
    if (
      trimmed.startsWith('#') ||
      trimmed.startsWith('---') ||
      trimmed.startsWith('```') ||
      trimmed.startsWith('|') ||
      trimmed.startsWith('>')
    ) {
      if (started) break;
      continue;
    }
    para.push(trimmed);
    started = true;
    if (para.join(' ').length > 300) break;
  }

  return para.join(' ').slice(0, 400);
}

/**
 * Extract short trigger keywords/phrases from a skill description.
 * Only keeps phrases ≤ 35 chars. Used as hover hints on cards.
 * @param {string} text
 * @returns {string[]}  up to 6 items
 */
export function extractTriggerKeywords(text) {
  if (!text) return [];
  const raw = new Set();

  // Quoted short phrases: "keyword"  or  'keyword'
  for (const m of text.matchAll(/["']([^"'\n]{3,35})["']/g)) {
    raw.add(m[1].trim().toLowerCase());
  }

  // "Use when asked to X" — grab only the verb phrase before a comma or period
  for (const m of text.matchAll(/asked to ["']?([^"',.\n]{3,35})["']?/gi)) {
    raw.add(m[1].trim().toLowerCase());
  }

  // "Proactively suggest when X" — grab after "when"
  for (const m of text.matchAll(/suggest when (.{3,35}?)(?:[.,\n]|$)/gi)) {
    raw.add(m[1].trim().toLowerCase());
  }

  // Filter: remove generic single words and overly long entries
  return [...raw]
    .filter(k => k.length >= 3 && k.length <= 35 && k.split(' ').length >= 1)
    .slice(0, 6);
}

/**
 * Normalize a frontmatter value to an array of strings.
 * Handles: null, string, string[].
 * @param {any} val
 * @returns {string[]}
 */
export function normalizeArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  if (typeof val === 'string') return val ? [val] : [];
  return [];
}
