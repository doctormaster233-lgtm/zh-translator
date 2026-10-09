#!/usr/bin/env node
/**
 * Build public/dict.json from CC-CEDICT + a word-frequency list.
 * CC-CEDICT is CC BY-SA 4.0. See NOTICE.md.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CEDICT = path.join(ROOT, 'data', 'cedict.txt');
const FREQ = path.join(ROOT, 'data', 'zh_50k.txt');
const OUT = path.join(ROOT, 'public', 'dict.json');

const VOWEL_MARKS = {
  a: ['a', 'ā', 'á', 'ǎ', 'à'],
  e: ['e', 'ē', 'é', 'ě', 'è'],
  i: ['i', 'ī', 'í', 'ǐ', 'ì'],
  o: ['o', 'ō', 'ó', 'ǒ', 'ò'],
  u: ['u', 'ū', 'ú', 'ǔ', 'ù'],
  ü: ['ü', 'ǖ', 'ǘ', 'ǚ', 'ǜ'],
};

function toneVowelIndex(s) {
  const a = s.indexOf('a');
  if (a >= 0) return a;
  const e = s.indexOf('e');
  if (e >= 0) return e;
  const ou = s.indexOf('ou');
  if (ou >= 0) return ou;
  let idx = -1;
  for (let i = 0; i < s.length; i++) {
    if ('aeiouü'.includes(s[i])) idx = i;
  }
  return idx;
}

function applyTone(base, tone) {
  let s = String(base || '').toLowerCase();
  if (s.startsWith('lv')) s = 'lü' + s.slice(2);
  else if (s.startsWith('nv')) s = 'nü' + s.slice(2);
  else s = s.replace(/u:/g, 'ü').replace(/v/g, 'ü');
  if (/^[jqxy]ü/.test(s)) s = s.replace('ü', 'u');
  const t = Number(tone);
  if (!t || t === 5 || t < 1 || t > 4) return s;
  const idx = toneVowelIndex(s);
  if (idx < 0) return s;
  const marks = VOWEL_MARKS[s[idx]];
  if (!marks) return s;
  return s.slice(0, idx) + marks[t] + s.slice(idx + 1);
}

function isPureHan(s) {
  return /^[\u3400-\u9fff·]+$/.test(s) && /[\u3400-\u9fff]/.test(s);
}

function parsePinyin(field) {
  const parts = field.trim().split(/\s+/);
  let key = '';
  let tones = '';
  const marked = [];
  for (const part of parts) {
    const m = part.match(/^([A-Za-z:ü]+)([1-5])?$/);
    if (!m) return null;
    let base = m[1].toLowerCase().replace(/u:/g, 'v').replace(/ü/g, 'v');
    if (!base) return null;
    const tone = m[2] || '5';
    key += base;
    tones += tone;
    marked.push(applyTone(base, tone));
  }
  if (!key) return null;
  return { key, tones, marked: marked.join(' '), syls: marked };
}

const freq = new Map();
for (const line of fs.readFileSync(FREQ, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const sp = line.indexOf(' ');
  if (sp < 0) continue;
  const w = line.slice(0, sp).trim();
  const n = parseInt(line.slice(sp + 1), 10);
  if (w && Number.isFinite(n)) freq.set(w, n);
}

// char -> Map(markedPinyin -> vote). Votes come from aligned multi-char words
// and from the single-character frequency list once we know the winning reading.
const votes = new Map();
function addVote(ch, py, w) {
  let m = votes.get(ch);
  if (!m) {
    m = new Map();
    votes.set(ch, m);
  }
  m.set(py, (m.get(py) || 0) + w);
}

const dedup = new Map();
let skipped = 0;
let parsed = 0;

for (const line of fs.readFileSync(CEDICT, 'utf8').split('\n')) {
  if (!line || line.startsWith('#') || line.startsWith('#!')) continue;
  const m = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]/);
  if (!m) {
    skipped++;
    continue;
  }
  const word = m[2];
  if (!isPureHan(word)) {
    skipped++;
    continue;
  }
  const py = parsePinyin(m[3]);
  if (!py) {
    skipped++;
    continue;
  }
  parsed++;
  const listed = freq.get(word) || 0;
  const han = Array.from(word).filter((ch) => ch !== '·');
  const aligned = py.syls.length === han.length;
  if (aligned && word.length > 1) {
    const weight = Math.max(listed, 1);
    let si = 0;
    for (const ch of word) {
      if (ch === '·') continue;
      addVote(ch, py.syls[si], weight);
      si++;
    }
  }
  const id = word + '\t' + py.key + '\t' + py.tones;
  const prev = dedup.get(id);
  if (!prev || listed > prev.listed) {
    dedup.set(id, {
      k: py.key,
      w: word,
      p: py.marked,
      listed,
      t: py.tones,
      syls: py.syls,
      aligned,
    });
  }
}

// Winning reading per character.
const bestChar = new Map();
for (const [ch, m] of votes) {
  let bestPy = '';
  let bestV = -1;
  for (const [py, v] of m) {
    if (v > bestV) {
      bestV = v;
      bestPy = py;
    }
  }
  bestChar.set(ch, bestPy);
}

// Single-character lines that never appeared inside a word still need a reading.
for (const e of dedup.values()) {
  if (e.w.length === 1 && !bestChar.has(e.w)) bestChar.set(e.w, e.p);
}

const entries = [];
for (const e of dedup.values()) {
  let f = e.listed;
  if (e.w.length === 1) {
    const voteMap = votes.get(e.w);
    const vote = (voteMap && voteMap.get(e.p)) || 0;
    const listedChar = freq.get(e.w) || 0;
    const winner = bestChar.get(e.w) === e.p;
    f = vote + (winner ? listedChar : 0);
    if (f <= 0) f = 1;
  }
  entries.push([e.k, e.w, e.p, f, e.t]);
}

entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : b[3] - a[3]));

const payload = {
  license: 'Dictionary data derived from CC-CEDICT (CC BY-SA 4.0) with frequency ranks from hermitdave/FrequencyWords (OpenSubtitles).',
  built: new Date().toISOString(),
  count: entries.length,
  // [pinyin key, simplified word, tone-marked pinyin, frequency, tone digits]
  e: entries,
};

fs.writeFileSync(OUT, JSON.stringify(payload));
const bytes = fs.statSync(OUT).size;
console.log(JSON.stringify({
  parsed,
  skipped,
  entries: entries.length,
  chars: bestChar.size,
  bytes,
  mb: +(bytes / 1048576).toFixed(2),
}, null, 2));
