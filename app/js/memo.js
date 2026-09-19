(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});
  const util = PB.util;

  let activeId = null;
  let saveTimer = null;

  function getMemos() { return PB.store.get().memos; }

  function sortMemos(list) {
    return list.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function createMemo() {
    const now = Date.now();
    const memo = { id: 'm' + now + Math.random().toString(36).slice(2, 5),
                   title: '新笔记', body: '', createdAt: now, updatedAt: now };
    getMemos().push(memo);
    activeId = memo.id;
    PB.store.save();
    renderMemos();
    const t = document.getElementById('memoTitle');
    if (t) { t.focus(); t.select(); }
  }

  function deleteMemo(id) {
    const m = getMemos().find(x => x.id === id);
    if (!m) return;
    if (!confirm(`删除笔记「${m.title || '无标题'}」？`)) return;
    const list = getMemos();
    list.splice(list.findIndex(x => x.id === id), 1);
    if (activeId === id) activeId = list.length ? sortMemos(list)[0].id : null;
    PB.store.save();
    renderMemos();
  }

  function selectMemo(id) {
    flushPending();
    activeId = id;
    renderMemos();
  }

  // 编辑区输入 → 防抖保存
  function onEdit() {
    const m = getMemos().find(x => x.id === activeId);
    if (!m) return;
    m.title = document.getElementById('memoTitle').value;
    m.body = document.getElementById('memoBody').value;
    m.updatedAt = Date.now();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { PB.store.save(); renderMemoList(); }, 800);
  }

  function flushPending() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; PB.store.save(); }
  }

  function renderMemoList() {
    const el = document.getElementById('memoList');
    if (!el) return;
    const list = sortMemos(getMemos());
    if (!list.length) {
      el.innerHTML = '<div class="memo-empty">还没有笔记</div>';
      return;
    }
    el.innerHTML = list.map(m => `<div class="memo-item${m.id === activeId ? ' active' : ''}"
        onclick="PB.memo.selectMemo('${m.id}')">
      <div class="memo-item-title">${util.escapeHtml(m.title || '无标题')}</div>
      <div class="memo-item-time">${formatTime(m.updatedAt)}</div>
    </div>`).join('');
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const today = util.todayStr();
    const ds = util.toDateStr(d);
    const hm = util.pad2(d.getHours()) + ':' + util.pad2(d.getMinutes());
    if (ds === today) return hm;
    return util.formatShortDate(ds) + ' ' + hm;
  }

  function renderMemos() {
    renderMemoList();
    const m = getMemos().find(x => x.id === activeId);
    const titleEl = document.getElementById('memoTitle');
    const bodyEl = document.getElementById('memoBody');
    const delBtn = document.getElementById('memoDelete');
    if (!m) {
      titleEl.value = ''; bodyEl.value = '';
      titleEl.disabled = true; bodyEl.disabled = true;
      delBtn.disabled = true;
      return;
    }
    titleEl.disabled = false; bodyEl.disabled = false; delBtn.disabled = false;
    titleEl.value = m.title;
    bodyEl.value = m.body;
  }

  PB.memo = { renderMemos, createMemo, deleteMemo, selectMemo, onEdit, flushPending,
              get activeId() { return activeId; } };
})();
