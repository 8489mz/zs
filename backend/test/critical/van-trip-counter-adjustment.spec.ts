/*
New file: backend/test/critical/van-trip-counter-adjustment.spec.ts
Pins the trip-counter adjustment on sale edit/cancel (Phase 1, van
F2): executeFieldSaleInternal maintains four counters on
van_sales_trips (sales_amount, cash_collected, credit_sales,
total_instapay_sales), but the generic updateSale/cancelSale paths
never touched them — the sales writer had zero references to
van_trip_id. Editing a field sale down, or cancelling it, left
settleTrip expecting cash that was never collected (or collected
cash the books no longer showed), i.e. a false shortage charged to
the rep.

WHAT THIS PINS:
- The contribution table on the pure engine: every creation branch
  (cash / card / instapay / vodafone_cash / bank_transfer / credit /
  split via ledger row / split via tender rows / split via paid
  fallback), plus the credit-with-partial-card-tender shape, plus
  negate/diff.
- cancelSale on a trip sale reverses exactly the sale's
  contribution on the trip row (captured update args), before any
  stock/journal work, and only when the trip is still open: a
  settled trip's counters are history and are left alone.
- updateSale locks the trip row (FOR UPDATE, on the transaction)
  immediately after reading the locked sale row, before the shift
  check — the lock ordering the settle guard relies on.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { SalesWriteService } from '../../src/modules/sales/services/sales-write.service';
import {
  diffContributions,
  negateContribution,
  tripSaleContribution,
} from '../../src/modules/delivery-reps/van-trip-counters.engine';

function testContributionTable(): void {
  const cases: Array<
    [string, any, { salesAmount: number; cashCollected: number; creditSales: number; instapaySales: number }]
  > = [
    [
      'cash',
      { total: 100, paidAmount: 0, paymentChannel: 'cash' },
      { salesAmount: 100, cashCollected: 100, creditSales: 0, instapaySales: 0 },
    ],
    [
      'card',
      { total: 100, paidAmount: 100, paymentChannel: 'card' },
      { salesAmount: 100, cashCollected: 0, creditSales: 0, instapaySales: 0 },
    ],
    [
      'instapay',
      { total: 100, paidAmount: 100, paymentChannel: 'instapay' },
      { salesAmount: 100, cashCollected: 0, creditSales: 0, instapaySales: 100 },
    ],
    [
      'vodafone_cash',
      { total: 100, paidAmount: 100, paymentChannel: 'vodafone_cash' },
      { salesAmount: 100, cashCollected: 0, creditSales: 0, instapaySales: 100 },
    ],
    [
      'bank_transfer',
      { total: 100, paidAmount: 100, paymentChannel: 'bank_transfer' },
      { salesAmount: 100, cashCollected: 0, creditSales: 0, instapaySales: 100 },
    ],
    [
      'credit',
      { total: 100, paidAmount: 0, paymentChannel: 'credit' },
      { salesAmount: 100, cashCollected: 0, creditSales: 100, instapaySales: 0 },
    ],
    [
      'credit + partial card tender',
      { total: 100, paidAmount: 30, paymentChannel: 'card' },
      { salesAmount: 100, cashCollected: 0, creditSales: 70, instapaySales: 0 },
    ],
    [
      'split via ledger',
      { total: 100, paidAmount: 0, paymentChannel: 'mixed', ledgerCreditAmount: 60 },
      { salesAmount: 100, cashCollected: 40, creditSales: 60, instapaySales: 0 },
    ],
    [
      'split via tender rows',
      { total: 100, paidAmount: 40, paymentChannel: 'mixed', payments: [{ amount: 40, payment_channel: 'cash' }] },
      { salesAmount: 100, cashCollected: 40, creditSales: 60, instapaySales: 0 },
    ],
    [
      'split via tender rows incl. card',
      {
        total: 100,
        paidAmount: 70,
        paymentChannel: 'mixed',
        payments: [
          { amount: 40, payment_channel: 'cash' },
          { amount: 30, payment_channel: 'card' },
        ],
      },
      { salesAmount: 100, cashCollected: 40, creditSales: 30, instapaySales: 0 },
    ],
    [
      'split via paid fallback',
      { total: 100, paidAmount: 40, paymentChannel: 'mixed' },
      { salesAmount: 100, cashCollected: 40, creditSales: 60, instapaySales: 0 },
    ],
    [
      'wallet',
      { total: 100, paidAmount: 100, paymentChannel: 'wallet' },
      { salesAmount: 100, cashCollected: 0, creditSales: 0, instapaySales: 0 },
    ],
    [
      'unknown channel stays sales-only',
      { total: 100, paidAmount: 100, paymentChannel: 'mystery' },
      { salesAmount: 100, cashCollected: 0, creditSales: 0, instapaySales: 0 },
    ],
  ];
  for (const [name, input, expected] of cases) {
    assert.deepEqual(tripSaleContribution(input), expected, name);
  }
  assert.deepEqual(negateContribution({ salesAmount: 100, cashCollected: 40, creditSales: 60, instapaySales: 0 }), {
    salesAmount: -100,
    cashCollected: -40,
    creditSales: -60,
    instapaySales: 0,
  });
  assert.deepEqual(
    diffContributions(
      { salesAmount: 60, cashCollected: 60, creditSales: 0, instapaySales: 0 },
      { salesAmount: 100, cashCollected: 100, creditSales: 0, instapaySales: 0 },
    ),
    { salesAmount: -40, cashCollected: -40, creditSales: 0, instapaySales: 0 },
  );
  console.log('Trip counter contribution table tests passed');
}

function chainable(terminal: Record<string, any>) {
  const builder: any = {};
  for (const key of ['selectAll', 'select', 'where', 'forUpdate', 'set', 'limit', 'orderBy']) {
    builder[key] = () => builder;
  }
  Object.assign(builder, terminal);
  return builder;
}

const adminAuth: any = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] };

function tripSaleRow(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: 7,
    tenant_id: 't1',
    status: 'posted',
    exchange_return_id: null,
    zatca_status: 'not_submitted',
    van_trip_id: 11,
    delivery_rep_id: 4,
    total: 100,
    paid_amount: 0,
    payment_type: 'cash',
    payment_channel: 'cash',
    customer_id: null,
    branch_id: null,
    created_by: 1,
    created_at: new Date(),
    delivery_status: null,
    order_type: 'pos',
    ...overrides,
  };
}

/** cancelSale mock: answers the guard reads + trip lock/update, throws on anything later. */
function buildCancelService(opts: { sale: any; tripStatus: string; captured: any }) {
  const trx: any = {
    selectFrom: (table: string) => {
      if (table === 'sales') return chainable({ executeTakeFirst: async () => opts.sale });
      if (table === 'return_documents' || table === 'payment_allocations') {
        return chainable({ executeTakeFirst: async () => null });
      }
      if (table === 'sale_payments') {
        return chainable({
          executeTakeFirst: async () => ({ amount: 0 }),
          execute: async () => [],
        });
      }
      if (table === 'van_sales_trips') {
        return chainable({ executeTakeFirst: async () => ({ id: 11, status: opts.tripStatus }) });
      }
      throw new Error(`unexpected query on table ${table}: the trip-counter reversal must run before it`);
    },
    updateTable: (table: string) => {
      if (table === 'van_sales_trips') {
        return chainable({
          execute: async () => {
            opts.captured.tripUpdates.push((trx as any).__lastSet);
            return [];
          },
        });
      }
      throw new Error(`unexpected update on table ${table}`);
    },
  };
  const originalUpdateTable = trx.updateTable;
  trx.updateTable = (table: string) => {
    const builder = originalUpdateTable(table);
    const originalSet = builder.set;
    builder.set = (values: any) => {
      (trx as any).__lastSet = values;
      return originalSet(values);
    };
    return builder;
  };
  const db: any = {};
  const service = Object.create(SalesWriteService.prototype);
  service.db = db;
  service.tx = { runInTransaction: async (_db: any, cb: any) => cb(trx) };
  service.authz = { authorizeDiscountOverride: async () => undefined };
  return service;
}

