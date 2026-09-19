(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});
  const util = PB.util;
  const store = PB.store;

  // ============ SETTINGS ============
  const hasDesktopAPI = () => !!(typeof window !== 'undefined' && window.planboardAPI?.app);

  async function openSettings() {
    const cfg = store.get().config;
    document.getElementById('configProjectName').value = cfg.projectName;
    document.getElementById('configSemesterStart').value = cfg.semesterStart || '';
    document.getElementById('configSemesterEnd').value = cfg.semesterEnd || '';
    renderSemesterHint();
    document.getElementById('setOpenAtLogin').checked = !!cfg.settings.openAtLogin;
    document.getElementById('setCloseToTray').checked = !!cfg.settings.closeToTray;
    document.getElementById('configAiModel').value = cfg.settings.ai.model || 'deepseek-flash';
    document.getElementById('configApiKey').value = '';
    document.getElementById('desktopHint').style.display = hasDesktopAPI() ? 'none' : '';
    renderSubjectList();
    document.getElementById('settingsModal').classList.add('open');
    // 下面两步要问主进程，先让弹窗出来再填
    refreshKeyStatus();
    openMemory(activeMemory);
  }

  function closeSettings() {
    // 先读入临时变量，全部校验通过后才写回 config
    const name = document.getElementById('configProjectName').value.trim();
    const semesterStart = document.getElementById('configSemesterStart').value;
    const semesterEnd = document.getElementById('configSemesterEnd').value;
    const model = document.getElementById('configAiModel').value.trim();

    if (name) store.get().config.projectName = name;
    store.get().config.semesterStart = semesterStart || null;
    store.get().config.semesterEnd = semesterEnd || null;
    if (model) store.get().config.settings.ai.model = model;
    flushMemory();

    store.save();
    document.getElementById('settingsModal').classList.remove('open');
    PB.list.render();
    PB.week.renderWeek();
    PB.list.showToast('设置已保存');
  }

  // 点遮罩关掉设置，和课表日历 / 任务编辑保持一致。
  // 以前点遮罩毫无反应，而学期日期又只在关弹窗时才写盘，所以像是「设置不了」。
  function onOverlayClick(e) {
    if (e.target.classList.contains('modal-overlay')) closeSettings();
  }

  // 学期日期改动即时落盘，不等关弹窗
  function setSemester(field, value) {
    const cfg = store.get().config;
    if (field === 'start') cfg.semesterStart = value || null;
    else cfg.semesterEnd = value || null;
    store.save();
    renderSemesterHint();
    if (document.getElementById('tplCalModal')?.classList.contains('open')) PB.tplcal.render();
    PB.week.renderWeek();
  }

  function renderSemesterHint() {
    const el = document.getElementById('semesterWeeks');
    if (!el) return;
    const cfg = store.get().config;
    const weeks = util.weeksBetween(cfg.semesterStart, cfg.semesterEnd);
    if (cfg.semesterStart && weeks) el.textContent = `本学期共 ${weeks} 周`;
    else if (cfg.semesterStart) el.textContent = '已设开学日期，还没填学期结束日期';
    else el.textContent = '还没设开学日期，课表里的单双周会按每周显示';
  }

  // ============ 桌面版开关 ============
  // 两项都即时生效：写进 config 的同时通知主进程，不必等关弹窗
  function setDesktop(field, on) {
    store.get().config.settings[field] = !!on;
    store.save();
    const api = (typeof window !== 'undefined' && window.planboardAPI?.app) || null;
    if (!api) return;   // 浏览器里只落在配置里，重开仍是这个值
    if (field === 'openAtLogin') api.setOpenAtLogin(!!on);
    else api.setCloseToTray(!!on);
  }

  // ============ API KEY ============
  async function refreshKeyStatus() {
    const el = document.getElementById('apiKeyStatus');
    const s = await PB.ai.keyStatus();
    el.textContent = s.hasKey
      ? `已配置（${s.preview}）。密钥存在主进程，页面上不显示完整内容。`
      : '未配置。四象限的 AI 分析、记忆总结都用不了。';
    el.classList.toggle('warn', !s.hasKey);
  }

  async function saveApiKey() {
    const el = document.getElementById('configApiKey');
    const key = el.value.trim();
    if (!key) { alert('先填入 API Key'); return; }
    await PB.ai.setKey(key);
    el.value = '';
    await refreshKeyStatus();
    PB.list.showToast('API Key 已保存');
  }

  async function clearApiKey() {
    if (!confirm('清除已保存的 DeepSeek API Key？')) return;
    await PB.ai.clearKey();
    await refreshKeyStatus();
    PB.list.showToast('已清除 API Key');
  }

  // ============ 个人背景记忆 ============
  let activeMemory = PB.memory.FILES[0].name;
  let memoryDoc = null;      // 当前编辑器里装的是哪一份
  let memoryTimer = null;

  function renderMemoryTabs() {
    const el = document.getElementById('memoryTabs');
    if (!el) return;
    const enabled = store.get().config.settings.ai.memoryEnabled || {};
    el.innerHTML = PB.memory.FILES.map(f =>
      `<button class="memory-tab${f.name === activeMemory ? ' active' : ''}"
        title="${util.attr(f.desc)}"
        onclick="PB.settings.openMemory('${f.name}')">${f.label}${
          enabled[f.name] ? '' : '<span class="memory-off">不发</span>'}</button>`).join('');
  }

  async function openMemory(name) {
    flushMemory();               // 先把上一份没落盘的敲进去
    activeMemory = name;
    memoryDoc = name;

    const file = PB.memory.FILES.find(f => f.name === name);
    const enabled = store.get().config.settings.ai.memoryEnabled || {};
    document.getElementById('memoryEnabled').checked = !!enabled[name];
    document.getElementById('memoryHint').textContent = `${name}.md — ${file.desc}`;
    renderMemoryTabs();

    const text = await PB.memory.read(name);
    if (memoryDoc !== name) return;   // 等待期间用户又切走了
    document.getElementById('memoryText').value = text;
  }

  function onMemoryInput() {
    if (memoryTimer) clearTimeout(memoryTimer);
    memoryTimer = setTimeout(flushMemory, 800);
  }

  function flushMemory() {
    if (memoryTimer) { clearTimeout(memoryTimer); memoryTimer = null; }
    if (!memoryDoc) return;
    PB.memory.write(memoryDoc, document.getElementById('memoryText').value);
  }

  function setMemoryEnabled(on) {
    const st = store.get();
    st.config.settings.ai.memoryEnabled[activeMemory] = !!on;
    store.save();
    renderMemoryTabs();
  }

  function renderSubjectList() {
    const el = document.getElementById('subjectList');
    // Don't allow deleting the last subject
    const canDelete = store.get().config.subjects.length > 1;
    el.innerHTML = store.get().config.subjects.map(s => `<div class="subject-row" id="sbRow_${s.id}">
    <span class="sb-color" style="background:${s.color}"></span>
    <span class="sb-name">${util.escapeHtml(s.label)}</span>
    <input type="text" class="sb-rename" value="${util.attr(s.label)}" style="display:none"
      onkeydown="renameKey(event,'${s.id}')" onblur="commitRename('${s.id}')">
    <input type="color" value="${s.color}" onchange="updateSubjectColor('${s.id}',this.value)" style="width:28px;height:22px;padding:1px;border:1px solid var(--border);border-radius:3px;cursor:pointer;">
    <button class="btn" style="padding:2px 10px;font-size:12px;" onclick="startRename('${s.id}')">改名</button>
    ${canDelete ? `<button class="sb-del" onclick="deleteSubject('${s.id}')">&times;</button>` : ''}
  </div>`).join('');
  }

  // 就地改名，不用原生 prompt —— Esc 放弃，回车或失焦提交
  function startRename(id) {
    const row = document.getElementById('sbRow_' + id);
    if (!row) return;
    row.querySelector('.sb-name').style.display = 'none';
    const input = row.querySelector('.sb-rename');
    input.style.display = '';
    input.focus();
    input.select();
  }

  function renameKey(e, id) {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    else if (e.key === 'Escape') { e.target.dataset.cancel = '1'; e.target.blur(); }
  }

  function commitRename(id) {
    const row = document.getElementById('sbRow_' + id);
    if (!row) return;
    const input = row.querySelector('.sb-rename');
    const name = input.value.trim();
    const cancelled = input.dataset.cancel === '1';

    if (!cancelled && name) {
      const s = store.get().config.subjects.find(x => x.id === id);
      if (store.get().config.subjects.some(x => x.id !== id && x.label === name)) {
        PB.list.showToast('分类名已存在');
      } else if (s && s.label !== name) {
        s.label = name;
        store.save();
        PB.list.render();
        PB.week.renderWeek();
      }
    }
    renderSubjectList();
  }

  function addSubject() {
    const name = document.getElementById('newSubjectName').value.trim();
    if (!name) { alert('请输入分类名称'); return; }
    if (store.get().config.subjects.some(s => s.label === name)) { alert('分类名已存在'); return; }
    const color = document.getElementById('newSubjectColor').value;
    store.get().config.subjects.push({ id: store.genId(), label: name, color });
    document.getElementById('newSubjectName').value = '';
    store.save();
    renderSubjectList();
    PB.list.showToast('已添加分类');
  }

  function deleteSubject(id) {
    if (store.get().config.subjects.length <= 1) { alert('至少保留一个分类'); return; }

    // 先确定接管分类：优先 'other'，否则取第一个非被删分类
    const fallback = store.get().config.subjects.find(s => s.id === 'other' && s.id !== id)
                  || store.get().config.subjects.find(s => s.id !== id);
    if (!fallback) { alert('至少保留一个分类'); return; }

    const target = store.get().config.subjects.find(s => s.id === id);
    if (!confirm(`删除分类"${target.label}"？已有任务将移至"${fallback.label}"。`)) return;

    for (const date in store.get().tasks) {
      store.get().tasks[date].forEach(t => { if (t.subject === id) t.subject = fallback.id; });
    }
    store.get().config.subjects = store.get().config.subjects.filter(s => s.id !== id);
    store.save(); renderSubjectList(); PB.list.render();
    PB.list.showToast('已删除分类');
  }

  function updateSubjectColor(id, color) {
    const s = store.get().config.subjects.find(x => x.id === id);
    if (s) { s.color = color; store.save(); renderSubjectList(); PB.list.render(); }
  }

  // ============ EXPORT / IMPORT ============
  function exportJSON() {
    const data = { version: 1, exportedAt: new Date().toISOString(), config: store.get().config, tasks: store.get().tasks };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `planboard-${util.todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    PB.list.showToast('已导出');
  }

  function importJSON(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = JSON.parse(e.target.result);
        if (data.config && data.tasks) {
          store.get().config = data.config;
          store.get().tasks = data.tasks;
          store.save();
          PB.list.render();
          PB.list.showToast('已导入');
        } else {
          alert('无效的 PlanBoard 文件');
        }
      } catch(err) {
        alert('文件解析失败');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  // ============ RESET ============
  function resetPlan() {
    if (!confirm('重置将清除所有数据，确定？')) return;
    store.clear();   // 经存储抽象层，浏览器/桌面版走各自的后端
    PB.list.render();
    PB.week.renderWeek();
    PB.list.showToast('已重置');
  }

  const api = {
    openSettings, closeSettings, onOverlayClick, setSemester, renderSemesterHint,
    addSubject, deleteSubject,
    startRename, renameKey, commitRename, updateSubjectColor, exportJSON, importJSON, resetPlan,
    renderSubjectList,
    setDesktop, refreshKeyStatus, saveApiKey, clearApiKey,
    renderMemoryTabs, openMemory, onMemoryInput, flushMemory, setMemoryEnabled
  };
  PB.settings = api;
  Object.assign(window, api);
})();
