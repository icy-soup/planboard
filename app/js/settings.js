(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});
  const util = PB.util;
  const store = PB.store;
  const transfer = PB.transfer;

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
    renderViewVisibility();
    if (PB.debug) PB.debug.openModal('settingsModal', '#configProjectName');
    else document.getElementById('settingsModal').classList.add('open');
    // 下面几步要问主进程，先让弹窗出来再填
    refreshKeyStatus();
    refreshDataDir();
    openMemory(activeMemory);
  }

  function closeSettings() {
    // 先读入临时变量，全部校验通过后才写回 config
    const name = document.getElementById('configProjectName').value.trim();
    const semesterStart = document.getElementById('configSemesterStart').value;
    const semesterEnd = document.getElementById('configSemesterEnd').value;
    const model = document.getElementById('configAiModel').value.trim();
    const selectedViews = [...document.querySelectorAll('#viewVisibility input[data-view]:checked')].map(x => x.dataset.view);

    if (name) store.get().config.projectName = name;
    store.get().config.semesterStart = semesterStart || null;
    store.get().config.semesterEnd = semesterEnd || null;
    if (model) store.get().config.settings.ai.model = model;
    if (selectedViews.length) store.get().config.settings.visibleViews = selectedViews;
    document.querySelectorAll('#tabs .tab').forEach(b => { b.hidden = !selectedViews.includes(b.dataset.view); });
    flushMemory();

    store.save();
    document.getElementById('settingsModal').classList.remove('open');
    PB.list.render();
    PB.week.renderWeek();
    PB.list.showToast('设置已保存');
  }

  function renderViewVisibility() {
    const el = document.getElementById('viewVisibility'); if (!el) return;
    // 四象限暂时隐藏，保留实现以便以后恢复。
    const names = { week: '周视图', list: '任务时间轴', timeline: '里程碑', memo: '备忘录' };
    const visible = store.get().config.settings.visibleViews || Object.keys(names);
    el.innerHTML = Object.entries(names).map(([id, name]) => `<label class="edit-check" style="margin:0 12px 0 0;"><input type="checkbox" data-view="${id}" ${visible.includes(id) ? 'checked' : ''}> ${name}</label>`).join('');
  }

  // 点遮罩关掉设置，和课表日历 / 任务编辑保持一致。
  // 以前点遮罩毫无反应，而学期日期又只在关弹窗时才写盘，所以像是「设置不了」。
  function onOverlayClick(e) {
    if (e.target.classList.contains('modal-overlay')) closeSettings();
  }

  function openDeleteRange() {
    const today = util.todayStr();
    document.getElementById('deleteFrom').value = today;
    document.getElementById('deleteTo').value = today;
    previewDeleteRange();
    document.getElementById('deleteRangeModal').classList.add('open');
  }
  function closeDeleteRange() { document.getElementById('deleteRangeModal').classList.remove('open'); }
  function onDeleteRangeOverlayClick(e) { if (e.target.classList.contains('modal-overlay')) closeDeleteRange(); }
  function deleteRangeCount(from, to) {
    let n = 0; const tasks = store.get().tasks || {};
    for (const date of Object.keys(tasks)) if (date >= from && date <= to) n += (tasks[date] || []).length;
    return n;
  }
  function previewDeleteRange() {
    const from = document.getElementById('deleteFrom').value;
    const to = document.getElementById('deleteTo').value;
    const el = document.getElementById('deleteRangePreview');
    if (!from || !to || from > to) { el.textContent = '请选择有效的日期范围。'; return; }
    el.textContent = `这段时间共有 ${deleteRangeCount(from, to)} 条任务将被删除。`;
  }
  function confirmDeleteRange() {
    const from = document.getElementById('deleteFrom').value;
    const to = document.getElementById('deleteTo').value;
    if (!from || !to || from > to) { previewDeleteRange(); return; }
    const count = deleteRangeCount(from, to);
    if (!count) { closeDeleteRange(); PB.list.showToast('这段时间没有任务'); return; }
    if (!confirm(`确定删除 ${from} 至 ${to} 的 ${count} 条任务吗？此操作会先备份，不能自动撤销。`)) return;
    store.get().tasks = transfer.deleteDateRange(store.get().tasks, from, to);
    store.save(true);
    closeDeleteRange();
    PB.week.renderWeek(); PB.list.render(); PB.quadrant.render();
    PB.list.showToast(`已删除 ${count} 条任务`);
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

  // 开发版写项目旁的 data/，安装版写 %APPDATA%，两者互不相通。
  // 把真实路径摆出来，省得再遇到「打开是空的，我的东西怎么没了」。
  async function refreshDataDir() {
    const el = document.getElementById('dataDirHint');
    if (!el) return;
    if (!hasDesktopAPI()) {
      el.textContent = '数据目录：浏览器 localStorage（桌面版会写到程序旁的 data/）';
      return;
    }
    el.textContent = '数据目录：' + (await window.planboardAPI.app.dataDir());
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
  const memoryContents = {}; // name -> 已落盘的正文，用来判断这份是不是空的

  async function loadMemoryContents() {
    const texts = await Promise.all(PB.memory.FILES.map(f => PB.memory.read(f.name)));
    PB.memory.FILES.forEach((f, i) => { memoryContents[f.name] = texts[i] || ''; });
  }

  // 开关开着但文件是空的，AI 那边一个字节都收不到 —— 标出来，别让开关说谎
  function paintMemoryTabs() {
    const el = document.getElementById('memoryTabs');
    if (!el) return;
    const enabled = store.get().config.settings.ai.memoryEnabled || {};
    el.innerHTML = PB.memory.FILES.map(f => {
      let badge = '';
      if (!enabled[f.name]) badge = '<span class="memory-off">不发</span>';
      else if (!(memoryContents[f.name] || '').trim()) badge = '<span class="memory-off">空</span>';
      return `<button class="memory-tab${f.name === activeMemory ? ' active' : ''}"
        title="${util.attr(f.desc)}"
        onclick="PB.settings.openMemory('${f.name}')">${f.label}${badge}</button>`;
    }).join('');
  }

  async function renderMemoryTabs() {
    await loadMemoryContents();
    paintMemoryTabs();
  }

  async function openMemory(name) {
    await flushMemory();         // 先把上一份没落盘的敲进去，免得读回旧内容
    activeMemory = name;
    memoryDoc = name;

    const file = PB.memory.FILES.find(f => f.name === name);
    const enabled = store.get().config.settings.ai.memoryEnabled || {};
    document.getElementById('memoryEnabled').checked = !!enabled[name];
    document.getElementById('memoryHint').textContent = `${name}.md — ${file.desc}`;

    await renderMemoryTabs();
    if (memoryDoc !== name) return;   // 等待期间用户又切走了
    document.getElementById('memoryText').value = memoryContents[name] || '';
  }

  function onMemoryInput() {
    if (memoryTimer) clearTimeout(memoryTimer);
    memoryTimer = setTimeout(flushMemory, 800);
  }

  function flushMemory() {
    if (memoryTimer) { clearTimeout(memoryTimer); memoryTimer = null; }
    if (!memoryDoc) return Promise.resolve();
    const name = memoryDoc;
    const text = document.getElementById('memoryText').value;
    memoryContents[name] = text;
    paintMemoryTabs();
    return PB.memory.write(name, text);
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

  // ============ EXPORT ============
  // 导出哪一段、带不带课表 / 设置 / 备忘录，都在弹窗里选，选完才真的下载。
  // 默认区间取列表视图正在看的那一段 —— 「正在看哪段就导哪段」。
  // API Key 在 secrets.json 里、个人背景记忆在 data/memory/ 里，都不进这个文件。
  function openExport() {
    const r = (PB.list && PB.list.range) || null;
    if (r) {
      document.getElementById('exportFrom').value = r.from;
      document.getElementById('exportTo').value = r.to;
    }
    document.getElementById('exportAll').checked = false;
    syncExportAll();
    if (PB.debug) PB.debug.openModal('exportModal');
    else document.getElementById('exportModal').classList.add('open');
  }

  // 勾了「全部」就把两个日期框停掉，免得两处打架
  function syncExportAll() {
    const off = document.getElementById('exportAll').checked;
    document.getElementById('exportFrom').disabled = off;
    document.getElementById('exportTo').disabled = off;
  }

  function cancelExport() {
    document.getElementById('exportModal').classList.remove('open');
  }

  function onExportOverlayClick(e) {
    if (e.target.classList.contains('modal-overlay')) cancelExport();
  }

  function confirmExport() {
    const all = document.getElementById('exportAll').checked;
    const from = all ? null : document.getElementById('exportFrom').value;
    const to = all ? null : document.getElementById('exportTo').value;

    if (!all && (!from || !to)) {
      alert('先选起始日期和结束日期，或者勾上「全部」。');
      return;
    }
    if (!all && from > to) {
      alert('起始日期不能晚于结束日期。');
      return;
    }

    const data = transfer.sliceForExport(store.get(), from, to, {
      templates: document.getElementById('exportTemplates').checked,
      config: document.getElementById('exportConfig').checked,
      memos: document.getElementById('exportMemos').checked,
      timeline: document.getElementById('exportTimeline').checked
    });
    data.exportedAt = new Date().toISOString();

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = all ? `planboard-${util.todayStr()}.json`
                     : `planboard-${from}_${to}.json`;
    a.click();
    URL.revokeObjectURL(url);

    cancelExport();
    const n = transfer.describeSlice(data.tasks);
    PB.list.showToast(`已导出 ${n.count} 条（跨 ${n.days} 天）`);
  }

  // ============ IMPORT ============

  let pendingImport = null;     // 解析好的文件，等用户在弹窗里选合并还是覆盖
  let importNote = '';          // 文件形状有点怪但收编回来了，这句话要显示在弹窗里

  // 先把「现有多少 / 文件里多少」摆出来，别让人闭着眼点覆盖。
  // 文件里没带的类别不列 —— 列出来反而像「覆盖会把它清掉」。
  function importSummary(data) {
    const st = store.get();
    const head = 'color:var(--text-muted);font-size:11px;';
    const cell = 'padding:2px 0;';
    const fileTasks = transfer.describeSlice(data.tasks);
    const rows = [['任务', transfer.describeSlice(st.tasks).count,
                   `${fileTasks.count} 条 / 跨 ${fileTasks.days} 天`]];
    if (Array.isArray(data.templates)) {
      rows.push(['课表模板', st.templates.length, data.templates.length]);
    }
    if (Array.isArray(data.memos)) {
      rows.push(['备忘录', st.memos.length, data.memos.length]);
    }
    if (Array.isArray(data.timeline)) {
      rows.push(['里程碑', (st.timeline || []).length, data.timeline.length]);
    }
    return (importNote
      ? `<div style="font-size:12px;color:#b45309;margin-bottom:10px;">${util.escapeHtml(importNote)}</div>`
      : '')
      + `<div style="display:grid;grid-template-columns:1fr auto auto;gap:2px 16px;font-size:13px;margin-bottom:14px;">
      <span style="${head}">类别</span><span style="${head}">现有</span><span style="${head}">文件里</span>
      ${rows.map(r => `<span style="${cell}">${r[0]}</span>
        <span style="${cell}text-align:right;">${r[1]}</span>
        <span style="${cell}text-align:right;font-weight:600;">${r[2]}</span>`).join('')}
    </div>`;
  }

  function importJSON(event) {
    const input = event.target;
    const file = input.files[0];
    input.value = '';           // 清掉，同一个文件下次还能再选一次
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      let data;
      try { data = JSON.parse(e.target.result); }
      catch (err) { alert('文件解析失败'); return; }
      // 形状体检挡在这里：读不懂的文件绝不能走到写盘那一步
      const check = store.checkImport(data);
      if (!check.ok) {
        alert('这份文件导入不了：' + check.error + '\n\n现有数据没有改动。');
        return;
      }
      data.tasks = check.tasks;      // 没有 tasks 的里程碑文件保持为空，不会转成全天任务
      importNote = check.messages.join('；');

      pendingImport = data;
      document.getElementById('importFileName').textContent = file.name;
      document.getElementById('importSummary').innerHTML = importSummary(data);
      // 文件里带课表就默认勾上「连课表一起处理」；文件里没有就别无端动现有课表
      document.getElementById('importTemplates').checked =
        Array.isArray(data.templates) && data.templates.length > 0;
      if (PB.debug) PB.debug.openModal('importModal');
      else document.getElementById('importModal').classList.add('open');
    };
    reader.readAsText(file);
  }

  function cancelImport() {
    pendingImport = null;
    importNote = '';
    document.getElementById('importModal').classList.remove('open');
  }

  function onImportOverlayClick(e) {
    if (e.target.classList.contains('modal-overlay')) cancelImport();
  }

  function doImport(mode) {
    const file = pendingImport;
    if (!file) return;
    const st = store.get();
    const withTemplates = document.getElementById('importTemplates').checked;

    const merged = mode === 'overwrite'
      ? {
          // config 按字段合并：文件里少一项就把现有那项抹掉，风险太大。
          // 覆盖导入想覆盖的是任务，不是把学期设置也清空
          config: Object.assign({}, st.config, file.config),
          // 只换文件里出现过的那几天，没导出的日期一条不动
          tasks: transfer.replaceDays(st.tasks, file.tasks, file.range),
          templates: (withTemplates && Array.isArray(file.templates)) ? file.templates : st.templates,
          // 文件里没带备忘录就永远不动它
          memos: Array.isArray(file.memos) ? file.memos : st.memos,
          timeline: Array.isArray(file.timeline) ? file.timeline : st.timeline
        }
      : {
          config: Object.assign({}, st.config, file.config),
          tasks: transfer.mergeDays(st.tasks, file.tasks),
          templates: withTemplates
            ? transfer.mergeList(st.templates, file.templates || [])
            : st.templates,
          memos: transfer.mergeList(st.memos, file.memos || []),
          timeline: transfer.mergeList(st.timeline || [], file.timeline || [])
        };

    // 过一遍 migrate：文件里缺的字段（settings.ai.memoryEnabled 之类）补默认值，
    // 不过这一道，导入完点设置就会炸
    const report = { messages: [], dataAtRisk: false };
    const next = store.migrate(merged, report);
    if (report.dataAtRisk) {     // 还有读不懂的就别写盘，宁可这次白导
      alert('导入的内容里有读不懂的东西，没有写盘：\n' + report.messages.join('；'));
      return;
    }
    st.config = next.config;
    st.tasks = next.tasks;
    st.templates = next.templates;
    st.memos = next.memos;
    st.timeline = next.timeline;

    store.save(true);            // 导入是整批写入，写盘前无条件先备一份
    cancelImport();
    openSettings();          // 顺带把设置页那些字段刷成导入后的值
    PB.week.renderWeek();
    PB.list.render();
    PB.quadrant.render();
    PB.memo.renderMemos();
    PB.list.showToast(mode === 'overwrite' ? '已覆盖导入' : '已合并导入');
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
    openSettings, closeSettings, onOverlayClick, setSemester, renderSemesterHint, renderViewVisibility,
    addSubject, deleteSubject,
    startRename, renameKey, commitRename, updateSubjectColor,
    openExport, cancelExport, confirmExport, syncExportAll, onExportOverlayClick,
    importJSON, resetPlan,
    cancelImport, doImport, onImportOverlayClick,
    openDeleteRange, closeDeleteRange, onDeleteRangeOverlayClick, previewDeleteRange, confirmDeleteRange,
    renderSubjectList,
    setDesktop, refreshKeyStatus, saveApiKey, clearApiKey,
    renderMemoryTabs, openMemory, onMemoryInput, flushMemory, setMemoryEnabled
  };
  PB.settings = api;
  Object.assign(window, api);
})();
