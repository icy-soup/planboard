const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const backups = require('../electron/backups.js');

const MIN = 60 * 1000;
const T0 = new Date(2026, 8, 18, 14, 30, 5).getTime();   // 本地时间 2026-09-18 14:30:05

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-backup-'));
  return { dir, state: path.join(dir, 'planboard.json'), bak: path.join(dir, 'backups') };
}

test('stamp / stampMs 互为逆运算', () => {
  const s = backups.stamp(new Date(T0));
  assert.strictEqual(s, '20260918-143005');
  assert.strictEqual(backups.stampMs(backups.PREFIX + s + '.json'), T0);
});

test('stampMs 对命名不合规的文件返回 0（当最旧处理）', () => {
  assert.strictEqual(backups.stampMs('notes.txt'), 0);
  assert.strictEqual(backups.stampMs('planboard-broken.json'), 0);
});

test('目录不存在时 list 为空、due 为真', () => {
  const { bak } = tmp();
  assert.deepStrictEqual(backups.list(bak), []);
  assert.strictEqual(backups.due(bak, T0), true);
});

test('还没有主文件时不备份', () => {
  const { state, bak } = tmp();
  assert.strictEqual(backups.backup(state, bak, T0), null);
  assert.deepStrictEqual(backups.list(bak), []);
});

test('backup 复制的是调用时磁盘上的内容（覆盖前那一份）', () => {
  const { state, bak } = tmp();
  fs.writeFileSync(state, 'first', 'utf8');
  const name = backups.backup(state, bak, T0);

  assert.strictEqual(name, 'planboard-20260918-143005.json');
  assert.strictEqual(fs.readFileSync(path.join(bak, name), 'utf8'), 'first');
});

test('10 分钟内不重复备份，超过之后才再备一份', () => {
  const { state, bak } = tmp();
  fs.writeFileSync(state, 'v1', 'utf8');
  backups.backup(state, bak, T0);

  fs.writeFileSync(state, 'v2', 'utf8');
  assert.strictEqual(backups.backup(state, bak, T0 + 9 * MIN), null);       // 未到期
  assert.strictEqual(backups.list(bak).length, 1);

  const later = backups.backup(state, bak, T0 + 10 * MIN);                  // 正好到期
  assert.strictEqual(later, 'planboard-20260918-144005.json');
  assert.strictEqual(fs.readFileSync(path.join(bak, later), 'utf8'), 'v2');
  assert.strictEqual(backups.list(bak).length, 2);
});

test('超过 20 份时删掉最旧的，保留最近 20 份', () => {
  const { state, bak } = tmp();
  fs.mkdirSync(bak, { recursive: true });
  for (let i = 0; i < 25; i++) {
    fs.writeFileSync(state, 'v' + i, 'utf8');
    backups.backup(state, bak, T0 + i * 11 * MIN);
  }
  const files = backups.list(bak);
  assert.strictEqual(files.length, backups.KEEP);
  assert.strictEqual(files[0], 'planboard-20260918-152505.json');   // 第 6 份（14:30 + 55min），前 5 份已删
  assert.ok(!fs.existsSync(path.join(bak, 'planboard-20260918-143005.json')));
});

test('prune 按时间戳而非文件名字典序删（乱的顺序也不会删错）', () => {
  const { bak } = tmp();
  fs.mkdirSync(bak, { recursive: true });
  // 故意让字典序与时间序相反
  for (const n of ['planboard-20260101-000000.json', 'planboard-c.json', 'planboard-20261231-235959.json']) {
    fs.writeFileSync(path.join(bak, n), '{}');
  }
  backups.prune(bak, 2);
  const left = backups.list(bak);
  assert.strictEqual(left.length, 2);
  // 命名不合规的当作 0，最先被删
  assert.ok(!left.includes('planboard-c.json'));
});

test('newestReadable 跳过损坏的快照，返回最近一份可解析的', () => {
  const { bak } = tmp();
  fs.mkdirSync(bak, { recursive: true });
  fs.writeFileSync(path.join(bak, 'planboard-20260918-140000.json'), '{"ok":1}');
  fs.writeFileSync(path.join(bak, 'planboard-20260918-150000.json'), '{ 坏掉的');

  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
  assert.deepStrictEqual(backups.newestReadable(bak, readJson), { ok: 1 });
});

test('newestReadable 全部损坏时返回 null', () => {
  const { bak } = tmp();
  fs.mkdirSync(bak, { recursive: true });
  fs.writeFileSync(path.join(bak, 'planboard-20260918-150000.json'), 'nope');
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
  assert.strictEqual(backups.newestReadable(bak, readJson), null);
});
