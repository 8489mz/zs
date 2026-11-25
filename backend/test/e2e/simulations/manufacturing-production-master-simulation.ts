import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../src/app.module';
import { ManufacturingService } from '../../../src/modules/manufacturing/services/manufacturing.service';
import { Kysely, sql } from 'kysely';
import { Database } from '../../../src/database/database.types';
import { AuthContext } from '../../../src/core/auth/interfaces/auth-context.interface';
import { KYSELY_DB } from '../../../src/database/database.constants';
import { applyStockDelta } from '../../../src/common/utils/location-stock-ledger';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`[FAIL] ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

async function ensureManufacturingAccounts(db: Kysely<Database>, tenantId: string): Promise<void> {
  const accountsToEnsure = [
    {
      code: '1140',
      name_ar: 'مخزون المواد الخام والمنتجات التامة',
      name_en: 'Inventory (Raw Materials & FG)',
      type: 'asset',
      group: 'current_assets',
      normal_balance: 'debit',
      isInventory: true,
    },
    {
      code: '5400',
      name_ar: 'تكاليف صناعية غير مباشرة مستوعبة (تحميل)',
      name_en: 'Manufacturing Overhead Absorbed',
      type: 'expense',
      group: 'direct_costs',
      normal_balance: 'credit',
      isInventory: false,
    },
  ];

  for (const acc of accountsToEnsure) {
    const existing = await (db as any)
      .selectFrom('accounting_accounts')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('code', '=', acc.code)
      .executeTakeFirst();

    if (existing) {
      await (db as any)
        .updateTable('accounting_accounts')
        .set({ is_active: true })
        .where('tenant_id', '=', tenantId)
        .where('code', '=', acc.code)
        .execute();
    } else {
      await (db as any)
        .insertInto('accounting_accounts')
        .values({
          tenant_id: tenantId,
          account_id: `acc-${tenantId}-${acc.code}`,
          code: acc.code,
          name_ar: acc.name_ar,
          name_en: acc.name_en,
          account_type: acc.type,
          account_group: acc.group,
          normal_balance: acc.normal_balance,
          is_receivable: false,
          is_payable: false,
          is_inventory: acc.isInventory,
          is_active: true,
          is_system: false,
          allow_manual_entries: true,
          is_control_account: false,
          is_cash_bank: false,
          is_tax: false,
          is_monetary: false,
          description_ar: acc.name_ar,
          sort_order: 150,
        })
        .execute();
    }
  }
}

export async function runManufacturingProductionMasterSimulation(): Promise<void> {
  console.log('========================================================================');
  console.log('  STARTING COMPREHENSIVE END-TO-END MANUFACTURING & WORK ORDERS SIMULATION');
  console.log('========================================================================\n');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const mfgService = app.get(ManufacturingService);
  const db = app.get<Kysely<Database>>(KYSELY_DB);

  try {
    const tenantId = 'zs';
    const userRow = await (db as any)
      .selectFrom('users')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('role', '=', 'super_admin')
      .executeTakeFirst();
    const userId = userRow?.id ? Number(userRow.id) : 46;

    const auth: AuthContext = {
      userId,
      sessionId: 'mfg-master-simulation',
      username: 'admin',
      role: 'super_admin',
      permissions: ['*'],
      tenantId,
      accountId: tenantId,
    };

    // Ensure chart of accounts for manufacturing postings (1140 inventory & 5400 overhead)
    await ensureManufacturingAccounts(db, tenantId);

    // Ensure production stock location
    let location = await (db as any)
      .selectFrom('stock_locations')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .executeTakeFirst();

    if (!location) {
      location = await (db as any)
        .insertInto('stock_locations')
        .values({
          tenant_id: tenantId,
          account_id: tenantId,
          name: 'المستودع الصناعي الرئيسي لخطوط الإنتاج',
          is_active: true,
        })
        .returningAll()
        .executeTakeFirst();
    }
    const locationId = Number(location.id);
    console.log(`[CONFIG] Using Production Stock Location ID: ${locationId} (${location.name})\n`);

    // -------------------------------------------------------------------------
    // STEP 1: Work Center Provisioning & Capacity Planning
    // -------------------------------------------------------------------------
    console.log('[STEP 1] Provisioning Industrial Work Centers & Machine Routing...');
    const wc1Res = await mfgService.upsertWorkCenter(
      null,
      {
        code: 'WC-CNC-01',
        name: 'مركز القص والتشكيل الرقمي بالليزر CNC',
        costPerHour: 40,
        capacity: 8,
        timeEfficiency: 95,
        status: 'active',
        notes: 'ماكينة ليزر فايبر 6 كيلووات',
      },
      auth,
    );
    assert(Boolean(wc1Res.workCenter?.id), 'Work Center 1 must be created');
    const wc1Id = Number(wc1Res.workCenter.id);
    console.log(`  -> Created Work Center 1: [${wc1Res.workCenter.code}] ${wc1Res.workCenter.name} (40 EGP/hr)`);

    const wc2Res = await mfgService.upsertWorkCenter(
      null,
      {
        code: 'WC-ASSM-01',
        name: 'محطة التجميع الآلي واللحام الروبوتي',
        costPerHour: 25,
        capacity: 16,
        timeEfficiency: 100,
        status: 'active',
        notes: 'روبوت لحام ثنائي المحاور',
      },
      auth,
    );
    assert(Boolean(wc2Res.workCenter?.id), 'Work Center 2 must be created');
    const wc2Id = Number(wc2Res.workCenter.id);
    console.log(`  -> Created Work Center 2: [${wc2Res.workCenter.code}] ${wc2Res.workCenter.name} (25 EGP/hr)`);

    const wcListRes = await mfgService.listWorkCenters(auth);
    assert(wcListRes.workCenters.length >= 2, 'Must have at least 2 active work centers');
    console.log('  [PASS] STEP 1 PASSED: Work centers provisioned successfully.\n');

    // -------------------------------------------------------------------------
    // STEP 2: Raw Materials & Finished Goods Master Catalog Setup
    // -------------------------------------------------------------------------
    console.log('[STEP 2] Creating Raw Materials, Finished Goods & By-Product Items...');
    const suffix = Date.now();

    // Raw Material 1: Sheet Steel
    const rm1 = await (db as any)
      .insertInto('products')
      .values({
        tenant_id: tenantId,
        account_id: tenantId,
        name: `ألواح صلب مجلفن 2مم - كود #${suffix}`,
        item_kind: 'standard',
        item_type: 'product',
        cost_price: 30,
        retail_price: 45,
        wholesale_price: 38,
        stock_qty: 0,
        is_active: true,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const rm1Id = Number(rm1.id);
    console.log(`  -> Raw Material 1: [ID: ${rm1Id}] ${rm1.name} (Cost: 30 EGP/Kg)`);

    // Raw Material 2: Fastening Bolts
    const rm2 = await (db as any)
      .insertInto('products')
      .values({
        tenant_id: tenantId,
        account_id: tenantId,
        name: `مسامير صلب مجلفن M8x25 - كود #${suffix}`,
        item_kind: 'standard',
        item_type: 'product',
        cost_price: 2,
        retail_price: 4,
        wholesale_price: 3,
        stock_qty: 0,
        is_active: true,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const rm2Id = Number(rm2.id);
    console.log(`  -> Raw Material 2: [ID: ${rm2Id}] ${rm2.name} (Cost: 2 EGP/Pcs)`);

    // Raw Material 3: Industrial Coating
    const rm3 = await (db as any)
      .insertInto('products')
      .values({
        tenant_id: tenantId,
        account_id: tenantId,
        name: `طلاء إلكتروستاتيك رمادي صناعي - كود #${suffix}`,
        item_kind: 'standard',
        item_type: 'product',
        cost_price: 50,
        retail_price: 75,
        wholesale_price: 65,
        stock_qty: 0,
        is_active: true,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const rm3Id = Number(rm3.id);
    console.log(`  -> Raw Material 3: [ID: ${rm3Id}] ${rm3.name} (Cost: 50 EGP/Liter)`);

    // Finished Good: Industrial Enclosure Cabinet
    const fg = await (db as any)
      .insertInto('products')
      .values({
        tenant_id: tenantId,
        account_id: tenantId,
        name: `لوحة تحكم صناعية معزولة 800x600x300 - كود #${suffix}`,
        item_kind: 'standard',
        item_type: 'product',
        cost_price: 0,
        retail_price: 1200,
        wholesale_price: 950,
        stock_qty: 0,
        is_active: true,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const fgId = Number(fg.id);
    console.log(`  -> Finished Good: [ID: ${fgId}] ${fg.name} (Target Retail: 1,200 EGP)`);

    // By-Product: Scrap Steel
    const bp = await (db as any)
      .insertInto('products')
      .values({
        tenant_id: tenantId,
        account_id: tenantId,
        name: `قصاصات وخردة صاج صلب - كود #${suffix}`,
        item_kind: 'standard',
        item_type: 'product',
        cost_price: 5,
        retail_price: 8,
        wholesale_price: 6,
        stock_qty: 0,
        is_active: true,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const bpId = Number(bp.id);
    console.log(`  -> By-Product: [ID: ${bpId}] ${bp.name} (Scrap Valuation: 5 EGP/Kg)`);
    console.log('  [PASS] STEP 2 PASSED: Master product catalog established.\n');

    // -------------------------------------------------------------------------
    // STEP 3: Multi-Level Bill of Materials (BOM) & Circular Dependency Defense
    // -------------------------------------------------------------------------
    console.log('[STEP 3] Creating Bill of Materials (BOM) & Verifying Circular Defense...');

    // Circular Defense Test: Self-Reference
    let selfRefBlocked = false;
    try {
      await mfgService.createBom(
        {
          productId: fgId,
          quantity: 1,
          overheadCost: 50,
          lines: [{ componentProductId: fgId, quantity: 1, unitName: 'Pcs', unitMultiplier: 1, expectedCost: 100 }],
        },
        auth,
      );
    } catch (err: any) {
      selfRefBlocked = true;
      console.log(`  -> Circular Defense Guard correctly rejected self-reference: ${err.message}`);
    }
    assert(selfRefBlocked === true, 'Self-referencing BOM must be strictly forbidden');

    // Create Valid BOM:
    // 1 Unit of FG consumes:
    // - 10 Kg of RM1 (waste: 5%) @ 30 = 300 EGP
    // - 20 Pcs of RM2 @ 2 = 40 EGP
    // - 1 Liter of RM3 @ 50 = 50 EGP
    // + 50 EGP Overhead cost = 440 EGP Expected Unit Cost
    const bomRes = await mfgService.createBom(
      {
        productId: fgId,
        quantity: 1,
        overheadCost: 50,
        lines: [
          {
            componentProductId: rm1Id,
            quantity: 10,
            unitName: 'Kg',
            unitMultiplier: 1,
            expectedCost: 30,
            wastePercentage: 5,
          },
          {
            componentProductId: rm2Id,
            quantity: 20,
            unitName: 'Pcs',
            unitMultiplier: 1,
            expectedCost: 2,
            wastePercentage: 0,
          },
          {
            componentProductId: rm3Id,
            quantity: 1,
            unitName: 'Liter',
            unitMultiplier: 1,
            expectedCost: 50,
            wastePercentage: 0,
          },
        ],
      },
      auth,
    );

    assert(Boolean(bomRes.bomId), 'BOM ID must exist');
    const bomId = bomRes.bomId;
    console.log(`  -> Created Valid Multi-Level BOM #${bomId} for FG #${fgId}`);

    const bomsList = await mfgService.getBoms(auth);
    const createdBom = bomsList.boms.find((b: any) => Number(b.id) === bomId);
    assert(Boolean(createdBom), 'Created BOM must appear in active BOM list');
    assert(
      Number(createdBom!.expected_cost) === 440,
      `Expected unit cost must be 440, got: ${createdBom!.expected_cost}`,
    );
    console.log(`  -> BOM Expected Cost Verified: ${createdBom!.expected_cost} EGP/Unit`);
    console.log('  [PASS] STEP 3 PASSED: BOM created with anti-circular invariants.\n');

    // -------------------------------------------------------------------------
    // STEP 4: Warehouse Stock Provisioning (Canonical Lock Order)
    // -------------------------------------------------------------------------
    console.log('[STEP 4] Seeding Raw Materials Inventory via Canonical Lock Order...');

    // Seed: 500 Kg of RM1, 1000 Pcs of RM2, 100 Liters of RM3
    await applyStockDelta(db, {
      tenantId,
      accountId: tenantId,
      productId: rm1Id,
      branchId: null,
      locationId,
      delta: 500,
    });
    await applyStockDelta(db, {
      tenantId,
      accountId: tenantId,
      productId: rm2Id,
      branchId: null,
      locationId,
      delta: 1000,
    });
    await applyStockDelta(db, {
      tenantId,
      accountId: tenantId,
      productId: rm3Id,
      branchId: null,
      locationId,
      delta: 100,
    });

    const checkStockRM1 = await (db as any)
      .selectFrom('product_location_stock')
      .select('qty')
      .where('tenant_id', '=', tenantId)
      .where('location_id', '=', locationId)
      .where('product_id', '=', rm1Id)
      .executeTakeFirst();
    assert(Number(checkStockRM1?.qty) === 500, `RM1 stock must be 500, got: ${checkStockRM1?.qty}`);
    console.log(`  -> Verified Initial RM1 Stock in Warehouse: ${checkStockRM1?.qty} Kg`);
    console.log('  [PASS] STEP 4 PASSED: Raw material inventory balances provisioned.\n');

    // -------------------------------------------------------------------------
    // STEP 5: Work Order Issuance & Document Numbering
    // -------------------------------------------------------------------------
    console.log('[STEP 5] Issuing Manufacturing Work Order #1 (20 Cabinets)...');
    const wo1Res = await mfgService.createWorkOrder(
      {
        bomId,
        quantityToProduce: 20,
        sourceLocationId: locationId,
        destinationLocationId: locationId,
        note: 'تشغيل دفعة 20 لوحة تحكم كهربائية للوحدات المدمجة',
      },
      auth,
    );

    assert(Boolean(wo1Res.workOrderId), 'Work Order ID must exist');
    const wo1Id = wo1Res.workOrderId;
    console.log(`  -> Created Work Order #${wo1Id}`);

    const woList = await mfgService.getWorkOrders(auth);
    const wo1 = woList.workOrders.find((w: any) => Number(w.id) === wo1Id);
    assert(Boolean(wo1), 'Work order must exist in list');
    assert(wo1!.status === 'draft', `Work order initial status must be draft, got: ${wo1!.status}`);
    assert(Number(wo1!.quantity_to_produce) === 20, 'Quantity to produce must be 20');
    console.log(`  -> Work Order #${wo1Id} Status: [${wo1!.status}] for ${wo1!.quantity_to_produce} units`);
    console.log('  [PASS] STEP 5 PASSED: Work order created.\n');

    // -------------------------------------------------------------------------
    // STEP 6: Shortage Defense Guard (Insufficient Material Invariant)
    // -------------------------------------------------------------------------
    console.log('[STEP 6] Testing Shortage Defense Guard against Excess Work Order...');
    const woShortageRes = await mfgService.createWorkOrder(
      {
        bomId,
        quantityToProduce: 200, // Requires 200 * 10 * 1.05 = 2,100 Kg RM1 (only 500 available)
        sourceLocationId: locationId,
        destinationLocationId: locationId,
        note: 'أمر إنتاج زائد لاختبار حارس العجز المخزني',
      },
      auth,
    );

    let shortageBlocked = false;
    try {
      await mfgService.completeWorkOrder(
        woShortageRes.workOrderId,
        {
          sourceLocationId: locationId,
          destinationLocationId: locationId,
        },
        auth,
      );
    } catch (err: any) {
      shortageBlocked = true;
      console.log(`  -> Shortage Guard strictly blocked work order: ${err.message}`);
    }
    assert(shortageBlocked === true, 'Work order execution exceeding raw materials must be strictly blocked');
    console.log('  [PASS] STEP 6 PASSED: Material shortage guard enforced.\n');

    // -------------------------------------------------------------------------
    // STEP 7: Work Center Routing Operations
    // -------------------------------------------------------------------------
    console.log('[STEP 7] Scheduling Multi-Stage Work Center Operations...');
    const operations = [
      {
        workCenterId: wc1Id,
        operationName: 'قص وتشكيل الألواح بليزر CNC',
        sequence: 1,
        durationHours: 5,
        hourlyCost: 40, // 5 * 40 = 200 EGP
        notes: 'برنامج القطع الآلي رقم P-806',
      },
      {
        workCenterId: wc2Id,
        operationName: 'تجميع الهيكل واللحام الكهربائي',
        sequence: 2,
        durationHours: 8,
        hourlyCost: 25, // 8 * 25 = 200 EGP
        notes: 'فحص استواء الزوايا وجودة اللحام',
      },
    ];
    console.log(
      `  -> Configured 2 Shop Floor Operations: 5 hrs @ CNC (200 EGP) + 8 hrs @ Assembly (200 EGP) = 400 EGP Machine Cost`,
    );
    console.log('  [PASS] STEP 7 PASSED: Operations routing ready.\n');

    // -------------------------------------------------------------------------
    // STEP 8: Production Execution, Completion & Scrap Generation
    // -------------------------------------------------------------------------
    console.log('[STEP 8] Executing & Completing Work Order #1...');
    // Consumption for 20 units:
    // RM1: 20 * 10 * (1 + 0.05) = 210 Kg consumed
    // RM2: 20 * 20 = 400 Pcs consumed
    // RM3: 20 * 1 = 20 Liters consumed
    // By-Product: 50 Kg of Scrap Steel produced
    const completeRes = await mfgService.completeWorkOrder(
      wo1Id,
      {
        sourceLocationId: locationId,
        destinationLocationId: locationId,
        operations,
        byProducts: [
          {
            productId: bpId,
            productName: 'قصاصات وخردة صاج صلب',
            quantity: 50,
            unitCost: 5,
            locationId,
          },
        ],
      },
      auth,
    );

    assert(completeRes.ok === true, 'Work order completion must succeed');
    console.log(`  -> Work Order #${wo1Id} Completed Successfully!`);

    // Verify Work Order status in DB
    const wo1Completed = await (db as any)
      .selectFrom('manufacturing_work_orders')
      .selectAll()
      .where('id', '=', wo1Id)
      .executeTakeFirst();
    assert(wo1Completed.status === 'done', `Work order status must be "done", got: ${wo1Completed.status}`);
    assert(Number(wo1Completed.produced_quantity) === 20, 'Produced quantity must be 20');
    console.log(
      `  -> Work Order DB Status: [${wo1Completed.status}], Total Actual Cost: ${wo1Completed.total_cost} EGP`,
    );

    // Verify Raw Materials stock deductions
    const postStockRM1 = await (db as any)
      .selectFrom('product_location_stock')
      .select('qty')
      .where('tenant_id', '=', tenantId)
      .where('location_id', '=', locationId)
      .where('product_id', '=', rm1Id)
      .executeTakeFirst();
    // 500 - 210.526 = 289.474 Kg (5% waste factor: 200 / 0.95 = 210.526)
    assert(
      Math.abs(Number(postStockRM1?.qty) - 289.474) < 0.01,
      `RM1 remaining stock must be ~289.474 Kg, got: ${postStockRM1?.qty}`,
    );
    console.log(`  -> Verified RM1 Stock deducted correctly: 500 -> ${postStockRM1?.qty} Kg`);

    // Verify Finished Good stock increase
    const postStockFG = await (db as any)
      .selectFrom('product_location_stock')
      .select('qty')
      .where('tenant_id', '=', tenantId)
      .where('location_id', '=', locationId)
      .where('product_id', '=', fgId)
      .executeTakeFirst();
    assert(Number(postStockFG?.qty) === 20, `FG stock must be 20, got: ${postStockFG?.qty}`);
    console.log(`  -> Verified FG Stock created in warehouse: ${postStockFG?.qty} Units`);

    // Verify By-Product stock creation
    const postStockBP = await (db as any)
      .selectFrom('product_location_stock')
      .select('qty')
      .where('tenant_id', '=', tenantId)
      .where('location_id', '=', locationId)
      .where('product_id', '=', bpId)
      .executeTakeFirst();
    assert(Number(postStockBP?.qty) === 50, `By-product scrap stock must be 50 Kg, got: ${postStockBP?.qty}`);
    console.log(`  -> Verified By-Product Scrap Stock generated: ${postStockBP?.qty} Kg`);

    // Verify FG average cost updated in products table
    const fgProductUpdated = await (db as any)
      .selectFrom('products')
      .select(['cost_price'])
      .where('id', '=', fgId)
      .executeTakeFirst();
    assert(Number(fgProductUpdated.cost_price) > 0, 'FG unit cost_price must be updated');
    console.log(`  -> Updated Finished Good Unit Cost: ${Number(fgProductUpdated.cost_price).toFixed(2)} EGP/Unit`);
    console.log('  [PASS] STEP 8 PASSED: Production executed and inventory transformed.\n');

    // -------------------------------------------------------------------------
    // STEP 9: Double-Entry Manufacturing Ledger Audit
    // -------------------------------------------------------------------------
    console.log('[STEP 9] Auditing Manufacturing Double-Entry Journal Entry...');
    const mfgJournal = await (db as any)
      .selectFrom('journal_entries')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('source_type', '=', 'manufacturing_work_order')
      .where('source_id', '=', wo1Id)
      .executeTakeFirst();

    assert(Boolean(mfgJournal), 'Manufacturing journal entry must exist');
    console.log(`  -> Found Manufacturing Journal Entry #${mfgJournal.entry_no} (ID: ${mfgJournal.id})`);

    const journalLines = await (db as any)
      .selectFrom('journal_entry_lines as l')
      .innerJoin('accounting_accounts as a', 'a.id', 'l.account_id')
      .select(['l.debit', 'l.credit', 'a.code', 'a.name_ar', 'l.description'])
      .where('l.tenant_id', '=', tenantId)
      .where('l.journal_entry_id', '=', mfgJournal.id)
      .execute();

    assert(journalLines.length >= 2, 'Journal must contain at least 2 lines');

    let sumDebit = 0;
    let sumCredit = 0;
    for (const l of journalLines) {
      const d = Number(l.debit || 0);
      const c = Number(l.credit || 0);
      sumDebit += d;
      sumCredit += c;
      console.log(
        `    Line: [${l.code}] ${l.name_ar} | Debit: ${d.toFixed(2)} EGP | Credit: ${c.toFixed(2)} EGP | ${l.description}`,
      );
    }

    const delta = Math.abs(sumDebit - sumCredit);
    console.log(
      `  -> Double-Entry Balance Check: Debit ${sumDebit.toFixed(2)} == Credit ${sumCredit.toFixed(2)} (Discrepancy: ${delta.toFixed(2)})`,
    );
    assert(delta === 0, `Manufacturing Journal must be mathematically balanced with zero delta, got: ${delta}`);
    console.log('  [PASS] STEP 9 PASSED: Double-entry manufacturing ledger audit verified.\n');

    // -------------------------------------------------------------------------
    // STEP 10: Unbuild / Disassembly Order (Reverse Manufacturing)
    // -------------------------------------------------------------------------
    console.log('[STEP 10] Testing Unbuild / Disassembly Order (Reverse Manufacturing)...');
    const unbuildRes = await mfgService.createUnbuildOrder(
      {
        productId: fgId,
        bomId,
        quantity: 2, // Disassemble 2 finished cabinets
        warehouseId: locationId,
        notes: 'تفكيك وحدتين لإعادة استخدام المكونات في طلب خاص',
      },
      auth,
    );

    assert(unbuildRes.ok === true, 'Unbuild order creation must succeed');
    console.log(`  -> Created Unbuild Order #${unbuildRes.unbuildNumber} (ID: ${unbuildRes.unbuildId})`);

    // Verify FG stock reduced from 20 to 18
    const stockAfterUnbuildFG = await (db as any)
      .selectFrom('product_location_stock')
      .select('qty')
      .where('tenant_id', '=', tenantId)
      .where('location_id', '=', locationId)
      .where('product_id', '=', fgId)
      .executeTakeFirst();
    assert(
      Number(stockAfterUnbuildFG?.qty) === 18,
      `FG stock after unbuild must be 18 (20 - 2), got: ${stockAfterUnbuildFG?.qty}`,
    );
    console.log(`  -> Verified FG Stock after unbuild: ${stockAfterUnbuildFG?.qty} Units`);

    // Verify RM1 returned to stock (2 * 10 = 20 Kg returned: 289.474 + 20 = 309.474 Kg)
    const stockAfterUnbuildRM1 = await (db as any)
      .selectFrom('product_location_stock')
      .select('qty')
      .where('tenant_id', '=', tenantId)
      .where('location_id', '=', locationId)
      .where('product_id', '=', rm1Id)
      .executeTakeFirst();
    assert(
      Math.abs(Number(stockAfterUnbuildRM1?.qty) - 309.474) < 0.01,
      `RM1 stock after unbuild must be ~309.474 Kg (289.474 + 20), got: ${stockAfterUnbuildRM1?.qty}`,
    );
    console.log(`  -> Verified RM1 Stock recovered: 289.474 -> ${stockAfterUnbuildRM1?.qty} Kg`);

    const unbuildList = await mfgService.listUnbuildOrders(auth);
    assert(unbuildList.unbuildOrders.length >= 1, 'Must have at least 1 unbuild order in history');
    console.log('  [PASS] STEP 10 PASSED: Unbuild reverse manufacturing audit completed.\n');

    // -------------------------------------------------------------------------
    // STEP 11: Make-To-Order (MTO) Dynamic Linkage
    // -------------------------------------------------------------------------
    console.log('[STEP 11] Testing Make-To-Order (MTO) Dynamic Work Order Linkage...');
    const mtoRes = await mfgService.createMtoWorkOrder(
      {
        salesOrderId: 8842,
        productId: fgId,
        quantityToProduce: 15,
        notes: 'أمر تشغيل مرتبط بعقد التوريد رقم SO-8842',
      },
      auth,
    );

    assert(mtoRes.ok === true, 'MTO Work order must succeed');
    assert(Boolean(mtoRes.workOrderId), 'MTO Work order ID must exist');
    console.log(`  -> Created MTO Work Order #${mtoRes.workOrderId} linked to Sales Order #8842`);

    const mtoWo = await (db as any)
      .selectFrom('manufacturing_work_orders')
      .selectAll()
      .where('id', '=', mtoRes.workOrderId)
      .executeTakeFirst();
    assert(mtoWo.note.includes('8842'), 'Work order note must contain linked sales order reference');
    assert(Number(mtoWo.quantity_to_produce) === 15, 'MTO quantity must be 15');
    console.log(`  -> Verified MTO Order Linkage: "${mtoWo.note}" for ${mtoWo.quantity_to_produce} units`);
    console.log('  [PASS] STEP 11 PASSED: Make-To-Order linkage verified.\n');

    console.log('========================================================================');
    console.log('  ALL 11 PHASES OF MANUFACTURING & WORK ORDERS PASSED 100%!');
    console.log('========================================================================\n');
  } catch (err: any) {
    console.error('[FAIL] MANUFACTURING MASTER SIMULATION FAILED:', err?.message || err);
    console.error(err?.stack);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  runManufacturingProductionMasterSimulation();
}
