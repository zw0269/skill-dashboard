import { createServer }                          from 'node:http';
import { readFileSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { join, resolve, extname, normalize, sep } from 'node:path';
import { fileURLToPath }                         from 'node:url';
import { exec }                                  from 'node:child_process';
import { platform }                               from 'node:os';
import { SKILL_ROOT, INDEX_FILE, runScan }       from './scanner.mjs';

const __dirname  = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = resolve(join(__dirname, 'public'));
const FEEDBACK_FILE = resolve(join(__dirname, 'feedback.md'));
const MAX_FEEDBACK = 8 * 1024;
const PORT       = 8082;
const START_TIME = Date.now();
const MAX_BODY   = 64 * 1024; // 64 KB request body limit
const MAX_FILE   = 2  * 1024 * 1024; // 2 MB file read limit

// ── MIME types ─────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
};

// ── Response helpers ────────────────────────────────────────────────────────

function setCommonHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function sendJson(res, data, status = 200) {
  setCommonHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendError(res, msg, status = 400) {
  sendJson(res, { error: msg }, status);
}

function send404(res) {
  sendJson(res, { error: 'Not found' }, 404);
}

function serveStatic(res, filePath) {
  if (!existsSync(filePath)) { send404(res); return; }
  const ext  = extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'text/plain; charset=utf-8';
  let body;
  try { body = readFileSync(filePath); }
  catch { sendError(res, 'Failed to read file', 500); return; }
  setCommonHeaders(res);
  res.writeHead(200, { 'Content-Type': mime });
  res.end(body);
}

// ── Security: safe path resolution ─────────────────────────────────────────

/**
 * Resolve raw (possibly URL-encoded) path and verify it lives inside SKILL_ROOT.
 * @param {string} raw
 * @returns {string|null}  absolute safe path, or null if invalid / outside root
 */
function safePath(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.includes('\0')) return null;
    const root = resolve(SKILL_ROOT);
    // Resolve relative to SKILL_ROOT so the committed index — which addresses
    // files by root-relative `id` — is portable across machines (e.g. scanned
    // on macOS under /Users/…, served on Linux under /var/www/…). Inputs that
    // are already absolute-under-root still pass; foreign-absolute paths and
    // ../ traversal resolve outside root and are rejected by the check below.
    const abs  = resolve(root, decoded);
    // Use path.sep (platform-native separator) to avoid Windows backslash vs '/' mismatch.
    // On Windows: sep = '\', so "E:\root\file".startsWith("E:\root\") works correctly.
    if (!abs.startsWith(root + sep) && abs !== root) return null;
    return abs;
  } catch {
    return null;
  }
}

// ── Request body reader ─────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new Error('Request body too large')); return; }
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ── Request logger ──────────────────────────────────────────────────────────

function log(method, pathname, status) {
  const time = new Date().toTimeString().slice(0, 8);
  const color = status >= 500 ? '\x1b[31m' : status >= 400 ? '\x1b[33m' : '\x1b[32m';
  console.log(`${time} ${color}${status}\x1b[0m ${method} ${pathname}`);
}

// ── Route handlers ──────────────────────────────────────────────────────────

async function handleIndex(req, res) {
  if (!existsSync(INDEX_FILE)) {
    console.log('  index.json missing — running initial scan...');
    try { runScan(); }
    catch (e) { sendError(res, `Scan failed: ${e.message}`, 500); return; }
  }
  serveStatic(res, INDEX_FILE);
}

async function handleRaw(req, res, url) {
  const rawPath = url.searchParams.get('path');
  if (!rawPath) { sendError(res, 'Missing ?path= param'); return; }

  const safe = safePath(rawPath);
  if (!safe) { sendError(res, 'Path outside skill root or invalid', 403); return; }
  if (!existsSync(safe)) { send404(res); return; }

  let stat;
  try { stat = statSync(safe); }
  catch { sendError(res, 'Cannot stat file', 500); return; }

  if (!stat.isFile()) { sendError(res, 'Not a file'); return; }
  if (stat.size > MAX_FILE) { sendError(res, 'File too large (>2 MB)'); return; }

  let content;
  try { content = readFileSync(safe, 'utf-8'); }
  catch { sendError(res, 'Cannot read file', 500); return; }

  sendJson(res, { content, size: stat.size, mtime: stat.mtimeMs });
}

async function handleRescan(req, res) {
  try {
    const entries = runScan();
    sendJson(res, { ok: true, total: entries.length, scannedAt: new Date().toISOString() });
  } catch (e) {
    console.error('Rescan error:', e);
    sendError(res, String(e.message || e), 500);
  }
}

