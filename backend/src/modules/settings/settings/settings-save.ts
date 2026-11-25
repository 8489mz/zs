import { sql, type Kysely } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import type { AuditService } from '../../../core/audit/audit.service';
import type { AuthCacheService } from '../../../core/auth/services/auth-cache.service';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import type { TenantScope } from '../../../core/auth/utils/tenant-boundary';
import type { RawBuilder } from 'kysely';
import { AppError } from '../../../common/errors/app-error';
import { lockAccountingPeriod } from '../../accounting/accounting-period-lock';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { isValidTimezone } from '../../../common/utils/tenant-timezone.util';
import { getIndustryProfile, normalizeIndustryProfileKey } from '../../../core/tenant/industry-profiles';
import { filterProtectedModuleKeysForActor } from '../settings-module-entitlement.engine';
import { PLAN_MANAGED_MODULES_SETTING_KEY } from '../../../common/constants/platform-settings-keys';
import { hashManagerPin, isBcryptHash, MANAGER_PIN_SETTING_KEYS } from '../../../common/utils/manager-approval';

export class SettingsSave {
  constructor(private readonly db: Kysely<Database>, private readonly audit: AuditService, private readonly authCache: AuthCacheService, private readonly bound: { getSettings: (actor: AuthContext) => Promise<Record<string, unknown>>; invalidatePlanFeaturesCache: (tenantId: string | undefined) => void; invalidateSettingsCache: (tenantId: string | undefined) => void; loadFeatureOverride: (tenantId: string, featureCode: string) => Promise<boolean | null>; scope: (actor: AuthContext) => TenantScope; tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean> }) {}

  private async getSettings(actor: AuthContext): Promise<Record<string, unknown>> {
    return this.bound.getSettings(actor);
  }
  private invalidatePlanFeaturesCache(tenantId: string | undefined): void {
    return this.bound.invalidatePlanFeaturesCache(tenantId);
  }
  private invalidateSettingsCache(tenantId: string | undefined): void {
    return this.bound.invalidateSettingsCache(tenantId);
  }
  private async loadFeatureOverride(tenantId: string, featureCode: string): Promise<boolean | null> {
    return this.bound.loadFeatureOverride(tenantId, featureCode);
  }
  private scope(actor: AuthContext): TenantScope {
    return this.bound.scope(actor);
  }
  private tenantPredicate(actor: AuthContext, alias?: string): RawBuilder<boolean> {
    return this.bound.tenantPredicate(actor, alias);
  }

  async saveSettings(payload: Record<string, unknown>, actor: AuthContext): Promise<Record<string, unknown>> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new AppError('Settings payload must be an object', 'SETTINGS_INVALID', 400);
    const scope = this.scope(actor);
    const currentBranchIdRaw = String(payload.currentBranchId ?? '').trim();
    const currentLocationIdRaw = String(payload.currentLocationId ?? '').trim();

    const normalizedPayload = { ...payload };

    // Only process branch and location if they are provided
    if (currentBranchIdRaw) {
      const currentBranchId = Number(currentBranchIdRaw);
      let branch = null;
      if (Number.isFinite(currentBranchId) && currentBranchId > 0) {
        branch = await this.db
          .selectFrom('branches')
          .select(['id', 'default_stock_location_id'])
          .where('id', '=', currentBranchId)
          .where(this.tenantPredicate(actor))
          .executeTakeFirst();
      }

      if (!branch) {
        // Fallback to the tenant's first active branch if available
        branch = await this.db
          .selectFrom('branches')
          .select(['id', 'default_stock_location_id'])
          .where('is_active', '=', true)
          .where(this.tenantPredicate(actor))
          .orderBy('id', 'asc')
          .executeTakeFirst();
      }

      if (branch) {
        normalizedPayload.currentBranchId = String(branch.id);
        const locationId = currentLocationIdRaw ? Number(currentLocationIdRaw) : branch.default_stock_location_id;

        if (locationId && Number.isFinite(locationId) && locationId > 0) {
          const location = await this.db
            .selectFrom('stock_locations')
            .select(['id'])
            .where('id', '=', locationId)
            .where(this.tenantPredicate(actor))
            .executeTakeFirst();

          if (location) {
            normalizedPayload.currentLocationId = String(location.id);
          } else {
            delete normalizedPayload.currentLocationId;
          }
        }
      } else {
        delete normalizedPayload.currentBranchId;
        delete normalizedPayload.currentLocationId;
      }
    }


    if ('uiLanguage' in normalizedPayload) {
      normalizedPayload.uiLanguage = String(normalizedPayload.uiLanguage || '').trim().toLowerCase() === 'en' ? 'en' : 'ar';
    }
    if ('defaultBranchIssueMode' in normalizedPayload) {
      normalizedPayload.defaultBranchIssueMode = normalizedPayload.defaultBranchIssueMode === 'transfer_to_branch_stock' ? 'transfer_to_branch_stock' : 'final_issue';
    }
    if ('timezone' in normalizedPayload && normalizedPayload.timezone) {
      const tz = String(normalizedPayload.timezone).trim();
      if (!isValidTimezone(tz)) {
        throw new AppError('المنطقة الزمنية المحددة غير صالحة', 'INVALID_TIMEZONE', 400);
      }
      normalizedPayload.timezone = tz;
    }

