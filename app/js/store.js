(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});

  const HAS_LOCAL_STORAGE = typeof localStorage !== 'undefined';
  const HAS_WINDOW = typeof window !== 'undefined';

  // ============ DEFAULT CONFIG ============
  // 课程块的统一底色。课程不属于「工作/学习/个人」分类，所以它有自己的固定色
  const COURSE_COLOR = '#f59e0b';

  const DEFAULT_SUBJECTS = [
    { id: 'work', label: '工作', color: '#3b82f6' },
    { id: 'study', label: '学习', color: '#10b981' },
    { id: 'personal', label: '个人', color: '#8b5cf6' },
    { id: 'other', label: '其他', color: '#94a3b8' },
  ];

  const DEFAULT_AI_SETTINGS = {
    provider: 'deepseek',
    model: 'deepseek-flash',
    memoryEnabled: { profile: true, courses: true, goals: true, preferences: true }
  };

  // ============ 默认值与迁移 ============
  function defaultState() {
    return {
      version: 2,
      config: {
        projectName: '📋 PlanBoard',
        semesterStart: null,
        semesterEnd: null,
        timelineStart: null,
        timelineEnd: null,
        subjects: JSON.parse(JSON.stringify(DEFAULT_SUBJECTS)),
        settings: {
          openAtLogin: false,
          closeToTray: false,
          visibleViews: ['week', 'list', 'timeline', 'quadrant', 'memo'],
          ai: JSON.parse(JSON.stringify(DEFAULT_AI_SETTINGS))
        }
      },
      tasks: {},
      templates: [],
      memos: [],
      timeline: []
    };
  }

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // 任务按日期分桶存的；形状不对的内容**不能**悄悄换成 {}（2026-09-19 就是这么丢过一次任务）。
  // 能收编的收编，收不了的记进 report：messages 给人看，dataAtRisk 表示盘上还有读不懂的东西。
  function foldTaskArray(items, report) {
    const out = {};
    let dropped = 0;
    for (const item of items) {
      const date = (item && typeof item === 'object'
                 && typeof item.date === 'string' && DATE_RE.test(item.date)) ? item.date : null;
      if (!date) { dropped++; continue; }
      (out[date] || (out[date] = [])).push(item);
    }
    if (report) {
      report.messages.push(`tasks 不是按日期分桶的对象，已按每条自带的 date 归位 ${items.length - dropped} 条`
        + (dropped ? `，另有 ${dropped} 条没有可用的 date` : ''));
      if (dropped) report.dataAtRisk = true;
    }
    return out;
  }

  function normalizeTasks(raw, report) {
    if (raw === undefined || raw === null) return {};
    if (Array.isArray(raw)) return foldTaskArray(raw, report);
    if (typeof raw === 'object') return raw;
    if (report) {
      report.dataAtRisk = true;
      report.messages.push(`tasks 的形状读不懂（是 ${typeof raw}，既不是对象也不是数组）`);
    }
    return {};
  }

  function normalizeList(raw, name, report) {
    if (raw === undefined || raw === null) return [];
    if (Array.isArray(raw)) return raw;
    if (report) {
      report.dataAtRisk = true;
      report.messages.push(`${name} 不是数组，读不懂`);
    }
    return [];
  }

  // 纯函数：不修改入参，输出一份补全后的 v2 状态。
  // report 是可选的收集器（{ messages: [], dataAtRisk: false }），老调用点不传照旧。
  function migrate(raw, report) {
    if (!raw || typeof raw !== 'object') return defaultState();

    const base = defaultState();
    const inConfig = (raw.config && typeof raw.config === 'object') ? raw.config : {};
    const inSettings = (inConfig.settings && typeof inConfig.settings === 'object') ? inConfig.settings : {};
    const inAi = (inSettings.ai && typeof inSettings.ai === 'object') ? inSettings.ai : {};

    return {
      version: 2,
      config: {
        ...base.config,
        ...inConfig,
        // 新字段缺失时用默认值，已有值保留
        semesterStart: inConfig.semesterStart !== undefined ? inConfig.semesterStart : base.config.semesterStart,
        semesterEnd: inConfig.semesterEnd !== undefined ? inConfig.semesterEnd : base.config.semesterEnd,
        timelineStart: inConfig.timelineStart !== undefined ? inConfig.timelineStart : base.config.timelineStart,
        timelineEnd: inConfig.timelineEnd !== undefined ? inConfig.timelineEnd : base.config.timelineEnd,
        subjects: Array.isArray(inConfig.subjects) && inConfig.subjects.length
          ? inConfig.subjects : base.config.subjects,
        settings: {
          ...base.config.settings,
          ...inSettings,
          visibleViews: Array.isArray(inSettings.visibleViews) && inSettings.visibleViews.length ? inSettings.visibleViews : base.config.settings.visibleViews,
          ai: { ...DEFAULT_AI_SETTINGS, ...inAi,
                memoryEnabled: { ...DEFAULT_AI_SETTINGS.memoryEnabled, ...(inAi.memoryEnabled || {}) } }
        }
      },
      tasks: normalizeTasks(raw.tasks, report),
      templates: normalizeList(raw.templates, 'templates', report),
      memos: normalizeList(raw.memos, 'memos', report),
      timeline: normalizeList(raw.timeline, 'timeline', report)
    };
  }

  // 导入前的形状体检：放过读不懂的文件，比导完才发现任务没了便宜得多。
  // config 可以没有（AI 写任务时通常只给 tasks，少一项也不会把现有设置抹掉）。
  // 返回 { ok, tasks } 或 { ok: false, error }；tasks 是收编好的分桶对象
  function checkImport(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: '文件内容不是一个 JSON 对象' };
    }
    if (data.config !== undefined && data.config !== null
        && (typeof data.config !== 'object' || Array.isArray(data.config))) {
      return { ok: false, error: 'config 不是对象' };
    }
    if ((data.tasks === undefined || data.tasks === null)
        && (data.timeline === undefined || data.timeline === null)) return { ok: false, error: '缺 tasks 或 timeline' };
    for (const name of ['templates', 'memos', 'timeline']) {
      const v = data[name];
      if (v !== undefined && v !== null && !Array.isArray(v)) {
        return { ok: false, error: `${name} 不是数组` };
      }
    }
    const report = newReport();
    const tasks = normalizeTasks(data.tasks, report);
    if (report.dataAtRisk) {
      return { ok: false, error: 'tasks 里有读不懂的内容（' + report.messages.join('；') + '）' };
    }
    return { ok: true, tasks, messages: report.messages };
  }

  // ============ 任务分桶操作 ============
  // 跨天搬任务：换格子，同时把任务自带的 date 副本一起改。
  // 两处对不上时编辑弹窗读的是副本、写回去也是副本，表现成「拖过去又被搬回来」
  // （2026-09-22 修的拖动 bug）。同一天内的排序不归这里管，由调用方自己处理。
  // beforeId 为 null 或找不到时追加到末尾；搬不动返回 false。
  function moveTaskTo(tasks, fromDate, taskId, toDate, beforeId) {
    if (!tasks || !fromDate || !toDate || fromDate === toDate) return false;
    const src = tasks[fromDate];
    if (!Array.isArray(src)) return false;
    const i = src.findIndex(t => t && t.id === taskId);
    if (i === -1) return false;

    const [moved] = src.splice(i, 1);
    if (!src.length) delete tasks[fromDate];

    if (!Array.isArray(tasks[toDate])) tasks[toDate] = [];
    const tgt = tasks[toDate];
    const at = beforeId ? tgt.findIndex(t => t && t.id === beforeId) : -1;
    tgt.splice(at === -1 ? tgt.length : at, 0, moved);
    moved.date = toDate;

    // 任务自带的 to 和「那天那格勾」也得跟着走：
    // to 等于原起始日就是单天，不搬的话往回拖会凭空长出一段区间（to 还留在旧日期右边）。
    // 跨天的真区间（to 晚于 fromDate）不归这里管 —— 那是它自己的事，而且跨天的不给拖。
    if (moved.to === fromDate) moved.to = toDate;
    if (moved.doneDays && moved.doneDays[fromDate]) {
      moved.doneDays[toDate] = true;
      delete moved.doneDays[fromDate];
    }
    return true;
  }

  // ============ 后端 ============
  function detectBackend() {
    return (HAS_WINDOW
         && window.planboardAPI
         && typeof window.planboardAPI.storage?.read === 'function') ? 'file' : 'local';
  }

  const localBackend = {
    read() {
      if (!HAS_LOCAL_STORAGE) return null;
      try {
        const raw = localStorage.getItem('pb_state');
        if (raw) return JSON.parse(raw);
        // 兼容 v1 的两个键
        const cfg = localStorage.getItem('pb_config');
        if (!cfg) return null;
        return {
          config: JSON.parse(cfg),
          tasks: JSON.parse(localStorage.getItem('pb_tasks') || '{}')
        };
      } catch (e) { return null; }
    },
    write(state) {
      if (!HAS_LOCAL_STORAGE) return;
      localStorage.setItem('pb_state', JSON.stringify(state));
    }
  };

  // 存储层要界面知道的事（文件损坏已回滚备份、写盘失败等），取走即清空
  let notice = null;

  function takeNotice() { const n = notice; notice = null; return n; }

  // 浏览器调试时留下的 v1 数据；只在「桌面版且还没有数据文件」时搬一次
  function legacyV1() {
    if (!HAS_LOCAL_STORAGE) return null;
    try {
      const cfg = localStorage.getItem('pb_config');
      if (!cfg) return null;
      return { config: JSON.parse(cfg), tasks: JSON.parse(localStorage.getItem('pb_tasks') || '{}') };
    } catch (e) { return null; }
  }

  const fileBackend = (HAS_WINDOW && window.planboardAPI?.storage) ? {
    read() {
      // 主进程回 { state, notice } —— 文件损坏时它已从备份捞回一份
      const res = window.planboardAPI.storage.read();
      if (res && typeof res === 'object' && 'state' in res) {
        if (res.notice) notice = res.notice;
        return res.state;
      }
      return res;
    },
    write(s, forceBackup) {
      if (window.planboardAPI.storage.write(s, { force: !!forceBackup }) === false) {
        notice = '写入失败：数据没能存到磁盘';
      }
    }
  } : null;

  const backendName = detectBackend();
  const backend = backendName === 'file' ? fileBackend : localBackend;

  // 读到过读不懂的内容、但还没写盘时置位：下一次写盘前无条件先备一份
  let forceBackupNext = false;

  // 返回「这次读进来的东西是否全部读懂了」；读不懂时调用方不许回写盘
  function applyReport(report) {
    if (report.messages.length) {
      notice = [notice].concat(report.messages).filter(Boolean).join('；');
    }
    if (report.dataAtRisk) forceBackupNext = true;
    return !report.dataAtRisk;
  }

  function newReport() { return { messages: [], dataAtRisk: false }; }

  let migratedFromV1 = false;
  let raw = backend.read();
  if (!raw && backendName === 'file') {
    const v1 = legacyV1();
    // 原 localStorage 数据不删，留作额外保险
    if (v1) { raw = v1; migratedFromV1 = true; }
  }

  const firstReport = newReport();
  let state = migrate(raw, firstReport);

  // 首次加载即固化 v2 状态：v1 数据只迁移这一次，此后以 v2 键为准。
  // 有读不懂的内容就先别写 —— 盘上那份原样留着，比写回一份缺东西的强
  if (applyReport(firstReport)) save();

  function load() {
    const report = newReport();
    state = migrate(backend.read(), report);
    applyReport(report);
    return state;
  }

  function save(forceBackup) {
    const force = !!forceBackup || forceBackupNext;
    forceBackupNext = false;
    backend.write(state, force);
    // 模块加载期 PB.list 还不存在，这种通知留给 main.js 启动后再弹
    if (notice && PB.list && PB.list.showToast) PB.list.showToast(takeNotice());
  }

  function get() { return state; }

  // 重置：写一份默认状态回去，而不是删文件 ——
  // 删掉的话下次启动会被当成「首次启动」，v1 迁移会把旧数据重新搬回来。
  function clear() {
    state = defaultState();
    backend.write(state, true);   // 整份覆盖，写前无条件留一份备份
    return state;
  }

  // ============ 查询辅助 ============
  function genId() { return 's' + Date.now() + Math.random().toString(36).slice(2,5); }

  function subjectLabel(id) {
    return state.config.subjects.find(s => s.id === id)
        || { id: '__unknown__', label: '未分类', color: '#94a3b8' };
  }

  const api = {
    migrate, defaultState, normalizeTasks, checkImport, moveTaskTo,
    load, save, get, clear, takeNotice,
    get backendName() { return backendName; },
    get migratedFromV1() { return migratedFromV1; },
    DEFAULT_SUBJECTS, COURSE_COLOR, genId, subjectLabel
  };
  PB.store = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
