/*
New file: backend/test/critical/wht-base-excludes-vat.spec.ts
Pins the withholding-tax extraction base (INV-WHT-BASE-EXCLUDES-VAT).

THE GAP: extractFromPurchases computed the withholding base as
subtotal minus discount without ever reading the bill's VAT.
For a tax-inclusive bill, subtotal already contains the VAT, so
the withholding was charged on the VAT itself — a 1140 bill
(1000 base + 140 VAT) withheld on 1140 instead of 1000.

THE RULE: the base is the pre-VAT amount — the stored
tax_amount is removed for tax-inclusive bills only; exclusive
bills already store subtotal pre-VAT. Amounts round at the
tenant's book digits (a KWD 0.001 of withholding survives
instead of rounding to cents). The 300 threshold keeps applying
to the extracted base.

WHAT THIS PINS, driving the REAL extractFromPurchases on PGlite
(KWD tenant, 1% goods rate):
- Inclusive bill 1140 (tax 140) -> base 1000, tax 10.
- Exclusive bill 1000 (tax 140) -> base 1000, tax 10.
- Inclusive bill 310 (tax 20) -> base 290, below threshold,
  skipped entirely.
- Inclusive bill 1114.125 (tax 114) -> base 1000.125,
  tax 10.001 at 3 decimals.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { WithholdingTaxService } from '../../src/modules/accounting/services/withholding-tax.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const service = new WithholdingTaxService(db, {} as never);

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text, metadata jsonb);
      CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, supplier_id bigint, status text, created_at timestamptz, subtotal numeric, discount numeric, tax_amount numeric, prices_include_tax boolean, doc_no text);
      CREATE TABLE withholding_tax_transactions (id bigserial PRIMARY KEY, tenant_id text, direction text, source_type text, source_id bigint, extraction_key text, invoice_number text, invoice_date text, partner_type text, partner_id bigint, partner_name text, tax_id_number text, wht_type text, wht_rate numeric, base_amount numeric, tax_amount numeric, quarter text, tax_year int, status text, notes text, created_by bigint);
      INSERT INTO settings VALUES ('t1','currency','KWD');
      INSERT INTO suppliers VALUES (5,'t1','Supplier Co','{"companyName":"Supplier Co","taxNumber":"123"}'::jsonb);
      INSERT INTO purchases VALUES (1,'t1',5,'posted','2026-10-15',1140,0,140,true,'PUR-1');
      INSERT INTO purchases VALUES (2,'t1',5,'posted','2026-10-15',1000,0,140,false,'PUR-2');
      INSERT INTO purchases VALUES (3,'t1',5,'posted','2026-10-15',310,0,20,true,'PUR-3');
      INSERT INTO purchases VALUES (4,'t1',5,'posted','2026-10-15',1114.125,0,114,true,'PUR-4');
    `);

    const result = await service.extractFromPurchases(auth, {
      fromDate: '2026-10-01',
      toDate: '2026-10-31',
      defaultWhtType: 'goods',
      defaultWhtRate: 1,
    } as never);
    assert.equal(result.extracted_count, 3);
    assert.equal(result.total_tax_added, 30.001);

    const rows = await pg.query<{ source_id: number; base_amount: string; tax_amount: string }>(
      'SELECT source_id, base_amount::text, tax_amount::text FROM withholding_tax_transactions ORDER BY source_id',
    );
    assert.deepEqual(
      rows.rows.map((r) => [Number(r.source_id), Number(r.base_amount), Number(r.tax_amount)]),
      [
        [1, 1000, 10],
        [2, 1000, 10],
        [4, 1000.125, 10.001],
      ],
    );

    console.log('WHT base excludes VAT tests passed.');
  } finally {
    await db.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
