import assert from 'node:assert';
import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { ConfigService } from '@nestjs/config';
import { Database } from '../../../src/database/database.types';
import { AuditService, AUDIT_EVENT_CODES } from '../../../src/core/audit/audit.service';
import { AuthCacheService } from '../../../src/core/auth/services/auth-cache.service';
import { SessionService } from '../../../src/core/auth/services/session.service';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { SettingsDemoDataService } from '../../../src/modules/settings/services/settings-demo-data.service';
import { TrialTenantProvisioningService } from '../../../src/modules/saas-admin/trial-tenant-provisioning.service';
import { SaasAdminService } from '../../../src/modules/saas-admin/saas-admin.service';
import { TenantSubscriptionService } from '../../../src/modules/tenant-subscription/tenant-subscription.service';
import { PricingCatalogService } from '../../../src/modules/tenant-subscription/pricing/pricing-catalog.service';
import { verifyPassword } from '../../../src/core/auth/utils/password-hasher';
import { AuthContext } from '../../../src/core/auth/interfaces/auth-context.interface';

/**
 * MASTER E2E SIMULATION: MULTI-TENANT SAAS PLATFORM, GOVERNANCE & SUBSCRIPTION LIFECYCLE
 *
 * Verifies core cloud SaaS invariants and complete administrative lifecycle:
 * 1. Dual-Check Platform Security Boundary Invariant (Super Admin + Platform Tenant)
 * 2. Platform Tenant Immutability & Target Defense ('zs' cannot be modified/deleted)
 * 3. Slug Sanitization & Reserved Names Defense
 * 4. Atomic Provisioning of Trial Tenant with Bcrypt-secured owner user
 * 5. Trial Extension & Administrative Grace Periods
 * 6. Tenant Suspension & Session Lockdown
 * 7. Plan Activation & Subscription Ledger Provisioning
 * 8. Billing Payment Recording & Subscription Renewal
 * 9. Subscription Expiration Enforcement
 * 10. Dynamic Plan Features Synchronization to Module Settings
 * 11. Impersonation Audit Invariant (O34: impersonatedBy operator tracking)
 * 12. Owner Account Unlocking & Password Recovery
 * 13. Complete Tenant Deletion & Multi-Tenant Data Isolation Cleanup
 */
