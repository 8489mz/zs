import { sql } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import { verifyPassword } from '../../../../core/auth/utils/password-hasher';
import type { Kysely } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import type { SettingsBackupService } from '../settings-backup.service';

export class SettingsDemoDataGuards {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly backupService: SettingsBackupService,
  ) {}

  scope(actor: AuthContext): { tenantId: string; accountId: string } {
    const tenantId = String(actor.tenantId || '').trim();
    const accountId = String(actor.accountId || actor.tenantId || '').trim();
    if (!tenantId || !accountId) {
      throw new AppError('Tenant scope missing', 'MISSING_TENANT_SCOPE', 400);
    }
    return { tenantId, accountId };
  }

  async assertSuperAdminAndPassword(password: string, actor: AuthContext): Promise<void> {
    if (actor.role !== 'super_admin') {
      throw new AppError('فقط السوبر أدمن هو المخول بتنفيذ هذه العملية', 'SUPER_ADMIN_REQUIRED', 403);
    }

    if (!password || typeof password !== 'string' || !password.trim()) {
      throw new AppError('يرجى إدخال كلمة مرور السوبر أدمن لتأكيد العملية', 'PASSWORD_REQUIRED', 400);
    }

    const scope = this.scope(actor);
    const user = await this.db
      .selectFrom('users')
      .select(['id', 'password_hash', 'password_salt'])
      .where('id', '=', actor.userId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();

    if (!user || !user.password_hash) {
      throw new AppError('تعذر التحقق من حساب المستخدم', 'USER_NOT_FOUND', 404);
    }

    const check = await verifyPassword(password.trim(), String(user.password_hash), String(user.password_salt || ''));
    if (!check.valid) {
      throw new AppError('كلمة مرور السوبر أدمن غير صحيحة', 'INVALID_SUPER_ADMIN_PASSWORD', 401);
    }
  }

  async assertAdminAndPassword(password: string, actor: AuthContext): Promise<void> {
    if (actor.role !== 'admin' && actor.role !== 'super_admin') {
      throw new AppError('فقط مدير المنشأة أو السوبر أدمن هو المخول بتنفيذ هذه العملية', 'ADMIN_REQUIRED', 403);
    }

    if (!password || typeof password !== 'string' || !password.trim()) {
      throw new AppError('يرجى إدخال كلمة المرور لتأكيد العملية', 'PASSWORD_REQUIRED', 400);
    }

    const scope = this.scope(actor);
    const user = await this.db
      .selectFrom('users')
      .select(['id', 'password_hash', 'password_salt'])
      .where('id', '=', actor.userId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();

    if (!user || !user.password_hash) {
      throw new AppError('تعذر التحقق من حساب المستخدم', 'USER_NOT_FOUND', 404);
    }

    const check = await verifyPassword(password.trim(), String(user.password_hash), String(user.password_salt || ''));
    if (!check.valid) {
      throw new AppError('كلمة المرور غير صحيحة', 'INVALID_PASSWORD', 401);
    }
  }

  async takeAutoBackup(actor: AuthContext, reason: string): Promise<void> {
    await this.backupService.savePreMutationBackup(actor, reason);
  }

  /** Clear daily-split allocation rows before deleting sales/payments (ON DELETE SET NULL + CHECK constraint). */
  async clearVanSettlementRows(trx: any, tenantId: string): Promise<void> {
    await trx.deleteFrom('settlement_allocations').where(sql<boolean>`tenant_id = ${tenantId}`).execute();
    await trx.deleteFrom('van_rep_financial_settlements').where(sql<boolean>`tenant_id = ${tenantId}`).execute();
  }
}
