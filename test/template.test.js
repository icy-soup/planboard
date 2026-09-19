const { test } = require('node:test');
const assert = require('node:assert');
const template = require('../app/js/template.js');

function tpl(over = {}) {
  return { id: 'T1', weekday: 1, start: '08:00', end: '09:40',
           text: '高数', subject: 'study', parity: 'all',
           from: '2026-09-01', to: '2026-12-31', enabled: true, ...over };
}

test('templateApplies: 星期几必须匹配', () => {
  assert.strictEqual(template.templateApplies(tpl(), '2026-09-14', 2), true);   // 周一
  assert.strictEqual(template.templateApplies(tpl(), '2026-09-15', 2), false);  // 周二
});

test('templateApplies: 生效日期范围为闭区间', () => {
  assert.strictEqual(template.templateApplies(tpl({ from: '2026-09-14' }), '2026-09-14', 2), true);
  assert.strictEqual(template.templateApplies(tpl({ to: '2026-09-14' }), '2026-09-14', 2), true);
  assert.strictEqual(template.templateApplies(tpl({ from: '2026-09-15' }), '2026-09-14', 2), false);
  assert.strictEqual(template.templateApplies(tpl({ to: '2026-09-13' }), '2026-09-14', 2), false);
});

test('templateApplies: 单双周', () => {
  assert.strictEqual(template.templateApplies(tpl({ parity: 'odd' }),  '2026-09-14', 1), true);
  assert.strictEqual(template.templateApplies(tpl({ parity: 'odd' }),  '2026-09-14', 2), false);
  assert.strictEqual(template.templateApplies(tpl({ parity: 'even' }), '2026-09-14', 1), false);
  assert.strictEqual(template.templateApplies(tpl({ parity: 'even' }), '2026-09-14', 2), true);
});

test('templateApplies: weekNo 为 null 时单双周降级为每周', () => {
  assert.strictEqual(template.templateApplies(tpl({ parity: 'odd' }), '2026-09-14', null), true);
  assert.strictEqual(template.templateApplies(tpl({ parity: 'even' }), '2026-09-14', null), true);
});

test('templateApplies: enabled 为 false 时不适用', () => {
  assert.strictEqual(template.templateApplies(tpl({ enabled: false }), '2026-09-14', 2), false);
});

test('resolveDayTasks: 无实际项时输出虚拟项', () => {
  const out = template.resolveDayTasks('2026-09-14', 2, [tpl()], []);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].virtual, true);
  assert.strictEqual(out[0].text, '高数');
  assert.strictEqual(out[0].templateId, 'T1');
  assert.strictEqual(out[0].start, '08:00');
});

test('resolveDayTasks: 已有实际项时用实际项替换虚拟项', () => {
  const real = { id: 'r1', start: '10:00', end: '11:00', text: '高数(改)',
                 subject: 'study', done: true, templateId: 'T1' };
  const out = template.resolveDayTasks('2026-09-14', 2, [tpl()], [real]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].virtual, false);
  assert.strictEqual(out[0].text, '高数(改)');
  assert.strictEqual(out[0].start, '10:00');
  assert.strictEqual(out[0].done, true);
});

test('resolveDayTasks: 墓碑项隐藏且不输出', () => {
  const tomb = { id: 'r1', templateId: 'T1', deleted: true };
  const out = template.resolveDayTasks('2026-09-14', 2, [tpl()], [tomb]);
  assert.strictEqual(out.length, 0);
});

test('resolveDayTasks: 普通任务照常输出', () => {
  const normal = { id: 'n1', start: '14:00', end: '15:00', text: '打球',
                   subject: 'personal', done: false };
  const out = template.resolveDayTasks('2026-09-14', 2, [], [normal]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].text, '打球');
  assert.strictEqual(out[0].virtual, false);
});

test('resolveDayTasks: 不适用的模板不产生虚拟项', () => {
  const out = template.resolveDayTasks('2026-09-15', 2, [tpl()], []);   // 周二
  assert.strictEqual(out.length, 0);
});

test('resolveDayTasks: 不修改入参数组', () => {
  const dayTasks = [{ id: 'n1', start: '14:00', end: '15:00', text: '打球', subject: 'personal', done: false }];
  const tpls = [tpl()];
  const daySnap = JSON.stringify(dayTasks);
  template.resolveDayTasks('2026-09-14', 2, tpls, dayTasks);
  assert.strictEqual(JSON.stringify(dayTasks), daySnap);
  assert.strictEqual(tpls.length, 1);
});

test('resolveDayTasks: 课程不带 subject 字段也照常产出虚拟项', () => {
  const course = tpl();
  delete course.subject;                    // 课程现在不分「工作/学习」，没有这个字段
  const out = template.resolveDayTasks('2026-09-14', 2, [course], []);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].virtual, true);
  assert.strictEqual(out[0].text, '高数');
});