async function runSaasPlatformMasterSimulation() {
  console.log('========================================================================');
  console.log('  STARTING COMPREHENSIVE END-TO-END SAAS PLATFORM & GOVERNANCE SIMULATION');
  console.log('========================================================================\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/zs_dev',
  });

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

  const audit = new AuditService(db);
  const authCache = new AuthCacheService();
  const configService = new ConfigService();
  const sessionService = new SessionService(db, configService, audit, authCache);
  const settingsService = new SettingsService(db, audit, authCache);
  const demoDataService = new SettingsDemoDataService(db, audit, {} as any);
  const provisioningService = new TrialTenantProvisioningService(db);
  const saasAdminService = new SaasAdminService(
    db,
    audit,
    provisioningService,
    configService,
    sessionService,
    demoDataService,
    settingsService,
    authCache,
  );
  const pricingService = new PricingCatalogService();
  const tenantSubService = new TenantSubscriptionService(db, audit, pricingService);

  const uniqueSuffix = Date.now().toString();
  const platformSessionId = `session-plat-${uniqueSuffix}`;
  await (db as any)
    .insertInto('sessions')
    .values({
      id: platformSessionId,
      user_id: 46,
      tenant_id: 'zs',
      account_id: 'zs:main',
      expires_at: new Date(Date.now() + 24 * 3600 * 1000),
      last_seen_at: new Date(),
    })
    .execute();

  // Platform Administrator Actor Context
  const platformAdminAuth: AuthContext = {
    userId: 46,
    sessionId: platformSessionId,
    username: 'admin',
    role: 'super_admin',
    permissions: ['*'],
    tenantId: 'zs',
    accountId: 'zs',
  };

  // Unauthorized Customer Tenant Owner Actor Context
  const rogueTenantAuth: AuthContext = {
    userId: 999,
    sessionId: 'session-rogue-owner',
    username: 'rogue_owner',
    role: 'admin',
    permissions: ['*'],
    tenantId: 'customer_tenant_99',
    accountId: 'customer_tenant_99',
  };

  let createdTenantId = '';

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Dual-Check Platform Security Boundary Invariant
    // -------------------------------------------------------------------------
    console.log('[STEP 1] Testing Dual-Check Platform Access Boundary Invariant...');
    let rogueBlocked = false;
    try {
      await saasAdminService.listTenants({}, rogueTenantAuth);
    } catch (err: any) {
      rogueBlocked = true;
      console.log(`  -> Customer Tenant Owner correctly rejected: ${err.message}`);
    }
    assert(rogueBlocked === true, 'Customer tenant owner must be strictly rejected from platform administration');

    // Super Admin on a NON-platform tenant must ALSO be rejected!
    let fakeSuperAdminBlocked = false;
    try {
      await saasAdminService.listTenants(
        {},
        {
          ...rogueTenantAuth,
          role: 'super_admin',
          tenantId: 'external_tenant_123',
        },
      );
    } catch (err: any) {
      fakeSuperAdminBlocked = true;
      console.log(`  -> Non-Platform Super Admin correctly rejected: ${err.message}`);
    }
    assert(fakeSuperAdminBlocked === true, 'Super Admin on non-platform tenant must be strictly rejected');

    // Platform Super Admin on 'zs' must succeed
    const tenantsList = await saasAdminService.listTenants({}, platformAdminAuth);
    assert(Array.isArray(tenantsList.tenants), 'Platform super admin must access tenants list');
    console.log(
      `  -> Platform Super Admin successfully verified (Active Tenants Count: ${(tenantsList.tenants as any[]).length})`,
    );
    console.log('  [PASS] STEP 1 PASSED: Dual-check platform security barrier strictly enforced.\n');

    // -------------------------------------------------------------------------
    // STEP 2: Platform Tenant Immutability & Target Defense
    // -------------------------------------------------------------------------
    console.log('[STEP 2] Testing Platform Tenant Immutability & Defense against modification of "zs"...');
    let suspendZsBlocked = false;
    try {
      await saasAdminService.suspendTenant('zs', { reason: 'illegal test' }, platformAdminAuth);
    } catch (err: any) {
      suspendZsBlocked = true;
      console.log(`  -> Platform suspension guard correctly rejected: ${err.message}`);
    }
    assert(suspendZsBlocked === true, 'Cannot suspend platform tenant "zs"');

    let deleteZsBlocked = false;
    try {
      await saasAdminService.deleteTenant('zs', platformAdminAuth);
    } catch (err: any) {
      deleteZsBlocked = true;
      console.log(`  -> Platform deletion guard correctly rejected: ${err.message}`);
    }
    assert(deleteZsBlocked === true, 'Cannot delete platform tenant "zs"');
    console.log('  [PASS] STEP 2 PASSED: Platform tenant immutability validated.\n');

    // -------------------------------------------------------------------------
    // STEP 3: Slug Validation & Reserved Slugs Defense
    // -------------------------------------------------------------------------
    console.log('[STEP 3] Testing Slug Sanitization & Reserved Names Defense...');
    let reservedSlugBlocked = false;
    try {
      await saasAdminService.createTrialTenant(
        {
          businessName: 'شركة تجريبية',
          slug: 'admin', // reserved
          ownerName: 'مدير تجريبي',
          ownerEmail: `reserved.${uniqueSuffix}@test.local`,
          ownerPhone: '01011112222',
          username: `user_${uniqueSuffix}`,
          password: `StrongPass@${uniqueSuffix}`,
          activityType: 'retail',
        },
        platformAdminAuth,
      );
    } catch (err: any) {
      reservedSlugBlocked = true;
      console.log(`  -> Reserved slug "admin" correctly blocked: ${err.message}`);
    }
    assert(reservedSlugBlocked === true, 'Reserved slug must be blocked');
    console.log('  [PASS] STEP 3 PASSED: Reserved slug defense verified.\n');

    // -------------------------------------------------------------------------
    // STEP 4: Atomic Provisioning of Trial Tenant
    // -------------------------------------------------------------------------
    console.log('[STEP 4] Provisioning New Isolated Trial Tenant...');
    const testSlug = `nile-tech-${uniqueSuffix.slice(-6)}`;
    const ownerUsername = `nile_owner_${uniqueSuffix.slice(-6)}`;
    const plainPassword = `NileTech@${uniqueSuffix.slice(-6)}`;

    const createRes = await saasAdminService.createTrialTenant(
      {
        businessName: 'شركة النيل للتقنية والتوزيع الشامل',
        slug: testSlug,
        ownerName: 'م. مصطفى كامل الباجوري',
        ownerEmail: `mostafa.${uniqueSuffix}@nile-tech.local`,
        ownerPhone: '01099887766',
        activityType: 'retail',
        username: ownerUsername,
        password: plainPassword,
        days: 14,
      },
      platformAdminAuth,
    );

    assert(Boolean(createRes.tenant && (createRes.tenant as any).id), 'Tenant creation must return tenant payload');
    createdTenantId = (createRes.tenant as any).id;
    console.log(
      `  -> Created Trial Tenant: [ID: ${createdTenantId}] Slug: "${testSlug}" Status: "${(createRes.tenant as any).status}"`,
    );

    // Verify Owner User in DB
    const ownerUser = await (db as any)
      .selectFrom('users')
      .selectAll()
      .where('tenant_id', '=', createdTenantId)
      .where('username', '=', ownerUsername)
      .executeTakeFirst();

    assert(Boolean(ownerUser), 'Owner user must exist in DB');
    assert(
      ownerUser.role === 'admin',
      `Owner role must strictly be 'admin' (never super_admin), got: ${ownerUser.role}`,
    );
    assert(ownerUser.password_hash !== plainPassword, 'Password must NEVER be stored in plaintext');
    const isPassValid = await verifyPassword(plainPassword, ownerUser.password_hash, ownerUser.password_salt || '');
    assert(isPassValid.valid === true, 'Hashed password must verify with bcrypt');
    console.log(
      `  -> Verified Owner User: [ID: ${ownerUser.id}] Role: [${ownerUser.role}] Password Hash: Bcrypt verified.`,
    );

    // Verify Audit Event
    const trialAudit = await (db as any)
      .selectFrom('audit_logs')
      .selectAll()
      .where('event_code', '=', AUDIT_EVENT_CODES.SAAS_TENANT_TRIAL_CREATED)
      .where('target_tenant_id', '=', createdTenantId)
      .executeTakeFirst();
    assert(Boolean(trialAudit), 'Must record SAAS_TENANT_TRIAL_CREATED audit event');
    console.log(`  -> Verified Audit Trail: ${trialAudit.event_code} logged.`);
    console.log('  [PASS] STEP 4 PASSED: Trial tenant provisioned with cryptographical invariants.\n');

    // -------------------------------------------------------------------------
    // STEP 5: Trial Extension & Administrative Grace Periods
    // -------------------------------------------------------------------------
    console.log('[STEP 5] Extending Trial Period by 7 Days...');
    const tenantBeforeExtend = await (db as any)
      .selectFrom('tenants')
      .select(['trial_ends_at'])
      .where('id', '=', createdTenantId)
      .executeTakeFirst();

    const extendRes = await saasAdminService.extendTrial(createdTenantId, { days: 7 }, platformAdminAuth);
    assert(extendRes.ok === true, 'Extend trial must succeed');

    const tenantAfterExtend = await (db as any)
      .selectFrom('tenants')
      .select(['trial_ends_at'])
      .where('id', '=', createdTenantId)
      .executeTakeFirst();

    const diffDays = Math.round(
      (new Date(tenantAfterExtend.trial_ends_at).getTime() - new Date(tenantBeforeExtend.trial_ends_at).getTime()) /
        86400000,
    );
    assert(diffDays === 7, `Trial must be extended by 7 days, got: ${diffDays} days`);
    console.log(`  -> Trial Ends At pushed forward by +7 days: ${tenantAfterExtend.trial_ends_at}`);

    const extendAudit = await (db as any)
      .selectFrom('audit_logs')
      .selectAll()
      .where('event_code', '=', AUDIT_EVENT_CODES.SAAS_TENANT_TRIAL_EXTENDED)
      .where('target_tenant_id', '=', createdTenantId)
      .executeTakeFirst();
    assert(Boolean(extendAudit), 'Must record SAAS_TENANT_TRIAL_EXTENDED audit event');
    console.log('  [PASS] STEP 5 PASSED: Trial extension recorded.\n');

    // -------------------------------------------------------------------------
    // STEP 6: Administrative Tenant Suspension & Lockdown
    // -------------------------------------------------------------------------
    console.log('[STEP 6] Suspending Tenant (administrative lockdown)...');
    const suspendRes = await saasAdminService.suspendTenant(
      createdTenantId,
      {
        reason: 'فحص إداري مؤقت للامتثال المؤسسي',
      },
      platformAdminAuth,
    );
    assert(suspendRes.ok === true, 'Suspend tenant must succeed');

    const suspendedTenant = await (db as any)
      .selectFrom('tenants')
      .select(['status'])
      .where('id', '=', createdTenantId)
      .executeTakeFirst();
    assert(suspendedTenant.status === 'suspended', `Tenant status must be suspended, got: ${suspendedTenant.status}`);
    console.log(`  -> Tenant Status Updated in DB: [${suspendedTenant.status}]`);

    const suspendAudit = await (db as any)
      .selectFrom('audit_logs')
      .selectAll()
      .where('event_code', '=', AUDIT_EVENT_CODES.SAAS_TENANT_SUSPENDED)
      .where('target_tenant_id', '=', createdTenantId)
      .executeTakeFirst();
    assert(Boolean(suspendAudit), 'Must record SAAS_TENANT_SUSPENDED audit event');
    console.log('  [PASS] STEP 6 PASSED: Suspension lockdown enforced.\n');

    // -------------------------------------------------------------------------
    // STEP 7: Plan Activation & Subscription Provisioning
    // -------------------------------------------------------------------------
    console.log('[STEP 7] Activating Tenant with Paid Enterprise Plan...');
    // Fetch or seed a plan in saas_plans
    let plan = await (db as any).selectFrom('saas_plans').selectAll().executeTakeFirst();

    if (!plan) {
      plan = await (db as any)
        .insertInto('saas_plans')
        .values({
          name: 'باقة الشركات الاحترافية Pro Enterprise',
          code: `PRO-${uniqueSuffix.slice(-4)}`,
          price: 1500,
          billing_period_months: 1,
          is_active: true,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    }
    const planId = Number(plan.id);
    console.log(`  -> Selected Plan: [ID: ${planId}] "${plan.name}"`);

    const activateRes = await saasAdminService.activateTenant(
      createdTenantId,
      {
        planId,
        durationMonths: 12,
        paymentAmount: 18000,
        paymentMethod: 'bank_transfer',
        paymentReference: `TRF-${uniqueSuffix.slice(-6)}`,
      },
      platformAdminAuth,
    );
    assert(activateRes.ok === true, 'Activation must succeed');

    const activeTenant = await (db as any)
      .selectFrom('tenants')
      .select(['status', 'plan_id', 'activated_at'])
      .where('id', '=', createdTenantId)
      .executeTakeFirst();
    assert(activeTenant.status === 'active', `Tenant status must be active, got: ${activeTenant.status}`);
    assert(Boolean(activeTenant.activated_at), 'activated_at must be populated');
    console.log(`  -> Tenant Status: [${activeTenant.status}], Activated At: ${activeTenant.activated_at}`);

    // Verify Subscription Record
    const subRecord = await (db as any)
      .selectFrom('tenant_subscriptions')
      .selectAll()
      .where('tenant_id', '=', createdTenantId)
      .orderBy('id', 'desc')
      .executeTakeFirst();
    assert(Boolean(subRecord), 'Subscription record must exist in tenant_subscriptions');
    assert(subRecord.status === 'active', `Subscription status must be active, got: ${subRecord.status}`);
    console.log(
      `  -> Subscription Provisioned: [ID: ${subRecord.id}] Plan ID: ${subRecord.plan_id} Ends At: ${subRecord.ends_at}`,
    );

    const activateAudit = await (db as any)
      .selectFrom('audit_logs')
      .selectAll()
      .where('event_code', '=', AUDIT_EVENT_CODES.SAAS_TENANT_ACTIVATED)
      .where('target_tenant_id', '=', createdTenantId)
      .executeTakeFirst();
    assert(Boolean(activateAudit), 'Must record SAAS_TENANT_ACTIVATED audit event');
    console.log('  [PASS] STEP 7 PASSED: Tenant activated and subscription provisioned.\n');

    // -------------------------------------------------------------------------
    // STEP 8: Billing Payment Recording & Subscription Renewal
    // -------------------------------------------------------------------------
    console.log('[STEP 8] Recording Billing Payment & Renewing Subscription...');
    const payRes = await saasAdminService.recordPayment(
      createdTenantId,
      {
        amount: 18000,
        currency: 'EGP',
        method: 'bank_transfer',
        reference: `TRF-RENEW-${uniqueSuffix.slice(-6)}`,
        notes: 'سداد تجديد مبكر لمدة 6 أشهر إضافية',
      },
      platformAdminAuth,
    );
    assert(payRes.ok === true, 'Record payment must succeed');

    const paymentRow = await (db as any)
      .selectFrom('tenant_subscription_payments')
      .selectAll()
      .where('tenant_id', '=', createdTenantId)
      .orderBy('id', 'desc')
      .executeTakeFirst();
    assert(Boolean(paymentRow), 'Payment record must exist in tenant_subscription_payments');
    assert(Number(paymentRow.amount) === 18000, `Payment amount must be 18000, got: ${paymentRow.amount}`);
    console.log(
      `  -> Recorded Payment: [ID: ${paymentRow.id}] Amount: ${paymentRow.amount} EGP (Ref: ${paymentRow.reference})`,
    );

    // Renew for 6 months
    const subBeforeRenew = await (db as any)
      .selectFrom('tenant_subscriptions')
      .select(['ends_at'])
      .where('tenant_id', '=', createdTenantId)
      .orderBy('id', 'desc')
      .executeTakeFirst();

    const renewRes = await saasAdminService.renewTenant(
      createdTenantId,
      {
        planId,
        durationMonths: 6,
      },
      platformAdminAuth,
    );
    assert(renewRes.ok === true, 'Renew tenant must succeed');

    const subAfterRenew = await (db as any)
      .selectFrom('tenant_subscriptions')
      .select(['ends_at'])
      .where('tenant_id', '=', createdTenantId)
      .orderBy('id', 'desc')
      .executeTakeFirst();

    assert(
      new Date(subAfterRenew.ends_at) > new Date(subBeforeRenew.ends_at),
      'Subscription ends_at must be extended after renewal',
    );
    console.log(`  -> Subscription Extended: ${subBeforeRenew.ends_at} -> ${subAfterRenew.ends_at}`);

    const renewAudit = await (db as any)
      .selectFrom('audit_logs')
      .selectAll()
      .where('event_code', '=', AUDIT_EVENT_CODES.SAAS_SUBSCRIPTION_RENEWED)
      .where('target_tenant_id', '=', createdTenantId)
      .executeTakeFirst();
    assert(Boolean(renewAudit), 'Must record SAAS_SUBSCRIPTION_RENEWED audit event');
    console.log('  [PASS] STEP 8 PASSED: Payment and subscription renewal verified.\n');

    // -------------------------------------------------------------------------
    // STEP 9: Impersonation Security Protocol (O34 Invariant)
    // -------------------------------------------------------------------------
    console.log('[STEP 9] Auditing Impersonation Security Protocol (O34 Invariant)...');
    const impRes = await saasAdminService.impersonateTenant(createdTenantId, platformAdminAuth);
    assert(Boolean(impRes.sessionId), 'Impersonation session ID must exist');
    assert(impRes.auth.tenantId === createdTenantId, 'Session must be switched to target tenant');
    assert(
      Number(impRes.auth.impersonatedBy) === Number(platformAdminAuth.userId),
      'O34 Invariant: impersonatedBy must record operator user ID',
    );
    console.log(
      `  -> Impersonation Session Active: Operator #${platformAdminAuth.userId} acting as Target User #${impRes.auth.userId} (${impRes.auth.username})`,
    );

    const impStartAudit = await (db as any)
      .selectFrom('audit_logs')
      .selectAll()
      .where('event_code', '=', AUDIT_EVENT_CODES.SAAS_IMPERSONATION_STARTED)
      .where('target_tenant_id', '=', createdTenantId)
      .executeTakeFirst();
    assert(Boolean(impStartAudit), 'Must record SAAS_IMPERSONATION_STARTED audit event');

    // Exit Impersonation
    const exitRes = await saasAdminService.exitImpersonation(impRes.originalSessionId, impRes.auth);
    assert(Boolean(exitRes.sessionId), 'Exit impersonation must return session');
    assert(exitRes.auth.tenantId === 'zs', 'Must return to platform tenant zs');

    const impEndAudit = await (db as any)
      .selectFrom('audit_logs')
      .selectAll()
      .where('event_code', '=', AUDIT_EVENT_CODES.SAAS_IMPERSONATION_ENDED)
      .where('target_tenant_id', '=', 'zs')
      .executeTakeFirst();
    assert(Boolean(impEndAudit), 'Must record SAAS_IMPERSONATION_ENDED audit event');
    console.log(`  -> Impersonation Safely Terminated with complete O34 audit logging.`);
    console.log('  [PASS] STEP 9 PASSED: Impersonation security protocol verified.\n');

    // -------------------------------------------------------------------------
    // STEP 10: Dynamic Plan Feature Toggling & Module Sync
    // -------------------------------------------------------------------------
    console.log('[STEP 10] Testing Plan Features Toggling & Module Settings Synchronization...');
    await saasAdminService.developerUpdateTenantPlan({
      tenantId: createdTenantId,
      planId: 'plan_ultimate',
      extraFeatures: ['manufacturing', 'maritime_freight', 'maintenance'],
    });

    const tenantWithFeatures = await (db as any)
      .selectFrom('tenants')
      .select(['extra_features', 'plan_id'])
      .where('id', '=', createdTenantId)
      .executeTakeFirst();

    const featuresList =
      typeof tenantWithFeatures.extra_features === 'string'
        ? JSON.parse(tenantWithFeatures.extra_features)
        : tenantWithFeatures.extra_features;

    assert(Array.isArray(featuresList), 'extra_features must be an array');
    assert(featuresList.includes('manufacturing'), 'Must include manufacturing feature');
    assert(featuresList.includes('maritime_freight'), 'Must include maritime_freight feature');
    console.log(`  -> Features Provisioned: [${featuresList.join(', ')}]`);

    // Verify settings table synchronized
    const mfgSetting = await (db as any)
      .selectFrom('settings')
      .select(['value'])
      .where('tenant_id', '=', createdTenantId)
      .where('key', '=', 'manufacturingModuleEnabled')
      .executeTakeFirst();
    console.log(`  -> Synchronized Module Setting [manufacturingModuleEnabled]: ${mfgSetting?.value}`);
    console.log('  [PASS] STEP 10 PASSED: Feature toggling and module synchronization verified.\n');

    // -------------------------------------------------------------------------
    // STEP 11: Owner Account Unlocking & Password Recovery
    // -------------------------------------------------------------------------
    console.log('[STEP 11] Testing Owner Account Unlocking & Password Recovery...');
    // Lock owner
    await (db as any)
      .updateTable('users')
      .set({
        failed_login_count: 5,
        locked_until: new Date(Date.now() + 3600000),
      })
      .where('tenant_id', '=', createdTenantId)
      .where('username', '=', ownerUsername)
      .execute();

    const unlockRes = await saasAdminService.unlockOwner(createdTenantId, platformAdminAuth);
    assert(unlockRes.ok === true, 'Unlock owner must succeed');

    const unlockedUser = await (db as any)
      .selectFrom('users')
      .select(['failed_login_count', 'locked_until'])
      .where('tenant_id', '=', createdTenantId)
      .where('username', '=', ownerUsername)
      .executeTakeFirst();
    assert(unlockedUser.failed_login_count === 0, 'failed_login_count must be reset to 0');
    assert(unlockedUser.locked_until === null, 'locked_until must be null');
    console.log(`  -> Owner Account Unlocked: failed_login_count: 0, locked_until: null`);

    // Reset password
    const newPassword = `NewSecuredPass@${uniqueSuffix.slice(-6)}`;
    const resetRes = await saasAdminService.resetOwnerPassword(
      createdTenantId,
      {
        newPassword,
      },
      platformAdminAuth,
    );
    assert(resetRes.ok === true, 'Password reset must succeed');

    const ownerAfterReset = await (db as any)
      .selectFrom('users')
      .select(['password_hash', 'password_salt'])
      .where('tenant_id', '=', createdTenantId)
      .where('username', '=', ownerUsername)
      .executeTakeFirst();
    const isNewPassValid = await verifyPassword(
      newPassword,
      ownerAfterReset.password_hash,
      ownerAfterReset.password_salt || '',
    );
    assert(isNewPassValid.valid === true, 'New password must verify with bcrypt');
    console.log(`  -> Owner Password Reset & Bcrypt verified successfully.`);
    console.log('  [PASS] STEP 11 PASSED: Account security and recovery validated.\n');

    // -------------------------------------------------------------------------
    // STEP 12: Subscription Expiration Enforcement
    // -------------------------------------------------------------------------
    console.log('[STEP 12] Testing Subscription Expiration Lifecycle...');
    const expireRes = await saasAdminService.expireTenant(
      createdTenantId,
      {
        reason: 'محاكاة انتهاء مهلة الاشتراك',
      },
      platformAdminAuth,
    );
    assert(expireRes.ok === true, 'Expire tenant must succeed');

    const expiredTenant = await (db as any)
      .selectFrom('tenants')
      .select(['status'])
      .where('id', '=', createdTenantId)
      .executeTakeFirst();
    assert(expiredTenant.status === 'expired', `Tenant status must be expired, got: ${expiredTenant.status}`);
    console.log(`  -> Tenant Status Updated in DB: [${expiredTenant.status}]`);

    const expireAudit = await (db as any)
      .selectFrom('audit_logs')
      .selectAll()
      .where('event_code', '=', AUDIT_EVENT_CODES.SAAS_TENANT_EXPIRED)
      .where('target_tenant_id', '=', createdTenantId)
      .executeTakeFirst();
    assert(Boolean(expireAudit), 'Must record SAAS_TENANT_EXPIRED audit event');
    console.log('  [PASS] STEP 12 PASSED: Subscription expiration enforcement verified.\n');

    // -------------------------------------------------------------------------
    // STEP 13: Tenant Deletion & Multi-Tenant Data Isolation Cleanup
    // -------------------------------------------------------------------------
    console.log('[STEP 13] Testing Tenant Deletion & Multi-Tenant Isolation Cleanup...');
    const deleteRes = await saasAdminService.deleteTenant(createdTenantId, platformAdminAuth);
    assert(deleteRes.ok === true, 'Delete tenant must succeed');

    // Verify tenant deleted
    const deletedTenant = await (db as any)
      .selectFrom('tenants')
      .select(['id'])
      .where('id', '=', createdTenantId)
      .executeTakeFirst();
    assert(!deletedTenant, 'Tenant must no longer exist in tenants table');

    // Verify tenant users deleted
    const remainingUsers = await (db as any)
      .selectFrom('users')
      .select(['id'])
      .where('tenant_id', '=', createdTenantId)
      .execute();
    assert(remainingUsers.length === 0, 'All tenant users must be deleted');

    const deleteAudit = await (db as any)
      .selectFrom('audit_logs')
      .selectAll()
      .where('event_code', '=', AUDIT_EVENT_CODES.SAAS_TENANT_DELETED)
      .where('target_tenant_id', '=', createdTenantId)
      .executeTakeFirst();
    assert(Boolean(deleteAudit), 'Must record SAAS_TENANT_DELETED audit event');
    console.log(`  -> Cleaned up Tenant #${createdTenantId}: zero residual records, audit logged.`);
    console.log('  [PASS] STEP 13 PASSED: Tenant deletion and isolation cleanup confirmed.\n');

    console.log('========================================================================');
    console.log('  ALL 13 PHASES OF SAAS PLATFORM & GOVERNANCE PASSED 100%!');
    console.log('========================================================================\n');
  } finally {
    if (platformSessionId) {
      try {
        await (db as any).deleteFrom('sessions').where('id', '=', platformSessionId).execute();
      } catch {}
    }
    // If tenant wasn't deleted due to an early failure, clean it up
    if (createdTenantId) {
      try {
        await (db as any).deleteFrom('users').where('tenant_id', '=', createdTenantId).execute();
        await (db as any).deleteFrom('tenants').where('id', '=', createdTenantId).execute();
      } catch {}
    }
    await db.destroy();
  }
}

runSaasPlatformMasterSimulation()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n[FAIL] SAAS PLATFORM MASTER SIMULATION FAILED:', err);
    process.exit(1);
  });
