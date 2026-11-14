/*
 * R4-B / INV-REST-SHIFT-CLOSE-CONTROL: closing a shift is a control, not
 * a formality. Pure asserts + PGlite cases. The pure part imports
 * production helpers; the PGlite part drives the production
 * CashDrawerService / SalesAuthorizationService against a minimal
 * harness (same accounting seed as cash-drawer-variance.spec.ts).
 *
 * WHAT THIS PINS:
 * I20 — close is blocked while the opener still has open tables
 *   (held_sales rows) or draft sales in the shift window; only a
 *   DIFFERENT manager's secret + a >=10-char reason overrides it,
 *   and the override is stamped into close_note.
 *   INV-SHIFT-CLOSE-HANDOVER-NOTE-REASON: the closing note IS the
 *   handover justification — the reason is read from
 *   openTablesOverrideReason OR the closing note (ملاحظة الإغلاق),
 *   so a reason typed in the visible note field counts. An
 *   admin/super_admin closer closes with a >=10-char reason alone
 *   (admin-as-super_admin: their own password-confirmed close +
 *   recorded reason is the control); a cashier still needs a
 *   different manager's account secret. Held tables and drafts
 *   survive the close — they belong to the shop, not the shift.
 * INV-SHIFT-CLOSE-ADMIN-CLOSE-ANY: an admin closes ANY cashier's
 *   shift (recorded as the closer, blind close goes to review);
 *   a cashier closes only their own — another cashier's shift
 *   throws SHIFT_FORBIDDEN.
 * I21 — a variance over the shortage-tolerance cap needs a second
 *   approver (a manager/admin other than the closer, by account
 *   password — the shared PIN has no identity and cannot prove a
 *   second person) + a >=10-char note; variance_approved_by is the
 *   approver. Blind close keys off the OPENER's role, so a
 *   super_admin closing a cashier's shift goes to pending_review.
 * I22 — review takes a decision: approve with any declared/computed
 *   delta, count delta, or detail-total delta and no >=10-char note
 *   throws; reject reopens the shift with the reason stamped and
 *   posts NO variance journal; a clean approve closes it.
 * I23 — the POS/cash-sale shift gate honours requireCashierShiftForSales:
 *   false (or 'false') lets a sale through with no open shift;
 *   true or missing still demands one. (Only the small gate service
 *   is spec'd here, never full createSale: the PGlite
 *   single-connection trap — the service reads this.db inside its
 *   own transaction — would hang it.)
 * I24 — a terminal_code identifies a station: a second open on the
 *   same branch+terminal throws, and a third login's sale carrying
 *   that terminal's code attributes to that terminal's shift even
 *   when two shifts are open (the old exactly-one-open-shift
 *   fallback cannot claim it).
 * I25 — the expected-cash breakdown is one pure function whose rows
 *   sum to its total, including customer collections and cancelled-
 *   sale cash; the hydrated shift row exposes both totals.
 * I26 — an offline timestamp is validated, never silently clamped
 *   (garbage / future / pre-2000 reject); a backdated sale inside a
 *   closed shift's window corrects that shift's stored figures
 *   through refreshClosedShiftSummary with a stamped correction.
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
import { hashManagerPin } from '../../src/common/utils/manager-approval';
import { CashDrawerService } from '../../src/modules/cash-drawer/cash-drawer.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import {
  buildExpectedCashBreakdown,
  requiresSecondApproval,
  sumExpectedCashRows,
  validateOfflineCreatedAt,
} from '../../src/modules/cash-drawer/helpers/cash-drawer.helper';
import {
  SalesAuthorizationService,
  resolveRequireCashierShiftForSales,
} from '../../src/modules/sales/services/sales-authorization.service';

// --- Pure layer: second-approval gate. ---
assert.equal(requiresSecondApproval(20, 0.01), true);
assert.equal(requiresSecondApproval(-20, 0.01), true);
assert.equal(requiresSecondApproval(0.005, 0.01), false);
assert.equal(requiresSecondApproval(-20, 25), false);
assert.equal(requiresSecondApproval(0.01, 0.01), false, 'a variance exactly at the cap is within tolerance');
assert.equal(requiresSecondApproval(0, 0), false);

// --- Pure layer: expected-cash breakdown rows sum to the total. ---
const breakdown = buildExpectedCashBreakdown({
  openingCash: 100,
  netDrawerMovement: 5,
  cashSalesTotal: 50,
  cancelledSaleCashTotal: 20,
  serviceCashTotal: 10,
  customerCollectionsTotal: 30,
  saleReturnCashRefundTotal: 15,
  supplierPaymentsTotal: 25,
  expensesTotal: 5,
});
assert.equal(breakdown.total, 170, '100+5+50+20+10+30-15-25-5 must be 170');
assert.equal(sumExpectedCashRows(breakdown.rows), breakdown.total, 'rows must sum to the total');
assert.ok(breakdown.rows.some((row: { key: string; amount: number }) => row.key === 'customerCollections' && row.amount === 30));
assert.ok(breakdown.rows.some((row: { key: string; amount: number }) => row.key === 'cancelledSaleCash' && row.amount === 20));
assert.ok(breakdown.rows.some((row: { key: string; amount: number }) => row.key === 'saleReturnsCash' && row.amount === -15));

// --- Pure layer: offline timestamp validation (never silently clamped). ---
assert.ok(validateOfflineCreatedAt('2026-11-08T10:00:00.000Z') instanceof Date);
assert.equal(validateOfflineCreatedAt(undefined), null);
assert.equal(validateOfflineCreatedAt(''), null);
assert.throws(() => validateOfflineCreatedAt('not-a-date'), /OFFLINE_TIMESTAMP_INVALID/);
assert.throws(() => validateOfflineCreatedAt('1970-01-01T00:00:00.000Z'), /OFFLINE_TIMESTAMP_INVALID/);
assert.throws(
  () => validateOfflineCreatedAt(new Date(Date.now() + 60 * 60 * 1000).toISOString()),
  /OFFLINE_TIMESTAMP_INVALID/,
  'a timestamp an hour in the future must reject, never clamp to now',
);

// --- Pure layer: the shift-for-sales setting resolves fail-closed. ---
assert.equal(resolveRequireCashierShiftForSales(new Map([['requireCashierShiftForSales', false]])), false);
assert.equal(resolveRequireCashierShiftForSales(new Map([['requireCashierShiftForSales', 'false']])), false);
assert.equal(resolveRequireCashierShiftForSales(new Map([['requireCashierShiftForSales', true]])), true);
assert.equal(resolveRequireCashierShiftForSales(new Map()), true, 'a missing setting still demands a shift');
assert.equal(resolveRequireCashierShiftForSales(undefined), true);

const codeOf = (error: unknown): string => (error as { code?: string })?.code || '';

async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const drawer = new CashDrawerService(db, new TransactionHelper(), posting);
  const authz = new SalesAuthorizationService(db);
  const admin1 = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin1', permissions: [] } as unknown as AuthContext;
  const manager2 = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 2, username: 'manager2', permissions: [] } as unknown as AuthContext;
  const cashier3 = { tenantId: 't1', accountId: 'a1', role: 'cashier', userId: 3, username: 'cashier3', permissions: [] } as unknown as AuthContext;
  const cashier5 = { tenantId: 't1', accountId: 'a1', role: 'cashier', userId: 5, username: 'cashier5', permissions: [] } as unknown as AuthContext;
  const admin4 = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 4, username: 'admin4', permissions: [] } as unknown as AuthContext;
  const superAdmin = { tenantId: 't1', accountId: 'a1', role: 'super_admin', userId: 9, username: 'owner', permissions: [] } as unknown as AuthContext;

  const shiftRow = async (id: number) => {
    const r = await pg.query<{ status: string; close_note: string; counted_cash: string | null; variance: string | null; variance_approved_by: string | null; expected_cash: string; closed_by: string | null; closed_at: string | null }>(
      'SELECT status, close_note, counted_cash, variance, variance_approved_by, expected_cash, closed_by, closed_at FROM cashier_shifts WHERE id=$1', [id]);
    return r.rows[0];
  };
  const journalCount = async () => {
    const r = await pg.query<{ count: string }>(`SELECT count(*) AS count FROM journal_entries WHERE source_type='cashier_shift_variance'`);
    return Number(r.rows[0].count);
  };
  const shiftIdOf = async (opener: number): Promise<number> => {
    const r = await pg.query<{ id: string }>(
      'SELECT id FROM cashier_shifts WHERE opened_by=$1 ORDER BY id DESC LIMIT 1', [opener]);
    return Number(r.rows[0].id);
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
    for (const [code, type] of [[1110, 'asset'], [7110, 'revenue'], [7210, 'expense'], [1135, 'asset']] as const) {
      await pg.query('INSERT INTO accounting_accounts(id,tenant_id,code,account_type) VALUES ($1,$2,$3,$4)', [code, 't1', String(code), type]);
    }
    const passwords: Record<number, string> = { 1: 'pw-admin-1', 2: 'pw-manager-2', 3: 'pw-cashier-3', 4: 'pw-admin-4', 5: 'pw-cashier-5', 9: 'pw-owner-9' };
    for (const [id, role, branch] of [[1, 'admin', null], [2, 'admin', null], [3, 'cashier', 1], [4, 'admin', null], [5, 'cashier', 1], [9, 'super_admin', null]] as const) {
      const rec = await createPasswordRecord(passwords[id as number]);
      await pg.query(
        'INSERT INTO users(id,tenant_id,username,role,is_active,password_hash,password_salt,default_branch_id) VALUES ($1,$2,$3,$4,true,$5,$6,$7)',
        [id, 't1', `user${id}`, role, rec.hash, rec.salt, branch],
      );
    }
    await pg.query(`INSERT INTO user_branches VALUES ('t1',3,1),('t1',5,1)`);

    // ---------- I20: open tables / draft sales block the close. ----------
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, admin1);
    const shiftA = await shiftIdOf(1);
    await pg.query(`INSERT INTO held_sales(id,tenant_id,account_id,table_number,order_type,branch_id,created_by,created_at)
      VALUES (1,'t1','a1','T5','dine_in',1,1,now())`);
    await pg.query(`INSERT INTO sales(id,tenant_id,account_id,table_number,order_type,status,branch_id,created_by,created_at)
      VALUES (1,'t1','a1','T7','dine_in','draft',1,1,now())`);
    await assert.rejects(
      drawer.closeCashierShift(shiftA, { countedCash: 100, managerPin: 'pw-admin-1' }, admin1),
      (err: unknown) => codeOf(err) === 'SHIFT_CLOSE_OPEN_TABLES',
      'a held table + a draft sale must block the close',
    );
    await pg.query(`DELETE FROM held_sales WHERE id=1`);
    await assert.rejects(
      drawer.closeCashierShift(shiftA, { countedCash: 100, managerPin: 'pw-admin-1' }, admin1),
      (err: unknown) => codeOf(err) === 'SHIFT_CLOSE_OPEN_TABLES',
      'the remaining draft sale alone must still block the close',
    );
    await pg.query(`DELETE FROM sales WHERE id=1`);
    await drawer.closeCashierShift(shiftA, { countedCash: 100, managerPin: 'pw-admin-1' }, admin1);
    assert.equal((await shiftRow(shiftA)).status, 'closed', 'with no open tables or drafts the close succeeds');

    // Override: a different manager's secret + a >=10-char reason, stamped.
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, admin1);
    const shiftB = await shiftIdOf(1);
    await pg.query(`INSERT INTO held_sales(id,tenant_id,account_id,table_number,order_type,branch_id,created_by,created_at)
      VALUES (2,'t1','a1','T5','dine_in',1,1,now())`);
    await assert.rejects(
      drawer.closeCashierShift(shiftB, { countedCash: 100, managerPin: 'pw-admin-1', openTablesOverrideSecret: 'pw-manager-2', openTablesOverrideReason: 'قصير' }, admin1),
      (err: unknown) => codeOf(err) === 'SHIFT_CLOSE_OVERRIDE_REASON_REQUIRED',
      'an override reason under 10 chars must not open the gate',
    );
    await drawer.closeCashierShift(shiftB, { countedCash: 100, managerPin: 'pw-admin-1', openTablesOverrideSecret: 'pw-manager-2', openTablesOverrideReason: 'الطاولة ستنتقل إلى وردية المساء' }, admin1);
    const rowB = await shiftRow(shiftB);
    assert.equal(rowB.status, 'closed');
    assert.ok(String(rowB.close_note || '').includes('T5'), 'the override stamp must name the open table');
    assert.ok(String(rowB.close_note || '').includes('وردية المساء'), 'the override stamp must carry the reason');

    // The identity rule still binds a non-admin closer: the shared
    // manager PIN carries no identity, so it cannot approve an override.
    await pg.query(`INSERT INTO settings VALUES ('t1','managerPin',$1)`, [JSON.stringify(await hashManagerPin('1234'))]);
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, cashier3);
    const shiftB2 = await shiftIdOf(3);
    await pg.query(`INSERT INTO held_sales(id,tenant_id,account_id,table_number,order_type,branch_id,created_by,created_at)
      VALUES (3,'t1','a1','T5','dine_in',1,3,now())`);
    await assert.rejects(
      drawer.closeCashierShift(shiftB2, { countedCash: 100, managerPin: 'pw-cashier-3', openTablesOverrideSecret: '1234', openTablesOverrideReason: 'الطاولة ستنتقل إلى وردية المساء' }, cashier3),
      (err: unknown) => codeOf(err) === 'SHIFT_CLOSE_OVERRIDE_IDENTITY_REQUIRED',
      'a cashier cannot override with the shared manager PIN — it proves no second person',
    );
    await pg.query(`DELETE FROM settings WHERE tenant_id='t1' AND key='managerPin'`);
    await pg.query(`DELETE FROM held_sales WHERE id=3`);
    await drawer.closeCashierShift(shiftB2, { countedCash: 100, managerPin: 'pw-cashier-3' }, cashier3);

    // INV-SHIFT-CLOSE-HANDOVER-NOTE-REASON: an admin closer with a
    // >=10-char reason in the closing note alone closes with open
    // tables — no second manager's secret — and the held table and
    // draft survive for the next cashier.
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, admin1);
    const shiftH1 = await shiftIdOf(1);
    await pg.query(`INSERT INTO held_sales(id,tenant_id,account_id,table_number,order_type,branch_id,created_by,created_at)
      VALUES (20,'t1','a1','T5','dine_in',1,1,now())`);
    await pg.query(`INSERT INTO sales(id,tenant_id,account_id,table_number,order_type,status,branch_id,created_by,created_at)
      VALUES (21,'t1','a1','T7','dine_in','draft',1,1,now())`);
    await drawer.closeCashierShift(shiftH1, { countedCash: 100, note: 'الطاولات ستنتقل إلى وردية المساء', managerPin: 'pw-admin-1' }, admin1);
    const rowH1 = await shiftRow(shiftH1);
    assert.equal(rowH1.status, 'closed', 'an admin handover close with a >=10-char reason in the closing note must succeed');
    assert.ok(String(rowH1.close_note || '').includes('وردية المساء'), 'the handover stamp must carry the closing-note reason');
    assert.ok(String(rowH1.close_note || '').includes('T5'), 'the handover stamp must name the open table');
    const heldAfter = await pg.query<{ count: string }>(`SELECT count(*) AS count FROM held_sales WHERE id=20`);
    assert.equal(Number(heldAfter.rows[0].count), 1, 'the held table must survive the close for the next cashier');
    const draftAfter = await pg.query<{ count: string }>(`SELECT count(*) AS count FROM sales WHERE id=21 AND status='draft'`);
    assert.equal(Number(draftAfter.rows[0].count), 1, 'the draft sale must survive the close');
    assert.equal(await drawer.computeShiftExpectedCash(shiftH1, admin1), 100, 'held tables and drafts must not inflate the closed shift expected cash');
    await pg.query(`DELETE FROM held_sales WHERE id=20`);
    await pg.query(`DELETE FROM sales WHERE id=21`);

    // An admin handover close with a reason under 10 chars still demands one.
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, admin1);
    const shiftH2 = await shiftIdOf(1);
    await pg.query(`INSERT INTO held_sales(id,tenant_id,account_id,table_number,order_type,branch_id,created_by,created_at)
      VALUES (22,'t1','a1','T5','dine_in',1,1,now())`);
    await assert.rejects(
      drawer.closeCashierShift(shiftH2, { countedCash: 100, note: 'قصير', managerPin: 'pw-admin-1' }, admin1),
      (err: unknown) => codeOf(err) === 'SHIFT_CLOSE_OVERRIDE_REASON_REQUIRED',
      'an admin handover close with a reason under 10 chars must still demand a reason',
    );
    await pg.query(`DELETE FROM held_sales WHERE id=22`);
    await drawer.closeCashierShift(shiftH2, { countedCash: 100, managerPin: 'pw-admin-1' }, admin1);

    // A cashier still needs a second manager's secret even with a long
    // closing note — the note fallback waives no secret for cashiers.
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, cashier3);
    const shiftH3 = await shiftIdOf(3);
    await pg.query(`INSERT INTO held_sales(id,tenant_id,account_id,table_number,order_type,branch_id,created_by,created_at)
      VALUES (23,'t1','a1','T5','dine_in',1,3,now())`);
    await assert.rejects(
      drawer.closeCashierShift(shiftH3, { countedCash: 100, note: 'الطاولات ستنتقل إلى وردية المساء', managerPin: 'pw-cashier-3' }, cashier3),
      (err: unknown) => codeOf(err) === 'SHIFT_CLOSE_OPEN_TABLES',
      'a cashier still needs a second manager secret even with a long closing note',
    );
    // ...but the reason may live in the closing note instead of the
    // override-reason box: secret + note reason closes (to review).
    await drawer.closeCashierShift(shiftH3, { countedCash: 100, note: 'الطاولات ستنتقل إلى وردية المساء', managerPin: 'pw-cashier-3', openTablesOverrideSecret: 'pw-manager-2' }, cashier3);
    const rowH3 = await shiftRow(shiftH3);
    assert.equal(rowH3.status, 'pending_review', 'a cashier-opener shift closed with a manager override goes to review');
    assert.ok(String(rowH3.close_note || '').includes('وردية المساء'), 'the override stamp must carry the closing-note reason for the cashier path too');
    await pg.query(`DELETE FROM held_sales WHERE id=23`);

    // ---------- TRIAL REPRODUCTION (SHIFT-261113-0027 state, 2026-11-14):
    // opener cashier, closer admin, 5 parked orders (held tables),
    // closing note >= 10 chars, counted = expected = 4283.90, diff 0.00.
    // Diagnostic for the live close that failed with the generic
    // message in the agent browser session: if this closes in-test,
    // the backend close path is sound for this state and the live
    // failure is NOT a backend bug in the close logic (the browser
    // hypothesis then stands: stale bundle / stale session state).
    await drawer.openCashierShift({ openingCash: 4283.90, branchId: 1 }, cashier3);
    const shiftT1 = await shiftIdOf(3);
    for (let n = 1; n <= 5; n++) {
      await pg.query(`INSERT INTO held_sales(id,tenant_id,account_id,table_number,order_type,branch_id,created_by,created_at)
        VALUES (${30 + n},'t1','a1','T${n}','dine_in',1,3,now())`);
    }
    await drawer.closeCashierShift(shiftT1, { countedCash: 4283.90, note: 'الطاولات الخمس ستنتقل إلى وردية المساء', managerPin: 'pw-admin-1' }, admin1);
    const rowT1 = await shiftRow(shiftT1);
    assert.equal(rowT1.status, 'pending_review', 'a cashier-opener shift closes to review with 5 parked orders and a long note');
    assert.equal(Number(rowT1.variance), 0, 'counted = expected must give zero variance');
    assert.equal(Number(rowT1.expected_cash), 4283.9, 'expected cash must be the 4283.90 opening cash');
    assert.ok(String(rowT1.close_note || '').includes('وردية المساء'), 'the override stamp must carry the closing-note reason');
    for (let n = 1; n <= 5; n++) {
      assert.ok(String(rowT1.close_note || '').includes(`T${n}`), `the override stamp must name table T${n}`);
    }
    await pg.query(`DELETE FROM held_sales WHERE id >= 31 AND id <= 35`);

    // Same trial state, admin opener + admin closer: closes outright
    // (no blind review), variance 0, no variance journal.
    const journalsBeforeT = await journalCount();
    await drawer.openCashierShift({ openingCash: 4283.90, branchId: 1 }, admin1);
    const shiftT2 = await shiftIdOf(1);
    for (let n = 1; n <= 5; n++) {
      await pg.query(`INSERT INTO held_sales(id,tenant_id,account_id,table_number,order_type,branch_id,created_by,created_at)
        VALUES (${40 + n},'t1','a1','T${n}','dine_in',1,1,now())`);
    }
    await drawer.closeCashierShift(shiftT2, { countedCash: 4283.90, note: 'الطاولات الخمس ستنتقل إلى وردية المساء', managerPin: 'pw-admin-1' }, admin1);
    const rowT2 = await shiftRow(shiftT2);
    assert.equal(rowT2.status, 'closed', 'an admin-opener shift with 5 parked orders and a long note closes outright');
    assert.equal(Number(rowT2.variance), 0, 'counted = expected must give zero variance');
    assert.equal(Number(rowT2.expected_cash), 4283.9, 'expected cash must be the 4283.90 opening cash');
    assert.equal(await journalCount(), journalsBeforeT, 'a zero-variance close must post no variance journal');
    await pg.query(`DELETE FROM held_sales WHERE id >= 41 AND id <= 45`);

    // ---------- INV-SHIFT-CLOSE-ADMIN-CLOSE-ANY: admin closes any
    // cashier's shift; a cashier closes only their own. The old
    // owner-only gate (super_admin excepted) blocked the shop owner
    // from closing a cashier who forgot or left — live on test10k
    // 2026-11-13, admin closing cashier_test SHIFT-261112-0026 got
    // "غير مسموح لك بإغلاق هذه الوردية". Admin is super_admin in
    // all in-tenant permissions (standing rule, decided 2026-11-11
    // for discounts, generalized 2026-11-13); super_admin exists
    // only for package/subscription changes. ----------
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, cashier5);
    const shiftP1 = await shiftIdOf(5);
    await assert.rejects(
      drawer.closeCashierShift(shiftP1, { countedCash: 100, managerPin: 'pw-cashier-3' }, cashier3),
      (err: unknown) => codeOf(err) === 'SHIFT_FORBIDDEN',
      'a cashier must never close another cashier shift',
    );
    await drawer.closeCashierShift(shiftP1, { countedCash: 100, managerPin: 'pw-admin-1' }, admin1);
    const rowP1 = await shiftRow(shiftP1);
    assert.equal(rowP1.status, 'pending_review', 'an admin closing a cashier-opener shift goes to review, like super_admin');
    assert.equal(Number(rowP1.closed_by), 1, 'the admin closer must be recorded as the closer');
    await drawer.reviewCashierShiftClose(shiftP1, { decision: 'approve', note: 'مطابق' }, manager2);
    assert.equal((await shiftRow(shiftP1)).status, 'closed');
    // A cashier closing their own shift still works.
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, cashier5);
    const shiftP2 = await shiftIdOf(5);
    await drawer.closeCashierShift(shiftP2, { countedCash: 100, managerPin: 'pw-cashier-5' }, cashier5);
    assert.equal((await shiftRow(shiftP2)).status, 'pending_review', 'a cashier closing their own shift still works');

    // ---------- I21: over-cap variance needs a second approver. ----------
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, admin1);
    const shiftC = await shiftIdOf(1);
    await assert.rejects(
      drawer.closeCashierShift(shiftC, { countedCash: 80, note: 'x', managerPin: 'pw-admin-1' }, admin1),
      (err: unknown) => codeOf(err) === 'SHIFT_SECOND_APPROVAL_REQUIRED',
      'a 20.000 variance over the default 0.001 cap with no approver must throw',
    );
    await assert.rejects(
      drawer.closeCashierShift(shiftC, { countedCash: 80, note: 'فرق كبير في الدرج يستدعي المراجعة', managerPin: 'pw-admin-1', approverSecret: 'pw-admin-1' }, admin1),
      (err: unknown) => codeOf(err) === 'SHIFT_SECOND_APPROVER_MUST_DIFFER',
      'the closer cannot second-approve their own variance',
    );
    await drawer.closeCashierShift(shiftC, { countedCash: 80, note: 'فرق كبير في الدرج يستدعي المراجعة', managerPin: 'pw-admin-1', approverSecret: 'pw-manager-2' }, admin1);
    const rowC = await shiftRow(shiftC);
    assert.equal(rowC.status, 'closed');
    assert.equal(Number(rowC.variance_approved_by), 2, 'variance_approved_by must be the second approver, not the closer');
    assert.equal(Number(rowC.variance), -20);

    // Within an explicitly configured cap (25) the same variance closes alone.
    await pg.query(`INSERT INTO settings VALUES ('t1','cashierShortageTolerance','25')`);
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, admin1);
    const shiftD = await shiftIdOf(1);
    await drawer.closeCashierShift(shiftD, { countedCash: 80, note: 'x', managerPin: 'pw-admin-1' }, admin1);
    assert.equal(Number((await shiftRow(shiftD)).variance_approved_by), 1, 'within cap the closer remains the approver of record');
    await pg.query(`DELETE FROM settings WHERE tenant_id='t1' AND key='cashierShortageTolerance'`);

    // Blind close keys off the OPENER: a super_admin closing a cashier's shift goes to review.
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, cashier3);
    const shiftE = await shiftIdOf(3);
    await drawer.closeCashierShift(shiftE, { countedCash: 100, managerPin: 'pw-owner-9' }, superAdmin);
    assert.equal((await shiftRow(shiftE)).status, 'pending_review', 'a cashier-opener shift closed by super_admin must await review');
    await drawer.reviewCashierShiftClose(shiftE, { decision: 'approve', note: 'مطابق' }, manager2);
    assert.equal((await shiftRow(shiftE)).status, 'closed');

    // ---------- I22: review decides; reject reopens with no journal. ----------
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, cashier3);
    const shiftF = await shiftIdOf(3);
    await drawer.closeCashierShift(shiftF, { countedCash: 100, cardDeclaredTotal: 100, cardOperationCount: 1, managerPin: 'pw-cashier-3' }, cashier3);
    assert.equal((await shiftRow(shiftF)).status, 'pending_review');
    const journalsBefore = await journalCount();
    await assert.rejects(
      drawer.reviewCashierShiftClose(shiftF, { decision: 'approve', note: '' }, manager2),
      (err: unknown) => codeOf(err) === 'SHIFT_REVIEW_NOTE_REQUIRED',
      'approving a 100.000 card mismatch with no note must throw',
    );
    await assert.rejects(
      drawer.reviewCashierShiftClose(shiftF, { decision: 'reject', note: 'قصير' }, manager2),
      (err: unknown) => codeOf(err) === 'SHIFT_REVIEW_NOTE_REQUIRED',
      'rejecting without a >=10-char reason must throw',
    );
    await drawer.reviewCashierShiftClose(shiftF, { decision: 'reject', note: 'الإقرار لا يطابق تقرير الماكينة إطلاقا' }, manager2);
    const rowF = await shiftRow(shiftF);
    assert.equal(rowF.status, 'open', 'a rejected close reopens the shift');
    assert.equal(await journalCount(), journalsBefore, 'a rejection must post no variance journal');
    assert.ok(String(rowF.close_note || '').includes('الإقرار لا يطابق'), 'the rejection reason must be stamped on the shift');

    // Detail totals are reconciled too: declared 0 with 50.000 of itemised
    // card details is a mismatch even though computed card is also 0.
    await drawer.closeCashierShift(shiftF, { countedCash: 100, cardDeclaredTotal: 0, cardOperationCount: 0, cardDetails: [{ amount: 50 }], managerPin: 'pw-cashier-3' }, cashier3);
    assert.equal((await shiftRow(shiftF)).status, 'pending_review');
    await assert.rejects(
      drawer.reviewCashierShiftClose(shiftF, { decision: 'approve', note: '' }, manager2),
      (err: unknown) => codeOf(err) === 'SHIFT_REVIEW_NOTE_REQUIRED',
      'a detail-total mismatch must demand a review note even with zero declared/computed deltas',
    );
    await drawer.reviewCashierShiftClose(shiftF, { decision: 'approve', note: 'تفاصيل البطاقة سجلت بالخطأ وستصحح' }, manager2);
    assert.equal((await shiftRow(shiftF)).status, 'closed');

    // Clean approve: zero deltas close with a short note and no journal.
    await drawer.openCashierShift({ openingCash: 100, branchId: 1 }, cashier3);
    const shiftG = await shiftIdOf(3);
    await drawer.closeCashierShift(shiftG, { countedCash: 100, managerPin: 'pw-cashier-3' }, cashier3);
    await drawer.reviewCashierShiftClose(shiftG, { decision: 'approve', note: 'مطابق' }, manager2);
    assert.equal((await shiftRow(shiftG)).status, 'closed');

    // ---------- I23: the setting-aware sale gate (small service only). ----------
    const noShiftFalse = await authz.hasOpenCashierShiftForSale(db, admin1, null, new Map([['requireCashierShiftForSales', false]]));
    assert.equal(noShiftFalse, true, 'setting false + no shift must let the sale through');
    const noShiftTrue = await authz.hasOpenCashierShiftForSale(db, admin1, null, new Map([['requireCashierShiftForSales', true]]));
    assert.equal(noShiftTrue, false, 'setting true + no shift must block');
    const noShiftMissing = await authz.hasOpenCashierShiftForSale(db, admin1, null, new Map());
    assert.equal(noShiftMissing, false, 'a missing setting must fail closed to demanding a shift');
    await drawer.openCashierShift({ openingCash: 50 }, admin1);
    const withShift = await authz.hasOpenCashierShiftForSale(db, admin1, null, new Map([['requireCashierShiftForSales', true]]));
    assert.equal(withShift, true, 'setting true + an open shift must pass');
    const openShiftId = await shiftIdOf(1);
    await drawer.closeCashierShift(openShiftId, { countedCash: 50, managerPin: 'pw-admin-1' }, admin1);

    // ---------- I24: terminal identity. ----------
    await drawer.openCashierShift({ openingCash: 100, branchId: 1, terminalCode: 'T1' }, admin1);
    const shiftH = await shiftIdOf(1);
    await drawer.openCashierShift({ openingCash: 200, branchId: 1, terminalCode: 'T2' }, manager2);
    const shiftI = await shiftIdOf(2);
    await assert.rejects(
      drawer.openCashierShift({ openingCash: 10, branchId: 1, terminalCode: 'T1' }, admin4),
      (err: unknown) => codeOf(err) === 'SHIFT_TERMINAL_OCCUPIED',
      'a second open on the same branch+terminal must throw',
    );
    await pg.query(`INSERT INTO sales(id,tenant_id,account_id,table_number,order_type,status,payment_type,payment_channel,total,paid_amount,branch_id,created_by,created_at,pos_terminal_code)
      VALUES (10,'t1','a1','','takeaway','posted','cash','cash',50,50,1,3,now(),'T1')`);
    const expectedH = await drawer.computeShiftExpectedCash(shiftH, admin1);
    const expectedI = await drawer.computeShiftExpectedCash(shiftI, manager2);
    assert.equal(expectedH, 150, 'a third login sale on terminal T1 must land in shift A (100 + 50)');
    assert.equal(expectedI, 200, 'the same sale must not land in shift B (T2)');

    // ---------- I25: collections + cancelled cash in the hydrated row. ----------
    await pg.query(`INSERT INTO customer_payments(id,tenant_id,account_id,amount,payment_channel,created_by,created_at,branch_id)
      VALUES (1,'t1','a1',30,'cash',1,now(),NULL)`);
    await pg.query(`INSERT INTO sales(id,tenant_id,account_id,table_number,order_type,status,payment_type,payment_channel,total,paid_amount,branch_id,created_by,created_at)
      VALUES (11,'t1','a1','','takeaway','cancelled','cash','cash',20,20,NULL,1,now())`);
    const expectedH2 = await drawer.computeShiftExpectedCash(shiftH, admin1);
    assert.equal(expectedH2, 200, 'shift A expected cash must now include the 30 collection and the 20 cancelled-sale cash (150 + 30 + 20)');
    const listing = await drawer.listCashierShifts({}, admin1) as { cashierShifts: Array<Record<string, unknown>> };
    const rowH = listing.cashierShifts.find((row) => String(row.id) === String(shiftH));
    assert.equal(Number(rowH?.customerCollectionsTotal || 0), 30, 'the hydrated row must expose customerCollectionsTotal');
    assert.equal(Number(rowH?.cancelledSaleCashTotal || 0), 20, 'the hydrated row must expose cancelledSaleCashTotal');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
