// Enable Node.js 22+ built-in V8 compile cache for accelerated startup
try {
  const { enableCompileCache } = require('node:module');
  if (typeof enableCompileCache === 'function') {
    enableCompileCache();
  }
} catch {}

const { app, BrowserWindow, ipcMain, dialog, session, Menu, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, execSync } = require('child_process');

// Enforce single application instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[ELECTRON] Another instance of the application is already running. Focusing existing instance.');
  app.quit();
  process.exit(0);
}

const RuntimeConfig = require('./runtime-config.cjs');
const {
  printThermalLabelsOnWindows,
  printThermalReceiptOnWindows,
  warmThermalSpooler,
  shutdownThermalSpooler,
} = require('./thermal-label-printer.cjs');
let sharedChromiumPrintWin = null;
let chromiumPrintQueue = Promise.resolve();
let runtimeConfigInstance = null;
let currentConfig = null;

function getAppDisplayVersion() {
  try {
    const portableRoot = path.dirname(process.execPath);
    const versionFile = path.join(portableRoot, 'runtime', 'run', '.app_version');
    if (fs.existsSync(versionFile)) {
      const v = fs.readFileSync(versionFile, 'ascii').trim();
      if (v) return v;
    }
  } catch { /* ignore */ }

  try {
    const unpackedBackendPkg = path.join(
      __dirname.includes('app.asar') ? __dirname.replace('app.asar', 'app.asar.unpacked') : __dirname,
      'backend/package.json'
    );
    if (fs.existsSync(unpackedBackendPkg)) {
      const pkg = JSON.parse(fs.readFileSync(unpackedBackendPkg, 'utf8'));
      if (pkg.version) return pkg.version;
    }
  } catch { /* ignore */ }

  try {
    return require('../package.json').version;
  } catch {
    return app.getVersion() || '1.0.0';
  }
}

const packageVersion = getAppDisplayVersion();

function getLogsDir() {
  const dataDir = app.isPackaged
    ? path.join(path.dirname(process.execPath), 'runtime', 'data')
    : path.join(process.cwd(), 'portable_data');
  return path.resolve(dataDir, '../logs');
}

