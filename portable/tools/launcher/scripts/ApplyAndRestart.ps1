<#
.SYNOPSIS
  Applies a pending ZS update and restarts the backend process automatically.

.DESCRIPTION
  This script is spawned as a DETACHED process by the NestJS backend just before
  it calls process.exit(0) to trigger a self-update.

  Supports two modes:
    - Portable mode  : electronExePath NOT set in pending -> restarts Node.js backend.
    - Electron mode  : electronExePath IS set in pending  -> restarts the Electron EXE.

.NOTES
  - Called automatically by the backend via child_process.spawn (detached, stdio: ignore).
  - Safe to re-run if it fails partway (the .update_pending marker persists until success).
#>

param(
  [Parameter(Mandatory = $true)][string]$PortableRoot,
  [string]$NodeExe       = '',
  [string]$BackendCwd    = '',
  [string]$BackendEntry  = 'dist/main.js',
  [string]$BackendPort   = '3001',
  [int]$WaitBeforeApplySecs = 4
)

New-Item -ItemType Directory -Path (Join-Path $PortableRoot 'runtime\logs') -Force | Out-Null
$entryLog = Join-Path $PortableRoot 'runtime\logs\ps-entry.log'
"ENTERED SCRIPT $(Get-Date)" | Out-File $entryLog -Append -Encoding utf8

$ErrorActionPreference = 'Stop'

# ── Log setup ─────────────────────────────────────────────────────────────────
$runtimeRunDir  = Join-Path $PortableRoot 'runtime\run'
$runtimeLogsDir = Join-Path $PortableRoot 'runtime\logs'
if (-not (Test-Path $runtimeLogsDir)) {
  New-Item -ItemType Directory -Path $runtimeLogsDir -Force | Out-Null
}
$logFile = Join-Path $runtimeLogsDir 'launcher-apply-restart.log'

function Write-Log {
  param([string]$Msg)
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Msg"
  Add-Content -Path $logFile -Value $line -Encoding UTF8
  Write-Host "[ZS-ApplyRestart] $Msg"
}

function Ensure-Dir {
  param([string]$DirPath)
  if (-not (Test-Path $DirPath)) {
    New-Item -ItemType Directory -Path $DirPath -Force | Out-Null
  }
}

# ── Wait for backend to exit ──────────────────────────────────────────────────
Write-Log "ApplyAndRestart started. Waiting ${WaitBeforeApplySecs}s for backend to exit..."
Start-Sleep -Seconds $WaitBeforeApplySecs

# ── Read the pending marker ───────────────────────────────────────────────────
$pendingFile = Join-Path $runtimeRunDir '.update_pending'
if (-not (Test-Path $pendingFile)) {
  Write-Log 'No .update_pending found. Nothing to do.'
  exit 0
}

$pending = Get-Content -Path $pendingFile -Raw -Encoding utf8 | ConvertFrom-Json

$version        = $pending.version
$patchUrl       = ''
$localPatchPath = ''

if ($pending.PSObject.Properties['patchUrl'] -and $pending.patchUrl) {
  $patchUrl = $pending.patchUrl
}
if ($pending.PSObject.Properties['localPatchPath'] -and $pending.localPatchPath) {
  $localPatchPath = $pending.localPatchPath
}

# Override params with values from the pending file
if ($pending.PSObject.Properties['nodeExe']      -and $pending.nodeExe)      { $NodeExe      = $pending.nodeExe }
if ($pending.PSObject.Properties['backendCwd']   -and $pending.backendCwd)   { $BackendCwd   = $pending.backendCwd }
if ($pending.PSObject.Properties['backendEntry'] -and $pending.backendEntry) { $BackendEntry = $pending.backendEntry }
if ($pending.PSObject.Properties['backendPort']  -and $pending.backendPort)  { $BackendPort  = $pending.backendPort }

# ── Detect Electron mode ──────────────────────────────────────────────────────
$electronExePath = ''
if ($pending.PSObject.Properties['electronExePath'] -and $pending.electronExePath) {
  $electronExePath = $pending.electronExePath
}
$isElectronMode = (-not [string]::IsNullOrWhiteSpace($electronExePath)) -and (Test-Path $electronExePath)
Write-Log "Mode: $(if ($isElectronMode) { 'Electron' } else { 'Portable' })"

