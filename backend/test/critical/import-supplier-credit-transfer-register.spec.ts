/*
New file: backend/test/critical/import-supplier-credit-transfer-register.spec.ts
Pins the supplier-credit transfer register read path
(INV-IMPORT-SUPPLIER-CREDIT-TRANSFER-REGISTER).

WHAT WAS WRONG (live re-test 2026-11-09 R5, deployed
4d811676): the supplier-credit screen's KPIs were real
(factory debt 353,326.00 EGP, cash 2,393.80, 503 factories
registered) but the transfer register read "0 حوالة مسجلة"
despite the posted supplier payment ZPV-261108-000004
(JE-00015028) existing.

ROOT CAUSE (grounded): the register reads
GET /api/import-sales/foreign-transfers ->
listForeignTransfers, which filtered
`supplier_payments.doc_no LIKE 'FT-%'`. Only payments
recorded through the foreign-transfer screen carry an FT-
doc_no; the canonical purchases path
(createSupplierPayment) numbers its rows ZPV-YYMMDD-NNNN
and stores a positive EGP amount with amount_foreign NULL.
The FT- vs ZPV- prefix is a numbering artifact of the
recording screen, not a property of the payment — so every
payment posted outside this screen was invisible here.

WHAT THIS PINS, driving the real listForeignTransfers on
PGlite:
- A ZPV payment (purchases-path shape: positive EGP amount,
  amount_foreign NULL, currency EGP) is listed, with its
  doc_no, supplier name and EGP amount.
- An FT payment (foreign-transfer shape: negative EGP
  amount, amount_foreign set, currency USD) is still listed,
  and its EGP amount is the absolute value — the screen only
  renders egpAmount > 0, so the stored negative would have
  rendered as '—'.
- A payment belonging to another tenant is never listed
  (tenant scoping is the only filter; the doc_no filter is
  gone, so this must be asserted explicitly).
- Ordering is newest first.

NOT PROVEN HERE (honest limit): the React table rendering
itself. What the backend proves is the read path: with the
endpoint returning the ZPV row, the screen's existing table
(which renders docNo / supplierName / amountEgp from exactly
these fields) shows it instead of the empty state.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text, balance numeric DEFAULT 0);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, amount numeric, amount_foreign numeric, note text, created_by bigint, payment_date timestamptz, currency text, exchange_rate numeric, forex_variance_egp numeric, proforma_invoice_id text, idempotency_key text, doc_no text, created_at timestamptz DEFAULT NOW());
    INSERT INTO suppliers VALUES (1, 't1', 'Factory A', 353326), (2, 't1', 'Factory B', 0), (3, 't2', 'Other Tenant Factory', 0);
  `);
  return db;
}

function makeService(db: Kysely<Database>): any {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  return new (ImportSalesService as any)(db, posting);
}

async function seedPayment(
  db: Kysely<Database>,
  row: {
    tenantId: string;
    supplierId: number;
    docNo: string;
    amount: number;
    amountForeign?: number | null;
    currency?: string;
    exchangeRate?: number;
    createdAt: string;
  },
): Promise<void> {
  await db.insertInto('supplier_payments' as never).values({
    tenant_id: row.tenantId,
    supplier_id: row.supplierId,
    doc_no: row.docNo,
    amount: row.amount,
    amount_foreign: row.amountForeign ?? null,
    note: 'live re-test probe',
    payment_date: row.createdAt,
    currency: row.currency ?? 'EGP',
    exchange_rate: row.exchangeRate ?? 1,
    created_at: row.createdAt,
  } as never).execute();
}

async function main(): Promise<void> {
  // Case 1: the live R5 probe — a ZPV payment posted through the
  // purchases path is listed with its doc_no, supplier and EGP amount.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedPayment(db, {
        tenantId: 't1', supplierId: 1, docNo: 'ZPV-261108-000004',
        amount: 1200, amountForeign: null, currency: 'EGP',
        createdAt: '2026-11-08T10:00:00Z',
      });
      const rows = await service.listForeignTransfers('t1');
      assert.equal(rows.length, 1, 'The posted ZPV supplier payment must appear in the register');
      assert.equal(rows[0].docNo, 'ZPV-261108-000004', 'The register row must carry the ZPV doc_no');
      assert.equal(rows[0].doc_no, 'ZPV-261108-000004', 'The snake_case doc_no alias must match too');
      assert.equal(rows[0].supplierName, 'Factory A', 'The register row must name the supplier');
      assert.equal(rows[0].amountEgp, 1200, 'The ZPV payment EGP amount must be listed as 1200');
      assert.equal(rows[0].amountForeign, null, 'A purchases-path payment has no foreign amount');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: an FT payment is still listed, and its stored negative
  // EGP amount is normalised to a positive magnitude for the screen.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedPayment(db, {
        tenantId: 't1', supplierId: 1, docNo: 'FT-7',
        amount: -5000, amountForeign: 100, currency: 'USD', exchangeRate: 50,
        createdAt: '2026-11-08T11:00:00Z',
      });
      const rows = await service.listForeignTransfers('t1');
      assert.equal(rows.length, 1, 'The FT transfer must still be listed');
      assert.equal(rows[0].docNo, 'FT-7', 'The FT doc_no must be listed');
      assert.equal(rows[0].amountForeign, 100, 'The FT foreign amount must be listed as 100');
      assert.equal(rows[0].amountEgp, 5000, 'The FT EGP amount must be the absolute value 5000, not -5000');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: both paths together, newest first; another tenant's
  // payment — even with a ZPV doc_no — is never listed.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedPayment(db, {
        tenantId: 't1', supplierId: 1, docNo: 'ZPV-261108-000004',
        amount: 1200, amountForeign: null, currency: 'EGP',
        createdAt: '2026-11-08T10:00:00Z',
      });
      await seedPayment(db, {
        tenantId: 't1', supplierId: 2, docNo: 'FT-8',
        amount: -2500, amountForeign: 50, currency: 'USD', exchangeRate: 50,
        createdAt: '2026-11-08T12:00:00Z',
      });
      await seedPayment(db, {
        tenantId: 't2', supplierId: 3, docNo: 'ZPV-261108-000009',
        amount: 999, amountForeign: null, currency: 'EGP',
        createdAt: '2026-11-08T13:00:00Z',
      });
      const rows = await service.listForeignTransfers('t1');
      assert.equal(rows.length, 2, 'Both tenant t1 payments must be listed and no other-tenant row');
      assert.equal(rows[0].docNo, 'FT-8', 'Newest payment first');
      assert.equal(rows[0].supplierName, 'Factory B', 'The FT row must name its supplier');
      assert.equal(rows[1].docNo, 'ZPV-261108-000004', 'Oldest payment last');
      assert.ok(
        rows.every((r: any) => r.docNo !== 'ZPV-261108-000009'),
        'Another tenant payment must never leak into this tenant register',
      );
    } finally {
      await db.destroy();
    }
  }

  console.log('Import supplier-credit transfer register tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
