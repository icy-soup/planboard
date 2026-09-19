(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});

  if (typeof module !== 'undefined' && module.exports && !PB.util) require('./util.js');
  const util = PB.util;

  const QUADRANTS = [
    { id: 1, mark: '①', name: '重要且紧急', hint: '马上去做' },
    { id: 2, mark: '②', name: '重要不紧急', hint: '安排时间做' },
    { id: 3, mark: '③', name: '紧急不重要', hint: '尽快清掉' },
    { id: 4, mark: '④', name: '不重要不紧急', hint: '有空再说' }
  ];

  let items = [];           // 手填的和 AI 给的都在这里，一律可拖可改
  let lastCommitted = null; // 已写入的那批，供「记住这次的偏好」总结
  let busy = false;
  let seq = 0;

  const $ = (id) => document.getElementById(id);
  const toast = (m) => PB.list.showToast(m);

  function newItem(quadrant) {
    return {
      key: 'q' + (++seq),
      text: '', quadrant, reason: '',
      date: util.todayStr(), start: '09:00', end: '10:00'
    };
  }

  function byKey(key) { return items.find(it => it.key === key); }

  // ============ 渲染 ============
  function render() {
    const grid = $('qGrid');
    if (!grid) return;

    grid.innerHTML = QUADRANTS.map(q => {
      const mine = items.filter(it => it.quadrant === q.id);
      return `<div class="q-cell q-cell-${q.id}" data-q="${q.id}"
          ondragover="PB.quadrant.onDragOver(event)"
          ondragleave="PB.quadrant.onDragLeave(event)"
          ondrop="PB.quadrant.onDrop(event, ${q.id})">
        <div class="q-cell-head">
          <span class="q-cell-name">${q.mark} ${q.name}</span>
          <span class="q-cell-hint">${q.hint}</span>
          <button class="q-add" title="手动加一条" onclick="PB.quadrant.addItem(${q.id})">+</button>
        </div>
        <div class="q-items" onmousedown="PB.quadrant.onItemMouseDown(event)">
          ${mine.length ? mine.map(cardHtml).join('')
            : '<div class="q-empty">点 + 自己写，或把别处的条目拖过来</div>'}
        </div>
      </div>`;
    }).join('');

    updateActions();
  }

  function cardHtml(it) {
    const k = it.key;
    return `<div class="q-item" draggable="true" data-key="${util.attr(k)}"
        ondragstart="PB.quadrant.onDragStart(event,'${util.attr(k)}')"
        ondragend="PB.quadrant.onDragEnd(event)">
      <span class="q-grip" title="拖到别的象限">⠿</span>
      <input class="q-item-text" value="${util.attr(it.text)}" placeholder="写点什么…"
        oninput="PB.quadrant.setField('${util.attr(k)}','text',this.value)">
      <div class="q-item-time">
        <input type="date" value="${util.attr(it.date)}"
          onchange="PB.quadrant.setField('${util.attr(k)}','date',this.value)">
        <span class="time-field" data-field="start" onkeydown="PB.util.timeKeydown(event)">
          <input type="text" class="time-text" inputmode="numeric" maxlength="5"
            value="${util.attr(it.start)}" onchange="PB.quadrant.onTime('${util.attr(k)}','start',this)">
          <input type="time" class="time-native" tabindex="-1"
            value="${util.attr(it.start)}" onchange="PB.quadrant.onTime('${util.attr(k)}','start',this)">
        </span>
        <span>–</span>
        <span class="time-field" data-field="end" onkeydown="PB.util.timeKeydown(event)">
          <input type="text" class="time-text" inputmode="numeric" maxlength="5"
            value="${util.attr(it.end)}" onchange="PB.quadrant.onTime('${util.attr(k)}','end',this)">
          <input type="time" class="time-native" tabindex="-1"
            value="${util.attr(it.end)}" onchange="PB.quadrant.onTime('${util.attr(k)}','end',this)">
        </span>
      </div>
      ${it.reason ? `<div class="q-item-reason">${util.escapeHtml(it.reason)}</div>` : ''}
      <button class="q-item-del" title="去掉这条"
        onclick="PB.quadrant.removeItem('${util.attr(k)}')">✕</button>
    </div>`;
  }

  function updateActions() {
    const act = $('qActions');
    if (!act) return;
    const hasItems = items.length > 0;
    act.style.display = (hasItems || lastCommitted) ? 'flex' : 'none';
    act.querySelectorAll('[data-write]').forEach(b => { b.style.display = hasItems ? '' : 'none'; });
    const remember = $('qRemember');
    if (remember) remember.style.display = (!hasItems && lastCommitted) ? '' : 'none';

    const write = act.querySelector('[data-write-count]');
    if (write) write.textContent = `✓ 确认写入（${items.length}）`;
  }

  function setStatus(text) { const el = $('qStatus'); if (el) el.textContent = text; }

  function showRaw(content) {
    const el = $('qRaw');
    if (!el) return;
    el.style.display = 'block';
    el.innerHTML = `<div class="q-raw-head">AI 返回的不是预期格式，下面是原文，没有动上面的格子</div>
      <pre>${util.escapeHtml(content)}</pre>`;
  }

  function hideRaw() { const el = $('qRaw'); if (el) { el.style.display = 'none'; el.innerHTML = ''; } }

  // ============ 手动增删改 ============
  function addItem(quadrant) {
    const it = newItem(quadrant);
    items.push(it);
    render();
    const input = document.querySelector(`.q-item[data-key="${it.key}"] .q-item-text`);
    if (input) input.focus();
  }

  function setField(key, field, value) {
    const it = byKey(key);
    if (it) it[field] = value;   // 不回渲，否则打字会丢焦点
  }

  // 自由打字的时间框：补全成 HH:MM 后写回
  function onTime(key, field, el) {
    const v = util.syncTimeField(el);
    if (v) setField(key, field, v);
  }

  function removeItem(key) {
    items = items.filter(it => it.key !== key);
    render();
  }

  // ============ 拖拽换象限 ============
  // 在输入框里按下时先把卡片自己的 draggable 摘掉，
  // 否则在输入框里选文字会变成拖动整张卡片
  function onItemMouseDown(e) {
    const card = e.target.closest('.q-item');
    if (!card) return;
    card.draggable = !e.target.closest('input, textarea, button');
  }

  function onDragStart(e, key) {
    if (!e.currentTarget.draggable) { e.preventDefault(); return; }
    e.dataTransfer.setData('text/plain', key);
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.classList.add('dragging');
  }

  function onDragEnd(e) { e.currentTarget.classList.remove('dragging'); }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('hover');
  }

  function onDragLeave(e) { e.currentTarget.classList.remove('hover'); }

  function onDrop(e, quadrant) {
    e.preventDefault();
    e.currentTarget.classList.remove('hover');
    const it = byKey(e.dataTransfer.getData('text/plain'));
    if (!it || it.quadrant === quadrant) return;
    it.quadrant = quadrant;
    render();
  }

  // ============ AI 辅助 ============
  // AI 只往格子里补条目，不覆盖已经手填的内容
  async function analyze() {
    if (busy) return;
    const input = $('qInput');
    const lines = (input ? input.value : '').split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) { toast('先把待办写在上面，一行一条'); return; }

    busy = true;
    setStatus('AI 分析中…');
    hideRaw();

    const system = await PB.ai.buildSystemPrompt();
    const res = await PB.ai.chat([
      { role: 'system', content: system },
      { role: 'user', content: '待办：\n' + lines.map(l => '- ' + l).join('\n') }
    ], { json: true });

    busy = false;
    setStatus('');

    if (!res.ok) {
      if (res.error === 'NO_KEY') toast('还没配置 DeepSeek API Key，去 ⚙ 设置里填一个');
      else toast('AI 调用失败：' + res.error);
      return;   // 输入内容与已有格子都不动
    }

    const parsed = PB.ai.parseItems(res.content);
    if (!parsed) {
      showRaw(res.content);
      toast('AI 返回格式异常，没有写入');
      return;
    }

    // 已经有的（手填的或上次分析出来的）不重复加
    const seen = new Set(items.map(it => it.text.trim()));
    let added = 0, skipped = 0;
    for (const p of parsed) {
      if (seen.has(p.text)) { skipped++; continue; }
      seen.add(p.text);
      items.push({
        key: 'q' + (++seq), text: p.text, quadrant: p.quadrant, reason: p.reason,
        date: p.date, start: p.start, end: p.end
      });
      added++;
    }
    render();
    toast(`AI 补了 ${added} 条` + (skipped ? `，跳过 ${skipped} 条重复的` : '') + '，可以自己调');
  }

  // ============ 写入 / 取消 ============
  function commit() {
    const ready = items.filter(it => it.text.trim());
    if (!ready.length) { toast('还没有填内容'); return; }

    const st = PB.store.get();
    for (const it of ready) {
      if (!st.tasks[it.date]) st.tasks[it.date] = [];
      let end = it.end;
      // 起止相同会被 durationMinutes 算成 1440 分钟，顶到一小时
      if (it.start === end) end = util.toHHMM(util.toMinutes(it.start) + 60);
      st.tasks[it.date].push({
        id: PB.store.genId(),
        start: it.start, end,
        subject: st.config.subjects[0]?.id || 'other',
        text: it.text.trim(), loc: '', done: false
      });
    }

    lastCommitted = ready.map(it => Object.assign({}, it));
    items = [];
    PB.store.save();
    PB.week.renderWeek();
    PB.list.render();
    render();
    const input = $('qInput');
    if (input) input.value = '';
    hideRaw();
    toast(`已写入 ${ready.length} 项`);
  }

  function discard() {
    if (items.length && !confirm('清掉这四个格子里的条目？已经写进计划的不受影响。')) return;
    items = [];
    lastCommitted = null;
    hideRaw();
    render();      // 输入框里的原文保留，方便改完再分析一次
    toast('已清空');
  }

  // ============ 记住这次的偏好 ============
  async function remember() {
    if (!lastCommitted || !lastCommitted.length) return;
    const list = lastCommitted.map(it =>
      `- ${it.text} → 第 ${it.quadrant} 象限（${it.reason || '无理由'}），排在 ${it.date} ${it.start}`).join('\n');

    const btn = $('qRemember');
    if (btn) { btn.disabled = true; btn.textContent = '总结中…'; }

    const res = await PB.ai.chat([
      { role: 'system', content:
        '你是 PlanBoard 的助手。请从这次的四象限排序结果里总结这位使用者的偏好规律。' +
        '输出 1–3 条，每行以「- 」开头，直接写结论，不要标题、不要客套话、不要解释你在做什么。' },
      { role: 'user', content: `本次排序结果：\n${list}\n\n请总结 1–3 条偏好。` }
    ]);

    if (btn) { btn.disabled = false; btn.textContent = '记住这次的偏好'; }

    if (!res.ok) {
      toast('AI 调用失败：' + (res.error === 'NO_KEY' ? '还没配置 API Key' : res.error));
      return;
    }

    const add = res.content.trim();
    if (!add) { toast('AI 没给出可用的偏好'); return; }

    const prev = await PB.memory.read('preferences');
    const merged = (prev.trim() ? prev.trim() + '\n' : '') + add + '\n';
    await PB.memory.write('preferences', merged);
    toast('已追加到 preferences.md');
  }

  const api = { render, analyze, commit, discard, remember, addItem, setField, onTime, removeItem,
                onItemMouseDown, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
                QUADRANTS,
                // 供测试断言
                get items() { return items.slice(); },
                _reset() { items = []; lastCommitted = null; seq = 0; } };
  PB.quadrant = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
