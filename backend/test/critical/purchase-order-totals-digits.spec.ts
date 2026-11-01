import 'reflect-metadata';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { PurchaseOrdersService } from '../../src/modules/purchases/services/purchase-orders.service';
import { calculatePurchaseOrderTotals } from '../../src/modules/purchases/engines/purchase-order-totals.engine';

/*
 * Purchase-order totals at tenant book digits
 * (INV-PURCHASE-ORDER-TOTALS-BOOK-DIGITS).
 *
 * Grounding verdict (verified live before any code change): the totals
 * are STORED, not display-only. createOrder inserts the engine totals
 * into purchase_orders (subtotal/tax_amount/discount_amount/
 * total_amount) and the line totals into purchase_order_items.total;
 * updateOrder re-stores them (draft only); confirmOrder uses the
 * stored total_amount as the approval amount; convertToBill re-reads
 * the stored totals and gates bill creation on a reconciliation
 * against them. Client-supplied totals in the DTO are never read.
 * The engine previously hardcoded cents (Math.round(value * 100)),
 * so a 3-decimal book (KWD) stored 2-decimal totals: a 100.005
 * line became 100.01. The engine now takes the tenant's book digits
 * (REQUIRED, never silently defaulted) and rounds once with
 * roundMoney; both engine call sites resolve digits with the P2
 * pattern (tenantBaseCurrency + currencyMoneyDigits) -- createOrder
 * on the pool handle before its transaction, updateOrder on the
 * transaction handle -- and convertToBill recomputes its gate
 * subtotal at book digits with the 0.01 tolerance unchanged.
 *
 * Deliberately UNCHANGED (different arithmetic, separate decisions):
 * - The RFQ-award path (purchase-rfqs.service.ts) sums unrounded
 *   amounts and rounds only at write, with no discount pro-rating.
 * - The reorder-estimate path (reordering-rule.engine.ts) rounds to
 *   a fixed 3 decimals with no tax. Both write the same columns with
 *   different arithmetic; converging them would change stored amounts
 *   and needs its own decision.
 * - The 0.01 convertToBill reconciliation tolerance is a policy band.
 *
 * The service is driven with a recording mock database, mirroring the
 * purchase-order-conversion critical spec: the real service methods,
 * the real tenant-currency resolution and the real engine run; only
 * the database is mocked (KWD base currency). This is not an
 * end-to-end run on live Postgres.
 */

type Scenario = {
  orderRow: Record<string, unknown>;
  itemsRows: Array<Record<string, unknown>>;
  bill: Record<string, unknown>;
  billItems: Array<Record<string, unknown>>;
};

type Captures = {
  orderInserts: Array<Record<string, unknown>>;
  orderUpdates: Array<Record<string, unknown>>;
  itemInserts: Array<Record<string, unknown>>;
  itemDeletes: number;
};

function makeDb(s: Scenario): { db: Record<string, any>; captures: Captures } {
  const captures: Captures = { orderInserts: [], orderUpdates: [], itemInserts: [], itemDeletes: 0 };
  const rowFor = (table: string): Record<string, unknown> | undefined => {
    if (table === 'settings') return { value: 'KWD' };
    if (table === 'suppliers') return { id: 9 };
    if (table === 'stock_locations') return { id: 3 };
    if (table === 'purchase_orders') return s.orderRow;
    return undefined;
  };
  const selectFrom = (table: string) => {
    const builder: Record<string, any> = {};
    for (const name of ['select', 'selectAll', 'where', 'orderBy', 'forUpdate', 'innerJoin', 'leftJoin', 'limit']) {
      builder[name] = () => builder;
    }
    builder.executeTakeFirst = async () => rowFor(table);
    builder.executeTakeFirstOrThrow = async () => {
      const row = rowFor(table);
      if (!row) throw new Error(`no row for ${table}`);
      return row;
    };
    builder.execute = async () => {
      if (table === 'currency_exchange_rates') return [{ currency_code: 'KWD', exchange_rate: 1 }];
      if (table === 'products') return [{ id: 5 }];
      if (table === 'purchase_order_items') return s.itemsRows;
      if (table === 'purchase_items') return s.billItems;
      const row = rowFor(table);
      return row ? [row] : [];
    };
    return builder;
  };
  const updateTable = (table: string) => {
    let values: Record<string, unknown> = {};
    const builder: Record<string, any> = {};
    builder.set = (next: Record<string, unknown>) => {
      values = next;
      return builder;
    };
    builder.where = () => builder;
    const apply = () => {
      if (table === 'purchase_orders') {
        captures.orderUpdates.push(values);
        Object.assign(s.orderRow, values);
      }
      if (table === 'purchases') Object.assign(s.bill, values);
      if (table === 'purchase_items' && s.billItems[0]) Object.assign(s.billItems[0], values);
    };
    builder.execute = async () => {
      apply();
      return [{ numUpdatedRows: 1n }];
    };
    builder.executeTakeFirst = async () => {
      apply();
      return { numUpdatedRows: 1n };
    };
    return builder;
  };
  const insertInto = (table: string) => {
    let values: Record<string, unknown> = {};
    const builder: Record<string, any> = {};
    builder.values = (next: Record<string, unknown>) => {
      values = next;
      return builder;
    };
    builder.returning = () => builder;
    builder.returningAll = () => builder;
    builder.execute = async () => {
      if (table === 'purchase_orders') captures.orderInserts.push(values);
      if (table === 'purchase_order_items') captures.itemInserts.push(values);
      return [];
    };
    builder.executeTakeFirstOrThrow = async () => {
      if (table === 'purchase_orders') {
        captures.orderInserts.push(values);
        return { id: 11, order_number: 'PO-TMP-x' };
      }
      return values;
    };
    return builder;
  };
  const deleteFrom = (table: string) => {
    const builder: Record<string, any> = {};
    builder.where = () => builder;
    builder.execute = async () => {
      if (table === 'purchase_order_items') captures.itemDeletes += 1;
      return [];
    };
    return builder;
  };
  const db: Record<string, any> = {
    selectFrom,
    updateTable,
    insertInto,
    deleteFrom,
    transaction: () => ({
      execute: async (callback: (trx: Record<string, any>) => Promise<unknown>) => callback(db),
    }),
  };
  return { db, captures };
}

