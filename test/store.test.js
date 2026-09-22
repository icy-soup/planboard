const { test } = require('node:test');
const assert = require('node:assert');
const store = require('../app/js/store.js');

test('migrate 把 v1 配置升级为 v2 并补齐新字段', () => {
  const v1 = {
    config: {
      projectName: '期末复习',
      startDate: '2026-06-01',
      endDate: '2026-06-07',
      subjects: [{ id: 'work', label: '工作', color: '#3b82f6' }]
    },
    tasks: { '2026-06-01': [{ id: 't1', start: '09:00', end: '10:00', subject: 'work', text: '复习', done: false }] }
  };
  const v2 = store.migrate(v1);

  assert.strictEqual(v2.version, 2);
  assert.strictEqual(v2.config.projectName, '期末复习');
  assert.deepStrictEqual(v2.templates, []);
  assert.deepStrictEqual(v2.memos, []);
  assert.strictEqual(v2.config.semesterStart, null);
  assert.strictEqual(v2.config.settings.openAtLogin, false);
  assert.strictEqual(v2.config.settings.closeToTray, false);
  assert.strictEqual(v2.config.settings.ai.provider, 'deepseek');
  assert.strictEqual(v2.tasks['2026-06-01'][0].text, '复习');
});

test('migrate 对已是 v2 的数据只补缺失字段，不覆盖已有值', () => {
  const v2in = {
    version: 2,
    config: { projectName: 'A', semesterStart: '2026-09-07', subjects: [], settings: { openAtLogin: true } },
    tasks: {},
    templates: [{ id: 'x' }],
    memos: [{ id: 'm1', title: 'T', body: 'B' }]
  };
  const out = store.migrate(v2in);
  assert.strictEqual(out.config.semesterStart, '2026-09-07');
  assert.strictEqual(out.config.settings.openAtLogin, true);   // 未被默认值覆盖
  assert.strictEqual(out.templates.length, 1);
  assert.strictEqual(out.memos.length, 1);
  assert.strictEqual(out.config.settings.closeToTray, false);  // 缺失的补默认
});

test('migrate 对空输入返回可用的默认状态', () => {
  const out = store.migrate(null);
  assert.strictEqual(out.version, 2);
  assert.strictEqual(out.config.subjects.length, 4);
  assert.deepStrictEqual(out.tasks, {});
});

test('migrate 不会修改传入对象（纯函数）', () => {
  const input = { config: { projectName: 'X' }, tasks: {} };
  const snapshot = JSON.stringify(input);
  store.migrate(input);
  assert.strictEqual(JSON.stringify(input), snapshot);
});

test('migrate: semesterEnd 缺失补 null、已有值保留', () => {
  assert.strictEqual(store.migrate(null).config.semesterEnd, null);
  assert.strictEqual(store.migrate({ config: {} }).config.semesterEnd, null);
  const kept = store.migrate({ config: { semesterEnd: '2027-01-03' } });
  assert.strictEqual(kept.config.semesterEnd, '2027-01-03');
});

// ============ tasks 形状不对时的收编（2026-09-19 任务被清空的洞）============

test('migrate: tasks 是数组时按每条自带的 date 归位，不再静默清空', () => {
  const arr = [
    { id: 't1', date: '2026-09-19', start: '20:00', end: '21:30', text: '读论文' },
    { id: 't2', date: '2026-09-20', start: '08:00', end: '09:30', text: '写报告' }
  ];
  const report = { messages: [], dataAtRisk: false };
  const out = store.migrate({ config: {}, tasks: arr }, report);

  assert.deepStrictEqual(Object.keys(out.tasks).sort(), ['2026-09-19', '2026-09-20']);
  assert.strictEqual(out.tasks['2026-09-19'][0].id, 't1');
  assert.strictEqual(out.tasks['2026-09-20'][0].id, 't2');
  assert.strictEqual(report.dataAtRisk, false, '一条没丢，可以放心写回盘');
  assert.strictEqual(report.messages.length, 1, '形状不对要说一声');
});

test('migrate: 数组里没有可用 date 的条目被数出来，并标记 dataAtRisk', () => {
  const report = { messages: [], dataAtRisk: false };
  const out = store.migrate({ tasks: [
    { id: 'ok', date: '2026-09-19' },
    { id: 'nodate' },
    { id: 'bad', date: '9/20' },
    'not-an-object'
  ] }, report);

  assert.deepStrictEqual(Object.keys(out.tasks), ['2026-09-19']);
  assert.strictEqual(report.dataAtRisk, true, '有读不懂的内容就不许回写盘');
  assert.match(report.messages.join(' '), /3 条/);
});

