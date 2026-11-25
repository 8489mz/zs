import type { Kysely } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import * as fs from 'fs';
import * as path from 'path';
import { compareSemver } from './offline-releases-semver';

export class OfflineReleasesInitSync {
  constructor(private readonly db: Kysely<Database>) {}

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

    const foundManifests: Array<{
      version: string;
      changelog: string;
      passcode?: string;
      requiresPasscode?: boolean;
      generatedAt?: string;
      patchUrl?: string;
    }> = [];

    for (const dir of searchDirs) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter((f) => f.startsWith('manifest-') && f.endsWith('.json'));
        for (const file of files) {
          try {
            const raw = fs
              .readFileSync(path.join(dir, file), 'utf8')
              .trim()
              .replace(/^\uFEFF/, '');
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
    const uniqueByVersion = new Map<string, (typeof foundManifests)[0]>();
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
      // A manifest may carry a passcode (old manifests do); one that does not
      // must never be invented here — a missing code stays null until an
      // admin provisions it, and a stored code is never overwritten with null.
      const passcode = m.passcode ?? null;
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

          const activationValues: { is_active: boolean; passcode?: string | null } = { is_active: true };
          if (m.passcode) activationValues.passcode = m.passcode;
          await this.db.updateTable('offline_releases').set(activationValues).where('id', '=', existing.id).execute();
        }
      }
    }
  }
}
