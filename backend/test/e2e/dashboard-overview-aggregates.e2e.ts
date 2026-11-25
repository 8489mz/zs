import 'dotenv/config';
import assert from 'node:assert/strict';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { resolveDatabaseConfigFromEnv } from '../../src/database/migration-runner';
import { resolvePgSslConfig } from '../../src/database/ssl.util';
import type { Database } from '../../src/database/database.types';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { ReportsService } from '../../src/modules/reports/reports.service';

// PO-2 (PERFORMANCE_CONSTITUTION.md §5, ARCHITECTURE_INVARIANTS.md ledger #44): dashboardOverview
// used to pull every active product/customer/supplier for the tenant into Node and filter/reduce
// over them there. It is now a set of SQL aggregates (COUNT/SUM, some with FILTER, some joined
// against a per-partner ledger subquery). This test is the permanent regression guard for that
// migration: it seeds a disposable tenant with edge cases the old JS logic and the new SQL must
// agree on bit-for-bit (a zero min-stock threshold, an inactive row, a partner sitting exactly on
// the credit-limit boundary, a partner with no ledger activity at all), runs the real
// ReportsService.dashboardOverview against a real Postgres instance, and asserts every derived
// number. Everything happens inside one transaction that is rolled back unconditionally, so this
// test never leaves rows behind — it needs a migrated schema (run after `migration:run`, which is
// why it lives in test/e2e and not test/critical: CI's test:critical step runs before migrations).

const TENANT = '__po2_verify_tmp__';

async function main(): Promise<void> {
  const config = resolveDatabaseConfigFromEnv();
  const pool = new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.name,
    ssl: resolvePgSslConfig({
      enabled: config.ssl,
      rejectUnauthorized: config.sslRejectUnauthorized,
      caCert: config.sslCaCert,
    }),
    application_name: 'backend-e2e-po2',
  });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

  const ROLLBACK_SENTINEL = new Error('__intentional_rollback__');

  try {
    await db.transaction().execute(async (trx) => {
      await sql`
        insert into products (id, name, tenant_id, stock_qty, min_stock_qty, cost_price, retail_price, is_active)
        values
          (-901, 'P1 low', ${TENANT}, 5, 10, 2, 3, true),
          (-902, 'P2 out', ${TENANT}, 0, 5, 1, 2, true),
          (-903, 'P3 healthy', ${TENANT}, 100, 5, 4, 6, true),
          (-904, 'P4 no-threshold', ${TENANT}, 3, 0, 1, 1, true),
          (-905, 'P5 inactive', ${TENANT}, 2, 10, 5, 8, false)
      `.execute(trx);

      await sql`
        insert into customers (id, name, tenant_id, credit_limit, is_active)
        values
          (-901, 'C1 near', ${TENANT}, 1000, true),
          (-902, 'C2 above', ${TENANT}, 1000, true),
          (-903, 'C3 no-limit', ${TENANT}, 0, true),
          (-904, 'C4 no-ledger', ${TENANT}, 500, true),
          (-905, 'C5 inactive', ${TENANT}, 2000, false)
      `.execute(trx);
      await sql`
        insert into customer_ledger (id, customer_id, entry_type, amount, balance_after, tenant_id)
        values
          (-901, -901, 'sale', 850, 850, ${TENANT}),
          (-902, -902, 'sale', 1200, 1200, ${TENANT}),
          (-903, -903, 'sale', 500, 500, ${TENANT}),
          (-904, -905, 'sale', 1900, 1900, ${TENANT})
      `.execute(trx);

      await sql`
        insert into suppliers (id, name, tenant_id, is_active)
        values
          (-901, 'S1 high', ${TENANT}, true),
          (-902, 'S2 just-under', ${TENANT}, true),
          (-903, 'S3 no-ledger', ${TENANT}, true),
          (-904, 'S4 inactive', ${TENANT}, false)
      `.execute(trx);
      await sql`
        insert into supplier_ledger (id, supplier_id, entry_type, amount, balance_after, tenant_id)
        values
          (-901, -901, 'purchase', 1500, 1500, ${TENANT}),
          (-902, -902, 'purchase', 999, 999, ${TENANT}),
          (-903, -904, 'purchase', 5000, 5000, ${TENANT})
      `.execute(trx);

      const service = new ReportsService(trx as unknown as Kysely<Database>);
      const auth = { tenantId: TENANT, accountId: 'e2e-po2' } as AuthContext;
      const result = await service.dashboardOverview({} as never, auth);

      const stats = result.stats as Record<string, unknown>;
      const summary = result.summary as Record<string, unknown>;
      const lowStock = result.lowStock as Array<Record<string, unknown>>;
      const topCustomers = result.topCustomers as Array<Record<string, unknown>>;
      const topSuppliers = result.topSuppliers as Array<Record<string, unknown>>;

      // Products: P5 is inactive and excluded everywhere. P1 is low stock (5 <= min 10). P2 is out
      // of stock (0). P4 has min_stock_qty = 0, so it must NOT count as low stock even though its
      // stock (3) is small — the threshold condition requires min_stock_qty > 0.
      assert.equal(summary.totalProducts, 4, 'totalProducts excludes the inactive product');
      assert.equal(summary.lowStockCount, 1, 'only P1 qualifies as low stock');
      assert.equal(summary.outOfStockCount, 1, 'only P2 is out of stock');
      assert.equal(stats.inventoryCost, 413, '5*2 + 0*1 + 100*4 + 3*1 (P5 excluded)');
      assert.equal(stats.inventorySaleValue, 618, '5*3 + 0*2 + 100*6 + 3*1 (P5 excluded)');
      assert.equal(lowStock.length, 1);
      assert.equal(lowStock[0]?.name, 'P1 low');

      // Customers: C5 is inactive and excluded from counts/top-list/credit-limit checks, but its
      // ledger balance still counts toward customerDebt (matches the pre-migration behaviour, which
      // summed every ledger row for the tenant regardless of the customer's active flag).
      assert.equal(stats.customersCount, 4, 'C5 (inactive) excluded');
      assert.equal(stats.customerDebt, 4450, '850+1200+500+0+1900 — sums ALL ledger rows, active or not');
      assert.equal(stats.nearCreditLimit, 1, 'only C1 sits in [80%, 100%] of its credit limit');
      assert.equal(stats.aboveCreditLimit, 1, 'only C2 exceeds its credit limit');
      assert.equal(topCustomers.length, 3, 'C4 (zero balance) and C5 (inactive) excluded');
      assert.deepEqual(
        topCustomers.map((c) => c.total),
        [1200, 850, 500],
        'ordered by balance desc',
      );

      // Suppliers: same active/inactive split as customers.
      assert.equal(stats.suppliersCount, 3, 'S4 (inactive) excluded');
      assert.equal(stats.supplierDebt, 7499, '1500+999+0+5000 — sums ALL ledger rows, active or not');
      assert.equal(stats.highSupplierBalances, 1, 'only S1 is >= 1000');
      assert.equal(topSuppliers.length, 2, 'S3 (zero balance) and S4 (inactive) excluded');
      assert.deepEqual(
        topSuppliers.map((s) => s.total),
        [1500, 999],
        'ordered by balance desc',
      );

      process.stdout.write('dashboard-overview-aggregates.e2e: all PO-2 aggregate checks passed\n');
      throw ROLLBACK_SENTINEL;
    });
  } catch (error) {
    if (error !== ROLLBACK_SENTINEL) throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  const details = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`dashboard-overview-aggregates.e2e failed:\n${details}\n`);
  process.exit(1);
});
