import { Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AuthCacheService } from '../../core/auth/services/auth-cache.service';
import { checkPortalTenantStatus } from '../../core/auth/utils/portal-tenant-status';
import { boundedPage } from '../../common/utils/bounded-page';
import {
  PORTAL_TOKEN_PIN_VERSION_CLAIM,
  PORTAL_TOKEN_TTL_MS,
  portalTokenPinVersion,
  signPortalToken,
  verifyPortalToken,
  type PortalTokenErrorSpec,
} from '../../core/auth/utils/portal-token';
import { AppError } from '../../common/errors/app-error';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { UpsertDeliveryRepDto } from './dto/upsert-delivery-rep.dto';
import { LoginAttemptLimiter, normalizePhoneForRateLimit } from '../../common/utils/login-attempt-limiter';
import { assertPortalTenantAllowed } from '../../core/auth/utils/portal-tenant-status';
import { createPasswordRecord, verifyPassword } from '../../core/auth/utils/password-hasher';
import { assertSecurePasscode } from '../../core/auth/utils/password-policy';

import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { SalesFinanceService } from '../sales/services/sales-finance.service';
import { DeliveryRepsAdminService } from './delivery-reps-admin.service';
import { DeliveryRepsReadsService } from './delivery-reps-reads.service';
import { DeliveryRepsSettlementsService } from './delivery-reps-settlements.service';

@Injectable()
export class DeliveryRepsService {
  private readonly admin: DeliveryRepsAdminService;
  private readonly readsService: DeliveryRepsReadsService;
  private readonly settlements: DeliveryRepsSettlementsService;

