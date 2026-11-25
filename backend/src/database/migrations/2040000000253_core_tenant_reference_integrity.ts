import { Kysely, sql } from 'kysely';
import { Database } from '../database.types';

// The repository has mixed-width legacy prefixes; 253 follows the actual
// lexically ordered 252 head. No existing migration name or financial row moves.
const references = [
  ['users', 'default_branch_id', 'branches'],
  ['user_branches', 'user_id', 'users'],
  ['user_branches', 'branch_id', 'branches'],
  ['branches', 'default_stock_location_id', 'stock_locations'],
  ['stock_locations', 'branch_id', 'branches'],
  ['journal_entries', 'branch_id', 'branches'],
  ['journal_entries', 'location_id', 'stock_locations'],
  ['journal_entries', 'reversal_of_entry_id', 'journal_entries'],
  ['journal_entries', 'reversed_by_entry_id', 'journal_entries'],
  ['journal_entry_lines', 'journal_entry_id', 'journal_entries'],
  ['journal_entry_lines', 'account_id', 'accounting_accounts'],
  ['journal_entry_lines', 'cost_center_id', 'cost_centers'],
  ['journal_entry_lines', 'branch_id', 'branches'],
  ['journal_entry_lines', 'location_id', 'stock_locations'],
  ...[
    'cash_account_id',
    'bank_account_id',
    'customer_receivable_account_id',
    'supplier_payable_account_id',
    'inventory_account_id',
    'sales_revenue_account_id',
    'sales_discount_account_id',
    'cogs_account_id',
    'purchase_account_id',
    'expenses_account_id',
    'sales_tax_account_id',
    'purchase_tax_account_id',
    'manufacturing_overhead_account_id',
  ].map((column) => ['accounting_settings', column, 'accounting_accounts']),
];

const referenceName = (table: string, column: string) => `fk_core253_${table}_${column}`.slice(0, 63);

export async function up(db: Kysely<Database>): Promise<void> {
  // These keys support existing tenant-scoped branch/location/user references.
  for (const table of ['branches', 'stock_locations', 'users']) {
    await sql
      .raw(`CREATE UNIQUE INDEX IF NOT EXISTS uq_core253_${table}_tenant_id ON ${table} (tenant_id, id)`)
      .execute(db);
  }
  for (const [table, column, target] of references) {
    const name = referenceName(table, column);
    // Enforce new writes now; preserve legacy violations for explicit review.
    await sql
      .raw(
        `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}' AND conrelid = '${table}'::regclass) THEN
        ALTER TABLE ${table} ADD CONSTRAINT ${name}
          FOREIGN KEY (tenant_id, ${column}) REFERENCES ${target} (tenant_id, id) NOT VALID;
      END IF;
    END $$`,
      )
      .execute(db);
  }
  await sql`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_core253_journal_finite' AND conrelid = 'journal_entry_lines'::regclass) THEN
      ALTER TABLE journal_entry_lines ADD CONSTRAINT ck_core253_journal_finite CHECK (
        debit NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) AND
        credit NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
      ) NOT VALID;
    END IF;
  END $$`.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`ALTER TABLE journal_entry_lines DROP CONSTRAINT IF EXISTS ck_core253_journal_finite`.execute(db);
  for (const [table, column] of [...references].reverse()) {
    await sql.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${referenceName(table, column)}`).execute(db);
  }
  for (const table of ['branches', 'stock_locations', 'users']) {
    await sql.raw(`DROP INDEX IF EXISTS uq_core253_${table}_tenant_id`).execute(db);
  }
}
