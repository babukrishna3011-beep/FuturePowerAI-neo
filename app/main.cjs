const { app, BrowserWindow, session } = require('electron');
const path = require('path');

app.name = 'FuturePowerAIPlus';
app.commandLine.appendSwitch('enable-features', 'WebGPU');
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const ALLOWED_ONLINE_ORIGIN = /^https:\/\/futurepoweraiplus\.pro15\.workers\.dev\//i;
const ALLOWED_MODEL_HOST = /^https:\/\/([^/]+\.)*(huggingface\.co|hf\.co)(\/|$)/i;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#050814',
    autoHideMenuBar: true,
    title: 'FuturePowerAIPlus',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: false
    }
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[RENDERER ${level}] ${message} (${sourceId}:${line})`);
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    // Local app navigation is allowed. Network requests are permitted only to
    // the model/online Worker host and Hugging Face model artifacts. The UI
    // controls when online information is requested.
    if (details.url.startsWith('file://')) return callback({ cancel: false });
    if (ALLOWED_ONLINE_ORIGIN.test(details.url) || ALLOWED_MODEL_HOST.test(details.url)) {
      return callback({ cancel: false });
    }
    return callback({ cancel: true });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
