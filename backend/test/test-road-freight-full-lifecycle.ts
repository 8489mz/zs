import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { MaritimeFreightService } from '../src/modules/maritime-freight/maritime-freight.service';
import { Kysely } from 'kysely';
import { Database } from '../src/database/database.types';
import { AuthContext } from '../src/core/auth/interfaces/auth-context.interface';
import { KYSELY_DB } from '../src/database/database.constants';
import {
  calculateTrucksRequired,
  calculateRoadFreightCost,
  validateCmrWaybillNumber,
  ROAD_FREIGHT_MILESTONES,
} from '../src/modules/maritime-freight/engines/road-freight.engine';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`[FAIL] ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

async function runRoadFreightLifecycleTest() {
  console.log('========================================================================');
  console.log('  STARTING COMPREHENSIVE END-TO-END ROAD FREIGHT & TRUCKING TEST');
  console.log('========================================================================\n');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const freightService = app.get(MaritimeFreightService);
  const db = app.get<Kysely<Database>>(KYSELY_DB);

  try {
    const tenantId = 'zs';
    const auth: AuthContext = {
      userId: 102,
      sessionId: 'e2e-road-test-session',
      username: 'zs',
      role: 'super_admin',
      permissions: ['*'],
      tenantId,
      accountId: tenantId,
    };

    // -------------------------------------------------------------------------
    // STEP 0: Verify Master Data Seeding (Trucking Carriers & Dry Ports)
    // -------------------------------------------------------------------------
    console.log('[STEP 0] Ensuring Master Data (Trucking Carriers & Dry Ports/Depots)...');
    await freightService.ensureDefaultMasterData(tenantId);

    const nileTrucking = await db
      .selectFrom('shipping_lines')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('carrier_type', '=', 'trucking')
      .where('code', '=', 'TRK-NILE')
      .executeTakeFirst();
    assert(Boolean(nileTrucking), 'Nile Overland Transport (TRK-NILE) must be seeded');
    assert(nileTrucking?.carrier_type === 'trucking', 'Carrier type must be "trucking"');

    const gulfTrucking = await db
      .selectFrom('shipping_lines')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('carrier_type', '=', 'trucking')
      .where('code', '=', 'TRK-GULF')
      .executeTakeFirst();
    assert(Boolean(gulfTrucking), 'Gulf Cross-Border (TRK-GULF) must be seeded');

    const octDryPort = await db
      .selectFrom('shipping_ports')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('code', '=', 'EGSOC')
      .executeTakeFirst();
    assert(Boolean(octDryPort), '6th of October Dry Port (EGSOC) must be seeded');
    assert(octDryPort?.port_type === 'land', 'EGSOC port_type must be "land"');

    const ramadanDryPort = await db
      .selectFrom('shipping_ports')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('code', '=', 'EGTRD')
      .executeTakeFirst();
    assert(Boolean(ramadanDryPort), '10th of Ramadan Logistics Depot (EGTRD) must be seeded');
    assert(ramadanDryPort?.port_type === 'land', 'EGTRD port_type must be "land"');
    console.log('  [PASS] STEP 0 PASSED: Trucking carriers & Dry ports master data verified.\n');

    // -------------------------------------------------------------------------
    // STEP 1: Pure Road Freight Calculation Engine Verification
    // -------------------------------------------------------------------------
    console.log('[STEP 1] Testing Pure Road Freight Calculation Engine...');
    // 1. Truck requirement solver (Weight vs Pallet constraints)
    const truckCalc = calculateTrucksRequired({
      grossWeightKg: 54000,
      totalCbm: 50,
      palletCount: 30,
      preferredTruckType: 'flatbed',
    });
    assert(truckCalc.requiredTrucks === 2, '54,000 kg on Flatbed (28T max) must require 2 trucks');
    assert(truckCalc.limitingFactor === 'weight', 'Limiting factor must be weight');
    assert(
      truckCalc.weightUtilizationPercent === 96.43,
      `Weight utilization must be 96.43%, got ${truckCalc.weightUtilizationPercent}`,
    );

    // 2. Cost calculation with tolls, fuel, and detention
    const costCalc = calculateRoadFreightCost({
      pricingMode: 'per_trip',
      rate: 6000,
      truckCount: 2,
      roadTollsFee: 800,
      fuelSurcharge: 500,
      detentionDays: 1,
      detentionDailyRate: 1200,
    });
    // Base: 2 * 6000 = 12,000. Detention: 1 * 1200 * 2 = 2,400. Tolls: 800. Fuel: 500. Total = 15,700
    assert(costCalc.baseFreightCost === 12000, 'Base cost must be 12000');
    assert(costCalc.detentionCost === 2400, 'Detention cost must be 2400');
    assert(costCalc.totalCost === 15700, `Total cost must be 15700, got ${costCalc.totalCost}`);

    // 3. CMR / Waybill validation
    const cmrValidation = validateCmrWaybillNumber('CMR-EG-260914-001');
    assert(cmrValidation.valid === true, 'CMR must be valid');
    assert(cmrValidation.isInternationalCmr === true, 'Must detect international CMR');

    const domesticWb = validateCmrWaybillNumber('WB-8819203');
    assert(domesticWb.valid === true, 'Domestic waybill must be valid');
    assert(domesticWb.isInternationalCmr === false, 'Domestic waybill is not international CMR');

    console.log('  [PASS] STEP 1 PASSED: Pure Road Freight Calculation Engine 100% verified.\n');

    // -------------------------------------------------------------------------
    // STEP 2: Create Road Freight Inquiry (طلب شحن بري / نقل داخلي)
    // -------------------------------------------------------------------------
    console.log('[STEP 2] Creating Road Freight Inquiry (6th October Dry Port -> 10th Ramadan Logistics)...');
    const inquiryDto = {
      transportMode: 'road' as const,
      customerName: 'مجموعة الأهرام للصناعات الهندسية والمعدات',
      customerPhone: '01011223344',
      customerEmail: 'transport@ahram-ind.com',
      direction: 'import' as const,
      polCode: 'EGSOC',
      polName: 'الميناء الجاف بالسادس من أكتوبر (6th October Dry Port)',
      podCode: 'EGTRD',
      podName: 'المنطقة اللوجستية بالعاشر من رمضان (10th Ramadan Logistics)',
      incoterm: 'DAP',
      commodityDescription: 'قطع غيار وخطوط إنتاج صناعية على طبليات خشبية',
      cargoNature: 'general',
      grossWeightKg: 54000,
      cbm: 50,
      packageCount: 60,
      paymentTerm: 'prepaid' as const,
      notes: 'نقل بري داخلي عاجل - شاحنتين مسطحة 28 طن مع تأمين وتربيط الحمولة',
    };

    const inquiry = await freightService.createInquiry(auth, inquiryDto);
    console.log(`  -> Created Road Inquiry #${inquiry.inquiry_number} (ID: ${inquiry.id})`);
    assert(Boolean(inquiry.id), 'Inquiry ID must exist');
    assert(/^INQ-\d{6}-\d{4}$/.test(inquiry.inquiry_number), `Inquiry number format valid: ${inquiry.inquiry_number}`);
    assert(inquiry.transport_mode === 'road', 'Transport mode must be "road"');
    console.log('  [PASS] STEP 2 PASSED: Road Freight Inquiry created successfully.\n');

    // -------------------------------------------------------------------------
    // STEP 3: Convert Inquiry to Road RFQ (طلب تسعير مقطورات / شاحنات نقل)
    // -------------------------------------------------------------------------
    console.log('[STEP 3] Converting Road Inquiry to RFQ targeting Nile Overland Transport...');
    const rfq = await freightService.convertInquiryToRfq(auth, inquiry.id, [Number(nileTrucking!.id)]);
    console.log(`  -> Created Road RFQ #${rfq.rfq_number} (ID: ${rfq.id})`);
    assert(Boolean(rfq.id), 'RFQ ID must exist');
    assert(/^RFQ-\d{6}-\d{4}$/.test(rfq.rfq_number), `RFQ number format valid: ${rfq.rfq_number}`);
    assert(rfq.transport_mode === 'road', 'RFQ transport mode must be "road"');
    console.log('  [PASS] STEP 3 PASSED: Inquiry converted to Road RFQ.\n');

    // -------------------------------------------------------------------------
    // STEP 4: Submit Trucking Carrier Bid (عرض سعر شركة النقل)
    // -------------------------------------------------------------------------
    console.log('[STEP 4] Submitting Trucking Carrier Bid...');
    const bid = await freightService.submitBid(auth, {
      rfqId: String(rfq.id),
      shippingLineId: String(nileTrucking!.id),
      shippingLineName: nileTrucking!.name_ar,
      oceanFreight: 250, // Equivalent in USD or local currency
      otherCharges: 12000, // 6,000 EGP per truck x 2 trucks
      transitTimeDays: 1,
      freeDays: 2,
      validityDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      notes: 'شاحنتين تريلا مسطحة مجهزة لنقل 54 طن من ميناء 6 أكتوبر الجاف للعاشر من رمضان',
    });
    console.log(`  -> Submitted Bid ID: ${bid.id} from ${nileTrucking!.name_ar}`);
    assert(Boolean(bid.id), 'Bid ID must exist');
    console.log('  [PASS] STEP 4 PASSED: Trucking carrier bid submitted.\n');

    // -------------------------------------------------------------------------
    // STEP 5: Award Bid & Generate Road Quotation (ترسية وتوليد عرض سعر العميل)
    // -------------------------------------------------------------------------
    console.log('[STEP 5] Awarding Trucking Bid and Generating Customer Road Quotation...');
    await freightService.awardBid(auth, String(bid.id));

    const quoteDto = {
      inquiryId: String(inquiry.id),
      rfqId: String(rfq.id),
      bidId: String(bid.id),
      customerId: inquiry.customer_id,
      customerName: inquiry.customer_name,
      customerPhone: inquiry.customer_phone || undefined,
      customerEmail: inquiry.customer_email || undefined,
      transportMode: 'road' as const,
      paymentTerm: 'prepaid' as const,
      baseCost: 250,
      marginType: 'fixed' as const,
      marginValue: 100,
      currency: 'USD',
      exchangeRate: 48.5,
      polName: inquiry.pol_name,
      podName: inquiry.pod_name,
      grossWeightKg: inquiry.gross_weight_kg,
      totalCbm: inquiry.total_cbm,
      notes: 'عرض سعر شامل شاحنتين نقل بري وتصاريح الطرق والتربيط',
    };

    const quotation = await freightService.createQuotation(auth, quoteDto);
    console.log(`  -> Created Road Quotation #${quotation.quotation_number} (ID: ${quotation.id})`);
    assert(Boolean(quotation.id), 'Quotation ID must exist');
    assert(
      /^QUO(T)?-\d{6}-\d{4}$/.test(quotation.quotation_number),
      `Quotation format valid: ${quotation.quotation_number}`,
    );
    assert(quotation.transport_mode === 'road', 'Quotation transport mode must be "road"');
    console.log('  [PASS] STEP 5 PASSED: Road Quotation generated with profit margin.\n');

    // -------------------------------------------------------------------------
    // STEP 6: Convert Road Quotation to Operational Job
    // -------------------------------------------------------------------------
    console.log('[STEP 6] Converting Road Quotation to Operational Shipment Job...');
    const job = await freightService.autoConvertQuotationToJob(auth, String(quotation.id));
    console.log(`  -> Created Road Freight Job #${job.job_number} (ID: ${job.id})`);

    assert(Boolean(job.id), 'Job ID must exist');
    assert(/^JOB-\d{6}-\d{4}$/.test(job.job_number), `Job number format valid: ${job.job_number}`);
    assert(job.transport_mode === 'road', 'Job transport mode must be "road"');

    // CRITICAL INVARIANT: Road Freight must NEVER generate dummy ocean containers (MSKU...)
    const jobDetails = await freightService.getJobById(auth, String(job.id));
    assert(
      !jobDetails.containers || jobDetails.containers.length === 0,
      `Road Job must have ZERO ocean containers, found: ${jobDetails.containers?.length}`,
    );

    // Initial Milestone Invariant: Road Freight starts with TRK_ASSIGN, not ocean BOOK
    assert(
      job.milestone_status === 'TRK_ASSIGN',
      `Road job initial milestone must be TRK_ASSIGN, got ${job.milestone_status}`,
    );
    const initialMilestone = jobDetails.milestones.find((m: any) => m.milestone_key === 'TRK_ASSIGN');
    assert(Boolean(initialMilestone), 'Initial TRK_ASSIGN milestone record must exist');
    assert(
      Boolean(
        initialMilestone?.milestone_title.includes('النقل البري') ||
        initialMilestone?.milestone_title.includes('Truck'),
      ),
      `Initial milestone title must refer to road transport: ${initialMilestone?.milestone_title}`,
    );

    // Cost center created
    assert(Boolean(job.cost_center_id), 'Accounting cost center must be auto-created for road job');

    // Attach valid CMR waybill number and signed POD document before delivery gate
    await freightService.updateJob(auth, String(job.id), {
      bookingNumber: 'CMR-EG-261009-001',
    });

    await db
      .insertInto('maritime_job_documents')
      .values({
        tenant_id: tenantId,
        job_id: String(job.id),
        doc_type: 'other',
        title: 'إثبات التسليم بوليصة CMR موقعة POD',
        file_name: 'cmr-signed-001.pdf',
        mime_type: 'application/pdf',
        file_url: 'https://storage.z-systems.io/pods/cmr-signed-001.pdf',
      })
      .execute();

    console.log(
      '  [PASS] STEP 6 PASSED: Road Job created with zero containers, initial TRK_ASSIGN milestone, and CMR booking number.\n',
    );

    // -------------------------------------------------------------------------
    // STEP 7: Dispatch Inland Trucking Trips (تسيير رحلات النقل البري للشاحنتين)
    // -------------------------------------------------------------------------
    console.log('[STEP 7] Dispatching Inland Trucking Trips with Collision-Proof Sequence Numbering...');
    const tripDto = {
      jobId: String(job.id),
      truckingCompany: 'شركة النيل للنقل البري',
      driverName: 'أحمد محمود حسن',
      driverPhone: '01234567890',
      truckPlate: 'أ ب ج 1234',
      trailerPlate: 'د هـ و 5678',
      originPortTerminal: 'الميناء الجاف بالسادس من أكتوبر',
      deliveryDestination: 'المنطقة اللوجستية بالعاشر من رمضان',
      dispatchDate: new Date().toISOString(),
      costAmount: 6000,
      sellAmount: 7500,
      currency: 'EGP',
      notes: 'تريلا فرش 28 طن - نقل الحمولة الأولى (27 طن)',
    };

    const trip = await freightService.createInlandTruckingTrip(auth, tripDto);
    console.log(`  -> Created Inland Trucking Trip 1 #${trip.trip_number} (ID: ${trip.id})`);

    const trip2 = await freightService.createInlandTruckingTrip(auth, {
      ...tripDto,
      truckPlate: 'س ص ع 5678',
      trailerPlate: 'ل م ن 9012',
      notes: 'تريلا فرش 28 طن - نقل الحمولة الثانية (27 طن)',
    });
    console.log(`  -> Created Inland Trucking Trip 2 #${trip2.trip_number} (ID: ${trip2.id})`);

    assert(Boolean(trip.id), 'Trip 1 ID must exist');
    assert(Boolean(trip2.id), 'Trip 2 ID must exist');
    assert(
      /^TRIP-\d{6}-\d{4}$/.test(trip.trip_number),
      `Trip number must follow TRIP-YYMMDD-XXXX format: ${trip.trip_number}`,
    );
    assert(trip.trip_status === 'assigned', 'Trip status must be "assigned"');
    console.log(
      '  [PASS] STEP 7 PASSED: Both required Inland Trucking Trips created with standard sequence numbering.\n',
    );

    // -------------------------------------------------------------------------
    // STEP 8: Real-Time Trip Status Progression & Milestone Auto-Sync
    // -------------------------------------------------------------------------
    console.log('[STEP 8] Testing Real-Time Trip Status Progression & Milestone Auto-Synchronization...');

    // 8a. Transition to 'loading' -> Syncs to TRK_LOADED
    console.log('  -> Updating trip to "loading"...');
    await freightService.updateInlandTruckingTripStatus(auth, trip.id, {
      tripStatus: 'loading',
      notes: 'بدء تحميل وتربيط البضاعة وتأمين الأحزمة',
    });
    const jobAfterLoading = await freightService.getJobById(auth, String(job.id));
    assert(
      jobAfterLoading.milestone_status === 'TRK_LOADED',
      `Job milestone must be TRK_LOADED, got ${jobAfterLoading.milestone_status}`,
    );
    const loadedMilestone = jobAfterLoading.milestones.find((m: any) => m.milestone_key === 'TRK_LOADED');
    assert(Boolean(loadedMilestone), 'TRK_LOADED milestone record must be logged');

    // 8b. Transition to 'in_transit' -> Syncs to TRK_DISPATCH
    console.log('  -> Updating trip to "in_transit"...');
    await freightService.updateInlandTruckingTripStatus(auth, trip.id, {
      tripStatus: 'in_transit',
      notes: 'تحركت الشاحنة على الطريق الدائري الأوسطي متجهة للعاشر من رمضان',
    });
    const jobAfterDispatch = await freightService.getJobById(auth, String(job.id));
    assert(
      jobAfterDispatch.milestone_status === 'TRK_DISPATCH',
      `Job milestone must be TRK_DISPATCH, got ${jobAfterDispatch.milestone_status}`,
    );
    const dispatchMilestone = jobAfterDispatch.milestones.find((m: any) => m.milestone_key === 'TRK_DISPATCH');
    assert(Boolean(dispatchMilestone), 'TRK_DISPATCH milestone record must be logged');

    // 8c. Transition to 'delivered' -> Syncs to TRK_POD
    console.log('  -> Updating trip to "delivered"...');
    await freightService.updateInlandTruckingTripStatus(auth, trip.id, {
      tripStatus: 'delivered',
      deliveryDate: new Date().toISOString(),
      notes: 'وصلت الشاحنة وتم التفريغ بمستودع العميل وتوقيع إشعار التسليم',
    });
    const jobAfterDelivered = await freightService.getJobById(auth, String(job.id));
    assert(
      jobAfterDelivered.milestone_status === 'TRK_POD',
      `Job milestone must be TRK_POD, got ${jobAfterDelivered.milestone_status}`,
    );
    const podMilestone = jobAfterDelivered.milestones.find((m: any) => m.milestone_key === 'TRK_POD');
    assert(Boolean(podMilestone), 'TRK_POD milestone record must be logged');

    console.log('  [PASS] STEP 8 PASSED: Trip status progression auto-synchronized with shipment milestones.\n');

    // -------------------------------------------------------------------------
    // STEP 9: Job Details Hydration Check (getJobById includes truckingTrips)
    // -------------------------------------------------------------------------
    console.log('[STEP 9] Verifying Job Details Hydration (truckingTrips & roadFreightDefinitions)...');
    const finalJobDetails = await freightService.getJobById(auth, String(job.id));

    assert(Boolean(finalJobDetails.truckingTrips), 'truckingTrips array must exist on job details');
    assert(
      finalJobDetails.truckingTrips.length === 2,
      `Expected 2 trucking trips, got ${finalJobDetails.truckingTrips.length}`,
    );
    assert(
      finalJobDetails.truckingTrips.some((t) => t.trip_number === trip.trip_number),
      'Attached trip number must match',
    );
    assert(Boolean(finalJobDetails.roadFreightDefinitions), 'roadFreightDefinitions must exist');
    assert(finalJobDetails.roadFreightDefinitions.length >= 8, 'Must have at least 8 road freight definitions');
    console.log('  [PASS] STEP 9 PASSED: Job details includes truckingTrips and roadFreightDefinitions.\n');

    // -------------------------------------------------------------------------
    // STEP 10: Release Delivery Order / POD for Road Freight
    // -------------------------------------------------------------------------
    console.log('[STEP 10] Testing releaseDeliveryOrder for Road Freight (TRK_POD)...');
    const dlvResult = await freightService.releaseDeliveryOrder(auth, String(job.id));
    assert(
      dlvResult.milestone_status === 'TRK_POD',
      `releaseDeliveryOrder on road job must update job milestone_status to TRK_POD, got ${dlvResult.milestone_status}`,
    );
    const updatedJobAfterDlv = await freightService.getJobById(auth, String(job.id));
    const dlvMilestone = updatedJobAfterDlv.milestones.find((m: any) => m.milestone_key === 'TRK_POD');
    assert(Boolean(dlvMilestone), 'TRK_POD milestone must exist in job milestones');
    assert(
      Boolean(
        dlvMilestone?.milestone_title.includes('بوليصة الشحن البري') || dlvMilestone?.milestone_title.includes('POD'),
      ),
      `Milestone title must refer to road waybill / POD: ${dlvMilestone?.milestone_title}`,
    );
    console.log('  [PASS] STEP 10 PASSED: releaseDeliveryOrder appropriately registered TRK_POD for road job.\n');

    // -------------------------------------------------------------------------
    // STEP 11: Automated WhatsApp Message Templates for Road Freight
    // -------------------------------------------------------------------------
    console.log('[STEP 11] Testing WhatsApp Milestone Notifications for Road Freight...');
    const waDispatch = await freightService.getMilestoneWhatsAppMessage(auth, String(job.id), 'TRK_DISPATCH');
    assert(
      Boolean(waDispatch.message.includes('البرية')),
      `Message must indicate road shipment ("البرية"): ${waDispatch.message}`,
    );
    assert(
      Boolean(waDispatch.message.includes('انطلقت الشاحنة')),
      `Message must include road dispatch context: ${waDispatch.message}`,
    );
    assert(Boolean(waDispatch.message.includes(job.job_number)), 'Message must include job number');

    const waPod = await freightService.getMilestoneWhatsAppMessage(auth, String(job.id), 'TRK_POD');
    assert(
      Boolean(waPod.message.includes('بوليصة الاستلام')),
      `POD message must include proof of delivery context: ${waPod.message}`,
    );

    console.log('  [PASS] STEP 11 PASSED: Road Freight WhatsApp notifications generated with road templates.\n');

    console.log('========================================================================');
    console.log('  ALL 11 ROAD FREIGHT & TRUCKING LIFECYCLE TESTS PASSED CLEANLY (100%)');
    console.log('========================================================================');
  } catch (err) {
    console.error('[FAIL] ROAD FREIGHT LIFECYCLE TEST FAILED:', err);
    process.exit(1);
  } finally {
    await app.close();
  }
}

runRoadFreightLifecycleTest();
