/*
New file: backend/test/critical/van-refund-custody-guard.spec.ts
Pins the rep-custody guard for concurrent cash-refund approvals
(Phase 1, van F5) and its book-precision tolerance.

WHAT THE AUDIT FEARED: two concurrent approveFieldReturn calls for
cash refunds on the same trip both read the trip's cash_collected,
both pass the sufficiency check, and both pay out — overdrawing the
rep's custody.

WHAT ALREADY HELD (and what this pins, so it cannot silently
regress): approveFieldReturn locks the trip row FOR UPDATE, then
re-reads it, and deducts with a relative SQL update — under READ
COMMITTED a second approval waits for the lock and then sees the
first approval's committed deduction. This spec drives the real
approveFieldReturn with a recording mock DB: it asserts the lock
precedes the cash read, and that a second approval whose cash read
reflects the first approval's deduction is rejected before any
stock, credit, or journal work.

WHAT THIS PACKAGE CHANGES: the sufficiency tolerance. The old
check allowed totalAmount up to cash_collected + 0.01 — ten minor
units on a 3-decimal tenant, an overdraw permitted even
sequentially. The tolerance is now one minor unit of the tenant's
book currency (0.01 on EGP, 0.001 on KWD), derived through the
canonical tenantBaseCurrency helper on the cash branch only.

Deliberately NOT changed here: the submit-time advisory check in
submitFieldReturn and the pure evaluateFieldReturnGovernance
evaluator still carry their own hardcoded 0.01 (the approval-time
guard re-checks strictly, so the submit check can only pass a
request the guard then rejects — never the reverse).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { VanReturnsService } from '../../src/modules/delivery-reps/services/van-returns.service';

async function main(): Promise<void> {
  const events: string[] = [];
  const cashHolder = { cash: 100 };

  function chainable(table: string, terminal: Record<string, any>) {
    const builder: any = {};
    for (const key of ['selectAll', 'select', 'where', 'leftJoin', 'orderBy', 'limit']) {
      builder[key] = () => builder;
    }
    builder.forUpdate = () => {
      events.push(`lock:${table}`);
      return builder;
    };
    Object.assign(builder, terminal);
    const originalTakeFirst = builder.executeTakeFirst;
    if (originalTakeFirst) {
      builder.executeTakeFirst = async () => {
        events.push(`read:${table}`);
        return originalTakeFirst();
      };
    }
    return builder;
  }

  function buildService(opts: {
    ret: any;
    currency: string;
    sale: any;
    saleLines: any[];
  }) {
    const trx: any = {
      selectFrom: (table: string) => {
        if (table === 'van_field_returns') {
          return chainable(table, {
            executeTakeFirst: async () => opts.ret,
            execute: async () => [],
          });
        }
        if (table === 'van_sales_trips') {
          return chainable(table, {
            executeTakeFirst: async () => ({ id: 11, status: 'open' }),
          });
        }
        if (table === 'van_sales_trips as vt') {
          return chainable(table, {
            executeTakeFirst: async () => ({
              id: 11,
              van_location_id: 10,
              source_warehouse_id: 9,
              cash_collected: cashHolder.cash,
              vanBranchId: 3,
            }),
          });
        }
        if (table === 'sales as s') {
          return chainable(table, { executeTakeFirst: async () => opts.sale });
        }
        if (table === 'sale_items') {
          return chainable(table, { execute: async () => opts.saleLines });
        }
        if (table === 'settings') {
          return chainable(table, {
            executeTakeFirst: async () => ({ value: `"${opts.currency}"` }),
          });
        }
        if (table === 'currency_exchange_rates') {
          return chainable(table, {
            execute: async () => [{ currency_code: opts.currency, exchange_rate: 1 }],
          });
        }
        throw new Error(`unexpected query on table ${table}`);
      },
    };
    const service = Object.create(VanReturnsService.prototype);
    service.db = { transaction: () => ({ execute: async (cb: any) => cb(trx) }) };
    service.accountingPosting = { postVanFieldReturn: async () => {} };
    return service;
  }

  function retFixture(totalAmount: number): Record<string, any> {
    return {
      id: 31,
      tenant_id: 't1',
      trip_id: 11,
      rep_id: 4,
      customer_id: 21,
      sale_id: 7,
      status: 'pending_approval',
      return_reason: 'customer_request',
      refund_method: 'cash',
      total_amount: totalAmount,
      items_json: JSON.stringify([{ productId: 1, qty: 8, unitPrice: 100, saleItemId: 101 }]),
      doc_no: 'VRET-1',
    };
  }
  // INV-VAN-RETURN-METHOD-MATCH: the mock sale is a cash sale of
  // 1000 (the returns under test are cash refunds), so the
  // method-match leg check sees the leg the refunds draw on.
  const sale = { id: 7, doc_no: 'S-1', customer_id: 21, resolved_rep_id: 4, status: 'posted', payment_type: 'cash', total: 1000, paid_amount: 0 };
  const saleLines = [{ id: 101, product_id: 1, qty: 10, line_total: 1000, product_name: 'Widget' }];

  // 1. Lock precedes the cash read, and an insufficient refund is
  // rejected before any stock/credit/journal work (EGP tenant).
  {
    events.length = 0;
    cashHolder.cash = 100;
    const service = buildService({ ret: retFixture(100.02), currency: 'EGP', sale, saleLines });
    await assert.rejects(
      async () => service.approveFieldReturn('t1', 'a1', 31, 99),
      /INSUFFICIENT_REP_CASH_FOR_REFUND/,
    );
    assert.ok(events.indexOf('lock:van_sales_trips') !== -1, 'trip row must be locked');
    assert.ok(
      events.indexOf('lock:van_sales_trips') < events.indexOf('read:van_sales_trips as vt'),
      'trip lock must precede the cash read',
    );
    assert.ok(!events.some((e) => e.startsWith('read:products')), 'no stock work after a rejected guard');
    assert.ok(events.indexOf('read:settings') > events.indexOf('lock:van_sales_trips'));
  }

  // 2. Sequential approvals: the second sees the first deduction.
  {
    events.length = 0;
    cashHolder.cash = 100;
    const first = buildService({ ret: retFixture(80), currency: 'EGP', sale, saleLines });
    await assert.rejects(
      async () => first.approveFieldReturn('t1', 'a1', 31, 99),
      /unexpected query on table products/,
      'first approval passes the guard and reaches the stock step',
    );
    // The first approval's committed deduction: 100 - 80 = 20.
    cashHolder.cash = 20;
    const second = buildService({ ret: { ...retFixture(80), id: 32 }, currency: 'EGP', sale, saleLines });
    await assert.rejects(
      async () => second.approveFieldReturn('t1', 'a1', 32, 99),
      /INSUFFICIENT_REP_CASH_FOR_REFUND/,
    );
  }

  // 3. Tolerance is one minor unit: KWD 100.126 passes, 100.127 fails.
  {
    cashHolder.cash = 100.125;
    const within = buildService({ ret: retFixture(100.126), currency: 'KWD', sale, saleLines });
    await assert.rejects(
      async () => within.approveFieldReturn('t1', 'a1', 31, 99),
      /unexpected query on table products/,
      'one minor unit over the balance passes the guard',
    );
    const over = buildService({ ret: retFixture(100.127), currency: 'KWD', sale, saleLines });
    await assert.rejects(
      async () => over.approveFieldReturn('t1', 'a1', 31, 99),
      /INSUFFICIENT_REP_CASH_FOR_REFUND/,
    );
  }

  // 4. EGP behaviour is unchanged: 100.01 passes, 100.02 fails.
  {
    cashHolder.cash = 100;
    const within = buildService({ ret: retFixture(100.01), currency: 'EGP', sale, saleLines });
    await assert.rejects(
      async () => within.approveFieldReturn('t1', 'a1', 31, 99),
      /unexpected query on table products/,
    );
    const over = buildService({ ret: retFixture(100.02), currency: 'EGP', sale, saleLines });
    await assert.rejects(
      async () => over.approveFieldReturn('t1', 'a1', 31, 99),
      /INSUFFICIENT_REP_CASH_FOR_REFUND/,
    );
  }

  console.log('Van refund custody-guard tests passed.');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
