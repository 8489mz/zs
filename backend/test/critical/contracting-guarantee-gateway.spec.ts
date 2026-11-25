import assert from 'assert';
import {
  assertAdvancePaymentGate,
  checkIpcGuaranteeInterlocking,
  evaluateGuaranteeExpiryAlerts,
  BankGuarantee,
} from '../../src/modules/contracting/guarantee-gateway.engine';

// =============================================================================
// CRITICAL FINANCIAL AUDIT SUITE: Gateway G1 & IPC Interlocking
// Directly imports production engine without mock duplications (Rule 13 AGENTS.md)
// =============================================================================

function runGuaranteeGatewayTestSuite() {
  console.log('=== بدء اختبارات البوابة الرقابية G1 وحجب المستخلصات وخطابات الضمان ===\n');

  const baseGuarantee: BankGuarantee = {
    id: 'guar-1',
    tenant_id: 'tenant-1',
    project_id: 'proj-100',
    subcontract_id: 'sub-200',
    subcontractor_id: 'subc-10',
    guarantee_number: 'BG-AP-2026-001',
    guarantee_type: 'advance_payment',
    issuing_bank: 'البنك الأهلي المصري',
    amount: 100000,
    currency: 'EGP',
    issue_date: '2026-01-01',
    expiry_date: '2026-12-31',
    status: 'active',
  };

  // ---------------------------------------------------------------------------
  // Test 1: G1 Success - Active guarantee covers full advance payment
  // ---------------------------------------------------------------------------
  {
    const result = assertAdvancePaymentGate({
      projectId: 'proj-100',
      subcontractId: 'sub-200',
      requestedDisbursementAmount: 75000,
      disbursementDate: '2026-06-01',
      activeGuarantees: [baseGuarantee],
    });

    assert.strictEqual(result.approved, true, 'يجب اعتماد الصرف لوجود ضمان سارٍ وكافٍ');
    assert.strictEqual(result.coveringGuarantee.id, 'guar-1');
    assert.strictEqual(result.coverageExcess, 25000, 'فائض التغطية يجب أن يكون 25,000');
    console.log('[PASS] اختبار 1: اعتماد صرف الدفعة المقدمة بضمان سارٍ وكافٍ (نجاح)');
  }

  // ---------------------------------------------------------------------------
  // Test 2: G1 Failure - No advance guarantee registered
  // ---------------------------------------------------------------------------
  {
    let thrownError: any = null;
    try {
      assertAdvancePaymentGate({
        projectId: 'proj-100',
        subcontractId: 'sub-200',
        requestedDisbursementAmount: 50000,
        disbursementDate: '2026-06-01',
        activeGuarantees: [],
      });
    } catch (err: any) {
      thrownError = err;
    }

    assert.notStrictEqual(thrownError, null, 'يجب حظر الصرف قطيعاً عند عدم وجود خطاب ضمان');
    assert.match(thrownError.message, /بوابة الاعتماد الرقابية G1/, 'رسالة الخطأ يجب أن تشير صراحة للبوابة G1');
    console.log('[PASS] اختبار 2: حظر صرف الدفعة المقدمة عند انعدام خطاب الضمان (نجاح)');
  }

  // ---------------------------------------------------------------------------
  // Test 3: G1 Failure - Guarantee expired before disbursement date
  // ---------------------------------------------------------------------------
  {
    const expiredGuarantee: BankGuarantee = {
      ...baseGuarantee,
      expiry_date: '2026-05-01',
    };

    let thrownError: any = null;
    try {
      assertAdvancePaymentGate({
        projectId: 'proj-100',
        subcontractId: 'sub-200',
        requestedDisbursementAmount: 50000,
        disbursementDate: '2026-06-01',
        activeGuarantees: [expiredGuarantee],
      });
    } catch (err: any) {
      thrownError = err;
    }

    assert.notStrictEqual(thrownError, null, 'يجب حظر الصرف عند انتهاء تاريخ سريان الضمان');
    assert.match(thrownError.message, /منتهي الصلاحية/);
    console.log('[PASS] اختبار 3: حظر صرف الدفعة المقدمة عند انتهاء سريان خطاب الضمان (نجاح)');
  }

  // ---------------------------------------------------------------------------
  // Test 4: G1 Failure - Insufficient guarantee amount
  // ---------------------------------------------------------------------------
  {
    const insufficientGuarantee: BankGuarantee = {
      ...baseGuarantee,
      amount: 80000,
    };

    let thrownError: any = null;
    try {
      assertAdvancePaymentGate({
        projectId: 'proj-100',
        subcontractId: 'sub-200',
        requestedDisbursementAmount: 100000,
        disbursementDate: '2026-06-01',
        activeGuarantees: [insufficientGuarantee],
      });
    } catch (err: any) {
      thrownError = err;
    }

    assert.notStrictEqual(thrownError, null, 'يجب حظر الصرف إذا كانت قيمة الضمان أقل من المطلوب');
    assert.match(thrownError.message, /غير كافية لتغطية الدفعة المقدمة/);
    console.log('[PASS] اختبار 4: حظر صرف الدفعة المقدمة عند عجز قيمة الضمان عن التغطية (نجاح)');
  }

  // ---------------------------------------------------------------------------
  // Test 5: IPC Interlocking - Blocks IPC when unrecovered advance exists & guarantee is expired
  // ---------------------------------------------------------------------------
  {
    const expiredGuarantee: BankGuarantee = {
      ...baseGuarantee,
      expiry_date: '2026-04-30',
    };

    const interlocking = checkIpcGuaranteeInterlocking({
      projectId: 'proj-100',
      subcontractId: 'sub-200',
      unrecoveredAdvanceBalance: 40000,
      invoiceDate: '2026-05-15',
      activeGuarantees: [expiredGuarantee],
    });

    assert.strictEqual(interlocking.isBlocked, true, 'يجب حجب صرف المستخلص لانتهاء الضمان ورصيد الدفعة غير مسترد');
    assert.match(interlocking.blockReason || '', /حجب صرف المستخلص/);
    console.log('[PASS] اختبار 5: حجب اعتماد وصرف المستخلص IPC عند وجود دفعة غير مستردة وضمان منتهٍ (نجاح)');
  }

  // ---------------------------------------------------------------------------
  // Test 6: IPC Interlocking - Allows IPC when advance guarantee is active and unexpired
  // ---------------------------------------------------------------------------
  {
    const interlocking = checkIpcGuaranteeInterlocking({
      projectId: 'proj-100',
      subcontractId: 'sub-200',
      unrecoveredAdvanceBalance: 40000,
      invoiceDate: '2026-05-15',
      activeGuarantees: [baseGuarantee],
    });

    assert.strictEqual(interlocking.isBlocked, false, 'يجب السماح بصرف المستخلص طالما الضمان سارٍ');
    assert.strictEqual(interlocking.coveringGuarantee?.id, 'guar-1');
    console.log('[PASS] اختبار 6: السماح بصرف المستخلص IPC عند وجود غطاء بنكي سارٍ للرصيد المتبقي (نجاح)');
  }

  // ---------------------------------------------------------------------------
  // Test 7: IPC Interlocking - Unrecovered balance is 0 -> No block regardless of guarantee
  // ---------------------------------------------------------------------------
  {
    const interlocking = checkIpcGuaranteeInterlocking({
      projectId: 'proj-100',
      subcontractId: 'sub-200',
      unrecoveredAdvanceBalance: 0,
      invoiceDate: '2026-05-15',
      activeGuarantees: [],
    });

    assert.strictEqual(interlocking.isBlocked, false, 'لا حظر عند تمام استرداد الدفعة المقدمة بنسبة 100%');
    console.log('[PASS] اختبار 7: عدم تطبيق الحجب عند اكتمال استرداد الدفعة المقدمة بالكامل (نجاح)');
  }

  // ---------------------------------------------------------------------------
  // Test 8: Early Expiry Alerts - T-60, T-30, T-7, and Expired
  // ---------------------------------------------------------------------------
  {
    const today = '2026-06-01';
    const guaranteesForAlerts: BankGuarantee[] = [
      {
        ...baseGuarantee,
        id: 'g-expired',
        guarantee_number: 'BG-EXP',
        expiry_date: '2026-05-25', // 7 days ago
      },
      {
        ...baseGuarantee,
        id: 'g-t7',
        guarantee_number: 'BG-T7',
        expiry_date: '2026-06-05', // 4 days remaining
      },
      {
        ...baseGuarantee,
        id: 'g-t30',
        guarantee_number: 'BG-T30',
        expiry_date: '2026-06-20', // 19 days remaining
      },
      {
        ...baseGuarantee,
        id: 'g-t60',
        guarantee_number: 'BG-T60',
        expiry_date: '2026-07-15', // 44 days remaining
      },
      {
        ...baseGuarantee,
        id: 'g-healthy',
        guarantee_number: 'BG-OK',
        expiry_date: '2026-11-01', // 153 days remaining
      },
    ];

    const alerts = evaluateGuaranteeExpiryAlerts(guaranteesForAlerts, today);

    assert.strictEqual(alerts.length, 4, 'يجب إصدار 4 تنبيهات (منتهي، T-7، T-30، T-60) وتجاهل الآمن');
    assert.strictEqual(alerts[0].alertTier, 'expired', 'الأولى بالترتيب يجب أن تكون منتهية الصلاحية');
    assert.strictEqual(alerts[1].alertTier, 'critical_t7', 'الثانية يجب أن تكون T-7 الحرجة');
    assert.strictEqual(alerts[2].alertTier, 'warning_t30', 'الثالثة يجب أن تكون T-30 التحذيرية');
    assert.strictEqual(alerts[3].alertTier, 'info_t60', 'الرابعة يجب أن تكون T-60 الاستباقية');
    console.log('[PASS] اختبار 8: محرك التنبيهات المبكرة T-60 / T-30 / T-7 والتصنيف الحرج (نجاح)');
  }

  // ---------------------------------------------------------------------------
  // Test 9: Invariant G1-C Success - Multiple partial advances within guarantee ceiling
  // ---------------------------------------------------------------------------
  {
    const bigGuarantee: BankGuarantee = {
      ...baseGuarantee,
      amount: 200000,
    };

    const result = assertAdvancePaymentGate({
      projectId: 'proj-100',
      subcontractId: 'sub-200',
      requestedDisbursementAmount: 80000,
      priorAdvanceDisbursedAgainstGuarantee: 120000, // Prior disbursement
      disbursementDate: '2026-06-01',
      activeGuarantees: [bigGuarantee],
    });

    assert.strictEqual(result.approved, true, 'يجب اعتماد الصرف لأن إجمالي المنصرف التراكمي (200,000) يطابق الضمان');
    assert.strictEqual(result.coverageExcess, 0, 'فائض التغطية التراكمية يجب أن يكون 0 عند اكتمال الغطاء تماماً');
    console.log('[PASS] اختبار 9: (معيار G1-C) اعتماد الصرف التراكمي لدفعات مجزأة ضمن سقف الضمان (نجاح)');
  }

  // ---------------------------------------------------------------------------
  // Test 10: Invariant G1-C Failure - Cumulative disbursements breach guarantee ceiling
  // ---------------------------------------------------------------------------
  {
    const bigGuarantee: BankGuarantee = {
      ...baseGuarantee,
      amount: 200000,
    };

    let thrownError: any = null;
    try {
      assertAdvancePaymentGate({
        projectId: 'proj-100',
        subcontractId: 'sub-200',
        requestedDisbursementAmount: 60000,
        priorAdvanceDisbursedAgainstGuarantee: 150000, // 150k + 60k = 210k > 200k
        disbursementDate: '2026-06-01',
        activeGuarantees: [bigGuarantee],
      });
    } catch (err: any) {
      thrownError = err;
    }

    assert.notStrictEqual(thrownError, null, 'يجب حظر الصرف التراكمي الذي يتجاوز سقف الضمان قطيعاً');
    assert.match(thrownError.message, /G1-C/, 'رسالة الخطأ يجب أن تستشهد بالمعيار التراكمي G1-C');
    assert.match(thrownError.message, /210,000/, 'رسالة الخطأ يجب أن تفصح عن الإجمالي التراكمي بدقة');
    console.log('[PASS] اختبار 10: (معيار G1-C) حظر الصرف التراكمي الذي يتجاوز غطاء الضمان البنكي (نجاح)');
  }

  // ---------------------------------------------------------------------------
  // Test 11: Invariant G1-C Stepwise Staged Simulation (Claude Opus Breakthrough Scenario)
  // ---------------------------------------------------------------------------
  {
    const guarantee200k: BankGuarantee = {
      ...baseGuarantee,
      amount: 200000,
    };

    // Day 1: First disbursement 150,000 (prior = 0)
    const step1 = assertAdvancePaymentGate({
      projectId: 'proj-100',
      subcontractId: 'sub-200',
      requestedDisbursementAmount: 150000,
      priorAdvanceDisbursedAgainstGuarantee: 0,
      disbursementDate: '2026-06-01',
      activeGuarantees: [guarantee200k],
    });
    assert.strictEqual(step1.approved, true);
    assert.strictEqual(step1.coverageExcess, 50000);

    // Day 2: Second disbursement 150,000 (prior = 150,000) -> Total 300,000 vs 200,000 Guarantee!
    let step2Error: any = null;
    try {
      assertAdvancePaymentGate({
        projectId: 'proj-100',
        subcontractId: 'sub-200',
        requestedDisbursementAmount: 150000,
        priorAdvanceDisbursedAgainstGuarantee: 150000,
        disbursementDate: '2026-06-02',
        activeGuarantees: [guarantee200k],
      });
    } catch (err: any) {
      step2Error = err;
    }

    assert.notStrictEqual(step2Error, null, 'يجب سد ثغرة الصرف المجزأ وحظر الدفعة الثانية فوراً');
    assert.match(step2Error.message, /G1-C/);
    assert.match(step2Error.message, /300,000/);
    console.log(
      '[PASS] اختبار 11: (محاكاة سيناريو كلود التتابعي) نجاح الدفعة الأولى وسد ثغرة الدفعة الثانية بـ G1-C (نجاح)',
    );
  }

  console.log('\n=============================================================');
  console.log('كافة اختبارات البوابة الرقابية G1 وحجب المستخلصات اجتازت بنجاح 100%!');
  console.log('=============================================================');
}

runGuaranteeGatewayTestSuite();