function buildService(s: Scenario, purchasesWrite: unknown): { service: PurchaseOrdersService; captures: Captures } {
  const { db, captures } = makeDb(s);
  const service = new PurchaseOrdersService(db as any, purchasesWrite as any, {} as any);
  return { service, captures };
}

const auth: AuthContext = {
  tenantId: 't1', accountId: 't1', userId: 1,
  username: 'spec-admin', role: 'admin', permissions: [], sessionId: 'spec-session',
};

async function main(): Promise<void> {
  // 1. 3-decimal worked example: the old cents form stored line
  // 100.01 / total 110.01 here (float order makes the 10% tax land
  // on 10.000 either way); book digits keep the third decimal.
  assert.deepEqual(
    calculatePurchaseOrderTotals([{ quantity: 1, unitCost: 100.005, taxRate: 10 }], 0, 3),
    { subtotal: 100.005, taxAmount: 10, discountAmount: 0, totalAmount: 110.005, lineTotals: [100.005] },
  );

  // 2. A sub-cent discount is representable at 3 decimals.
  assert.deepEqual(
    calculatePurchaseOrderTotals([{ quantity: 2, unitCost: 50.005, taxRate: 0 }], 0.005, 3),
    { subtotal: 100.01, taxAmount: 0, discountAmount: 0.005, totalAmount: 100.005, lineTotals: [100.01] },
  );

  // 3. The same discount is rejected at 2 decimals: it cannot be
  // represented at book precision, so it must fail closed.
  assert.throws(
    () => calculatePurchaseOrderTotals([{ quantity: 2, unitCost: 50.005, taxRate: 0 }], 0.005, 2),
    (error: unknown) => error instanceof BadRequestException,
  );

  // 4. Multi-line accumulation at 3 decimals (old form: 33.34 per line,
  // subtotal 100.02).
  assert.deepEqual(
    calculatePurchaseOrderTotals(
      [
        { quantity: 1, unitCost: 33.335, taxRate: 0 },
        { quantity: 1, unitCost: 33.335, taxRate: 0 },
        { quantity: 1, unitCost: 33.335, taxRate: 0 },
      ],
      0,
      3,
    ),
    { subtotal: 100.005, taxAmount: 0, discountAmount: 0, totalAmount: 100.005, lineTotals: [33.335, 33.335, 33.335] },
  );

  // 5. 2-decimal books are unchanged (same expectations as the
  // pre-existing totals spec).
  assert.deepEqual(
    calculatePurchaseOrderTotals([{ quantity: 2, unitCost: 100, taxRate: 14 }], 20, 2),
    { subtotal: 200, discountAmount: 20, taxAmount: 25.2, totalAmount: 205.2, lineTotals: [200] },
  );

  // 6. Digits are required: calling without them fails closed instead
  // of silently defaulting to 2.
  assert.throws(
    () => (calculatePurchaseOrderTotals as (...args: unknown[]) => unknown)([{ quantity: 1, unitCost: 100 }], 0),
    (error: unknown) => error instanceof BadRequestException,
  );

  const neverCalled = async (): Promise<never> => {
    throw new Error('must not run for these cases');
  };

  // 7. createOrder stores book-precision totals (KWD tenant).
  {
    const scenario: Scenario = { orderRow: {}, itemsRows: [], bill: {}, billItems: [] };
    const { service, captures } = buildService(scenario, { createPurchase: neverCalled });
    const result = await service.createOrder(
      {
        items: [{ productId: 5, productName: 'Widget', quantity: 1, unitCost: 100.005, taxRate: 10 }],
        discountAmount: 0, supplierId: 9, warehouseId: 3,
        supplierName: 'Supplier', warehouseName: 'Main',
      } as any,
      auth,
    );
    assert.equal(result.success, true);
    assert.equal(result.id, 11);
    assert.equal(captures.orderInserts.length, 1);
    assert.equal(captures.orderInserts[0].subtotal, 100.005);
    assert.equal(captures.orderInserts[0].tax_amount, 10);
    assert.equal(captures.orderInserts[0].discount_amount, 0);
    assert.equal(captures.orderInserts[0].total_amount, 110.005);
    assert.equal(captures.itemInserts.length, 1);
    assert.equal(captures.itemInserts[0].total, 100.005);
  }

  // 8. updateOrder re-stores book-precision totals, resolving digits
  // on the transaction handle.
  {
    const scenario: Scenario = {
      orderRow: {
        id: 11, status: 'draft', discount_amount: 0, supplier_id: 9, warehouse_id: 3,
        supplier_name: 'Supplier', supplier_phone: null, warehouse_name: 'Main',
        expected_delivery_date: null, notes: null, terms_conditions: null,
      },
      itemsRows: [{ quantity: 1, unit_cost: 100.005, tax_rate: 10 }],
      bill: {}, billItems: [],
    };
    const { service, captures } = buildService(scenario, { createPurchase: neverCalled });
    const result = await service.updateOrder(11, {} as any, auth);
    assert.equal(result.success, true);
    assert.equal(captures.orderUpdates.length, 1);
    assert.equal(captures.orderUpdates[0].subtotal, 100.005);
    assert.equal(captures.orderUpdates[0].tax_amount, 10);
    assert.equal(captures.orderUpdates[0].total_amount, 110.005);
    assert.equal(captures.orderUpdates[0].status, 'draft');
  }

  // 9. convertToBill's gate recomputes at book digits: the stored
  // 3-decimal totals reconcile and the derived tax rate comes from
  // the stored tax amount.
  {
    const scenario: Scenario = {
      orderRow: {
        id: 7, tenant_id: 't1', account_id: 't1', supplier_id: 9, order_number: 'PO-7',
        status: 'confirmed', total_amount: 110.005, discount_amount: 0, tax_amount: 10,
      },
      itemsRows: [{ id: 17, product_id: 31, quantity: 1, unit_cost: 100.005, unit_name: 'piece' }],
      bill: { id: 51, po_id: null },
      billItems: [{ id: 61, product_id: 31, po_item_id: null }],
    };
    let payload: any;
    const purchasesWrite = {
      createPurchase: async (input: any, _auth: AuthContext, idempotencyKey: string) => {
        payload = input;
        assert.equal(idempotencyKey, 'purchase-order-conversion-7');
        return { purchaseId: 51 };
      },
    };
    const { service } = buildService(scenario, purchasesWrite);
    const result = await service.convertToBill(7, auth);
    assert.equal(result.convertedPurchaseId, 51);
    assert.equal(payload.items[0].cost, 100.005);
    assert.equal(payload.discount, 0);
    const expectedTaxRate = (10 / 100.005) * 100;
    assert.ok(Math.abs(payload.taxRate - expectedTaxRate) < 1e-9);
    assert.equal(scenario.bill.po_id, 7);
    assert.equal(scenario.billItems[0].po_item_id, 17);
    assert.equal(scenario.orderRow.status, 'converted_to_bill');
  }

  // 10. Source pins: the engine rounds with roundMoney at required
  // digits (no hardcoded cents), and all three service sites resolve
  // digits and pass them through.
  {
    const engine = readFileSync(resolve(__dirname, '../../src/modules/purchases/engines/purchase-order-totals.engine.ts'), 'utf8');
    assert.ok(engine.includes('digits: MoneyDigits'));
    assert.ok(engine.includes('roundMoney(value, digits)'));
    assert.ok(!engine.includes('Math.round(value * 100)'));
    assert.ok(!engine.includes('toFixed(2)'));
    const service = readFileSync(resolve(__dirname, '../../src/modules/purchases/services/purchase-orders.service.ts'), 'utf8');
    assert.ok(service.includes("import { tenantBaseCurrency } from '../../accounting/accounting-currency';"));
    assert.ok(service.includes("import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';"));
    assert.ok(service.includes('tenantBaseCurrency(this.db, scope.tenantId)'));
    assert.ok(service.includes('tenantBaseCurrency(trx, scope.tenantId)'));
    assert.ok(service.includes('calculatePurchaseOrderTotals(payload.items, payload.discountAmount, digits)'));
    assert.ok(!service.includes('calculatePurchaseOrderTotals(payload.items, payload.discountAmount);'));
    assert.ok(service.includes('.toFixed(digits)'));
    const convertStart = service.indexOf('async convertToBill(');
    const cancelStart = service.indexOf('async cancelOrder(');
    assert.ok(convertStart > 0 && cancelStart > convertStart);
    assert.ok(service.slice(convertStart, cancelStart).includes('.toFixed(digits)'));
  }

  console.log('purchase-order-totals-digits: all cases passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
