/*
New file: backend/test/critical/quotation-convert-money.spec.ts
Pins R6-E (INV-REST-SALE-MONEY-TRUTH-2): quotation conversion
recomputes its money from the lines, never trusting the stored
total as the payment amount — the same stored-total poisoning
R4-A fixed for sales orders (sales-orders.service.ts:883-902).

WHAT THIS PINS, driving the REAL QuotationsService.convertToSale
on PGlite with a capturing createSale stub (the established
conversion-spec precedent — no harness runs a full successful
createSale), plus the REAL money helper:
- A stored total_amount INFLATED vs the recomputed total throws
  QUOTATION_TOTAL_MISMATCH before any sale is created (createSale
  uncalled, no sale row, the 'converting' claim reverted to the
  previous status).
- A stored total DEFLATED vs the recomputed total throws the same
  (today it would post as partial credit or throw
  INVALID_PAID_AMOUNT downstream).
- A stored total equal to the recomputed total (within 0.001)
  converts, and the cash payment leg equals the RECOMPUTED total
  (asserted from the captured sale payload, never from the stored
  value). A stored total within tolerance (100.0005 vs 100)
  converts; outside tolerance it throws.
- Per-line stored totals stale but qty/price/discount consistent
  still convert (per-line totals are inert display data at
  conversion, the same rule as the sales-order path).
- Helper level: assertQuotationMoney throws
  QUOTATION_TOTAL_MISMATCH (never SALES_ORDER_TOTAL_MISMATCH)
  on a doctored total and passes within tolerance; the recompute
  folds line discounts into the header discount exactly like the
  sales-order helper.

NOT PINNED HERE: the integrated real-createSale path
(journal/stock posting inside the sale transaction) and
two-connection concurrency — the same deferred items as the
conversion-lifecycle-races spec. A mismatch leaves the
'processing' idempotency row exactly like a discount mismatch
does on the sales-order path (the assert sits after the
reservation); a retry proceeds after the stuck threshold.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { QuotationsService } from '../../src/modules/sales/services/quotations.service';
import { recomputeSalesOrderMoney, assertQuotationMoney } from '../../src/modules/sales/helpers/sales-order-money.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: [] } as unknown as AuthContext;

type QuoteItem = { quantity: number; unitPrice: number; discount?: number; total?: number };

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE branches (id bigserial PRIMARY KEY, tenant_id text NOT NULL, default_stock_location_id bigint);
    CREATE TABLE products (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, name text NOT NULL, stock_qty numeric NOT NULL DEFAULT 0, reserved_qty numeric NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, product_id bigint NOT NULL, branch_id bigint, location_id bigint, qty numeric NOT NULL DEFAULT 0, reserved_qty numeric NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW());
    CREATE TABLE quotations (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, quotation_number text NOT NULL, customer_id bigint, customer_name text NOT NULL DEFAULT '', customer_phone text, customer_address text, branch_id bigint, subtotal numeric NOT NULL DEFAULT 0, discount_amount numeric NOT NULL DEFAULT 0, tax_amount numeric NOT NULL DEFAULT 0, total_amount numeric NOT NULL DEFAULT 0, valid_until timestamptz, status text NOT NULL, sale_id bigint, notes text, terms_conditions text, created_by bigint, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW());
    CREATE TABLE quotation_items (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, quotation_id bigint NOT NULL, product_id bigint NOT NULL, product_name text NOT NULL DEFAULT '', unit_name text, quantity numeric NOT NULL DEFAULT 0, unit_price numeric NOT NULL DEFAULT 0, discount numeric NOT NULL DEFAULT 0, total numeric NOT NULL DEFAULT 0, notes text, created_at timestamptz NOT NULL DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, idempotency_key text NOT NULL, operation_type text NOT NULL, status text NOT NULL, request_hash text NOT NULL, document_id text, response_payload text, error_code text, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(), completed_at timestamptz);
  `);
  await db.insertInto('branches').values({ id: 1, tenant_id: 't1', default_stock_location_id: 10 } as any).execute();
  await db.insertInto('products').values({ id: 1, tenant_id: 't1', account_id: 'a1', name: 'Widget', stock_qty: 100, reserved_qty: 0 } as any).execute();
  await db.insertInto('product_location_stock').values({ tenant_id: 't1', account_id: 'a1', product_id: 1, branch_id: 1, location_id: 10, qty: 100, reserved_qty: 0 } as any).execute();
  return db;
}

async function seedQuotation(
  db: Kysely<Database>,
  id: number,
  opts: { status?: string; discount?: number; tax?: number; total: number; items: QuoteItem[] },
): Promise<void> {
  await db.insertInto('quotations').values({
    id, tenant_id: 't1', account_id: 'a1', quotation_number: `Q-${id}`, customer_name: 'Cust',
    branch_id: 1, discount_amount: opts.discount ?? 0, tax_amount: opts.tax ?? 0,
    total_amount: opts.total, status: opts.status ?? 'draft', updated_at: new Date(),
  } as any).execute();
  for (const item of opts.items) {
    await db.insertInto('quotation_items').values({
      tenant_id: 't1', account_id: 'a1', quotation_id: id, product_id: 1,
      quantity: item.quantity, unit_price: item.unitPrice, discount: item.discount ?? 0,
      total: item.total ?? item.quantity * item.unitPrice - (item.discount ?? 0),
    } as any).execute();
  }
}

async function quoteRow(db: Kysely<Database>, id: number): Promise<{ status: string; saleId: number | null }> {
  const row = await db.selectFrom('quotations').select(['status', 'sale_id']).where('id', '=', id).executeTakeFirstOrThrow();
  return { status: String(row.status), saleId: row.sale_id };
}

async function main(): Promise<void> {
  // Helper level: the recompute + the quotation-named assert.
  const lines = [
    { quantity: 2, unitPrice: 50, discount: 5, total: 95 },
    { quantity: 1, unitPrice: 30, discount: 5, total: 25 },
  ];
  const recomputed = recomputeSalesOrderMoney(lines, 10, 16.8);
  assert.equal(recomputed.subtotal, 130);
  assert.equal(recomputed.total, 136.8);
  assertQuotationMoney(recomputed, { total: 136.8 });
  assertQuotationMoney(recomputed, { total: 136.8005 });
  assert.throws(
    () => assertQuotationMoney(recomputed, { total: 150 }),
    (err: any) => err.code === 'QUOTATION_TOTAL_MISMATCH',
  );
  assert.throws(
    () => assertQuotationMoney(recomputed, { total: 120 }),
    (err: any) => err.code === 'QUOTATION_TOTAL_MISMATCH',
  );
  assert.throws(
    () => assertQuotationMoney(recomputed, { total: 136.81 }),
    (err: any) => err.code === 'QUOTATION_TOTAL_MISMATCH',
  );

  // Service level: the real convertToSale with a capturing stub.
  const db = await makeDb();
  try {
    let calls = 0;
    let nextSaleId = 500;
    let lastPayload: any = null;
    const stubSalesWrite: any = {
      createSale: async (payload: any) => {
        calls += 1;
        lastPayload = payload;
        const id = nextSaleId;
        nextSaleId += 1;
        return { sale: { id } };
      },
    };
    const quotations = new QuotationsService(db as any, stubSalesWrite);
    // Two lines, line discounts 5 + 5, header discount 10, tax
    // 16.8 -> recomputed total 136.8 (gross subtotal 130).
    const honestItems: QuoteItem[] = [
      { quantity: 2, unitPrice: 50, discount: 5 },
      { quantity: 1, unitPrice: 30, discount: 5 },
    ];

    // 1. Stored total INFLATED (150 vs 136.8) -> throws before any
    // sale is created; the claim reverts to the previous status.
    await seedQuotation(db, 1, { total: 150, discount: 10, tax: 16.8, items: honestItems });
    const callsBefore1 = calls;
    await assert.rejects(
      () => quotations.convertToSale(1, AUTH),
      (err: any) => err.code === 'QUOTATION_TOTAL_MISMATCH',
    );
    assert.equal(calls, callsBefore1, 'createSale must not run on a mismatched total');
    assert.deepEqual(await quoteRow(db, 1), { status: 'draft', saleId: null });

    // 2. Stored total DEFLATED (120 vs 136.8) -> the same throw
    // (at base this posted as partial credit / INVALID_PAID_AMOUNT).
    await seedQuotation(db, 2, { total: 120, discount: 10, tax: 16.8, items: honestItems });
    const callsBefore2 = calls;
    await assert.rejects(
      () => quotations.convertToSale(2, AUTH),
      (err: any) => err.code === 'QUOTATION_TOTAL_MISMATCH',
    );
    assert.equal(calls, callsBefore2);
    assert.deepEqual(await quoteRow(db, 2), { status: 'draft', saleId: null });

    // 3. Stored total honest (136.8) -> converts, and the cash
    // payment leg equals the RECOMPUTED total.
    await seedQuotation(db, 3, { total: 136.8, discount: 10, tax: 16.8, items: honestItems });
    const converted: any = await quotations.convertToSale(3, AUTH);
    assert.equal(Number(converted.saleId), 500);
    assert.equal(calls, callsBefore2 + 1);
    assert.deepEqual(await quoteRow(db, 3), { status: 'converted', saleId: 500 });
    assert.equal(lastPayload.payments.length, 1);
    assert.equal(lastPayload.payments[0].paymentChannel, 'cash');
    assert.equal(Number(lastPayload.payments[0].amount), 136.8);

    // 4. Stored total within tolerance (136.8005) converts; the
    // payment is still the recomputed 136.8, not the stored value.
    await seedQuotation(db, 4, { total: 136.8005, discount: 10, tax: 16.8, items: honestItems });
    const converted4: any = await quotations.convertToSale(4, AUTH);
    assert.equal(Number(converted4.saleId), 501);
    assert.equal(Number(lastPayload.payments[0].amount), 136.8);

    // 5. Per-line stored totals stale (9999) but qty/price/
    // discount consistent -> still converts (per-line totals are
    // inert display data at conversion).
    await seedQuotation(db, 5, {
      total: 136.8, discount: 10, tax: 16.8,
      items: [
        { quantity: 2, unitPrice: 50, discount: 5, total: 9999 },
        { quantity: 1, unitPrice: 30, discount: 5, total: 9999 },
      ],
    });
    const converted5: any = await quotations.convertToSale(5, AUTH);
    assert.equal(Number(converted5.saleId), 502);
    assert.equal(Number(lastPayload.payments[0].amount), 136.8);

    // 6. Source pins: the quotation conversion recomputes and
    // asserts with the quotation-named code, and never uses the
    // sales-order error name for a quotation.
    const quoteSource = readFileSync(resolve(__dirname, '../../src/modules/sales/services/quotations.service.ts'), 'utf8');
    const convertSlice = quoteSource.slice(quoteSource.indexOf('async convertToSale'));
    assert.ok(convertSlice.includes('recomputeSalesOrderMoney'), 'quotation conversion must recompute its money from the lines');
    assert.ok(convertSlice.includes('assertQuotationMoney'), 'quotation conversion must assert with the quotation-named assert');
    assert.ok(convertSlice.includes('recomputedQuotationMoney.total'), 'the cash payment must come from the recomputed total');
    assert.ok(!convertSlice.includes('SALES_ORDER_TOTAL_MISMATCH'), 'a quotation must never throw the sales-order error name');
    const helperSource = readFileSync(resolve(__dirname, '../../src/modules/sales/helpers/sales-order-money.helper.ts'), 'utf8');
    assert.ok(helperSource.includes('QUOTATION_TOTAL_MISMATCH'), 'the helper must define the quotation-named error');
  } finally {
    await db.destroy();
  }
  console.log('Quotation convert money tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
