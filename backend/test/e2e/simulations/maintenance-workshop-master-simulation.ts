import assert from 'node:assert';
import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Database } from '../../../src/database/database.types';
import { TransactionHelper } from '../../../src/database/helpers/transaction.helper';
import { AuditService } from '../../../src/core/audit/audit.service';
import { MaintenanceService } from '../../../src/modules/maintenance/maintenance.service';
import { TradeInService } from '../../../src/modules/tradein/tradein.service';
import { AccountingPostingService } from '../../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../../src/modules/accounting/accounting-tenant-foundation.service';
import { VanFleetService } from '../../../src/modules/delivery-reps/services/van-fleet.service';
import { applyStockDelta } from '../../../src/common/utils/location-stock-ledger';
import { AuthContext } from '../../../src/core/auth/interfaces/auth-context.interface';

/**
 * MASTER E2E SIMULATION: MAINTENANCE, WORKSHOP, TRADE-IN & FLEET PREVENTATIVE CARE
 *
 * Verifies full operational, inventory, treasury, and security lifecycles:
 * 1. Master catalog setup for repair spare parts
 * 2. Device intake with advance deposit payment to treasury
 * 3. Privacy & security compliance: passcode masking in listings
 * 4. Diagnostic status transitions (received -> inspecting)
 * 5. Inventory shortage defense guards on spare parts
 * 6. Authorized spare part consumption & stock movements
 * 7. Spare part cancellation & inventory restoration
 * 8. Workshop repair completion timestamping
 * 9. Customer delivery & final treasury revenue settlement
 * 10. Trade-in used equipment intake, catalog generation & treasury expense
 * 11. Fleet vehicle oil change tracking & proactive threshold alerts (warning/critical)
 * 12. Deletion safety net: automatic spare parts stock recovery upon ticket cancellation
 */
