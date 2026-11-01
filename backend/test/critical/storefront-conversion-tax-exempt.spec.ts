/*
 * INV-STOREFRONT-CONVERSION-TAX-EXEMPT: converting a storefront order
 * into a sale must NOT inject the tenant's configured tax rate.
 *
 * WHY THIS IS CORRECT (not a gap): checkout charges catalog prices
 * with no tax added — the order total is the plain sum of line
 * totals plus delivery minus discount, and the customer pays exactly
 * that amount. convertToSale therefore sends NO tax rate to
 * createSale, and createSale's F1 gate (resolveSaleTaxRate) normalizes
 * the omitted rate to 0 (exempt). Injecting the configured 14%/15%
 * here would post tax the customer never paid, make the sale total
 * exceed the collected amount, and break the paid-amount
 * reconciliation — the exact "helpful fix" a future agent must not
 * make. The :1820 tax_rate: 0 in this service is a different thing
 * (the dine-in kitchen DRAFT, which posts nothing) and is
 * deliberately unchanged.
 *
 * WHAT THIS PINS, driving the REAL convertToSale with a mock DB
 * (the F1-spec technique: the mock answers the preamble queries so
 * only the payload construction is under test; createSale itself is
 * stubbed to capture the payload):
 * 1. The captured sale payload carries no taxRate / tax_rate key.
 * 2. The real F1 engine resolves that omitted rate to 0 even for a
 *    tenant configured at 14.
 * 3. The payload's line sum equals the order total (no phantom tax
 *    base is smuggled in through prices or totals).
 * 4. The convertToSale function body mentions no tax rate at all.
 *
 * Deliberately NOT driven here: createSale's own totals/journal
 * (pinned by the F1 spec), the kitchen draft, and checkout pricing.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import { resolveSaleTaxRate } from '../../src/modules/sales/engines/sale-tax-rate.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

function chainable(terminal: Record<string, any>): any {
  const builder: any = {};
  for (const key of ['selectAll', 'select', 'where', 'forUpdate', 'leftJoin', 'innerJoin', 'orderBy', 'limit', 'onRef', 'on', 'set', 'returning']) {
    builder[key] = (...args: any[]) => {
      if ((key === 'leftJoin' || key === 'innerJoin') && typeof args[1] === 'function') args[1](builder);
      return builder;
    };
  }
  Object.assign(builder, terminal);
  return builder;
}

async function main(): Promise<void> {
  const orderRow: any = {
    id: 77,
    tenant_id: 't-sf',
    account_id: 'a-sf',
    order_number: 'ST-1',
    customer_name: 'Test Customer',
    customer_phone: '01012345678',
    customer_address: 'Cairo',
    items_json: JSON.stringify([
      { productId: 5, productName: 'Widget', quantity: 2, unitPrice: 100, total: 200 },
    ]),
    subtotal: 200,
    delivery_fee: 0,
    delivery_zone_id: null,
    delivery_zone_name: null,
    discount_amount: 0,
    coupon_code: null,
    total_amount: 200,
    status: 'confirmed',
    payment_method: 'cod',
    payment_status: 'pending',
    gateway_provider: null,
    branch_id: 1,
    reserved_branch_id: 1,
    reserved_location_id: 1,
    fulfillment_type: 'pickup',
    order_type: 'pickup',
    sale_id: null,
    table_number: null,
  };

  const mockDb: any = {
    selectFrom: (table: string) => {
      if (table === 'online_orders') {
        return chainable({ executeTakeFirst: async () => orderRow, execute: async () => [orderRow] });
      }
      if (table === 'customers') {
        return chainable({ executeTakeFirst: async () => ({ id: 9, name: 'Test Customer', phone: '01012345678', address: 'Cairo' }) });
      }
      if (table === 'branches') {
        return chainable({ executeTakeFirst: async () => ({ id: 1, default_stock_location_id: 1 }) });
      }
      return chainable({ executeTakeFirst: async () => null, execute: async () => [] });
    },
    insertInto: () => chainable({ executeTakeFirst: async () => ({ id: 9 }), execute: async () => [] }),
    updateTable: () => chainable({ execute: async () => undefined }),
  };

  let captured: any = null;
  const salesStub: any = {
    createSale: async (payload: any) => {
      captured = payload;
      return { id: 9001 };
    },
    getSaleById: async () => ({ id: 9001 }),
  };

  const service = new StorefrontService(mockDb, salesStub, {} as never, {} as never);
  (service as any).retireKitchenDraft = async () => undefined;

  const auth = {
    userId: 1,
    sessionId: 'sess-spec',
    username: 'actor-1',
    role: 'admin',
    permissions: [],
    tenantId: 't-sf',
    accountId: 'a-sf',
  } as unknown as AuthContext;

  const result = await service.convertToSale(77, auth);
  assert.equal(result.saleId, 9001);
  assert.ok(captured, 'createSale must have been called');
  assert.ok(!('taxRate' in captured), 'conversion must not inject a tax rate');
  assert.ok(!('tax_rate' in captured), 'conversion must not inject a legacy tax rate');
  assert.equal(resolveSaleTaxRate(captured.taxRate, 14), 0, 'omitted rate resolves to exempt even on a 14% tenant');
  const lineSum = captured.items.reduce((sum: number, line: any) => sum + Number(line.qty || line.quantity || 0) * Number(line.unitPrice ?? line.price ?? 0), 0);
  assert.equal(lineSum, 200, 'payload lines must sum to the order total with no tax added');

  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/modules/storefront/storefront.service.ts'),
    'utf8',
  );
  const body = source.slice(source.indexOf('async convertToSale('), source.indexOf('async prepareOrderForPos('));
  assert.ok(body.length > 0, 'convertToSale body must be locatable');
  assert.ok(!body.includes('taxRate') && !body.includes('tax_rate'), 'convertToSale must not mention a tax rate');

  console.log('storefront conversion tax exemption checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
