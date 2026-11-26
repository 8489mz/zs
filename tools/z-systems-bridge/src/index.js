/**
 * Z-Systems Hardware Bridge - Main Entry Point
 * Dual-Mode: Runs as an Electron Tray Application if Electron is present,
 * or as a lightweight background daemon if run directly with Node.js.
 */

const path = require('path');

// Check if running inside Electron
const isElectron = Boolean(process.versions.electron);

if (!isElectron) {
  // Headless Node.js mode
  console.log('[Z-Bridge] Starting in Headless Daemon mode...');
  require('./server/bridge-server');
} else {
  // Electron Tray mode
  const { app, Tray, Menu, nativeImage, shell } = require('electron');

  // Prevent multiple instances
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    process.exit(0);
  }

  // Hide dock icon on macOS
  if (app.dock) {
    app.dock.hide();
  }

  let tray = null;

  app.whenReady().then(() => {
    // 1. Start internal bridge server
    require('./server/bridge-server');

    // 2. Create Tray icon (16x16 / 24x24)
    // Create base64 16x16 PNG for tray icon
    const iconData = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMklEQVR42mNk+M9QzwAEjAwMDAwMDAwMDEAMZmg0BhoYGIyGAYwGABoYGIyGAYwGABoAAL6ABhUe7o71AAAAAElFTkSuQmCC';
    const icon = nativeImage.createFromDataURL(`data:image/png;base64,${iconData}`);

    tray = new Tray(icon);
    tray.setToolTip('أداة ربط أجهزة Z-Systems — تعمل بنجاح');

    const contextMenu = Menu.buildFromTemplate([
      { label: 'أداة ربط أجهزة Z-Systems — الإصدار 1.2.0', enabled: false },
      { label: 'الحالة: تعمل وجاهزة للاتصال', enabled: false },
      { type: 'separator' },
      {
        label: 'حالة الطابعات والأجهزة',
        click: () => {
          shell.openExternal('http://127.0.0.1:18181/diagnostics');
        },
      },
      {
        label: 'التشغيل التلقائي مع بدء ويندوز',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked });
        },
      },
      { type: 'separator' },
      {
        label: 'عن المطوّر — www.zsystemai.com',
        click: () => {
          shell.openExternal('https://www.zsystemai.com');
        },
      },
      { type: 'separator' },
      {
        label: 'إيقاف الخدمة وإغلاق',
        click: () => {
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
      shell.openExternal('http://127.0.0.1:18181/diagnostics');
    });
  });

  app.on('window-all-closed', (e) => {
    e.preventDefault(); // Keep running in tray
  });
}
