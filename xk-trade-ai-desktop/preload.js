'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('xkTrade', Object.freeze({
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: s => ipcRenderer.invoke('settings:save', s),
  clearKey: k => ipcRenderer.invoke('settings:clear', k),
  analyze: s => ipcRenderer.invoke('market:analyze', s),
  openExternal: u => ipcRenderer.invoke('external:open', u)
}));
