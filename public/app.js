/* Chinese ↔ English translator UI. Dictionary is local; translation is remote. */
(function () {
  const MAX = 2000;
  const $ = (id) => document.getElementById(id);

  const fromSel = $('from');
  const toSel = $('to');
  const src = $('src');
  const outEl = $('out');
  const candEl = $('cand');
  const srcPy = $('src-py');
  const outPy = $('out-py');
  const hint = $('hint');
  const statusEl = $('status');
  const provEl = $('prov');
  const countEl = $('count');
  const micBtn = $('mic');
  const srcWho = $('src-who');
  const outWho = $('out-who');

  const state = {
    comp: '',
    highlight: 0,
    cands: [],
    lastDigit: null,
    listening: false,
    recog: null,
    micBase: '',
    req: 0,
    timer: null,
    abort: null,
  };

  function setStatus(msg) {
    statusEl.textContent = msg || '';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function sourceIsZh() { return fromSel.value === 'zh'; }
  function targetIsZh() { return toSel.value === 'zh'; }

  function other(lang) { return lang === 'zh' ? 'en' : 'zh'; }

  function langName(code) { return code === 'zh' ? '中文' : 'English'; }

  function updateChrome() {
    srcWho.textContent = langName(fromSel.value);
    outWho.textContent = langName(toSel.value);
    src.placeholder = sourceIsZh()
      ? 'Type pinyin — nihao or ni3hao3 — or paste Chinese'
      : 'Type English, or use the microphone';
    hint.textContent = sourceIsZh()
      ? 'Type nihao or ni3hao3. Space inserts the first match. 1–9 chooses one — if the syllable has no tone yet, 1–5 sets the tone (press that number again to choose). Shift+number always chooses. Apostrophe splits syllables: xi\'an.'
      : 'Switch From to 中文 to type with pinyin. Microphone dictation works in Chrome, Edge, and Safari.';
    if (!sourceIsZh() && state.comp) clearComp();
    else renderCand();
  }

  function enforcePair(changed) {
    if (fromSel.value === toSel.value) {
      if (changed === 'from') toSel.value = other(fromSel.value);
      else fromSel.value = other(toSel.value);
    }
    updateChrome();
    renderPy(srcPy, src.value);
    scheduleTranslate(0);
  }

  // Google-Translate-style pinyin: the whole sentence on one readable line,
  // words grouped, punctuation kept, sentences capitalised ('Wǒ hěn huānyíng nǐ.').
  function pinyinBlock(text) {
    if (!window.ZhIme || !ZhIme.ready() || !text) return '';
    const line = ZhIme.sentencePinyin(text);
    if (!line) return '';
    return '<p class="py-line" lang="zh-Latn-pinyin">' + escapeHtml(line) + '</p>';
  }

  function renderPy(el, text) {
    const html = pinyinBlock(text);
    if (!html) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    el.innerHTML = html;
  }

  function renderCand() {
    if (!state.comp || !sourceIsZh()) {
      candEl.hidden = true;
      candEl.innerHTML = '';
      return;
    }
    const marked = window.ZhIme ? ZhIme.compositionPinyin(state.comp) : state.comp;
    const buttons = state.cands.map((c, i) => {
      const active = i === state.highlight ? ' active' : '';
      return '<button type="button" class="' + active.trim() + '" data-i="' + (i + 1) + '" aria-selected="' + (i === state.highlight) + '">'
        + '<span class="n">' + (i + 1) + '</span>'
        + '<span class="w">' + escapeHtml(c.word) + '</span>'
        + '<span class="p">' + escapeHtml(c.pinyin) + '</span>'
        + '</button>';
    }).join('');
    const list = buttons || '<p class="cand-empty">No matches — Space inserts the pinyin as typed.</p>';
    candEl.hidden = false;
    candEl.innerHTML = '<div class="cand-pre"><strong>' + escapeHtml(marked || state.comp) + '</strong><span>' + escapeHtml(state.comp) + '</span></div>'
      + '<div class="cand-list" role="listbox">' + list + '</div>';
  }

  function refreshComp() {
    state.cands = (window.ZhIme && ZhIme.ready() && state.comp) ? ZhIme.candidates(state.comp, 9) : [];
    if (state.highlight >= state.cands.length) state.highlight = 0;
    renderCand();
  }

  function clearComp() {
    state.comp = '';
    state.cands = [];
    state.highlight = 0;
    state.lastDigit = null;
    renderCand();
  }

  function insertAtCaret(text) {
    const a = src.selectionStart != null ? src.selectionStart : src.value.length;
    const b = src.selectionEnd != null ? src.selectionEnd : src.value.length;
    const next = src.value.slice(0, a) + text + src.value.slice(b);
    if (next.length > MAX) {
      setStatus('Limit is ' + MAX + ' characters.');
      return false;
    }
    src.value = next;
    const pos = a + text.length;
    src.focus();
    src.setSelectionRange(pos, pos);
    return true;
  }

  function afterEdit() {
    countEl.textContent = String(src.value.length);
    renderPy(srcPy, src.value);
    scheduleTranslate(300);
  }

  function pick(n) {
    if (!state.comp) return;
    const item = state.cands[n - 1];
    if (!item) {
      if (n === 1) {
        insertAtCaret(state.comp.replace(/[0-9']/g, ''));
        clearComp();
        afterEdit();
      }
      return;
    }
    const rest = window.ZhIme ? ZhIme.remainderAfterPick(state.comp, item.key) : '';
    if (!insertAtCaret(item.word)) return;
    state.lastDigit = null;
    state.highlight = 0;
    state.comp = rest;
    refreshComp();
    afterEdit();
  }

  function armKeyed() {
    state.justKeyed = true;
    setTimeout(function () { state.justKeyed = false; }, 0);
  }

  function digitFromEvent(e) {
    const m = /^Digit([1-9])$/.exec(e.code || '');
    if (m) return Number(m[1]);
    if (/^[1-9]$/.test(e.key)) return Number(e.key);
    return 0;
  }

  function canAcceptTone(comp, n) {
    return n >= 1 && n <= 5 && /[a-zA-Züv]$/.test(comp);
  }

  function onDigit(n, shift) {
    if (shift) {
      state.lastDigit = null;
      pick(n);
      return;
    }
    const now = Date.now();
    if (state.lastDigit && state.lastDigit.n === n && now - state.lastDigit.t < 550 && state.comp === state.lastDigit.after) {
      state.comp = state.lastDigit.before;
      state.lastDigit = null;
      state.highlight = 0;
      refreshComp();
      pick(n);
      return;
    }
    if (!canAcceptTone(state.comp, n)) {
      state.lastDigit = null;
      pick(n);
      return;
    }
    const before = state.comp;
    state.comp += String(n);
    state.lastDigit = { n, t: now, before, after: state.comp };
    state.highlight = 0;
    refreshComp();
  }

  function onKeyDown(e) {
    if (!sourceIsZh()) return;
    if (e.isComposing || e.key === 'Process') return;
    if (e.ctrlKey || e.metaKey) return;

    if (e.altKey) {
      const d = digitFromEvent(e);
      if (d && state.comp) {
        e.preventDefault();
      armKeyed();
        pick(d);
      }
      return;
    }

    if (e.key === 'Backspace' && state.comp) {
      e.preventDefault();
      armKeyed();
      state.comp = state.comp.slice(0, -1);
      state.lastDigit = null;
      state.highlight = 0;
      refreshComp();
      return;
    }
    if (e.key === 'Escape' && state.comp) {
      e.preventDefault();
      armKeyed();
      clearComp();
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && state.comp && state.cands.length) {
      e.preventDefault();
      armKeyed();
      state.highlight = (state.highlight + 1) % state.cands.length;
      renderCand();
      return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') && state.comp && state.cands.length) {
      e.preventDefault();
      armKeyed();
      state.highlight = (state.highlight + state.cands.length - 1) % state.cands.length;
      renderCand();
      return;
    }
    if ((e.key === ' ' || e.key === 'Enter') && state.comp) {
      e.preventDefault();
      armKeyed();
      pick(state.highlight + 1);
      return;
    }

    const d = digitFromEvent(e);
    if (d && state.comp) {
      e.preventDefault();
      armKeyed();
      onDigit(d, e.shiftKey);
      return;
    }

    if (/^[a-z]$/i.test(e.key) && e.key.length === 1) {
      e.preventDefault();
      armKeyed();
      armKeyed();
      state.comp += e.key.toLowerCase();
      state.lastDigit = null;
      state.highlight = 0;
      refreshComp();
    } else if (e.key === "'" && state.comp) {
      e.preventDefault();
      armKeyed();
      armKeyed();
      state.comp += "'";
      state.lastDigit = null;
      refreshComp();
    }
  }

  function onBeforeInput(e) {
    if (!sourceIsZh()) return;
    if (state.justKeyed) {
      state.justKeyed = false;
      if (e.cancelable) e.preventDefault();
      return;
    }
    if (e.inputType === 'deleteContentBackward' && state.comp) {
      e.preventDefault();
      state.comp = state.comp.slice(0, -1);
      state.lastDigit = null;
      state.highlight = 0;
      refreshComp();
      return;
    }
    if (e.inputType !== 'insertText' || !e.data) return;
    const data = e.data;
    if (/^[a-zA-Z']+$/.test(data)) {
      e.preventDefault();
      state.comp += data.toLowerCase();
      state.lastDigit = null;
      state.highlight = 0;
      refreshComp();
      return;
    }
    if (data === ' ' && state.comp) {
      e.preventDefault();
      pick(state.highlight + 1);
      return;
    }
    if (/^[1-9]$/.test(data) && state.comp) {
      e.preventDefault();
      onDigit(Number(data), false);
    }
  }

  function chunkChars(text, max) {
    if (text.length <= max) return [text];
    const parts = [];
    let i = 0;
    while (i < text.length) {
      let end = Math.min(text.length, i + max);
      if (end < text.length) {
        const slice = text.slice(i, end);
        let cut = -1;
        ['\n', '。', '！', '？', '. ', '! ', '? '].forEach((b) => {
          const at = slice.lastIndexOf(b);
          if (at > cut) cut = at;
        });
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
      const n = new Blob([ch]).size;
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

  function parseGoogle(data) {
    if (typeof data === 'string') return data;
    if (!Array.isArray(data) || !data.length) throw new Error('Unexpected translation response');
    if (typeof data[0] === 'string') return data.join('');
    return data.map((row) => (Array.isArray(row) ? row[0] || '' : String(row || ''))).join('');
  }

  async function googleDirect(q, from, to, signal) {
    const sl = from === 'zh' ? 'zh-CN' : 'en';
    const tl = to === 'zh' ? 'zh-CN' : 'en';
    const parts = chunkChars(q, 700);
    const out = [];
    for (const part of parts) {
      const url = 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl='
        + encodeURIComponent(sl) + '&tl=' + encodeURIComponent(tl) + '&q=' + encodeURIComponent(part);
      const r = await fetch(url, { signal, headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('Google HTTP ' + r.status);
      const text = parseGoogle(await r.json()).trim();
      if (!text) throw new Error('Empty translation');
      out.push(text);
    }
    return out.join('');
  }

  async function memoryDirect(q, from, to, signal) {
    const pair = (from === 'zh' ? 'zh-CN' : 'en') + '|' + (to === 'zh' ? 'zh-CN' : 'en');
    const parts = chunkBytes(q, 450);
    const out = [];
    for (const part of parts) {
      const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(part) + '&langpair=' + encodeURIComponent(pair);
      const r = await fetch(url, { signal });
      if (!r.ok) throw new Error('MyMemory HTTP ' + r.status);
      const data = await r.json();
      const text = data && data.responseData && data.responseData.translatedText;
      if (!text || data.responseStatus !== 200 || /MYMEMORY WARNING|QUERY LENGTH|INVALID LANGUAGE PAIR/i.test(text)) {
        throw new Error((text && String(text).slice(0, 140)) || 'MyMemory failed');
      }
      out.push(text);
    }
    return out.join('');
  }

  // Static hosts (GitHub Pages, Netlify, ...) have no /api/translate proxy.
  // Skip it on *.github.io or when the page opts out with
  // <meta name="translator-proxy" content="off">, and stop asking after the
  // first miss elsewhere.
  let proxyMissing = /\.github\.io$/i.test(location.hostname)
    || !!document.querySelector('meta[name="translator-proxy"][content="off"]');

  async function requestTranslation(q, from, to, signal) {
    if (!proxyMissing) {
      try {
        // Relative URL so the page also works under a subpath such as /zh-translator/.
        const url = 'api/translate?q=' + encodeURIComponent(q) + '&from=' + from + '&to=' + to;
        const r = await fetch(url, { signal });
        const type = r.headers.get('content-type') || '';
        if (r.status === 404 || r.status === 405 || (r.ok && type.indexOf('json') < 0)) {
          proxyMissing = true;
        } else if (r.ok) {
          const data = await r.json();
          if (data && data.text) return data;
        }
      } catch (e) {
        if (e.name === 'AbortError') throw e;
      }
    }
    try {
      return { text: await googleDirect(q, from, to, signal), provider: 'google' };
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      return { text: await memoryDirect(q, from, to, signal), provider: 'mymemory' };
    }
  }

  function providerLabel(provider) {
    if (provider === 'google') return "Translated with Google's public endpoint (unofficial, no key).";
    if (provider === 'mymemory') return 'Translated with MyMemory (fallback, no key).';
    return '';
  }

  function showOutput(text, provider, error) {
    if (error) {
      outEl.textContent = error;
      outEl.className = 'out error';
      provEl.textContent = '';
      renderPy(outPy, '');
      return;
    }
    if (!text) {
      outEl.textContent = 'Translation';
      outEl.className = 'out placeholder';
      provEl.textContent = '';
      renderPy(outPy, '');
      return;
    }
    outEl.textContent = text;
    outEl.className = 'out';
    provEl.textContent = providerLabel(provider);
    renderPy(outPy, text);
  }

  function scheduleTranslate(ms) {
    clearTimeout(state.timer);
    const delay = ms == null ? 300 : ms;
    state.timer = setTimeout(runTranslate, delay);
  }

  async function runTranslate() {
    const q = src.value.trim();
    const from = fromSel.value;
    const to = toSel.value;
    if (!q) {
      if (state.abort) state.abort.abort();
      state.req++;
      showOutput('', null);
      return;
    }
    const my = ++state.req;
    if (state.abort) state.abort.abort();
    state.abort = new AbortController();
    if (outEl.classList.contains('placeholder')) {
      outEl.textContent = 'Translating…';
    }
    try {
      const data = await requestTranslation(q, from, to, state.abort.signal);
      if (my !== state.req) return;
      showOutput(data.text, data.provider);
      setStatus('');
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (my !== state.req) return;
      showOutput('', null, 'Could not translate. ' + (e.message || 'Check the network and try again.'));
    }
  }

  async function copyText(text) {
    if (!text) {
      setStatus('Nothing to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied.');
    } catch (e) {
      setStatus('Clipboard is blocked. Select the text and copy it manually.');
    }
  }

  function speak(text, lang) {
    if (!text) {
      setStatus('Nothing to read aloud.');
      return;
    }
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance !== 'function') {
      setStatus('This browser has no speech synthesis.');
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === 'zh' ? 'zh-CN' : 'en-US';
    const voices = speechSynthesis.getVoices() || [];
    const prefix = lang === 'zh' ? 'zh' : 'en';
    const voice = voices.find((v) => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith(prefix));
    if (voice) u.voice = voice;
    u.onerror = () => setStatus('The voice could not speak. This system may not have a ' + (lang === 'zh' ? 'Chinese' : 'English') + ' voice installed.');
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    if (lang === 'zh' && !voice) {
      setStatus('No zh-CN voice found — the browser will try its default. Install a Chinese voice if it stays silent.');
    }
  }

  function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setStatus('Speech recognition is not supported in this browser. Use Chrome, Edge, or Safari.');
      return;
    }
    if (state.listening && state.recog) {
      state.recog.stop();
      return;
    }
    const rec = new SR();
    rec.lang = sourceIsZh() ? 'zh-CN' : 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    state.micBase = src.value;
    rec.onresult = (ev) => {
      let said = '';
      for (let i = 0; i < ev.results.length; i++) said += ev.results[i][0].transcript;
      src.value = state.micBase + said;
      clearComp();
      afterEdit();
    };
    rec.onerror = (ev) => {
      const map = {
        'not-allowed': 'Microphone permission was blocked. Allow the mic for this site and try again.',
        'service-not-allowed': 'Speech recognition is turned off in this browser.',
        network: 'Speech recognition needs a network connection and could not reach it.',
        'no-speech': 'No speech was heard. Try again.',
        'audio-capture': 'No microphone was found.',
        aborted: '',
      };
      if (map[ev.error]) setStatus(map[ev.error]);
      else if (ev.error) setStatus('Speech recognition error: ' + ev.error);
    };
    rec.onend = () => {
      state.listening = false;
      micBtn.classList.remove('on');
      micBtn.setAttribute('aria-pressed', 'false');
    };
    state.recog = rec;
    state.listening = true;
    micBtn.classList.add('on');
    micBtn.setAttribute('aria-pressed', 'true');
    setStatus(sourceIsZh() ? 'Listening for Mandarin…' : 'Listening for English…');
    try {
      rec.start();
    } catch (err) {
      state.listening = false;
      micBtn.classList.remove('on');
      setStatus('Could not start the microphone.');
    }
  }

  function outputText() {
    if (outEl.classList.contains('placeholder') || outEl.classList.contains('error')) return '';
    return outEl.textContent || '';
  }

  $('swap').addEventListener('click', () => {
    const spoken = outputText();
    const prevFrom = fromSel.value;
    fromSel.value = toSel.value;
    toSel.value = prevFrom;
    if (spoken) src.value = spoken;
    clearComp();
    updateChrome();
    countEl.textContent = String(src.value.length);
    renderPy(srcPy, src.value);
    scheduleTranslate(0);
  });

  fromSel.addEventListener('change', () => enforcePair('from'));
  toSel.addEventListener('change', () => enforcePair('to'));
  src.addEventListener('keydown', onKeyDown);
  src.addEventListener('beforeinput', onBeforeInput);
  src.addEventListener('input', () => {
    countEl.textContent = String(src.value.length);
    renderPy(srcPy, src.value);
    scheduleTranslate(300);
  });
  candEl.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('[data-i]');
    if (!btn) return;
    e.preventDefault();
    pick(Number(btn.dataset.i));
  });
  $('mic').addEventListener('click', toggleMic);
  $('speak-src').addEventListener('click', () => speak(src.value.trim(), fromSel.value));
  $('speak-out').addEventListener('click', () => speak(outputText().trim(), toSel.value));
  $('copy-src').addEventListener('click', () => copyText(src.value));
  $('copy-out').addEventListener('click', () => copyText(outputText()));
  $('clear').addEventListener('click', () => {
    src.value = '';
    clearComp();
    afterEdit();
    src.focus();
  });

  if (window.speechSynthesis) {
    speechSynthesis.onvoiceschanged = () => {};
    speechSynthesis.getVoices();
  }

  updateChrome();

  const params = new URLSearchParams(location.search);
  if (params.get('from') === 'en' || params.get('from') === 'zh') fromSel.value = params.get('from');
  if (params.get('to') === 'en' || params.get('to') === 'zh') toSel.value = params.get('to');
  if (fromSel.value === toSel.value) toSel.value = other(fromSel.value);
  if (params.get('q')) src.value = params.get('q').slice(0, MAX);
  updateChrome();
  countEl.textContent = String(src.value.length);

  fetch('dict.json')
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then((data) => {
      const info = ZhIme.load(data);
      window.__imeReady = info;
      renderPy(srcPy, src.value);
      renderPy(outPy, outputText());
      if (state.comp) refreshComp();
      if (statusEl.textContent.indexOf('dictionary') >= 0) setStatus('');
    })
    .catch(() => {
      setStatus('The pinyin dictionary failed to load. Translation still works; phonetic input does not.');
    });

  if (src.value.trim()) scheduleTranslate(0);
})();
