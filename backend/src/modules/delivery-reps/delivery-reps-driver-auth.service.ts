/**
 * DeliveryRepsDriverAuthService — slice S4 of the delivery-reps split.
 * Pure move of the seven driver-auth methods from DeliveryRepsService:
 * driver login, the internal login flow, PIN change, the PIN-changed
 * guard, and driver token verification. No behavior change: the bodies
 * are byte-identical; the facade keeps thin public delegates with the
 * original signatures. Deps are the database plus the auth cache, which
 * is optional with a fresh default, same shape as the facade ctor.
 * The login limiter field travels with the slice: it is used only by
 * the login methods. PINs stay bcrypt-hashed; nothing about the auth
 * flow is changed. No logger.
 */

import { Injectable } from '@nestjs/common';
import { Kysely } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthCacheService } from '../../core/auth/services/auth-cache.service';
import { AppError } from '../../common/errors/app-error';
import { checkPortalTenantStatus, assertPortalTenantAllowed } from '../../core/auth/utils/portal-tenant-status';
import { LoginAttemptLimiter, normalizePhoneForRateLimit } from '../../common/utils/login-attempt-limiter';
import { createPasswordRecord, verifyPassword } from '../../core/auth/utils/password-hasher';
import { assertSecurePasscode } from '../../core/auth/utils/password-policy';
import {
  PORTAL_TOKEN_PIN_VERSION_CLAIM,
  PORTAL_TOKEN_TTL_MS,
  portalTokenPinVersion,
  signPortalToken,
  verifyPortalToken,
} from '../../core/auth/utils/portal-token';
import { DRIVER_TOKEN_ERRORS, repPinVersion, withPinVersion } from './delivery-reps.helpers';

export interface DeliveryRepsDriverAuthDeps {
  db: Kysely<Database>;
  // Optional with a fresh default, same shape as the facade ctor param.
  authCache?: AuthCacheService;
}

@Injectable()
export class DeliveryRepsDriverAuthService {
  private readonly db: Kysely<Database>;
  private readonly authCache: AuthCacheService;
  private readonly driverLoginLimiter = new LoginAttemptLimiter();

  constructor(deps: DeliveryRepsDriverAuthDeps) {
    this.db = deps.db;
    this.authCache = deps.authCache ?? new AuthCacheService();
  }

  async driverLogin(payload: { phone: string; pinCode: string; companyCode?: string; tenantId?: string }): Promise<{ token: string; rep: Record<string, unknown>; mustChangePin: boolean }> {
    const rawPhone = String(payload?.phone || '').trim();
    const pinCode = String(payload?.pinCode || '').trim();
    const companyScope = payload?.companyCode || payload?.tenantId;

    if (!rawPhone || !pinCode) {
      throw new AppError('رقم الهاتف ورمز الدخول السريع (PIN) مطلوبان', 'INVALID_CREDENTIALS', 400);
    }

    // M14: مفتاح المحدِّد يستخدم رقم الهاتف بعد التطبيع (نفس تطبيع
    // المطابقة أدناه) — فالصيغ +20 / 0 / خام تشترك في دلو واحد.
    const rateLimitKey = `driver-portal:${normalizePhoneForRateLimit(rawPhone)}:${String(companyScope || '').toLowerCase()}`;
    this.driverLoginLimiter.assertNotLocked(rateLimitKey);

    try {
      return await this.driverLoginInternal(payload, rawPhone, pinCode, companyScope, rateLimitKey);
    } catch (error) {
      if (error instanceof AppError && ['UNAUTHORIZED_DRIVER'].includes(error.code)) {
        this.driverLoginLimiter.recordFailure(rateLimitKey);
      }
      throw error;
    }
  }

