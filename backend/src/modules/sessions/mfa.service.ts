import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../core/audit/audit.service';
import type { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { isPlatformTenantId, requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { verifyPassword } from '../../core/auth/utils/password-hasher';
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
} from '../../core/auth/utils/mfa-secret-cipher';
import {
  buildOtpauthUri,
  formatSecretForDisplay,
  generateTotpSecret,
  verifyTotpCode,
} from '../../core/auth/utils/totp';

export type MfaStatus = {
  enabled: boolean;
  confirmedAt: string | null;
  recoveryCodesRemaining: number;
  /** true حين تفرض سياسة المنصة العامل الثاني على هذا الدور ولم يُفعَّل بعد. */
  required: boolean;
};

@Injectable()
export class MfaService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
  ) {}

  private scope(auth: AuthContext) {
    return requireTenantScope(auth);
  }

  private issuerName(): string {
    return String(process.env.MFA_ISSUER_NAME || 'Z Systems Pro').trim() || 'Z Systems Pro';
  }

  /**
   * هل تفرض سياسة المنصة العامل الثاني على هذا الحساب؟
   *
   * **افتراضياً لا.** الفرض الفوري على حساب المنصة كان سيقفل المالك خارج نظامه قبل أن يسجّل
   * تطبيق المصادقة، وهو عطل لا رجعة فيه من طرفنا. المفتاح `MFA_REQUIRED_FOR_PLATFORM=true`
   * يشغّله بعد أن يفعّله المالك على حسابه فعلاً — والواجهة تنبّه عليه قبل ذلك.
   */
  isRequiredFor(auth: AuthContext): boolean {
    if (
      String(process.env.MFA_REQUIRED_FOR_PLATFORM || '')
        .trim()
        .toLowerCase() !== 'true'
    )
      return false;
    const isPlatformTenant = isPlatformTenantId(auth.tenantId);
    return isPlatformTenant && ['super_admin', 'admin'].includes(String(auth.role || ''));
  }

  async getStatus(auth: AuthContext): Promise<MfaStatus> {
    const { tenantId } = this.scope(auth);
    const row = await this.db
      .selectFrom('user_mfa')
      .select(['confirmed_at', 'recovery_codes'])
      .where('user_id', '=', auth.userId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    const confirmedAt = row?.confirmed_at ? new Date(row.confirmed_at as unknown as string) : null;
    return {
      enabled: Boolean(confirmedAt),
      confirmedAt: confirmedAt ? confirmedAt.toISOString() : null,
      recoveryCodesRemaining: Array.isArray(row?.recovery_codes) ? row!.recovery_codes.length : 0,
      required: this.isRequiredFor(auth),
    };
  }

  /**
   * يبدأ التسجيل: سر جديد **غير مؤكَّد** يحل محل أي محاولة سابقة لم تكتمل. الإعداد غير المؤكَّد
   * لا يحجب الدخول، فمن يبدأ ولا يُكمل لا يُقفل خارج حسابه.
   */
  async beginSetup(auth: AuthContext): Promise<{ secret: string; secretFormatted: string; otpauthUri: string }> {
    const { tenantId, accountId } = this.scope(auth);

    const existing = await this.db
      .selectFrom('user_mfa')
      .select(['confirmed_at'])
      .where('user_id', '=', auth.userId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (existing?.confirmed_at) {
      throw new AppError(
        'المصادقة الثنائية مفعّلة بالفعل. أوقفها أولاً إن أردت ربط تطبيق آخر.',
        'MFA_ALREADY_ENABLED',
        400,
      );
    }

    const secret = generateTotpSecret();
    const encrypted = encryptMfaSecret(secret);
    const now = new Date();

    const saved = await this.db
      .insertInto('user_mfa')
      .values({
        user_id: auth.userId,
        tenant_id: tenantId,
        account_id: accountId,
        secret_encrypted: encrypted,
        confirmed_at: null,
        last_used_step: 0,
        recovery_codes: JSON.stringify([]),
        updated_at: now,
      })
      .onConflict((oc) =>
        oc
          .column('user_id')
          .doUpdateSet({
            tenant_id: tenantId,
            account_id: accountId,
            secret_encrypted: encrypted,
            confirmed_at: null,
            last_used_step: 0,
            recovery_codes: JSON.stringify([]),
            updated_at: now,
            // Concurrent confirmation must NEVER be reset back to an unenrolled factor.
          })
          .where('tenant_id', '=', tenantId)
          .where('confirmed_at', 'is', null),
      )
      .returning('user_id')
      .executeTakeFirst();

    if (!saved) {
      throw new AppError(
        'المصادقة الثنائية مفعّلة بالفعل. أوقفها أولاً إن أردت ربط تطبيق آخر.',
        'MFA_ALREADY_ENABLED',
        400,
      );
    }

    return {
      secret,
      secretFormatted: formatSecretForDisplay(secret),
      otpauthUri: buildOtpauthUri({ issuer: this.issuerName(), account: auth.username, secret }),
    };
  }

  /** يؤكّد أن التطبيق يولّد رموزاً صحيحة، ثم يُصدر رموز الاسترداد **مرة واحدة**. */
  async confirmSetup(auth: AuthContext, code: string): Promise<{ recoveryCodes: string[] }> {
    const { tenantId } = this.scope(auth);

    const row = await this.db
      .selectFrom('user_mfa')
      .select(['secret_encrypted', 'confirmed_at'])
      .where('user_id', '=', auth.userId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!row) throw new AppError('ابدأ إعداد المصادقة الثنائية أولاً.', 'MFA_SETUP_NOT_STARTED', 400);
    if (row.confirmed_at) throw new AppError('المصادقة الثنائية مفعّلة بالفعل.', 'MFA_ALREADY_ENABLED', 400);

    const step = verifyTotpCode(decryptMfaSecret(row.secret_encrypted), code);
    if (step === null)
      throw new AppError('رمز التحقق غير صحيح. تأكد من وقت الهاتف ثم أعد المحاولة.', 'MFA_CODE_INVALID', 400);

    const recoveryCodes = generateRecoveryCodes();
    const confirmed = await this.db
      .updateTable('user_mfa')
      .set({
        confirmed_at: new Date(),
        last_used_step: step,
        recovery_codes: JSON.stringify(recoveryCodes.map(hashRecoveryCode)),
        updated_at: new Date(),
      })
      .where('user_id', '=', auth.userId)
      .where('tenant_id', '=', tenantId)
      // Another setup/confirmation may have replaced the pending secret since
      // our read. Never confirm a different secret with this request's OTP.
      .where('secret_encrypted', '=', row.secret_encrypted)
      .where('confirmed_at', 'is', null)
      .returning('user_id')
      .executeTakeFirst();

    if (!confirmed) {
      throw new AppError('تغير إعداد المصادقة الثنائية، أعد بدء التسجيل.', 'MFA_SETUP_CHANGED', 409);
    }

    await this.audit.log('تفعيل المصادقة الثنائية', `فعّل المستخدم ${auth.username} المصادقة الثنائية`, auth, {
      targetTenantId: tenantId,
    });

    // تُعرض مرة واحدة ولا تُخزَّن إلا مجزَّأة — لا مسار في النظام يعيدها بعد هذه اللحظة.
    return { recoveryCodes };
  }

  /**
   * الإيقاف يحتاج **كلمة المرور الحالية ورمزاً صالحاً معاً**: جلسة مسروقة وحدها يجب ألّا تكفي
   * لنزع العامل الثاني، وإلا كانت الحماية بلا معنى أمام الحالة التي أُضيفت من أجلها.
   */
  async disable(auth: AuthContext, currentPassword: string, code: string): Promise<{ ok: true }> {
    const { tenantId } = this.scope(auth);

    const user = await this.db
      .selectFrom('users')
      .select(['password_hash', 'password_salt'])
      .where('id', '=', auth.userId)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();
    if (!user) throw new AppError('المستخدم غير موجود.', 'USER_NOT_FOUND', 404);

    const passwordCheck = await verifyPassword(currentPassword, user.password_hash, user.password_salt);
    if (!passwordCheck.valid) throw new AppError('كلمة المرور الحالية غير صحيحة.', 'CURRENT_PASSWORD_INVALID', 400);

    const row = await this.db
      .selectFrom('user_mfa')
      .select(['secret_encrypted', 'recovery_codes', 'confirmed_at'])
      .where('user_id', '=', auth.userId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!row || !row.confirmed_at) throw new AppError('المصادقة الثنائية غير مفعّلة.', 'MFA_NOT_ENABLED', 400);

    const byTotp = verifyTotpCode(decryptMfaSecret(row.secret_encrypted), code) !== null;
    const stored = Array.isArray(row.recovery_codes) ? row.recovery_codes.map(String) : [];
    const byRecovery = stored.includes(hashRecoveryCode(code));
    if (!byTotp && !byRecovery) throw new AppError('رمز التحقق غير صحيح.', 'MFA_CODE_INVALID', 400);

    await this.db.deleteFrom('user_mfa').where('user_id', '=', auth.userId).where('tenant_id', '=', tenantId).execute();

    await this.audit.log('إيقاف المصادقة الثنائية', `أوقف المستخدم ${auth.username} المصادقة الثنائية`, auth, {
      targetTenantId: tenantId,
    });

    return { ok: true };
  }

  /** رموز استرداد جديدة تُبطل القديمة كلها. يحتاج رمزاً صالحاً من التطبيق. */
  async regenerateRecoveryCodes(auth: AuthContext, code: string): Promise<{ recoveryCodes: string[] }> {
    const { tenantId } = this.scope(auth);

    const row = await this.db
      .selectFrom('user_mfa')
      .select(['secret_encrypted', 'confirmed_at'])
      .where('user_id', '=', auth.userId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!row || !row.confirmed_at) throw new AppError('المصادقة الثنائية غير مفعّلة.', 'MFA_NOT_ENABLED', 400);
    if (verifyTotpCode(decryptMfaSecret(row.secret_encrypted), code) === null) {
      throw new AppError('رمز التحقق غير صحيح.', 'MFA_CODE_INVALID', 400);
    }

    const recoveryCodes = generateRecoveryCodes();
    await this.db
      .updateTable('user_mfa')
      .set({ recovery_codes: JSON.stringify(recoveryCodes.map(hashRecoveryCode)), updated_at: new Date() })
      .where('user_id', '=', auth.userId)
      .where('tenant_id', '=', tenantId)
      .execute();

    await this.audit.log('تجديد رموز استرداد المصادقة الثنائية', `جدّد المستخدم ${auth.username} رموز الاسترداد`, auth, {
      targetTenantId: tenantId,
    });

    return { recoveryCodes };
  }
}
