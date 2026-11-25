/*
 * INV-SOLO-ADMIN-TRANSFER-SHORTAGE-OVERRIDE: the shortfall gate in
 * `receiveStockTransfer` (inventory-transfer.service.ts) required
 * approval by a DIFFERENT admin user than the receiver, verified
 * through authorizeManagerSecret: the shared manager PIN was
 * rejected (no identity) and the receiver's own password was
 * rejected (TRANSFER_SHORTAGE_SELF_APPROVAL). In a shop with only
 * ONE admin that gate is unsatisfiable when the solo admin IS the
 * receiver: nobody else exists to approve the shortfall, so the
 * receipt is refused forever and the goods sit stranded in transit.
 *
 * WHAT THIS PINS (drives the real InventoryTransferService against
 * a minimal PGlite harness, reusing the
 * transfer-receipt-shortage-approval schema):
 * - A solo admin receiver with a valid (>= 8-char) reason and NO
 *   approval secret accepts the shortfall: the transfer becomes
 *   `received`, the shrinkage posts, and the override is LOGGED,
 *   never silent — the audit log names the receiver, the total
 *   shortfall amount and the reason, and states that no second
 *   admin was available; the shrinkage movement note carries the
 *   same override stamp. The variance_reason stays the pure reason.
 * - The reason stays mandatory: a solo admin with a short reason
 *   and no secret is still refused with
 *   TRANSFER_SHORTAGE_REASON_REQUIRED.
 * - The override is NOT a self-approval loophole: a solo admin who
 *   supplies their OWN password as the approval secret is still
 *   refused with TRANSFER_SHORTAGE_SELF_APPROVAL (P3 precedent: a
 *   supplied secret must still differ; the override path takes no
 *   secret at all).
 * - The shared manager PIN still cannot satisfy the gate: a solo
 *   admin supplying only the PIN is still refused with
 *   TRANSFER_SHORTAGE_APPROVAL_REQUIRED.
 * - A non-admin receiver can never use the override: a cashier
 *   receiving with no secret is still refused with
 *   TRANSFER_SHORTAGE_APPROVAL_REQUIRED, even when the tenant's
 *   only admin is someone else.
 * - When a second active admin EXISTS, no second approval is
 *   required either (INV-SECOND-MANAGER-PASSWORD-REMOVED): the receiver with
 *   no secret accepts alone, stamped the same way. The receiver's
 *   own password as the approval secret is still refused with
 *   TRANSFER_SHORTAGE_SELF_APPROVAL — the override path takes no
 *   secret at all, and a supplied secret must still differ.
 * - A different admin approving works as before, with NO override
 *   stamp in the audit log or the shrinkage movement note.
 * - An INACTIVE second admin changes nothing either: the admin may
 *   accept alone, stamped, whether or not a second admin exists.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuditService } from '../../src/core/audit/audit.service';
import { InventoryScopeService } from '../../src/modules/inventory/services/inventory-scope.service';
import { IdempotencyService } from '../../src/core/idempotency/idempotency.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { InventoryTransferService } from '../../src/modules/inventory/services/inventory-transfer.service';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';
import { hashManagerPin } from '../../src/common/utils/manager-approval';

const RECEIVER_PASSWORD = 'receiver-password';
const APPROVER_PASSWORD = 'approver-password';
const MANAGER_PIN = '2468';
const REASON = 'Two units lost in transit';
const AUTH = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'admin',
  userId: 1,
  username: 'admin',
  permissions: ['canAdjustInventory'],
} as unknown as AuthContext;
const CASHIER_AUTH = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'cashier',
  userId: 3,
  username: 'cashier',
  permissions: ['canAdjustInventory'],
} as unknown as AuthContext;

async function seedProduct(db: Kysely<Database>, id: number, qty: number, cost: number): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, is_active, track_serials) VALUES (${id}, 't1', 'a1', ${`Product ${id}`}, ${qty}, 0, ${cost}, true, false)`.execute(
    db,
  );
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', ${id}, 1, 1, ${qty}, 0)`.execute(
    db,
  );
}

async function makeTransfer(
  service: InventoryTransferService,
  items: Array<{ productId: number; qty: number }>,
): Promise<number> {
  const res = (await service.createStockTransfer({ fromLocationId: 1, toLocationId: 2, items } as never, AUTH)) as any;
  return Number(res.transferId);
}

async function transferItemId(db: Kysely<Database>, transferId: number, productId: number): Promise<number> {
  const row = await sql<{
    id: number;
  }>`SELECT id FROM stock_transfer_items WHERE transfer_id = ${transferId} AND product_id = ${productId}`.execute(db);
  return Number(row.rows[0].id);
}

async function transferStatus(db: Kysely<Database>, transferId: number): Promise<string> {
  const row = await sql<{ status: string }>`SELECT status FROM stock_transfers WHERE id = ${transferId}`.execute(db);
  return row.rows[0].status;
}

async function lossCount(db: Kysely<Database>, transferId: number): Promise<number> {
  const row = await sql<{
    n: string;
  }>`SELECT COUNT(*) AS n FROM stock_movements WHERE reference_id = ${transferId} AND movement_type = 'transfer_transit_loss'`.execute(
    db,
  );
  return Number(row.rows[0].n);
}

async function latestAuditDetails(db: Kysely<Database>): Promise<string> {
  const row = await sql<{
    details: string;
  }>`SELECT details FROM audit_logs WHERE action = 'استلام تحويل مخزون' ORDER BY id DESC LIMIT 1`.execute(db);
  return row.rows.length ? String(row.rows[0].details) : '';
}

async function lossNote(db: Kysely<Database>, transferId: number): Promise<string> {
  const row = await sql<{
    note: string;
  }>`SELECT note FROM stock_movements WHERE reference_id = ${transferId} AND movement_type = 'transfer_transit_loss'`.execute(
    db,
  );
  return row.rows.length ? String(row.rows[0].note) : '';
}

async function itemReason(db: Kysely<Database>, itemId: number): Promise<string> {
  const row = await sql<{
    variance_reason: string;
  }>`SELECT variance_reason FROM stock_transfer_items WHERE id = ${itemId}`.execute(db);
  return String(row.rows[0].variance_reason);
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const service = new InventoryTransferService(
    db as never,
    new TransactionHelper(),
    new AuditService(db as never),
    new InventoryScopeService(db as never),
    { check: async () => null } as unknown as IdempotencyService,
    posting,
  );

  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY);
      INSERT INTO tenants VALUES ('t1');
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      INSERT INTO settings VALUES ('t1','currency','EGP');
      INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset', account_group text DEFAULT '', is_active boolean DEFAULT true, is_tax boolean DEFAULT false);
      INSERT INTO accounting_accounts (id, tenant_id, code, account_type) VALUES (1140,'t1','1140','asset'), (5200,'t1','5200','expense'), (5300,'t1','5300','expense'), (6900,'t1','6900','expense'), (7100,'t1','7100','revenue');
      CREATE TABLE accounting_settings (id bigint, tenant_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      INSERT INTO accounting_settings VALUES (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
      CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text, period_number int, start_date date, end_date date);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, dedup_key text, cash_flow_category text);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint, tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
      CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, default_stock_location_id bigint);
      INSERT INTO branches VALUES (1, 't1', 'Main', 1), (2, 't1', 'Dest', 2);
      CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
      INSERT INTO stock_locations VALUES (1, 't1', 'a1', 1, 'Main Store', 'MAIN', true, 'branch_stock'), (2, 't1', 'a1', 2, 'Dest Store', 'DEST', true, 'branch_stock');
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_transfers (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, from_location_id bigint, to_location_id bigint, from_branch_id bigint, to_branch_id bigint, status text, note text, recipient_name text, created_by bigint, received_by bigint, received_at timestamptz, cancelled_by bigint, cancelled_at timestamptz, has_transit_variance boolean, transit_variance_journal_entry_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE stock_transfer_items (id bigserial PRIMARY KEY, transfer_id bigint, tenant_id text, account_id text, product_id bigint, product_name text, qty numeric, dispatched_qty numeric, received_qty numeric, variance_qty numeric, variance_reason text, serial_tracking text, batch_tracking text);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, branch_id bigint, location_id bigint, cost_price numeric, purchase_id bigint, purchase_item_id bigint, sale_id bigint, sale_item_id bigint, warranty_end_date date, notes text, updated_at timestamptz);
      CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number text, expiry_date text, quantity numeric, unit_cost numeric, location_id bigint, supplier_name text, status text, notes text, updated_at timestamptz);
      CREATE TABLE pharmacy_drugs (id bigserial PRIMARY KEY, tenant_id text, product_id bigint);
      CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, status text, remaining_quantity numeric, location_id bigint, receipt_date date, created_at timestamptz DEFAULT NOW());
      SELECT setval(pg_get_serial_sequence('stock_locations', 'id'), 100);
      SELECT setval(pg_get_serial_sequence('stock_transfers', 'id'), 100);
    `);

    // Phase A: SOLO admin — the users table holds ONLY the receiver
    // (user 1, admin) plus a cashier (user 3). No second admin exists.
    const receiverRecord = await createPasswordRecord(RECEIVER_PASSWORD);
    const approverRecord = await createPasswordRecord(APPROVER_PASSWORD);
    const cashierRecord = await createPasswordRecord('cashier-password');
    await sql`INSERT INTO users VALUES (1, 't1', 'admin', 1, 'admin', ${receiverRecord.hash}, ${receiverRecord.salt}, true)`.execute(
      db,
    );
    await sql`INSERT INTO users VALUES (3, 't1', 'cashier', 1, 'cashier', ${cashierRecord.hash}, ${cashierRecord.salt}, true)`.execute(
      db,
    );
    const pinHash = await hashManagerPin(MANAGER_PIN);
    await sql`INSERT INTO settings VALUES ('t1', 'managerPin', ${JSON.stringify(pinHash)})`.execute(db);

    // Case A1: solo admin receiver, valid reason, NO approval secret ->
    // accepted, with the override logged in the audit trail and in the
    // shrinkage movement note; the reason stays the pure reason.
    await seedProduct(db, 1, 100, 10);
    const t1 = await makeTransfer(service, [{ productId: 1, qty: 10 }]);
    const t1item = await transferItemId(db, t1, 1);
    await service.receiveStockTransfer(t1, AUTH, {
      items: [{ itemId: t1item, receivedQty: 8 }],
      varianceReason: REASON,
    } as never);
    assert.equal(await transferStatus(db, t1), 'received');
    assert.equal(await lossCount(db, t1), 1);
    assert.equal(await itemReason(db, t1item), REASON);
    const audit1 = await latestAuditDetails(db);
    assert.ok(audit1.includes('اعتماد فاقد منفرد بقرار إداري'), 'audit log must carry the solo-override stamp');
    assert.ok(audit1.includes('admin'), 'audit log must name the receiver');
    assert.ok(audit1.includes('بفاقد 2'), 'audit log must record the shortfall amount');
    assert.ok(audit1.includes(REASON), 'audit log must record the reason');
    assert.ok(!audit1.includes('ثانٍ'), 'audit log must carry no second-manager reference at all');
    const note1 = await lossNote(db, t1);
    assert.ok(note1.includes('اعتماد منفرد بقرار إداري'), 'shrinkage note must carry the solo-override stamp');
    assert.ok(note1.includes('المستلم admin'), 'shrinkage note must name the receiver');

    // Case A2: solo admin supplying their OWN password as the approval
    // secret is still refused — the override takes no secret at all,
    // and a supplied secret must still differ (P3 precedent).
    await seedProduct(db, 2, 100, 10);
    const t2 = await makeTransfer(service, [{ productId: 2, qty: 10 }]);
    const t2item = await transferItemId(db, t2, 2);
    await assert.rejects(
      service.receiveStockTransfer(t2, AUTH, {
        items: [{ itemId: t2item, receivedQty: 8 }],
        varianceReason: REASON,
        approvalSecret: RECEIVER_PASSWORD,
      } as never),
      /TRANSFER_SHORTAGE_SELF_APPROVAL/,
    );
    assert.equal(await transferStatus(db, t2), 'sent');
    assert.equal(await lossCount(db, t2), 0);

    // Case A3: solo admin with a short reason and no secret is still
    // refused — the >= 8-char reason is a real control that stays.
    await assert.rejects(
      service.receiveStockTransfer(t2, AUTH, {
        items: [{ itemId: t2item, receivedQty: 8 }],
        varianceReason: 'lost',
      } as never),
      /TRANSFER_SHORTAGE_REASON_REQUIRED/,
    );
    assert.equal(await transferStatus(db, t2), 'sent');
    assert.equal(await lossCount(db, t2), 0);

    // Case A4: the shared manager PIN still cannot satisfy the gate,
    // even for a solo admin — the PIN identifies no approver.
    await assert.rejects(
      service.receiveStockTransfer(t2, AUTH, {
        items: [{ itemId: t2item, receivedQty: 8 }],
        varianceReason: REASON,
        approvalSecret: MANAGER_PIN,
      } as never),
      /TRANSFER_SHORTAGE_APPROVAL_REQUIRED/,
    );
    assert.equal(await transferStatus(db, t2), 'sent');
    assert.equal(await lossCount(db, t2), 0);

    // Case A5: a non-admin receiver can never use the override — a
    // cashier receiving with no secret is still refused.
    await assert.rejects(
      service.receiveStockTransfer(t2, CASHIER_AUTH, {
        items: [{ itemId: t2item, receivedQty: 8 }],
        varianceReason: REASON,
      } as never),
      /TRANSFER_SHORTAGE_APPROVAL_REQUIRED/,
    );
    assert.equal(await transferStatus(db, t2), 'sent');
    assert.equal(await lossCount(db, t2), 0);

    // Phase B: a SECOND active admin exists — no second approval is
    // required either (INV-SECOND-MANAGER-PASSWORD-REMOVED).
    await sql`INSERT INTO users VALUES (2, 't1', 'approver', 1, 'admin', ${approverRecord.hash}, ${approverRecord.salt}, true)`.execute(
      db,
    );

    // Case B1: supplying your OWN password as the approval secret is
    // still refused — the override takes no secret at all, and a
    // supplied secret must still differ (P3 precedent).
    await assert.rejects(
      service.receiveStockTransfer(t2, AUTH, {
        items: [{ itemId: t2item, receivedQty: 8 }],
        varianceReason: REASON,
        approvalSecret: RECEIVER_PASSWORD,
      } as never),
      /TRANSFER_SHORTAGE_SELF_APPROVAL/,
    );
    assert.equal(await transferStatus(db, t2), 'sent');
    assert.equal(await lossCount(db, t2), 0);

    // Case B2: no secret is now accepted even when a second admin
    // exists — the admin accepts alone, stamped the same way as A1.
    await service.receiveStockTransfer(t2, AUTH, {
      items: [{ itemId: t2item, receivedQty: 8 }],
      varianceReason: REASON,
    } as never);
    assert.equal(await transferStatus(db, t2), 'received');
    assert.equal(await lossCount(db, t2), 1);
    assert.equal(await itemReason(db, t2item), REASON);
    const auditB2 = await latestAuditDetails(db);
    assert.ok(auditB2.includes('اعتماد فاقد منفرد بقرار إداري'), 'audit log must carry the solo-override stamp');
    assert.ok(auditB2.includes('admin'), 'audit log must name the receiver');
    assert.ok(auditB2.includes('بفاقد 2'), 'audit log must record the shortfall amount');
    assert.ok(auditB2.includes(REASON), 'audit log must record the reason');
    assert.ok(!auditB2.includes('ثانٍ'), 'audit log must carry no second-manager reference at all');
    const noteB2 = await lossNote(db, t2);
    assert.ok(noteB2.includes('اعتماد منفرد بقرار إداري'), 'shrinkage note must carry the solo-override stamp');
    assert.ok(noteB2.includes('المستلم admin'), 'shrinkage note must name the receiver');

    // Case B3: a DIFFERENT admin approving works as before, with NO
    // override stamp in the audit log or the shrinkage note. (A fresh
    // transfer: B2 already received t2.)
    await seedProduct(db, 4, 100, 10);
    const t2b = await makeTransfer(service, [{ productId: 4, qty: 10 }]);
    const t2bitem = await transferItemId(db, t2b, 4);
    await service.receiveStockTransfer(t2b, AUTH, {
      items: [{ itemId: t2bitem, receivedQty: 8 }],
      varianceReason: REASON,
      approvalSecret: APPROVER_PASSWORD,
    } as never);
    assert.equal(await transferStatus(db, t2b), 'received');
    assert.equal(await lossCount(db, t2b), 1);
    assert.equal(await itemReason(db, t2bitem), REASON);
    const audit2 = await latestAuditDetails(db);
    assert.ok(!audit2.includes('اعتماد فاقد منفرد'), 'the two-admin path must carry no override stamp');
    assert.ok(
      !(await lossNote(db, t2b)).includes('اعتماد منفرد'),
      'the two-admin shrinkage note must carry no override stamp',
    );

    // Case B4: an INACTIVE second admin changes nothing — the admin
    // may accept alone, stamped (as before, and as with an active
    // second admin since INV-SECOND-MANAGER-PASSWORD-REMOVED).
    await sql`UPDATE users SET is_active = false WHERE id = 2`.execute(db);
    await seedProduct(db, 3, 100, 10);
    const t3 = await makeTransfer(service, [{ productId: 3, qty: 10 }]);
    const t3item = await transferItemId(db, t3, 3);
    await service.receiveStockTransfer(t3, AUTH, {
      items: [{ itemId: t3item, receivedQty: 7 }],
      varianceReason: REASON,
    } as never);
    assert.equal(await transferStatus(db, t3), 'received');
    assert.equal(await lossCount(db, t3), 1);
    const audit3 = await latestAuditDetails(db);
    assert.ok(audit3.includes('اعتماد فاقد منفرد بقرار إداري'), 'audit log must carry the solo-override stamp again');
    assert.ok(audit3.includes('بفاقد 3'), 'audit log must record the shortfall amount');
    assert.ok(audit3.includes(REASON), 'audit log must record the reason');

    // ---------- Wiring: this spec is in both critical lists, in identical order (350 specs — the api-versioning spec is the last entry). ----------
    {
      const specs = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
        .specs as string[];
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
      const serial = String(pkg.scripts['test:critical:serial']);
      const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
      assert.equal(specs.length, 350);
      assert.equal(chain.length, 350);
      assert.deepEqual(chain, specs);
      assert.ok(specs.includes('test/critical/solo-admin-transfer-shortage-override.spec.ts'));
      console.log('wiring: evidence spec in both critical lists (350 = 350, identical order), passed');
    }

    console.log('Solo-admin transfer shortage override tests passed');
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
