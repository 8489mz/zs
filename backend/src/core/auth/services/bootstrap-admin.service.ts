import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { createPasswordRecord, verifyPassword } from '../utils/password-hasher';
import { assertStrongPassword } from '../utils/password-policy';
import { resolveTenantContext } from '../utils/tenant-context';
import { getPlatformTenantIds } from '../utils/tenant-boundary';

import { SUPER_ADMIN_PERMISSIONS } from '../constants/super-admin-permissions';

@Injectable()
export class BootstrapAdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapAdminService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly configService: ConfigService,
  ) {}

  private async sanitizeSuperAdminRoles(): Promise<void> {
    try {
      const platformTenantId = String(this.configService.get<string>('PLATFORM_TENANT_ID') || 'zs').trim();
      const appMode = String(this.configService.get<string>('APP_MODE') || 'CLOUD_SAAS').trim().toUpperCase();
      const platformTenantIds = getPlatformTenantIds(appMode, platformTenantId);
      const result = await sql`
        UPDATE users SET role = 'admin'
        WHERE role = 'super_admin' AND LOWER(TRIM(tenant_id)) NOT IN (${sql.join(platformTenantIds)});
      `.execute(this.db);

      const numUpdated = Number((result as any)?.numUpdatedRows || 0);
      if (numUpdated > 0) {
        this.logger.warn(`Security isolation: Sanitized ${numUpdated} user(s) from 'super_admin' to 'admin' (strictly permitted only in platform tenant).`);
      }
    } catch (error: any) {
      this.logger.debug?.(`Role sanitization skipped: ${error.message}`);
    }
  }

  private async ensureBootstrapUser(input: {
    username: string;
    password: string;
    role: 'super_admin' | 'admin';
    displayName: string;
    permissions: string[];
  }): Promise<void> {
    const scope = resolveTenantContext(this.configService);
    const existing = await this.db
      .selectFrom('users')
      .select('id')
      .where('username', '=', input.username)
      .limit(1)
      .executeTakeFirst();

    if (existing) {
      return;
    }

    // The single insertion point for bootstrap users: enforce the
    // role-aware minimum here so no caller can seed a weak password.
    assertStrongPassword(input.password, { role: input.role });

    const passwordRecord = await createPasswordRecord(input.password);

    const platformTenantId = String(this.configService.get<string>('PLATFORM_TENANT_ID') || 'zs').trim();
    const targetTenantId = input.role === 'super_admin' ? platformTenantId : scope.tenantId;
    const targetAccountId = input.role === 'super_admin' ? platformTenantId : scope.accountId;

    try {
      await this.db
        .insertInto('users')
        .values({
        username: input.username,
        password_hash: passwordRecord.hash,
        password_salt: passwordRecord.salt,
        role: input.role,
        is_active: true,
        permissions_json: JSON.stringify(input.permissions),
        default_branch_id: null,
        display_name: input.displayName,
        failed_login_count: 0,
        locked_until: null,
        last_login_at: null,
        must_change_password: true,
        tenant_id: targetTenantId,
        account_id: targetAccountId,
      })
      .execute();
    } catch (e: any) {
      if (e.code !== '23505') { // ignore unique violation
        throw e;
      }
    }
  }

  private async ensurePlatformSuperAdminIntegrity(): Promise<void> {
    try {
      const appMode = String(this.configService.get<string>('APP_MODE') || 'CLOUD_SAAS').trim().toUpperCase();
      const platformTenantId = String(this.configService.get<string>('PLATFORM_TENANT_ID') || 'zs').trim();
      const targetTenantId = appMode === 'CLOUD_SAAS' ? platformTenantId : 'default';

      // 1. Ensure platform tenant exists in cloud SaaS mode
      if (appMode === 'CLOUD_SAAS') {
        const tenantExists = await this.db.selectFrom('tenants').select('id').where('id', '=', platformTenantId).executeTakeFirst();
        if (!tenantExists) {
          await sql`
            INSERT INTO tenants (
              id, slug, business_name, owner_name, owner_phone, owner_email,
              activity_type, status, trial_starts_at, trial_ends_at, activated_at,
              created_at, updated_at, plan_id, extra_features, country_code
            ) VALUES (
              ${platformTenantId}, ${platformTenantId}, 'منصة Z-Systems المركزية', 'محمود زكريا', '0000000000', 'admin@zsystems.io',
              'retail_general', 'active', NOW(), NOW() + INTERVAL '100 years', NOW(),
              NOW(), NOW(), 'plan_omnichannel', '[]'::jsonb, 'EG'
            ) ON CONFLICT (id) DO NOTHING;
          `.execute(this.db);
        }
      }

      // 2. Ensure super_admin user 'zs' exists and is healthy
      const userZs = await this.db
        .selectFrom('users')
        .select(['id', 'role', 'is_active', 'tenant_id', 'password_hash', 'password_salt'])
        .where('tenant_id', '=', targetTenantId)
        .where(sql<boolean>`LOWER(TRIM(username)) = 'zs'`)
        .executeTakeFirst();

      if (!userZs) {
        // Secure fail-closed provisioning: only provision if operator explicitly supplies PLATFORM_SUPERADMIN_PASSWORD in environment
        const operatorPassword = (this.configService.get<string>('PLATFORM_SUPERADMIN_PASSWORD') || '').trim();
        if (!operatorPassword) {
          this.logger.warn(`Platform Root Administrator 'zs' is missing in tenant '${targetTenantId}'. Set PLATFORM_SUPERADMIN_PASSWORD in environment to provision.`);
        } else {
          const FORBIDDEN_PASSWORDS = ['ZsAdmin2026', 'ChangeMe123!', 'Admin123!', 'Password123!', '12345678', 'admin', 'password', 'weak'];
          if (FORBIDDEN_PASSWORDS.includes(operatorPassword) || operatorPassword.length < 12) {
            throw new Error('Platform super-admin provisioning refuses to use published, default, or weak passwords (minimum 12 characters required)');
          }
          assertStrongPassword(operatorPassword, { role: 'super_admin' });

          const passwordRecord = await createPasswordRecord(operatorPassword);
          await this.db
            .insertInto('users')
            .values({
              username: 'zs',
              password_hash: passwordRecord.hash,
              password_salt: passwordRecord.salt,
              role: 'super_admin',
              is_active: true,
              permissions_json: JSON.stringify(SUPER_ADMIN_PERMISSIONS),
              default_branch_id: null,
              display_name: 'محمود زكريا',
              failed_login_count: 0,
              locked_until: null,
              last_login_at: null,
              must_change_password: true,
              tenant_id: targetTenantId,
              account_id: targetTenantId,
            })
            .execute();
          this.logger.warn(`Platform Integrity: Securely provisioned missing root super administrator 'zs' in tenant '${targetTenantId}' using operator secret.`);
        }
      } else {
        // Audit existing account: detect if installation is using the published default credential 'ZsAdmin2026'
        if (userZs.password_hash) {
          const defaultCheck = await verifyPassword('ZsAdmin2026', userZs.password_hash, userZs.password_salt || '');
          if (defaultCheck.valid) {
            this.logger.error(
              `SECURITY ALERT: Root platform administrator 'zs' in tenant '${targetTenantId}' is configured with known default password 'ZsAdmin2026'. Immediate password rotation is required. Setting must_change_password=true.`
            );
            await this.db
              .updateTable('users')
              .set({ must_change_password: true })
              .where('id', '=', userZs.id)
              .execute()
              .catch(() => undefined);
          }
        }

        await this.db
          .updateTable('users')
          .set({
            role: 'super_admin',
            is_active: true,
            permissions_json: JSON.stringify(SUPER_ADMIN_PERMISSIONS),
            failed_login_count: 0,
            locked_until: null,
          })
          .where('id', '=', userZs.id)
          .execute()
          .catch(() => undefined);
      }

      // 3. Rename any rogue user with username 'zs' in other tenants to avoid collision
      await sql`
        UPDATE users
        SET username = CONCAT(tenant_id, '_admin')
        WHERE LOWER(TRIM(username)) = 'zs' AND LOWER(TRIM(tenant_id)) NOT IN (${sql.join(getPlatformTenantIds(appMode, platformTenantId))});
      `.execute(this.db).catch(() => undefined);

      // 4. Sanitize rogue super_admin roles
      await this.sanitizeSuperAdminRoles();
    } catch (err: any) {
      if (err.message && err.message.includes('Platform super-admin provisioning refuses')) {
        throw err;
      }
      this.logger.warn(`Platform integrity check warning: ${err?.message}`);
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    // Always guarantee platform tenant and super_admin user integrity on startup
    await this.ensurePlatformSuperAdminIntegrity();

    const activationEnforced = this.configService.get<boolean>('ACTIVATION_ENFORCED') === true;
    const licenseMode = this.configService.get<string>('LICENSE_MODE') || 'desktop';
    if (licenseMode !== 'server' && activationEnforced) {
      this.logger.log('Bootstrap admin seeding is disabled while desktop activation is enforced');
      return;
    }

    const enableBootstrapAdmin = this.configService.get<boolean>('ENABLE_BOOTSTRAP_ADMIN') === true;
    if (!enableBootstrapAdmin) {
      this.logger.log('Bootstrap admin seeding is disabled for this environment');
      return;
    }

    const existingUser = await this.db
      .selectFrom('users')
      .select('id')
      .limit(1)
      .executeTakeFirst();

    if (existingUser) {
      this.logger.log('Bootstrap admin seeding is skipped because the system is already initialized');
      return;
    }

    const nodeEnv = this.configService.get<string>('NODE_ENV') || 'development';
    const allowInProduction = this.configService.get<boolean>('ALLOW_BOOTSTRAP_ADMIN_IN_PRODUCTION') === true;
    const bootstrapSuperAdminUsername = (this.configService.get<string>('DEFAULT_ADMIN_USERNAME') || '').trim();
    const bootstrapSuperAdminPassword = this.configService.get<string>('DEFAULT_ADMIN_PASSWORD') || '';

    if (nodeEnv === 'production' && !allowInProduction) {
      throw new Error('Bootstrap admin seeding is blocked in production unless ALLOW_BOOTSTRAP_ADMIN_IN_PRODUCTION=true');
    }

    if (!bootstrapSuperAdminUsername) {
      throw new Error('Bootstrap admin seeding requires DEFAULT_ADMIN_USERNAME when ENABLE_BOOTSTRAP_ADMIN=true');
    }

    if (!bootstrapSuperAdminPassword) {
      throw new Error('Bootstrap admin seeding requires DEFAULT_ADMIN_PASSWORD when ENABLE_BOOTSTRAP_ADMIN=true');
    }

    const FORBIDDEN_BOOTSTRAP_PASSWORDS = ['ChangeMe123!', 'ZsAdmin2026', 'Admin123!', 'Password123!', '12345678', 'admin'];
    if (FORBIDDEN_BOOTSTRAP_PASSWORDS.includes(bootstrapSuperAdminPassword)) {
      throw new Error('Bootstrap admin seeding refuses to start with the default administrator password or published credentials');
    }

    assertStrongPassword(bootstrapSuperAdminPassword, { role: 'super_admin' });

    await this.ensureBootstrapUser({
      username: bootstrapSuperAdminUsername,
      password: bootstrapSuperAdminPassword,
      role: 'super_admin',
      displayName: 'محمود زكريا',
      permissions: SUPER_ADMIN_PERMISSIONS,
    });

    this.logger.warn(
      `Bootstrap administrator '${bootstrapSuperAdminUsername}' was seeded for first-run setup.`,
    );
  }
}
