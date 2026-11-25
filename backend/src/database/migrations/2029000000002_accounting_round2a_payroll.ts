import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .alterTable('hr_payroll_runs')
      .addColumn('paid_by', 'bigint', (col) => col.references('users.id').onDelete('set null'))
      .addColumn('paid_at', 'timestamptz')
      .addColumn('payment_channel', 'text')
      .addColumn('payment_reference', 'text')
      .addColumn('payment_notes', 'text', (col) => col.notNull().defaultTo(''))
      .execute();

    await db.schema.alterTable('hr_payroll_runs').dropConstraint('hr_payroll_runs_status_check').ifExists().execute();

    await db.schema.alterTable('hr_payroll_runs').dropConstraint('hr_payroll_runs_status_valid').ifExists().execute();

    await db.schema
      .alterTable('hr_payroll_runs')
      .addCheckConstraint(
        'hr_payroll_runs_status_check',
        sql`status IN ('draft', 'reviewed', 'approved', 'paid', 'cancelled')`,
      )
      .execute();

    await db.schema
      .alterTable('hr_payroll_runs')
      .addCheckConstraint(
        'hr_payroll_runs_payment_channel_check',
        sql`payment_channel IS NULL OR payment_channel IN ('cash', 'bank')`,
      )
      .execute();

    // Idempotency constraints
    await sql`
      CREATE UNIQUE INDEX idx_journal_entries_payroll_round2a_uniq
      ON journal_entries (tenant_id, source_type, source_id)
      WHERE source_type IN ('hr_payroll_accrual', 'hr_payroll_payment');
    `.execute(db);

    await sql`
      CREATE UNIQUE INDEX idx_treasury_transactions_payroll_payment_uniq
      ON treasury_transactions (tenant_id, reference_type, reference_id)
      WHERE reference_type = 'hr_payroll_payment';
    `.execute(db);
  },

  async down(db: Kysely<any>): Promise<void> {
    await sql`DROP INDEX IF EXISTS idx_treasury_transactions_payroll_payment_uniq;`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_journal_entries_payroll_round2a_uniq;`.execute(db);

    await db.schema
      .alterTable('hr_payroll_runs')
      .dropConstraint('hr_payroll_runs_payment_channel_check')
      .ifExists()
      .execute();

    await db.schema.alterTable('hr_payroll_runs').dropConstraint('hr_payroll_runs_status_check').ifExists().execute();

    await db.schema.alterTable('hr_payroll_runs').dropConstraint('hr_payroll_runs_status_valid').ifExists().execute();

    // Restore previous check
    await db.schema
      .alterTable('hr_payroll_runs')
      .addCheckConstraint('hr_payroll_runs_status_valid', sql`status IN ('draft', 'reviewed', 'approved', 'cancelled')`)
      .execute();

    await db.schema
      .alterTable('hr_payroll_runs')
      .dropColumn('payment_notes')
      .dropColumn('payment_reference')
      .dropColumn('payment_channel')
      .dropColumn('paid_at')
      .dropColumn('paid_by')
      .execute();
  },
};