  private readonly driverLoginLimiter = new LoginAttemptLimiter();

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly accountingPosting: AccountingPostingService,
    private readonly salesFinance: SalesFinanceService,
    @Optional() private readonly authCache: AuthCacheService = new AuthCacheService(),
  ) {
    this.admin = new DeliveryRepsAdminService({
      db: this.db,
      audit: this.audit,
      tenantPredicate: this.tenantPredicate.bind(this),
      tenantFields: this.tenantFields.bind(this),
    });
    this.readsService = new DeliveryRepsReadsService({
      db: this.db,
      tenantPredicate: this.tenantPredicate.bind(this),
      getDeliveryFeeMode: this.getDeliveryFeeMode.bind(this),
      repOrderCashDue: this.repOrderCashDue.bind(this),
    });
    this.settlements = new DeliveryRepsSettlementsService({
      db: this.db,
      audit: this.audit,
      accountingPosting: this.accountingPosting,
      salesFinance: this.salesFinance,
      tenantPredicate: this.tenantPredicate.bind(this),
      tenantFields: this.tenantFields.bind(this),
      getDeliveryFeeMode: this.getDeliveryFeeMode.bind(this),
    });
  }

  private tenantPredicate(actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    return sql<boolean>`tenant_id = ${tenantId}`;
  }

  private tenantFields(actor: AuthContext) {
    const { tenantId, accountId } = requireTenantScope(actor);
    return { tenant_id: tenantId, account_id: accountId };
  }

  private async getDeliveryFeeMode(trx: Kysely<Database>, actor: AuthContext): Promise<'freelance_courier' | 'store_fleet'> {
    const row = await trx
      .selectFrom('settings')
      .select(['value'])
      .where('key', '=', 'deliveryFeeMode')
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();
    if (!row?.value) return 'freelance_courier';
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      return parsed === 'store_fleet' ? 'store_fleet' : 'freelance_courier';
    } catch {
      return String(row.value).includes('store_fleet') ? 'store_fleet' : 'freelance_courier';
    }
  }

  async list(actor: AuthContext): Promise<Record<string, unknown>> {
    return this.admin.list(actor);
  }

  async create(payload: UpsertDeliveryRepDto, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.admin.create(payload, actor);
  }

  async update(id: number, payload: UpsertDeliveryRepDto, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.admin.update(id, payload, actor);
  }

  async remove(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.admin.remove(id, actor);
  }

  async listOrders(repId: number, actor: AuthContext, filters?: { dateFrom?: string; dateTo?: string; status?: string; discountedOnly?: boolean; page?: number; pageSize?: number }): Promise<Record<string, unknown>> {
    return this.readsService.listOrders(repId, actor, filters);
  }

  async listSettlements(repId: number, actor: AuthContext, filters?: { dateFrom?: string; dateTo?: string; page?: number; pageSize?: number }): Promise<Record<string, unknown>> {
    return this.readsService.listSettlements(repId, actor, filters);
  }

  async getRepKPIs(repId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.readsService.getRepKPIs(repId, actor);
  }

  async settleOrder(
    saleId: number,
    actor: AuthContext,
    payload?: { signatureDataUrl?: string; proofPhotoUrl?: string; gpsLat?: number; gpsLng?: number; notes?: string; countedCashAmount?: number }
  ): Promise<Record<string, unknown>> {
    return this.settlements.settleOrder(saleId, actor, payload);
  }

  async settlePartialOrder(
    saleId: number,
    actor: AuthContext,
    payload?: { signatureDataUrl?: string; proofPhotoUrl?: string; gpsLat?: number; gpsLng?: number; notes?: string; countedCashAmount?: number }
  ): Promise<Record<string, unknown>> {
    return this.settlements.settlePartialOrder(saleId, actor, payload);
  }

  /**
   * INV-SF-REP-CUSTODY-NET-RETURNS (D-SF-10): the cash a rep still
   * owes (pending) or has handed over (collected) for ONE order,
   * derived from deliverySettlementBasis — the single source of
   * truth the settle gates and postDeliveryRepSettlement already
   * use — never from gross sales.total. A prior return already
   * reversed part of the receivable (and relieved part of the
   * fee), so the gross total charges the rep for money the
   * customer no longer owes (live divergence 131.60: return
   * ZR-261110-0601 reversed the sale JE while the badge kept
   * 131.60). The formula is settleAllOrders' cashDue exactly:
   * store-fleet owes the remaining receivable; a freelance
   * courier owes it minus the remaining fee, floored at zero.
   *
   * INV-REP-PREPAID-SHIFT-TREASURY (M6/A7): a rep-prepaid order
   * owes the PAID amount, not the remaining receivable — the sale
   * posted as paid at creation, so the remaining receivable is
   * already zero while the rep still holds the cash. The rep hands
   * over the paid amount minus the remaining courier fee (zero for
   * a store-fleet sale: the basis already reports a zero remaining
   * fee for it), floored at zero. The fee still comes from the
   * basis, so a prior return that relieved part of the fee is
   * honoured exactly like the COD formula.
   */
  private async repOrderCashDue(
    order: { id: number; delivery_fee_mode: string | null; collection_status?: string | null; paid_amount?: number | string | null },
    defaultMode: 'freelance_courier' | 'store_fleet',
    moneyDigits: MoneyDigits,
    actor: AuthContext,
  ): Promise<number> {
    const basis = await this.accountingPosting.deliverySettlementBasis(this.db, Number(order.id), actor);
    if (String(order.collection_status || '') === 'prepaid_by_rep') {
      return Math.max(0, roundMoney(Number(order.paid_amount || 0) - basis.remainingFee, moneyDigits));
    }
    return (order.delivery_fee_mode || defaultMode) === 'store_fleet'
      ? basis.remainingReceivable
      : Math.max(0, roundMoney(basis.remainingReceivable - basis.remainingFee, moneyDigits));
  }

  async getRepSummary(repId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.readsService.getRepSummary(repId, actor);
  }

  async getRepLifetimeReport(repId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.readsService.getRepLifetimeReport(repId, actor);
  }

  async settleAllOrders(repId: number, expectedAmount: number, actor: AuthContext, countedCashAmount?: number): Promise<Record<string, unknown>> {
    return this.settlements.settleAllOrders(repId, expectedAmount, actor, countedCashAmount);
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

  async driverListOrders(repId: number, tenantId: string, accountId: string, filters?: { dateFrom?: string; dateTo?: string; status?: string; page?: number; pageSize?: number }): Promise<Record<string, unknown>> {
    const { page, pageSize, offset } = boundedPage(filters?.page, filters?.pageSize);
    let query = this.db
      .selectFrom('sales')
      .leftJoin('customers', (join) => join.onRef('customers.id', '=', 'sales.customer_id').onRef('customers.tenant_id', '=', 'sales.tenant_id'))
      .select([
        'sales.id',
        'sales.doc_no as docNo',
        'sales.total',
        'sales.delivery_fee as deliveryFee',
        'sales.delivery_fee_mode as deliveryFeeMode',
        'customers.name as customerName',
        'customers.phone as customerPhone',
        'customers.address as customerAddress',
        'sales.order_type as orderType',
        'sales.delivery_rep_id as deliveryRepId',
        'sales.delivery_status as deliveryStatus',
        'sales.collection_status as collectionStatus',
        sql<string | null>`sales.delivery_signature`.as('deliverySignature'),
        sql<string | null>`sales.delivery_photo_url`.as('deliveryPhotoUrl'),
        sql<number | null>`sales.delivery_gps_lat`.as('deliveryGpsLat'),
        sql<number | null>`sales.delivery_gps_lng`.as('deliveryGpsLng'),
        sql<string | null>`sales.delivery_notes`.as('deliveryNotes'),
        'sales.settled_at as settledAt',
        'sales.created_at as createdAt',
      ])
      .where('sales.delivery_rep_id', '=', repId)
      .where('sales.tenant_id', '=', tenantId);

    if (filters?.status) {
      if (filters.status === 'pending') {
        query = query.where((eb) => eb.or([
          eb('sales.delivery_status', '!=', 'settled'),
          eb('sales.delivery_status', 'is', null),
        ]));
      } else if (filters.status === 'settled') {
        query = query.where('sales.delivery_status', '=', 'settled');
      }
    }

    const orders = await query.orderBy('sales.created_at', 'desc').orderBy('sales.id', 'desc').limit(pageSize + 1).offset(offset).execute();
    // INV-DRIVER-PORTAL-REMAINING-AMOUNT (M15): the driver portal
    // showed the raw invoice total per row (and summed it into the
    // pending badge) although the rep owes only the remaining cash
    // due — a prior return already reversed part of the receivable.
    // Mirror the listOrders pattern: each page row carries its
    // remaining cash due from deliverySettlementBasis (store-fleet:
    // remaining receivable; freelance: remaining receivable minus
    // remaining fee, floored at zero) as `remainingAmount`, while
    // `total` stays the invoice total. The driver token carries no
    // full session, so the basis runs on a minimal { tenantId,
    // accountId } scope — the only fields requireTenantScope reads.
    // Only the page rows are priced (pageSize <= 200), never the
    // lookahead row.
    const pageRows = orders.slice(0, pageSize);
    const driverActor = { tenantId, accountId } as AuthContext;
    const defaultMode = await this.getDeliveryFeeMode(this.db, driverActor);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const ordersWithRemaining = [];
    for (const row of pageRows) {
      const remainingAmount = await this.repOrderCashDue(
        { id: Number(row.id), delivery_fee_mode: (row as any).deliveryFeeMode ?? null },
        defaultMode,
        moneyDigits,
        driverActor,
      );
      ordersWithRemaining.push({ ...row, remainingAmount });
    }
    return { ok: true, orders: ordersWithRemaining, pagination: { page, pageSize, hasMore: orders.length > pageSize } };
  }

  async driverSettleOrder(
    saleId: number,
    repId: number,
    tenantId: string,
    payload?: { signatureDataUrl?: string; proofPhotoUrl?: string; gpsLat?: number; gpsLng?: number; notes?: string }
  ): Promise<Record<string, unknown>> {
    await this.db.transaction().execute(async (trx) => {
      const sale = await trx
        .selectFrom('sales')
        .select(['id', 'delivery_rep_id', 'delivery_status', 'tenant_id'])
        .where('id', '=', saleId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!sale) throw new AppError('الطلب غير موجود', 'ORDER_NOT_FOUND', 404);
      if (Number(sale.delivery_rep_id) !== Number(repId)) {
        throw new AppError('هذا الطلب غير مسند إلى هذا المندوب', 'NOT_ASSIGNED', 403);
      }
      if (sale.delivery_status === 'settled') {
        throw new AppError('تمت تسوية هذا الطلب مسبقاً', 'ALREADY_SETTLED', 400);
      }

      // Proof of delivery is not a cash settlement. The authorized cashier must
      // still post the courier's COD custody/treasury/GL atomically via settleOrder.
      if (sale.delivery_status === 'delivered') return;

      // C5 (INV-DISPATCH-STATE-GUARDS-AUDIT): proof of delivery is only
      // meaningful after dispatch — a pending order was never handed to
      // any rep, so marking it delivered would skip dispatch/custody
      // entirely (pending -> delivered directly).
      if (sale.delivery_status !== 'out_for_delivery') {
        throw new AppError('لا يمكن إثبات توصيل طلب لم يُصرف بعد؛ اصرف الطلب إلى المندوب أولاً', 'DELIVERY_NOT_DISPATCHED', 409);
      }

      const updateData: Record<string, any> = {
        delivery_status: 'delivered',
        updated_at: sql`NOW()`,
      };
      if (payload?.signatureDataUrl) updateData.delivery_signature = payload.signatureDataUrl;
      if (payload?.proofPhotoUrl) updateData.delivery_photo_url = payload.proofPhotoUrl;
      if (payload?.gpsLat !== undefined && payload?.gpsLat !== null) updateData.delivery_gps_lat = payload.gpsLat;
      if (payload?.gpsLng !== undefined && payload?.gpsLng !== null) updateData.delivery_gps_lng = payload.gpsLng;
      if (payload?.notes) updateData.delivery_notes = payload.notes;

      await trx
        .updateTable('sales')
        .set(updateData)
        .where('id', '=', saleId)
        .where('tenant_id', '=', tenantId)
        .execute();

      await trx
        .updateTable('online_orders')
        .set({
          status: 'delivered',
          updated_at: sql`NOW()`,
        })
        .where('sale_id', '=', saleId)
        .where('tenant_id', '=', tenantId)
        .where('status', '!=', 'cancelled')
        .execute();
    });

    return { ok: true, message: 'تم إثبات تسليم الشحنة؛ عهدة التحصيل قيد التسوية' };
  }

  /**
   * Restaurant & F&B Dispatch Console: 1-click batch order dispatch to driver
   */
  async dispatchOrders(
    actor: AuthContext,
    payload: { repId: number; saleIds?: number[]; onlineOrderIds?: number[]; notes?: string }
  ) {
    const validateIds = (ids: number[] | undefined): number[] => {
      const values = ids || [];
      if (!Array.isArray(values) || values.length > 200 ||
          values.some(id => !Number.isSafeInteger(id) || id <= 0) ||
          new Set(values).size !== values.length) {
        throw new AppError('معرفات الطلبات غير صالحة أو مكررة', 'DELIVERY_DISPATCH_INVALID_IDS', 400);
      }
      return values;
    };
    const saleIds = validateIds(payload.saleIds);
    const onlineOrderIds = validateIds(payload.onlineOrderIds);
    if (!saleIds.length && !onlineOrderIds.length) {
      throw new AppError('اختر طلباً واحداً على الأقل', 'DELIVERY_DISPATCH_EMPTY', 400);
    }

    const result = await this.db.transaction().execute(async (trx) => {
      const rep = await trx.selectFrom('delivery_representatives')
        .select(['id', 'name', 'phone', 'is_active'])
        .where('id', '=', payload.repId).where(this.tenantPredicate(actor))
        .executeTakeFirst();
      if (!rep || !rep.is_active) {
        throw new AppError('مندوب التوصيل غير موجود أو غير نشط', 'DELIVERY_REP_NOT_FOUND', 404);
      }
      const now = new Date();
      const notifications: Array<{ recipientPhone: string; orderNumber: string; text: string }> = [];
      // D-SF-02 (INV-SF-COD-CUSTODY-GL): the sales dispatched in this
      // transaction (direct ids + online-order links) are the ones
      // whose receivable moves to courier custody below.
      const dispatchedSaleIds: number[] = [...saleIds];

      // C12 (INV-DISPATCH-STATE-GUARDS-AUDIT): one audit row per
      // dispatched item (sale or online order), written in this same
      // transaction so a rolled-back dispatch leaves no audit trace.
      // A re-assignment (oldRepId set) records old rep -> new rep.
      const auditEntries: Array<{ orderLabel: string; oldRepId: number | null }> = [];

      if (saleIds.length) {
        const sales = await trx.selectFrom('sales')
          .select(['id','doc_no','customer_phone','order_type','status','delivery_status','delivery_rep_id'])
          .where('id', 'in', saleIds).where(this.tenantPredicate(actor))
          .orderBy('id', 'asc').forUpdate().execute();
        if (sales.length !== saleIds.length ||
            sales.some(s => s.status === 'cancelled' ||
              ['delivered', 'settled'].includes(String(s.delivery_status)) ||
              (s.delivery_rep_id && Number(s.delivery_rep_id) !== Number(rep.id) &&
                !['pending', null].includes(s.delivery_status)))) {
          throw new AppError('لا يمكن إسناد طلب ملغي أو مسلّم بالفعل أو في عهدة مندوب آخر', 'DELIVERY_DISPATCH_FORBIDDEN', 409);
        }
        // C4: a pending order re-assigned to another rep is allowed,
        // but the old -> new rep move must be recorded, not silent.
        for (const s of sales) {
          auditEntries.push({
            orderLabel: `#${s.id}`,
            oldRepId: s.delivery_rep_id && Number(s.delivery_rep_id) !== Number(rep.id)
              ? Number(s.delivery_rep_id)
              : null,
          });
        }
        await trx.updateTable('sales').set({
          order_type: 'delivery',
          delivery_rep_id: rep.id,
          delivery_status: 'out_for_delivery',
          dispatched_at: now,
          ...(payload.notes ? { note: sql`COALESCE(note, '') || ${' [' + payload.notes + ']'}` as any } : {}),
        }).where('id', 'in', saleIds).where(this.tenantPredicate(actor)).execute();

        for (const s of sales) if (s.customer_phone) {
          notifications.push({
            recipientPhone: s.customer_phone,
            orderNumber: s.doc_no || `SALE-${s.id}`,
            text: `عزيزي العميل، طلبك رقم #${s.doc_no || s.id} في الطريق إليك مع كابتن التوصيل ${rep.name} (${rep.phone || ''}). نتمنى لك وجبة شهية!`,
          });
        }
      }

      if (onlineOrderIds.length) {
        const orders = await trx.selectFrom('online_orders')
          .select(['id','order_number','customer_phone','status','sale_id'])
          .where('id', 'in', onlineOrderIds).where(this.tenantPredicate(actor))
          .orderBy('id', 'asc').forUpdate().execute();
        if (orders.length !== onlineOrderIds.length ||
            orders.some(order => ['cancelled','delivered','returned'].includes(String(order.status)))) {
          throw new AppError('طلب أونلاين غير موجود أو أُلغي أو سُلّم بالفعل', 'DELIVERY_DISPATCH_FORBIDDEN', 409);
        }
        await trx.updateTable('online_orders').set({
          status: 'shipped', dispatched_at: now,
        }).where('id','in',onlineOrderIds).where(this.tenantPredicate(actor)).execute();

        const linkedSaleIds = orders.map(o => o.sale_id).filter((id): id is number => Boolean(id) && Number(id) > 0);
        dispatchedSaleIds.push(...linkedSaleIds);
        if (linkedSaleIds.length > 0) {
          // C2 (INV-DISPATCH-STATE-GUARDS-AUDIT): mirror the saleIds
          // guard on the linked sale — a settled sale, or one already
          // out for delivery in another rep's custody, must be
          // refused here too, not silently overwritten.
          const linkedSales = await trx.selectFrom('sales')
            .select(['id', 'status', 'delivery_status', 'delivery_rep_id'])
            .where('id', 'in', [...new Set(linkedSaleIds)]).where(this.tenantPredicate(actor))
            .orderBy('id', 'asc').forUpdate().execute();
          if (linkedSales.length !== new Set(linkedSaleIds).size ||
              linkedSales.some(s => s.status === 'cancelled' ||
                ['delivered', 'settled'].includes(String(s.delivery_status)) ||
                (s.delivery_rep_id && Number(s.delivery_rep_id) !== Number(rep.id) &&
                  !['pending', null].includes(s.delivery_status)))) {
            throw new AppError('لا يمكن إسناد طلب أونلاين مسلّم بالفعل أو مُسوَّى أو في عهدة مندوب آخر', 'DELIVERY_DISPATCH_FORBIDDEN', 409);
          }
          const linkedById = new Map(linkedSales.map(s => [Number(s.id), s]));
          for (const order of orders) {
            if (!order.sale_id) {
              auditEntries.push({ orderLabel: `أونلاين #${order.order_number || order.id}`, oldRepId: null });
              continue;
            }
            const linked = linkedById.get(Number(order.sale_id));
            auditEntries.push({
              orderLabel: `#${order.sale_id}`,
              oldRepId: linked && linked.delivery_rep_id && Number(linked.delivery_rep_id) !== Number(rep.id)
                ? Number(linked.delivery_rep_id)
                : null,
            });
          }
          await trx.updateTable('sales').set({
            order_type: 'delivery',
            delivery_rep_id: rep.id,
            delivery_status: 'out_for_delivery',
            dispatched_at: now,
            ...(payload.notes ? { note: sql`COALESCE(note, '') || ${' [' + payload.notes + ']'}` as any } : {}),
          }).where('id', 'in', linkedSaleIds).where(this.tenantPredicate(actor)).execute();
        } else {
          // Online orders with no linked sale still get an audit row.
          for (const order of orders) {
            auditEntries.push({ orderLabel: `أونلاين #${order.order_number || order.id}`, oldRepId: null });
          }
        }

        for (const order of orders) if (order.customer_phone) {
          notifications.push({
            recipientPhone: order.customer_phone,
            orderNumber: order.order_number,
            text: `عزيزي العميل، طلبك رقم #${order.order_number} في الطريق إليك مع كابتن التوصيل ${rep.name} (${rep.phone || ''}). نتمنى لك وجبة شهية!`,
          });
        }
      }
      // D-SF-02 (INV-SF-COD-CUSTODY-GL): dispatch moves the COD
      // receivable off the customer to courier custody — GL
      // reclassification plus the customer-ledger leg that takes
      // the customer balance to zero for the order, in this same
      // transaction. Prepaid / fully-returned sales are a no-op
      // inside the reclassification (remaining 0). A re-dispatch
      // to the same rep is idempotent there and writes no second
      // ledger leg.
      for (const dispatchedSaleId of dispatchedSaleIds) {
        const reclass = await this.accountingPosting.postDeliveryCustodyReclassification(trx, dispatchedSaleId, rep.id, actor);
        if (reclass.posted && reclass.amount > 0 && reclass.customerId) {
          await this.salesFinance.addCustomerLedgerLeg(trx, reclass.customerId, -reclass.amount, 'delivery_custody_transfer', `نقل عهدة فاتورة #${reclass.docNo} إلى مندوب التوصيل ${rep.name}`, 'sale', dispatchedSaleId, actor);
        }
      }
      // C12: one audit row per dispatched item, in this same
      // transaction. A re-assignment row names the old rep too.
      for (const entry of auditEntries) {
        const reassigned = entry.oldRepId !== null;
        await this.audit.logWithExecutor(trx,
          reassigned ? 'إعادة إسناد طلب توصيل' : 'إسناد طلب توصيل',
          reassigned
            ? `تمت إعادة إسناد الطلب ${entry.orderLabel} من المندوب #${entry.oldRepId} إلى المندوب ${rep.name} (#${rep.id}) بواسطة ${actor.username}`
            : `تم إسناد الطلب ${entry.orderLabel} إلى المندوب ${rep.name} (#${rep.id}) بواسطة ${actor.username}`,
          actor,
          { eventCode: 'DELIVERY_ORDER_DISPATCHED' });
      }
      return { rep, notifications };
    });

    return {
      success: true,
      repId: result.rep.id,
      repName: result.rep.name,
      dispatchedCount: saleIds.length + onlineOrderIds.length,
      notifications: result.notifications,
      message: `تم إسناد وانطلاق ${saleIds.length + onlineOrderIds.length} طلب بنجاح مع الكابتن ${result.rep.name}`,
    };
  }
}
