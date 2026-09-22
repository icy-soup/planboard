const { test } = require('node:test');
const assert = require('node:assert');
const span = require('../app/js/span.js');

// 2026-09-14 是周一，到 09-20 周日
const WEEK = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17',
              '2026-09-18', '2026-09-19', '2026-09-20'];

test('spanRange: 不写 to 就是单天，to 比 date 早当没写', () => {
  assert.deepStrictEqual(span.spanRange({ allDay: true, date: '2026-09-20' }),
                         { from: '2026-09-20', to: '2026-09-20' });
  assert.deepStrictEqual(span.spanRange({ allDay: true, date: '2026-09-20', to: '2026-09-24' }),
                         { from: '2026-09-20', to: '2026-09-24' });
  assert.deepStrictEqual(span.spanRange({ allDay: true, date: '2026-09-20', to: '2026-09-18' }),
                         { from: '2026-09-20', to: '2026-09-20' });
});

test('spanRange: 不是全天、或没有 date，都不算跨天任务', () => {
  assert.strictEqual(span.spanRange({ date: '2026-09-20', start: '09:00' }), null);
  assert.strictEqual(span.spanRange({ allDay: true }), null);
  assert.strictEqual(span.spanRange(null), null);
});

test('coversDay / dayCount', () => {
  const t = { allDay: true, date: '2026-09-20', to: '2026-09-24' };
  assert.strictEqual(span.coversDay(t, '2026-09-20'), true);
  assert.strictEqual(span.coversDay(t, '2026-09-24'), true);
  assert.strictEqual(span.coversDay(t, '2026-09-19'), false);
  assert.strictEqual(span.coversDay(t, '2026-09-25'), false);
  assert.strictEqual(span.dayCount(t), 5);
  assert.strictEqual(span.dayCount({ allDay: true, date: '2026-09-20' }), 1);
  assert.strictEqual(span.dayCount({ date: '2026-09-20' }), 0);
});

test('setDoneDay: 按天勾，全取消后不留空 doneDays', () => {
  const t = { allDay: true, date: '2026-09-20', to: '2026-09-24' };
  span.setDoneDay(t, '2026-09-21', true);
  span.setDoneDay(t, '2026-09-23', true);
  assert.strictEqual(span.isDoneDay(t, '2026-09-21'), true);
  assert.strictEqual(span.isDoneDay(t, '2026-09-22'), false);
  assert.strictEqual(span.doneCount(t), 2);

  span.setDoneDay(t, '2026-09-21', false);
  assert.strictEqual(span.isDoneDay(t, '2026-09-21'), false);
  assert.strictEqual(span.doneCount(t), 1);

  span.setDoneDay(t, '2026-09-23', false);
  assert.strictEqual('doneDays' in t, false);
  assert.strictEqual(span.doneCount(t), 0);
});

test('setDoneDay: 范围外的日期勾不上', () => {
  const t = { allDay: true, date: '2026-09-20', to: '2026-09-24' };
  span.setDoneDay(t, '2026-09-25', true);
  assert.strictEqual(span.isDoneDay(t, '2026-09-25'), false);
  assert.strictEqual('doneDays' in t, false);
});

test('doneCount: 范围缩短后，范围外的旧勾不再计数', () => {
  const t = { allDay: true, date: '2026-09-20', to: '2026-09-24',
              doneDays: { '2026-09-21': true, '2026-09-24': true } };
  t.to = '2026-09-22';                      // 缩到 9/20–9/22
  assert.strictEqual(span.doneCount(t), 1); // 9/24 那个勾不算了
});

test('columns: 本周占哪几列，左右被切掉要标出来', () => {
  assert.deepStrictEqual(span.columns({ allDay: true, date: '2026-09-16', to: '2026-09-18' }, WEEK),
                         { startIdx: 2, endIdx: 4, before: false, after: false });
  assert.deepStrictEqual(span.columns({ allDay: true, date: '2026-09-10', to: '2026-09-15' }, WEEK),
                         { startIdx: 0, endIdx: 1, before: true, after: false });
  assert.deepStrictEqual(span.columns({ allDay: true, date: '2026-09-18', to: '2026-10-05' }, WEEK),
                         { startIdx: 4, endIdx: 6, before: false, after: true });
  assert.deepStrictEqual(span.columns({ allDay: true, date: '2026-09-01', to: '2026-12-31' }, WEEK),
                         { startIdx: 0, endIdx: 6, before: true, after: true });
  assert.strictEqual(span.columns({ allDay: true, date: '2026-08-01', to: '2026-08-05' }, WEEK), null);
  assert.strictEqual(span.columns({ date: '2026-09-16', start: '09:00' }, WEEK), null);
});

test('weekSpans: 不重叠的共用一行，重叠的往下排', () => {
  const tasks = {
    '2026-09-16': [{ allDay: true, date: '2026-09-16', to: '2026-09-18', id: 'a' }],
    '2026-09-10': [{ allDay: true, date: '2026-09-10', to: '2026-09-15', id: 'b' }],
    '2026-09-18': [{ allDay: true, date: '2026-09-18', to: '2026-10-05', id: 'c' }]
  };
  const { items, rows } = span.weekSpans(tasks, WEEK);
  assert.strictEqual(rows, 2);
  const row = id => items.find(i => i.task.id === id).row;
  assert.strictEqual(row('b'), 0);   // 0–1 列
  assert.strictEqual(row('a'), 0);   // 2–4 列，和 b 不挨着
  assert.strictEqual(row('c'), 1);   // 4–6 列，和第 4 列上的 a 撞了
});