async function testCancelSaleWiring(): Promise<void> {
  // 1. Cancelling a cash trip sale on an OPEN trip reverses its counters.
  {
    const captured: any = { tripUpdates: [] };
    const service = buildCancelService({ sale: tripSaleRow(), tripStatus: 'open', captured });
    await assert.rejects(async () => service.cancelSale(7, 'إلغاء', '1234', adminAuth), /unexpected query on table/);
    assert.equal(captured.tripUpdates.length, 1, 'the trip counters must be reversed');
    // The set values are Kysely sql fragments; their bound parameters
    // carry the deltas.
    const paramsOf = (set: any, key: string): unknown => (set[key] as any)?.toOperationNode?.()?.parameters?.[0]?.value;
    const setArg = captured.tripUpdates[0];
    assert.equal(paramsOf(setArg, 'sales_amount'), -100, 'sales_amount reverses the full total');
    assert.equal(paramsOf(setArg, 'cash_collected'), -100, 'cash_collected reverses the cash leg');
    assert.equal(paramsOf(setArg, 'credit_sales'), 0);
    assert.equal(paramsOf(setArg, 'total_instapay_sales'), 0);
  }

  // 2. Cancelling a sale on a SETTLED trip leaves the counters alone.
  {
    const captured: any = { tripUpdates: [] };
    const service = buildCancelService({ sale: tripSaleRow(), tripStatus: 'settled', captured });
    await assert.rejects(async () => service.cancelSale(7, 'إلغاء', '1234', adminAuth), /unexpected query on table/);
    assert.equal(captured.tripUpdates.length, 0, 'settled-trip counters are history and must not move');
  }

  // 3. Cancelling a non-trip sale touches no trip row.
  {
    const captured: any = { tripUpdates: [] };
    const service = buildCancelService({ sale: tripSaleRow({ van_trip_id: null }), tripStatus: 'open', captured });
    await assert.rejects(async () => service.cancelSale(7, 'إلغاء', '1234', adminAuth), /unexpected query on table/);
    assert.equal(captured.tripUpdates.length, 0);
  }

  console.log('  -> cancelSale: trip-counter reversal runs before stock/journal work, skipped for settled trips.');
}

