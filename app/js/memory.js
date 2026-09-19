(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});

  // 按主题拆开，改课表时只动 courses.md
  const FILES = [
    { name: 'profile',     label: '个人背景', desc: '身份、作息、习惯、精力曲线' },
    { name: 'courses',     label: '课表',     desc: '本学期的课表（文字描述）' },
    { name: 'goals',       label: '目标',     desc: '当前目标与截止日期' },
    { name: 'preferences', label: '偏好',     desc: '偏好，含 AI 自动积累的部分' }
  ];

  const NAMES = FILES.map(f => f.name);
  const hasNative = typeof window !== 'undefined' && !!window.planboardAPI?.memory;

  async function read(name) {
    if (NAMES.indexOf(name) === -1) return '';
    if (hasNative) return (await window.planboardAPI.memory.read(name)) || '';
    try { return localStorage.getItem('pb_memory_' + name) || ''; } catch (e) { return ''; }
  }

  async function write(name, text) {
    if (NAMES.indexOf(name) === -1) return;
    if (hasNative) return window.planboardAPI.memory.write(name, text);
    try { localStorage.setItem('pb_memory_' + name, String(text == null ? '' : text)); } catch (e) {}
  }

  // 只取「勾了发送」且确实有内容的文件 —— 没勾的不读、不发
  async function readEnabled(config) {
    const enabled = (config.settings.ai && config.settings.ai.memoryEnabled) || {};
    const out = [];
    for (const f of FILES) {
      if (!enabled[f.name]) continue;
      const text = (await read(f.name)).trim();
      if (text) out.push({ name: f.name, label: f.label, text });
    }
    return out;
  }

  const api = { FILES, NAMES, hasNative, read, write, readEnabled };
  PB.memory = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
