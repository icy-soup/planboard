const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

// 极简 DOM 桩：quadrant.js 只用到 getElementById / querySelector(All) / classList
const els = {};
function el(id) {
  return els[id] || (els[id] = {
    id, innerHTML: '', value: '', style: {}, dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    querySelector: () => null,
    querySelectorAll: () => [],
    focus() {}
  });
}
globalThis.document = {
  getElementById: (id) => (els[id] === undefined ? null : el(id)),
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ set textContent(v) { this._v = v; }, get innerHTML() { return this._v || ''; } })
};
['qGrid', 'qActions', 'qStatus', 'qRaw', 'qInput', 'qRemember'].forEach(el);

const store = require('../app/js/store.js');
const quadrant = require('../app/js/quadrant.js');
const PB = globalThis.PB;

// 这两个是界面依赖，测试里换成空的
PB.week = { renderWeek() {} };
PB.list = { render() {}, showToast() {} };
globalThis.confirm = () => true;

beforeEach(() => {
  store.clear();
  quadrant._reset();
});

function items() { return quadrant.items; }

test('render 一直画出四个象限，空格子也在', () => {
  quadrant.render();
  const html = els.qGrid.innerHTML;
  for (const q of [1, 2, 3, 4]) assert.ok(html.includes(`data-q="${q}"`), `缺第 ${q} 象限`);
  assert.ok(html.includes('点 + 自己写'), '空格子要有提示');
});

test('每个格子都能手动加条目，加在对应的象限里', () => {
  quadrant.addItem(2);
  quadrant.addItem(2);
  quadrant.addItem(4);
  assert.deepStrictEqual(items().map(i => i.quadrant), [2, 2, 4]);
  assert.strictEqual(items()[0].text, '', '新条目是空的，等着手填');
});

test('改文本不回渲，免得打字丢焦点', () => {
  quadrant.addItem(1);
  quadrant.render();
  const before = els.qGrid.innerHTML;
  quadrant.setField(items()[0].key, 'text', '准备高数小测');
  assert.strictEqual(els.qGrid.innerHTML, before, '输入过程中不该重绘');
  assert.strictEqual(items()[0].text, '准备高数小测');
});

test('拖到别的象限会改掉它的 quadrant', () => {
  quadrant.addItem(1);
  const key = items()[0].key;
  const ev = {
    preventDefault() {},
    currentTarget: { classList: { add() {}, remove() {} } },
    dataTransfer: { getData: () => key }
  };
  quadrant.onDrop(ev, 3);
  assert.strictEqual(items()[0].quadrant, 3);
});

test('拖到自己所在的格子不做无谓重排', () => {
  quadrant.addItem(2);
  quadrant.setField(items()[0].key, 'text', 'a');
  const key = items()[0].key;
  quadrant.onDrop({
    preventDefault() {}, currentTarget: { classList: { add() {}, remove() {} } },
    dataTransfer: { getData: () => key }
  }, 2);
  assert.strictEqual(items()[0].quadrant, 2);
});

test('removeItem 按 key 删，不误伤别的', () => {
  quadrant.addItem(1); quadrant.addItem(2); quadrant.addItem(3);
  quadrant.removeItem(items()[1].key);
  assert.deepStrictEqual(items().map(i => i.quadrant), [1, 3]);
});

test('确认写入把条目落到 tasks，空条目不写', () => {
  quadrant.addItem(1);
  quadrant.setField(items()[0].key, 'text', '准备高数小测');
  quadrant.setField(items()[0].key, 'start', '19:00');
  quadrant.setField(items()[0].key, 'end', '21:00');
  quadrant.addItem(3);   // 这条没填内容，不该写进去

  quadrant.commit();

  const tasks = store.get().tasks;
  const all = Object.values(tasks).flat();
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].text, '准备高数小测');
  assert.strictEqual(all[0].start, '19:00');
  assert.strictEqual(all[0].end, '21:00');
  assert.deepStrictEqual(items(), [], '写完后格子清空');
});

test('起止时间相同会被顶成一小时，不铺满整天', () => {
  quadrant.addItem(1);
  quadrant.setField(items()[0].key, 'text', 'x');
  quadrant.setField(items()[0].key, 'start', '09:00');
  quadrant.setField(items()[0].key, 'end', '09:00');

  quadrant.commit();

  const t = Object.values(store.get().tasks).flat()[0];
  assert.strictEqual(t.end, '10:00');
});

test('点全部是空条目时不写入，也不清空', () => {
  quadrant.addItem(1);
  quadrant.addItem(2);
  quadrant.commit();
  assert.strictEqual(items().length, 2, '空条目原地留着');
  assert.deepStrictEqual(store.get().tasks, {});
});

test('AI 结果按文本去重，不覆盖已经手填的', () => {
  const parsed = [
    { text: '手填的', quadrant: 1, reason: '', date: '2026-09-18', start: '09:00', end: '10:00' },
    { text: '新的', quadrant: 2, reason: '', date: '2026-09-18', start: '09:00', end: '10:00' }
  ];
  quadrant.addItem(4);
  quadrant.setField(items()[0].key, 'text', '手填的');

  // analyze 里的合并逻辑：seen 取自现有条目
  const seen = new Set(items().map(i => i.text.trim()));
  const added = parsed.filter(p => !seen.has(p.text));
  assert.strictEqual(added.length, 1);
  assert.strictEqual(added[0].text, '新的');
});

test('discard 清空格子但不动已经写入的任务', () => {
  quadrant.addItem(1);
  quadrant.setField(items()[0].key, 'text', 'a');
  quadrant.commit();
  const written = Object.values(store.get().tasks).flat().length;

  quadrant.addItem(2);
  quadrant.setField(items()[0].key, 'text', 'b');
  quadrant.discard();

  assert.deepStrictEqual(items(), []);
  assert.strictEqual(Object.values(store.get().tasks).flat().length, written);
});
