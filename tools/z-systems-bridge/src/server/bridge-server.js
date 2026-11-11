/**
 * Z-Systems Hardware Bridge Server
 * Listens on 127.0.0.1:18181 with W3C Private Network Access headers.
 * Connects Web POS to local ECR terminals, ESC/POS printers, and cash drawers.
 */

const http = require('http');
const url = require('url');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const { chargePax, cancelPax, testPaxConnection } = require('../drivers/ecr/pax-driver');
const { chargeGeidea, cancelGeidea, testGeideaConnection } = require('../drivers/ecr/geidea-driver');
const { printRawReceipt, kickCashDrawer, printTestReceipt } = require('../drivers/printer/escpos-driver');

const PORT = 18181;
const HOST = '127.0.0.1';
const startTime = Date.now();

let activeEcrSession = null;
const sseClients = new Set();

function broadcastEvent(type, data = {}) {
  const payload = JSON.stringify({ type, ...data, timestamp: Date.now() });
  for (const res of sseClients) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch {
      sseClients.delete(res);
    }
  }
}

// --- Silent Windows HTML printing (Electron tray runtime only) ---
// The headless Node daemon has no rendering engine, so print-windows answers
// 501 there; the Electron tray app owns a hidden BrowserWindow for rendering.
const isElectronRuntime = Boolean(process.versions && process.versions.electron);
let windowsPrintWindow = null; // lazily created hidden BrowserWindow (Electron only)
let windowsPrintQueue = Promise.resolve(); // serialize prints (one job at a time)

async function getWindowsPrintWindow() {
  // Lazy require: this file must keep loading in plain Node (headless daemon).
  const { BrowserWindow } = require('electron');
  if (!windowsPrintWindow || windowsPrintWindow.isDestroyed()) {
    windowsPrintWindow = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
  }
  return windowsPrintWindow;
}

async function printHtmlOnWindowsPrinter({ html, deviceName, pageSize = 'A4', receiptWidthMm = 80 }) {
  const win = await getWindowsPrintWindow();
  const base64 = Buffer.from(html, 'utf8').toString('base64');
  const printJob = (async () => {
    await win.loadURL(`data:text/html;base64,${base64}`);
    const printOptions = { silent: true, printBackground: true, margins: { marginType: 'none' } };
    if (deviceName) printOptions.deviceName = deviceName;
    if (pageSize === 'A4') printOptions.pageSize = 'A4';
    else if (pageSize === 'receipt') {
      printOptions.pageSize = { width: (receiptWidthMm === 58 ? 58 : 80) * 1000, height: 297000 };
    }
    // 'auto' leaves pageSize unset: the HTML @page rule decides.
    // webContents.print returns a Promise on newer Electron and takes a
    // callback on older Electron; settle on whichever fires first.
    await new Promise((resolve, reject) => {
      let settled = false;
      const once = (fn) => (value) => { if (!settled) { settled = true; fn(value); } };
      const onOk = once(resolve);
      const onErr = once(reject);
      let result;
      try {
        result = win.webContents.print(printOptions, (success, failureReason) => {
          if (success) onOk();
          else onErr(new Error(failureReason || 'فشلت الطباعة'));
        });
      } catch (err) {
        onErr(err);
        return;
      }
      if (result && typeof result.then === 'function') {
        result.then(onOk, (err) => onErr(err instanceof Error ? err : new Error(String(err))));
      }
    });
  })();
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('انتهت مهلة الطباعة (30 ثانية) ولم تكتمل الطباعة')), 30000));
  await Promise.race([printJob, timeout]);
}

