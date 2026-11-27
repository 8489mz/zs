/*
 * P6 (cashier retrial 2): the close dialog let the cashier submit
 * Visa / wallet / InstaPay declared totals as 0.00 — submit needed
 * cash + password only. The close was submitted 23:09 2026-11-15
 * with all three at 0.00, when the shift actually had Visa
 * 11,835.30 / wallets 8,494.50 / InstaPay 6,780.00.
 *
 * WHAT THIS PINS (drives the real CashDrawerService against a
 * minimal PGlite harness, same accounting seed as
 * cash-drawer-shift-close-control.spec.ts):
 * - The per-method TOTAL is mandatory whenever that method has
 *   operations (server-computed count > 0); per-operation detail
 *   boxes stay optional. The gate is PRESENCE, not matching the
 *   system total: an explicitly entered 0.00 stays acceptable (the
 *   cashier counted and found zero), a missing total refuses the
 *   close with SHIFT_CLOSE_DECLARED_TOTAL_REQUIRED and posts
 *   nothing (the shift stays open, no variance journal).
 * - The counts come from the SERVER's own breakdown of the shift
 *   (POS sales + customer collections + service / return amounts),
 *   never from the caller-supplied operation counts: a payload
 *   claiming cardOperationCount 0 while a card sale exists is
 *   still refused, and a card collection alone (no card sale)
 *   still requires the card total.
 * - The same rule covers drawer cash: cash operations with no
 *   countedCash refuse the close; a shift with zero operations on
 *   every method closes with no declarations at all.
 * - NOTE (INV-ADMIN-CLOSE-DECLARED-TOTALS-WAIVER): the refusal
 *   pins below run as CASHIER-closes-own-shift. An admin/super_admin
 *   closer skips this gate (the close form renders the declaration
 *   rows only for a cashier closer) and the waiver is stamped into
 *   the close note — pinned by
 *   admin-close-declared-totals-waiver.spec.ts.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';
import { CashDrawerService } from '../../src/modules/cash-drawer/cash-drawer.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';

const codeOf = (error: unknown): string => (error as { code?: string })?.code || '';

async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const drawer = new CashDrawerService(db, new TransactionHelper(), posting);
  const cashier3 = {
    tenantId: 't1',
    accountId: 'a1',
    role: 'cashier',
    userId: 3,
    username: 'cashier3',
    permissions: [],
  } as unknown as AuthContext;

  const shiftRow = async (id: number) => {
    const r = await pg.query<{ status: string }>('SELECT status FROM cashier_shifts WHERE id=$1', [id]);
    return r.rows[0];
  };
  const journalCount = async () => {
    const r = await pg.query<{ count: string }>(
      `SELECT count(*) AS count FROM journal_entries WHERE source_type='cashier_shift_variance'`,
    );
    return Number(r.rows[0].count);
  };
  const shiftIdOf = async (opener: number): Promise<number> => {
    const r = await pg.query<{ id: string }>(
      'SELECT id FROM cashier_shifts WHERE opened_by=$1 ORDER BY id DESC LIMIT 1',
      [opener],
    );
    return Number(r.rows[0].id);
  };
  const seedSale = async (id: number, channel: string, amount: number, opener = 1) => {
    await pg.query(
      `INSERT INTO sales(id,tenant_id,account_id,table_number,order_type,status,payment_type,payment_channel,total,paid_amount,branch_id,created_by,created_at)
      VALUES ($1,'t1','a1','','takeaway','posted',$2,$3,$4,$4,1,$5,now())`,
      [id, channel, channel, amount, opener],
    );
  };
  const expectCode = async (promise: Promise<unknown>, code: string, message: string) => {
    try {
      await promise;
    } catch (err: unknown) {
      assert.equal(codeOf(err), code, `${message} — got ${codeOf(err)}: ${(err as Error)?.message}`);
      return;
    }
    assert.fail(`${message} — expected rejection with ${code}, the close went through`);
  };

  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY);
      INSERT INTO tenants VALUES ('t1');
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text DEFAULT '', default_stock_location_id bigint);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, name text DEFAULT '', branch_id bigint);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, role text, is_active boolean DEFAULT true, password_hash text, password_salt text, default_branch_id bigint);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
      CREATE TABLE cashier_shifts (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, doc_no text, branch_id bigint, location_id bigint,
        opened_by bigint, opening_cash numeric, opening_note text, status text,
        expected_cash numeric, counted_cash numeric, variance numeric,
        variance_resolution text, variance_journal_entry_id bigint, variance_charged_to_user_id bigint,
        variance_approved_by bigint, variance_approved_at timestamptz,
        close_note text, closed_by bigint, closed_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), terminal_code varchar(32));
      CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, account_id text, table_number text, order_type text, doc_no text,
        customer_id bigint, customer_name text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0,
        tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, tip_amount numeric DEFAULT 0, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0,
        tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, status text, note text,
        branch_id bigint, location_id bigint, created_by bigint, cancelled_at timestamptz, cancelled_by bigint, cancel_reason text,
        delivery_rep_id bigint, delivery_status text, collection_status text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
        pos_terminal_code varchar(32));
      CREATE TABLE sale_payments (id bigint PRIMARY KEY, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, tenant_id text, account_id text);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, line_discount numeric DEFAULT 0);
      CREATE TABLE services (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, amount numeric, payment_channel text, created_by bigint, created_at timestamptz DEFAULT now(), branch_id bigint, location_id bigint);
      CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, return_type text, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, created_by bigint, created_at timestamptz DEFAULT now(), branch_id bigint, location_id bigint, note text);
      CREATE TABLE treasury_transactions (id bigint PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, payment_channel text, created_at timestamptz DEFAULT now(), request_key text);
      CREATE TABLE supplier_payments (id bigint PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, amount numeric, note text, payment_channel text, payment_date timestamptz, created_by bigint, created_at timestamptz DEFAULT now(), branch_id bigint, location_id bigint);
      CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text, balance numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE expenses (id bigint PRIMARY KEY, tenant_id text, account_id text, amount numeric, title text, note text, expense_date timestamptz, created_by bigint, created_at timestamptz DEFAULT now(), branch_id bigint, location_id bigint, cancelled_at timestamptz, cancelled_by bigint, cancel_reason text);
      CREATE TABLE customer_payments (id bigint PRIMARY KEY, tenant_id text, account_id text, amount numeric, note text, payment_channel text, created_by bigint, created_at timestamptz DEFAULT now(), branch_id bigint, location_id bigint);
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE held_sales (id bigint PRIMARY KEY, tenant_id text, account_id text, table_number text, order_type text, customer_id bigint, payment_type text, payment_channel text, paid_amount numeric DEFAULT 0, cash_amount numeric DEFAULT 0, card_amount numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, note text, search text, price_type text, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, collection_status text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE customers (id bigint, tenant_id text, balance numeric DEFAULT 0);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text,
        name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset',
        account_group text DEFAULT '', is_active boolean DEFAULT true, is_tax boolean DEFAULT false);
      CREATE TABLE accounting_settings (id bigint, tenant_id text, cash_account_id bigint,
        bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint,
        inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint,
        cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint,
        purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint,
        lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text,
        period_number int, start_date date, end_date date);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text,
        entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint,
        status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint,
        posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint,
        reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text,
        dedup_key text, cash_flow_category text);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint,
        tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric,
        partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
      CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
      CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz);
      INSERT INTO branches VALUES (1, 't1', NULL);
      INSERT INTO settings VALUES ('t1','currency','KWD');
      INSERT INTO accounting_settings VALUES
        (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
    `);
    for (const [code, type] of [
      [1110, 'asset'],
      [7110, 'revenue'],
      [7210, 'expense'],
      [1135, 'asset'],
    ] as const) {
      await pg.query('INSERT INTO accounting_accounts(id,tenant_id,code,account_type) VALUES ($1,$2,$3,$4)', [
        code,
        't1',
        String(code),
        type,
      ]);
    }
    const passwords: Record<number, string> = { 1: 'pw-admin-1', 3: 'pw-cashier-3' };
    for (const [id, role, branch] of [
      [1, 'admin', null],
      [3, 'cashier', 1],
    ] as const) {
      const rec = await createPasswordRecord(passwords[id as number]);
      await pg.query(
        'INSERT INTO users(id,tenant_id,username,role,is_active,password_hash,password_salt,default_branch_id) VALUES ($1,$2,$3,$4,true,$5,$6,$7)',
        [id, 't1', `user${id}`, role, rec.hash, rec.salt, branch],
      );
    }
    await pg.query(`INSERT INTO user_branches VALUES ('t1',3,1)`);

    // ---------- Card: a card sale with no declared card total refuses, posts nothing. ----------
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, cashier3);
    const shiftCard = await shiftIdOf(3);
    await seedSale(1, 'card', 100, 3);
    const journalsBeforeCard = await journalCount();
    await expectCode(
      drawer.closeCashierShift(shiftCard, { countedCash: 100, managerPin: 'pw-cashier-3' }, cashier3),
      'SHIFT_CLOSE_DECLARED_TOTAL_REQUIRED',
      'a card sale with no cardDeclaredTotal must refuse the close',
    );
    assert.equal((await shiftRow(shiftCard)).status, 'open', 'a refused close must leave the shift open');
    assert.equal(await journalCount(), journalsBeforeCard, 'a refused close must post no variance journal');
    // The SAME shift closes once the total is declared — even an explicit 0.00.
    await drawer.closeCashierShift(
      shiftCard,
      { countedCash: 100, cardDeclaredTotal: 0, managerPin: 'pw-cashier-3' },
      cashier3,
    );
    assert.equal(
      (await shiftRow(shiftCard)).status,
      'pending_review',
      'an explicitly entered 0.00 card total must let the close proceed to review',
    );

    // ---------- Wallet: same shape. ----------
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, cashier3);
    const shiftWallet = await shiftIdOf(3);
    await seedSale(2, 'wallet', 50, 3);
    await expectCode(
      drawer.closeCashierShift(shiftWallet, { countedCash: 100, managerPin: 'pw-cashier-3' }, cashier3),
      'SHIFT_CLOSE_DECLARED_TOTAL_REQUIRED',
      'a wallet sale with no walletDeclaredTotal must refuse the close',
    );
    assert.equal((await shiftRow(shiftWallet)).status, 'open', 'a refused close must leave the shift open');
    await drawer.closeCashierShift(
      shiftWallet,
      { countedCash: 100, walletDeclaredTotal: 0, managerPin: 'pw-cashier-3' },
      cashier3,
    );
    assert.equal(
      (await shiftRow(shiftWallet)).status,
      'pending_review',
      'an explicitly entered 0.00 wallet total must let the close proceed to review',
    );

    // ---------- InstaPay: same shape. ----------
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, cashier3);
    const shiftInstapay = await shiftIdOf(3);
    await seedSale(3, 'instapay', 70, 3);
    await expectCode(
      drawer.closeCashierShift(shiftInstapay, { countedCash: 100, managerPin: 'pw-cashier-3' }, cashier3),
      'SHIFT_CLOSE_DECLARED_TOTAL_REQUIRED',
      'an InstaPay sale with no instapayDeclaredTotal must refuse the close',
    );
    assert.equal((await shiftRow(shiftInstapay)).status, 'open', 'a refused close must leave the shift open');
    await drawer.closeCashierShift(
      shiftInstapay,
      { countedCash: 100, instapayDeclaredTotal: 0, managerPin: 'pw-cashier-3' },
      cashier3,
    );
    assert.equal(
      (await shiftRow(shiftInstapay)).status,
      'pending_review',
      'an explicitly entered 0.00 InstaPay total must let the close proceed to review',
    );

    // ---------- Drawer cash: cash operations with no countedCash refuse; with it, proceed. ----------
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, cashier3);
    const shiftCash = await shiftIdOf(3);
    await seedSale(4, 'cash', 50, 3);
    await expectCode(
      drawer.closeCashierShift(shiftCash, { managerPin: 'pw-cashier-3' }, cashier3),
      'SHIFT_CLOSE_DECLARED_TOTAL_REQUIRED',
      'a cash sale with no countedCash must refuse the close',
    );
    assert.equal((await shiftRow(shiftCash)).status, 'open', 'a refused close must leave the shift open');
    await drawer.closeCashierShift(shiftCash, { countedCash: 150, managerPin: 'pw-cashier-3' }, cashier3);
    assert.equal(
      (await shiftRow(shiftCash)).status,
      'pending_review',
      'counted cash 150 (opening 100 + cash sale 50) must close clean to review',
    );

    // ---------- Zero operations on every method: no declarations needed at all. ----------
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, cashier3);
    const shiftEmpty = await shiftIdOf(3);
    await drawer.closeCashierShift(shiftEmpty, { managerPin: 'pw-cashier-3' }, cashier3);
    assert.equal(
      (await shiftRow(shiftEmpty)).status,
      'pending_review',
      'a shift with zero operations must close with no declared totals at all',
    );

    // ---------- Collections count too: a card receipt alone requires the card total. ----------
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, cashier3);
    const shiftColl = await shiftIdOf(3);
    await pg.query(`INSERT INTO customer_payments(id,tenant_id,account_id,amount,payment_channel,created_by,created_at,branch_id)
      VALUES (1,'t1','a1',50,'card',3,now(),1)`);
    await expectCode(
      drawer.closeCashierShift(shiftColl, { countedCash: 100, managerPin: 'pw-cashier-3' }, cashier3),
      'SHIFT_CLOSE_DECLARED_TOTAL_REQUIRED',
      'a card customer collection with no cardDeclaredTotal must refuse the close',
    );
    assert.equal((await shiftRow(shiftColl)).status, 'open', 'a refused close must leave the shift open');
    await drawer.closeCashierShift(
      shiftColl,
      { countedCash: 100, cardDeclaredTotal: 50, managerPin: 'pw-cashier-3' },
      cashier3,
    );
    assert.equal(
      (await shiftRow(shiftColl)).status,
      'pending_review',
      'declaring the collected card total must let the close proceed to review',
    );

    // ---------- The gate never trusts caller-supplied counts. ----------
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, cashier3);
    const shiftLie = await shiftIdOf(3);
    await seedSale(5, 'card', 100, 3);
    await expectCode(
      drawer.closeCashierShift(
        shiftLie,
        { countedCash: 100, cardOperationCount: 0, managerPin: 'pw-cashier-3' },
        cashier3,
      ),
      'SHIFT_CLOSE_DECLARED_TOTAL_REQUIRED',
      'a payload claiming cardOperationCount 0 while a card sale exists must still refuse the close',
    );
    assert.equal((await shiftRow(shiftLie)).status, 'open', 'a refused close must leave the shift open');
    await drawer.closeCashierShift(
      shiftLie,
      { countedCash: 100, cardDeclaredTotal: 100, cardOperationCount: 0, managerPin: 'pw-cashier-3' },
      cashier3,
    );
    assert.equal(
      (await shiftRow(shiftLie)).status,
      'pending_review',
      'declaring the card total must let the close proceed to review even with a caller count of 0',
    );

    // ---------- Service card alone (no card sale) requires the card total. ----------
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, cashier3);
    const shiftService = await shiftIdOf(3);
    await pg.query(`INSERT INTO services(id,tenant_id,account_id,name,amount,payment_channel,created_by,created_at,branch_id,location_id)
      VALUES (1,'t1','a1','خدمة',10,'card',3,now(),1,NULL)`);
    await expectCode(
      drawer.closeCashierShift(shiftService, { countedCash: 100, managerPin: 'pw-cashier-3' }, cashier3),
      'SHIFT_CLOSE_DECLARED_TOTAL_REQUIRED',
      'a service card payment with no cardDeclaredTotal must refuse the close',
    );
    assert.equal((await shiftRow(shiftService)).status, 'open', 'a refused close must leave the shift open');
    await drawer.closeCashierShift(
      shiftService,
      { countedCash: 100, cardDeclaredTotal: 10, managerPin: 'pw-cashier-3' },
      cashier3,
    );
    assert.equal(
      (await shiftRow(shiftService)).status,
      'pending_review',
      'declaring the service card total must let the close proceed to review',
    );

    console.log('Close declared-totals-required tests passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