/** updateSale mock: answers the sale load + currency lookup + trip lock, throws on the shift read. */
function buildUpdateService(opts: { sale: any; counters: any }) {
  const trx: any = {
    selectFrom: (table: string) => {
      if (table === 'sales') return chainable({ executeTakeFirst: async () => opts.sale });
      if (table === 'settings') return chainable({ executeTakeFirst: async () => ({ value: 'EGP' }) });
      if (table === 'currency_exchange_rates') {
        return chainable({ execute: async () => [{ currency_code: 'EGP', exchange_rate: 1 }] });
      }
      if (table === 'van_sales_trips') {
        opts.counters.tripLockReads += 1;
        const builder = chainable({ executeTakeFirst: async () => ({ id: 11, status: 'open' }) });
        const originalForUpdate = builder.forUpdate;
        builder.forUpdate = () => {
          opts.counters.tripLockForUpdate = true;
          return originalForUpdate();
        };
        return builder;
      }
      throw new Error(`unexpected query on table ${table}`);
    },
  };
  const db: any = {};
  const service = Object.create(SalesWriteService.prototype);
  service.db = db;
  service.tx = { runInTransaction: async (_db: any, cb: any) => cb(trx) };
  service.authz = { authorizeDiscountOverride: async () => undefined };
  return service;
}

async function testUpdateSaleTripLock(): Promise<void> {
  const counters = { tripLockReads: 0, tripLockForUpdate: false };
  const service = buildUpdateService({ sale: tripSaleRow(), counters });
  const editPayload: any = {
    items: [{ productId: 1, qty: 1, unitPrice: 50 }],
    editReason: 'تصحيح سعر',
    paymentType: 'cash',
  };
  await assert.rejects(
    async () => service.updateSale(7, editPayload, adminAuth),
    /unexpected query on table cashier_shifts/,
  );
  assert.equal(counters.tripLockReads, 1, 'the trip row must be locked before the shift check');
  assert.equal(counters.tripLockForUpdate, true, 'the trip lock must be FOR UPDATE');
  console.log('  -> updateSale: trip row locked (FOR UPDATE) before any stock/shift work.');
}

async function main() {
  testContributionTable();
  await testCancelSaleWiring();
  await testUpdateSaleTripLock();
  console.log('Van trip counter adjustment tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