test('migrate: tasks 既不是对象也不是数组时，标记 dataAtRisk 而不是当空对象', () => {
  const report = { messages: [], dataAtRisk: false };
  const out = store.migrate({ tasks: 'oops' }, report);

  assert.deepStrictEqual(out.tasks, {});
  assert.strictEqual(report.dataAtRisk, true);
  assert.ok(report.messages.length);
});

test('migrate: templates / memos 不是数组时也说一声', () => {
  const report = { messages: [], dataAtRisk: false };
  const out = store.migrate({ tasks: {}, templates: { a: 1 }, memos: 'x' }, report);

  assert.deepStrictEqual(out.templates, []);
  assert.deepStrictEqual(out.memos, []);
  assert.strictEqual(report.dataAtRisk, true);
});

test('migrate: 形状正常时不产生任何消息，也不标记风险', () => {
  const report = { messages: [], dataAtRisk: false };
  store.migrate({ tasks: { '2026-09-19': [{ id: 't1' }] }, templates: [], memos: [] }, report);

  assert.deepStrictEqual(report.messages, []);
  assert.strictEqual(report.dataAtRisk, false);
});

test('migrate: 不传 report 时结果不变（老调用点不受影响）', () => {
  const out = store.migrate({ config: {}, tasks: { '2026-09-19': [{ id: 't1' }] } });
  assert.strictEqual(out.tasks['2026-09-19'][0].id, 't1');
});

// ============ 导入前的形状体检 ============

test('checkImport: 放行形状正常的文件', () => {
  const r = store.checkImport({ config: {}, tasks: { '2026-09-19': [{ id: 't1' }] } });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.messages, []);
  assert.strictEqual(r.tasks['2026-09-19'][0].id, 't1');
});

test('checkImport: tasks 是数组时收编，并把说明带回界面', () => {
  const r = store.checkImport({ config: {}, tasks: [{ id: 't1', date: '2026-09-19' }] });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.tasks['2026-09-19'][0].id, 't1');
  assert.ok(r.messages.length);
});

test('checkImport: tasks 里有读不懂的条目就拒绝并说清原因', () => {
  const r = store.checkImport({ config: {}, tasks: [{ id: 'x' }] });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /读不懂|date/);
});

