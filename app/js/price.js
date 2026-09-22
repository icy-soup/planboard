(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});

  // Node 下被测试 require 时，浏览器里 util.js 已先执行
  if (typeof module !== 'undefined' && module.exports && !PB.util) require('./util.js');
  const util = PB.util;

  // ============ DeepSeek 峰谷计价 ============
  // 空闲时段价格 = 高峰时段的一半。
  // 高峰：北京时间周一至周五（不含中国法定节假日）9:00–12:00、14:00–18:00
  // 空闲：其余时段 + 周末 + 中国法定节假日全天
  const PEAK_BLOCKS = [
    { from: '09:00', to: '12:00' },
    { from: '14:00', to: '18:00' }
  ];

  // 中国法定节假日（国务院每年公布，按年维护；日期如有出入以当年公告为准）
  const HOLIDAYS = {
    '2026': [
      '2026-01-01',                                             // 元旦
      '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',   // 春节（除夕–初三）
      '2026-04-05',                                             // 清明节
      '2026-05-01', '2026-05-02',                               // 劳动节
      '2026-06-19',                                             // 端午节
      '2026-09-25',                                             // 中秋节
      '2026-10-01', '2026-10-02', '2026-10-03'                  // 国庆节
    ]
  };

  function holidaySet(dateStr) {
    const year = String(dateStr || '').slice(0, 4);
    const list = HOLIDAYS[year];
    return list ? new Set(list) : null;
  }

  function isHoliday(dateStr) {
    const set = holidaySet(dateStr);
    return !!set && set.has(dateStr);
  }

  // 周末（六 / 日）或法定节假日 → 全天空闲
  function isOffPeakDay(dateStr) {
    if (!dateStr) return false;
    if (isHoliday(dateStr)) return true;
    return util.dayOfWeek(dateStr) >= 6;
  }

  // 某一时刻是否高峰：仅工作日（非节假日）的 9–12 / 14–18
  function isPeak(dateStr, hhmm) {
    if (isOffPeakDay(dateStr)) return false;
    const m = util.toMinutes(hhmm);
    return PEAK_BLOCKS.some(b => m >= util.toMinutes(b.from) && m < util.toMinutes(b.to));
  }

  const api = { PEAK_BLOCKS, HOLIDAYS, isHoliday, isOffPeakDay, isPeak };
  PB.price = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
