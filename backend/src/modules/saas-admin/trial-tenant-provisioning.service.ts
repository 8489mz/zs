import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { isReservedStoreSlug } from '../storefront/engines/store-public-url.engine';
import { randomBytes, randomUUID } from 'node:crypto';
import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { KYSELY_DB } from '../../database/database.constants';
import { createPasswordRecord } from '../../core/auth/utils/password-hasher';
import { assertStrongPassword } from '../../core/auth/utils/password-policy';
import { DEFAULT_TRIAL_DAYS } from './trial.constants';
import { formatBranchStockLocationName } from '../../common/utils/branch-stock.util';
import { SUPER_ADMIN_PERMISSIONS } from '../../core/auth/constants/super-admin-permissions';
import { normalizeIndustryProfileKey } from '../../core/tenant/industry-profiles';

export type TrialTenantProvisioningInput = {
  slug?: string;
  businessName: string;
  branchName?: string | null;
  ownerName: string;
  ownerPhone: string;
  ownerEmail?: string | null;
  activityType?: string | null;
  businessIndustry?: string | null;
  username?: string;
  password?: string | null;
  days?: number;
  source?: string | null;
  campaign?: string | null;
  notes?: string | null;
  featurePlanId?: string | null;
  saasPlanId?: number | null;
};

export type TrialTenantProvisioningResult = {
  tenant: {
    id: string;
    slug: string;
    businessName: string;
    ownerName: string;
    ownerPhone: string;
    ownerEmail: string;
    activityType: string;
    status: 'trial';
    trialStartsAt: string;
    trialEndsAt: string;
    activatedAt: null;
    createdAt: string;
    updatedAt: string;
    trialDaysRemaining: number;
    ownerUsername?: string;
    planName?: string;
    planId?: string | null;
  };
  owner: {
    username: string;
    temporaryPassword: string;
    mustChangePassword: true;
  };
};

