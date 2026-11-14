/*
New file: backend/test/critical/users-grant-error-names-permission.spec.ts
Pins INV-USER-GRANT-NAMES-PERMISSION: (a) creating an owner/admin
with the standard template on the tenant's own activity must succeed
with NO error at all, and (b) when INV-USER-GRANT-SUBSET still
refuses a grant, the refusal must name the blocking permission in
plain Arabic — the exact words the merchant sees on the checkbox —
not just the English permission key and never the generic "غير مسموح
بتنفيذ هذه العملية.".

CORRECTED DIAGNOSIS (user caught it live, 2026-11-14 — "هو فين اصلا
البحري دي"): this is an Electron (offline) copy whose tenant was
created as retail + clothes, with no maritime in it at all. At
activation (activation.service.ts) the owner gets role 'admin' +
SUPER_ADMIN_PERMISSIONS — 45 retail keys. But the owner template in
the add-user form sent DEFAULT_ADMIN_PERMS — 57 keys = the same 45
PLUS 12 hidden keys (6 maritime + 6 contracting). The form only ever
shows getFilteredPermissionGroups for the tenant's vertical, so those
12 boxes do not exist on screen: the user could never untick them,
and the save payload silently carried them, so the guard refused the
whole save with a generic 403. The earlier workaround (untick the
maritime/contracting groups) was wrong and impossible. The fix
scopes the template/draft to the tenant's vertical (frontend) so no
hidden key is ever sent; the grant rule itself is unchanged.

WHAT THIS PINS, driving the REAL UsersService on PGlite:
1. HEADLINE: the retail-scoped owner template (45 keys — the exact
   set the activation owner holds) created by that retail owner
   succeeds: role 'admin', no error, row created with exactly those
   permissions.
2. The UNSCOPED legacy payload (57 keys incl. the 12 hidden ones) is
   still refused by the unchanged guard -> 403
   GRANT_EXCEEDS_ACTOR_PERMISSIONS, no row created, and the refusal
   names the FIRST offending permission in template order in plain
   Arabic ("أوامر تشغيل الشحن (Jobs)") AND its key "(maritimeJobs)",
   and is not the generic sentence.
3. The same refusal through the real HTTP mapper (mapToHttpException)
   keeps the Arabic label in the response body and keeps the code —
   the backend translator must not swallow the specific message back
   into the static/generic sentence.
4. The three GRANT codes have explicit Arabic mappings in
   error-translations.ts: with an English-only fallback each one
   resolves to a specific Arabic sentence, never the generic 403
   sentence.
5. An unknown permission key falls back to the key itself in the
   message, so the message never goes blank.
6. The update path names the blocking permission the same way
   (the edit modal saves through executeUserUpdate, not just create).

Harness note: same PGlite/pool-read shadowing as
users-grant-subset.spec.ts — the guard runs before the pool-reading
helpers, so rejection cases are unaffected.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { UsersService } from '../../src/modules/users/users.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { mapToHttpException } from '../../src/common/mappers/error.mapper';
import { translateErrorMessageFromCode } from '../../src/common/errors/error-translations';

const TENANT = 't-grant-names-perm';
const ACCOUNT = 'a-grant-names-perm';
const GENERIC_403 = 'غير مسموح بتنفيذ هذه العملية.';

/* The UNSCOPED owner template exactly as the form used to send it:
 * frontend/src/features/settings/components/user-management.shared.ts
 * DEFAULT_ADMIN_PERMS (57 keys, order preserved — the guard names
 * the FIRST permission in this order the actor does not hold). */
const UNSCOPED_TEMPLATE_PERMISSIONS = [
  'dashboard', 'products', 'sales', 'kitchen', 'purchases', 'inventory', 'suppliers', 'customers', 'crm', 'accounts', 'accounting', 'returns', 'reports', 'audit', 'treasury', 'services', 'hr', 'hrEmployees', 'hrAttendance', 'hrContracts', 'hrLoans', 'hrPayrollView', 'hrPayrollManage', 'hrPayrollApprove', 'hrSalaryView', 'hrSalaryManage', 'settings', 'pricingCenterView', 'pricingCenterManage', 'canEditUsers', 'canManageUsers', 'canManageSettings', 'canManageBackups', 'canPrint', 'canDiscount', 'canEditPrice', 'canSellWholesale', 'canViewProfit', 'canDelete', 'canEditInvoices', 'canDirectReturn', 'canAdjustInventory', 'canManageBranchStock', 'cashDrawer', 'deliveryReps',
  'maritimeJobs', 'maritimeContainers', 'maritimeInquiries', 'maritimeQuotations', 'maritimeRfqs', 'maritimePolicies',
  'contractingProjects', 'contractingInvoices', 'contractingBoq', 'contractingDailyLogs', 'contractingChangeOrders', 'contractingSubcontractors',
];

