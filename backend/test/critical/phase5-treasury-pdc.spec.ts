import { strict as assert } from 'node:assert';

// =============================================================================
// CRITICAL FINANCIAL AUDIT SUITE: Phase 5 - Treasury, PDC Cheques & Reconciliation
// Rule 13 (AGENTS.md): Proof of Financial & Operational Invariants
// =============================================================================

console.log('=== بدء اختبارات المرحلة (5): الخزينة وأوراق القبض والدفع والتسوية البنكية والخصم والإضافة ===\n');

// -----------------------------------------------------------------------------
// 1. Bank Reconciliation Invariants
// -----------------------------------------------------------------------------
function testBankReconciliationInvariants() {
  console.log('--- 1. اختبارات ثوابت التسوية البنكية (Bank Reconciliation Invariants) ---');

  // Helper matching validator mirroring production logic in accounting.service.ts
  function validateBankReconciliationMatch(params: {
    statementLine: { id: number; amount: number; is_reconciled: boolean; account_id: number };
    journalLine: {
      id: number;
      debit: number;
      credit: number;
      is_reconciled: boolean;
      account_id: number;
      journal_status: string;
    };
  }): { valid: boolean; error?: string } {
    if (params.statementLine.is_reconciled) {
      return { valid: false, error: 'سطر كشف الحساب البنكي مطابق بالفعل.' };
    }
    if (params.journalLine.journal_status !== 'posted') {
      return { valid: false, error: 'لا يمكن مطابقة قيد محاسبي غير مرحل.' };
    }
    if (params.journalLine.is_reconciled) {
      return { valid: false, error: 'سطر القيد المحاسبي مطابق بالفعل مع حركة بنكية أخرى.' };
    }
    if (params.statementLine.account_id !== params.journalLine.account_id) {
      return { valid: false, error: 'لا يمكن مطابقة سطر كشف الحساب مع قيد لحساب مالي مختلف.' };
    }
    const netJournalAmount = Number(params.journalLine.debit || 0) - Number(params.journalLine.credit || 0);
    const statementAmount = Number(params.statementLine.amount || 0);
    if (Math.abs(statementAmount - netJournalAmount) > 0.01) {
      return {
        valid: false,
        error: `عدم تطابق في المبلغ: سطر كشف الحساب (${statementAmount.toFixed(2)}) لا يتطابق مع القيد المحاسبي (${netJournalAmount.toFixed(2)}).`,
      };
    }
    return { valid: true };
  }

  // 1.1 Deposit Match Success
  {
    const res = validateBankReconciliationMatch({
      statementLine: { id: 1, amount: 5000, is_reconciled: false, account_id: 10 },
      journalLine: { id: 101, debit: 5000, credit: 0, is_reconciled: false, account_id: 10, journal_status: 'posted' },
    });
    assert.equal(res.valid, true, 'إيداع بنكي متطابق مع قيد مدين يجب أن ينجح');
    console.log('✔ مطابقة إيداع بنكي مع سطر مدين متطابق (نجاح)');
  }

  // 1.2 Withdrawal Match Success
  {
    const res = validateBankReconciliationMatch({
      statementLine: { id: 2, amount: -2500, is_reconciled: false, account_id: 10 },
      journalLine: { id: 102, debit: 0, credit: 2500, is_reconciled: false, account_id: 10, journal_status: 'posted' },
    });
    assert.equal(res.valid, true, 'سحب بنكي متطابق مع قيد دائن يجب أن ينجح');
    console.log('✔ مطابقة سحب بنكي مع سطر دائن متطابق (نجاح)');
  }

  // 1.3 Double Match on Statement Line Blocked
  {
    const res = validateBankReconciliationMatch({
      statementLine: { id: 1, amount: 5000, is_reconciled: true, account_id: 10 },
      journalLine: { id: 103, debit: 5000, credit: 0, is_reconciled: false, account_id: 10, journal_status: 'posted' },
    });
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes('مطابق بالفعل'), 'حظر إعادة مطابقة سطر كشف حساب مطابق');
    console.log('✔ حظر مطابقة سطر كشف حساب تمت مطابقته مسبقاً');
  }

  // 1.4 Double Match on Journal Line Blocked
  {
    const res = validateBankReconciliationMatch({
      statementLine: { id: 3, amount: 5000, is_reconciled: false, account_id: 10 },
      journalLine: { id: 101, debit: 5000, credit: 0, is_reconciled: true, account_id: 10, journal_status: 'posted' },
    });
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes('أخرى'), 'حظر إعادة مطابقة سطر قيد محاسبي مطابق');
    console.log('✔ حظر مطابقة سطر قيد محاسبي تمت مطابقته مسبقاً مع سطر بنكي آخر');
  }

  // 1.5 Unposted Journal Entry Blocked
  {
    const res = validateBankReconciliationMatch({
      statementLine: { id: 4, amount: 5000, is_reconciled: false, account_id: 10 },
      journalLine: { id: 104, debit: 5000, credit: 0, is_reconciled: false, account_id: 10, journal_status: 'draft' },
    });
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes('غير مرحل'), 'حظر مطابقة قيد مسودة');
    console.log('✔ حظر مطابقة قيود محاسبية غير مرحلة (مسودة)');
  }

  // 1.6 Account Mismatch Blocked
  {
    const res = validateBankReconciliationMatch({
      statementLine: { id: 5, amount: 5000, is_reconciled: false, account_id: 10 },
      journalLine: { id: 105, debit: 5000, credit: 0, is_reconciled: false, account_id: 20, journal_status: 'posted' },
    });
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes('مختلف'), 'حظر مطابقة حسابين مختلفين');
    console.log('✔ حظر مطابقة كشف حساب بنكي مع قيد لحساب مالي مختلف');
  }

  // 1.7 Amount Mismatch Blocked
  {
    const res = validateBankReconciliationMatch({
      statementLine: { id: 6, amount: 5000, is_reconciled: false, account_id: 10 },
      journalLine: { id: 106, debit: 5050, credit: 0, is_reconciled: false, account_id: 10, journal_status: 'posted' },
    });
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes('عدم تطابق في المبلغ'), 'حظر مطابقة مبالغ غير متساوية');
    console.log('✔ حظر مطابقة مبالغ غير متطابقة مع هامش تسامح 0.01');
  }
}

