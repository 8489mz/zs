import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { MaritimeFreightService } from '../src/modules/maritime-freight/maritime-freight.service';
import { MaritimeMailService } from '../src/modules/maritime-freight/maritime-mail.service';
import { Kysely, sql } from 'kysely';
import { Database } from '../src/database/database.types';
import { AuthContext } from '../src/core/auth/interfaces/auth-context.interface';
import { DcsaMilestoneKey } from '../src/modules/maritime-freight/maritime-freight.types';
import { KYSELY_DB } from '../src/database/database.constants';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`[FAIL] ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

async function runSeaFreightLifecycleTest() {
  console.log('========================================================================');
  console.log('  STARTING COMPREHENSIVE END-TO-END INTERNATIONAL SEA FREIGHT TEST');
  console.log('========================================================================\n');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const freightService = app.get(MaritimeFreightService);
  const mailService = app.get(MaritimeMailService);
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

    // Ensure master data (shipping lines, ports) are present
    await freightService.ensureDefaultMasterData(tenantId);

    // -------------------------------------------------------------------------
    // STEP 1: Create Client Sea Freight Inquiry (طلب شحن بحري جديد)
    // -------------------------------------------------------------------------
    console.log('[STEP 1] Creating Sea Freight Inquiry (FCL / 40HC)...');
    const inquiryDto = {
      transportMode: 'sea' as const,
      customerName: 'شركة الإسكندرية للصناعات الهندسية',
      customerPhone: '01099887766',
      customerEmail: 'logistics@alex-engineering.com',
      direction: 'import' as const,
      polCode: 'CNSHA',
      polName: 'ميناء شنغهاي - الصين (CNSHA)',
      podCode: 'EGALY',
      podName: 'ميناء الإسكندرية - مصر (EGALY)',
      incoterm: 'FOB',
      cargoMode: 'FCL',
      containerType: '40HC',
      containerCount: 2,
      commodityDescription: 'خطوط إنتاج وماكينات تعبئة وتغليف صناعية',
      cargoNature: 'general',
      grossWeightKg: 42000,
      cbm: 120,
      targetFreeDays: 14,
      paymentTerm: 'prepaid' as const,
      notes: 'شحنة بحرية هامة - مطلوب فترات سماح لا تقل عن 14 يوم بالإسكندرية',
    };

    const inquiry = await freightService.createInquiry(auth, inquiryDto);
    console.log(`  -> Created Inquiry #${inquiry.inquiry_number} (ID: ${inquiry.id})`);
    assert(Boolean(inquiry.id), 'Inquiry ID must exist');
    assert(
      /^INQ-\d{6}-\d{4}$/.test(inquiry.inquiry_number),
      `Inquiry number must follow INQ-YYMMDD-XXXX formula, got: ${inquiry.inquiry_number}`,
    );
    assert(inquiry.status === 'received', 'Initial status must be "received"');
    assert(inquiry.transport_mode === 'sea', 'Transport mode must be "sea"');
    assert(Number(inquiry.container_count) === 2, 'Container count must be 2');
    console.log('  [PASS] STEP 1 PASSED: Sea Inquiry created & validated.\n');

    // -------------------------------------------------------------------------
    // STEP 2: Convert Inquiry to Maritime RFQ (تحويل الاستفسار إلى طلب تسعير خطوط)
    // -------------------------------------------------------------------------
    console.log('[STEP 2] Converting Inquiry to Line RFQ (طلب تسعير الخطوط)...');

    // Fetch available shipping lines for tenant
    const lines = await db
      .selectFrom('shipping_lines')
      .select(['id', 'code', 'name_en'])
      .where('tenant_id', '=', tenantId)
      .where('code', 'in', ['MSCU', 'MAEU', 'CMDU'])
      .execute();

    const targetLineIds = lines.map((l) => Number(l.id));
    console.log(`  -> Targeting ${lines.length} carriers:`, lines.map((l) => `${l.name_en} (${l.code})`).join(', '));
    assert(targetLineIds.length > 0, 'Must have carrier shipping lines to target');

    const rfq = await freightService.convertInquiryToRfq(auth, String(inquiry.id), targetLineIds);
    console.log(`  -> Created RFQ #${rfq.rfq_number} (ID: ${rfq.id})`);
    assert(Boolean(rfq.id), 'RFQ ID must exist');
    assert(
      /^RFQ-\d{6}-\d{4}$/.test(rfq.rfq_number),
      `RFQ number must follow RFQ-YYMMDD-XXXX formula, got: ${rfq.rfq_number}`,
    );
    assert(rfq.transport_mode === 'sea', 'RFQ transport mode must be preserved as "sea"');
    assert(String(rfq.inquiry_id) === String(inquiry.id), 'RFQ must be linked to source inquiry');

    // Verify inquiry status was updated to rfq_created
    const updatedInquiry = await freightService.getInquiryById(auth, String(inquiry.id));
    assert(updatedInquiry.status === 'rfq_created', 'Inquiry status must be updated to "rfq_created"');
    assert(String(updatedInquiry.rfq_id) === String(rfq.id), 'Inquiry must point to generated rfq_id');
    console.log('  [PASS] STEP 2 PASSED: Inquiry converted to RFQ and bi-directional link verified.\n');

    // -------------------------------------------------------------------------
    // STEP 3: Dispatch RFQ Emails to Shipping Lines (إرسال طلب التسعير للخطوط)
    // -------------------------------------------------------------------------
    console.log('[STEP 3] Dispatching RFQ Emails to Shipping Lines...');
    const dispatchRes = await freightService.dispatchRfqEmails(auth, String(rfq.id), targetLineIds);
    console.log(`  -> Dispatch Result: ${dispatchRes.message} (Sent count: ${dispatchRes.sentCount})`);
    assert(dispatchRes.sentCount > 0, 'At least 1 carrier email must be dispatched/simulated');

    // Check RFQ status is now "sent"
    const sentRfq = await freightService.getRfqById(auth, String(rfq.id));
    assert(sentRfq.status === 'sent', `RFQ status must be "sent", got: ${sentRfq.status}`);
    console.log('  [PASS] STEP 3 PASSED: RFQ dispatched and status changed to "sent".\n');

    // -------------------------------------------------------------------------
    // STEP 4: Carrier Email Text Parsing & Inbound Bids Ingestion
    // -------------------------------------------------------------------------
    console.log('[STEP 4] Testing Smart Inbound Carrier Email Parsing & Bids Recording...');

    // Carrier 1 Email Text (e.g. from MSC pricing desk)
    const mscEmailBody = `
      Dear Customer,
      Thank you for your freight inquiry [${rfq.rfq_number}].
      We are pleased to offer our spot ocean rates for 2x 40'HC from Shanghai to Alexandria:
      - Ocean Freight: $2,450 USD per container
      - Origin THC: $180 USD
      - Destination THC: $260 USD
      - Transit Time: 26 days
      - Free Days: 14 days detention free at Alexandria Port
      Validity: End of current month.
      Best regards,
      MSC Mediterranean Shipping Company
    `;

    const parsedMsc = freightService.parseCarrierEmailText(mscEmailBody);
    console.log('  -> Parsed MSC Email:', {
      oceanFreight: parsedMsc.oceanFreight,
      thcOrigin: parsedMsc.thcOrigin,
      thcDestination: parsedMsc.thcDestination,
      freeDays: parsedMsc.freeDays,
      transitTimeDays: parsedMsc.transitTimeDays,
      currency: parsedMsc.currency,
      totalEstimated: parsedMsc.totalEstimated,
    });

    assert(parsedMsc.oceanFreight === 2450, `Expected ocean freight 2450, got: ${parsedMsc.oceanFreight}`);
    assert(parsedMsc.thcOrigin === 180, `Expected origin THC 180, got: ${parsedMsc.thcOrigin}`);
    assert(parsedMsc.thcDestination === 260, `Expected dest THC 260, got: ${parsedMsc.thcDestination}`);
    assert(parsedMsc.freeDays === 14, `Expected 14 free days, got: ${parsedMsc.freeDays}`);
    assert(parsedMsc.transitTimeDays === 26, `Expected 26 days transit, got: ${parsedMsc.transitTimeDays}`);
    assert(parsedMsc.totalEstimated === 2450 + 180 + 260, 'Total estimated matches sum');

    // Submit MSC Bid
    const mscLine = lines.find((l) => l.code === 'MSCU') || lines[0];
    const mscBid = await freightService.submitBid(auth, {
      rfqId: String(rfq.id),
      shippingLineId: Number(mscLine.id),
      shippingLineName: mscLine.name_en,
      oceanFreight: parsedMsc.oceanFreight,
      currency: parsedMsc.currency,
      thcOrigin: parsedMsc.thcOrigin,
      thcDestination: parsedMsc.thcDestination,
      freeDays: parsedMsc.freeDays,
      transitTimeDays: parsedMsc.transitTimeDays,
      submissionChannel: 'email_auto',
      notes: 'عرض رسمي مستلم من إيميل الخط الملاحي MSC',
    });
    console.log(`  -> Recorded MSC Bid ID: ${mscBid.id}, Total Freight Cost: $${mscBid.total_freight_cost}`);

    // Submit Competitor Bid (Maersk) to enable Matrix Comparison
    const maerskLine = lines.find((l) => l.code === 'MAEU') || lines[1] || lines[0];
    const maerskBid = await freightService.submitBid(auth, {
      rfqId: String(rfq.id),
      shippingLineId: Number(maerskLine.id),
      shippingLineName: maerskLine.name_en,
      oceanFreight: 2600,
      currency: 'USD',
      thcOrigin: 160,
      thcDestination: 240,
      freeDays: 21,
      transitTimeDays: 22,
      submissionChannel: 'carrier_portal',
      notes: 'عرض بديل عبر البوابة - ميرسك مع 21 يوم سماح',
    });
    console.log(`  -> Recorded Maersk Bid ID: ${maerskBid.id}, Total Freight Cost: $${maerskBid.total_freight_cost}`);

    // Check RFQ status is now "bids_received"
    const rfqWithBids = await freightService.getRfqById(auth, String(rfq.id));
    assert(rfqWithBids.status === 'bids_received', `RFQ status must be "bids_received", got: ${rfqWithBids.status}`);
    assert(rfqWithBids.bids && rfqWithBids.bids.length === 2, 'RFQ must have 2 submitted bids');
    console.log('  [PASS] STEP 4 PASSED: Smart text parsing & 2 carrier bids submitted.\n');

    // -------------------------------------------------------------------------
    // STEP 5: Matrix Comparison & Bid Awarding (مقارنة العروض وترسية العرض الفائز)
    // -------------------------------------------------------------------------
    console.log('[STEP 5] Comparing Bids in Matrix & Awarding Best Carrier...');
    console.log(`  -> Bid 1 (MSC): Total $${mscBid.total_freight_cost}, Transit: 26d, Free Days: 14d`);
    console.log(`  -> Bid 2 (Maersk): Total $${maerskBid.total_freight_cost}, Transit: 22d, Free Days: 21d`);

    // Award MSC Bid
    const awarded = await freightService.awardBid(auth, String(mscBid.id));
    assert(Boolean(awarded.is_awarded), 'Awarded bid must have is_awarded = true');
    assert(Boolean(awarded.awarded_at), 'Awarded bid must have awarded_at timestamp');

    // Check RFQ is now awarded
    const awardedRfq = await freightService.getRfqById(auth, String(rfq.id));
    assert(awardedRfq.status === 'awarded', `RFQ status must be "awarded", got: ${awardedRfq.status}`);

    // Check competitor bid is not awarded
    const bidsAfterAward = awardedRfq.bids || [];
    const nonAwarded = bidsAfterAward.find((b: any) => String(b.id) === String(maerskBid.id));
    assert(Boolean(nonAwarded && !nonAwarded.is_awarded), 'Competitor bid must not be awarded');
    console.log(`  [PASS] STEP 5 PASSED: MSC Bid #${mscBid.id} awarded successfully.\n`);

    // -------------------------------------------------------------------------
    // STEP 6: Client Quotation Generation & Margin Calculation
    // -------------------------------------------------------------------------
    console.log('[STEP 6] Generating Client Quotation with Markup & Foreign Exchange...');
    const baseCostPerContainer = Number(mscBid.total_freight_cost); // $2890
    const totalBaseCost = baseCostPerContainer * 2; // $5780 for 2 containers
    const markupValue = 250; // $250 profit per container
    const totalMargin = markupValue * 2; // $500 total markup
    const exchangeRate = 48.5; // EGP / USD

    const quote = await freightService.createQuotation(auth, {
      inquiryId: String(inquiry.id),
      rfqId: String(rfq.id),
      bidId: String(mscBid.id),
      customerName: inquiry.customer_name,
      customerPhone: inquiry.customer_phone || undefined,
      customerEmail: inquiry.customer_email || undefined,
      transportMode: 'sea',
      baseCost: totalBaseCost,
      currency: 'USD',
      marginType: 'fixed',
      marginValue: totalMargin,
      exchangeRate,
      charges: [
        {
          chargeCode: 'O-FRT',
          chargeNameAr: 'نولون بحري (2x 40HC)',
          chargeNameEn: 'Ocean Freight (2x 40HC)',
          currency: 'USD',
          quantity: 2,
          unitRate: 2450 + markupValue,
          totalAmount: (2450 + markupValue) * 2,
        },
        {
          chargeCode: 'THC-O',
          chargeNameAr: 'عوايد تفريغ وشحن ميناء شنغهاي (THC-O)',
          chargeNameEn: 'Origin Terminal Handling Charge',
          currency: 'USD',
          quantity: 2,
          unitRate: 180,
          totalAmount: 180 * 2,
        },
        {
          chargeCode: 'THC-D',
          chargeNameAr: 'عوايد تفريغ ميناء الإسكندرية (THC-D)',
          chargeNameEn: 'Destination Terminal Handling Charge',
          currency: 'USD',
          quantity: 2,
          unitRate: 260,
          totalAmount: 260 * 2,
        },
      ],
      notes: 'عرض سعر معتمد شامل نولون بحري وفترات سماح 14 يوم بالإسكندرية',
    });

    console.log(`  -> Created Quotation #${quote.quotation_number} (ID: ${quote.id})`);
    assert(Boolean(quote.id), 'Quotation ID must exist');
    assert(
      /^QUO-\d{6}-\d{4}$/.test(quote.quotation_number),
      `Quotation number must follow QUO-YYMMDD-XXXX formula, got: ${quote.quotation_number}`,
    );
    assert(Number(quote.base_cost) === totalBaseCost, 'Base cost matches');
    assert(Number(quote.final_total) === totalBaseCost + totalMargin, 'Final total includes margin');
    assert(
      Math.round(Number(quote.final_total_local)) === Math.round((totalBaseCost + totalMargin) * exchangeRate),
      'Final total local equals total * exchange rate',
    );
    console.log('  -> Quote Amounts:', {
      baseUSD: quote.base_cost,
      marginUSD: quote.margin_value,
      finalTotalUSD: quote.final_total,
      rate: quote.exchange_rate,
      finalTotalEGP: quote.final_total_local,
    });
    console.log('  [PASS] STEP 6 PASSED: Client quotation created with accurate financial math.\n');

    // -------------------------------------------------------------------------
    // STEP 7: Convert Quotation to Operational Job & Allocate Containers
    // -------------------------------------------------------------------------
    console.log('[STEP 7] Converting Quotation to Operational Maritime Job (أمر تشغيل الشحنة)...');
    const job = await freightService.autoConvertQuotationToJob(auth, String(quote.id));
    console.log(`  -> Created Job #${job.job_number} (ID: ${job.id})`);
    assert(Boolean(job.id), 'Job ID must exist');
    assert(
      /^JOB-\d{6}-\d{4}$/.test(job.job_number),
      `Job number must follow JOB-YYMMDD-XXXX formula, got: ${job.job_number}`,
    );
    assert(job.status === 'active', 'Initial Job status must be "active"');
    assert(job.milestone_status === 'BOOK', 'Initial sea freight milestone must be "BOOK"');
    assert(job.shipping_line_name === mscBid.shipping_line_name, 'Assigned carrier must match awarded bid');

    // Verify Accounting Cost Center was automatically opened
    assert(Boolean(job.cost_center_id), 'Job must have an automatic Accounting Cost Center ID');
    const costCenter = await db
      .selectFrom('cost_centers')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', job.cost_center_id as any)
      .executeTakeFirst();
    assert(Boolean(costCenter), 'Cost center must exist in database');
    assert(costCenter?.code === job.job_number, 'Cost center code must match JOB number exactly');
    console.log(`  -> Verified Accounting Cost Center: [${costCenter?.code}] ${costCenter?.name}`);

    // Verify containers created
    const containers = await db
      .selectFrom('maritime_containers')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', String(job.id))
      .execute();

    console.log(`  -> Allocated Containers count: ${containers.length}`);
    assert(containers.length === 2, 'Must have allocated 2 containers for 2x 40HC');
    containers.forEach((c) => {
      assert(c.free_days === 14, 'Container free days must match 14 days');
      assert(c.container_type === '40HC', 'Container type must be 40HC');
    });

    // Verify Quotation & Inquiry status updated to converted_to_job
    const updatedQuote = await db
      .selectFrom('maritime_quotations')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', quote.id as any)
      .executeTakeFirst();
    assert(Boolean(updatedQuote), 'Quote must exist');
    assert(updatedQuote?.status === 'converted_to_job', 'Quotation status must be "converted_to_job"');
    assert(String(updatedQuote?.converted_job_id) === String(job.id), 'Quotation must point to job.id');

    const finalInquiry = await freightService.getInquiryById(auth, String(inquiry.id));
    assert(finalInquiry.status === 'converted_to_job', 'Inquiry status must be "converted_to_job"');
    console.log(
      '  [PASS] STEP 7 PASSED: Job created, cost center opened, containers allocated, lifecycle statuses updated.\n',
    );

    // -------------------------------------------------------------------------
    // STEP 8: Container Tracking & DCSA Standard Milestones
    // -------------------------------------------------------------------------
    console.log('[STEP 8] Progressing DCSA Sea Freight Milestones (Tracking & Operations)...');
    const seaMilestones: Array<{ key: DcsaMilestoneKey; title: string; loc: string; notes: string }> = [
      {
        key: 'GTI',
        title: 'دخول بوابة الميناء (Gate In)',
        loc: 'Shanghai Terminal Gate 4',
        notes: 'دخلت الحاويات ساحة التصدير بميناء شنغهاي',
      },
      {
        key: 'LOAD',
        title: 'التحميل على السفينة (Loaded on Vessel)',
        loc: 'Shanghai Berth 2',
        notes: 'تم شحن الحاويات على متن السفينة MSC ISABELLA',
      },
      {
        key: 'DEPT',
        title: 'مغادرة ميناء الشحن (Vessel Departure)',
        loc: 'East China Sea',
        notes: 'أبحرت السفينة بالرحلة رقم 2610W باتجاه ميناء الإسكندرية',
      },
      {
        key: 'ARRI',
        title: 'وصول ميناء الوجهة (Vessel Arrival)',
        loc: 'Alexandria Outer Anchorage',
        notes: 'وصلت السفينة لغاطس ميناء الإسكندرية',
      },
      {
        key: 'DISC',
        title: 'التفريغ على الرصيف (Discharged at POD)',
        loc: 'Alexandria Container Terminal',
        notes: 'تم تفريغ الحاويات وبدء سريان فترة السماح 14 يوم',
      },
      {
        key: 'CUST',
        title: 'الإفراج الجمركي (Customs Cleared)',
        loc: 'Alexandria Customs Authority',
        notes: 'تم إنهاء الكشف والمعاينة والإفراج الجمركي بموجب شهادة الوارد',
      },
      {
        key: 'GTO',
        title: 'خروج الحاويات من الميناء (Gate Out)',
        loc: 'Alexandria Port Gate 27',
        notes: 'تم إصدار إذن التسليم وخروج الشاحنات بالحاويات من الميناء',
      },
      {
        key: 'DLVR',
        title: 'التسليم للمستودع (Cargo Delivered)',
        loc: 'Alexandria Industrial Zone Warehouse',
        notes: 'تم وصول وتفريغ البضائع بمستودع العميل واستلام أصل بوليصة التسليم POD',
      },
      {
        key: 'RETN',
        title: 'إرجاع الحاويات الفارغة (Empty Returned)',
        loc: 'MSC Empty Depot Dekheila',
        notes: 'تم إعادة الحاويات الفارغة بحالة سليمة لساحة الخط الملاحي واسترداد إيصال الإرجاع',
      },
    ];

    for (const m of seaMilestones) {
      await freightService.addJobMilestone(auth, String(job.id), m.key, m.notes, m.loc);
      console.log(`  -> Milestone [${m.key}] recorded: ${m.title}`);
    }

    // Verify milestones in database
    const recordedMilestones = await db
      .selectFrom('maritime_job_milestones')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', String(job.id))
      .orderBy('id', 'asc')
      .execute();

    assert(
      recordedMilestones.length === 1 + seaMilestones.length,
      `Expected 10 total milestones (1 initial BOOK + 9 progression), got: ${recordedMilestones.length}`,
    );
    console.log('  [PASS] STEP 8 PASSED: Full DCSA standard lifecycle milestones recorded successfully.\n');

    // -------------------------------------------------------------------------
    // STEP 9: Demurrage Radar & Container Return Deadlines Verification
    // -------------------------------------------------------------------------
    console.log('[STEP 9] Verifying Demurrage Radar (رادار فترات السماح وغرامات الأرضيات)...');

    // Simulate return date on containers to ensure Demurrage calculation works accurately
    const containerList = await freightService.getContainers(auth, { search: job.job_number });
    assert(containerList.length === 2, `Expected 2 containers returned by filter, got: ${containerList.length}`);

    for (const c of containerList) {
      console.log(
        `  -> Container ${c.container_number}: Free Days=${c.free_days}, Overdue=${c.is_overdue}, Deposit=${c.deposit_amount} ${c.deposit_currency}`,
      );
      assert(c.free_days === 14, 'Container free days must be 14');
    }

    // Test returning empty container
    const firstContainer = containerList[0];
    const returnDate = new Date().toISOString();
    await freightService.updateContainer(auth, String(firstContainer.id), {
      emptyReturnedAt: returnDate,
    });

    const refreshedContainer = (
      await freightService.getContainers(auth, { search: firstContainer.container_number })
    )[0];
    assert(Boolean(refreshedContainer.empty_returned_at), 'empty_returned_at must be populated');
    assert(refreshedContainer.deposit_status === 'not_required', 'deposit_status must be not_required');
    console.log('  [PASS] STEP 9 PASSED: Container return & deadlines validated.\n');

    // -------------------------------------------------------------------------
    // STEP 10: Complete Shipment & Operational File Archiving
    // -------------------------------------------------------------------------
    console.log('[STEP 10] Completing Shipment & Archiving Operational Job...');
    await freightService.updateJob(auth, String(job.id), {
      status: 'completed',
      deliveryOrderReleased: true,
      notes:
        'تمت دورة الشحن البحري بنجاح تام: من استفسار العميل إلى التسليم وإرجاع الحاويات وإغلاق الملف التشغيلي والمالي.',
    });

    const finalJob = await freightService.getJobById(auth, String(job.id));
    assert(finalJob.status === 'completed', 'Job status must be "completed"');
    assert(finalJob.delivery_order_released === true, 'Delivery order must be released');
    console.log('  -> Final Job Status:', {
      jobNumber: finalJob.job_number,
      customer: finalJob.customer_name,
      carrier: finalJob.shipping_line_name,
      status: finalJob.status,
      milestone: finalJob.milestone_status,
      costCenter: finalJob.cost_center_id,
    });
    console.log('  [PASS] STEP 10 PASSED: Shipment marked completed and archived.\n');

    console.log('========================================================================');
    console.log('  ALL 10 PHASES OF INTERNATIONAL SEA FREIGHT PASSED 100% WITH SUCCESS!');
    console.log('========================================================================\n');
  } catch (err: any) {
    console.error('[FAIL] E2E SEA FREIGHT TEST FAILED:', err?.message || err);
    console.error(err?.stack);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

runSeaFreightLifecycleTest();
