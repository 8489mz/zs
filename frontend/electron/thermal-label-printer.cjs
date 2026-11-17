const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const POWERSHELL_PRINT_SCRIPT = `
param([string]$ManifestPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$files = @($manifest.imageFiles)
if ($files.Count -eq 0) {
  throw 'No print images provided'
}

Add-Type -AssemblyName System.Drawing

$doc = New-Object System.Drawing.Printing.PrintDocument
$printerName = [string]$manifest.printerName
if (-not [string]::IsNullOrWhiteSpace($printerName)) {
  $doc.PrinterSettings.PrinterName = $printerName
  if (-not $doc.PrinterSettings.IsValid) {
    throw "Invalid or unavailable Windows printer: $printerName"
  }
}

$mode = if ($manifest.mode -eq 'receipt') { 'receipt' } else { 'label' }

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
    if ($null -ne $bestStock) {
      $doc.DefaultPageSettings.PaperSize = $bestStock
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

$script:pageIndex = 0
$script:srcYOffset = 0
$doc.add_PrintPage({
  param($sender, $e)
  $e.Graphics.PageUnit = [System.Drawing.GraphicsUnit]::Display
  $e.Graphics.Clear([System.Drawing.Color]::White)
  $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

  $filePath = [string]$files[$script:pageIndex]
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

      $remPx = [Math]::Max(1, $img.Height - $script:srcYOffset)
      $pxToHi = $drawW / [double]$img.Width
      $remDrawH = [double]$remPx * $pxToHi

      if ($availH -le 20 -or $remDrawH -le $availH) {
        $srcRect = New-Object System.Drawing.RectangleF([float]0, [float]$script:srcYOffset, [float]$img.Width, [float]$remPx)
        $destRect = New-Object System.Drawing.RectangleF([float]$drawX, [float]$availY, [float]$drawW, [float]$remDrawH)
        $e.Graphics.DrawImage($img, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
        $script:srcYOffset = 0
        $script:pageIndex++
      } else {
        $slicePx = [Math]::Max(1, [int][Math]::Floor($availH / $pxToHi))
        $srcRect = New-Object System.Drawing.RectangleF([float]0, [float]$script:srcYOffset, [float]$img.Width, [float]$slicePx)
        $destRect = New-Object System.Drawing.RectangleF([float]$drawX, [float]$availY, [float]$drawW, [float]$availH)
        $e.Graphics.DrawImage($img, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
        $script:srcYOffset += $slicePx
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
      $script:pageIndex++
    }
  } finally {
    $img.Dispose()
  }

  $e.HasMorePages = ($script:pageIndex -lt $files.Count)
})

$doc.Print()
Write-Output "OK:$($files.Count)"
`;

