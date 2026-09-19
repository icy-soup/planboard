(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});

  if (typeof module !== 'undefined' && module.exports && !PB.util) require('./util.js');
  const util = PB.util;

  const MIN_DURATION = 15;    // 起止相同会被算成 1440 分钟，最少错开这么久
  const VIRTUAL_PREFIX = 'v_';

  // { date, fromDate, isNew, taskId, templateId, virtual, draft }
  let state = null;

  // 属性值要转义引号，util.escapeHtml 只处理 &<>，放进 value="" 里会漏
  function attr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  const $ = (id) => document.getElementById(id);
  const val = (id) => { const el = $(id); return el ? el.value : ''; };
  const on = (id) => { const el = $(id); return !!(el && el.checked); };

  // ============ 打开 ============
  // taskId 为空 = 新建；'v_xxx' = 课表里的课程，弹只读详情，不给改
  function openTask(date, taskId, preset) {
    const st = PB.store.get();
    const real = taskId ? (st.tasks[date] || []).find(t => t.id === taskId) : null;

    if (real) {
      state = {
        date, fromDate: date, isNew: false, taskId: real.id,
        templateId: real.templateId || null, virtual: false,
        draft: Object.assign({}, real)
      };
    } else if (taskId && taskId.indexOf(VIRTUAL_PREFIX) === 0) {
      const tpl = st.templates.find(t => t.id === taskId.slice(VIRTUAL_PREFIX.length));
      if (!tpl) return;
      state = {
        date, fromDate: date, isNew: true, taskId: null,
        templateId: tpl.id, virtual: true,
        // 只读详情要看的就这么几个字段；课程没有任务那套分类，也就不带 subject
        draft: {
          id: PB.store.genId(), date,
          start: tpl.start, end: tpl.end, text: tpl.text,
          loc: tpl.loc || '', done: false
        }
      };
    } else {
      state = {
        date, fromDate: date, isNew: true, taskId: null,
        templateId: null, virtual: false,
        draft: {
          id: PB.store.genId(), date,
          start: (preset && preset.start) || '09:00',
          end: (preset && preset.end) || '10:00',
          subject: st.config.subjects[0]?.id || 'other',
          text: '', loc: '', done: false
        }
      };
    }
    render();
    show();
  }

  function show() { $('editModal').classList.add('open'); }
  function close() {
    const el = $('editModal');
    if (el) el.classList.remove('open');
    state = null;
  }
  function onOverlayClick(e) {
    if (e.target.classList.contains('modal-overlay')) close();
  }

  // ============ 渲染 ============
  function render() {
    if (state.virtual) { renderCourseInfo(); return; }

    const d = state.draft;
    $('editTitle').textContent = state.isNew ? '新建任务' : '任务详情';

    const subjects = PB.store.get().config.subjects;
    const subjectSel = `<select id="efSubject">${subjects.map(s =>
      `<option value="${attr(s.id)}"${s.id === d.subject ? ' selected' : ''}>${
        util.escapeHtml(s.label)}</option>`).join('')}</select>`;

    $('editBody').innerHTML = `
      <label>内容<input type="text" id="efText" placeholder="例如：写完第三章习题"
        value="${attr(d.text)}"></label>
      <label>地点 / 教室<input type="text" id="efLoc" placeholder="可留空"
        value="${attr(d.loc || '')}"></label>
      <label>分类${subjectSel}</label>
      <label>日期<input type="date" id="efDate" value="${attr(d.date)}"></label>
      <div class="edit-row">
        <label>开始<span class="time-field" data-field="start" onkeydown="PB.util.timeKeydown(event)">
          <input type="text" class="time-text" id="efStart" inputmode="numeric" maxlength="5"
            value="${attr(d.start)}" onchange="PB.edit.onTime(this)">
          <input type="time" class="time-native" tabindex="-1" value="${attr(d.start)}"
            onchange="PB.edit.onTime(this)"></span></label>
        <label>结束<span class="time-field" data-field="end" onkeydown="PB.util.timeKeydown(event)">
          <input type="text" class="time-text" id="efEnd" inputmode="numeric" maxlength="5"
            value="${attr(d.end)}" onchange="PB.edit.onTime(this)">
          <input type="time" class="time-native" tabindex="-1" value="${attr(d.end)}"
            onchange="PB.edit.onTime(this)"></span></label>
      </div>
      <label class="edit-check"><input type="checkbox" id="efDone"${d.done ? ' checked' : ''}>
        已完成</label>
      <div class="edit-actions">
        ${state.isNew ? '' : '<button class="btn btn-danger" onclick="PB.edit.remove()">删除</button>'}
        <span class="edit-spacer"></span>
        <button class="btn" onclick="PB.edit.close()">取消</button>
        <button class="btn btn-primary" onclick="PB.edit.save()">保存</button>
      </div>`;
  }

  // 周视图里的课程块给只读详情。课程的编辑入口只有课表日历一处，
  // 不在这儿给输入框，免得「改了但改的不是课表」。
  function renderCourseInfo() {
    const tpl = PB.store.get().templates.find(t => t.id === state.templateId) || {};
    const d = state.draft;
    const weeks = util.weeksBetween(tpl.from, tpl.to);
    const span = (tpl.from || tpl.to)
      ? `${tpl.from || '不限'} ~ ${tpl.to || '不限'}${weeks ? `（${weeks} 周）` : ''}`
      : '不限';
    const parity = { odd: '单周', even: '双周' }[tpl.parity] || '每周';

    // 进元素内容，用 escapeHtml 就够（attr 是给属性值用的）
    const row = (label, value) => value
      ? `<div class="course-info-row"><span>${label}</span><b>${util.escapeHtml(value)}</b></div>`
      : '';

    $('editTitle').textContent = '课表课程';
    $('editBody').innerHTML = `
      <p class="edit-hint">这是课表里的课程，在这儿只能看。</p>
      <div class="course-info">
        ${row('名称', d.text)}
        ${row('地点', d.loc)}
        ${row('时间', `周${util.weekdayLabel(state.date)} ${d.start}–${d.end}`)}
        ${row('日期', state.date)}
        ${row('频次', parity)}
        ${row('生效范围', span)}
      </div>
      <div class="edit-actions">
        <button class="btn btn-danger" onclick="PB.edit.skipDay()">这天不上</button>
        <span class="edit-spacer"></span>
        <button class="btn" onclick="PB.edit.gotoCalendar()">📅 去课表日历改</button>
        <button class="btn" onclick="PB.edit.close()">关闭</button>
      </div>`;
  }

  // 时间框成对出现：文本框负责打字，原生控件只用来开选择器，改动时把两边对齐
  function onTime(el) { util.syncTimeField(el); }

  // ============ 保存 ============
  function collect() {
    const d = state.draft;
    d.text = val('efText').trim() || '新任务';
    d.loc = val('efLoc').trim();
    d.subject = val('efSubject');
    d.date = val('efDate') || state.date;
    // 时间是自由打字的，收的时候补全成 HH:MM；认不出来就留着原值
    const hhmm = (v, old) => util.parseTimeInput(v, Math.floor(util.toMinutes(old) / 60)) || old;
    d.start = hhmm(val('efStart'), d.start);
    d.end = hhmm(val('efEnd'), d.end);
    // 起止相同会被 durationMinutes 算成 1440 分钟（铺满一整天），错开一刻钟
    if (d.start === d.end) d.end = util.toHHMM(util.toMinutes(d.start) + MIN_DURATION);
    d.done = on('efDone');
    return d;
  }

  function save() {
    if (!state || state.virtual) return;
    const d = collect();
    const st = PB.store.get();
    const wasNew = state.isNew;

    if (!wasNew) {
      // 先从原日期摘掉，再按目标日期插回去；同一天则插回原下标，保住原有排序
      const from = st.tasks[state.fromDate] || [];
      const i = from.findIndex(t => t.id === state.taskId);
      if (i !== -1) from.splice(i, 1);
      if (!from.length) delete st.tasks[state.fromDate];

      if (!st.tasks[d.date]) st.tasks[d.date] = [];
      if (d.date === state.fromDate && i !== -1) st.tasks[d.date].splice(i, 0, d);
      else st.tasks[d.date].push(d);
    } else {
      if (!st.tasks[d.date]) st.tasks[d.date] = [];
      st.tasks[d.date].push(d);
    }

    PB.store.save();
    PB.week.renderWeek();
    PB.list.render();
    close();
    PB.list.showToast(wasNew ? '已添加任务' : '已保存');
  }

  function remove() {
    if (!state || state.virtual) return;
    const st = PB.store.get();
    const label = state.draft.text;
    if (!confirm(`删除任务「${label}」？`)) return;

    const arr = (st.tasks[state.fromDate] || []).filter(t => t.id !== state.taskId);
    // 早先固化过的课表项要留个墓碑，否则它下一帧又会被模板重新叠出来
    if (state.templateId) {
      arr.push({ id: PB.store.genId(), templateId: state.templateId, deleted: true });
    }
    if (arr.length) st.tasks[state.fromDate] = arr;
    else delete st.tasks[state.fromDate];

    PB.store.save();
    PB.week.renderWeek();
    PB.list.render();
    close();
    PB.list.showToast('已删除');
  }

  // 「这天不上」：课表本身不动，只在这一天的 tasks 里留个墓碑把这个块盖住
  function skipDay() {
    if (!state || !state.virtual) return;
    const st = PB.store.get();
    if (!confirm(`「${state.draft.text}」这天上不了？课表本身不变，只是这天不再显示。`)) return;

    const arr = (st.tasks[state.date] || []).filter(t => t.templateId !== state.templateId);
    arr.push({ id: PB.store.genId(), templateId: state.templateId, deleted: true });
    st.tasks[state.date] = arr;

    PB.store.save();
    PB.week.renderWeek();
    PB.list.render();
    close();
    PB.list.showToast('这天已跳过');
  }

  // 课程的编辑入口在课表日历，顺手把选中项带过去。
  // 编辑弹窗在 DOM 里排在课表弹窗后面，不先关掉会盖在它上面。
  function gotoCalendar() {
    if (!state) return;
    const id = state.templateId;
    close();
    PB.tplcal.open();
    if (id) PB.tplcal.select(id);
  }

  const api = { openTask, close, save, remove, skipDay, gotoCalendar, onTime, onOverlayClick,
                get state() { return state; } };
  PB.edit = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