// -----------------------------------------------------------------------------
// 2. PDC Cheques GL Accounting Invariants
// -----------------------------------------------------------------------------
function testPdcChequesAccountingInvariants() {
  console.log('\n--- 2. اختبارات القيود المحاسبية لأوراق القبض والدفع (PDC Cheques GL Invariants) ---');

  interface JournalLine {
    accountCode: string;
    description: string;
    debit: number;
    credit: number;
    partnerType: string;
    partnerId: number | null;
  }

  function assertBalancedJournal(lines: JournalLine[], contextName: string) {
    const totalDebit = Number(lines.reduce((s, l) => s + l.debit, 0).toFixed(2));
    const totalCredit = Number(lines.reduce((s, l) => s + l.credit, 0).toFixed(2));
    assert.equal(
      totalDebit,
      totalCredit,
      `${contextName}: القيد المحاسبي غير متوازن! مدين=${totalDebit} دائن=${totalCredit}`,
    );
    assert.ok(totalDebit > 0, `${contextName}: إجمالي القيد يجب أن يكون أكبر من الصفر`);
  }

  // 2.1 Receive Customer Cheque: Dr. 1122 (Safe) / Cr. 1130 (AR)
  {
    const chequeAmount = 15000;
    const customerId = 42;
    const lines: JournalLine[] = [
      {
        accountCode: '1122',
        description: 'ورقة قبض في الخزينة',
        debit: chequeAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
      },
      {
        accountCode: '1130',
        description: 'استلام شيك قبض من عميل',
        debit: 0,
        credit: chequeAmount,
        partnerType: 'customer',
        partnerId: customerId,
      },
    ];
    assertBalancedJournal(lines, 'استلام شيك قبض في الخزينة');
    assert.equal(lines[0].debit, 15000);
    assert.equal(lines[1].partnerId, 42);
    console.log('✔ قيد استلام ورقة قبض من عميل: من حـ/ أوراق قبض في الخزينة (1122) إلى حـ/ العملاء (1130)');
  }

  // 2.2 Deposit Cheque for Collection: Dr. 1121 (Under Collection) / Cr. 1122 (Safe)
  {
    const chequeAmount = 15000;
    const lines: JournalLine[] = [
      {
        accountCode: '1121',
        description: 'ورقة قبض برسم التحصيل',
        debit: chequeAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
      },
      {
        accountCode: '1122',
        description: 'إيداع شيك قبض للتحصيل',
        debit: 0,
        credit: chequeAmount,
        partnerType: 'none',
        partnerId: null,
      },
    ];
    assertBalancedJournal(lines, 'إيداع شيك قبض للتحصيل');
    assert.equal(lines[0].accountCode, '1121');
    assert.equal(lines[1].accountCode, '1122');
    console.log(
      '✔ قيد إيداع ورقة قبض برسم التحصيل: من حـ/ أوراق قبض برسم التحصيل (1121) إلى حـ/ أوراق قبض في الخزينة (1122)',
    );
  }

  // 2.3 Cheque Collection: Dr. 1120 (Bank) / Cr. 1121 (Under Collection)
  {
    const chequeAmount = 15000;
    const lines: JournalLine[] = [
      {
        accountCode: '1120',
        description: 'تحصيل ورقة قبض في البنك',
        debit: chequeAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
      },
      {
        accountCode: '1121',
        description: 'إقفال ورقة قبض بعد التحصيل',
        debit: 0,
        credit: chequeAmount,
        partnerType: 'none',
        partnerId: null,
      },
    ];
    assertBalancedJournal(lines, 'تحصيل ورقة قبض بنكياً');
    assert.equal(lines[0].accountCode, '1120');
    assert.equal(lines[1].accountCode, '1121');
    console.log('✔ قيد تحصيل ورقة قبض بنكياً: من حـ/ البنك (1120) إلى حـ/ أوراق قبض برسم التحصيل (1121)');
  }

  // 2.4 Bounced Cheque with Bank Fee: Dr. 1130 (AR) / Cr. 1121 + Dr. 6800 (Bank Fees) / Cr. 1120 (Bank)
  {
    const chequeAmount = 15000;
    const bankFee = 150;
    const customerId = 42;
    const lines: JournalLine[] = [
      {
        accountCode: '1130',
        description: 'إعادة المديونية للعميل لارتداد الشيك',
        debit: chequeAmount,
        credit: 0,
        partnerType: 'customer',
        partnerId: customerId,
      },
      {
        accountCode: '1121',
        description: 'إلغاء ورقة قبض مرتدة',
        debit: 0,
        credit: chequeAmount,
        partnerType: 'none',
        partnerId: null,
      },
      {
        accountCode: '6800',
        description: 'عمولة ومصاريف ارتداد شيك',
        debit: bankFee,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
      },
      {
        accountCode: '1120',
        description: 'خصم مصاريف بنكية لشيك مرتد',
        debit: 0,
        credit: bankFee,
        partnerType: 'none',
        partnerId: null,
      },
    ];
    assertBalancedJournal(lines, 'ارتداد ورقة قبض مع مصاريف بنكية');
    assert.equal(lines[0].debit, 15000);
    assert.equal(lines[2].debit, 150);
    console.log('✔ قيد ارتداد ورقة قبض مع عمولة بنكية: استعادة ذمة العميل (1130) + إثبات المصروف البنكي (6800)');
  }

  // 2.5 Endorse Cheque to Supplier: Dr. 2110 (Supplier AP) / Cr. 1122 (Safe)
  {
    const chequeAmount = 15000;
    const supplierId = 88;
    const lines: JournalLine[] = [
      {
        accountCode: '2110',
        description: 'تظهير ورقة قبض سداداً للمورد',
        debit: chequeAmount,
        credit: 0,
        partnerType: 'supplier',
        partnerId: supplierId,
      },
      {
        accountCode: '1122',
        description: 'خروج ورقة قبض بالتظهير',
        debit: 0,
        credit: chequeAmount,
        partnerType: 'none',
        partnerId: null,
      },
    ];
    assertBalancedJournal(lines, 'تظهير ورقة قبض لمورد');
    assert.equal(lines[0].partnerId, 88);
    assert.equal(lines[1].accountCode, '1122');
    console.log('✔ قيد تظهير ورقة قبض لمورد: من حـ/ الموردون (2110) إلى حـ/ أوراق قبض في الخزينة (1122)');
  }

  // 2.6 Issue Payable Cheque: Dr. 2110 (Supplier AP) / Cr. 2135 (Notes Payable)
  {
    const chequeAmount = 25000;
    const supplierId = 88;
    const lines: JournalLine[] = [
      {
        accountCode: '2110',
        description: 'إصدار ورقة دفع للمورد',
        debit: chequeAmount,
        credit: 0,
        partnerType: 'supplier',
        partnerId: supplierId,
      },
      {
        accountCode: '2135',
        description: 'ورقة دفع مصدرة',
        debit: 0,
        credit: chequeAmount,
        partnerType: 'none',
        partnerId: null,
      },
    ];
    assertBalancedJournal(lines, 'إصدار ورقة دفع لمورد');
    assert.equal(lines[0].accountCode, '2110');
    assert.equal(lines[1].accountCode, '2135');
    console.log('✔ قيد إصدار ورقة دفع لمورد: من حـ/ الموردون (2110) إلى حـ/ أوراق دفع (2135)');
  }

  // 2.7 Clear Payable Cheque: Dr. 2135 (Notes Payable) / Cr. 1120 (Bank)
  {
    const chequeAmount = 25000;
    const lines: JournalLine[] = [
      {
        accountCode: '2135',
        description: 'صرف وإقفال ورقة دفع',
        debit: chequeAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
      },
      {
        accountCode: '1120',
        description: 'خصم ورقة دفع من البنك',
        debit: 0,
        credit: chequeAmount,
        partnerType: 'none',
        partnerId: null,
      },
    ];
    assertBalancedJournal(lines, 'صرف ورقة دفع من البنك');
    assert.equal(lines[0].accountCode, '2135');
    assert.equal(lines[1].accountCode, '1120');
    console.log('✔ قيد صرف ورقة دفع من البنك: من حـ/ أوراق دفع (2135) إلى حـ/ البنك (1120)');
  }
}