function logRenderer(msg) {
  try {
    const logsDir = getLogsDir();
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    fs.appendFileSync(path.join(logsDir, 'renderer.log'), `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
  } catch {}
}

function cleanupDesktopLogs() {
  try {
    const logsDir = getLogsDir();
    if (!fs.existsSync(logsDir)) return;
    const files = fs.readdirSync(logsDir);
    const now = Date.now();
    // Retention: Minimum 90 days (3 months), or if file was marked as uploaded/synced to server
    const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
    for (const file of files) {
      const isLog = file.endsWith('.log') || file.endsWith('.log.gz');
      const isSyncedOrUploaded = file.includes('.synced') || file.includes('.uploaded');
      if (isLog || isSyncedOrUploaded) {
        const filePath = path.join(logsDir, file);
        // Rotate active logs if larger than 25MB
        if (file === 'backend.log' || file === 'renderer.log') {
          try {
            const stats = fs.statSync(filePath);
            if (stats.size > 25 * 1024 * 1024) {
              const rotatedName = `${file.replace('.log', '')}-${new Date().toISOString().slice(0, 10)}.log`;
              fs.renameSync(filePath, path.join(logsDir, rotatedName));
            }
          } catch {}
          continue;
        }

        const stats = fs.statSync(filePath);
        if (isSyncedOrUploaded || (now - stats.mtimeMs > RETENTION_MS)) {
          try {
            fs.unlinkSync(filePath);
          } catch {}
        }
      }
    }
  } catch (err) {
    console.error('[ELECTRON] Failed to clean up desktop logs:', err);
  }
}

function getLoadingHtmlPath() {
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    return path.join(__dirname, 'loading.html');
  }

  // 1. Check unpacked dist/loading.html (updated via OTA patches)
  const unpackedDistLoading = path.join(
    __dirname.includes('app.asar') ? __dirname.replace('app.asar', 'app.asar.unpacked') : __dirname,
    '../dist/loading.html'
  );
  if (fs.existsSync(unpackedDistLoading)) {
    return unpackedDistLoading;
  }

  // 2. Check unpacked electron/loading.html
  const unpackedElectronLoading = path.join(
    __dirname.includes('app.asar') ? __dirname.replace('app.asar', 'app.asar.unpacked') : __dirname,
    'loading.html'
  );
  if (fs.existsSync(unpackedElectronLoading)) {
    return unpackedElectronLoading;
  }

  // 3. Check resources/loading.html
  try {
    const portableRoot = path.dirname(process.execPath);
    const resourcesLoading = path.join(portableRoot, 'resources', 'loading.html');
    if (fs.existsSync(resourcesLoading)) {
      return resourcesLoading;
    }
  } catch { /* ignore */ }

  // 4. Fallback to asar
  return path.join(__dirname, 'loading.html');
}

let loadingWindow = null;
let mainWindow = null;

const getDisplayDimensions = () => {
  try {
    const primaryDisplay = screen && screen.getPrimaryDisplay ? screen.getPrimaryDisplay() : null;
    if (primaryDisplay && primaryDisplay.workAreaSize) {
      return {
        width: Math.max(1024, primaryDisplay.workAreaSize.width),
        height: Math.max(700, primaryDisplay.workAreaSize.height)
      };
    }
  } catch {}
  return { width: 1280, height: 800 };
};

const createLoadingWindow = () => {
  const { width, height } = getDisplayDimensions();

  loadingWindow = new BrowserWindow({
    width,
    height,
    backgroundColor: '#f8fafc',
    icon: path.join(__dirname, '../public/logo_cropped.png'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    show: false
  });

  loadingWindow.setMenuBarVisibility(false);
  loadingWindow.maximize();
  loadingWindow.show();
  loadingWindow.loadFile(getLoadingHtmlPath(), { query: { v: packageVersion } });
};

let isBackendReady = false;
let isMainWindowRendered = false;
let hasRevealedApp = false;
let isForceClosing = false;

function toggleFullScreen(win = mainWindow) {
  if (!win || win.isDestroyed()) return false;
  const isFS = win.isFullScreen();
  if (isFS) {
    win.setFullScreen(false);
    win.maximize();
    if (!win.isDestroyed()) {
      win.webContents.send('fullscreen-changed', false);
    }
    return false;
  } else {
    win.maximize();
    win.setFullScreen(true);
    if (!win.isDestroyed()) {
      win.webContents.send('fullscreen-changed', true);
    }
    return true;
  }
}

const tryRevealApp = () => {
  if (hasRevealedApp) return;
  if (!isBackendReady || !isMainWindowRendered) return;
  hasRevealedApp = true;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.maximize();
    setImmediate(() => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setFullScreen(true);
        }
      } catch {}
    });
  }

  if (loadingWindow && !loadingWindow.isDestroyed()) {
    setTimeout(() => {
      try {
        if (loadingWindow && !loadingWindow.isDestroyed()) {
          loadingWindow.destroy();
          loadingWindow = null;
        }
      } catch {}
    }, 80);
  }
};

function loadAppIntoWindow(win = mainWindow) {
  if (!win || win.isDestroyed()) return;
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    const unpackedDist = path.join(
      __dirname.includes('app.asar') ? __dirname.replace('app.asar', 'app.asar.unpacked') : __dirname,
      '../dist/index.html'
    );
    win.loadFile(unpackedDist);
  }
}

const createMainWindow = (customLoadHandler, autoLoad = true) => {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  Menu.setApplicationMenu(null);

  const { width, height } = getDisplayDimensions();

  mainWindow = new BrowserWindow({
    width,
    height,
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, '../public/logo_cropped.png'),
    autoHideMenuBar: true,
    fullscreenable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      additionalArguments: [`--electron-runtime-config=${JSON.stringify(currentConfig)}`]
    },
    show: false
  });

  mainWindow.setMenuBarVisibility(false);

  // Never give untrusted windows our privileged preload bridge.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank') {
      return { action: 'allow', overrideBrowserWindowOptions: {
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
      } };
    }
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch((error) => console.error('Cannot open external URL:', error));
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isDevNavigation = process.env.NODE_ENV === 'development' && /^http:\/\/localhost:5173(?:\/|$)/.test(url);
    const isAppNavigation = url.startsWith('file://') && url.split('#')[0] === mainWindow.webContents.getURL().split('#')[0];
    if (!isDevNavigation && !isAppNavigation) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url).catch((error) => console.error('Cannot open external URL:', error));
      }
    }
  });

  mainWindow.webContents.on('will-prevent-unload', (event) => {
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('show-custom-close-dialog');
    }
  });

  let closeAttemptCount = 0;
  let closeAttemptTimer = null;

  mainWindow.on('close', (event) => {
    if (isForceClosing) {
      return;
    }
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('show-custom-close-dialog');

      closeAttemptCount++;
      if (closeAttemptTimer) clearTimeout(closeAttemptTimer);
      closeAttemptTimer = setTimeout(() => {
        closeAttemptCount = 0;
      }, 2500);

      // Infallible fallback: If clicked twice or renderer is unresponsive, offer native exit
      if (closeAttemptCount >= 2) {
        closeAttemptCount = 0;
        const choice = dialog.showMessageBoxSync(mainWindow, {
          type: 'question',
          buttons: ['إغلاق البرنامج ومغادرة', 'البقاء في البرنامج'],
          defaultId: 0,
          cancelId: 1,
          title: 'تأكيد إغلاق المنظومة',
          message: 'هل أنت متأكد من رغبتك في إغلاق تطبيق Z-ERP الآن؟',
        });
        if (choice === 0) {
          isForceClosing = true;
          app.quit();
        }
      }
    }
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11' && input.type === 'keyDown') {
      toggleFullScreen(mainWindow);
      event.preventDefault();
    }
  });

  mainWindow.on('enter-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('fullscreen-changed', true);
    }
  });

  mainWindow.on('leave-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.maximize();
      mainWindow.webContents.send('fullscreen-changed', false);
    }
  });

  mainWindow.once('ready-to-show', () => {
    isMainWindowRendered = true;
    tryRevealApp();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    isMainWindowRendered = true;
    tryRevealApp();
    if (isBackendReady && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend-ready');
    }
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    logRenderer(`[FAIL-LOAD] code=${errorCode} (${errorDescription}) URL=${validatedURL}`);
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    logRenderer(`[PROCESS GONE] reason=${details.reason}, exitCode=${details.exitCode}`);
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level >= 2) {
      logRenderer(`[CONSOLE-${level === 3 ? 'ERROR' : 'WARN'}] (${sourceId || 'inline'}:${line}) ${message}`);
    }
  });

  if (autoLoad) {
    if (customLoadHandler) {
      customLoadHandler(mainWindow);
    } else {
      loadAppIntoWindow(mainWindow);
    }
  }

  return mainWindow;
};

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else if (loadingWindow && !loadingWindow.isDestroyed()) {
    if (loadingWindow.isMinimized()) loadingWindow.restore();
    loadingWindow.focus();
  }
});


app.whenReady().then(async () => {
  runtimeConfigInstance = new RuntimeConfig(app.getPath('userData'));
  currentConfig = runtimeConfigInstance.getConfig();
  cleanupDesktopLogs();

  // Ensure port 3001 isn't locked by an orphan process from a previous crash/abrupt close
  if (currentConfig.runtimeMode !== 'lan_client') {
    const targetPort = currentConfig.port || 3001;

    const net = require('net');
    const findFreePort = (port) => {
      return new Promise((resolve) => {
        const server = net.createServer();
        server.listen(port, '127.0.0.1', () => {
          server.once('close', () => resolve(port));
          server.close();
        });
        server.on('error', () => {
          resolve(findFreePort(port + 1));
        });
      });
    };
    const freePort = await findFreePort(targetPort);
    if (freePort !== targetPort) {
      if (currentConfig.runtimeMode === 'lan_server') {
        dialog.showErrorBox('منفذ الشبكة المحلية مشغول',
          `المنفذ ${targetPort} مستخدم بالفعل. أغلق الخدمة التي تستخدمه أو غيّر إعداد الشبكة قبل التشغيل.`);
        app.quit();
        return;
      }
      console.log(`[ELECTRON] Port ${targetPort} is busy. Using ${freePort} for standalone backend.`);
      currentConfig.port = freePort;
    }
  }

  // Log App Version details for Update Checker & Debugging
  const runtimeVersion = getAppDisplayVersion();
  console.log('----------------------------------------');
  console.log(`[ELECTRON] Application started`);
  console.log(`[ELECTRON] app.getVersion(): ${app.getVersion()}`);
  console.log(`[ELECTRON] runtime version: ${runtimeVersion}`);
  console.log(`[ELECTRON] process.env.APP_MODE: ${process.env.APP_MODE || 'SELF_CONTAINED'}`);
  console.log('----------------------------------------');

  // Only clear Chromium HTTP Cache on explicit flag/update to preserve V8 code cache across routine boots
  const shouldClearCache = process.argv.includes('--clear-cache') || process.env.ELECTRON_FORCE_CLEAR_CACHE === 'true';
  if (shouldClearCache) {
    try {
      await session.defaultSession.clearCache();
      console.log('[ELECTRON] Cleared Chromium HTTP Cache on explicit request.');
    } catch (err) {
      console.error('[ELECTRON] Failed to clear cache:', err);
    }
  }

  // ─── Multi-Layer Persistent License & Instant Hardware ID ───────────────────
  let inMemoryCachedHwId = null;
  let inMemoryCachedLicense = null;

  const cleanHwStr = (s) => (s || '').replace(/[^A-Za-z0-9_-]/g, '').trim().toUpperCase();

  const isInvalidHwVal = (val) => {
    if (!val) return true;
    const lower = val.toLowerCase().trim();
    return lower === '' || 
           lower.includes('default string') || 
           lower.includes('to be filled by o.e.m') || 
           lower.includes('ffffffff') || 
           lower === 'none' ||
           lower === '00000000' ||
           lower === '0000000000000000';
  };

  const getProgramDataLicensePath = () => {
    const base = process.env.PROGRAMDATA || (process.env.APPDATA ? path.dirname(process.env.APPDATA) : null) || app.getPath('userData');
    const dir = path.join(base, 'ZSystemsLicense');
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch {}
    return path.join(dir, 'license.json');
  };

  const getUserDataLicensePath = () => path.join(app.getPath('userData'), 'license.json');

  const readRegistryLicense = () => {
    if (process.platform !== 'win32') return null;
    try {
      const out = execSync('reg query "HKCU\\Software\\ZSystems\\ERP"', { encoding: 'utf8', timeout: 1200 });
      const keyMatch = out.match(/LicenseKey\s+REG_SZ\s+(\S+)/i);
      const hwMatch = out.match(/HardwareId\s+REG_SZ\s+(\S+)/i);
      const actMatch = out.match(/ActivatedAt\s+REG_SZ\s+([^\r\n]+)/i);
      if (keyMatch && keyMatch[1]) {
        return {
          licenseKey: keyMatch[1].trim(),
          hardwareId: hwMatch && hwMatch[1] ? hwMatch[1].trim() : '',
          activatedAt: actMatch && actMatch[1] ? actMatch[1].trim() : new Date().toISOString(),
        };
      }
    } catch {}
    return null;
  };

  const writeRegistryLicense = (licenseKey, hardwareId) => {
    if (process.platform !== 'win32') return;
    try {
      if (licenseKey) {
        execSync(`reg add "HKCU\\Software\\ZSystems\\ERP" /v LicenseKey /t REG_SZ /d "${licenseKey.trim()}" /f`, { timeout: 1500 });
      }
      if (hardwareId) {
        execSync(`reg add "HKCU\\Software\\ZSystems\\ERP" /v HardwareId /t REG_SZ /d "${hardwareId.trim()}" /f`, { timeout: 1500 });
      }
      execSync(`reg add "HKCU\\Software\\ZSystems\\ERP" /v ActivatedAt /t REG_SZ /d "${new Date().toISOString()}" /f`, { timeout: 1500 });
    } catch (e) {
      console.warn('[ELECTRON] Failed to write to Registry:', e);
    }
  };

  const readLicenseFile = () => {
    if (inMemoryCachedLicense && inMemoryCachedLicense.licenseKey) {
      return inMemoryCachedLicense;
    }

    // 1. Check Windows Registry (Primary Immune Layer)
    const regData = readRegistryLicense();
    if (regData && regData.licenseKey) {
      inMemoryCachedLicense = regData;
      return regData;
    }

    // 2. Check ProgramData global file
    try {
      const progPath = getProgramDataLicensePath();
      if (fs.existsSync(progPath)) {
        const raw = fs.readFileSync(progPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.licenseKey) {
          inMemoryCachedLicense = parsed;
          return parsed;
        }
      }
    } catch {}

    // 3. Check AppData / userData local file
    try {
      const userPath = getUserDataLicensePath();
      if (fs.existsSync(userPath)) {
        const raw = fs.readFileSync(userPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.licenseKey) {
          inMemoryCachedLicense = parsed;
          return parsed;
        }
      }
    } catch {}

    return null;
  };

  const writeLicenseFile = (data) => {
    try {
      const existing = readLicenseFile() || {};
      const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
      inMemoryCachedLicense = updated;

      // 1. Save to Registry
      if (updated.licenseKey || updated.hardwareId) {
        writeRegistryLicense(updated.licenseKey, updated.hardwareId);
      }

      // 2. Save to ProgramData
      try {
        const progPath = getProgramDataLicensePath();
        fs.writeFileSync(progPath, JSON.stringify(updated, null, 2), 'utf8');
      } catch {}

      // 3. Save to UserData
      try {
        const userPath = getUserDataLicensePath();
        fs.writeFileSync(userPath, JSON.stringify(updated, null, 2), 'utf8');
      } catch {}

      return true;
    } catch (e) {
      console.error('[ELECTRON] Failed to write license files:', e);
      return false;
    }
  };

  const computeHardwareId = () => {
    if (inMemoryCachedHwId && inMemoryCachedHwId.length > 3) {
      return inMemoryCachedHwId;
    }

    // 1. Check if already in Registry or cached file
    const cached = readLicenseFile();
    if (cached && cached.hardwareId && typeof cached.hardwareId === 'string' && cached.hardwareId.trim().length > 3) {
      inMemoryCachedHwId = cached.hardwareId.trim();
      return inMemoryCachedHwId;
    }

    // 2. Primary on Windows: Synchronous Fast MachineGuid query (< 10ms)
    let generatedHwId = '';
    if (process.platform === 'win32') {
      try {
        const regOutput = execSync('reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid', { encoding: 'utf8', timeout: 1200 });
        const match = regOutput.match(/MachineGuid\s+REG_SZ\s+(\S+)/i);
        if (match && match[1] && !isInvalidHwVal(match[1])) {
          generatedHwId = `WIN-${cleanHwStr(match[1])}`;
        }
      } catch {}

      if (!generatedHwId) {
        try {
          const ps = `(Get-CimInstance Win32_ComputerSystemProduct -ErrorAction SilentlyContinue).UUID`;
          const uuidOut = execSync(`powershell.exe -NoProfile -NonInteractive -Command "${ps}"`, { encoding: 'utf8', timeout: 2500 }).trim();
          if (uuidOut && !isInvalidHwVal(uuidOut) && uuidOut !== '03000200040005000006000700080009') {
            generatedHwId = `UUID-${cleanHwStr(uuidOut)}`;
          }
        } catch {}
      }
    }

    // 3. Fallback OS Hostname & Username
    if (!generatedHwId) {
      try {
        const os = require('os');
        generatedHwId = `HOST-${cleanHwStr(os.hostname())}-${cleanHwStr(os.userInfo() ? os.userInfo().username : 'USER')}`;
      } catch {
        generatedHwId = 'WIN-SYSTEM-DEVICE-01';
      }
    }

    inMemoryCachedHwId = generatedHwId;
    writeLicenseFile({ hardwareId: generatedHwId });
    return generatedHwId;
  };

  // Register all critical IPC handlers IMMEDIATELY before creating any browser window
  ipcMain.handle('get-hardware-id', () => {
    return computeHardwareId();
  });

  ipcMain.handle('get-saved-license', () => {
    return readLicenseFile();
  });

  ipcMain.handle('save-license-key', (event, key) => {
    const trimmedKey = (key || '').trim();
    const id = computeHardwareId();
    writeLicenseFile({ hardwareId: id, licenseKey: trimmedKey, activatedAt: new Date().toISOString() });
    return { ok: true };
  });

  ipcMain.handle('get-runtime-config', () => currentConfig);

  ipcMain.handle('open-new-window', (event, routePath) => {
    try {
      const { width, height } = getDisplayDimensions();
      const subWin = new BrowserWindow({
        width: Math.min(width, 1366),
        height: Math.min(height, 820),
        backgroundColor: '#ffffff',
        icon: path.join(__dirname, '../public/logo_cropped.png'),
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          nodeIntegration: false,
          contextIsolation: true,
          additionalArguments: [`--electron-runtime-config=${JSON.stringify(currentConfig)}`]
        }
      });
      subWin.setMenuBarVisibility(false);
      const cleanHash = routePath ? (routePath.startsWith('#') ? routePath : `#${routePath.replace(/^\//, '')}`) : '#/';
      if (app.isPackaged) {
        subWin.loadFile(path.join(__dirname, '../dist/index.html'), { hash: cleanHash.replace(/^#/, '') });
      } else {
        subWin.loadURL(`http://127.0.0.1:5173/${cleanHash}`);
      }
      return { ok: true };
    } catch (err) {
      console.error('[ELECTRON] Failed to open new window:', err);
      return { ok: false, error: err.message };
    }
  });

  // Show loading window with progress immediately
  createLoadingWindow();

  // Create main window structure silently in advance so Chromium initializes
  createMainWindow(null, false);

  // Start the bundled Postgres Server
  const PostgresManager = require('./postgres-manager.cjs');
  const pgManager = new PostgresManager(app.getAppPath(), app.isPackaged);
  
  if (currentConfig.runtimeMode !== 'lan_client' && currentConfig.runtimeMode !== 'invalid') {
    try {
      await pgManager.setupAndStart();
    } catch (err) {
      console.error('Failed to start Postgres runtime:', err);
      dialog.showErrorBox('قاعدة البيانات المحلية لم تبدأ',
        'تعذر تشغيل قاعدة البيانات. لن يتم فتح البرنامج حتى لا يتم تسجيل بيانات بشكل خاطئ.\\n' + String(err.message || err));
      app.quit();
      return;
    }
  }

  // Start the bundled NestJS backend in offline mode
  const { fork } = require('child_process');
  const backendPath = path.join(
    __dirname.includes('app.asar') ? __dirname.replace('app.asar', 'app.asar.unpacked') : __dirname,
    'backend',
    'dist',
    'main.js'
  );
  
  // Load or generate session secrets securely
  const fsLib = require('fs');
  const cryptoLib = require('crypto');
  const dataDir = app.isPackaged ? path.join(path.dirname(process.execPath), 'runtime', 'data') : path.join(process.cwd(), 'portable_data');
  const secretsPath = path.join(dataDir, 'secrets.json');
  let sessionSecret, csrfSecret, developerMasterPassword;
  try {
    if (fsLib.existsSync(secretsPath)) {
      const secretsData = JSON.parse(fsLib.readFileSync(secretsPath, 'utf8'));
      sessionSecret = secretsData.sessionSecret;
      csrfSecret = secretsData.csrfSecret;
      developerMasterPassword = secretsData.developerMasterPassword;
    }
  } catch (err) {
    console.error('Error reading secrets.json', err);
  }
  // The developer panel unlocks every paid module, and in lan_server mode the backend
  // listens on 0.0.0.0 — so this must be per-installation, never a constant shipped in
  // the build. It joins the existing secrets file rather than getting its own mechanism.
  if (!sessionSecret || !csrfSecret || !developerMasterPassword) {
    sessionSecret = sessionSecret || cryptoLib.randomBytes(32).toString('hex');
    csrfSecret = csrfSecret || cryptoLib.randomBytes(32).toString('hex');
    developerMasterPassword = developerMasterPassword || 'infoadmin';
    try {
      if (!fsLib.existsSync(dataDir)) {
        fsLib.mkdirSync(dataDir, { recursive: true });
      }
      fsLib.writeFileSync(
        secretsPath,
        JSON.stringify({ sessionSecret, csrfSecret, developerMasterPassword }),
        { mode: 0o600 }
      );
    } catch (err) {
      console.error('Error writing secrets.json', err);
    }
  }

  // Always run migrations on startup to handle manual data folder replacements
  // Ensure compile cache directory exists for fast V8 bytecode caching
  const compileCacheDir = path.join(dataDir, '.compile_cache');
  try {
    if (!fsLib.existsSync(compileCacheDir)) {
      fsLib.mkdirSync(compileCacheDir, { recursive: true });
    }
  } catch {}

  // Provide environment variables for the backend
  const backendEnv = {
    ...process.env,
    ...pgManager.getEnvironmentVariables(),
    Z_DATA_DIR: dataDir,
    PORTABLE_MODE: 'false',
    IS_ELECTRON: 'true',
    TENANT_ID: 'default',
    ACCOUNT_ID: 'default',
    APP_PORT: String(currentConfig.port || 3001),
    APP_HOST: currentConfig.runtimeMode === 'lan_server' ? '0.0.0.0' : '127.0.0.1',
    APP_MODE: 'SELF_CONTAINED',
    NODE_ENV: 'production',
    NODE_COMPILE_CACHE: compileCacheDir,
    SESSION_SECRET: sessionSecret,
    SESSION_CSRF_SECRET: csrfSecret,
    CORS_ORIGINS: `http://localhost:${currentConfig.port || 3001},http://127.0.0.1:${currentConfig.port || 3001},file://`,
    ALLOW_SESSION_ID_HEADER: 'true',
    ELECTRON_EXE_PATH: process.execPath,
    ELECTRON_MAIN_PID: String(process.pid),
    SKIP_MIGRATIONS: 'false',
    ELECTRON_RUNTIME_MODE: currentConfig.runtimeMode,
    DEVELOPER_MASTER_PASSWORD: developerMasterPassword,
  };

  let backendProcess = null;
  let backendSignaledReady = false;
  let backendStartupFailed = false;
  let isQuitting = false;

  const backendLogPath = path.join(dataDir, '../logs', 'backend.log');
  let backendLogStream = null;
  try {
    if (!fsLib.existsSync(path.dirname(backendLogPath))) {
      fsLib.mkdirSync(path.dirname(backendLogPath), { recursive: true });
    }
    backendLogStream = fsLib.createWriteStream(backendLogPath, { flags: 'a' });
    backendLogStream.write(`\n\n--- Backend Starting at ${new Date().toISOString()} ---\n`);
  } catch (err) {
    console.error('Could not create backend log stream', err);
  }

  let lastBackendError = '';

  if (currentConfig.runtimeMode !== 'lan_client' && currentConfig.runtimeMode !== 'invalid') {
    backendProcess = fork(backendPath, [], {
      env: backendEnv,
      stdio: 'pipe'
    });

    if (backendProcess.stdout) {
      backendProcess.stdout.on('data', (data) => {
        const text = data.toString();
        process.stdout.write(text);
        if (backendLogStream) backendLogStream.write(text);
      });
    }

    if (backendProcess.stderr) {
      backendProcess.stderr.on('data', (data) => {
        const text = data.toString();
        process.stderr.write(text);
        if (backendLogStream) backendLogStream.write(text);
        // keep last 500 chars for error dialog
        lastBackendError = (lastBackendError + text).slice(-500); 
      });
    }

    backendProcess.on('error', (err) => {
      backendStartupFailed = true;
      console.error('Backend process error:', err);
    });

    backendProcess.on('message', (msg) => {
      if (msg === 'ready') {
        console.log('[ELECTRON] Backend signaled ready via IPC.');
        backendSignaledReady = true;
      }
    });

    // When the backend exits cleanly (code 0, no signal), it means it triggered
    // a self-update. Close Electron so ApplyAndRestart.ps1 can replace the files
    // and relaunch the EXE.
    backendProcess.on('exit', (code, signal) => {
      if (code === 0 && !signal && !isQuitting) {
        console.log('[ELECTRON] Backend exited cleanly — closing Electron for update restart...');
        // The main-window close handler normally shows a confirmation dialog.
        // An update is a controlled shutdown: bypass that dialog and let the
        // before-quit handler actually stop bundled PostgreSQL.
        isForceClosing = true;
        app.quit();
      } else if (code !== 0 && !isQuitting) {
        backendStartupFailed = true;
        console.error(`[ELECTRON] Backend crashed with code ${code} and signal ${signal}`);
        if (backendLogStream) {
          backendLogStream.write(`\n--- Backend crashed with code ${code} ---\n`);
        }
        dialog.showErrorBox(
          'فشل تشغيل السيرفر الداخلي',
          'حدث خطأ أدى إلى توقف السيرفر المحلي، وبالتالي لا يمكن تسجيل فواتير حتى يعود للعمل.\n\n' +
          'السبب المحتمل:\n' +
          lastBackendError.trim() + '\n\n' +
          'للمزيد من التفاصيل، راجع ملف backend.log الموجود في مجلد logs.'
        );
      }
    });
  }

  // Ensure backend shuts down cleanly when Electron closes
  const cleanShutdown = () => {
    if (isQuitting) return;
    isQuitting = true;
    try { shutdownThermalSpooler(); } catch {}
    try {
      if (sharedChromiumPrintWin && !sharedChromiumPrintWin.isDestroyed()) {
        sharedChromiumPrintWin.destroy();
      }
      sharedChromiumPrintWin = null;
    } catch {}
    if (backendProcess && backendProcess.pid && !backendProcess.killed) {
      try { backendProcess.kill(); } catch (err) {
        console.error('[ELECTRON] Backend graceful shutdown failed:', err);
      }
    }
    if (currentConfig.runtimeMode !== 'lan_client' && currentConfig.runtimeMode !== 'invalid') {
      try {
        pgManager.stopServer();
      } catch (err) {
        console.error('Failed to stop postgres on quit', err);
      }
    }
  };

  app.on('before-quit', cleanShutdown);
  app.on('will-quit', cleanShutdown);

  // Handle IPC for LAN Modes
  ipcMain.on('force-close-app', async () => {
    isForceClosing = true;
    try {
      await cleanShutdown();
    } catch {}
    app.exit(0);
  });

  // Handle IPC for Fullscreen
  ipcMain.handle('toggle-fullscreen', () => {
    return toggleFullScreen(mainWindow);
  });
  ipcMain.handle('get-fullscreen-state', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      return mainWindow.isFullScreen();
    }
    return false;
  });
  ipcMain.handle('set-fullscreen', (event, flag) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (flag) {
        mainWindow.maximize();
        mainWindow.setFullScreen(true);
      } else {
        mainWindow.setFullScreen(false);
        mainWindow.maximize();
      }
      return mainWindow.isFullScreen();
    }
    return false;
  });

  // Handle IPC for Silent Printing
  ipcMain.handle('get-printers', async () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const printers = await mainWindow.webContents.getPrintersAsync();
        return printers.map(p => ({ name: p.name, displayName: p.displayName, isDefault: p.isDefault }));
      }
      return [];
    } catch (err) {
      console.error('Failed to get printers', err);
      return [];
    }
  });

  ipcMain.handle('print-html-silent', async (_event, options = {}) => {
    const { html, deviceName, pageSize, receiptWidthMm, pageSizeMm, orientation } = options || {};
    if (typeof html !== 'string' || !html.trim() || html.length > 4 * 1024 * 1024) {
      return { ok: false, error: 'Invalid print document' };
    }
    const customWidthMm = Number(pageSizeMm && pageSizeMm.widthMm);
    const customHeightMm = Number(pageSizeMm && pageSizeMm.heightMm);
    const hasCustomLabelSize =
      Number.isFinite(customWidthMm) && customWidthMm > 0 && Number.isFinite(customHeightMm) && customHeightMm > 0;
    if (process.platform === 'win32' && hasCustomLabelSize) {
      const thermalRes = await printThermalLabelsOnWindows({
        BrowserWindow,
        html,
        deviceName,
        widthMm: customWidthMm,
        heightMm: customHeightMm,
      });
      if (thermalRes && thermalRes.ok) {
        return thermalRes;
      }
      console.warn('[ELECTRON] Windows thermal label spooler failed, falling back to Chromium print:', thermalRes && thermalRes.error);
    }
    if (process.platform === 'win32' && pageSize === 'receipt' && !hasCustomLabelSize) {
      const receiptRes = await printThermalReceiptOnWindows({
        BrowserWindow,
        html,
        deviceName,
        receiptWidthMm: receiptWidthMm === 58 ? 58 : 80,
      });
      if (receiptRes && receiptRes.ok) {
        return receiptRes;
      }
      console.warn('[ELECTRON] Windows thermal receipt spooler failed, falling back to Chromium print:', receiptRes && receiptRes.error);
    }
    const resolvedPageSize =
      hasCustomLabelSize
        ? { width: Math.round(customWidthMm * 1000), height: Math.round(customHeightMm * 1000) }
        : pageSize === 'receipt'
          ? { width: receiptWidthMm === 58 ? 58000 : 80000, height: 297000 }
          : (pageSize === 'A4' ? 'A4' : undefined);
    const runChromiumSilentPrint = () => new Promise((resolve) => {
      let completed = false;
      const cleanupListeners = (win) => {
        if (!win || win.isDestroyed()) return;
        win.webContents.removeListener('did-fail-load', onFail);
        win.webContents.removeListener('did-finish-load', onFinish);
      };
      const finish = (result) => {
        if (completed) return;
        completed = true;
        clearTimeout(watchdog);
        cleanupListeners(sharedChromiumPrintWin);
        resolve(result);
      };
      const watchdog = setTimeout(() => {
        try {
          if (sharedChromiumPrintWin && !sharedChromiumPrintWin.isDestroyed()) {
            sharedChromiumPrintWin.destroy();
          }
          sharedChromiumPrintWin = null;
        } catch {}
        finish({ ok: false, error: 'Printing timed out' });
      }, 30000);
      const onFail = (_e, code, reason) =>
        finish({ ok: false, error: `Print document failed to load (${code}): ${reason}` });
      const onFinish = () => {
        setTimeout(() => {
          if (completed || !sharedChromiumPrintWin || sharedChromiumPrintWin.isDestroyed()) return;
          try {
            sharedChromiumPrintWin.webContents.print({
              silent: true,
              printBackground: true,
              deviceName: typeof deviceName === 'string' ? deviceName : undefined,
              margins: { marginType: 'none' },
              ...(orientation === 'landscape' ? { landscape: true } : {}),
              pageSize: resolvedPageSize
            }, (success, reason) => finish(success ? { ok: true } : { ok: false, error: reason || 'Print failed' }));
          } catch (error) {
            finish({ ok: false, error: String(error.message || error) });
          }
        }, 20);
      };
      try {
        if (!sharedChromiumPrintWin || sharedChromiumPrintWin.isDestroyed()) {
          sharedChromiumPrintWin = new BrowserWindow({
            show: false,
            webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
          });
        }
        sharedChromiumPrintWin.webContents.once('did-fail-load', onFail);
        sharedChromiumPrintWin.webContents.once('did-finish-load', onFinish);
        sharedChromiumPrintWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
          .catch((error) => finish({ ok: false, error: String(error.message || error) }));
      } catch (error) {
        finish({ ok: false, error: String(error.message || error) });
      }
    });

    const queuedPrint = chromiumPrintQueue.catch(() => {}).then(runChromiumSilentPrint);
    chromiumPrintQueue = queuedPrint.catch(() => {});
    return queuedPrint;
  });

  // Handle IPC for Cash Drawer Kick
  ipcMain.handle('kick-cash-drawer', async (e, { deviceName } = {}) => {
    return new Promise((resolve) => {
      // 1. Check if printer is network TCP (e.g. 192.168.1.100:9100)
      if (deviceName && (deviceName.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(deviceName))) {
        try {
          const net = require('net');
          const [host, port = 9100] = deviceName.split(':');
          const client = new net.Socket();
          client.setTimeout(2500);
          client.connect(Number(port), host, () => {
            const kickBytes = Buffer.from([27, 112, 0, 25, 250, 27, 112, 1, 25, 250, 7]);
            client.write(kickBytes, () => {
              client.end();
              resolve({ ok: true });
            });
          });
          client.on('error', (err) => {
            console.error('TCP drawer kick error:', err);
            resolve({ ok: false, error: err.message });
          });
          client.on('timeout', () => {
            client.destroy();
            resolve({ ok: false, error: 'Connection timeout' });
          });
          return;
        } catch (netErr) {
          console.error('Failed to init TCP drawer kick:', netErr);
        }
      }

      // 2. Windows local printer via kick-drawer.ps1
      const psScript = path.join(__dirname, 'kick-drawer.ps1');
      const printerName = typeof deviceName === 'string' ? deviceName.trim() : '';
      if (printerName.length > 256) return resolve({ ok: false, error: 'Invalid printer name' });
      const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psScript];
      if (printerName) args.push('-PrinterName', printerName);

      execFile('powershell.exe', args, { timeout: 4000, windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          console.error('Drawer kick script failed:', error, stderr);
          resolve({ ok: false, error: stderr || error.message });
        } else {
          resolve({ ok: true, output: (stdout || '').trim() });
        }
      });
    });
  });
  ipcMain.handle('switch-to-standalone', () => {
    runtimeConfigInstance.switchToStandalone();
    app.relaunch();
    app.exit();
  });

  ipcMain.handle('clear-app-cache', async () => {
    try {
      await session.defaultSession.clearCache();
      return { ok: true };
    } catch (error) {
      console.error('Failed to clear app cache:', error);
      return { ok: false, error: String(error) };
    }
  });

  ipcMain.handle('switch-to-lan-server', () => {
    runtimeConfigInstance.switchToLanServer();
    app.relaunch();
    app.exit();
  });
  ipcMain.handle('switch-to-lan-client', (e, { serverUrl, port }) => {
    runtimeConfigInstance.switchToLanClient(serverUrl, port);
    app.relaunch();
    app.exit();
  });
  ipcMain.handle('test-lan-server', async (e, { serverUrl }) => {
    try {
      const { net: electronNet } = require('electron');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await electronNet.fetch(`${serverUrl}/api/runtime/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error('Server returned ' + res.status);
      const data = await res.json();
      return { ok: true, data };
    } catch (err) {
      let errorMsg = err.message || String(err);
      if (err.name === 'AbortError' || errorMsg.includes('aborted')) {
        errorMsg = 'فشل الاتصال: يرجى التأكد من أن البرنامج يعمل على الجهاز الرئيسي، وأنه متصل بنفس الشبكة ولا يمنعه الجدار الناري.';
      } else if (errorMsg.includes('fetch failed')) {
        errorMsg = 'تعذر الاتصال بالجهاز الرئيسي. تأكد من صحة الرابط.';
      }
      return { ok: false, error: errorMsg };
    }
  });

  // Wait for backend to be ready then load the actual app
  const net = require('net');
  const waitForBackend = () => {
    if (currentConfig.runtimeMode === 'invalid') return Promise.resolve(false);
    
    if (currentConfig.runtimeMode === 'lan_client') {
      return new Promise((resolve) => {
        const { net: electronNet } = require('electron');
        let attempts = 0;
        const pingLan = async () => {
          attempts++;
          if (attempts > 15) { // wait up to 15 seconds
            return resolve(false); 
          }
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1000);
            const res = await electronNet.fetch(`${currentConfig.serverUrl}/api/runtime/health`, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok && (await res.json()).runtimeMode === 'lan_server') return resolve(true);
          } catch {}
          setTimeout(pingLan, 1000);
        };
        pingLan();
      });
    }

    return new Promise((resolve) => {
      let attempts = 0;
      const targetPort = Number(currentConfig.port || 3001);
      const ping = () => {
        if (backendStartupFailed) return resolve(false);
        if (backendSignaledReady) {
          return resolve(true);
        }
        attempts++;
        if (attempts > 600) {
          return resolve(false);
        }
        const socket = new net.Socket();
        socket.setTimeout(800);
        socket.once('connect', () => {
          socket.destroy();
          // Only the forked backend's IPC message confirms migrations completed.
          if (backendSignaledReady) return resolve(true);
          setTimeout(ping, 100);
        });
        socket.once('error', () => {
          socket.destroy();
          if (backendSignaledReady) return resolve(true);
          setTimeout(ping, 100);
        });
        socket.once('timeout', () => {
          socket.destroy();
          if (backendSignaledReady) return resolve(true);
          setTimeout(ping, 100);
        });
        socket.connect(targetPort, '127.0.0.1');
      };
      ping();
    });
  };

  const backendReady = await waitForBackend();

  // Never write a successful version marker for a failed backend bootstrap.
  if (backendReady) try {
    if (!fsLib.existsSync(dataDir)) {
      fsLib.mkdirSync(dataDir, { recursive: true });
    }
    const versionMarkerPath = path.join(dataDir, '.version');
    fsLib.writeFileSync(versionMarkerPath, packageVersion, 'utf8');
  } catch (err) {
    console.error('Error writing version marker:', err);
  }

  // Error screens must still be displayed; failed standalone startup must not load the POS.
  isBackendReady = true;
  if (!backendReady && currentConfig.runtimeMode !== 'lan_client' && currentConfig.runtimeMode !== 'invalid') {
    dialog.showErrorBox('فشل تشغيل السيرفر الداخلي',
      'لم يتم التأكد من جاهزية السيرفر المحلي وقاعدة البيانات. أعد تشغيل البرنامج وافحص backend.log.');
    app.quit();
    return;
  }

  if (currentConfig.runtimeMode === 'invalid') {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadFile(path.join(__dirname, 'config-error.html'));
    }
  } else if (currentConfig.runtimeMode === 'lan_client' && !backendReady) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadFile(path.join(__dirname, 'server-offline.html'));
    }
  } else {
    // Backend is 100% online, verified and listening! Load React now without race conditions
    if (mainWindow && !mainWindow.isDestroyed()) {
      loadAppIntoWindow(mainWindow);
    }
  }

  tryRevealApp();

  // Warm the silent print offscreen renderer + PowerShell System.Drawing daemon in the background
  setTimeout(() => {
    if (!isQuitting) {
      warmThermalSpooler(BrowserWindow);
    }
  }, 1500);

  // Safety fallback: if app did not signal rendered within 10s of backend ready, reveal anyway
  setTimeout(() => {
    if (!hasRevealedApp && isBackendReady) {
      isMainWindowRendered = true;
      tryRevealApp();
    }
  }, 10000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
