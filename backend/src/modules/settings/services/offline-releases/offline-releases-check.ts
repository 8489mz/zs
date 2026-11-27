import type { Kysely } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import { compareSemver } from './offline-releases-semver';

export class OfflineReleasesCheck {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly bound: {
      syncManifestsFromDisk: () => Promise<void>;
      fetchGitHubLatestRelease: () => Promise<{
        version: string;
        changelog: string;
        patchUrl: string;
        passcode?: string;
      } | null>;
    },
  ) {}

  private async syncManifestsFromDisk(): Promise<void> {
    return this.bound.syncManifestsFromDisk();
  }
  private async fetchGitHubLatestRelease(): Promise<{
    version: string;
    changelog: string;
    patchUrl: string;
    passcode?: string;
  } | null> {
    return this.bound.fetchGitHubLatestRelease();
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

        // A release published without a passcode keeps a null code until an
        // admin provisions one; a stored code is never overwritten with null.
        const passcode = ghRelease.passcode ?? null;

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

          const activationValues: {
            is_active: boolean;
            patch_url: string;
            changelog: string;
            passcode?: string | null;
          } = {
            is_active: true,
            patch_url: ghRelease.patchUrl,
            changelog: ghRelease.changelog,
          };
          if (ghRelease.passcode) activationValues.passcode = ghRelease.passcode;
          await this.db.updateTable('offline_releases').set(activationValues).where('id', '=', existing.id).execute();
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

    const rows = await this.db.selectFrom('offline_releases').selectAll().execute();

    // The activation code is NEVER returned in the history, even in
    // dev: the history is a public response (controller GET history
    // and checkForUpdate's `releases`), and the code itself is only
    // needed by the admin provisioning surface and the apply
    // validation, which read the stored row directly.
    // requiresPasscode stays so clients know a code is required,
    // without learning it.
    const mapped = rows.map((r) => ({
      id: r.id,
      version: r.version,
      changelog: r.changelog,
      patchUrl: r.patch_url,
      promotedAt: r.promoted_at || r.created_at,
      requiresPasscode: r.requires_passcode ?? true,
    }));

    return mapped.sort((a, b) => compareSemver(b.version, a.version));
  }
}
