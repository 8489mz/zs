/*
 * INV-SOLO-ADMIN-SHIFT-CLOSE-OVER-TOLERANCE: the second-approval
 * gate over the shortage-tolerance cap (SHIFT_SECOND_APPROVAL_REQUIRED
 * / SHIFT_SECOND_APPROVER_MUST_DIFFER) used to require a DIFFERENT
 * admin/manager account password from every closer — the shared
 * manager PIN was rejected (no identity) and self-approval was
 * rejected. That gate is gone entirely
 * (INV-SECOND-MANAGER-PASSWORD-REMOVED): no second-manager password
 * is collected or required from ANY closer — an admin, a manager, or
 * any other role closes alone with a >=10-char note, stamped. A
 * supplied approverSecret is ignored. The >=10-char note stays: the
 * override needs a recorded reason.
 *
 * WHAT THIS PINS (drives the real CashDrawerService against a
 * minimal PGlite harness, same accounting seed as
 * admin-close-declared-totals-waiver.spec.ts):
 * - An admin closing an ADMIN-opened shift with a -20 variance
 *   over the default 0.001 cap, a >=10-char note and NO approver
 *   secret closes with status `closed`, and the override is stamped
 *   into the close note (who closed, the variance, the tolerance
 *   cap); the closer stays the approver of record
 *   (variance_approved_by = closer) and the variance journal is
 *   posted. The control is recorded, not silently dropped — and the
 *   stamp carries NO second-manager reference at all.
 * - A solo super_admin closes the same way, stamped with their name.
 * - A supplied approver secret is IGNORED: an admin closing WITH a
 *   second admin's account password still closes alone — the closer
 *   stays the approver of record and the solo-override stamp is
 *   used, never the old second-approval stamp.
 * - A non-privileged closer closes alone too: a manager closing
 *   their OWN manager-opened shift over tolerance with a >=10-char
 *   note and no approver closes with status `closed`, stamped, the
 *   manager staying the approver of record and the variance journal
 *   posted; with a different admin's password supplied it still
 *   closes alone (the secret is ignored).
 *   (A cashier can never reach this gate: a cashier closing their
 *   own shift is blind by the opener's role, so the gate — which
 *   fires only on non-blind closes — never runs for a cashier
 *   closer. The manager-opened shift is the non-privileged closer
 *   that can actually reach a non-blind close.)
 * - A closer with a short (<10-char) note and no approver is
 *   refused with SHIFT_SECOND_APPROVAL_NOTE_REQUIRED: the override
 *   needs a recorded reason, and a short note refuses instead of
 *   closing silently.
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
const LONG_NOTE = 'فرق كبير في الدرج يستدعي المراجعة';

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
  const manager2 = {
    tenantId: 't1',
    accountId: 'a1',
    role: 'admin',
    userId: 2,
    username: 'manager2',
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
  const manager6 = {
    tenantId: 't1',
    accountId: 'a1',
    role: 'manager',
    userId: 6,
    username: 'manager6',
    permissions: [],
  } as unknown as AuthContext;
  const superAdmin = {
    tenantId: 't1',
    accountId: 'a1',
    role: 'super_admin',
    userId: 9,
    username: 'owner',
    permissions: [],
  } as unknown as AuthContext;

  const shiftRow = async (id: number) => {
    const r = await pg.query<{
      status: string;
      close_note: string;
      variance: string | null;
      variance_approved_by: string | null;
    }>('SELECT status, close_note, variance, variance_approved_by FROM cashier_shifts WHERE id=$1', [id]);
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
    const passwords: Record<number, string> = {
      1: 'pw-admin-1',
      2: 'pw-manager-2',
      3: 'pw-cashier-3',
      6: 'pw-manager-6',
      9: 'pw-owner-9',
    };
    const usernames: Record<number, string> = { 1: 'admin1', 2: 'manager2', 3: 'cashier3', 6: 'manager6', 9: 'owner' };
    for (const [id, role, branch] of [
      [1, 'admin', null],
      [2, 'admin', null],
      [3, 'cashier', 1],
      [6, 'manager', null],
      [9, 'super_admin', null],
    ] as const) {
      const rec = await createPasswordRecord(passwords[id as number]);
      await pg.query(
        'INSERT INTO users(id,tenant_id,username,role,is_active,password_hash,password_salt,default_branch_id) VALUES ($1,$2,$3,$4,true,$5,$6,$7)',
        [id, 't1', usernames[id as number], role, rec.hash, rec.salt, branch],
      );
    }
    await pg.query(`INSERT INTO user_branches VALUES ('t1',3,1),('t1',6,1)`);

    // ---------- Solo admin: over-tolerance variance, long note, NO approver secret: closes + override stamp. ----------
    const journalsBeforeSolo = await journalCount();
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, admin1);
    const shiftSolo = await shiftIdOf(1);
    await drawer.closeCashierShift(shiftSolo, { countedCash: 80, note: LONG_NOTE, managerPin: 'pw-admin-1' }, admin1);
    const soloRow = await shiftRow(shiftSolo);
    assert.equal(soloRow.status, 'closed', 'a solo admin closing over tolerance with a recorded reason must close');
    assert.equal(Number(soloRow.variance), -20, 'the -20 variance must be recorded on the closed shift');
    assert.equal(Number(soloRow.variance_approved_by), 1, 'the solo closer stays the approver of record');
    assert.equal(
      await journalCount(),
      journalsBeforeSolo + 1,
      'a solo-admin override close must still post the variance journal',
    );
    assert.ok(
      String(soloRow.close_note || '').includes('اعتماد فرق منفرد بقرار إداري'),
      'the close note must carry the solo-admin override stamp',
    );
    assert.ok(String(soloRow.close_note || '').includes('admin1'), 'the override stamp must name who closed');
    assert.ok(String(soloRow.close_note || '').includes('الفرق -20'), 'the override stamp must record the variance');
    assert.ok(
      String(soloRow.close_note || '').includes('حد التسامح 0.001'),
      'the override stamp must record the tolerance cap',
    );
    assert.ok(
      !String(soloRow.close_note || '').includes('ثانٍ'),
      'the override stamp must carry no second-manager reference at all',
    );

    // ---------- Solo super_admin: same override, stamped with their name. ----------
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, superAdmin);
    const shiftSuper = await shiftIdOf(9);
    await drawer.closeCashierShift(
      shiftSuper,
      { countedCash: 80, note: LONG_NOTE, managerPin: 'pw-owner-9' },
      superAdmin,
    );
    const superRow = await shiftRow(shiftSuper);
    assert.equal(
      superRow.status,
      'closed',
      'a solo super_admin closing over tolerance with a recorded reason must close',
    );
    assert.equal(Number(superRow.variance_approved_by), 9, 'the solo super_admin stays the approver of record');
    assert.ok(
      String(superRow.close_note || '').includes('اعتماد فرق منفرد بقرار إداري'),
      'the super_admin close note must carry the solo-admin override stamp',
    );
    assert.ok(
      String(superRow.close_note || '').includes('owner'),
      'the override stamp must name the super_admin who closed',
    );

    // ---------- A supplied approver secret is IGNORED: no second-manager password is collected any more. ----------
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, admin1);
    const shiftSecond = await shiftIdOf(1);
    await drawer.closeCashierShift(
      shiftSecond,
      { countedCash: 80, note: LONG_NOTE, managerPin: 'pw-admin-1', approverSecret: 'pw-manager-2' },
      admin1,
    );
    const secondRow = await shiftRow(shiftSecond);
    assert.equal(secondRow.status, 'closed', 'an admin closing with a supplied approver secret must still close');
    assert.equal(
      Number(secondRow.variance_approved_by),
      1,
      'variance_approved_by must be the closer — the supplied secret names no approver any more',
    );
    assert.ok(
      String(secondRow.close_note || '').includes('اعتماد فرق منفرد بقرار إداري'),
      'a close with a supplied secret must carry the solo-override stamp',
    );
    assert.ok(
      !String(secondRow.close_note || '').includes('اعتماد فرق فوق حد التسامح بواسطة'),
      'a close with a supplied secret must not carry the old second-approval stamp',
    );
    assert.ok(
      !String(secondRow.close_note || '').includes('ثانٍ'),
      'the close note must carry no second-manager reference at all',
    );

    // ---------- Non-privileged closer closes alone too: no second approval is required from any role. ----------
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, manager6);
    const shiftManager = await shiftIdOf(6);
    const journalsBeforeManager = await journalCount();
    await drawer.closeCashierShift(
      shiftManager,
      { countedCash: 80, note: LONG_NOTE, managerPin: 'pw-manager-6' },
      manager6,
    );
    const managerRow = await shiftRow(shiftManager);
    assert.equal(
      managerRow.status,
      'closed',
      'a manager closing their own shift over tolerance with a recorded reason must close alone',
    );
    assert.equal(Number(managerRow.variance_approved_by), 6, 'the manager closer stays the approver of record');
    assert.equal(
      await journalCount(),
      journalsBeforeManager + 1,
      'a manager solo-override close must still post the variance journal',
    );
    assert.ok(
      String(managerRow.close_note || '').includes('اعتماد فرق منفرد بقرار إداري'),
      'the manager close note must carry the solo-override stamp',
    );
    assert.ok(
      String(managerRow.close_note || '').includes('manager6'),
      'the override stamp must name the manager who closed',
    );
    assert.ok(
      !String(managerRow.close_note || '').includes('ثانٍ'),
      'the close note must carry no second-manager reference at all',
    );
    // A supplied admin password is ignored on the manager path too.
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, manager6);
    const shiftManagerSecret = await shiftIdOf(6);
    await drawer.closeCashierShift(
      shiftManagerSecret,
      { countedCash: 80, note: LONG_NOTE, managerPin: 'pw-manager-6', approverSecret: 'pw-admin-1' },
      manager6,
    );
    const managerSecretRow = await shiftRow(shiftManagerSecret);
    assert.equal(managerSecretRow.status, 'closed', 'a manager closing with a supplied admin password must close');
    assert.equal(
      Number(managerSecretRow.variance_approved_by),
      6,
      'variance_approved_by must be the manager closer — the supplied secret names no approver any more',
    );
    assert.ok(
      !String(managerSecretRow.close_note || '').includes('اعتماد فرق فوق حد التسامح بواسطة'),
      'a manager close with a supplied secret must not carry the old second-approval stamp',
    );

    // ---------- A closer with a short note: refused until the reason is recorded. ----------
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, admin1);
    const shiftShort = await shiftIdOf(1);
    await expectCode(
      drawer.closeCashierShift(shiftShort, { countedCash: 80, note: 'x', managerPin: 'pw-admin-1' }, admin1),
      'SHIFT_SECOND_APPROVAL_NOTE_REQUIRED',
      'a closer closing over tolerance with a <10-char note must be refused until the override reason is recorded',
    );
    assert.equal((await shiftRow(shiftShort)).status, 'open', 'a refused close must leave the shift open');

    // ---------- Wiring: this spec is in both critical lists, in identical order (351 specs — the api-versioning spec is the last entry). ----------
    {
      const specs = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
        .specs as string[];
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
      const serial = String(pkg.scripts['test:critical:serial']);
      const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
      assert.equal(specs.length, 351);
      assert.equal(chain.length, 351);
      assert.deepEqual(chain, specs);
      assert.ok(specs.includes('test/critical/solo-admin-shift-close-over-tolerance.spec.ts'));
      console.log('wiring: evidence spec in both critical lists (351 = 351, identical order), passed');
    }

    console.log('Solo-admin shift-close over-tolerance tests passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
