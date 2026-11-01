/*
 * INV-SUBSCRIPTION-BILLING-DIGITS: subscription billing rounds at the
 * tenant's book precision, never at a hardcoded 2 decimals.
 *
 * WHAT THE AUDIT FEARED: calculateSubscriptionLineTotals and
 * calculateSubscriptionTotals used Number(...toFixed(2)) throughout.
 * On a 3-decimal tenant (KWD) a 0.375 net became 0.38, a 0.0525 tax
 * became 0.05, and a 7.125 recurring amount became 7.13 — the stored
 * subscription totals disagreed with the book-precision journals by
 * up to half a cent per line, silently, on every billing cycle.
 *
 * WHAT THIS PINS (pure engine, book digits required — no silent
 * 2-decimal default):
 * 1. At 3 digits: 3 x 0.125 at 14% -> net 0.375, tax 0.053,
 *    total 0.428 (the old code produced 0.38 / 0.05 / 0.43).
 * 2. At 2 digits the historical results are preserved exactly:
 *    5 x 200 at 14% -> 1000 / 140 / 1140, and the two-line
 *    aggregation -> 3000 / 140 / 3140.
 * 3. The engine file contains no toFixed(2) anymore.
 *
 * 4. The recurring-billing service maps stored line rows onto the
 *    engine inputs (quantity / unit_price / tax_rate -> quantity /
 *    unitPrice / taxRate) and resolves digits from the tenant base
 *    currency: a KWD tenant's recurring sale carries the 3-decimal
 *    totals. Before this package the raw rows were passed straight
 *    through, so unitPrice and taxRate were undefined and every
 *    recurring invoice was created with total 0.
 *
 * Deliberately NOT driven here: the tax-rate source itself (callers
 * supply line tax rates), and invoice posting beyond the sale row
 * (generateDueInvoices writes a sale record, not a journal).
 */

import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import {
  calculateSubscriptionLineTotals,
  calculateSubscriptionTotals,
} from '../../src/modules/sales/engines/subscription-billing.engine';
import { CommercialSubscriptionService } from '../../src/modules/sales/services/commercial-subscription.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

function main(): void {
  // 1. Three-decimal tenant: book precision, not cents.
  const kwd = calculateSubscriptionLineTotals(3, 0.125, 14, 3);
  assert.equal(kwd.netAmount, 0.375);
  assert.equal(kwd.taxAmount, 0.053);
  assert.equal(kwd.totalAmount, 0.428);

  const kwdTotals = calculateSubscriptionTotals(
    [
      { quantity: 3, unitPrice: 0.125, taxRate: 14 },
      { quantity: 1, unitPrice: 7.125, taxRate: 0 },
    ],
    3,
  );
  assert.equal(kwdTotals.subtotal, 7.5);
  assert.equal(kwdTotals.taxTotal, 0.053);
  assert.equal(kwdTotals.grandTotal, 7.553);

  // 2. Two-decimal tenants keep exactly the old results.
  const line = calculateSubscriptionLineTotals(5, 200, 14, 2);
  assert.equal(line.netAmount, 1000);
  assert.equal(line.taxAmount, 140);
  assert.equal(line.totalAmount, 1140);

  const totals = calculateSubscriptionTotals(
    [
      { quantity: 2, unitPrice: 500, taxRate: 14 },
      { quantity: 1, unitPrice: 2000, taxRate: 0 },
    ],
    2,
  );
  assert.equal(totals.subtotal, 3000);
  assert.equal(totals.taxTotal, 140);
  assert.equal(totals.grandTotal, 3140);

  // 3. No hardcoded 2-decimal rounding remains in the engine.
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/modules/sales/engines/subscription-billing.engine.ts'),
    'utf8',
  );
  assert.ok(!source.includes('toFixed(2)'), 'subscription billing must round via roundMoney at book digits');

  console.log('subscription billing digits checks passed');
}

