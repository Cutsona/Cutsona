// What the Cutsona page may ask the desktop app for: the system's folder picker, and (in the installed app)
// checking for and installing updates. Nothing else from the computer is reachable from the page.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const info = ipcRenderer.sendSync('app:info');
const bridge = {
  version: info.version,
  platform: info.platform,
  pickFolder: (start) => ipcRenderer.invoke('dialog:folder', start || ''),
};
if (info.packaged) {
  bridge.checkUpdate = () => ipcRenderer.invoke('update:check');
  bridge.installUpdate = () => ipcRenderer.invoke('update:install');
  bridge.onUpdate = (fn) => { ipcRenderer.removeAllListeners('update:state'); ipcRenderer.on('update:state', (_e, s) => fn(s)); };
}
contextBridge.exposeInMainWorld('cutsonaDesktop', bridge);
