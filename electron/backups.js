'use strict';
const fs = require('node:fs');
const path = require('node:path');

// 与 Electron 无关的纯文件操作，单独拆出来是为了能直接 node --test
const PREFIX = 'planboard-';
const SUFFIX = '.json';
const KEEP = 20;                          // 保留最近 20 份
const INTERVAL_MS = 10 * 60 * 1000;       // 距上次备份超过 10 分钟才再备一份

function pad2(n) { return String(n).padStart(2, '0'); }

function stamp(d) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
       + `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

// 文件名里的时间戳；命名不合规的当作 0（最旧）
function stampMs(name) {
  const m = /^planboard-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/.exec(name);
  if (!m) return 0;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

function list(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    return [];   // 目录还不存在
  }
  return names
    .filter(n => n.startsWith(PREFIX) && n.endsWith(SUFFIX))
    .sort((a, b) => (stampMs(a) - stampMs(b)) || a.localeCompare(b));
}

// 到期条件只看最近一份备份的时间戳，重启后也成立
function due(dir, now) {
  const files = list(dir);
  if (!files.length) return true;
  return now - stampMs(files[files.length - 1]) >= INTERVAL_MS;
}

function prune(dir, keep) {
  const files = list(dir);
  const drop = files.slice(0, Math.max(0, files.length - keep));
  for (const f of drop) fs.unlinkSync(path.join(dir, f));
  return drop.length;
}

// 备份的是「上一次写盘留下的那份」，所以调用方要在覆盖主文件之前调
// 返回新建的备份文件名；没到期或还没有主文件时返回 null
function backup(stateFile, dir, now) {
  if (!fs.existsSync(stateFile)) return null;
  if (!due(dir, now)) return null;

  fs.mkdirSync(dir, { recursive: true });
  const name = PREFIX + stamp(new Date(now)) + SUFFIX;
  fs.copyFileSync(stateFile, path.join(dir, name));
  prune(dir, KEEP);
  return name;
}

// 从新到旧找第一份能解析的；全都不行则返回 null
function newestReadable(dir, readJson) {
  const files = list(dir);
  for (let i = files.length - 1; i >= 0; i--) {
    const parsed = readJson(path.join(dir, files[i]));
    if (parsed) return parsed;
  }
  return null;
}

module.exports = { PREFIX, SUFFIX, KEEP, INTERVAL_MS, stamp, stampMs, list, due, prune, backup, newestReadable };
