const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const POWERSHELL_SPOOL_FUNCTION = `
$script:paperStockCache = @{}

function Invoke-ZsSpoolManifest {
  param([string]$ManifestPath)
  $manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $files = @($manifest.imageFiles)
  if ($files.Count -eq 0) {
    throw 'No print images provided'
  }

  $doc = New-Object System.Drawing.Printing.PrintDocument
  try {
    $printerName = [string]$manifest.printerName
    if (-not [string]::IsNullOrWhiteSpace($printerName)) {
      $doc.PrinterSettings.PrinterName = $printerName
      if (-not $doc.PrinterSettings.IsValid) {
        throw "Invalid or unavailable Windows printer: $printerName"
      }
    }

    $mode = if ($manifest.mode -eq 'receipt') { 'receipt' } else { 'label' }
    $reqW = 0
    $reqH = 0

    if ($mode -eq 'receipt') {
      $doc.DefaultPageSettings.Landscape = $false
    } else {
      $widthMm = [double]$manifest.widthMm
      $heightMm = [double]$manifest.heightMm
      $reqW = [int][Math]::Round($widthMm / 25.4 * 100.0)
      $reqH = [int][Math]::Round($heightMm / 25.4 * 100.0)
      $reqMin = [Math]::Min($reqW, $reqH)
      $reqMax = [Math]::Max($reqW, $reqH)

      $curPs = $doc.DefaultPageSettings.PaperSize
      $curMin = [Math]::Min($curPs.Width, $curPs.Height)
      $curMax = [Math]::Max($curPs.Width, $curPs.Height)
      if (([Math]::Abs($curMin - $reqMin) -gt 24) -or ([Math]::Abs($curMax - $reqMax) -gt 24)) {
        $cacheKey = "$printerName|$reqMin|$reqMax"
        if ($script:paperStockCache.ContainsKey($cacheKey)) {
          $cachedStock = $script:paperStockCache[$cacheKey]
          if ($null -ne $cachedStock) {
            $doc.DefaultPageSettings.PaperSize = $cachedStock
          }
        } else {
          $bestStock = $null
          $bestDist = 999999
          foreach ($ps in $doc.PrinterSettings.PaperSizes) {
            $pMin = [Math]::Min($ps.Width, $ps.Height)
            $pMax = [Math]::Max($ps.Width, $ps.Height)
            $dist = [Math]::Abs($pMin - $reqMin) + [Math]::Abs($pMax - $reqMax)
            if ($dist -lt $bestDist -and [Math]::Abs($pMin - $reqMin) -le 24 -and [Math]::Abs($pMax - $reqMax) -le 24) {
              $bestDist = $dist
              $bestStock = $ps
            }
          }
          $script:paperStockCache[$cacheKey] = $bestStock
          if ($null -ne $bestStock) {
            $doc.DefaultPageSettings.PaperSize = $bestStock
          }
        }
      }

      $activePs = $doc.DefaultPageSettings.PaperSize
      $wantWide = ($widthMm -ge $heightMm)
      $paperIsWide = ($activePs.Width -ge $activePs.Height)
      $doc.DefaultPageSettings.Landscape = ($wantWide -ne $paperIsWide)
    }

    $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
    $doc.OriginAtMargins = $false
    $doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController

    $state = @{ pageIndex = 0; srcYOffset = 0 }
    $doc.add_PrintPage({
      param($sender, $e)
      $e.Graphics.PageUnit = [System.Drawing.GraphicsUnit]::Display
      $e.Graphics.Clear([System.Drawing.Color]::White)
      $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

      $filePath = [string]$files[$state.pageIndex]
      $img = [System.Drawing.Image]::FromFile($filePath)
      try {
        if ($mode -eq 'receipt') {
          $clip = $e.Graphics.VisibleClipBounds
          $availX = [double]$clip.X
          $availY = [double]$clip.Y
          $availW = if ($clip.Width -gt 20) { [double]$clip.Width } else { [double]$e.PageBounds.Width }
          $availH = if ($clip.Height -gt 20) { [double]$clip.Height } else { [double]$e.PageBounds.Height }
          $maxPaperMm = if ($manifest.maxPaperMm) { [double]$manifest.maxPaperMm } else { 76.0 }
          $maxDrawW = $maxPaperMm / 25.4 * 100.0
          $drawW = [Math]::Min($availW, $maxDrawW)
          $drawX = if ($availW -gt $drawW) { $availX + (($availW - $drawW) / 2.0) } else { $availX }

          $remPx = [Math]::Max(1, $img.Height - $state.srcYOffset)
          $pxToHi = $drawW / [double]$img.Width
          $remDrawH = [double]$remPx * $pxToHi

          if ($availH -le 20 -or $remDrawH -le $availH) {
            $srcRect = New-Object System.Drawing.RectangleF([float]0, [float]$state.srcYOffset, [float]$img.Width, [float]$remPx)
            $destRect = New-Object System.Drawing.RectangleF([float]$drawX, [float]$availY, [float]$drawW, [float]$remDrawH)
            $e.Graphics.DrawImage($img, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
            $state.srcYOffset = 0
            $state.pageIndex++
          } else {
            $slicePx = [Math]::Max(1, [int][Math]::Floor($availH / $pxToHi))
            $srcRect = New-Object System.Drawing.RectangleF([float]0, [float]$state.srcYOffset, [float]$img.Width, [float]$slicePx)
            $destRect = New-Object System.Drawing.RectangleF([float]$drawX, [float]$availY, [float]$drawW, [float]$availH)
            $e.Graphics.DrawImage($img, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
            $state.srcYOffset += $slicePx
          }
        } else {
          $bounds = $e.PageBounds
          $bW = [double]$bounds.Width
          $bH = [double]$bounds.Height
          if ($bW -gt 0 -and $bH -gt 0 -and [Math]::Abs($bW - $reqW) -le ($reqW * 0.35) -and [Math]::Abs($bH - $reqH) -le ($reqH * 0.35)) {
            $drawW = $bW
            $drawH = $bH
          } else {
            $drawW = if ($bW -gt 0) { [Math]::Min($bW, [double]$reqW) } else { [double]$reqW }
            $drawH = if ($bH -gt 0) { [Math]::Min($bH, [double]$reqH) } else { [double]$reqH }
          }
          $e.Graphics.DrawImage($img, [float]0, [float]0, [float]$drawW, [float]$drawH)
          $state.pageIndex++
        }
      } finally {
        $img.Dispose()
      }

      $e.HasMorePages = ($state.pageIndex -lt $files.Count)
    })

    $doc.Print()
    return $files.Count
  } finally {
    $doc.Dispose()
  }
}
`;

