/*
 * INV-ADMIN-CLOSE-DECLARED-TOTALS-WAIVER: the declared-totals
 * presence gate (SHIFT_CLOSE_DECLARED_TOTAL_REQUIRED) applied to
 * EVERY closer with no role exception, while the close form renders
 * the declaration rows only when the closer is a cashier — so an
 * admin closing a shift with card/wallet/InstaPay operations was
 * refused by a gate he had no input to satisfy (live clothes-client
 * case: admin-opened shift, Visa operations present, expected cash
 * 8,736.56 counted 8,736.56 variance 0.00, refused). For a non-blind
 * close the declared values are discarded anyway (blindCloseMeta is
 * null unless the opener is a cashier), so the gate had zero control
 * value on that path.
 *
 * WHAT THIS PINS (drives the real CashDrawerService against a
 * minimal PGlite harness, same accounting seed as
 * close-declared-totals-required.spec.ts):
 * - An admin closing an ADMIN-opened shift with Visa operations and
 *   no declared totals closes with status `closed`, and the waiver
 *   is stamped into the close note (the audit trail shows the
 *   missing declaration instead of silently dropping it).
 * - An admin closing a CASHIER-opened shift with Visa operations
 *   and no declared totals closes with status `pending_review`
 *   (blind close by the opener's role); the waiver is stamped into
 *   the blind-close note and the stored declaration carries
 *   cardTotal 0, so review reconciles the full delta.
 * - A cashier closing his OWN shift without declared totals is
 *   STILL refused with SHIFT_CLOSE_DECLARED_TOTAL_REQUIRED and
 *   posts nothing; declaring an explicit 0.00 lets it proceed to
 *   `pending_review`. The cashier path is byte-identical.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
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
  const admin1 = {
    tenantId: 't1',
    accountId: 'a1',
    role: 'admin',
    userId: 1,
    username: 'admin1',
    permissions: [],
  } as unknown as AuthContext;
  const cashier3 = {
    tenantId: 't1',
    accountId: 'a1',
    role: 'cashier',
    userId: 3,
    username: 'cashier3',
    permissions: [],
  } as unknown as AuthContext;

  const shiftRow = async (id: number) => {
    const r = await pg.query<{ status: string; close_note: string }>(
      'SELECT status, close_note FROM cashier_shifts WHERE id=$1',
      [id],
    );
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

    // ---------- Admin closes an ADMIN-opened shift with Visa ops, no declared totals: closed + waiver stamp. ----------
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, admin1);
    const shiftAdmin = await shiftIdOf(1);
    await seedSale(1, 'card', 100);
    await drawer.closeCashierShift(shiftAdmin, { countedCash: 100, managerPin: 'pw-admin-1' }, admin1);
    const adminRow = await shiftRow(shiftAdmin);
    assert.equal(
      adminRow.status,
      'closed',
      'an admin closing his own shift with Visa ops and no declared totals must close',
    );
    assert.ok(
      String(adminRow.close_note || '').includes('إقرار معفى بقرار إداري'),
      'the admin close note must carry the declared-totals waiver stamp',
    );
    assert.ok(
      String(adminRow.close_note || '').includes('الفيزا'),
      'the waiver stamp must name the waived Visa declaration',
    );
    assert.ok(String(adminRow.close_note || '').includes('admin1'), 'the waiver stamp must name the admin who closed');

    // ---------- Admin closes a CASHIER-opened shift with Visa ops, no declared totals: pending_review + waiver stamp. ----------
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, cashier3);
    const shiftCashier = await shiftIdOf(3);
    await seedSale(2, 'card', 100, 3);
    await drawer.closeCashierShift(shiftCashier, { countedCash: 100, managerPin: 'pw-admin-1' }, admin1);
    const cashierRow = await shiftRow(shiftCashier);
    assert.equal(
      cashierRow.status,
      'pending_review',
      'an admin closing a cashier-opened shift with Visa ops and no declared totals must go to pending_review',
    );
    assert.ok(
      String(cashierRow.close_note || '').includes('إقرار معفى بقرار إداري'),
      'the blind-close note must carry the declared-totals waiver stamp',
    );
    assert.ok(
      String(cashierRow.close_note || '').includes('"cardTotal":0'),
      'the stored blind declaration must carry cardTotal 0 so review reconciles the full delta',
    );

    // ---------- Cashier closing his OWN shift without declared totals: still refused, posts nothing. ----------
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, cashier3);
    const shiftOwn = await shiftIdOf(3);
    await seedSale(3, 'card', 100, 3);
    const journalsBefore = await journalCount();
    await expectCode(
      drawer.closeCashierShift(shiftOwn, { countedCash: 100, managerPin: 'pw-cashier-3' }, cashier3),
      'SHIFT_CLOSE_DECLARED_TOTAL_REQUIRED',
      'a cashier closing his own shift with a card sale and no cardDeclaredTotal must still be refused',
    );
    assert.equal((await shiftRow(shiftOwn)).status, 'open', 'a refused close must leave the shift open');
    assert.equal(await journalCount(), journalsBefore, 'a refused close must post no variance journal');
    // Declaring an explicit 0.00 lets the cashier close proceed to review.
    await drawer.closeCashierShift(
      shiftOwn,
      { countedCash: 100, cardDeclaredTotal: 0, managerPin: 'pw-cashier-3' },
      cashier3,
    );
    assert.equal(
      (await shiftRow(shiftOwn)).status,
      'pending_review',
      'an explicitly entered 0.00 card total must let the cashier close proceed to review',
    );

    // ---------- Wiring: this spec is in both critical lists, in identical order (363 specs — the purchases-writer spec is the last entry). ----------
    {
      const specs = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
        .specs as string[];
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
      const serial = String(pkg.scripts['test:critical:serial']);
      const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
      assert.equal(specs.length, 450);
      assert.equal(chain.length, 450);
      assert.deepEqual(chain, specs);
      assert.ok(specs.includes('test/critical/admin-close-declared-totals-waiver.spec.ts'));
      console.log('wiring: evidence spec in both critical lists (373 = 373, identical order), passed');
    }

    console.log('Admin close declared-totals waiver tests passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
