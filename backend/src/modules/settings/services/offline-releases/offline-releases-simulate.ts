import type { Kysely } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import { BadRequestException } from '@nestjs/common';
import { expectedPasscodeOrFail } from './offline-releases-passcode';
import { compareSemver } from './offline-releases-semver';

export class OfflineReleasesSimulate {
  constructor(private readonly db: Kysely<Database>) {}

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

    // Fail closed: with no stored code there is nothing to compare against,
    // and no code may be derived — the published code for this version must
    // not verify. The wrong-code error never echoes the expected code.
    if (targetRelease?.requires_passcode !== false) {
      const expectedPasscode = expectedPasscodeOrFail(targetRelease?.passcode, targetVer);
      if (!body.passcode || !body.passcode.trim()) {
        throw new BadRequestException(`كود تفعيل التحديث مطلوب لهذا الإصدار.`);
      }
      const normalizedProvided = (body.passcode || '').replace(/[\s-]+/g, '').toUpperCase();
      const normalizedExpected = expectedPasscode.replace(/[\s-]+/g, '').toUpperCase();
      if (normalizedProvided !== normalizedExpected) {
        throw new BadRequestException(`كود تفعيل التحديث غير صحيح.`);
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
      cumulativeReleasesCount: intermediate.length,
      cumulativeChangelog: cumulativeChangelog || `تحديث شامل للإصدار ${targetVer}`,
      steps: [
        { step: 1, title: 'التحقق من كود التفعيل والترخيص', status: 'completed', message: `تم التحقق بنجاح من كود التفعيل.` },
        { step: 2, title: 'إنشاء نقطة استعادة فورية (Auto Backup)', status: 'completed', message: `تم تأمين قاعدة البيانات والملفات في runtime/backups/pre-update-v${targetVer}.` },
        { step: 3, title: 'فحص الحزمة وتطابق الـ SHA256 Checksums', status: 'completed', message: 'جميع الملفات والـ Hash سليمة 100% ولا توجد أي ملفات تالفة أو محقونة.' },
        { step: 4, title: 'تطبيق ملفات الباك إند والفرونت إند', status: 'completed', message: `تم استبدال مجلدات dist بالكامل للإصدار ${targetVer} بنجاح.` },
        { step: 5, title: 'تشغيل ترقيات قاعدة البيانات (Kysely Migrations)', status: 'completed', message: 'تم فحص وتطبيق كافة المايجريشنز التراكمية على قاعدة البيانات المحلية بنجاح.' },
        { step: 6, title: 'تحديث علامة الإصدار (.app_version)', status: 'completed', message: `تم تحديث ملف الإصدار إلى: ${targetVer}.` },
        { step: 7, title: 'إعادة التشغيل الساخن (Zero Downtime)', status: 'completed', message: 'تم إقلاع النظام وتجهيزه للعمل بكفاءة تامة.' },
      ],
    };
  }
}
