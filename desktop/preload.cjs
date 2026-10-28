'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('relayDesktop', Object.freeze({
  version: () => ipcRenderer.invoke('relay:version'),
  notify: payload => ipcRenderer.invoke('relay:notify', payload),
  getPreferences: () => ipcRenderer.invoke('relay:preferences'),
  setLaunchAtStartup: enabled => ipcRenderer.invoke('relay:startup', enabled),
  checkForUpdates: () => ipcRenderer.invoke('relay:check-update'),
  installUpdate: () => ipcRenderer.invoke('relay:install-update'),
  onDeepLink: callback => {
    if (typeof callback !== 'function') throw new TypeError('Expected a callback.');
    const listener = (_event, path) => { if (typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')) callback(path); };
    ipcRenderer.on('relay:deep-link', listener);
    return () => ipcRenderer.removeListener('relay:deep-link', listener);
  },
  onUpdateStatus: callback => {
    if (typeof callback !== 'function') throw new TypeError('Expected a callback.');
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('relay:update-status', listener);
    return () => ipcRenderer.removeListener('relay:update-status', listener);
  }
}));
