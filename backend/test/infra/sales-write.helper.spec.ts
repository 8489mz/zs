import assert from 'node:assert/strict';
import { AppError } from '../../src/common/errors/app-error';
import { applyStockDelta } from '../../src/common/utils/location-stock-ledger';
import { buildPreparedSaleItem, calculateAllowedSaleUnitPrice, calculateCollectibleTotal, calculatePaidAmount, calculateRestoredStockQuantity, paidAmountExceedsRecordedPayments, resolvePostedSalePaymentChannel, resolveSalePayments } from '../../src/modules/sales/helpers/sales-write.helper';

const STOCK_TEST_SCOPE = { tenantId: 'tenant-test', accountId: 'account-test' };

type FakeProduct = { id: number; name: string; stock_qty: number; tenant_id?: string; account_id?: string };
type FakeLocationStock = { id: number; product_id: number; branch_id: number | null; location_id: number | null; qty: number; tenant_id?: string; account_id?: string };
type FakeStockState = { products: FakeProduct[]; locationStock: FakeLocationStock[]; nextLocationStockId: number };

class FakeSelectBuilder {
  private filters = new Map<string, unknown>();
  constructor(private readonly table: string, private readonly state: FakeStockState) {}
  select(_columns: unknown): this { return this; }
  where(column: string | unknown, _operator?: string, value?: unknown): this {
    if (typeof column === 'string') this.filters.set(column, value);
    return this;
  }
  orderBy(_column?: unknown, _direction?: unknown): this { return this; }
  forUpdate(): this { return this; }
  async executeTakeFirst(): Promise<unknown> {
    const rows = await this.execute();
    return rows[0];
  }
  async execute(): Promise<unknown[]> {
    if (this.table === 'products') return this.state.products.filter((row) => row.id === Number(this.filters.get('id') || 0));
    if (this.table === 'product_location_stock') return this.state.locationStock.filter((row) => row.product_id === Number(this.filters.get('product_id') || 0));
    throw new Error(`Unexpected select table ${this.table}`);
  }
}

class FakeInsertBuilder {
  private payload: Record<string, unknown> = {};
  constructor(private readonly table: string, private readonly state: FakeStockState) {}
  values(payload: Record<string, unknown>): this {
    this.payload = payload;
    return this;
  }
  returning(_columns: unknown): this { return this; }
  async executeTakeFirstOrThrow(): Promise<unknown> {
    if (this.table !== 'product_location_stock') throw new Error(`Unexpected insert table ${this.table}`);
    const row: FakeLocationStock = {
      id: this.state.nextLocationStockId,
      product_id: Number(this.payload.product_id),
      branch_id: this.payload.branch_id == null ? null : Number(this.payload.branch_id),
      location_id: this.payload.location_id == null ? null : Number(this.payload.location_id),
      qty: Number(this.payload.qty || 0),
      tenant_id: String(this.payload.tenant_id || ''),
      account_id: String(this.payload.account_id || ''),
    };
    this.state.nextLocationStockId += 1;
    this.state.locationStock.push(row);
    return row;
  }
}

class FakeUpdateBuilder {
  private payload: Record<string, unknown> = {};
  private filters = new Map<string, unknown>();
  constructor(private readonly table: string, private readonly state: FakeStockState) {}
  set(payload: Record<string, unknown>): this {
    this.payload = payload;
    return this;
  }
  where(column: string | unknown, _operator?: string, value?: unknown): this {
    if (typeof column === 'string') this.filters.set(column, value);
    return this;
  }
  async execute(): Promise<void> {
    if (this.table === 'products') {
      const row = this.state.products.find((product) => product.id === Number(this.filters.get('id') || 0));
      if (row && this.payload.stock_qty !== undefined) row.stock_qty = Number(this.payload.stock_qty);
      return;
    }
    if (this.table === 'product_location_stock') {
      const row = this.state.locationStock.find((entry) => entry.id === Number(this.filters.get('id') || 0));
      if (row && this.payload.qty !== undefined) row.qty = Number(this.payload.qty);
      if (row && this.payload.branch_id !== undefined) row.branch_id = this.payload.branch_id == null ? null : Number(this.payload.branch_id);
      return;
    }
    throw new Error(`Unexpected update table ${this.table}`);
  }
}

class FakeStockDb {
  constructor(private readonly state: FakeStockState) {}
  selectFrom(table: string): FakeSelectBuilder { return new FakeSelectBuilder(table, this.state); }
  insertInto(table: string): FakeInsertBuilder { return new FakeInsertBuilder(table, this.state); }
  updateTable(table: string): FakeUpdateBuilder { return new FakeUpdateBuilder(table, this.state); }
}

