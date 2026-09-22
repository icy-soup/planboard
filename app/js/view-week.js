(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});
  const util = PB.util;

  const MIN_BLOCK_H = 20;      // 任务块最小可见高度（px）
  const COMPACT_H = 34;        // 低于此高度只显示标题，不显示时间行
  const SNAP_MIN = 5;          // 提交时的吸附粒度（分钟）
  const MIN_DURATION = 15;     // 最小时长（分钟）
  const RESIZE_EDGE = 6;       // 底部 6px 内按下视为改时长
  const LABEL_MIN_TOP = 10;    // 时刻标签距网格顶的最小距离（约半个字高，防止被表头切掉）
const SPAN_ROW_H = 48;       // 顶部全天带子每行的高度（跟时间网格 1 小时一样高，格子好点）

  let currentWeekStart = null;        // 该周周一 "YYYY-MM-DD"
  let nowTimer = null;
  let drag = null;
  let suppressClick = false;          // 拖拽后的那次 click 不应触发编辑
  let expanded = loadExpanded();      // { early: bool, night: bool }

  function loadExpanded() {
    try {
      const raw = localStorage.getItem('pb_weekBands');
      if (raw) return Object.assign({ early: false, night: false }, JSON.parse(raw));
    } catch (e) {}
    return { early: false, night: false };
  }

  function saveExpanded() {
    try { localStorage.setItem('pb_weekBands', JSON.stringify(expanded)); } catch (e) {}
  }

  function toggleBand(id) {
    expanded[id] = !expanded[id];
    saveExpanded();
    renderWeek();
  }

  function ensureWeekStart() {
    if (!currentWeekStart) currentWeekStart = util.startOfWeek(util.todayStr());
    return currentWeekStart;
  }

  function weekDates() {
    const s = ensureWeekStart();
    return Array.from({ length: 7 }, (_, i) => util.addDays(s, i));
  }

  function prevWeek() { currentWeekStart = util.addDays(ensureWeekStart(), -7); renderWeek(); }
  function nextWeek() { currentWeekStart = util.addDays(ensureWeekStart(), 7); renderWeek(); }
  function gotoThisWeek() { currentWeekStart = util.startOfWeek(util.todayStr()); renderWeek(); }

  // 一天内的任务块并排分泳道；返回 [{task, lane, laneCount}]
  function layoutOverlaps(items) {
    const sorted = items.slice().sort((a, b) =>
      util.offsetFromTime(a.start) - util.offsetFromTime(b.start));
    const lanes = [];
    const placed = [];
    for (const it of sorted) {
      const s = util.offsetFromTime(it.start);
      const e = s + util.durationMinutes(it.start, it.end);
      let lane = lanes.findIndex(end => end <= s);
      if (lane === -1) { lane = lanes.length; lanes.push(e); }
      else lanes[lane] = e;
      placed.push({ task: it, lane });
    }
    for (const p of placed) {
      const ps = util.offsetFromTime(p.task.start);
      const pe = ps + util.durationMinutes(p.task.start, p.task.end);
      let maxLane = p.lane;
      for (const q of placed) {
        if (q === p) continue;
        const qs = util.offsetFromTime(q.task.start);
        const qe = qs + util.durationMinutes(q.task.start, q.task.end);
        if (qs < pe && qe > ps) maxLane = Math.max(maxLane, q.lane);
      }
      p.laneCount = maxLane + 1;
    }
    return placed;
  }

  // 完全落在折叠段内的任务不画，数量汇总到折叠带上
  function hiddenBandId(startOffset, endOffset, layout) {
    for (const s of layout) {
      if (!s.open && startOffset >= s.from && endOffset <= s.to) return s.id;
    }
    return null;
  }

  function taskBlockHtml(task, dateStr, lane, laneCount, layout) {
    const s = util.offsetFromTime(task.start);
    const e = s + util.durationMinutes(task.start, task.end);
    const top = util.weekY(s, layout);
    const height = Math.max(util.weekY(e, layout) - top, MIN_BLOCK_H);
    const widthPct = 100 / laneCount;
    const leftPct = widthPct * lane;
    // 课表课程有自己的固定色，不跟任务分类搅在一起
    const sub = task.virtual ? { color: PB.store.COURSE_COLOR } : PB.store.subjectLabel(task.subject);
    // 有时段的跨天任务会在覆盖到的每一天各画一块：块在 dateStr 这一列，
    // 但改它得回它挂着的起始日那一格（openTask 按桶键找任务）。
    // 它也不给拖 —— 拖走一块该动的是范围，不是某一格。
    const multi = PB.span.isMultiDay(task);
    const homeDate = multi ? task.date : dateStr;
    const done = multi ? PB.span.isDoneDay(task, dateStr) : !!task.done;
    const cls = ['week-block'];
    if (task.virtual) cls.push('virtual');
    if (multi) cls.push('multi');
    if (done) cls.push('done');
    const tall = height >= COMPACT_H;
    const timeLine = tall ? `<div class="week-block-time">${task.start}–${task.end}</div>` : '';
    const locLine = (tall && task.loc) ? `<div class="week-block-loc">${util.escapeHtml(task.loc)}</div>` : '';
    const range = multi
      ? `（跨天 ${util.formatShortDate(task.date)}–${util.formatShortDate(task.to)}）` : '';
    const title = `${task.start}–${task.end} ${task.text}` + (task.loc ? ` @ ${task.loc}` : '') + range;
    return `<div class="${cls.join(' ')}"
        style="top:${top}px;height:${height}px;left:calc(${leftPct}% + 2px);width:calc(${widthPct}% - 4px);--sub-color:${sub.color}"
        data-task-id="${task.id}" data-date="${homeDate}"
        title="${util.attr(title)}"
        onclick="PB.week.openTask('${homeDate}','${task.id}')">
      ${timeLine}
      <div class="week-block-text">${util.escapeHtml(task.text)}</div>
      ${locLine}
    </div>`;
  }

  // 只画展开段内的小时线；折叠段靠自己的边框表示
  function hourLinesHtml(layout, withLabels) {
    let h = '';
    for (const seg of layout) {
      if (!seg.open) continue;
      for (let off = seg.from; off < seg.to; off += 60) {
        const top = util.weekY(off, layout);
        h += `<div class="week-hour" style="top:${top}px"></div>`;
        if (withLabels) {
          // 标签是绕整点线垂直居中的，最顶端那条会被粘性表头吃掉上半截，往下让半个字高
          const labelTop = Math.max(top, LABEL_MIN_TOP);
          h += `<div class="week-hour-label" style="top:${labelTop}px">${util.timeFromOffset(off)}</div>`;
        }
      }
    }
    return h;
  }

  // 折叠带本身只是一条视觉窄条（跨全部 7 列），按钮不在这里
  function bandStripHtml(layout) {
    return layout.filter(s => s.banner).map(s =>
      `<div class="week-band${s.open ? ' open' : ''}"
            style="top:${s.y}px;height:${s.height}px"></div>`
    ).join('');
  }

  // 时间轴左侧的峰谷色带：工作日（非节假日）高峰 9–12 / 14–18 标成峰，其余为谷。
  // 周末与法定节假日整天都是谷，由表头那个「谷」徽标表示。
  function priceStripHtml(layout) {
    const segs = PB.price.PEAK_BLOCKS.map(b => {
      const top = util.weekY(util.offsetFromTime(b.from), layout);
      const bottom = util.weekY(util.offsetFromTime(b.to), layout);
      return `<div class="week-price-seg peak" style="top:${top}px;height:${Math.max(bottom - top, 2)}px"></div>`;
    }).join('');
    return `<div class="week-price-gutter" title="高峰（工作日）9:00–12:00、14:00–18:00；其余时段及周末、法定节假日为谷价（半价）">${segs}</div>`;
  }

  // 展开/收起按钮画到左侧时间轴列里，纵向对齐各自那条带子的中线
  function bandButtonsHtml(layout, counts) {
    return layout.filter(s => s.banner).map(s => {
      const n = counts[s.id] || 0;
      const title = s.open
        ? `收起 ${s.banner}`
        : `点开 ${s.banner}${n ? `（本周 ${n} 项）` : ''}`;
      return `<button class="week-band-btn" style="top:${s.y + s.height / 2}px"
        title="${title}" onclick="PB.week.toggleBand('${s.id}')">${s.open ? '▾' : '▸' + (n || '')}</button>`;
    }).join('');
  }

  // ============ 顶部全天带子 ============
  // 一条全天任务横跨 date → to。带子按天分格：点哪一格就勾那一天，
  // 格子里那个 ✎ 才是改内容（改名 / 改范围 / 删除）。
  function spanBandHtml(it, dates, i, j) {
    const t = it.task;
    const sub = PB.store.subjectLabel(t.subject);
    // 只占一天的那种才给拖（今天的不想做了，拖到明天）。
    // 跨天的拖走该动的是范围而不是某一格，所以不给 draggable。
    const single = PB.span.dayCount(t) === 1;
    let cells = '';
    for (let k = i; k <= j; k++) {
      const date = dates[k];
      const head = k === it.startIdx;
      const last = k === it.endIdx;
      const done = PB.span.isDoneDay(t, date);
      const hint = done ? '已完成，点一下取消' : '点一下标记这天完成';
      cells += `<div class="week-span-cell${head ? ' head' : ''}${done ? ' done' : ''}"
          style="--sub-color:${sub.color}" data-date="${date}"
          title="${util.attr(`${t.text} · ${util.formatShortDate(date)} ${hint}`)}"
          onclick="PB.week.toggleSpanDay('${t.date}','${t.id}','${date}')"
          ${single ? `draggable="true"
            ondragstart="PB.week.spanDragStart(event,'${t.date}','${t.id}')"
            ondragend="PB.week.spanDragEnd(event)"` : ''}>
        ${head && it.before ? '<span class="week-span-cont">◀</span>' : ''}
        ${head ? `<span class="week-span-text">${util.escapeHtml(t.text)}</span>` : ''}
        ${done ? '<span class="week-span-mark">✓</span>' : ''}
        ${last ? `${it.after ? '<span class="week-span-cont">▶</span>' : ''}
          <button class="week-span-edit" title="改名 / 改范围 / 删除（点格子是勾这一天）"
            onclick="event.stopPropagation();PB.week.editSpan('${t.date}','${t.id}')">✎</button>` : ''}
      </div>`;
    }
    return cells;
  }

  function spanLineCells(dates, rowItems) {
    const owner = dates.map(() => null);
    for (const it of rowItems) {
      for (let i = it.startIdx; i <= it.endIdx; i++) owner[i] = it;
    }
    let html = '';
    let i = 0;
    while (i < dates.length) {
      const it = owner[i];
      if (!it) {
        html += `<div class="week-span-gap" data-date="${dates[i]}"
          title="点这里加一条全天任务"
          onclick="PB.week.newAllDay('${dates[i]}')"></div>`;
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < dates.length && owner[j + 1] === it) j++;
      html += spanBandHtml(it, dates, i, j);
      i = j + 1;
    }
    return html;
  }

  function spanLaneHtml(dates, tasks) {
    const { items, rows } = PB.span.weekSpans(tasks, dates);
    let lines = '';
    for (let r = 0; r < rows; r++) {
      lines += `<div class="week-span-line" style="top:${r * SPAN_ROW_H}px;height:${SPAN_ROW_H}px">${
        spanLineCells(dates, items.filter(it => it.row === r))}</div>`;
    }
    return `<div class="week-span-row">
      <div class="week-price-spacer"></div>
      <div class="week-span-gutter">全天</div>
      <div class="week-spans" style="height:${rows * SPAN_ROW_H}px"
           ondragover="PB.week.spanDragOver(event)"
           ondragleave="PB.week.spanDragLeave(event)"
           ondrop="PB.week.spanDrop(event)">${lines}</div>
    </div>`;
  }

  // ============ 单天全天任务：拖到别的列 ============
  // 跨天的带子不给拖 —— 拖走它该动的是范围，不是某一格。
  let spanDrag = null;         // 正在拖的那条：{ homeDate, id }
  let spanDraggedAt = 0;       // 刚拖完跟来的那次 click 不该被当成「点一下勾完成」

  function spanDragStart(e, homeDate, id) {
    spanDrag = { homeDate, id };
    spanDraggedAt = Date.now();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    e.currentTarget.classList.add('dragging');
  }

  function spanDragEnd(e) {
    spanDrag = null;
    spanDraggedAt = Date.now();
    e.currentTarget.classList.remove('dragging');
    clearSpanDropTargets();
  }

  function clearSpanDropTargets() {
    document.querySelectorAll('.week-span-cell.drop-target')
      .forEach(el => el.classList.remove('drop-target'));
  }

  // 不 preventDefault 浏览器就不认这里是落点
  function spanDragOver(e) {
    if (!spanDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearSpanDropTargets();
    const cell = e.target.closest('[data-date]');
    if (cell && cell.dataset.date !== spanDrag.homeDate) cell.classList.add('drop-target');
  }

  function spanDragLeave(e) {
    const cell = e.target.closest('[data-date]');
    if (cell) cell.classList.remove('drop-target');
  }

  function spanDrop(e) {
    e.preventDefault();
    const cell = e.target.closest('[data-date]');
    const d = spanDrag;
    spanDrag = null;
    clearSpanDropTargets();
    if (!cell || !d || cell.dataset.date === d.homeDate) return;

    const toDate = cell.dataset.date;
    const st = PB.store.get();
    if (!PB.store.moveTaskTo(st.tasks, d.homeDate, d.id, toDate, null)) return;
    PB.store.save();
    renderWeek();
    PB.list.render();
    PB.list.showToast(`已挪到 ${util.formatDateLabel(toDate)}`);
  }

  function toggleSpanDay(homeDate, id, date) {
    if (Date.now() - spanDraggedAt < 300) return;    // 拖完那一下的 click，别顺手勾完成
    const t = (PB.store.get().tasks[homeDate] || []).find(x => x.id === id);
    if (!t) return;
    PB.span.setDoneDay(t, date, !PB.span.isDoneDay(t, date));
    PB.store.save();
    renderWeek();
    PB.list.render();
  }

  function editSpan(homeDate, id) { PB.edit.openTask(homeDate, id); }

  function newAllDay(date) { PB.edit.openTask(date, null, { allDay: true }); }

  // 事件委托必须挂在不会被重建的 #weekGrid 上（每次渲染只替换它的 innerHTML）
  function bindGridOnce() {
    const grid = document.getElementById('weekGrid');
    if (!grid || grid.dataset.bound) return;
    grid.dataset.bound = '1';
    grid.addEventListener('pointerdown', onBlockPointerDown);
    grid.addEventListener('click', onGridClick);
  }

  // 点空白处（含课表背景块）在那一刻新建任务；点在已有任务块上则是编辑，不新建
  function onGridClick(e) {
    // 拖拽后的那次 click 要吞掉，但必须在这里消费掉标志，
    // 否则之后点空白新建会被一直吞
    if (suppressClick) { suppressClick = false; return; }
    // 点在任务块上是编辑，点在课表背景块上是「什么都不做」——两者都不新建
    if (e.target.closest('.week-block')) return;
    const col = e.target.closest('.week-col');
    if (!col) return;

    const dateStr = col.dataset.date;
    const layout = util.weekLayout(expanded);
    const y = e.clientY - col.getBoundingClientRect().top;
    const startOffset = snapMinute(util.weekOffset(y, layout), 1435);

    // 就地新建：预填点中那一刻的起始时间 + 1 小时
    PB.edit.openTask(dateStr, null, {
      start: util.timeFromOffset(startOffset),
      end: util.timeFromOffset(startOffset + 60)
    });
  }

  function renderWeek() {
    bindGridOnce();
    const dates = weekDates();
    const st = PB.store.get();
    const container = document.getElementById('weekGrid');
    if (!container) return;

    const layout = util.weekLayout(expanded);
    const total = util.weekTotalHeight(layout);

    const header = `<div class="week-price-spacer"></div><div class="week-head-spacer"></div>` +
      dates.map(d => {
        const isToday = util.isToday(d);
        const offpeak = PB.price.isOffPeakDay(d);
        return `<div class="week-head${isToday ? ' today' : ''}">
          <div class="week-head-dow">周${util.weekdayLabel(d)}</div>
          <div class="week-head-date">${util.formatShortDate(d)}</div>
          ${offpeak ? '<span class="week-head-offpeak" title="全天空闲（半价）">谷</span>' : ''}
        </div>`;
      }).join('');

    const counts = {};
    const cols = dates.map(d => {
      // 有时段的跨天任务挂在起始日那一格，但覆盖到的每一天都要在网格里出现
      const dayTasks = (st.tasks[d] || []).concat(PB.span.timedCovering(st.tasks, d));
      const weekNumber = st.config.semesterStart
        ? util.weekNo(d, st.config.semesterStart) : null;
      // 全天任务画在顶部带子里，不进时间网格
      const resolved = PB.template.resolveDayTasks(d, weekNumber, st.templates, dayTasks)
        .filter(t => !t.allDay);

      const visible = [];
      for (const t of resolved) {
        const s = util.offsetFromTime(t.start);
        const e = s + util.durationMinutes(t.start, t.end);
        const bandId = hiddenBandId(s, e, layout);
        if (bandId) counts[bandId] = (counts[bandId] || 0) + 1;
        else visible.push(t);
      }

      const blocks = layoutOverlaps(visible)
        .map(p => taskBlockHtml(p.task, d, p.lane, p.laneCount, layout)).join('');
      const isToday = util.isToday(d);
      return `<div class="week-col${isToday ? ' today' : ''}" data-date="${d}"
                   style="height:${total}px">
        ${hourLinesHtml(layout, false)}
        ${blocks}
        <div class="week-now" data-now style="display:none"></div>
      </div>`;
    }).join('');

    container.innerHTML = `<div class="week-frame">
      <div class="week-head-row">${header}</div>
      ${spanLaneHtml(dates, st.tasks)}
      <div class="week-body">
        ${priceStripHtml(layout)}
        <div class="week-gutter" style="height:${total}px">${
          hourLinesHtml(layout, true) + bandButtonsHtml(layout, counts)
        }</div>
        <div class="week-cols">
          ${cols}
          ${bandStripHtml(layout)}
        </div>
      </div>
    </div>`;

    updateNowLine();
    startNowTimer();
    updateWeekLabel();
  }

  function updateWeekLabel() {
    const dates = weekDates();
    const el = document.getElementById('weekLabel');
    if (el) el.textContent = `${util.formatDateLabel(dates[0])} – ${util.formatDateLabel(dates[6])}`;
  }

  // 当前时刻线：只在今天这一列显示；落在折叠段内则不显示
  function updateNowLine() {
    const now = new Date();
    const todayStr = util.todayStr();
    const layout = util.weekLayout(expanded);
    const offset = (now.getHours() * 60 + now.getMinutes() - util.DAY_START_MINUTES + 1440) % 1440;
    const inCollapsed = layout.some(s => !s.open && offset >= s.from && offset <= s.to);

    document.querySelectorAll('.week-col').forEach(col => {
      const line = col.querySelector('[data-now]');
      if (!line) return;
      if (col.dataset.date !== todayStr || inCollapsed) { line.style.display = 'none'; return; }
      line.style.display = 'block';
      line.style.top = util.weekY(offset, layout) + 'px';
    });
  }

  function startNowTimer() {
    if (nowTimer) clearInterval(nowTimer);
    nowTimer = setInterval(updateNowLine, 60000);
  }

  // ============ 拖拽 ============
  // max 取 1435 表示「不能贴到清醒日末尾」，1440 表示「允许收尾于末尾」
  function snapMinute(offset, max) {
    return Math.max(0, Math.min(max, Math.round(offset / SNAP_MIN) * SNAP_MIN));
  }

  function onBlockPointerDown(e) {
    if (e.button !== 0) return;
    const el = e.target.closest('.week-block');
    // 课表背景不参与拖拽；跨天的那块也不给拖 —— 拖走一块该动的是范围，不是某一格
    if (!el || el.classList.contains('virtual') || el.classList.contains('multi')) return;
    const rect = el.getBoundingClientRect();
    const isResize = (e.clientY > rect.bottom - RESIZE_EDGE);
    drag = {
      mode: isResize ? 'resize' : 'move',
      date: el.dataset.date,
      taskId: el.dataset.taskId,
      el,
      startX: e.clientX,
      startY: e.clientY,
      origTop: parseFloat(el.style.top) || 0,
      origHeight: parseFloat(el.style.height) || 0,
      total: util.weekTotalHeight(util.weekLayout(expanded)),
      moved: false
    };
    suppressClick = false;
    el.classList.add('dragging');
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    const dx = e.clientX - drag.startX;
    if (Math.abs(dy) > 2 || Math.abs(dx) > 2) drag.moved = true;

    if (drag.mode === 'resize') {
      const maxHeight = drag.total - drag.origTop;
      const h = Math.max(MIN_BLOCK_H, Math.min(maxHeight, drag.origHeight + dy));
      drag.el.style.height = h + 'px';
      drag.pendingHeight = h;
    } else {
      const top = Math.max(0, Math.min(drag.total - drag.origHeight, drag.origTop + dy));
      drag.el.style.top = top + 'px';
      drag.pendingTop = top;
      const col = document.elementFromPoint(e.clientX, e.clientY)?.closest('.week-col');
      document.querySelectorAll('.week-col.hover').forEach(c => c.classList.remove('hover'));
      if (col && col.dataset.date !== drag.date) col.classList.add('hover');
      drag.pendingDate = col ? col.dataset.date : drag.date;
    }
  }

  function onPointerUp(e) {
    if (!drag) return;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    drag.el.classList.remove('dragging');
    document.querySelectorAll('.week-col.hover').forEach(c => c.classList.remove('hover'));

    const d = drag;
    drag = null;
    if (!d.moved) return;

    suppressClick = true;

    const layout = util.weekLayout(expanded);
    const st = PB.store.get();
    const committed = (st.tasks[d.date] || []).find(t => t.id === d.taskId);
    if (!committed) return;

    if (d.mode === 'resize') {
      const startOffset = util.offsetFromTime(committed.start);
      const bottomY = d.origTop + d.pendingHeight;
      let endOffset = snapMinute(util.weekOffset(bottomY, layout), 1440);
      if (endOffset < startOffset + MIN_DURATION) endOffset = startOffset + MIN_DURATION;
      committed.end = util.timeFromOffset(Math.min(endOffset, 1440) % 1440);
    } else {
      const newStart = util.timeFromOffset(snapMinute(util.weekOffset(d.pendingTop, layout), 1435));
      const dur = util.durationMinutes(committed.start, committed.end);
      committed.start = newStart;
      committed.end = util.timeFromOffset(util.offsetFromTime(newStart) + dur);

      if (d.pendingDate && d.pendingDate !== d.date) {
        // 搬格子交给 store，它会顺手把任务自带的 date 副本一起改
        PB.store.moveTaskTo(st.tasks, d.date, committed.id, d.pendingDate, null);
      }
    }
    PB.store.save();
    renderWeek();
  }

  // 真实任务打开详情；课表虚拟块（id 形如 v_<tplId>）走同一入口，保存即固化
  function openTask(dateStr, taskId) {
    if (suppressClick) return;
    PB.edit.openTask(dateStr, taskId);
  }

  PB.week = { renderWeek, prevWeek, nextWeek, gotoThisWeek, layoutOverlaps, openTask, toggleBand,
              toggleSpanDay, editSpan, newAllDay,
              spanDragStart, spanDragEnd, spanDragOver, spanDragLeave, spanDrop,
              get currentWeekStart() { return ensureWeekStart(); },
              get expanded() { return Object.assign({}, expanded); } };
})();
