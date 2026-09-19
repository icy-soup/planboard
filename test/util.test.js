const { test } = require('node:test');
const assert = require('node:assert');
const util = require('../app/js/util.js');

test('toMinutes 把 HH:MM 转成分钟数', () => {
  assert.strictEqual(util.toMinutes('00:00'), 0);
  assert.strictEqual(util.toMinutes('08:30'), 510);
  assert.strictEqual(util.toMinutes('23:59'), 1439);
});

test('toHHMM 把分钟数转回 HH:MM', () => {
  assert.strictEqual(util.toHHMM(510), '08:30');
  assert.strictEqual(util.toHHMM(0), '00:00');
  assert.strictEqual(util.toHHMM(1440), '00:00');   // 溢出回绕
});

test('offsetFromTime 按清醒日换算成网格纵向偏移', () => {
  assert.strictEqual(util.offsetFromTime('05:00'), 0);
  assert.strictEqual(util.offsetFromTime('06:00'), 60);
  assert.strictEqual(util.offsetFromTime('07:00'), 120);
  assert.strictEqual(util.offsetFromTime('23:00'), 1080);
  assert.strictEqual(util.offsetFromTime('00:30'), 1170);
  assert.strictEqual(util.offsetFromTime('04:00'), 1380);
});

test('timeFromOffset 是 offsetFromTime 的逆运算', () => {
  for (const t of ['05:00', '06:00', '12:34', '23:00', '00:30', '04:00']) {
    assert.strictEqual(util.timeFromOffset(util.offsetFromTime(t)), t);
  }
});

test('durationMinutes 跨午夜安全', () => {
  assert.strictEqual(util.durationMinutes('08:00', '09:40'), 100);
  assert.strictEqual(util.durationMinutes('23:00', '00:30'), 90);
  assert.strictEqual(util.durationMinutes('00:30', '01:00'), 30);
});

test('toDateStr 用本地日期，不走 UTC', () => {
  assert.strictEqual(util.toDateStr(new Date(2026, 8, 17)), '2026-09-17');
  assert.strictEqual(util.toDateStr(new Date(2026, 0, 1)), '2026-01-01');
});

test('dayOfWeek 返回 1..7，周一为 1', () => {
  assert.strictEqual(util.dayOfWeek('2026-09-14'), 1);  // 周一
  assert.strictEqual(util.dayOfWeek('2026-09-20'), 7);  // 周日
});

