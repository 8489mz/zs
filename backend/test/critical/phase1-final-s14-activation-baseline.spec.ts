import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Database } from '../../src/database/database.types';
import { ActivationService } from '../../src/modules/activation/activation.service';
import { getMachineFingerprint } from '../../src/modules/activation/utils/machine-fingerprint';
import { formatBranchStockLocationName } from '../../src/common/utils/branch-stock.util';

/*
 * Phase 1 final-inspection slice 14 — baseline spec for the
 * activation module (one of the 5 modules still unverified on
 * 56bb6d4).
 *
 * GROUNDING (live code, read before writing):
 * - ActivationService (activation/activation.service.ts) is
 *   Kysely-DB-backed (settings + users + branches +
 *   stock_locations + user_branches + tenants; columns mirrored
 *   from the service's own writes). getStatus short-circuits in
 *   CLOUD_SAAS mode (activated, no DB read) and otherwise reads
 *   the live machine fingerprint (machine-fingerprint.ts: Linux
 *   reads /etc/machine-id + DMI ids) plus the stored
 *   'activation.license' setting and the user count.
 *   activationEnforced is true only in desktop mode with
 *   ACTIVATION_ENFORCED=true. activate() verifies the RSA-SHA256
 *   license code (verifyCode) against ACTIVATION_PUBLIC_KEY and
 *   the live machine fingerprint, then stores the license record.
 *   initialize() creates the first admin user + the primary branch
 *   + its stock location + the seed settings in one transaction,
 *   and refuses a second initialization. assertLoginAllowed()
 *   blocks login while activation is required but missing.
 * - The license in this spec is signed in-spec with a fresh RSA
 *   keypair generated here: the public key is handed to the
 *   service through the ConfigService stub, the payload carries
 *   this machine's live fingerprint. No fixture key is committed;
 *   the signature path is the production verifyCode, not a copy.
 * - apps-store-plan-compatibility.spec.ts does NOT import
 *   activation code (it drives SettingsService/SaasAdminService
 *   plan switches) — it is NOT activation evidence and stays
 *   unlinked (recorded remaining).
 *
 * WHAT THIS PROVES (real service on PGlite, no mocks except the
 * ConfigService value map):
 * - Cloud mode: status activated without a DB read; activate and
 *   initialize both forbidden.
 * - Desktop unenforced: status activated, setup required with 0
 *   users, live machine id reported; activate answers ok.
 * - Initialize: creates exactly 1 admin user + 1 branch + 1 stock
 *   location + the seed settings; a second initialize is
 *   forbidden; status then reports setup no longer required.
 * - Enforced mode: login blocked with no license; a tampered
 *   signature rejects BadRequest; a code for another machine
 *   rejects Forbidden; a valid self-signed code activates, stores
 *   the license with the live machine id, and unblocks login.
 */

const TENANT = 'local-tenant';