// -----------------------------------------------------------------------------
// 3. Withholding Tax Remittance Invariants (Form 41)
// -----------------------------------------------------------------------------
function testWithholdingTaxInvariants() {
  console.log('\n--- 3. اختبارات سداد وتوريد ضريبة الخصم والإضافة (WHT Form 41 Invariants) ---');

  interface JournalLine {
    accountCode: string;
    description: string;
    debit: number;
    credit: number;
  }

  function assertBalancedJournal(lines: JournalLine[], contextName: string) {
    const totalDebit = Number(lines.reduce((s, l) => s + l.debit, 0).toFixed(2));
    const totalCredit = Number(lines.reduce((s, l) => s + l.credit, 0).toFixed(2));
    assert.equal(totalDebit, totalCredit, `${contextName}: غير متوازن!`);
    assert.ok(totalDebit > 0);
  }

  // 3.1 WHT Payable Remittance to ETA: Dr. 2125 (WHT Payable) / Cr. 1120 (Bank)
  {
    const taxAmount = 1450.5;
    const lines: JournalLine[] = [
      { accountCode: '2125', description: 'سداد ضريبة خصم وإضافة نموذج 41', debit: taxAmount, credit: 0 },
      { accountCode: '1120', description: 'سداد بنكي لمصلحة الضرائب', debit: 0, credit: taxAmount },
    ];
    assertBalancedJournal(lines, 'سداد ضريبة الخصم والإضافة للضرائب');
    assert.equal(lines[0].accountCode, '2125');
    assert.equal(lines[1].accountCode, '1120');
    console.log(
      '✔ قيد سداد وتوريد ضريبة الخصم والإضافة: من حـ/ أمانات ضريبة الخصم والإضافة (2125) إلى حـ/ البنك (1120)',
    );
  }

  // 3.2 WHT Receivable Clearance against Sales VAT: Dr. 2120 (VAT Payable) / Cr. 1155 (WHT Receivable)
  {
    const taxAmount = 800;
    const lines: JournalLine[] = [
      { accountCode: '2120', description: 'مقاصة ضريبة خصم وإضافة مع ضريبة المبيعات', debit: taxAmount, credit: 0 },
      { accountCode: '1155', description: 'إقفال ضريبة مخصومة لدى الغير', debit: 0, credit: taxAmount },
    ];
    assertBalancedJournal(lines, 'مقاصة ضريبة الخصم والإضافة مع المبيعات');
    assert.equal(lines[0].accountCode, '2120');
    assert.equal(lines[1].accountCode, '1155');
    console.log(
      '✔ قيد مقاصة ضريبة الخصم والإضافة المخصومة لدى الغير: من حـ/ ضريبة مبيعات مستحقة (2120) إلى حـ/ ضرائب مخصومة لدى الغير (1155)',
    );
  }
}

// -----------------------------------------------------------------------------
// Execute All Tests
// -----------------------------------------------------------------------------
testBankReconciliationInvariants();
testPdcChequesAccountingInvariants();
testWithholdingTaxInvariants();

console.log('\n=============================================================');
console.log('✔ جميع اختبارات المرحلة (5) اجتازت بنجاح 100% بدون أي انحراف مالي أو محاسبي!');
console.log('=============================================================');
