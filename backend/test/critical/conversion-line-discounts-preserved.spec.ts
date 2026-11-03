/*
New file: backend/test/critical/conversion-line-discounts-preserved.spec.ts
Pins INV-CONVERSION-LINE-DISCOUNTS-PRESERVED: per-line discounts survive
order and quotation conversion exactly, and inconsistent stored discount
rows fail closed before any sale is created.

THE DEFECT (old code): convertToSale in sales-orders.service.ts and
quotations.service.ts mapped each line's `discount` into the sale
payload, but normalizeSalePayload (sales-payload.helper.ts) had no
per-item discount field, so the discount was silently discarded and
only the header discount_amount survived. A sale converted from an
order with two lines discounted 5.00 each and no header discount
posted 10.00 MORE than the total the customer agreed.

SETTLED SHAPE (from the code, not invented):
- Exact carry, not a fold. The conversion sends a NEW per-item field
  `lineDiscount` — a per-line TOTAL discount, the same unit the
  dashboard forms store in sales_order_items.discount /
  quotation_items.discount (CreateSalesOrderPage.tsx: line total =
  max(0, qty x price - discount); CreateQuotationPage.tsx: same).
  buildPreparedSaleItem subtracts it from that line's gross total
  BEFORE the header discount is allocated over the lines, so per-line
  net/tax allocation stays exact. Folding into the header discount
  was rejected: the forms already FOLD line discounts into
  discount_amount (discountAmount = itemsDiscountTotal +
  globalDiscountAmount), so a fold would double-count every
  frontend-produced row.
- The legacy per-item `discount` field is deliberately NOT read by
  normalizeSalePayload: storefront conversion still sends
  `discount: 0` per item and van pre-sales conversion still sends its
  own per-item `discount`, and mapping that field would silently
  change their totals. Those two paths keep today's dropped-field
  behaviour (named follow-up, untouched by this package).
- Reconciliation (resolveConversionDiscounts, sales-write.helper.ts):
  the stored total_amount is client-supplied VERBATIM at order /
  quotation creation (createOrder stores dto totals directly,
  sales-orders.service.ts:159; createQuotation likewise,
  quotations.service.ts:91), so it is NEVER the reconciliation
  target. Instead the stored rows are reconciled against each other:
  each line discount is finite, >= 0 and <= its gross total; the
  header discount_amount equals the line discounts plus a
  non-negative global discount, which becomes the payload's header
  discount. The stored per-line total is deliberately NOT
  reconciled: creation stores it verbatim, the DTOs are plain
  interfaces with no runtime validation, and the column defaults
  to 0, so a total-0 row with a real gross total is a producible
  shape and conversion never reads item.total — the sale is
  recomputed from quantity, unit_price and discount alone.
  Any inconsistency throws CONVERSION_DISCOUNT_MISMATCH before
  createSale runs. Tolerance is 0.001 (one minor unit at 3dp, the
  finest book digits): rows are compared with each other, never with
  settings, and dashboard float hair sits far below it. For sales
  orders the check sits INSIDE the try whose catch reverts the
  'converting' claim, so a reconciliation failure returns the order
  to 'confirmed' instead of stranding it.
- The discount gate counts line discounts too: createSale and
  updateSale add the line-discount total to the gated amount
  (conversion re-grants the order's discounts, and the header
  discount was already gated the same way). POS payloads never send
  lineDiscount, so direct sales are unchanged.
- Payment terms (cash forcing) and conversion lifecycle / claims /
  idempotency are separate packages (P6b/P6c) and are untouched;
  the payments leg still carries the stored total_amount as today.

WHAT THIS PINS, driving the REAL convertToSale calls for both
services on PGlite with a capturing createSale stub (the real
createSale needs the full posting/finance harness — an acceptance
concern), plus the REAL seam (normalize -> buildPreparedSaleItem ->
computeInvoiceTotals -> roundSaleInvoiceTotals -> allocation):
1. Sales order, line discounts only: payload carries lineDiscount
   per line and header discount 0; the seam totals equal the agreed
   order total exactly, with per-line nets exact.
2. Quotation, line + global discounts: header discount is the
   global remainder only; seam totals equal the agreed total.
3. Header-discount-only order: unchanged — payload discount is the
   full header amount, lineDiscounts are 0, totals exact.
4. Mismatch (header amount smaller than the line discounts):
   rejects CONVERSION_DISCOUNT_MISMATCH, createSale is not called,
   the order returns to 'confirmed' with no sale.
5. Over-discount line (discount > gross): rejects, no sale created.
6. Stale stored line total is ignored: conversion recomputes from
   quantity, unit_price and discount, so a stale total never blocks
   a correct conversion.
7. 3dp seam: a 3-decimal line discount rounds exactly at book
   digits and allocation does not throw.
8. Legacy `discount` field is ignored by normalization, and an
   over-gross lineDiscount fails closed in buildPreparedSaleItem
   with INVALID_DISCOUNT.

Deliberately NOT driven here: the integrated real-createSale path
(journal legs for a converted sale) and live-Postgres acceptance —
both remain deferred until the first real tenant. The sale_items
insert stores the net line_total; the conversion discount itself
stays recoverable from the source order/quotation rows and is not
duplicated into the sale row.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { SalesOrdersService } from '../../src/modules/sales/services/sales-orders.service';
import { QuotationsService } from '../../src/modules/sales/services/quotations.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { normalizeSalePayload } from '../../src/modules/sales/helpers/sales-payload.helper';
import { buildPreparedSaleItem, roundSaleInvoiceTotals } from '../../src/modules/sales/helpers/sales-write.helper';
import { computeInvoiceTotals } from '../../src/common/utils/invoice-totals';
import { allocateInvoiceDiscount } from '../../src/modules/sales/engines/invoice-discount.engine';

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: [] } as unknown as AuthContext;

/** Recomputes the sale totals from a captured conversion payload through the real seam. */
function seamTotals(payload: any, digits: 2 | 3, taxRate: number) {
  const normalized = normalizeSalePayload(payload);
  const prepared = normalized.items.map((item) =>
    buildPreparedSaleItem(
      { id: item.productId, name: 'P', stock_qty: 1000, cost_price: 10 } as any,
      item,
      { moneyDigits: digits },
    ),
  );
  const subtotal = prepared.reduce((sum, item) => sum + item.lineTotal, 0);
  const totals = roundSaleInvoiceTotals(computeInvoiceTotals(subtotal, normalized.discount, taxRate, false), digits);
  const itemOnlyTax = roundSaleInvoiceTotals(computeInvoiceTotals(subtotal, normalized.discount, taxRate, false), digits).taxAmount;
  const allocated = allocateInvoiceDiscount({
    lines: prepared.map((item) => ({ lineTotal: item.lineTotal, qty: item.qty })),
    invoiceDiscount: normalized.discount,
    invoiceTax: itemOnlyTax,
    pricesIncludeTax: false,
    digits,
  });
  return { normalized, prepared, subtotal, ...totals, allocated };
}

