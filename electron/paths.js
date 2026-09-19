'use strict';
const path = require('node:path');

// 与 Electron 无关的纯逻辑，单独拆出来是为了能直接 node --test，
// 和 backups.js 同样的理由。打包后 __dirname 落在只读的 app.asar 里，
// 数据必须改放 userData；开发版维持「项目目录旁的 data/」，
// 用户日常 `npm start` 的路径一个字节都不变。
function resolveDataDir(opts) {
  if (opts.isPackaged) return path.join(opts.userData, 'data');
  return path.join(opts.root, 'data');
}

// 开机自启登记的是「可执行文件 + 参数」。开发版下 exe 是 electron.exe，
// 必须把项目目录当参数传进去；打包版 exe 就是应用自身，不需要参数。
function loginItemArgs(opts) {
  return opts.isPackaged ? [] : [opts.root];
}

module.exports = { resolveDataDir, loginItemArgs };
