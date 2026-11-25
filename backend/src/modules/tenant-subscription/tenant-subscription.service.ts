import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { AuditService } from '../../core/audit/audit.service';
import { RequestRenewalDto } from './dto/tenant-subscription.dto';
import { PricingCatalogService } from './pricing/pricing-catalog.service';

/**
 * كانت هنا قائمة باقات بأسعار مكتوبة في الكود (3500/7500/15000/24000) تُعرض حين
 * يكون جدول `saas_plans` فارغاً، **بمعرّفات وهمية 1..4** تُمرَّر إلى طلب الترقية.
 * أُزيلت: هي مصدر تسعير ثالث يخالف الثابت PRICE-2 والنمط المحظور F40، والمعرّف
 * الوهمي يطلب باقة قد لا تكون موجودة. الأسعار مصدرها `PricingCatalogService`،
 * وجدول فارغ يعني **لا باقات** لا باقاتٍ مُختلَقة.
 */

@Injectable()
export class TenantSubscriptionService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly pricing: PricingCatalogService,
  ) {}

  /**
   * نشاط المنشأة وبلدها — **من سجل المنشأة والوحدات المفعلة حصراً**، مع قبول تلميح النطاق إن وُجد.
   * `businessIndustry` في `settings` مخزَّن JSON فتُزال أقواسه.
   * المرجع: PRICING_AND_PACKAGING.md §11 البند C8 · هجرة 148.
   */
  private async readPricingScope(
    tenantId: string,
    verticalHint?: string | null,
  ): Promise<{ industryPresetId: string | null; countryCode: string | null }> {
    const [settingsRows, tenantRow] = await Promise.all([
      this.db
        .selectFrom('settings')
        .select(['key', 'value'])
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where('key', 'in', [
          'businessIndustry',
          'activityType',
          'industryPillar',
          'pillar',
          'industryProfile',
          'maritimeFreightModuleEnabled',
          'contractingModuleEnabled',
          'manufacturingModuleEnabled',
          'restaurantModuleEnabled',
          'enablePharmacyModule',
          'enableMobileStoreFeatures',
          'servicesModuleEnabled',
          'importModuleEnabled',
        ])
        .execute()
        .catch(() => []),
      this.db
        .selectFrom('tenants')
        .select(['country_code', 'activity_type'])
        .where('id', '=', tenantId)
        .executeTakeFirst()
        .catch(() => undefined),
    ]);

    const settingsMap = new Map<string, any>();
    for (const row of settingsRows) {
      try {
        settingsMap.set(row.key, JSON.parse(row.value));
      } catch {
        settingsMap.set(row.key, row.value);
      }
    }

    const isTrue = (val: any) => val === true || val === 'true' || val === 1 || val === '1';

    let resolvedIndustry: string | null = null;

    // 1. أولية قطاعات المؤسسات الكبرى المخصصة بحسب الوحدات المفعلة تشغيلياً (Operational Truth)
    if (isTrue(settingsMap.get('maritimeFreightModuleEnabled'))) {
      resolvedIndustry = 'maritime';
    } else if (isTrue(settingsMap.get('contractingModuleEnabled'))) {
      resolvedIndustry = 'contracting';
    } else if (isTrue(settingsMap.get('manufacturingModuleEnabled'))) {
      resolvedIndustry = 'manufacturing';
    } else if (isTrue(settingsMap.get('restaurantModuleEnabled'))) {
      resolvedIndustry = 'restaurant';
    } else if (isTrue(settingsMap.get('enablePharmacyModule'))) {
      resolvedIndustry = 'pharmacy';
    } else if (isTrue(settingsMap.get('enableMobileStoreFeatures'))) {
      resolvedIndustry = 'electronics';
    }

    // 2. تلميح النطاق النشط من العميل إن وُجد ولم يكن عاماً
    if (!resolvedIndustry && verticalHint) {
      const cleanHint = String(verticalHint).trim().toLowerCase();
      if (
        cleanHint &&
        cleanHint !== 'general' &&
        cleanHint !== 'retail_general' &&
        cleanHint !== 'null' &&
        cleanHint !== 'undefined'
      ) {
        resolvedIndustry = cleanHint;
      }
    }

    // 3. قراءة النطاق المحدد في الإعدادات أو سجل المنشأة مع استبعاد القيم الافتراضية العامة
    if (!resolvedIndustry) {
      const rawActivity = String(settingsMap.get('activityType') ?? '')
        .trim()
        .replace(/^"|"$/g, '');
      const rawIndustry = String(settingsMap.get('businessIndustry') ?? '')
        .trim()
        .replace(/^"|"$/g, '');
      const rawPillar = String(settingsMap.get('pillar') ?? settingsMap.get('industryPillar') ?? '')
        .trim()
        .replace(/^"|"$/g, '');
      const tenantActivity = String((tenantRow as any)?.activity_type ?? '').trim();

      const nonGeneric = [rawActivity, rawPillar, rawIndustry, tenantActivity].filter(
        (s) => s && s !== 'general' && s !== 'retail_general' && s !== 'retail' && s !== 'store',
      );

      if (nonGeneric.length > 0) {
        resolvedIndustry = nonGeneric[0];
      } else {
        resolvedIndustry = rawIndustry || tenantActivity || 'retail';
      }
    }

    return {
      industryPresetId: resolvedIndustry,
      countryCode: (tenantRow as any)?.country_code || null,
    };
  }

  /**
   * التسعير المعتمد للمنشأة — مستويات نطاقها وحدها بأسعار بلدها وحده.
   * لا يقبل أي معامل من العميل لتغيير السعر، ويدعم تمرير تلميح النطاق النشط للتحقق والمطابقة.
   */
  async getResolvedPricing(auth: AuthContext, verticalHint?: string | null): Promise<Record<string, unknown>> {
    const tenantId = String(auth.tenantId || '').trim() || 'default';
    const scope = await this.readPricingScope(tenantId, verticalHint);
    return this.pricing.resolveForTenant(scope) as unknown as Record<string, unknown>;
  }

  /**
   * O33: what a page load is allowed to do — read. `ensureTenant`/`ensureStandardPlans` below write
   * rows (a tenant, the platform plan catalogue, a 10-year "active" subscription), and they used to
   * run on this GET, so simply opening the subscription screen could invent platform revenue records.
   * They stay for the write paths (renewal request, online payment), where an admin really acts.
   */
  private async readTenantOrPlaceholder(tenantId: string, auth: AuthContext) {
    const normalizedTenantId = tenantId.trim() || 'default';
    const existing = await this.db
      .selectFrom('tenants')
      .selectAll()
      .where('id', '=', normalizedTenantId)
      .executeTakeFirst()
      .catch(() => undefined);
    if (existing) return existing as any;

    // Nothing is written: the screen renders with what we know, and no row is created.
    return {
      id: normalizedTenantId,
      slug: normalizedTenantId,
      business_name: 'المنشأة الرئيسية',
      owner_name: auth.role === 'super_admin' ? 'مدير المنظومة' : 'مسؤول النظام',
      owner_phone: '',
      status: 'unknown',
      trial_starts_at: null,
      trial_ends_at: null,
      created_at: new Date(),
    } as any;
  }

  /** O33: the plan catalogue as it is; the static list is a display fallback, not a seed. */
  private async readPlans(): Promise<Array<any>> {
    const plans = await this.db
      .selectFrom('saas_plans')
      .selectAll()
      .where('is_active', '=', true)
      .orderBy('price', 'asc')
      .execute()
      .catch(() => []);
    return plans;
  }

  private async ensureTenant(
    tenantId: string,
    auth: AuthContext,
  ): Promise<{
    id: string;
    slug: string;
    business_name: string;
    owner_name: string;
    owner_phone: string;
    owner_email?: string | null;
    status: string;
    trial_starts_at: Date | string | null;
    trial_ends_at: Date | string | null;
    created_at: Date | string;
  }> {
    const normalizedTenantId = tenantId.trim() || 'default';

    const existingTenant = await this.db
      .selectFrom('tenants')
      .selectAll()
      .where('id', '=', normalizedTenantId)
      .executeTakeFirst();

    if (existingTenant) {
      return existingTenant as any;
    }

    // Auto-heal / provision tenant record from settings or auth context
    const settingsRows = await this.db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where(sql<boolean>`tenant_id = ${normalizedTenantId}`)
      .execute()
      .catch(() => []);

    const settingsMap: Record<string, string> = {};
    for (const row of settingsRows) {
      try {
        settingsMap[row.key] = typeof row.value === 'string' ? JSON.parse(row.value) : String(row.value);
      } catch {
        settingsMap[row.key] = String(row.value || '');
      }
    }

    const businessName = settingsMap.storeName || settingsMap.companyName || 'المنشأة الرئيسية';
    const ownerPhone = settingsMap.phone || '';
    const ownerName = auth.role === 'super_admin' ? 'مدير المنظومة' : 'مسؤول النظام';
    const now = new Date();
    const tenYearsLater = new Date(now);
    tenYearsLater.setFullYear(tenYearsLater.getFullYear() + 10);

    try {
      await this.db
        .insertInto('tenants')
        .values({
          id: normalizedTenantId,
          slug: normalizedTenantId,
          business_name: businessName,
          owner_name: ownerName,
          owner_phone: ownerPhone,
          owner_email: '',
          status: 'active',
          trial_starts_at: now,
          trial_ends_at: tenYearsLater,
          activated_at: now,
          created_at: now,
          updated_at: now,
        } as any)
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();

      const created = await this.db
        .selectFrom('tenants')
        .selectAll()
        .where('id', '=', normalizedTenantId)
        .executeTakeFirst();

      if (created) return created as any;
    } catch {
      // Fallback synthetic tenant object
    }

    return {
      id: normalizedTenantId,
      slug: normalizedTenantId,
      business_name: businessName,
      owner_name: ownerName,
      owner_phone: ownerPhone,
      status: 'active',
      trial_starts_at: now,
      trial_ends_at: tenYearsLater,
      created_at: now,
    };
  }

  private async ensureStandardPlans(): Promise<Array<any>> {
    let plans = await this.db
      .selectFrom('saas_plans')
      .selectAll()
      .where('is_active', '=', true)
      .orderBy('price', 'asc')
      .execute()
      .catch(() => []);

    const hasBasic = plans.some((p) => p.code?.toUpperCase() === 'BASIC');
    const hasPro = plans.some((p) => p.code?.toUpperCase() === 'PRO');
    const hasUltimate = plans.some(
      (p) => p.code?.toUpperCase() === 'ULTIMATE' || p.code?.toLowerCase() === 'enterprise',
    );
    const hasOmnichannel = plans.some((p) => p.code?.toUpperCase() === 'OMNICHANNEL');

    if (!hasBasic || !hasPro || !hasUltimate || !hasOmnichannel) {
      const now = new Date();
      const missingPlans = [];
      if (!hasBasic) {
        missingPlans.push({
          code: 'BASIC',
          name: 'الباقة الأساسية (Basic POS)',
          price: 3500,
          currency: 'EGP',
          billing_period_months: 12,
          max_users: 2,
          max_branches: 1,
          feature_plan_id: 'plan_basic',
          is_active: true,
          created_at: now,
          updated_at: now,
        });
      }
      if (!hasPro) {
        missingPlans.push({
          code: 'PRO',
          name: 'الباقة الاحترافية (Professional)',
          price: 7500,
          currency: 'EGP',
          billing_period_months: 12,
          max_users: 6,
          max_branches: 3,
          feature_plan_id: 'plan_pro',
          is_active: true,
          created_at: now,
          updated_at: now,
        });
      }
      if (!hasUltimate) {
        missingPlans.push({
          code: 'ULTIMATE',
          name: 'الباقة المتكاملة (Ultimate ERP)',
          price: 15000,
          currency: 'EGP',
          billing_period_months: 12,
          max_users: 15,
          max_branches: 10,
          feature_plan_id: 'plan_ultimate',
          is_active: true,
          created_at: now,
          updated_at: now,
        });
      }
      if (!hasOmnichannel) {
        missingPlans.push({
          code: 'OMNICHANNEL',
          name: 'باقة التجارة الشاملة (Omnichannel Enterprise)',
          price: 24000,
          currency: 'EGP',
          billing_period_months: 12,
          max_users: null,
          max_branches: null,
          feature_plan_id: 'plan_omnichannel',
          is_active: true,
          created_at: now,
          updated_at: now,
        });
      }

      try {
        await this.db
          .insertInto('saas_plans')
          .values(missingPlans as any)
          .onConflict((oc) => oc.column('code').doNothing())
          .execute();

        plans = await this.db
          .selectFrom('saas_plans')
          .selectAll()
          .where('is_active', '=', true)
          .orderBy('price', 'asc')
          .execute();
      } catch {
        // ignore if conflict or constraint
      }
    }

    return plans;
  }

  async getMySubscription(auth: AuthContext): Promise<Record<string, unknown>> {
    const tenantId = String(auth.tenantId || '').trim() || 'default';
    const tenant = await this.readTenantOrPlaceholder(tenantId, auth);
    const availablePlans = await this.readPlans();

    // 1. Get latest/active subscription
    const subscription = await this.db
      .selectFrom('tenant_subscriptions as s')
      .leftJoin('saas_plans as p', 's.plan_id', 'p.id')
      .select([
        's.id',
        's.status',
        's.starts_at',
        's.ends_at',
        's.grace_ends_at',
        's.auto_renew',
        's.created_at',
        'p.id as plan_id',
        'p.name as plan_name',
        'p.code as plan_code',
        'p.price as plan_price',
        'p.currency as plan_currency',
        'p.billing_period_months',
        'p.max_users',
        'p.max_branches',
      ])
      .where('s.tenant_id', '=', tenant.id)
      .orderBy('s.created_at', 'desc')
      .executeTakeFirst()
      .catch(() => undefined);

    // O33: no subscription row means no subscription. Inventing an "active for 10 years" one here
    // (and inserting it) turned a page load into a billing record. The screen handles null.

    // 2. Resource usage calculation
    const [usersRes, branchesRes, locationsRes, productsRes, salesRes] = await Promise.all([
      this.db
        .selectFrom('users')
        .select(sql<number>`count(*)::int`.as('count'))
        .where('tenant_id', '=', tenant.id)
        .where('is_active', '=', true)
        .executeTakeFirst()
        .catch(() => ({ count: 1 })),
      this.db
        .selectFrom('branches')
        .select(sql<number>`count(*)::int`.as('count'))
        .where('tenant_id', '=', tenant.id)
        .where('is_active', '=', true)
        .executeTakeFirst()
        .catch(() => ({ count: 1 })),
      this.db
        .selectFrom('stock_locations')
        .select(sql<number>`count(*)::int`.as('count'))
        .where('tenant_id', '=', tenant.id)
        .where('is_active', '=', true)
        .executeTakeFirst()
        .catch(() => ({ count: 1 })),
      this.db
        .selectFrom('products')
        .select(sql<number>`count(*)::int`.as('count'))
        .where('tenant_id', '=', tenant.id)
        .executeTakeFirst()
        .catch(() => ({ count: 0 })),
      this.db
        .selectFrom('sales')
        .select(sql<number>`count(*)::int`.as('count'))
        .where('tenant_id', '=', tenant.id)
        .executeTakeFirst()
        .catch(() => ({ count: 0 })),
    ]);

    const activeUsersCount = usersRes?.count || 0;
    const activeBranchesCount = branchesRes?.count || 0;
    const activeLocationsCount = locationsRes?.count || 0;
    const totalProductsCount = productsRes?.count || 0;
    const totalSalesCount = salesRes?.count || 0;

    // 3. Payment receipts & history
    const payments = await this.db
      .selectFrom('tenant_subscription_payments as p')
      .leftJoin('tenant_subscriptions as s', 'p.subscription_id', 's.id')
      .leftJoin('saas_plans as pl', 's.plan_id', 'pl.id')
      .select([
        'p.id',
        'p.amount',
        'p.currency',
        'p.method',
        'p.reference',
        'p.paid_at',
        'p.created_at',
        'pl.name as plan_name',
        's.starts_at',
        's.ends_at',
      ])
      .where('p.tenant_id', '=', tenant.id)
      .orderBy('p.paid_at', 'desc')
      .execute()
      .catch(() => []);

    // 4. Expiry & days calculation
    const now = new Date();
    let daysRemaining: number | null = null;
    let isExpiringSoon = false;
    let isExpired = false;

    if (tenant.status === 'trial' && tenant.trial_ends_at) {
      const diff = new Date(tenant.trial_ends_at).getTime() - now.getTime();
      daysRemaining = Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
      isExpiringSoon = daysRemaining <= 5 && daysRemaining > 0;
      isExpired = daysRemaining === 0;
    } else if (subscription?.ends_at) {
      const diff = new Date(subscription.ends_at).getTime() - now.getTime();
      daysRemaining = Math.ceil(diff / (24 * 60 * 60 * 1000));
      isExpiringSoon = daysRemaining <= 7 && daysRemaining > 0;
      isExpired = daysRemaining <= 0;
    }

    return {
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        businessName: tenant.business_name,
        ownerName: tenant.owner_name,
        ownerPhone: tenant.owner_phone,
        status: tenant.status,
        planId: (tenant as any).plan_id || null,
        activityType: (tenant as any).activity_type || null,
        pillar: (tenant as any).pillar || null,
        features: (tenant as any).features || (tenant as any).extra_features || [],
        trialStartsAt: tenant.trial_starts_at,
        trialEndsAt: tenant.trial_ends_at,
        createdAt: tenant.created_at,
      },
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            startsAt: subscription.starts_at,
            endsAt: subscription.ends_at,
            graceEndsAt: subscription.grace_ends_at,
            autoRenew: subscription.auto_renew,
            planId: subscription.plan_id,
            planName: subscription.plan_name,
            planCode: subscription.plan_code,
            planPrice: subscription.plan_price,
            planCurrency: subscription.plan_currency,
            billingPeriodMonths: subscription.billing_period_months,
          }
        : null,
      usage: {
        users: {
          current: activeUsersCount,
          max: subscription?.max_users || (tenant.status === 'trial' ? 5 : null),
        },
        branches: {
          current: activeBranchesCount,
          max: subscription?.max_branches || (tenant.status === 'trial' ? 2 : null),
        },
        locations: {
          current: activeLocationsCount,
        },
        products: {
          current: totalProductsCount,
        },
        sales: {
          current: totalSalesCount,
        },
      },
      statusMeta: {
        daysRemaining,
        isExpiringSoon,
        isExpired,
      },
      availablePlans: availablePlans.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        price: p.price,
        currency: p.currency,
        billingPeriodMonths: p.billing_period_months,
        maxUsers: p.max_users,
        maxBranches: p.max_branches,
        featurePlanId: (p as any).feature_plan_id,
        pricingBand: (p as any).pricing_band ?? null,
        pricingLevel: (p as any).pricing_level ?? null,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        method: p.method,
        reference: p.reference,
        paidAt: p.paid_at,
        planName: p.plan_name,
        startsAt: p.starts_at,
        endsAt: p.ends_at,
      })),
    };
  }

  async resolvePlan(planId?: number) {
    if (planId) {
      const plan = await this.db
        .selectFrom('saas_plans')
        .selectAll()
        .where('id', '=', planId)
        .executeTakeFirst()
        .catch(() => undefined);
      if (plan) return plan;
    }

    const plans = await this.ensureStandardPlans();
    return (planId ? plans.find((p) => p.id === planId) : null) || plans[1] || plans[0];
  }

  async requestRenewal(dto: RequestRenewalDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const tenantId = String(auth.tenantId || '').trim() || 'default';
    const tenant = await this.ensureTenant(tenantId, auth);

    const plan = await this.resolvePlan(dto.planId);
    if (!plan) {
      throw new NotFoundException('الخطة غير موجودة.');
    }

    const renewalScope = await this.readPricingScope(tenant.id);
    const renewalLevelId = this.pricing.levelIdForLegacyPlanCode(plan.code);
    const renewalPrice = renewalLevelId
      ? this.pricing.priceForLevel({
          ...renewalScope,
          levelId: renewalLevelId,
          billingPeriodMonths: dto.billingPeriodMonths || plan.billing_period_months || 12,
        })
      : null;

    await this.audit.log(
      'طلب تجديد اشتراك',
      `قام المالك بطلب تجديد/ترقية الاشتراك إلى باقة: ${plan.name} (طريقة السداد المرجوة: ${dto.paymentMethod || 'غير محدد'})`,
      auth,
      { targetTenantId: tenant.id },
    );

    return {
      ok: true,
      message:
        'تم استلام طلب التجديد بنجاح. سيتم التواصل لتأكيد السداد وتفعيل الباقة، أو الدفع مباشرة فور تفعيل بوابة الدفع.',
      plan: {
        id: plan.id,
        name: plan.name,
        // السعر من الكتالوج لا من صف الباقة القديم (البند C9)
        price: renewalPrice?.amount ?? null,
        currency: renewalPrice?.currency ?? null,
      },
    };
  }

  async initiateOnlinePayment(
    dto: { planId: number; billingPeriodMonths?: number; gateway?: string; redirectUrl?: string },
    paymentManager: any,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const tenantId = String(auth.tenantId || '').trim() || 'default';
    const tenant = await this.ensureTenant(tenantId, auth);

    const plan = await this.resolvePlan(dto.planId);
    if (!plan) throw new NotFoundException('الخطة غير موجودة.');

    const durationMonths = dto.billingPeriodMonths || plan.billing_period_months || 12;

    /*
     * البند C9: كان المبلغ يُحسب من `saas_plans.price` بينما الشاشة تعرض رقماً من
     * ملف في الواجهة — مصدران للحقيقة لنفس الرقم، فالعميل يرى سعراً ويُحصَّل آخر.
     * المبلغ الآن من الكتالوج نفسه الذي عرضته الشاشة، وبنطاق المنشأة وبلدها.
     * وإن تعذّر تسعير المستوى، **يُرفض** الدفع ولا يُحصَّل رقم قديم (فشل مغلق، لا F7).
     */
    const scope = await this.readPricingScope(tenant.id);
    const levelId = this.pricing.levelIdForLegacyPlanCode(plan.code);
    const catalogPrice = levelId
      ? this.pricing.priceForLevel({ ...scope, levelId, billingPeriodMonths: durationMonths })
      : null;
    if (!catalogPrice) {
      throw new NotFoundException('لا يوجد سعر معتمد لهذه الباقة في بلد المنشأة. راجع كتالوج التسعير قبل إتمام الدفع.');
    }
    const amount = catalogPrice.amount;

    const gatewayName = dto.gateway || 'xpay';
    const result = await paymentManager.initiatePayment(gatewayName, {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      businessName: tenant.business_name,
      ownerName: tenant.owner_name,
      ownerPhone: tenant.owner_phone,
      ownerEmail: tenant.owner_email || undefined,
      planId: plan.id,
      planName: plan.name,
      amount,
      currency: catalogPrice.currency,
      durationMonths,
      redirectUrl: dto.redirectUrl,
    });

    return result;
  }
}
