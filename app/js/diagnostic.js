(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});
  const api = globalThis.planboardAPI?.diagnostic;

  function log(type, details) {
    const payload = { type, details: details || {} };
    try { api?.log(payload); } catch (_) {}
    return payload;
  }

  function describe(el) {
    if (!el) return null;
    return {
      tag: el.tagName,
      id: el.id || '',
      className: typeof el.className === 'string' ? el.className : '',
      modal: el.closest?.('.modal-overlay')?.id || '',
      disabled: !!el.disabled,
      readOnly: !!el.readOnly,
      contentEditable: !!el.isContentEditable
    };
  }

  function focusState(extra) {
    return Object.assign({
      hasFocus: document.hasFocus(),
      visibility: document.visibilityState,
      active: describe(document.activeElement)
    }, extra || {});
  }

  function openModal(id, focusSelector) {
    document.querySelectorAll('.modal-overlay.open').forEach(el => {
      if (el.id !== id) el.classList.remove('open');
    });
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('open');
    log('modal-open', { id, active: describe(document.activeElement) });
    if (focusSelector) {
      requestAnimationFrame(() => {
        const focusEl = el.querySelector(focusSelector);
        if (focusEl && !focusEl.disabled) focusEl.focus({ preventScroll: true });
        log('modal-focus', { id, active: describe(document.activeElement) });
      });
    }
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
    log('modal-close', { id, active: describe(document.activeElement) });
  }

  window.addEventListener('error', e => log('window-error', {
    message: e.message, source: e.filename, line: e.lineno, column: e.colno
  }));
  window.addEventListener('unhandledrejection', e => log('unhandled-rejection', {
    reason: String(e.reason?.stack || e.reason || '')
  }));
  window.addEventListener('focus', () => log('window-focus', focusState()));
  window.addEventListener('blur', () => log('window-blur', focusState()));
  document.addEventListener('focusin', e => {
    if (e.target.matches?.('input, textarea, select, button, [contenteditable="true"]')) {
      log('control-focusin', focusState({ target: describe(e.target) }));
    }
  }, true);
  document.addEventListener('focusout', e => {
    if (e.target.matches?.('input, textarea, select, button, [contenteditable="true"]')) {
      log('control-focusout', focusState({ target: describe(e.target), related: describe(e.relatedTarget) }));
    }
  }, true);
  document.addEventListener('pointerdown', e => {
    const target = e.target.closest?.('input, textarea, select, button, [contenteditable="true"]');
    if (target) log('control-pointerdown', focusState({ target: describe(target) }));
  }, true);
  document.addEventListener('pointerup', e => {
    const target = e.target.closest?.('input, textarea, select, button, [contenteditable="true"]');
    if (target) log('control-pointerup', focusState({ target: describe(target) }));
  }, true);
  document.addEventListener('keydown', e => {
    const target = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (target) log('control-keydown', focusState({ target: describe(target), key: e.key }));
  }, true);
  document.addEventListener('click', e => {
    const target = e.target;
    if (target.matches?.('input, textarea, select, button, [contenteditable="true"]')) {
      log('control-click', focusState({ target: describe(target) }));
    }
  }, true);
  PB.debug = { log, describe, openModal, closeModal };
})();