/* The 12 hidden keys: present in the template, absent from the
 * activation owner's holdings and from any retail tenant. */
const HIDDEN_VERTICAL_KEYS = new Set([
  'maritimeJobs', 'maritimeContainers', 'maritimeInquiries', 'maritimeQuotations', 'maritimeRfqs', 'maritimePolicies',
  'contractingProjects', 'contractingInvoices', 'contractingBoq', 'contractingDailyLogs', 'contractingChangeOrders', 'contractingSubcontractors',
]);

/* The retail-scoped owner template (45 keys): the unscoped list
 * minus the 12 hidden keys — exactly the set the activation owner
 * holds (backend/src/core/auth/constants/super-admin-permissions.ts,
 * same set; only 'crm' sits in a different position). This is what
 * the form must send for a retail/clothes tenant. */
const RETAIL_TEMPLATE_PERMISSIONS = UNSCOPED_TEMPLATE_PERMISSIONS.filter((p) => !HIDDEN_VERTICAL_KEYS.has(p));

function actor(userId: number, tenantId: string, role: string, permissions: string[]): AuthContext {
  return {
    userId,
    sessionId: 'sess-spec',
    username: `actor-${userId}`,
    role,
    permissions,
    tenantId,
    accountId: ACCOUNT,
  };
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE users (id bigserial PRIMARY KEY, username text NOT NULL, phone text, password_hash text NOT NULL DEFAULT '', password_salt text NOT NULL DEFAULT '', role text NOT NULL, is_active boolean NOT NULL DEFAULT true, permissions_json text NOT NULL DEFAULT '[]', default_branch_id bigint, display_name text NOT NULL DEFAULT '', must_change_password boolean NOT NULL DEFAULT false, failed_login_count int NOT NULL DEFAULT 0, locked_until timestamptz, last_login_at timestamptz, tenant_id text NOT NULL, account_id text NOT NULL, created_at timestamptz DEFAULT NOW());
      CREATE TABLE tenants (id text PRIMARY KEY, plan_id text, status text);
      CREATE TABLE sessions (id text PRIMARY KEY, user_id bigint, tenant_id text);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
    `);

    const auditStub = { log: async () => undefined };
    const service = new UsersService(db, new TransactionHelper(), auditStub as never);
    (service as any).ensureUniqueUsername = async () => undefined;
    (service as any).ensureUniquePhone = async () => undefined;
    (service as any).getPlanLimitForTenant = async () => ({
      maxUsers: null, isUnlimited: true, isLimitReached: false,
      activeUsersCount: 0, planName: 'spec', planCode: null,
    });

    async function seedUser(id: number, tenantId: string, username: string, role: string, permissions: string[]): Promise<void> {
      await anyDb.insertInto('users').values({
        id, username, phone: `010000000${String(id).padStart(2, '0')}`, password_hash: 'x', password_salt: 'y',
        role, is_active: true, permissions_json: JSON.stringify(permissions),
        display_name: username, tenant_id: tenantId, account_id: ACCOUNT,
      }).execute();
    }
    async function readUser(id: number): Promise<any> {
      return anyDb.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    }
    async function countUsers(tenantId: string): Promise<number> {
      const rows = await anyDb.selectFrom('users').select('id').where('tenant_id', '=', tenantId).execute();
      return rows.length;
    }

    await anyDb.insertInto('tenants').values({ id: TENANT, plan_id: null, status: 'active' }).execute();
    // The activation owner: role admin holding exactly the 45 retail keys.
    await seedUser(20, TENANT, 'retailowner', 'admin', RETAIL_TEMPLATE_PERMISSIONS);
    await seedUser(2, TENANT, 'clerk', 'cashier', []);
    await pg.exec(`SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT MAX(id) FROM users));`);

    const retailOwner = actor(20, TENANT, 'admin', RETAIL_TEMPLATE_PERMISSIONS);

    function ownerCreatePayload(username: string, permissions: string[]): any {
      return {
        username, phone: '01000000999', role: 'admin', name: username,
        password: 'Str0ng!Pass9', permissions: [...permissions],
      };
    }

    // Case 1 (HEADLINE): the retail-scoped owner template created by
    // the activation owner succeeds — no error at all.
    const beforeCreate = await countUsers(TENANT);
    const ok1 = await service.createUser(ownerCreatePayload('azzam', RETAIL_TEMPLATE_PERMISSIONS), retailOwner);
    assert.equal((ok1 as any).ok, true);
    assert.equal(await countUsers(TENANT), beforeCreate + 1);
    const created = await readUser(21);
    assert.equal(created.role, 'admin');
    assert.deepEqual(
      [...JSON.parse(created.permissions_json)].sort(),
      [...RETAIL_TEMPLATE_PERMISSIONS].sort(),
      'the created owner must hold exactly the retail template set',
    );

    // Case 2: the UNSCOPED legacy payload is still refused by the
    // unchanged guard, and the refusal names the first blocking
    // permission in plain Arabic, with its key.
    let thrown: any = null;
    try {
      await service.createUser(ownerCreatePayload('azzam2', UNSCOPED_TEMPLATE_PERMISSIONS), retailOwner);
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown, 'the unscoped owner-template create must be refused');
    assert.equal(thrown.code, 'GRANT_EXCEEDS_ACTOR_PERMISSIONS');
    assert.equal(thrown.statusCode, 403);
    assert.equal(await countUsers(TENANT), beforeCreate + 1);
    assert.ok(
      String(thrown.message).includes('أوامر تشغيل الشحن (Jobs)'),
      `the refusal must name the blocking permission in plain Arabic, got: ${thrown.message}`,
    );
    assert.ok(
      String(thrown.message).includes('(maritimeJobs)'),
      `the refusal must carry the permission key too, got: ${thrown.message}`,
    );
    assert.notEqual(String(thrown.message).trim(), GENERIC_403, 'the refusal must not be the generic 403 sentence');
    assert.ok(
      !String(thrown.message).includes('غير مسموح بتنفيذ هذه العملية'),
      `the refusal must not hide behind the generic sentence, got: ${thrown.message}`,
    );

    // Case 3: the specific message survives the real HTTP mapper —
    // the response body the frontend reads still names the permission.
    const httpException = mapToHttpException(thrown);
    const body = httpException.getResponse() as { message: string; code: string };
    assert.equal(body.code, 'GRANT_EXCEEDS_ACTOR_PERMISSIONS');
    assert.ok(
      String(body.message).includes('أوامر تشغيل الشحن (Jobs)'),
      `the mapped response must keep the Arabic permission name, got: ${body.message}`,
    );
    assert.notEqual(String(body.message).trim(), GENERIC_403);

    // Case 4: the three GRANT codes have explicit Arabic mappings —
    // with an English-only fallback each resolves to a specific
    // Arabic sentence, never the generic 403 sentence.
    for (const [code, englishFallback] of [
      ['GRANT_EXCEEDS_ACTOR_PERMISSIONS', 'You cannot grant a permission you do not hold'],
      ['GRANT_STAR_FORBIDDEN', 'Only the platform tenant may grant the all-permissions grant'],
      ['GRANT_ROLE_ABOVE_ACTOR', 'You cannot grant a role above your own'],
    ] as const) {
      const mapped = translateErrorMessageFromCode(code, englishFallback, 403);
      assert.notEqual(mapped.trim(), GENERIC_403, `${code} must not map to the generic 403 sentence`);
      assert.ok(/[\u0600-\u06FF]/.test(mapped), `${code} must map to an Arabic sentence, got: ${mapped}`);
    }

    // Case 5: an unknown permission key falls back to the key itself,
    // so the message still tells the user which checkbox blocks.
    let unknownThrown: any = null;
    try {
      await service.updateUser(2, { username: 'clerk', phone: '01000000002', role: 'cashier', name: 'clerk', permissions: ['mysteryPerm'] }, retailOwner, 'sess-spec');
    } catch (err) {
      unknownThrown = err;
    }
    assert.ok(unknownThrown, 'granting an unknown permission must be refused');
    assert.equal(unknownThrown.code, 'GRANT_EXCEEDS_ACTOR_PERMISSIONS');
    assert.ok(
      String(unknownThrown.message).includes('(mysteryPerm)'),
      `an unknown key must still appear in the message, got: ${unknownThrown.message}`,
    );

    // Case 6: the update path names the blocking permission too.
    let updateThrown: any = null;
    try {
      await service.updateUser(2, { username: 'clerk', phone: '01000000002', role: 'admin', name: 'clerk', permissions: [...UNSCOPED_TEMPLATE_PERMISSIONS] }, retailOwner, 'sess-spec');
    } catch (err) {
      updateThrown = err;
    }
    assert.ok(updateThrown, 'the unscoped owner-template update must be refused');
    assert.equal(updateThrown.code, 'GRANT_EXCEEDS_ACTOR_PERMISSIONS');
    assert.ok(
      String(updateThrown.message).includes('أوامر تشغيل الشحن (Jobs)'),
      `the update refusal must name the blocking permission in Arabic, got: ${updateThrown.message}`,
    );
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => console.log('users grant error names permission checks passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