@Injectable()
export class TrialTenantProvisioningService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private normalizeRequired(value: unknown, message: string): string {
    const normalized = String(value || '').trim();
    if (!normalized) throw new BadRequestException(message);
    return normalized;
  }

  private normalizeOptional(value: unknown): string | null {
    const normalized = String(value || '').trim();
    return normalized || null;
  }

  getIndustrySettingsPatch(industry: string): Record<string, any> {
    const normalized = normalizeIndustryProfileKey(industry);
    const base: Record<string, any> = {
      businessIndustry: normalized,
      onboardingCompleted: true,
      posModuleEnabled: true,
      requireCashierShiftForSales: true,
      defaultPosMode: 'scanner',
      defaultProductKind: 'standard',
      contractingModuleEnabled: false,
      maritimeFreightModuleEnabled: false,
      restaurantModuleEnabled: false,
      enablePharmacyModule: false,
      enableMobileStoreFeatures: false,
      clothingModuleEnabled: false,
      autoPartsModuleEnabled: false,
      manufacturingModuleEnabled: false,
      weightedBarcodeEnabled: false,
      servicesModuleEnabled: false,
      storefrontModuleEnabled: false,
      deliveryFleetModuleEnabled: false,
      deliveryRepsModuleEnabled: false,
      vanSalesModuleEnabled: false,
      purchasesModuleEnabled: true,
      inventoryModuleEnabled: true,
      enableEnterpriseFeatures: false,
    };

    switch (normalized as string) {
      case 'contracting':
        base.contractingModuleEnabled = true;
        base.posModuleEnabled = false;
        base.requireCashierShiftForSales = false;
        base.hrModuleEnabled = true;
        base.enableEnterpriseFeatures = true;
        base.fixedAssetsModuleEnabled = true;
        base.taxDeclarationModuleEnabled = true;
        base.installmentsModuleEnabled = true;
        break;

      case 'maritime_freight':
      case 'maritime':
        base.maritimeFreightModuleEnabled = true;
        base.posModuleEnabled = false;
        base.inventoryModuleEnabled = false;
        base.requireCashierShiftForSales = false;
        base.hrModuleEnabled = true;
        base.enableEnterpriseFeatures = true;
        base.taxDeclarationModuleEnabled = true;
        break;

      case 'storefront':
      case 'ecommerce':
        base.storefrontModuleEnabled = true;
        base.deliveryRepsModuleEnabled = true;
        base.deliveryFleetModuleEnabled = true;
        base.enableEnterpriseFeatures = true;
        break;

      case 'import_export':
        base.importModuleEnabled = true;
        base.enableEnterpriseFeatures = true;
        base.taxDeclarationModuleEnabled = true;
        base.installmentsModuleEnabled = true;
        break;

      case 'supermarket':
        base.weightedBarcodeEnabled = true;
        base.defaultPosMode = 'scanner';
        break;

      case 'pharmacy':
        base.enablePharmacyModule = true;
        base.deliveryRepsModuleEnabled = true;
        base.deliveryFleetModuleEnabled = true;
        break;

      case 'maintenance':
      case 'electronics':
        base.enableMobileStoreFeatures = true;
        base.servicesModuleEnabled = true;
        base.installmentsModuleEnabled = true;
        break;

      case 'appliances_installments':
        base.installmentsModuleEnabled = true;
        base.enableEnterpriseFeatures = true;
        break;

      case 'auto_parts':
        base.autoPartsModuleEnabled = true;
        base.defaultPosMode = 'scanner';
        break;

      case 'restaurant':
      case 'cafe':
        base.restaurantModuleEnabled = true;
        base.defaultPosMode = 'touch';
        base.posKitchenPrinterEnabled = true;
        break;

      case 'services':
        base.posModuleEnabled = false;
        base.requireCashierShiftForSales = false;
        base.servicesModuleEnabled = true;
        base.inventoryModuleEnabled = false;
        base.installmentsModuleEnabled = true;
        base.enableEnterpriseFeatures = true;
        break;

      case 'warehousing':
        base.posModuleEnabled = false;
        base.requireCashierShiftForSales = false;
        base.inventoryModuleEnabled = true;
        base.purchasesModuleEnabled = true;
        base.enableEnterpriseFeatures = true;
        break;

      case 'wholesale_van':
      case 'wholesale':
        base.posModuleEnabled = false;
        base.requireCashierShiftForSales = false;
        base.vanSalesModuleEnabled = true;
        base.deliveryFleetModuleEnabled = true;
        base.deliveryRepsModuleEnabled = false;
        base.enableEnterpriseFeatures = true;
        base.installmentsModuleEnabled = true;
        base.taxDeclarationModuleEnabled = true;
        break;

      case 'manufacturing':
        base.manufacturingModuleEnabled = true;
        base.importModuleEnabled = true;
        base.enableEnterpriseFeatures = true;
        break;

      case 'clothing':
      case 'fashion':
        base.clothingModuleEnabled = true;
        base.defaultProductKind = 'fashion';
        break;

      case 'spices':
      case 'perfumes':
      case 'retail':
      case 'retail_general':
      default:
        base.defaultPosMode = 'scanner';
        break;
    }

    return base;
  }

  normalizePhoneDigits(value: unknown): string {
    return String(value || '')
      .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
      .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
      .replace(/\s+/g, '')
      .trim();
  }

  /**
   * Best-effort Arabic -> Latin transliteration so an Arabic business name still produces a
   * readable slug (e.g. "حماده يلعب" -> "hmadh-ylaab") instead of falling through to a random
   * "store-48213" every time, since almost every trial signup names their business in Arabic.
   */
  transliterateArabicToLatin(value: unknown): string {
    const ARABIC_TRANSLITERATION_MAP: Record<string, string> = {
      'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'aa', 'ب': 'b', 'ت': 't', 'ث': 'th',
      'ج': 'j', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'th', 'ر': 'r', 'ز': 'z',
      'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a',
      'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
      'ه': 'h', 'و': 'w', 'ي': 'y', 'ى': 'a', 'ة': 'a', 'ء': '', 'ؤ': 'o', 'ئ': 'e',
    };

    const withoutDiacritics = String(value || '').replace(/[ً-ٰٟـ]/g, '');
    const withLatinDigits = withoutDiacritics
      .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
      .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776));

    let result = '';
    for (const char of withLatinDigits) {
      result += ARABIC_TRANSLITERATION_MAP[char] ?? char;
    }
    return result;
  }

  normalizeSlugBase(value: unknown, isFallback = false): string {
    let normalized = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');

    // Auto-generated slugs (from a transliterated business name) read as an address, not a
    // sentence — cap them to a short, speakable handle instead of the whole business name.
    if (isFallback && normalized) {
      const MAX_FALLBACK_WORDS = 3;
      const MAX_FALLBACK_LENGTH = 24;
      const words = normalized.split('-').filter(Boolean).slice(0, MAX_FALLBACK_WORDS);
      const trimmedWords: string[] = [];
      let total = 0;
      for (const word of words) {
        const nextTotal = total + (trimmedWords.length ? 1 : 0) + word.length;
        if (nextTotal > MAX_FALLBACK_LENGTH && trimmedWords.length > 0) break;
        trimmedWords.push(word);
        total = nextTotal;
      }
      normalized = trimmedWords.join('-') || words[0]?.slice(0, MAX_FALLBACK_LENGTH) || '';
    }

    if (!normalized || normalized.length < 3) {
      if (isFallback) {
        return `store-${Math.floor(10000 + Math.random() * 90000)}`;
      }
      throw new BadRequestException('المعرف (Slug) غير صالح. يجب كتابته بحروف إنجليزية أو أرقام فقط.');
    }
    if (normalized.length > 60) {
      if (isFallback) {
        return normalized.slice(0, 60).replace(/-+$/g, '');
      }
      throw new BadRequestException('المعرف (Slug) يجب ألا يتجاوز 60 حرفًا.');
    }
    if (isReservedStoreSlug(normalized)) {
      if (isFallback) return `${normalized}-store`;
      throw new BadRequestException('هذا المعرف محجوز للنظام ولا يمكن استخدامه.');
    }

    return normalized;
  }

  private async makeUniqueSlug(base: string, trx: Kysely<Database>): Promise<string> {
    let candidate = base;
    let suffix = 2;
    while (true) {
      const row = await trx.selectFrom('tenants').select('id').where('slug', '=', candidate).executeTakeFirst();
      if (!row) return candidate;
      candidate = `${base}-${suffix++}`;
      if (candidate.length > 60) {
        candidate = `${base.slice(0, 54)}-${suffix++}`;
      }
    }
  }

  private async makeUniqueUsername(base: string, trx: Kysely<Database>): Promise<string> {
    const baseName = String(base || '').trim();
    let candidate = baseName;
    let suffix = 1;
    while (true) {
      const row = await trx
        .selectFrom('users')
        .select('id')
        .where(sql<string>`LOWER(username)`, '=', candidate.toLowerCase())
        .executeTakeFirst();
      if (!row) return candidate;
      candidate = `${baseName}${suffix++}`;
    }
  }

  /**
   * Routes through the shared policy instead of re-stating it. This used to inline its own
   * `length < 1` rule, so `enforceStrongProvidedPassword: true` from the platform admin
   * path enforced nothing beyond "not empty", and raising MIN_PASSWORD_LENGTH centrally
   * would silently have missed tenant provisioning.
   */
  private assertStrongTrialPassword(password: string): void {
    // Trial tenants are provisioned with an admin account.
    assertStrongPassword(password, { role: 'admin' });
  }

  private generatePassword(): string {
    return `Trial-${randomBytes(9).toString('base64url')}@Zs1`;
  }

  private addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private defaultPermissions(): string[] {
    return [...SUPER_ADMIN_PERMISSIONS];
  }

  private trialDaysRemaining(trialEndsAt: Date): number {
    const diffMs = trialEndsAt.getTime() - Date.now();
    return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  }

  async createTrialTenant(
    payload: TrialTenantProvisioningInput,
    options?: {
      enforceStrongProvidedPassword?: boolean;
      strictProvidedSlug?: boolean;
      strictProvidedUsername?: boolean;
    },
  ): Promise<TrialTenantProvisioningResult> {
    const businessName = this.normalizeRequired(payload.businessName, 'اسم النشاط مطلوب.');
    const ownerName = this.normalizeRequired(payload.ownerName, 'اسم المالك مطلوب.');
    const ownerPhone = this.normalizeRequired(this.normalizePhoneDigits(payload.ownerPhone), 'رقم الهاتف مطلوب.');
    const ownerEmail = this.normalizeOptional(payload.ownerEmail);
    const activityType = normalizeIndustryProfileKey(payload.businessIndustry || payload.activityType);
    const businessIndustry = activityType;
    const days = Number.isFinite(Number(payload.days)) ? Math.max(1, Math.min(365, Number(payload.days))) : DEFAULT_TRIAL_DAYS;
    const providedSlug = this.normalizeOptional(payload.slug);
    const providedUsername = this.normalizeOptional(payload.username);
    const providedPassword = this.normalizeOptional(payload.password);
    const now = new Date();
    const expiresAt = this.addDays(now, days);

    const result = await this.db.transaction().execute(async (trx) => {
      const slugBase = providedSlug
        ? this.normalizeSlugBase(providedSlug, false)
        : this.normalizeSlugBase(this.transliterateArabicToLatin(businessName), true);
      let slug = await this.makeUniqueSlug(slugBase, trx);
      if (providedSlug && options?.strictProvidedSlug) {
        const exists = await trx.selectFrom('tenants').select('id').where('slug', '=', slugBase).executeTakeFirst();
        if (exists) throw new BadRequestException('اسم النسخة مستخدم بالفعل.');
        slug = slugBase;
      }
      const usernameBase = String(providedUsername || businessName).trim();
      let username = await this.makeUniqueUsername(usernameBase, trx);
      if (providedUsername && options?.strictProvidedUsername) {
        const exists = await trx
          .selectFrom('users')
          .select('id')
          .where(sql<string>`LOWER(username)`, '=', usernameBase.toLowerCase())
          .executeTakeFirst();
        if (exists) throw new BadRequestException('اسم المستخدم مستخدم بالفعل.');
        username = usernameBase;
      }
      const temporaryPassword = providedPassword || this.generatePassword();
      if (providedPassword && options?.enforceStrongProvidedPassword !== false) {
        this.assertStrongTrialPassword(temporaryPassword);
      }

      const tenantId = randomUUID();
      const signupId = randomUUID();
      const accountId = `${tenantId}:main`;
      const passwordRecord = await createPasswordRecord(temporaryPassword);

      // Resolve feature plan id: if provided use it, otherwise default to 'plan_ultimate' (the comprehensive plan with all features)
      let featurePlanId = this.normalizeOptional(payload.featurePlanId);
      if (!featurePlanId) {
        const ultimatePlan = await trx.selectFrom('plans').select('id').where('id', '=', 'plan_ultimate').executeTakeFirst();
        if (ultimatePlan) {
          featurePlanId = ultimatePlan.id;
        } else {
          const firstPlan = await trx.selectFrom('plans').select('id').orderBy('created_at', 'desc').executeTakeFirst();
          featurePlanId = firstPlan?.id || null;
        }
      }

      await trx
        .insertInto('tenants')
        .values({
          id: tenantId,
          slug,
          business_name: businessName,
          owner_name: ownerName,
          owner_phone: ownerPhone,
          owner_email: ownerEmail,
          activity_type: activityType,
          status: 'trial',
          plan_id: featurePlanId,
          trial_starts_at: now,
          trial_ends_at: expiresAt,
          created_at: now,
          updated_at: now,
        } as any)
        .execute();

      // Create trial subscription record
      let saasPlan = payload.saasPlanId 
        ? await trx.selectFrom('saas_plans').selectAll().where('id', '=', payload.saasPlanId).executeTakeFirst()
        : null;

      if (!saasPlan && featurePlanId) {
        saasPlan = await trx.selectFrom('saas_plans').selectAll().where('feature_plan_id', '=', featurePlanId).executeTakeFirst();
      }
      if (!saasPlan) {
        saasPlan = await trx.selectFrom('saas_plans').selectAll().where('is_active', '=', true).orderBy('price', 'desc').executeTakeFirst();
      }

      if (saasPlan) {
        await trx
          .insertInto('tenant_subscriptions')
          .values({
            tenant_id: tenantId,
            plan_id: saasPlan.id,
            status: 'trial',
            starts_at: now,
            ends_at: expiresAt,
            grace_ends_at: null,
            auto_renew: false,
            created_at: now,
            updated_at: now,
          } as any)
          .execute();
      }

      await trx
        .insertInto('trial_signups')
        .values({
          id: signupId,
          tenant_id: tenantId,
          source: this.normalizeOptional(payload.source),
          campaign: this.normalizeOptional(payload.campaign),
          utm_source: null,
          utm_campaign: null,
          notes: this.normalizeOptional(payload.notes),
          created_at: now,
        } as any)
        .execute();

      // 1. Create Default Primary Branch
      const branchName = payload.branchName?.trim() || 'الفرع الرئيسي';
      const branch = await trx
        .insertInto('branches')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          name: branchName,
          code: 'MAIN',
          sales_stock_mode: 'single_location',
          allow_external_sales_stock: false,
          is_active: true,
        } as any)
        .returning(['id'])
        .executeTakeFirstOrThrow();

      const branchId = Number(branch.id);

      // 2. Create Default Primary Stock Location (e.g. "رصيد الفرع الرئيسي")
      const locationName = formatBranchStockLocationName(branchName);
      const location = await trx
        .insertInto('stock_locations')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          branch_id: branchId,
          name: locationName,
          code: 'WH-MAIN',
          location_type: 'branch_stock',
          is_active: true,
        } as any)
        .returning(['id'])
        .executeTakeFirstOrThrow();

      const locationId = Number(location.id);

      await trx
        .updateTable('branches')
        .set({ default_stock_location_id: locationId })
        .where('id', '=', branchId)
        .where('tenant_id', '=', tenantId)
        .execute();

      // 3. Create Tenant Admin User with default branch
      const user = await trx
        .insertInto('users')
        .values({
          username,
          password_hash: passwordRecord.hash,
          password_salt: passwordRecord.salt,
          role: 'admin',
          is_active: true,
          permissions_json: JSON.stringify(this.defaultPermissions()),
          default_branch_id: branchId,
          display_name: ownerName,
          phone: ownerPhone,
          failed_login_count: 0,
          locked_until: null,
          last_login_at: null,
          must_change_password: true,
          tenant_id: tenantId,
          account_id: accountId,
        } as any)
        .returning(['id'])
        .executeTakeFirstOrThrow();

      // 4. Link user to primary branch
      await trx
        .insertInto('user_branches')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          user_id: Number(user.id),
          branch_id: branchId,
        } as any)
        .onConflict((oc) => oc.columns(['user_id', 'branch_id'] as never).doNothing())
        .execute();

      // 5. Seed Default Business and Store Settings
      const defaultSettings: Array<{ key: string; value: any }> = [
        { key: 'storeName', value: businessName },
        { key: 'companyName', value: businessName },
        { key: 'business_name', value: businessName },
        { key: 'store_name', value: businessName },
        { key: 'phone', value: ownerPhone },
        { key: 'ownerName', value: ownerName },
        { key: 'email', value: ownerEmail || '' },
        { key: 'activityType', value: activityType || 'تجارة عامة ومتنوعة (افتراضي)' },
        { key: 'currency', value: 'EGP' },
        { key: 'uiLanguage', value: 'ar' },
        { key: 'language', value: 'ar' },
        { key: 'timezone', value: 'Africa/Cairo' },
        { key: 'dateFormat', value: 'dd/MM/yyyy' },
        { key: 'timeFormat', value: '12h' },
        { key: 'paperSize', value: 'receipt' },
        { key: 'theme', value: 'light' },
        { key: 'primaryBranchId', value: String(branchId) },
        { key: 'primaryLocationId', value: String(locationId) },
        { key: 'defaultStockLocationId', value: String(locationId) },
        { key: 'currentLocationId', value: String(locationId) },
        { key: 'taxRate', value: 0 },
        { key: 'taxMode', value: 'exclusive' },
        { key: 'taxNumber', value: '' },
      ];

      const industryPatch = this.getIndustrySettingsPatch(businessIndustry);
      const isOmni = featurePlanId === 'plan_omnichannel' || featurePlanId === 'omnichannel' || featurePlanId === 'OMNICHANNEL';
      const isEnterprise = isOmni || featurePlanId === 'plan_ultimate' || featurePlanId === 'ultimate' || featurePlanId === 'ULTIMATE';
      if (isOmni) {
        industryPatch.storefrontModuleEnabled = true;
      }
      if (isEnterprise) {
        industryPatch.enableEnterpriseFeatures = true;
        industryPatch.installmentsModuleEnabled = true;
        industryPatch.taxDeclarationModuleEnabled = true;
        industryPatch.fixedAssetsModuleEnabled = true;
        industryPatch.hrModuleEnabled = true;
      }
      for (const [k, v] of Object.entries(industryPatch)) {
        defaultSettings.push({ key: k, value: v });
      }

      for (const s of defaultSettings) {
        await sql`
          INSERT INTO settings (key, value, tenant_id, account_id)
          VALUES (${s.key}, ${JSON.stringify(s.value)}, ${tenantId}, ${accountId})
          ON CONFLICT (tenant_id, key)
          DO UPDATE SET value = EXCLUDED.value, account_id = EXCLUDED.account_id
        `.execute(trx);
      }

      const resolvedPlanName = saasPlan?.name || (featurePlanId === 'plan_omnichannel' ? 'التجارة الشاملة' : featurePlanId === 'plan_ultimate' ? 'المتكاملة' : featurePlanId === 'plan_pro' ? 'المتقدمة' : featurePlanId === 'plan_starter' ? 'الأساسية' : 'المتكاملة');

      return {
        tenantId,
        slug,
        username,
        temporaryPassword,
        featurePlanId,
        planName: resolvedPlanName,
      };
    });

    return {
      tenant: {
        id: result.tenantId,
        slug: result.slug,
        businessName,
        ownerName,
        ownerPhone,
        ownerEmail: ownerEmail || '',
        activityType: activityType || '',
        status: 'trial',
        trialStartsAt: now.toISOString(),
        trialEndsAt: expiresAt.toISOString(),
        activatedAt: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        trialDaysRemaining: this.trialDaysRemaining(expiresAt),
        ownerUsername: result.username,
        planName: result.planName,
        planId: result.featurePlanId,
      },
      owner: {
        username: result.username,
        temporaryPassword: result.temporaryPassword,
        mustChangePassword: true,
      },
    };
  }
}