# A fixed delay is not proof that Electron has released app.asar and the
# PostgreSQL cluster. Wait for the exact parent process that requested update.
$previousElectronPid = 0
if ($pending.PSObject.Properties['electronMainPid'] -and $pending.electronMainPid) {
  $previousElectronPid = [int]$pending.electronMainPid
}
if ($isElectronMode -and $previousElectronPid -gt 0) {
  Write-Log "Waiting for previous Electron PID $previousElectronPid to exit..."
  try {
    Wait-Process -Id $previousElectronPid -Timeout 45 -ErrorAction Stop
  } catch {
    if (Get-Process -Id $previousElectronPid -ErrorAction SilentlyContinue) {
      Write-Log 'ERROR: Previous Electron still owns the application files; refusing to apply update.'
      Remove-Item -Path $pendingFile -Force -ErrorAction SilentlyContinue
      exit 1
    }
  }
  Write-Log 'Previous Electron process released its application files.'
}

function Abort-BeforeApply([string]$Message) {
  Write-Log "Update cancelled before changing application files: $Message"
  Remove-Item -Path $pendingFile -Force -ErrorAction SilentlyContinue
  if ($isElectronMode -and (Test-Path $electronExePath)) {
    Write-Log 'Reopening the previous, unchanged Electron application.'
    Start-Process -FilePath $electronExePath -WorkingDirectory $PortableRoot -WindowStyle Normal | Out-Null
  }
  exit 1
}

# ── Build path map ────────────────────────────────────────────────────────────
if ($isElectronMode) {
  $unpackedBase = Join-Path $PortableRoot 'resources\app.asar.unpacked'
  $pathMap = @{
    RuntimeDir     = Join-Path $PortableRoot 'runtime'
    RuntimeRunDir  = $runtimeRunDir
    AppBackendDir  = Join-Path $unpackedBase 'electron\backend'
    AppFrontendDir = Join-Path $unpackedBase 'dist'
    PostgresBinDir = Join-Path $PortableRoot 'runtime\postgres\bin'
    ConfigDir      = ''
    BundledNodeExe = Join-Path $PortableRoot 'runtime\node\node.exe'
  }
} else {
  # Portable mode: source Common.ps1
  . (Join-Path $PortableRoot 'tools\launcher\lib\Common.ps1')
  $cmn = Get-PathMap
  $pathMap = @{
    RuntimeDir     = $cmn.RuntimeDir
    RuntimeRunDir  = $cmn.RuntimeRunDir
    AppBackendDir  = $cmn.AppBackendDir
    AppFrontendDir = $cmn.AppFrontendDir
    PostgresBinDir = $cmn.PostgresBinDir
    ConfigDir      = $cmn.ConfigDir
    BundledNodeExe = $cmn.BundledNodeExe
  }
}

# ── Validate patch source ─────────────────────────────────────────────────────
if ([string]::IsNullOrWhiteSpace($patchUrl) -and [string]::IsNullOrWhiteSpace($localPatchPath)) {
  Abort-BeforeApply 'No patch URL or local patch source was supplied'
}

Write-Log "Applying update to v$version"

# Releases are pinned by the VERSION-SPECIFIC manifest in the trusted GitHub repository.
# Uploaded ZIP files are checked against the operator provisioned digest by NestJS.
$expectedSha256 = ''
if ($pending.PSObject.Properties['expectedSha256'] -and $pending.expectedSha256) {
  $expectedSha256 = ([string]$pending.expectedSha256).Trim().ToLowerInvariant()
}
if ([string]::IsNullOrWhiteSpace($localPatchPath)) {
  try {
    $trusted = Invoke-RestMethod -Uri "https://raw.githubusercontent.com/8489mx/zs/main/releases/manifest-$version.json" -TimeoutSec 20
    if ([string]$trusted.version -ne [string]$version) { throw 'Trusted version mismatch' }
    $trustedUrl = [string]$trusted.patchUrl
    if ($trustedUrl -notmatch '^https://github[.]com/8489mx/zs/releases/download/') { throw 'Untrusted release URL' }
    if ($patchUrl -and $patchUrl -ne $trustedUrl) { throw 'Release URL mismatch' }
    $patchUrl = $trustedUrl
    $expectedSha256 = ([string]$trusted.sha256).Trim().ToLowerInvariant()
  } catch {
    Abort-BeforeApply "Official GitHub release manifest verification failed: $($_.Exception.Message)"
  }
}
if ($expectedSha256 -notmatch '^[0-9a-f]{64}$') {
  Abort-BeforeApply 'No trusted SHA256 digest was supplied'
}

