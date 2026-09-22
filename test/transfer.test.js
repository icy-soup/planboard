const { test } = require('node:test');
const assert = require('node:assert');
const transfer = require('../app/js/transfer.js');

// 一份带跨天带子的状态：带子 9/18 起、9/25 止，起始日落在区间外但伸进来了
function sampleState() {
  return {
    tasks: {
      '2026-09-18': [{ id: 'a', allDay: true, date: '2026-09-18', to: '2026-09-25', text: '开学准备' }],
      '2026-09-20': [{ id: 'b', text: '复习' }],
      '2026-09-26': [{ id: 'c', text: '区间外' }]
    },
    templates: [{ id: 'tp1', text: '高数' }],
    config: { semesterStart: '2026-09-01' },
    memos: [{ id: 'm1', text: '备忘' }]
  };
}

test('sliceForExport: 只取区间内那几天的任务', () => {
  const out = transfer.sliceForExport(sampleState(), '2026-09-20', '2026-09-25', {});
  assert.deepStrictEqual(Object.keys(out.tasks).sort(), ['2026-09-18', '2026-09-20']);
  assert.strictEqual(out.tasks['2026-09-20'][0].id, 'b');
  assert.deepStrictEqual(out.range, { from: '2026-09-20', to: '2026-09-25' });
  assert.strictEqual(out.version, 2);
});

test('sliceForExport: 起始日在区间外、带子伸进来的跨天任务要一起带上', () => {
  const out = transfer.sliceForExport(sampleState(), '2026-09-20', '2026-09-25', {});
  assert.strictEqual(out.tasks['2026-09-18'][0].id, 'a');
});

test('sliceForExport: 与区间完全不相交的跨天任务不带', () => {
  const st = sampleState();
  st.tasks['2026-09-10'] = [{ id: 'z', allDay: true, date: '2026-09-10', to: '2026-09-12' }];
  const out = transfer.sliceForExport(st, '2026-09-20', '2026-09-25', {});
  assert.strictEqual(out.tasks['2026-09-10'], undefined);
});

test('sliceForExport: 有时段的跨天任务同样按外溢规则带上', () => {
  const st = sampleState();
  st.tasks['2026-09-18'] = [{ id: 'y', date: '2026-09-18', to: '2026-09-21',
                              start: '22:15', end: '22:55', text: '跟读' }];
  const out = transfer.sliceForExport(st, '2026-09-20', '2026-09-25', {});
  assert.strictEqual(out.tasks['2026-09-18'][0].id, 'y');
});

test('sliceForExport: 不传区间就是全部，且不带 range 键', () => {
  const out = transfer.sliceForExport(sampleState(), null, null, {});
  assert.deepStrictEqual(Object.keys(out.tasks).sort(),
    ['2026-09-18', '2026-09-20', '2026-09-26']);
  assert.strictEqual('range' in out, false);
});

test('sliceForExport: 课表 / 设置 / 备忘录默认不带，勾了才带', () => {
  const bare = transfer.sliceForExport(sampleState(), null, null, {});
  assert.strictEqual('templates' in bare, false);
  assert.strictEqual('config' in bare, false);
  assert.strictEqual('memos' in bare, false);

  const full = transfer.sliceForExport(sampleState(), null, null,
    { templates: true, config: true, memos: true });
  assert.strictEqual(full.templates[0].id, 'tp1');
  assert.strictEqual(full.config.semesterStart, '2026-09-01');
  assert.strictEqual(full.memos[0].id, 'm1');
});

test('sliceForExport: 不改入参', () => {
  const st = sampleState();
  const before = JSON.stringify(st);
  transfer.sliceForExport(st, '2026-09-20', '2026-09-25', { templates: true, config: true, memos: true });
  assert.strictEqual(JSON.stringify(st), before);
});

// ===== 导入：覆盖只动文件里出现过的那几天 =====

test('replaceDays: 文件里有的日期整段换掉，文件里没有的日期一条不动', () => {
  const cur = { '2026-09-20': [{ id: 'old' }], '2026-09-27': [{ id: 'keep' }] };
  const out = transfer.replaceDays(cur, { '2026-09-20': [{ id: 'new' }] });

  assert.strictEqual(out['2026-09-20'][0].id, 'new');
  assert.strictEqual(out['2026-09-27'][0].id, 'keep');
  assert.strictEqual(cur['2026-09-20'][0].id, 'old', '不该改入参');
});

test('replaceDays: 文件里某天是空数组就把那天清掉', () => {
  const cur = { '2026-09-20': [{ id: 'old' }], '2026-09-27': [{ id: 'keep' }] };
  const out = transfer.replaceDays(cur, { '2026-09-20': [] });
  assert.strictEqual('2026-09-20' in out, false);
  assert.strictEqual(out['2026-09-27'][0].id, 'keep');
});

// ===== 导入：合并 =====

test('mergeDays: 同一天里按 id 顶掉，文件里多出来的追加在后面', () => {
  const cur = { '2026-09-20': [{ id: 'a', text: '旧' }] };
  const out = transfer.mergeDays(cur, { '2026-09-20': [{ id: 'a', text: '新' }, { id: 'b', text: '新增' }] });

  assert.strictEqual(out['2026-09-20'].length, 2);
  assert.strictEqual(out['2026-09-20'][0].id, 'a');
  assert.strictEqual(out['2026-09-20'][0].text, '新');
  assert.strictEqual(out['2026-09-20'][1].id, 'b');
});

test('mergeList: 同一 id 顶掉且位置不动，多出来的排在后面', () => {
  const cur = [{ id: 'a', text: '旧' }, { id: 'b' }];
  const out = transfer.mergeList(cur, [{ id: 'a', text: '新' }, { id: 'c' }]);

  assert.deepStrictEqual(out.map(x => x.id), ['a', 'b', 'c']);
  assert.strictEqual(out[0].text, '新');
  assert.strictEqual(cur[0].text, '旧', '不该改入参');
});

test('describeSlice: 报出条数和跨几天', () => {
  const d = transfer.describeSlice({
    '2026-09-20': [{ id: 'a' }, { id: 'b' }],
    '2026-09-22': [{ id: 'c' }]
  });
  assert.strictEqual(d.count, 3);
  assert.strictEqual(d.days, 2);
  assert.deepStrictEqual(transfer.describeSlice({}), { count: 0, days: 0 });
});