    const tenantRow = await this.db
      .selectFrom('tenants')
      .select(['activity_type', 'plan_id', 'extra_features'])
      .where('id', '=', scope.tenantId)
      .executeTakeFirst();

    const rawRequestedActivity = String(
      normalizedPayload.activityType || normalizedPayload.businessIndustry || '',
    ).trim().toLowerCase();

    let effectiveType = tenantRow?.activity_type || rawRequestedActivity || 'retail_general';

    // Allow Super Admin to switch the tenant's activity profile via settings save
    const isSuperAdminActor = actor.role === 'super_admin';
    if (isSuperAdminActor && rawRequestedActivity && rawRequestedActivity !== tenantRow?.activity_type) {
      const normalizedKey = normalizeIndustryProfileKey(rawRequestedActivity);
      await this.db
        .updateTable('tenants')
        .set({ activity_type: normalizedKey })
        .where('id', '=', scope.tenantId)
        .execute();
      this.authCache.invalidateTenant(scope.tenantId);
      this.invalidatePlanFeaturesCache(scope.tenantId);
      effectiveType = normalizedKey;
      normalizedPayload.activityType = normalizedKey;
      normalizedPayload.businessIndustry = normalizedKey;
    }

    const profile = getIndustryProfile(effectiveType);

    if (profile.pillar === 'contracting') {
      normalizedPayload.contractingModuleEnabled = true;
      normalizedPayload.crmModuleEnabled = true;
      normalizedPayload.purchasesModuleEnabled = true;
      normalizedPayload.inventoryModuleEnabled = true;
      normalizedPayload.hrModuleEnabled = true;
      normalizedPayload.enableEnterpriseFeatures = true;
      normalizedPayload.fixedAssetsModuleEnabled = true;
      normalizedPayload.taxDeclarationModuleEnabled = true;
      normalizedPayload.maritimeFreightModuleEnabled = false;
      normalizedPayload.posModuleEnabled = false;
      normalizedPayload.requireCashierShiftForSales = false;
    } else if (profile.pillar === 'maritime_freight') {
      normalizedPayload.maritimeFreightModuleEnabled = true;
      normalizedPayload.crmModuleEnabled = true;
      normalizedPayload.purchasesModuleEnabled = true;
      normalizedPayload.hrModuleEnabled = true;
      normalizedPayload.enableEnterpriseFeatures = true;
      normalizedPayload.fixedAssetsModuleEnabled = true;
      normalizedPayload.taxDeclarationModuleEnabled = true;
      normalizedPayload.contractingModuleEnabled = false;
      normalizedPayload.manufacturingModuleEnabled = false;
      normalizedPayload.inventoryModuleEnabled = false;
      normalizedPayload.posModuleEnabled = false;
      normalizedPayload.requireCashierShiftForSales = false;
    } else if (profile.pillar === 'manufacturing') {
      normalizedPayload.manufacturingModuleEnabled = true;
      normalizedPayload.crmModuleEnabled = true;
      normalizedPayload.purchasesModuleEnabled = true;
      normalizedPayload.inventoryModuleEnabled = true;
      normalizedPayload.hrModuleEnabled = true;
      normalizedPayload.enableEnterpriseFeatures = true;
      normalizedPayload.fixedAssetsModuleEnabled = true;
      normalizedPayload.taxDeclarationModuleEnabled = true;
      normalizedPayload.contractingModuleEnabled = false;
      normalizedPayload.maritimeFreightModuleEnabled = false;
      normalizedPayload.posModuleEnabled = false;
      normalizedPayload.requireCashierShiftForSales = false;
    } else if (profile.key === 'import_export' || profile.subVertical === 'import_export') {
      normalizedPayload.contractingModuleEnabled = false;
      normalizedPayload.maritimeFreightModuleEnabled = false;
      normalizedPayload.manufacturingModuleEnabled = false;
      normalizedPayload.importModuleEnabled = true;
      normalizedPayload.inventoryModuleEnabled = true;
      normalizedPayload.purchasesModuleEnabled = true;
      normalizedPayload.enableEnterpriseFeatures = true;
      normalizedPayload.hrModuleEnabled = true;
      normalizedPayload.posModuleEnabled = false;
      normalizedPayload.requireCashierShiftForSales = false;
    } else if (profile.key === 'warehousing' || profile.key === 'wholesale_van') {
      normalizedPayload.contractingModuleEnabled = false;
      normalizedPayload.maritimeFreightModuleEnabled = false;
      normalizedPayload.posModuleEnabled = false;
      normalizedPayload.requireCashierShiftForSales = false;
    } else if (profile.key === 'services') {
      normalizedPayload.contractingModuleEnabled = false;
      normalizedPayload.maritimeFreightModuleEnabled = false;
    } else {
      normalizedPayload.contractingModuleEnabled = false;
      normalizedPayload.maritimeFreightModuleEnabled = false;
      normalizedPayload.posModuleEnabled = true;
    }

