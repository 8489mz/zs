/*
 * INV-SUBSCRIPTION-TAX-RATE-SOURCE: a subscription line's tax rate comes
 * from the canonical tax engine, never straight from the client DTO.
 *
 * WHAT THE AUDIT FOUND: createSubscription passed `line.taxRate || 0`
 * from the DTO straight into calculateSubscriptionLineTotals and stored
 * it as `tax_rate`. A client could bill a subscription at any rate
 * (7%, 15%, 0% on a taxed tenant) while the canonical engine
 * (resolveSaleTaxRate, used by createSale) allows exactly the tenant's
 * configured rate or 0 (exempt) and rejects anything else.
 *
 * WHAT THIS PINS (service-level, PGlite):
 * 1. DTO rate == configured rate (14) -> contract created, stored
 *    tax_rate 14, recurring_amount carries the 14% tax (5 x 200 -> 1140).
 * 2. DTO rate 7 on a 14% tenant -> SALE_TAX_RATE_MISMATCH, no rows written.
 * 3. DTO rate 15 on a 14% tenant -> SALE_TAX_RATE_MISMATCH, no rows written.
 * 4. DTO rate 0 / omitted on a 14% tenant -> exempt contract, tax 0.
 * 5. Legacy `tax_rate` settings key (no `taxRate` key) still resolves.
 * 6. No configured rate at all: a 14% DTO rate is rejected, 0 passes.
 *
 * Deliberately NOT driven here: generateDueInvoices re-reads the
 * STORED line rates (no DTO involved) — a contract's rate is fixed at
 * creation, so recurring billing must not re-gate legacy rows against
 * a possibly-changed configured rate. The fix is prospective only:
 * stored historical rates are never rewritten.
 */

