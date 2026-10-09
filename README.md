# 译 · Chinese ↔ English

**Live:** https://doctormaster233-lgtm.github.io/zh-translator/

A small translate page in the style of Google Translate:

- Simplified Chinese ↔ English, both directions
- Offline pinyin input (`nihao` or `ni3 hao3`) with a candidate bar
- Tone-marked pinyin under Chinese in the source and the translation
- Read-aloud and speak-to-type via the browser Web Speech API
- Swap, copy, and a layout that works on a phone or a desktop

The phonetic dictionary is bundled. Translation needs a network.

## Run

```bash
git clone https://github.com/doctormaster233-lgtm/zh-translator.git
cd zh-translator
node server.js
```

Then open http://127.0.0.1:4173

`PORT` and `HOST` override the default `4173` and `127.0.0.1`. `npm start` is the same command.

Check the dictionary without a browser:

```bash
node test/lookup.test.js
```

Rebuild `public/dict.json` after replacing the source files in `data/`:

```bash
node scripts/build-dict.js
```

## How pinyin input works

Set **From** to 中文 and type letters. A candidate bar opens above the hint.

| Input | What happens |
| --- | --- |
| `nihao` | Candidates, with 你好 first |
| `ni3hao3` or `ni3 hao3` | Same lookup, tone digits preferred |
| Space or Enter | Insert the highlighted candidate (the first, unless you moved with the arrow keys) |
| Click a candidate | Insert that word |
| `1`–`9` | Choose that candidate. If the current syllable has no tone yet, `1`–`5` sets the tone instead; press the same number again to choose, or hold Shift |
| Shift+`1`–`9` or Alt+`1`–`9` | Always choose that candidate |
| `'` | Split a syllable (`xi'an` is 西安's spelling, not 先) |
| Backspace | Delete a pinyin letter |
| Esc | Cancel the spelling |

Choosing a candidate that only covers the start of what you typed leaves the rest in the bar (`ni` → 你, leftover `hao`). A longer suggestion (you typed `ni` and chose 你好) replaces the whole spelling.

Paste or dictate Chinese normally; you do not have to go through pinyin. Latin letters are captured by this keyboard only while the source language is Chinese, so the operating system's own Chinese IME is not required.

Pinyin under the text is segmented with the same dictionary (common words first). Polyphones such as 行 are read from the word when it knows one (`银行` → yín háng, `行` alone → xíng). Rare phrases can still get the wrong reading.

## Translation

The page debounces for 300ms, then asks `GET api/translate?q=&from=zh|en&to=en|zh` (relative to the page).

1. **Primary:** `https://clients5.google.com/translate_a/t?client=dict-chrome-ex` — Google's keyless dictionary endpoint. Unofficial, no published quota, and it may answer HTTP 429 or change without notice. Long text is split around 700 characters.
2. **Fallback:** [MyMemory](https://api.mymemory.translated.net/get) — keyless. The documented maximum is **500 bytes per request** (this server chunks at 450). Usage is counted in words; anonymous calls are throttled (older docs cited about 5,000 words/day; the current limits page does not publish a fixed number). A `MYMEMORY WARNING` response is treated as failure.

The browser calls the same two services directly if `/api/translate` is missing, so the files in `public/` also work as a static site.

## Speech

- **Speaker** uses `speechSynthesis` with `zh-CN` or `en-US`. Voices depend on the OS. Linux often has no Chinese voice, so the button can stay silent even though the API exists.
- **Microphone** uses `SpeechRecognition` / `webkitSpeechRecognition` in the source language. Chrome and Edge support it (audio is sent to Google, so it is not offline). Safari supports it on recent versions. Firefox does not. If the API is missing or the mic is blocked, the status line says so.

## Hosting the static build

`public/` is the deployable site: `index.html`, `styles.css`, `app.js`, `ime.js`, `dict.json` (about 5.4 MB), and `NOTICE.md`.

- **This repo on GitHub Pages:** the live site is served from the `docs/` folder on `main` (Settings → Pages → Deploy from a branch → `main` / `/docs`). `docs/` is a copy of `public/`. After changing anything in `public/` or `NOTICE.md`, run `npm run sync-docs` and commit `docs/` too.
- **Netlify or any other static host:** publish the `public` directory. Do not use `file://` — the page fetches `dict.json`.
- All asset paths are relative, so the page works under a subpath such as `/zh-translator/`. There is no API key to configure.
- On a static host there is no `api/translate` proxy. The page skips it on `*.github.io` (elsewhere it stops asking after the first 404) and calls Google and MyMemory from the browser. Both currently send `Access-Control-Allow-Origin: *`. If Google starts blocking browsers, MyMemory is the fallback; a tiny proxy like `server.js` is the reliable option.
- CC-CEDICT is **CC BY-SA 4.0**. Keep `NOTICE.md` (or equivalent attribution) with any public copy of the dictionary data. The page footer links to it.

## Layout

```
server.js                 translation proxy and static files
public/index.html         UI
public/app.js             debounce, speech, candidate bar
public/ime.js             lookup, tones, pinyin segmentation
public/dict.json          bundled dictionary
public/styles.css
public/NOTICE.md          copy of NOTICE.md for the published site
docs/                     GitHub Pages copy of public/ (npm run sync-docs)
scripts/build-dict.js     rebuild dict.json
data/cedict.txt           CC-CEDICT snapshot
data/zh_50k.txt           frequency list
test/lookup.test.js       candidate and pinyin checks
```

## Limits

- Simplified Chinese only (no traditional conversion, no fuzzy typos).
- 2,000 characters per translation.
- Tone-number keys and candidate-number keys share the top row; see the table above.
- Readings are dictionary-based, not a full grammar model.
- The Google endpoint is unofficial and must not be hammered.