async function listWindowsPrinters() {
  if (isElectronRuntime) {
    const win = await getWindowsPrintWindow();
    const list = await win.webContents.getPrintersAsync();
    return list.map((p) => p.name).filter(Boolean);
  }
  // Headless Node on Windows: ask PowerShell for the installed printers.
  // Any other platform has no Windows printer queue to list.
  if (process.platform !== 'win32') {
    throw new Error('قائمة الطابعات غير متاحة: الجسر يعمل بدون واجهة Electron على نظام غير ويندوز');
  }
  return new Promise((resolve, reject) => {
    execFile('powershell', ['-NoProfile', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name'],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          reject(new Error('تعذر قراءة قائمة الطابعات من ويندوز: ' + err.message));
          return;
        }
        resolve(String(stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
      });
  });
}

// Strict browser-origin allowlist; native clients without Origin are handled separately.
const trustedOrigins = new Set([
  'https://app.zsystemai.com',
  ...String(process.env.ZS_BRIDGE_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
]);
function isTrustedBrowserOrigin(origin) {
  return !origin || trustedOrigins.has(origin);
}
function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && trustedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-pairing-key, X-Requested-With');
}

function parseJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({ raw: body });
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(req, res);
  if (!isTrustedBrowserOrigin(req.headers.origin)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Untrusted browser origin' }));
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 1. Health & Ping
  if (pathname === '/health' || pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ONLINE',
      name: 'Z-Systems Hardware Bridge',
      version: '1.0.0',
      uptimeSec: Math.floor((Date.now() - startTime) / 1000),
      activeSession: activeEcrSession ? activeEcrSession.referenceId : null,
    }));
    return;
  }

  // 2. SSE Event Stream
  if (pathname === '/events' || pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', version: '1.0.0' })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // 3. ECR Terminal Endpoints
  if (pathname === '/api/ecr/charge' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const { ip, port, provider = 'fawry', amount, currency = 'EGP', referenceId = `ECR-${Date.now()}`, pairingKey, terminalTid } = body;

    if (!ip || !amount) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'يجب تحديد عنوان IP للماكينة والمبلغ المطلوب' }));
      return;
    }

    const cleanPort = Number(port || 8080);
    const provLower = String(provider).toLowerCase();

    activeEcrSession = { referenceId, amount, currency, ip, port: cleanPort, provider };
    broadcastEvent('ecr_waiting', activeEcrSession);

    try {
      let result = null;
      if (provLower.includes('geidea')) {
        result = await chargeGeidea({ ip, port: cleanPort, amount, currency, referenceId, pairingKey, terminalTid });
      } else {
        // PAX / Fawry / K-NET / Paymob
        result = await chargePax({ ip, port: cleanPort, amount, currency, referenceId, terminalTid });
      }

      activeEcrSession = null;
      broadcastEvent(result.success ? 'ecr_approved' : 'ecr_declined', result);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      activeEcrSession = null;
      broadcastEvent('ecr_error', { error: err.message, referenceId });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, status: 'error', message: err.message }));
    }
    return;
  }

  if (pathname === '/api/ecr/cancel' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const { ip, port, provider = 'fawry', referenceId } = body;

    const cleanPort = Number(port || 8080);
    const provLower = String(provider).toLowerCase();

    try {
      let result = null;
      if (provLower.includes('geidea')) {
        result = await cancelGeidea({ ip, port: cleanPort, referenceId });
      } else {
        result = await cancelPax({ ip, port: cleanPort, referenceId });
      }

      activeEcrSession = null;
      broadcastEvent('ecr_cancelled', { referenceId });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (pathname === '/api/ecr/test' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const { ip, port, provider = 'fawry' } = body;
    const cleanPort = Number(port || 8080);
    const provLower = String(provider).toLowerCase();

    let testResult = null;
    if (provLower.includes('geidea')) {
      testResult = await testGeideaConnection(ip, cleanPort);
    } else {
      testResult = await testPaxConnection(ip, cleanPort);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: testResult }));
    return;
  }

  // 4. ESC/POS Thermal Printer Endpoints
  if (pathname === '/api/printer/print' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    try {
      const result = await printRawReceipt(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (pathname === '/api/printer/kick-drawer' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    try {
      const result = await kickCashDrawer(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (pathname === '/api/printer/test' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    try {
      const result = await printTestReceipt(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 4b. Windows Printer Endpoints (silent HTML print, no browser dialog).
  //     These only render in the Electron tray runtime, which owns a hidden
  //     BrowserWindow. The headless Node daemon has no rendering engine and
  //     the bridge ships zero dependencies, so it answers 501 naming the
  //     missing capability; the web app then falls back to the browser print
  //     dialog and printing is never lost.
  if (pathname === '/api/printer/list' && req.method === 'GET') {
    try {
      const printers = await listWindowsPrinters();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, printers }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (pathname === '/api/printer/print-windows' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const html = String(body.html || '');
    if (!html.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'يرجى إرسال محتوى HTML للطباعة' }));
      return;
    }
    if (!isElectronRuntime) {
      res.writeHead(501, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'الطباعة الصامتة من HTML غير متاحة في الجسر بدون واجهة Electron: شغّل تطبيق الجسر (Electron) على هذا الجهاز' }));
      return;
    }
    try {
      const deviceName = String(body.deviceName || '').trim() || undefined;
      const pageSize = String(body.pageSize || 'A4');
      const receiptWidthMm = Number(body.receiptWidthMm || 80);
      // Serialize prints: one silent job at a time (shared hidden window).
      // The queue promise is kept settled so one failed job never blocks the next.
      const job = windowsPrintQueue.catch(() => {}).then(() =>
        printHtmlOnWindowsPrinter({ html, deviceName, pageSize, receiptWidthMm }));
      windowsPrintQueue = job.catch(() => {});
      await job;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, printer: deviceName || 'default' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 5. Diagnostics Dashboard Web Page
  if (pathname === '/' || pathname === '/diagnostics' || pathname === '/index.html') {
    const uiPath = path.join(__dirname, '..', 'ui', 'diagnostics.html');
    fs.readFile(uiPath, (err, content) => {
      if (err) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Z-Systems Hardware Bridge is Running at http://127.0.0.1:18181');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

server.listen(PORT, HOST, () => {
  console.log(`====================================================`);
  console.log(`  Z-Systems Hardware Bridge v1.0.0                  `);
  console.log(`  Listening on http://${HOST}:${PORT}              `);
  console.log(`  Diagnostics UI: http://${HOST}:${PORT}/diagnostics`);
  console.log(`====================================================`);
});

module.exports = { server };
