(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});

  // 在 Node 下被测试 require 时，需自行加载依赖（浏览器中 util.js 已先于本文件执行）
  if (typeof module !== 'undefined' && module.exports && !PB.util) require('./util.js');
  const util = PB.util;

  // 单个模板是否适用于某一天
  function templateApplies(tpl, dateStr, weekNumber) {
    if (!tpl || tpl.enabled === false) return false;
    if (util.dayOfWeek(dateStr) !== tpl.weekday) return false;
    if (tpl.from && dateStr < tpl.from) return false;
    if (tpl.to && dateStr > tpl.to) return false;
    // weekNumber 为 null（未设置学期起始日）时降级为每周
    if (weekNumber != null && tpl.parity && tpl.parity !== 'all') {
      const isOddWeek = weekNumber % 2 === 1;
      if (tpl.parity === 'odd' && !isOddWeek) return false;
      if (tpl.parity === 'even' && isOddWeek) return false;
    }
    return true;
  }

  // 虚拟叠加：模板项 + 实际项合并，实际项覆盖同 templateId 的模板项
  function resolveDayTasks(dateStr, weekNumber, templates, dayTasks) {
    const out = [];
    const coveredTemplateIds = new Set();

    for (const t of (dayTasks || [])) {
      if (t.templateId) coveredTemplateIds.add(t.templateId);
      if (t.deleted) continue;                  // 墓碑不输出，但已计入 covered
      out.push({ ...t, virtual: false });
    }

    for (const tpl of (templates || [])) {
      if (coveredTemplateIds.has(tpl.id)) continue;
      if (!templateApplies(tpl, dateStr, weekNumber)) continue;
      // 虚拟项不带 subject：课程不属于任务的分类体系，颜色由 store.COURSE_COLOR 统一给
      out.push({
        id: 'v_' + tpl.id,
        start: tpl.start, end: tpl.end,
        text: tpl.text, loc: tpl.loc || '',
        done: false, templateId: tpl.id, virtual: true
      });
    }

    return out;
  }

  const api = { templateApplies, resolveDayTasks };
  PB.template = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
