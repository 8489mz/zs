import { type Kysely, sql } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import { type AuditService, AUDIT_EVENT_CODES } from '../../../core/audit/audit.service';
import type { TrialTenantProvisioningService } from '../trial-tenant-provisioning.service';
import type { SettingsService } from '../../settings/settings.service';
import type { AuthCacheService } from '../../../core/auth/services/auth-cache.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { isReservedStoreSlug } from '../../storefront/engines/store-public-url.engine';
import { normalizeIndustryProfileKey } from '../../../core/tenant/industry-profiles';
import { isEnterpriseOrUltimatePlan, isOmnichannelPlanId } from '../../../core/tenant/plan-tier.util';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';

export interface SaasAdminPlanMutationsBoundDeps {
  assertPlatformAccess(auth: AuthContext): void;
  assertNotPlatformTenantTarget(targetTenantId: string): void;
  syncTenantModuleSettingsForPlan(tenantId: string, planId?: string | null, extraFeatures?: string[]): Promise<void>;
  syncTenantSubscriptionPlan(tenantId: string, planId: string): Promise<void>;
}

export class SaasAdminPlanMutations {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly provisioning: TrialTenantProvisioningService,
    private readonly settingsService: SettingsService,
    private readonly authCache: AuthCacheService,
    private readonly bound: SaasAdminPlanMutationsBoundDeps,
  ) {}

  private assertPlatformAccess(auth: AuthContext): void {
    return this.bound.assertPlatformAccess(auth);
  }

  private assertNotPlatformTenantTarget(targetTenantId: string): void {
    return this.bound.assertNotPlatformTenantTarget(targetTenantId);
  }

  private async syncTenantModuleSettingsForPlan(
    tenantId: string,
    planId?: string | null,
    extraFeatures?: string[],
  ): Promise<void> {
    return this.bound.syncTenantModuleSettingsForPlan(tenantId, planId, extraFeatures);
  }

  private async syncTenantSubscriptionPlan(tenantId: string, planId: string): Promise<void> {
    return this.bound.syncTenantSubscriptionPlan(tenantId, planId);
  }

  /**
   * P10 (INV-VAN-GENERAL-FEATURE-OVERRIDES): applies super-admin per-tenant
   * feature overrides. Each entry: granted true (grant), false (hide), or
   * null (remove — back to the profile/plan default). Only rows whose value
   * actually changes are written, and each change gets one audit event.
   * Returns the number of features whose effective override changed.
   */
  private async applyFeatureOverrides(
    tenantId: string,
    overrides: Array<{ featureCode: string; granted?: boolean | null; reason?: string }> | undefined,
    auth: AuthContext,
  ): Promise<number> {
    if (!overrides) return 0;
    let current: Array<{ feature_code: string; granted: boolean }> = [];
    try {
      current = await this.db
        .selectFrom('tenant_feature_overrides')
        .select(['feature_code', 'granted'])
        .where('tenant_id', '=', tenantId)
        .execute();
    } catch {
      current = [];
    }
    const currentByCode = new Map(current.map((r) => [String(r.feature_code), Boolean(r.granted)]));
    let changed = 0;
    for (const entry of overrides) {
      const code = String(entry.featureCode || '').trim();
      if (!code) continue;
      const previous = currentByCode.has(code) ? currentByCode.get(code)! : null;
      const next = entry.granted === null || entry.granted === undefined ? null : Boolean(entry.granted);
      if (previous === next) continue;
      if (next === null) {
        await this.db
          .deleteFrom('tenant_feature_overrides')
          .where('tenant_id', '=', tenantId)
          .where('feature_code', '=', code)
          .execute();
      } else {
        await sql`INSERT INTO tenant_feature_overrides (tenant_id, feature_code, granted, granted_by, granted_at, reason)
          VALUES (${tenantId}, ${code}, ${next}, ${auth.userId}, NOW(), ${entry.reason ?? null})
          ON CONFLICT (tenant_id, feature_code) DO UPDATE SET granted = EXCLUDED.granted, granted_by = EXCLUDED.granted_by, granted_at = EXCLUDED.granted_at, reason = EXCLUDED.reason, updated_at = NOW()`.execute(
          this.db,
        );
      }
      changed += 1;
      await this.audit.log(
        next === null ? 'إزالة تجاوز ميزة' : next ? 'منح تجاوز ميزة' : 'إخفاء تجاوز ميزة',
        `الميزة ${code} على النسخة ${tenantId}: ${previous === null ? 'افتراضي' : previous ? 'ممنوحة' : 'مخفاة'} إلى ${next === null ? 'افتراضي' : next ? 'ممنوحة' : 'مخفاة'}${entry.reason ? ` — ${entry.reason}` : ''}`,
        auth,
        { targetTenantId: tenantId, eventCode: AUDIT_EVENT_CODES.SAAS_TENANT_FEATURE_OVERRIDE },
      );
    }
    return changed;
  }

  async updateTenantPlan(
    id: string,
    dto: {
      planId?: string;
      extraFeatures?: string[];
      activityType?: string;
      featureOverrides?: Array<{ featureCode: string; granted?: boolean | null; reason?: string }>;
    },
    auth: AuthContext,
  ) {
    this.assertPlatformAccess(auth);
    this.assertNotPlatformTenantTarget(id);

    const tenant = await this.db
      .selectFrom('tenants')
      .select(['id', 'slug', 'plan_id', 'extra_features'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!tenant) throw new NotFoundException('Tenant not found');

    // P10: overrides apply first, so the plan sync below (and the activity
    // patch above it) reads the new value from the table.
    const overrideChanges = await this.applyFeatureOverrides(id, dto.featureOverrides, auth);

    const updateData: any = {};
    if (dto.planId !== undefined) updateData.plan_id = dto.planId;
    if (dto.extraFeatures !== undefined) updateData.extra_features = JSON.stringify(dto.extraFeatures);
    if (dto.activityType !== undefined && String(dto.activityType).trim().length > 0) {
      const normalized = normalizeIndustryProfileKey(dto.activityType);
      updateData.activity_type = normalized;
      const patch = this.provisioning.getIndustrySettingsPatch(normalized);
      const targetPlan = dto.planId !== undefined ? dto.planId : (tenant as any).plan_id;
      const targetExtra = dto.extraFeatures !== undefined ? dto.extraFeatures : (tenant as any).extra_features;
      const isOmni =
        isOmnichannelPlanId(targetPlan) || (Array.isArray(targetExtra) && targetExtra.includes('storefront'));
      const isEnterprise =
        isOmni ||
        isEnterpriseOrUltimatePlan(targetPlan) ||
        (Array.isArray(targetExtra) && targetExtra.includes('accounting'));
      if (isOmni) {
        delete patch.storefrontModuleEnabled;
      }
      if (isEnterprise) {
        delete patch.enableEnterpriseFeatures;
        delete patch.installmentsModuleEnabled;
        delete patch.taxDeclarationModuleEnabled;
        delete patch.fixedAssetsModuleEnabled;
        delete patch.deliveryRepsModuleEnabled;
        delete patch.hrModuleEnabled;
      }
      const userRow = await this.db
        .selectFrom('users')
        .select('account_id')
        .where('tenant_id', '=', id)
        .executeTakeFirst();
      const accountId = userRow?.account_id ?? 1;

      for (const [k, v] of Object.entries(patch)) {
        await sql`
          INSERT INTO settings (tenant_id, account_id, key, value)
          VALUES (${id}, ${accountId}, ${k}, ${JSON.stringify(v)})
          ON CONFLICT (tenant_id, key)
          DO UPDATE SET value = EXCLUDED.value, account_id = EXCLUDED.account_id;
        `.execute(this.db);
      }
    }

    if (Object.keys(updateData).length > 0) {
      await this.db.updateTable('tenants').set(updateData).where('id', '=', id).execute();

      const effectivePlanId = dto.planId !== undefined ? dto.planId : (tenant as any).plan_id;
      const effectiveExtra = dto.extraFeatures !== undefined ? dto.extraFeatures : (tenant as any).extra_features;
      await this.syncTenantModuleSettingsForPlan(id, effectivePlanId, effectiveExtra);
      if (effectivePlanId) {
        await this.syncTenantSubscriptionPlan(id, effectivePlanId);
      }

      this.authCache.invalidateTenant(id);
      this.settingsService.invalidateSettingsCache(id);
      this.settingsService.invalidatePlanFeaturesCache(id);
      await this.audit.log('تحديث الباقة والنشاط', `تم تحديث باقة ونشاط النسخة ${tenant.slug}`, auth, {
        targetTenantId: tenant.id,
        eventCode: AUDIT_EVENT_CODES.SAAS_TENANT_PLAN_UPDATED,
      });
    } else if (overrideChanges > 0) {
      // P10: overrides alone (no plan/activity change) still need the plan
      // sync — it is the writer of the module switches the override drives
      // (posModuleEnabled / requireCashierShiftForSales), and create-sale
      // reads the RAW settings rows, not the getSettings safety net.
      const effectivePlanId = (tenant as any).plan_id;
      const effectiveExtra = (tenant as any).extra_features;
      await this.syncTenantModuleSettingsForPlan(id, effectivePlanId, effectiveExtra);
      this.authCache.invalidateTenant(id);
      this.settingsService.invalidateSettingsCache(id);
      this.settingsService.invalidatePlanFeaturesCache(id);
    }

    return { ok: true };
  }

  async updateTenantSlug(id: string, newSlug: string, auth: AuthContext) {
    this.assertPlatformAccess(auth);
    this.assertNotPlatformTenantTarget(id);

    const tenant = await this.db
      .selectFrom('tenants')
      .select(['id', 'slug', 'business_name'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!tenant) throw new NotFoundException('النسخة غير موجودة');

    const cleanSlug = String(newSlug || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-');

    if (!cleanSlug || cleanSlug.length < 3) {
      throw new BadRequestException('معرّف النسخة يجب أن يتكون من 3 أحرف إنجليزية أو أرقام على الأقل');
    }

    if (isReservedStoreSlug(cleanSlug)) {
      throw new BadRequestException('هذا المعرّف محجوز للنظام ولا يمكن استخدامه');
    }

    // Check uniqueness across other tenants
    const existing = await this.db
      .selectFrom('tenants')
      .select('id')
      .where('slug', '=', cleanSlug)
      .where('id', '!=', id)
      .executeTakeFirst();

    if (existing) {
      throw new ConflictException(`معرّف النسخة "${cleanSlug}" مستخدم بالفعل من قبل عميل آخر`);
    }

    const oldSlug = tenant.slug;
    await this.db
      .updateTable('tenants')
      .set({
        slug: cleanSlug,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();

    this.authCache.invalidateTenant(id);

    await this.audit.log(
      'تعديل معرّف النسخة',
      `تم تغيير معرّف النسخة من "${oldSlug}" إلى "${cleanSlug}" لنشاط (${tenant.business_name})`,
      auth,
      {
        targetTenantId: tenant.id,
        eventCode: AUDIT_EVENT_CODES.SAAS_TENANT_SLUG_UPDATED,
      },
    );

    return {
      success: true,
      oldSlug,
      newSlug: cleanSlug,
      message: `تم تحديث معرّف النسخة بنجاح إلى "${cleanSlug}"`,
    };
  }
}
