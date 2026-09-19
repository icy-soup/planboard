const { test } = require('node:test');
const assert = require('node:assert');
const util = require('../app/js/util.js');
const store = require('../app/js/store.js');
const template = require('../app/js/template.js');
const edit = require('../app/js/edit-modal.js');

// 这组直接跑真实模块，只把 DOM / 弹窗依赖换成假件
const PB = globalThis.PB;
const nodes = {};
globalThis.document = {
  getElementById: (id) => nodes[id] || (nodes[id] = {
    innerHTML: '', textContent: '', value: '', checked: false,
    classList: { add() {}, remove() {}, contains: () => false }
  })
};
globalThis.confirm = () => true;
PB.week = { renderWeek() {} };
PB.list = { render() {}, showToast() {} };
PB.tplcal = { open() {}, select() {} };

// render() 会调 util.escapeHtml，而它要 document.createElement。
// 这儿只关心转义结果，直接换掉，省得为测试搭一套 DOM 假件。
util.escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function freshCourse() {
  const st = store.get();
  st.tasks = {};
  st.templates = [{
    id: 'T1', weekday: 1, start: '08:00', end: '09:35',
    text: '智能芯片与系统实践', loc: 'G209', parity: 'odd',
    from: '2026-09-14', to: '2027-01-03', enabled: true
  }];
  st.config.semesterStart = '2026-09-14';
  st.config.semesterEnd = '2027-01-03';
  return st;
}

const dayTasks = (st, date) => st.tasks[date] || [];

test('点课表课程：弹只读详情，没有输入框也没有分类', () => {
  freshCourse();
  edit.openTask('2026-09-14', 'v_T1');
  const html = nodes.editBody.innerHTML;

  assert.strictEqual(nodes.editTitle.textContent, '课表课程');
  assert.ok(!html.includes('efSubject'), '不该出现分类下拉');
  assert.ok(!html.includes('efText'), '不该出现可改的输入框');
  assert.ok(!html.includes('工作'), '课程不属于任务分类，不该冒出「工作」');
  assert.ok(html.includes('智能芯片与系统实践'));
  assert.ok(html.includes('G209'));
  assert.ok(html.includes('16 周'));            // 生效范围里带出的持续周数
  assert.ok(html.includes('单周'));
});

test('只读详情的按钮：这天不上 / 去课表日历改 / 关闭', () => {
  freshCourse();
  edit.openTask('2026-09-14', 'v_T1');
  const html = nodes.editBody.innerHTML;

  assert.ok(html.includes('PB.edit.skipDay()'));
  assert.ok(html.includes('PB.edit.gotoCalendar()'));
  assert.ok(html.includes('PB.edit.close()'));
  assert.ok(!html.includes('PB.edit.save()'), '不该给「固化为任务」');
  assert.ok(!html.includes('PB.edit.remove()'), '不该给删除');
});

test('课程弹窗不会被 save() 固化成任务', () => {
  const st = freshCourse();
  edit.openTask('2026-09-14', 'v_T1');
  edit.save();
  assert.deepStrictEqual(st.tasks, {});
});

test('课程弹窗不会被 remove() 删掉', () => {
  const st = freshCourse();
  edit.openTask('2026-09-14', 'v_T1');
  edit.remove();
  assert.deepStrictEqual(st.tasks, {});
});

test('「这天不上」写墓碑，当天不再显示这门课，课表本身不动', () => {
  const st = freshCourse();
  const weekNo = util.weekNo('2026-09-14', st.config.semesterStart);
  assert.strictEqual(
    template.resolveDayTasks('2026-09-14', weekNo, st.templates, dayTasks(st, '2026-09-14')).length, 1);

  edit.openTask('2026-09-14', 'v_T1');
  edit.skipDay();

  assert.strictEqual(
    template.resolveDayTasks('2026-09-14', weekNo, st.templates, dayTasks(st, '2026-09-14')).length, 0);
  assert.strictEqual(st.templates.length, 1, '课表本身不动');
  assert.strictEqual(st.templates[0].enabled, true);
});

test('「这天不上」只影响这一天', () => {
  const st = freshCourse();
  const later = '2026-09-28';                       // 第 3 周，单周，照常上课
  edit.openTask('2026-09-14', 'v_T1');
  edit.skipDay();

  const weekNo = util.weekNo(later, st.config.semesterStart);
  assert.strictEqual(
    template.resolveDayTasks(later, weekNo, st.templates, dayTasks(st, later)).length, 1);
});

test('去课表日历改：把选中的课带过去', () => {
  freshCourse();
  const calls = [];
  PB.tplcal = { open: () => calls.push('open'), select: (id) => calls.push('select:' + id) };

  edit.openTask('2026-09-14', 'v_T1');
  edit.gotoCalendar();

  assert.deepStrictEqual(calls, ['open', 'select:T1']);
});
