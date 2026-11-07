/*
New file: backend/test/critical/accounting-digits-services.spec.ts
Pins D2 (unification batch U1): the five dependent accounting
services round through the canonical digits-aware engine
(money-minor-units roundMoney) at the tenant's book digits instead
of their private 2dp toMoney/money helpers.

WHAT THIS PINS (drives the real service methods over PGlite with a
KWD tenant, no copies of the rounding math):
- Every private rounder answers the canonical value at 3 digits
  (10.005 -> 10.005, 10.125 -> 10.125, 0.101 -> 0.101) while the
  2-digit path is unchanged (10.005 -> 10, 10.125 -> 10.13), and a
  non-finite display value still answers 0 instead of throwing.
- Cash flow: a posted 10.005 journal leg reports endingCash 10.005
  (old code: 10.00) with the reconciliation flag still true.
- PDC: a KWD cheque of 10.125 lists at 10.125 with a 0.101 bounce
  fee (old code: 10.13 / 0.10), portfolio stats total 15.187 at book
  digits, while a USD cheque in the same KWD tenant still lists at
  10.13 -- the face amount follows the CHEQUE's currency, never the
  tenant's. The bounce fee follows the BOOK digits (it is validated
  and posted as a book amount).
- AR collections: overview and case rows report 10.125 / 100.125 at
  book digits (old code: 10.13 / 100.13).
- Withholding tax: a stored 10.125 base / 0.101 tax Form 41 row
  reports exactly that, totals and breakdown included (old code:
  10.13 / 0.10).
- Aged debts: a 10.125 balance ages into the 91+ bucket at 10.125
  (old code: SQL round(,2) truncated it to 10.13 first), and a real
  0.005 KWD balance is aged instead of dropped by the old > 0.01
  dust filter (at 2dp the threshold is still exactly 0.01).

Deliberately NOT pinned here: cash-flow section totals
(netCashFlow), which the section classifier
(cash-flow-classification.engine.ts) still rounds to cents -- that
engine is out of this package's file list and keeps the 0.01
reconciliation tolerance honest until it is digits-aware; and
syncCollections' stored total_overdue past the dunning engine
(ar-dunning.engine.ts, D6c), whose own toFixed(2) balance handling
is a separate package.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { CashFlowService } from '../../src/modules/accounting/services/cash-flow.service';
import { PdcChequesService } from '../../src/modules/accounting/services/pdc-cheques.service';
import { ArCollectionsService } from '../../src/modules/accounting/services/ar-collections.service';
import { WithholdingTaxService } from '../../src/modules/accounting/services/withholding-tax.service';
import { AgedDebtsService } from '../../src/modules/accounting/services/aged-debts.service';

const AUTH = {
  tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin',
  permissions: ['accounting'],
} as unknown as AuthContext;

async function seedCurrency(pg: PGlite) {
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
    INSERT INTO settings VALUES ('t1', 'currency', 'KWD');
    INSERT INTO currency_exchange_rates VALUES ('t1', 'KWD', true, 1);
  `);
}

function makeDb(pg: PGlite) {
  return new Kysely<Database>({ dialect: new PGliteDialect(pg) });
}

async function main() {
  // Phase 1: the private rounders themselves, all five services.
  // On the base code each takes one argument and ignores the digits,
  // so every 3-digit assertion below fails there.
  {
    const pg = new PGlite();
    const db = makeDb(pg);
    const postingStub = {} as never;
    const cashFlow = new CashFlowService(db);
    const pdc = new PdcChequesService(db, postingStub);
    const ar = new ArCollectionsService(db);
    const wht = new WithholdingTaxService(db, postingStub);
    const aged = new AgedDebtsService(db);
    try {
      assert.equal((cashFlow as any).toMoney(10.005, 3), 10.005);
      assert.equal((cashFlow as any).toMoney(1.005, 2), 1);
      assert.equal((cashFlow as any).toMoney(4.255, 2), 4.26);
      assert.equal((cashFlow as any).toMoney(100.125, 3), 100.125);
      assert.equal((cashFlow as any).toMoney(NaN, 3), 0);
      assert.equal((pdc as any).toMoney(10.125, 3), 10.125);
      assert.equal((pdc as any).toMoney(10.125, 2), 10.13);
      assert.equal((ar as any).toMoney(10.125, 3), 10.125);
      assert.equal((wht as any).toMoney(0.101, 3), 0.101);
      assert.equal((wht as any).toMoney(10.001, 3), 10.001);
      assert.equal((aged as any).money(10.125, 3), 10.125);
      assert.equal((aged as any).money(10.125, 2), 10.13);
      console.log('accounting-digits-services: phase 1 (private rounders) OK');
    } finally {
      await db.destroy();
    }
  }

  // Phase 2: cash-flow statement over posted 3dp journal legs.
  {
    const pg = new PGlite();
    const db = makeDb(pg);
    const service = new CashFlowService(db);
    try {
      await seedCurrency(pg);
      await pg.exec(`
        CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, is_cash_bank boolean, code text, account_type text, account_group text);
        CREATE TABLE journal_entries (id bigint PRIMARY KEY, tenant_id text, status text, entry_date timestamptz, cash_flow_category text);
        CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint, tenant_id text, account_id bigint, debit numeric, credit numeric, branch_id bigint);
        INSERT INTO accounting_accounts VALUES (1, 't1', true, '1120', 'asset', 'current_assets'), (2, 't1', false, '4110', 'revenue', null);
        INSERT INTO journal_entries VALUES (1, 't1', 'posted', '2026-06-15T12:00:00Z', null);
        INSERT INTO journal_entry_lines (journal_entry_id, tenant_id, account_id, debit, credit, branch_id)
          VALUES (1, 't1', 1, 10.005, 0, null), (1, 't1', 2, 0, 10.005, null);
      `);
      const report = await service.getCashFlowStatement(AUTH, { dateFrom: '2026-01-01', dateTo: '2026-12-31' });
      assert.equal(report.beginningCash, 0);
      assert.equal(report.endingCash, 10.005);
      assert.equal(report.reconciledCashActual, 10.005);
      assert.equal(report.isReconciled, true);
      console.log('accounting-digits-services: phase 2 (cash flow) OK');
    } finally {
      await db.destroy();
    }
  }

  // Phase 3: PDC list + stats. The KWD cheque and its fee are book
  // amounts; the USD cheque face follows the cheque's own currency.
  {
    const pg = new PGlite();
    const db = makeDb(pg);
    const service = new PdcChequesService(db, {} as never);
    try {
      await seedCurrency(pg);
      await pg.exec(`
        CREATE TABLE accounting_cheques (id bigserial PRIMARY KEY, tenant_id text, account_id bigint, type text, cheque_number text, bank_name text, branch_name text, drawer_name text, partner_type text, partner_id bigint, partner_name text, amount numeric, currency text, issue_date date, due_date date, status text, deposit_bank_id bigint, deposit_date date, cleared_date date, bounced_date date, bounced_reason text, bounced_fee numeric, flagged_rate_variance boolean, registered_exchange_rate numeric, endorsed_to_supplier_id bigint, endorsed_to_supplier_name text, journal_entry_id bigint, notes text, created_by bigint, created_at timestamptz, updated_at timestamptz, base_amount numeric, base_currency text, exchange_rate numeric, last_action_date date, settlement_base_amount numeric, posting_sequence int);
        INSERT INTO accounting_cheques (id, tenant_id, type, cheque_number, bank_name, partner_type, partner_name, amount, currency, issue_date, due_date, status, bounced_fee, base_amount, base_currency, exchange_rate, created_at, updated_at)
          VALUES (1, 't1', 'receivable', 'KWD-1', 'Bank', 'customer', 'Cust A', 10.125, 'KWD', '2026-06-01', '2026-06-20', 'in_safe', 0.101, 10.125, 'KWD', 1, now(), now()),
                 (2, 't1', 'receivable', 'USD-1', 'Bank', 'customer', 'Cust B', 10.125, 'USD', '2026-06-01', '2026-06-20', 'in_safe', 0, 5.062, 'KWD', 0.5, now(), now());
      `);
      const listed = await service.listCheques(AUTH, {});
      assert.equal(listed.total, 2);
      const byId = new Map(listed.data.map((r) => [r.id, r]));
      assert.equal(byId.get(1)?.amount, 10.125);
      assert.equal(byId.get(1)?.bounced_fee, 0.101);
      assert.equal(byId.get(2)?.amount, 10.13);
      const stats = await service.getStats(AUTH);
      assert.equal(stats.receivables.totalCount, 2);
      assert.equal(stats.receivables.totalAmount, 15.187);
      assert.equal(stats.receivables.inSafeAmount, 15.187);
      assert.equal(stats.receivables.overdueAmount, 15.187);
      console.log('accounting-digits-services: phase 3 (pdc cheques) OK');
    } finally {
      await db.destroy();
    }
  }

  // Phase 4: AR collections overview + case rows at book digits.
  {
    const pg = new PGlite();
    const db = makeDb(pg);
    const service = new ArCollectionsService(db);
    try {
      await seedCurrency(pg);
      await pg.exec(`
        CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text, phone text, address text, balance numeric, credit_limit numeric, is_credit_blocked boolean, credit_block_reason text, credit_blocked_at timestamptz, credit_blocked_by bigint, is_active boolean);
        CREATE TABLE ar_collection_cases (id text PRIMARY KEY, tenant_id text, customer_id bigint, current_level_id text, total_overdue numeric, oldest_overdue_days int, status text, promised_payment_date date, promised_amount numeric, last_contact_date timestamptz, next_followup_date date, notes text, updated_at timestamptz, created_at timestamptz, assigned_collector_id bigint);
        CREATE TABLE ar_dunning_levels (id text PRIMARY KEY, tenant_id text, level_order int, level_name text, days_past_due int, auto_block_sales boolean, action_type text, template_text text);
        CREATE TABLE users (id bigint PRIMARY KEY, name text);
        INSERT INTO customers VALUES (1, 't1', 'Cust A', '0100', null, 10.125, 100.125, false, null, null, null, true);
        INSERT INTO ar_collection_cases (id, tenant_id, customer_id, total_overdue, oldest_overdue_days, status, promised_payment_date, promised_amount, updated_at)
          VALUES ('case_1', 't1', 1, 10.125, 5, 'open', null, null, now());
      `);
      const overview = await service.getOverview(AUTH);
      assert.equal(overview.totalOverdue, 10.125);
      assert.equal(overview.promisedAmountToday, 0);
      assert.equal(overview.openCasesCount, 1);
      const { cases } = await service.getCases(AUTH, {} as never);
      assert.equal(cases.length, 1);
      assert.equal(cases[0].total_overdue, 10.125);
      assert.equal(cases[0].customer_balance, 10.125);
      assert.equal(cases[0].customer_credit_limit, 100.125);
      console.log('accounting-digits-services: phase 4 (ar collections) OK');
    } finally {
      await db.destroy();
    }
  }

  // Phase 5: withholding-tax Form 41 report over stored 3dp amounts.
  {
    const pg = new PGlite();
    const db = makeDb(pg);
    const service = new WithholdingTaxService(db, {} as never);
    try {
      await seedCurrency(pg);
      await pg.exec(`
        CREATE TABLE withholding_tax_transactions (id bigserial PRIMARY KEY, tenant_id text, direction text, source_type text, source_id bigint, invoice_number text, invoice_date date, partner_type text, partner_id bigint, partner_name text, tax_id_number text, file_number text, tax_office_code text, partner_address text, wht_type text, wht_rate numeric, base_amount numeric, tax_amount numeric, quarter text, tax_year int, status text, payment_reference text, notes text, created_by bigint, created_at timestamptz, updated_at timestamptz, extraction_key text);
        INSERT INTO withholding_tax_transactions (tenant_id, direction, source_type, invoice_number, invoice_date, partner_type, partner_name, wht_type, wht_rate, base_amount, tax_amount, quarter, tax_year, status, created_at, updated_at)
          VALUES ('t1', 'payable', 'manual', 'INV-1', '2026-05-10', 'supplier', 'Sup A', 'goods', 1, 10.125, 0.101, 'Q2', 2026, 'draft', now(), now());
      `);
      const report = await service.getForm41Report(AUTH, { year: 2026, quarter: 'Q2', direction: 'payable' });
      assert.equal(report.transactions.length, 1);
      assert.equal(report.transactions[0].base_amount, 10.125);
      assert.equal(report.transactions[0].tax_amount, 0.101);
      assert.equal(report.total_base_amount, 10.125);
      assert.equal(report.total_tax_amount, 0.101);
      assert.equal(report.breakdown.goods.count, 1);
      assert.equal(report.breakdown.goods.base_amount, 10.125);
      assert.equal(report.breakdown.goods.tax_amount, 0.101);
      console.log('accounting-digits-services: phase 5 (withholding tax) OK');
    } finally {
      await db.destroy();
    }
  }

  // Phase 6: aged receivables. The 10.125 balance ages at 10.125
  // (SQL round at book digits, not 2dp), and the 0.005 balance is
  // aged instead of dropped by the dust filter.
  {
    const pg = new PGlite();
    const db = makeDb(pg);
    const service = new AgedDebtsService(db);
    try {
      await seedCurrency(pg);
      await pg.exec(`
        CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text, phone text, credit_limit numeric);
        CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, customer_id bigint, created_at timestamptz, amount numeric, branch_id bigint);
        INSERT INTO customers VALUES (1, 't1', 'Cust A', '0100', 100.125), (2, 't1', 'Cust B', '0200', null);
        INSERT INTO customer_ledger (tenant_id, customer_id, created_at, amount, branch_id)
          VALUES ('t1', 1, '2026-01-01T00:00:00Z', 10.125, null),
                 ('t1', 2, '2026-01-01T00:00:00Z', 0.005, null);
      `);
      const report = await service.getAgedReceivables(AUTH, { asOfDate: '2026-06-01' });
      assert.equal(report.totalPartnersCount, 2);
      assert.equal(report.filteredPartnersCount, 2);
      assert.equal(report.totalBalance, 10.13);
      assert.equal(report.total91Plus, 10.13);
      assert.equal(report.partners.length, 2);
      const byId = new Map(report.partners.map((r) => [r.partnerId, r]));
      assert.equal(byId.get(1)?.totalBalance, 10.125);
      assert.equal(byId.get(1)?.days91Plus, 10.125);
      assert.equal(byId.get(1)?.currentAmount, 0);
      assert.equal(byId.get(2)?.totalBalance, 0.005);
      assert.equal(byId.get(2)?.days91Plus, 0.005);
      console.log('accounting-digits-services: phase 6 (aged debts) OK');
    } finally {
      await db.destroy();
    }
  }
  console.log('accounting-digits-services: OK (49 assertions)');
}

main().catch((error) => { console.error(error); process.exit(1); });
