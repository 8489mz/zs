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
  throw 'No label images to print'
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
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
$doc.OriginAtMargins = $false
$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController

$script:pageIndex = 0
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
  } finally {
    $img.Dispose()
  }

  $script:pageIndex++
  $e.HasMorePages = ($script:pageIndex -lt $files.Count)
})

$doc.Print()
Write-Output "OK:$($files.Count)"
`;

function runPowerShellPrintJob(manifestPath, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const tempScriptPath = path.join(path.dirname(manifestPath), 'spool-labels.ps1');
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
        resolve({ ok: false, error: (stderr || error.message || 'Label print failed').trim() });
      } else {
        resolve({ ok: true, output: (stdout || '').trim() });
      }
    });
  });
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
    printWin = new BrowserWindow({
      show: false,
      width: pixelWidth,
      height: pixelHeight,
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
      const timer = setTimeout(() => reject(new Error('Label render timed out')), 20000);
      printWin.webContents.once('did-fail-load', (_e, code, reason) => {
        clearTimeout(timer);
        reject(new Error(`Label document failed to load (${code}): ${reason}`));
      });
      printWin.webContents.once('did-finish-load', () => {
        clearTimeout(timer);
        resolve();
      });
      printWin
        .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });

    printWin.webContents.setZoomFactor(scale);

    const layoutInfo = await printWin.webContents.executeJavaScript(`
      (async () => {
        document.documentElement.style.cssText = 'margin:0!important;padding:0!important;overflow:hidden!important;background:#fff!important;';
        document.body.style.cssText = 'margin:0!important;padding:0!important;overflow:hidden!important;background:#fff!important;';
        const shell = document.querySelector('.print-shell');
        if (shell) shell.style.cssText = 'margin:0!important;padding:0!important;width:100%!important;max-width:100%!important;';
        const pages = Array.from(document.querySelectorAll('.barcode-print-page-thermal, .barcode-print-page'));
        if (document.fonts && document.fonts.ready) {
          try { await document.fonts.ready; } catch {}
        }
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

module.exports = {
  printThermalLabelsOnWindows,
};