async function serviceMain(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE settings (key text NOT NULL, value text, tenant_id text NOT NULL, account_id text NOT NULL, PRIMARY KEY (tenant_id, key));
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text NOT NULL, currency_code text NOT NULL, exchange_rate numeric NOT NULL, is_base boolean NOT NULL DEFAULT false);
      CREATE TABLE commercial_subscriptions (id text PRIMARY KEY, tenant_id text NOT NULL, contract_number text, customer_id bigint, billing_period text NOT NULL, next_billing_date text NOT NULL, auto_renew boolean NOT NULL DEFAULT true, recurring_amount numeric NOT NULL DEFAULT 0, status text NOT NULL, payment_method text, start_date text NOT NULL, end_date text, notes text, invoices_count int NOT NULL DEFAULT 0, last_generated_invoice_id bigint, last_generated_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE commercial_subscription_lines (id text PRIMARY KEY, tenant_id text NOT NULL, subscription_id text NOT NULL, product_id bigint, description text, quantity numeric NOT NULL DEFAULT 0, unit_price numeric NOT NULL DEFAULT 0, tax_rate numeric NOT NULL DEFAULT 0, total_price numeric NOT NULL DEFAULT 0, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text NOT NULL, customer_id bigint, total numeric NOT NULL DEFAULT 0, subtotal numeric NOT NULL DEFAULT 0, tax_amount numeric NOT NULL DEFAULT 0, paid_amount numeric NOT NULL DEFAULT 0, payment_type text, status text, doc_no text, invoice_number text, order_type text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    `);

    async function seedTenant(tenantId: string, currency: string): Promise<void> {
      await anyDb.insertInto('settings').values({ key: 'currency', value: currency, tenant_id: tenantId, account_id: tenantId }).execute();
      await anyDb
        .insertInto('currency_exchange_rates')
        .values({ tenant_id: tenantId, currency_code: currency, exchange_rate: 1, is_base: true })
        .execute();
    }

    async function seedSubscription(tenantId: string, subId: string, qty: number, unitPrice: number, taxRate: number): Promise<void> {
      await anyDb
        .insertInto('commercial_subscriptions')
        .values({
          id: subId, tenant_id: tenantId, contract_number: `SUB-${subId}`, customer_id: 1,
          billing_period: 'monthly', next_billing_date: '2026-01-01', auto_renew: true,
          recurring_amount: 0, status: 'active', start_date: '2026-01-01', invoices_count: 0,
        })
        .execute();
      await anyDb
        .insertInto('commercial_subscription_lines')
        .values({
          id: `line-${subId}`, tenant_id: tenantId, subscription_id: subId,
          quantity: qty, unit_price: unitPrice, tax_rate: taxRate, total_price: 0,
        })
        .execute();
    }

    function authFor(tenantId: string): AuthContext {
      return {
        userId: 1, sessionId: 'sess-spec', username: 'actor-1', role: 'admin',
        permissions: [], tenantId, accountId: tenantId,
      } as unknown as AuthContext;
    }

    // 4a. KWD tenant: recurring sale at 3-decimal book precision.
    await seedTenant('t-kwd', 'KWD');
    await seedSubscription('t-kwd', 'sub-kwd', 3, 0.125, 14);
    const kwdService = new CommercialSubscriptionService(db);
    const kwdResult = await kwdService.generateDueInvoices(authFor('t-kwd'));
    assert.equal(kwdResult.generatedInvoices.length, 1);
    const kwdSale = await anyDb.selectFrom('sales').selectAll().where('tenant_id', '=', 't-kwd').executeTakeFirstOrThrow();
    assert.equal(Number(kwdSale.subtotal), 0.375);
    assert.equal(Number(kwdSale.tax_amount), 0.053);
    assert.equal(Number(kwdSale.total), 0.428);

    // 4b. EGP tenant: historical 2-decimal results preserved end to end.
    await seedTenant('t-egp', 'EGP');
    await seedSubscription('t-egp', 'sub-egp', 5, 200, 14);
    const egpService = new CommercialSubscriptionService(db);
    await egpService.generateDueInvoices(authFor('t-egp'));
    const egpSale = await anyDb.selectFrom('sales').selectAll().where('tenant_id', '=', 't-egp').executeTakeFirstOrThrow();
    assert.equal(Number(egpSale.subtotal), 1000);
    assert.equal(Number(egpSale.tax_amount), 140);
    assert.equal(Number(egpSale.total), 1140);

    console.log('subscription billing service mapping checks passed');
  } finally {
    await db.destroy();
  }
}

main();
serviceMain().catch((error) => {
  console.error(error);
  process.exit(1);
});
