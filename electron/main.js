'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const backups = require('./backups.js');
const { resolveDataDir, loginItemArgs } = require('./paths.js');

const ROOT = path.join(__dirname, '..');
// 开发版沿用项目目录旁的 data/；打包版走 %APPDATA%\PlanBoard\data
// （asar 是只读归档，写不进去，写盘会整条失败）
const DATA_DIR = resolveDataDir({
  isPackaged: app.isPackaged,
  userData: app.getPath('userData'),
  root: ROOT
});
const STATE_FILE = path.join(DATA_DIR, 'planboard.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json');
const MEMORY_DIR = path.join(DATA_DIR, 'memory');

const MEMORY_FILES = ['profile', 'courses', 'goals', 'preferences'];

// 托盘图标：应用图标缩到 16×16 后内嵌，避免多带一个二进制图标文件
const TRAY_ICON_16 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAChUlEQVR4nHWTTW5cVRCFv6p3n7tt/GJ3GxADwH+JkBgEVsAqAENQxCQTohAp2UBnB5FCFAYZgZSAHRaRDYBwxIAfB3cDEgHU7Z827jbvvnsYvLZxpHAGd1CqKp1z6xzjBDIEmAlg9fborEJcBLAYeo+vTG/VbTIMoO6zk+FJYeXO7gVC8yOl9KaZzdYzOjD3b4njT3++PH//9IwhGTews+2f8ip/6bNstlhTCemfQ1AlACwzn5rBcqgOhutZ+eTDrcG5khvIkByztPzJznrWmn837g1LN9wwZ0IWIaGURApzRV7t7G5sf9xaQ3IDWLrVXwvz7S/jcFiaWT6OkCROw81oBpBUhqLI4+7gve7VhfVAp+N4uK5IMnAJXn/emcnheIUBhyU83kkYuCIJD9fpdB6EldalVZmdT0cjNzPFBG+9kvHqnFOlekHm0NtL/DhI5G6ejkZmZudXWpdWQ7KpZQ95U1UpYWYGu0didiSSahYSDEbCDASGoizkzRSnl8NpnVZ/GG7/1ZoZnGkYo2hIHC85QbCy7CqUYzw0USWBnZkyFqZrX33fT3z+XYlZLUUgLDPFcmzluOvbw7tbkh55YzoJJTf45o+Kh79EHvYiX/9e8et+4smBJgyVvDGTJD3aHt7dMoDFm3++ny+8cP/4jIeliKnWNOXGTA5pwvv4jGX/rwu9ay9+cWKkpVuDB6Hders2kjIzt2PDS1L9WBXmijwOdr7qXm2/g+QOiI5c/c2L1d7+RiiK3BqFJ9ySamCZebPwUBR5tbe/of7mRTrySSCeDtPy7cEHhMZlxBvm/hyAUvobY5N4dGf7Svve02H6nzgv3fztNTxfBCCVve61l394Vpz/BRLPWENv5lH7AAAAAElFTkSuQmCC';

let win = null;
let tray = null;
let closeToTray = false;
let quitting = false;
// 存储层要告诉界面的事（文件损坏已回滚备份等），随下次 storage:read 一起交出去
let readNotice = null;

// ============ 主数据文件 ============
function readFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return null;
  }
}

// 主文件损坏就退到最近一份还能解析的备份，并记下要说的话
function readState() {
  let err = null;
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {
    err = e;
  }
  if (err.code === 'ENOENT') return null;   // 首次启动，交由界面兜成默认状态

  console.error('读取 planboard.json 失败：', err.message);
  const salvaged = backups.newestReadable(BACKUP_DIR, readFile);
  if (salvaged) {
    readNotice = '数据文件损坏，已从最近的备份恢复';
    return salvaged;
  }
  readNotice = '数据文件损坏，且没有可用备份，已重置为空数据';
  return null;
}