async function handleOpen(req, res) {
  let body;
  try { body = await readBody(req); }
  catch (e) { sendError(res, e.message); return; }

  const safe = safePath(body.path || '');
  if (!safe) { sendError(res, 'Invalid path', 403); return; }

  // Cross-platform: reveal file in OS file manager
  const plat = platform();
  let cmd;
  if (plat === 'win32') {
    cmd = `explorer /select,"${safe.replace(/\//g, '\\')}"`;
  } else if (plat === 'darwin') {
    cmd = `open -R "${safe}"`;
  } else {
    // Linux: open containing directory (xdg-open has no "select file" flag)
    const dir = safe.replace(/[\/\\][^\/\\]*$/, '') || '/';
    cmd = `xdg-open "${dir}"`;
  }
  exec(cmd, (err) => {
    if (err) console.warn('  reveal failed:', err.message);
  });
  sendJson(res, { ok: true });
}

async function handleFeedback(req, res) {
  let body;
  try { body = await readBody(req); }
  catch (e) { sendError(res, e.message); return; }

  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) { sendError(res, 'Empty content'); return; }
  if (content.length > MAX_FEEDBACK) { sendError(res, 'Content too large'); return; }

  const ts    = new Date().toISOString();
  const entry = `## ${ts}\n\n${content}\n\n---\n\n`;

  try {
    if (!existsSync(FEEDBACK_FILE)) {
      appendFileSync(FEEDBACK_FILE, '# Feedback Log\n\n', 'utf-8');
    }
    appendFileSync(FEEDBACK_FILE, entry, 'utf-8');
  } catch (e) {
    sendError(res, 'Failed to write feedback: ' + e.message, 500);
    return;
  }
  sendJson(res, { ok: true, savedAt: ts });
}

async function handleHealth(req, res) {
  sendJson(res, {
    ok: true,
    port: PORT,
    uptime: Math.floor((Date.now() - START_TIME) / 1000),
    skillRoot: SKILL_ROOT,
  });
}

// ── Route table ─────────────────────────────────────────────────────────────
// To add a new route: push an entry here. No other changes needed.

const ROUTES = [
  { method: 'GET',  path: '/api/index',  handler: handleIndex  },
  { method: 'GET',  path: '/api/raw',    handler: handleRaw    },
  { method: 'POST', path: '/api/rescan', handler: handleRescan },
  { method: 'POST', path: '/api/open',     handler: handleOpen     },
  { method: 'POST', path: '/api/feedback', handler: handleFeedback },
  { method: 'GET',  path: '/api/health',   handler: handleHealth   },
];

// ── Request dispatcher ──────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  } catch {
    sendError(res, 'Malformed URL', 400);
    return;
  }

  const pathname = url.pathname;
  let status = 200;

  try {
    // Match API route
    const route = ROUTES.find(r => r.method === req.method && r.path === pathname);
    if (route) {
      await route.handler(req, res, url);
      status = res.statusCode || 200;
      log(req.method, pathname, status);
      return;
    }

    // OPTIONS preflight
    if (req.method === 'OPTIONS') {
      setCommonHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }

    // Static files
    if (req.method === 'GET') {
      const reqPath = pathname === '/' ? '/index.html' : pathname;
      const staticFile = resolve(join(PUBLIC_DIR, normalize(reqPath).replace(/^[/\\]+/, '')));

      // Directory traversal guard
      if (!staticFile.startsWith(PUBLIC_DIR)) {
        sendError(res, 'Forbidden', 403);
        log(req.method, pathname, 403);
        return;
      }

      serveStatic(res, staticFile);
      status = existsSync(staticFile) ? 200 : 404;
      log(req.method, pathname, status);
      return;
    }

    sendError(res, 'Not found', 404);
    log(req.method, pathname, 404);

  } catch (e) {
    console.error('Unhandled request error:', e);
    try { sendError(res, 'Internal server error', 500); } catch {}
    log(req.method, pathname, 500);
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use. Stop the other process or change PORT in server.mjs.\n`);
  } else {
    console.error('Server error:', e);
  }
  process.exit(1);
});

// ── Startup ─────────────────────────────────────────────────────────────────

if (!existsSync(INDEX_FILE)) {
  console.log('First run — scanning skills...');
  try { runScan(); }
  catch (e) { console.error('Initial scan failed:', e.message); }
}

server.listen(PORT, '0.0.0.0', () => { 
  console.log(`\n  Skill Dashboard  →  http://localhost:${PORT}\n`);

});