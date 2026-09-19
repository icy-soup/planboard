'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// 只暴露这些能力：不把 ipcRenderer 本身交给页面，也不开 nodeIntegration。
// 存储读写是同步的 —— store.js 的 read()/write() 都是同步调用。
contextBridge.exposeInMainWorld('planboardAPI', {
  storage: {
    read: () => ipcRenderer.sendSync('storage:read'),
    write: (state) => ipcRenderer.sendSync('storage:write', state)
  },
  app: {
    setOpenAtLogin: (on) => ipcRenderer.invoke('app:setOpenAtLogin', on),
    setCloseToTray: (on) => ipcRenderer.invoke('app:setCloseToTray', on)
  },
  secrets: {
    // 完整密钥留在主进程，页面只拿得到「配没配 + 尾号」
    status: () => ipcRenderer.invoke('secrets:status'),
    set: (key) => ipcRenderer.invoke('secrets:set', key),
    clear: () => ipcRenderer.invoke('secrets:clear')
  },
  memory: {
    read: (name) => ipcRenderer.invoke('memory:read', name),
    write: (name, text) => ipcRenderer.invoke('memory:write', name, text),
    list: () => ipcRenderer.invoke('memory:list')
  },
  ai: {
    chat: (messages, opts) => ipcRenderer.invoke('ai:chat', messages, opts)
  }
});
