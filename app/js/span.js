(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});

  // 在 Node 下被测试 require 时，需自行加载依赖（浏览器中 util.js 已先于本文件执行）
  if (typeof module !== 'undefined' && module.exports && !PB.util) require('./util.js');
  const util = PB.util;

  // 全天 / 跨天任务的公共逻辑。这两个是**互相独立**的两个维度（2026-09-22 拆开）：
  //   allDay: true                → 不占时间网格，画在顶部带子里
  //   to 晚于 date                → 跨天，覆盖 date 到 to 的每一天
  // 一条任务可以只有其中一个（全天但就一天 / 有时段但跨好几天），也可以两个都占。
  // 完成度有两种存法，看 isPerDay()：跨天且选了「做完一次」之外，都按天记。

  // 跨天 = 写了一个晚于起始日的 to。跟全不全天无关。
  function isMultiDay(t) {
    return !!(t && t.date && t.to && t.to > t.date);
  }

  // 有区间的任务：全天（哪怕只占一天）或者跨天。普通单天任务没有区间。
  function spanRange(t) {
    if (!t || !t.date) return null;
    const multi = isMultiDay(t);
    if (!multi && !t.allDay) return null;
    return { from: t.date, to: multi ? t.to : t.date };
  }

  function coversDay(t, date) {
    const r = spanRange(t);
    return !!r && date >= r.from && date <= r.to;
  }

  function dayCount(t) {
    const r = spanRange(t);
    return r ? util.daysBetween(r.from, r.to) + 1 : 0;
  }

  // 完成勾怎么记：跨天且没选「做完一次」→ 按天；其余（单天、或跨天但只做一次）→ 一个整体勾。
  // 全天任务即使只占一天也按天记 —— 历史就是这么存的，改了要给老数据做迁移，不值当。
  function isPerDay(t) {
    return !!t && !t.once && (!!t.allDay || isMultiDay(t));
  }

  function isDoneDay(t, date) {
    if (!isPerDay(t)) return !!t.done;
    return !!(t.doneDays && t.doneDays[date]);
  }

  function setDoneDay(t, date, on) {
    if (!isPerDay(t)) { t.done = !!on; return; }   // 整条一个勾，跟哪一天无关
    if (!coversDay(t, date)) return;               // 范围外的日期勾不上
    if (on) {
      if (!t.doneDays) t.doneDays = {};
      t.doneDays[date] = true;
    } else if (t.doneDays) {
      delete t.doneDays[date];
      // 全取消掉就把这个空壳也去掉，别在数据里留 {}
      if (!Object.keys(t.doneDays).length) delete t.doneDays;
    }
  }

  // 缩过范围之后，doneDays 里可能留着范围外的日期，不数它们
  function doneCount(t) {
    if (!isPerDay(t)) return t && t.done ? 1 : 0;
    if (!t.doneDays) return 0;
    return Object.keys(t.doneDays).filter(d => coversDay(t, d)).length;
  }

  // 全天任务挂在起始日那一格里，所以「跨到本周」的那些要扫全表才找得到
  function allSpans(tasks) {
    const out = [];
    for (const key of Object.keys(tasks || {})) {
      for (const t of tasks[key]) {
        if (!t.allDay) continue;
        // 列表视图「+ 添加任务」建出来的对象没有 date 字段，按它所在的那一格补上，
        // 否则后面的区间判定全落空、带子凭空消失
        if (!t.date) t.date = key;
        if (spanRange(t)) out.push(t);
      }
    }
    return out;
  }

  // 有时段的跨天任务：也挂在起始日那一格，但覆盖到的每一天都要在时间网格里出现。
  // 起始日那天本来就在它自己的桶里，所以只扫别的格子。
  function timedCovering(tasks, date) {
    const out = [];
    for (const key of Object.keys(tasks || {})) {
      if (key === date) continue;
      for (const t of tasks[key]) {
        if (t.allDay || !isMultiDay(t)) continue;
        if (date >= t.date && date <= t.to) out.push(t);
      }
    }
    return out;
  }

  // 这条带子在本周的 dates 里占哪几列（含首尾）；完全不相交返回 null
  function columns(t, dates) {
    const r = spanRange(t);
    if (!r) return null;
    let startIdx = -1, endIdx = -1;
    for (let i = 0; i < dates.length; i++) {
      if (dates[i] >= r.from && dates[i] <= r.to) {
        if (startIdx === -1) startIdx = i;
        endIdx = i;
      }
    }
    if (startIdx === -1) return null;
    return {
      startIdx, endIdx,
      before: r.from < dates[startIdx],   // 左边还有几天，被本周切掉了
      after: r.to > dates[endIdx]
    };
  }

  // 分道：同一行里不能有互相重叠的带子，按起始列贪心往下排
  function weekSpans(tasks, dates) {
    const items = [];
    for (const t of allSpans(tasks)) {
      const c = columns(t, dates);
      if (c) items.push(Object.assign({ task: t }, c));
    }
    items.sort((a, b) => a.startIdx - b.startIdx || a.endIdx - b.endIdx);

    const rowEnds = [];
    for (const p of items) {
      let row = rowEnds.findIndex(end => end < p.startIdx);
      if (row === -1) { row = rowEnds.length; rowEnds.push(p.endIdx); }
      else rowEnds[row] = p.endIdx;
      p.row = row;
    }
    // 一行都没有也要留一行：空行是「点这里新建全天任务」的落点
    return { items, rows: Math.max(rowEnds.length, 1) };
  }

  const api = { isMultiDay, spanRange, coversDay, dayCount, isPerDay,
                isDoneDay, setDoneDay, doneCount,
                allSpans, timedCovering, columns, weekSpans };
  PB.span = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