function runPowerShellPrintJob(manifestPath, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const tempScriptPath = path.join(path.dirname(manifestPath), 'spool-thermal.ps1');
    try {
      fs.writeFileSync(tempScriptPath, '\uFEFF' + POWERSHELL_PRINT_SCRIPT, 'utf8');
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

async function createOffscreenRenderWindow(BrowserWindow, html, widthPx, heightPx, scale) {
  const win = new BrowserWindow({
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

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Thermal render timed out')), 20000);
    win.webContents.once('did-fail-load', (_e, code, reason) => {
      clearTimeout(timer);
      reject(new Error(`Document failed to load (${code}): ${reason}`));
    });
    win.webContents.once('did-finish-load', () => {
      clearTimeout(timer);
      resolve();
    });
    win
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });

  win.webContents.setZoomFactor(scale);
  return win;
}

async function waitForFontsAndImages(win) {
  await win.webContents.executeJavaScript(`
    (async () => {
      if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch {}
      }
      await Promise.all(
        Array.from(document.images || []).map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                img.onload = resolve;
                img.onerror = resolve;
              })
        )
      );
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    })()
  `);
}

async function printThermalLabelsOnWindows({ BrowserWindow, html, deviceName, widthMm, heightMm }) {
  const scale = 3;
  const cssWidthPx = Math.max(60, Math.round(widthMm * (96 / 25.4)));
  const cssHeightPx = Math.max(40, Math.round(heightMm * (96 / 25.4)));
  const pixelWidth = cssWidthPx * scale;
  const pixelHeight = cssHeightPx * scale;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-thermal-label-'));
  let printWin = null;

  try {
    printWin = await createOffscreenRenderWindow(BrowserWindow, html, pixelWidth, pixelHeight, scale);
    await waitForFontsAndImages(printWin);

    const layoutInfo = await printWin.webContents.executeJavaScript(`
      (async () => {
        document.documentElement.style.cssText = 'margin:0!important;padding:0!important;overflow:hidden!important;background:#fff!important;';
        document.body.style.cssText = 'margin:0!important;padding:0!important;overflow:hidden!important;background:#fff!important;';
        const shell = document.querySelector('.print-shell');
        if (shell) shell.style.cssText = 'margin:0!important;padding:0!important;width:100%!important;max-width:100%!important;';
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
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          })()
        `);
      }
      await new Promise((r) => setTimeout(r, u === 0 ? 100 : 45));
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
      if (printWin && !printWin.isDestroyed()) printWin.destroy();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

async function printThermalReceiptOnWindows({ BrowserWindow, html, deviceName, receiptWidthMm = 80 }) {
  const is58 = Number(receiptWidthMm) === 58;
  const printableWidthMm = is58 ? 48 : 72;
  const maxPaperMm = printableWidthMm;
  const scale = 3;
  const cssWidthPx = Math.max(120, Math.round(printableWidthMm * (96 / 25.4)));
  const pixelWidth = cssWidthPx * scale;
  const maxSingleSliceCssPx = 2200;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-thermal-receipt-'));
  let printWin = null;

  try {
    printWin = await createOffscreenRenderWindow(BrowserWindow, html, pixelWidth, 1200, scale);
    await printWin.webContents.executeJavaScript(`
      (() => {
        const s = document.createElement('style');
        s.textContent = [
          'html, body { margin: 0 !important; padding: 0 !important; width: 100% !important; max-width: 100% !important; background: #fff !important; overflow-x: hidden !important; }',
          '.print-shell, .thermal-receipt-container { width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 1.5mm 2mm !important; box-sizing: border-box !important; }',
          '.receipt-cut-separator { display: none !important; }'
        ].join('\\n');
        document.head.appendChild(s);
      })()
    `);
    await waitForFontsAndImages(printWin);

    const copyInfo = await printWin.webContents.executeJavaScript(`
      (() => {
        const cust = document.querySelector('.receipt-copy-customer');
        const merch = document.querySelector('.receipt-copy-merchant');
        return { hasDualCopies: Boolean(cust && merch) };
      })()
    `);

    const captureTargets = copyInfo.hasDualCopies ? ['customer', 'merchant'] : ['all'];
    const imageFiles = [];

    for (let t = 0; t < captureTargets.length; t += 1) {
      const target = captureTargets[t];
      const totalCssH = await printWin.webContents.executeJavaScript(`
        (async () => {
          const cust = document.querySelector('.receipt-copy-customer');
          const merch = document.querySelector('.receipt-copy-merchant');
          if (cust && merch) {
            cust.style.display = ${target === 'merchant' ? "'none'" : "'block'"};
            merch.style.display = ${target === 'customer' ? "'none'" : "'block'"};
          }
          document.body.style.transform = '';
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          return Math.max(40, Math.ceil(document.documentElement.scrollHeight));
        })()
      `);

      let offsetCss = 0;
      let bandIdx = 0;
      while (offsetCss < totalCssH) {
        const sliceCssH = Math.min(maxSingleSliceCssPx, totalCssH - offsetCss);
        const slicePixelH = Math.max(30, Math.ceil(sliceCssH * scale));
        printWin.setContentSize(pixelWidth, slicePixelH);
        await printWin.webContents.executeJavaScript(`
          (async () => {
            document.body.style.transform = 'translateY(-${offsetCss}px)';
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          })()
        `);
        await new Promise((r) => setTimeout(r, t === 0 && bandIdx === 0 ? 90 : 45));
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
      if (printWin && !printWin.isDestroyed()) printWin.destroy();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

module.exports = {
  printThermalLabelsOnWindows,
  printThermalReceiptOnWindows,
};
