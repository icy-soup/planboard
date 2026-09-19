(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});

  // ============ KEYBOARD ============
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      const active = document.activeElement;
      if (active && active.classList.contains('task-text')) active.blur();
    }
    if (e.key === 'Escape' && document.activeElement?.classList.contains('task-text')) {
      document.activeElement.blur();
    }
    // Esc 关掉弹窗（正在改名字时留给改名逻辑自己处理）；编辑弹窗在最上层，先关它
    if (e.key === 'Escape' && !document.activeElement?.isContentEditable) {
      const edit = document.getElementById('editModal');
      if (edit && edit.classList.contains('open')) { PB.edit.close(); return; }
      const cal = document.getElementById('tplCalModal');
      if (cal && cal.classList.contains('open')) PB.tplcal.close();
    }
    // Ctrl+Escape -> toggle settings
    if (e.key === 'Escape' && e.ctrlKey) {
      const modal = document.getElementById('settingsModal');
      if (modal.classList.contains('open')) PB.settings.closeSettings();
      else PB.settings.openSettings();
    }
  });

  // ============ VIEW SWITCHING ============
  const VIEWS = ['week', 'list', 'quadrant', 'memo'];
  let activeView = 'week';

  function switchView(name) {
    if (!VIEWS.includes(name)) return;
    if (activeView === 'memo' && name !== 'memo') PB.memo.flushPending();
    activeView = name;

    document.querySelectorAll('#tabs .tab').forEach(b =>
      b.classList.toggle('active', b.dataset.view === name));

    document.getElementById('view-week').style.display = name === 'week' ? '' : 'none';
    document.getElementById('view-list').style.display = name === 'list' ? '' : 'none';
    document.getElementById('view-quadrant').style.display = name === 'quadrant' ? '' : 'none';
    document.getElementById('view-memo').style.display = name === 'memo' ? '' : 'none';

    if (name === 'week') PB.week.renderWeek();
    if (name === 'list') PB.list.render();
    if (name === 'quadrant') PB.quadrant.render();
    if (name === 'memo') PB.memo.renderMemos();
    try { localStorage.setItem('pb_activeView', name); } catch (e) {}
  }

  document.getElementById('tabs').addEventListener('click', e => {
    const btn = e.target.closest('.tab');
    if (btn) switchView(btn.dataset.view);
  });

  // ============ INIT ============
  let saved = 'week';
  try { saved = localStorage.getItem('pb_activeView') || 'week'; } catch (e) {}
  // 存储里的值可能失效（手工改过 / 旧版本留下的），必须回退到已知视图名
  switchView(VIEWS.includes(saved) ? saved : 'week');

  // 启动期的存储层消息（网页版数据迁移 / 数据文件损坏已恢复）
  if (PB.store.migratedFromV1) PB.list.showToast('已从网页版迁移数据');
  else { const n = PB.store.takeNotice(); if (n) PB.list.showToast(n); }

  // Auto-save on page unload
  window.addEventListener('beforeunload', () => { PB.memo.flushPending(); PB.store.save(); });
})();
