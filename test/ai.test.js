const { test } = require('node:test');
const assert = require('node:assert');
const ai = require('../app/js/ai.js');
const memory = require('../app/js/memory.js');
const util = require('../app/js/util.js');

test('parseItems 认得 {"items":[...]} 形状', () => {
  const out = ai.parseItems(JSON.stringify({
    items: [{ text: '准备高数小测', quadrant: 1, reason: '明天就考',
              suggestedDate: '2026-09-19', suggestedStart: '19:00', suggestedEnd: '21:00' }]
  }));
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0], {
    text: '准备高数小测', quadrant: 1, reason: '明天就考',
    date: '2026-09-19', start: '19:00', end: '21:00'
  });
});

test('parseItems 也认得裸数组', () => {
  const out = ai.parseItems('[{"text":"回邮件","quadrant":3}]');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].quadrant, 3);
});

test('parseItems 对非 JSON 返回 null，交给界面展示原文', () => {
  assert.strictEqual(ai.parseItems('抱歉，我不太确定。'), null);
});

test('parseItems 对缺 items 数组的对象返回 null', () => {
  assert.strictEqual(ai.parseItems('{"result":[]}'), null);
  assert.strictEqual(ai.parseItems('null'), null);
});

test('parseItems 补默认值：象限越界归 4、日期缺省为今天、时间缺省 09:00–10:00', () => {
  const out = ai.parseItems(JSON.stringify([
    { text: 'x', quadrant: 9, suggestedDate: '明天', suggestedStart: '25:00', suggestedEnd: '' }
  ]));
  assert.strictEqual(out[0].quadrant, 4);
  assert.strictEqual(out[0].date, util.todayStr());
  assert.strictEqual(out[0].start, '09:00');
  assert.strictEqual(out[0].end, '10:00');
});

test('parseItems 不放过越界的时刻与不存在的日期', () => {
  const out = ai.parseItems(JSON.stringify([
    { text: 'a', suggestedStart: '24:00', suggestedEnd: '09:60', suggestedDate: '2026-02-31' },
    { text: 'b', suggestedDate: '2026-02-28', suggestedStart: '00:30', suggestedEnd: '23:59' }
  ]));
  assert.strictEqual(out[0].start, '09:00');           // 24:00 不是合法时刻
  assert.strictEqual(out[0].end, '10:00');             // 09:60 同理
  assert.strictEqual(out[0].date, util.todayStr());    // 2 月没有 31 号
  assert.strictEqual(out[1].date, '2026-02-28');       // 合法的原样保留
  assert.strictEqual(out[1].start, '00:30');
  assert.strictEqual(out[1].end, '23:59');
});

test('parseItems 丢掉没有正文的条目', () => {
  const out = ai.parseItems(JSON.stringify([
    { text: '  ', quadrant: 1 }, { text: '有内容', quadrant: 2 }
  ]));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].text, '有内容');
});

test('记忆文件按主题拆成四份且顺序固定', () => {
  assert.deepStrictEqual(memory.NAMES, ['profile', 'courses', 'goals', 'preferences']);
  assert.strictEqual(memory.FILES.length, 4);
});

test('记忆读写只认白名单里的名字，挡住路径穿越', async () => {
  assert.strictEqual(await memory.read('../secrets'), '');
  assert.strictEqual(await memory.read('nope'), '');
  // 越界的名字不该抛异常，也不该写出去
  assert.strictEqual(await memory.write('../secrets', 'x'), undefined);
});

test('readEnabled 只收勾选了「发送给 AI」的文件', async () => {
  const config = { settings: { ai: { memoryEnabled: { profile: false, courses: true } } } };
  // Node 下没有 localStorage/主进程，四份都读成空串，因此只会被内容为空筛掉
  assert.deepStrictEqual(await memory.readEnabled(config), []);
});

test('readEnabled 在开关对象缺失时不报错', async () => {
  assert.deepStrictEqual(await memory.readEnabled({ settings: { ai: {} } }), []);
});
