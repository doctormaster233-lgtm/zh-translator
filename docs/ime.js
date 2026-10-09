/* Offline pinyin IME + tone-mark annotation. Works in the browser and in Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ZhIme = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SYLLABLES = (
    'a ai an ang ao e ei en eng er o ou ' +
    'ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu ' +
    'pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu ' +
    'ma mai man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu ' +
    'fa fan fang fei fen feng fo fou fu ' +
    'da dai dan dang dao de dei den deng di dia dian diao die ding diu dong dou du duan dui dun duo ' +
    'ta tai tan tang tao te tei teng ti tian tiao tie ting tong tou tu tuan tui tun tuo ' +
    'na nai nan nang nao ne nei nen neng ni nian niang niao nie nin ning niu nong nou nu nuan nve nue nun nuo nv ' +
    'la lai lan lang lao le lei leng li lia lian liang liao lie lin ling liu lo long lou lu luan lve lue lun luo lv ' +
    'ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo ' +
    'ka kai kan kang kao ke kei ken keng kong kou ku kua kuai kuan kuang kui kun kuo ' +
    'ha hai han hang hao he hei hen heng hong hou hu hua huai huan huang hui hun huo ' +
    'za zai zan zang zao ze zei zen zeng zha zhai zhan zhang zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi zong zou zu zuan zui zun zuo ' +
    'ca cai can cang cao ce cen ceng cha chai chan chang chao che chen cheng chi chong chou chu chua chuai chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo ' +
    'sa sai san sang sao se sen seng sha shai shan shang shao she shei shen sheng shi shou shu shua shuai shuan shuang shui shun shuo si song sou su suan sui sun suo ' +
    'ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun ' +
    'qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun ' +
    'xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun ' +
    'ya yan yang yao ye yi yin ying yo yong you yu yuan yue yun ' +
    'wa wai wan wang wei wen weng wo wu ' +
    'r ran rang rao re ren reng ri rong rou ru rua ruan rui run ruo'
  ).split(/\s+/);

  const SYL = new Set(SYLLABLES);
  const PREF = new Set();
  SYLLABLES.forEach((s) => {
    for (let i = 1; i <= s.length; i++) PREF.add(s.slice(0, i));
  });

  const VOWEL_MARKS = {
    a: ['a', 'ā', 'á', 'ǎ', 'à'],
    e: ['e', 'ē', 'é', 'ě', 'è'],
    i: ['i', 'ī', 'í', 'ǐ', 'ì'],
    o: ['o', 'ō', 'ó', 'ǒ', 'ò'],
    u: ['u', 'ū', 'ú', 'ǔ', 'ù'],
    ü: ['ü', 'ǖ', 'ǘ', 'ǚ', 'ǜ'],
  };

  let entries = [];
  let wordBest = new Map();

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

  function isHanChar(ch) {
    const c = ch.codePointAt(0);
    return (c >= 0x3400 && c <= 0x9fff) || (c >= 0x20000 && c <= 0x2ceaf);
  }

  function normalizeUser(raw) {
    const s = String(raw || '').toLowerCase().replace(/ü/g, 'v').replace(/u:/g, 'v');
    let key = '';
    let tones = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c >= 'a' && c <= 'z') key += c;
      else if (c >= '1' && c <= '5') tones += c;
    }
    key = key.replace(/lue/g, 'lve').replace(/nue/g, 'nve');
    return { key, tones };
  }

  function load(data) {
    const src = (data && data.e) || data || [];
    entries = src.map((row) => ({
      k: row[0],
      w: row[1],
      p: row[2],
      f: row[3] || 0,
      t: row[4] || '',
    }));
    if (entries.length && entries[0].k > entries[entries.length - 1].k) {
      entries.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : b.f - a.f));
    }
    wordBest = new Map();
    for (const e of entries) {
      const prev = wordBest.get(e.w);
      if (!prev || e.f > prev.f) wordBest.set(e.w, e);
    }
    return { entries: entries.length, words: wordBest.size };
  }

  function lowerBound(key) {
    let lo = 0;
    let hi = entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (entries[mid].k < key) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function candidates(raw, limit) {
    const lim = limit || 9;
    const { key, tones } = normalizeUser(raw);
    if (!key || !entries.length) return [];
    const found = [];
    for (let i = lowerBound(key); i < entries.length; i++) {
      const e = entries[i];
      if (!e.k.startsWith(key)) break;
      const extra = e.k.length - key.length;
      if (extra > 0 && e.f === 0 && extra > 3) continue;
      let score = e.f;
      if (e.k === key) score += 1e15;
      if (tones && e.k === key) {
        if (e.t === tones) score += 1e13;
        else if (e.t.startsWith(tones)) score += 1e12;
      }
      found.push({ word: e.w, pinyin: e.p, key: e.k, freq: e.f, tones: e.t, score, extra });
    }
    found.sort((a, b) => b.score - a.score || a.extra - b.extra || b.freq - a.freq || (a.word < b.word ? -1 : 1));
    const seen = new Set();
    const out = [];
    for (const item of found) {
      const id = item.word + '\t' + item.pinyin;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(item);
      if (out.length >= lim) break;
    }
    return out;
  }

  function pathScore(entry, len) {
    if (!entry) return -4;
    if (len <= 1) return Math.log(Math.max(entry.f, 1)) * 0.18;
    if (entry.f > 0) return Math.log(entry.f) + 8 * len;
    return 2.2 * len;
  }

  function annotate(text) {
    const s = String(text || '');
    const chars = Array.from(s);
    const n = chars.length;
    if (!n) return [];
    const NEG = -1e15;
    const dp = new Array(n + 1).fill(NEG);
    const back = new Array(n + 1).fill(0);
    const pick = new Array(n + 1).fill(null);
    dp[0] = 0;
    const MAXW = 12;
    for (let i = 0; i < n; i++) {
      if (dp[i] === NEG) continue;
      if (!isHanChar(chars[i])) {
        const sc = dp[i];
        if (sc > dp[i + 1]) {
          dp[i + 1] = sc;
          back[i + 1] = i;
          pick[i + 1] = null;
        }
        continue;
      }
      const maxLen = Math.min(MAXW, n - i);
      for (let len = 1; len <= maxLen; len++) {
        if (len > 1 && !isHanChar(chars[i + len - 1])) break;
        let hanCount = 0;
        for (let k = 0; k < len; k++) if (isHanChar(chars[i + k])) hanCount++;
        if (hanCount !== len) break;
        const w = chars.slice(i, i + len).join('');
        const entry = wordBest.get(w) || null;
        if (len > 1 && !entry) continue;
        const sc = dp[i] + pathScore(entry, len);
        if (sc > dp[i + len]) {
          dp[i + len] = sc;
          back[i + len] = i;
          pick[i + len] = entry || { w, p: '', f: 0 };
        }
      }
    }
    const spans = [];
    let i = n;
    while (i > 0) {
      const start = dp[i] === NEG ? i - 1 : back[i];
      const from = dp[i] === NEG ? i - 1 : start;
      spans.push({ from, to: i, entry: pick[i] });
      i = from;
    }
    spans.reverse();
    return spans.map((span) => {
      const textPart = chars.slice(span.from, span.to).join('');
      if (!span.entry) return { text: textPart, pinyin: '', parts: [] };
      const py = span.entry.p || '';
      const bits = py ? py.split(/\s+/) : [];
      const han = Array.from(textPart).filter(isHanChar);
      const parts = bits.length === han.length ? bits : [];
      return { text: textPart, pinyin: py, parts };
    });
  }

  function pinyinLine(text) {
    return annotate(text)
      .map((seg) => seg.pinyin)
      .filter(Boolean)
      .join(' ');
  }

  function segmentComposition(raw) {
    const s = String(raw || '').toLowerCase().replace(/ü/g, 'v').replace(/u:/g, 'v');
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === ' ' || c === "'" || c === '-') {
        out.push({ sep: true, ch: c === '-' ? ' ' : c === ' ' ? ' ' : "'" });
        i++;
        continue;
      }
      if (c >= '1' && c <= '5') {
        const prev = out.length ? out[out.length - 1] : null;
        if (prev && !prev.sep && !prev.tone) {
          prev.tone = c;
          prev.marked = applyTone(prev.syl, c);
        } else {
          out.push({ stray: c });
        }
        i++;
        continue;
      }
      if (!(c >= 'a' && c <= 'z')) {
        i++;
        continue;
      }
      let bestLen = 0;
      let prefixLen = 0;
      let chunk = '';
      const max = Math.min(6, s.length - i);
      for (let len = 1; len <= max; len++) {
        const ch = s[i + len - 1];
        if (!(ch >= 'a' && ch <= 'z')) break;
        chunk += ch;
        if (!PREF.has(chunk)) break;
        prefixLen = len;
        if (SYL.has(chunk)) bestLen = len;
      }
      if (!prefixLen) {
        out.push({ syl: c, partial: true, marked: c, tone: '' });
        i++;
        continue;
      }
      const take = prefixLen > bestLen ? prefixLen : bestLen;
      const syl = s.slice(i, i + take);
      const partial = prefixLen > bestLen || bestLen === 0;
      i += take;
      let tone = '';
      if (i < s.length && s[i] >= '1' && s[i] <= '5') {
        tone = s[i];
        i++;
      }
      out.push({
        syl,
        partial,
        tone,
        marked: partial && !tone ? syl : applyTone(syl, tone),
      });
    }
    return out;
  }

  function compositionPinyin(raw) {
    return segmentComposition(raw)
      .map((seg) => (seg.sep ? '' : seg.stray ? '' : seg.marked))
      .filter(Boolean)
      .join(' ');
  }

  /**
   * If a chosen dictionary key is a proper prefix of what the user typed,
   * return the unused tail of the raw composition (so 你 + leftover hao stays).
   * Longer predictions consume the whole composition (returns '').
   */
  function remainderAfterPick(raw, pickedKey) {
    const { key } = normalizeUser(raw);
    if (!pickedKey || !key.startsWith(pickedKey) || pickedKey.length >= key.length) return '';
    let left = pickedKey.length;
    let i = 0;
    const s = String(raw);
    while (i < s.length && left > 0) {
      const c = s[i];
      if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === 'ü' || c === 'v' || c === 'V') {
        left--;
      }
      i++;
    }
    if (i < s.length && s[i] >= '1' && s[i] <= '5') i++;
    return s.slice(i).replace(/^[\s'\-]+/, '');
  }

  function ready() {
    return entries.length > 0;
  }

  return {
    load,
    candidates,
    annotate,
    pinyinLine,
    normalizeUser,
    applyTone,
    segmentComposition,
    compositionPinyin,
    remainderAfterPick,
    ready,
  };
});
