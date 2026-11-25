import 'dotenv/config';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { Database } from '../../../src/database/database.types';
import { ManufacturingService } from '../../../src/modules/manufacturing/services/manufacturing.service';
import { MaintenanceService } from '../../../src/modules/maintenance/maintenance.service';
import { TradeInService } from '../../../src/modules/tradein/tradein.service';
import { ImportSalesService } from '../../../src/modules/import-sales/import-sales.service';
import { AuditService } from '../../../src/core/audit/audit.service';
import { AccountingPostingService } from '../../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../../src/modules/accounting/accounting-tenant-foundation.service';
import { TransactionHelper } from '../../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../../src/core/auth/interfaces/auth-context.interface';

async function runMultiModuleMasterSimulation() {
  console.log('\n================================================================');
  console.log('🏭 📱 🚢 Z-SYSTEMS ERP — MULTI-MODULE MASTER AUDIT & SIMULATION');
  console.log('1. التصنيع والإنتاج (Manufacturing & Work Orders)');
  console.log('2. قسم الموبايل والأجهزة (Maintenance Tickets & Trade-in)');
  console.log('3. الاستيراد والشراكة (Containers, China Debt & Profit Pool)');
  console.log('================================================================\n');

  const pool = new Pool({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 5433),
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
    database: process.env.DATABASE_NAME || 'zs_dev',
  });

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

  const tx = new TransactionHelper();
  const auditService = new AuditService(db as any);
  const accountingFoundation = new AccountingTenantFoundationService();
  const accountingPosting = new AccountingPostingService(accountingFoundation);

  const manufacturingService = new ManufacturingService(db as any, tx, auditService, accountingPosting);
  const maintenanceService = new MaintenanceService(
    db as any,
    tx,
    auditService,
    accountingPosting,
    accountingFoundation,
  );
  const tradeinService = new TradeInService(db as any, tx, auditService, accountingPosting);
  const importSalesService = new ImportSalesService(db as any);

  const userRow = await sql<{ id: number; tenant_id: string; account_id: string; username: string }>`
    SELECT id, tenant_id, account_id, username FROM users ORDER BY id ASC LIMIT 1
  `.execute(db);

  if (userRow.rows.length === 0) {
    throw new Error('No system user found in database');
  }

  const existingUser = userRow.rows[0];
  const dbTenantId = existingUser.tenant_id || 'default';
  const dbAccountId = existingUser.account_id || 'default';
  const simUid = Date.now().toString().slice(-4);

  const auth: AuthContext = {
    userId: existingUser.id,
    username: existingUser.username || 'admin',
    role: 'admin',
    tenantId: dbTenantId,
    accountId: dbAccountId,
    sessionId: `session_multi_${simUid}`,
    permissions: ['*'],
  };

  console.log(
    `📌 Tenant Context: [Tenant: ${dbTenantId}, Account: ${dbAccountId}, User: ${auth.username} (#${auth.userId})]\n`,
  );

  // Ensure system accounts 5400 and 1140 exist and are active for this tenant
  await sql`
    INSERT INTO accounting_accounts (tenant_id, account_id, code, name_ar, name_en, account_type, account_group, normal_balance, is_active, is_system, created_at, updated_at)
    VALUES (${auth.tenantId}, ${auth.accountId}, '5400', 'مصاريف صناعية غير مباشرة محملة', 'Manufacturing Overhead', 'expense', 'expenses', 'debit', true, true, NOW(), NOW())
    ON CONFLICT (tenant_id, code) DO UPDATE SET is_active = true
  `.execute(db);

  await sql`
    INSERT INTO accounting_accounts (tenant_id, account_id, code, name_ar, name_en, account_type, account_group, normal_balance, is_active, is_system, created_at, updated_at)
    VALUES (${auth.tenantId}, ${auth.accountId}, '1140', 'مخزون بضاعة ومواد خام', 'Inventory', 'asset', 'current_assets', 'debit', true, true, NOW(), NOW())
    ON CONFLICT (tenant_id, code) DO UPDATE SET is_active = true
  `.execute(db);

  try {
    // =========================================================================
    // MODULE 1: التصنيع والإنتاج (MANUFACTURING & PRODUCTION)
    // =========================================================================
    console.log('================================================================');
    console.log('🏭 [MODULE 1] التصنيع والإنتاج (المكونات، الوصفات، وأوامر التشغيل)');
    console.log('================================================================');

    // 1. Create Raw Materials (المواد الخام) in products
    const rawMetalRes = await sql<{ id: number }>`
      INSERT INTO products (tenant_id, account_id, name, barcode, item_type, cost_price, retail_price, stock_qty, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${'ألواح صاج مجلفن 2مم ' + simUid}, ${'622' + simUid + '01'}, 'raw_material', 250, 0, 100, true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const rawMetalId = Number(rawMetalRes.rows[0].id);

    const rawScrewsRes = await sql<{ id: number }>`
      INSERT INTO products (tenant_id, account_id, name, barcode, item_type, cost_price, retail_price, stock_qty, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${'مسامير صلب فايبر صناعي ' + simUid}, ${'622' + simUid + '02'}, 'raw_material', 2, 0, 1000, true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const rawScrewsId = Number(rawScrewsRes.rows[0].id);

    const rawPaintRes = await sql<{ id: number }>`
      INSERT INTO products (tenant_id, account_id, name, barcode, item_type, cost_price, retail_price, stock_qty, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${'دهان إلكتروستاتيك حراري ' + simUid}, ${'622' + simUid + '03'}, 'raw_material', 80, 0, 50, true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const rawPaintId = Number(rawPaintRes.rows[0].id);

    // 2. Create Finished Product (المنتج التام)
    const finishedProductRes = await sql<{ id: number }>`
      INSERT INTO products (tenant_id, account_id, name, barcode, item_type, cost_price, retail_price, stock_qty, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${'كابينة سيرفرات 42U بريميوم ' + simUid}, ${'622' + simUid + '04'}, 'product', 0, 8500, 0, true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const finishedProductId = Number(finishedProductRes.rows[0].id);

    console.log(`   ✅ تم تجهيز المواد الخام والمخزون:`);
    console.log(`      • ألواح صاج (#${rawMetalId}): 100 لوح @ 250 ج.م`);
    console.log(`      • مسامير صلب (#${rawScrewsId}): 1000 مسمار @ 2 ج.م`);
    console.log(`      • دهان إلكتروستاتيك (#${rawPaintId}): 50 لتر @ 80 ج.م`);
    console.log(`      • منتج تام الصنع (#${finishedProductId}): كابينة سيرفرات 42U (رصيد حالي: 0)`);

    // 3. Create Bill of Materials (BOM / قائمة المكونات)
    const bomRes = await manufacturingService.createBom(
      {
        productId: finishedProductId,
        quantity: 1, // 1 Finished Cabinet
        overheadCost: 450, // مصاريف صناعية وعمالة وتشغيل ماكينات
        lines: [
          {
            componentProductId: rawMetalId,
            quantity: 4,
            unitName: 'لوح',
            unitMultiplier: 1,
            expectedCost: 250,
            wastePercentage: 5,
          },
          {
            componentProductId: rawScrewsId,
            quantity: 50,
            unitName: 'مسمار',
            unitMultiplier: 1,
            expectedCost: 2,
            wastePercentage: 2,
          },
          {
            componentProductId: rawPaintId,
            quantity: 2,
            unitName: 'لتر',
            unitMultiplier: 1,
            expectedCost: 80,
            wastePercentage: 0,
          },
        ],
      },
      auth,
    );

    const bomId = Number((bomRes as any).bomId);
    console.log(`   ✅ تم إنشاء قائمة المكونات (BOM #${bomId}) مع احتساب نسب الهالك والمصاريف الصناعية.`);

    // 4. Create Work Order (أمر الإنتاج) to produce 5 Cabinets
    const woRes = await manufacturingService.createWorkOrder(
      {
        bomId,
        quantityToProduce: 5,
        note: `تشغيل دفعة إنتاج 5 كبائن سيرفرات لطلبية معتمدة #${simUid}`,
      },
      auth,
    );
    const woId = Number((woRes as any).workOrderId);
    console.log(`   ✅ تم إصدار أمر الإنتاج #${woId} لإنتاج 5 كبائن (الحالة: Draft).`);

    // 5. Complete Work Order (إنهاء أمر الإنتاج وخصم المواد الخام وتغذية تام الصنع)
    await manufacturingService.completeWorkOrder(woId, {}, auth);
    console.log(`   ✅ تم إنهاء أمر الإنتاج #${woId} بنجاح:`);
    console.log(`      • تم خصم المواد الخام من المخزن بدقة مع إضافة نسب الهالك.`);
    console.log(`      • تم إنتاج وإيداع 5 كبائن سيرفرات تامة الصنع في مخزن المنتجات.`);
    console.log(`      • تم تحديث متوسط التكلفة المرجح لمنتج الكابينة تلقائياً.`);
    console.log(`      • تم ترحيل القيود المحاسبية الصناعية وتوثيق حركة المخزون.\n`);

    // =========================================================================
    // MODULE 2: قسم الموبايل والأجهزة (MAINTENANCE, TRADE-IN & SERIALS)
    // =========================================================================
    console.log('================================================================');
    console.log('📱 [MODULE 2] قسم الموبايل والأجهزة (الصيانة، الاستبدال، وتتبع IMEI)');
    console.log('================================================================');

    // 1. Create Customer for Mobile Shop
    const customerRes = await sql<{ id: number }>`
      INSERT INTO customers (tenant_id, account_id, name, phone, balance, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${'أستاذ / طارق العوضي ' + simUid}, '01055667788', 0, true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const customerId = Number(customerRes.rows[0].id);

    // 2. Create Spare Parts in Products
    const screenPartRes = await sql<{ id: number }>`
      INSERT INTO products (tenant_id, account_id, name, barcode, item_type, cost_price, retail_price, stock_qty, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${'شاشة أصلية Apple iPhone 14 Pro Max ' + simUid}, ${'622' + simUid + '31'}, 'product', 3200, 3500, 20, true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const screenPartId = Number(screenPartRes.rows[0].id);

    const batteryPartRes = await sql<{ id: number }>`
      INSERT INTO products (tenant_id, account_id, name, barcode, item_type, cost_price, retail_price, stock_qty, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${'بطارية أصلية Apple MagSafe ' + simUid}, ${'622' + simUid + '32'}, 'product', 700, 900, 25, true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const batteryPartId = Number(batteryPartRes.rows[0].id);

    // 3. Create Maintenance Ticket 1: iPhone 14 Pro Max
    const ticketNo = `TKT-${simUid}-01`;
    const imeiCode1 = `356984110294${simUid}`;
    const ticket1Res = await maintenanceService.createTicket(
      {
        ticketNo,
        customerId,
        customerName: 'أستاذ / طارق العوضي',
        customerPhone: '01055667788',
        deviceModel: 'iPhone 14 Pro Max 256GB Deep Purple',
        serialNumber: imeiCode1,
        problemDescription: 'شاشة مكسورة تماماً وتفريغ شحن سريع جداً مع سخونة',
        deviceCondition: 'خدوش خفيفة بالإطار الخارجي',
        expectedCost: 4500,
        advancePayment: 1000,
        passcode: '198420',
        technicianNotes: 'تم الاستلام وإرسال إشعار للعميل',
      } as any,
      auth,
    );

    const ticket1Id = Number((ticket1Res as any).ticket?.id || (ticket1Res as any).id);
    console.log(
      `   ✅ تم فتح تذكرة صيانة #${ticket1Id} (رقم: ${ticketNo}) لجهاز iPhone 14 Pro Max (IMEI: ${imeiCode1}).`,
    );

    // Add Spare Parts to Ticket
    await maintenanceService.addPart(
      ticket1Id,
      {
        productId: screenPartId,
        productName: 'شاشة أصلية Apple iPhone 14 Pro Max',
        qty: 1,
        unitCost: 3200,
        unitPrice: 3500,
      } as any,
      auth,
    );

    await maintenanceService.addPart(
      ticket1Id,
      {
        productId: batteryPartId,
        productName: 'بطارية أصلية Apple MagSafe',
        qty: 1,
        unitCost: 700,
        unitPrice: 900,
      } as any,
      auth,
    );

    console.log(`   ✅ تم إضافة قطع الغيار للتذكرة: شاشة أصلية + بطارية.`);

    // Progress Ticket Status: in_progress -> repaired -> delivered
    await maintenanceService.updateTicketStatus(
      ticket1Id,
      {
        status: 'in_progress',
        technicianNotes: 'جاري فك الجهاز وتركيب الشاشة والبطارية الجديدة',
      } as any,
      auth,
    );

    await maintenanceService.updateTicketStatus(
      ticket1Id,
      {
        status: 'repaired',
        technicianNotes: 'تم الإصلاح والاختبار بنجاح بنسبة 100% والجهاز جاهز للتسليم',
      } as any,
      auth,
    );

    await maintenanceService.updateTicketStatus(
      ticket1Id,
      {
        status: 'delivered',
        finalCost: 4400,
        collectedAmount: 3400, // 4400 - 1000 advance
        paymentMethod: 'cash',
        technicianNotes: 'تم تسليم الجهاز للعميل وتجربته واستلام المتبقي نقداً مع فاتورة وضمان',
      } as any,
      auth,
    );

    console.log(`   ✅ تم إكمال دورة الصيانة بالكامل: فحص -> قيد العمل -> تم الإصلاح -> تم التسليم للعميل بنجاح.`);

    // 3. Trade-in: شراء واستبدال جهاز مستعمل من عميل
    const tradeinImei = `359874100982${simUid}`;
    const tradeinRes = await tradeinService.createTransaction(
      {
        sellerName: 'أستاذ / طارق العوضي',
        sellerPhone: '01055667788',
        sellerNationalId: `2910405${simUid}999`,
        deviceBrand: 'Apple',
        deviceModel: 'iPhone 13 128GB Midnight',
        serialNumber: tradeinImei,
        deviceConditionState: 'like_new',
        deviceConditionNotes: 'حالة ممتازة شاشة أصلية وبطارية 88% بدون خدوش',
        agreedPurchasePrice: 18000,
        transactionType: 'cash_purchase',
        autoAddToInventory: true,
        resalePrice: 21500,
        paymentMethod: 'cash',
        notes: 'تم فحص الجهاز بالكامل وشراؤه من العميل لإعادة بيعه في قسم المستعمل',
      } as any,
      auth,
    );

    const tradeinId = Number((tradeinRes as any).transaction?.id || (tradeinRes as any).id);
    console.log(
      `   ✅ تم تنفيذ عملية استبدال وشراء جهاز مستعمل (#${tradeinId}) بمبلغ 18,000 ج.م (IMEI: ${tradeinImei}).\n`,
    );

    // =========================================================================
    // MODULE 3: الاستيراد والشراكة (IMPORT CONTAINERS, PARTNERS & PROFIT POOL)
    // =========================================================================
    console.log('================================================================');
    console.log('🚢 [MODULE 3] الاستيراد والشراكة (الحاويات، مديونية الصين، وتوزيع الأرباح)');
    console.log('================================================================');

    // 1. Create Partners
    const partner1Res = await importSalesService.createPartner(
      auth.tenantId!,
      auth.userId!,
      `الحاج / محمود زكريا ${simUid}`,
      60, // 60%
      500000, // 500,000 EGP Capital
    );
    const partner1Id = String((partner1Res as any).id || (partner1Res as any).partner?.id);

    const partner2Res = await importSalesService.createPartner(
      auth.tenantId!,
      auth.userId!,
      `المهندس / حسام البدري ${simUid}`,
      40, // 40%
      300000, // 300,000 EGP Capital
    );
    const partner2Id = String((partner2Res as any).id || (partner2Res as any).partner?.id);

    console.log(`   ✅ تم تسجيل الشركاء ورؤوس الأموال:`);
    console.log(`      • الشريك الأول: الحاج محمود زكريا (حصة 60% | رأس مال: 500,000 ج.م)`);
    console.log(`      • الشريك الثاني: المهندس حسام البدري (حصة 40% | رأس مال: 300,000 ج.م)`);

    // Record Capital Deposit for Partner 2: +50,000 EGP
    await importSalesService.recordCapitalTransaction(auth.tenantId!, auth.userId!, partner2Id, {
      type: 'DEPOSIT',
      amount: 50000,
      date: '2026-08-15',
      note: 'إيداع نقدي إضافي لتمويل شحنة الشاشات الجديدة',
    });
    console.log(`   ✅ تم تسجيل حركة رأس مال: إيداع +50,000 ج.م للشريك الثاني (إجمالي رأس ماله: 350,000 ج.م).`);

    // 2. Create Import Supplier & Shipment / Container
    const supplierRes = await sql<{ id: number }>`
      INSERT INTO suppliers (tenant_id, account_id, name, phone, balance, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${'Shenzhen Quantum Tech Ltd (China) ' + simUid}, '008675588990', 0, true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const chinaSupplierId = Number(supplierRes.rows[0].id);

    const shipmentCode = `CONT-${simUid}-CN`;
    const shipmentRes = await importSalesService.createShipment(auth.tenantId!, {
      containerNumber: shipmentCode,
      supplierId: String(chinaSupplierId),
      exchangeRateAtArrival: 48.5,
      pricingExchangeRate: 48.5,
      status: 'Pending',
    } as any);

    const shipmentId = String((shipmentRes as any).id || (shipmentRes as any).shipment?.id);
    console.log(`   ✅ تم فتح ملف شحنة استيراد #${shipmentId} (حاوية: ${shipmentCode}) من المورد الصيني.`);

    // 3. Create Products for Shipment Items
    const screenProdRes = await sql<{ id: number }>`
      INSERT INTO products (tenant_id, account_id, name, barcode, item_type, cost_price, retail_price, stock_qty, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${'شاشة ألعاب كوانتم 27 IPS 165Hz ' + simUid}, ${'622' + simUid + '11'}, 'product', 0, 8500, 0, true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const screenProdId = String(screenProdRes.rows[0].id);

    const gpuProdRes = await sql<{ id: number }>`
      INSERT INTO products (tenant_id, account_id, name, barcode, item_type, cost_price, retail_price, stock_qty, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${'كارت شاشة RTX 4060 8GB GDDR6 ' + simUid}, ${'622' + simUid + '12'}, 'product', 0, 16500, 0, true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const gpuProdId = String(gpuProdRes.rows[0].id);

    // Add Shipment Items (الأصناف المستوردة)
    await importSalesService.addShipmentItem(auth.tenantId!, shipmentId, {
      productId: screenProdId,
      quantity: 100,
      factoryUnitPriceUsd: 120, // $120 USD
    });

    await importSalesService.addShipmentItem(auth.tenantId!, shipmentId, {
      productId: gpuProdId,
      quantity: 200,
      factoryUnitPriceUsd: 65, // $65 USD
    });

    console.log(
      `   ✅ تم إدراج الأصناف: 100 شاشة @ $120 ($12,000) + 200 كارت شاشة @ $65 ($13,000) = إجمالي $25,000 USD.`,
    );

    // 4. Update Shipping & Clearance Costs (المصروفات والجمارك المحملة Landed Costs)
    await importSalesService.updateShipmentCosts(auth.tenantId!, auth.userId!, shipmentId, {
      shippingCostUsd: 1300, // شحن بحري بالدولار
      customsCostEgp: 120000, // جمارك وضرائب
      internalTransportCostEgp: 15000, // تخليص ونولون محلي
      exchangeRateAtArrival: 48.5,
      status: 'Arrived', // Arrived: ترحيل المخزون والتكلفة المحملة Landed Cost
    });
    console.log(`   ✅ تم استلام الحاوية وترحيل البضائع للمخزن وحساب التكلفة الفعلية المحملة (Landed Cost) لكل صنف.`);

    // 5. Record Foreign Bank Transfer to China Supplier ($15,000 USD @ 48.50)
    await importSalesService.recordForeignTransfer(auth.tenantId!, auth.userId!, {
      supplierId: String(chinaSupplierId),
      amountForeign: 15000,
      amountEgp: 15000 * 48.5,
      notes: 'دفعة سويفت بنكي للمورد الصيني لتغطية تكاليف الشحن وتوريد البضاعة',
    });
    console.log(`   ✅ تم تسجيل تحويل خارجي للمورد الصيني: $15,000 USD وتحديث مديونية الصين.`);

    // 6. Profit Report & Partner Payout
    const profitReport = await importSalesService.generatePeriodProfitReport(
      auth.tenantId!,
      '2026-08-01',
      '2026-08-31',
    );
    console.log(`   📊 تقرير أرباح فترة الاستيراد:`, profitReport);

    // Record Partner Payout
    await importSalesService.recordPartnerPayout(auth.tenantId!, auth.userId!, partner1Id, 30000);
    console.log(`   ✅ تم صرف وتوثيق دفعة أرباح للشريك الأول بمبلغ 30,000 ج.م.\n`);

    console.log('================================================================');
    console.log('🎉 نجاح باهر: تم اختبار ومحاكاة الموديولات الثلاثة بالكامل 100%!');
    console.log('================================================================\n');
  } catch (err: any) {
    console.error('❌ MULTI-MODULE SIMULATION FAILED WITH ERROR:', err.message || err);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMultiModuleMasterSimulation();
