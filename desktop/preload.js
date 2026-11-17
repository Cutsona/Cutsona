// What the Cutsona page may ask the desktop app for: the system's folder picker, where a file you picked is, and (in the installed app)
// checking for and installing updates. Nothing else from the computer is reachable from the page.
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const info = ipcRenderer.sendSync('app:info');
const bridge = {
  version: info.version,
  platform: info.platform,
  pickFolder: (start) => ipcRenderer.invoke('dialog:folder', start || ''),
  // where a video you picked or dropped is on this computer, so Cutsona's engine can watch it without a copy
  pathOf: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  frameless: !!info.frameless,
  setTitleBar: (color, symbol) => ipcRenderer.send('ui:titlebar', { color, symbol }),
};
if (info.packaged) {
  bridge.checkUpdate = () => ipcRenderer.invoke('update:check');
  bridge.installUpdate = () => ipcRenderer.invoke('update:install');
  bridge.onUpdate = (fn) => { ipcRenderer.removeAllListeners('update:state'); ipcRenderer.on('update:state', (_e, s) => fn(s)); };
  // a new build or release, the moment it's out (desktop/main.js watches for it)
  bridge.onLive = (fn) => { ipcRenderer.removeAllListeners('update:live'); ipcRenderer.on('update:live', (_e, j) => fn(j)); };
}
contextBridge.exposeInMainWorld('cutsonaDesktop', bridge);