test('checkImport: 只给 tasks 的文件也能导（AI 通常只产出任务）', () => {
  const r = store.checkImport({ tasks: { '2026-09-19': [{ id: 't1' }] } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.tasks['2026-09-19'][0].id, 't1');
});

test('checkImport: 缺 tasks / 形状不对都拒绝', () => {
  assert.strictEqual(store.checkImport(null).ok, false);
  assert.strictEqual(store.checkImport({ config: {} }).ok, false);
  assert.strictEqual(store.checkImport({ config: [], tasks: {} }).ok, false);
  assert.strictEqual(store.checkImport({ config: {}, tasks: {}, templates: { a: 1 } }).ok, false);
  assert.strictEqual(store.checkImport({ config: {}, tasks: {}, memos: 'x' }).ok, false);
});

test('COURSE_COLOR 与「学习」分类的绿色不是同一个色', () => {
  const study = store.DEFAULT_SUBJECTS.find(s => s.id === 'study');
  assert.ok(study, '默认分类里应该有 study');
  assert.notStrictEqual(store.COURSE_COLOR.toLowerCase(), study.color.toLowerCase());
});

// 任务存在按日期分桶的对象里，任务对象自己还带一份 date 副本。
// 2026-09-22 的拖动 bug 就是只搬桶、没同步副本，编辑弹窗照着副本把任务搬了回去。

test('moveTaskTo: 跨天搬任务时把任务自带的 date 一起改，源格子空了就删键', () => {
  const tasks = { '2026-09-20': [{ id: 't1', text: '复习', date: '2026-09-20' }] };
  const ok = store.moveTaskTo(tasks, '2026-09-20', 't1', '2026-09-23', null);

  assert.strictEqual(ok, true);
  assert.strictEqual(tasks['2026-09-20'], undefined);
  assert.strictEqual(tasks['2026-09-23'].length, 1);
  assert.strictEqual(tasks['2026-09-23'][0].id, 't1');
  assert.strictEqual(tasks['2026-09-23'][0].date, '2026-09-23');
});

test('moveTaskTo: 任务原本没有 date 字段时补上', () => {
  const tasks = { '2026-09-20': [{ id: 't1' }] };
  store.moveTaskTo(tasks, '2026-09-20', 't1', '2026-09-21', null);
  assert.strictEqual(tasks['2026-09-21'][0].date, '2026-09-21');
});

test('moveTaskTo: beforeId 指定时插到它之前，找不着就追加到末尾', () => {
  const tasks = {
    '2026-09-20': [{ id: 't1', date: '2026-09-20' }],
    '2026-09-21': [{ id: 'a', date: '2026-09-21' }, { id: 'b', date: '2026-09-21' }]
  };
  store.moveTaskTo(tasks, '2026-09-20', 't1', '2026-09-21', 'b');
  assert.deepStrictEqual(tasks['2026-09-21'].map(t => t.id), ['a', 't1', 'b']);

  const other = { '2026-09-20': [{ id: 't1' }], '2026-09-21': [{ id: 'a' }] };
  store.moveTaskTo(other, '2026-09-20', 't1', '2026-09-21', '没有这个 id');
  assert.deepStrictEqual(other['2026-09-21'].map(t => t.id), ['a', 't1']);
});

test('moveTaskTo: 同一天 / 找不到任务 / 源格子不存在都返回 false 且不动数据', () => {
  const same = { '2026-09-20': [{ id: 't1' }] };
  assert.strictEqual(store.moveTaskTo(same, '2026-09-20', 't1', '2026-09-20', null), false);
  assert.strictEqual(same['2026-09-20'].length, 1);

  const missing = { '2026-09-20': [{ id: 't1' }] };
  assert.strictEqual(store.moveTaskTo(missing, '2026-09-20', '没有这个 id', '2026-09-21', null), false);
  assert.strictEqual(missing['2026-09-20'].length, 1);
  assert.strictEqual(missing['2026-09-21'], undefined);

  assert.strictEqual(store.moveTaskTo({}, '2026-09-20', 't1', '2026-09-21', null), false);
});

// 单天全天任务可以拖到别的日子，跨天的不行（该动的是范围，不是某一格）。

test('moveTaskTo: 单天全天任务的 to 跟着日期一起搬，往回拖不会凭空长出一段区间', () => {
  const tasks = {
    '2026-09-20': [{ id: 't1', allDay: true, date: '2026-09-20', to: '2026-09-20' }]
  };
  store.moveTaskTo(tasks, '2026-09-20', 't1', '2026-09-18', null);

  const t = tasks['2026-09-18'][0];
  assert.strictEqual(t.date, '2026-09-18');
  assert.strictEqual(t.to, '2026-09-18');
});

test('moveTaskTo: 全天任务搬家时把它那天那格完成勾一起带走', () => {
  const tasks = {
    '2026-09-20': [{ id: 't1', allDay: true, date: '2026-09-20',
                     doneDays: { '2026-09-20': true } }]
  };
  store.moveTaskTo(tasks, '2026-09-20', 't1', '2026-09-21', null);

  const t = tasks['2026-09-21'][0];
  assert.deepStrictEqual(t.doneDays, { '2026-09-21': true });
});

test('moveTaskTo: 有时段的任务带着一个等于起始日的 to 时，搬家也不许凭空长区间', () => {
  const tasks = {
    '2026-09-20': [{ id: 't1', date: '2026-09-20', to: '2026-09-20',
                     start: '22:15', end: '22:55' }]
  };
  store.moveTaskTo(tasks, '2026-09-20', 't1', '2026-09-18', null);

  const t = tasks['2026-09-18'][0];
  assert.strictEqual(t.date, '2026-09-18');
  assert.strictEqual(t.to, '2026-09-18');
});

test('moveTaskTo: 跨天任务的 to 不动 —— 它的区间是它自己的事', () => {
  const tasks = {
    '2026-09-18': [{ id: 't1', allDay: true, date: '2026-09-18', to: '2026-09-25' }]
  };
  store.moveTaskTo(tasks, '2026-09-18', 't1', '2026-09-20', null);

  assert.strictEqual(tasks['2026-09-20'][0].to, '2026-09-25');
});
