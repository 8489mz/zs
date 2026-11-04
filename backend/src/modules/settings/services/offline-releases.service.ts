/// <reference types="multer" />
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import AdmZip from 'adm-zip';
import { isDesktopRuntimeMode } from '../../../config/app-mode';

export function generateReleasePasscode(version: string): string {
  const clean = version.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
  const h = crypto.createHash('sha256').update(`ZS_SECRET_KEY_${version}_2026_MASTER`).digest('hex').toUpperCase();
  return `ZS-UPD-${clean || '100'}-${h.substring(0, 4)}-${h.substring(4, 8)}`;
}

/** Operator-approved package SHA256: update packages must be pinned out-of-band, never trusted because
 * a user supplied a manifest/passcode in the package itself. */
export function assertTrustedOfflineUpdatePackage(buffer: Buffer, expectedDigest: string | undefined): void {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > 128 * 1024 * 1024) {
    throw new BadRequestException('Update package size exceeds 128 MiB or is empty');
  }
  if (!expectedDigest || !/^[a-f0-9]{64}$/i.test(expectedDigest)) {
    throw new BadRequestException('The trusted update SHA256 must be provisioned on the device');
  }
  const expected = Buffer.from(expectedDigest, 'hex');
  const received = crypto.createHash('sha256').update(buffer).digest();
  if (!crypto.timingSafeEqual(expected, received)) {
    throw new BadRequestException('Update package SHA256 does not match the operator-approved release');
  }
}

/**
 * Update channel (INV-OFFLINE-UPDATE-CHANNEL-ZSUPDATES): desktop
 * clients read the PUBLIC releases-only repository 8489mx/zsupdates,
 * because the zs source repository went private and is unreachable
 * unauthenticated. Every channel URL is built from the single repo
 * value below so a future channel move touches one place. Operators
 * may re-point the channel with ZS_OFFLINE_UPDATE_REPO; the SHA-256
 * pin above is unaffected by the channel value. The manifest is
 * expected on the `main` branch of the channel repo.
 */
export const OFFLINE_UPDATE_REPO_DEFAULT = '8489mx/zsupdates';

export function offlineUpdateRepo(): string {
  const override = String(process.env.ZS_OFFLINE_UPDATE_REPO || '').trim();
  return override || OFFLINE_UPDATE_REPO_DEFAULT;
}

export function offlineUpdateManifestUrl(): string {
  return `https://raw.githubusercontent.com/${offlineUpdateRepo()}/main/releases/manifest-latest.json`;
}

export function offlineUpdateReleasesApiUrl(): string {
  return `https://api.github.com/repos/${offlineUpdateRepo()}/releases/latest`;
}

export function offlineUpdateReleaseDownloadUrl(version: string, fileName: string): string {
  const clean = String(version || '').replace(/^v/, '');
  return `https://github.com/${offlineUpdateRepo()}/releases/download/v${clean}/${fileName}`;
}

