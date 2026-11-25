import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { MaritimeFreightService } from '../src/modules/maritime-freight/maritime-freight.service';
import { Kysely } from 'kysely';
import { Database } from '../src/database/database.types';
import { AuthContext } from '../src/core/auth/interfaces/auth-context.interface';
import { KYSELY_DB } from '../src/database/database.constants';
import {
  calculateAirChargeableWeight,
  calculateAirFreightCost,
  validateIataAwbNumber,
  IATA_CARGO_IQ_MILESTONES,
} from '../src/modules/maritime-freight/engines/air-freight.engine';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`[FAIL] ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

async function runAirFreightLifecycleTest() {
  console.log('========================================================================');
  console.log('  STARTING COMPREHENSIVE END-TO-END INTERNATIONAL AIR FREIGHT TEST');
  console.log('========================================================================\n');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const freightService = app.get(MaritimeFreightService);
  const db = app.get<Kysely<Database>>(KYSELY_DB);

  try {
    const tenantId = 'zs';
    const auth: AuthContext = {
      userId: 102,
      sessionId: 'e2e-test-session',
      username: 'zs',
      role: 'super_admin',
      permissions: ['*'],
      tenantId,
      accountId: tenantId,
    };

    // -------------------------------------------------------------------------
    // STEP 0: Verify Master Data Seeding (Airlines & Cargo Airports)
    // -------------------------------------------------------------------------
    console.log('[STEP 0] Ensuring Master Data (Airlines EgyptAir/Emirates & Airports CAI/DXB)...');
    await freightService.ensureDefaultMasterData(tenantId);

    const egyptAir = await db
      .selectFrom('shipping_lines')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('carrier_type', '=', 'airline')
      .where('code', '=', 'MS')
      .executeTakeFirst();
    assert(Boolean(egyptAir), 'EgyptAir Cargo (MS) must be seeded');
    assert(egyptAir?.airline_prefix === '077', 'EgyptAir IATA prefix must be 077');

    const emirates = await db
      .selectFrom('shipping_lines')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('carrier_type', '=', 'airline')
      .where('code', '=', 'EK')
      .executeTakeFirst();
    assert(Boolean(emirates), 'Emirates SkyCargo (EK) must be seeded');
    assert(emirates?.airline_prefix === '176', 'Emirates IATA prefix must be 176');

    const caiAirport = await db
      .selectFrom('shipping_ports')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('code', '=', 'CAI')
      .executeTakeFirst();
    assert(Boolean(caiAirport), 'Cairo Airport (CAI) must be seeded');
    assert(caiAirport?.port_type === 'air', 'CAI port_type must be "air"');

    const dxbAirport = await db
      .selectFrom('shipping_ports')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('code', '=', 'DXB')
      .executeTakeFirst();
    assert(Boolean(dxbAirport), 'Dubai Airport (DXB) must be seeded');
    assert(dxbAirport?.port_type === 'air', 'DXB port_type must be "air"');
    console.log('  [PASS] STEP 0 PASSED: Airlines & Airports master data verified.\n');

    // -------------------------------------------------------------------------
    // STEP 1: Pure Calculation Engine Verification (IATA Standard & Modulo-7)
    // -------------------------------------------------------------------------
    console.log('[STEP 1] Testing Pure Air Freight Calculation Engine...');
    // Volumetric weight: 500 kg gross, 4 CBM -> 4 * 166.667 = 666.668 kg -> 667.0 kg chargeable
    const weightCalc = calculateAirChargeableWeight({
      grossWeightKg: 500,
      cbm: 4,
    });
    assert(weightCalc.grossWeightKg === 500, 'Gross weight must be 500');
    assert(Math.abs(weightCalc.volumetricWeightKg - 666.667) < 0.01, 'Volumetric weight must be 666.667');
    assert(weightCalc.chargeableWeightKg === 667, 'Chargeable weight must round up to 667 kg');
    assert(weightCalc.dominantFactor === 'volume', 'Dominant factor must be volume');

    // Air Freight Cost with FSC, SSC, and AWB fee
    const costCalc = calculateAirFreightCost({
      chargeableWeightKg: 667,
      ratePerKg: 2.5,
      fuelSurchargePerKg: 0.4,
      securitySurchargePerKg: 0.15,
      awbDocumentationFee: 50.0,
    });
    assert(
      costCalc.baseWeightCharge === 1667.5,
      `Base weight charge expected 1667.50, got ${costCalc.baseWeightCharge}`,
    );
    assert(costCalc.fuelSurcharge === 266.8, `Fuel surcharge expected 266.80, got ${costCalc.fuelSurcharge}`);
    assert(
      costCalc.securitySurcharge === 100.05,
      `Security surcharge expected 100.05, got ${costCalc.securitySurcharge}`,
    );
    assert(costCalc.awbFee === 50.0, `AWB fee expected 50.00, got ${costCalc.awbFee}`);
    assert(costCalc.totalCost === 2084.35, `Total cost expected 2084.35, got ${costCalc.totalCost}`);

    // IATA Modulo-7 Check Digit Rule: 077-12345675 (1234567 % 7 = 5)
    const validAwb = validateIataAwbNumber('077-12345675');
    assert(validAwb.valid === true, 'AWB 077-12345675 must be valid');
    assert(validAwb.checkDigit === 5, 'Check digit must be 5');

    const invalidAwb = validateIataAwbNumber('077-12345674');
    assert(invalidAwb.valid === false, 'AWB 077-12345674 must be invalid');
    assert(Boolean(invalidAwb.error?.includes('Modulo-7')), 'Error must mention Modulo-7');
    console.log('  [PASS] STEP 1 PASSED: Pure Air Freight Calculation Engine 100% verified.\n');

    // -------------------------------------------------------------------------
    // STEP 2: Create Air Cargo Inquiry (طلب شحن جوي)
    // -------------------------------------------------------------------------
    console.log('[STEP 2] Creating Air Freight Inquiry (Cairo CAI -> Dubai DXB)...');
    const inquiryDto = {
      transportMode: 'air' as const,
      airCargoType: 'general',
      customerName: 'مؤسسة الدلتا للأجهزة والمستلزمات الطبية',
      customerPhone: '01023456789',
      customerEmail: 'cargo@delta-med.com',
      direction: 'export' as const,
      polCode: 'CAI',
      polName: 'مطار القاهرة الدولي (قرية البضائع CAI)',
      podCode: 'DXB',
      podName: 'مطار دبي الدولي للشحن (DXB)',
      incoterm: 'CPT',
      commodityDescription: 'أجهزة قياس ومعدات طبية حساسة',
      cargoNature: 'fragile',
      grossWeightKg: 500,
      cbm: 4,
      packageCount: 15,
      paymentTerm: 'prepaid' as const,
      notes: 'شحنة جوية عاجلة - مطلوب حجز على أقرب رحلة مباشرة للقاهرة/دبي',
    };

    const inquiry = await freightService.createInquiry(auth, inquiryDto);
    console.log(`  -> Created Air Inquiry #${inquiry.inquiry_number} (ID: ${inquiry.id})`);
    assert(Boolean(inquiry.id), 'Inquiry ID must exist');
    assert(/^INQ-\d{6}-\d{4}$/.test(inquiry.inquiry_number), `Inquiry number format valid: ${inquiry.inquiry_number}`);
    assert(inquiry.transport_mode === 'air', 'Transport mode must be "air"');
    assert(
      Number(inquiry.chargeable_weight_kg) === 667,
      `Chargeable weight auto-derived: ${inquiry.chargeable_weight_kg}`,
    );
    assert(
      Number(inquiry.volumetric_weight_kg) > 666,
      `Volumetric weight auto-derived: ${inquiry.volumetric_weight_kg}`,
    );
    console.log('  [PASS] STEP 2 PASSED: Air Inquiry created with auto-derived chargeable weight.\n');

    // -------------------------------------------------------------------------
    // STEP 3: Convert Inquiry to Air RFQ (تحويل الاستفسار لطلب تسعير شركات طيران)
    // -------------------------------------------------------------------------
    console.log('[STEP 3] Converting Air Inquiry to RFQ targeting EgyptAir and Emirates...');
    const rfq = await freightService.convertInquiryToRfq(auth, inquiry.id, [
      Number(egyptAir!.id),
      Number(emirates!.id),
    ]);
    console.log(`  -> Created Air RFQ #${rfq.rfq_number} (ID: ${rfq.id})`);
    assert(Boolean(rfq.id), 'RFQ ID must exist');
    assert(/^RFQ-\d{6}-\d{4}$/.test(rfq.rfq_number), `RFQ number format valid: ${rfq.rfq_number}`);
    assert(rfq.transport_mode === 'air', 'RFQ transport mode must be "air"');
    assert(Number(rfq.chargeable_weight_kg) === 667, `RFQ preserved chargeable weight: ${rfq.chargeable_weight_kg}`);
    console.log('  [PASS] STEP 3 PASSED: Inquiry converted to Air RFQ.\n');

    // -------------------------------------------------------------------------
    // STEP 4: Submit Airline Bids (عروض أسعار شركات الطيران)
    // -------------------------------------------------------------------------
    console.log('[STEP 4] Submitting Airline Bids...');
    // Bid 1: EgyptAir Cargo
    const bid1 = await freightService.submitBid(auth, {
      rfqId: String(rfq.id),
      shippingLineId: String(egyptAir!.id),
      shippingLineName: egyptAir!.name_ar,
      oceanFreight: costCalc.baseWeightCharge, // 1667.50
      currency: 'USD',
      thcOrigin: 0,
      thcDestination: 0,
      bafCharges: costCalc.fuelSurcharge, // 266.80 FSC
      otherCharges: costCalc.securitySurcharge + costCalc.awbFee, // 150.05 SSC + AWB
      transitTimeDays: 1,
      freeDays: 3,
      notes: 'عرض رسمي من مصر للطيران للشحن الجوي: رحلة مباشرة MS-801',
    });
    console.log(`  -> Bid 1 (EgyptAir Cargo): Total ${bid1.total_freight_cost} ${bid1.currency}`);
    assert(Number(bid1.total_freight_cost) === 2084.35, `Bid 1 cost must be 2084.35, got ${bid1.total_freight_cost}`);

    // Bid 2: Emirates SkyCargo
    const bid2 = await freightService.submitBid(auth, {
      rfqId: String(rfq.id),
      shippingLineId: String(emirates!.id),
      shippingLineName: emirates!.name_ar,
      oceanFreight: 1867.6,
      currency: 'USD',
      thcOrigin: 0,
      thcDestination: 0,
      bafCharges: 300.0,
      otherCharges: 150.0,
      transitTimeDays: 1,
      freeDays: 4,
      notes: 'عرض طيران الإمارات للشحن الجوي EK SkyCargo',
    });
    console.log(`  -> Bid 2 (Emirates SkyCargo): Total ${bid2.total_freight_cost} ${bid2.currency}`);
    assert(Number(bid2.total_freight_cost) === 2317.6, `Bid 2 cost must be 2317.60, got ${bid2.total_freight_cost}`);
    console.log('  [PASS] STEP 4 PASSED: Airline bids submitted.\n');

    // -------------------------------------------------------------------------
    // STEP 5: Award EgyptAir Cargo Bid
    // -------------------------------------------------------------------------
    console.log('[STEP 5] Awarding EgyptAir Cargo Bid in Comparison Matrix...');
    const awarded = await freightService.awardBid(auth, String(bid1.id));
    assert(awarded.is_awarded === true, 'Bid 1 must be marked awarded');

    const updatedRfq = await freightService.getRfqById(auth, String(rfq.id));
    assert(updatedRfq.status === 'awarded', 'RFQ status must be "awarded"');
    console.log('  [PASS] STEP 5 PASSED: Best airline bid awarded.\n');

    // -------------------------------------------------------------------------
    // STEP 6: Generate Client Air Freight Quotation
    // -------------------------------------------------------------------------
    console.log('[STEP 6] Generating Client Quotation with 24% Profit Margin...');
    const quoteDto = {
      rfqId: String(rfq.id),
      bidId: String(bid1.id),
      inquiryId: String(inquiry.id),
      customerId: inquiry.customer_id,
      customerName: inquiry.customer_name,
      customerPhone: inquiry.customer_phone || undefined,
      customerEmail: inquiry.customer_email || undefined,
      transportMode: 'air' as const,
      airCargoType: 'general',
      grossWeightKg: 500,
      volumetricWeightKg: 666.67,
      chargeableWeightKg: 667,
      totalCbm: 4,
      packageCount: 15,
      polCode: 'CAI',
      polName: 'مطار القاهرة الدولي (CAI)',
      podCode: 'DXB',
      podName: 'مطار دبي الدولي (DXB)',
      baseCost: 2084.35,
      currency: 'USD',
      marginType: 'fixed' as const,
      marginValue: 500.0, // Total $2,584.35 USD
      exchangeRate: 48.5, // EGP per USD
      notes: 'عرض أسعار شحن جوي شامل النولون والمصاريف الإضافية حتى مطار دبي',
    };

    const quote = await freightService.createQuotation(auth, quoteDto as any);
    console.log(`  -> Created Air Quotation #${quote.quotation_number} (Final: $${quote.final_total} USD)`);
    assert(Boolean(quote.id), 'Quotation ID must exist');
    assert(/^QUO-\d{6}-\d{4}$/.test(quote.quotation_number), `Quotation formula: ${quote.quotation_number}`);
    assert(Number(quote.final_total) === 2584.35, `Final total must be 2584.35 USD, got ${quote.final_total}`);
    assert(Number(quote.chargeable_weight_kg) === 667, 'Quotation chargeable weight must be 667 kg');

    // Approve quotation
    const approvedQuote = await freightService.updateQuotationStatus(auth, String(quote.id), 'approved');
    assert(approvedQuote.status === 'approved', 'Quotation status must be "approved"');
    console.log('  [PASS] STEP 6 PASSED: Quotation generated and approved.\n');

    // -------------------------------------------------------------------------
    // STEP 7: Auto Convert Quotation to Air Job (Zero Ocean Containers Rule!)
    // -------------------------------------------------------------------------
    console.log('[STEP 7] Converting Approved Quotation to Air Freight Shipment Job...');
    const job = await freightService.autoConvertQuotationToJob(auth, String(quote.id));
    console.log(`  -> Created Air Shipment Job #${job.job_number} (ID: ${job.id})`);
    assert(Boolean(job.id), 'Job ID must exist');
    assert(/^JOB-\d{6}-\d{4}$/.test(job.job_number), `Job number formula: ${job.job_number}`);
    assert(job.transport_mode === 'air', 'Job transport mode must be "air"');
    assert(Number(job.chargeable_weight_kg) === 667, 'Job chargeable weight must be 667 kg');

    // CRITICAL AIR INVARIANT: Zero Ocean Containers!
    const jobDetails = await freightService.getJobById(auth, String(job.id));
    assert(
      jobDetails.containers.length === 0,
      `Air Freight shipment must have 0 ocean containers! Found: ${jobDetails.containers.length}`,
    );
    console.log('  VERIFIED INVARIANT: Air job has exactly 0 ocean containers (No dummy MSKU containers).');

    // Verify Cost Center was automatically created under 'project'
    assert(Boolean(job.cost_center_id), 'Job must have a cost center allocated');
    const costCenter = await db
      .selectFrom('cost_centers')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', job.cost_center_id as any)
      .executeTakeFirst();
    assert(Boolean(costCenter), 'Cost center record must exist in DB');
    assert(costCenter?.code === job.job_number, `Cost center code must equal job number: ${costCenter?.code}`);
    assert(costCenter?.dimension === 'project', 'Cost center dimension must be "project"');
    assert(Boolean(costCenter?.name?.includes('شحنة جوية')), 'Cost center name must reflect air shipment');
    console.log(`  -> Verified Cost Center: ${costCenter?.code} - ${costCenter?.name}`);

    // Verify initial milestone is BKD (Cargo iQ Air Booking)
    assert(
      jobDetails.milestone_status === 'BKD',
      `Initial air milestone must be "BKD", got: ${jobDetails.milestone_status}`,
    );
    console.log('  [PASS] STEP 7 PASSED: Air job converted with Cost Center, 0 containers, and BKD milestone.\n');

    // -------------------------------------------------------------------------
    // STEP 8: Flight Booking & IATA Modulo-7 MAWB Validation Gate
    // -------------------------------------------------------------------------
    console.log('[STEP 8] Testing IATA Modulo-7 MAWB Validation Gate on Job Update...');
    // 8a: Try invalid MAWB check digit (1234567 % 7 is 5, but submitting 4)
    let caughtInvalidMawb = false;
    try {
      await freightService.updateJob(auth, String(job.id), {
        mawbNumber: '077-12345674',
      });
    } catch (err: any) {
      caughtInvalidMawb = true;
      console.log(`  -> Correctly blocked invalid MAWB 077-12345674: ${err.message}`);
      assert(
        err.message.includes('Modulo-7') || err.message.includes('Check Digit'),
        'Error must specify Modulo-7 check digit',
      );
    }
    assert(caughtInvalidMawb, 'System MUST reject invalid IATA MAWB check digits');

    // 8b: Submit valid MAWB 077-12345675
    const updatedWithMawb = await freightService.updateJob(auth, String(job.id), {
      flightNumber: 'MS-801',
      flightDate: '2026-10-15',
      mawbNumber: '077-12345675',
      hawbNumber: 'HAWB-DXB-9901',
    });
    assert(updatedWithMawb.flight_number === 'MS-801', 'Flight number must be MS-801');
    assert(
      updatedWithMawb.mawb_number === '077-1234 5675',
      `Formatted MAWB expected "077-1234 5675", got: ${updatedWithMawb.mawb_number}`,
    );
    assert(updatedWithMawb.hawb_number === 'HAWB-DXB-9901', 'HAWB must be recorded');
    console.log(`  -> Validated & formatted MAWB: ${updatedWithMawb.mawb_number}`);
    console.log('  [PASS] STEP 8 PASSED: IATA Modulo-7 validation gate enforced.\n');

    // -------------------------------------------------------------------------
    // STEP 9: Progress Cargo iQ Lifecycle Milestones & Multimodal WhatsApp Alerts
    // -------------------------------------------------------------------------
    console.log('[STEP 9] Progressing Cargo iQ Milestones (RCS -> MAN -> DEP -> ARR -> RCF -> CUST -> NFD)...');

    // 9a: RCS - Cargo Received from Shipper at Cairo Cargo Village
    await freightService.addJobMilestone(
      auth,
      String(job.id),
      'RCS',
      'تم استلام 15 طرد بمستودع قرية البضائع بالقاهرة ومطابقة الوزن 500 كجم والحجم 4 م3',
      'CAI Cargo Village',
    );
    const track = await freightService.getJobById(auth, String(job.id));
    assert(track.milestone_status === 'RCS', 'Milestone status must be RCS');
    const lastMs = track.milestones[track.milestones.length - 1];
    assert(
      lastMs.milestone_title.includes('استلام الشحنة بمستودع المطار'),
      `Bilingual title must exist: ${lastMs.milestone_title}`,
    );

    // 9b: MAN - Manifested on Flight
    await freightService.addJobMilestone(
      auth,
      String(job.id),
      'MAN',
      'تم إدراج الشحنة على مانيفست رحلة مصر للطيران MS-801',
    );

    // 9c: DEP - Flight Departed CAI
    await freightService.addJobMilestone(auth, String(job.id), 'DEP', 'أقلعت طائرة الشحن متجهة إلى دبي (ATD)', 'CAI');

    // Test WhatsApp message format for flight departure
    const waMsgDep = await freightService.getMilestoneWhatsAppMessage(auth, String(job.id), 'DEP');
    assert(waMsgDep.message.includes('شحنتكم الجوية'), 'WhatsApp message must use air terminology');
    assert(waMsgDep.message.includes('MS-801'), 'WhatsApp message must include flight number');
    assert(waMsgDep.message.includes('https://'), 'WhatsApp message must include direct tracking link');
    console.log(`  -> Verified Air WhatsApp Alert Template: ${waMsgDep.milestoneTitle}`);

    // 9d: ARR - Flight Arrived DXB
    await freightService.addJobMilestone(
      auth,
      String(job.id),
      'ARR',
      'هبوط ووصول الطائرة بمطار دبي الدولي (ATA)',
      'DXB',
    );

    // 9e: RCF - Cargo Received from Flight into DXB Cargo Terminal
    await freightService.addJobMilestone(
      auth,
      String(job.id),
      'RCF',
      'تفريغ ودخول الشحنة لمستودع الشحن بدبي',
      'DXB Dnata Terminal',
    );

    // 9f: CUST - Customs Cleared at DXB Airport
    await freightService.addJobMilestone(
      auth,
      String(job.id),
      'CUST',
      'تم إنهاء الإفراج والتخليص الجمركي بمطار دبي بنجاح',
    );

    // 9g: NFD - Consignee Notified
    await freightService.addJobMilestone(
      auth,
      String(job.id),
      'NFD',
      'تم إشعار العميل المستلم بوصول الشحنة وجاهزيتها للتسليم',
    );
    console.log('  [PASS] STEP 9 PASSED: All Cargo iQ milestones progressed with bilingual titles & alerts.\n');

    // -------------------------------------------------------------------------
    // STEP 10: Air Delivery Order Release (AWD Milestone Verification)
    // -------------------------------------------------------------------------
    console.log('[STEP 10] Releasing Air Cargo Delivery Order (D/O & Documents)...');
    const doJob = await freightService.releaseDeliveryOrder(auth, String(job.id));
    assert(doJob.milestone_status === 'AWD', `Air D/O must register milestone "AWD", got: ${doJob.milestone_status}`);
    const doDetails = await freightService.getJobById(auth, String(job.id));
    const doMilestone = doDetails.milestones.find((m) => m.milestone_key === 'AWD');
    assert(Boolean(doMilestone), 'AWD milestone must exist');
    assert(Boolean(doMilestone?.milestone_title.includes('إذن التسليم')), 'AWD title must reflect Air Delivery Order');
    console.log(`  -> Released Air Delivery Order: ${doMilestone?.milestone_title}`);
    console.log('  [PASS] STEP 10 PASSED: Air Delivery Order release verified.\n');

    // -------------------------------------------------------------------------
    // STEP 11: Final Delivery POD & Shipment Completion
    // -------------------------------------------------------------------------
    console.log('[STEP 11] Recording Final Proof of Delivery (DLV) & Completing Job...');
    await freightService.addJobMilestone(
      auth,
      String(job.id),
      'DLV',
      'تم تسليم الشحنة للعميل نهائياً بمقر دبي وتوقيع استلام POD',
    );

    // Mark Job completed
    const completedJob = await freightService.updateJob(auth, String(job.id), {
      status: 'completed',
    });
    assert(completedJob.status === 'completed', 'Job status must be "completed"');
    assert(completedJob.milestone_status === 'DLV', 'Final milestone status must be "DLV"');
    console.log('  [PASS] STEP 11 PASSED: Air Job delivered & completed.\n');

    console.log('========================================================================');
    console.log('  ALL AIR FREIGHT LIFECYCLE AUDIT & VERIFICATION TESTS PASSED 100%!');
    console.log('========================================================================\n');
  } catch (error: any) {
    console.error('[FAIL] AIR FREIGHT LIFECYCLE TEST FAILED:', error);
    process.exit(1);
  } finally {
    await app.close();
    process.exit(0);
  }
}

runAirFreightLifecycleTest();
