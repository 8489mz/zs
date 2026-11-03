/*
New file: backend/test/critical/sale-tax-rate-enforcement.spec.ts
Pins Tax F1: the invoice tax rate is the tenant's configured rate
or 0 (exempt) — never whatever the client sent. `normalizeSalePayload`
took payload.taxRate verbatim and no backend code ever read the
settings `taxRate` the POS itself displays, so a tampered client
could post a zero-tax sale on a 15% tenant (or a 999% one), and an
edit re-derived a posted invoice's tax from the new payload rate.

WHAT THIS PINS:
- Pure rule table for resolveSaleTaxRate (configured / legacy
  spelling / absent / string / tolerance / exempt / invalid).
- The real createSale, driven with a mock DB: a mismatched rate
  throws SALE_TAX_RATE_MISMATCH before any write; a matching rate,
  an exempt 0, the legacy `tax_rate` spelling, and an omitted rate
  all pass the gate (and reach the first post-gate query, which the
  mock refuses). The mock answers the identical preamble for every
  case, so only the gate discriminates the outcomes.
- Purchases are deliberately untouched (a purchase rate is the
  supplier invoice's own rate) — no purchase assertion here.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { SalesWriteService } from '../../src/modules/sales/services/sales-write.service';
import { resolveSaleTaxRate } from '../../src/modules/sales/engines/sale-tax-rate.engine';

function chainable(terminal: Record<string, any>) {
  const builder: any = {};
  for (const key of ['selectAll', 'select', 'where', 'forUpdate', 'leftJoin', 'innerJoin', 'orderBy', 'limit', 'onRef', 'on']) {
    builder[key] = (...args: any[]) => {
      if ((key === 'leftJoin' || key === 'innerJoin') && typeof args[1] === 'function') args[1](builder);
      return builder;
    };
  }
  Object.assign(builder, terminal);
  return builder;
}

function buildService(settingsRows: any[]) {
  const trx: any = {
    executeQuery: async () => ({ rows: [] }),
    getExecutor: () => ({
      compileQuery: (node: any) => ({ sql: '', parameters: [], query: node }),
      transformQuery: (query: any) => query,
      executeQuery: async () => ({ rows: [] }),
    }),
    selectFrom: (table: string) => {
      if (table === 'accounting_settings') {
        return chainable({ executeTakeFirst: async () => ({ lock_date_all: null, lock_date_non_adviser: null, lock_date_tax: null }) });
      }
      if (table === 'accounting_fiscal_periods') {
        return chainable({ executeTakeFirst: async () => null });
      }
      if (table === 'settings') {
        return chainable({
          executeTakeFirst: async () => ({ value: '"EGP"' }),
          execute: async () => settingsRows,
        });
      }
      if (table === 'currency_exchange_rates') {
        return chainable({ execute: async () => [{ currency_code: 'EGP', exchange_rate: 1 }] });
      }
      if (table === 'customers') {
        return chainable({
          executeTakeFirst: async () => ({
            id: 21, name: 'Customer', balance: 0, credit_limit: 0,
            store_credit_balance: 0, loyalty_points: 0,
            is_credit_blocked: false, credit_block_reason: null,
          }),
        });
      }
      if (table === 'products as p') {
        return chainable({
          execute: async () => [{
            id: 1, name: 'Widget', name_en: null, stock_qty: 100, reserved_qty: 0,
            retail_price: 100, wholesale_price: 90, cost_price: 60,
            min_selling_price: 0, item_type: 'product', bom_id: null,
          }],
        });
      }
      if (table === 'product_offers') {
        return chainable({ execute: async () => [] });
      }
      throw new Error(`unexpected (query|write) ${table}: the tax gate must run before it`);
    },
    insertInto: () => { throw new Error('unexpected write: the tax gate must run before any write'); },
    updateTable: () => { throw new Error('unexpected write: the tax gate must run before any write'); },
    deleteFrom: () => { throw new Error('unexpected write: the tax gate must run before any write'); },
  };
  const service = Object.create(SalesWriteService.prototype);
  service.db = {};
  service.tx = { runInTransaction: async (_db: any, cb: any) => cb(trx) };
  service.lockSaleStockRows = async () => {};
  // The open-shift gate (INV-ADMIN-CASH-SALE-SHIFT-REQUIRED) now
  // calls this.authz.hasOpenCashierShift after the tax gate. The
  // stub reports an open shift so execution reaches the first
  // post-gate query, preserving this spec's sentinel assertions
  // about the tax gate running before any write.
  service.authz = { hasOpenCashierShift: async () => true };
  return service;
}

function salePayload(tenantId: string, taxRate?: number): { payload: any; auth: any } {
  const payload: any = {
    customerId: 21,
    paymentType: 'cash',
    items: [{ productId: 1, qty: 1, unitPrice: 100 }],
    pricesIncludeTax: false,
  };
  if (taxRate !== undefined) payload.taxRate = taxRate;
  const auth: any = { userId: 1, tenantId, accountId: 'a1', role: 'admin', permissions: [], sessionId: 'x', username: 't' };
  return { payload, auth };
}

async function main() {
  // Part A: the pure rule.
  assert.equal(resolveSaleTaxRate(15, 15), 15);
  assert.equal(resolveSaleTaxRate(0, 15), 0);
  assert.equal(resolveSaleTaxRate(15.0001, 15), 15);
  assert.equal(resolveSaleTaxRate(0, 0), 0);
  assert.equal(resolveSaleTaxRate(15, '15'), 15);
  assert.equal(resolveSaleTaxRate(undefined, 15), 0);
  assert.equal(resolveSaleTaxRate(0, undefined), 0);
  assert.equal(resolveSaleTaxRate(0, -5), 0);
  assert.throws(() => resolveSaleTaxRate(7, 15), /SALE_TAX_RATE_MISMATCH/);
  assert.throws(() => resolveSaleTaxRate(14, 0), /SALE_TAX_RATE_MISMATCH/);
  assert.throws(() => resolveSaleTaxRate(14, undefined), /SALE_TAX_RATE_MISMATCH/);
  assert.throws(() => resolveSaleTaxRate(-5, 15), /SALE_TAX_RATE_MISMATCH/);
  assert.throws(() => resolveSaleTaxRate('abc', 15), /SALE_TAX_RATE_INVALID/);
  assert.throws(() => resolveSaleTaxRate(14, -5), /SALE_TAX_RATE_MISMATCH/);

  // Part B: the real createSale through the mock DB. Distinct tenant
  // ids per case: the settings map is cached statically for 60s.
  const settingsRows = (rateKey: string | null, rateValue: any) => [
    { key: 'currency', value: '"EGP"' },
    ...(rateKey ? [{ key: rateKey, value: JSON.stringify(rateValue) }] : []),
  ];

  // 1. Mismatched rate -> rejected before any write.
  {
    const service = buildService(settingsRows('taxRate', 15));
    const { payload, auth } = salePayload('t-tax-mismatch', 7);
    await assert.rejects(async () => service.createSale(payload, auth), /SALE_TAX_RATE_MISMATCH/);
  }

  // 2. Matching rate -> passes the gate (reaches the first post-gate query).
  {
    const service = buildService(settingsRows('taxRate', 15));
    const { payload, auth } = salePayload('t-tax-match', 15);
    await assert.rejects(async () => service.createSale(payload, auth), /unexpected (query|write)/);
  }

  // 3. Exempt 0 on a 15% tenant -> passes the gate.
  {
    const service = buildService(settingsRows('taxRate', 15));
    const { payload, auth } = salePayload('t-tax-exempt', 0);
    await assert.rejects(async () => service.createSale(payload, auth), /unexpected (query|write)/);
  }

  // 4. Unconfigured tenant (no rate key) behaves as 0: 14 rejected.
  {
    const service = buildService(settingsRows(null, null));
    const { payload, auth } = salePayload('t-tax-unconfigured', 14);
    await assert.rejects(async () => service.createSale(payload, auth), /SALE_TAX_RATE_MISMATCH/);
  }

  // 5. Legacy `tax_rate` spelling is honored.
  {
    const service = buildService(settingsRows('tax_rate', 14));
    const { payload, auth } = salePayload('t-tax-legacy', 14);
    await assert.rejects(async () => service.createSale(payload, auth), /unexpected (query|write)/);
  }
  {
    const service = buildService(settingsRows('tax_rate', 14));
    const { payload, auth } = salePayload('t-tax-legacy-2', 15);
    await assert.rejects(async () => service.createSale(payload, auth), /SALE_TAX_RATE_MISMATCH/);
  }

  // 6. Omitted rate normalizes to 0 (exempt) -> passes the gate.
  {
    const service = buildService(settingsRows('taxRate', 15));
    const { payload, auth } = salePayload('t-tax-omitted');
    await assert.rejects(async () => service.createSale(payload, auth), /unexpected (query|write)/);
  }

  console.log('Sale tax rate enforcement tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
