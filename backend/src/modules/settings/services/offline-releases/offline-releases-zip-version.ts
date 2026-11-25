/// <reference types="multer" />
import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import AdmZip from 'adm-zip';
import { isDesktopRuntimeMode } from '../../../../config/app-mode';
import { getPortableRoot } from './offline-releases-portable-root';
import { assertTrustedOfflineUpdatePackage, expectedPasscodeOrFail } from './offline-releases-passcode';

export class OfflineReleasesZipVersion {
  constructor() {}

  async applyLocalZipUpdate(file: Express.Multer.File, passcode?: string) {
    if (!isDesktopRuntimeMode(process.env.APP_MODE)) {
      throw new BadRequestException('تطبيق التحديثات المباشرة متاح فقط في تطبيق سطح المكتب (Desktop App).');
    }

    if (!file || !file.buffer) {
      throw new BadRequestException('ملف التحديث غير موجود');
    }
    assertTrustedOfflineUpdatePackage(file.buffer, process.env.ZS_TRUSTED_OFFLINE_UPDATE_SHA256);

    // Verify zip structure and security
    let version = 'manual';
    try {
      const zip = new AdmZip(file.buffer);
      const entries = zip.getEntries();
      if (entries.length > 3000) throw new BadRequestException('Update archive contains too many entries');
      let totalExpanded = 0;

      let manifestEntry = null;

      for (const entry of entries) {
        const name = entry.entryName.replace(/\\/g, '/');
        // Apply a strict path policy before downstream PowerShell extracts the archive.
        if (!name || name.startsWith('/') || /^[a-zA-Z]:/.test(name) ||
            name.split('/').some((part) => part === '..' || part === '.') ||
            name.includes('\0') || name.includes('//')) {
          throw new Error('مسار غير آمن في الملف (Path Traversal)');
        }
        const size = Number(entry.header?.size || 0);
        if (!Number.isFinite(size) || size < 0) throw new Error('Invalid ZIP entry size');
        totalExpanded += size;
        if (totalExpanded > 512 * 1024 * 1024) throw new Error('ZIP exceeds maximum expanded size');


        if (name === 'update-manifest.json') manifestEntry = entry;
      }

      if (manifestEntry) {
        const manifestStr = manifestEntry.getData().toString('utf8');
        const manifest = JSON.parse(manifestStr);

        if (!manifest.version) {
          throw new Error('ملف التحديث يحتوي على manifest غير صالح');
        }

        version = manifest.version;

        // Passcode validation for ZIP package (if required by manifest).
        // The expected value is only the code carried inside this pinned
        // package — with no code in the manifest, the gate fails closed.
        if (manifest.requiresPasscode === true || manifest.passcode) {
          const expected = expectedPasscodeOrFail(manifest.passcode ?? null, manifest.version);
          const normalizedProvided = (passcode || '').replace(/[\s-]+/g, '').toUpperCase();
          const normalizedExpected = expected.replace(/[\s-]+/g, '').toUpperCase();
          if (normalizedProvided !== normalizedExpected) {
            throw new BadRequestException('كود تفعيل التحديث غير صحيح. يرجى التواصل مع إدارة النظام للحصول على كود التفعيل المعتمد.');
          }
        }

        // 2. Checksum validation
        for (const f of manifest.files || []) {
          const fileEntry = zip.getEntry(f.path) || zip.getEntry(f.path.replace(/\//g, '\\'));
          if (!fileEntry) throw new Error(`الملف المذكور في manifest غير موجود: ${f.path}`);

          const hash = crypto.createHash('sha256').update(fileEntry.getData()).digest('hex');
          if (hash !== f.sha256) {
             throw new Error(`الملف ${f.path} تالف أو تم التلاعب به (Checksum Mismatch)`);
          }
        }

        // 3. Expected structure validation
        for (const folder of manifest.expectedFolders || []) {
          let found = false;
          for (const entry of entries) {
             const name = entry.entryName.replace(/\\/g, '/');
             if (name.startsWith(folder + '/') || name === folder) { found = true; break; }
          }
          if (!found) throw new Error(`المجلد المطلوب ${folder} غير موجود في ملف التحديث`);
        }
      } else {
        // Fallback for zip packages without update-manifest.json
        const pkgEntry = zip.getEntry('backend/package.json') || zip.getEntry('backend\\package.json');
        if (pkgEntry) {
          try {
            const pkgData = JSON.parse(pkgEntry.getData().toString('utf8'));
            version = pkgData.version || 'manual';
          } catch {
            version = 'manual';
          }
        }
      }
    } catch (e: any) {
      throw new BadRequestException(e.message || 'ملف التحديث غير صالح.');
    }

    const portableRoot  = getPortableRoot();
    const stagingDir = path.join(portableRoot, 'runtime', 'run', 'update-staging');

    try { fs.mkdirSync(stagingDir, { recursive: true }); } catch { /* ignore */ }

    const patchPath = path.join(stagingDir, 'manual-patch.zip');
    fs.writeFileSync(patchPath, file.buffer);

    const runtimeRunDir = path.join(portableRoot, 'runtime', 'run');
    const pendingFile = path.join(runtimeRunDir, '.update_pending');

    const payload = {
      version:         version,
      patchUrl:        '',
      localPatchPath:  patchPath,
      changelog:       'اختبار تحديث محلي من 1.1.9 إلى 1.1.9.1',
      triggeredBy:     'Local User',
      triggeredAt:     new Date().toISOString(),
      nodeExe:         process.execPath,
      backendCwd:      process.cwd(),
      backendEntry:    process.argv[1] ?? 'dist/main.js',
      backendPort:     process.env.APP_PORT ?? process.env.BACKEND_PORT ?? '3001',
      electronExePath: process.env.ELECTRON_EXE_PATH || '',
      electronMainPid: Number(process.env.ELECTRON_MAIN_PID || '0'),
      expectedSha256: process.env.ZS_TRUSTED_OFFLINE_UPDATE_SHA256 || '',
    };
    fs.writeFileSync(pendingFile, JSON.stringify(payload, null, 2), 'utf8');

    const applyScript = path.join(portableRoot, 'tools', 'launcher', 'scripts', 'ApplyAndRestart.ps1');
    if (!fs.existsSync(applyScript)) {
      if (process.env.APP_MODE !== 'SELF_CONTAINED' || process.env.NODE_ENV !== 'production') {
        return {
          ok: true,
          message: `تم فحص وتأكيد حزمة التحديث (الإصدار v${version}) بنجاح!`,
          version: version,
        };
      }
      throw new BadRequestException('ApplyAndRestart.ps1 not found at: ' + applyScript);
    }

    if (process.env.NODE_ENV === 'test') {
      return { ok: true, version };
    }

    const logsDir = path.join(portableRoot, 'runtime', 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const spawnLog = path.join(logsDir, 'update-spawn.log');

    // Spawn the detached updater directly. cmd.exe /c start can silently fail
    // due to quoting of Windows paths and is not a reliable handoff for production.
    const psCommand = 'powershell.exe';
    const psArgs = [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-WindowStyle', 'Hidden', '-File', applyScript,
      '-PortableRoot', portableRoot,
    ];

    fs.writeFileSync(spawnLog, JSON.stringify({
      scriptPath: applyScript,
      pendingFilePath: pendingFile,
      localPatchPath: patchPath,
      cwd: process.cwd(),
      command: psCommand + ' ' + psArgs.join(' ')
    }, null, 2), 'utf8');

    const ps = spawn(psCommand, psArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      cwd: portableRoot
    });
    if (!ps.pid) {
      throw new BadRequestException('Could not launch the offline updater process');
    }
    ps.on('error', (error) => console.error('[OfflineUpdate] Updater process launch failed:', error));
    ps.unref();

    setTimeout(() => {
      console.log('[OfflineReleasesService] Shutting down before applying verified ZIP...');
      process.exit(0);
    }, 1500);

    return {
      ok: true,
      message: `جاري تطبيق التحديث المحلي (الإصدار ${version}) — سيتم إغلاق التطبيق لتطبيق التحديث`,
      version: version,
    };
  }

  /**
   * Returns the currently running app version using this priority:
   *
   *  1. runtime/run/.app_version  → written by ApplyAndRestart.ps1 after each auto-update
   *  2. process.cwd()/package.json → the backend's own package.json (always present, no
   *     manual configuration needed — just bump the version before building each release)
   *  3. '0.0.0' as an absolute last resort
   *
   * This means zero manual intervention is required from the developer or client.
   */
  getCurrentVersion(): { version: string } {
    const portableRoot = getPortableRoot();

    // 1. Written by the auto-update script on success
    const versionFile = path.join(portableRoot, 'runtime', 'run', '.app_version');
    try {
      if (fs.existsSync(versionFile)) {
        const ver = fs.readFileSync(versionFile, 'utf8').trim();
        if (ver) return { version: ver };
      }
    } catch { /* ignore */ }

    // 2. Read the backend's own package.json (baked in at build time, always accurate)
    try {
      const pkgPath = path.join(portableRoot, 'resources', 'app.asar.unpacked', 'electron', 'backend', 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
        if (pkg?.version) return { version: pkg.version };
      }
    } catch { /* ignore */ }

    // Fallback for local development if not in portable structure
    try {
      const devPkgPath = path.join(process.cwd(), 'package.json');
      if (fs.existsSync(devPkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(devPkgPath, 'utf8')) as { version?: string };
        if (pkg?.version) return { version: pkg.version };
      }
    } catch { /* ignore */ }

    // 3. Absolute fallback
    return { version: '0.0.0' };
  }
}
