/*
 * INV-DEVELOPER-MASTER-PASSWORD: the developer panel (desktop mode
 * only) guards plan/package changes with a SEPARATE master password
 * that is never the super_admin login password. The fixed desktop
 * fallback password ('infoadmin') was removed by owner decision
 * (2026-11-04) and must be rejected even in desktop mode. The master
 * password is set or changed ONLY by the platform super_admin through
 * POST /api/developer/master-password (SessionAuthGuard +
 * SuperAdminRoleGuard), stored as a bcrypt hash in the settings table
 * under key 'developerMasterPasswordHash' for the installation's own
 * (first-created) tenant. Until a hash exists, the
 * DEVELOPER_MASTER_PASSWORD env value is accepted as a transition;
 * once a hash is set, the env value alone never authenticates, and an
 * unset env value with no hash disables the panel. The generic
 * settings save path can never write the hash key.
 *
 * DELEGATED CHOICES, flagged for reversal: (1) the env fallback keeps
 * its old floor (any non-empty value) so existing operator setups keep
 * working until a hash is set; only the super_admin-set password
 * enforces the 12-character admin floor; (2) the hash is scoped to the
 * first-created tenant, matching the default tenant the panel edits,
 * and the tenantId in an update-plan body never re-scopes the secret;
 * (3) no current-password check on rotation — the authenticated
 * super_admin may always reset it, that is the point of the endpoint.
 *
 * WHAT THIS PINS, driving the REAL controller and the REAL
 * SaasAdminService hash methods on PGlite: fixed password rejected in
 * desktop mode; env secret accepted before any hash exists; hash
 * stored bcrypt (never plaintext); hash wins over env after it is
 * set; rotation replaces the secret; 11-char set rejected, 12-char
 * accepted (DTO + service path); guard metadata on the setter;
 * generic settings save cannot plant the hash key; unset env + no
 * hash disables the panel (Forbidden).
 *
 * Deliberately NOT driven here: the live guard runtime (Nest
 * execution of SessionAuthGuard/SuperAdminRoleGuard) — pinned by
 * metadata, the same pattern as the password-reset route-shape spec;
 * the frontend setter UI in DeveloperActivationPanel (no frontend
 * tooling in this VM); rotation audit logging (no audit row is
 * asserted — the endpoint writes none today).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Database } from '../../src/database/database.types';
import { DeveloperController } from '../../src/modules/saas-admin/developer.controller';
import {
  DEVELOPER_MASTER_PASSWORD_HASH_KEY,
  SaasAdminService,
} from '../../src/modules/saas-admin/saas-admin.service';
import { SetDeveloperMasterPasswordDto } from '../../src/modules/saas-admin/dto/developer-update-plan.dto';
import { SessionAuthGuard } from '../../src/core/auth/guards/session-auth.guard';
import { SuperAdminRoleGuard } from '../../src/core/auth/guards/super-admin-role.guard';
import { SettingsService } from '../../src/modules/settings/settings.service';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 'default';
const ACCOUNT = 'default';

function superAdminAuth(): AuthContext {
  return {
    userId: 1,
    sessionId: 'sess-spec',
    username: 'root',
    role: 'super_admin',
    permissions: [],
    tenantId: TENANT,
    accountId: ACCOUNT,
  } as unknown as AuthContext;
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY, slug text, business_name text, owner_name text, owner_phone text, owner_email text, status text, plan_id text, extra_features text, activity_type text, country_code text, created_at timestamptz DEFAULT now());
      CREATE TABLE settings (key text NOT NULL, value text, tenant_id text NOT NULL, account_id text NOT NULL, PRIMARY KEY (tenant_id, key));
      CREATE TABLE users (id bigserial PRIMARY KEY, tenant_id text, account_id text, username text, role text, is_active boolean DEFAULT true, password_hash text, password_salt text);
    `);
    await anyDb
      .insertInto('tenants')
      .values({ id: TENANT, slug: TENANT, business_name: 'Z-Systems', status: 'active', created_at: new Date('2026-01-01T00:00:00Z') })
      .execute();
    await anyDb
      .insertInto('tenants')
      .values({ id: 'second', slug: 'second', business_name: 'Second', status: 'active', created_at: new Date('2026-02-01T00:00:00Z') })
      .execute();

    const service = new SaasAdminService(
      db,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const envConfig = (envValue: string) => ({
      get: (key: string) => {
        if (key === 'APP_MODE' || key === 'app.mode') return 'SELF_CONTAINED';
        if (key === 'DEVELOPER_MASTER_PASSWORD') return envValue;
        return undefined;
      },
    });
    const controller = new DeveloperController(service as never, envConfig('EnvSecret123!') as never);

    // 1. No hash exists yet: fixed password rejected, env secret works.
    await assert.rejects(
      () => controller.updatePlan({ masterPassword: 'infoadmin' }),
      UnauthorizedException,
      'the removed fixed password must be rejected even in desktop mode',
    );
    await assert.rejects(
      () => controller.updatePlan({ masterPassword: 'wrong-password' }),
      UnauthorizedException,
    );
    const before = await controller.updatePlan({ masterPassword: 'EnvSecret123!' });
    assert.equal((before as { ok?: boolean }).ok, true, 'env secret must work until a hash is set');

    // 2. Super_admin sets the master password: bcrypt hash stored, never plaintext.
    const setResult = await controller.setMasterPassword(
      { newMasterPassword: 'SuperSecret123!' },
      { authContext: superAdminAuth() } as never,
    );
    assert.equal((setResult as { ok?: boolean }).ok, true);
    const storedHash = await service.getDeveloperMasterPasswordHash();
    assert.ok(storedHash, 'a hash must be stored after setting');
    assert.match(storedHash!, /^\$2[aby]\$/, 'stored value must be a bcrypt hash');
    assert.ok(!storedHash!.includes('SuperSecret123!'), 'plaintext must never be stored');
    const hashRow = await anyDb
      .selectFrom('settings')
      .selectAll()
      .where('key', '=', DEVELOPER_MASTER_PASSWORD_HASH_KEY)
      .executeTakeFirst();
    assert.equal(hashRow?.tenant_id, TENANT, 'hash is scoped to the first-created tenant');
    assert.ok(!hashRow?.value?.includes('SuperSecret123!'));

    // 3. Hash wins: env secret no longer authenticates, hash secret does.
    await assert.rejects(
      () => controller.updatePlan({ masterPassword: 'EnvSecret123!' }),
      UnauthorizedException,
      'once a hash is set, the env value alone must never authenticate',
    );
    await assert.rejects(
      () => controller.updatePlan({ masterPassword: 'infoadmin' }),
      UnauthorizedException,
    );
    const after = await controller.updatePlan({ masterPassword: 'SuperSecret123!' });
    assert.equal((after as { ok?: boolean }).ok, true);

    // 4. Rotation replaces the secret; the old one stops working.
    await controller.setMasterPassword(
      { newMasterPassword: 'RotatedSecret99!' },
      { authContext: superAdminAuth() } as never,
    );
    await assert.rejects(
      () => controller.updatePlan({ masterPassword: 'SuperSecret123!' }),
      UnauthorizedException,
    );
    const rotated = await controller.updatePlan({ masterPassword: 'RotatedSecret99!' });
    assert.equal((rotated as { ok?: boolean }).ok, true);

    // 5. Admin floor: 11 characters rejected, 12 accepted (DTO + endpoint).
    const dtoShort = validateSync(plainToInstance(SetDeveloperMasterPasswordDto, { newMasterPassword: 'ElevenChars' }));
    assert.ok(dtoShort.length > 0, '11-char master password must fail DTO validation');
    const dtoOk = validateSync(plainToInstance(SetDeveloperMasterPasswordDto, { newMasterPassword: 'TwelveChars!' }));
    assert.equal(dtoOk.length, 0, '12-char master password must pass DTO validation');
    await assert.rejects(
      () =>
        controller.setMasterPassword(
          { newMasterPassword: 'ElevenChars' },
          { authContext: superAdminAuth() } as never,
        ),
      (error: unknown) => (error as { code?: string }).code === 'PASSWORD_TOO_WEAK',
      '11-char set must be rejected by the role-aware minimum',
    );

    // 6. The setter is guarded: only the platform super_admin may call it.
    const guards = (Reflect.getMetadata(GUARDS_METADATA, DeveloperController.prototype.setMasterPassword) || []).map(
      (g: { name?: string }) => g?.name || '',
    );
    assert.ok(guards.includes(SessionAuthGuard.name), 'setter must require a session');
    assert.ok(guards.includes(SuperAdminRoleGuard.name), 'setter must require the super_admin role');

    // 7. The generic settings save path can never plant the hash key.
    const currentHash = await service.getDeveloperMasterPasswordHash();
    const settingsService = new SettingsService(db, { log: async () => undefined } as never, {} as never);
    await settingsService.saveSettings(
      { [DEVELOPER_MASTER_PASSWORD_HASH_KEY]: 'attacker-planted-value' },
      { ...superAdminAuth(), role: 'admin' } as AuthContext,
    );
    const planted = await anyDb
      .selectFrom('settings')
      .selectAll()
      .where('key', '=', DEVELOPER_MASTER_PASSWORD_HASH_KEY)
      .executeTakeFirst();
    assert.equal(
      planted?.value,
      currentHash,
      'settings save must leave the stored hash untouched',
    );

    // 8. Unset env + no hash disables the panel.
    await anyDb.deleteFrom('settings').where('key', '=', DEVELOPER_MASTER_PASSWORD_HASH_KEY).execute();
    const disabled = new DeveloperController(service as never, envConfig('') as never);
    await assert.rejects(
      () => disabled.updatePlan({ masterPassword: 'anything' }),
      ForbiddenException,
      'unset env with no hash must disable the panel',
    );

    console.log('developer-master-password.spec: ok');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
