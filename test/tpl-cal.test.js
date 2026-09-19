const { test } = require('node:test');
const assert = require('node:assert');
const cal = require('../app/js/tpl-cal.js');
const util = require('../app/js/util.js');
const store = require('../app/js/store.js');

// 下面这组直接跑真实模块的数据流转，只把跟 DOM 有关的依赖 stub 掉：
// render() 取不到 #tplCal 就提前返回，正好把纯数据部分让出来。
const PB = globalThis.PB;
globalThis.document = { getElementById: () => null };
PB.week = { renderWeek() {} };
PB.list = { showToast() {} };

function freshStore(semesterStart, semesterEnd) {
  const st = store.get();
  st.templates = [];
  st.config.semesterStart = semesterStart || null;
  st.config.semesterEnd = semesterEnd || null;
  return st;
}

function tpl(over = {}) {
  return { id: 'T1', weekday: 1, start: '08:00', end: '09:40',
           text: '高数', subject: 'study', parity: 'all',
           from: null, to: null, enabled: true, ...over };
}

test('computeRange: 没有课表项时用默认窗口 06:00–24:00', () => {
  assert.deepStrictEqual(cal.computeRange([]), { from: 360, to: 1440 });
});

test('computeRange: 课程都在默认窗口内则窗口不变', () => {
  const r = cal.computeRange([tpl(), tpl({ start: '14:00', end: '17:30' })]);
  assert.deepStrictEqual(r, { from: 360, to: 1440 });
});

test('computeRange: 早于 06:00 的课把上沿撑开', () => {
  const r = cal.computeRange([tpl({ start: '05:00', end: '06:00' })]);
  assert.strictEqual(r.from, 300);        // 05:00
  assert.strictEqual(r.to, 1440);
});

test('computeRange: 晚于 24:00 的课被截在 24:00（不出现 25:00 这种标签）', () => {
  const r = cal.computeRange([tpl({ start: '23:00', end: '01:00' })]);   // 跨午夜 2 小时
  assert.strictEqual(r.to, 1440);
});

test('computeRange: 上沿向下取整到整点、下沿向上取整到整点', () => {
  const r = cal.computeRange([tpl({ start: '05:20', end: '23:10' })]);
  assert.strictEqual(r.from, 300);        // 05:20 → 05:00
  assert.strictEqual(r.to, 1440);         // 23:10 → 24:00
});

test('snap: 吸附到最近的 15 分钟', () => {
  assert.strictEqual(cal.snap(367, 360, 1440), 360);   // 06:07 → 06:00
  assert.strictEqual(cal.snap(368, 360, 1440), 375);   // 06:08 → 06:15
  assert.strictEqual(cal.snap(449, 360, 1440), 450);   // 07:29 → 07:30
});

test('snap: 超出窗口时被钳在两端', () => {
  assert.strictEqual(cal.snap(100, 360, 1440), 360);
  assert.strictEqual(cal.snap(2000, 360, 1440), 1440);
});

test('snap: 结果永远落在窗口内且是 15 的倍数', () => {
  for (let m = 0; m <= 1500; m += 7) {
    const v = cal.snap(m, 360, 1440);
    assert.ok(v >= 360 && v <= 1440, `${m} → ${v} 越界`);
    assert.strictEqual(v % cal.SNAP_MIN, 0, `${m} → ${v} 不是 ${cal.SNAP_MIN} 的倍数`);
  }
});

// ---- 新建课程的默认值 ----

test('onSlotClick: 生效范围默认带出学期起止', () => {
  const st = freshStore('2026-09-14', '2027-01-03');
  cal.onSlotClick(1, '08:00');

  assert.strictEqual(st.templates.length, 1);
  const t = st.templates[0];
  assert.strictEqual(t.weekday, 1);
  assert.strictEqual(t.start, '08:00');
  assert.strictEqual(t.end, '09:30');                 // 默认 90 分钟
  assert.strictEqual(t.from, '2026-09-14');
  assert.strictEqual(t.to, '2027-01-03');
  assert.strictEqual(util.weeksBetween(t.from, t.to), 16);
});

test('onSlotClick: 课程不带任务分类字段', () => {
  const st = freshStore('2026-09-14', '2027-01-03');
  cal.onSlotClick(2, '14:00');
  assert.ok(!('subject' in st.templates[0]), '课程不再属于「工作/学习/个人」那一套');
});

test('onSlotClick: 没设学期日期时生效范围留空', () => {
  const st = freshStore(null, null);
  cal.onSlotClick(1, '08:00');
  assert.strictEqual(st.templates[0].from, null);
  assert.strictEqual(st.templates[0].to, null);
});

// ---- 生效起 / 生效止 / 持续周数 三向联动 ----

test('setField: 填持续周数写出生效止', () => {
  const st = freshStore('2026-09-14', null);
  cal.onSlotClick(1, '08:00');
  cal.setField('weeks', '16');
  assert.strictEqual(st.templates[0].to, '2027-01-03');   // 09-14 + 16×7 − 1
});

test('setField: 挪生效起时生效止按原周数一起挪', () => {
  const st = freshStore('2026-09-14', null);
  cal.onSlotClick(1, '08:00');
  cal.setField('weeks', '16');
  cal.setField('from', '2026-09-21');                     // 整体晚一周
  assert.strictEqual(st.templates[0].from, '2026-09-21');
  assert.strictEqual(st.templates[0].to, '2027-01-10');
  assert.strictEqual(util.weeksBetween(st.templates[0].from, st.templates[0].to), 16);
});

test('setField: 改生效止会按整周对齐', () => {
  const st = freshStore('2026-09-14', null);
  cal.onSlotClick(1, '08:00');
  cal.setField('to', '2026-10-05');                       // 落在第 4 周中间
  assert.strictEqual(st.templates[0].to, '2026-10-04');   // 对齐到第 3 周周日
  assert.strictEqual(util.weeksBetween(st.templates[0].from, st.templates[0].to), 3);
});

test('setField: 没有生效起时填周数不改数据', () => {
  const st = freshStore(null, null);
  cal.onSlotClick(1, '08:00');
  cal.setField('weeks', '16');
  assert.strictEqual(st.templates[0].from, null);
  assert.strictEqual(st.templates[0].to, null);           // 推不出来就原样留着
});

test('setField: 清空生效起不会连带清掉生效止', () => {
  const st = freshStore('2026-09-14', '2027-01-03');
  cal.onSlotClick(1, '08:00');
  cal.setField('from', '');
  assert.strictEqual(st.templates[0].from, null);
  assert.strictEqual(st.templates[0].to, '2027-01-03');   // 只留「止」也是合法区间
});
