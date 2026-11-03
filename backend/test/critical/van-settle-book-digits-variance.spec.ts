/*
New file: backend/test/critical/van-settle-book-digits-variance.spec.ts

WHAT THIS PINS (INV-VAN-SETTLE-BOOK-DIGITS-VARIANCE): the van
settleTrip cash variance is computed at tenant book digits through
the shared computeCashDrawerVariance helper — the same helper shift
close and submitTripSettlement use — instead of the hardcoded
toFixed(2) form. On a 3-decimal tenant the old form silently dropped
a 0.005 variance to zero (and the submit/settle figures for the same
trip disagreed by a fils). The cash ledger gates move with it: a
nonzero-at-book-digits variance records a rep financial settlement
row; the old fixed 0.01 gate dropped real fils variances.

WHAT IS DRIVEN: the real settleTrip (and, for the agreement case,
the real submitTripSettlement) with a recording mock database,
mirroring the cash-variance-unification spec: the real service
methods, the real tenant-currency resolution, the real shared
helper, and the real stock-audit engine run on empty van stock; only
the database is mocked. The settle journal itself is stubbed at the
posting boundary and its parameters captured.

DELIBERATELY UNCHANGED AND PINNED BY THE SOURCE PIN: the 0.5
suspicion gate is a currency materiality policy, not precision; the
stock-shortage ledger gate (> 0.01 on the engine-computed stock
cost) is a different figure from the cash variance and is untouched.

NOT DRIVEN: a live sale-to-settlement run on Postgres (deferred by
written decision); the rep-remittance drawer attribution (reported
separately as defective — settle posts a GL journal only, no
treasury row); two-terminal concurrency (PGlite is single-connection).
*/

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';

type Ctx = {
  trip: Record<string, unknown>;
  currency: string;
  expenses: number;
  updates: Array<{ table: string; values: Record<string, unknown> }>;
  inserts: Array<{ table: string; values: Record<string, unknown> }>;
  suspicionEvents: unknown[];
};

