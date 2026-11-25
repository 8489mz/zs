import { sql, type Kysely } from 'kysely';

type SeedAccount = {
  code: string;
  nameAr: string;
  nameEn: string;
  accountType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'contra_asset' | 'contra_revenue';
  normalBalance: 'debit' | 'credit';
  sortOrder: number;
  parentCode: string | null;
};

const SEED_ACCOUNTS: SeedAccount[] = [
  {
    code: '1000',
    nameAr: 'الأصول',
    nameEn: 'Assets',
    accountType: 'asset',
    normalBalance: 'debit',
    sortOrder: 1000,
    parentCode: null,
  },
  {
    code: '1100',
    nameAr: 'الخزينة',
    nameEn: 'Cash',
    accountType: 'asset',
    normalBalance: 'debit',
    sortOrder: 1100,
    parentCode: '1000',
  },
  {
    code: '1200',
    nameAr: 'البنك',
    nameEn: 'Bank',
    accountType: 'asset',
    normalBalance: 'debit',
    sortOrder: 1200,
    parentCode: '1000',
  },
  {
    code: '1300',
    nameAr: 'العملاء',
    nameEn: 'Accounts Receivable',
    accountType: 'asset',
    normalBalance: 'debit',
    sortOrder: 1300,
    parentCode: '1000',
  },
  {
    code: '1400',
    nameAr: 'المخزون',
    nameEn: 'Inventory',
    accountType: 'asset',
    normalBalance: 'debit',
    sortOrder: 1400,
    parentCode: '1000',
  },
  {
    code: '2000',
    nameAr: 'الخصوم',
    nameEn: 'Liabilities',
    accountType: 'liability',
    normalBalance: 'credit',
    sortOrder: 2000,
    parentCode: null,
  },
  {
    code: '2100',
    nameAr: 'الموردون',
    nameEn: 'Accounts Payable',
    accountType: 'liability',
    normalBalance: 'credit',
    sortOrder: 2100,
    parentCode: '2000',
  },
  {
    code: '2200',
    nameAr: 'ضريبة مبيعات مستحقة',
    nameEn: 'Sales Tax Payable',
    accountType: 'liability',
    normalBalance: 'credit',
    sortOrder: 2200,
    parentCode: '2000',
  },
  {
    code: '3000',
    nameAr: 'حقوق الملكية',
    nameEn: 'Equity',
    accountType: 'equity',
    normalBalance: 'credit',
    sortOrder: 3000,
    parentCode: null,
  },
  {
    code: '3100',
    nameAr: 'رأس المال',
    nameEn: 'Capital',
    accountType: 'equity',
    normalBalance: 'credit',
    sortOrder: 3100,
    parentCode: '3000',
  },
  {
    code: '4000',
    nameAr: 'الإيرادات',
    nameEn: 'Revenue',
    accountType: 'revenue',
    normalBalance: 'credit',
    sortOrder: 4000,
    parentCode: null,
  },
  {
    code: '4100',
    nameAr: 'المبيعات',
    nameEn: 'Sales Revenue',
    accountType: 'revenue',
    normalBalance: 'credit',
    sortOrder: 4100,
    parentCode: '4000',
  },
  {
    code: '4200',
    nameAr: 'خصومات المبيعات',
    nameEn: 'Sales Discounts',
    accountType: 'contra_revenue',
    normalBalance: 'debit',
    sortOrder: 4200,
    parentCode: '4000',
  },
  {
    code: '5000',
    nameAr: 'تكلفة ومصروفات',
    nameEn: 'Costs and Expenses',
    accountType: 'expense',
    normalBalance: 'debit',
    sortOrder: 5000,
    parentCode: null,
  },
  {
    code: '5100',
    nameAr: 'تكلفة البضاعة المباعة',
    nameEn: 'Cost of Goods Sold',
    accountType: 'expense',
    normalBalance: 'debit',
    sortOrder: 5100,
    parentCode: '5000',
  },
  {
    code: '5200',
    nameAr: 'المشتريات',
    nameEn: 'Purchases',
    accountType: 'expense',
    normalBalance: 'debit',
    sortOrder: 5200,
    parentCode: '5000',
  },
  {
    code: '5300',
    nameAr: 'المصروفات العامة',
    nameEn: 'General Expenses',
    accountType: 'expense',
    normalBalance: 'debit',
    sortOrder: 5300,
    parentCode: '5000',
  },
  {
    code: '5400',
    nameAr: 'ضريبة مشتريات',
    nameEn: 'Purchase Tax',
    accountType: 'asset',
    normalBalance: 'debit',
    sortOrder: 5400,
    parentCode: '5000',
  },
];

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      CREATE TABLE IF NOT EXISTS accounting_accounts (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name_ar TEXT NOT NULL,
        name_en TEXT NOT NULL DEFAULT '',
        account_type TEXT NOT NULL,
        parent_id BIGINT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
        normal_balance TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT accounting_accounts_account_type_chk CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense', 'contra_asset', 'contra_revenue')),
        CONSTRAINT accounting_accounts_normal_balance_chk CHECK (normal_balance IN ('debit', 'credit'))
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS journal_entries (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        entry_no TEXT NOT NULL UNIQUE,
        entry_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        description TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL DEFAULT 'manual',
        source_id BIGINT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
        location_id BIGINT NULL REFERENCES stock_locations(id) ON DELETE SET NULL,
        created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        posted_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        posted_at TIMESTAMPTZ NULL,
        cancelled_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        cancelled_at TIMESTAMPTZ NULL,
        cancel_reason TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT journal_entries_status_chk CHECK (status IN ('draft', 'posted', 'cancelled'))
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS journal_entry_lines (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        journal_entry_id BIGINT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
        account_id BIGINT NOT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
        description TEXT NOT NULL DEFAULT '',
        debit NUMERIC(14,2) NOT NULL DEFAULT 0,
        credit NUMERIC(14,2) NOT NULL DEFAULT 0,
        partner_type TEXT NOT NULL DEFAULT 'none',
        partner_id BIGINT NULL,
        branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
        location_id BIGINT NULL REFERENCES stock_locations(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT journal_entry_lines_debit_non_negative_chk CHECK (debit >= 0),
        CONSTRAINT journal_entry_lines_credit_non_negative_chk CHECK (credit >= 0),
        CONSTRAINT journal_entry_lines_partner_type_chk CHECK (partner_type IN ('none', 'customer', 'supplier')),
        CONSTRAINT journal_entry_lines_debit_credit_mutual_exclusive_chk CHECK (NOT (debit > 0 AND credit > 0)),
        CONSTRAINT journal_entry_lines_debit_or_credit_required_chk CHECK ((debit > 0) OR (credit > 0))
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS accounting_settings (
        id SMALLINT PRIMARY KEY,
        cash_account_id BIGINT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
        bank_account_id BIGINT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
        customer_receivable_account_id BIGINT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
        supplier_payable_account_id BIGINT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
        inventory_account_id BIGINT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
        sales_revenue_account_id BIGINT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
        sales_discount_account_id BIGINT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
        cogs_account_id BIGINT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
        purchase_account_id BIGINT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
        expenses_account_id BIGINT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
        sales_tax_account_id BIGINT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
        purchase_tax_account_id BIGINT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT accounting_settings_singleton_chk CHECK (id = 1)
      )
    `.execute(db);

    await sql`CREATE INDEX IF NOT EXISTS idx_accounting_accounts_code ON accounting_accounts(code)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_accounting_accounts_parent_id ON accounting_accounts(parent_id)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_journal_entries_entry_date ON journal_entries(entry_date)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_journal_entries_status ON journal_entries(status)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_journal_entries_source ON journal_entries(source_type, source_id)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_journal_entry_id ON journal_entry_lines(journal_entry_id)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account_id ON journal_entry_lines(account_id)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_partner ON journal_entry_lines(partner_type, partner_id)`.execute(
      db,
    );

    for (const account of SEED_ACCOUNTS) {
      await sql`
        INSERT INTO accounting_accounts (
          code, name_ar, name_en, account_type, normal_balance, is_active, is_system, sort_order
        )
        VALUES (
          ${account.code}, ${account.nameAr}, ${account.nameEn}, ${account.accountType}, ${account.normalBalance}, TRUE, TRUE, ${account.sortOrder}
        )
        ON CONFLICT (code) DO UPDATE SET
          name_ar = EXCLUDED.name_ar,
          name_en = EXCLUDED.name_en,
          account_type = EXCLUDED.account_type,
          normal_balance = EXCLUDED.normal_balance,
          is_system = TRUE,
          sort_order = EXCLUDED.sort_order,
          updated_at = NOW()
      `.execute(db);
    }

    for (const account of SEED_ACCOUNTS.filter((entry) => entry.parentCode)) {
      await sql`
        UPDATE accounting_accounts child
        SET parent_id = parent.id, updated_at = NOW()
        FROM accounting_accounts parent
        WHERE child.code = ${account.code}
          AND parent.code = ${account.parentCode}
          AND (child.parent_id IS DISTINCT FROM parent.id)
      `.execute(db);
    }

    await sql`
      INSERT INTO accounting_settings (
        id,
        cash_account_id,
        bank_account_id,
        customer_receivable_account_id,
        supplier_payable_account_id,
        inventory_account_id,
        sales_revenue_account_id,
        sales_discount_account_id,
        cogs_account_id,
        purchase_account_id,
        expenses_account_id,
        sales_tax_account_id,
        purchase_tax_account_id,
        updated_at
      )
      VALUES (
        1,
        (SELECT id FROM accounting_accounts WHERE code = '1100'),
        (SELECT id FROM accounting_accounts WHERE code = '1200'),
        (SELECT id FROM accounting_accounts WHERE code = '1300'),
        (SELECT id FROM accounting_accounts WHERE code = '2100'),
        (SELECT id FROM accounting_accounts WHERE code = '1400'),
        (SELECT id FROM accounting_accounts WHERE code = '4100'),
        (SELECT id FROM accounting_accounts WHERE code = '4200'),
        (SELECT id FROM accounting_accounts WHERE code = '5100'),
        (SELECT id FROM accounting_accounts WHERE code = '5200'),
        (SELECT id FROM accounting_accounts WHERE code = '5300'),
        (SELECT id FROM accounting_accounts WHERE code = '2200'),
        (SELECT id FROM accounting_accounts WHERE code = '5400'),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        cash_account_id = EXCLUDED.cash_account_id,
        bank_account_id = EXCLUDED.bank_account_id,
        customer_receivable_account_id = EXCLUDED.customer_receivable_account_id,
        supplier_payable_account_id = EXCLUDED.supplier_payable_account_id,
        inventory_account_id = EXCLUDED.inventory_account_id,
        sales_revenue_account_id = EXCLUDED.sales_revenue_account_id,
        sales_discount_account_id = EXCLUDED.sales_discount_account_id,
        cogs_account_id = EXCLUDED.cogs_account_id,
        purchase_account_id = EXCLUDED.purchase_account_id,
        expenses_account_id = EXCLUDED.expenses_account_id,
        sales_tax_account_id = EXCLUDED.sales_tax_account_id,
        purchase_tax_account_id = EXCLUDED.purchase_tax_account_id,
        updated_at = NOW()
    `.execute(db);
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS accounting_settings`.execute(db);
    await sql`DROP TABLE IF EXISTS journal_entry_lines`.execute(db);
    await sql`DROP TABLE IF EXISTS journal_entries`.execute(db);
    await sql`DROP TABLE IF EXISTS accounting_accounts`.execute(db);
  },
};