function createFakeStockDb(stockQty: number, locationQty?: number): { db: FakeStockDb; state: FakeStockState } {
  const state: FakeStockState = {
    products: [{ id: 7, name: 'Beans', stock_qty: stockQty, tenant_id: STOCK_TEST_SCOPE.tenantId, account_id: STOCK_TEST_SCOPE.accountId }],
    locationStock: locationQty === undefined ? [] : [{ id: 1, product_id: 7, branch_id: 3, location_id: 4, qty: locationQty, tenant_id: STOCK_TEST_SCOPE.tenantId, account_id: STOCK_TEST_SCOPE.accountId }],
    nextLocationStockId: locationQty === undefined ? 1 : 2,
  };
  return { db: new FakeStockDb(state), state };
}

const prepared = buildPreparedSaleItem(
  { id: 2, name: 'Tea', stock_qty: '10', cost_price: '3.5' },
  { productId: 2, qty: 2, price: 5, unitName: 'علبة', unitMultiplier: 1.5, priceType: 'retail', notes: '', modifiers: [] },
  { moneyDigits: 2 },
);
assert.deepEqual(prepared, {
  productId: 2,
  productName: 'Tea',
  productNameEn: null,
  qty: 2,
  unitPrice: 5,
  lineTotal: 10,
  unitName: 'علبة',
  unitMultiplier: 1.5,
  priceType: 'retail',
  costPrice: 5.25,
  requiredQty: 3,
  beforeQty: 10,
  afterQty: 7,
  notes: '',
  modifiers: [],
  isService: false,
});

assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, wholesalePrice: 80, priceType: 'retail' }), 100);
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, wholesalePrice: 80, priceType: 'wholesale' }), 80);
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, wholesalePrice: 80, priceType: 'retail', offers: [{ offer_type: 'percent', value: 10, start_date: '2026-01-01', end_date: '2026-12-31' }], todayIso: '2026-04-14' }), 90);
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, wholesalePrice: 80, priceType: 'retail', offers: [{ offer_type: 'fixed', value: 15, start_date: '2026-01-01', end_date: '2026-12-31' }], todayIso: '2026-04-14' }), 85);
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, wholesalePrice: 80, priceType: 'retail', offers: [{ offer_type: 'price', value: 72, start_date: '2026-01-01', end_date: '2026-12-31' }], todayIso: '2026-04-14' }), 72);
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, wholesalePrice: 80, priceType: 'retail', offers: [{ offer_type: 'percent', value: 10, start_date: '2026-04-14', end_date: null }], todayIso: '2026-04-14' }), 90);
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, wholesalePrice: 80, priceType: 'retail', offers: [{ offer_type: 'percent', value: 10, start_date: null, end_date: '2026-04-14' }], todayIso: '2026-04-14' }), 90);
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, wholesalePrice: 80, priceType: 'retail', offers: [{ offer_type: 'percent', value: 10, start_date: '2026-04-15', end_date: null }], todayIso: '2026-04-14' }), 100);
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, wholesalePrice: 80, priceType: 'retail', offers: [{ offer_type: 'percent', value: 10, start_date: null, end_date: '2026-04-13' }], todayIso: '2026-04-14' }), 100);
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, wholesalePrice: 80, priceType: 'retail', offers: [{ offer_type: 'percent', value: 25, min_qty: 3, start_date: '2026-04-14', end_date: '2026-04-14' }], qty: 2, todayIso: '2026-04-14' }), 100);
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, wholesalePrice: 80, priceType: 'retail', offers: [{ offer_type: 'percent', value: 25, min_qty: 3, start_date: '2026-04-14', end_date: '2026-04-14' }], qty: 3, todayIso: '2026-04-14' }), 75);
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, wholesalePrice: 80, priceType: 'retail', offers: [{ offer_type: 'percent', value: 10, start_date: '2026-04-14T23:30:00.000Z', end_date: '2026-04-14T01:30:00.000Z' }], todayIso: '2026-04-14' }), 90);
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 120, wholesalePrice: 90, priceType: 'retail', offers: [{ offer_type: 'bundle', value: 500, min_qty: 5, start_date: '2026-01-01', end_date: '2026-12-31' }], qty: 5, todayIso: '2026-04-14' }), 100);
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 120, wholesalePrice: 90, priceType: 'retail', offers: [{ offer_type: 'bundle', value: 500, min_qty: 5, start_date: '2026-01-01', end_date: '2026-12-31' }], qty: 7, todayIso: '2026-04-14' }), 105.71);
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 120, wholesalePrice: 90, priceType: 'retail', offers: [{ offer_type: 'bundle', value: 500, min_qty: 5, start_date: '2026-01-01', end_date: '2026-12-31' }], qty: 3, todayIso: '2026-04-14' }), 120);

