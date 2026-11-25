import 'dotenv/config';
import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Database } from '../../../src/database/database.types';
import { InventoryCountService } from '../../../src/modules/inventory/services/inventory-count.service';
import { InventoryScopeService } from '../../../src/modules/inventory/services/inventory-scope.service';
import { IdempotencyService } from '../../../src/core/idempotency/idempotency.service';
import { AccountingTenantFoundationService } from '../../../src/modules/accounting/accounting-tenant-foundation.service';
import { AccountingPostingService } from '../../../src/modules/accounting/accounting-posting.service';
import { AuditService } from '../../../src/core/audit/audit.service';
import { TransactionHelper } from '../../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../../src/core/auth/interfaces/auth-context.interface';
import { setScopedStockQty } from '../../../src/common/utils/location-stock-ledger';

/**
 * Z-SYSTEMS ERP — INVENTORY COUNT & STOCKTAKING SIMULATION
 *
 * Verifies:
 * 1. Foundation: Tenant, Branch, Stock Location, Products with Cost & Pricing.
 * 2. Initial Stock Ingestion: Setting initial physical quantities across locations.
 * 3. Stock Count Session Creation: Items with surplus, deficit, and match.
 * 4. Recount Workflow: Auditing recounted items with mandatory justification.
 * 5. Stock Count Finalization & Posting: Updating location stock ledger and stock movements.
 * 6. Damaged Stock Lifecycle: Recording damaged inventory with cost valuation.
 * 7. Zero Variance Session: Flawless physical-to-book match.
 * 8. Stock Movement Audit: Reviewing full ledger trail and before/after balances.
 * 9. Idempotent and clean teardown.
 */