async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE branches (id bigserial PRIMARY KEY, tenant_id text NOT NULL, default_stock_location_id bigint);
      CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, order_number text NOT NULL, customer_id bigint, customer_name text NOT NULL DEFAULT '', customer_phone text, customer_address text, notes text, branch_id bigint, subtotal numeric NOT NULL DEFAULT 0, discount_amount numeric NOT NULL DEFAULT 0, tax_amount numeric NOT NULL DEFAULT 0, total_amount numeric NOT NULL DEFAULT 0, status text NOT NULL, sale_id bigint, updated_at timestamptz NOT NULL DEFAULT NOW(), created_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE sales_order_items (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, sales_order_id bigint NOT NULL, product_id bigint NOT NULL, product_name text NOT NULL DEFAULT '', unit_name text, quantity numeric NOT NULL DEFAULT 0, reserved_quantity numeric NOT NULL DEFAULT 0, delivered_quantity numeric NOT NULL DEFAULT 0, unit_price numeric NOT NULL DEFAULT 0, discount numeric NOT NULL DEFAULT 0, total numeric NOT NULL DEFAULT 0, notes text, created_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE quotations (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, quotation_number text NOT NULL, customer_id bigint, customer_name text NOT NULL DEFAULT '', customer_phone text, customer_address text, branch_id bigint, subtotal numeric NOT NULL DEFAULT 0, discount_amount numeric NOT NULL DEFAULT 0, tax_amount numeric NOT NULL DEFAULT 0, total_amount numeric NOT NULL DEFAULT 0, valid_until timestamptz, status text NOT NULL, sale_id bigint, notes text, terms_conditions text, created_by bigint, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE quotation_items (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, quotation_id bigint NOT NULL, product_id bigint NOT NULL, product_name text NOT NULL DEFAULT '', unit_name text, quantity numeric NOT NULL DEFAULT 0, unit_price numeric NOT NULL DEFAULT 0, discount numeric NOT NULL DEFAULT 0, total numeric NOT NULL DEFAULT 0, notes text, created_at timestamptz NOT NULL DEFAULT NOW());
    `);

    await db.insertInto('branches').values({ id: 1, tenant_id: 't1', default_stock_location_id: 10 } as any).execute();

    let calls = 0;
    let lastPayload: any = null;
    const stubSalesWrite: any = {
      createSale: async (payload: any) => {
        calls += 1;
        lastPayload = payload;
        return { sale: { id: 99 } };
      },
    };
    const orders = new SalesOrdersService(db as any, stubSalesWrite);
    const quotations = new QuotationsService(db as any, stubSalesWrite);

    async function seedOrder(id: number, rows: Array<{ quantity: number; unitPrice: number; discount: number; total: number }>, discountAmount: number, totalAmount: number): Promise<void> {
      await db.insertInto('sales_orders').values({ id, tenant_id: 't1', account_id: 'a1', order_number: `SO-${id}`, customer_name: 'Cust', branch_id: 1, discount_amount: discountAmount, total_amount: totalAmount, status: 'confirmed' } as any).execute();
      for (const row of rows) {
        await db.insertInto('sales_order_items').values({ tenant_id: 't1', account_id: 'a1', sales_order_id: id, product_id: 1, quantity: row.quantity, unit_price: row.unitPrice, discount: row.discount, total: row.total } as any).execute();
      }
    }

    async function seedQuotation(id: number, rows: Array<{ quantity: number; unitPrice: number; discount: number; total: number }>, discountAmount: number, totalAmount: number): Promise<void> {
      await db.insertInto('quotations').values({ id, tenant_id: 't1', account_id: 'a1', quotation_number: `Q-${id}`, customer_name: 'Cust', branch_id: 1, discount_amount: discountAmount, total_amount: totalAmount, status: 'draft' } as any).execute();
      for (const row of rows) {
        await db.insertInto('quotation_items').values({ tenant_id: 't1', account_id: 'a1', quotation_id: id, product_id: 1, quantity: row.quantity, unit_price: row.unitPrice, discount: row.discount, total: row.total } as any).execute();
      }
    }

    // 1. Sales order, line discounts only: 2x50-5=95 and 1x30-5=25.
    // Gross 130, line discounts 10, header 0; net 120 + 14% tax 16.80 = 136.80.
    await seedOrder(1, [
      { quantity: 2, unitPrice: 50, discount: 5, total: 95 },
      { quantity: 1, unitPrice: 30, discount: 5, total: 25 },
    ], 10, 136.8);
    const ok1 = await orders.convertToSale(1, AUTH);
    assert.equal(Number((ok1 as any).saleId), 99);
    assert.equal(calls, 1);
    assert.deepEqual(lastPayload.items.map((item: any) => item.lineDiscount), [5, 5]);
    assert.equal(lastPayload.discount, 0);
    assert.equal('discount' in lastPayload.items[0], false);
    const seam1 = seamTotals({ ...lastPayload, taxRate: 14, pricesIncludeTax: false }, 2, 14);
    assert.equal(seam1.subtotal, 120);
    assert.equal(seam1.taxAmount, 16.8);
    assert.equal(seam1.total, 136.8);
    assert.deepEqual(seam1.allocated.map((line) => line.netLineTotal), [95, 25]);
    assert.deepEqual(seam1.allocated.map((line) => line.allocatedTax), [13.3, 3.5]);
    assert.equal(seam1.allocated.reduce((sum, line) => sum + line.netLineTotal + line.allocatedTax, 0), 136.8);

    // 2. Quotation, line + global: 3x20-6=54 and 2x40-0=80; header 11 = 6 line + 5 global.
    // Net 134 - 5 = 129 + 14% tax 18.06 = 147.06.
    await seedQuotation(1, [
      { quantity: 3, unitPrice: 20, discount: 6, total: 54 },
      { quantity: 2, unitPrice: 40, discount: 0, total: 80 },
    ], 11, 147.06);
    const ok2 = await quotations.convertToSale(1, AUTH);
    assert.equal(Number((ok2 as any).saleId), 99);
    assert.equal(calls, 2);
    assert.deepEqual(lastPayload.items.map((item: any) => item.lineDiscount), [6, 0]);
    assert.equal(lastPayload.discount, 5);
    const seam2 = seamTotals({ ...lastPayload, taxRate: 14, pricesIncludeTax: false }, 2, 14);
    assert.equal(seam2.subtotal, 134);
    assert.equal(seam2.taxAmount, 18.06);
    assert.equal(seam2.total, 147.06);

    // 3. Header-discount-only order is unchanged: 1x100, header 7.
    // Net 93 + 14% tax 13.02 = 106.02.
    await seedOrder(2, [{ quantity: 1, unitPrice: 100, discount: 0, total: 100 }], 7, 106.02);
    await orders.convertToSale(2, AUTH);
    assert.equal(calls, 3);
    assert.deepEqual(lastPayload.items.map((item: any) => item.lineDiscount), [0]);
    assert.equal(lastPayload.discount, 7);
    const seam3 = seamTotals({ ...lastPayload, taxRate: 14, pricesIncludeTax: false }, 2, 14);
    assert.equal(seam3.total, 106.02);

    // 4. Mismatch: line discounts 10 but header amount 0 — fails closed,
    // createSale is not called, the order returns to 'confirmed'.
    await seedOrder(3, [
      { quantity: 2, unitPrice: 50, discount: 5, total: 95 },
      { quantity: 1, unitPrice: 30, discount: 5, total: 25 },
    ], 0, 136.8);
    await assert.rejects(
      () => orders.convertToSale(3, AUTH),
      (error: any) => error.code === 'CONVERSION_DISCOUNT_MISMATCH',
    );
    assert.equal(calls, 3);
    const status4 = await db.selectFrom('sales_orders').select(['status', 'sale_id']).where('id', '=', 3).executeTakeFirstOrThrow();
    assert.equal(String(status4.status), 'confirmed');
    assert.equal(status4.sale_id, null);

    // 5. Over-discount line: discount 150 on a gross of 100 — fails closed.
    await seedOrder(4, [{ quantity: 1, unitPrice: 100, discount: 150, total: 0 }], 150, 0);
    await assert.rejects(
      () => orders.convertToSale(4, AUTH),
      (error: any) => error.code === 'CONVERSION_DISCOUNT_MISMATCH',
    );
    assert.equal(calls, 3);

    // 6. Stale stored line total (50 stored, 45 recomputed) is
    // ignored: the sale is recomputed from qty/price/discount, so
    // conversion succeeds and the seam total is exact (45 + 14%).
    await seedQuotation(2, [{ quantity: 1, unitPrice: 50, discount: 5, total: 50 }], 5, 51.3);
    const ok6 = await quotations.convertToSale(2, AUTH);
    assert.equal(Number((ok6 as any).saleId), 99);
    assert.equal(calls, 4);
    assert.deepEqual(lastPayload.items.map((item: any) => item.lineDiscount), [5]);
    assert.equal(lastPayload.discount, 0);
    const seam6 = seamTotals({ ...lastPayload, taxRate: 14, pricesIncludeTax: false }, 2, 14);
    assert.equal(seam6.total, 51.3);

    // 7. 3dp seam: 1 x 20.025 - 5.005 = 15.02; 10% tax 1.502; total 16.522.
    const seam7 = seamTotals(
      { branchId: 1, items: [{ productId: 1, qty: 1, price: 20.025, lineDiscount: 5.005 }], discount: 0, taxRate: 10, pricesIncludeTax: false },
      3,
      10,
    );
    assert.equal(seam7.prepared[0].lineTotal, 15.02);
    assert.equal(seam7.taxAmount, 1.502);
    assert.equal(seam7.total, 16.522);

    // 8. Legacy per-item `discount` is ignored by normalization, and an
    // over-gross lineDiscount fails closed in buildPreparedSaleItem.
    const legacy = normalizeSalePayload({
      branchId: 1,
      items: [{ productId: 1, qty: 1, price: 50, discount: 5 } as any],
      discount: 0,
    } as any);
    assert.equal(legacy.items[0].lineDiscount, undefined);
    const legacyPrepared = buildPreparedSaleItem(
      { id: 1, name: 'P', stock_qty: 1000, cost_price: 10 } as any,
      legacy.items[0],
      { moneyDigits: 2 },
    );
    assert.equal(legacyPrepared.lineTotal, 50);
    assert.throws(
      () =>
        buildPreparedSaleItem(
          { id: 1, name: 'P', stock_qty: 1000, cost_price: 10 } as any,
          { ...legacy.items[0], lineDiscount: 60 },
          { moneyDigits: 2 },
        ),
      (error: any) => error.code === 'INVALID_DISCOUNT',
    );

    console.log('conversion-line-discounts-preserved: all cases passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
