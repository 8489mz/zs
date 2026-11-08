/*
New file: backend/test/critical/import-landed-cost-canonical.spec.ts
Pins the W1 canonical landed-cost unification (U4).

WHAT CHANGED: calculateLandedCostBreakdown, calculateLateExpenseAllocation
and calculateDemurrageRisk used private toFixed math. Book-money outputs
now round through roundMoney at the tenant base currency's digits and the
overhead split goes through allocateLandedCosts, so the parts sum exactly
to the posted total. The live recalculation path passes the tenant's
digits (tenantBaseCurrency -> currencyMoneyDigits) instead of guessing EGP.

WHAT THIS PINS, calling the REAL pure engines directly plus the REAL
ImportSalesService.calculateLandedCost on PGlite end to end:
- allocation sums exactly: a 100 EGP overhead over 3 equal items splits
  33.34 / 33.33 / 33.33 and the parts sum to the total.
- 3dp vs 2dp: a 100.125 overhead stays 100.125 at KWD digits and rounds
  to 100.13 at EGP digits (2dp identity only on exact-binary values).
- FX fail-closed: a missing, zero, negative, or non-finite rate throws
  instead of costing at rate 1.
- late-expense split sums exactly (COGS + inventory == total), at 2dp
  and at 3dp, including a fractional split.
- demurrage fees round at book digits (2dp 100.13 / 3dp 100.125).
- live wiring: the service recalculation on an EGP tenant allocates at
  2dp and on a KWD tenant keeps 100.125 — the digits come from the
  tenant's settings, not from a hardcoded default — and the stored
  per-unit costs match the returned breakdown.

DELIBERATELY UNCHANGED (grounded, not missed): per-unit costs
(baseCostEgp, unitOverheadEgp, landedCostEgp) stay at 4 decimals —
migration 0271 stores them in NUMERIC(15, 4) and the tiny-rate pin
needs sub-cent unit precision. The demurrage estimate keeps its
labelled 14-day / $50 / rate-1 assumptions under
INV-IMPORT-ESTIMATES-HONEST (pinned by
import-feasibility-estimates-honest.spec.ts Case 4): they are named in
the assumptions object, never silently posted, and the read callers
pass a possibly-null arrival rate, so failing closed there would turn
shipment reads into errors. Only the fee rounding is canonicalised.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import {
  calculateLandedCostBreakdown,
  calculateLateExpenseAllocation,
  calculateDemurrageRisk,
} from '../../src/modules/import-sales/engines/import-landed-cost.engine';

function testAllocationSumsExactly(): void {
  const threeEqual = [
    { id: '1', productId: 101, quantity: 10, factoryUnitPriceUsd: 10 },
    { id: '2', productId: 102, quantity: 10, factoryUnitPriceUsd: 10 },
    { id: '3', productId: 103, quantity: 10, factoryUnitPriceUsd: 10 },
  ];
  const result = calculateLandedCostBreakdown({
    items: threeEqual,
    exchangeRate: 50,
    shippingCostUsd: 0,
    customsCostEgp: 100,
    internalTransportCostEgp: 0,
  });
  assert.equal(result.totalOverheadEgp, 100, 'Overhead total must be 100 EGP');
  assert.deepEqual(
    result.items.map((item) => item.allocatedOverheadEgp),
    [33.34, 33.33, 33.33],
    'A 100 EGP overhead over 3 equal items splits 33.34 / 33.33 / 33.33',
  );
  assert.equal(
    result.items.reduce((sum, item) => sum + item.allocatedOverheadEgp, 0),
    result.totalOverheadEgp,
    'Allocated parts must sum exactly to the overhead total',
  );
  assert.equal(
    result.items.reduce((sum, item) => sum + item.totalItemLandedCostEgp, 0),
    3 * 10 * 500 + 100,
    'Item totals must reconcile to base cost plus overhead',
  );
}

function testDigitsThreeVsTwo(): void {
  const oneItem = [{ id: '1', productId: 101, quantity: 1, factoryUnitPriceUsd: 10 }];
  const kwd = calculateLandedCostBreakdown({
    items: oneItem,
    exchangeRate: 50,
    shippingCostUsd: 0,
    customsCostEgp: 100.125,
    internalTransportCostEgp: 0,
    moneyDigits: 3,
  });
  assert.equal(kwd.totalOverheadEgp, 100.125, 'KWD (3dp) keeps 100.125');
  assert.equal(kwd.items[0].allocatedOverheadEgp, 100.125, 'KWD allocation keeps 100.125');

  const egp = calculateLandedCostBreakdown({
    items: oneItem,
    exchangeRate: 50,
    shippingCostUsd: 0,
    customsCostEgp: 100.125,
    internalTransportCostEgp: 0,
  });
  assert.equal(egp.totalOverheadEgp, 100.13, 'EGP (2dp) rounds 100.125 to 100.13');
  assert.equal(egp.items[0].allocatedOverheadEgp, 100.13, 'EGP allocation rounds 100.125 to 100.13');
}

function testFxFailClosed(): void {
  const oneItem = [{ id: '1', productId: 101, quantity: 10, factoryUnitPriceUsd: 10 }];
  for (const bad of [undefined, null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => calculateLandedCostBreakdown({
        items: oneItem,
        exchangeRate: bad as number,
        shippingCostUsd: 0,
        customsCostEgp: 0,
        internalTransportCostEgp: 0,
      }),
      /exchange rate/i,
      `rate ${String(bad)} must fail closed`,
    );
  }
}

function testLateExpenseSumsExactly(): void {
  const even = calculateLateExpenseAllocation(50000, 200, 120);
  assert.equal(even.lateCogsAdjustmentEgp, 20000, '40% of the late expense adjusts COGS');
  assert.equal(even.lateInventoryAdjustmentEgp, 30000, '60% adjusts on-hand inventory');
  assert.equal(even.unitCostIncreaseEgp, 250, 'Each on-hand unit rises by 30000 / 120 = 250');
  assert.equal(
    even.lateCogsAdjustmentEgp + even.lateInventoryAdjustmentEgp,
    50000,
    'COGS + inventory must equal the late expense exactly',
  );

  const fractional = calculateLateExpenseAllocation(100, 3, 1);
  assert.equal(fractional.soldQuantity, 2, 'Sold quantity must be 2 of 3');
  assert.equal(
    fractional.lateCogsAdjustmentEgp + fractional.lateInventoryAdjustmentEgp,
    100,
    'A fractional split must still sum exactly to the total',
  );

  const kwd = calculateLateExpenseAllocation(100.125, 2, 1, 3);
  assert.equal(kwd.lateCogsAdjustmentEgp, 50.063, 'KWD split keeps 3dp (50.063)');
  assert.equal(kwd.lateInventoryAdjustmentEgp, 50.062, 'KWD inventory share is 50.062');
  assert.equal(kwd.lateCogsAdjustmentEgp + kwd.lateInventoryAdjustmentEgp, 100.125);

  const egp = calculateLateExpenseAllocation(100.125, 2, 1);
  assert.equal(egp.lateCogsAdjustmentEgp + egp.lateInventoryAdjustmentEgp, 100.13, 'EGP split sums to the 2dp total');
}

function testDemurrageFeeDigits(): void {
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 15); // 14 free days => 1 day overdue
  const egp = calculateDemurrageRisk({
    arrivalDate: pastDate,
    freeDays: 14,
    ratePerDayUsd: 2.0859375,
    exchangeRate: 48,
    status: 'In Customs',
  });
  assert.equal(egp.overdueDays, 1, 'Overdue days must be 1');
  assert.equal(egp.estimatedFeesEgp, 100.13, 'EGP fee rounds 100.125 to 100.13');

  const kwd = calculateDemurrageRisk({
    arrivalDate: pastDate,
    freeDays: 14,
    ratePerDayUsd: 2.0859375,
    exchangeRate: 48,
    status: 'In Customs',
    moneyDigits: 3,
  });
  assert.equal(kwd.estimatedFeesEgp, 100.125, 'KWD fee keeps 100.125');
}

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE import_shipments (id text PRIMARY KEY DEFAULT ('sh-' || md5(random()::text)), tenant_id text, supplier_id bigint, project_id text, container_number text, status text, bill_of_lading text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days numeric, demurrage_start_date text, demurrage_rate_per_day numeric, customs_declaration_no text, vat_refundable_egp numeric, is_consolidated boolean, cost_allocation_method text, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, actual_demurrage_fees numeric, shipped_date text, eta_date text, clearance_date text, arrival_date text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY DEFAULT ('item-' || md5(random()::text)), tenant_id text, shipment_id text, product_id bigint, quantity numeric, received_quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, shortage_handling_method text, gross_weight_kg_unit numeric, cbm_unit numeric, target_retail_margin numeric, target_wholesale_margin numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text, review_reason text, posted_at timestamptz, created_by bigint, journal_entry_id bigint);
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"'), ('tkwd', 'currency', '"KWD"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES
      ('t1', 'EGP', 1, true), ('t1', 'USD', 50, false),
      ('tkwd', 'KWD', 1, true), ('tkwd', 'USD', 50, false);
  `);
  return db;
}

function makeService(db: Kysely<Database>): any {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  return new (ImportSalesService as any)(db, posting);
}

async function testLiveCallerWiring(): Promise<void> {
  const db = await makeDb();
  try {
    const service = makeService(db);

    // EGP tenant: 3 equal items, 100 EGP overhead -> 2dp split.
    await db.insertInto('import_shipments' as never).values({
      id: 'sh-egp', tenant_id: 't1', status: 'Pending', exchange_rate_at_arrival: 50,
      shipping_cost_usd: 0, customs_cost_egp: 100, internal_transport_cost_egp: 0,
    } as never).execute();
    for (let i = 1; i <= 3; i++) {
      await db.insertInto('import_shipment_items' as never).values({
        id: `item-egp-${i}`, tenant_id: 't1', shipment_id: 'sh-egp', product_id: 100 + i,
        quantity: 10, received_quantity: 10, factory_unit_price_usd: 10,
        shortage_handling_method: 'capitalize',
      } as never).execute();
    }
    const egp = await service.calculateLandedCost('t1', 'sh-egp');
    assert.equal(egp.breakdown.totalOverheadEgp, 100, 'Live EGP overhead total must be 100');
    const egpAllocated = [...egp.breakdown.items]
      .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)))
      .map((item: any) => item.allocatedOverheadEgp);
    assert.deepEqual(
      egpAllocated,
      [33.34, 33.33, 33.33],
      'Live EGP recalculation must split through the canonical allocator',
    );
    const storedEgp: any[] = await (db as any).selectFrom('import_shipment_items')
      .select(['id', 'allocated_overhead_egp', 'landed_cost_egp'])
      .where('shipment_id', '=', 'sh-egp').orderBy('id', 'asc').execute();
    assert.equal(Number(storedEgp[0].allocated_overhead_egp), 3.334, 'Stored per-unit overhead matches the breakdown (33.34 / 10)');
    assert.equal(Number(storedEgp[0].landed_cost_egp), 503.334, 'Stored landed cost matches the breakdown ((5000 + 33.34) / 10)');
    assert.equal(Number(storedEgp[1].landed_cost_egp), 503.333, 'Stored landed cost of item 2 matches ((5000 + 33.33) / 10)');

    // KWD tenant: the same engine call must keep 100.125 — if the
    // service guessed EGP digits it would store 100.13 instead.
    await db.insertInto('import_shipments' as never).values({
      id: 'sh-kwd', tenant_id: 'tkwd', status: 'Pending', exchange_rate_at_arrival: 50,
      shipping_cost_usd: 0, customs_cost_egp: 100.125, internal_transport_cost_egp: 0,
    } as never).execute();
    await db.insertInto('import_shipment_items' as never).values({
      id: 'item-kwd-1', tenant_id: 'tkwd', shipment_id: 'sh-kwd', product_id: 201,
      quantity: 1, received_quantity: 1, factory_unit_price_usd: 10,
      shortage_handling_method: 'capitalize',
    } as never).execute();
    const kwd = await service.calculateLandedCost('tkwd', 'sh-kwd');
    assert.equal(kwd.breakdown.totalOverheadEgp, 100.125, 'Live KWD overhead total must keep 100.125');
    assert.equal(kwd.breakdown.items[0].allocatedOverheadEgp, 100.125, 'Live KWD allocation must keep 100.125');
    const storedKwd: any = await (db as any).selectFrom('import_shipment_items')
      .select(['allocated_overhead_egp', 'landed_cost_egp'])
      .where('shipment_id', '=', 'sh-kwd').executeTakeFirstOrThrow();
    assert.equal(Number(storedKwd.landed_cost_egp), 600.125, 'Stored KWD landed cost matches ((500 + 100.125) / 1)');
  } finally {
    await db.destroy();
  }
}

async function main(): Promise<void> {
  testAllocationSumsExactly();
  testDigitsThreeVsTwo();
  testFxFailClosed();
  testLateExpenseSumsExactly();
  testDemurrageFeeDigits();
  await testLiveCallerWiring();
  console.log('import landed cost canonical checks passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
