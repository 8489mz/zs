import { strict as assert } from 'node:assert';
import { Client } from 'pg';

/**
 * Disposable PostgreSQL migration-history acceptance for divergent P0-C and main.
 * Called after each real migration run: branch-first, main-first and both.
 * Never connects to a non-local or non-allowlisted database.
 */
async function main(): Promise<void> {
  const mode = process.argv[2];
  assert.ok(['branch-only', 'main-only', 'both'].includes(mode), 'Explicit migration-stage argument required');
  const raw = process.env.ACCEPTANCE_DATABASE_URL;
  assert.ok(raw, 'ACCEPTANCE_DATABASE_URL is required');
  const url = new URL(raw);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Only local disposable PostgreSQL is allowed');
  assert.ok(
    ['/zs_p0c_branch_first_test', '/zs_p0c_main_first_test'].includes(url.pathname),
    'Refusing to inspect a non-P0-C disposable database',
  );
  const db = new Client({ connectionString: raw });
  await db.connect();
  try {
    const names = [
      '2040000000256_currency_minor_unit_precision',
      '2040000000257_purchase_minor_unit_precision',
      '2040000000258_sale_minor_unit_precision',
      '2040000000259_return_minor_unit_precision',
      '2040000000256_sync_tenant_subscriptions_plan_and_upgrade_pro_users',
    ];
    const result = await db.query<{ name: string }>(
      'SELECT name FROM kysely_migration WHERE name = ANY($1::text[]) ORDER BY name',
      [names],
    );
    const actual = result.rows.map((row) => row.name);
    const expected = (
      mode === 'branch-only' ? names.slice(0, 4) : mode === 'main-only' ? names.slice(4) : names
    ).sort();
    assert.deepEqual(
      actual,
      expected,
      'Both original migration identities must be preserved; neither may be renamed or substituted',
    );

    if (mode !== 'main-only') {
      for (const [table, column, minScale] of [
        ['journal_entry_lines', 'debit', 3],
        ['purchases', 'total', 3],
        ['sales', 'total', 3],
        ['return_documents', 'total', 3],
      ] as const) {
        const { rows } = await db.query<{ numeric_scale: number }>(
          'SELECT numeric_scale FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND column_name=$2',
          [table, column],
        );
        assert.equal(rows.length, 1, 'Missing currency evidence column: ' + table + '.' + column);
        assert.ok(
          Number(rows[0].numeric_scale) >= minScale,
          'Precision migration was recorded without widening ' + table + '.' + column,
        );
      }
    }
    if (mode !== 'branch-only') {
      const plans = await db.query<{ code: string; max_users: number | null }>(
        "SELECT code, max_users FROM saas_plans WHERE code IN ('PRO','ULTIMATE')",
      );
      for (const p of plans.rows) {
        if (p.code === 'PRO') assert.equal(Number(p.max_users), 10);
        if (p.code === 'ULTIMATE') assert.equal(p.max_users, null);
      }
    }
    console.log('PASS P0-C 256 history / schema: ' + mode);
  } finally {
    await db.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
