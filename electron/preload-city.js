'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cityAPI', {
  get: () => ipcRenderer.invoke('weather:get'),
  search: (keyword) => ipcRenderer.invoke('weather:search', keyword),
  setCity: (city) => ipcRenderer.send('weather:set-city', city),
  relocate: () => ipcRenderer.send('weather:relocate'),
  refresh: () => ipcRenderer.send('weather:refresh'),
  close: () => ipcRenderer.send('weather:close-city')
});
