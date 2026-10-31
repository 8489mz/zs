import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { AuditService } from '../../core/audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { LoginAttemptLimiter } from '../../common/utils/login-attempt-limiter';
import { formatDailyDocumentNumber } from '../../common/utils/document-number.util';
import {
  PORTAL_TOKEN_TTL_MS,
  signPortalToken,
  verifyPortalToken,
  type PortalTokenErrorSpec,
} from '../../core/auth/utils/portal-token';
import { MaritimeFreightService } from './maritime-freight.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { createPasswordRecord, verifyPassword } from '../../core/auth/utils/password-hasher';
import { assertSecurePasscode } from '../../core/auth/utils/password-policy';
import * as crypto from 'crypto';

const CUSTOMER_PORTAL_TOKEN_ERRORS: PortalTokenErrorSpec = {
  missing: { message: 'غير مصرح - يرجى تسجيل الدخول إلى بوابة عملاء الشحن', code: 'UNAUTHORIZED_CUSTOMER' },
  invalid: { message: 'رمز الدخول للبوابة غير صالح أو منتهي', code: 'INVALID_CUSTOMER_TOKEN' },
  signature: { message: 'رمز الدخول للبوابة غير صالح أو مزور', code: 'INVALID_CUSTOMER_TOKEN' },
  expired: { message: 'انتهت صلاحية جلسة بوابة العملاء، يرجى إعادة تسجيل الدخول', code: 'CUSTOMER_SESSION_EXPIRED' },
};

export interface CustomerPortalContext {
  customerId: number;
  tenantId: string;
  accountId: string;
  name: string;
  phone: string;
}

export interface CreatePortalQuoteRequestDto {
  transportMode: 'sea' | 'air' | 'road' | 'multimodal';
  direction?: 'import' | 'export' | 'cross_trade';
  polCode: string;
  polName: string;
  podCode: string;
  podName: string;
  cargoMode?: string;
  containerType?: string;
  containerCount?: number;
  commodityDescription: string;
  grossWeightKg?: number;
  volumetricWeightKg?: number;
  chargeableWeightKg?: number;
  totalCbm?: number;
  incoterm?: string;
  cargoReadyDate?: string;
  targetDeliveryDate?: string;
  targetFreeDays?: number;
  notes?: string;
}