async function runMaintenanceWorkshopMasterSimulation() {
  console.log('========================================================================');
  console.log('  STARTING COMPREHENSIVE END-TO-END WORKSHOP & MAINTENANCE SIMULATION');
  console.log('========================================================================\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/zs_dev',
  });

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

  const tx = new TransactionHelper();
  const audit = new AuditService(db);
  const maintenanceService = new MaintenanceService(
    db,
    tx,
    audit,
    new AccountingPostingService(new AccountingTenantFoundationService()),
    new AccountingTenantFoundationService(),
  );
  const tradeInService = new TradeInService(
    db,
    tx,
    audit,
    new AccountingPostingService(new AccountingTenantFoundationService()),
  );
  const fleetService = new VanFleetService(db);

  const tenantId = 'zs';
  const accountId = 'zs';
  const userId = 46;

  const auth: AuthContext = {
    userId,
    sessionId: 'session-maint-sim',
    username: 'admin',
    role: 'admin',
    permissions: ['*'],
    tenantId,
    accountId,
  };

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Verify Location & Setup Repair Spare Parts Catalog
    // -------------------------------------------------------------------------
    console.log('[STEP 1] Setting up Workshop Location & Repair Spare Parts Catalog...');
    const location = await (db as any)
      .selectFrom('stock_locations')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', 40)
      .executeTakeFirst();

    const locationId = location ? Number(location.id) : 40;
    console.log(`  -> Using Workshop Warehouse Location ID: ${locationId}`);

    const uniqueSuffix = Date.now().toString();

    // 1. OLED Screen
    const screenRes = await (db as any)
      .insertInto('products')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        name: `شاشة أصلية سوبر أموليد 6.7 بوصة - كود #${uniqueSuffix}`,
        item_kind: 'standard',
        item_type: 'product',
        cost_price: 500,
        retail_price: 1100,
        wholesale_price: 900,
        stock_qty: 0,
        is_active: true,
      })
      .returning(['id', 'name'])
      .executeTakeFirstOrThrow();
    const screenPartId = Number(screenRes.id);

    // 2. Lithium Battery
    const batteryRes = await (db as any)
      .insertInto('products')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        name: `بطارية ليثيوم بوليمر 5000mAh - كود #${uniqueSuffix}`,
        item_kind: 'standard',
        item_type: 'product',
        cost_price: 180,
        retail_price: 350,
        wholesale_price: 280,
        stock_qty: 0,
        is_active: true,
      })
      .returning(['id', 'name'])
      .executeTakeFirstOrThrow();
    const batteryPartId = Number(batteryRes.id);

    // Seed stock: 10 screens, 15 batteries
    await (db as any).transaction().execute(async (trx: any) => {
      await applyStockDelta(trx, {
        productId: screenPartId,
        delta: 10,
        branchId: null,
        locationId,
        tenantId,
        accountId,
      });

      await applyStockDelta(trx, {
        productId: batteryPartId,
        delta: 15,
        branchId: null,
        locationId,
        tenantId,
        accountId,
      });
    });

    console.log(`  -> Screen Spare Part [ID: ${screenPartId}] Seeded: 10 Units @ 500 EGP Cost / 1,100 EGP Price`);
    console.log(`  -> Battery Spare Part [ID: ${batteryPartId}] Seeded: 15 Units @ 180 EGP Cost / 350 EGP Price`);
    console.log('  [PASS] STEP 1 PASSED: Workshop spare parts catalog ready.\n');

    // -------------------------------------------------------------------------
    // STEP 2: Device Intake & Maintenance Ticket Creation with Advance Payment
    // -------------------------------------------------------------------------
    console.log('[STEP 2] Creating Maintenance Ticket with Advance Cash Deposit...');
    const advanceAmount = 400;
    const ticketCreateRes = await maintenanceService.createTicket(
      {
        customerName: 'م. أحمد الشناوي - شركة المقاولات الحديثة',
        customerPhone: '01012345678',
        deviceBrand: 'Apple',
        deviceModel: 'iPhone 14 Pro Max',
        serialNumber: `IMEI-3589410928374-${uniqueSuffix}`,
        passcode: '998877',
        problemDescription: 'كسر بالشاشة الخارجية وتفريغ شحن سريع',
        deviceCondition: 'خدوش سطحية بالهيكل الخلفي بدون كسور',
        expectedCost: 1600,
        finalCost: 1600,
        advancePayment: advanceAmount,
        warrantyDays: 60,
        locationId,
      },
      auth,
    );

    assert(ticketCreateRes.ok === true, 'Ticket creation must succeed');
    const ticketId = Number(ticketCreateRes.id);
    const ticketNo = ticketCreateRes.ticketNo;
    assert(Boolean(ticketNo.startsWith('ZM-')), `Ticket number must follow ZM-YYMMDD-XXXX format, got: ${ticketNo}`);
    console.log(`  -> Created Maintenance Ticket #${ticketNo} (ID: ${ticketId})`);

    // Verify Treasury Deposit
    const advanceTxn = await (db as any)
      .selectFrom('treasury_transactions')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('reference_type', '=', 'maintenance_ticket')
      .where('reference_id', '=', ticketId)
      .where('txn_type', '=', 'revenue')
      .where('note', 'like', `%${ticketNo}%`)
      .orderBy('id', 'desc')
      .executeTakeFirst();

    assert(Boolean(advanceTxn), 'Advance payment must create a treasury revenue transaction');
    assert(
      Number(advanceTxn.amount) === advanceAmount,
      `Treasury amount must be ${advanceAmount}, got: ${advanceTxn.amount}`,
    );
    console.log(`  -> Verified Treasury Advance Revenue: ${advanceTxn.amount} EGP recorded atomically.`);
    console.log('  [PASS] STEP 2 PASSED: Ticket created and advance payment secured.\n');

    // -------------------------------------------------------------------------
    // STEP 3: Privacy & Security Compliance: Passcode Masking in Listing
    // -------------------------------------------------------------------------
    console.log('[STEP 3] Auditing Passcode Privacy Masking in Listing APIs...');
    const listRes = await maintenanceService.listTickets(auth, { q: 'الشناوي' });
    const listedTicket = listRes.tickets.find((t) => t.id === String(ticketId));
    assert(Boolean(listedTicket), 'Ticket must be found in listing');
    assert(
      listedTicket?.passcode === '******',
      `Passcode in ticket listing must be masked with '******', got: ${listedTicket?.passcode}`,
    );
    console.log(`  -> Verified Passcode Masked in List View: "${listedTicket?.passcode}"`);

    // Direct fetch must reveal actual passcode for authorized technician
    const singleTicketRes = await maintenanceService.getTicket(ticketId, auth);
    assert(singleTicketRes.ticket.passcode === '998877', 'Single ticket details must expose passcode for technician');
    console.log(
      `  -> Verified Authorized Technician Detail View reveals original passcode: "${singleTicketRes.ticket.passcode}"`,
    );
    console.log('  [PASS] STEP 3 PASSED: Passcode privacy & security verified.\n');

    // -------------------------------------------------------------------------
    // STEP 4: Diagnostic Inspection Status Transition
    // -------------------------------------------------------------------------
    console.log('[STEP 4] Updating Ticket Status to Inspection (inspecting)...');
    await maintenanceService.updateTicketStatus(
      ticketId,
      {
        status: 'inspecting',
        technicianNotes: 'تم فحص اللوحة الأم سليمة — تحتاج استبدال شاشة وتغيير بطارية',
      },
      auth,
    );

    const ticketAfterInspection = await maintenanceService.getTicket(ticketId, auth);
    assert(ticketAfterInspection.ticket.status === 'inspecting', 'Ticket status must be inspecting');
    console.log(`  -> Ticket Status Updated: [${ticketAfterInspection.ticket.status}] with technician notes`);
    console.log('  [PASS] STEP 4 PASSED: Inspection lifecycle updated.\n');

    // -------------------------------------------------------------------------
    // STEP 5: Inventory Shortage Guard Enforcement on Spare Parts
    // -------------------------------------------------------------------------
    console.log('[STEP 5] Testing Shortage Defense Guard on Excessive Spare Part Request...');
    let shortageBlocked = false;
    try {
      await maintenanceService.addPart(
        ticketId,
        {
          productId: screenPartId,
          productName: 'شاشة أصلية سوبر أموليد',
          qty: 999, // only 10 available
          unitPrice: 1100,
          unitCost: 500,
          locationId,
        },
        auth,
      );
    } catch (err: any) {
      shortageBlocked = true;
      console.log(`  -> Shortage Guard correctly blocked request: [${err.code || err.name}] ${err.message}`);
    }
    assert(shortageBlocked === true, 'Excessive spare part request must be blocked by stock guard');

    const screenStockCheck = await (db as any)
      .selectFrom('product_location_stock')
      .select('qty')
      .where('tenant_id', '=', tenantId)
      .where('location_id', '=', locationId)
      .where('product_id', '=', screenPartId)
      .executeTakeFirst();
    assert(Number(screenStockCheck?.qty) === 10, 'Screen stock must remain untouched at 10');
    console.log('  [PASS] STEP 5 PASSED: Shortage defense strictly maintained stock integrity.\n');

    // -------------------------------------------------------------------------
    // STEP 6: Authorized Spare Part Consumption & Stock Deductions
    // -------------------------------------------------------------------------
    console.log('[STEP 6] Consuming Authorized Spare Parts for Ticket...');
    // 1. Add Screen (qty: 1, price: 1100)
    const partScreenRes = await maintenanceService.addPart(
      ticketId,
      {
        productId: screenPartId,
        productName: 'شاشة أصلية سوبر أموليد',
        qty: 1,
        unitPrice: 1100,
        unitCost: 500,
        locationId,
      },
      auth,
    );
    assert(partScreenRes.ok === true, 'Screen part addition must succeed');

    // 2. Add Battery (qty: 1, price: 350)
    const partBatteryRes = await maintenanceService.addPart(
      ticketId,
      {
        productId: batteryPartId,
        productName: 'بطارية ليثيوم بوليمر 5000mAh',
        qty: 1,
        unitPrice: 350,
        unitCost: 180,
        locationId,
      },
      auth,
    );
    assert(partBatteryRes.ok === true, 'Battery part addition must succeed');

    // Verify Stock deductions
    const screenStockPost = await (db as any)
      .selectFrom('product_location_stock')
      .select('qty')
      .where('tenant_id', '=', tenantId)
      .where('location_id', '=', locationId)
      .where('product_id', '=', screenPartId)
      .executeTakeFirst();
    assert(Number(screenStockPost?.qty) === 9, `Screen stock must be 9 (10 - 1), got: ${screenStockPost?.qty}`);

    const batteryStockPost = await (db as any)
      .selectFrom('product_location_stock')
      .select('qty')
      .where('tenant_id', '=', tenantId)
      .where('location_id', '=', locationId)
      .where('product_id', '=', batteryPartId)
      .executeTakeFirst();
    assert(Number(batteryStockPost?.qty) === 14, `Battery stock must be 14 (15 - 1), got: ${batteryStockPost?.qty}`);

    console.log(`  -> Screen Stock deducted: 10 -> ${screenStockPost?.qty} Units`);
    console.log(`  -> Battery Stock deducted: 15 -> ${batteryStockPost?.qty} Units`);

    // Verify Stock movement audit row
    const moveRes = await (db as any)
      .selectFrom('stock_movements')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('reference_type', '=', 'maintenance_ticket')
      .where('reference_id', '=', ticketId)
      .where('movement_type', '=', 'maintenance_consumption')
      .execute();
    assert(moveRes.length === 2, `Must have 2 maintenance_consumption stock movement records, got: ${moveRes.length}`);
    console.log(`  -> Verified Stock Movement Ledger: ${moveRes.length} consumption movements logged.`);
    console.log('  [PASS] STEP 6 PASSED: Spare parts consumed and inventory ledgers audited.\n');

    // -------------------------------------------------------------------------
    // STEP 7: Spare Part Return / Cancellation Safety
    // -------------------------------------------------------------------------
    console.log('[STEP 7] Testing Spare Part Return / Cancellation Safety...');
    // Customer decides battery is still acceptable, cancel battery part
    const batteryPartIdInTicket = Number(partBatteryRes.partId);
    await maintenanceService.removePart(ticketId, batteryPartIdInTicket, auth);

    // Verify battery stock restored
    const batteryStockRestored = await (db as any)
      .selectFrom('product_location_stock')
      .select('qty')
      .where('tenant_id', '=', tenantId)
      .where('location_id', '=', locationId)
      .where('product_id', '=', batteryPartId)
      .executeTakeFirst();
    assert(
      Number(batteryStockRestored?.qty) === 15,
      `Battery stock must be restored to 15, got: ${batteryStockRestored?.qty}`,
    );
    console.log(`  -> Verified Battery Stock safely restored: 14 -> ${batteryStockRestored?.qty} Units`);

    // Verify return movement row
    const returnMove = await (db as any)
      .selectFrom('stock_movements')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('reference_type', '=', 'maintenance_ticket')
      .where('reference_id', '=', ticketId)
      .where('movement_type', '=', 'maintenance_return')
      .executeTakeFirst();
    assert(Boolean(returnMove), 'Must log maintenance_return stock movement');
    console.log(`  -> Verified Stock Movement Ledger: maintenance_return movement logged.`);
    console.log('  [PASS] STEP 7 PASSED: Part removed and inventory restored cleanly.\n');

    // -------------------------------------------------------------------------
    // STEP 8: Workshop Repair Completion Timestamping
    // -------------------------------------------------------------------------
    console.log('[STEP 8] Marking Ticket as Repaired (repaired)...');
    const finalRepairCost = 1450; // 1100 screen + 350 labor
    await maintenanceService.updateTicketStatus(
      ticketId,
      {
        status: 'repaired',
        finalCost: finalRepairCost,
        technicianNotes: 'تم تركيب الشاشة الأصلية ومعايرة ألوان TrueTone بنجاح',
      },
      auth,
    );

    const ticketRepaired = await maintenanceService.getTicket(ticketId, auth);
    assert(ticketRepaired.ticket.status === 'repaired', 'Status must be repaired');
    assert(Boolean(ticketRepaired.ticket.repairedAt), 'repairedAt timestamp must be set');
    assert(Number(ticketRepaired.ticket.finalCost) === finalRepairCost, 'Final cost must match 1450 EGP');
    console.log(
      `  -> Ticket Status: [${ticketRepaired.ticket.status}], Repaired At: ${ticketRepaired.ticket.repairedAt}`,
    );
    console.log('  [PASS] STEP 8 PASSED: Repair completion confirmed.\n');

    // -------------------------------------------------------------------------
    // STEP 9: Customer Handover & Final Treasury Settlement
    // -------------------------------------------------------------------------
    console.log('[STEP 9] Handing Over Device & Collecting Remaining Balance into Treasury...');
    // Final Cost = 1450 EGP, Advance = 400 EGP, Remaining to collect = 1050 EGP
    const remainingToCollect = finalRepairCost - advanceAmount;
    await maintenanceService.updateTicketStatus(
      ticketId,
      {
        status: 'delivered',
        collectedAmount: remainingToCollect,
      },
      auth,
    );

    const ticketDelivered = await maintenanceService.getTicket(ticketId, auth);
    assert(ticketDelivered.ticket.status === 'delivered', 'Status must be delivered');
    assert(Boolean(ticketDelivered.ticket.deliveredAt), 'deliveredAt timestamp must be set');

    // Verify Treasury final revenue transaction
    const finalTxn = await (db as any)
      .selectFrom('treasury_transactions')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('reference_type', '=', 'maintenance_ticket')
      .where('reference_id', '=', ticketId)
      .where('txn_type', '=', 'revenue')
      .where('amount', '=', remainingToCollect)
      .orderBy('id', 'desc')
      .executeTakeFirst();

    assert(Boolean(finalTxn), `Must record remaining collection of ${remainingToCollect} EGP in treasury`);
    console.log(`  -> Handover Completed at: ${ticketDelivered.ticket.deliveredAt}`);
    console.log(
      `  -> Verified Final Collection in Treasury: ${finalTxn.amount} EGP collected (Total 400 + 1050 = 1450 EGP).`,
    );
    console.log('  [PASS] STEP 9 PASSED: Delivery and treasury revenue settled.\n');

    // -------------------------------------------------------------------------
    // STEP 10: Trade-In (شراء المستعمل واستبدال الأجهزة) Workflow
    // -------------------------------------------------------------------------
    console.log('[STEP 10] Testing Trade-In Used Hardware Intake & Catalog Integration...');
    const tradeinRes = await tradeInService.createTransaction(
      {
        sellerName: 'كابتن محمود الغندور',
        sellerPhone: '01234567890',
        sellerNationalId: '29508140102554',
        deviceBrand: 'Samsung',
        deviceModel: 'Galaxy S23 Ultra 256GB Phantom Black',
        serialNumber: `R5CW-${uniqueSuffix}`,
        agreedPurchasePrice: 18500,
        deviceConditionState: 'like_new',
        deviceConditionNotes: 'بطارية 96% بحالة ممتازة وبدون أي خدوش ومع الكرتونة',
        autoAddToInventory: true,
        locationId,
        paymentMethod: 'cash',
      },
      auth,
    );

    assert(tradeinRes.ok === true, 'Trade-in transaction must succeed');
    assert(
      Boolean(tradeinRes.docNo.startsWith('TRD-')),
      `Trade-in docNo must follow TRD-YYMMDD-XXXX format, got: ${tradeinRes.docNo}`,
    );
    console.log(`  -> Created Trade-In Record #${tradeinRes.docNo} (ID: ${tradeinRes.id})`);

    // Verify Used Product added to catalog via getTransaction
    const tradeinDetails = await tradeInService.getTransaction(Number(tradeinRes.id), auth);
    assert(Boolean(tradeinDetails.transaction.createdProductId), 'Used product must be generated in catalog');
    const createdProductId = Number(tradeinDetails.transaction.createdProductId);
    const usedProduct = await (db as any)
      .selectFrom('products')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', createdProductId)
      .executeTakeFirst();

    assert(Boolean(usedProduct), 'Used product must exist in products table');
    assert(
      Number(usedProduct.cost_price) === 18500,
      `Used product cost must match agreed price 18500, got: ${usedProduct.cost_price}`,
    );
    console.log(
      `  -> Created Used Product in Catalog: [ID: ${usedProduct.id}] "${usedProduct.name}" (Cost: ${usedProduct.cost_price} EGP)`,
    );

    // Verify Stock increased by 1
    const usedStock = await (db as any)
      .selectFrom('product_location_stock')
      .select('qty')
      .where('tenant_id', '=', tenantId)
      .where('location_id', '=', locationId)
      .where('product_id', '=', createdProductId)
      .executeTakeFirst();
    assert(Number(usedStock?.qty) === 1, `Used product stock in location must be 1, got: ${usedStock?.qty}`);
    console.log(`  -> Verified Used Product Stock in Warehouse: ${usedStock?.qty} Unit`);

    // Verify Treasury Cash Disbursement
    const tradeinExpenseTxn = await (db as any)
      .selectFrom('treasury_transactions')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('reference_type', '=', 'trade_in')
      .where('reference_id', '=', Number(tradeinRes.id))
      .where('txn_type', '=', 'expense')
      .executeTakeFirst();

    assert(Boolean(tradeinExpenseTxn), 'Treasury expense transaction must be recorded for trade-in purchase');
    assert(
      Math.abs(Number(tradeinExpenseTxn.amount)) === 18500,
      `Treasury expense amount must be 18500, got: ${tradeinExpenseTxn.amount}`,
    );
    console.log(`  -> Verified Treasury Expense Disbursed: ${tradeinExpenseTxn.amount} EGP paid to seller.`);
    console.log('  [PASS] STEP 10 PASSED: Trade-in device purchase and inventory integration verified.\n');

    // -------------------------------------------------------------------------
    // STEP 11: Fleet Vehicle Oil Change Tracking & Preventative Alerts
    // -------------------------------------------------------------------------
    console.log('[STEP 11] Testing Fleet Vehicle Preventative Maintenance & Alerts...');
    // Create vehicle
    const vehicleRes = await (db as any)
      .insertInto('fleet_vehicles')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        plate_number: `ف ل ت-${uniqueSuffix.slice(-4)}`,
        model_name: 'تويوتا هايس فان ديزل 2023',
        vehicle_type: 'van',
        current_odometer: 75000,
        fuel_type: 'diesel',
        license_expires_at: new Date(Date.now() + 180 * 86400000).toISOString().split('T')[0],
        status: 'available',
      })
      .returning(['id', 'plate_number'])
      .executeTakeFirstOrThrow();

    const vehicleId = Number(vehicleRes.id);
    console.log(`  -> Registered Fleet Vehicle #${vehicleRes.plate_number} (ID: ${vehicleId}) @ 75,000 Km`);

    // Record Oil Change: Odometer 75,000 Km, rated 5,000 Km (next due: 80,000 Km), alertKmBefore: 500
    const oilRes = await fleetService.recordOilChange(tenantId, accountId, null, {
      vehicleId,
      odometerAtChange: 75000,
      ratedKm: 5000,
      alertKmBefore: 500,
      oilType: 'Mobil Delvac 1 ESP 5W-40',
      withFilter: true,
      cost: 1200,
      performedBy: 'مركز صيانة النصر المعتمد',
    });

    assert(oilRes.ok === true, 'Oil change recording must succeed');
    assert(oilRes.nextDueOdometer === 80000, `Next due odometer must be 80,000 Km, got: ${oilRes.nextDueOdometer}`);
    console.log(
      `  -> Recorded Oil Change: Next Due at ${oilRes.nextDueOdometer} Km (Alert Threshold: ${oilRes.alertKmBefore} Km)`,
    );

    // Scenario A: Vehicle travels to 79,600 Km (mremaining 400 Km <= 500 Km alert threshold) -> WARNING ALERT
    await (db as any)
      .updateTable('fleet_vehicles')
      .set({ current_odometer: 79600 })
      .where('id', '=', vehicleId)
      .where('tenant_id', '=', tenantId)
      .execute();

    const warningAlertsRes = await fleetService.getFleetMaintenanceAlerts(tenantId, vehicleId);
    const oilWarnAlert = warningAlertsRes.alerts.find((a) => a.vehicleId === vehicleId && a.type === 'oil_change');
    assert(Boolean(oilWarnAlert), 'Warning alert must trigger when within threshold');
    assert(oilWarnAlert?.severity === 'warning', `Alert severity must be warning, got: ${oilWarnAlert?.severity}`);
    console.log(
      `  -> [Alert Triggered] Severity: [${oilWarnAlert?.severity}] - "${oilWarnAlert?.title}" (${oilWarnAlert?.description})`,
    );

    // Scenario B: Vehicle travels to 80,250 Km (exceeded 80,000 Km by 250 Km) -> CRITICAL ALERT
    await (db as any)
      .updateTable('fleet_vehicles')
      .set({ current_odometer: 80250 })
      .where('id', '=', vehicleId)
      .where('tenant_id', '=', tenantId)
      .execute();

    const criticalAlertsRes = await fleetService.getFleetMaintenanceAlerts(tenantId, vehicleId);
    const oilCritAlert = criticalAlertsRes.alerts.find((a) => a.vehicleId === vehicleId && a.type === 'oil_change');
    assert(Boolean(oilCritAlert), 'Critical alert must trigger when overdue');
    assert(oilCritAlert?.severity === 'critical', `Alert severity must be critical, got: ${oilCritAlert?.severity}`);
    console.log(
      `  -> [Alert Triggered] Severity: [${oilCritAlert?.severity}] - "${oilCritAlert?.title}" (${oilCritAlert?.description})`,
    );
    console.log('  [PASS] STEP 11 PASSED: Proactive fleet maintenance alerts validated.\n');

    // -------------------------------------------------------------------------
    // STEP 12: Ticket Deletion Safety Net & Automatic Inventory Recovery
    // -------------------------------------------------------------------------
    console.log('[STEP 12] Testing Ticket Deletion Safety Net & Spare Part Restoration...');
    // Create temporary ticket
    const tempTicketRes = await maintenanceService.createTicket(
      {
        customerName: 'عميل اختبار الحذف',
        customerPhone: '01111111111',
        deviceModel: 'جهاز اختباري',
        problemDescription: 'فحص الحذف',
        locationId,
      },
      auth,
    );

    const tempTicketId = Number(tempTicketRes.id);

    // Consume 1 Screen part: Screen stock was 9, now becomes 8
    await maintenanceService.addPart(
      tempTicketId,
      {
        productId: screenPartId,
        productName: 'شاشة أصلية سوبر أموليد',
        qty: 1,
        unitPrice: 1100,
        unitCost: 500,
        locationId,
      },
      auth,
    );

    const screenStockBeforeDelete = await (db as any)
      .selectFrom('product_location_stock')
      .select('qty')
      .where('tenant_id', '=', tenantId)
      .where('location_id', '=', locationId)
      .where('product_id', '=', screenPartId)
      .executeTakeFirst();
    assert(
      Number(screenStockBeforeDelete?.qty) === 8,
      `Stock before delete must be 8, got: ${screenStockBeforeDelete?.qty}`,
    );

    // Now delete ticket
    await maintenanceService.deleteTicket(tempTicketId, auth);

    // Assert that Screen stock automatically restored to 9!
    const screenStockAfterDelete = await (db as any)
      .selectFrom('product_location_stock')
      .select('qty')
      .where('tenant_id', '=', tenantId)
      .where('location_id', '=', locationId)
      .where('product_id', '=', screenPartId)
      .executeTakeFirst();
    assert(
      Number(screenStockAfterDelete?.qty) === 9,
      `Screen stock must be restored to 9 after ticket deletion, got: ${screenStockAfterDelete?.qty}`,
    );
    console.log(`  -> Screen Stock safely restored on ticket deletion: 8 -> ${screenStockAfterDelete?.qty} Units`);

    // Verify ticket no longer exists
    let deletedTicketFound = false;
    try {
      await maintenanceService.getTicket(tempTicketId, auth);
      deletedTicketFound = true;
    } catch {
      deletedTicketFound = false;
    }
    assert(deletedTicketFound === false, 'Deleted ticket must not exist');
    console.log('  [PASS] STEP 12 PASSED: Deletion safety net successfully recovered inventory.\n');

    console.log('========================================================================');
    console.log('  ALL 12 PHASES OF MAINTENANCE, WORKSHOP & FLEET PASSED 100%!');
    console.log('========================================================================\n');
  } finally {
    await db.destroy();
  }
}

runMaintenanceWorkshopMasterSimulation()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n[FAIL] WORKSHOP MASTER SIMULATION FAILED:', err);
    process.exit(1);
  });
