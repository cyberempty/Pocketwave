'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pocketwave', {
  init: () => ipcRenderer.invoke('app:init'),
  setTitleBarDark: dark => ipcRenderer.send('win:titlebar-dark', !!dark),
  saveUser: d => ipcRenderer.invoke('user:save', d),
  saveUserSync: d => ipcRenderer.sendSync('user:save-sync', d),
  scan: (roots, keep, opts) => ipcRenderer.invoke('library:scan', roots, keep, opts),
  clearLibrary: () => ipcRenderer.invoke('library:clear'),
  onScanProgress: cb => ipcRenderer.on('scan:progress', (_e, p) => cb(p)),
  chooseFolder: title => ipcRenderer.invoke('dialog:folder', title),
  folderAvailable: p => ipcRenderer.invoke('folder:ok', p),
  exists: p => ipcRenderer.invoke('file:exists', p),
  cover: (p, opts) => ipcRenderer.invoke('file:cover', p, opts),
  reveal: p => ipcRenderer.invoke('file:reveal', p),
  relocateData: () => ipcRenderer.invoke('data:relocate'),
  pickImage: () => ipcRenderer.invoke('image:pick'),
  saveImage: (bytes, ext) => ipcRenderer.invoke('image:save', bytes, ext),
  removeImage: n => ipcRenderer.invoke('image:remove', n),
  imageInfo: () => ipcRenderer.invoke('image:info'),
  clearImages: () => ipcRenderer.invoke('image:clear'),
  openImagesFolder: () => ipcRenderer.invoke('image:open'),
  exportM3U: (name, entries) => ipcRenderer.invoke('m3u:export', name, entries),
  importM3U: () => ipcRenderer.invoke('m3u:import'),
  addExtras: tracks => ipcRenderer.invoke('library:addExtras', tracks),
  onMediaKey: cb => ipcRenderer.on('media:key', (_e, k) => cb(k)),
  watchSet: (roots, tags) => ipcRenderer.invoke('watch:set', roots, tags),
  onWatchAdded: cb => ipcRenderer.on('watch:added', (_e, t) => cb(t)),
  onWatchUpdated: cb => ipcRenderer.on('watch:updated', (_e, t) => cb(t)),
  onWatchRenamed: cb => ipcRenderer.on('watch:renamed', (_e, r) => cb(r)),
  onWatchRemoved: cb => ipcRenderer.on('watch:removed', (_e, p) => cb(p)),
  onWatchStatus: cb => ipcRenderer.on('watch:status', (_e, s) => cb(s))
});
