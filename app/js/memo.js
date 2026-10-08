(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});
  const util = PB.util;

  let activeId = null;
  let saveTimer = null;
  let undoStack = [];
  let redoStack = [];
  let lastSnapshot = null;

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

  function snapshot() {
    return {
      title: document.getElementById('memoTitle')?.value || '',
      body: document.getElementById('memoBody')?.value || ''
    };
  }

  function sameSnapshot(a, b) {
    return !!a && !!b && a.title === b.title && a.body === b.body;
  }

  function resetHistory() {
    undoStack = [];
    redoStack = [];
    lastSnapshot = snapshot();
  }

  // 编辑区输入 → 防抖保存
  function onEdit() {
    const m = getMemos().find(x => x.id === activeId);
    if (!m) return;
    const current = snapshot();
    if (lastSnapshot && !sameSnapshot(lastSnapshot, current)) {
      undoStack.push(lastSnapshot);
      if (undoStack.length > 100) undoStack.shift();
      redoStack = [];
    }
    lastSnapshot = current;
    m.title = current.title;
    m.body = current.body;
    m.updatedAt = Date.now();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { PB.store.save(); renderMemoList(); }, 800);
  }

  function onKeydown(e) {
    const isMemoInput = e.target.id === 'memoBody' || e.target.id === 'memoTitle';
    if (!isMemoInput || e.target.disabled) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      e.preventDefault();
      redo();
      return;
    }
    if (e.key !== 'Tab' || e.target.id !== 'memoBody') return;
    e.preventDefault();
    const el = e.target;
    el.setRangeText('\t', el.selectionStart, el.selectionEnd, 'end');
    onEdit();
  }

  function applySnapshot(value) {
    const titleEl = document.getElementById('memoTitle');
    const bodyEl = document.getElementById('memoBody');
    if (!titleEl || !bodyEl) return;
    titleEl.value = value.title;
    bodyEl.value = value.body;
    lastSnapshot = value;
    const m = getMemos().find(x => x.id === activeId);
    if (m) {
      m.title = value.title;
      m.body = value.body;
      m.updatedAt = Date.now();
    }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { PB.store.save(); renderMemoList(); }, 800);
  }

  function undo() {
    const previous = undoStack.pop();
    if (!previous || !lastSnapshot) return;
    redoStack.push(lastSnapshot);
    applySnapshot(previous);
  }

  function redo() {
    const next = redoStack.pop();
    if (!next || !lastSnapshot) return;
    undoStack.push(lastSnapshot);
    applySnapshot(next);
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
    resetHistory();
  }

  document.addEventListener('keydown', onKeydown, true);

  PB.memo = { renderMemos, createMemo, deleteMemo, selectMemo, onEdit, onKeydown, undo, redo, flushPending,
              get activeId() { return activeId; } };
})();
