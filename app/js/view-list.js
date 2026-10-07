(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});
  const util = PB.util;
  const store = PB.store;

  let dragSource = null;

  // ============ 显示区间 ============
  const MAX_RANGE_DAYS = 10;        // 起止区间最多显示多少天
  const RANGE_KEY = 'pb_listRange';

  function thisWeekRange() {
    const s = util.startOfWeek(util.todayStr());
    return { from: s, to: util.addDays(s, 6) };
  }

  function loadRange() {
    try {
      const raw = localStorage.getItem(RANGE_KEY);
      if (raw) {
        const r = JSON.parse(raw);
        if (r && r.from && r.to) return util.clampRange(r.from, r.to, MAX_RANGE_DAYS);
      }
    } catch (e) {}
    return thisWeekRange();
  }

  let range = loadRange();

  function saveRange() {
    try { localStorage.setItem(RANGE_KEY, JSON.stringify(range)); } catch (e) {}
  }

  function rangeDates() {
    const n = util.daysBetween(range.from, range.to) + 1;
    return Array.from({ length: n }, (_, i) => util.addDays(range.from, i));
  }

  function setRange(field, value) {
    if (!value) return;
    range = util.editRange(range, field, value, MAX_RANGE_DAYS);
    saveRange();
    render();
  }

  // 「上周/下周」按 7 天平移，区间长度不变
  function shiftRange(days) {
    range = { from: util.addDays(range.from, days), to: util.addDays(range.to, days) };
    saveRange();
    render();
  }
  function prevWeek() { shiftRange(-7); }
  function nextWeek() { shiftRange(7); }
  function gotoThisWeek() { range = thisWeekRange(); saveRange(); render(); }

  function updateToolbar() {
    const label = document.getElementById('listLabel');
    if (label) label.textContent =
      `${util.formatDateLabel(range.from)} – ${util.formatDateLabel(range.to)}`;
    const fromEl = document.getElementById('listFrom');
    const toEl = document.getElementById('listTo');
    if (fromEl) fromEl.value = range.from;
    if (toEl) toEl.value = range.to;
  }

  // ============ RENDER ============
  // 某一天时间线上要画的东西。全天 / 跨天的带子单独排在最上面，所以这里只剩有时段的。
  // 有时段的跨天任务挂在起始日那一格，但覆盖到的每一天都要出现 ——
  // 每一行是「任务 + 它挂在哪一格」：改它得回那一格，勾的却是你看到的这一天。
  function timeRowsFor(date) {
    // deleted 是课表模板的墓碑，只用于压住当天的虚拟课程，不能当成普通任务画出来。
    const mine = (store.get().tasks[date] || []).filter(t => !t.allDay && !t.deleted)
      .map(t => ({ t, home: date }));
    const spilled = PB.span.timedCovering(store.get().tasks, date)
      .map(t => ({ t, home: t.date }));
    return mine.concat(spilled);
  }

  function render() {
    const container = document.getElementById('dayContainer');
    const dates = rangeDates();
    const days = dates.map(date => ({ date, weekday: util.weekdayLabel(date) }));
    let total = 0, done = 0;
    let html = '';

    // Update header
    document.getElementById('projectTitle').textContent = store.get().config.projectName;

    const todayStr = util.toDateStr(new Date());
    const spans = PB.span.allSpans(store.get().tasks);
    // 总进度的口径是“要完成几件事”，而不是“页面上画了几行”。
    // once 任务会在跨天范围的每一天各出现一次，但整条任务只应进分子/分母一次。
    const countedOnce = new Set();
    const countProgressItems = items => {
      let count = 0, completed = 0;
      for (const t of items) {
        const key = t.once ? (t.id || t) : null;
        if (key && countedOnce.has(key)) continue;
        if (key) countedOnce.add(key);
        count++;
        if (PB.span.isDoneDay(t, t.date)) completed++;
      }
      return { count, completed };
    };
    for (const day of days) {
      const rows = timeRowsFor(day.date);
      const daySpans = spans.filter(t => PB.span.coversDay(t, day.date));
      const dayCount = rows.length + daySpans.length;
      const dayDone = rows.filter(r => PB.span.isDoneDay(r.t, day.date)).length
                    + daySpans.filter(t => PB.span.isDoneDay(t, day.date)).length;
      const progress = countProgressItems(rows.map(r => r.t).concat(daySpans));
      total += progress.count;
      done += progress.completed;
      const isPast = day.date < todayStr;

      html += `<div class="timeline-item">
      <div class="timeline-marker">
        <div class="timeline-line"></div>
        <div class="timeline-date">${util.formatShortDate(day.date)}</div>
        <div class="timeline-dot ${util.isToday(day.date) ? 'today' : ''}"></div>
      </div>
      <div class="day-section${util.isToday(day.date) ? ' today' : ''}${isPast ? ' past' : ''}" data-date="${day.date}"
           ondragover="onDragOver(event)" ondragenter="onDragEnterDay(event)"
           ondragleave="onDragLeaveDay(event)" ondrop="onDropOnDay(event)">
        <div class="day-header${isPast ? ' collapsed' : ''}" onclick="toggleDay(this)">
          <span class="toggle-icon">▼</span>
          <span class="day-date">
            ${util.formatDateLabel(day.date)}
            <span class="weekday">周${day.weekday}</span>
          </span>
          ${util.isToday(day.date) ? '<span class="day-badge today-badge">今天</span>' : ''}
          <span class="day-check-count">${dayDone}/${dayCount}</span>
        </div>
        <div class="day-content">
          ${daySpans.map(t => renderSpanRow(t, day.date)).join('')}
          ${dayCount === 0 ? '<div class="empty-day-msg">暂无安排 · 点击下方添加</div>' : ''}
          ${rows.map(r => renderTask(r.t, r.home, day.date)).join('')}
          <div class="day-dropzone"></div>
          <button class="add-task-btn" onclick="addTask('${day.date}')">+ 添加任务</button>
        </div>
      </div>
    </div>`;
    }

    container.innerHTML = html;

    updateToolbar();

    // Overview bar
    renderOverview(days);

    // Progress
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressText').textContent = `已完成 ${done} / ${total} 项 (${pct}%)`;
  }

  function renderOverview(days) {
    const bar = document.getElementById('overviewBar');
    const spans = PB.span.allSpans(store.get().tasks);
    // 跨天任务在它覆盖到的每一天各算一次，跟每天那个 x/y 的口径一致
    const byDay = days.map(day =>
      timeRowsFor(day.date).map(r => r.t)
        .concat(spans.filter(t => PB.span.coversDay(t, day.date))));

    let html = `<span class="overview-item"><span style="font-weight:600;">${days.length}</span> 天</span>`;
    for (const sub of store.get().config.subjects) {
      let count = 0;
      for (const list of byDay) count += list.filter(t => t.subject === sub.id).length;
      html += `<span class="overview-item">
      <span class="dot" style="background:${sub.color}"></span>
      ${sub.label} <span class="count">${count}</span>
    </span>`;
    }
    bar.innerHTML = html;
  }

  // 分类下拉在时间线和全天行里长得一样，只有「拿哪个日期当存储键」不同
  function subjectSelectHtml(t, key) {
    const sub = store.subjectLabel(t.subject);
    const sel = `background:${sub.color}22; color:${sub.color}; border-color:${sub.color}33`;
    return `<select class="subject-tag" style="${sel}" onchange="updateSubject('${key}','${t.id}',this.value)">
      ${store.get().config.subjects.map(s => {
        const st = `background:${s.color}22; color:${s.color}; border-color:${s.color}33`;
        return `<option value="${s.id}" ${s.id === t.subject ? 'selected' : ''} style="${st}">${s.label}</option>`;
      }).join('')}
    </select>`;
  }

  // home = 它挂在哪个桶里（改内容 / 改时间 / 删除都按这个找）；
  // shown = 这一行现在显示在哪一天（勾的是这一天）。单天任务两者相同。
  function renderTask(t, home, shown) {
    const multi = PB.span.isMultiDay(t);
    const done = PB.span.isDoneDay(t, shown);
    const doneCls = done ? 'completed' : '';
    // 跨天的那行不给拖（拖走一块该动的是范围），所以连 draggable 属性都不给它
    const dragAttrs = multi ? '' : `draggable="true" onmousedown="onTaskMouseDown(event)"
       ondragstart="onDragStart(event)" ondragend="onDragEnd(event)"`;
    // 跨天且「每天都要做」→ 勾这一天；其余一个整体勾
    const onCheck = PB.span.isPerDay(t)
      ? `toggleSpanDay('${home}','${shown}','${t.id}',this.checked)`
      : `toggleDone('${home}','${t.id}',this.checked)`;
    const range = multi
      ? `<span class="span-range" title="这条横跨 ${t.date} 至 ${t.to}">${
          util.formatShortDate(t.date)}–${util.formatShortDate(t.to)}</span>`
      : '';
    return `<div class="task-card ${doneCls}${multi ? ' multi' : ''}" ${dragAttrs}
       data-task-id="${t.id}" data-date="${shown}"
       ondragover="onDragOver(event)" ondrop="onDropOnTask(event)"
       ondragenter="onDragEnter(event)" ondragleave="onDragLeave(event)">
    <span class="drag-handle">⠿</span>
    <label class="task-check">
      <input type="checkbox" ${done ? 'checked' : ''} onchange="${onCheck}">
    </label>
    <span class="task-time">
      <span class="time-field" data-field="start" onkeydown="PB.util.timeKeydown(event)">
        <input type="text" class="time-text" inputmode="numeric" maxlength="5"
          value="${util.attr(t.start)}" onchange="updateTime('${home}','${t.id}','start',this)">
        <input type="time" class="time-native" tabindex="-1"
          value="${util.attr(t.start)}" onchange="updateTime('${home}','${t.id}','start',this)">
      </span>
      <span class="sep">–</span>
      <span class="time-field" data-field="end" onkeydown="PB.util.timeKeydown(event)">
        <input type="text" class="time-text" inputmode="numeric" maxlength="5"
          value="${util.attr(t.end)}" onchange="updateTime('${home}','${t.id}','end',this)">
        <input type="time" class="time-native" tabindex="-1"
          value="${util.attr(t.end)}" onchange="updateTime('${home}','${t.id}','end',this)">
      </span>
    </span>
    <span class="task-subject">${subjectSelectHtml(t, home)}</span>
    <span class="task-text" contenteditable="true" data-date="${home}" data-task-id="${t.id}"
          onblur="updateText('${home}','${t.id}',this.textContent)">${util.escapeHtml(t.text)}</span>
    ${range}
    <button class="task-delete" onclick="deleteTask('${home}','${t.id}')" title="删除">✕</button>
  </div>`;
  }

  // 全天 / 跨天任务排在当天最上面。勾的是「这一天」，所以一条横跨五天的任务
  // 会在那五天里各出现一行 —— 勾哪一行就是勾哪一天，改内容改的却是同一条。
  // 只占一天的那种可以拖到别的日子（今天的不想做了，挪到明天）；
  // 跨天的不给 draggable：拖走一条跨天任务，该动的是范围，不是某一格。
  function renderSpanRow(t, date) {
    const r = PB.span.spanRange(t);
    const single = r.from === r.to;
    const done = PB.span.isDoneDay(t, date);
    const range = single ? ''
      : `<span class="span-range" title="这条横跨 ${r.from} 至 ${r.to}">${
          util.formatShortDate(r.from)}–${util.formatShortDate(r.to)}</span>`;
    const dragAttrs = single
      ? `draggable="true" onmousedown="onTaskMouseDown(event)"
       ondragstart="onDragStart(event)" ondragend="onDragEnd(event)"
       ondragover="onDragOver(event)" ondrop="onDropOnTask(event)"
       ondragenter="onDragEnter(event)" ondragleave="onDragLeave(event)"`
      : '';
    return `<div class="task-card allday${done ? ' completed' : ''}"
       data-task-id="${t.id}" data-date="${date}"
       style="--sub-color:${store.subjectLabel(t.subject).color}" ${dragAttrs}>
    <span class="drag-handle" title="${single ? '拖到别的日子' : '跨天的任务不跟着拖'}">⠿</span>
    <label class="task-check">
      <input type="checkbox" ${done ? 'checked' : ''}
        onchange="toggleSpanDay('${t.date}','${date}','${t.id}',this.checked)">
    </label>
    <span class="task-time">全天</span>
    <span class="task-subject">${subjectSelectHtml(t, t.date)}</span>
    <span class="task-text" contenteditable="true" data-date="${t.date}" data-task-id="${t.id}"
          onblur="updateText('${t.date}','${t.id}',this.textContent)">${util.escapeHtml(t.text)}</span>
    ${range}
    <button class="task-delete" onclick="deleteTask('${t.date}','${t.id}')" title="删除">✕</button>
  </div>`;
  }

  // ============ CRUD ============
  function toggleDone(date, id, checked) {
    const t = store.get().tasks[date].find(x => x.id === id);
    if (t) { t.done = checked; store.save(); render(); }
  }

  // homeDate 是它挂在存储里的那一天（起始日），date 是这一行显示的哪天
  function toggleSpanDay(homeDate, date, id, checked) {
    const t = (store.get().tasks[homeDate] || []).find(x => x.id === id);
    if (!t) return;
    PB.span.setDoneDay(t, date, checked);
    store.save(); render();
  }

  // el 是刚 change 的那个框：文本框自己打的，或原生选择器选的
  function updateTime(date, id, field, el) {
    const t = store.get().tasks[date].find(x => x.id === id);
    const v = util.syncTimeField(el);
    if (t && v) { t[field] = v; store.save(); }
  }

  function updateSubject(date, id, val) {
    const t = store.get().tasks[date].find(x => x.id === id);
    if (t) { t.subject = val; store.save(); render(); }
  }

  function updateText(date, id, val) {
    const t = store.get().tasks[date].find(x => x.id === id);
    if (t) { t.text = val; store.save(); }
  }

  function deleteTask(date, id) {
    if (!confirm('删除这个任务？')) return;
    store.get().tasks[date] = store.get().tasks[date].filter(x => x.id !== id);
    if (store.get().tasks[date].length === 0) delete store.get().tasks[date];
    store.save(); render(); showToast('已删除');
  }

  function addTask(date) {
    if (!store.get().tasks[date]) store.get().tasks[date] = [];
    const id = 't' + Date.now() + Math.random().toString(36).slice(2, 5);
    store.get().tasks[date].push({
      id, date, start: '09:00', end: '10:00',
      subject: store.get().config.subjects[0]?.id || 'other',
      text: '新任务', done: false
    });
    store.save(); render();
    requestAnimationFrame(() => {
      const cards = document.querySelectorAll(`[data-date="${date}"] .task-card`);
      if (cards.length) {
        const textEl = cards[cards.length-1].querySelector('.task-text');
        if (textEl) textEl.focus();
      }
    });
    showToast('已添加新任务');
  }

  // ============ DRAG & DROP ============
  // 在输入框 / 文字编辑区里按下时先把卡片自己的 draggable 摘掉，
  // 否则选文字、放光标会被当成拖动整张卡片，表现成「点了没反应 / 光标不在点的地方」。
  // 跨天的那行全天任务压根没有 draggable 属性，所以这里先看它原本给不给拖 ——
  // 直接设 draggable = true 会把不给拖的那行也变成可拖的。
  function onTaskMouseDown(e) {
    const card = e.target.closest('.task-card');
    if (!card || !card.hasAttribute('draggable')) return;
    const interactive = e.target.closest('input, textarea, select, button, [contenteditable="true"]');
    card.draggable = !interactive;
  }

  function onDragStart(e) {
    if (!e.currentTarget.draggable) { e.preventDefault(); return; }
    const card = e.target.closest('.task-card');
    if (!card) return;
    dragSource = { id: card.dataset.taskId, date: card.dataset.date };
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.taskId);
  }

  function onDragEnd(e) {
    const card = e.target.closest('.task-card');
    if (card) card.classList.remove('dragging');
    document.querySelectorAll('.task-card.drag-over-target').forEach(el => el.classList.remove('drag-over-target'));
    document.querySelectorAll('.day-section.drag-over').forEach(el => el.classList.remove('drag-over'));
    dragSource = null;
  }

  function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }

  function onDragEnter(e) {
    const card = e.target.closest('.task-card');
    if (card && dragSource && card.dataset.taskId !== dragSource.id) {
      card.classList.add('drag-over-target');
    }
  }

  function onDragLeave(e) {
    const card = e.target.closest('.task-card');
    if (card) card.classList.remove('drag-over-target');
  }

  function onDragEnterDay(e) {
    if (!dragSource) return;
    const section = e.target.closest('.day-section');
    if (section) section.classList.add('drag-over');
  }

  function onDragLeaveDay(e) {
    const section = e.target.closest('.day-section');
    if (!section) return;
    // 只有真正离开这个 section 才清除高亮（避免在子元素间移动时闪烁）
    if (!section.contains(e.relatedTarget)) section.classList.remove('drag-over');
  }

  // 拖到某张任务卡上：插入到该卡之前（同天排序）或搬到该卡所在天（跨天）
  function onDropOnTask(e) {
    e.preventDefault();
    e.stopPropagation();
    const targetCard = e.target.closest('.task-card');
    if (!targetCard || !dragSource) return;
    targetCard.classList.remove('drag-over-target');

    const targetId = targetCard.dataset.taskId;
    const targetDate = targetCard.dataset.date;

    if (dragSource.date !== targetDate) {
      moveTaskToDate(dragSource.date, dragSource.id, targetDate, targetId);
      return;
    }

    const arr = store.get().tasks[dragSource.date];
    const fromIdx = arr.findIndex(x => x.id === dragSource.id);
    const toIdx = arr.findIndex(x => x.id === targetId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);
    store.save(); render();
  }

  // 拖到空白处：同天不动（已到底），跨天则追加到目标那天末尾
  function onDropOnDay(e) {
    e.preventDefault();
    const section = e.target.closest('.day-section');
    if (!section || !dragSource) return;
    section.classList.remove('drag-over');

    const targetDate = section.dataset.date;
    if (dragSource.date === targetDate) return;   // 拖回原位，无操作

    moveTaskToDate(dragSource.date, dragSource.id, targetDate, null);
  }

  // 把任务从 srcDate 移到 targetDate；beforeId 为 null 时追加到末尾
  function moveTaskToDate(srcDate, taskId, targetDate, beforeId) {
    if (!store.moveTaskTo(store.get().tasks, srcDate, taskId, targetDate, beforeId)) return;
    store.save(); render();
    showToast(`已移动到 ${util.formatDateLabel(targetDate)}`);
  }

  // ============ UI HELPERS ============
  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
  }

  function toggleDay(header) { header.classList.toggle('collapsed'); }
  function collapseAll() { document.querySelectorAll('.day-header').forEach(h => h.classList.add('collapsed')); }
  function expandAll() { document.querySelectorAll('.day-header').forEach(h => h.classList.remove('collapsed')); }

  const api = {
    render, renderOverview, renderTask, renderSpanRow,
    prevWeek, nextWeek, gotoThisWeek, setRange,
    // 导出弹窗拿它当默认区间：正在看哪段就导哪段
    get range() { return Object.assign({}, range); },
    toggleDone, toggleSpanDay, updateTime, updateSubject, updateText, deleteTask, addTask,
    onTaskMouseDown, onDragStart, onDragEnd, onDragOver, onDragEnter, onDragLeave,
    onDragEnterDay, onDragLeaveDay, onDropOnTask, onDropOnDay,
    showToast, toggleDay, collapseAll, expandAll
  };
  PB.list = api;
  Object.assign(window, api);
})();
