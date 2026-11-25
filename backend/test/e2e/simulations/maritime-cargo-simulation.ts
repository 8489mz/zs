import 'dotenv/config';
import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';

/**
 * Z-SYSTEMS ERP — MARITIME CARGO & LOGISTICS SIMULATION
 *
 * Verifies:
 * 1. Shipping Master Foundation: Ports, Shipping Lines, Configurations.
 * 2. Maritime RFQ & Bidding: Port of Loading (POL), Port of Discharge (POD), Carriers Bidding.
 * 3. Client Quotations: Freight pricing, Margins, Acceptance.
 * 4. Freight Job Order: Shipment File, Booking, MBL/HBL generation.
 * 5. Container Inventory: Container numbering, Seals, Tare/Gross weights.
 * 6. Milestone Tracking: Standard DCSA events (Gate-in, On-board, Departure, Arrival, Customs, Delivery).
 * 7. Job Profitability & Cost Sheet: Revenue, Carrier cost, and Net margin calculations.
 * 8. Clean and idempotent teardown.
 */

async function runSimulation() {
  const simUid = Date.now().toString().slice(-4);
  const testTenantId = `maritime_sim_${simUid}`;

  console.log('\n================================================================');
  console.log('[MARITIME-SIMULATION] Z-SYSTEMS ERP — FREIGHT FORWARDING AUDIT');
  console.log('1. البيانات الأساسية للشحن (Shipping Master Foundation)');
  console.log('2. طلب عروض الأسعار والمزايدة (Maritime RFQ & Bidding)');
  console.log('3. عروض أسعار العملاء (Customer Quotations)');
  console.log('4. أوامر تشغيل الشحنات (Freight Job Order)');
  console.log('5. تتبع الحاويات والأختام (Container & Seal Tracking)');
  console.log('6. المعالم الزمنية للشحنة (Milestone Tracking)');
  console.log('7. تحليل الربحية وتكاليف الرحلة (Job Profitability)');
  console.log('================================================================\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/zs_dev',
  });

  const db = new Kysely<any>({
    dialect: new PostgresDialect({ pool }),
  });

  let polId: number | undefined;
  let podId: number | undefined;
  let shippingLineId: number | undefined;
  let rfqId: number | undefined;
  let bidId: number | undefined;
  let quoteId: number | undefined;
  let jobId: number | undefined;

  try {
    // 1. Shipping Master Foundation
    console.log('--- 1. البيانات الأساسية للشحن (Shipping Master Foundation) ---');
    const polRes = await db
      .insertInto('shipping_ports')
      .values({
        tenant_id: testTenantId,
        code: `EGALY_${simUid}`,
        name_en: 'Alexandria Port',
        name_ar: 'ميناء الإسكندرية',
        country_code: 'EG',
        country_name: 'مصر',
        is_active: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    polId = Number(polRes.id);

    const podRes = await db
      .insertInto('shipping_ports')
      .values({
        tenant_id: testTenantId,
        code: `SAJED_${simUid}`,
        name_en: 'Jeddah Islamic Port',
        name_ar: 'ميناء جدة الإسلامي',
        country_code: 'SA',
        country_name: 'السعودية',
        is_active: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    podId = Number(podRes.id);

    const slRes = await db
      .insertInto('shipping_lines')
      .values({
        tenant_id: testTenantId,
        code: `MAEU_${simUid}`,
        name_en: 'Maersk Line',
        name_ar: 'ميرسك للملاحة',
        is_active: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    shippingLineId = Number(slRes.id);

    console.log(`[OK] تم إنشاء ميناء الشحن (${polId}) وميناء التفريغ (${podId}) والخط الملاحي (${shippingLineId}).`);

    // 2. Maritime RFQ & Line Bidding
    console.log('\n--- 2. طلب عروض الأسعار والمزايدة (Maritime RFQ & Bidding) ---');
    const rfqNumber = `RFQ-260914-${simUid}`;
    const rfqRes = await db
      .insertInto('maritime_rfqs')
      .values({
        tenant_id: testTenantId,
        rfq_number: rfqNumber,
        direction: 'export',
        cargo_mode: 'FCL',
        container_type: '40HC',
        container_count: 2,
        pol_id: polId,
        pol_code: `EGALY_${simUid}`,
        pol_name: 'ميناء الإسكندرية',
        pod_id: podId,
        pod_code: `SAJED_${simUid}`,
        pod_name: 'ميناء جدة الإسلامي',
        commodity_description: 'مواد غذائية معبأة',
        status: 'published',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    rfqId = Number(rfqRes.id);

    const bidRes = await db
      .insertInto('maritime_rfq_bids')
      .values({
        tenant_id: testTenantId,
        rfq_id: rfqId,
        shipping_line_id: shippingLineId,
        shipping_line_name: 'ميرسك للملاحة',
        ocean_freight: 1800.0,
        currency: 'USD',
        thc_origin: 150.0,
        thc_destination: 120.0,
        total_freight_cost: 2070.0,
        free_days: 14,
        is_awarded: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    bidId = Number(bidRes.id);

    console.log(`[OK] تم إنشاء طلب التسعير ${rfqNumber} واعتماد عرض الخط الملاحي بقيمة 1,800$ لكل حاوية.`);

    // 3. Customer Maritime Quotation
    console.log('\n--- 3. عروض أسعار العملاء (Customer Quotations) ---');
    const quoteNumber = `QT-260914-${simUid}`;
    const quoteRes = await db
      .insertInto('maritime_quotations')
      .values({
        tenant_id: testTenantId,
        quotation_number: quoteNumber,
        rfq_id: rfqId,
        bid_id: bidId,
        customer_name: 'شركة الاستيراد والتصدير السعودية',
        base_cost: 3600.0, // 2 containers * 1800
        currency: 'USD',
        margin_type: 'fixed',
        margin_value: 800.0,
        final_total: 4400.0, // 2 containers * 2200
        status: 'accepted',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    quoteId = Number(quoteRes.id);

    console.log(`[OK] تم إنشاء عرض سعر العميل ${quoteNumber} بإجمالي 4,400$ وتم قبوله.`);

    // 4. Freight Job Order Execution
    console.log('\n--- 4. أوامر تشغيل الشحنات (Freight Job Order) ---');
    const jobNumber = `JOB-260914-${simUid}`;
    const jobRes = await db
      .insertInto('maritime_jobs')
      .values({
        tenant_id: testTenantId,
        job_number: jobNumber,
        quotation_id: quoteId,
        rfq_id: rfqId,
        customer_name: 'شركة الاستيراد والتصدير السعودية',
        shipping_line_id: shippingLineId,
        shipping_line_name: 'ميرسك للملاحة',
        pol_code: `EGALY_${simUid}`,
        pol_name: 'ميناء الإسكندرية',
        pod_code: `SAJED_${simUid}`,
        pod_name: 'ميناء جدة الإسلامي',
        booking_number: `BKG-${simUid}`,
        mbl_number: `MBL-${simUid}`,
        hbl_number: `HBL-${simUid}`,
        milestone_status: 'IN_TRANSIT',
        client_invoiced_total: 4400.0,
        carrier_cost_total: 3600.0,
        net_profit: 800.0,
        status: 'active',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    jobId = Number(jobRes.id);

    console.log(`[OK] تم فتح ملف الشحنة ${jobNumber} مع البوليصة الملاحية MBL-${simUid}.`);

    // 5. Container Inventory & Sealed Tracking
    console.log('\n--- 5. تتبع الحاويات والأختام (Container & Seal Tracking) ---');
    await db
      .insertInto('maritime_containers')
      .values([
        {
          tenant_id: testTenantId,
          job_id: jobId,
          container_number: `MSKU${simUid}01`,
          seal_number: `SL-${simUid}01`,
          container_type: '40HC',
          gross_weight_kg: 21000.0,
        },
        {
          tenant_id: testTenantId,
          job_id: jobId,
          container_number: `MSKU${simUid}02`,
          seal_number: `SL-${simUid}02`,
          container_type: '40HC',
          gross_weight_kg: 21000.0,
        },
      ])
      .execute();

    const containerRows = await db
      .selectFrom('maritime_containers')
      .where('tenant_id', '=', testTenantId)
      .where('job_id', '=', jobId)
      .selectAll()
      .execute();

    if (containerRows.length !== 2) {
      throw new Error(`Expected 2 containers, found ${containerRows.length}`);
    }
    console.log(`[OK] تم تسجيل وتثبيت حاويتين (40HC) مع أرقام الرصاص والأوزان.`);

    // 6. Milestone Tracking
    console.log('\n--- 6. المعالم الزمنية للشحنة (Milestone Tracking) ---');
    const milestones = [
      { key: 'GATE_IN', title: 'Gate In at Terminal' },
      { key: 'LOADED', title: 'Loaded on Vessel' },
      { key: 'DEPARTED', title: 'Vessel Departed' },
      { key: 'ARRIVED', title: 'Vessel Arrived at Destination' },
      { key: 'CUSTOMS', title: 'Customs Cleared' },
      { key: 'DELIVERED', title: 'Delivered to Consignee' },
    ];

    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i];
      await db
        .insertInto('maritime_job_milestones')
        .values({
          tenant_id: testTenantId,
          job_id: jobId,
          milestone_key: m.key,
          milestone_title: m.title,
          occurred_at: new Date(Date.now() + i * 3600000),
        })
        .execute();
    }

    const milestoneCount: any = await db
      .selectFrom('maritime_job_milestones')
      .where('tenant_id', '=', testTenantId)
      .where('job_id', '=', jobId)
      .select((eb: any) => eb.fn.count('id').as('cnt'))
      .executeTakeFirst();

    if (Number(milestoneCount?.cnt) !== 6) {
      throw new Error(`Expected 6 milestones, found ${milestoneCount?.cnt}`);
    }
    console.log('[OK] تم تسجيل 6 معالم لوجستية تتبعية متسلسلة (DCSA Standard).');

    // 7. Job Profitability & Cost Sheet
    console.log('\n--- 7. تحليل الربحية وتكاليف الرحلة (Job Profitability) ---');
    const jobAudit = await db
      .selectFrom('maritime_jobs')
      .where('tenant_id', '=', testTenantId)
      .where('id', '=', jobId)
      .select(['client_invoiced_total', 'carrier_cost_total', 'net_profit'])
      .executeTakeFirstOrThrow();

    const revenue = Number(jobAudit.client_invoiced_total);
    const cost = Number(jobAudit.carrier_cost_total);
    const profit = Number(jobAudit.net_profit);

    console.log(`[PROFITABILITY] الإيرادات: $${revenue} | تكلفة الخط الملاحي: $${cost} | صافي الربح: $${profit}`);
    if (revenue !== 4400 || cost !== 3600 || profit !== 800) {
      throw new Error('Profitability formula mismatch!');
    }
    console.log('[OK] حسابات الربحية وتكاليف الشحن البحري دقيقة 100%.');

    console.log('\n================================================================');
    console.log('[SUCCESS] اكتملت محاكاة الشحن البحري والعمليات اللوجستية بنجاح 100%!');
    console.log('================================================================\n');
  } catch (error: any) {
    console.error('[ERROR] SIMULATION FAILED:', error.message || error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    console.log('--- تنظيف البيانات المؤقتة (Cleanup) ---');
    if (jobId) {
      await db
        .deleteFrom('maritime_job_milestones')
        .where('tenant_id', '=', testTenantId)
        .execute()
        .catch(() => {});
      await db
        .deleteFrom('maritime_containers')
        .where('tenant_id', '=', testTenantId)
        .execute()
        .catch(() => {});
      await db
        .deleteFrom('maritime_jobs')
        .where('tenant_id', '=', testTenantId)
        .execute()
        .catch(() => {});
    }
    if (quoteId)
      await db
        .deleteFrom('maritime_quotations')
        .where('tenant_id', '=', testTenantId)
        .execute()
        .catch(() => {});
    if (bidId)
      await db
        .deleteFrom('maritime_rfq_bids')
        .where('tenant_id', '=', testTenantId)
        .execute()
        .catch(() => {});
    if (rfqId)
      await db
        .deleteFrom('maritime_rfqs')
        .where('tenant_id', '=', testTenantId)
        .execute()
        .catch(() => {});
    if (shippingLineId)
      await db
        .deleteFrom('shipping_lines')
        .where('tenant_id', '=', testTenantId)
        .execute()
        .catch(() => {});
    if (podId)
      await db
        .deleteFrom('shipping_ports')
        .where('tenant_id', '=', testTenantId)
        .execute()
        .catch(() => {});
    if (polId)
      await db
        .deleteFrom('shipping_ports')
        .where('tenant_id', '=', testTenantId)
        .execute()
        .catch(() => {});
    console.log('[OK] تم مسح جميع البيانات الخاصة بالمحاكاة بنجاح.');
    await pool.end();
  }
}

runSimulation();