# ── Pre-Update Backup ─────────────────────────────────────────────────────────
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $pathMap.RuntimeDir "backups\pre-update-v$version-$timestamp"
Ensure-Dir -DirPath $backupDir

Write-Log "Creating pre-update backup at $backupDir..."
try {
  $backendDistSrc = Join-Path $pathMap.AppBackendDir 'dist'
  if (Test-Path $backendDistSrc) {
    $backendDistDest = Join-Path $backupDir 'backend\dist'
    robocopy $backendDistSrc $backendDistDest /E /IS /IT /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed for backend dist (exit $LASTEXITCODE)" }
  }

  $pkgSrc = Join-Path $pathMap.AppBackendDir 'package.json'
  if (Test-Path $pkgSrc) {
    Ensure-Dir -DirPath (Join-Path $backupDir 'backend')
    Copy-Item -Path $pkgSrc -Destination (Join-Path $backupDir 'backend\package.json') -Force
  }

  $frontendDistSrc = $pathMap.AppFrontendDir
  if (Test-Path $frontendDistSrc) {
    $frontendDistDest = Join-Path $backupDir 'frontend\dist'
    robocopy $frontendDistSrc $frontendDistDest /E /IS /IT /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed for frontend dist (exit $LASTEXITCODE)" }
  }

  # A stopped PostgreSQL cluster can be snapshotted and restored across schema migrations.
  # Protect EVERY table and WAL file, not just the SQL export subset.
  if ($isElectronMode) {
    $dataDir = Join-Path $pathMap.RuntimeDir 'data'
    $pgCtl = Join-Path $pathMap.PostgresBinDir 'pg_ctl.exe'
    if (-not (Test-Path (Join-Path $dataDir 'PG_VERSION')) -or -not (Test-Path $pgCtl)) {
      throw 'PostgreSQL cluster or pg_ctl missing; cannot safely update'
    }
    & $pgCtl -D $dataDir status *> $null
    if ($LASTEXITCODE -eq 0) {
      & $pgCtl -D $dataDir stop -m fast -w *> $null
      if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not stop for snapshot' }
    }
    $clusterBackup = Join-Path $backupDir 'postgres-data'
    robocopy $dataDir $clusterBackup /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8 -or -not (Test-Path (Join-Path $clusterBackup 'PG_VERSION'))) {
      throw "Database snapshot could not be verified (robocopy $LASTEXITCODE)"
    }
    # PostgreSQL auth is stored inside data/ (.postgres-auth.json), with fallback
    # to legacy runtime/.postgres-auth.json so both layouts snapshot and roll back cleanly.
    $dataPgAuthFile = Join-Path $dataDir '.postgres-auth.json'
    $legacyPgAuthFile = Join-Path $pathMap.RuntimeDir '.postgres-auth.json'
    if (Test-Path $dataPgAuthFile) {
      Copy-Item -Path $dataPgAuthFile -Destination (Join-Path $backupDir 'postgres-auth.json') -Force
    } elseif (Test-Path $legacyPgAuthFile) {
      Copy-Item -Path $legacyPgAuthFile -Destination (Join-Path $backupDir 'postgres-auth.json') -Force
    } else {
      Set-Content -Path (Join-Path $backupDir 'postgres-auth.absent') -Value 'not-present-before-update'
    }
    Write-Log 'Complete PostgreSQL cluster and authentication backup verified.'
  } else {
    $pgDump = Join-Path $pathMap.PostgresBinDir 'pg_dump.exe'
    if (Test-Path $pgDump) {
      $envFile = Join-Path $pathMap.ConfigDir '.env.offline'
      if (Test-Path $envFile) {
        $envMap  = Get-EnvMap -EnvFile $envFile
        $dbPort  = Get-EnvValue -EnvMap $envMap -Key 'DB_PORT'     -Default '5432'
        $dbUser  = Get-EnvValue -EnvMap $envMap -Key 'DB_USER'     -Default 'postgres'
        $dbName  = Get-EnvValue -EnvMap $envMap -Key 'DB_NAME'     -Default 'postgres'
        $dbPass  = Get-EnvValue -EnvMap $envMap -Key 'DB_PASSWORD' -Default 'postgres'
        $env:PGPASSWORD = $dbPass
        $dbBackupPath = Join-Path $backupDir 'database.sql'
        & $pgDump -h 127.0.0.1 -p $dbPort -U $dbUser -d $dbName -F c -f $dbBackupPath
        if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit $LASTEXITCODE)" }
        Write-Log 'Database backup completed.'
      }
    }
  }

  Write-Log 'Pre-update backup completed.'
} catch {
  Abort-BeforeApply "Pre-update backup failed: $($_.Exception.Message)"
}