// BOGO Offers (Buy X Get Y Free / Discounted)
// Buy 1 Get 1 Free (100% discount on 2nd item)
const bogo1Plus1 = [{ offer_type: 'bogo', bogo_buy_qty: 1, bogo_get_qty: 1, bogo_discount_percent: 100, start_date: '2026-01-01', end_date: '2026-12-31' }];
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, priceType: 'retail', offers: bogo1Plus1, qty: 1, todayIso: '2026-04-14' }), 100);
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, priceType: 'retail', offers: bogo1Plus1, qty: 2, todayIso: '2026-04-14' }), 50);
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, priceType: 'retail', offers: bogo1Plus1, qty: 3, todayIso: '2026-04-14' }), 66.67);
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, priceType: 'retail', offers: bogo1Plus1, qty: 4, todayIso: '2026-04-14' }), 50);

// Buy 2 Get 1 at 50% discount
const bogo2Plus1Half = [{ offer_type: 'bogo', bogo_buy_qty: 2, bogo_get_qty: 1, bogo_discount_percent: 50, start_date: '2026-01-01', end_date: '2026-12-31' }];
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, priceType: 'retail', offers: bogo2Plus1Half, qty: 2, todayIso: '2026-04-14' }), 100);
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, priceType: 'retail', offers: bogo2Plus1Half, qty: 3, todayIso: '2026-04-14' }), 83.33);

// Happy Hours & Days of Week Offers
const happyHourOffer = [{ offer_type: 'percent', value: 20, happy_hour_start: '14:00', happy_hour_end: '18:00', start_date: '2026-01-01', end_date: '2026-12-31' }];
const insideHappyHour = new Date('2026-04-14T15:30:00'); // 15:30
const outsideHappyHour = new Date('2026-04-14T19:00:00'); // 19:00
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, priceType: 'retail', offers: happyHourOffer, qty: 1, todayIso: '2026-04-14', now: insideHappyHour }), 80);
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, priceType: 'retail', offers: happyHourOffer, qty: 1, todayIso: '2026-04-14', now: outsideHappyHour }), 100);

// Specific days of week (e.g. Day 1 = Monday)
const mondayOnlyOffer = [{ offer_type: 'percent', value: 30, days_of_week: '1', start_date: '2026-01-01', end_date: '2026-12-31' }];
const mondayDate = new Date('2026-04-13T12:00:00'); // Monday
const tuesdayDate = new Date('2026-04-14T12:00:00'); // Tuesday
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, priceType: 'retail', offers: mondayOnlyOffer, qty: 1, todayIso: '2026-04-13', now: mondayDate }), 70);
assert.equal(calculateAllowedSaleUnitPrice({ moneyDigits: 2, retailPrice: 100, priceType: 'retail', offers: mondayOnlyOffer, qty: 1, todayIso: '2026-04-14', now: tuesdayDate }), 100);

assert.equal(calculateCollectibleTotal(120, 20, 2), 100);
assert.deepEqual(resolveSalePayments('credit', [{ paymentChannel: 'cash', amount: 10 }], 100), [{ paymentChannel: 'cash', amount: 10 }]);
assert.deepEqual(resolveSalePayments('credit', [], 100), []);
assert.deepEqual(resolveSalePayments('cash', [], 55), [{ paymentChannel: 'cash', amount: 55 }]);
assert.equal(calculatePaidAmount([{ amount: 10 }, { amount: 5.255 }], 2), 15.26);

// Sale-edit guard at book digits: two 0.004 payments plus a 0.008 header
// must not block the edit on a 3-decimal tenant (cents netting blocked
// it: 0 + 0 recorded cents vs 1 header cent), while a 0.009 header over
// the same rows must block it. The same amounts at 2 digits would block,
// because the digits — not the amounts alone — decide the answer.
assert.equal(paidAmountExceedsRecordedPayments([{ amount: 0.004 }, { amount: 0.004 }], 0.008, 3), false);
assert.equal(paidAmountExceedsRecordedPayments([{ amount: 0.004 }, { amount: 0.004 }], 0.009, 3), true);
assert.equal(paidAmountExceedsRecordedPayments([{ amount: 0.004 }, { amount: 0.004 }], 0.008, 2), true);
assert.equal(paidAmountExceedsRecordedPayments([{ amount: 100 }, { amount: 50 }], 150, 2), false);
assert.equal(paidAmountExceedsRecordedPayments([{ amount: 100 }, { amount: 50 }], 149.99, 2), false);
assert.equal(paidAmountExceedsRecordedPayments([{ amount: 100 }, { amount: 50 }], 150.01, 2), true);
assert.equal(paidAmountExceedsRecordedPayments([{ amount: '100.125' }, { amount: null }], '100.125', 3), false);
assert.equal(paidAmountExceedsRecordedPayments([{ amount: 100 }], Number.NaN, 2), true);
assert.equal(paidAmountExceedsRecordedPayments([{ amount: Number.POSITIVE_INFINITY }], 100, 2), true);
assert.equal(resolvePostedSalePaymentChannel('credit', []), 'credit');
assert.equal(resolvePostedSalePaymentChannel('credit', [{ paymentChannel: 'cash' }]), 'cash');
assert.equal(resolvePostedSalePaymentChannel('credit', [{ paymentChannel: 'cash' }, { paymentChannel: 'card' }]), 'mixed');
assert.equal(resolvePostedSalePaymentChannel('cash', [{ paymentChannel: 'card' }]), 'card');
assert.equal(resolvePostedSalePaymentChannel('cash', [{ paymentChannel: 'cash' }, { paymentChannel: 'card' }]), 'mixed');
assert.deepEqual(calculateRestoredStockQuantity('4', '2', '1.5'), { restoreQty: 3, beforeQty: 4, afterQty: 7 });

