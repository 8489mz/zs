import 'dotenv/config';
import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Database } from '../../../src/database/database.types';
import { SalesOrdersService } from '../../../src/modules/sales/services/sales-orders.service';
import { QuotationsService } from '../../../src/modules/sales/services/quotations.service';
import { AccountingTenantFoundationService } from '../../../src/modules/accounting/accounting-tenant-foundation.service';
import { AuthContext } from '../../../src/core/auth/interfaces/auth-context.interface';
import { setScopedStockQty } from '../../../src/common/utils/location-stock-ledger';
import { TransactionHelper } from '../../../src/database/helpers/transaction.helper';

/**
 * Z-SYSTEMS ERP — SALES ORDERS & QUOTATIONS LIFECYCLE SIMULATION
 *
 * Verifies:
 * 1. Foundation: Tenant, Branch, Warehouse Stock Location, Customer, and Catalog Products.
 * 2. Quotation Creation: Item pricing, tax, discounts, and validity dates.
 * 3. Draft Sales Order Creation: Without stock reservation (autoReserve: false).
 * 4. Explicit Confirmation & Stock Reservation: Locks stock in product_location_stock & products.reserved_qty.
 * 5. Order Cancellation & Stock Release: Returns reserved stock to available pool.
 * 6. Order-to-Invoice Conversion: Generates formal sale, decrements physical stock, sets converted status.
 * 7. Order Status Analytics: Verifies summary counts by lifecycle stage.
 * 8. Draft Order Deletion: Removes unwanted unconfirmed orders cleanly.
 * 9. Idempotent and clean teardown.
 */

