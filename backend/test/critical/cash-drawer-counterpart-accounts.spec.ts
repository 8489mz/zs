/*
New file: backend/test/critical/cash-drawer-counterpart-accounts.spec.ts

WHAT THIS PINS (INV-CASH-DRAWER-COUNTERPART-CASHIER-ACCESS): the
cash-drawer movement form's counterpart picker must work for a
cashier by default. The picker used to query GET
/api/accounting/accounts, whose AccountingAccessGuard allows only
super_admin / admin / the `accounting` permission — and the
default cashier template carries `accounts` but NOT `accounting`,
so a cashier got 403, which the picker's `.catch(() => ({
accounts: [] }))` silently turned into "no active cash or bank
accounts". The fix is a narrow endpoint under the cash-drawer
scope (cashDrawer permission only) returning active cash/bank
accounts only: id/code/name plus the discriminator fields the
picker filter needs — NO balances, NO chart data.

THE DEFECT: as cashier "cash" (trial 2, re-trial gate 07:56), the
counterpart picker offered ZERO accounts — not only the new safe
account 1111, but also 1110 and 1120 — so safe_drop /
safe_replenishment were unusable by any cashier, contradicting
approved fix #9 (cashier-password disbursements). The Sep-2026
guard must stay intact: granting `accounting` to cashiers would
reopen the hole it was built to close (a cashier reading the full
balance sheet and cash-flow statement).

ACCEPTANCE (user, 2026-11-14): access works BY DEFAULT for EVERY
cashier, with no manual checkbox. The cashier auth below carries
EXACTLY DEFAULT_CASHIER_PERMS (copied verbatim from
frontend/src/features/settings/components/user-management.shared.ts)
— no `accounting`, nothing ticked — and must still receive
1111+1120. The checkbox that would open this is "دفاتر المنشأة
المالية" (the `accounting` permission); it must NOT be ticked.

STRUCTURE NOTE (file-size ratchet): the endpoint lives in a NEW
small service file (cash-drawer-counterpart.service.ts), NOT in
cash-drawer.service.ts — that file is a ratchet-baseline file at
1654 lines and must not grow. The controller wires the new
service; the old service file is untouched.

WHAT IS DRIVEN: the real CashDrawerCounterpartService on PGlite,
with the real tenant scoping, for a cashier auth with exactly
DEFAULT_CASHIER_PERMS and for an admin auth.

NOT DRIVEN: the HTTP route wiring (controller
@RequirePermissions('cashDrawer') — one line, verified by
inspection; the guard chain is pinned by
test/infra/critical-route-guards.spec.ts patterns); the frontend
picker (pinned by CashDrawerFormsPanel.spec.tsx, which drives the
real panel against the new endpoint and asserts a failed load
surfaces a permission hint instead of the empty-accounts hint);
live-Postgres acceptance (deferred by written decision).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { CashDrawerCounterpartService } from '../../src/modules/cash-drawer/cash-drawer-counterpart.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';

// EXACT copy of DEFAULT_CASHIER_PERMS
// (frontend/src/features/settings/components/user-management.shared.ts:12-15).
// The acceptance is that a cashier with ONLY these permissions — no
// `accounting`, no manual checkbox — sees the counterpart accounts.
// If the template ever changes, this list must change with it.
const DEFAULT_CASHIER_PERMS = [
  'sales', 'kitchen', 'cashDrawer', 'customers', 'suppliers', 'accounts',
  'purchases', 'products', 'returns', 'deliveryReps', 'hr', 'hrAttendance',
  'canPrint', 'services', 'treasury',
];

const cashierAuth: AuthContext = {
  userId: 2, sessionId: 'spec', username: 'cash', role: 'cashier',
  permissions: [...DEFAULT_CASHIER_PERMS], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

const adminAuth: AuthContext = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['sales'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

const emptyTenantAuth: AuthContext = {
  userId: 2, sessionId: 'spec', username: 'cash', role: 'cashier',
  permissions: [...DEFAULT_CASHIER_PERMS], tenantId: 't-empty', accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, normal_balance text, is_cash_bank boolean, is_active boolean, is_tax boolean, account_group text, is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false, allow_manual_entries boolean DEFAULT true);
  `);
  return { pg, db };
}

async function seedAccounts(db: Kysely<Database>): Promise<void> {
  const rows: Array<{ id: number; tenant_id: string; code: string; name_ar: string; name_en: string; account_type: string; normal_balance: string; is_cash_bank: boolean; is_active: boolean }> = [
    { id: 1, tenant_id: TENANT, code: '1110', name_ar: 'صندوق الدرج', name_en: '', account_type: 'asset', normal_balance: 'debit', is_cash_bank: true, is_active: true },
    { id: 2, tenant_id: TENANT, code: '1111', name_ar: 'الخزينة الآمنة', name_en: 'Safe', account_type: 'asset', normal_balance: 'debit', is_cash_bank: true, is_active: true },
    { id: 3, tenant_id: TENANT, code: '1120', name_ar: 'بنك', name_en: '', account_type: 'asset', normal_balance: 'debit', is_cash_bank: true, is_active: true },
    { id: 4, tenant_id: TENANT, code: '1140', name_ar: 'مخزون', name_en: '', account_type: 'asset', normal_balance: 'debit', is_cash_bank: false, is_active: true },
    { id: 5, tenant_id: TENANT, code: '1130', name_ar: 'ذمم مدينة معطلة', name_en: '', account_type: 'asset', normal_balance: 'debit', is_cash_bank: true, is_active: false },
    { id: 6, tenant_id: TENANT, code: '2110', name_ar: 'ذمم دائنة', name_en: '', account_type: 'liability', normal_balance: 'credit', is_cash_bank: true, is_active: true },
    { id: 99, tenant_id: 't2', code: '1111', name_ar: 'الخزينة الآمنة', name_en: 'Safe', account_type: 'asset', normal_balance: 'debit', is_cash_bank: true, is_active: true },
  ];
  for (const row of rows) {
    await db.insertInto('accounting_accounts').values(row as never).execute();
  }
}

async function main(): Promise<void> {
  // 1. A cashier with EXACTLY the default cashier permissions —
  // no `accounting`, no manual checkbox — receives 1111+1120.
  {
    const { pg, db } = await makeDb();
    try {
      await seedAccounts(db);
      const service = new CashDrawerCounterpartService(db);
      assert.ok(!cashierAuth.permissions.includes('accounting'), 'the cashier auth must not carry the accounting permission');
      assert.ok(cashierAuth.permissions.includes('cashDrawer'), 'the cashier auth carries the cashDrawer permission');
      const result = await service.listCounterpartAccounts(cashierAuth);
      assert.deepEqual(
        (result.accounts as Array<Record<string, unknown>>).map((row) => String(row.id)),
        ['1', '2', '3'],
        'the cashier receives exactly the tenant active cash/bank asset accounts (ids)',
      );
      assert.deepEqual(
        (result.accounts as Array<Record<string, unknown>>).map((row) => String(row.code)),
        ['1110', '1111', '1120'],
        'the cashier receives 1111+1120, ordered by code',
      );
      for (const row of result.accounts as Array<Record<string, unknown>>) {
        assert.ok(!('balance' in row), 'no balance is ever returned');
        assert.ok(!('parentId' in row) && !('depth' in row) && !('sortOrder' in row), 'no chart-structure fields are returned');
        assert.deepEqual(row.flags, { isCashBank: true }, 'each row is stamped as a cash/bank account');
        assert.equal(row.accountType, 'asset', 'each row is an asset');
        assert.equal(row.normalBalance, 'debit', 'each row is debit-normal');
        assert.equal(row.isActive, true, 'each row is active');
      }
    } finally {
      await db.destroy(); (globalThis as any).gc?.();
    }
    console.log('  cashier with exactly DEFAULT_CASHIER_PERMS receives 1111+1120 with no balances passed');
  }

  // 2. Admin receives the identical list (admin behavior unchanged).
  {
    const { pg, db } = await makeDb();
    try {
      await seedAccounts(db);
      const service = new CashDrawerCounterpartService(db);
      const asCashier = await service.listCounterpartAccounts(cashierAuth);
      const asAdmin = await service.listCounterpartAccounts(adminAuth);
      assert.deepEqual(asAdmin, asCashier, 'admin and cashier receive the identical counterpart list');
    } finally {
      await db.destroy(); (globalThis as any).gc?.();
    }
    console.log('  admin receives the identical list passed');
  }

  // 3. An empty chart returns an empty list, not an error (so the
  // picker's "no accounts" hint is then honest).
  {
    const { pg, db } = await makeDb();
    try {
      await seedAccounts(db);
      const service = new CashDrawerCounterpartService(db);
      const result = await service.listCounterpartAccounts(emptyTenantAuth);
      assert.deepEqual(result.accounts, [], 'a tenant with no accounts gets an empty list');
    } finally {
      await db.destroy(); (globalThis as any).gc?.();
    }
    console.log('  empty chart returns an empty list passed');
  }

  // 4. Source pins: the service file and the controller route
  // exist, the route requires only cashDrawer (no AccountingAccessGuard
  // on the cash-drawer controller), the Sep-2026 guard is intact,
  // and the 1654-line cash-drawer.service.ts is untouched by this fix.
  {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const here = __dirname;
    const serviceSource = readFileSync(resolve(here, '../../src/modules/cash-drawer/cash-drawer-counterpart.service.ts'), 'utf8');
    assert.ok(serviceSource.includes('async listCounterpartAccounts('), 'the service exposes listCounterpartAccounts');
    assert.ok(serviceSource.includes("where('is_cash_bank', '=', true)"), 'the service filters to cash/bank accounts');
    assert.ok(!/import[^;]*accounting-access\.guard/.test(serviceSource) && !serviceSource.includes('assertAccountingAccess('), 'the counterpart service never touches the accounting gate');
    const controllerSource = readFileSync(resolve(here, '../../src/modules/cash-drawer/cash-drawer.controller.ts'), 'utf8');
    assert.ok(controllerSource.includes("cashier-shifts/counterpart-accounts"), 'the controller exposes the counterpart route');
    assert.ok(controllerSource.includes("@RequirePermissions('cashDrawer')"), 'the counterpart route requires only cashDrawer');
    assert.ok(!/import[^;]*accounting-access\.guard/.test(controllerSource), 'the cash-drawer controller never imports the accounting guard');
    const drawerServiceSource = readFileSync(resolve(here, '../../src/modules/cash-drawer/cash-drawer.service.ts'), 'utf8');
    assert.ok(!drawerServiceSource.includes('listCounterpartAccounts'), 'the 1654-line drawer service is untouched by this fix');
    const guardSource = readFileSync(resolve(here, '../../src/core/auth/guards/accounting-access.guard.ts'), 'utf8');
    assert.ok(guardSource.includes("includes('accounting')"), 'the Sep-2026 accounting guard still requires the accounting permission');
    const invariants = readFileSync(resolve(here, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-CASH-DRAWER-COUNTERPART-CASHIER-ACCESS').length - 1, 1, 'the invariant entry must exist exactly once');
    console.log('  source + invariant pins passed');
  }

  console.log('Cash drawer counterpart accounts tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
