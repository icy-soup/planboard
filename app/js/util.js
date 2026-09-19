(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});

  // 清醒日从 05:00 起算（设计文档 §5.1）
  const DAY_START_MINUTES = 300;
  // 每小时 60px，即 1 分钟 = 1px
  const PX_PER_HOUR = 60;

  function pad2(n) { return String(n).padStart(2, '0'); }

  function toMinutes(hhmm) {
    const [h, m] = String(hhmm).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  function toHHMM(minutes) {
    const m = ((minutes % 1440) + 1440) % 1440;
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }

  // 真实时刻 → 清醒日网格纵向偏移（0..1439 分钟）
  function offsetFromTime(hhmm) {
    return (toMinutes(hhmm) - DAY_START_MINUTES + 1440) % 1440;
  }

  function timeFromOffset(offset) {
    return toHHMM(offset + DAY_START_MINUTES);
  }

  // 同一清醒日内两个时刻的间隔，跨午夜安全
  function durationMinutes(start, end) {
    const d = offsetFromTime(end) - offsetFromTime(start);
    return d > 0 ? d : d + 1440;
  }

  function toDateStr(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseDate(dateStr) {
    return new Date(dateStr + 'T00:00:00');
  }

  function dayOfWeek(dateStr) {
    const d = parseDate(dateStr).getDay();   // 0=周日
    return d === 0 ? 7 : d;                  // 转成 1=周一 … 7=周日
  }

  function addDays(dateStr, n) {
    const d = parseDate(dateStr);
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  }

  function startOfWeek(dateStr) {
    return addDays(dateStr, -(dayOfWeek(dateStr) - 1));
  }

  function daysBetween(aStr, bStr) {
    const a = parseDate(aStr), b = parseDate(bStr);
    return Math.round((b - a) / 86400000);
  }

  // 1-based 周次；semesterStart 为学期第一周周一
  function weekNo(dateStr, semesterStart) {
    return Math.floor(daysBetween(semesterStart, dateStr) / 7) + 1;
  }

  // 「持续周数」与「生效止」互推。N 周含首尾，所以末日 = 起 + N×7 − 1 天
  function endFromWeeks(fromStr, weeks) {
    const n = Math.round(Number(weeks));
    if (!fromStr || !Number.isFinite(n) || n <= 0) return null;
    return addDays(fromStr, n * 7 - 1);
  }

  // 反向推算周数。区间是闭区间，所以天数要 +1
  function weeksBetween(fromStr, toStr) {
    if (!fromStr || !toStr) return null;
    const n = Math.round((daysBetween(fromStr, toStr) + 1) / 7);
    return n > 0 ? n : null;
  }

  function formatShortDate(dateStr) {
    const d = parseDate(dateStr);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function formatDateLabel(dateStr) {
    const d = parseDate(dateStr);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function todayStr() { return toDateStr(new Date()); }

  function isToday(dateStr) { return dateStr === todayStr(); }

  const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];
  function weekdayLabel(dateStr) { return WEEKDAY_CN[parseDate(dateStr).getDay()]; }

  // ---------- 周视图时间轴：分段压缩 ----------
  // 默认露出的时段是 07:00 – 次日 01:00，两端各有一段可折叠的窄带
  const WEEK_PX_PER_MIN = 48 / 60;   // 每小时 48px
  const WEEK_BAND_H = 24;            // 折叠带收起时的高度

  function weekBands() {
    return [
      { id: 'early', from: 0,                       to: offsetFromTime('07:00'), banner: '05:00–07:00' },
      { id: 'main',  from: offsetFromTime('07:00'), to: offsetFromTime('01:00'), banner: null },
      { id: 'night', from: offsetFromTime('01:00'), to: 1440,                    banner: '01:00–05:00' }
    ];
  }

  // 按展开状态算出每段的 y 偏移与高度。expanded 形如 { early: true, night: false }
  function weekLayout(expanded) {
    let y = 0;
    return weekBands().map(s => {
      const open = s.banner === null || !!(expanded && expanded[s.id]);
      const height = open ? (s.to - s.from) * WEEK_PX_PER_MIN : WEEK_BAND_H;
      const seg = Object.assign({}, s, { open, y, height });
      y += height;
      return seg;
    });
  }

  function weekTotalHeight(layout) {
    const last = layout[layout.length - 1];
    return last.y + last.height;
  }

  // 清醒日偏移 → 网格纵向像素（段内按比例，所以折叠段被压缩）
  function weekY(offset, layout) {
    for (const s of layout) {
      if (offset < s.to) {
        const within = Math.max(offset, s.from) - s.from;
        return s.y + (within / (s.to - s.from)) * s.height;
      }
    }
    return weekTotalHeight(layout);
  }

  // 像素 → 清醒日偏移，weekY 的逆运算
  function weekOffset(y, layout) {
    for (const s of layout) {
      if (y < s.y + s.height) {
        const within = Math.max(y, s.y) - s.y;
        return s.from + (within / s.height) * (s.to - s.from);
      }
    }
    return 1440;
  }

  // ---------- 时间输入 ----------
  // 原生 <input type="time"> 是「时 / 分」两格的分段控件：你打的数字一旦不可能再延长，
  // 它就立刻提交并跳走（打 "3" 时 30–39 不是合法小时，所以当场变成 03），
  // 没法连着打两位。所以可见的那个框改用普通文本框，靠下面两个函数补全。
  function buildTime(h, m) {
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return pad2(h) + ':' + pad2(m);
  }

  // 把随手打的串补成 HH:MM，认不出来返回 null（调用方保持原值）
  //   3 / 03 / 3:      → 03:00     （一位或两位且 ≤23，当时）
  //   13 / 13:         → 13:00
  //   30               → fallbackHour:30  （24–59 当分，省得把小时弄丢）
  //   330 / 3:3        → 03:30
  //   1330 / 13.30     → 13:30
  function parseTimeInput(raw, fallbackHour) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return null;

    // 带分隔符的（: . ． ， 空格）两边各 1–2 位
    const marked = s.match(/^(\d{1,2})\s*[:.．，,\s]\s*(\d{1,2})$/);
    if (marked) return buildTime(Number(marked[1]), Number(marked[2]));

    if (!/^\d+$/.test(s)) return null;
    if (s.length <= 2) {
      const n = Number(s);
      if (s.length === 1 || n <= 23) return buildTime(n, 0);
      const fh = Number(fallbackHour);
      return buildTime(Number.isFinite(fh) ? fh : 0, n);
    }
    if (s.length === 3) return buildTime(Number(s.slice(0, 1)), Number(s.slice(1)));
    if (s.length === 4) return buildTime(Number(s.slice(0, 2)), Number(s.slice(2)));
    return null;
  }

  // 文本框只在失焦时才触发 change。回车就当失焦，免得打了值却没生效
  // （下次别处一重建，输入框从模型取值，刚打的就没了）。
  function timeKeydown(e) {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  }

  // 一对时间框（.time-text 打字 / .time-native 只用来开原生选择器）互相对齐。
  // el 是刚发生 change 的那个；返回补全后的 HH:MM，认不出来则退回原值并返回 null。
  function syncTimeField(el) {
    const span = el.closest('.time-field');
    if (!span) return null;
    const text = span.querySelector('.time-text');
    const native = span.querySelector('.time-native');
    if (!text || !native) return null;

    const fromNative = el === native;
    // 拿对面那个框的旧值当「当前小时」，这样只打 "30" 不会把小时抹掉
    const fallbackHour = Math.floor(toMinutes((fromNative ? text : native).value) / 60);
    const parsed = parseTimeInput(el.value, fallbackHour);
    if (!parsed) { el.value = fromNative ? text.value : native.value; return null; }
    text.value = parsed;
    native.value = parsed;
    return parsed;
  }

  // 依赖浏览器的 document；Node 下只导出不调用，供测试断言存在性
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str; return div.innerHTML;
  }

  // 放进 HTML 属性值（value="" / title=""）里用。
  // innerHTML 那条路不转义引号，属性里会直接跑出去。
  function attr(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  const api = {
    DAY_START_MINUTES, PX_PER_HOUR,
    pad2, toMinutes, toHHMM,
    offsetFromTime, timeFromOffset, durationMinutes,
    toDateStr, parseDate, dayOfWeek, addDays, startOfWeek, daysBetween, weekNo,
    endFromWeeks, weeksBetween,
    formatShortDate, formatDateLabel, todayStr, isToday, weekdayLabel, escapeHtml, attr,
    parseTimeInput, syncTimeField, timeKeydown,
    WEEK_PX_PER_MIN, WEEK_BAND_H,
    weekBands, weekLayout, weekTotalHeight, weekY, weekOffset
  };
  PB.util = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
