import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import * as os from 'os';
import { Kysely } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthCacheService } from '../../../core/auth/services/auth-cache.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { isPlatformTenantId, requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { resolveTenantPackage } from '../../../core/tenant-transfer/backup-bundle';
import { exportTenantPackage, importTenantPackage, TenantPackageError } from '../../../core/tenant-transfer/tenant-package';
import { SettingsService } from '../settings.service';
import { isDesktopRuntimeMode } from '../../../config/app-mode';
import { isProtectedTenantDataTarget } from '../../../core/tenant-transfer/protected-tenant-target';

export const TENANT_IMPORT_CONFIRMATION = 'IMPORT TENANT';

const PACKAGE_ERROR_MESSAGES: Record<string, string> = {
  PACKAGE_INVALID: 'الملف ليس حزمة بيانات صالحة أو أنه تالف.',
  PACKAGE_NEWER_THAN_APP: 'الحزمة مأخوذة من إصدار أحدث من هذا البرنامج. حدّث البرنامج أولاً ثم أعد المحاولة.',
  TENANT_MISMATCH: 'هذه الحزمة تخص منشأة أخرى، ولا يمكن استيرادها فوق بيانات هذه المنشأة.',
  TARGET_TENANT_MISSING: 'المنشأة المستهدفة غير موجودة على هذا الخادم.',
  TABLE_MISSING: 'الحزمة تحتوي بيانات لا يعرفها هذا الإصدار. حدّث البرنامج أولاً.',
  ID_CONFLICT: 'أرقام السجلات في الحزمة مستخدمة بالفعل هنا لبيانات أخرى، فلم يُستورد شيء.',
  ORPHANED_REFERENCES: 'تم إلغاء الاستيراد ولم يتغير شيء: الحزمة فيها سجلات مرتبطة ببيانات غير موجودة.',
  OFFLINE_BLOCKS_EXHAUSTED: 'تعذر تجهيز نطاق أرقام العمل بدون إنترنت لهذه المنشأة.',
};

// Moves the signed-in tenant between the cloud and a desktop install (src/core/tenant-transfer).
// Export: a .zsbak of this tenant. Import: replaces this tenant with a package (or with one tenant
// picked out of a nightly bundle), keeping every original id. Same permission as restoring a
// backup (super_admin or canManageBackups), because an import replaces the whole tenant.
@Injectable()
export class TenantTransferService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly authCache: AuthCacheService,
    private readonly settings: SettingsService,
  ) {}

  isDesktop(): boolean {
    return isDesktopRuntimeMode(process.env.APP_MODE);
  }

  private assertCanTransfer(auth?: AuthContext | null): asserts auth is AuthContext {
    if (!auth) throw new ForbiddenException('Authentication required');
    if (!(auth.role === 'super_admin' || auth.permissions.includes('canManageBackups'))) {
      throw new ForbiddenException('نقل البيانات يتطلب صلاحية النسخ الاحتياطي والاسترداد');
    }
    requireTenantScope(auth);
  }

  async exportForActor(auth: AuthContext): Promise<{ buffer: Buffer; fileName: string }> {
    this.assertCanTransfer(auth);
    const scope = requireTenantScope(auth);
    const desktop = this.isDesktop();
    const { buffer, manifest } = await exportTenantPackage(this.db as unknown as Kysely<any>, scope.tenantId, {
      source: `${desktop ? 'desktop' : 'cloud'}:${os.hostname()}`,
      // only the cloud hands out offline id blocks; a desktop carries the block it received
      allocateOfflineBlock: !desktop,
    });
    await this.audit.log('تصدير حزمة بيانات المنشأة', `تم تصدير حزمة بيانات المنشأة بواسطة ${auth.username}`, auth).catch(() => undefined);
    const day = await resolveBusinessDateKey(this.db, scope.tenantId, new Date());
    const slug = (manifest.origin?.slug || manifest.tenant.slug || 'tenant').replace(/[^A-Za-z0-9_-]+/g, '-');
    return { buffer, fileName: `ZERP-tenant-${slug}-${day}.zsbak` };
  }

  async importForActor(
    auth: AuthContext,
    file: Buffer,
    options: { confirmation?: string; passphrase?: string; pick?: string },
  ): Promise<Record<string, unknown>> {
    this.assertCanTransfer(auth);
    const scope = requireTenantScope(auth);
    if (isProtectedTenantDataTarget(scope.tenantId)) {

      throw new ForbiddenException('ممنوع منعاً باتاً استيراد حزم بيانات فوق منشأة المنصة المركزية السحابية (zs). المنصة مخصصة لإدارة المشتركين فقط.');
    }

    if (String(options.confirmation || '').trim() !== TENANT_IMPORT_CONFIRMATION) {
      throw new AppError(`اكتب ${TENANT_IMPORT_CONFIRMATION} لتأكيد استبدال كل بيانات المنشأة`, 'TENANT_IMPORT_CONFIRMATION_REQUIRED', 400);
    }

    let packageBuffer: Buffer;
    try {
      packageBuffer = resolveTenantPackage(file, { passphrase: options.passphrase, pick: options.pick }).packageBuffer;
    } catch (error: any) {
      if (Array.isArray(error?.bundleTenants)) {
        throw new AppError('الملف يحتوي أكثر من منشأة: اختر المنشأة المطلوبة', 'TENANT_PICK_REQUIRED', 409, {
          tenants: error.bundleTenants.map((t: any) => ({ tenantId: t.tenantId, slug: t.slug, businessName: t.businessName, rows: t.rows })),
        });
      }
      const message = String(error?.message || '');
      if (/passphrase/i.test(message)) {
        throw new AppError(/Wrong/i.test(message) ? 'كلمة سر النسخة غير صحيحة' : 'النسخة مشفرة: أدخل كلمة سر النسخ الاحتياطي', 'BACKUP_PASSPHRASE', 400);
      }
      throw new AppError('الملف ليس نسخة احتياطية أو حزمة بيانات صالحة', 'PACKAGE_INVALID', 400);
    }

    try {
      const report = await importTenantPackage(this.db as unknown as Kysely<any>, packageBuffer, {
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        mode: this.isDesktop() ? 'desktop' : 'cloud',
      });
      this.authCache.invalidateTenant(scope.tenantId);
      this.settings.invalidateSettingsCache(scope.tenantId);
      this.settings.invalidateBranchesCache(scope.tenantId);
      this.settings.invalidatePlanFeaturesCache(scope.tenantId);
      await this.audit.log(
        'استيراد حزمة بيانات المنشأة',
        `تم استبدال بيانات المنشأة بحزمة ${report.sourceTenant.businessName || report.sourceTenant.slug} (${report.rows} سجل) بواسطة ${auth.username}`,
        auth,
      ).catch(() => undefined);
      return { ok: true, ...report, loggedOut: true };
    } catch (error: any) {
      if (error instanceof TenantPackageError) {
        throw new AppError(PACKAGE_ERROR_MESSAGES[error.code] ?? error.message, `TENANT_${error.code}`, 400, { detail: error.message });
      }
      throw error;
    }
  }
}
