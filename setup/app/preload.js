const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('petAPI', {
  setIgnore: (ignore) => ipcRenderer.send('set-ignore', ignore),
  hop: (dir) => ipcRenderer.send('hop', dir),
  onPlaced: (cb) => ipcRenderer.on('placed', (e, d) => cb(d)),
  onAgents: (cb) => ipcRenderer.on('agents', (e, list) => cb(list))   // [{id,label,task|null}]
});