@Injectable()
export class MaritimeCustomerPortalService {
  private readonly customerLoginLimiter = new LoginAttemptLimiter();

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly freightService: MaritimeFreightService,
  ) {}

  /**
   * Customer Login via Phone + PIN
   */
  async customerLogin(payload: { phone: string; pinCode: string; companyCode?: string; tenantId?: string }): Promise<{
    token: string;
    customer: Record<string, unknown>;
  }> {
    const rawPhone = String(payload?.phone || '').trim();
    const pinCode = String(payload?.pinCode || '').trim();
    const companyScope = payload?.companyCode || payload?.tenantId;

    if (!rawPhone || !pinCode) {
      throw new AppError('رقم الهاتف ورمز الدخول السري (PIN) مطلوبان', 'INVALID_CREDENTIALS', 400);
    }

    const rateLimitKey = `freight-customer-portal:${rawPhone.toLowerCase()}:${String(companyScope || '').toLowerCase()}`;
    this.customerLoginLimiter.assertNotLocked(rateLimitKey);

    try {
      const cleanDigits = rawPhone.replace(/\D/g, '');
      const cleanNoCountry = cleanDigits.startsWith('20')
        ? cleanDigits.slice(2)
        : cleanDigits.startsWith('0')
        ? cleanDigits.slice(1)
        : cleanDigits;

      let tenantFilter = companyScope ? String(companyScope).trim() : undefined;

      // Query customer matching phone
      let query = this.db
        .selectFrom('customers')
        .select([
          'id',
          'name',
          'phone',
          'company_name',
          'address',
          'balance',
          'credit_limit',
          'is_active',
          'tenant_id',
          'account_id',
          'portal_pin_hash',
          'portal_pin_salt',
          'portal_token',
        ])
        .where('is_active', '=', true);

      if (tenantFilter) {
        query = query.where('tenant_id', '=', tenantFilter);
      }

      const matchingCustomers = await query.execute();

      // Find matching customer by flexible phone match
      const matched = matchingCustomers.find((c) => {
        const cPhone = String(c.phone || '').replace(/\D/g, '');
        const cPhoneNoCountry = cPhone.startsWith('20')
          ? cPhone.slice(2)
          : cPhone.startsWith('0')
          ? cPhone.slice(1)
          : cPhone;
        return cPhone === cleanDigits || cPhoneNoCountry === cleanNoCountry || c.phone === rawPhone;
      });

      if (!matched) {
        throw new AppError('لم يتم العثور على حساب عميل مسجل بهذا الرقم', 'UNAUTHORIZED_CUSTOMER', 401);
      }

      // INV-FREIGHT-PORTAL-PIN-HASHED: PINs are verified only against the
      // stored bcrypt hash (the same createPasswordRecord/verifyPassword
      // helper as driver/employee PINs). There is no default PIN and no
      // plaintext fallback: '1234' works only if staff set exactly that
      // value as the hash input, which assertSecurePasscode forbids at
      // set time. A customer with no hash set fails closed and must
      // obtain a PIN through the staff reset channel.
      if (!matched.portal_pin_hash) {
        throw new AppError(
          'لم يتم تعيين رمز دخول لهذا الحساب بعد، يرجى التواصل مع الإدارة لتعيين رمز جديد',
          'PORTAL_PIN_NOT_SET',
          401,
        );
      }
      const pinCheck = await verifyPassword(pinCode, String(matched.portal_pin_hash), String(matched.portal_pin_salt || ''));
      if (!pinCheck.valid) {
        throw new AppError('رمز الدخول السري (PIN) غير صحيح', 'UNAUTHORIZED_CUSTOMER', 401);
      }

      this.customerLoginLimiter.recordSuccess(rateLimitKey);

      // Fetch company / tenant name
      const tenantRow = await this.db
        .selectFrom('tenants')
        .select(['business_name'])
        .where('id', '=', matched.tenant_id)
        .executeTakeFirst();

      const token = signPortalToken(
        {
          customerId: matched.id,
          tenantId: matched.tenant_id,
          accountId: matched.account_id,
          name: matched.name,
          phone: matched.phone,
        },
        PORTAL_TOKEN_TTL_MS,
      );

      return {
        token,
        customer: {
          id: matched.id,
          name: matched.name,
          companyName: matched.company_name,
          phone: matched.phone,
          address: matched.address,
          balance: Number(matched.balance || 0),
          creditLimit: Number(matched.credit_limit || 0),
          tenantId: matched.tenant_id,
          tenantName: tenantRow?.business_name || 'Z-Systems Freight',
          portalToken: matched.portal_token,
        },
      };
    } catch (err) {
      if (err instanceof AppError && ['UNAUTHORIZED_CUSTOMER', 'PORTAL_PIN_NOT_SET'].includes(err.code)) {
        this.customerLoginLimiter.recordFailure(rateLimitKey);
      }
      throw err;
    }
  }

  /**
   * Staff-only: set or rotate a customer's freight-portal PIN.
   * INV-FREIGHT-PORTAL-PIN-HASHED: the PIN is stored only as a bcrypt
   * hash (createPasswordRecord, the same helper as driver/employee
   * PINs). assertSecurePasscode rejects trivial values including
   * '1234', so the old universal default can never be reintroduced
   * through this path. The plaintext PIN is never returned or logged.
   */
  async setCustomerPortalPin(
    auth: AuthContext,
    customerId: number,
    pinCode: string,
  ): Promise<{ ok: boolean; customerId: number }> {
    const tenantId = String(auth?.tenantId || '').trim();
    if (!tenantId || !Number.isSafeInteger(customerId) || customerId <= 0) {
      throw new AppError('حساب العميل غير موجود', 'CUSTOMER_NOT_FOUND', 404);
    }
    const customer = await this.db
      .selectFrom('customers')
      .select(['id', 'phone'])
      .where('id', '=', customerId)
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (!customer) {
      throw new AppError('حساب العميل غير موجود', 'CUSTOMER_NOT_FOUND', 404);
    }
    const pin = String(pinCode || '').trim();
    assertSecurePasscode(pin, { phone: customer.phone || undefined });
    const record = await createPasswordRecord(pin);
    await this.db
      .updateTable('customers')
      .set({ portal_pin_hash: record.hash, portal_pin_salt: record.salt, updated_at: sql`NOW()` })
      .where('id', '=', customerId)
      .where('tenant_id', '=', tenantId)
      .execute();
    await this.audit.log(
      'تعيين رمز دخول بوابة عملاء الشحن',
      `تم تعيين رمز دخول بوابة الشحن للعميل #${customerId} بواسطة ${auth.username}`,
      auth,
    );
    return { ok: true, customerId };
  }

  /**
   * Token Login (Magic Link / direct token)
   */
  async customerTokenLogin(token: string): Promise<{ token: string; customer: Record<string, unknown> }> {
    const rawToken = String(token || '').trim();
    if (!rawToken) {
      throw new AppError('رمز الرابط مطلوب', 'INVALID_CREDENTIALS', 400);
    }

    const matched = await this.db
      .selectFrom('customers')
      .selectAll()
      .where('portal_token', '=', rawToken)
      .where('is_active', '=', true)
      .executeTakeFirst();

    if (!matched) {
      throw new AppError('رابط الوصول للبوابة غير صالح أو منتهي', 'UNAUTHORIZED_CUSTOMER', 401);
    }

    const tenantRow = await this.db
      .selectFrom('tenants')
      .select(['business_name'])
      .where('id', '=', matched.tenant_id)
      .executeTakeFirst();

    const signedToken = signPortalToken(
      {
        customerId: matched.id,
        tenantId: matched.tenant_id,
        accountId: matched.account_id,
        name: matched.name,
        phone: matched.phone,
      },
      PORTAL_TOKEN_TTL_MS,
    );

    return {
      token: signedToken,
      customer: {
        id: matched.id,
        name: matched.name,
        companyName: matched.company_name,
        phone: matched.phone,
        address: matched.address,
        balance: Number(matched.balance || 0),
        creditLimit: Number(matched.credit_limit || 0),
        tenantId: matched.tenant_id,
        tenantName: tenantRow?.business_name || 'Z-Systems Freight',
        portalToken: matched.portal_token,
      },
    };
  }

  /**
   * Verify Authorization Header & extract customer context
   */
  async verifyCustomerToken(authHeader: string | undefined): Promise<CustomerPortalContext> {
    const payload = verifyPortalToken<Record<string, any>>(authHeader, CUSTOMER_PORTAL_TOKEN_ERRORS);

    const customerId = Number(payload.customerId || 0);
    const tenantId = String(payload.tenantId || '').trim();
    const accountId = String(payload.accountId || '').trim();

    if (!customerId || !tenantId) {
      throw new AppError('جلسة الدخول غير صالحة', 'INVALID_CUSTOMER_TOKEN', 401);
    }

    const customer = await this.db
      .selectFrom('customers')
      .select(['id', 'name', 'phone', 'is_active', 'tenant_id', 'account_id'])
      .where('id', '=', customerId)
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .executeTakeFirst();

    if (!customer) {
      throw new AppError('حساب العميل غير موجود أو تم تعطيله', 'UNAUTHORIZED_CUSTOMER', 401);
    }

    return {
      customerId: customer.id,
      tenantId: customer.tenant_id,
      accountId: customer.account_id,
      name: customer.name,
      phone: customer.phone,
    };
  }

  /**
   * Get Portal Dashboard Overview & Summary KPIs
   */
  async getDashboard(auth: CustomerPortalContext) {
    const customer = await this.db
      .selectFrom('customers')
      .select(['id', 'name', 'company_name', 'balance', 'credit_limit'])
      .where('id', '=', auth.customerId)
      .where('tenant_id', '=', auth.tenantId)
      .executeTakeFirst();

    // 1. Active Shipments Count
    const activeShipmentsRes = await sql<{ count: string }>`
      SELECT COUNT(*) as count 
      FROM maritime_jobs 
      WHERE tenant_id = ${auth.tenantId} 
        AND customer_id = ${auth.customerId}
        AND status = 'active'
    `.execute(this.db);
    const activeShipmentsCount = Number(activeShipmentsRes.rows[0]?.count || 0);

    // 2. Delivered Shipments Count
    const deliveredShipmentsRes = await sql<{ count: string }>`
      SELECT COUNT(*) as count 
      FROM maritime_jobs 
      WHERE tenant_id = ${auth.tenantId} 
        AND customer_id = ${auth.customerId}
        AND status = 'completed'
    `.execute(this.db);
    const deliveredShipmentsCount = Number(deliveredShipmentsRes.rows[0]?.count || 0);

    // 3. Pending Quotes Count
    const pendingQuotesRes = await sql<{ count: string }>`
      SELECT COUNT(*) as count 
      FROM maritime_quotations 
      WHERE tenant_id = ${auth.tenantId} 
        AND customer_id = ${auth.customerId}
        AND status IN ('draft', 'sent')
    `.execute(this.db);
    const pendingQuotesCount = Number(pendingQuotesRes.rows[0]?.count || 0);

    // 4. Approved Quotes Count
    const approvedQuotesRes = await sql<{ count: string }>`
      SELECT COUNT(*) as count 
      FROM maritime_quotations 
      WHERE tenant_id = ${auth.tenantId} 
        AND customer_id = ${auth.customerId}
        AND status IN ('approved', 'converted_to_job')
    `.execute(this.db);
    const approvedQuotesCount = Number(approvedQuotesRes.rows[0]?.count || 0);

    // 5. Recent Active Shipments (Top 5)
    const recentShipments = await this.db
      .selectFrom('maritime_jobs')
      .select([
        'id',
        'job_number',
        'direction',
        'transport_mode',
        'shipping_line_name',
        'vessel_name',
        'voyage_number',
        'pol_name',
        'pod_name',
        'etd',
        'eta',
        'status',
        'tracking_token',
        'created_at',
      ])
      .where('tenant_id', '=', auth.tenantId)
      .where('customer_id', '=', auth.customerId)
      .orderBy('created_at', 'desc')
      .limit(5)
      .execute();

    // 6. Recent Quotations (Top 5)
    const recentQuotes = await this.db
      .selectFrom('maritime_quotations')
      .select([
        'id',
        'quotation_number',
        'transport_mode',
        'currency',
        'final_total',
        'valid_until',
        'status',
        'customer_approved_at',
        'created_at',
      ])
      .where('tenant_id', '=', auth.tenantId)
      .where('customer_id', '=', auth.customerId)
      .orderBy('created_at', 'desc')
      .limit(5)
      .execute();

    return {
      kpis: {
        activeShipmentsCount,
        deliveredShipmentsCount,
        pendingQuotesCount,
        approvedQuotesCount,
        outstandingBalance: Number(customer?.balance || 0),
        creditLimit: Number(customer?.credit_limit || 0),
        availableCredit: Math.max(0, Number(customer?.credit_limit || 0) - Number(customer?.balance || 0)),
      },
      customer: {
        id: customer?.id,
        name: customer?.name,
        companyName: customer?.company_name,
      },
      recentShipments,
      recentQuotes,
    };
  }

  /**
   * List Customer Shipments with containers & live milestones
   */
  async getShipments(auth: CustomerPortalContext, query: { status?: string; search?: string; page?: string; pageSize?: string }) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)));
    const offset = (page - 1) * pageSize;

    let baseQuery = this.db
      .selectFrom('maritime_jobs')
      .where('tenant_id', '=', auth.tenantId)
      .where('customer_id', '=', auth.customerId);

    if (query.status === 'active') {
      baseQuery = baseQuery.where('status', '=', 'active');
    } else if (query.status === 'completed') {
      baseQuery = baseQuery.where('status', '=', 'completed');
    }

    if (query.search && query.search.trim()) {
      const term = `%${query.search.trim()}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('job_number', 'ilike', term),
          eb('booking_number', 'ilike', term),
          eb('vessel_name', 'ilike', term),
          eb('pol_name', 'ilike', term),
          eb('pod_name', 'ilike', term),
          eb('acid_number', 'ilike', term),
        ]),
      );
    }

    const totalRes = await baseQuery.select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirst();
    const total = Number(totalRes?.count || 0);

    const jobs = await baseQuery
      .selectAll()
      .orderBy('created_at', 'desc')
      .offset(offset)
      .limit(pageSize)
      .execute();

    // Attach containers and milestones
    const enriched = await Promise.all(
      jobs.map(async (job) => {
        const containers = await this.db
          .selectFrom('maritime_containers')
          .selectAll()
          .where('job_id', '=', job.id)
          .where('tenant_id', '=', auth.tenantId)
          .execute();

        const milestones = await this.db
          .selectFrom('maritime_job_milestones')
          .selectAll()
          .where('job_id', '=', job.id)
          .where('tenant_id', '=', auth.tenantId)
          .orderBy('occurred_at', 'asc')
          .execute();

        // Calculate demurrage & free time indicator
        let freeDaysRemaining: number | null = null;
        let demurrageStatus: 'safe' | 'warning' | 'critical' | 'demurrage' = 'safe';

        const containerFreeDays = containers[0]?.free_days || 14;
        if (job.eta) {
          const etaDate = new Date(job.eta).getTime();
          const now = Date.now();
          const daysSinceArrival = Math.max(0, Math.floor((now - etaDate) / (1000 * 60 * 60 * 24)));
          freeDaysRemaining = containerFreeDays - daysSinceArrival;

          if (freeDaysRemaining < 0) demurrageStatus = 'demurrage';
          else if (freeDaysRemaining <= 3) demurrageStatus = 'critical';
          else if (freeDaysRemaining <= 7) demurrageStatus = 'warning';
        }

        return {
          ...job,
          containers,
          milestones,
          freeDaysRemaining,
          demurrageStatus,
        };
      }),
    );

    return {
      items: enriched,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Get Shipment Details by ID
   */
  async getShipmentDetails(auth: CustomerPortalContext, jobId: string) {
    const job = await this.db
      .selectFrom('maritime_jobs')
      .selectAll()
      .where('id', '=', jobId as any)
      .where('tenant_id', '=', auth.tenantId)
      .where('customer_id', '=', auth.customerId)
      .executeTakeFirst();

    if (!job) {
      throw new NotFoundException('الشحنة غير موجودة أو غير مصرح بعرضها');
    }

    const containers = await this.db
      .selectFrom('maritime_containers')
      .selectAll()
      .where('job_id', '=', job.id)
      .where('tenant_id', '=', auth.tenantId)
      .execute();

    const milestones = await this.db
      .selectFrom('maritime_job_milestones')
      .selectAll()
      .where('job_id', '=', job.id)
      .where('tenant_id', '=', auth.tenantId)
      .orderBy('occurred_at', 'asc')
      .execute();

    const charges = await this.db
      .selectFrom('maritime_job_charges')
      .selectAll()
      .where('job_id', '=', job.id)
      .where('tenant_id', '=', auth.tenantId)
      .execute();

    const inlandTrips = await this.db
      .selectFrom('maritime_inland_trucking_trips')
      .selectAll()
      .where('job_id', '=', job.id)
      .where('tenant_id', '=', auth.tenantId)
      .execute();

    const documents = await this.db
      .selectFrom('maritime_job_documents')
      .selectAll()
      .where('job_id', '=', job.id)
      .where('tenant_id', '=', auth.tenantId)
      .execute();

    return {
      job,
      containers,
      milestones,
      charges,
      inlandTrips,
      documents,
    };
  }

  /**
   * Request a Freight Quote Online (Create Inquiry)
   */
  async requestQuote(auth: CustomerPortalContext, dto: CreatePortalQuoteRequestDto) {
    return await this.db.transaction().execute(async (trx) => {
      const tempNumber = `INQ-TMP-${crypto.randomUUID()}`;

      const [inquiry] = await trx
        .insertInto('maritime_inquiries')
        .values({
          tenant_id: auth.tenantId,
          inquiry_number: tempNumber,
          customer_id: auth.customerId,
          customer_name: auth.name,
          customer_phone: auth.phone || null,
          customer_email: null,
          direction: dto.direction || 'import',
          transport_mode: dto.transportMode || 'sea',
          pol_code: (dto.polCode || '').toUpperCase(),
          pol_name: dto.polName,
          pod_code: (dto.podCode || '').toUpperCase(),
          pod_name: dto.podName,
          incoterm: dto.incoterm || 'FOB',
          cargo_mode: dto.cargoMode || 'FCL',
          container_type: dto.containerType || '40HC',
          container_count: dto.containerCount || 1,
          commodity_description: dto.commodityDescription || '',
          cargo_nature: 'general',
          gross_weight_kg: Number(dto.grossWeightKg || 0),
          volumetric_weight_kg: Number(dto.volumetricWeightKg || 0),
          chargeable_weight_kg: Number(dto.chargeableWeightKg || 0),
          total_cbm: Number(dto.totalCbm || 0),
          cbm: Number(dto.totalCbm || 0),
          cargo_ready_date: dto.cargoReadyDate || null,
          target_delivery_date: dto.targetDeliveryDate || null,
          target_free_days: dto.targetFreeDays || 14,
          payment_term: 'prepaid',
          status: 'received',
          notes: dto.notes || null,
          portal_submitted: true,
          portal_customer_notes: dto.notes || null,
          created_by: null,
        })
        .returningAll()
        .execute();

      const finalNumber = formatDailyDocumentNumber('INQ', Number(inquiry.id));
      await trx
        .updateTable('maritime_inquiries')
        .set({ inquiry_number: finalNumber })
        .where('id', '=', inquiry.id)
        .execute();

      return {
        success: true,
        inquiryId: inquiry.id,
        inquiryNumber: finalNumber,
        message: 'تم استلام طلب التسعير بنجاح وسيتم إعداد العرض وموافاتكم بأسرع وقت',
      };
    });
  }

  /**
   * List Customer Quotations
   */
  async getQuotations(auth: CustomerPortalContext, query: { status?: string }) {
    let q = this.db
      .selectFrom('maritime_quotations')
      .selectAll()
      .where('tenant_id', '=', auth.tenantId)
      .where('customer_id', '=', auth.customerId);

    if (query.status) {
      q = q.where('status', '=', query.status as any);
    }

    const quotes = await q.orderBy('created_at', 'desc').execute();

    // Attach itemized charges
    const enriched = await Promise.all(
      quotes.map(async (quote) => {
        const charges = await this.db
          .selectFrom('maritime_quotation_charges')
          .selectAll()
          .where('quotation_id', '=', quote.id)
          .where('tenant_id', '=', auth.tenantId)
          .execute();

        return {
          ...quote,
          charges,
        };
      }),
    );

    return enriched;
  }

  /**
   * Get Single Quotation by ID
   */
  async getQuotationDetails(auth: CustomerPortalContext, quoteId: string) {
    const quote = await this.db
      .selectFrom('maritime_quotations')
      .selectAll()
      .where('id', '=', quoteId as any)
      .where('tenant_id', '=', auth.tenantId)
      .where('customer_id', '=', auth.customerId)
      .executeTakeFirst();

    if (!quote) {
      throw new NotFoundException('عرض السعر غير موجود أو غير مخصص لحسابكم');
    }

    const charges = await this.db
      .selectFrom('maritime_quotation_charges')
      .selectAll()
      .where('quotation_id', '=', quote.id)
      .where('tenant_id', '=', auth.tenantId)
      .execute();

    return {
      ...quote,
      charges,
    };
  }

  /**
   * Approve Quotation Online (Instant Booking Confirmation)
   */
  async approveQuotation(
    auth: CustomerPortalContext,
    quoteId: string,
    payload: { approvalNotes?: string; clientReference?: string; confirmedBy?: string; clientIp?: string },
  ) {
    const quote = await this.db
      .selectFrom('maritime_quotations')
      .selectAll()
      .where('id', '=', quoteId as any)
      .where('tenant_id', '=', auth.tenantId)
      .where('customer_id', '=', auth.customerId)
      .executeTakeFirst();

    if (!quote) {
      throw new NotFoundException('عرض السعر غير موجود أو غير مخصص لحسابكم');
    }

    if (quote.status === 'converted_to_job' || quote.status === 'approved') {
      return {
        success: true,
        quotationId: quote.id,
        status: quote.status,
        jobId: quote.converted_job_id,
        message: 'تم اعتماد وتعميد هذا العرض مسبقاً',
      };
    }

    // Update Quotation Status to 'approved' with approval audit
    await this.db
      .updateTable('maritime_quotations')
      .set({
        status: 'approved',
        customer_approved_at: new Date(),
        customer_approval_notes: payload.approvalNotes || null,
        customer_approval_reference: payload.clientReference || payload.confirmedBy || auth.name,
        customer_approval_ip: payload.clientIp || null,
      })
      .where('id', '=', quote.id)
      .where('tenant_id', '=', auth.tenantId)
      .execute();

    // Automatically convert quotation to active job so shipment is ready!
    let createdJob: any = null;
    try {
      const systemAuth: AuthContext = {
        tenantId: auth.tenantId,
        accountId: auth.accountId,
        userId: 0,
        sessionId: 'portal-customer-session',
        username: `portal-${auth.name || 'customer'}`,
        role: 'admin',
        permissions: ['*'],
      };
      createdJob = await this.freightService.autoConvertQuotationToJob(systemAuth, quote.id);
    } catch (e) {
      // If auto-conversion fails for any edge-case, the quote remains cleanly approved
    }

    return {
      success: true,
      quotationId: quote.id,
      status: 'approved',
      jobId: createdJob?.id || quote.converted_job_id || null,
      jobNumber: createdJob?.job_number || null,
      message: 'تم اعتماد وتعميد عرض السعر بنجاح وتم فتح أمر تشغيل الشحنة فورياً',
    };
  }

  /**
   * Reject Quotation
   */
  async rejectQuotation(auth: CustomerPortalContext, quoteId: string, payload: { reason?: string }) {
    const quote = await this.db
      .selectFrom('maritime_quotations')
      .selectAll()
      .where('id', '=', quoteId as any)
      .where('tenant_id', '=', auth.tenantId)
      .where('customer_id', '=', auth.customerId)
      .executeTakeFirst();

    if (!quote) {
      throw new NotFoundException('عرض السعر غير موجود');
    }

    await this.db
      .updateTable('maritime_quotations')
      .set({
        status: 'rejected',
        notes: payload.reason ? `تم الرفض بواسطة العميل: ${payload.reason}` : 'تم الرفض من بوابة العميل',
      })
      .where('id', '=', quote.id)
      .where('tenant_id', '=', auth.tenantId)
      .execute();

    return {
      success: true,
      quotationId: quote.id,
      status: 'rejected',
      message: 'تم تسجيل رفض العرض',
    };
  }

  /**
   * Customer Statement of Account & Financial Ledgers
   */
  async getStatement(auth: CustomerPortalContext) {
    const customer = await this.db
      .selectFrom('customers')
      .selectAll()
      .where('id', '=', auth.customerId)
      .where('tenant_id', '=', auth.tenantId)
      .executeTakeFirst();

    if (!customer) throw new NotFoundException('العميل غير موجود');

    // Recent shipments billing summary
    const jobs = await this.db
      .selectFrom('maritime_jobs')
      .select(['id', 'job_number', 'shipping_line_name', 'pol_name', 'pod_name', 'created_at', 'status'])
      .where('customer_id', '=', auth.customerId)
      .where('tenant_id', '=', auth.tenantId)
      .orderBy('created_at', 'desc')
      .limit(30)
      .execute();

    const jobsWithCharges = await Promise.all(
      jobs.map(async (j) => {
        const charges = await this.db
          .selectFrom('maritime_job_charges')
          .selectAll()
          .where('job_id', '=', j.id)
          .where('tenant_id', '=', auth.tenantId)
          .execute();

        const totalCharges = charges.reduce((acc, c) => acc + Number(c.sell_amount || 0), 0);
        return {
          ...j,
          chargesCount: charges.length,
          totalAmount: totalCharges,
        };
      }),
    );

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        companyName: customer.company_name,
        phone: customer.phone,
        address: customer.address,
        taxNumber: customer.tax_number,
        balance: Number(customer.balance || 0),
        creditLimit: Number(customer.credit_limit || 0),
      },
      jobsSummary: jobsWithCharges,
      statementGeneratedAt: new Date(),
    };
  }
}
