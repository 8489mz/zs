import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    // Journal entries unique partial indexes
    await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_employee_loan_disb_uniq
    ON journal_entries(tenant_id, source_type, source_id)
    WHERE source_type = 'hr_employee_loan_disbursement'
  `.execute(db);

    await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_employee_loan_repay_uniq
    ON journal_entries(tenant_id, source_type, source_id)
    WHERE source_type = 'hr_employee_loan_repayment'
  `.execute(db);

    // Treasury transactions unique partial indexes
    await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_treasury_transactions_employee_loan_disb_uniq
    ON treasury_transactions(tenant_id, reference_type, reference_id)
    WHERE reference_type = 'hr_employee_loan'
  `.execute(db);

    await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_treasury_transactions_employee_loan_repay_uniq
    ON treasury_transactions(tenant_id, reference_type, reference_id)
    WHERE reference_type = 'hr_employee_loan_repayment'
  `.execute(db);
  },
  async down(db: Kysely<any>): Promise<void> {
    await sql`DROP INDEX IF EXISTS idx_journal_entries_employee_loan_disb_uniq`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_journal_entries_employee_loan_repay_uniq`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_treasury_transactions_employee_loan_disb_uniq`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_treasury_transactions_employee_loan_repay_uniq`.execute(db);
  },
};
