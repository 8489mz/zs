import type { Kysely } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import { BadRequestException } from '@nestjs/common';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { isDesktopRuntimeMode } from '../../../../config/app-mode';
import { getPortableRoot } from './offline-releases-portable-root';
import { expectedPasscodeOrFail } from './offline-releases-passcode';

export class OfflineReleasesApply {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Writes .update_pending marker then spawns ApplyAndRestart.ps1 as a
   * detached process that will: download the patch, apply it, run migrations,
   * and restart the backend — all without any manual user intervention.
   */
  async triggerUpdate(auth: AuthContext) {
    if (!isDesktopRuntimeMode(process.env.APP_MODE)) {
      throw new BadRequestException('Cloud SaaS must never apply desktop updates');
    }
    const active = await this.db
      .selectFrom('offline_releases')
      .selectAll()
      .where('is_active', '=', true)
      .orderBy('promoted_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!active) {
      throw new BadRequestException('لا يوجد إصدار مفعّل حالياً');
    }

    // Resolve paths
    const portableRoot  = getPortableRoot();
    const runtimeRunDir = path.join(portableRoot, 'runtime', 'run');

    try { fs.mkdirSync(runtimeRunDir, { recursive: true }); } catch { /* ignore */ }

    // Write the pending marker with all runtime info the restart script needs
    const pendingFile = path.join(runtimeRunDir, '.update_pending');
    const payload = {
      version:         active.version,
      patchUrl:        active.patch_url,
      changelog:       active.changelog,
      triggeredBy:     auth.username ?? auth.role,
      triggeredAt:     new Date().toISOString(),
      // Runtime context for ApplyAndRestart.ps1
      nodeExe:         process.execPath,
      backendCwd:      process.cwd(),
      backendEntry:    process.argv[1] ?? 'dist/main.js',
      backendPort:     process.env.APP_PORT ?? process.env.BACKEND_PORT ?? '3001',
      electronExePath: process.env.ELECTRON_EXE_PATH || '',
      electronMainPid: Number(process.env.ELECTRON_MAIN_PID || '0'),
    };
    fs.writeFileSync(pendingFile, JSON.stringify(payload, null, 2), 'utf8');

    // Spawn ApplyAndRestart.ps1 as a fully detached process so it survives
    // after this Node.js process exits
    const applyScript = path.join(portableRoot, 'tools', 'launcher', 'scripts', 'ApplyAndRestart.ps1');
    if (fs.existsSync(applyScript)) {
      const ps = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-WindowStyle', 'Hidden', '-File', applyScript, '-PortableRoot', portableRoot],
        { detached: true, stdio: 'ignore', windowsHide: true, cwd: portableRoot },
      );
      if (!ps.pid) throw new BadRequestException('Could not launch the offline updater');
      ps.on('error', (error) => console.error('[OfflineUpdate] Updater launch failed:', error));
      ps.unref();
    }

    // Exit after the HTTP response is sent
    setTimeout(() => process.exit(0), 1500);

    return {
      ok: true,
      message: `جاري تطبيق الإصدار ${active.version} — سيتم إعادة تشغيل التطبيق تلقائياً خلال لحظات`,
      version: active.version,
    };
  }

  /**
   * Called by the local desktop client to apply an update downloaded from SaaS.
   */
  async applyLocalUpdate(body: { version: string; patchUrl: string; changelog: string; passcode?: string }) {
    if (!isDesktopRuntimeMode(process.env.APP_MODE)) {
      throw new BadRequestException('Updates can only be applied in Desktop/Offline mode');
    }

    if (!body.version || !body.patchUrl) {
      throw new BadRequestException('version and patchUrl are required');
    }

    // Validate passcode
    const release = await this.db
      .selectFrom('offline_releases')
      .selectAll()
      .where('version', '=', body.version)
      .executeTakeFirst();

    // Fail closed when no code was ever provisioned for this release.
    if (release?.requires_passcode !== false) {
      const expected = expectedPasscodeOrFail(release?.passcode, body.version);
      const normalizedProvided = (body.passcode || '').replace(/[\s-]+/g, '').toUpperCase();
      const normalizedExpected = expected.replace(/[\s-]+/g, '').toUpperCase();
      if (normalizedProvided !== normalizedExpected) {
        throw new BadRequestException('كود تفعيل التحديث غير صحيح. يرجى التواصل مع إدارة النظام للحصول على كود التفعيل المعتمد.');
      }
    }

    const portableRoot  = getPortableRoot();
    const runtimeRunDir = path.join(portableRoot, 'runtime', 'run');

    try { fs.mkdirSync(runtimeRunDir, { recursive: true }); } catch { /* ignore */ }

    let resolvedLocalPatchPath = '';
    const isOnlineUrl = /^https?:\/\//i.test(body.patchUrl);
    if (!isOnlineUrl) {
      const possibleLocalPatchPaths = [
        path.join(portableRoot, 'updates', `Z-ERP-Patch-v${body.version}.zip`),
        path.join(portableRoot, '..', 'updates', `Z-ERP-Patch-v${body.version}.zip`),
        path.join(portableRoot, 'runtime', 'run', 'update-staging', 'manual-patch.zip'),
      ];
      for (const p of possibleLocalPatchPaths) {
        if (fs.existsSync(p)) {
          resolvedLocalPatchPath = p;
          break;
        }
      }
    }

    const pendingFile = path.join(runtimeRunDir, '.update_pending');
    const payload = {
      version:         body.version,
      patchUrl:        body.patchUrl,
      localPatchPath:  resolvedLocalPatchPath,
      changelog:       body.changelog || '',
      triggeredBy:     'Local User',
      triggeredAt:     new Date().toISOString(),
      nodeExe:         process.execPath,
      backendCwd:      process.cwd(),
      backendEntry:    process.argv[1] ?? 'dist/main.js',
      backendPort:     process.env.APP_PORT ?? process.env.BACKEND_PORT ?? '3001',
      electronExePath: process.env.ELECTRON_EXE_PATH || '',
      electronMainPid: Number(process.env.ELECTRON_MAIN_PID || '0'),
    };
    fs.writeFileSync(pendingFile, JSON.stringify(payload, null, 2), 'utf8');

    const applyScript = path.join(portableRoot, 'tools', 'launcher', 'scripts', 'ApplyAndRestart.ps1');
    if (!fs.existsSync(applyScript)) {
      if (process.env.APP_MODE !== 'SELF_CONTAINED' || process.env.NODE_ENV !== 'production') {
        return {
          ok: true,
          message: `تم فحص وتجهيز التحديث (الإصدار v${body.version}) بنجاح!`,
          version: body.version,
        };
      }
      throw new BadRequestException('ApplyAndRestart.ps1 not found at: ' + applyScript);
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
      localPatchPath: resolvedLocalPatchPath,
      patchUrl: body.patchUrl,
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
      console.log('[OfflineReleasesService] Shutting down before patching any files...');
      process.exit(0);
    }, 1500);

    return {
      ok: true,
      message: `جاري تحميل وتطبيق الإصدار ${body.version} — سيتم إعادة تشغيل التطبيق تلقائياً خلال لحظات`,
      version: body.version,
    };
  }
}
