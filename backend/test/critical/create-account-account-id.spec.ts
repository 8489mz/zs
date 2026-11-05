/*
New file: backend/test/critical/create-account-account-id.spec.ts
Pins the account-creation failure (INV-ACCOUNT-CREATE-ACCOUNT-ID).

THE GAP: createAccount inserted a row into accounting_accounts without
account_id, but the tenant-scope migration
(20260531000200_tenant_scope_accounting_and_hr_settings.ts, scopeTable)
added account_id as TEXT NOT NULL with no default. Every account creation
-- root or sub-account -- therefore failed in PostgreSQL with 23502
(null value in column "account_id"), surfacing as a generic failure in the
accounts screen ("add sub-account impossible"). The insert already set
tenant_id from the same scope; account_id was simply never added.

THE RULE: createAccount stores scope.accountId in account_id, the same
scope the rest of the accounting module already uses (e.g. the inserts at
accounting.service.ts L1164, L1913, L2439).

WHAT THIS PINS, driving the REAL AccountingService.createAccount on PGlite
(the spec DDL mirrors the production foundation DDL plus the scope
migration: account_id TEXT NOT NULL with no default, and the spec asserts
the constraint is present, so the case cannot pass vacuously):
- creating a root account succeeds and stores tenant_id + account_id.
- creating a sub-account under it succeeds and stores the parent link
  plus tenant_id + account_id.
- creating a second account with the same code is still rejected with
  'Account code already exists'.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { AccountingService } from '../../src/modules/accounting/accounting.service';

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: ['accounting'] } as unknown as AuthContext;

async function createDb(): Promise<Kysely<Database>> {
  const pglite = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pglite) });
  // Production DDL: 20260529000100_accounting_foundation.ts (foundation
  // columns) + 20260531000200 scopeTable (tenant_id / account_id TEXT
  // NOT NULL, no default) + the flag columns later migrations added and
  // the insert sets explicitly.
  await sql`
    CREATE TABLE accounting_accounts (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL DEFAULT '',
      account_type TEXT NOT NULL,
      account_group TEXT NOT NULL DEFAULT '',
      parent_id BIGINT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
      normal_balance TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      is_system BOOLEAN NOT NULL DEFAULT FALSE,
      allow_manual_entries BOOLEAN NOT NULL DEFAULT TRUE,
      is_control_account BOOLEAN NOT NULL DEFAULT FALSE,
      is_cash_bank BOOLEAN NOT NULL DEFAULT FALSE,
      is_receivable BOOLEAN NOT NULL DEFAULT FALSE,
      is_payable BOOLEAN NOT NULL DEFAULT FALSE,
      is_inventory BOOLEAN NOT NULL DEFAULT FALSE,
      is_tax BOOLEAN NOT NULL DEFAULT FALSE,
      description_ar TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT accounting_accounts_account_type_chk CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense', 'contra_asset', 'contra_revenue')),
      CONSTRAINT accounting_accounts_normal_balance_chk CHECK (normal_balance IN ('debit', 'credit'))
    )
  `.execute(db);
  return db;
}

async function assertAccountIdNotNull(db: Kysely<Database>): Promise<void> {
  const row = await sql<{ is_nullable: string }>`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_name = 'accounting_accounts' AND column_name = 'account_id'
  `.execute(db);
  assert.equal(row.rows[0]?.is_nullable, 'NO', 'account_id must be NOT NULL or the case passes vacuously');
}

async function main(): Promise<void> {
  const db = await createDb();
  try {
    await assertAccountIdNotNull(db);
    const service = new AccountingService(db as never, {} as never);

    const root = await service.createAccount(
      { code: '1010', nameAr: 'الصندوق', nameEn: 'Cash', accountType: 'asset', normalBalance: 'debit' } as never,
      AUTH,
    ) as { ok: boolean; accountId: string };
    assert.equal(root.ok, true);
    const rootId = Number(root.accountId);
    assert.ok(Number.isSafeInteger(rootId) && rootId > 0, 'root account id returned');

    const rootRow = await sql<{ tenant_id: string; account_id: string; code: string }>`
      SELECT tenant_id, account_id, code FROM accounting_accounts WHERE id = ${rootId}
    `.execute(db);
    assert.equal(rootRow.rows[0]?.tenant_id, 't1');
    assert.equal(rootRow.rows[0]?.account_id, 'a1');
    assert.equal(rootRow.rows[0]?.code, '1010');

    const child = await service.createAccount(
      { code: '1011', nameAr: 'صندوق فرعي', nameEn: 'Petty Cash', accountType: 'asset', normalBalance: 'debit', parentId: rootId } as never,
      AUTH,
    ) as { ok: boolean; accountId: string };
    assert.equal(child.ok, true);
    const childRow = await sql<{ account_id: string; parent_id: number }>`
      SELECT account_id, parent_id FROM accounting_accounts WHERE id = ${Number(child.accountId)}
    `.execute(db);
    assert.equal(childRow.rows[0]?.account_id, 'a1');
    assert.equal(Number(childRow.rows[0]?.parent_id), rootId);

    await assert.rejects(
      () => service.createAccount(
        { code: '1010', nameAr: 'مكرر', nameEn: 'Duplicate', accountType: 'asset', normalBalance: 'debit' } as never,
        AUTH,
      ),
      /Account code already exists/,
    );

    console.log('create account account_id checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