  private async driverLoginInternal(
    payload: { phone: string; pinCode: string; companyCode?: string; tenantId?: string },
    rawPhone: string,
    pinCode: string,
    companyScope: string | undefined,
    rateLimitKey: string,
  ): Promise<{ token: string; rep: Record<string, unknown>; mustChangePin: boolean }> {
    const cleanDigits = rawPhone.replace(/\D/g, '');
    // M14: نفس دالة التطبيع التي يبني بها driverLogin مفتاح المحدِّد —
    // رقم واحد بأي صيغة يطابق صفاً واحداً ودلواً واحداً.
    const cleanNoCountry = normalizePhoneForRateLimit(rawPhone);

    let resolvedTenantId = companyScope ? String(companyScope).trim() : undefined;
    if (resolvedTenantId) {
      const tenantKey = resolvedTenantId;
      try {
        const tenantRow = await this.db
          .selectFrom('tenants')
          .select(['id', 'slug'])
          .where((eb) => eb.or([eb('id', '=', tenantKey), eb('slug', '=', tenantKey)]))
          .executeTakeFirst();
        if (tenantRow?.id) {
          resolvedTenantId = tenantRow.id;
        }
      } catch {
        // fallback
      }
    }

    let repsQuery = this.db
      .selectFrom('delivery_representatives')
      .selectAll()
      .where('is_active', '=', true);

    if (resolvedTenantId) {
      repsQuery = repsQuery.where('tenant_id', '=', resolvedTenantId);
    }

    const reps = await repsQuery.execute();

    // الهاتف يُرشَّح أولاً (مقارنة نصية رخيصة)، ثم يُتحقق من الـPIN بالتجزئة على
    // المرشحين الباقين فقط — bcrypt مكلف ولا يصح تشغيله على كل المناديب.
    const phoneMatches = reps.filter((r) => {
      if (!r.phone || !r.pin_hash) return false;
      const rDigits = String(r.phone).replace(/\D/g, '');
      const rNoCountry = normalizePhoneForRateLimit(String(r.phone));
      return rNoCountry === cleanNoCountry || rDigits === cleanDigits;
    });

    const pinChecks = await Promise.all(
      phoneMatches.map(async (r) => {
        const res = await verifyPassword(pinCode, String(r.pin_hash), String(r.pin_salt || ''));
        return res.valid;
      }),
    );
    const matchedReps = phoneMatches.filter((_, idx) => pinChecks[idx]);

    if (!matchedReps || matchedReps.length === 0) {
      throw new AppError('بيانات الدخول غير صحيحة أو حساب المندوب غير مفعّل', 'UNAUTHORIZED_DRIVER', 401);
    }

    if (matchedReps.length > 1) {
      const candidateTenantIds = Array.from(
        new Set(matchedReps.map((r) => String(r.tenant_id).trim())),
      ).filter(Boolean);

      let tenantRows: any[] = [];
      try {
        tenantRows = await this.db
          .selectFrom('tenants')
          .select(['id', 'slug', 'business_name'])
          .where('id', 'in', candidateTenantIds)
          .execute();
      } catch {
        tenantRows = [];
      }

      const tenantMap = new Map((tenantRows || []).map((t: any) => [t.id, t]));
      const tenantOptions = candidateTenantIds.map((tId) => {
        const t = tenantMap.get(tId);
        return {
          id: tId,
          name: t?.business_name || t?.slug || tId,
          slug: t?.slug || tId,
        };
      });

      throw new AppError(
        'رقم هاتف المندوب مسجل لدى أكثر من منشأة. يرجى اختيار المنشأة المراد العمل معها لمنع تداخل الحسابات.',
        'MULTIPLE_TENANTS',
        401,
        { tenants: tenantOptions },
      );
    }

    const matchedRep = matchedReps[0];

    // Fetch tenant name for active driver session
    let tenantName = matchedRep.tenant_id;
    try {
      const tenantRow = await this.db
        .selectFrom('tenants')
        .select(['business_name', 'slug'])
        .where('id', '=', matchedRep.tenant_id)
        .executeTakeFirst();
      if (tenantRow?.business_name || tenantRow?.slug) {
        tenantName = tenantRow.business_name || tenantRow.slug;
      }
    } catch {
      // fallback to tenant_id
    }

    // INV-PORTAL-TENANT-STATUS-ENFORCED: no fresh login for a
    // suspended / expired / trial-expired tenant, even with a valid PIN.
    await assertPortalTenantAllowed(this.db as any, this.authCache, String(matchedRep.tenant_id));

    // INV-DRIVER-PIN-FIRST-LOGIN-CHANGE: a PIN that is still the public
    // default must be changed at first login. Detection is a real password
    // check against the stored hash — never a comparison with a stored
    // value — and the default itself is never returned or displayed.
    const mustChangePin = matchedRep.pin_hash
      ? (await verifyPassword('1234', String(matchedRep.pin_hash), String(matchedRep.pin_salt || ''))).valid
      : false;

    const token = signPortalToken(
      {
        repId: Number(matchedRep.id),
        tenantId: matchedRep.tenant_id,
        accountId: matchedRep.account_id,
        name: matchedRep.name,
        phone: matchedRep.phone,
        // M14: الرمز يحمل نسخة الـPIN الحالية؛ أي تغيير PIN لاحق
        // يُبطل هذا الرمز عند التحقق (verifyDriverTokenCore).
        [PORTAL_TOKEN_PIN_VERSION_CLAIM]: repPinVersion((matchedRep as any).metadata),
      },
      PORTAL_TOKEN_TTL_MS,
    );
    this.driverLoginLimiter.recordSuccess(rateLimitKey);

    return {
      token,
      mustChangePin,
      rep: {
        id: matchedRep.id,
        name: matchedRep.name,
        fullName: matchedRep.full_name,
        phone: matchedRep.phone,
        vehiclePlate: matchedRep.vehicle_plate,
        tenantId: matchedRep.tenant_id,
        tenantName,
        isVanRep: Boolean((matchedRep as any).is_van_rep),
        vanLocationId: (matchedRep as any).van_location_id || null,
        permissions: (matchedRep as any).permissions || {},
      },
    };
  }