# ── Staging ───────────────────────────────────────────────────────────────────
$stagingDir = Join-Path $pathMap.RuntimeRunDir 'update-staging'
$zipPath    = Join-Path $stagingDir 'patch.zip'
$extractDir = Join-Path $stagingDir 'extracted'
Ensure-Dir -DirPath $stagingDir

if ((-not [string]::IsNullOrWhiteSpace($localPatchPath)) -and (Test-Path $localPatchPath)) {
  Write-Log "Using local patch file: $localPatchPath"
  Copy-Item -Path $localPatchPath -Destination $zipPath -Force
} else {
  Write-Log "Attempting to retrieve patch for v$version..."
  $downloadSuccess = $false

  if (-not [string]::IsNullOrWhiteSpace($patchUrl)) {
    if ($patchUrl -match '8489mx/zs') {
      $patchUrl = $patchUrl -replace '8489mx/zs', '8489mx/zs'
      Write-Log "Auto-corrected repository URL to: $patchUrl"
    }
  } else {
    $patchUrl = "https://github.com/8489mx/zs/releases/download/v$version/Z-ERP-Patch-v$version.zip"
    Write-Log "Using official release URL: $patchUrl"
  }

  $urlsToTry = @($patchUrl, "https://github.com/8489mx/zs/releases/download/v$version/Z-ERP-Patch-v$version.zip") | Select-Object -Unique

  foreach ($currentUrl in $urlsToTry) {
    if ($downloadSuccess) { break }
    try {
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      Write-Log "Downloading from $currentUrl ..."
      $webClient = New-Object System.Net.WebClient
      $webClient.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Z-ERP-Desktop-Updater')
      $webClient.DownloadFile($currentUrl, $zipPath)
      if ((Test-Path $zipPath) -and ((Get-Item $zipPath).Length -gt 100000)) {
        $sizeMB = [Math]::Round((Get-Item $zipPath).Length / 1MB, 2)
        Write-Log "WebClient download complete ($sizeMB MB)"
        $downloadSuccess = $true
        break
      }
    } catch {
      Write-Log "Notice: WebClient download failed ($($_.Exception.Message)), trying Invoke-WebRequest..."
      try {
        Invoke-WebRequest -Uri $currentUrl -OutFile $zipPath -UseBasicParsing -TimeoutSec 300 -Headers @{ 'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Z-ERP-Desktop-Updater' }
        if ((Test-Path $zipPath) -and ((Get-Item $zipPath).Length -gt 100000)) {
          $sizeMB = [Math]::Round((Get-Item $zipPath).Length / 1MB, 2)
          Write-Log "Invoke-WebRequest download complete ($sizeMB MB)"
          $downloadSuccess = $true
          break
        }
      } catch {
        Write-Log "Notice: Download from $currentUrl failed ($($_.Exception.Message))"
      }
    }
  }

  if (-not $downloadSuccess) {
    $fallbackLocal = @(
      (Join-Path $PortableRoot "..\updates\Z-ERP-Patch-v$version.zip"),
      (Join-Path $PortableRoot "updates\Z-ERP-Patch-v$version.zip"),
      (Join-Path $PortableRoot "runtime\run\update-staging\manual-patch.zip"),
      "D:\zn\release\updates\Z-ERP-Patch-v$version.zip"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1

    if ($fallbackLocal) {
      Write-Log "Found local patch archive: $fallbackLocal"
      Copy-Item -Path $fallbackLocal -Destination $zipPath -Force
    } else {
      Write-Log "ERROR: No patch archive found (download failed and no local patch available)."
      Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue
      Abort-BeforeApply 'Release could not be downloaded or found locally'
    }
  }
}

# Validate every byte before extracting any executable or applying any migration.
if (-not (Test-Path $zipPath)) { Abort-BeforeApply 'Release ZIP missing' }
$receivedSha256 = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($receivedSha256 -ne $expectedSha256) {
  Write-Log "ERROR: SHA256 mismatch. Expected $expectedSha256 but got $receivedSha256."
  Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue
  Abort-BeforeApply 'Release SHA256 mismatch'
}
Write-Log 'SHA256 of downloaded release verified.'

# ── Extract and Apply ─────────────────────────────────────────────────────────
$applySuccess = $false
try {
  Write-Log 'Extracting ZIP...'
  if (Test-Path $extractDir) { Remove-Item -Path $extractDir -Recurse -Force }
  Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
  Write-Log 'Extraction complete.'

  # Check the release's own file list, layout, and path traversal before copying.
  $manifestFile = Join-Path $extractDir 'update-manifest.json'
  if (-not (Test-Path $manifestFile)) { throw 'update-manifest.json missing' }
  $manifest = Get-Content $manifestFile -Raw | ConvertFrom-Json
  if ([string]$manifest.version -ne [string]$version) { throw 'ZIP version differs from release' }
  if (-not $manifest.files -or $manifest.files.Count -lt 3) { throw 'ZIP manifest contains no file hashes' }
  $safeRoot = [IO.Path]::GetFullPath($extractDir).TrimEnd('\') + '\'
  foreach ($f in $manifest.files) {
    $rel = [string]$f.path
    if (-not $rel -or $rel -match '(^[\\/]|^[A-Za-z]:|(^|[\\/])[.][.]([\\/]|$))') { throw "Unsafe archive path: $rel" }
    $filePath = [IO.Path]::GetFullPath((Join-Path $extractDir ($rel -replace '/', '\')))
    if (-not $filePath.StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Path traversal: $rel" }
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) { throw "Missing patch file: $rel" }
    if ((Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne ([string]$f.sha256).ToLowerInvariant()) {
      throw "Patch checksum mismatch: $rel"
    }
  }
  if (-not (Test-Path (Join-Path $extractDir 'backend\dist\main.js')) -or
      -not (Test-Path (Join-Path $extractDir 'frontend\dist\index.html')) -or
      -not (Test-Path (Join-Path $extractDir 'backend\package.json'))) {
    throw 'The patch is missing the backend or frontend executable'
  }
  Write-Log 'Complete update manifest verified.'

  # ── Copy backend/dist ─────────────────────────────────────────────────────────
  $srcBackend = $null
  $candidates = @(
    (Join-Path $extractDir 'backend\dist'),
    (Join-Path $extractDir 'backend/dist')
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { $srcBackend = $c; break }
  }

  if ($srcBackend) {
    $destBackend = Join-Path $pathMap.AppBackendDir 'dist'
    Write-Log "Copying backend/dist -> $destBackend"
    robocopy $srcBackend $destBackend /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed for backend dist (exit $LASTEXITCODE)" }
    Write-Log 'backend/dist applied.'
  } else {
    throw 'backend/dist not found in patch.'
  }

  # ── Copy backend/package.json ─────────────────────────────────────────────────
  $srcPkg = $null
  $pkgCandidates = @(
    (Join-Path $extractDir 'backend\package.json'),
    (Join-Path $extractDir 'backend/package.json')
  )
  foreach ($c in $pkgCandidates) {
    if (Test-Path $c) { $srcPkg = $c; break }
  }

  if ($srcPkg) {
    $destPkg = Join-Path $pathMap.AppBackendDir 'package.json'
    Copy-Item -Path $srcPkg -Destination $destPkg -Force -ErrorAction Stop
    Write-Log 'backend/package.json updated.'
  } else {
    throw 'backend/package.json not found in patch.'
  }

  # ── Copy frontend/dist ────────────────────────────────────────────────────────
  $srcFrontend = $null
  $frontendCandidates = @(
    (Join-Path $extractDir 'frontend\dist'),
    (Join-Path $extractDir 'frontend/dist')
  )
  foreach ($c in $frontendCandidates) {
    if (Test-Path $c) { $srcFrontend = $c; break }
  }

  if ($srcFrontend) {
    $destFrontend = $pathMap.AppFrontendDir
    Write-Log "Copying frontend/dist -> $destFrontend"
    robocopy $srcFrontend $destFrontend /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed for frontend dist (exit $LASTEXITCODE)" }
    Write-Log 'frontend/dist applied.'

    # Update loading.html in electron resources if present in patch
    $srcLoading = Join-Path $extractDir 'frontend\electron\loading.html'
    if (-not (Test-Path $srcLoading)) {
      $srcLoading = Join-Path $extractDir 'frontend\dist\loading.html'
    }
    if (Test-Path $srcLoading) {
      if ($isElectronMode) {
        $destLoading1 = Join-Path $pathMap.AppFrontendDir 'loading.html'
        Copy-Item -Path $srcLoading -Destination $destLoading1 -Force -ErrorAction SilentlyContinue

        $destLoading2 = Join-Path $pathMap.AppFrontendDir '..\electron\loading.html'
        if (Test-Path (Split-Path $destLoading2)) {
          Copy-Item -Path $srcLoading -Destination $destLoading2 -Force -ErrorAction SilentlyContinue
        }

        $destLoading3 = Join-Path $portableRoot 'resources\loading.html'
        if (Test-Path (Split-Path $destLoading3)) {
          Copy-Item -Path $srcLoading -Destination $destLoading3 -Force -ErrorAction SilentlyContinue
        }
        Write-Log 'loading.html updated in Electron resources and dist.'
      }
    }
  } else {
    throw 'frontend/dist not found in patch.'
  }

  # ── Update ZMT maintenance scripts if present in patch ───────────────────────
  $srcZmt = Join-Path $extractDir 'zmt.bat'
  if (Test-Path $srcZmt) {
    Copy-Item -Path $srcZmt -Destination (Join-Path $PortableRoot 'zmt.bat') -Force -ErrorAction SilentlyContinue
    Write-Log 'zmt.bat updated.'
  }
  $srcZmtScripts = Join-Path $extractDir 'scripts'
  if (Test-Path $srcZmtScripts) {
    $destScripts = Join-Path $PortableRoot 'scripts'
    Ensure-Dir -DirPath $destScripts
    Copy-Item -Path (Join-Path $srcZmtScripts '*') -Destination $destScripts -Recurse -Force -ErrorAction SilentlyContinue
    Write-Log 'scripts/zmt.* updated.'
  }

  # ── Run database migrations (portable mode only) ──────────────────────────────
  if (-not $isElectronMode) {
    Write-Log 'Running database migrations...'
    $envFile = Join-Path $pathMap.ConfigDir '.env.offline'
    if (Test-Path $envFile) {
      $envMap = Get-EnvMap -EnvFile $envFile
      Export-EnvMap -EnvMap $envMap
      $migrationCmd = Resolve-MigrationCommand -Paths $cmn -EnvMap $envMap
      if ($migrationCmd) {
        $migrationOutput = Invoke-BackendCommand -Command $migrationCmd -WorkingDirectory $BackendCwd -Label 'Migrations'
        if ($LASTEXITCODE -ne 0) {
          throw "Database migrations failed (exit $LASTEXITCODE)."
        }
        Write-Log 'Migrations complete.'
      }
    }
  } else {
    # Electron automatically runs database migrations. A patch is NOT successful until
    # the new backend has started and /health/ready returns HTTP 200.
    Write-Log 'Starting patched Electron for migration + health verification...'
    $newProc = Start-Process -FilePath $electronExePath -WorkingDirectory $PortableRoot -WindowStyle Normal -PassThru
    $healthUrl = "http://127.0.0.1:$BackendPort/health/ready"
    $healthy = $false
    $deadline = (Get-Date).AddSeconds(150)
    while ((Get-Date) -lt $deadline) {
      $newProc.Refresh()
      if ($newProc.HasExited) { break }
      try {
        $check = Invoke-WebRequest -Uri $healthUrl -Method Get -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ([int]$check.StatusCode -eq 200) { $healthy = $true; break }
      } catch {}
      Start-Sleep -Milliseconds 800
    }
    if (-not $healthy) {
      Write-Log 'New Electron release did not become healthy; reverting code and database.'
      $newProc.Refresh()
      if (-not $newProc.HasExited) { taskkill /PID $newProc.Id /T /F *> $null }
      $pgCtl = Join-Path $pathMap.PostgresBinDir 'pg_ctl.exe'
      & $pgCtl -D (Join-Path $pathMap.RuntimeDir 'data') stop -m immediate -w *> $null
      throw 'Electron failed to pass backend and migration readiness'
    }
    Write-Log 'Patched Electron and PostgreSQL migrations passed HTTP readiness.'
  }

  $applySuccess = $true

} catch {
  Write-Log "ERROR: Update application failed: $($_.Exception.Message)"
}

$rollbackOk = $true
if (-not $applySuccess) {
  Write-Log "Initiating Rollback from $backupDir ..."
  try {
    if (Test-Path (Join-Path $backupDir 'backend\dist')) {
       robocopy (Join-Path $backupDir 'backend\dist') (Join-Path $pathMap.AppBackendDir 'dist') /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
       if ($LASTEXITCODE -ge 8) { throw "Backend rollback failed ($LASTEXITCODE)" }
    }
    if (Test-Path (Join-Path $backupDir 'backend\package.json')) {
       Copy-Item (Join-Path $backupDir 'backend\package.json') (Join-Path $pathMap.AppBackendDir 'package.json') -Force
    }
    if (Test-Path (Join-Path $backupDir 'frontend\dist')) {
       robocopy (Join-Path $backupDir 'frontend\dist') $pathMap.AppFrontendDir /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
       if ($LASTEXITCODE -ge 8) { throw "Frontend rollback failed ($LASTEXITCODE)" }
    }
    if ($isElectronMode) {
      $clusterBackup = Join-Path $backupDir 'postgres-data'
      $dbData = Join-Path $pathMap.RuntimeDir 'data'
      if (-not (Test-Path (Join-Path $clusterBackup 'PG_VERSION'))) {
        throw 'Cannot restore prior version: PostgreSQL snapshot missing'
      }
      $pgCtl = Join-Path $pathMap.PostgresBinDir 'pg_ctl.exe'
      & $pgCtl -D $dbData stop -m immediate -w *> $null
      robocopy $clusterBackup $dbData /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
      if ($LASTEXITCODE -ge 8) { throw "PostgreSQL rollback failed ($LASTEXITCODE)" }
      $originalPgAuth = Join-Path $backupDir 'postgres-auth.json'
      $dataPgAuthDest = Join-Path $dbData '.postgres-auth.json'
      $legacyPgAuthDest = Join-Path $pathMap.RuntimeDir '.postgres-auth.json'
      if (Test-Path $originalPgAuth) {
        if (Test-Path (Join-Path $clusterBackup '.postgres-auth.json')) {
          Copy-Item -Path $originalPgAuth -Destination $dataPgAuthDest -Force
          Remove-Item -Path $legacyPgAuthDest -Force -ErrorAction SilentlyContinue
        } else {
          Copy-Item -Path $originalPgAuth -Destination $legacyPgAuthDest -Force
          Remove-Item -Path $dataPgAuthDest -Force -ErrorAction SilentlyContinue
        }
      } elseif (Test-Path (Join-Path $backupDir 'postgres-auth.absent')) {
        Remove-Item -Path $dataPgAuthDest -Force -ErrorAction SilentlyContinue
        Remove-Item -Path $legacyPgAuthDest -Force -ErrorAction SilentlyContinue
      } else {
        throw 'PostgreSQL authentication snapshot marker missing; refusing incomplete rollback'
      }
      Write-Log 'Restored complete pre-update PostgreSQL cluster and credentials.'
    } else {
      $dbBackupPath = Join-Path $backupDir 'database.sql'
      if (Test-Path $dbBackupPath) {
        Write-Log "Restoring database from $dbBackupPath ..."
        $pgRestore = Join-Path $pathMap.PostgresBinDir 'pg_restore.exe'
        if (Test-Path $pgRestore) {
          $envFile = Join-Path $pathMap.ConfigDir '.env.offline'
          $envMap  = Get-EnvMap -EnvFile $envFile
          $dbPort  = Get-EnvValue -EnvMap $envMap -Key 'DB_PORT'     -Default '5432'
          $dbUser  = Get-EnvValue -EnvMap $envMap -Key 'DB_USER'     -Default 'postgres'
          $dbName  = Get-EnvValue -EnvMap $envMap -Key 'DB_NAME'     -Default 'postgres'
          $dbPass  = Get-EnvValue -EnvMap $envMap -Key 'DB_PASSWORD' -Default 'postgres'
          $env:PGPASSWORD = $dbPass
          & $pgRestore -h 127.0.0.1 -p $dbPort -U $dbUser -d $dbName --clean --if-exists $dbBackupPath
          Write-Log 'Database restored.'
        }
      }
    }
    Write-Log "Rollback complete. Restarting with previous version..."
  } catch {
    $rollbackOk = $false
    Write-Log "CRITICAL ERROR during rollback: $($_.Exception.Message)"
  }
} else {
  # ── Write version marker ──────────────────────────────────────────────────────
  $versionFile = Join-Path $pathMap.RuntimeRunDir '.app_version'
  Set-Content -Path $versionFile -Value $version -Encoding ascii
  Write-Log "Written .app_version = $version"
  
  # Update the updater itself only after health succeeds; the running script is not
  # replaced until its code and DB are already verified.
  $newUpdater = Join-Path $extractDir 'tools\launcher\scripts\ApplyAndRestart.ps1'
  if (Test-Path $newUpdater) {
    Copy-Item -Path $newUpdater -Destination (Join-Path $PortableRoot 'tools\launcher\scripts\ApplyAndRestart.ps1') -Force
  }
  Remove-Item -Path $pendingFile -Force -ErrorAction SilentlyContinue
}

# ── Restart ───────────────────────────────────────────────────────────────────
if ($isElectronMode) {
  if (-not $applySuccess) {
    # Avoid an endless bad-update retry after successful rollback.
    Remove-Item -Path $pendingFile -Force -ErrorAction SilentlyContinue
    if (-not $rollbackOk) { Write-Log 'ERROR: Rollback incomplete. Manual recovery required.'; exit 1 }
    Write-Log 'Restarting previous working Electron version after rollback.'
    Start-Process -FilePath $electronExePath -WorkingDirectory $PortableRoot -WindowStyle Normal | Out-Null
    exit 1
  }
  Write-Log 'Updated Electron is already running with verified backend readiness.'
} else {
  if ([string]::IsNullOrWhiteSpace($NodeExe) -or -not (Test-Path $NodeExe)) {
    $envFile = Join-Path $pathMap.ConfigDir '.env.offline'
    if (Test-Path $envFile) {
      $envMap  = Get-EnvMap -EnvFile $envFile
      $NodeExe = Resolve-NodeExe -Paths $cmn -EnvMap $envMap
    } else {
      $NodeExe = $pathMap.BundledNodeExe
    }
  }
  if ([string]::IsNullOrWhiteSpace($BackendCwd)) { $BackendCwd = $pathMap.AppBackendDir }

  Write-Log "Starting backend: $NodeExe $BackendEntry (cwd: $BackendCwd)"
  $backendProc = Start-Process `
    -FilePath $NodeExe `
    -WorkingDirectory $BackendCwd `
    -ArgumentList @($BackendEntry) `
    -WindowStyle Hidden `
    -PassThru

  Write-Log "Backend process started (PID: $($backendProc.Id))"

  $healthUrl = "http://127.0.0.1:$BackendPort/health/live"
  Write-Log "Waiting for backend health at $healthUrl ..."
  $deadline = (Get-Date).AddSeconds(120)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri $healthUrl -Method Get -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
      if ([int]$r.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 800
  }
  if ($ready) {
    Write-Log 'Backend is healthy.'
  } else {
    Write-Log 'ERROR: Backend did not become healthy within 120s.'
    exit 1
  }
}

# ── Cleanup ───────────────────────────────────────────────────────────────────
Remove-Item -Path $stagingDir  -Recurse -Force -ErrorAction SilentlyContinue
Write-Log "Update to v$version applied and restarted successfully."
exit 0