function signLicense(payload: Record<string, unknown>, privateKey: KeyObject): string {
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(payloadBase64);
  sign.end();
  return `${payloadBase64}.${sign.sign(privateKey).toString('base64url')}`;
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const prevTenantId = process.env.TENANT_ID;
  const prevAccountId = process.env.ACCOUNT_ID;
  process.env.TENANT_ID = TENANT;
  process.env.ACCOUNT_ID = TENANT;
  try {
    await pg.exec(`
      CREATE TABLE tenants (
        id text PRIMARY KEY,
        slug text,
        business_name text,
        owner_name text,
        owner_phone text,
        owner_email text,
        status text,
        plan_id text,
        extra_features text,
        activity_type text,
        country_code text,
        trial_starts_at timestamptz,
        trial_ends_at timestamptz,
        activated_at timestamptz,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE settings (
        key text NOT NULL,
        value text,
        tenant_id text NOT NULL,
        account_id text NOT NULL,
        PRIMARY KEY (tenant_id, key)
      );
      CREATE TABLE users (
        id bigserial PRIMARY KEY,
        tenant_id text,
        account_id text,
        username text,
        password_hash text,
        password_salt text,
        role text,
        is_active boolean DEFAULT true,
        permissions_json text,
        default_branch_id bigint,
        display_name text,
        failed_login_count int DEFAULT 0,
        locked_until timestamptz,
        last_login_at timestamptz,
        must_change_password boolean DEFAULT false
      );
      CREATE TABLE branches (
        id bigserial PRIMARY KEY,
        tenant_id text NOT NULL,
        account_id text NOT NULL,
        name text NOT NULL,
        code text,
        sales_stock_mode text,
        allow_external_sales_stock boolean DEFAULT false,
        is_active boolean DEFAULT true,
        default_stock_location_id bigint,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE stock_locations (
        id bigserial PRIMARY KEY,
        tenant_id text,
        account_id text,
        branch_id bigint,
        name text,
        code text,
        location_type text,
        is_active boolean DEFAULT true
      );
      CREATE TABLE user_branches (
        user_id bigint NOT NULL,
        branch_id bigint NOT NULL,
        tenant_id text,
        account_id text,
        PRIMARY KEY (user_id, branch_id)
      );
    `);

    await (db as any)
      .insertInto('tenants')
      .values({
        id: TENANT,
        slug: TENANT,
        business_name: 'Local',
        status: 'active',
        activity_type: 'retail_general',
      })
      .execute();

    const fingerprint = getMachineFingerprint();
    assert.ok(fingerprint.machineId.length > 0, 'the live machine fingerprint must have an id');

    const config: Record<string, unknown> = {
      LICENSE_MODE: 'desktop',
      APP_MODE: '',
      ACTIVATION_ENFORCED: false,
      ACTIVATION_PUBLIC_KEY: '',
      TENANT_ID: TENANT,
      ACCOUNT_ID: TENANT,
    };
    const configService = { get: (key: string) => config[key] } as unknown as ConfigService;

    // 1) Cloud mode: activated without a DB read; activate + initialize forbidden.
    {
      const cloudConfig: Record<string, unknown> = { ...config, APP_MODE: 'CLOUD_SAAS' };
      const cloudService = new ActivationService(db, {
        get: (key: string) => cloudConfig[key],
      } as unknown as ConfigService);
      const status = await cloudService.getStatus();
      assert.equal(status.activationRequired, false, 'cloud status must not require activation');
      assert.equal(status.activated, true, 'cloud status must report activated');
      assert.equal(status.setupRequired, false, 'cloud status must not require setup');
      assert.equal(status.machineId, null, 'cloud status must not expose a machine id');
      await assert.rejects(
        () => cloudService.activate({ activationCode: 'x.y' } as any),
        ForbiddenException,
        'cloud activate must be forbidden',
      );
      await assert.rejects(
        () =>
          cloudService.initialize({
            storeName: 'x',
            branchName: 'x',
            locationName: 'x',
            adminDisplayName: 'x',
            adminUsername: 'x',
            adminPassword: 'Str0ng!AdminPass123',
          } as any),
        ForbiddenException,
        'cloud initialize must be forbidden',
      );
      console.log('  cloud mode passed');
    }

    const service = new ActivationService(db, configService);

    // 2) Desktop unenforced: activated, setup required with 0 users, live machine id.
    {
      const status = await service.getStatus();
      assert.equal(status.deploymentMode, 'desktop', 'desktop status must report desktop mode');
      assert.equal(status.activationRequired, false, 'unenforced status must not require activation');
      assert.equal(status.activated, true, 'unenforced status must report activated');
      assert.equal(status.setupRequired, true, 'unenforced status must require setup with 0 users');
      assert.equal(status.machineId, fingerprint.machineId, 'status must report the live machine id');
      const activated = await service.activate({ activationCode: 'unused-when-unenforced' } as any);
      assert.equal(activated.ok, true, 'unenforced activate must answer ok');
      console.log('  desktop unenforced status passed');
    }

    // 3) Initialize: first admin + branch + location + seed settings, once only.
    {
      const res = await service.initialize({
        storeName: 'متجر الاختبار',
        branchName: 'الفرع الرئيسي',
        locationName: 'المستودع الرئيسي',
        adminDisplayName: 'Owner',
        adminUsername: 'owner',
        adminPassword: 'Str0ng!AdminPass123',
        uiLanguage: 'ar',
      } as any);
      assert.equal(res.ok, true, 'initialize must answer ok');
      const users = await (db as any).selectFrom('users').selectAll().execute();
      assert.equal(users.length, 1, 'initialize must create exactly 1 user');
      assert.equal(users[0].username, 'owner', 'the created user must be the admin username');
      assert.equal(users[0].role, 'admin', 'the first portable user must be an admin');
      assert.equal(users[0].is_active, true, 'the created user must be active');
      assert.doesNotThrow(
        () => JSON.parse(users[0].permissions_json),
        'the created user permissions must be valid JSON',
      );
      const branches = await (db as any).selectFrom('branches').selectAll().execute();
      assert.equal(branches.length, 1, 'initialize must create exactly 1 branch');
      assert.equal(branches[0].name, 'الفرع الرئيسي', 'the branch name must be the DTO name');
      const locations = await (db as any).selectFrom('stock_locations').selectAll().execute();
      assert.equal(locations.length, 1, 'initialize must create exactly 1 stock location');
      assert.equal(
        locations[0].name,
        formatBranchStockLocationName('الفرع الرئيسي'),
        'the location name must be the production branch-location name',
      );
      assert.equal(locations[0].branch_id, Number(branches[0].id), 'the location must belong to the branch');
      const branchSetting = await (db as any)
        .selectFrom('settings')
        .select('value')
        .where('key', '=', 'activation.primaryBranchId')
        .executeTakeFirst();
      assert.equal(branchSetting.value, String(branches[0].id), 'the primary branch id must be stored');
      const currency = await (db as any)
        .selectFrom('settings')
        .select('value')
        .where('key', '=', 'currency')
        .executeTakeFirst();
      assert.equal(currency.value, '"EGP"', 'the seed currency must be EGP');
      const after = await service.getStatus();
      assert.equal(after.setupRequired, false, 'setup must no longer be required after initialize');
      await assert.rejects(
        () =>
          service.initialize({
            storeName: 'x',
            branchName: 'x',
            locationName: 'x',
            adminDisplayName: 'x',
            adminUsername: 'x2',
            adminPassword: 'Str0ng!AdminPass123',
          } as any),
        ForbiddenException,
        'a second initialize must be forbidden',
      );
      console.log('  initialize passed');
    }

    // 4) Enforced mode: login blocked with no license; bad code rejected; valid code activates.
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    config.ACTIVATION_ENFORCED = true;
    config.ACTIVATION_PUBLIC_KEY = publicPem;
    const enforced = new ActivationService(db, configService);
    {
      await assert.rejects(
        () => enforced.assertLoginAllowed(),
        UnauthorizedException,
        'login must be blocked while activation is required and missing',
      );
      const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
      const tampered = signLicense(
        {
          machineId: fingerprint.machineId,
          machineHash: fingerprint.fingerprintHash,
          customerName: 'عميل الاختبار',
          issuedAt: new Date().toISOString(),
          expiresAt: null,
          mode: 'desktop',
        },
        otherKey,
      );
      await assert.rejects(
        () => enforced.activate({ activationCode: tampered } as any),
        BadRequestException,
        'a code with a bad signature must reject BadRequest',
      );
      const wrongMachine = signLicense(
        {
          machineId: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX',
          machineHash: fingerprint.fingerprintHash,
          customerName: 'عميل الاختبار',
          issuedAt: new Date().toISOString(),
          expiresAt: null,
          mode: 'desktop',
        },
        privateKey,
      );
      await assert.rejects(
        () => enforced.activate({ activationCode: wrongMachine } as any),
        ForbiddenException,
        'a code for another machine must reject Forbidden',
      );
      await assert.rejects(
        () => enforced.activate({ activationCode: 'not-a-code' } as any),
        BadRequestException,
        'a malformed code must reject BadRequest',
      );
      const valid = signLicense(
        {
          machineId: fingerprint.machineId,
          machineHash: fingerprint.fingerprintHash,
          customerName: 'عميل الاختبار',
          issuedAt: new Date().toISOString(),
          expiresAt: null,
          mode: 'desktop',
        },
        privateKey,
      );
      const res = await enforced.activate({ activationCode: valid } as any);
      assert.equal(res.ok, true, 'a valid code must activate');
      assert.equal(res.activated, true, 'the status after activation must report activated');
      assert.equal(res.customerName, 'عميل الاختبار', 'the status must carry the licensed customer name');
      assert.equal(res.activationRequired, true, 'the status must still report enforcement on');
      const stored = await (db as any)
        .selectFrom('settings')
        .select('value')
        .where('key', '=', 'activation.license')
        .executeTakeFirst();
      const record = JSON.parse(stored.value);
      assert.equal(record.machineId, fingerprint.machineId, 'the stored license must carry the live machine id');
      assert.equal(record.customerName, 'عميل الاختبار', 'the stored license must carry the customer name');
      assert.equal(record.mode, 'desktop', 'the stored license must carry desktop mode');
      await enforced.assertLoginAllowed();
      const after = await enforced.getStatus();
      assert.equal(after.activated, true, 'the status must stay activated after the license is stored');
      console.log('  enforced license activation passed');
    }
  } finally {
    if (prevTenantId === undefined) delete process.env.TENANT_ID;
    else process.env.TENANT_ID = prevTenantId;
    if (prevAccountId === undefined) delete process.env.ACCOUNT_ID;
    else process.env.ACCOUNT_ID = prevAccountId;
    await db.destroy();
  }
  console.log('phase1 final slice 14 activation baseline passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