  /**
   * INV-DRIVER-PIN-FIRST-LOGIN-CHANGE: driver self-service PIN change.
   * The current PIN must verify first; the new credential must pass the
   * shared `assertSecurePasscode` policy (never a trivial value such as
   * 1234/0000) and differ from the current one. Returns a fresh token:
   * once the PIN is no longer the default the session is unflagged.
   * M14: the change bumps the stored PIN version, so every token issued
   * under the old PIN is rejected at verify (verifyDriverTokenCore).
   */
  async driverChangePin(
    driver: { repId: number; tenantId: string; accountId: string; name: string; phone: string },
    body: { currentPin?: string; newPin?: string },
  ): Promise<{ token: string; rep: Record<string, unknown>; mustChangePin: false }> {
    const currentPin = String(body?.currentPin || '').trim();
    const newPin = String(body?.newPin || '').trim();
    if (!currentPin || !newPin) {
      throw new AppError('يرجى إدخال الرمز الحالي والرمز الجديد', 'INVALID_PIN', 400);
    }

    const rep = await this.db
      .selectFrom('delivery_representatives')
      .select(['id', 'name', 'full_name', 'phone', 'vehicle_plate', 'is_active', 'tenant_id', 'account_id', 'pin_hash', 'pin_salt', 'is_van_rep', 'van_location_id', 'permissions', 'metadata'])
      .where('id', '=', driver.repId)
      .where('tenant_id', '=', driver.tenantId)
      .executeTakeFirst();

    if (!rep || rep.is_active === false) {
      throw new AppError('تم إيقاف حساب المندوب. يرجى مراجعة الإدارة', 'DRIVER_INACTIVE', 401);
    }
    if (
      !rep.pin_hash ||
      !(await verifyPassword(currentPin, String(rep.pin_hash), String(rep.pin_salt || ''))).valid
    ) {
      throw new AppError('رمز الدخول الحالي غير صحيح', 'INVALID_PIN', 401);
    }

    assertSecurePasscode(newPin, { phone: String(rep.phone || '') });

    if ((await verifyPassword(newPin, String(rep.pin_hash), String(rep.pin_salt || ''))).valid) {
      throw new AppError('الرمز الجديد يجب أن يختلف عن الرمز الحالي', 'WEAK_PIN', 400);
    }

    const record = await createPasswordRecord(newPin);
    // M14: رفع نسخة الـPIN مع تغييره، في نفس الكتابة — الرمز الجديد
    // يحمل النسخة الجديدة، والرموز القديمة تُرفض عند التحقق.
    const nextPinVersion = repPinVersion((rep as any).metadata) + 1;
    await this.db
      .updateTable('delivery_representatives')
      .set({ pin_hash: record.hash, pin_salt: record.salt, metadata: withPinVersion((rep as any).metadata, nextPinVersion) as any })
      .where('id', '=', driver.repId)
      .where('tenant_id', '=', driver.tenantId)
      .execute();

    let tenantName = String(rep.tenant_id);
    try {
      const tenantRow = await this.db
        .selectFrom('tenants')
        .select(['business_name', 'slug'])
        .where('id', '=', rep.tenant_id)
        .executeTakeFirst();
      if (tenantRow?.business_name || tenantRow?.slug) {
        tenantName = tenantRow.business_name || tenantRow.slug;
      }
    } catch {
      // fallback to tenant_id
    }

    const token = signPortalToken(
      {
        repId: Number(rep.id),
        tenantId: rep.tenant_id,
        accountId: rep.account_id,
        name: rep.name,
        phone: rep.phone,
        // M14: الرمز الجديد يحمل النسخة الجديدة بعد رفعها.
        [PORTAL_TOKEN_PIN_VERSION_CLAIM]: nextPinVersion,
      },
      PORTAL_TOKEN_TTL_MS,
    );

    return {
      token,
      mustChangePin: false,
      rep: {
        id: rep.id,
        name: rep.name,
        fullName: rep.full_name,
        phone: rep.phone,
        vehiclePlate: rep.vehicle_plate,
        tenantId: rep.tenant_id,
        tenantName,
        isVanRep: Boolean((rep as any).is_van_rep),
        vanLocationId: (rep as any).van_location_id || null,
        permissions: (rep as any).permissions || {},
      },
    };
  }