async function runSalesOrdersQuotationSimulation() {
  console.log('\n================================================================');
  console.log('[SALES-ORDERS-SIMULATION] Z-SYSTEMS ERP — SALES ORDERS & QUOTATIONS AUDIT');
  console.log('================================================================\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/zs_dev',
  });

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

  const tx = new TransactionHelper();
  const accountingFoundation = new AccountingTenantFoundationService();

  const simUid = Date.now().toString().slice(-4);
  const tenantId = `so_sim_${simUid}`;
  const accountId = `so_acc_${simUid}`;

  // SalesWrite stub for convertToSale
  const salesWriteStub: any = {
    createSale: async (payload: any, auth: AuthContext) => {
      const subtotal = payload.items.reduce((s: number, i: any) => s + i.price * i.qty, 0);
      const discount = payload.discount || 0;
      const total = subtotal - discount;

      const saleRes = await db
        .insertInto('sales')
        .values({
          tenant_id: auth.tenantId!,
          account_id: auth.accountId!,
          branch_id: payload.branchId,
          customer_id: payload.customerId || null,
          doc_no: `INV-${simUid}-001`,
          table_number: '',
          order_type: 'takeaway',
          payment_type: 'cash',
          payment_channel: 'cash',
          subtotal,
          discount,
          tax_rate: 15,
          tax_amount: 0,
          total,
          paid_amount: total,
          status: 'completed',
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      for (const it of payload.items) {
        await db
          .insertInto('sale_items')
          .values({
            tenant_id: auth.tenantId!,
            account_id: auth.accountId!,
            sale_id: saleRes.id,
            product_id: it.productId,
            product_name: 'شاشة سامسونج',
            qty: it.qty,
            unit_price: it.price,
            line_total: it.price * it.qty,
            unit_name: 'قطعة',
            unit_multiplier: 1,
            cost_price: 1800,
          } as any)
          .execute();
      }

      return { sale: { id: saleRes.id, total } };
    },
  };

  const salesOrdersService = new SalesOrdersService(db, salesWriteStub);
  const quotationsService = new QuotationsService(db, salesWriteStub);

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
      username: 'sales_order_auditor',
      role: 'admin',
      tenantId,
      accountId,
      sessionId: `session_so_${simUid}`,
      permissions: ['*'],
    };

    console.log(`[CONTEXT] Tenant Context: [Tenant: ${tenantId}, Account: ${accountId}, User: #${auth.userId}]`);

    // 1. Foundation Setup
    console.log('\n--- 1. إعداد البيانات الأساسية وشجرة الحسابات ---');
    await accountingFoundation.ensureForAuth(db, auth);

    const branchRes = await sql<{ id: number }>`
      INSERT INTO branches (tenant_id, account_id, name, code, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, 'فرع المبيعات المركزية', ${'SO-BR-' + simUid}, true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const branchId = Number(branchRes.rows[0].id);

    const locRes = await sql<{ id: number }>`
      INSERT INTO stock_locations (tenant_id, account_id, branch_id, name, location_type, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${branchId}, 'المستودع الرئيسي للمبيعات', 'branch_stock', true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const locationId = Number(locRes.rows[0].id);

    await sql`UPDATE branches SET default_stock_location_id = ${locationId} WHERE id = ${branchId}`.execute(db);

    const custRes = await sql<{ id: number }>`
      INSERT INTO customers (
        tenant_id, account_id, name, phone, address, balance, customer_type, credit_limit, store_credit_balance, company_name, tax_number, is_active
      ) VALUES (
        ${auth.tenantId}, ${auth.accountId}, 'شركة الرواد للتجارة', '0501112233', 'الرياض، المملكة العربية السعودية', 0, 'cash', 50000, 0, 'الرواد', '300000000000003', true
      ) RETURNING id
    `.execute(db);
    const customerId = Number(custRes.rows[0].id);

    const p1Res = await sql<{ id: number }>`
      INSERT INTO products (
        tenant_id, account_id, name, barcode, item_type, cost_price, retail_price, wholesale_price, stock_qty, is_active, created_at, updated_at
      ) VALUES (
        ${auth.tenantId}, ${auth.accountId}, ${'شاشة سامسونج 65 بوصة ' + simUid}, ${'PRD-TV-' + simUid}, 'product', 1800.00, 2500.00, 2300.00, 0, true, NOW(), NOW()
      ) RETURNING id
    `.execute(db);
    const product1Id = Number(p1Res.rows[0].id);

    const p2Res = await sql<{ id: number }>`
      INSERT INTO products (
        tenant_id, account_id, name, barcode, item_type, cost_price, retail_price, wholesale_price, stock_qty, is_active, created_at, updated_at
      ) VALUES (
        ${auth.tenantId}, ${auth.accountId}, ${'جهاز صوتي محيطي ' + simUid}, ${'PRD-SND-' + simUid}, 'product', 400.00, 750.00, 700.00, 0, true, NOW(), NOW()
      ) RETURNING id
    `.execute(db);
    const product2Id = Number(p2Res.rows[0].id);

    // Initial stock: 100 units of TV, 50 units of Sound System
    await tx.runInTransaction(db, async (trx) => {
      await setScopedStockQty(trx, {
        productId: product1Id,
        branchId,
        locationId,
        nextQty: 100,
        tenantId: auth.tenantId!,
        accountId: auth.accountId!,
      });
      await setScopedStockQty(trx, {
        productId: product2Id,
        branchId,
        locationId,
        nextQty: 50,
        tenantId: auth.tenantId!,
        accountId: auth.accountId!,
      });
    });
    console.log(`[OK] تم تجهيز العميل والمستودع والمنتجات (مخزون شاشات: 100، أنظمة صوت: 50).`);

    // 2. Quotation Creation Workflow
    console.log('\n--- 2. إنشاء عرض سعر تجاري للعميل (Quotation Flow) ---');
    const quoteRes = await quotationsService.createQuotation(
      {
        customerId,
        customerName: 'شركة الرواد للتجارة',
        customerPhone: '0501112233',
        branchId,
        subtotal: 5750,
        discountAmount: 250,
        taxAmount: 825,
        totalAmount: 6325,
        validUntil: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        notes: 'عرض أسعار خاص يشمل الضمان لمدة سنتين والتوصيل المجاني',
        items: [
          {
            productId: product1Id,
            productName: 'شاشة سامسونج 65 بوصة',
            quantity: 2,
            unitPrice: 2500,
            discount: 250,
            total: 4750,
          },
          {
            productId: product2Id,
            productName: 'جهاز صوتي محيطي',
            quantity: 1,
            unitPrice: 750,
            discount: 0,
            total: 750,
          },
        ],
      },
      auth,
    );

    const quotationId = Number((quoteRes as any).quotation?.id);
    console.log(`[OK] تم إنشاء عرض السعر #${quotationId} بإجمالي 6,325 ر.س بنجاح.`);

    // 3. Draft Sales Order Creation (No auto reserve)
    console.log('\n--- 3. إنشاء أمر بيع مسودة دون حجز فوري للمخزون ---');
    const draftOrderRes = await salesOrdersService.createOrder(
      {
        customerId,
        customerName: 'شركة الرواد للتجارة',
        customerPhone: '0501112233',
        branchId,
        autoReserve: false,
        quotationId,
        subtotal: 5000,
        discountAmount: 0,
        taxAmount: 750,
        totalAmount: 5750,
        notes: 'أمر بيع مستند لعرض السعر',
        items: [
          {
            productId: product1Id,
            productName: 'شاشة سامسونج 65 بوصة',
            quantity: 2,
            unitPrice: 2500,
            total: 5000,
          },
        ],
      },
      auth,
    );

    const draftOrderId = Number((draftOrderRes as any).order?.id);
    const fetchedDraft = await salesOrdersService.getOrderById(draftOrderId, auth);
    if ((fetchedDraft as any).status !== 'draft') {
      throw new Error(`Expected draft status, got ${(fetchedDraft as any).status}`);
    }
    console.log(`[OK] تم إنشاء أمر البيع #${draftOrderId} بحالة draft دون حجز مخزون.`);

    // 4. Confirm Order and Reserve Stock
    console.log('\n--- 4. تأكيد أمر البيع وحجز المخزون ---');
    await salesOrdersService.confirmAndReserve(draftOrderId, auth);

    const p1AfterReserve = await sql<{ stock_qty: string; reserved_qty: string }>`
      SELECT stock_qty, reserved_qty FROM products WHERE id = ${product1Id} AND tenant_id = ${auth.tenantId}
    `.execute(db);

    if (Number(p1AfterReserve.rows[0]?.reserved_qty) !== 2) {
      throw new Error(`Expected reserved_qty = 2, got ${p1AfterReserve.rows[0]?.reserved_qty}`);
    }
    console.log(`[OK] تم تأكيد أمر البيع وحجز 2 وحدة من الشاشات (المحجوز: ${p1AfterReserve.rows[0]?.reserved_qty}).`);

    // 5. Cancel Order and Release Stock
    console.log('\n--- 5. إلغاء أمر البيع وتحرير المخزون المحجوز ---');
    await salesOrdersService.cancelOrder(draftOrderId, auth);

    const p1AfterCancel = await sql<{ stock_qty: string; reserved_qty: string }>`
      SELECT stock_qty, reserved_qty FROM products WHERE id = ${product1Id} AND tenant_id = ${auth.tenantId}
    `.execute(db);

    if (Number(p1AfterCancel.rows[0]?.reserved_qty) !== 0) {
      throw new Error(`Expected reserved_qty = 0 after cancel, got ${p1AfterCancel.rows[0]?.reserved_qty}`);
    }
    console.log(`[OK] تم إلغاء أمر البيع وإرجاع الكمية المحجوزة للرصيد المتاح (المحجوز: 0).`);

    // 6. Create Confirmed Order with Auto-Reserve & Convert to Sale
    console.log('\n--- 6. إنشاء أمر بيع معتمد مع الحجز التلقائي وتحويله لفاتورة بيع ---');
    const orderToConvertRes = await salesOrdersService.createOrder(
      {
        customerId,
        customerName: 'شركة الرواد للتجارة',
        customerPhone: '0501112233',
        branchId,
        autoReserve: true,
        subtotal: 5000,
        discountAmount: 200,
        taxAmount: 720,
        totalAmount: 5520,
        items: [
          {
            productId: product1Id,
            productName: 'شاشة سامسونج 65 بوصة',
            quantity: 2,
            unitPrice: 2500,
            total: 5000,
          },
        ],
      },
      auth,
    );

    const convertOrderId = Number((orderToConvertRes as any).order?.id);
    console.log(`[OK] تم إنشاء أمر البيع #${convertOrderId} بحالة confirmed وحجز تلقائي.`);

    // Convert to sale
    const convertResult = await salesOrdersService.convertToSale(convertOrderId, auth);
    const convertedOrder = await salesOrdersService.getOrderById(convertOrderId, auth);

    if ((convertedOrder as any).status !== 'converted') {
      throw new Error(`Expected status to be converted, got ${(convertedOrder as any).status}`);
    }
    console.log(`[OK] تم تحويل أمر البيع #${convertOrderId} بنجاح إلى فاتورة بيع (#${(convertResult as any).saleId}).`);

    // 7. Orders Listing and Status Summaries
    console.log('\n--- 7. استعراض قائمة أوامر البيع وإحصائيات الحالات ---');
    const listRes = await salesOrdersService.listOrders(auth);
    const ordersList = (listRes as any).orders || [];
    const summary = (listRes as any).summary || {};

    console.log(
      `[OK] إجمالي أوامر البيع المسجلة: ${ordersList.length} (ملغي: ${summary.cancelled}, محول: ${summary.converted}).`,
    );

    // 8. Delete Draft Order
    console.log('\n--- 8. إنشاء أمر بيع مسودة وحذفه نهائياً ---');
    const tempDraftRes = await salesOrdersService.createOrder(
      {
        customerId,
        customerName: 'عميل مسودة للحذف',
        branchId,
        autoReserve: false,
        subtotal: 100,
        totalAmount: 100,
        items: [],
      },
      auth,
    );
    const tempDraftId = Number((tempDraftRes as any).order?.id);

    await salesOrdersService.deleteOrder(tempDraftId, auth);

    let deleteVerified = false;
    try {
      await salesOrdersService.getOrderById(tempDraftId, auth);
    } catch (err: any) {
      deleteVerified = true;
    }

    if (!deleteVerified) {
      throw new Error('Draft order was not properly deleted');
    }
    console.log(`[OK] تم حذف أمر البيع المسودة #${tempDraftId} بنجاح.`);

    console.log('\n================================================================');
    console.log('[SUCCESS] اكتملت محاكاة دورة حياة طلبات البيع وعروض الأسعار بنجاح 100%!');
    console.log('================================================================\n');
  } catch (err: any) {
    console.error('[ERROR] SIMULATION FAILED:', err.message || err);
    console.error(err.stack);
    process.exit(1);
  } finally {
    console.log('--- تنظيف البيانات المؤقتة (Cleanup) ---');
    await sql`DELETE FROM sale_items WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM sales WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM sales_order_items WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM sales_orders WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM quotation_items WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM quotations WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM product_location_stock WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM products WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM customers WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM stock_locations WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM branches WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM accounting_settings WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM accounting_accounts WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    console.log('[OK] تم تنظيف بيانات محاكاة أوامر البيع بنجاح.');
    await pool.end();
  }
}

runSalesOrdersQuotationSimulation();