    // Only platform super_admin or an active SaaS impersonation session may flip module switches;
    // regular tenant admins retain operational settings (prefixes, VAT, receipts, printers).
    const isPlatformModuleOperator = isSuperAdminActor || Boolean(actor.impersonatedBy);
    if (!isPlatformModuleOperator) {
      filterProtectedModuleKeysForActor(normalizedPayload, {
        isSuperAdmin: false,
        profile,
      });
    }

    // P10 (INV-VAN-GENERAL-FEATURE-OVERRIDES): a super-admin POS override
    // is re-applied AFTER the protected-keys filter, because the override
    // is super-admin authority and wins over it (posModuleEnabled is in
    // ALWAYS_PROTECTED_SWITCHES, so the filter would otherwise strip a
    // grant a tenant admin's save round-tripped). A grant keeps POS + the
    // cashier-shift gate on; a hide keeps them off; no row leaves the
    // profile branch's values alone.
    const posOverride = await this.loadFeatureOverride(scope.tenantId, 'pos');
    if (posOverride === true) {
      normalizedPayload.posModuleEnabled = true;
      normalizedPayload.requireCashierShiftForSales = true;
    } else if (posOverride === false) {
      normalizedPayload.posModuleEnabled = false;
      normalizedPayload.requireCashierShiftForSales = false;
    }

    // Platform bookkeeping, never a tenant setting: this records which module switches the
    // last plan sync granted, and the next sync takes its revocation list from it. It is
    // returned by getSettings like any other row, so a full round-trip of the settings
    // object would otherwise write it straight back — and a crafted value would steer what
    // the next sync switches off.
    delete normalizedPayload[PLAN_MANAGED_MODULES_SETTING_KEY];

    // P10: posGrantedByOverride is a computed read-path flag, never a
    // persisted setting — a round-tripped value must not land in the
    // settings table.
    delete normalizedPayload['posGrantedByOverride'];

    // The developer master-password hash is set ONLY through the
    // guarded POST /api/developer/master-password endpoint, by the
    // super_admin, as a bcrypt hash. A generic settings payload must
    // never create or overwrite it — a settings manager writing a
    // chosen hash here would take over the developer panel.
    delete normalizedPayload['developerMasterPasswordHash'];

    // INV-REST-MANAGER-PIN-HASHED: the shared manager PIN is stored as a
    // bcrypt hash, never plaintext (same mechanism as
    // developerMasterPasswordHash). A value that is already a bcrypt hash
    // is left alone, so a settings round-trip (getSettings returns the
    // hash to a settings manager, the client sends the whole object back)
    // never double-hashes it. An empty value clears the PIN, as before.
    for (const key of MANAGER_PIN_SETTING_KEYS) {
      const raw = normalizedPayload[key];
      if (typeof raw === 'string' && raw.trim() && !isBcryptHash(raw.trim())) {
        normalizedPayload[key] = await hashManagerPin(raw.trim());
      }
    }

    await this.db.transaction().execute(async trx => {
      if ('currency' in normalizedPayload) {
        await lockAccountingPeriod(trx, scope.tenantId);
        const requested = String(normalizedPayload.currency || '').trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(requested)) throw new AppError('رمز العملة غير صالح', 'INVALID_CURRENCY', 400);
        const current = await tenantBaseCurrency(trx, scope.tenantId);
        if (requested !== current) {
          const posted = await trx.selectFrom('journal_entries').select('id').where('tenant_id', '=', scope.tenantId).where('status', '=', 'posted').limit(1).executeTakeFirst();
          const rate = await trx.selectFrom('currency_exchange_rates').select('id').where('tenant_id', '=', scope.tenantId).limit(1).executeTakeFirst();
          if (posted || rate) throw new AppError('تغيير عملة الأساس بعد تهيئة أسعار الصرف أو الترحيل يتطلب تحويل دفاتر معتمداً', 'BASE_CURRENCY_LOCKED', 400);
        }
        normalizedPayload.currency = requested;
      }
      for (const [key, value] of Object.entries(normalizedPayload)) {
        await sql`insert into settings (key, value, tenant_id, account_id) values (${key}, ${JSON.stringify(value)}, ${scope.tenantId}, ${scope.accountId}) on conflict (tenant_id, key) do update set value = excluded.value, account_id = excluded.account_id`.execute(trx);
      }
    });
    this.invalidateSettingsCache(scope.tenantId);
    await this.audit.log('تعديل الإعدادات', `تم تعديل الإعدادات بواسطة ${actor.username}`, actor);
    return this.getSettings(actor);
  }
}
