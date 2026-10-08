const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const theme = require('../app/js/theme.js');

test('主题只接受 light / dark，未知值回到 light', () => {
  assert.equal(theme.normalize('dark'), 'dark');
  assert.equal(theme.normalize('light'), 'light');
  assert.equal(theme.normalize('system'), 'light');
  assert.equal(theme.normalize(''), 'light');
});

test('toggle 在浅色和深色之间切换', () => {
  assert.equal(theme.toggle('light'), 'dark');
  assert.equal(theme.toggle('dark'), 'light');
});

test('深色主题为红色提示和里程碑背景提供主题变量', () => {
  const css = fs.readFileSync('app/css/base.css', 'utf8');
  assert.match(css, /:root\[data-theme="dark"\][\s\S]*--rose:/);
  assert.match(css, /--timeline-board-bg:/);
  assert.match(css, /timeline-board \{ background: var\(--timeline-board-bg\)/);
  assert.match(css, /timeline-dot \{ border-color:var\(--timeline-board-bg\)/);
});