test('addDays 跨月跨年正确', () => {
  assert.strictEqual(util.addDays('2026-09-30', 1), '2026-10-01');
  assert.strictEqual(util.addDays('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(util.addDays('2026-09-01', -1), '2026-08-31');
});

test('startOfWeek 返回所在周的周一', () => {
  assert.strictEqual(util.startOfWeek('2026-09-17'), '2026-09-14');  // 周四 → 周一
  assert.strictEqual(util.startOfWeek('2026-09-14'), '2026-09-14');  // 周一 → 自身
  assert.strictEqual(util.startOfWeek('2026-09-20'), '2026-09-14');  // 周日 → 本周一
});

test('escapeHtml 在浏览器环境下可用', () => {
  assert.strictEqual(typeof util.escapeHtml, 'function');
});

test('weekLayout 折叠时压成窄条，展开时按 48px/小时', () => {
  const collapsed = util.weekLayout({ early: false, night: false });
  assert.deepStrictEqual(collapsed.map(s => [s.id, s.y, s.height]), [
    ['early', 0, 24],       // 05:00–07:00 收起
    ['main', 24, 864],      // 07:00–01:00，18h × 48
    ['night', 888, 24]      // 01:00–05:00 收起
  ]);
  assert.strictEqual(util.weekTotalHeight(collapsed), 912);

  const open = util.weekLayout({ early: true, night: true });
  assert.deepStrictEqual(open.map(s => [s.id, s.y, s.height]), [
    ['early', 0, 96],       // 2h × 48
    ['main', 96, 864],
    ['night', 960, 192]     // 4h × 48
  ]);
  assert.strictEqual(util.weekTotalHeight(open), 1152);

  // 只展开一段不影响另一段
  assert.strictEqual(util.weekTotalHeight(util.weekLayout({ early: true })), 984);
  assert.strictEqual(util.weekTotalHeight(util.weekLayout({ night: true })), 1080);
});

test('weekY 分段映射：主段线性、折叠段被压缩', () => {
  const c = util.weekLayout({ early: false, night: false });
  assert.strictEqual(util.weekY(0, c), 0);              // 05:00 → 窄条顶端
  assert.strictEqual(util.weekY(120, c), 24);           // 07:00 → 主段起点
  assert.strictEqual(util.weekY(180, c), 72);           // 08:00 → 24 + 48
  assert.strictEqual(util.weekY(1200, c), 888);         // 01:00 → 次日 01:00
  assert.strictEqual(util.weekY(1440, c), 912);         // 次日 05:00 → 网格底

  const o = util.weekLayout({ early: true, night: true });
  assert.strictEqual(util.weekY(0, o), 0);
  assert.strictEqual(util.weekY(60, o), 48);            // 06:00
  assert.strictEqual(util.weekY(120, o), 96);           // 07:00
});

test('weekOffset 是 weekY 的逆运算（四种折叠组合）', () => {
  for (const state of [{}, { early: true }, { night: true }, { early: true, night: true }]) {
    const layout = util.weekLayout(state);
    for (const off of [0, 30, 120, 121, 300, 719, 1199, 1200, 1300, 1439, 1440]) {
      const y = util.weekY(off, layout);
      const back = util.weekOffset(y, layout);
      assert.ok(Math.abs(back - off) < 1e-6,
        `offset ${off} → y ${y} → ${back}（折叠状态 ${JSON.stringify(state)}）`);
    }
  }
});

test('weekOffset 超出网格范围时被钳在两端', () => {
  const layout = util.weekLayout({ early: false, night: false });
  assert.strictEqual(util.weekOffset(-5, layout), 0);
  assert.strictEqual(util.weekOffset(99999, layout), 1440);
  assert.strictEqual(util.weekOffset(912, layout), 1440);   // 正好是网格底
});

test('weekNo 从学期起始日推算 1-based 周次', () => {
  const start = '2026-09-07';                          // 学期第一周周一
  assert.strictEqual(util.weekNo('2026-09-07', start), 1);
  assert.strictEqual(util.weekNo('2026-09-13', start), 1);  // 第一周周日
  assert.strictEqual(util.weekNo('2026-09-14', start), 2);
  assert.strictEqual(util.weekNo('2026-09-21', start), 3);
  assert.strictEqual(util.weekNo('2026-09-28', start), 4);
});

test('endFromWeeks: N 周含首尾，末日 = 起 + N×7 − 1 天', () => {
  assert.strictEqual(util.endFromWeeks('2026-09-14', 1), '2026-09-20');    // 周一到周日
  assert.strictEqual(util.endFromWeeks('2026-09-14', 16), '2027-01-03');   // 跨年
});

test('endFromWeeks: 缺起点或周数不是正数时返回 null', () => {
  assert.strictEqual(util.endFromWeeks('', 16), null);
  assert.strictEqual(util.endFromWeeks('2026-09-14', ''), null);
  assert.strictEqual(util.endFromWeeks('2026-09-14', 0), null);
  assert.strictEqual(util.endFromWeeks('2026-09-14', -3), null);
  assert.strictEqual(util.endFromWeeks('2026-09-14', 'abc'), null);
  assert.strictEqual(util.endFromWeeks('2026-09-14', null), null);
});

test('weeksBetween: 与 endFromWeeks 互为逆运算', () => {
  assert.strictEqual(util.weeksBetween('2026-09-14', '2026-09-20'), 1);
  assert.strictEqual(util.weeksBetween('2026-09-14', '2027-01-03'), 16);
  const back = util.endFromWeeks('2026-09-14', util.weeksBetween('2026-09-14', '2027-01-03'));
  assert.strictEqual(back, '2027-01-03');
});

test('weeksBetween: 缺一端或区间倒置时返回 null', () => {
  assert.strictEqual(util.weeksBetween('', '2027-01-03'), null);
  assert.strictEqual(util.weeksBetween('2026-09-14', ''), null);
  assert.strictEqual(util.weeksBetween('2027-01-03', '2026-09-14'), null);  // 止早于起
});

test('parseTimeInput: 随手打的串补成 HH:MM', () => {
  assert.strictEqual(util.parseTimeInput('3'), '03:00');
  assert.strictEqual(util.parseTimeInput('03'), '03:00');
  assert.strictEqual(util.parseTimeInput('13'), '13:00');
  assert.strictEqual(util.parseTimeInput('330'), '03:30');
  assert.strictEqual(util.parseTimeInput('1330'), '13:30');
  assert.strictEqual(util.parseTimeInput('2359'), '23:59');
  assert.strictEqual(util.parseTimeInput('13:30'), '13:30');
  assert.strictEqual(util.parseTimeInput('13.30'), '13:30');
  assert.strictEqual(util.parseTimeInput('13 30'), '13:30');
  assert.strictEqual(util.parseTimeInput('1:5'), '01:05');
});

test('parseTimeInput: 24–59 的两位数当分钟，保住当前小时', () => {
  assert.strictEqual(util.parseTimeInput('30', 8), '08:30');
  assert.strictEqual(util.parseTimeInput('24', 9), '09:24');
  assert.strictEqual(util.parseTimeInput('59', 23), '23:59');
});

test('parseTimeInput: 认不出来返回 null，交给调用方保持原值', () => {
  assert.strictEqual(util.parseTimeInput(''), null);
  assert.strictEqual(util.parseTimeInput(null), null);
  assert.strictEqual(util.parseTimeInput('abc'), null);
  assert.strictEqual(util.parseTimeInput('99'), null);        // 两位但 >59，当分钟也不合法
  assert.strictEqual(util.parseTimeInput('2460'), null);      // 24 时 60 分
  assert.strictEqual(util.parseTimeInput('25:00'), null);     // 25 时
  assert.strictEqual(util.parseTimeInput('13330'), null);     // 五位
});

// ---- 时间框成对同步（文本框打字 / 原生控件开选择器）----
function timeField(textValue, nativeValue) {
  const text = { value: textValue };
  const native = { value: nativeValue };
  const span = { querySelector: (s) => (s === '.time-text' ? text : native) };
  text.closest = () => span;
  native.closest = () => span;
  return { text, native };
}

test('syncTimeField: 文本框打 "30" 保留原来的小时', () => {
  const f = timeField('08:00', '08:00');
  f.text.value = '30';
  assert.strictEqual(util.syncTimeField(f.text), '08:30');
  assert.strictEqual(f.text.value, '08:30');
  assert.strictEqual(f.native.value, '08:30');   // 原生控件也跟上，开选择器时是对的时间
});

test('syncTimeField: 打一位数字按小时补全', () => {
  const f = timeField('13:00', '13:00');
  f.text.value = '3';
  assert.strictEqual(util.syncTimeField(f.text), '03:00');
});

test('syncTimeField: 认不出来就退回原值，别把时间弄丢', () => {
  const f = timeField('08:00', '08:00');
  f.text.value = '乱写';
  assert.strictEqual(util.syncTimeField(f.text), null);
  assert.strictEqual(f.text.value, '08:00');
});

test('syncTimeField: 用原生选择器选的直接带回来', () => {
  const f = timeField('08:00', '08:00');
  f.native.value = '15:45';
  assert.strictEqual(util.syncTimeField(f.native), '15:45');
  assert.strictEqual(f.text.value, '15:45');
});
