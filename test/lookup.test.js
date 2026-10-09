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

// Google-Translate-style sentence pinyin
const sentenceCases = {
  '我很欢迎你': 'Wǒ hěn huānyíng nǐ',
  '我很欢迎你。': 'Wǒ hěn huānyíng nǐ.',
  '早上好！你叫什么名字？': 'Zǎoshanghǎo! Nǐ jiào shénme míngzi?',
  '今天天气很好，我们去公园散步吧。': 'Jīntiān tiānqì hěn hǎo, wǒmen qù gōngyuán sànbù ba.',
  '你会说英语吗？': 'Nǐ huì shuō Yīngyǔ ma?',
  '西安在中国。': "Xī'ān zài Zhōngguó.",
  '他说：“我爱北京。”': 'Tā shuō: "Wǒ ài Běijīng."',
  '我有3个iPhone。': 'Wǒ yǒu 3 gè iPhone.',
  '朋友们好': 'Péngyoumen hǎo',
  '第一行\n第二行': "Dìyī xíng\nDì'èr xíng",
};
Object.keys(sentenceCases).forEach((zh) => {
  assert.strictEqual(ime.sentencePinyin(zh), sentenceCases[zh], 'sentencePinyin ' + zh);
});
assert.strictEqual(ime.sentencePinyin('hello'), '', 'no pinyin line for text without Chinese');

console.log('lookup tests passed');
console.log(' nihao   ', words('nihao').slice(0, 5).join(' '));
console.log(' xiexie  ', words('xiexie').slice(0, 5).join(' '));
console.log(' zhongguo', words('zhongguo').slice(0, 5).join(' '));
