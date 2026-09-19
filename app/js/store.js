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
        subjects: JSON.parse(JSON.stringify(DEFAULT_SUBJECTS)),
        settings: {
          openAtLogin: false,
          closeToTray: false,
          ai: JSON.parse(JSON.stringify(DEFAULT_AI_SETTINGS))
        }
      },
      tasks: {},
      templates: [],
      memos: []
    };
  }

  // 纯函数：不修改入参，输出一份补全后的 v2 状态
  function migrate(raw) {
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
        subjects: Array.isArray(inConfig.subjects) && inConfig.subjects.length
          ? inConfig.subjects : base.config.subjects,
        settings: {
          ...base.config.settings,
          ...inSettings,
          ai: { ...DEFAULT_AI_SETTINGS, ...inAi,
                memoryEnabled: { ...DEFAULT_AI_SETTINGS.memoryEnabled, ...(inAi.memoryEnabled || {}) } }
        }
      },
      tasks: (raw.tasks && typeof raw.tasks === 'object' && !Array.isArray(raw.tasks)) ? raw.tasks : {},
      templates: Array.isArray(raw.templates) ? raw.templates : [],
      memos: Array.isArray(raw.memos) ? raw.memos : []
    };
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
    write(s) {
      if (window.planboardAPI.storage.write(s) === false) {
        notice = '写入失败：数据没能存到磁盘';
      }
    }
  } : null;

  const backendName = detectBackend();
  const backend = backendName === 'file' ? fileBackend : localBackend;

  let migratedFromV1 = false;
  let raw = backend.read();
  if (!raw && backendName === 'file') {
    const v1 = legacyV1();
    // 原 localStorage 数据不删，留作额外保险
    if (v1) { raw = v1; migratedFromV1 = true; }
  }

  let state = migrate(raw);

  // 首次加载即固化 v2 状态：v1 数据只迁移这一次，此后以 v2 键为准
  save();

  function load() { state = migrate(backend.read()); return state; }

  function save() {
    backend.write(state);
    // 模块加载期 PB.list 还不存在，这种通知留给 main.js 启动后再弹
    if (notice && PB.list && PB.list.showToast) PB.list.showToast(takeNotice());
  }

  function get() { return state; }

  // 重置：写一份默认状态回去，而不是删文件 ——
  // 删掉的话下次启动会被当成「首次启动」，v1 迁移会把旧数据重新搬回来。
  function clear() {
    state = defaultState();
    backend.write(state);
    return state;
  }

  // ============ 查询辅助 ============
  function genId() { return 's' + Date.now() + Math.random().toString(36).slice(2,5); }

  function subjectLabel(id) {
    return state.config.subjects.find(s => s.id === id)
        || { id: '__unknown__', label: '未分类', color: '#94a3b8' };
  }

  const api = {
    migrate, defaultState,
    load, save, get, clear, takeNotice,
    get backendName() { return backendName; },
    get migratedFromV1() { return migratedFromV1; },
    DEFAULT_SUBJECTS, COURSE_COLOR, genId, subjectLabel
  };
  PB.store = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