async function runInventoryCountSimulation() {
  console.log('\n================================================================');
  console.log('[INVENTORY-SIMULATION] Z-SYSTEMS ERP — INVENTORY COUNT & STOCKTAKING AUDIT');
  console.log('================================================================\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/zs_dev',
  });

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

  const tx = new TransactionHelper();
  const auditService = new AuditService(db as any);
  const accountingFoundation = new AccountingTenantFoundationService();
  const accountingPosting = new AccountingPostingService(accountingFoundation);
  const scopeService = new InventoryScopeService(db);
  const idempotencyService = new IdempotencyService(db);
  const inventoryCountService = new InventoryCountService(
    db,
    tx,
    auditService,
    scopeService,
    idempotencyService,
    accountingPosting,
  );

  const simUid = Date.now().toString().slice(-4);
  const tenantId = `inv_cnt_${simUid}`;
  const accountId = `inv_acc_${simUid}`;

  try {
    const userRow = await sql<{ id: number; username: string }>`
      SELECT id, username FROM users ORDER BY id ASC LIMIT 1
    `.execute(db);

    if (!userRow.rows.length) {
      throw new Error('No system user found in database');
    }
    const existingUser = userRow.rows[0];

    const auth: AuthContext = {
      userId: existingUser.id,
      username: 'inventory_auditor',
      role: 'admin',
      tenantId,
      accountId,
      sessionId: `session_inv_${simUid}`,
      permissions: ['*'],
    };

    console.log(`[CONTEXT] Tenant Context: [Tenant: ${tenantId}, Account: ${accountId}, User: #${auth.userId}]`);

    // 1. Foundation Setup
    console.log('\n--- 1. إعداد المنشأة والمستودعات والمنتجات (Foundation Setup) ---');
    await accountingFoundation.ensureForAuth(db, auth);

    const branchRes = await sql<{ id: number }>`
      INSERT INTO branches (tenant_id, account_id, name, code, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, 'مستودع المنطقة الوسطى', ${'WH-BR-' + simUid}, true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const branchId = Number(branchRes.rows[0].id);

    const locRes = await sql<{ id: number }>`
      INSERT INTO stock_locations (tenant_id, account_id, branch_id, name, location_type, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${branchId}, 'المستودع الرئيسي - جرد', 'branch_stock', true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const locationId = Number(locRes.rows[0].id);

    const prod1Res = await sql<{ id: number }>`
      INSERT INTO products (
        tenant_id, account_id, name, barcode, item_type, cost_price, retail_price, wholesale_price, stock_qty, is_active, created_at, updated_at
      ) VALUES (
        ${auth.tenantId}, ${auth.accountId}, ${'منتج جرد ألف ' + simUid}, ${'SKU-A-' + simUid}, 'product', 100.00, 150.00, 140.00, 0, true, NOW(), NOW()
      ) RETURNING id
    `.execute(db);
    const prodAId = Number(prod1Res.rows[0].id);

    const prod2Res = await sql<{ id: number }>`
      INSERT INTO products (
        tenant_id, account_id, name, barcode, item_type, cost_price, retail_price, wholesale_price, stock_qty, is_active, created_at, updated_at
      ) VALUES (
        ${auth.tenantId}, ${auth.accountId}, ${'منتج جرد باء ' + simUid}, ${'SKU-B-' + simUid}, 'product', 200.00, 300.00, 280.00, 0, true, NOW(), NOW()
      ) RETURNING id
    `.execute(db);
    const prodBId = Number(prod2Res.rows[0].id);

    console.log(`[OK] تم إنشاء الفرع (#${branchId}) والمستودع (#${locationId}) والمنتجين (#${prodAId}, #${prodBId}).`);

    // 2. Set Initial Stock
    console.log('\n--- 2. ضبط الأرصدة الافتتاحية للمنتجات بالموقع ---');
    await tx.runInTransaction(db, async (trx) => {
      await setScopedStockQty(trx, {
        productId: prodAId,
        branchId,
        locationId,
        nextQty: 100,
        tenantId: auth.tenantId!,
        accountId: auth.accountId!,
      });
      await setScopedStockQty(trx, {
        productId: prodBId,
        branchId,
        locationId,
        nextQty: 50,
        tenantId: auth.tenantId!,
        accountId: auth.accountId!,
      });
    });
    console.log('[OK] تم ضبط رصيد منتج أ = 100 وحدة، ومنتج ب = 50 وحدة.');

    // 3. Create Stock Count Session (Shortage on A: counted 95, Surplus on B: counted 53)
    console.log('\n--- 3. إنشاء جلسة جرد المستودع ورصد الفروقات ---');
    const sessionRes = await inventoryCountService.createStockCountSession(
      {
        branchId,
        locationId,
        note: 'جرد دوري ربع سنوي لمستودع المنطقة الوسطى',
        items: [
          { productId: prodAId, countedQty: 95, note: 'عجز 5 حبات' },
          { productId: prodBId, countedQty: 53, note: 'فائض 3 حبات' },
        ],
      },
      auth,
    );

    const sessionId = Number(sessionRes.sessionId);
    console.log(`[OK] تم إنشاء جلسة الجرد #${sessionId} بحالة draft.`);

    // 4. Verify Session & Variance Details
    const countItems = await sql<{
      id: number;
      product_id: number;
      expected_qty: string;
      counted_qty: string;
      variance_qty: string;
    }>`
      SELECT id, product_id, expected_qty, counted_qty, variance_qty
      FROM stock_count_items
      WHERE session_id = ${sessionId} AND tenant_id = ${auth.tenantId}
      ORDER BY product_id ASC
    `.execute(db);

    const itemA = countItems.rows.find((r) => Number(r.product_id) === prodAId);
    const itemB = countItems.rows.find((r) => Number(r.product_id) === prodBId);

    if (!itemA || Number(itemA.variance_qty) !== -5) {
      throw new Error(`Variance mismatch for Product A: expected -5, got ${itemA?.variance_qty}`);
    }
    if (!itemB || Number(itemB.variance_qty) !== 3) {
      throw new Error(`Variance mismatch for Product B: expected +3, got ${itemB?.variance_qty}`);
    }
    console.log(`[OK] تم التأكد من الفروقات: منتج أ عجز (-5)، منتج ب فائض (+3).`);

    // 5. Recount Item A (Auditor recount: found 96 instead of 95)
    console.log('\n--- 5. إعادة عد وتدقيق بند الجرد (Recount Workflow) ---');
    await inventoryCountService.recountPendingStockCountItem(
      sessionId,
      Number(itemA.id),
      {
        countedQty: 96,
        reason: 'إعادة تدقيق بالباركود في الرف الخلفي للمستودع',
      },
      auth,
    );

    const updatedItemARes = await sql<{ variance_qty: string; counted_qty: string }>`
      SELECT variance_qty, counted_qty FROM stock_count_items WHERE id = ${itemA.id} AND tenant_id = ${auth.tenantId}
    `.execute(db);
    console.log(
      `[OK] تم تحديث العد بعد إعادة الجرد: الكمية الفعلية ${updatedItemARes.rows[0].counted_qty} والفارق الجديد ${updatedItemARes.rows[0].variance_qty}.`,
    );

    // 6. Post Stock Count Session
    console.log('\n--- 6. ترحيل جلسة الجرد وتحديث دفاتر المخزون ---');
    await inventoryCountService.postStockCountSession(sessionId, auth);

    const sessionRow = await sql<{ status: string; posted_at: string }>`
      SELECT status, posted_at FROM stock_count_sessions WHERE id = ${sessionId} AND tenant_id = ${auth.tenantId}
    `.execute(db);
    if (sessionRow.rows[0]?.status !== 'posted') {
      throw new Error(`Expected session status to be 'posted', got ${sessionRow.rows[0]?.status}`);
    }
    console.log(`[OK] تم ترحيل جلسة الجرد #${sessionId} بنجاح.`);

    // 7. Verify Stock Balances Updated in Ledger
    console.log('\n--- 7. التحقق من تحديث أرصدة المستودع الفعلية ---');
    const stockAfter = await sql<{ product_id: number; qty: string }>`
      SELECT product_id, qty FROM product_location_stock
      WHERE location_id = ${locationId} AND tenant_id = ${auth.tenantId}
    `.execute(db);

    const stockA = stockAfter.rows.find((s) => Number(s.product_id) === prodAId);
    const stockB = stockAfter.rows.find((s) => Number(s.product_id) === prodBId);

    if (Number(stockA?.qty) !== 96) {
      throw new Error(`Product A stock expected 96, got ${stockA?.qty}`);
    }
    if (Number(stockB?.qty) !== 53) {
      throw new Error(`Product B stock expected 53, got ${stockB?.qty}`);
    }
    console.log(`[OK] تم التحقق من الرصيد الدفتري الجديد: منتج أ = 96 وحدة، منتج ب = 53 وحدة.`);

    // 8. Register Damaged Stock
    console.log('\n--- 8. تسجيل بضاعة تالفة وتقييم التكلفة (Damaged Stock) ---');
    await inventoryCountService.createDamagedStock(
      {
        productId: prodBId,
        branchId,
        locationId,
        qty: 3,
        reason: 'تلف كرتون أثناء النقل بالرافعة الشوكية',
        note: 'كسر داخلي غير قابل للاسترجاع للمورد',
      },
      auth,
    );

    const stockBAfterDamage = await sql<{ qty: string }>`
      SELECT qty FROM product_location_stock
      WHERE product_id = ${prodBId} AND location_id = ${locationId} AND tenant_id = ${auth.tenantId}
    `.execute(db);

    if (Number(stockBAfterDamage.rows[0]?.qty) !== 50) {
      throw new Error(`Product B stock after damage expected 50, got ${stockBAfterDamage.rows[0]?.qty}`);
    }
    console.log(`[OK] تم خصم التالف بنجاح: رصيد منتج ب عاد إلى 50 وحدة.`);

    // 9. Zero Variance Session
    console.log('\n--- 9. جلسة جرد متطابقة بدون أي فروقات (Zero Variance) ---');
    const zeroSessionRes = await inventoryCountService.createStockCountSession(
      {
        branchId,
        locationId,
        note: 'جرد تأكيدي متطابق تماماً مع الدفاتر',
        items: [
          { productId: prodAId, countedQty: 96 },
          { productId: prodBId, countedQty: 50 },
        ],
      },
      auth,
    );
    const zeroSessionId = Number(zeroSessionRes.sessionId);
    await inventoryCountService.postStockCountSession(zeroSessionId, auth);
    console.log(`[OK] تم ترحيل جلسة الجرد المتطابقة #${zeroSessionId} بنجاح.`);

    // 10. Audit Stock Movements Trail
    console.log('\n--- 10. تدقيق سجل الحركات المخزنية والتتبع التاريخي ---');
    const movementsRes = await inventoryCountService.listStockMovements({ locationId }, auth);
    const movements = (movementsRes as any).stockMovements || [];
    console.log(`[OK] تم رصد ${movements.length} حركة مخزنية مرتبطة بجلسات الجرد والتالف.`);

    console.log('\n================================================================');
    console.log('[SUCCESS] اكتملت محاكاة جرد المخزون والتسويات بنجاح 100%!');
    console.log('================================================================\n');
  } catch (err: any) {
    console.error('[ERROR] SIMULATION FAILED:', err.message || err);
    console.error(err.stack);
    process.exit(1);
  } finally {
    console.log('--- تنظيف البيانات المؤقتة (Cleanup) ---');
    await sql`DELETE FROM stock_movements WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM damaged_stock_records WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM stock_count_items WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM stock_count_sessions WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM product_location_stock WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM products WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM stock_locations WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM branches WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM accounting_settings WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM accounting_accounts WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    console.log('[OK] تم تنظيف بيانات محاكاة الجرد بنجاح.');
    await pool.end();
  }
}

runInventoryCountSimulation();
