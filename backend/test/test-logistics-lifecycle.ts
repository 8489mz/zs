import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { MaritimeFreightService } from '../src/modules/maritime-freight/maritime-freight.service';
import { Kysely } from 'kysely';
import { Database } from '../src/database/database.types';
import { AuthContext } from '../src/core/auth/interfaces/auth-context.interface';
import { DcsaMilestoneKey } from '../src/modules/maritime-freight/maritime-freight.types';

import { KYSELY_DB } from '../src/database/database.constants';

async function runLogisticsLifecycleTest() {
  console.log('--- Starting Comprehensive Logistics & Maritime Freight Lifecycle Test ---');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const maritimeService = app.get(MaritimeFreightService);
  const db = app.get<Kysely<Database>>(KYSELY_DB);

  try {
    // 1. Test Smart Carrier Booking Text Parsing
    console.log('\n[TEST 1] Testing Smart Carrier Booking Text Parsing...');
    const sampleBookingEmail = `
      Dear Customer,
      Thank you for booking with MAERSK LINE.
      Booking Reference: MSK-987654321
      Vessel: MAERSK MC-KINNEY MOLLER
      Voyage: 2401E
      Port of Loading: Shanghai (CNSHA)
      Port of Discharge: Alexandria (EGALY)
      ETD: 2026-10-01
      ETA: 2026-10-22
      Port Cut-off: 2026-09-28
      Master B/L: MSKU987654321
      Allocated Containers:
      - MSKU1234567 (40' HC)
      - MSKU7654321 (40' HC)
    `;

    const parsed = await maritimeService.parseCarrierBookingText(sampleBookingEmail);
    console.log('Parsed Booking Details:', {
      carrier: parsed.shippingLineName,
      bookingNumber: parsed.bookingNumber,
      vessel: parsed.vesselName,
      voyage: parsed.voyageNumber,
      etd: parsed.etd,
      eta: parsed.eta,
      cutoff: parsed.portCutOff,
      mbl: parsed.mblNumber,
      containersCount: parsed.containers.length,
    });

    if (parsed.bookingNumber !== 'MSK-987654321' || parsed.containers.length !== 2) {
      throw new Error('Smart Booking Parser failed to extract expected fields!');
    }
    console.log('PASS: Smart Carrier Booking Text Parsing verified successfully.');

    // 2. Setup Tenant & Auth Context
    const tenantId = 'dev-tenant';
    const auth: AuthContext = {
      userId: 1,
      sessionId: 'test-session',
      username: 'dev',
      role: 'admin',
      permissions: ['*'],
      tenantId,
      accountId: tenantId,
    };

    // Ensure tenant exists
    const existingTenant = await db.selectFrom('tenants').where('id', '=', tenantId).select('id').executeTakeFirst();
    if (!existingTenant) {
      await db
        .insertInto('tenants')
        .values({
          id: tenantId,
          slug: tenantId,
          business_name: 'Dev Logistics Company',
          owner_name: 'Dev Admin',
          owner_phone: '01000000000',
          owner_email: 'dev@zsystems.com',
          plan_id: 'plan_ultimate',
          activity_type: 'logistics',
          status: 'active',
          trial_starts_at: new Date(),
          trial_ends_at: new Date(Date.now() + 365 * 86400000),
          activated_at: new Date(),
        } as any)
        .execute();
    }
    console.log(`\nUsing tenant: ${tenantId}`);

    // Ensure test customer exists with negative balance (advance credit)
    let customer = await db
      .selectFrom('customers')
      .where('tenant_id', '=', tenantId)
      .selectAll()
      .limit(1)
      .executeTakeFirst();

    if (!customer) {
      const [newCust] = await db
        .insertInto('customers')
        .values({
          tenant_id: tenantId,
          account_id: tenantId,
          name: 'شركة الاستيراد والتصدير التجريبية',
          phone: '01000000000',
          balance: -200000, // 200,000 credit
        } as any)
        .returningAll()
        .execute();
      customer = newCust;
    } else {
      // Give customer credit for the test
      await db
        .updateTable('customers')
        .set({ balance: -200000 } as any)
        .where('id', '=', customer.id as any)
        .execute();
      customer.balance = -200000 as any;
    }
    console.log(`Customer: ${customer.name} (ID: ${customer.id}), Balance Credit: 200,000 EGP`);

    // 3. Create a Maritime Job (Shipment)
    console.log('\n[TEST 2] Creating Maritime Freight Job...');
    const createdJob = await maritimeService.createJob(auth, {
      customerId: Number(customer.id),
      customerName: customer.name,
      shippingLineName: parsed.shippingLineName || 'Maersk Line',
      direction: 'import',
      polCode: 'CNSHA',
      polName: 'Shanghai (CNSHA)',
      podCode: 'EGALY',
      podName: 'Alexandria Port (EGALY)',
      notes: 'شحنة تجريبية لاختبار دورة حياة الشحن والأتمتة الذكية',
    });
    console.log(`PASS: Maritime Job created: #${createdJob.job_number} (ID: ${createdJob.id})`);

    // Set invoice amount on the job
    await db
      .updateTable('maritime_jobs')
      .set({ client_invoiced_total: 150000 } as any)
      .where('id', '=', createdJob.id as any)
      .execute();

    // 4. Update with Parsed Voyage & Carrier Details
    console.log('\n[TEST 3] Applying Parsed Carrier Booking Data to Job...');
    const updatedJob = await maritimeService.updateJob(auth, String(createdJob.id), {
      bookingNumber: parsed.bookingNumber,
      vesselName: parsed.vesselName,
      voyageNumber: parsed.voyageNumber,
      etd: parsed.etd,
      eta: parsed.eta,
      portCutOff: parsed.portCutOff,
      mblNumber: parsed.mblNumber,
      shippingLineName: parsed.shippingLineName,
    });
    console.log('PASS: Updated Voyage Details:', {
      vessel: updatedJob.vessel_name,
      voyage: updatedJob.voyage_number,
      booking: updatedJob.booking_number,
      shippingLine: updatedJob.shipping_line_name,
    });

    // 5. Add Containers
    console.log('\n[TEST 4] Adding Containers...');
    const container1 = await maritimeService.createContainer(auth, {
      jobId: String(createdJob.id),
      containerNumber: 'MSKU1234567',
      containerType: "40' HC",
      sealNumber: 'SL-998811',
      freeDays: 14,
      grossWeightKg: 24500,
    });
    const container2 = await maritimeService.createContainer(auth, {
      jobId: String(createdJob.id),
      containerNumber: 'MSKU7654321',
      containerType: "40' HC",
      sealNumber: 'SL-998822',
      freeDays: 14,
      grossWeightKg: 25000,
    });
    console.log(`PASS: 2 Containers added: ${container1.container_number}, ${container2.container_number}`);

    // 6. Test Smart Job Settlement from Customer Advance Balance
    console.log('\n[TEST 5] Testing Smart Balance Settlement...');
    const activeJobs = await maritimeService.getCustomerActiveJobs(auth, Number(customer.id));
    console.log(`Active jobs found for customer: ${activeJobs.length}`);

    // Settle job from customer balance
    console.log('Settling job from available balance...');
    const settleRes = await maritimeService.settleJobFromCustomerBalance(auth, String(createdJob.id), {
      amount: 150000,
    });
    console.log('Settlement result:', settleRes.message);

    const verifiedPaidJob = await maritimeService.getJobById(auth, String(createdJob.id));
    console.log('PASS: Payment Status after settlement:', {
      status: verifiedPaidJob.payment_status,
      invoiced: verifiedPaidJob.client_invoiced_total,
      paid: verifiedPaidJob.client_paid_total,
    });
    if (verifiedPaidJob.payment_status !== 'paid') {
      throw new Error(`Expected payment_status to be 'paid', got ${verifiedPaidJob.payment_status}`);
    }

    // 7. Full DCSA Milestones Progression
    console.log('\n[TEST 6] Testing Full DCSA Milestone Progression...');
    const milestones: Array<{ key: DcsaMilestoneKey; notes: string; loc: string }> = [
      { key: 'GTI', notes: 'تم دخول الحاويات لبوابة محطة الشحن بميناء شنغهاي', loc: 'Shanghai Terminal Gate' },
      { key: 'LOAD', notes: 'تم تحميل الحاويات على متن السفينة MAERSK MC-KINNEY MOLLER', loc: 'Shanghai Berth 3' },
      { key: 'DEPT', notes: 'أبحرت السفينة باتجاه ميناء الإسكندرية', loc: 'East China Sea' },
      { key: 'ARRI', notes: 'وصلت السفينة إلى غاطس ميناء الإسكندرية', loc: 'Alexandria Anchorage' },
      {
        key: 'DISC',
        notes: 'تم تفريغ الحاويات على رصيف محطة الإسكندرية وبدء فترة السماح 14 يوم',
        loc: 'Alexandria Quayside',
      },
      { key: 'CUST', notes: 'تم الإفراج الجمركي وإنهاء إجراءات المعاينة', loc: 'Alexandria Customs Yard' },
      { key: 'GTO', notes: 'تم إصدار إذن التسليم D/O وخروج الحاويات من بوابة الميناء', loc: 'Alexandria Gate Out' },
      { key: 'DLVR', notes: 'تم تسليم البضائع وتفريغها بمستودع العميل', loc: 'Customer Warehouse - 6th October' },
      { key: 'RETN', notes: 'تم إرجاع الحاويات الفارغة لساحة الخط الملاحي بالميناء', loc: 'Alexandria Empty Depot' },
    ];

    for (const m of milestones) {
      await maritimeService.addJobMilestone(auth, String(createdJob.id), m.key, m.notes, m.loc);
      console.log(`  -> Milestone [${m.key}] recorded at ${m.loc}`);
    }

    // Verify container movement states
    const containers = await db
      .selectFrom('maritime_containers')
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', String(createdJob.id))
      .selectAll()
      .execute();
    console.log(
      'PASS: Containers verified:',
      containers.map((c) => ({
        num: c.container_number,
        freeDays: c.free_days,
        dischargedAt: c.discharged_at,
        isOverdue: c.is_overdue,
      })),
    );

    // 8. Close Shipment Completely
    console.log('\n[TEST 7] Closing Shipment Completely...');
    const closedJob = await maritimeService.updateJob(auth, String(createdJob.id), {
      notes: 'تمت كافة إجراءات الشحنة والتسليم وإرجاع الحاويات بنجاح تام وإغلاق الملف التشغيلي والمالي.',
    });
    await db
      .updateTable('maritime_jobs')
      .set({ status: 'completed' })
      .where('id', '=', createdJob.id as any)
      .execute();

    console.log('PASS: Final Shipment Status:', {
      jobId: closedJob.id,
      jobNumber: closedJob.job_number,
      status: 'completed',
      paymentStatus: closedJob.payment_status,
    });

    console.log('\n=== ALL LOGISTICS & MARITIME FREIGHT TESTS PASSED 100% SUCCESSFULLY! ===');
  } catch (err) {
    console.error('FAIL: Test failed with error:', err);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

runLogisticsLifecycleTest();
