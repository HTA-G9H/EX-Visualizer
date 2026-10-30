// EX Visualizer desktop app — Electron main process
const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: '#0d0d12',
    title: 'EX Visualizer — Truly Free Video Editor',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Exports render in real time — never throttle the renderer when the
      // window is unfocused/minimised, or recordings get frozen/silent gaps
      backgroundThrottling: false,
    },
  });
  win.loadFile('index.html');
}

// Let the user pick a real folder on their PC for exports
ipcMain.handle('freecut:choose-export-folder', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose where to save your exported videos',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled || !result.filePaths.length ? null : result.filePaths[0];
});

// Save an exported video into the folder the user chose.
// Data arrives as base64 (bridge-safe). We only report success after
// verifying the file is really on disk with the exact expected size.
ipcMain.handle('freecut:save-export', async (_event, folder, filename, base64) => {
  if (!folder || typeof folder !== 'string') throw new Error('No export folder chosen');
  if (typeof base64 !== 'string' || !base64.length) throw new Error('No video data received');
  const safeName = path.basename(String(filename || 'ex-visualizer-export.webm'));
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new Error('Video data was empty');
  await fs.promises.mkdir(folder, { recursive: true });
  const fullPath = path.join(folder, safeName);
  await fs.promises.writeFile(fullPath, buffer);
  const stat = await fs.promises.stat(fullPath);
  if (!stat.isFile() || stat.size !== buffer.length) {
    throw new Error(`Save could not be verified (${stat.size}/${buffer.length} bytes)`);
  }
  return { fullPath, size: stat.size };
});

// Convert a rendered WebM master into a real .mp4/.mov/.mkv/.avi with the
// FFmpeg binary bundled in the app, save it to the chosen folder, and verify it.
function ffmpegPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'ffmpeg.exe')
    : path.join(__dirname, 'resources', 'ffmpeg.exe');
}
function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath();
    if (!fs.existsSync(bin)) { reject(new Error('The built-in video converter is missing from this build')); return; }
    const proc = spawn(bin, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', d => { stderr = (stderr + d.toString()).slice(-3000); });
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve(true) : reject(new Error('Conversion failed: ' + stderr.split('\n').filter(Boolean).slice(-2).join(' ') || `ffmpeg exit ${code}`)));
  });
}
ipcMain.handle('freecut:convert-export', async (_event, payload) => {
  const { folder, filename, format, fps, bitrateMbps, base64, masterExt } = payload || {};
  const allowed = ['mp4', 'mov', 'mkv', 'avi', 'webm'];
  if (!allowed.includes(format)) throw new Error('Unsupported export format');
  if (!folder || typeof folder !== 'string') throw new Error('No export folder chosen');
  if (typeof base64 !== 'string' || !base64.length) throw new Error('No video data received');
  const safeName = path.basename(String(filename || `export.${format}`));
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'exvisualizer-'));
  const master = path.join(tmpDir, `master.${masterExt === 'mp4' ? 'mp4' : 'webm'}`);
  const fullPath = path.join(folder, safeName);
  const rate = `${Math.min(45, Math.max(5, Number(bitrateMbps) || 12))}M`;
  const fr = String(Math.min(60, Math.max(12, Number(fps) || 30)));
  try {
    await fs.promises.mkdir(folder, { recursive: true });
    await fs.promises.writeFile(master, Buffer.from(base64, 'base64'));
    const common = ['-y', '-i', master, '-map', '0:v:0', '-map', '0:a?', '-r', fr, '-b:v', rate];
    let args;
    if (format === 'mp4' || format === 'mov') args = [...common, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', fullPath];
    else if (format === 'mkv') args = [...common, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', fullPath];
    else if (format === 'webm') args = [...common, '-c:v', 'libvpx-vp9', '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '192k', fullPath];
    else args = [...common, '-c:v', 'mpeg4', '-c:a', 'libmp3lame', '-b:a', '192k', fullPath]; // avi
    await runFFmpeg(args);
    const stat = await fs.promises.stat(fullPath);
    if (!stat.isFile() || stat.size === 0) throw new Error('Conversion produced an empty file');
    return { fullPath, size: stat.size };
  } finally {
    fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

// Reveal a saved export in Explorer/Finder
ipcMain.handle('freecut:reveal-export', async (_event, fullPath) => {
  if (fullPath && typeof fullPath === 'string' && fs.existsSync(fullPath)) {
    shell.showItemInFolder(fullPath);
    return true;
  }
  return false;
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
