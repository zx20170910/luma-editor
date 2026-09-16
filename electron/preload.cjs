const { contextBridge, ipcRenderer } = require('electron');
const invoke = (channel, ...args) => ipcRenderer.invoke(`luma:${channel}`, ...args);
const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') throw new TypeError('回调必须是函数。');
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(`luma:${channel}`, listener);
  return () => ipcRenderer.removeListener(`luma:${channel}`, listener);
};
contextBridge.exposeInMainWorld('luma', {
  platform: process.platform,
  openFiles: () => invoke('open-files'),
  openFolder: () => invoke('open-folder'),
  readFile: path => invoke('read-file', path),
  listDirectory: path => invoke('list-directory', path),
  saveFile: request => invoke('save-file', request),
  confirmClose: name => invoke('confirm-close', name),
  loadSession: () => invoke('load-session'),
  saveSession: session => invoke('save-session', session),
  format: request => invoke('format', request),
  formatterStatus: () => invoke('formatter-status'),
  getExternalFormatters: () => invoke('get-external-formatters'),
  setExternalFormatters: value => invoke('set-external-formatters', value),
  readAsset: (path, documentPath) => invoke('read-asset', path, documentPath),
  openExternal: url => invoke('open-external', url),
  revealFile: path => invoke('reveal-file', path),
  windowControl: command => invoke('window-control', command),
  checkForUpdates: () => invoke('check-for-updates'),
  downloadUpdate: (url, fileName) => invoke('download-update', url, fileName),
  setDirty: value => ipcRenderer.send('luma:set-dirty', value),
  respondToClose: () => ipcRenderer.send('luma:respond-to-close'),
  onCommand: callback => subscribe('command', callback),
  onOpenFiles: callback => subscribe('open-files', callback),
  onCloseRequested: callback => subscribe('close-requested', callback),
});
