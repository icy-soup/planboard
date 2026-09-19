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

  // 起止倒置则交换；跨度超上限则以 from 为锚把 to 收回来
  function clampRange(from, to) {
    if (util.daysBetween(from, to) < 0) { const t = from; from = to; to = t; }
    if (util.daysBetween(from, to) > MAX_RANGE_DAYS - 1) {
      to = util.addDays(from, MAX_RANGE_DAYS - 1);
    }
    return { from, to };
  }

  function loadRange() {
    try {
      const raw = localStorage.getItem(RANGE_KEY);
      if (raw) {
        const r = JSON.parse(raw);
        if (r && r.from && r.to) return clampRange(r.from, r.to);
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
    range = clampRange(field === 'from' ? value : range.from,
                       field === 'to'   ? value : range.to);
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
  function render() {
    const container = document.getElementById('dayContainer');
    const dates = rangeDates();
    const days = dates.map(date => ({ date, weekday: util.weekdayLabel(date) }));
    let total = 0, done = 0;
    let html = '';

    // Update header
    document.getElementById('projectTitle').textContent = store.get().config.projectName;

    const todayStr = util.toDateStr(new Date());
    for (const day of days) {
      const dayTasks = store.get().tasks[day.date] || [];
      const dayDone = dayTasks.filter(t => t.done).length;
      total += dayTasks.length;
      done += dayDone;
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
          <span class="day-check-count">${dayDone}/${dayTasks.length}</span>
        </div>
        <div class="day-content">
          ${dayTasks.length === 0 ? '<div class="empty-day-msg">暂无安排 · 点击下方添加</div>' : ''}
          ${dayTasks.map((t, idx) => renderTask(t, day.date)).join('')}
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
    let html = `<span class="overview-item"><span style="font-weight:600;">${days.length}</span> 天</span>`;
    for (const sub of store.get().config.subjects) {
      let count = 0;
      for (const day of days) {
        const dayTasks = store.get().tasks[day.date] || [];
        count += dayTasks.filter(t => t.subject === sub.id).length;
      }
      html += `<span class="overview-item">
      <span class="dot" style="background:${sub.color}"></span>
      ${sub.label} <span class="count">${count}</span>
    </span>`;
    }
    bar.innerHTML = html;
  }

  function renderTask(t, date) {
    const sub = store.subjectLabel(t.subject);
    const doneCls = t.done ? 'completed' : '';
    const subStyle = `background:${sub.color}22; color:${sub.color}; border-color:${sub.color}33`;
    return `<div class="task-card ${doneCls}" draggable="true"
       data-task-id="${t.id}" data-date="${date}"
       ondragstart="onDragStart(event)" ondragend="onDragEnd(event)"
       ondragover="onDragOver(event)" ondrop="onDropOnTask(event)"
       ondragenter="onDragEnter(event)" ondragleave="onDragLeave(event)">
    <span class="drag-handle">⠿</span>
    <label class="task-check">
      <input type="checkbox" ${t.done ? 'checked' : ''} onchange="toggleDone('${date}','${t.id}',this.checked)">
    </label>
    <span class="task-time">
      <span class="time-field" data-field="start" onkeydown="PB.util.timeKeydown(event)">
        <input type="text" class="time-text" inputmode="numeric" maxlength="5"
          value="${util.attr(t.start)}" onchange="updateTime('${date}','${t.id}','start',this)">
        <input type="time" class="time-native" tabindex="-1"
          value="${util.attr(t.start)}" onchange="updateTime('${date}','${t.id}','start',this)">
      </span>
      <span class="sep">–</span>
      <span class="time-field" data-field="end" onkeydown="PB.util.timeKeydown(event)">
        <input type="text" class="time-text" inputmode="numeric" maxlength="5"
          value="${util.attr(t.end)}" onchange="updateTime('${date}','${t.id}','end',this)">
        <input type="time" class="time-native" tabindex="-1"
          value="${util.attr(t.end)}" onchange="updateTime('${date}','${t.id}','end',this)">
      </span>
    </span>
    <span class="task-subject">
      <select class="subject-tag" style="${subStyle}" onchange="updateSubject('${date}','${t.id}',this.value)">
        ${store.get().config.subjects.map(s => {
          const st = `background:${s.color}22; color:${s.color}; border-color:${s.color}33`;
          return `<option value="${s.id}" ${s.id === t.subject ? 'selected' : ''} style="${st}">${s.label}</option>`;
        }).join('')}
      </select>
    </span>
    <span class="task-text" contenteditable="true" data-date="${date}" data-task-id="${t.id}"
          onblur="updateText('${date}','${t.id}',this.textContent)">${util.escapeHtml(t.text)}</span>
    <button class="task-delete" onclick="deleteTask('${date}','${t.id}')" title="删除">✕</button>
  </div>`;
  }

  // ============ CRUD ============
  function toggleDone(date, id, checked) {
    const t = store.get().tasks[date].find(x => x.id === id);
    if (t) { t.done = checked; store.save(); render(); }
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
      id, start: '09:00', end: '10:00',
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
  function onDragStart(e) {
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
    const srcArr = store.get().tasks[srcDate];
    if (!srcArr) return;
    const srcIdx = srcArr.findIndex(x => x.id === taskId);
    if (srcIdx === -1) return;

    const [moved] = srcArr.splice(srcIdx, 1);
    if (srcArr.length === 0) delete store.get().tasks[srcDate];

    if (!store.get().tasks[targetDate]) store.get().tasks[targetDate] = [];
    if (beforeId) {
      const tgtIdx = store.get().tasks[targetDate].findIndex(x => x.id === beforeId);
      store.get().tasks[targetDate].splice(tgtIdx === -1 ? store.get().tasks[targetDate].length : tgtIdx, 0, moved);
    } else {
      store.get().tasks[targetDate].push(moved);
    }

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
    render, renderOverview, renderTask,
    prevWeek, nextWeek, gotoThisWeek, setRange,
    toggleDone, updateTime, updateSubject, updateText, deleteTask, addTask,
    onDragStart, onDragEnd, onDragOver, onDragEnter, onDragLeave,
    onDragEnterDay, onDragLeaveDay, onDropOnTask, onDropOnDay,
    showToast, toggleDay, collapseAll, expandAll
  };
  PB.list = api;
  Object.assign(window, api);
})();