import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { CommercialSubscriptionService } from '../../src/modules/sales/services/commercial-subscription.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE settings (key text NOT NULL, value text, tenant_id text NOT NULL, account_id text NOT NULL, PRIMARY KEY (tenant_id, key));
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text NOT NULL, currency_code text NOT NULL, exchange_rate numeric NOT NULL, is_base boolean NOT NULL DEFAULT false);
      CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text NOT NULL, name text NOT NULL);
      CREATE TABLE commercial_subscriptions (id text PRIMARY KEY, tenant_id text NOT NULL, contract_number text, customer_id bigint, billing_period text NOT NULL, next_billing_date text NOT NULL, auto_renew boolean NOT NULL DEFAULT true, recurring_amount numeric NOT NULL DEFAULT 0, status text NOT NULL, payment_method text, start_date text NOT NULL, end_date text, notes text, invoices_count int NOT NULL DEFAULT 0, last_generated_invoice_id bigint, last_generated_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE commercial_subscription_lines (id text PRIMARY KEY, tenant_id text NOT NULL, subscription_id text NOT NULL, product_id bigint, description text, quantity numeric NOT NULL DEFAULT 0, unit_price numeric NOT NULL DEFAULT 0, tax_rate numeric NOT NULL DEFAULT 0, total_price numeric NOT NULL DEFAULT 0, created_at timestamptz DEFAULT NOW());
    `);

    function authFor(tenantId: string): AuthContext {
      return {
        userId: 1, sessionId: 'sess-spec', username: 'actor-1', role: 'admin',
        permissions: [], tenantId, accountId: tenantId,
      } as unknown as AuthContext;
    }

    async function seedTenant(
      tenantId: string,
      settings: Array<{ key: string; value: string }>,
      customerId: number,
    ): Promise<void> {
      await anyDb.insertInto('settings').values({ key: 'currency', value: 'EGP', tenant_id: tenantId, account_id: tenantId }).execute();
      for (const setting of settings) {
        await anyDb.insertInto('settings').values({ ...setting, tenant_id: tenantId, account_id: tenantId }).execute();
      }
      await anyDb
        .insertInto('currency_exchange_rates')
        .values({ tenant_id: tenantId, currency_code: 'EGP', exchange_rate: 1, is_base: true })
        .execute();
      await anyDb.insertInto('customers').values({ id: customerId, tenant_id: tenantId, name: 'Acme' }).execute();
    }

    function dto(taxRate?: number, customerId = 1): any {
      const line: any = { description: 'Monthly service', quantity: 5, unitPrice: 200 };
      if (taxRate !== undefined) line.taxRate = taxRate;
      return {
        customerId, billingPeriod: 'monthly', startDate: '2026-01-01',
        lines: [line],
      };
    }

    async function subscriptionCount(tenantId: string): Promise<number> {
      const row = await anyDb
        .selectFrom('commercial_subscriptions')
        .select((eb: any) => eb.fn.countAll().as('count'))
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      return Number(row?.count || 0);
    }

    async function expectMismatch(
      service: CommercialSubscriptionService,
      tenantId: string,
      taxRate: number | undefined,
      customerId = 1,
    ): Promise<void> {
      let caught: any = null;
      try {
        await service.createSubscription(authFor(tenantId), dto(taxRate, customerId));
      } catch (error) {
        caught = error;
      }
      assert.ok(caught, `rate ${taxRate} on ${tenantId} must be rejected`);
      assert.ok(
        String((caught as any)?.code || '').includes('SALE_TAX_RATE_MISMATCH') ||
          String((caught as any)?.message || '').includes('SALE_TAX_RATE_MISMATCH'),
        `expected SALE_TAX_RATE_MISMATCH, got ${String((caught as any)?.code || caught)}`,
      );
    }

    const service = new CommercialSubscriptionService(db);

    // 1. DTO rate == configured rate -> created, stored rate and totals agree.
    await seedTenant('t-14', [{ key: 'taxRate', value: '14' }], 1);
    const created = await service.createSubscription(authFor('t-14'), dto(14));
    assert.equal(created.success, true);
    const sub14 = await anyDb.selectFrom('commercial_subscriptions').selectAll().where('tenant_id', '=', 't-14').executeTakeFirstOrThrow();
    assert.equal(Number(sub14.recurring_amount), 1140);
    const line14 = await anyDb.selectFrom('commercial_subscription_lines').selectAll().where('subscription_id', '=', created.subscriptionId).executeTakeFirstOrThrow();
    assert.equal(Number(line14.tax_rate), 14);
    assert.equal(Number(line14.total_price), 1140);

    // 2 + 3. DTO rates that match neither configured nor 0 are rejected, nothing stored.
    await expectMismatch(service, 't-14', 7);
    await expectMismatch(service, 't-14', 15);
    assert.equal(await subscriptionCount('t-14'), 1);

    // 4. Exempt (0 / omitted) still passes on a taxed tenant.
    const exempt = await service.createSubscription(authFor('t-14'), dto(0));
    assert.equal(exempt.success, true);
    const subExempt = await anyDb.selectFrom('commercial_subscriptions').selectAll().where('id', '=', exempt.subscriptionId).executeTakeFirstOrThrow();
    assert.equal(Number(subExempt.recurring_amount), 1000);
    const omitted = await service.createSubscription(authFor('t-14'), dto(undefined));
    assert.equal(omitted.success, true);
    const lineOmitted = await anyDb.selectFrom('commercial_subscription_lines').selectAll().where('subscription_id', '=', omitted.subscriptionId).executeTakeFirstOrThrow();
    assert.equal(Number(lineOmitted.tax_rate), 0);

    // 5. Legacy `tax_rate` settings key resolves the same way.
    await seedTenant('t-legacy', [{ key: 'tax_rate', value: '14' }], 2);
    const legacy = await service.createSubscription(authFor('t-legacy'), dto(14, 2));
    assert.equal(legacy.success, true);
    await expectMismatch(service, 't-legacy', 7, 2);
    assert.equal(await subscriptionCount('t-legacy'), 1);

    // 6. No configured rate: only exempt passes.
    await seedTenant('t-none', [], 3);
    await expectMismatch(service, 't-none', 14, 3);
    assert.equal(await subscriptionCount('t-none'), 0);
    const noneExempt = await service.createSubscription(authFor('t-none'), dto(0, 3));
    assert.equal(noneExempt.success, true);

    console.log('subscription tax-rate source checks passed (6 cases)');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
