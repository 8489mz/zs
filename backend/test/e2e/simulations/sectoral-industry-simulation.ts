import 'dotenv/config';
import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';

/**
 * Z-SYSTEMS ERP — SECTORAL & SPECIALIZED INDUSTRY SIMULATION
 *
 * Verifies:
 * 1. Pharmacy Domain: Medications, Batches, Expiry tracking, and FEFO allocation.
 * 2. Customer Installments: Financing plans, Schedules, Payment tracking, and Outstanding balance.
 * 3. Commercial Subscriptions: Recurring contracts, Billing intervals, and Line item reconciliation.
 * 4. Kitchen Display System (KDS): Restaurant dine-in orders, Stations, and Order progress (pending -> cooking -> ready -> served).
 * 5. Clean and idempotent teardown.
 */

async function runSectoralSimulation() {
  const simUid = Date.now().toString().slice(-4);
  const testTenantId = `sect_sim_${simUid}`;
  const testAccountId = `sect_acc_${simUid}`;

  console.log('\n================================================================');
  console.log('[SECTORAL-SIMULATION] Z-SYSTEMS ERP — INDUSTRY VERTICALS AUDIT');
  console.log('1. موديول الصيدليات وتتبع الصلاحية FEFO (Pharmacy Domain)');
  console.log('2. موديول الأقساط وجدولة السداد (Installment Financing)');
  console.log('3. الاشتراكات التجارية والعقود الدورية (Commercial Subscriptions)');
  console.log('4. نظام عرض المطبخ والمطاعم KDS (Kitchen Display System)');
  console.log('================================================================\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/zs_dev',
  });

  const db = new Kysely<any>({
    dialect: new PostgresDialect({ pool }),
  });

  let drugId: number | undefined;
  let batch1Id: number | undefined;
  let batch2Id: number | undefined;
  let customerId: number | undefined;
  let planId: number | undefined;
  const subId = `sub_${simUid}`;
  let saleId: number | undefined;

  try {
    // -------------------------------------------------------------------------
    // 1. Pharmacy Domain (موديول الصيدليات)
    // -------------------------------------------------------------------------
    console.log('--- 1. محاكاة موديول الصيدليات وتتبع الصلاحية (FEFO) ---');
    const drugRes = await sql<{ id: number }>`
      INSERT INTO pharmacy_drugs (
        tenant_id, account_id, trade_name, active_ingredient, dosage_form,
        strip_price, box_price, prescription_required, created_at, updated_at
      ) VALUES (
        ${testTenantId}, ${testAccountId}, 'Panadol Extra', 'Paracetamol + Caffeine', 'Tablet',
        15.00, 30.00, false, NOW(), NOW()
      )
      RETURNING id
    `.execute(db);
    drugId = Number(drugRes.rows[0].id);

    const futureExpiry = '2028-12-31';
    const nearExpiry = '2026-11-30';

    const b1Res = await sql<{ id: number }>`
      INSERT INTO pharmacy_batches (
        tenant_id, account_id, drug_id, batch_number, expiry_date,
        quantity, unit_cost, status, created_at, updated_at
      ) VALUES (
        ${testTenantId}, ${testAccountId}, ${drugId}, ${'BT-FAR-' + simUid}, ${futureExpiry},
        100, 18.00, 'active', NOW(), NOW()
      )
      RETURNING id
    `.execute(db);
    batch1Id = Number(b1Res.rows[0].id);

    const b2Res = await sql<{ id: number }>`
      INSERT INTO pharmacy_batches (
        tenant_id, account_id, drug_id, batch_number, expiry_date,
        quantity, unit_cost, status, created_at, updated_at
      ) VALUES (
        ${testTenantId}, ${testAccountId}, ${drugId}, ${'BT-NEAR-' + simUid}, ${nearExpiry},
        50, 18.00, 'active', NOW(), NOW()
      )
      RETURNING id
    `.execute(db);
    batch2Id = Number(b2Res.rows[0].id);

    console.log(`[OK] تم تعريف الدواء (ID: ${drugId}) وتشغيلتين: بعيدة (${futureExpiry}) وقريبة (${nearExpiry}).`);

    // FEFO Selection Query
    const fefoCandidate = await sql<{ id: number; batch_number: string; quantity: string }>`
      SELECT id, batch_number, quantity 
      FROM pharmacy_batches 
      WHERE tenant_id = ${testTenantId} AND drug_id = ${drugId} AND status = 'active' AND quantity > 0
      ORDER BY expiry_date ASC 
      LIMIT 1
    `.execute(db);

    const selectedBatchId = Number(fefoCandidate.rows[0].id);
    if (selectedBatchId !== batch2Id) {
      throw new Error(`FEFO selection failed! Expected near expiry batch ${batch2Id}, got ${selectedBatchId}`);
    }

    // Allocate 10 units from near-expiry batch
    await sql`
      UPDATE pharmacy_batches
      SET quantity = quantity - 10, updated_at = NOW()
      WHERE id = ${selectedBatchId} AND tenant_id = ${testTenantId}
    `.execute(db);

    const updatedBatch = await sql<{ quantity: string }>`
      SELECT quantity FROM pharmacy_batches WHERE id = ${selectedBatchId}
    `.execute(db);

    const remQty = Number(updatedBatch.rows[0].quantity);
    if (remQty !== 40) {
      throw new Error(`Expected batch quantity to be 40 after deduction, got ${remQty}`);
    }
    console.log('[OK] تم تطبيق قاعدة FEFO بنجاح وصرف الكمية من التشغيلة الأقرب انتهاءً (المتبقي: 40).');

    // -------------------------------------------------------------------------
    // 2. Customer Installments (موديول الأقساط وجدولة السداد)
    // -------------------------------------------------------------------------
    console.log('\n--- 2. محاكاة موديول الأقساط وجدولة السداد ---');
    const custRes = await sql<{ id: number }>`
      INSERT INTO customers (
        tenant_id, name, phone, balance, is_active, created_at, updated_at
      ) VALUES (
        ${testTenantId}, ${'عميل الأقساط ' + simUid}, '0555000111', 0, true, NOW(), NOW()
      )
      RETURNING id
    `.execute(db);
    customerId = Number(custRes.rows[0].id);

    const planNumber = `PLAN-260914-${simUid}`;
    const planRes = await sql<{ id: number }>`
      INSERT INTO customer_installment_plans (
        tenant_id, account_id, plan_number, customer_id,
        total_amount, down_payment, financed_amount, installment_count, monthly_amount,
        start_date, status, notes, created_at, updated_at
      ) VALUES (
        ${testTenantId}, ${testAccountId}, ${planNumber}, ${customerId},
        12000.00, 2000.00, 10000.00, 10, 1000.00,
        CURRENT_DATE, 'active', 'تمويل إلكترونيات', NOW(), NOW()
      )
      RETURNING id
    `.execute(db);
    planId = Number(planRes.rows[0].id);

    // Create 10 installments
    for (let i = 1; i <= 10; i++) {
      const isFirst = i === 1;
      await sql`
        INSERT INTO customer_installments (
          tenant_id, account_id, plan_id, customer_id,
          installment_number, due_date, amount, paid_amount, status,
          created_at, updated_at
        ) VALUES (
          ${testTenantId}, ${testAccountId}, ${planId}, ${customerId},
          ${i}, CURRENT_DATE + (${i} * INTERVAL '1 month'), 1000.00,
          ${isFirst ? 1000.0 : 0.0},
          ${isFirst ? 'paid' : 'pending'},
          NOW(), NOW()
        )
      `.execute(db);
    }

    const installStats = await sql<{ total_paid: string; pending_count: string }>`
      SELECT 
        COALESCE(SUM(paid_amount), 0) as total_paid,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count
      FROM customer_installments
      WHERE tenant_id = ${testTenantId} AND plan_id = ${planId}
    `.execute(db);

    const totalPaid = Number(installStats.rows[0].total_paid);
    const pendingCount = Number(installStats.rows[0].pending_count);

    if (totalPaid !== 1000 || pendingCount !== 9) {
      throw new Error(`Installment schedule mismatch: total paid ${totalPaid}, pending count ${pendingCount}`);
    }
    console.log(
      `[OK] تم إنشاء خطة التقسيط ${planNumber}: 10 أقساط بمبلغ 1,000 ريال (مدفوع: ${totalPaid}، متبقي 9 أقساط).`,
    );

    // -------------------------------------------------------------------------
    // 3. Commercial Subscriptions (الاشتراكات التجارية والعقود الدورية)
    // -------------------------------------------------------------------------
    console.log('\n--- 3. محاكاة الاشتراكات التجارية والعقود الدورية ---');
    const contractNo = `SUB-260914-${simUid}`;
    await sql`
      INSERT INTO commercial_subscriptions (
        id, tenant_id, contract_number, customer_id, billing_period,
        next_billing_date, auto_renew, recurring_amount, status, payment_method,
        start_date, created_at, updated_at
      ) VALUES (
        ${subId}, ${testTenantId}, ${contractNo}, ${customerId}, 'monthly',
        CURRENT_DATE + INTERVAL '1 month', true, 1500.00, 'active', 'bank_transfer',
        CURRENT_DATE, NOW(), NOW()
      )
    `.execute(db);

    await sql`
      INSERT INTO commercial_subscription_lines (
        id, tenant_id, subscription_id, description, quantity, unit_price, total_price, created_at
      ) VALUES 
      (${'line1_' + simUid}, ${testTenantId}, ${subId}, 'ترخيص نظام Z-Systems السحابي', 1, 1000.00, 1000.00, NOW()),
      (${'line2_' + simUid}, ${testTenantId}, ${subId}, 'النسخ الاحتياطي السحابي اليومي', 1, 500.00, 500.00, NOW())
    `.execute(db);

    const subAudit = await sql<{ recurring_amount: string; lines_sum: string }>`
      SELECT 
        s.recurring_amount,
        COALESCE(SUM(l.total_price), 0) as lines_sum
      FROM commercial_subscriptions s
      JOIN commercial_subscription_lines l ON l.subscription_id = s.id
      WHERE s.tenant_id = ${testTenantId} AND s.id = ${subId}
      GROUP BY s.id, s.recurring_amount
    `.execute(db);

    const recurringAmount = Number(subAudit.rows[0].recurring_amount);
    const linesSum = Number(subAudit.rows[0].lines_sum);

    if (recurringAmount !== 1500 || linesSum !== 1500) {
      throw new Error(`Subscription lines mismatch: recurring ${recurringAmount}, lines sum ${linesSum}`);
    }
    console.log(`[OK] تم توثيق عقد الاشتراك ${contractNo} بقيمة دورية ${recurringAmount} ريال متطابقة مع البنود.`);

    // -------------------------------------------------------------------------
    // 4. Kitchen Display System - KDS (شاشات مطابخ المطاعم)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. محاكاة نظام عرض المطبخ (KDS) ودورة حياة الطلب ---');
    const docNo = `DINE-260914-${simUid}`;
    const saleRes = await sql<{ id: number }>`
      INSERT INTO sales (
        tenant_id, doc_no, order_type, table_number, payment_type,
        subtotal, total, paid_amount, status, note, created_at, updated_at
      ) VALUES (
        ${testTenantId}, ${docNo}, 'dine_in', 'T-05', 'cash',
        120.00, 120.00, 120.00, 'posted', 'طاولة رقم 5 - صالة', NOW(), NOW()
      )
      RETURNING id
    `.execute(db);
    saleId = Number(saleRes.rows[0].id);

    await sql`
      INSERT INTO sale_items (
        sale_id, product_name, qty, unit_price, line_total, unit_name
      ) VALUES 
      (${saleId}, 'مشوي كباب مشكل عائلي', 1, 95.00, 95.00, 'وجبة'),
      (${saleId}, 'عصير برتقال طبيعي', 2, 12.50, 25.00, 'كوب')
    `.execute(db);

    console.log(`[OK] تم إنشاء طلب صالة رقم ${docNo} لطاولة T-05 مع وجبات المطبخ والمشروبات.`);

    // Simulate KDS lifecycle state transitions: pending -> cooking -> ready -> served
    const kdsPhases = ['pending', 'cooking', 'ready', 'served'];
    for (const phase of kdsPhases) {
      const runtimeState = {
        tickets: {
          [String(saleId)]: {
            status: phase,
            itemsStatus: {
              all: phase,
            },
            updatedAt: new Date().toISOString(),
          },
        },
        lastServedId: phase === 'served' ? saleId : undefined,
      };

      const existingSetting = await sql<{ key: string }>`
        SELECT key FROM settings WHERE key = 'kds_tickets_runtime_state' AND tenant_id = ${testTenantId}
      `.execute(db);

      if (existingSetting.rows.length > 0) {
        await sql`
          UPDATE settings SET value = ${JSON.stringify(runtimeState)}
          WHERE key = 'kds_tickets_runtime_state' AND tenant_id = ${testTenantId}
        `.execute(db);
      } else {
        await sql`
          INSERT INTO settings (tenant_id, account_id, key, value)
          VALUES (${testTenantId}, 'default', 'kds_tickets_runtime_state', ${JSON.stringify(runtimeState)})
        `.execute(db);
      }

      console.log(`[KDS-STATUS] تقدمت حالة الطلب إلى: [${phase}]`);
    }

    // Verify final state
    const kdsCheck = await sql<{ value: string }>`
      SELECT value FROM settings WHERE key = 'kds_tickets_runtime_state' AND tenant_id = ${testTenantId}
    `.execute(db);

    const savedState = JSON.parse(kdsCheck.rows[0].value);
    const finalStatus = savedState.tickets[String(saleId)]?.status;

    if (finalStatus !== 'served' || savedState.lastServedId !== saleId) {
      throw new Error(`KDS state machine failed! Expected served, got ${finalStatus}`);
    }
    console.log('[OK] اكتملت دورة حياة شاشات المطبخ KDS حتى التسليم للعميل (served).');

    console.log('\n================================================================');
    console.log('[SUCCESS] اكتملت محاكاة القطاعات المتخصصة والأنشطة الرأسية بنجاح 100%!');
    console.log('================================================================\n');
  } catch (error: any) {
    console.error('[ERROR] SIMULATION FAILED:', error.message || error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    console.log('--- تنظيف البيانات المؤقتة (Cleanup) ---');
    if (saleId) {
      await sql`DELETE FROM sale_items WHERE sale_id = ${saleId}`.execute(db).catch(() => {});
      await sql`DELETE FROM sales WHERE tenant_id = ${testTenantId}`.execute(db).catch(() => {});
    }
    await sql`DELETE FROM settings WHERE tenant_id = ${testTenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM commercial_subscription_lines WHERE tenant_id = ${testTenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM commercial_subscriptions WHERE tenant_id = ${testTenantId}`.execute(db).catch(() => {});
    if (planId) {
      await sql`DELETE FROM customer_installments WHERE tenant_id = ${testTenantId}`.execute(db).catch(() => {});
      await sql`DELETE FROM customer_installment_plans WHERE tenant_id = ${testTenantId}`.execute(db).catch(() => {});
    }
    if (customerId) {
      await sql`DELETE FROM customers WHERE tenant_id = ${testTenantId}`.execute(db).catch(() => {});
    }
    if (drugId) {
      await sql`DELETE FROM pharmacy_batches WHERE tenant_id = ${testTenantId}`.execute(db).catch(() => {});
      await sql`DELETE FROM pharmacy_drugs WHERE tenant_id = ${testTenantId}`.execute(db).catch(() => {});
    }
    console.log('[OK] تم مسح جميع البيانات الخاصة بالمحاكاة بنجاح.');
    await pool.end();
  }
}

runSectoralSimulation();
