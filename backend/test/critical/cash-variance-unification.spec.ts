import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { computeCashDrawerVariance } from '../../src/modules/cash-drawer/helpers/cash-drawer.helper';

/*
 * Cash-variance unification (INV-CASH-VARIANCE-UNIFICATION).
 *
 * The submitTripSettlement path in VanSalesService used to compute cash
 * variance inline with a hardcoded two-decimal form
 * (Number((countedCash - expectedCash).toFixed(2))). That silently
 * mis-rounded 3-decimal books (a KWD 0.005 variance became 0.01).
 * That path now calls the shared computeCashDrawerVariance helper at
 * tenant book digits, the same helper the cash-drawer shift close uses.
 *
 * Converged by Slice 7 Batch 2 P6 (INV-VAN-SETTLE-BOOK-DIGITS-VARIANCE,
 * user-authorized 2026-11-03 as the second batch of 4): settleTrip now
 * computes its cash variance through the same shared helper at book
 * digits, and its cash ledger gates are nonzero-at-book-digits. The
 * source pin below pins the convergence, so a future regression to
 * the inline form is visible, not silent.
 *
 * Deliberately unchanged, as separate findings:
 * - The -0.5 suspicion threshold is a currency materiality policy
 *   band, not precision (same precedent as the P8 0.01 status band).
 * - The stock-shortage ledger gate (> 0.01 on the engine-computed
 *   stock cost) is a different figure from the cash variance and is
 *   untouched by the convergence.
 *
 * The service is driven with a recording mock database, mirroring the
 * van-settle-double-settle critical spec: the real service methods,
 * the real tenant-currency resolution and the real shared helper run;
 * only the database is mocked (empty van stock, no unload, no vehicle,
 * rep phone null). This is not an end-to-end sale-to-settlement run
 * on live Postgres.
 */

type Ctx = {
  trip: Record<string, unknown>;
  currency: string;
  expenses: number;
  updates: Array<{ table: string; values: Record<string, unknown> }>;
  inserts: Array<{ table: string; values: Record<string, unknown> }>;
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
  service.recordSuspicionEvent = async () => {
    throw new Error('recordSuspicionEvent must not run for these cases');
  };
  service.resolveSystemAuthContext = async () => {
    throw new Error('resolveSystemAuthContext must not run when authContext is supplied');
  };
  service.moveVanStock = async () => {
    throw new Error('moveVanStock must not run when unloadRemainingToWarehouse is false');
  };
  service.deductVanSalePharmacyBatches = async () => {
    throw new Error('deductVanSalePharmacyBatches must not run for these cases');
  };
  service.moveVanPharmacyBatches = async () => {
    throw new Error('moveVanPharmacyBatches must not run for these cases');
  };
  return service as VanSalesService;
}

function tripFixture(): Record<string, unknown> {
  return {
    id: 11,
    tenant_id: 't1',
    rep_id: 4,
    status: 'open',
    settlement_status: 'open',
    start_odometer: 100,
    end_odometer: null,
    cash_collected: 100,
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


async function main(): Promise<void> {
  // Shared-helper identity: the 3-decimal case the old toFixed(2) form
  // mis-rounded (100.005 - 100 became 0.01, not 0.005).
  assert.equal(computeCashDrawerVariance(100.005, 100, 3), 0.005);
  assert.equal(computeCashDrawerVariance(100.12, 100, 2), 0.12);

  // 1. submitTripSettlement, 3-decimal book (KWD): 0.005 survives.
  {
    const ctx: Ctx = { trip: tripFixture(), currency: 'KWD', expenses: 0, updates: [], inserts: [] };
    const service = buildService(ctx, []);
    const result = await service.submitTripSettlement(4, 't1', 'a1', {
      tripId: 11,
      countedCash: 100.005,
      endOdometer: 120,
      unloadRemainingToWarehouse: false,
    });
    assert.equal(result.variance, 0.005);
    assert.equal(result.status, 'submitted_by_rep');
    const tripUpdate = ctx.updates.find((u) => u.table === 'van_sales_trips');
    assert.ok(tripUpdate, 'trip update must be recorded');
    assert.equal(tripUpdate.values.variance, 0.005);
    assert.equal(tripUpdate.values.settlement_status, 'submitted_by_rep');
  }

  // 2. submitTripSettlement, 2-decimal book (EGP): unchanged rounding.
  {
    const ctx: Ctx = { trip: tripFixture(), currency: 'EGP', expenses: 0, updates: [], inserts: [] };
    const service = buildService(ctx, []);
    const result = await service.submitTripSettlement(4, 't1', 'a1', {
      tripId: 11,
      countedCash: 100.12,
      endOdometer: 120,
      unloadRemainingToWarehouse: false,
    });
    assert.equal(result.variance, 0.12);
    const balanced = await service.submitTripSettlement(4, 't1', 'a1', {
      tripId: 11,
      countedCash: 100,
      endOdometer: 120,
      unloadRemainingToWarehouse: false,
    });
    assert.equal(balanced.variance, 0);
  }

  // Source pin: submitTripSettlement calls the shared helper with
  // book digits and keeps no inline toFixed(2) variance form, and
  // settleTrip does the same since Slice 7 P6 converged it (the
  // inline form is gone from both paths).
  {
    const source = readFileSync(resolve(__dirname, '../../src/modules/delivery-reps/services/van-trip-lifecycle.service.ts'), 'utf8');
    assert.ok(source.includes("import { computeCashDrawerVariance } from '../../cash-drawer/helpers/cash-drawer.helper';"));
    const submitStart = source.indexOf('async submitTripSettlement(');
    const settleStart = source.indexOf('async settleTrip(');
    const afterSettle = source.indexOf('async listTripsForAdmin(');
    assert.ok(submitStart > 0 && settleStart > submitStart && afterSettle > settleStart);
    const submitBody = source.slice(submitStart, settleStart);
    const settleBody = source.slice(settleStart, afterSettle);
    assert.ok(submitBody.includes('computeCashDrawerVariance(countedCash, expectedCash, bookDigits)'));
    assert.ok(!submitBody.includes('(countedCash - expectedCash).toFixed(2)'));
    assert.ok(settleBody.includes('computeCashDrawerVariance(countedCash, expectedCash, bookDigits)'));
    assert.ok(!settleBody.includes('(countedCash - expectedCash).toFixed(2)'));
    assert.ok(!settleBody.includes('(grossCashCollected - totalTripExpenses).toFixed(2)'));
  }

  console.log('cash-variance-unification: all cases passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
