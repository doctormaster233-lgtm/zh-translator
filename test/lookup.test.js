#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ime = require('../public/ime.js');

const dict = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'dict.json'), 'utf8'));
const info = ime.load(dict);
assert.ok(info.entries > 100000, 'dictionary should include CC-CEDICT');

function words(q) {
  return ime.candidates(q, 8).map((c) => c.word);
}

function includesTop(q, word) {
  const list = words(q);
  assert.ok(list.includes(word), q + ' top candidates ' + list.join(',') + ' should include ' + word);
  return list;
}

const nihao = includesTop('nihao', '你好');
assert.strictEqual(nihao[0], '你好', '你好 should be the first candidate for nihao');
assert.strictEqual(words('ni3 hao3')[0], '你好');
assert.strictEqual(words('ni3hao3')[0], '你好');
assert.strictEqual(ime.candidates('ni3hao3', 1)[0].pinyin, 'nǐ hǎo');

includesTop('xiexie', '谢谢');
assert.strictEqual(words('xiexie')[0], '谢谢');
includesTop('zhongguo', '中国');
assert.strictEqual(words('zhongguo')[0], '中国');

assert.ok(ime.candidates('ni', 8)[0].freq >= ime.candidates('ni', 8)[1].freq, 'frequency sort');

assert.strictEqual(ime.pinyinLine('你好'), 'nǐ hǎo');
assert.strictEqual(ime.pinyinLine('谢谢'), 'xiè xie');
assert.strictEqual(ime.pinyinLine('中国'), 'zhōng guó');
assert.strictEqual(ime.pinyinLine('银行'), 'yín háng');
assert.strictEqual(ime.pinyinLine('音乐'), 'yīn yuè');
assert.strictEqual(ime.pinyinLine('长大'), 'zhǎng dà');
assert.ok(ime.pinyinLine('了').startsWith('le'), ime.pinyinLine('了'));
assert.strictEqual(ime.compositionPinyin('ni3hao3'), 'nǐ hǎo');
assert.strictEqual(ime.compositionPinyin("xi'an"), 'xi an');
assert.strictEqual(ime.remainderAfterPick('nihao', 'ni'), 'hao');
assert.strictEqual(ime.remainderAfterPick('ni3hao3', 'ni'), 'hao3');
assert.strictEqual(ime.remainderAfterPick('nihao', 'nihao'), '');

// English "sounds like" respelling
const respellCases = {
  nihao: 'nee-how',
  xiexie: 'syeh-syeh',
  zhongguo: 'jong-gwaw',
  zaoshanghao: 'dzow-shahng-how',
  shi: 'shr',
  si: 'sz',
  'nü': 'nyoo',
  'lüe': 'lyweh',
  qing: 'ching',
  xue: 'shweh',
};
Object.keys(respellCases).forEach((py) => {
  assert.strictEqual(ime.respell(py), respellCases[py], 'respell ' + py);
});
assert.strictEqual(ime.respell('nv'), 'nyoo', 'v spelling of ü');
assert.strictEqual(ime.respell('lve'), 'lyweh', 'v spelling of üe');
assert.strictEqual(ime.respell('nǐ hǎo'), 'nee-how', 'tone-marked input');
assert.strictEqual(ime.respell('ni3hao3', { tones: true }), 'nee↘↗-how↘↗', 'tone arrows');
assert.strictEqual(ime.respellSyllable('zhōng').tone, 1);
assert.strictEqual(ime.soundsLike('你好'), 'nee-how');
assert.strictEqual(ime.soundsLike('谢谢'), 'syeh-syeh');
assert.strictEqual(ime.soundsLike('中国'), 'jong-gwaw');
assert.strictEqual(ime.soundsLike('早上好'), 'dzow-shahng-how');
assert.strictEqual(ime.soundsLike('中国', { tones: true }), 'jong→-gwaw↗');
assert.strictEqual(ime.soundsLike('我是学生。'), 'waw shr shweh-shung');

console.log('lookup tests passed');
Object.keys(respellCases).forEach((py) => console.log(' ' + py.padEnd(12), ime.respell(py, { tones: true })));
console.log(' nihao   ', words('nihao').slice(0, 5).join(' '));
console.log(' xiexie  ', words('xiexie').slice(0, 5).join(' '));
console.log(' zhongguo', words('zhongguo').slice(0, 5).join(' '));