export function compareSemver(v1: string, v2: string): number {
  const p1 = (v1 || '0.0.0').replace(/^[vV]/, '').split('.').map(Number);
  const p2 = (v2 || '0.0.0').replace(/^[vV]/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const a = p1[i] || 0;
    const b = p2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

/**
 * Determines the portable/Electron root directory.
 * - In Electron mode: ELECTRON_EXE_PATH env is set by main.cjs → use its directory.
 * - In portable mode: CWD is app/backend → go 2 levels up.
 */
function getPortableRoot(): string {
  if (process.env.ELECTRON_EXE_PATH) {
    return path.dirname(process.env.ELECTRON_EXE_PATH);
  }
  return path.resolve(process.cwd(), '../..');
}

@Injectable()
export class OfflineReleasesService implements OnModuleInit {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async onModuleInit() {
    await this.syncManifestsFromDisk().catch((err) => {
      console.warn('[OfflineReleasesService] Auto-sync manifests warning:', err?.message);
    });
  }

  /**
   * Automatically scans runtime/releases/ for manifest-*.json files
   * and ensures all released versions are in the offline_releases table,
   * activating the latest semver version automatically without manual SaaS entry!
   */
  async syncManifestsFromDisk() {
    const searchDirs = [
      path.resolve(process.cwd(), 'releases'),
      path.resolve(process.cwd(), '../releases'),
      path.resolve(process.cwd(), 'runtime/releases'),
      path.resolve(process.cwd(), 'backend/runtime/releases'),
      path.resolve(__dirname, '../../../../releases'),
      path.resolve(__dirname, '../../../../runtime/releases'),
      path.resolve(__dirname, '../../../../../releases'),
      path.resolve(__dirname, '../../../../../runtime/releases'),
      'D:/zn/releases',
      'D:/zn/backend/runtime/releases',
    ];

    const foundManifests: Array<{ version: string; changelog: string; passcode?: string; requiresPasscode?: boolean; generatedAt?: string; patchUrl?: string }> = [];

    for (const dir of searchDirs) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter(f => f.startsWith('manifest-') && f.endsWith('.json'));
        for (const file of files) {
          try {
            const raw = fs.readFileSync(path.join(dir, file), 'utf8').trim().replace(/^\uFEFF/, '');
            const content = JSON.parse(raw);
            if (content.version) {
              foundManifests.push(content);
            }
          } catch {
            // ignore bad json
          }
        }
      }
    }

    if (foundManifests.length === 0) return;

    // Deduplicate by version
    const uniqueByVersion = new Map<string, typeof foundManifests[0]>();
    for (const m of foundManifests) {
      uniqueByVersion.set(m.version, m);
    }

    const sortedManifests = Array.from(uniqueByVersion.values()).sort((a, b) => compareSemver(b.version, a.version));
    const latestVersion = sortedManifests[0]?.version;

    for (const m of sortedManifests) {
      const existing = await this.db
        .selectFrom('offline_releases')
        .selectAll()
        .where('version', '=', m.version)
        .executeTakeFirst();

      const isLatest = m.version === latestVersion;
      const passcode = m.passcode || generateReleasePasscode(m.version);
      const patchUrl = m.patchUrl || `/downloads/updates/Z-ERP-Patch-v${m.version}.zip`;

      if (!existing) {
        if (isLatest) {
          await this.db
            .updateTable('offline_releases')
            .set({ is_active: false })
            .where('is_active', '=', true)
            .execute();
        }
        await this.db
          .insertInto('offline_releases')
          .values({
            version: m.version,
            changelog: m.changelog,
            patch_url: patchUrl,
            passcode: passcode,
            requires_passcode: m.requiresPasscode ?? true,
            is_active: isLatest,
            promoted_by: '1',
            promoted_at: m.generatedAt ? new Date(m.generatedAt).toISOString() : new Date().toISOString(),
            created_at: new Date().toISOString(),
          })
          .execute();
      } else {
        if (isLatest && !existing.is_active) {
          await this.db
            .updateTable('offline_releases')
            .set({ is_active: false })
            .where('is_active', '=', true)
            .execute();

          await this.db
            .updateTable('offline_releases')
            .set({ is_active: true, passcode: passcode })
            .where('id', '=', existing.id)
            .execute();
        }
      }
    }
  }

  // ─── GitHub Cloud Updates ──────────────────────────────────────────────────

  async fetchGitHubLatestRelease(): Promise<{
    version: string;
    changelog: string;
    patchUrl: string;
    passcode?: string;
  } | null> {
    try {
      // 1. Try raw manifest-latest.json from the update-channel repo
      const rawUrl = offlineUpdateManifestUrl();
      const rawRes = await fetch(rawUrl, {
        headers: { 'User-Agent': 'Z-ERP-Desktop-Client' },
        signal: AbortSignal.timeout(4000),
      });

      if (rawRes.ok) {
        const manifest = (await rawRes.json()) as any;
        if (manifest?.version && manifest.version !== '0.0.0') {
          return {
            version: manifest.version,
            changelog: manifest.changelog || 'تحديث شامل للنظام متوفر على GitHub.',
            patchUrl: manifest.patchUrl || offlineUpdateReleaseDownloadUrl(manifest.version, `Z-ERP-Patch-v${manifest.version}.zip`),
            passcode: manifest.passcode,
          };
        }
      }
    } catch {
      // Offline or GitHub raw unreachable
    }

    try {
      // 2. Fallback to GitHub Releases API
      const apiUrl = offlineUpdateReleasesApiUrl();
      const apiRes = await fetch(apiUrl, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Z-ERP-Desktop-Client',
        },
        signal: AbortSignal.timeout(4000),
      });

      if (apiRes.ok) {
        const data = (await apiRes.json()) as any;
        const tag = (data.tag_name || '').replace(/^v/, '').trim();
        if (tag) {
          const zipAsset = (data.assets || []).find((a: any) =>
            a.name?.endsWith('.zip'),
          );
          return {
            version: tag,
            changelog: data.body || 'تحديث جديد عبر GitHub Releases.',
            patchUrl:
              zipAsset?.browser_download_url ||
              offlineUpdateReleaseDownloadUrl(tag, `patch-${tag}.zip`),
          };
        }
      }
    } catch {
      // Fallback silently
    }

    return null;
  }

  // ─── Public ───────────────────────────────────────────────────────────────

  /**
   * Called by offline portable clients on startup.
   * Returns the latest active release if it is newer than the client's current version,
   * along with the cumulative changelog of all releases between current and target.
   */
  async checkForUpdate(currentVersion: string) {
    // 1. Ensure manifests are synced from local disk
    await this.syncManifestsFromDisk().catch(() => {});

    // 2. Query GitHub Cloud for latest remote release
    const ghRelease = await this.fetchGitHubLatestRelease().catch(() => null);
    if (ghRelease && ghRelease.version) {
      const isNewerThanCurrent = compareSemver(ghRelease.version, currentVersion) > 0;
      if (isNewerThanCurrent) {
        const existing = await this.db
          .selectFrom('offline_releases')
          .selectAll()
          .where('version', '=', ghRelease.version)
          .executeTakeFirst();

        const passcode = ghRelease.passcode || generateReleasePasscode(ghRelease.version);

        if (!existing) {
          await this.db
            .updateTable('offline_releases')
            .set({ is_active: false })
            .where('is_active', '=', true)
            .execute();

          await this.db
            .insertInto('offline_releases')
            .values({
              version: ghRelease.version,
              changelog: ghRelease.changelog,
              patch_url: ghRelease.patchUrl,
              passcode: passcode,
              requires_passcode: true,
              is_active: true,
              promoted_by: 'GitHub Cloud',
              promoted_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
            })
            .execute();
        } else if (!existing.is_active) {
          await this.db
            .updateTable('offline_releases')
            .set({ is_active: false })
            .where('is_active', '=', true)
            .execute();

          await this.db
            .updateTable('offline_releases')
            .set({
              is_active: true,
              patch_url: ghRelease.patchUrl,
              changelog: ghRelease.changelog,
              passcode: passcode,
            })
            .where('id', '=', existing.id)
            .execute();
        }
      }
    }

    const active = await this.db
      .selectFrom('offline_releases')
      .selectAll()
      .where('is_active', '=', true)
      .orderBy('promoted_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    const history = await this.listReleaseHistory();

    if (!active) {
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: null,
        patchUrl: null,
        changelog: null,
        cumulativeChangelog: null,
        requiresPasscode: false,
        releases: history,
      };
    }

    const isNewer = compareSemver(active.version, currentVersion) > 0;

    if (!isNewer) {
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: active.version,
        patchUrl: null,
        changelog: null,
        cumulativeChangelog: null,
        requiresPasscode: active.requires_passcode ?? true,
        releases: history,
      };
    }

    // Build cumulative changelog from all intermediate releases
    const allApproved = await this.db
      .selectFrom('offline_releases')
      .selectAll()
      .where('promoted_at', 'is not', null)
      .orderBy('promoted_at', 'desc')
      .execute();

    const intermediate = allApproved.filter((r) => compareSemver(r.version, currentVersion) > 0);
    const cumulativeChangelog = intermediate
      .map((r) => {
        const dateStr = r.promoted_at ? new Date(r.promoted_at).toLocaleDateString('ar-EG') : '';
        return `### 📦 الإصدار ${r.version} ${dateStr ? `(${dateStr})` : ''}\n${r.changelog || 'تحسينات عامة على أداء واستقرار النظام.'}`;
      })
      .join('\n\n---\n\n');

    return {
      updateAvailable: true,
      currentVersion,
      latestVersion: active.version,
      patchUrl: active.patch_url,
      changelog: active.changelog,
      cumulativeChangelog: cumulativeChangelog || active.changelog,
      requiresPasscode: active.requires_passcode ?? true,
      releases: history,
    };
  }

  async listReleaseHistory() {
    await this.syncManifestsFromDisk().catch(() => {});

    const rows = await this.db
      .selectFrom('offline_releases')
      .selectAll()
      .execute();

    const isDev = process.env.NODE_ENV !== 'production' && process.env.APP_MODE !== 'SELF_CONTAINED';

    const mapped = rows.map((r) => ({
      id: r.id,
      version: r.version,
      changelog: r.changelog,
      patchUrl: r.patch_url,
      promotedAt: r.promoted_at || r.created_at,
      requiresPasscode: r.requires_passcode ?? true,
      passcode: isDev ? (r.passcode || generateReleasePasscode(r.version)) : undefined,
    }));

    return mapped.sort((a, b) => compareSemver(b.version, a.version));
  }

  // ─── Developer Simulation Sandbox ──────────────────────────────────────────

  /**
   * Allows the developer to simulate and test updates in real-time without packaging Electron EXEs.
   */
  async simulateUpdate(body: { fromVersion?: string; targetVersion?: string; passcode?: string }) {
    const fromVer = body.fromVersion || '1.1.2';
    const targetVer = body.targetVersion || '1.1.14';

    const targetRelease = await this.db
      .selectFrom('offline_releases')
      .selectAll()
      .where('version', '=', targetVer)
      .executeTakeFirst();

    const expectedPasscode = targetRelease?.passcode || generateReleasePasscode(targetVer);

    if (targetRelease?.requires_passcode !== false) {
      if (!body.passcode || !body.passcode.trim()) {
        throw new BadRequestException(`كود تفعيل التحديث مطلوب لهذا الإصدار.`);
      }
      const normalizedProvided = (body.passcode || '').replace(/[\s-]+/g, '').toUpperCase();
      const normalizedExpected = expectedPasscode.replace(/[\s-]+/g, '').toUpperCase();
      if (normalizedProvided !== normalizedExpected) {
        throw new BadRequestException(`كود تفعيل التحديث غير صحيح. الكود المطلوب لهذا الإصدار هو: ${expectedPasscode}`);
      }
    }

    const allApproved = await this.db
      .selectFrom('offline_releases')
      .selectAll()
      .where('promoted_at', 'is not', null)
      .orderBy('promoted_at', 'desc')
      .execute();

    const intermediate = allApproved.filter((r) => compareSemver(r.version, fromVer) > 0);
    const cumulativeChangelog = intermediate
      .map((r) => `### 📦 الإصدار ${r.version}\n${r.changelog || 'تحسينات شاملة.'}`)
      .join('\n\n---\n\n');

    return {
      ok: true,
      simulation: true,
      fromVersion: fromVer,
      targetVersion: targetVer,
      passcodeVerified: true,
      generatedPasscode: expectedPasscode,
      cumulativeReleasesCount: intermediate.length,
      cumulativeChangelog: cumulativeChangelog || `تحديث شامل للإصدار ${targetVer}`,
      steps: [
        { step: 1, title: 'التحقق من كود التفعيل والترخيص', status: 'completed', message: `تم التحقق بنجاح من كود التفعيل (${expectedPasscode}) وتوقيعه الرقمي.` },
        { step: 2, title: 'إنشاء نقطة استعادة فورية (Auto Backup)', status: 'completed', message: `تم تأمين قاعدة البيانات والملفات في runtime/backups/pre-update-v${targetVer}.` },
        { step: 3, title: 'فحص الحزمة وتطابق الـ SHA256 Checksums', status: 'completed', message: 'جميع الملفات والـ Hash سليمة 100% ولا توجد أي ملفات تالفة أو محقونة.' },
        { step: 4, title: 'تطبيق ملفات الباك إند والفرونت إند', status: 'completed', message: `تم استبدال مجلدات dist بالكامل للإصدار ${targetVer} بنجاح.` },
        { step: 5, title: 'تشغيل ترقيات قاعدة البيانات (Kysely Migrations)', status: 'completed', message: 'تم فحص وتطبيق كافة المايجريشنز التراكمية على قاعدة البيانات المحلية بنجاح.' },
        { step: 6, title: 'تحديث علامة الإصدار (.app_version)', status: 'completed', message: `تم تحديث ملف الإصدار إلى: ${targetVer}.` },
        { step: 7, title: 'إعادة التشغيل الساخن (Zero Downtime)', status: 'completed', message: 'تم إقلاع النظام وتجهيزه للعمل بكفاءة تامة.' },
      ],
    };
  }

  // ─── Admin ────────────────────────────────────────────────────────────────

  async listReleases(_auth: AuthContext) {
    const rows = await this.db
      .selectFrom('offline_releases')
      .selectAll()
      .orderBy('created_at', 'desc')
      .execute();

    // Auto-populate passcode for releases if missing
    for (const r of rows) {
      if (!r.passcode) {
        const gen = generateReleasePasscode(r.version);
        await this.db
          .updateTable('offline_releases')
          .set({ passcode: gen })
          .where('id', '=', r.id)
          .execute();
        r.passcode = gen;
      }
    }

    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      changelog: r.changelog,
      patchUrl: r.patch_url,
      isActive: r.is_active,
      passcode: r.passcode,
      requiresPasscode: r.requires_passcode ?? true,
      promotedBy: r.promoted_by,
      promotedAt: r.promoted_at,
      createdAt: r.created_at,
    }));
  }

  async getReleasePasscode(_auth: AuthContext, id: number) {
    const release = await this.db
      .selectFrom('offline_releases')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!release) throw new NotFoundException('الإصدار غير موجود');

    let passcode = release.passcode;
    if (!passcode) {
      passcode = generateReleasePasscode(release.version);
      await this.db
        .updateTable('offline_releases')
        .set({ passcode })
        .where('id', '=', id)
        .execute();
    }

    return {
      ok: true,
      version: release.version,
      passcode,
      requiresPasscode: release.requires_passcode ?? true,
    };
  }

  async getReleasePasscodeByVersion(_auth: AuthContext, version: string) {
    if (!version?.trim()) throw new BadRequestException('version مطلوب');

    const release = await this.db
      .selectFrom('offline_releases')
      .selectAll()
      .where('version', '=', version.trim())
      .executeTakeFirst();

    if (release) {
      let passcode = release.passcode;
      if (!passcode) {
        passcode = generateReleasePasscode(release.version);
        await this.db
          .updateTable('offline_releases')
          .set({ passcode })
          .where('id', '=', release.id)
          .execute();
      }
      return {
        ok: true,
        version: release.version,
        passcode,
        requiresPasscode: release.requires_passcode ?? true,
      };
    }

    const passcode = generateReleasePasscode(version.trim());
    return {
      ok: true,
      version: version.trim(),
      passcode,
      requiresPasscode: true,
    };
  }

  async createRelease(
    _auth: AuthContext,
    body: { version: string; changelog: string; patchUrl: string; passcode?: string; requiresPasscode?: boolean },
  ) {
    const { version, changelog, patchUrl, passcode, requiresPasscode } = body;

    if (!version?.trim()) throw new BadRequestException('version مطلوب');
    if (!patchUrl?.trim()) throw new BadRequestException('patchUrl مطلوب');

    // Check for duplicate version
    const existing = await this.db
      .selectFrom('offline_releases')
      .select('id')
      .where('version', '=', version.trim())
      .executeTakeFirst();

    if (existing) {
      throw new ConflictException(`الإصدار ${version} موجود بالفعل`);
    }

    const assignedPasscode = passcode?.trim() || generateReleasePasscode(version.trim());

    const inserted = await this.db
      .insertInto('offline_releases')
      .values({
        version: version.trim(),
        changelog: changelog?.trim() ?? '',
        patch_url: patchUrl.trim(),
        is_active: false,
        passcode: assignedPasscode,
        requires_passcode: requiresPasscode ?? true,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return { ok: true, release: inserted };
  }

  async promoteRelease(auth: AuthContext, id: number) {
    const release = await this.db
      .selectFrom('offline_releases')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!release) throw new NotFoundException(`الإصدار غير موجود`);

    // Deactivate all other releases first
    await this.db
      .updateTable('offline_releases')
      .set({ is_active: false })
      .where('id', '!=', id)
      .execute();

    // Activate this one
    await this.db
      .updateTable('offline_releases')
      .set({
        is_active: true,
        promoted_by: auth.username ?? auth.role,
        promoted_at: new Date().toISOString() as any,
      })
      .where('id', '=', id)
      .execute();

    return { ok: true, message: `تم اعتماد الإصدار ${release.version} كنسخة مستقرة للعملاء` };
  }

  async deactivateRelease(_auth: AuthContext, id: number) {
    const release = await this.db
      .selectFrom('offline_releases')
      .select(['id', 'version'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!release) throw new NotFoundException(`الإصدار غير موجود`);

    await this.db
      .updateTable('offline_releases')
      .set({ is_active: false })
      .where('id', '=', id)
      .execute();

    return { ok: true, message: `تم إلغاء تفعيل الإصدار ${release.version}` };
  }

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

    if (release?.requires_passcode !== false) {
      const expected = release?.passcode || generateReleasePasscode(body.version);
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

        // Passcode validation for ZIP package (if required by manifest)
        if (manifest.requiresPasscode === true || manifest.passcode) {
          const expected = manifest.passcode || generateReleasePasscode(manifest.version);
          const normalizedProvided = (passcode || '').replace(/[\s-]+/g, '').toUpperCase();
          const normalizedExpected = expected.replace(/[\s-]+/g, '').toUpperCase();
          if (normalizedProvided !== normalizedExpected) {
            throw new BadRequestException('كود تفعيل التحديث غير صحيح. يرجى التواصل مع إدارة النظام للحصول على كود التفعيل المعتمد.');
          }
        }

        // 2. Checksum validation
        const crypto = require('crypto');
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
