// EX Visualizer runs 100% locally. No telemetry, no uploads, no account.
// Safe bridge: only these two export-folder actions are exposed to the app.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('freecutDesktop', {
  isDesktop: true,
  platform: process.platform,
  chooseExportFolder: () => ipcRenderer.invoke('freecut:choose-export-folder'),
  saveExport: (folder, filename, data) =>
    ipcRenderer.invoke('freecut:save-export', folder, filename, data),
  showExportInFolder: (fullPath) =>
    ipcRenderer.invoke('freecut:reveal-export', fullPath),
  convertAndSaveExport: (payload) =>
    ipcRenderer.invoke('freecut:convert-export', payload),
});
