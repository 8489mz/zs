import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { AppError } from '../../common/errors/app-error';
import { InMemoryRateLimitService } from '../../common/security/in-memory-rate-limit.service';
import { AUDIT_EVENT_CODES, AuditService } from '../../core/audit/audit.service';
import { AuthCacheService } from '../../core/auth/services/auth-cache.service';
import { createPasswordRecord } from '../../core/auth/utils/password-hasher';
import { assertStrongPassword } from '../../core/auth/utils/password-policy';
import { resolveTenantContext } from '../../core/auth/utils/tenant-context';
import {
  classifyPasswordResetToken,
  generatePasswordResetToken,
  hashPasswordResetToken,
  passwordResetTokenTtlMs,
} from '../../core/auth/utils/password-reset-token';
import { RequestPasswordResetDto, ConfirmPasswordResetDto, ValidatePasswordResetTokenDto } from './dto/password-reset.dto';
import { PasswordResetMailService, PasswordResetMailTarget } from './password-reset-mail.service';

/** أكثر عدد منشآت يُصدَر لها رمز في طلب واحد — نفس البريد قد يملك أكثر من منشأة. */
const MAX_TARGETS_PER_REQUEST = 5;

/**
 * الرابط الذي يصل للمستخدم. الرمز يُوضع في **جزء الـfragment** (`#token=`) لا في الـquery
 * عمداً: الـfragment لا يُرسَل إلى السيرفر أصلاً، فلا يظهر في سجلات nginx ولا في ترويسة
 * `Referer` لأي طرف ثالث تفتحه الصفحة. نفس السبب الذي جعل رابط تتبع الطلب يستخدم `#t=`
 * (SF-1 في `ARCHITECTURE_INVARIANTS.md` §4).
 */
export function buildPasswordResetUrl(
  origin: string | undefined,
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  // A request-controlled forwarded host is never an acceptable password-reset destination.
  // Only the operator-controlled public origin is trusted in cloud deployments.
  const standalone = env.APP_MODE === 'SELF_CONTAINED' || env.IS_ELECTRON === 'true';
  const configured = String(env.APP_PUBLIC_URL || '').trim();
  const candidate = configured || (standalone ? String(origin || '').trim() : '');
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) return null;
    const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname.toLowerCase());
    if (parsed.protocol !== 'https:' && !(standalone && isLoopback && parsed.protocol === 'http:')) return null;
    // A standalone fallback is restricted to loopback, never an untrusted forwarded public host.
    if (!configured && !isLoopback) return null;
    return `${parsed.origin}/reset-password#token=${encodeURIComponent(token)}`;
  } catch {
    return null;
  }
}