function writeState(state) {
  try {
    // 备份的是覆盖前那一份，所以要在写盘之前调
    backups.backup(STATE_FILE, BACKUP_DIR, Date.now());
  } catch (err) {
    // 备份失败不阻断主写入
    console.error('备份失败：', err.message);
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// ============ 密钥 / 记忆文件 ============
function readSecrets() { return readFile(SECRETS_FILE) || {}; }

function writeSecrets(obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

// 记忆文件名来自界面，白名单挡住路径穿越
function memoryPath(name) {
  if (!MEMORY_FILES.includes(name)) throw new Error('未知的记忆文件：' + name);
  return path.join(MEMORY_DIR, name + '.md');
}

function readMemory(name) {
  try {
    return fs.readFileSync(memoryPath(name), 'utf8');
  } catch (e) {
    return '';
  }
}

function writeMemory(name, text) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  fs.writeFileSync(memoryPath(name), String(text == null ? '' : text), 'utf8');
}

// ============ DeepSeek ============
function aiConfig() { return readFile(STATE_FILE)?.config?.settings?.ai || {}; }

async function chat(messages, opts) {
  const key = readSecrets().deepseekApiKey;
  if (!key) return { ok: false, error: 'NO_KEY' };

  const model = (opts && opts.model) || aiConfig().model || 'deepseek-flash';
  const body = { model, messages, temperature: 0.3, stream: false };
  if (opts && opts.json) body.response_format = { type: 'json_object' };

  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      return { ok: false, error: msg };
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return { ok: false, error: 'AI 返回内容为空' };
    return { ok: true, content };
  } catch (err) {
    const timeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    return { ok: false, error: timeout ? 'AI 请求超时' : err.message };
  }
}

// ============ 窗口 / 托盘 ============
function createWindow() {
  win = new BrowserWindow({
    width: 960,
    height: 720,
    backgroundColor: '#f6f7f9',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(ROOT, 'app', 'index.html'));

  // 关窗 = 退出；开了「关闭后最小化到托盘」才改成藏起来
  win.on('close', (e) => {
    if (quitting || !closeToTray) return;
    e.preventDefault();
    win.hide();
  });
  win.on('closed', () => { win = null; });
}

function showWindow() {
  if (!win) createWindow();
  else { win.show(); win.focus(); }
}

function createTray() {
  if (tray) return;
  const image = nativeImage.createFromDataURL('data:image/png;base64,' + TRAY_ICON_16);
  tray = new Tray(image);
  tray.setToolTip('PlanBoard');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: showWindow },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', showWindow);
}

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

// 开机自启由系统按「可执行文件 + 参数」登记，所以要带上项目目录
function applyOpenAtLogin(on) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!on,
      path: process.execPath,
      args: loginItemArgs({ isPackaged: app.isPackaged, root: ROOT })
    });
  } catch (err) {
    console.error('设置开机自启失败：', err.message);
  }
}

// 启动时先按磁盘上的设置就位，界面还没起来也不影响
function applyStoredSettings() {
  const settings = readFile(STATE_FILE)?.config?.settings || {};
  closeToTray = !!settings.closeToTray;
  if (settings.openAtLogin) applyOpenAtLogin(true);
  if (closeToTray) createTray();
}

// ============ IPC ============
// 渲染进程的 store.js 是同步 API，所以读写用 sendSync 而非 invoke/handle。
ipcMain.on('storage:read', (event) => {
  const state = readState();
  const notice = readNotice;
  readNotice = null;
  event.returnValue = { state, notice };
});

ipcMain.on('storage:write', (event, state) => {
  try {
    writeState(state);
    event.returnValue = true;
  } catch (err) {
    console.error('写入 planboard.json 失败：', err.message);
    event.returnValue = false;
  }
});

ipcMain.handle('app:setOpenAtLogin', (event, on) => {
  applyOpenAtLogin(on);
  return true;
});

ipcMain.handle('app:setCloseToTray', (event, on) => {
  closeToTray = !!on;
  if (closeToTray) createTray(); else destroyTray();
  return true;
});

ipcMain.handle('secrets:status', () => {
  const key = readSecrets().deepseekApiKey || '';
  return {
    hasKey: !!key,
    // 只回一个尾段给界面做确认，完整密钥不进入渲染进程
    preview: key ? 'sk-…' + key.slice(-4) : ''
  };
});

ipcMain.handle('secrets:set', (event, key) => {
  writeSecrets(Object.assign(readSecrets(), { deepseekApiKey: String(key || '').trim() }));
  return true;
});

ipcMain.handle('secrets:clear', () => {
  const s = readSecrets();
  delete s.deepseekApiKey;
  writeSecrets(s);
  return true;
});

ipcMain.handle('memory:read', (event, name) => readMemory(name));
ipcMain.handle('memory:write', (event, name, text) => { writeMemory(name, text); return true; });
ipcMain.handle('memory:list', () => MEMORY_FILES.map(name => ({ name, text: readMemory(name) })));

ipcMain.handle('ai:chat', (event, messages, opts) => chat(messages, opts));

// ============ 生命周期 ============
app.whenReady().then(() => {
  applyStoredSettings();
  createWindow();
});

app.on('before-quit', () => { quitting = true; });

app.on('window-all-closed', () => {
  // 开了托盘常驻就把应用留在托盘里，否则关窗即退出
  if (closeToTray || process.platform === 'darwin') return;
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else showWindow();
});
