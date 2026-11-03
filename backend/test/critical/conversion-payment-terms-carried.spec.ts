/*
 * Conversion payment terms carried (INV-CONVERSION-PAYMENT-TERMS-CARRIED,
 * Slice 5 P6b, Batch 2 package 2).
 *
 * THE DEFECT: both convertToSale implementations hardcoded
 * paymentType/paymentChannel 'cash' and a single cash payment for the
 * full order total. A credit-terms order became a fully-paid cash
 * sale: no receivable, no customer-ledger entry, no credit-limit
 * check on the converted amount.
 *
 * SETTLED SHAPE (from the code, not invented):
 * - The only payment-terms data stored on a sales order today is the
 *   `sales_orders.payment_terms` column (migration 0199, written
 *   only by van pre-sales as 'cash' | 'credit'; dashboard orders
 *   never set it and the column defaults to 'cash'). Quotations
 *   carry no terms column at all, and neither document stores a
 *   partial/deposit/due-date field, so no partial shape can be
 *   carried — inventing one would fabricate terms never agreed.
 * - `resolveConversionPaymentTerms` maps the stored value onto the
 *   sale writer's own vocabulary: missing/blank => 'cash'
 *   (historical behaviour), 'cash' | 'credit' carry through, any
 *   other value throws CONVERSION_PAYMENT_TERMS_UNKNOWN before any
 *   sale is created. A credit payload is the sale writer's own
 *   full-credit shape (paymentType/paymentChannel 'credit', no
 *   payment lines), so createSale's EXISTING customer-required /
 *   credit-blocked / credit-limit checks consume it unchanged —
 *   those checks are deliberately NOT duplicated in conversion.
 * - The sales-order failure sits inside the claim try, so an
 *   unrecognised value reverts 'converting' to 'confirmed' exactly
 *   like a discount mismatch (P6a pattern). Quotations have no
 *   claim; a throw leaves the quotation unconverted.
 *
 * WHAT THIS DRIVES: the REAL convertToSale calls for both services
 * on PGlite with a capturing createSale stub (the real createSale
 * needs the full posting/finance harness — an acceptance concern,
 * same precedent as P6a), plus the REAL seam (normalize ->
 * buildPreparedSaleItem -> computeInvoiceTotals ->
 * roundSaleInvoiceTotals -> allocation) and the REAL normalize
 * gate for the no-customer credit case:
 * 1. Credit order: payload is the full-credit shape, customer
 *    carried, seam totals exact, normalize passes with a customer.
 * 2. Cash order: payload is byte-for-byte today's cash shape.
 * 3. Missing terms (NULL): cash shape — dashboard orders unchanged.
 * 4. Unrecognised terms: throws CONVERSION_PAYMENT_TERMS_UNKNOWN,
 *    createSale not called, order back to 'confirmed'.
 * 5. Credit order with no customer: the captured payload throws
 *    CREDIT_SALE_REQUIRES_CUSTOMER in real normalizeSalePayload —
 *    the first payment gate createSale runs (line 1098, before the
 *    customer/limit checks). Integrated enforcement is NOT driven
 *    here; the acceptance suite must cover it.
 * 6. Quotation: cash shape, identical to today's payload.
 * 7. Resolver units: whitespace/case tolerated, blank/missing is
 *    cash, non-strings and unknown values fail closed.
 * 8. Credit-limit wiring pin: the limit check exists at both
 *    create/edit debt sites and remainingDebt is the full total
 *    for a payments:[] credit payload. Wiring evidence only — the
 *    failing conversion itself is acceptance-deferred (case 5 note).
 * 9. Source pins + invariant pin.
 *
 * Deliberately NOT driven here: the integrated real-createSale path
 * (journal legs, customer-ledger posting, limit enforcement on a
 * live customer row) and live-Postgres acceptance — both remain
 * deferred until the first real tenant. Lifecycle/claims/
 * idempotency (P6c), per-line discounts (P6a, landed), storefront
 * conversion, and direct POS payment handling are untouched.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { SalesOrdersService } from '../../src/modules/sales/services/sales-orders.service';
import { QuotationsService } from '../../src/modules/sales/services/quotations.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { normalizeSalePayload } from '../../src/modules/sales/helpers/sales-payload.helper';
import { buildPreparedSaleItem, roundSaleInvoiceTotals, resolveConversionPaymentTerms } from '../../src/modules/sales/helpers/sales-write.helper';
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
      CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, order_number text NOT NULL, customer_id bigint, customer_name text NOT NULL DEFAULT '', customer_phone text, customer_address text, notes text, branch_id bigint, subtotal numeric NOT NULL DEFAULT 0, discount_amount numeric NOT NULL DEFAULT 0, tax_amount numeric NOT NULL DEFAULT 0, total_amount numeric NOT NULL DEFAULT 0, status text NOT NULL, sale_id bigint, payment_terms text, updated_at timestamptz NOT NULL DEFAULT NOW(), created_at timestamptz NOT NULL DEFAULT NOW());
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

    const rows = [
      { quantity: 2, unitPrice: 50, discount: 5, total: 95 },
      { quantity: 1, unitPrice: 30, discount: 0, total: 30 },
    ];

    async function seedOrder(
      id: number,
      paymentTerms: string | null,
      customerId: number | null,
    ): Promise<void> {
      await db.insertInto('sales_orders').values({
        id, tenant_id: 't1', account_id: 'a1', order_number: `SO-${id}`,
        customer_id: customerId, customer_name: 'Cust', branch_id: 1,
        discount_amount: 5, total_amount: 125, status: 'confirmed',
        payment_terms: paymentTerms,
      } as any).execute();
      for (const row of rows) {
        await db.insertInto('sales_order_items').values({
          tenant_id: 't1', account_id: 'a1', sales_order_id: id, product_id: 1,
          quantity: row.quantity, unit_price: row.unitPrice, discount: row.discount, total: row.total,
        } as any).execute();
      }
    }

    async function seedQuotation(id: number): Promise<void> {
      await db.insertInto('quotations').values({
        id, tenant_id: 't1', account_id: 'a1', quotation_number: `Q-${id}`,
        customer_name: 'Cust', branch_id: 1,
        discount_amount: 5, total_amount: 125, status: 'draft',
      } as any).execute();
      for (const row of rows) {
        await db.insertInto('quotation_items').values({
          tenant_id: 't1', account_id: 'a1', quotation_id: id, product_id: 1,
          quantity: row.quantity, unit_price: row.unitPrice, discount: row.discount, total: row.total,
        } as any).execute();
      }
    }

    async function orderStatus(id: number): Promise<string> {
      const row = await db.selectFrom('sales_orders').select('status').where('id', '=', id).executeTakeFirst();
      return String((row as any)?.status);
    }

    // 1. Credit order: full-credit shape, customer carried, seam totals exact.
    await seedOrder(1, 'credit', 7);
    const creditResult: any = await orders.convertToSale(1, AUTH);
    assert.equal(creditResult.saleId, 99);
    assert.equal(lastPayload.paymentType, 'credit');
    assert.equal(lastPayload.paymentChannel, 'credit');
    assert.deepEqual(lastPayload.payments, []);
    assert.equal(lastPayload.customerId, 7);
    assert.equal(calls, 1);
    const creditSeam = seamTotals(lastPayload, 2, 14);
    assert.equal(creditSeam.subtotal, 125);
    assert.equal(creditSeam.taxAmount, 17.5);
    assert.equal(creditSeam.total, 142.5);
    assert.equal(creditSeam.normalized.paymentType, 'credit');

    // 2. Cash order: byte-for-byte today's cash shape (stored total in the cash leg).
    await seedOrder(2, 'cash', 7);
    await orders.convertToSale(2, AUTH);
    assert.equal(lastPayload.paymentType, 'cash');
    assert.equal(lastPayload.paymentChannel, 'cash');
    assert.deepEqual(lastPayload.payments, [{ paymentChannel: 'cash', amount: 125 }]);

    // 3. Missing terms (NULL): cash shape — dashboard orders unchanged.
    await seedOrder(3, null, 7);
    await orders.convertToSale(3, AUTH);
    assert.equal(lastPayload.paymentType, 'cash');
    assert.equal(lastPayload.paymentChannel, 'cash');
    assert.deepEqual(lastPayload.payments, [{ paymentChannel: 'cash', amount: 125 }]);

    // 4. Unrecognised terms: fail closed, createSale not called, claim reverted.
    await seedOrder(4, 'card', 7);
    const callsBefore = calls;
    await assert.rejects(
      () => orders.convertToSale(4, AUTH),
      (err: any) => err?.code === 'CONVERSION_PAYMENT_TERMS_UNKNOWN',
    );
    assert.equal(calls, callsBefore, 'createSale must not be called on unrecognised terms');
    assert.equal(await orderStatus(4), 'confirmed');

    // 5. Credit order with no customer: the captured payload trips the
    // real normalize gate (the first payment gate createSale runs).
    await seedOrder(5, 'credit', null);
    await orders.convertToSale(5, AUTH);
    assert.equal(lastPayload.paymentType, 'credit');
    assert.equal(lastPayload.customerId, undefined);
    assert.throws(
      () => normalizeSalePayload(lastPayload),
      (err: any) => err?.code === 'CREDIT_SALE_REQUIRES_CUSTOMER',
    );

    // 6. Quotation: cash shape, identical to today's payload.
    await seedQuotation(1);
    await quotations.convertToSale(1, AUTH);
    assert.equal(lastPayload.paymentType, 'cash');
    assert.equal(lastPayload.paymentChannel, 'cash');
    assert.deepEqual(lastPayload.payments, [{ paymentChannel: 'cash', amount: 125 }]);

    // 7. Resolver units.
    assert.equal(resolveConversionPaymentTerms(' Cash '), 'cash');
    assert.equal(resolveConversionPaymentTerms('CREDIT'), 'credit');
    assert.equal(resolveConversionPaymentTerms(''), 'cash');
    assert.equal(resolveConversionPaymentTerms(null), 'cash');
    assert.equal(resolveConversionPaymentTerms(undefined), 'cash');
    assert.throws(
      () => resolveConversionPaymentTerms(42),
      (err: any) => err?.code === 'CONVERSION_PAYMENT_TERMS_UNKNOWN',
    );
    assert.throws(
      () => resolveConversionPaymentTerms('split'),
      (err: any) => err?.code === 'CONVERSION_PAYMENT_TERMS_UNKNOWN',
    );

    // 8. Credit-limit wiring pin (evidence, not behaviour proof): the
    // limit check exists at both debt sites and remainingDebt is the
    // full collectible total for a payments:[] credit payload, so the
    // check consumes exactly this shape.
    {
      const writer = readFileSync(
        resolve(__dirname, '../../src/modules/sales/services/sales-write.service.ts'),
        'utf8',
      );
      const limitSites = writer.split('CUSTOMER_CREDIT_LIMIT').length - 1;
      assert.ok(limitSites >= 2, `expected the credit-limit check at create + edit sites, found ${limitSites}`);
      assert.ok(writer.includes('remainingDebt = roundMoney(Math.max(0, collectibleTotal - paidAmount)'));
      assert.ok(writer.includes("if (remainingDebt > 0"));
    }

    // 9. Source pins: both conversions resolve terms through the one
    // resolver and build the payload from its result.
    {
      const ordersSource = readFileSync(
        resolve(__dirname, '../../src/modules/sales/services/sales-orders.service.ts'),
        'utf8',
      );
      const quotationsSource = readFileSync(
        resolve(__dirname, '../../src/modules/sales/services/quotations.service.ts'),
        'utf8',
      );
      for (const source of [ordersSource, quotationsSource]) {
        assert.ok(source.includes('resolveConversionPaymentTerms('));
        assert.ok(source.includes('paymentType: paymentTerms'));
        assert.ok(source.includes('paymentChannel: paymentTerms'));
      }
      assert.ok(quotationsSource.includes('resolveConversionPaymentTerms(undefined)'));
    }

    // 10. Invariant pin: exactly once, last line; P3 entry still once.
    {
      const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
      assert.equal(invariants.split('INV-CONVERSION-PAYMENT-TERMS-CARRIED').length - 1, 1, 'the invariant entry must exist exactly once');
      assert.equal(invariants.split('INV-FLOATING-POOL-ALLOCATION-LEG').length - 1, 1, 'the P3 invariant entry must still exist exactly once');
      const lines = invariants.split('\n').filter((line) => line.trim().length > 0);
      assert.ok(lines[lines.length - 1].includes('INV-CONVERSION-PAYMENT-TERMS-CARRIED'), 'the invariant entry must be the last line');
    }
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => console.log('conversion-payment-terms-carried: all cases passed'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