  /**
   * INV-DRIVER-PIN-FIRST-LOGIN-CHANGE: no driver-portal data is served
   * while the rep still uses the default PIN. The flag is re-derived
   * from the live stored hash on every call, never trusted from the
   * token — so a rep who changes the PIN unflags immediately, even on
   * an old token. The change-PIN endpoint is the only escape hatch and
   * does not call this guard. Mirrors the staff portal's
   * assertPinChanged (INV-PORTAL-DEFAULT-PIN-FORCED-CHANGE).
   */
  async assertDriverPinChanged(driver: { repId: number; tenantId: string }): Promise<void> {
    const rep = await this.db
      .selectFrom('delivery_representatives')
      .select(['pin_hash', 'pin_salt'])
      .where('id', '=', driver.repId)
      .where('tenant_id', '=', driver.tenantId)
      .executeTakeFirst();
    if (
      rep?.pin_hash &&
      (await verifyPassword('1234', String(rep.pin_hash), String(rep.pin_salt || ''))).valid
    ) {
      throw new AppError('يجب تغيير رمز الدخول الافتراضي قبل المتابعة', 'PIN_CHANGE_REQUIRED', 403);
    }
  }

  /**
   * يتحقق من رمز بوابة المندوب.
   *
   * الرمز بلا حالة وعمره 30 يوماً، فبعد التحقق من التوقيع يُعاد التأكد من قاعدة
   * البيانات أن المندوب ما زال نشطاً داخل نفس المستأجر — وإلا ظل مندوب موقوف قادراً
   * على البيع والتحصيل باسم المنشأة لمدة شهر بعد إيقافه.
   * M14: يُعاد التأكد أيضاً أن نسخة الـPIN في الرمز تساوي المخزنة —
   * أي تغيير PIN (ذاتي أو من الإدارة) يُبطل فوراً كل رمز صدر قبله.
   */
  /**
   * INV-PORTAL-TENANT-STATUS-ENFORCED: the driver token is stateless,
   * so every request re-checks the rep row AND the tenant status.
   * `settleOnly` is the narrow finish-and-settle path: a suspended
   * tenant's driver may still settle his already-open trip (the settle
   * service methods themselves enforce open-trip + rep ownership), and
   * the caller learns the tenant is suspended via `tenantSuspended`.
   * Every other caller uses the strict form, which throws.
   */
  private async verifyDriverTokenCore(
    token: string,
    settleOnly: boolean,
  ): Promise<{ repId: number; tenantId: string; accountId: string; name: string; phone: string; tenantSuspended: boolean }> {
    const payload = verifyPortalToken<Record<string, any>>(token, DRIVER_TOKEN_ERRORS);

    const repId = Number(payload.repId || 0);
    const tenantId = String(payload.tenantId || '').trim();
    const accountId = String(payload.accountId || '').trim();

    if (!repId || !tenantId || !accountId) {
      throw new AppError('رمز الدخول غير صالح', 'INVALID_DRIVER_TOKEN', 401);
    }

    const rep = await this.db
      .selectFrom('delivery_representatives')
      .select(['id', 'name', 'phone', 'is_active', 'tenant_id', 'account_id', 'metadata'])
      .where('id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!rep || rep.is_active === false) {
      throw new AppError('تم إيقاف حساب المندوب. يرجى مراجعة الإدارة', 'DRIVER_INACTIVE', 401);
    }

    // M14: نسخة الـPIN في الرمز أقدم من المخزنة تعني أن الـPIN تغيّر
    // بعد إصدار الرمز — الرمز مرفوض حتى لو كان توقيعه وعمره سليمين.
    // الرموز القديمة بلا حقل نسخة تُقرأ نسخة 0 (portalTokenPinVersion).
    if (portalTokenPinVersion(payload) !== repPinVersion((rep as any).metadata)) {
      throw new AppError('رمز الدخول غير صالح', 'INVALID_DRIVER_TOKEN', 401);
    }

    const decision = await checkPortalTenantStatus(this.db as any, this.authCache, tenantId);
    if (decision.blocked && !settleOnly) {
      throw new AppError(decision.message || 'تم إيقاف أو انتهاء اشتراك هذه النسخة.', decision.code || 'TENANT_NOT_ALLOWED', 401);
    }
    const tenantSuspended = decision.blocked;

    return {
      repId,
      tenantId: String(rep.tenant_id),
      accountId: String(rep.account_id || accountId),
      name: String(rep.name || payload.name || ''),
      phone: String(rep.phone || payload.phone || ''),
      tenantSuspended,
    };
  }

  async verifyDriverToken(token: string): Promise<{ repId: number; tenantId: string; accountId: string; name: string; phone: string }> {
    const { tenantSuspended: _tenantSuspended, ...driver } = await this.verifyDriverTokenCore(token, false);
    return driver;
  }

  async verifyDriverTokenForSettlement(token: string): Promise<{ repId: number; tenantId: string; accountId: string; name: string; phone: string; tenantSuspended: boolean }> {
    return this.verifyDriverTokenCore(token, true);
  }
}
