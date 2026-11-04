/*
New file: backend/test/critical/marketplace-settlement-book-digits.spec.ts

WHAT THIS PINS (INV-MARKETPLACE-SETTLEMENT-BOOK-DIGITS):
reconcileSettlement gates settlement amounts and the
gross-vs-parts identity at the tenant's BOOK digits, not at
a hardcoded 2 decimals. Before this fix the gate rejected
any amount with a non-zero third decimal, so a 3-decimal
tenant (KWD/OMR/BHD/JOD/TND/IQD/LYD) could not reconcile
any marketplace settlement at all. The gate now runs
inside the transaction, once the base currency is known,
through the shared currencyMoneyDigits rule used everywhere
else; the journal itself already went through
postDomainJournal, so only the gate changes.

THE CASES, WORKED ONCE:
(a) KWD tenant: gross 100.005 = referral 10.000 +
fulfillment 5.000 + other 0.500 + net 84.505 reconciles: a
balanced journal posts, bank debit 84.505, revenue credit
100.005.
(b) EGP tenant: a non-zero third decimal (100.005) is still
rejected -- the gate still enforces 2 decimals where the
book digits are 2.
(c) KWD tenant: a fourth decimal (100.0005) is rejected.
(d) KWD tenant: parts summing to 100.004 against gross
100.005 are rejected by the identity check at 3 decimals.

HOW THIS IS DRIVEN: the real MarketplaceSyncService over the
real AccountingPostingService on PGlite. Journal legs are
read from the posted journal rows, never re-implemented.

RED PROOF: on the unfixed tree case (a) throws the
2-decimal gate error and posts nothing.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuditService } from '../../src/core/audit/audit.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { MarketplaceSyncService } from '../../src/modules/storefront/services/marketplace-sync.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';

const adminAuth: AuthContext = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['sales'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(currency: string): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text, is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false, allow_manual_entries boolean DEFAULT true, is_cash_bank boolean DEFAULT false);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, cash_flow_category text, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE accounting_marketplace_settlements (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id text NOT NULL, marketplace text NOT NULL, settlement_key text NOT NULL, payload jsonb NOT NULL, journal_entry_id bigint, UNIQUE (tenant_id, marketplace, settlement_key));
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
  `);
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: currency }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: currency, exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('accounting_settings').values({ id: 1, tenant_id: TENANT }).execute();
  const accounts: Array<[number, string, string, boolean]> = [
    [1120, '1120', 'asset', true],
    [4100, '4100', 'revenue', false],
    [6400, '6400', 'expense', false],
    [6700, '6700', 'expense', false],
  ];
  for (const [id, code, type, isCashBank] of accounts) {
    await anyDb.insertInto('accounting_accounts').values({
      id, tenant_id: TENANT, code, name_ar: code, account_type: type,
      is_active: true, is_cash_bank: isCashBank, allow_manual_entries: true,
    }).execute();
  }
  return { pg, db };
}

function buildService(db: Kysely<Database>): MarketplaceSyncService {
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  return new MarketplaceSyncService(db, new AuditService(db), posting);
}

async function journalLeg(db: Kysely<Database>, entryId: number, accountId: number, side: 'debit' | 'credit'): Promise<number> {
  const rows = await (db as any).selectFrom('journal_entry_lines').select([side])
    .where('journal_entry_id', '=', entryId)
    .where('account_id', '=', accountId).execute();
  return rows.reduce((sum: number, row: any) => sum + Number(row[side] || 0), 0);
}

async function journalTotals(db: Kysely<Database>, entryId: number): Promise<{ debit: number; credit: number }> {
  const rows = await (db as any).selectFrom('journal_entry_lines').select(['debit', 'credit'])
    .where('journal_entry_id', '=', entryId).execute();
  return rows.reduce((acc: { debit: number; credit: number }, row: any) => ({
    debit: acc.debit + Number(row.debit || 0),
    credit: acc.credit + Number(row.credit || 0),
  }), { debit: 0, credit: 0 });
}

async function expectThrow(fn: () => Promise<unknown>, fragment: string): Promise<void> {
  let thrown: any = null;
  try {
    await fn();
  } catch (err: any) {
    thrown = err;
  }
  assert.ok(thrown, `expected a throw containing: ${fragment}`);
  assert.match(String(thrown?.message || ''), new RegExp(fragment), 'the error names the failure');
}

async function main(): Promise<void> {
  // (a) KWD: 3-decimal amounts reconcile and post balanced.
  {
    const { pg, db } = await makeDb('KWD');
    try {
      const service = buildService(db);
      const result = await service.reconcileSettlement({
        marketplace: 'amazon', settlementId: 'SET-1',
        periodStart: '2026-10-01', periodEnd: '2026-10-31', currency: 'KWD',
        grossSales: 100.005, referralFees: 10, fulfillmentFees: 5,
        refunds: 0, storageOrOtherFees: 0.5, netPayout: 84.505,
      }, adminAuth);
      assert.equal(result.ok, true, 'a 3-decimal settlement must reconcile');
      assert.ok(result.journalEntryId > 0, 'a journal entry is posted');
      assert.equal(await journalLeg(db, result.journalEntryId, 1120, 'debit'), 84.505, 'bank leg equals the net payout');
      assert.equal(await journalLeg(db, result.journalEntryId, 4100, 'credit'), 100.005, 'revenue leg equals gross sales');
      const totals = await journalTotals(db, result.journalEntryId);
      assert.equal(totals.debit, totals.credit, 'the settlement journal balances');
    } finally {
      await db.destroy();
    }
    console.log('  KWD 3-decimal settlement passed');
  }

  // (b) EGP: a non-zero third decimal is still rejected.
  {
    const { pg, db } = await makeDb('EGP');
    try {
      const service = buildService(db);
      await expectThrow(() => service.reconcileSettlement({
        marketplace: 'amazon', settlementId: 'SET-2',
        periodStart: '2026-10-01', periodEnd: '2026-10-31', currency: 'EGP',
        grossSales: 100.005, referralFees: 10, fulfillmentFees: 5,
        refunds: 0, storageOrOtherFees: 0.5, netPayout: 84.505,
      }, adminAuth), 'دقة عملة الأساس');
      const rows = await (db as any).selectFrom('journal_entries').select('id').execute();
      assert.equal(rows.length, 0, 'a rejected settlement posts nothing');
    } finally {
      await db.destroy();
    }
    console.log('  EGP third-decimal rejection passed');
  }

  // (c) KWD: a fourth decimal is rejected.
  {
    const { pg, db } = await makeDb('KWD');
    try {
      const service = buildService(db);
      await expectThrow(() => service.reconcileSettlement({
        marketplace: 'noon', settlementId: 'SET-3',
        periodStart: '2026-10-01', periodEnd: '2026-10-31', currency: 'KWD',
        grossSales: 100.0005, referralFees: 10, fulfillmentFees: 5,
        refunds: 0, storageOrOtherFees: 0.5, netPayout: 84.5005,
      }, adminAuth), 'دقة عملة الأساس');
    } finally {
      await db.destroy();
    }
    console.log('  KWD fourth-decimal rejection passed');
  }

  // (d) KWD: the identity check runs at 3 decimals.
  {
    const { pg, db } = await makeDb('KWD');
    try {
      const service = buildService(db);
      await expectThrow(() => service.reconcileSettlement({
        marketplace: 'amazon', settlementId: 'SET-4',
        periodStart: '2026-10-01', periodEnd: '2026-10-31', currency: 'KWD',
        grossSales: 100.005, referralFees: 10, fulfillmentFees: 5,
        refunds: 0, storageOrOtherFees: 0.5, netPayout: 84.504,
      }, adminAuth), 'لا يطابق');
    } finally {
      await db.destroy();
    }
    console.log('  KWD identity-at-3-decimals passed');
  }

  console.log('Marketplace settlement book-digits tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
