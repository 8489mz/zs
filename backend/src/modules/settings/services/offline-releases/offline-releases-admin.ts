import type { Kysely } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';

export class OfflineReleasesAdmin {
  constructor(private readonly db: Kysely<Database>) {}

  // ─── Admin ────────────────────────────────────────────────────────────────

  async listReleases(_auth: AuthContext) {
    const rows = await this.db.selectFrom('offline_releases').selectAll().orderBy('created_at', 'desc').execute();

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
    const release = await this.db.selectFrom('offline_releases').selectAll().where('id', '=', id).executeTakeFirst();

    if (!release) throw new NotFoundException('الإصدار غير موجود');

    return {
      ok: true,
      version: release.version,
      passcode: release.passcode ?? null,
      requiresPasscode: release.requires_passcode ?? true,
    };
  }

  /**
   * Provision (or rotate) the activation passcode for a release. This is the
   * only way a code reaches a release row after the derivation was removed:
   * the seller generates the code with the release script and sets it here,
   * then gives it to the client out-of-band. Codes already stored for old
   * releases are untouched by this method unless an admin rotates them.
   */
  async setReleasePasscode(_auth: AuthContext, id: number, passcode: string) {
    if (!passcode?.trim()) throw new BadRequestException('passcode مطلوب');

    const release = await this.db
      .selectFrom('offline_releases')
      .select(['id', 'version'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!release) throw new NotFoundException('الإصدار غير موجود');

    const normalized = passcode.trim();
    await this.db.updateTable('offline_releases').set({ passcode: normalized }).where('id', '=', id).execute();

    return {
      ok: true,
      version: release.version,
      passcode: normalized,
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
      return {
        ok: true,
        version: release.version,
        passcode: release.passcode ?? null,
        requiresPasscode: release.requires_passcode ?? true,
      };
    }

    // No row, no code: an unprovisioned version is handed nothing.
    return {
      ok: true,
      version: version.trim(),
      passcode: null,
      requiresPasscode: true,
    };
  }

  async createRelease(
    _auth: AuthContext,
    body: { version: string; changelog?: string; patchUrl: string; passcode?: string; requiresPasscode?: boolean },
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

    // No derivation fallback: an admin must provision the code explicitly
    // (release script output, set via setReleasePasscode).
    const assignedPasscode = passcode?.trim() || null;

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
    const release = await this.db.selectFrom('offline_releases').selectAll().where('id', '=', id).executeTakeFirst();

    if (!release) throw new NotFoundException(`الإصدار غير موجود`);

    // Deactivate all other releases first
    await this.db.updateTable('offline_releases').set({ is_active: false }).where('id', '!=', id).execute();

    // Activate this one
    await this.db
      .updateTable('offline_releases')
      .set({
        is_active: true,
        promoted_by: auth.username ?? auth.role,
        promoted_at: new Date().toISOString(),
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

    await this.db.updateTable('offline_releases').set({ is_active: false }).where('id', '=', id).execute();

    return { ok: true, message: `تم إلغاء تفعيل الإصدار ${release.version}` };
  }
}
