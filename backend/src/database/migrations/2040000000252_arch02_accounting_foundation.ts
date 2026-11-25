import { Kysely, sql } from 'kysely';

/** Additive metadata and widened unit costs; historical financial values are preserved. */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE accounting_cheques
      ADD COLUMN IF NOT EXISTS base_amount NUMERIC(18,2),
      ADD COLUMN IF NOT EXISTS base_currency TEXT,
      ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,8),
      ADD COLUMN IF NOT EXISTS settlement_base_amount NUMERIC(18,2),
      ADD COLUMN IF NOT EXISTS last_action_date DATE,
      ADD COLUMN IF NOT EXISTS posting_sequence BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE contracting_subcontractor_payments ADD COLUMN IF NOT EXISTS request_key TEXT, ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;
    ALTER TABLE manufacturing_work_orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
    ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS dedup_key TEXT, ADD COLUMN IF NOT EXISTS cash_flow_category TEXT;
    ALTER TABLE withholding_tax_transactions ADD COLUMN IF NOT EXISTS extraction_key TEXT;
  `.execute(db);
  // Unit values require more precision than document money. Widen integer
  // capacity as well: no existing unit cost is rounded or reinterpreted.
  await sql`
    ALTER TABLE products ALTER COLUMN cost_price TYPE NUMERIC(20,6);
    ALTER TABLE sale_items ALTER COLUMN cost_price TYPE NUMERIC(20,6);
    ALTER TABLE return_items ALTER COLUMN cost_price TYPE NUMERIC(20,6);
    ALTER TABLE manufacturing_wo_consumptions ALTER COLUMN unit_cost TYPE NUMERIC(20,6);
    ALTER TABLE stock_movements ALTER COLUMN unit_cost TYPE NUMERIC(20,6);
  `.execute(db);
  // New stable event identities are nullable on legacy rows: reconciliation must not
  // pick a winner among historical duplicate financial documents automatically.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_arch02_journal_event ON journal_entries (tenant_id, dedup_key) WHERE dedup_key IS NOT NULL`.execute(
    db,
  );
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_arch02_wht_extraction ON withholding_tax_transactions (tenant_id, extraction_key) WHERE extraction_key IS NOT NULL`.execute(
    db,
  );
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_arch02_subcontractor_payment_request ON contracting_subcontractor_payments (tenant_id, request_key) WHERE request_key IS NOT NULL`.execute(
    db,
  );
  // Repeatable cheque events use (cheque, sequence, event) in dedup_key. A bounce
  // with bank fees is not an exact reversal of a deposit; do not falsify reversal
  // links merely to free the old source-level unique key.
  await sql`DROP INDEX IF EXISTS idx_journal_entries_pdc_and_wht_uniq`.execute(db);
  await sql`CREATE UNIQUE INDEX idx_journal_entries_pdc_and_wht_uniq
    ON journal_entries (tenant_id, source_type, source_id)
    WHERE source_type IN ('pdc_cheque_receive', 'pdc_cheque_collect', 'pdc_cheque_endorse',
      'pdc_cheque_issue', 'pdc_cheque_clear', 'withholding_tax_remittance')
      AND reversed_by_entry_id IS NULL`.execute(db);
  // A duplicate legacy base requires reviewed configuration repair; never pick a
  // currency arbitrarily or reinterpret existing books during migration.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_arch02_currency_base ON currency_exchange_rates (tenant_id) WHERE is_base`.execute(
    db,
  );
  // Composite keys support tenant-owned references on new domain documents.
  for (const table of [
    'suppliers',
    'journal_entries',
    'customer_installment_plans',
    'customer_installments',
    'cost_centers',
    'accounting_accounts',
  ]) {
    await sql
      .raw(`CREATE UNIQUE INDEX IF NOT EXISTS uq_arch02_${table}_tenant_id ON ${table} (tenant_id, id)`)
      .execute(db);
  }
  await sql`
    CREATE TABLE IF NOT EXISTS accounting_supplier_links (
      tenant_id TEXT NOT NULL,
      domain TEXT NOT NULL CHECK (domain IN ('shipping_line', 'subcontractor')),
      domain_id TEXT NOT NULL,
      supplier_id BIGINT NOT NULL,
      PRIMARY KEY (tenant_id, domain, domain_id)
    );
    CREATE TABLE IF NOT EXISTS accounting_marketplace_settlements (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      marketplace TEXT NOT NULL,
      settlement_key TEXT NOT NULL,
      payload JSONB NOT NULL,
      journal_entry_id BIGINT,
      UNIQUE (tenant_id, marketplace, settlement_key)
    );
    CREATE TABLE IF NOT EXISTS accounting_installment_interest (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      plan_id BIGINT NOT NULL,
      installment_id BIGINT NOT NULL,
      recognition_date DATE NOT NULL,
      amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
      journal_entry_id BIGINT,
      UNIQUE (tenant_id, installment_id)
    );
  `.execute(db);
  // New accrual worker scans due, unposted rows, not entire tenant installment tables.
  await sql`CREATE INDEX IF NOT EXISTS idx_arch02_interest_due ON accounting_installment_interest (recognition_date, tenant_id) WHERE journal_entry_id IS NULL`.execute(
    db,
  );
  const constraints = [
    [
      'journal_entries',
      'ck_arch02_cash_flow_category',
      "CHECK (cash_flow_category IS NULL OR cash_flow_category IN ('operating', 'investing', 'financing'))",
    ],
    [
      'accounting_supplier_links',
      'fk_arch02_supplier_link',
      'FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers (tenant_id, id)',
    ],
    [
      'accounting_marketplace_settlements',
      'fk_arch02_marketplace_journal',
      'FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES journal_entries (tenant_id, id)',
    ],
    [
      'accounting_installment_interest',
      'fk_arch02_interest_plan',
      'FOREIGN KEY (tenant_id, plan_id) REFERENCES customer_installment_plans (tenant_id, id)',
    ],
    [
      'accounting_installment_interest',
      'fk_arch02_interest_installment',
      'FOREIGN KEY (tenant_id, installment_id) REFERENCES customer_installments (tenant_id, id)',
    ],
    [
      'accounting_installment_interest',
      'fk_arch02_interest_journal',
      'FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES journal_entries (tenant_id, id)',
    ],
    [
      'cost_centers',
      'fk_arch02_center_parent',
      'FOREIGN KEY (tenant_id, parent_id) REFERENCES cost_centers (tenant_id, id)',
    ],
    [
      'accounting_accounts',
      'fk_arch02_account_parent',
      'FOREIGN KEY (tenant_id, parent_id) REFERENCES accounting_accounts (tenant_id, id)',
    ],
    [
      'currency_exchange_rates',
      'ck_arch02_positive_exchange_rate',
      "CHECK (exchange_rate > 0 AND exchange_rate <> 'NaN'::numeric AND (NOT is_base OR exchange_rate = 1))",
    ],
    [
      'accounting_cheques',
      'ck_arch02_cheque_base',
      "CHECK (base_amount IS NULL OR (base_amount > 0 AND base_amount <> 'NaN'::numeric AND exchange_rate IS NOT NULL AND exchange_rate > 0 AND exchange_rate <> 'NaN'::numeric AND base_currency IS NOT NULL))",
    ],
  ];
  for (const [table, name, definition] of constraints) {
    // NOT VALID enforces all new writes while preserving legacy rows for a reviewed
    // reconciliation. Validation belongs to the subsequent, authorized data repair.
    await sql
      .raw(
        `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}' AND conrelid = '${table}'::regclass) THEN
        ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition} NOT VALID;
      END IF;
    END $$`,
      )
      .execute(db);
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  // Never drop event/interest evidence after the feature has posted money.
  const used = await sql<{ count: number }>`SELECT (
    (SELECT count(*) FROM accounting_installment_interest) +
    (SELECT count(*) FROM accounting_marketplace_settlements) +
    (SELECT count(*) FROM accounting_supplier_links) +
    (SELECT count(*) FROM journal_entries WHERE dedup_key IS NOT NULL) +
    (SELECT count(*) FROM contracting_subcontractor_payments WHERE request_key IS NOT NULL)
  )::int AS count`.execute(db);
  if (Number(used.rows[0]?.count))
    throw new Error('ARCH02 rollback requires reviewed financial reconciliation; new evidence cannot be discarded');
  await sql`DROP TABLE accounting_installment_interest; DROP TABLE accounting_marketplace_settlements; DROP TABLE accounting_supplier_links`.execute(
    db,
  );
  for (const [table, name] of [
    ['cost_centers', 'fk_arch02_center_parent'],
    ['accounting_accounts', 'fk_arch02_account_parent'],
    ['journal_entries', 'ck_arch02_cash_flow_category'],
    ['currency_exchange_rates', 'ck_arch02_positive_exchange_rate'],
    ['accounting_cheques', 'ck_arch02_cheque_base'],
  ])
    await sql.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`).execute(db);
  // Additive metadata and supporting unique keys may safely remain on a code rollback.
}
