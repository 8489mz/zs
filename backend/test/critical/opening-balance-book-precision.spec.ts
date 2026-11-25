/*
New file: backend/test/critical/opening-balance-book-precision.spec.ts
Pins money unification package 2 (INV-OPENING-BALANCE-BOOK-PRECISION):
a partner opening balance is recorded at the TENANT'S book
digits, not at a hardcoded 2dp. Both addCustomerOpeningBalance
and addSupplierOpeningBalance used to round the amount with
toFixed(2) BEFORE writing the ledger row, the partner balance,
and the amount handed to the posting service — so a 3dp tenant
(KWD) opening a partner at 100.125 stored 100.13 everywhere,
including in the posted journal. The posting methods already
re-derived book digits; only the caller-side rounding leaked.
Both writers now round with the canonical roundMoney at the
digits of the tenant's base currency.

WHAT THIS PINS, driving the REAL private writers on PGlite:
- A KWD tenant (3dp): 100.125 stays 100.125 in the ledger row,
  the partner balance, and the amount handed to posting.
- An EGP tenant (2dp): 100.125 becomes 100.13, unchanged.
- A zero amount writes no ledger row at all.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { PartnersService } from '../../src/modules/partners/partners.service';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE customers (id bigint PRIMARY KEY, balance numeric DEFAULT 0, updated_at timestamptz, tenant_id text, account_id text, is_active boolean);
      CREATE TABLE customer_ledger (customer_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, tenant_id text, account_id text);
      CREATE TABLE suppliers (id bigint PRIMARY KEY, balance numeric DEFAULT 0, updated_at timestamptz, tenant_id text, account_id text, is_active boolean, supplier_type text, overdraft_limit numeric);
      CREATE TABLE supplier_ledger (supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, tenant_id text, account_id text);
    `);
    await pg.exec(`
      INSERT INTO settings VALUES ('t1', 'currency', '"KWD"'), ('t2', 'currency', '"EGP"');
      INSERT INTO currency_exchange_rates VALUES ('t1', 'KWD', 1, true), ('t2', 'EGP', 1, true);
      INSERT INTO customers VALUES (1, 0, NOW(), 't1', 'a1', true), (2, 0, NOW(), 't2', 'a2', true), (3, 0, NOW(), 't1', 'a1', true);
      INSERT INTO suppliers VALUES (1, 0, NOW(), 't1', 'a1', true);
    `);

    const posted: { customer?: number; supplier?: number } = {};
    const fakePosting: any = {
      postCustomerOpeningBalance: async (_db: any, _id: number, amount: number) => {
        posted.customer = amount;
      },
      postSupplierOpeningBalance: async (_db: any, _id: number, amount: number) => {
        posted.supplier = amount;
      },
    };
    const svc: any = new PartnersService(db as any, {} as any, fakePosting);
    const authKwd = {
      tenantId: 't1',
      accountId: 'a1',
      role: 'admin',
      userId: 1,
      permissions: [],
    } as unknown as AuthContext;
    const authEgp = {
      tenantId: 't2',
      accountId: 'a2',
      role: 'admin',
      userId: 1,
      permissions: [],
    } as unknown as AuthContext;

    // KWD (3dp): the third decimal survives everywhere.
    await svc.addCustomerOpeningBalance(1, 100.125, authKwd, db);
    const kwdLedger: any = await db
      .selectFrom('customer_ledger' as any)
      .selectAll()
      .where('customer_id', '=', 1)
      .executeTakeFirst();
    assert.equal(Number(kwdLedger.amount), 100.125);
    assert.equal(Number(kwdLedger.balance_after), 100.125);
    const kwdCustomer: any = await db
      .selectFrom('customers' as any)
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirst();
    assert.equal(Number(kwdCustomer.balance), 100.125);
    assert.equal(posted.customer, 100.125);

    await svc.addSupplierOpeningBalance(1, 50.125, authKwd, db);
    const kwdSupLedger: any = await db
      .selectFrom('supplier_ledger' as any)
      .selectAll()
      .where('supplier_id', '=', 1)
      .executeTakeFirst();
    assert.equal(Number(kwdSupLedger.amount), 50.125);
    const kwdSupplier: any = await db
      .selectFrom('suppliers' as any)
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirst();
    assert.equal(Number(kwdSupplier.balance), 50.125);
    assert.equal(posted.supplier, 50.125);

    // EGP (2dp): behavior unchanged — 100.125 rounds to 100.13.
    await svc.addCustomerOpeningBalance(2, 100.125, authEgp, db);
    const egpLedger: any = await db
      .selectFrom('customer_ledger' as any)
      .selectAll()
      .where('customer_id', '=', 2)
      .executeTakeFirst();
    assert.equal(Number(egpLedger.amount), 100.13);

    // Zero writes nothing.
    await svc.addCustomerOpeningBalance(3, 0, authKwd, db);
    const zeroRows: any[] = await db
      .selectFrom('customer_ledger' as any)
      .selectAll()
      .where('customer_id', '=', 3)
      .execute();
    assert.equal(zeroRows.length, 0);

    console.log('Opening balance book precision tests passed.');
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
