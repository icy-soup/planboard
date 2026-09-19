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

test('COURSE_COLOR 与「学习」分类的绿色不是同一个色', () => {
  const study = store.DEFAULT_SUBJECTS.find(s => s.id === 'study');
  assert.ok(study, '默认分类里应该有 study');
  assert.notStrictEqual(store.COURSE_COLOR.toLowerCase(), study.color.toLowerCase());
});
