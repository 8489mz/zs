/*
New file: backend/test/critical/pdc-subledger-balance-after.spec.ts
Style follows backend/test/critical/pdc-cheque-kwd.spec.ts
(PGlite + Kysely, imports production code, db.destroy() teardown).

WHAT THIS PINS: a PDC cheque action's subledger row records the
partner's running balance EXACTLY (INV-PDC-SUBLEDGER-BALANCE-AFTER).
Before this package, syncCustomerSubLedger/syncSupplierSubLedger
re-rounded the returned balance with toFixed(2), so on a 3-decimal
tenant the ledger's balance_after differed from the stored partner
balance by up to 0.005 on every cheque action, while the partner
balance itself (a SQL increment of book-digit amounts) kept the
third decimal. The fix copies the returned balance verbatim, the
same precedent syncPostedPartnerLedger already follows
(balance_after: Number(partner.balance), no rounding).

The spec drives the REAL private sync methods over PGlite with a
stub posting service (the sync methods never touch it). Storage is
pinned by migrations 0257/0258 (ledger balance_after scale 3), not
by this spec: the PGlite DDL below uses unbounded numerics, so a
storage regression would not fail here -- run the migrations,
don't just run the spec. The private toMoney(2dp) return-shaping
helper is deliberately untouched: it formats list/detail responses
only and never feeds a stored balance.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { PdcChequesService } from '../../src/modules/accounting/services/pdc-cheques.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const postingStub = {} as never;
  const service = new PdcChequesService(db, postingStub);
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const inTx = <T>(fn: (trx: any) => Promise<T>): Promise<T> => db.transaction().execute(fn);
  try {
    await pg.exec(`
      CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, balance numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, balance numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint,
        entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint,
        created_at timestamptz, created_by bigint, branch_id bigint, location_id bigint);
      CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint,
        entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint,
        created_at timestamptz, created_by bigint, branch_id bigint, location_id bigint);
      CREATE TABLE accounting_cheques (id bigint PRIMARY KEY, tenant_id text, last_action_date date, issue_date date);
      INSERT INTO customers VALUES (25, 't1', 10.000, now());
      INSERT INTO suppliers VALUES (7, 't1', 20.000, now());
      INSERT INTO accounting_cheques VALUES (1, 't1', '2026-10-05', '2026-10-01');
    `);

    const ledgerRow = async (table: string) => {
      const r = await pg.query<{ amount: string; balance_after: string }>(
        `SELECT amount, balance_after FROM ${table} ORDER BY id DESC LIMIT 1`,
      );
      return r.rows[0];
    };
    const partnerBalance = async (table: string, id: number) => {
      const r = await pg.query<{ balance: string }>(`SELECT balance FROM ${table} WHERE id=$1`, [id]);
      return r.rows[0].balance;
    };

    // Customer: 10.000 + 0.125 -> balance_after must be 10.125, not 10.13.
    await inTx((trx) => (service as any).syncCustomerSubLedger(trx, auth, 25, 0.125, 'receive', 'CHQ-1', 1));
    assert.equal(Number(await partnerBalance('customers', 25)), 10.125);
    const customerRow = await ledgerRow('customer_ledger');
    assert.equal(Number(customerRow.amount), 0.125);
    assert.equal(Number(customerRow.balance_after), 10.125);
    assert.equal(String(customerRow.balance_after), '10.125');

    // Second move on the same customer: 10.125 + 0.002 -> 10.127 exactly.
    // A 2dp re-round would freeze both rows at 10.13 and hide the drift.
    await inTx((trx) => (service as any).syncCustomerSubLedger(trx, auth, 25, 0.002, 'deposit', 'CHQ-1', 1));
    assert.equal(Number(await partnerBalance('customers', 25)), 10.127);
    assert.equal(String((await ledgerRow('customer_ledger')).balance_after), '10.127');

    // Supplier mirror: 20.000 - 0.125 -> balance_after 19.875, not 19.88.
    await inTx((trx) => (service as any).syncSupplierSubLedger(trx, auth, 7, -0.125, 'issue', 'CHQ-2', 1));
    assert.equal(Number(await partnerBalance('suppliers', 7)), 19.875);
    const supplierRow = await ledgerRow('supplier_ledger');
    assert.equal(Number(supplierRow.amount), -0.125);
    assert.equal(Number(supplierRow.balance_after), 19.875);
    assert.equal(String(supplierRow.balance_after), '19.875');

    console.log('pdc-subledger-balance-after: OK');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
