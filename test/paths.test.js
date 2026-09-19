const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const paths = require('../electron/paths.js');

const ROOT = path.join('C:', 'repo');
const USER_DATA = path.join('C:', 'Users', 'someone', 'AppData', 'Roaming', 'PlanBoard');

test('resolveDataDir: 开发版沿用项目目录旁的 data/', () => {
  const got = paths.resolveDataDir({ isPackaged: false, userData: USER_DATA, root: ROOT });
  assert.strictEqual(got, path.join(ROOT, 'data'));
});

test('resolveDataDir: 打包版改放 userData，不落在只读的 asar 里', () => {
  const got = paths.resolveDataDir({ isPackaged: true, userData: USER_DATA, root: ROOT });
  assert.strictEqual(got, path.join(USER_DATA, 'data'));
  // 打包后 root 指向 app.asar 内部，结果里绝不能出现它
  assert.ok(!got.includes('asar'));
});

test('loginItemArgs: 开发版要把项目目录当参数传给 electron.exe', () => {
  assert.deepStrictEqual(paths.loginItemArgs({ isPackaged: false, root: ROOT }), [ROOT]);
});

test('loginItemArgs: 打包版 exe 就是应用本身，不带参数', () => {
  assert.deepStrictEqual(paths.loginItemArgs({ isPackaged: true, root: ROOT }), []);
});