const POWERSHELL_ONESHOT_SCRIPT = `
param([string]$ManifestPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
${POWERSHELL_SPOOL_FUNCTION}
$count = Invoke-ZsSpoolManifest -ManifestPath $ManifestPath
Write-Output "OK:$count"
`;

const POWERSHELL_DAEMON_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
${POWERSHELL_SPOOL_FUNCTION}
[Console]::Out.WriteLine('@@ZS_DAEMON_READY@@')
[Console]::Out.Flush()

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $trimmed = $line.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
  if ($trimmed -eq '__EXIT__') { break }
  try {
    $count = Invoke-ZsSpoolManifest -ManifestPath $trimmed
    [Console]::Out.WriteLine("@@ZS_PRINT_OK@@:$count")
  } catch {
    $errMsg = ($_.Exception.Message -replace "[\\r\\n]+", " ").Trim()
    if ([string]::IsNullOrWhiteSpace($errMsg)) { $errMsg = 'Thermal print failed' }
    [Console]::Out.WriteLine("@@ZS_PRINT_ERR@@:$errMsg")
  }
  [Console]::Out.Flush()
}
`;

let spoolDaemonProc = null;
let spoolDaemonReadyPromise = null;
let spoolDaemonScriptPath = null;
let spoolDaemonBuffer = '';
let activeDaemonCallback = null;
let daemonJobQueue = Promise.resolve();

let sharedOffscreenWin = null;
let offscreenRenderQueue = Promise.resolve();

function teardownSpoolDaemon(reason) {
  if (activeDaemonCallback) {
    const cb = activeDaemonCallback;
    activeDaemonCallback = null;
    cb({ ok: false, brokenPipe: true, error: reason || 'Spool daemon exited' });
  }
  const proc = spoolDaemonProc;
  spoolDaemonProc = null;
  spoolDaemonReadyPromise = null;
  spoolDaemonBuffer = '';
  if (proc && !proc.killed) {
    try { proc.kill(); } catch {}
  }
}

function ensurePowerShellSpoolDaemon() {
  if (process.platform !== 'win32') {
    return Promise.resolve(null);
  }
  if (spoolDaemonProc && !spoolDaemonProc.killed && spoolDaemonReadyPromise) {
    return spoolDaemonReadyPromise;
  }

  spoolDaemonReadyPromise = new Promise((resolve) => {
    try {
      if (!spoolDaemonScriptPath) {
        spoolDaemonScriptPath = path.join(os.tmpdir(), `zs-spool-daemon-${process.pid}.ps1`);
      }
      fs.writeFileSync(spoolDaemonScriptPath, '\uFEFF' + POWERSHELL_DAEMON_SCRIPT, 'utf8');

      const proc = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', spoolDaemonScriptPath],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
      );
      spoolDaemonProc = proc;
      spoolDaemonBuffer = '';
      let settledReady = false;

      const readyTimer = setTimeout(() => {
        if (!settledReady) {
          settledReady = true;
          teardownSpoolDaemon('Spool daemon startup timeout');
          resolve(null);
        }
      }, 10000);

      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => {
        spoolDaemonBuffer += chunk;
        let newlineIdx = spoolDaemonBuffer.indexOf('\n');
        while (newlineIdx !== -1) {
          const line = spoolDaemonBuffer.slice(0, newlineIdx).trim();
          spoolDaemonBuffer = spoolDaemonBuffer.slice(newlineIdx + 1);
          newlineIdx = spoolDaemonBuffer.indexOf('\n');

          if (!settledReady && line.includes('@@ZS_DAEMON_READY@@')) {
            settledReady = true;
            clearTimeout(readyTimer);
            resolve(proc);
            continue;
          }
          if (activeDaemonCallback && line.startsWith('@@ZS_PRINT_OK@@:')) {
            const cb = activeDaemonCallback;
            activeDaemonCallback = null;
            cb({ ok: true, output: line.replace('@@ZS_PRINT_OK@@:', 'OK:') });
          } else if (activeDaemonCallback && line.startsWith('@@ZS_PRINT_ERR@@:')) {
            const cb = activeDaemonCallback;
            activeDaemonCallback = null;
            cb({ ok: false, error: line.slice('@@ZS_PRINT_ERR@@:'.length).trim() || 'Thermal print failed' });
          }
        }
      });

      proc.on('error', (err) => {
        clearTimeout(readyTimer);
        teardownSpoolDaemon(err && err.message ? err.message : 'Spool daemon spawn error');
        if (!settledReady) {
          settledReady = true;
          resolve(null);
        }
      });

      proc.on('exit', () => {
        clearTimeout(readyTimer);
        teardownSpoolDaemon('Spool daemon exited');
        if (!settledReady) {
          settledReady = true;
          resolve(null);
        }
      });
    } catch {
      spoolDaemonProc = null;
      spoolDaemonReadyPromise = null;
      resolve(null);
    }
  });

  return spoolDaemonReadyPromise;
}

function runOneShotPowerShellPrintJob(manifestPath, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const tempScriptPath = path.join(path.dirname(manifestPath), 'spool-thermal.ps1');
    try {
      fs.writeFileSync(tempScriptPath, '\uFEFF' + POWERSHELL_ONESHOT_SCRIPT, 'utf8');
    } catch (err) {
      return resolve({ ok: false, error: String(err.message || err) });
    }

    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      tempScriptPath,
      '-ManifestPath',
      manifestPath,
    ];

    execFile('powershell.exe', args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, error: (stderr || error.message || 'Thermal print failed').trim() });
      } else {
        resolve({ ok: true, output: (stdout || '').trim() });
      }
    });
  });
}

function runPowerShellPrintJob(manifestPath, timeoutMs = 45000) {
  const job = daemonJobQueue.catch(() => {}).then(async () => {
    const daemon = await ensurePowerShellSpoolDaemon();
    if (!daemon || !daemon.stdin || daemon.killed) {
      return runOneShotPowerShellPrintJob(manifestPath, timeoutMs);
    }

    const daemonRes = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        teardownSpoolDaemon('Thermal print timed out');
        resolve({ ok: false, brokenPipe: true, error: 'Thermal print timed out' });
      }, timeoutMs);

      activeDaemonCallback = (res) => {
        clearTimeout(timer);
        resolve(res);
      };

      try {
        daemon.stdin.write(`${manifestPath}\n`, 'utf8');
      } catch (err) {
        clearTimeout(timer);
        activeDaemonCallback = null;
        teardownSpoolDaemon(err && err.message ? err.message : 'Write failed');
        resolve({ ok: false, brokenPipe: true, error: String(err.message || err) });
      }
    });

    if (daemonRes && daemonRes.brokenPipe) {
      return runOneShotPowerShellPrintJob(manifestPath, timeoutMs);
    }
    return daemonRes;
  });

  daemonJobQueue = job.catch(() => {});
  return job;
}

function getOrCreateOffscreenWindow(BrowserWindow, widthPx, heightPx) {
  if (!sharedOffscreenWin || sharedOffscreenWin.isDestroyed()) {
    sharedOffscreenWin = new BrowserWindow({
      show: false,
      width: widthPx,
      height: heightPx,
      useContentSize: true,
      enableLargerThanScreen: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        offscreen: true,
      },
    });
  } else {
    sharedOffscreenWin.setContentSize(widthPx, heightPx);
  }
  return sharedOffscreenWin;
}

async function loadHtmlIntoOffscreenWindow(BrowserWindow, html, widthPx, heightPx, scale) {
  const win = getOrCreateOffscreenWindow(BrowserWindow, widthPx, heightPx);
  win.webContents.setZoomFactor(1);

  await new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      win.webContents.removeListener('did-fail-load', onFail);
      win.webContents.removeListener('did-finish-load', onFinish);
    };
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new Error('Thermal render timed out'));
    }, 20000);
    const onFail = (_e, code, reason) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error(`Document failed to load (${code}): ${reason}`));
    };
    const onFinish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      cleanup();
      resolve();
    };

    win.webContents.once('did-fail-load', onFail);
    win.webContents.once('did-finish-load', onFinish);
    win
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      .catch((err) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        cleanup();
        reject(err);
      });
  });

  win.webContents.setZoomFactor(scale);
  return win;
}

function warmThermalSpooler(BrowserWindow) {
  if (process.platform !== 'win32') return;
  try {
    void ensurePowerShellSpoolDaemon();
    if (BrowserWindow) {
      const win = getOrCreateOffscreenWindow(BrowserWindow, 816, 600);
      win.loadURL('about:blank').catch(() => {});
    }
  } catch {}
}

function shutdownThermalSpooler() {
  try {
    if (spoolDaemonProc && spoolDaemonProc.stdin && !spoolDaemonProc.killed) {
      try { spoolDaemonProc.stdin.write('__EXIT__\n'); } catch {}
    }
  } catch {}
  teardownSpoolDaemon('App shutting down');
  try {
    if (spoolDaemonScriptPath && fs.existsSync(spoolDaemonScriptPath)) {
      fs.unlinkSync(spoolDaemonScriptPath);
    }
  } catch {}
  try {
    if (sharedOffscreenWin && !sharedOffscreenWin.isDestroyed()) {
      sharedOffscreenWin.destroy();
    }
  } catch {}
  sharedOffscreenWin = null;
}

function printThermalLabelsOnWindows({ BrowserWindow, html, deviceName, widthMm, heightMm }) {
  const task = offscreenRenderQueue.catch(() => {}).then(async () => {
    const scale = 3;
    const cssWidthPx = Math.max(60, Math.round(widthMm * (96 / 25.4)));
    const cssHeightPx = Math.max(40, Math.round(heightMm * (96 / 25.4)));
    const pixelWidth = cssWidthPx * scale;
    const pixelHeight = cssHeightPx * scale;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-thermal-label-'));

    try {
      const printWin = await loadHtmlIntoOffscreenWindow(BrowserWindow, html, pixelWidth, pixelHeight, scale);

      const layoutInfo = await printWin.webContents.executeJavaScript(`
        (async () => {
          document.documentElement.style.cssText = 'margin:0!important;padding:0!important;overflow:hidden!important;background:#fff!important;';
          document.body.style.cssText = 'margin:0!important;padding:0!important;overflow:hidden!important;background:#fff!important;';
          const shell = document.querySelector('.print-shell');
          if (shell) shell.style.cssText = 'margin:0!important;padding:0!important;width:100%!important;max-width:100%!important;';
          if (document.fonts && document.fonts.ready) {
            try { await document.fonts.ready; } catch {}
          }
          await Promise.all(
            Array.from(document.images || []).map((img) =>
              img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; })
            )
          );
          const pages = Array.from(document.querySelectorAll('.barcode-print-page-thermal, .barcode-print-page'));
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          if (!pages.length) {
            return { totalPages: 1, uniqueIndices: [0], pageToUniqueIdx: [0] };
          }
          const sigMap = new Map();
          const uniqueIndices = [];
          const pageToUniqueIdx = [];
          pages.forEach((p, idx) => {
            p.style.pageBreakAfter = 'none';
            p.style.breakAfter = 'auto';
            const sig = p.innerHTML;
            if (!sigMap.has(sig)) {
              sigMap.set(sig, uniqueIndices.length);
              uniqueIndices.push(idx);
            }
            pageToUniqueIdx.push(sigMap.get(sig));
          });
          return { totalPages: pages.length, uniqueIndices, pageToUniqueIdx };
        })()
      `);

      const uniqueFiles = [];
      for (let u = 0; u < layoutInfo.uniqueIndices.length; u += 1) {
        const domIdx = layoutInfo.uniqueIndices[u];
        if (layoutInfo.totalPages > 1) {
          await printWin.webContents.executeJavaScript(`
            (async () => {
              const pages = Array.from(document.querySelectorAll('.barcode-print-page-thermal, .barcode-print-page'));
              pages.forEach((el, idx) => {
                el.style.display = idx === ${domIdx} ? 'block' : 'none';
              });
              await new Promise((r) => requestAnimationFrame(r));
            })()
          `);
        }
        await new Promise((r) => setTimeout(r, 16));
        const image = await printWin.webContents.capturePage({
          x: 0,
          y: 0,
          width: pixelWidth,
          height: pixelHeight,
        });
        const filePath = path.join(tempDir, `label-u${u}.png`);
        fs.writeFileSync(filePath, image.toPNG());
        uniqueFiles.push(filePath);
      }

      const imageFiles = layoutInfo.pageToUniqueIdx.map((uIdx) => uniqueFiles[uIdx]);
      const manifestPath = path.join(tempDir, 'manifest.json');
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          mode: 'label',
          printerName: typeof deviceName === 'string' ? deviceName.trim() : '',
          widthMm,
          heightMm,
          imageFiles,
        }),
        'utf8',
      );

      return await runPowerShellPrintJob(manifestPath);
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });
  offscreenRenderQueue = task.catch(() => {});
  return task;
}

function printThermalReceiptOnWindows({ BrowserWindow, html, deviceName, receiptWidthMm = 80 }) {
  const task = offscreenRenderQueue.catch(() => {}).then(async () => {
    const is58 = Number(receiptWidthMm) === 58;
    const printableWidthMm = is58 ? 48 : 72;
    const maxPaperMm = printableWidthMm;
    const scale = 3;
    const cssWidthPx = Math.max(120, Math.round(printableWidthMm * (96 / 25.4)));
    const pixelWidth = cssWidthPx * scale;
    const maxSingleSliceCssPx = 2200;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-thermal-receipt-'));

    try {
      const printWin = await loadHtmlIntoOffscreenWindow(BrowserWindow, html, pixelWidth, 1200, scale);
      const docState = await printWin.webContents.executeJavaScript(`
        (async () => {
          const s = document.createElement('style');
          s.textContent = [
            'html, body { margin: 0 !important; padding: 0 !important; width: 100% !important; max-width: 100% !important; background: #fff !important; overflow-x: hidden !important; }',
            '.print-shell, .thermal-receipt-container { width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 1.5mm 2mm !important; box-sizing: border-box !important; }',
            '.receipt-cut-separator { display: none !important; }'
          ].join('\\n');
          document.head.appendChild(s);
          if (document.fonts && document.fonts.ready) {
            try { await document.fonts.ready; } catch {}
          }
          await Promise.all(
            Array.from(document.images || []).map((img) =>
              img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; })
            )
          );
          await new Promise((r) => requestAnimationFrame(r));
          const cust = document.querySelector('.receipt-copy-customer');
          const merch = document.querySelector('.receipt-copy-merchant');
          const hasDualCopies = Boolean(cust && merch);
          return {
            hasDualCopies,
            singleHeight: hasDualCopies ? 0 : Math.max(40, Math.ceil(document.documentElement.scrollHeight)),
          };
        })()
      `);

      const captureTargets = docState.hasDualCopies ? ['customer', 'merchant'] : ['all'];
      const imageFiles = [];

      for (let t = 0; t < captureTargets.length; t += 1) {
        const target = captureTargets[t];
        const totalCssH = !docState.hasDualCopies
          ? docState.singleHeight
          : await printWin.webContents.executeJavaScript(`
              (async () => {
                const cust = document.querySelector('.receipt-copy-customer');
                const merch = document.querySelector('.receipt-copy-merchant');
                if (cust && merch) {
                  cust.style.display = ${target === 'merchant' ? "'none'" : "'block'"};
                  merch.style.display = ${target === 'customer' ? "'none'" : "'block'"};
                }
                document.body.style.transform = '';
                await new Promise((r) => requestAnimationFrame(r));
                return Math.max(40, Math.ceil(document.documentElement.scrollHeight));
              })()
            `);

        let offsetCss = 0;
        let bandIdx = 0;
        while (offsetCss < totalCssH) {
          const sliceCssH = Math.min(maxSingleSliceCssPx, totalCssH - offsetCss);
          const slicePixelH = Math.max(30, Math.ceil(sliceCssH * scale));
          printWin.setContentSize(pixelWidth, slicePixelH);
          if (offsetCss > 0) {
            await printWin.webContents.executeJavaScript(`
              (async () => {
                document.body.style.transform = 'translateY(-${offsetCss}px)';
                await new Promise((r) => requestAnimationFrame(r));
              })()
            `);
          }
          await new Promise((r) => setTimeout(r, 16));
          const image = await printWin.webContents.capturePage({
            x: 0,
            y: 0,
            width: pixelWidth,
            height: slicePixelH,
          });
          const filePath = path.join(tempDir, `receipt-${t}-${bandIdx}.png`);
          fs.writeFileSync(filePath, image.toPNG());
          imageFiles.push(filePath);
          offsetCss += sliceCssH;
          bandIdx += 1;
        }
      }

      const manifestPath = path.join(tempDir, 'manifest.json');
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          mode: 'receipt',
          printerName: typeof deviceName === 'string' ? deviceName.trim() : '',
          maxPaperMm,
          imageFiles,
        }),
        'utf8',
      );

      return await runPowerShellPrintJob(manifestPath);
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });
  offscreenRenderQueue = task.catch(() => {});
  return task;
}

module.exports = {
  printThermalLabelsOnWindows,
  printThermalReceiptOnWindows,
  warmThermalSpooler,
  shutdownThermalSpooler,
};
