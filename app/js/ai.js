(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});

  if (typeof module !== 'undefined' && module.exports && !PB.util) require('./util.js');
  const util = PB.util;

  const hasNative = typeof window !== 'undefined' && !!window.planboardAPI?.ai;
  const LS_KEY = 'pb_deepseekKey';

  // ---------- 密钥 ----------
  // 桌面版把密钥留在主进程，页面只拿到「配没配 + 尾号」；浏览器版降级存在 localStorage
  async function keyStatus() {
    if (hasNative) return window.planboardAPI.secrets.status();
    let key = '';
    try { key = localStorage.getItem(LS_KEY) || ''; } catch (e) {}
    return { hasKey: !!key, preview: key ? 'sk-…' + key.slice(-4) : '' };
  }

  async function setKey(key) {
    const k = String(key || '').trim();
    if (hasNative) return window.planboardAPI.secrets.set(k);
    try { localStorage.setItem(LS_KEY, k); } catch (e) {}
  }

  async function clearKey() {
    if (hasNative) return window.planboardAPI.secrets.clear();
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
  }

  // ---------- 调用 ----------
  async function chat(messages, opts) {
    if (hasNative) return window.planboardAPI.ai.chat(messages, opts);

    let key = '';
    try { key = localStorage.getItem(LS_KEY) || ''; } catch (e) {}
    if (!key) return { ok: false, error: 'NO_KEY' };

    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(Object.assign(
          { model: PB.store.get().config.settings.ai.model || 'deepseek-flash',
            messages, temperature: 0.3, stream: false },
          (opts && opts.json) ? { response_format: { type: 'json_object' } } : {}
        ))
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') return { ok: false, error: 'AI 返回内容为空' };
      return { ok: true, content };
    } catch (err) {
      return { ok: false, error: '浏览器直连失败（可能是跨域限制），请用桌面版调用 AI' };
    }
  }

  // ---------- 提示词 ----------
  const SYSTEM_BASE = [
    '你是 PlanBoard 的计划助手。用户会把一批待办丢给你，请按四象限法则判断优先级，并给出建议时段。',
    '只输出 JSON，不要解释、不要 Markdown 代码块。格式：',
    '{"items":[{"text":"原文","quadrant":1,"reason":"一句话理由","suggestedDate":"YYYY-MM-DD","suggestedStart":"HH:MM","suggestedEnd":"HH:MM"}]}',
    'quadrant：1=重要且紧急，2=重要不紧急，3=紧急不重要，4=不重要不紧急。',
    'text 必须原样照抄用户的待办。suggestedDate 省略表示今天。',
    '时段要落在 05:00–次日 05:00 的清醒日内，别和已排的任务重叠。'
  ].join('\n');

  function todaySchedule() {
    const st = PB.store.get();
    const today = util.todayStr();
    const weekNo = st.config.semesterStart ? util.weekNo(today, st.config.semesterStart) : null;
    const items = PB.template.resolveDayTasks(today, weekNo, st.templates, st.tasks[today] || []);
    if (!items.length) return '';
    const lines = items.map(t => `  ${t.start}–${t.end} ${t.text}${t.loc ? ' @ ' + t.loc : ''}`).join('\n');
    return `今天（${today}）已排：\n${lines}`;
  }

  async function buildSystemPrompt() {
    const now = new Date();
    const parts = [
      SYSTEM_BASE,
      `今天是 ${util.todayStr()}（周${util.weekdayLabel(util.todayStr())}），现在 ${util.pad2(now.getHours())}:${util.pad2(now.getMinutes())}。`
    ];
    const sched = todaySchedule();
    if (sched) parts.push(sched);

    const mem = await PB.memory.readEnabled(PB.store.get().config);
    for (const m of mem) parts.push(`## ${m.label}（${m.name}.md）\n${m.text}`);
    return parts.join('\n\n');
  }

  // ---------- 结果解析 ----------
  // \d{2}:\d{2} 会放过 25:00 这种，得真按时刻范围验一遍
  function isHHMM(s) {
    if (typeof s !== 'string' || !/^\d{2}:\d{2}$/.test(s)) return false;
    return Number(s.slice(0, 2)) < 24 && Number(s.slice(3, 5)) < 60;
  }

  function isDateStr(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + 'T00:00:00');
    return !isNaN(d) && util.toDateStr(d) === s;   // 挡掉 2026-02-31 这种
  }

  // 兼容 {"items":[...]} 与裸数组两种形状；解析不了就返回 null 让界面展示原文
  function parseItems(content) {
    let data;
    try { data = JSON.parse(content); } catch (e) { return null; }
    const arr = Array.isArray(data) ? data
      : (data && Array.isArray(data.items)) ? data.items : null;
    if (!arr) return null;

    return arr.map(o => ({
      text: String(o.text || '').trim(),
      quadrant: [1, 2, 3, 4].includes(Number(o.quadrant)) ? Number(o.quadrant) : 4,
      reason: String(o.reason || '').trim(),
      date: isDateStr(o.suggestedDate) ? o.suggestedDate : util.todayStr(),
      start: isHHMM(o.suggestedStart) ? o.suggestedStart : '09:00',
      end: isHHMM(o.suggestedEnd) ? o.suggestedEnd : '10:00'
    })).filter(it => it.text);
  }

  const api = { hasNative, keyStatus, setKey, clearKey, chat, buildSystemPrompt, parseItems,
                SYSTEM_BASE };
  PB.ai = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
