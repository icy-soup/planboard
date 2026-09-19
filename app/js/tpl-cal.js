(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});

  // 在 Node 下被测试 require 时，需自行加载依赖（浏览器中 util.js 已先于本文件执行）
  if (typeof module !== 'undefined' && module.exports && !PB.util) require('./util.js');
  const util = PB.util;

  const HOUR_PX = 28;           // 每小时 28px
  const SNAP_MIN = 15;          // 拖拽吸附粒度（分钟）
  const MIN_DURATION = 15;      // 最小时长（分钟）
  const MIN_BLOCK_H = 16;       // 块最小可见高度
  const RESIZE_EDGE = 6;        // 底部 6px 内按下视为改时长
  const DEFAULT_DURATION = 90;  // 新建课程默认时长
  const LABEL_MIN_TOP = 8;      // 顶部那条时刻标签别被表头切掉
  const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日'];
  const PARITY_CN = [['all', '每周'], ['odd', '单周'], ['even', '双周']];

  let range = { from: 6 * 60, to: 24 * 60 };
  let selectedId = null;
  let drag = null;
  let suppressClick = false;

  // 属性值要转义引号，util.escapeHtml 只处理 &<>，放进 value="" 里会漏
  function attr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 默认窗口 06:00–24:00；有课程落在外面就自动撑开，保证不会有块看不见
  function computeRange(templates) {
    let from = 6 * 60, to = 24 * 60;
    for (const t of templates) {
      const s = util.toMinutes(t.start);
      const e = Math.min(s + util.durationMinutes(t.start, t.end), 1440);
      if (s < from) from = s;
      if (e > to) to = e;
    }
    return { from: Math.floor(from / 60) * 60, to: Math.min(Math.ceil(to / 60) * 60, 1440) };
  }

  const y = (minute) => (minute - range.from) / 60 * HOUR_PX;
  const minuteAt = (py) => range.from + py / HOUR_PX * 60;
  const totalH = () => y(range.to);

  function snap(minute, from, to) {
    const snapped = Math.round(minute / SNAP_MIN) * SNAP_MIN;
    return Math.max(from, Math.min(to, snapped));
  }

  function selected() {
    return PB.store.get().templates.find(t => t.id === selectedId) || null;
  }

  // ============ 渲染 ============
  function render() {
    const el = document.getElementById('tplCal');
    if (!el) return;
    const templates = PB.store.get().templates;
    range = computeRange(templates);
    const H = totalH();

    let head = '<div class="tplcal-gutter"></div>';
    for (let wd = 1; wd <= 7; wd++) head += `<div class="tplcal-day">周${WEEKDAY_CN[wd - 1]}</div>`;

    let hours = '';
    for (let m = range.from; m <= range.to; m += 60) {
      hours += `<div class="tplcal-hour" style="top:${Math.max(y(m), LABEL_MIN_TOP)}px">${
        util.pad2(m / 60 % 24)}:00</div>`;
    }

    let cols = '';
    for (let wd = 1; wd <= 7; wd++) {
      let slots = '';
      for (let m = range.from; m < range.to; m += 60) {
        slots += `<div class="tplcal-slot" style="top:${y(m)}px;height:${HOUR_PX}px"
          onclick="PB.tplcal.onSlotClick(${wd}, '${util.toHHMM(m)}')"></div>`;
      }
      const blocks = templates.filter(t => t.weekday === wd).map(blockHtml).join('');
      cols += `<div class="tplcal-col" data-weekday="${wd}" style="height:${H}px">${slots}${blocks}</div>`;
    }

    el.innerHTML = `${templates.length ? '' :
      '<div class="tplcal-empty">还没有课表项 · 点任意空格添加第一门课</div>'}
      <div class="tplcal-scroll">
      <div class="tplcal-head">${head}</div>
      <div class="tplcal-body">
        <div class="tplcal-gutter" style="height:${H}px">${hours}</div>
        <div class="tplcal-cols">${cols}</div>
      </div>
    </div>`;

    renderDetail();
  }

  function blockHtml(t) {
    const s = util.toMinutes(t.start);
    const dur = util.durationMinutes(t.start, t.end);
    const top = y(Math.max(s, range.from));
    const height = Math.max(y(Math.min(s + dur, range.to)) - top, MIN_BLOCK_H);
    const color = PB.store.COURSE_COLOR;
    const badge = t.parity === 'odd' ? '单' : t.parity === 'even' ? '双' : '';
    const title = `${t.text}　${t.start}–${t.end}` + (t.loc ? `　@ ${t.loc}` : '') + (badge ? `　${badge}周` : '');

    return `<div class="tplcal-block${t.enabled ? '' : ' off'}${t.id === selectedId ? ' sel' : ''}"
        data-id="${t.id}"
        style="top:${top}px;height:${height}px;background:${color}22;border-left:3px solid ${color};color:${color}"
        title="${attr(title)}"
        onpointerdown="PB.tplcal.onBlockDown(event)">
      ${badge ? `<span class="tplcal-badge">${badge}</span>` : ''}
      <span class="tplcal-name">${util.escapeHtml(t.text)}</span>
      <button class="tplcal-del" title="删除"
        onpointerdown="event.stopPropagation()"
        onclick="PB.tplcal.remove('${t.id}')">✕</button>
    </div>`;
  }

  // ---- 右侧详情面板 ----
  function renderDetail() {
    const el = document.getElementById('tplCalDetail');
    if (!el) return;
    // 重建会把正在编辑的 DOM 整个换掉、焦点掉回 body，所以先记下改的是哪个字段，建完还回去。
  // 字段名写在各自的 data-field 上；时间那种一对输入框写成 .time-field 那个 span 上。
    const active = document.activeElement;
    const focused = (active && el.contains(active)) ? active.closest('[data-field]') : null;
    const restore = focused ? focused.dataset.field : null;

    const t = selected();
    if (!t) {
      el.innerHTML = '<div class="tplcal-detail-empty">点左边的课块，在这里改它的详情</div>';
      return;
    }
    const weeks = util.weeksBetween(t.from, t.to);
    // 单双周靠开学日期算周次；没设的话 templateApplies 会降级成每周，得说出来
    const parityWarn = (t.parity !== 'all' && !PB.store.get().config.semesterStart)
      ? '<div class="tplcal-detail-warn">还没设开学日期，这门课的单双周现在按每周显示</div>' : '';

    el.innerHTML = `
      <h4>课程详情</h4>
      <label>名称<input type="text" data-field="text" value="${attr(t.text)}"
        onchange="PB.tplcal.setField('text', this.value)"></label>
      <label>地点 / 教室<input type="text" data-field="loc" placeholder="例如：三教 305" value="${attr(t.loc || '')}"
        onchange="PB.tplcal.setField('loc', this.value)"></label>
      <label>周几<select onchange="PB.tplcal.setField('weekday', Number(this.value))">
        ${WEEKDAY_CN.map((c, i) => `<option value="${i + 1}"${i + 1 === t.weekday ? ' selected' : ''}>周${c}</option>`).join('')}
      </select></label>
      <label>频次<select onchange="PB.tplcal.setField('parity', this.value)">
        ${PARITY_CN.map(([v, lb]) => `<option value="${v}"${v === t.parity ? ' selected' : ''}>${lb}</option>`).join('')}
      </select></label>
      ${parityWarn}
      <div class="tplcal-detail-row">
        <label>开始<span class="time-field" data-field="start" onkeydown="PB.util.timeKeydown(event)">
          <input type="text" class="time-text" inputmode="numeric" maxlength="5" value="${attr(t.start)}"
            onchange="PB.tplcal.onTime(this)">
          <input type="time" class="time-native" tabindex="-1" value="${attr(t.start)}"
            onchange="PB.tplcal.onTime(this)"></span></label>
        <label>结束<span class="time-field" data-field="end" onkeydown="PB.util.timeKeydown(event)">
          <input type="text" class="time-text" inputmode="numeric" maxlength="5" value="${attr(t.end)}"
            onchange="PB.tplcal.onTime(this)">
          <input type="time" class="time-native" tabindex="-1" value="${attr(t.end)}"
            onchange="PB.tplcal.onTime(this)"></span></label>
      </div>
      <div class="tplcal-detail-row">
        <label>生效起<input type="date" data-field="from" value="${attr(t.from || '')}"
          onchange="PB.tplcal.setField('from', this.value)"></label>
        <label>生效止<input type="date" data-field="to" value="${attr(t.to || '')}"
          onchange="PB.tplcal.setField('to', this.value)"></label>
      </div>
      <label>持续周数<input type="number" data-field="weeks" min="1" max="52" placeholder="填了自动算生效止"
        value="${weeks == null ? '' : weeks}"
        onchange="PB.tplcal.setField('weeks', this.value)"></label>
      <div class="tplcal-detail-note">改周数会写「生效止」；改「生效止」会按整周对齐并重算周数</div>
      <label class="tplcal-detail-check"><input type="checkbox"${t.enabled ? ' checked' : ''}
        onchange="PB.tplcal.setField('enabled', this.checked)"> 启用这门课</label>
      <button class="btn btn-danger" onclick="PB.tplcal.remove('${t.id}')">删除这门课</button>
    `;

    if (!restore) return;
    const next = el.querySelector(`[data-field="${restore}"] .time-text`)
              || el.querySelector(`[data-field="${restore}"]`);
    if (!next) return;
    next.focus();
    // date / number 这类输入不支持选区内操作，select() 会抛 InvalidStateError，
    // 所以只对文本框做全选（正好省得删掉老值重打）
    if (next.type === 'text') next.select();
  }

  // 任何改动都立刻落盘，并同步周视图
  function commit() {
    PB.store.save();
    render();
    PB.week.renderWeek();
  }

  // ============ 打开 / 关闭 ============
  function open() {
    document.getElementById('tplCalModal').classList.add('open');
    render();
  }
  function close() {
    document.getElementById('tplCalModal').classList.remove('open');
  }
  function onOverlayClick(e) {
    if (e.target.classList.contains('modal-overlay')) close();
  }

  // ============ 增删改 ============
  function onSlotClick(weekday, startHHMM) {
    if (suppressClick) { suppressClick = false; return; }
    const st = PB.store.get();
    const s = util.toMinutes(startHHMM);
    // 生效范围默认取设置里的学期起止，建完还能在详情面板里改
    const t = {
      id: 'tpl' + Date.now() + Math.random().toString(36).slice(2, 5),
      weekday,
      start: startHHMM,
      end: util.toHHMM(s + DEFAULT_DURATION),
      text: '新课程',
      loc: '',
      parity: 'all',
      from: st.config.semesterStart || null,
      to: st.config.semesterEnd || null,
      enabled: true
    };
    st.templates.push(t);
    selectedId = t.id;
    commit();
  }

  // 自由打字的时间框：补全成 HH:MM 后写回模型
  function onTime(el) {
    const v = util.syncTimeField(el);
    if (v) setField(el.closest('.time-field').dataset.field, v);
  }

  function setField(field, value) {
    const t = selected();
    if (!t) return;

    // 生效起 / 生效止 / 持续周数 三者互推，改哪个都让另外两个跟着自洽
    if (field === 'weeks') {
      const end = util.endFromWeeks(t.from, value);
      if (!end) {
        PB.list.showToast('先填「生效起」，才能按周数推生效止');
        render();     // 把输入框里的数字弹回真实值，别让界面和数据对不上
        return;
      }
      t.to = end;
      commit();
      return;
    }

    if (field === 'from') {
      const weeks = util.weeksBetween(t.from, t.to);   // 先按旧区间量出周数
      t.from = value || null;
      // 起点挪了终点跟着挪；起被清空就留住原来的止 —— 只有「止」也是合法的
      if (weeks && t.from) t.to = util.endFromWeeks(t.from, weeks);
      commit();
      return;
    }

    if (field === 'to') {
      // 按整周对齐，否则「周数 × 7」跟生效止对不上
      t.to = util.endFromWeeks(t.from, util.weeksBetween(t.from, value)) || (value || null);
      commit();
      return;
    }

    t[field] = value;
    // 起止相同会被 durationMinutes 算成 1440 分钟（铺满一整天），错开 15 分钟
    if (t.start === t.end) t.end = util.toHHMM(util.toMinutes(t.start) + MIN_DURATION);
    commit();
  }

  function remove(id) {
    const st = PB.store.get();
    const t = st.templates.find(x => x.id === id);
    if (!t) return;
    if (!confirm(`删除课表项「${t.text}」？`)) return;
    st.templates = st.templates.filter(x => x.id !== id);
    if (selectedId === id) selectedId = null;
    commit();
    PB.list.showToast('已删除课表项');
  }

  function select(id) {
    selectedId = id;
    render();
  }

  // ============ 拖拽：上下改时间、左右改星期、底边改时长 ============
  function onBlockDown(e) {
    if (e.button !== 0) return;
    const el = e.target.closest('.tplcal-block');
    if (!el) return;
    suppressClick = false;

    const rect = el.getBoundingClientRect();
    drag = {
      mode: e.clientY > rect.bottom - RESIZE_EDGE ? 'resize' : 'move',
      id: el.dataset.id,
      el,
      startX: e.clientX,
      startY: e.clientY,
      origTop: parseFloat(el.style.top) || 0,
      origHeight: parseFloat(el.style.height) || 0,
      weekday: Number(el.closest('.tplcal-col').dataset.weekday),
      pendingWeekday: null,
      moved: false
    };
    el.classList.add('dragging');
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    const dx = e.clientX - drag.startX;
    if (Math.abs(dy) > 3 || Math.abs(dx) > 3) drag.moved = true;
    if (!drag.moved) return;

    if (drag.mode === 'resize') {
      const maxH = totalH() - drag.origTop;
      drag.el.style.height = Math.max(MIN_BLOCK_H, Math.min(maxH, drag.origHeight + dy)) + 'px';
      return;
    }

    const top = Math.max(0, Math.min(totalH() - drag.origHeight, drag.origTop + dy));
    drag.el.style.top = top + 'px';

    const col = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tplcal-col');
    document.querySelectorAll('.tplcal-col.hover').forEach(c => c.classList.remove('hover'));
    drag.pendingWeekday = col ? Number(col.dataset.weekday) : drag.weekday;
    if (col && drag.pendingWeekday !== drag.weekday) col.classList.add('hover');
  }

  function onPointerUp() {
    if (!drag) return;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    drag.el.classList.remove('dragging');
    document.querySelectorAll('.tplcal-col.hover').forEach(c => c.classList.remove('hover'));

    const d = drag;
    drag = null;

    // 没挪动 = 一次点击，选中它并显示详情
    if (!d.moved) { select(d.id); return; }

    suppressClick = true;
    const t = PB.store.get().templates.find(x => x.id === d.id);
    if (!t) return;

    if (d.mode === 'resize') {
      const bottomPx = parseFloat(d.el.style.top) + (parseFloat(d.el.style.height) || d.origHeight);
      const start = util.toMinutes(t.start);
      let end = Math.max(snap(minuteAt(bottomPx), range.from, range.to), start + MIN_DURATION);
      t.end = util.toHHMM(Math.min(end, 1440));
    } else {
      const start = snap(minuteAt(parseFloat(d.el.style.top) || d.origTop), range.from, range.to);
      const dur = util.durationMinutes(t.start, t.end);
      t.start = util.toHHMM(start);
      t.end = util.toHHMM(start + dur);
      if (d.pendingWeekday) t.weekday = d.pendingWeekday;
    }
    selectedId = d.id;
    commit();
  }

  const api = {
    open, close, render, onOverlayClick, onSlotClick, onBlockDown, remove, select, setField, onTime,
    // 纯计算部分，供 test/ 直接断言
    computeRange, snap, SNAP_MIN, MIN_DURATION, DEFAULT_DURATION, HOUR_PX
  };
  PB.tplcal = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
