import { strict as assert } from 'node:assert';
import { Pool } from 'pg';
import { tenantScopedReferences } from '../../src/database/migrations/2040000000255_platform_tenant_fk_hardening';

async function run(): Promise<void> {
  const host = process.env.DATABASE_HOST || '';
  const database = process.env.DATABASE_NAME || '';
  if (
    process.env.NODE_ENV !== 'test' ||
    !['localhost', '127.0.0.1', '::1'].includes(host) ||
    !['zs_core_audit_test', 'zs_p0a_isolated'].includes(database)
  ) {
    throw new Error('This integration test is restricted to the disposable local P0-A database');
  }
  const db = new Pool({
    host,
    database,
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
  });
  try {
    for (const ref of tenantScopedReferences) {
      const name = `fk_core255_${ref.child}_tenant_${ref.column}`;
      const constraints = await db.query<{
        conname: string;
        contype: string;
        convalidated: boolean;
        definition: string;
      }>(
        `select c.conname, c.contype, c.convalidated, pg_get_constraintdef(c.oid) as definition
         from pg_constraint c where c.conname = $1 and c.conrelid = to_regclass($2)`,
        [name, `public.${ref.child}`],
      );
      assert.equal(constraints.rowCount, 1, `Composite foreign key missing: ${name}`);
      const fk = constraints.rows[0];
      assert.equal(fk.contype, 'f', `${name} must be a foreign key`);
      assert.equal(fk.convalidated, false, `${name} must remain NOT VALID pending historical reconciliation`);
      const compact = fk.definition.replace(/\s+/g, ' ').toLowerCase();
      assert.ok(
        compact.includes(`foreign key (tenant_id, ${ref.column})`),
        `${name} is missing tenant-scoped child key`,
      );
      assert.ok(
        compact.includes(`references ${ref.parent}(tenant_id, id)`),
        `${name} is missing tenant-scoped parent key`,
      );
    }
    for (const parent of ['users', 'maritime_rfqs', 'maritime_jobs']) {
      const indexes = await db.query<{ indexdef: string }>(
        'select indexdef from pg_indexes where schemaname = $1 and indexname = $2',
        ['public', `uq_core255_${parent}_tenant_id`],
      );
      assert.equal(indexes.rowCount, 1, `Unique support index missing on ${parent}`);
      const compact = indexes.rows[0].indexdef.toLowerCase().replace(/\s+/g, ' ');
      assert.ok(
        compact.includes('unique index') && compact.includes('(tenant_id, id)'),
        `Unexpected composite index on ${parent}`,
      );
    }
    console.log('P0-A migration 255: 4 live tenant-composite NOT VALID foreign keys and 3 unique indexes verified');
  } finally {
    await db.end();
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
