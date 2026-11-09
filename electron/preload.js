'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  load: () => ipcRenderer.invoke('pet:load'),
  save: (state) => ipcRenderer.send('pet:save', state),
  setMouseThrough: (ignore) => ipcRenderer.send('pet:mouse-through', ignore),
  focusWindow: () => ipcRenderer.send('pet:focus'),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  openContextMenu: () => ipcRenderer.send('pet:context-menu'),
  onCommand: (cb) => ipcRenderer.on('pet:command', (_event, cmd) => cb(cmd)),
  onWalking: (cb) => ipcRenderer.on('pet:walking', (_event, value) => cb(value)),
  onDragging: (cb) => ipcRenderer.on('pet:dragging', (_event, value) => cb(value)),
  onScale: (cb) => ipcRenderer.on('pet:scale', (_event, factor) => cb(factor)),
  /* 聊天窗口的联动：表情反应 & 聊天开关状态 */
  onReaction: (cb) => ipcRenderer.on('pet:reaction', (_event, kind) => cb(kind)),
  onChatMode: (cb) => ipcRenderer.on('pet:chat-mode', (_event, on) => cb(on)),
  onName: (cb) => ipcRenderer.on('pet:name', (_event, name) => cb(name)),
  /* 天气联动 */
  getWeather: () => ipcRenderer.invoke('weather:get'),
  refreshWeather: () => ipcRenderer.send('weather:refresh'),
  onWeather: (cb) => ipcRenderer.on('pet:weather', (_event, data) => cb(data)),
  onWeatherChanged: (cb) => ipcRenderer.on('pet:weather-changed', (_event, data) => cb(data)),
  onWeatherError: (cb) => ipcRenderer.on('pet:weather-error', (_event, data) => cb(data)),
  onPreviewForm: (cb) => ipcRenderer.on('pet:form-preview', (_event, data) => cb(data))
});
