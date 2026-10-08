(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});

  function normalize(theme) { return theme === 'dark' ? 'dark' : 'light'; }
  function toggle(theme) { return normalize(theme) === 'dark' ? 'light' : 'dark'; }

  function paint(theme) {
    const mode = normalize(theme);
    document.documentElement.dataset.theme = mode;
    const button = document.getElementById('themeToggle');
    if (button) {
      button.textContent = mode === 'dark' ? '☀️ 日间' : '🌙 夜间';
      button.title = mode === 'dark' ? '切换到日间模式' : '切换到夜间模式';
      button.setAttribute('aria-label', button.title);
    }
    return mode;
  }

  function init() {
    const mode = paint(PB.store.get().config.settings.theme);
    // 旧数据没有 theme 时，使用当前默认值但不急着改盘。
    return mode;
  }

  function toggleCurrent() {
    const settings = PB.store.get().config.settings;
    settings.theme = toggle(settings.theme);
    const mode = paint(settings.theme);
    PB.store.save();
    return mode;
  }

  const api = { normalize, toggle, paint, init, toggleCurrent };
  PB.theme = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