type ResetCandidate = {
  userId: number;
  username: string;
  tenantId: string;
  accountId: string;
  businessName: string;
};

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly configService: ConfigService,
    private readonly rateLimit: InMemoryRateLimitService,
    private readonly mail: PasswordResetMailService,
    private readonly audit: AuditService,
    // لا قيمة افتراضية هنا: نسخة الكاش يجب أن تكون نفس نسخة `SessionService` وإلا بقيت
    // الجلسات المُبطَلة صالحة في كاش آخر (نفس عطل O39).
    private readonly authCache: AuthCacheService,
  ) {}

  private maskEmail(value: string): string {
    const [localRaw, domainRaw] = String(value || '').trim().toLowerCase().split('@');
    const local = localRaw || '';
    const domain = domainRaw || '';
    if (!local || !domain) return '***';
    return `${local.slice(0, 2)}***@${domain}`;
  }

  private tenantContextOf(row: { tenant_id?: string | null; account_id?: string | null }): { tenantId: string; accountId: string } {
    return resolveTenantContext(this.configService, {
      tenantId: String(row.tenant_id || '').trim(),
      accountId: String(row.account_id || '').trim(),
    });
  }

  private tooManyRequests(): never {
    throw new HttpException('عدد كبير من المحاولات خلال وقت قصير، يرجى المحاولة بعد قليل.', HttpStatus.TOO_MANY_REQUESTS);
  }

  private invalidTokenError(): AppError {
    // رسالة واحدة لكل الحالات (غير موجود / مستهلك / ملغى / منتهٍ): معرفة أي الحالات تنطبق
    // لا تفيد صاحب الحساب وتفيد من يجرّب رموزاً.
    return new AppError(
      'رابط إعادة التعيين غير صالح أو انتهت صلاحيته. اطلب رابطاً جديداً.',
      'PASSWORD_RESET_TOKEN_INVALID',
      400,
    );
  }

  /** نفس منطق مطابقة البريد في تسجيل الدخول: البريد مخزَّن على المنشأة لا على المستخدم. */
  private async findCandidates(email: string, companyCode?: string): Promise<ResetCandidate[]> {
    let resolvedTenantId = String(companyCode || '').trim();
    if (resolvedTenantId) {
      const tenantMatch = await this.db
        .selectFrom('tenants')
        .select(['id'])
        .where((eb) => eb.or([eb('id', '=', resolvedTenantId), eb('slug', '=', resolvedTenantId)]))
        .executeTakeFirst();
      resolvedTenantId = tenantMatch?.id || resolvedTenantId;
    }

    let query = this.db
      .selectFrom('users as u')
      .innerJoin('tenants as t', 't.id', 'u.tenant_id')
      .select([
        'u.id as id',
        'u.username as username',
        'u.tenant_id as tenant_id',
        'u.account_id as account_id',
        't.business_name as business_name',
        't.slug as slug',
      ])
      .where(sql<string>`LOWER(COALESCE(t.owner_email, ''))`, '=', email)
      .where('u.is_active', '=', true)
      .where('u.role', 'in', ['admin', 'super_admin']);

    if (resolvedTenantId) {
      query = query.where('u.tenant_id', '=', resolvedTenantId);
    }

    const rows = await query.orderBy('u.id', 'asc').limit(MAX_TARGETS_PER_REQUEST).execute();

    return rows.map((row) => {
      const scope = this.tenantContextOf(row);
      return {
        userId: Number(row.id),
        username: String(row.username || ''),
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        businessName: String(row.business_name || row.slug || '').trim() || 'منشأتك',
      };
    });
  }

  /**
   * يُصدِر رمزاً جديداً للمستخدم ويُلغي رموزه القائمة في نفس المعاملة، فلا يبقى صالحاً في أي
   * لحظة أكثر من رمز واحد لكل حساب.
   */
  private async issueToken(candidate: ResetCandidate, ip: string, expiresAt: Date): Promise<string> {
    const token = generatePasswordResetToken();
    const tokenHash = hashPasswordResetToken(token);

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('password_reset_tokens')
        .set({ invalidated_at: new Date() })
        .where('user_id', '=', candidate.userId)
        .where('tenant_id', '=', candidate.tenantId)
        .where('used_at', 'is', null)
        .where('invalidated_at', 'is', null)
        .execute();

      await trx
        .insertInto('password_reset_tokens')
        .values({
          id: randomUUID(),
          tenant_id: candidate.tenantId,
          account_id: candidate.accountId,
          user_id: candidate.userId,
          token_hash: tokenHash,
          expires_at: expiresAt,
          used_at: null,
          invalidated_at: null,
          requested_ip: ip.slice(0, 64),
        })
        .execute();
    });

    return token;
  }

  /**
   * الرد **دائماً** `{ ok: true }` سواء وُجد الحساب أم لا: أي اختلاف في الرد أو في زمنه يحوّل
   * هذا المسار إلى أداة لمعرفة أي البُرُد مسجَّلة لدينا.
   */
  async requestReset(dto: RequestPasswordResetDto, meta: { ip: string; origin?: string }): Promise<{ ok: true }> {
    const email = String(dto.email || '').trim().toLowerCase();
    const ip = String(meta.ip || 'unknown').trim() || 'unknown';

    const limits = await Promise.all([
      this.rateLimit.hit(`password-reset:request:ip:${ip}`, 10, 3600),
      this.rateLimit.hit(`password-reset:request:email:${email}`, 5, 3600),
    ]);
    if (limits.some((entry) => !entry.allowed)) this.tooManyRequests();

    const candidates = await this.findCandidates(email, dto.companyCode);
    if (candidates.length === 0) {
      return { ok: true };
    }

    const ttlMs = passwordResetTokenTtlMs();
    const expiresAt = new Date(Date.now() + ttlMs);
    const targets: PasswordResetMailTarget[] = [];

    for (const candidate of candidates) {
      const token = await this.issueToken(candidate, ip, expiresAt);
      const resetUrl = buildPasswordResetUrl(meta.origin, token);
      if (!resetUrl) {
        // بلا عنوان عام لا يمكن بناء رابط يعمل — نفشل بصوت في السجل لا بصمت في بريد المستخدم.
        this.logger.error('PASSWORD_RESET_PUBLIC_URL_MISSING: APP_PUBLIC_URL is not set and the request origin is not usable.');
        return { ok: true };
      }
      targets.push({ businessName: candidate.businessName, username: candidate.username, resetUrl });

      await this.audit.log(
        'طلب استعادة كلمة المرور',
        `تم إصدار رابط استعادة كلمة المرور للمستخدم ${candidate.username}`,
        { userId: candidate.userId, tenantId: candidate.tenantId, accountId: candidate.accountId },
        { targetTenantId: candidate.tenantId, eventCode: AUDIT_EVENT_CODES.AUTH_PASSWORD_RESET_REQUESTED },
      );
    }

    try {
      await this.mail.sendResetLink({
        email,
        ttlMinutes: Math.round(ttlMs / 60000),
        targets,
      });
    } catch (error) {
      // فشل الإرسال لا يُعاد للمستخدم: الرد المختلف عند بريد موجود يكشف وجوده. يُسجَّل هنا
      // ليظهر في المراقبة، والرموز الصادرة تموت وحدها بانتهاء صلاحيتها.
      this.logger.error(
        `PASSWORD_RESET_MAIL_FAILED to=${this.maskEmail(email)} error=${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return { ok: true };
  }

  /** يتحقق أن الرابط ما زال صالحاً قبل أن تعرض الواجهة نموذج كلمة المرور الجديدة. */
  async validateToken(dto: ValidatePasswordResetTokenDto, meta: { ip: string }): Promise<{ ok: true; username: string; businessName: string; expiresAt: string }> {
    const ip = String(meta.ip || 'unknown').trim() || 'unknown';
    const limit = await this.rateLimit.hit(`password-reset:validate:ip:${ip}`, 30, 3600);
    if (!limit.allowed) this.tooManyRequests();

    const row = await this.db
      .selectFrom('password_reset_tokens as prt')
      .innerJoin('users as u', (join) => join.onRef('u.id', '=', 'prt.user_id').onRef('u.tenant_id', '=', 'prt.tenant_id'))
      .innerJoin('tenants as t', 't.id', 'prt.tenant_id')
      .select([
        'prt.user_id as user_id',
        'prt.tenant_id as tenant_id',
        'prt.expires_at as expires_at',
        'prt.used_at as used_at',
        'prt.invalidated_at as invalidated_at',
        'u.username as username',
        'u.is_active as is_active',
        't.business_name as business_name',
      ])
      .where('prt.token_hash', '=', hashPasswordResetToken(dto.token))
      .executeTakeFirst();

    if (!row || !row.is_active) throw this.invalidTokenError();
    if (classifyPasswordResetToken(row) !== 'usable') throw this.invalidTokenError();

    const expiresAt = row.expires_at instanceof Date ? row.expires_at : new Date(String(row.expires_at));
    return {
      ok: true,
      username: String(row.username || ''),
      businessName: String(row.business_name || '').trim() || 'منشأتك',
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * يستهلك الرمز ويضبط كلمة المرور. كل شيء في معاملة واحدة مع `FOR UPDATE` على صف الرمز، فلا
   * يمكن لطلبين متزامنين أن يستهلكا نفس الرمز مرتين.
   */
  async confirmReset(dto: ConfirmPasswordResetDto, meta: { ip: string }): Promise<{ ok: true; username: string }> {
    const ip = String(meta.ip || 'unknown').trim() || 'unknown';
    const limit = await this.rateLimit.hit(`password-reset:confirm:ip:${ip}`, 20, 3600);
    if (!limit.allowed) this.tooManyRequests();

    // The role-aware minimum is enforced inside the transaction, after
    // the target account is resolved: the reset token alone does not
    // carry the account role, and a weak password must never be set
    // for an admin account. The token is untouched on rejection.
    const tokenHash = hashPasswordResetToken(dto.token);
    const passwordRecord = await createPasswordRecord(dto.newPassword);

    const outcome = await this.db.transaction().execute(async (trx) => {
      const tokenRow = await trx
        .selectFrom('password_reset_tokens')
        .select(['id', 'user_id', 'tenant_id', 'account_id', 'expires_at', 'used_at', 'invalidated_at'])
        .where('token_hash', '=', tokenHash)
        .forUpdate()
        .executeTakeFirst();

      if (!tokenRow || classifyPasswordResetToken(tokenRow) !== 'usable') return null;

      const tenantId = String(tokenRow.tenant_id || '').trim();
      const user = await trx
        .selectFrom('users')
        .select(['id', 'username', 'tenant_id', 'account_id', 'role'])
        .where('id', '=', tokenRow.user_id)
        .where('tenant_id', '=', tenantId)
        .where('is_active', '=', true)
        .executeTakeFirst();

      if (!user) return null;

      assertStrongPassword(dto.newPassword, { role: user.role });

      await trx
        .updateTable('users')
        .set({
          password_hash: passwordRecord.hash,
          password_salt: passwordRecord.salt,
          must_change_password: false,
          failed_login_count: 0,
          locked_until: null,
        })
        .where('id', '=', user.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      await trx
        .updateTable('password_reset_tokens')
        .set({ used_at: new Date() })
        .where('id', '=', tokenRow.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      // أي رمز آخر لنفس الحساب يموت مع الاستعمال: الاستعادة حدث واحد لا سلسلة أبواب مفتوحة.
      await trx
        .updateTable('password_reset_tokens')
        .set({ invalidated_at: new Date() })
        .where('user_id', '=', user.id)
        .where('tenant_id', '=', tenantId)
        .where('used_at', 'is', null)
        .where('invalidated_at', 'is', null)
        .execute();

      // تغيير كلمة المرور هو علاج الحساب المخترَق، فالجلسات المفتوحة بالقديمة لا تنجو منه.
      // نفس ما يفعله `saas-admin.service.ts:resetOwnerPassword` و`users.service.ts:updateUser`.
      await trx.deleteFrom('sessions').where('user_id', '=', user.id).where('tenant_id', '=', tenantId).execute();

      return {
        userId: Number(user.id),
        username: String(user.username || ''),
        ...this.tenantContextOf(user),
      };
    });

    if (!outcome) throw this.invalidTokenError();

    this.authCache.invalidateUserSessions(outcome.userId);

    await this.audit.log(
      'إعادة تعيين كلمة المرور',
      `تمت إعادة تعيين كلمة مرور المستخدم ${outcome.username} عبر رابط الاستعادة وإنهاء جلساته`,
      { userId: outcome.userId, tenantId: outcome.tenantId, accountId: outcome.accountId },
      { targetTenantId: outcome.tenantId, eventCode: AUDIT_EVENT_CODES.AUTH_PASSWORD_RESET_COMPLETED },
    );

    return { ok: true, username: outcome.username };
  }
}
