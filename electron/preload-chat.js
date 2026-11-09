'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/* 聊天窗口专用桥接：只暴露聊天相关能力，不碰窗口拖动/状态等桌宠接口 */
contextBridge.exposeInMainWorld('chatAPI', {
  send: (text) => ipcRenderer.send('chat:send', text),
  cancel: () => ipcRenderer.send('chat:cancel'),
  setKey: (key) => ipcRenderer.send('chat:set-key', key),
  status: () => ipcRenderer.invoke('chat:status'),
  clear: () => ipcRenderer.send('chat:clear'),
  close: () => ipcRenderer.send('chat:close'),
  setName: (name) => ipcRenderer.send('chat:set-name', name),
  onThinking: (cb) => ipcRenderer.on('chat:thinking', () => cb()),
  onDelta: (cb) => ipcRenderer.on('chat:delta', (_event, text) => cb(text)),
  onDone: (cb) => ipcRenderer.on('chat:done', (_event, data) => cb(data)),
  onError: (cb) => ipcRenderer.on('chat:error', (_event, data) => cb(data)),
  onKeySaved: (cb) => ipcRenderer.on('chat:key-saved', () => cb()),
  onCleared: (cb) => ipcRenderer.on('chat:cleared', () => cb()),
  onSetupKey: (cb) => ipcRenderer.on('chat:setup-key', () => cb()),
  onInit: (cb) => ipcRenderer.on('chat:init', (_event, data) => cb(data)),
  onShown: (cb) => ipcRenderer.on('chat:shown', () => cb()),
  onName: (cb) => ipcRenderer.on('chat:name', (_event, data) => cb(data)),
  onNameError: (cb) => ipcRenderer.on('chat:name-error', (_event, data) => cb(data)),
  onSetupName: (cb) => ipcRenderer.on('chat:setup-name', () => cb())
});