function makeDb(ctx: Ctx): Record<string, any> {
  const selectFrom = (table: string) => {
    const key = String(table);
    const rowFor = (): Record<string, unknown> | null => {
      if (key.startsWith('van_sales_trips')) return ctx.trip;
      if (key === 'delivery_representatives') return { id: 4, name: 'Rep', phone: null };
      if (key === 'van_trip_expenses') return { totalExpenses: ctx.expenses };
      if (key === 'settings') return { value: ctx.currency };
      if (key === 'currency_exchange_rates') return { currency_code: ctx.currency, exchange_rate: 1 };
      if (key === 'stock_locations') return { branch_id: 1 };
      // Test-only fixture for INV-REP-CASH-REMITTANCE-SHIFT: settleTrip
      // now links the remittance to an open shift in the same
      // transaction, so the fake answers one open shift on the branch.
      // The treasury row lands in ctx.inserts like every other write;
      // the variance assertions below filter by table and are
      // unaffected. The real shift link is driven by
      // rep-cash-remittance-shift.spec.ts on PGlite.
      if (key === 'cashier_shifts') return { id: 7, branch_id: 1, location_id: 10 };
      if (key.startsWith('product_location_stock')) return null;
      throw new Error(`unexpected selectFrom table ${key}`);
    };
    const builder: Record<string, any> = {};
    for (const name of ['select', 'selectAll', 'where', 'innerJoin', 'orderBy', 'limit', 'forUpdate']) {
      builder[name] = () => builder;
    }
    builder.executeTakeFirst = async () => rowFor();
    builder.execute = async () => {
      if (key === 'currency_exchange_rates') {
        return [{ currency_code: ctx.currency, exchange_rate: 1 }];
      }
      if (key.startsWith('product_location_stock')) return [];
      if (key === 'settings') return [{ value: ctx.currency }];
      const row = rowFor();
      return row === null ? [] : [row];
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
    for (const name of ['where', 'orderBy', 'limit']) {
      builder[name] = () => builder;
    }
    builder.execute = async () => {
      ctx.updates.push({ table, values });
      return [];
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
    for (const name of ['where', 'onConflict']) {
      builder[name] = () => builder;
    }
    builder.execute = async () => {
      ctx.inserts.push({ table, values });
      return [];
    };
    return builder;
  };
  const db: Record<string, any> = {
    selectFrom,
    updateTable,
    insertInto,
    transaction: () => ({
      execute: async (callback: (trx: Record<string, any>) => Promise<unknown>) => callback(db),
    }),
  };
  return db;
}

function buildService(ctx: Ctx, postCalls: unknown[]) {
  const service = Object.create(VanSalesService.prototype) as any;
  service.db = makeDb(ctx);
  service.accountingPosting = {
    postVanTripSettlement: async (_trx: unknown, _tripId: number, params: unknown, _auth: unknown) => {
      postCalls.push(params);
      return {};
    },
  };
  service.recordSuspicionEvent = async (params: unknown) => {
    ctx.suspicionEvents.push(params);
  };
  service.resolveSystemAuthContext = async () => {
    throw new Error('resolveSystemAuthContext must not run when authContext is supplied');
  };
  service.moveVanStock = async () => {
    throw new Error('moveVanStock must not run with empty van stock and no unload');
  };
  service.deductVanSalePharmacyBatches = async () => {
    throw new Error('deductVanSalePharmacyBatches must not run with no stock variance');
  };
  service.moveVanPharmacyBatches = async () => {
    throw new Error('moveVanPharmacyBatches must not run when unloadRemainingToWarehouse is false');
  };
  return service as VanSalesService;
}

function tripFixture(cashCollected: number): Record<string, unknown> {
  return {
    id: 11,
    tenant_id: 't1',
    rep_id: 4,
    status: 'open',
    settlement_status: 'open',
    start_odometer: 100,
    end_odometer: null,
    cash_collected: cashCollected,
    van_location_id: 10,
    vehicle_id: null,
    source_warehouse_id: 1,
    sales_amount: 0,
    credit_sales: 0,
    returns_amount: 0,
    cash_refunds: 0,
    total_instapay_sales: 0,
    total_instapay_collections: 0,
  };
}

function newCtx(cashCollected: number, currency: string, expenses: number): Ctx {
  return { trip: tripFixture(cashCollected), currency, expenses, updates: [], inserts: [], suspicionEvents: [] };
}

const adminAuth: any = { tenantId: 't1', accountId: 'a1', userId: 99, role: 'admin', permissions: [] };

async function settle(ctx: Ctx, countedCash: number, postCalls: unknown[]) {
  const service = buildService(ctx, postCalls);
  return service.settleTrip(4, 't1', 'a1', {
    tripId: 11, countedCash, unloadRemainingToWarehouse: false, endOdometer: 120,
  }, adminAuth);
}

async function main(): Promise<void> {
  // Case 1 (KWD, 3dp): 100.005 collected, 100.000 counted. The old
  // toFixed(2) form rounded expected cash to 100.00 and reported
  // zero variance with no ledger row. Book digits: -0.005, and a
  // cash_shortage settlement row for exactly 0.005.
  {
    const ctx = newCtx(100.005, 'KWD', 0);
    const postCalls: unknown[] = [];
    const result = await settle(ctx, 100.0, postCalls);
    assert.equal(result.expectedCash, 100.005);
    assert.equal(result.variance, -0.005);
    const shortage = ctx.inserts.filter((row) => row.table === 'van_rep_financial_settlements');
    assert.equal(shortage.length, 1);
    assert.equal(shortage[0].values.entry_type, 'cash_shortage');
    assert.equal(shortage[0].values.amount, 0.005);
    assert.equal(shortage[0].values.status, 'pending');
    assert.equal(ctx.suspicionEvents.length, 0);
    assert.equal((postCalls[0] as any).expectedCash, 100.005);
    assert.equal((postCalls[0] as any).countedCash, 100);
  }

  // Case 2 (KWD): counted equals expected at book digits — zero
  // variance, no ledger row, no suspicion event.
  {
    const ctx = newCtx(100.005, 'KWD', 0);
    const postCalls: unknown[] = [];
    const result = await settle(ctx, 100.005, postCalls);
    assert.equal(result.variance, 0);
    assert.equal(ctx.inserts.filter((row) => row.table === 'van_rep_financial_settlements').length, 0);
    assert.equal(ctx.suspicionEvents.length, 0);
  }

  // Case 3 (KWD): overage of one minor unit records a settled
  // cash_overage row for exactly 0.005.
  {
    const ctx = newCtx(100.0, 'KWD', 0);
    const postCalls: unknown[] = [];
    const result = await settle(ctx, 100.005, postCalls);
    assert.equal(result.variance, 0.005);
    const overage = ctx.inserts.filter((row) => row.table === 'van_rep_financial_settlements');
    assert.equal(overage.length, 1);
    assert.equal(overage[0].values.entry_type, 'cash_overage');
    assert.equal(overage[0].values.amount, 0.005);
    assert.equal(overage[0].values.status, 'settled');
  }

  // Case 4 (EGP, 2dp): 2-decimal behaviour is unchanged — expected
  // cash 100.05 after 0.05 of trip expenses, variance -0.05.
  {
    const ctx = newCtx(100.1, 'EGP', 0.05);
    const postCalls: unknown[] = [];
    const result = await settle(ctx, 100.0, postCalls);
    assert.equal(result.expectedCash, 100.05);
    assert.equal(result.variance, -0.05);
    const shortage = ctx.inserts.filter((row) => row.table === 'van_rep_financial_settlements');
    assert.equal(shortage.length, 1);
    assert.equal(shortage[0].values.amount, 0.05);
  }

  // Case 5: submit and settle agree on the same trip figures.
  {
    const ctx = newCtx(100.005, 'KWD', 0);
    const service = buildService(ctx, []);
    const submitted = await service.submitTripSettlement(4, 't1', 'a1', {
      countedCash: 100.0, endOdometer: 120,
    } as any);
    assert.equal(submitted.variance, -0.005);
    const ctx2 = newCtx(100.005, 'KWD', 0);
    const settled = await settle(ctx2, 100.0, []);
    assert.equal(settled.variance, submitted.variance);
  }

  // Source pin: settleTrip uses the shared helper and no inline
  // toFixed(2) variance/expected form; the 0.5 suspicion gate stays.
  {
    const source = readFileSync(resolve(__dirname, '../../src/modules/delivery-reps/van-sales.service.ts'), 'utf8');
    const settleStart = source.indexOf('async settleTrip(');
    const afterSettle = source.indexOf('async listTripsForAdmin(');
    const settleBody = source.slice(settleStart, afterSettle);
    assert.ok(settleBody.includes('computeCashDrawerVariance(countedCash, expectedCash, bookDigits)'));
    assert.ok(!settleBody.includes('(countedCash - expectedCash).toFixed(2)'));
    assert.ok(!settleBody.includes('(grossCashCollected - totalTripExpenses).toFixed(2)'));
    assert.ok(settleBody.includes('cashVariance < -0.5'));
  }

  // Invariant pin: the entry exists exactly once and is last.
  {
    const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-VAN-SETTLE-BOOK-DIGITS-VARIANCE').length - 1, 1, 'the invariant entry must exist exactly once');
  }

  console.log('Van settle book-digits variance tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