assert.throws(
  () => buildPreparedSaleItem({ id: 3, name: 'Sugar', stock_qty: '1', cost_price: '2' }, { productId: 3, qty: 2, price: 5, unitName: 'قطعة', unitMultiplier: 1, priceType: 'retail', notes: '', modifiers: [] }, { moneyDigits: 2 }),
  (error: unknown) => error instanceof AppError && error.code === 'INSUFFICIENT_STOCK',
);

assert.deepEqual(
  buildPreparedSaleItem(
    { id: 3, name: 'Sugar', stock_qty: '1', cost_price: '2' },
    { productId: 3, qty: 2, price: 5, unitName: 'قطعة', unitMultiplier: 1, priceType: 'retail', notes: '', modifiers: [] },
    { allowNegativeStockSales: true, moneyDigits: 2 },
  ),
  {
    productId: 3,
    productName: 'Sugar',
    productNameEn: null,
    qty: 2,
    unitPrice: 5,
    lineTotal: 10,
    unitName: 'قطعة',
    unitMultiplier: 1,
    priceType: 'retail',
    costPrice: 2,
    requiredQty: 2,
    beforeQty: 1,
    afterQty: -1,
    notes: '',
    modifiers: [],
    isService: false,
  },
);

async function runStockDeltaChecks(): Promise<void> {
  assert.equal(
    buildPreparedSaleItem(
      { id: 3, name: 'Sugar', stock_qty: '0', cost_price: '2' },
      { productId: 3, qty: 1, price: 5, unitName: 'قطعة', unitMultiplier: 1, priceType: 'retail', notes: '', modifiers: [] },
      { allowNegativeStockSales: true, moneyDigits: 2 },
    ).afterQty,
    -1,
  );

  const { db, state } = createFakeStockDb(0);
  const stockChange = await applyStockDelta(db as never, {
    ...STOCK_TEST_SCOPE,
    productId: 7,
    delta: -1,
    allowNegative: true,
  });
  assert.deepEqual(stockChange, { globalBefore: 0, globalAfter: -1, scopeBefore: 0, scopeAfter: -1 });
  assert.equal(state.products[0].stock_qty, -1);
  assert.equal(state.locationStock[0].qty, -1);
  assert.equal(state.locationStock[0].tenant_id, STOCK_TEST_SCOPE.tenantId);
  assert.equal(state.locationStock[0].account_id, STOCK_TEST_SCOPE.accountId);

  const exceedStock = createFakeStockDb(1, 1);
  const exceedStockChange = await applyStockDelta(exceedStock.db as never, {
    ...STOCK_TEST_SCOPE,
    productId: 7,
    delta: -2,
    branchId: 3,
    locationId: 4,
    allowNegative: true,
  });
  assert.deepEqual(exceedStockChange, { globalBefore: 1, globalAfter: -1, scopeBefore: 1, scopeAfter: -1 });
  assert.equal(exceedStock.state.products[0].stock_qty, -1);
  assert.equal(exceedStock.state.locationStock.find((row) => row.location_id === 4)?.qty, -1);

  const blocked = createFakeStockDb(1, 1);
  await assert.rejects(
    () => applyStockDelta(blocked.db as never, {
      ...STOCK_TEST_SCOPE,
      productId: 7,
      delta: -2,
      branchId: 3,
      locationId: 4,
      allowNegative: false,
    }),
    (error: unknown) => error instanceof AppError && error.code === 'INSUFFICIENT_STOCK',
  );
  assert.equal(blocked.state.products[0].stock_qty, 1);
  assert.equal(blocked.state.locationStock.find((row) => row.location_id === 4)?.qty, 1);
}

runStockDeltaChecks()
  .then(() => console.log('sales write helper checks passed'))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
