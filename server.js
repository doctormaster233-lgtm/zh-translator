#!/usr/bin/env node
/**
 * Static server + translation proxy.
 * Primary: Google's public dict-chrome endpoint (no key).
 * Fallback: MyMemory (no key, 500 bytes/request).
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.join(__dirname, 'public');
const MAX_CHARS = 2000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

function fetchText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.request(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ZhTranslator/1.0)',
        Accept: 'application/json,text/plain,*/*',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 3) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        fetchText(next, redirects + 1).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) {
          const err = new Error('HTTP ' + res.statusCode);
          err.status = res.statusCode;
          err.body = body.slice(0, 180);
          reject(err);
        } else {
          resolve(body);
        }
      });
    });
    req.setTimeout(12000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

function langCode(code, which) {
  if (code === 'zh') return 'zh-CN';
  if (code === 'en') return which === 'mymemory' ? 'en' : 'en';
  throw new Error('Unsupported language');
}

function parseGoogle(data) {
  if (typeof data === 'string') return data;
  if (!Array.isArray(data) || !data.length) throw new Error('Unexpected Google response');
  if (typeof data[0] === 'string') return data.join('');
  return data.map((row) => (Array.isArray(row) ? row[0] || '' : String(row || ''))).join('');
}

function chunkChars(text, max) {
  if (text.length <= max) return [text];
  const parts = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + max);
    if (end < text.length) {
      const slice = text.slice(i, end);
      const breaks = ['\n', '。', '！', '？', '. ', '! ', '? ', '；', '; '];
      let cut = -1;
      for (const b of breaks) {
        const at = slice.lastIndexOf(b);
        if (at > cut) cut = at;
      }
      if (cut > max * 0.4) end = i + cut + 1;
    }
    parts.push(text.slice(i, end));
    i = end;
  }
  return parts;
}

function chunkBytes(text, maxBytes) {
  const parts = [];
  let buf = '';
  let bytes = 0;
  for (const ch of text) {
    const n = Buffer.byteLength(ch);
    if (buf && bytes + n > maxBytes) {
      parts.push(buf);
      buf = '';
      bytes = 0;
    }
    buf += ch;
    bytes += n;
  }
  if (buf) parts.push(buf);
  return parts;
}

async function translateGoogle(q, from, to) {
  const sl = langCode(from);
  const tl = langCode(to);
  const url = 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl='
    + encodeURIComponent(sl) + '&tl=' + encodeURIComponent(tl) + '&q=' + encodeURIComponent(q);
  const body = await fetchText(url);
  let data;
  try { data = JSON.parse(body); } catch (e) { throw new Error('Google returned non-JSON'); }
  const text = parseGoogle(data).trim();
  if (!text) throw new Error('Empty Google translation');
  return text;
}

async function translateMyMemory(q, from, to) {
  const pair = langCode(from, 'mymemory') + '|' + langCode(to, 'mymemory');
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(q) + '&langpair=' + encodeURIComponent(pair);
  const body = await fetchText(url);
  let data;
  try { data = JSON.parse(body); } catch (e) { throw new Error('MyMemory returned non-JSON'); }
  const text = data && data.responseData && data.responseData.translatedText;
  if (!text || data.responseStatus !== 200 || /MYMEMORY WARNING|QUERY LENGTH|INVALID LANGUAGE PAIR/i.test(text)) {
    throw new Error((text && String(text).slice(0, 160)) || 'MyMemory failed');
  }
  return text;
}

async function translateAll(q, from, to) {
  const errors = [];
  try {
    const parts = chunkChars(q, 700);
    const out = [];
    for (const part of parts) out.push(await translateGoogle(part, from, to));
    return { text: out.join(''), provider: 'google' };
  } catch (e) {
    errors.push(e.message || String(e));
  }
  try {
    const parts = chunkBytes(q, 450);
    const out = [];
    for (const part of parts) out.push(await translateMyMemory(part, from, to));
    return { text: out.join(''), provider: 'mymemory', note: errors[0] || '' };
  } catch (e) {
    const err = new Error('Google: ' + (errors[0] || 'failed') + '. MyMemory: ' + (e.message || e));
    throw err;
  }
}

function sendJson(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  try { rel = decodeURIComponent(rel); } catch (e) {
    res.writeHead(400); res.end('Bad path'); return;
  }
  if (rel.includes('\0')) { res.writeHead(400); res.end('Bad path'); return; }
  const file = path.normalize(path.join(ROOT, rel));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(file).toLowerCase();
    const type = TYPES[ext] || 'application/octet-stream';
    const cache = ext === '.html' ? 'no-cache' : 'public, max-age=86400';
    const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '')
      && st.size > 800
      && /\.(js|css|json|html|svg|txt|md)$/.test(ext);
    const headers = { 'Content-Type': type, 'Cache-Control': cache };
    const stream = fs.createReadStream(file);
    stream.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); });
    if (!gz) {
      headers['Content-Length'] = st.size;
      res.writeHead(200, headers);
      stream.pipe(res);
      return;
    }
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
    res.writeHead(200, headers);
    stream.pipe(zlib.createGzip({ level: 6 })).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://127.0.0.1'); }
  catch (e) { res.writeHead(400); res.end('Bad request'); return; }

  if (req.method === 'OPTIONS' && url.pathname === '/api/translate') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (url.pathname === '/api/translate') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'Use GET' }); return; }
    const q = url.searchParams.get('q') || '';
    const from = url.searchParams.get('from') || 'zh';
    const to = url.searchParams.get('to') || 'en';
    if (!q.trim()) { sendJson(res, 400, { error: 'Missing q' }); return; }
    if (q.length > MAX_CHARS) { sendJson(res, 400, { error: 'Text is longer than ' + MAX_CHARS + ' characters' }); return; }
    if (!['zh', 'en'].includes(from) || !['zh', 'en'].includes(to) || from === to) {
      sendJson(res, 400, { error: 'from and to must be zh and en, and different' });
      return;
    }
    try {
      const result = await translateAll(q, from, to);
      sendJson(res, 200, { text: result.text, provider: result.provider, from, to });
    } catch (e) {
      sendJson(res, 502, { error: e.message || 'Translation failed' });
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end('Method not allowed'); return;
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log('Zh translator listening on http://' + HOST + ':' + PORT);
});
