import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../src/app.module';
import { ContractingService } from '../../../src/modules/contracting/contracting.service';
import { Kysely, sql } from 'kysely';
import { Database } from '../../../src/database/database.types';
import { AuthContext } from '../../../src/core/auth/interfaces/auth-context.interface';
import { KYSELY_DB } from '../../../src/database/database.constants';
import { computeIpc, IpcTerms } from '../../../src/modules/contracting/ipc-calculation.engine';
import {
  assertAdvancePaymentGate,
  checkIpcGuaranteeInterlocking,
  BankGuarantee,
} from '../../../src/modules/contracting/guarantee-gateway.engine';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`[FAIL] ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

async function ensureAccountingAccounts(db: Kysely<Database>, tenantId: string): Promise<void> {
  const accountsToEnsure = [
    {
      code: '1180',
      name_ar: 'أمانات وحجز ضمان العملاء (محتجزات مدينة)',
      name_en: 'Client Retentions Receivable',
      type: 'asset',
      group: 'current_assets',
      normal_balance: 'debit',
      isReceivable: false,
      isPayable: false,
    },
    {
      code: '2180',
      name_ar: 'أمانات وحجز ضمان مقاولي الباطن (محتجزات دائنة)',
      name_en: 'Subcontractor Retentions Payable',
      type: 'liability',
      group: 'current_liabilities',
      normal_balance: 'credit',
      isReceivable: false,
      isPayable: false,
    },
  ];

  for (const acc of accountsToEnsure) {
    const existing = await (db as any)
      .selectFrom('accounting_accounts')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('code', '=', acc.code)
      .executeTakeFirst();

    if (!existing) {
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
          is_receivable: acc.isReceivable,
          is_payable: acc.isPayable,
          is_active: true,
          is_system: false,
          allow_manual_entries: true,
          is_control_account: false,
          is_cash_bank: false,
          is_inventory: false,
          is_tax: false,
          is_monetary: false,
          description_ar: acc.name_ar,
          sort_order: 100,
        })
        .execute();
    }
  }
}

export async function runContractingConstructionMasterSimulation(): Promise<void> {
  console.log('========================================================================');
  console.log('  STARTING COMPREHENSIVE END-TO-END CONTRACTING & CONSTRUCTION SIMULATION');
  console.log('========================================================================\n');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const contractingService = app.get(ContractingService);
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
      sessionId: 'contracting-master-simulation',
      username: 'admin',
      role: 'super_admin',
      permissions: ['*'],
      tenantId,
      accountId: tenantId,
    };

    // Ensure baseline chart of accounts for construction ledger posting
    await ensureAccountingAccounts(db, tenantId);

    // -------------------------------------------------------------------------
    // STEP 1: Project Creation & Accounting Cost Center Auto-Generation
    // -------------------------------------------------------------------------
    console.log('[STEP 1] Creating Construction Project with Contractual Parameters...');
    const contractValue = 1_000_000; // 1,000,000 EGP
    const downPaymentAmount = 100_000; // 10% Advance = 100,000 EGP
    const retentionPercent = 5; // 5% Retention

    const project = await contractingService.createProject(auth, {
      name: 'أبراج النيل التخصصية - المرحلة الأولى (مشروع تدقيق)',
      clientName: 'الهيئة العامة للتطوير العقاري والاستثمار',
      contractValue,
      downPaymentAmount,
      retentionPercent,
      startDate: '2026-01-01',
      expectedEndDate: '2026-12-31',
      status: 'planning',
    });

    console.log(`  -> Created Project #${project.code} (ID: ${project.id})`);
    assert(Boolean(project.id), 'Project ID must exist');
    assert(Boolean(project.code), 'Project code must exist');
    assert(Number(project.contractValue) === contractValue, 'Contract value must match');
    assert(Number(project.downPaymentAmount) === downPaymentAmount, 'Down payment must match');
    assert(Number(project.retentionPercent) === retentionPercent, 'Retention % must match');

    // Verify Cost Center auto-created
    assert(Boolean(project.costCenterId), 'Project must have auto-allocated cost center ID');
    const costCenter = await (db as any)
      .selectFrom('cost_centers')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', project.costCenterId)
      .executeTakeFirst();
    assert(Boolean(costCenter), 'Project cost center record must exist in DB');
    assert(costCenter.dimension === 'project', 'Cost center dimension must be "project"');
    console.log(`  -> Verified Cost Center: [${costCenter.code}] ${costCenter.name}`);
    console.log('  [PASS] STEP 1 PASSED: Project & Cost Center created successfully.\n');

    // -------------------------------------------------------------------------
    // STEP 2: SOV / BOQ Engineering Bill of Quantities Breakdown
    // -------------------------------------------------------------------------
    console.log('[STEP 2] Setting up Bill of Quantities (SOV / BOQ Items)...');

    // BOQ Item 1: Earthworks
    const boq1 = await contractingService.createBoqItem(auth, String(project.id), {
      itemCode: 'BOQ-01',
      description: 'أعمال الحفر والإحلال وتثبيت طبقات التربة',
      unit: 'm3',
      contractQty: 500,
      unitPrice: 200, // 500 * 200 = 100,000 EGP
      estimatedUnitCost: 140,
    });
    assert(Boolean(boq1), 'BOQ Item 1 must be created');
    console.log(`  -> BOQ Item 1: [${boq1!.itemCode}] ${boq1!.description} (500 m3 @ 200 EGP = 100,000 EGP)`);

    // BOQ Item 2: Reinforced Concrete
    const boq2 = await contractingService.createBoqItem(auth, String(project.id), {
      itemCode: 'BOQ-02',
      description: 'أعمال الخرسانة المسلحة للأساسات والأعمدة',
      unit: 'm3',
      contractQty: 300,
      unitPrice: 2000, // 300 * 2000 = 600,000 EGP
      estimatedUnitCost: 1500,
    });
    assert(Boolean(boq2), 'BOQ Item 2 must be created');
    console.log(`  -> BOQ Item 2: [${boq2!.itemCode}] ${boq2!.description} (300 m3 @ 2,000 EGP = 600,000 EGP)`);

    // BOQ Item 3: Masonry & Architecture Finishes
    const boq3 = await contractingService.createBoqItem(auth, String(project.id), {
      itemCode: 'BOQ-03',
      description: 'أعمال البناء والتشطيبات المعمارية والواجهات',
      unit: 'm2',
      contractQty: 1000,
      unitPrice: 300, // 1000 * 300 = 300,000 EGP
      estimatedUnitCost: 210,
    });
    assert(Boolean(boq3), 'BOQ Item 3 must be created');
    console.log(`  -> BOQ Item 3: [${boq3!.itemCode}] ${boq3!.description} (1,000 m2 @ 300 EGP = 300,000 EGP)`);

    const boqItems = await contractingService.getBoqItems(auth, String(project.id));
    assert(boqItems.length === 3, 'Project must have 3 BOQ items');
    const totalBoqBudget = boqItems.reduce((acc, it) => acc + Number(it.contractQty) * Number(it.unitPrice), 0);
    assert(
      totalBoqBudget === contractValue,
      `Total BOQ budget (${totalBoqBudget}) must equal contract value (${contractValue})`,
    );
    console.log(`  -> Verified Total BOQ Budget: ${totalBoqBudget} EGP matches Contract Value`);
    console.log('  [PASS] STEP 2 PASSED: SOV / BOQ breakdown established.\n');

    // -------------------------------------------------------------------------
    // STEP 3: Bank Guarantee Registration & Advance Disbursement Gate G1
    // -------------------------------------------------------------------------
    // Register Bank Guarantee in DB to satisfy Interlocking Gateway
    const registeredGuarantee = await contractingService.createGuarantee(auth, {
      projectId: String(project.id),
      guaranteeNumber: `BG-AP-${project.code}-001`,
      guaranteeType: 'advance_payment',
      issuingBank: 'البنك الأهلي المصري',
      amount: 100_000,
      currency: 'EGP',
      issueDate: '2026-01-01',
      expiryDate: '2026-12-31',
    });
    console.log(
      `  -> Registered DB Advance Guarantee #${(registeredGuarantee as any).guarantee_number || (registeredGuarantee as any).guaranteeNumber} (Amount: 100,000 EGP)`,
    );

    const advanceGuarantee: BankGuarantee = {
      id: String(registeredGuarantee.id),
      tenant_id: tenantId,
      project_id: String(project.id),
      guarantee_number: `BG-AP-${project.code}-001`,
      guarantee_type: 'advance_payment',
      issuing_bank: 'البنك الأهلي المصري',
      amount: 100_000,
      currency: 'EGP',
      issue_date: '2026-01-01',
      expiry_date: '2026-12-31',
      status: 'active',
    };

    // Test Gate G1 Pass: Guarantee covers requested disbursement
    const g1PassResult = assertAdvancePaymentGate({
      projectId: String(project.id),
      requestedDisbursementAmount: 100_000,
      disbursementDate: '2026-01-15',
      activeGuarantees: [advanceGuarantee],
    });
    assert(g1PassResult.approved === true, 'Gate G1 must approve disbursement covered by active guarantee');
    console.log('  -> Gateway G1 Approved advance disbursement of 100,000 EGP against guarantee');

    // Test Gate G1 Failure: Block disbursement exceeding guarantee
    let g1Blocked = false;
    try {
      assertAdvancePaymentGate({
        projectId: String(project.id),
        requestedDisbursementAmount: 150_000,
        disbursementDate: '2026-01-15',
        activeGuarantees: [advanceGuarantee],
      });
    } catch (err: any) {
      g1Blocked = true;
      console.log(`  -> Gateway G1 correctly blocked excess disbursement: ${err.message}`);
    }
    assert(g1Blocked === true, 'Gate G1 must strictly reject advance payment exceeding bank guarantee');
    console.log('  [PASS] STEP 3 PASSED: Gateway G1 Advance Payment audit verified.\n');

    // -------------------------------------------------------------------------
    // STEP 4: Subcontractor Interlocking & Advance Guarantee Protection
    // -------------------------------------------------------------------------
    console.log('[STEP 4] Testing Subcontractor Guarantee Interlocking Protection...');
    const subc = await contractingService.createSubcontractor(auth, {
      name: 'شركة الفرسان للمقاولات التخصصية وأعمال التربة',
      contactPerson: 'المهندس فاروق الديب',
      phone: '01099887766',
      taxNumber: '987-654-321',
    });
    assert(Boolean(subc.id), 'Subcontractor ID must exist');

    // Create Subcontract
    const subcontract = await contractingService.createSubcontract(auth, String(project.id), {
      subcontractorId: Number(subc.id),
      contractNumber: `SUB-CTR-${project.code}-01`,
      scopeOfWork: 'أعمال حفر وإحلال الأساسات بمشروع الأبراج',
      totalAmount: 90_000,
      advanceAmount: 18_000, // 20% advance
      retentionPercent: 5,
      advanceRecoveryStartPct: 10,
      advanceRecoveryEndPct: 80,
    });
    assert(Boolean(subcontract.id), 'Subcontract ID must exist');

    // Interlocking Test: Subcontractor with unrecovered advance & NO active guarantee MUST BE BLOCKED
    const blockedInterlock = checkIpcGuaranteeInterlocking({
      projectId: String(project.id),
      subcontractId: String(subcontract.id),
      unrecoveredAdvanceBalance: 18_000,
      invoiceDate: '2026-06-01',
      activeGuarantees: [], // No guarantee!
    });
    assert(
      blockedInterlock.isBlocked === true,
      'Interlocking gate must block IPC when unrecovered advance has no active guarantee',
    );
    console.log(`  -> Interlocking correctly blocked unbacked subcontractor payment: ${blockedInterlock.blockReason}`);
    console.log('  [PASS] STEP 4 PASSED: Subcontractor guarantee interlocking verified.\n');

    // -------------------------------------------------------------------------
    // STEP 5: Site Operations: Daily Log & Work Inspection Request (WIR)
    // -------------------------------------------------------------------------
    console.log('[STEP 5] Recording Site Operations (Daily Log & WIR Inspection)...');
    const dailyLog = await contractingService.createDailyLog(auth, String(project.id), {
      logDate: '2026-02-10',
      weatherConditions: 'مشمس - درجة الحرارة 24 مئوية',
      laborCount: 38,
      equipmentOnSite: 'حفار هيتاشي 330 عدد 2 + مضخة خرسانة بوتزميستر 42م',
      workPerformed: 'تم استكمال أعمال حفر الأساسات وصب الخرسانة العادية والمسلحة للقواعد',
      delaysOrObstacles: 'لا حوادث ولا معوقات',
    });
    assert(Boolean(dailyLog.id), 'Daily log record must exist');
    console.log(`  -> Recorded Site Daily Log #${dailyLog.id} with 38 workers & heavy machinery`);

    const wir = await contractingService.createInspectionRequest(auth, String(project.id), {
      wirNumber: `WIR-${project.code}-001`,
      boqItemId: String(boq1!.id),
      locationGrid: 'القطاع الشمالي - محاور A1 إلى D8',
      tradeCategory: 'earthworks',
      inspectionType: 'excavation_approval',
      scheduledDate: '2026-02-11',
      consultantNotes: 'تم فحص المنسوب واختبار بروكتور لدمك طبقات الإحلال بنجاح 98%',
    });
    assert(Boolean(wir.id), 'WIR ID must exist');

    // Approve WIR
    const approvedWir = await contractingService.updateInspectionRequestStatus(auth, wir.id, {
      status: 'approved',
      consultantNotes: 'معتمد ومطابق للمواصفات الهندسية وأصول الصناعة',
    });
    assert(approvedWir.status === 'approved', 'WIR must be approved');
    console.log(
      `  -> Inspected & Approved Work Inspection Request [${(approvedWir as any).wir_number || (approvedWir as any).wirNumber}]`,
    );
    console.log('  [PASS] STEP 5 PASSED: Site Daily Log & WIR Inspection recorded.\n');

    // -------------------------------------------------------------------------
    // STEP 6: Change Order / Variation Management (CO-01)
    // -------------------------------------------------------------------------
    console.log('[STEP 6] Issuing Variation Change Order (CO-01)...');
    const changeOrder = await contractingService.createChangeOrder(auth, String(project.id), {
      title: 'إضافة أعمال تدعيم خوازيق سند الجوانب',
      reason: 'توصيات التقرير الجيوتقني الإضافي لسلامة المباني المجاورة',
      impactType: 'cost_and_time',
      costImpact: 50_000,
      timeImpactDays: 14,
    });
    assert(Boolean(changeOrder.id), 'Change order must exist');
    assert(Number(changeOrder.cost_impact) === 50_000, 'Change order cost impact must be 50,000');

    // Approve Change Order
    const approvedCo = await contractingService.updateChangeOrderStatus(auth, String(changeOrder.id), {
      status: 'approved',
      notes: 'معتمد من استشاري المشروع وممثل المالك',
    });
    assert(approvedCo.status === 'approved', 'Change order status must be approved');
    console.log(`  -> Approved Change Order [${approvedCo.change_order_number}] (+50,000 EGP, +14 days)`);
    console.log('  [PASS] STEP 6 PASSED: Variation change order approved.\n');

    // -------------------------------------------------------------------------
    // STEP 7: Client IPC Invoice #1 (Progress & Bounded Window Recovery)
    // -------------------------------------------------------------------------
    console.log('[STEP 7] Processing Client IPC Invoice #1 (Progress Work Done)...');
    // Progress: BOQ 1 (500 m3 = 100,000 EGP) + BOQ 2 (100 m3 = 200,000 EGP) = 300,000 EGP (30% progress)
    const ipc1 = await contractingService.createInvoice(auth, String(project.id), {
      ipcType: 'client',
      periodStart: '2026-01-01',
      periodEnd: '2026-02-28',
      items: [
        {
          boqItemId: String(boq1?.id),
          description: boq1?.description || '',
          unit: boq1?.unit || 'm3',
          unitPrice: Number(boq1?.unitPrice || 0),
          previousQty: 0,
          currentQty: 500, // 500 * 200 = 100,000 EGP
        },
        {
          boqItemId: String(boq2?.id),
          description: boq2?.description || '',
          unit: boq2?.unit || 'm3',
          unitPrice: Number(boq2?.unitPrice || 0),
          previousQty: 0,
          currentQty: 100, // 100 * 2,000 = 200,000 EGP
        },
      ],
    });

    console.log(`  -> Created IPC #1: [${ipc1.ipc_number}]`);
    assert(Boolean(ipc1.id), 'IPC #1 ID must exist');
    assert(Number(ipc1.gross_work_done_amount) === 300_000, `GWD must be 300,000, got: ${ipc1.gross_work_done_amount}`);

    // Verify 4-Layer calculation engine math:
    // Window factor: (30% - 10%) / (80% - 10%) = 20/70 = 28.5714% of 100,000 = 28,571.43 EGP
    // Retention: 5% of 300,000 = 15,000 EGP
    // Net Payable: 300,000 - 28,571.43 - 15,000 = 256,428.57 EGP
    assert(
      Math.abs(Number(ipc1.advance_recovery_amount) - 28_571.43) < 0.05,
      `Advance recovery must be ~28,571.43, got: ${ipc1.advance_recovery_amount}`,
    );
    assert(
      Number(ipc1.retention_held_amount) === 15_000,
      `Retention held must be 15,000, got: ${ipc1.retention_held_amount}`,
    );
    assert(
      Math.abs(Number(ipc1.net_payable) - 256_428.57) < 0.05,
      `Net payable must be ~256,428.57, got: ${ipc1.net_payable}`,
    );
    console.log('  -> Verified FIDIC 4-Layer IPC Math:', {
      grossWorkDone: ipc1.gross_work_done_amount,
      advanceRecovery: ipc1.advance_recovery_amount,
      retentionHeld: ipc1.retention_held_amount,
      netPayable: ipc1.net_payable,
    });

    // Approve IPC #1
    const approvedIpc1 = await contractingService.approveInvoice(auth, String(ipc1.id));
    assert(approvedIpc1.status === 'approved', 'IPC #1 status must be approved');

    // Post Double-Entry Journal Entry
    const postRes1 = await contractingService.postInvoiceJournalEntry(auth, String(ipc1.id));
    assert(postRes1.success === true, 'Journal entry for IPC #1 must be posted successfully');
    console.log(`  -> Posted Double-Entry Journal Entry #${postRes1.entryNo} (ID: ${postRes1.journalEntryId})`);

    // Verify Journal Line Balance (Debit == Credit)
    const journal1Lines = await (db as any)
      .selectFrom('journal_entry_lines')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('journal_entry_id', '=', postRes1.journalEntryId)
      .execute();

    const sumDebit1 = journal1Lines.reduce((acc: number, l: any) => acc + Number(l.debit || 0), 0);
    const sumCredit1 = journal1Lines.reduce((acc: number, l: any) => acc + Number(l.credit || 0), 0);
    assert(
      Math.abs(sumDebit1 - sumCredit1) < 0.01,
      `Journal 1 must be perfectly balanced: Debit ${sumDebit1} == Credit ${sumCredit1}`,
    );
    assert(
      Math.abs(sumDebit1 - 300_000) < 0.01,
      `Journal 1 total sum must equal Gross Work Done 300,000, got: ${sumDebit1}`,
    );
    console.log(
      `  -> Journal 1 Double-Entry Balance Verified: Debit ${sumDebit1} == Credit ${sumCredit1} (Delta: 0.00)`,
    );
    console.log('  [PASS] STEP 7 PASSED: Client IPC #1 processed, approved and balanced.\n');

    // -------------------------------------------------------------------------
    // STEP 8: Client IPC Invoice #2 with Backcharges & Deductions
    // -------------------------------------------------------------------------
    console.log('[STEP 8] Processing Client IPC Invoice #2 with Itemized Deductions...');
    // Progress: BOQ 2 (150 m3 = 300,000 EGP) + BOQ 3 (200 m2 = 60,000 EGP) = 360,000 EGP GWD
    // Cumulative GWD = 300,000 + 360,000 = 660,000 EGP (66% progress)
    const ipc2 = await contractingService.createInvoice(auth, String(project.id), {
      ipcType: 'client',
      periodStart: '2026-03-01',
      periodEnd: '2026-04-30',
      ldAmount: 10_000, // Liquidated Damages (LD)
      items: [
        {
          boqItemId: String(boq1?.id),
          description: boq1?.description || '',
          unit: boq1?.unit || 'm3',
          unitPrice: Number(boq1?.unitPrice || 0),
          previousQty: 500,
          currentQty: 0, // completed in IPC #1 (100,000 EGP)
        },
        {
          boqItemId: String(boq2?.id),
          description: boq2?.description || '',
          unit: boq2?.unit || 'm3',
          unitPrice: Number(boq2?.unitPrice || 0),
          previousQty: 100,
          currentQty: 150, // 150 * 2,000 = 300,000 EGP
        },
        {
          boqItemId: String(boq3?.id),
          description: boq3?.description || '',
          unit: boq3?.unit || 'm2',
          unitPrice: Number(boq3?.unitPrice || 0),
          previousQty: 0,
          currentQty: 200, // 200 * 300 = 60,000 EGP
        },
      ],
    });

    console.log(`  -> Created IPC #2: [${ipc2.ipc_number}]`);
    assert(Boolean(ipc2.id), 'IPC #2 ID must exist');
    assert(
      Number(ipc2.gross_work_done_amount) === 360_000,
      `GWD for period must be 360,000, got: ${ipc2.gross_work_done_amount}`,
    );
    assert(
      Number(ipc2.cumulative_amount) === 660_000,
      `Cumulative GWD must be 660,000, got: ${ipc2.cumulative_amount}`,
    );
    assert(Number(ipc2.ld_amount) === 10_000, 'LD penalty amount must match 10,000');

    // Approve IPC #2
    const approvedIpc2 = await contractingService.approveInvoice(auth, String(ipc2.id));
    assert(approvedIpc2.status === 'approved', 'IPC #2 status must be approved');

    // Post Double-Entry Journal Entry
    const postRes2 = await contractingService.postInvoiceJournalEntry(auth, String(ipc2.id));
    assert(postRes2.success === true, 'Journal entry for IPC #2 must be posted successfully');
    console.log(`  -> Posted Double-Entry Journal Entry #${postRes2.entryNo} (ID: ${postRes2.journalEntryId})`);

    const journal2Lines = await (db as any)
      .selectFrom('journal_entry_lines')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('journal_entry_id', '=', postRes2.journalEntryId)
      .execute();

    const sumDebit2 = journal2Lines.reduce((acc: number, l: any) => acc + Number(l.debit || 0), 0);
    const sumCredit2 = journal2Lines.reduce((acc: number, l: any) => acc + Number(l.credit || 0), 0);
    assert(
      Math.abs(sumDebit2 - sumCredit2) < 0.01,
      `Journal 2 must be perfectly balanced: Debit ${sumDebit2} == Credit ${sumCredit2}`,
    );
    console.log(
      `  -> Journal 2 Double-Entry Balance Verified: Debit ${sumDebit2} == Credit ${sumCredit2} (Delta: 0.00)`,
    );
    console.log('  [PASS] STEP 8 PASSED: Client IPC #2 processed, approved and balanced.\n');

    // -------------------------------------------------------------------------
    // STEP 9: Snag List & Defect Management Audit
    // -------------------------------------------------------------------------
    console.log('[STEP 9] Auditing Snag List & Defect Rectification...');
    const snag = await contractingService.createSnagItem(auth, String(project.id), {
      itemTitle: 'معالجة تعشيش خرساني بالعمود C4 بالدور الأرضي',
      locationDesc: 'الواجهة الشرقية - عمود C4',
      severity: 'major',
      dueDate: '2026-06-15',
      notes: 'حقن بمونة إيبوكسية غير قابلة للانكماش',
    });
    assert(Boolean(snag.id), 'Snag ID must exist');

    // Rectify Snag
    const resolvedSnag = await contractingService.updateSnagItemStatus(auth, snag.id, {
      status: 'rectified',
      rectifiedDate: '2026-06-15',
      verifiedBy: 'مهندس ضبط الجودة',
      notes: 'تم الحقن والمعالجة تحت إشراف مهندس ضبط الجودة',
    });
    assert(resolvedSnag.status === 'rectified', 'Snag status must be rectified');
    console.log(
      `  -> Rectified Snag Item [${(resolvedSnag as any).item_title || (resolvedSnag as any).itemTitle}]: ${resolvedSnag.notes}`,
    );
    console.log('  [PASS] STEP 9 PASSED: Snag defect management audit passed.\n');

    // -------------------------------------------------------------------------
    // STEP 10: Project Handover (TOC) & Retention Release
    // -------------------------------------------------------------------------
    console.log('[STEP 10] Project Handover (Taking-Over Certificate) & Retention Release...');
    const handover = await contractingService.createProjectHandover(auth, String(project.id), {
      handoverType: 'preliminary',
      handoverDate: '2026-10-01',
      committeeMembers: 'المهندس الاستشاري + مدير المشروعات + مندوب المالك',
      retentionReleaseAmount: 33_000,
      certificateRef: `TOC-${project.code}-2026`,
      notes: 'محضر استلام ابتدائي ناجح بعد اكتمال كافة الأعمال والتشطيبات واختبارات الجودة',
    });
    assert(Boolean(handover.id), 'Handover ID must exist');

    // Approve Handover
    const approvedHandover = await contractingService.approveProjectHandover(auth, handover.id, {
      approvedBy: 'الاستشاري العام للمشروع',
    });
    assert(approvedHandover.status === 'approved', 'Handover must be approved');
    console.log(
      `  -> Approved Handover Certificate [${(approvedHandover as any).certificate_ref || (approvedHandover as any).certificateRef}]`,
    );

    // Create & Release Retention Record
    const retentionRecord = await contractingService.createRetentionRecord(auth, String(project.id), {
      partyType: 'client',
      partyName: 'الهيئة العامة للتطوير العقاري',
      heldAmount: 33_000,
      retentionPercent: 5,
      releaseDueDate: '2026-10-01',
      notes: 'حجز ضمان أعمال المرحلة الأولى',
    });
    assert(Boolean(retentionRecord.id), 'Retention record must exist');

    const releasedRetention = await contractingService.releaseRetentionRecord(auth, String(retentionRecord.id), {
      releaseAmount: 33_000,
      notes: 'صرف محتجز الضمان بعد اعتماد محضر الاستلام الابتدائي',
    });
    assert(releasedRetention.status === 'fully_released', 'Retention status must be fully_released');
    console.log(
      `  -> Released Retention Record #${releasedRetention.id} (Amount: ${releasedRetention.released_amount} EGP)`,
    );
    console.log('  [PASS] STEP 10 PASSED: Project handover and retention release completed.\n');

    // -------------------------------------------------------------------------
    // STEP 11: Comprehensive Financial Audit & Ledger Integrity Check
    // -------------------------------------------------------------------------
    console.log('[STEP 11] Running Final Double-Entry Financial Ledger Audit...');
    const projectJournals = await (db as any)
      .selectFrom('journal_entries as je')
      .innerJoin('journal_entry_lines as jl', 'jl.journal_entry_id', 'je.id')
      .select([
        'je.id',
        'je.entry_no',
        sql<number>`sum(jl.debit)::numeric`.as('total_debit'),
        sql<number>`sum(jl.credit)::numeric`.as('total_credit'),
      ])
      .where('je.tenant_id', '=', tenantId)
      .where('je.id', 'in', [postRes1.journalEntryId, postRes2.journalEntryId])
      .groupBy(['je.id', 'je.entry_no'])
      .execute();

    assert(projectJournals.length === 2, 'Must have exactly 2 posted project journals');
    for (const j of projectJournals) {
      const d = Number(j.total_debit);
      const c = Number(j.total_credit);
      const delta = Math.abs(d - c);
      console.log(
        `  -> Journal #${j.entry_no}: Debit ${d.toFixed(2)} EGP == Credit ${c.toFixed(2)} EGP (Discrepancy: ${delta.toFixed(2)})`,
      );
      assert(delta === 0, `Journal #${j.entry_no} has non-zero discrepancy: ${delta}`);
    }

    console.log('  [PASS] STEP 11 PASSED: Double-entry ledgers mathematically proven with 0.00 delta.\n');

    console.log('========================================================================');
    console.log('  ALL 11 PHASES OF CONTRACTING & CONSTRUCTION PROJECTS PASSED 100%!');
    console.log('========================================================================\n');
  } catch (err: any) {
    console.error('[FAIL] CONTRACTING MASTER SIMULATION FAILED:', err?.message || err);
    console.error(err?.stack);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  runContractingConstructionMasterSimulation();
}
