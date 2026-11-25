/*
New file: backend/test/critical/three-way-match-bill-rate.spec.ts
Pins the three-way-match VAT wiring (unification inventory #8): the
GRN gate verifies a bill at the BILL's own stored VAT rate — never
the engine's old hardcoded 0.14 default — and extracts VAT instead
of stacking it when the bill's prices include tax.

WHAT WAS WRONG: verifyPurchaseThreeWayMatch built its
ThreeWayMatchInput without vatRate, so computeThreeWayMatch fell
back to 0.14 for every bill. An exempt bill's reported VAT and
payable were inflated by 14%, a 15% bill's understated, and a
tax-inclusive bill's VAT was computed additively on a total that
already contained the tax.

WHAT THIS PINS:
- Pure engine: exclusive rates (5%, 0%, 15%) compute VAT at the
  passed rate; tax-inclusive lines extract VAT and report the
  payable as the invoiced total (no double-count); a missing or
  negative rate fails closed instead of defaulting.
- The real verifyPurchaseThreeWayMatch, driven with a mock DB:
  the rate and the prices_include_tax flag flow from the stored
  purchase row into the engine — the gate's reported VAT/payable
  match the bill, not 14%.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { computeThreeWayMatch } from '../../src/modules/purchases/three-way-match.engine';
import { GoodsReceiptService } from '../../src/modules/purchases/services/goods-receipt.service';

function engineInput(overrides: Record<string, any> = {}): any {
  return {
    poItems: [{ id: 11, productId: 1, qty: 2, unitCost: 100 }],
    grnLines: [
      { id: 21, grnId: 55, poItemId: 11, productId: 1, receivedQty: 2, acceptedQty: 2, rejectedQty: 0, unitCost: 100 },
    ],
    invoiceItems: [{ id: 1, poItemId: 11, grnLineId: 21, productId: 1, qty: 2, unitCost: 100 }],
    minorUnits: 2,
    vatRate: 0.14,
    ...overrides,
  };
}

async function main(): Promise<void> {
  // ---- Pure engine ----
  const five = computeThreeWayMatch(engineInput({ vatRate: 0.05 }));
  assert.equal(five.totalVat, 10);
  assert.equal(five.totalAccountsPayable, 210);
  assert.equal(five.overallStatus, 'matched');

  const zero = computeThreeWayMatch(engineInput({ vatRate: 0 }));
  assert.equal(zero.totalVat, 0);
  assert.equal(zero.totalAccountsPayable, 200);

  const fifteen = computeThreeWayMatch(engineInput({ vatRate: 0.15 }));
  assert.equal(fifteen.totalVat, 30);

  // Gross-basis consistency: the PO and GRN carry the same gross cost
  // as the bill (bills store effectiveUnitCost as sent); only the VAT
  // leg is basis-sensitive, so it extracts instead of stacking.
  const inclusive = computeThreeWayMatch(
    engineInput({
      vatRate: 0.14,
      pricesIncludeTax: true,
      poItems: [{ id: 11, productId: 1, qty: 1, unitCost: 114 }],
      grnLines: [
        {
          id: 21,
          grnId: 55,
          poItemId: 11,
          productId: 1,
          receivedQty: 1,
          acceptedQty: 1,
          rejectedQty: 0,
          unitCost: 114,
        },
      ],
      invoiceItems: [{ id: 1, poItemId: 11, grnLineId: 21, productId: 1, qty: 1, unitCost: 114 }],
    }),
  );
  assert.equal(inclusive.totalVat, 14);
  assert.equal(inclusive.totalAccountsPayable, 114);
  assert.equal(inclusive.overallStatus, 'matched');

  assert.throws(() => computeThreeWayMatch(engineInput({ vatRate: undefined })), /invoice VAT rate/);
  assert.throws(() => computeThreeWayMatch(engineInput({ vatRate: -0.05 })), /invoice VAT rate/);
  assert.throws(() => computeThreeWayMatch(engineInput({ vatRate: Number.NaN })), /invoice VAT rate/);

  // ---- Real verifyPurchaseThreeWayMatch, mock DB ----
  function drive(purchase: Record<string, any>, items: Array<Record<string, any>>, poUnitCost: number) {
    function chainable(table: string, terminal: Record<string, any>) {
      const builder: any = {};
      for (const key of ['selectAll', 'select', 'where', 'forUpdate', 'leftJoin', 'innerJoin', 'orderBy', 'limit']) {
        builder[key] = () => builder;
      }
      builder.values = () => builder;
      builder.set = () => builder;
      builder.onConflict = (cb: any) => {
        cb({ columns: () => ({ doUpdateSet: () => ({}) }) });
        return builder;
      };
      Object.assign(builder, terminal);
      return builder;
    }
    const joinStub: any = { onRef: () => joinStub };
    const trx: any = {
      selectFrom: (table: string) => {
        if (table === 'purchases') {
          return chainable(table, { executeTakeFirst: async () => purchase });
        }
        if (table === 'settings') {
          let key = '';
          const builder = chainable(table, {});
          const originalWhere = builder.where;
          builder.where = (col: string, _op: string, val: unknown) => {
            if (col === 'key') key = String(val);
            return originalWhere();
          };
          builder.executeTakeFirst = async () => (key === 'currency' ? { value: '"EGP"' } : { value: '2' });
          return builder;
        }
        if (table === 'purchase_orders') {
          return chainable(table, { executeTakeFirst: async () => ({ id: 9, supplier_id: 3 }) });
        }
        if (table === 'purchase_items') {
          return chainable(table, { execute: async () => items });
        }
        if (table === 'purchase_items as pi') {
          const builder = chainable(table, { execute: async () => [] });
          builder.innerJoin = () => {
            return builder;
          };
          return builder;
        }
        if (table === 'products') {
          return chainable(table, { execute: async () => [{ id: 1, item_type: 'goods' }] });
        }
        if (table === 'purchase_order_items') {
          return chainable(table, {
            execute: async () => [{ id: 11, product_id: 1, quantity: 2, unit_cost: poUnitCost }],
          });
        }
        if (table === 'goods_receipt_notes') {
          return chainable(table, {
            executeTakeFirst: async () => ({ id: 55, purchase_order_id: 9, supplier_id: 3, status: 'posted' }),
          });
        }
        if (table === 'goods_receipt_lines') {
          return chainable(table, {
            execute: async () => [
              {
                id: 21,
                grn_id: 55,
                purchase_order_item_id: 11,
                product_id: 1,
                received_qty: 2,
                accepted_qty: 2,
                rejected_qty: 0,
                unit_cost: poUnitCost,
              },
            ],
          });
        }
        if (table === 'currency_exchange_rates') {
          return chainable(table, { execute: async () => [{ currency_code: 'EGP', exchange_rate: 1 }] });
        }
        throw new Error(`unexpected query on table ${table}`);
      },
      insertInto: () => chainable('insert', { execute: async () => ({}) }),
      updateTable: () => chainable('update', { execute: async () => ({}) }),
    };
    const service: any = new GoodsReceiptService(
      { transaction: () => ({ execute: async (cb: any) => cb(trx) }) } as any,
      {} as any,
      {} as any,
    );
    const auth = {
      userId: 99,
      role: 'admin',
      tenantId: 't1',
      accountId: 'a1',
      sessionId: 's',
      username: 'u',
      permissions: [] as string[],
    };
    return service.verifyPurchaseThreeWayMatch(5, {}, auth);
  }

  const basePurchase = {
    id: 5,
    tenant_id: 't1',
    status: 'posted',
    po_id: 9,
    grn_id: 55,
    supplier_id: 3,
    created_by: 5,
  };
  const exclusiveItems = [{ id: 1, po_item_id: 11, grn_line_id: 21, product_id: 1, qty: 2, unit_cost: 100 }];

  // Bill at 5%: gate reports 5% VAT, not 14%.
  const billFive: any = await drive({ ...basePurchase, tax_rate: 5, prices_include_tax: false }, exclusiveItems, 100);
  assert.equal(billFive.totalVat, 10);
  assert.equal(billFive.totalAccountsPayable, 210);
  assert.equal(billFive.overallStatus, 'matched');
  assert.equal(billFive.isValidForPosting, true);

  // Exempt bill: zero VAT.
  const billZero: any = await drive({ ...basePurchase, tax_rate: 0, prices_include_tax: false }, exclusiveItems, 100);
  assert.equal(billZero.totalVat, 0);
  assert.equal(billZero.totalAccountsPayable, 200);

  // Tax-inclusive bill at 14%: VAT extracted, payable not double-counted.
  // The PO/GRN carry the same gross cost as the bill (114), as stored.
  const billInclusive: any = await drive(
    { ...basePurchase, tax_rate: 14, prices_include_tax: true },
    [{ id: 1, po_item_id: 11, grn_line_id: 21, product_id: 1, qty: 1, unit_cost: 114 }],
    114,
  );
  assert.equal(billInclusive.totalVat, 14);
  assert.equal(billInclusive.totalAccountsPayable, 114);
  assert.equal(billInclusive.overallStatus, 'matched');

  console.log('Three-way-match bill-rate tests passed.');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