test('weekSpans: 一条都没有时也留一行（新建的落点）', () => {
  const { items, rows } = span.weekSpans({}, WEEK);
  assert.deepStrictEqual(items, []);
  assert.strictEqual(rows, 1);
});

test('allSpans: 扫全表，缺 date 的按所在那一格补上', () => {
  const tasks = {
    '2026-09-20': [{ allDay: true, id: 'a', text: '写报告' }],              // 缺 date
    '2026-09-21': [{ id: 'b', start: '09:00', end: '10:00' }],              // 普通任务，不算
    '2026-09-22': [{ allDay: true, date: '2026-09-22', to: '2026-09-23', id: 'c' }]
  };
  const out = span.allSpans(tasks);
  assert.deepStrictEqual(out.map(t => t.id), ['a', 'c']);
  assert.strictEqual(tasks['2026-09-20'][0].date, '2026-09-20');   // 补上了
});

test('allSpans: 空表不出错', () => {
  assert.deepStrictEqual(span.allSpans({}), []);
  assert.deepStrictEqual(span.allSpans(null), []);
});

// 2026-09-22：全天和跨天拆成两个独立维度。
// 跨天 = 写了一个晚于起始日的 to，跟全不全天无关；一次做完还是每天做，另说。

test('spanRange: 有时段的任务写了 to 也算跨天', () => {
  assert.deepStrictEqual(
    span.spanRange({ date: '2026-09-20', to: '2026-09-24', start: '22:15', end: '22:55' }),
    { from: '2026-09-20', to: '2026-09-24' });
  // to 不晚于起始日 = 没写
  assert.strictEqual(
    span.spanRange({ date: '2026-09-20', to: '2026-09-20', start: '22:15', end: '22:55' }), null);
});

test('isMultiDay: 只有 to 晚于起始日才算跨天', () => {
  assert.strictEqual(span.isMultiDay({ date: '2026-09-20', to: '2026-09-24' }), true);
  assert.strictEqual(span.isMultiDay({ date: '2026-09-20', to: '2026-09-20' }), false);
  assert.strictEqual(span.isMultiDay({ date: '2026-09-20' }), false);
  assert.strictEqual(span.isMultiDay(null), false);
});

test('isPerDay: 跨天且没选「做完一次」才按天记；全天即使只占一天也按天（历史存法）', () => {
  assert.strictEqual(span.isPerDay({ allDay: true, date: '2026-09-20' }), true);
  assert.strictEqual(span.isPerDay({ allDay: true, date: '2026-09-20', to: '2026-09-24' }), true);
  assert.strictEqual(
    span.isPerDay({ allDay: true, date: '2026-09-20', to: '2026-09-24', once: true }), false);
  assert.strictEqual(span.isPerDay({ date: '2026-09-20', to: '2026-09-24' }), true);
  assert.strictEqual(span.isPerDay({ date: '2026-09-20', to: '2026-09-24', once: true }), false);
  assert.strictEqual(span.isPerDay({ date: '2026-09-20', start: '09:00', end: '10:00' }), false);
});

test('有时段的跨天任务：按天勾', () => {
  const t = { date: '2026-09-20', to: '2026-09-22', start: '22:15', end: '22:55' };
  span.setDoneDay(t, '2026-09-21', true);

  assert.strictEqual(span.isDoneDay(t, '2026-09-21'), true);
  assert.strictEqual(span.isDoneDay(t, '2026-09-20'), false);
  assert.strictEqual(span.doneCount(t), 1);
  assert.strictEqual('done' in t, false);
});

test('「做完一次即可」的跨天任务：整条一个勾，勾在任一天都算', () => {
  const t = { date: '2026-09-20', to: '2026-09-22', once: true };
  span.setDoneDay(t, '2026-09-21', true);

  assert.strictEqual(t.done, true);
  assert.strictEqual('doneDays' in t, false);
  assert.strictEqual(span.isDoneDay(t, '2026-09-21'), true);
  assert.strictEqual(span.isDoneDay(t, '2026-09-20'), true);
  assert.strictEqual(span.doneCount(t), 1);

  span.setDoneDay(t, '2026-09-20', false);
  assert.strictEqual(t.done, false);
  assert.strictEqual(span.doneCount(t), 0);
});

test('timedCovering: 只捞有时段的跨天任务，且不含它自己那一格', () => {
  const tasks = {
    '2026-09-18': [
      { id: 'a', date: '2026-09-18', to: '2026-09-21', start: '22:15', end: '22:55' },
      { id: 'b', date: '2026-09-18', allDay: true, to: '2026-09-21' },
      { id: 'c', date: '2026-09-18', start: '09:00', end: '10:00' }
    ]
  };
  assert.deepStrictEqual(span.timedCovering(tasks, '2026-09-20').map(t => t.id), ['a']);
  assert.deepStrictEqual(span.timedCovering(tasks, '2026-09-18').map(t => t.id), []);
  assert.deepStrictEqual(span.timedCovering(tasks, '2026-09-22').map(t => t.id), []);
  assert.deepStrictEqual(span.timedCovering(null, '2026-09-20'), []);
});
