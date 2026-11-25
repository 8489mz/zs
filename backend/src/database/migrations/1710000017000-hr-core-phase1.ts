import { Kysely, sql } from 'kysely';
import { Database } from '../database.types';

export const migration = {
  up: async (db: Kysely<Database>): Promise<void> => {
    await sql`
      CREATE TABLE IF NOT EXISTS hr_departments (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        updated_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS hr_job_titles (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        updated_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS hr_positions (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        department_id BIGINT NULL REFERENCES hr_departments(id) ON DELETE SET NULL,
        job_title_id BIGINT NULL REFERENCES hr_job_titles(id) ON DELETE SET NULL,
        branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
        location_id BIGINT NULL REFERENCES stock_locations(id) ON DELETE SET NULL,
        description TEXT NOT NULL DEFAULT '',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        updated_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS hr_employees (
        id BIGSERIAL PRIMARY KEY,
        employee_no TEXT NOT NULL DEFAULT '',
        user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        department_id BIGINT NULL REFERENCES hr_departments(id) ON DELETE SET NULL,
        job_title_id BIGINT NULL REFERENCES hr_job_titles(id) ON DELETE SET NULL,
        position_id BIGINT NULL REFERENCES hr_positions(id) ON DELETE SET NULL,
        branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
        location_id BIGINT NULL REFERENCES stock_locations(id) ON DELETE SET NULL,
        hire_date DATE NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        updated_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT hr_employees_status_valid CHECK (status IN ('active','inactive','deactivated','terminated'))
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS hr_employee_contacts (
        id BIGSERIAL PRIMARY KEY,
        employee_id BIGINT NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
        contact_type TEXT NOT NULL DEFAULT 'phone',
        value TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT NOT NULL DEFAULT '',
        created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        updated_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS hr_employee_documents (
        id BIGSERIAL PRIMARY KEY,
        employee_id BIGINT NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        document_type TEXT NOT NULL DEFAULT '',
        file_url TEXT NOT NULL DEFAULT '',
        expiry_date DATE NULL,
        notes TEXT NOT NULL DEFAULT '',
        uploaded_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS hr_employment_contracts (
        id BIGSERIAL PRIMARY KEY,
        employee_id BIGINT NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
        contract_no TEXT NOT NULL DEFAULT '',
        contract_type TEXT NOT NULL DEFAULT 'standard',
        status TEXT NOT NULL DEFAULT 'draft',
        start_date DATE NOT NULL,
        end_date DATE NULL,
        base_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'EGP',
        notes TEXT NOT NULL DEFAULT '',
        created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        updated_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT hr_contracts_status_valid CHECK (status IN ('draft','active','ended','cancelled'))
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS hr_compensation_packages (
        id BIGSERIAL PRIMARY KEY,
        employee_id BIGINT NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
        contract_id BIGINT NULL REFERENCES hr_employment_contracts(id) ON DELETE SET NULL,
        package_name TEXT NOT NULL DEFAULT '',
        allowance_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        deduction_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        effective_from DATE NULL,
        effective_to DATE NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        updated_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS hr_employee_loans (
        id BIGSERIAL PRIMARY KEY,
        employee_id BIGINT NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
        loan_no TEXT NOT NULL DEFAULT '',
        loan_type TEXT NOT NULL DEFAULT 'advance',
        principal_amount NUMERIC(12,2) NOT NULL,
        paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        remaining_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        installment_count INTEGER NOT NULL DEFAULT 1,
        installment_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft',
        issue_date DATE NOT NULL,
        first_due_date DATE NULL,
        branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
        location_id BIGINT NULL REFERENCES stock_locations(id) ON DELETE SET NULL,
        notes TEXT NOT NULL DEFAULT '',
        approved_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        approved_at TIMESTAMP NULL,
        disbursed_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        disbursed_at TIMESTAMP NULL,
        created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        updated_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT hr_loans_status_valid CHECK (status IN ('draft','approved','paid','partially_repaid','repaid','cancelled'))
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS hr_employee_loan_installments (
        id BIGSERIAL PRIMARY KEY,
        loan_id BIGINT NOT NULL REFERENCES hr_employee_loans(id) ON DELETE CASCADE,
        installment_no INTEGER NOT NULL,
        due_date DATE NULL,
        amount NUMERIC(12,2) NOT NULL,
        paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        paid_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT hr_loan_installments_status_valid CHECK (status IN ('pending','partial','paid','cancelled'))
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS hr_employee_ledger (
        id BIGSERIAL PRIMARY KEY,
        employee_id BIGINT NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
        entry_type TEXT NOT NULL,
        amount NUMERIC(12,2) NOT NULL,
        balance_after NUMERIC(12,2) NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        reference_type TEXT NULL,
        reference_id BIGINT NULL,
        branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
        location_id BIGINT NULL REFERENCES stock_locations(id) ON DELETE SET NULL,
        created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS hr_hr_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        updated_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `.execute(db);

    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_departments_code_unique ON hr_departments(code) WHERE code <> ''`.execute(
      db,
    );
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_job_titles_code_unique ON hr_job_titles(code) WHERE code <> ''`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_hr_positions_department ON hr_positions(department_id)`.execute(db);
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_employees_employee_no_unique ON hr_employees(employee_no) WHERE employee_no <> ''`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_hr_employees_user_id ON hr_employees(user_id)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_hr_contacts_employee ON hr_employee_contacts(employee_id)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_hr_documents_employee ON hr_employee_documents(employee_id)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_hr_contracts_employee ON hr_employment_contracts(employee_id)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_hr_compensation_employee_contract ON hr_compensation_packages(employee_id, contract_id)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_hr_loans_employee_status ON hr_employee_loans(employee_id, status)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_hr_loan_installments_loan ON hr_employee_loan_installments(loan_id)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_hr_ledger_employee ON hr_employee_ledger(employee_id, created_at DESC)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_treasury_hr_reference ON treasury_transactions(reference_type, reference_id)`.execute(
      db,
    );
  },
  down: async (db: Kysely<Database>): Promise<void> => {
    await sql`DROP INDEX IF EXISTS idx_treasury_hr_reference`.execute(db);
    await sql`DROP TABLE IF EXISTS hr_hr_settings`.execute(db);
    await sql`DROP TABLE IF EXISTS hr_employee_ledger`.execute(db);
    await sql`DROP TABLE IF EXISTS hr_employee_loan_installments`.execute(db);
    await sql`DROP TABLE IF EXISTS hr_employee_loans`.execute(db);
    await sql`DROP TABLE IF EXISTS hr_compensation_packages`.execute(db);
    await sql`DROP TABLE IF EXISTS hr_employment_contracts`.execute(db);
    await sql`DROP TABLE IF EXISTS hr_employee_documents`.execute(db);
    await sql`DROP TABLE IF EXISTS hr_employee_contacts`.execute(db);
    await sql`DROP TABLE IF EXISTS hr_employees`.execute(db);
    await sql`DROP TABLE IF EXISTS hr_positions`.execute(db);
    await sql`DROP TABLE IF EXISTS hr_job_titles`.execute(db);
    await sql`DROP TABLE IF EXISTS hr_departments`.execute(db);
  },
};
