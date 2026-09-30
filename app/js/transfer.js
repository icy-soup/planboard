(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});

  // Node 下被测试 require 时自己加载依赖（浏览器里 store / span 已先于本文件执行）
  if (typeof module !== 'undefined' && module.exports) {
    if (!PB.util) require('./util.js');
    if (!PB.span) require('./span.js');
  }
  const span = PB.span;

  // 导出 / 导入的文件格式逻辑。都是纯函数：不碰 DOM、不改入参。

  // ===== 导出 =====
  // 只取区间内那几天的任务。跨天任务挂在起始日那一格，起始日在区间外、
  // 带子却伸进来的也得带上 —— 否则导出的这一周里那条带子会凭空消失。
  // from / to 都不给就是「全部」，此时不写 range 键。
  function sliceForExport(state, from, to, opts) {
    const st = state || {};
    const o = opts || {};
    const ranged = !!(from && to);
    const tasks = {};

    for (const date of Object.keys(st.tasks || {})) {
      const arr = st.tasks[date] || [];
      if (!ranged || (date >= from && date <= to)) { tasks[date] = arr; continue; }
      const spill = arr.filter(t => {
        const r = span.spanRange(t);
        return !!r && r.to >= from && r.from <= to;
      });
      if (spill.length) tasks[date] = spill;
    }

    const out = { version: 2, tasks };
    if (ranged) out.range = { from, to };
    if (o.templates) out.templates = st.templates || [];
    if (o.config) out.config = st.config;
    if (o.memos) out.memos = st.memos || [];
    if (o.timeline) out.timeline = st.timeline || [];
    return out;
  }

  // ===== 导入 =====
  // 覆盖：只换文件里出现过的那几天，其余日期一条不动。
  // 「部分导出 → 改完导回来」不该伤到没导出的日期。
  // 文件里某天是空数组 = 那天被清空（键一起删掉，不留空壳）。
  function replaceDays(cur, inc, range) {
    const out = Object.assign({}, cur || {});
    for (const date of Object.keys(inc || {})) {
      const arr = inc[date];
      // 区间外的日期只可能是跨天任务从区间外溢带入的来源日。
      // 这些日期的其它任务没有被导出，不能整桶替换，否则会误删。
      const outside = range && (date < range.from || date > range.to);
      if (outside) {
        const byId = {};
        for (const t of (out[date] || [])) byId[t.id] = t;
        for (const t of (Array.isArray(arr) ? arr : [])) byId[t.id] = t;
        const merged = Object.values(byId);
        if (merged.length) out[date] = merged; else delete out[date];
      } else if (Array.isArray(arr) && arr.length) out[date] = arr;
      else delete out[date];
    }
    return out;
  }

  // 合并：同一天里按 id 顶掉，文件里多出来的排在后面
  function mergeDays(cur, inc) {
    const out = Object.assign({}, cur || {});
    for (const date of Object.keys(inc || {})) {
      const byId = {};
      for (const t of (out[date] || [])) byId[t.id] = t;
      for (const t of inc[date]) byId[t.id] = t;
      out[date] = Object.values(byId);
    }
    return out;
  }

  // 同一 id 用文件里的那份顶掉，各自的位置不动，文件里多出来的排在后面
  function mergeList(cur, inc) {
    const out = (cur || []).slice();
    for (const item of (inc || [])) {
      const i = out.findIndex(x => x.id === item.id);
      if (i === -1) out.push(item); else out[i] = item;
    }
    return out;
  }

  // 给导入弹窗看的：文件里有多少条、压在几天上
  function describeSlice(tasks) {
    const keys = Object.keys(tasks || {});
    let count = 0;
    for (const date of keys) count += (tasks[date] || []).length;
    return { count, days: keys.length };
  }

  const api = { sliceForExport, replaceDays, mergeDays, mergeList, describeSlice };
  PB.transfer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
