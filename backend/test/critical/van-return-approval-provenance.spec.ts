/*
New file: backend/test/critical/van-return-approval-provenance.spec.ts
Pins approval-time provenance re-validation for field returns
(Phase 1, van F3): submitFieldReturn validates a return against the
sale(s) it claims — but only at submit time, outside any
transaction. approveFieldReturn then trusted items_json and
total_amount blindly: it never re-checked that the underlying
sale(s) still exist, are still posted, or still leave enough
un-returned quantity at the claimed price. A sale edited down or
cancelled between submit and approval (or a second return approved
first) therefore still paid out the full submitted quantity: stock
restored twice, customer credited twice, journal posted for goods
the customer no longer holds.

WHAT THIS PINS, driving the real approveFieldReturn with a mock DB:
- A linked return whose sale was cancelled is rejected
  (RETURN_SALE_NOT_POSTED) before any stock work.
- A linked return whose sale was edited below the claimed quantity
  is rejected (RETURN_QTY_EXCEEDS_SOLD).
- A linked return is measured against remaining quantity EXCLUDING
  itself: sold 10, another return 2, this return 8 passes the
  re-check (and reaches the stock step); asking 9 fails.
- An unlinked return with no posted rep sales left is rejected
  (NO_REP_SALES_HISTORY_FOR_RETURN).
- An unlinked return priced above the highest net unit the rep
  charged the customer is rejected (RETURN_PRICE_EXCEEDS_NET).
- An unlinked return within the remaining aggregate passes.
- A return on a settled trip is rejected (INVALID_TRIP).
- The trip row is locked (FOR UPDATE) on the transaction before
  the provenance reads.
- INV-VAN-RETURN-METHOD-MATCH: the mock sale carries payment_type
  'credit' / total 1000 and the mock answers the customer balance
  (1000), because approveFieldReturn now also enforces the refund
  method against the sale's payment legs and refuses a credit refund
  the customer's balance cannot cover. Case 3 passes both checks
  exactly (prior credit return 200, this return 800 of 1000).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { VanReturnsService } from '../../src/modules/delivery-reps/services/van-returns.service';

function chainable(terminal: Record<string, any>) {
  const builder: any = {};
  for (const key of ['selectAll', 'select', 'where', 'forUpdate', 'leftJoin', 'orderBy', 'limit']) {
    builder[key] = () => builder;
  }
  Object.assign(builder, terminal);
  return builder;
}

function buildService(opts: {
  ret: any;
  trip: any;
  sale: any;
  saleLines: any[];
  existingReturns: any[];
  repSales: any[];
  soldLines: any[];
  counters: any;
}) {
  const trx: any = {
    selectFrom: (table: string) => {
      if (table === 'van_field_returns') {
        return chainable({
          executeTakeFirst: async () => opts.ret,
          execute: async () => opts.existingReturns,
        });
      }
      if (table === 'van_sales_trips') {
        opts.counters.tripLockReads += 1;
        const builder = chainable({ executeTakeFirst: async () => opts.trip });
        const originalForUpdate = builder.forUpdate;
        builder.forUpdate = () => {
          opts.counters.tripLockForUpdate = true;
          return originalForUpdate();
        };
        return builder;
      }
      if (table === 'van_sales_trips as vt') {
        return chainable({ executeTakeFirst: async () => opts.trip });
      }
      if (table === 'sales as s') {
        return chainable({ executeTakeFirst: async () => opts.sale, execute: async () => opts.repSales });
      }
      if (table === 'sale_items') {
        return chainable({ execute: async () => opts.saleLines.concat(opts.soldLines) });
      }
      if (table === 'customers') {
        // INV-VAN-RETURN-METHOD-MATCH: the approval-time balance
        // floor locks the customer row; the mock world holds 1000.
        return chainable({ executeTakeFirst: async () => ({ balance: 1000 }) });
      }
      if (table === 'settings') {
        // D4: approveFieldReturn resolves book digits on the transaction
        // handle after the trip lock; the mock answers with EGP.
        return chainable({ executeTakeFirst: async () => ({ value: '"EGP"' }) });
      }
      if (table === 'currency_exchange_rates') {
        return chainable({ execute: async () => [{ currency_code: 'EGP', exchange_rate: 1 }] });
      }
      throw new Error(`unexpected query on table ${table}: provenance re-validation must run before it`);
    },
  };
  const db: any = {
    transaction: () => ({ execute: async (cb: any) => cb(trx) }),
  };
  const service = Object.create(VanReturnsService.prototype);
  service.db = db;
  service.accountingPosting = {
    postVanFieldReturn: async () => {
      throw new Error('postVanFieldReturn must not run after a rejected approval');
    },
  };
  return service;
}

function retFixture(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: 31, tenant_id: 't1', trip_id: 11, rep_id: 4, customer_id: 21,
    sale_id: 7, status: 'pending_approval', return_reason: 'customer_request',
    refund_method: 'credit', total_amount: 800,
    items_json: JSON.stringify([{ productId: 1, qty: 8, unitPrice: 100, saleItemId: 101 }]),
    doc_no: 'VRET-1',
    ...overrides,
  };
}

function tripRow(status = 'open'): Record<string, any> {
  return { id: 11, status, van_location_id: 10, source_warehouse_id: 9, cash_collected: 500, vanBranchId: 3 };
}

async function main() {
  const counters = { tripLockReads: 0, tripLockForUpdate: false };

  // 1. Linked: sale cancelled after submit -> rejected.
  {
    const service = buildService({
      ret: retFixture(),
      trip: tripRow(),
      sale: { id: 7, doc_no: 'S-1', customer_id: 21, resolved_rep_id: 4, status: 'cancelled', payment_type: 'credit', total: 1000, paid_amount: 0 },
      saleLines: [{ id: 101, product_id: 1, qty: 10, line_total: 1000, product_name: 'Widget' }],
      existingReturns: [],
      repSales: [],
      soldLines: [],
      counters,
    });
    await assert.rejects(
      async () => service.approveFieldReturn('t1', 'a1', 31, 99),
      /RETURN_SALE_NOT_POSTED/,
    );
  }

  // 2. Linked: sale edited below the claimed quantity -> rejected.
  {
    const service = buildService({
      ret: retFixture(),
      trip: tripRow(),
      sale: { id: 7, doc_no: 'S-1', customer_id: 21, resolved_rep_id: 4, status: 'posted', payment_type: 'credit', total: 1000, paid_amount: 0 },
      saleLines: [{ id: 101, product_id: 1, qty: 5, line_total: 500, product_name: 'Widget' }],
      existingReturns: [],
      repSales: [],
      soldLines: [],
      counters,
    });
    await assert.rejects(
      async () => service.approveFieldReturn('t1', 'a1', 31, 99),
      /RETURN_QTY_EXCEEDS_SOLD/,
    );
  }

  // 3. Linked: remaining excludes this return itself (8 of 10, other return 2) -> passes re-check.
  {
    const service = buildService({
      ret: retFixture(),
      trip: tripRow(),
      sale: { id: 7, doc_no: 'S-1', customer_id: 21, resolved_rep_id: 4, status: 'posted', payment_type: 'credit', total: 1000, paid_amount: 0 },
      saleLines: [{ id: 101, product_id: 1, qty: 10, line_total: 1000, product_name: 'Widget' }],
      existingReturns: [
        { id: 30, items_json: JSON.stringify([{ productId: 1, qty: 2, saleItemId: 101 }]), status: 'approved', refund_method: 'credit', total_amount: 200 },
        { id: 31, items_json: JSON.stringify([{ productId: 1, qty: 8, saleItemId: 101 }]), status: 'pending_approval' },
      ],
      repSales: [],
      soldLines: [],
      counters,
    });
    // The mock answers van_field_returns reads with the return row
    // itself; the re-check must exclude it (remaining 8, asking 8)
    // and reach the stock step, which the mock refuses.
    await assert.rejects(
      async () => service.approveFieldReturn('t1', 'a1', 31, 99),
      /unexpected query on table products/,
    );
  }

  // 4. Linked: asking 9 with remaining 8 -> rejected.
  {
    const service = buildService({
      ret: retFixture({ items_json: JSON.stringify([{ productId: 1, qty: 9, unitPrice: 100, saleItemId: 101 }]), total_amount: 900 }),
      trip: tripRow(),
      sale: { id: 7, doc_no: 'S-1', customer_id: 21, resolved_rep_id: 4, status: 'posted', payment_type: 'credit', total: 1000, paid_amount: 0 },
      saleLines: [{ id: 101, product_id: 1, qty: 10, line_total: 1000, product_name: 'Widget' }],
      existingReturns: [
        { id: 30, items_json: JSON.stringify([{ productId: 1, qty: 2, saleItemId: 101 }]), status: 'approved', refund_method: 'credit', total_amount: 200 },
      ],
      repSales: [],
      soldLines: [],
      counters,
    });
    await assert.rejects(
      async () => service.approveFieldReturn('t1', 'a1', 31, 99),
      /RETURN_QTY_EXCEEDS_SOLD/,
    );
  }

  // 5. Unlinked: no posted rep sales left -> rejected.
  {
    const service = buildService({
      ret: retFixture({ sale_id: null, items_json: JSON.stringify([{ productId: 1, qty: 2, unitPrice: 100 }]), total_amount: 200 }),
      trip: tripRow(),
      sale: null,
      saleLines: [],
      existingReturns: [],
      repSales: [],
      soldLines: [],
      counters,
    });
    await assert.rejects(
      async () => service.approveFieldReturn('t1', 'a1', 31, 99),
      /NO_REP_SALES_HISTORY_FOR_RETURN/,
    );
  }

  // 6. Unlinked: price above the highest net unit -> rejected.
  {
    const service = buildService({
      ret: retFixture({ sale_id: null, items_json: JSON.stringify([{ productId: 1, qty: 2, unitPrice: 60 }]), total_amount: 120 }),
      trip: tripRow(),
      sale: null,
      saleLines: [],
      existingReturns: [],
      repSales: [{ id: 7 }],
      soldLines: [{ product_id: 1, product_name: 'Widget', qty: 10, line_total: 500 }],
      counters,
    });
    await assert.rejects(
      async () => service.approveFieldReturn('t1', 'a1', 31, 99),
      /RETURN_PRICE_EXCEEDS_NET/,
    );
  }

  // 7. Unlinked: within the remaining aggregate -> passes re-check.
  {
    const service = buildService({
      ret: retFixture({ sale_id: null, items_json: JSON.stringify([{ productId: 1, qty: 8, unitPrice: 50 }]), total_amount: 400 }),
      trip: tripRow(),
      sale: null,
      saleLines: [],
      existingReturns: [],
      repSales: [{ id: 7 }],
      soldLines: [{ product_id: 1, product_name: 'Widget', qty: 10, line_total: 500 }],
      counters,
    });
    await assert.rejects(
      async () => service.approveFieldReturn('t1', 'a1', 31, 99),
      /unexpected query on table products/,
    );
  }

  // 8. Settled trip -> rejected before any provenance work.
  {
    const service = buildService({
      ret: retFixture(),
      trip: tripRow('settled'),
      sale: { id: 7, doc_no: 'S-1', customer_id: 21, resolved_rep_id: 4, status: 'posted', payment_type: 'credit', total: 1000, paid_amount: 0 },
      saleLines: [{ id: 101, product_id: 1, qty: 10, line_total: 1000, product_name: 'Widget' }],
      existingReturns: [],
      repSales: [],
      soldLines: [],
      counters,
    });
    await assert.rejects(
      async () => service.approveFieldReturn('t1', 'a1', 31, 99),
      /INVALID_TRIP/,
    );
  }

  assert.equal(counters.tripLockReads > 0, true, 'the trip row must be locked inside the approval transaction');
  assert.equal(counters.tripLockForUpdate, true, 'the trip lock must be FOR UPDATE');
  console.log('Van return approval provenance tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
