import assert from 'node:assert/strict';
import {
  evaluateCustomerDunning,
  determineDunningLevel,
  calculateInvoiceOverdueDays,
  allocateCustomerOverdueFifo,
  renderDunningMessage,
  buildWhatsAppCollectionUrl,
  type DunningLevel,
  type CustomerDunningInput,
} from '../src/modules/accounting/engines/ar-dunning.engine';

const testLevels: DunningLevel[] = [
  {
    id: 'lvl-1',
    level_order: 1,
    level_name: 'تذكير ودي',
    days_past_due: 7,
    auto_block_sales: false,
    action_type: 'whatsapp',
    template_text:
      'مرحباً {customer_name}، نود تذكيركم بلطف بوجود رصيد مستحق بقيمة {total_overdue} {currency} متأخر منذ {days_overdue} يوماً.',
  },
  {
    id: 'lvl-2',
    level_order: 2,
    level_name: 'إشعار رسمي بالسداد',
    days_past_due: 15,
    auto_block_sales: false,
    action_type: 'whatsapp',
    template_text: 'إشعار رسمي: السيد {customer_name}، نرجو سرعة سداد {total_overdue} {currency}.',
  },
  {
    id: 'lvl-3',
    level_order: 3,
    level_name: 'إنذار تعليق البيع الآجل',
    days_past_due: 30,
    auto_block_sales: true,
    action_type: 'manual_call',
    template_text: 'إنذار إداري: تم إيقاف المبيعات الآجلة لوجود متأخرات بقيمة {total_overdue} {currency}.',
  },
  {
    id: 'lvl-4',
    level_order: 4,
    level_name: 'إشعار تصعيد قانوني',
    days_past_due: 60,
    auto_block_sales: true,
    action_type: 'legal',
    template_text: 'إشعار أخير: تحويل ملف {customer_name} للشؤون القانونية للمطالبة بمبلغ {total_overdue} {currency}.',
  },
];

const asOf = new Date('2026-10-01T12:00:00Z');

// Test 1: Zero balance customer evaluates to settled
{
  const input: CustomerDunningInput = {
    customerId: 101,
    customerName: 'شركة النور للمقاولات',
    balance: 0,
    invoices: [],
    asOfDate: asOf,
  };

  const res = evaluateCustomerDunning(input, testLevels);
  assert.equal(res.totalOverdue, 0);
  assert.equal(res.oldestOverdueDays, 0);
  assert.equal(res.recommendedStatus, 'settled');
  assert.equal(res.shouldBlockCredit, false);
  assert.equal(res.activeDunningLevel, null);
  console.log('✓ Test 1 Passed: Zero balance customer evaluates to settled');
}

// Test 2: Invoices within credit terms (not yet overdue)
{
  const input: CustomerDunningInput = {
    customerId: 102,
    customerName: 'مؤسسة الأمل',
    balance: 5000,
    creditTermsDays: 30,
    invoices: [
      {
        id: 1,
        invoiceNumber: 'INV-001',
        createdAt: '2026-09-25T10:00:00Z', // 6 days old, terms = 30 days -> not overdue
        total: 5000,
        paidAmount: 0,
      },
    ],
    asOfDate: asOf,
  };

  const res = evaluateCustomerDunning(input, testLevels);
  assert.equal(res.totalOverdue, 0);
  assert.equal(res.oldestOverdueDays, 0);
  assert.equal(res.activeDunningLevel, null);
  assert.equal(res.shouldBlockCredit, false);
  assert.equal(res.recommendedStatus, 'open');
  console.log('✓ Test 2 Passed: Invoices within credit terms produce zero overdue');
}

// Test 3: FIFO allocation across multiple invoices and tier escalation to Level 2
{
  const input: CustomerDunningInput = {
    customerId: 103,
    customerName: 'شركة النصر',
    phone: '+201012345678',
    balance: 15000,
    creditTermsDays: 0, // Due immediately upon invoice date
    invoices: [
      {
        id: 1,
        invoiceNumber: 'INV-100',
        createdAt: '2026-09-11T12:00:00Z', // 20 days overdue -> matches Level 2 (>= 15 days)
        total: 10000,
        paidAmount: 0,
      },
      {
        id: 2,
        invoiceNumber: 'INV-101',
        createdAt: '2026-09-22T12:00:00Z', // 9 days overdue
        total: 5000,
        paidAmount: 0,
      },
    ],
    asOfDate: asOf,
  };

  const res = evaluateCustomerDunning(input, testLevels);
  assert.equal(res.totalOverdue, 15000);
  assert.equal(res.oldestOverdueDays, 20);
  assert.ok(res.activeDunningLevel);
  assert.equal(res.activeDunningLevel.level_order, 2);
  assert.equal(res.activeDunningLevel.level_name, 'إشعار رسمي بالسداد');
  assert.equal(res.shouldBlockCredit, false); // Level 2 does not auto-block
  assert.ok(res.whatsAppUrl?.includes('wa.me/201012345678'));
  console.log('✓ Test 3 Passed: FIFO allocation matches Level 2 without auto-blocking');
}

// Test 4: Level 3 triggers auto-credit block at 30+ days
{
  const input: CustomerDunningInput = {
    customerId: 104,
    customerName: 'معرض السلام',
    balance: 22000,
    creditTermsDays: 0,
    invoices: [
      {
        id: 5,
        invoiceNumber: 'INV-500',
        createdAt: '2026-08-25T12:00:00Z', // 37 days overdue -> Level 3 (>= 30 days)
        total: 22000,
        paidAmount: 0,
      },
    ],
    asOfDate: asOf,
  };

  const res = evaluateCustomerDunning(input, testLevels);
  assert.equal(res.oldestOverdueDays, 37);
  assert.ok(res.activeDunningLevel);
  assert.equal(res.activeDunningLevel.level_order, 3);
  assert.equal(res.shouldBlockCredit, true);
  assert.ok(res.creditBlockReason?.includes('تجاوز مهلة السداد'));
  console.log('✓ Test 4 Passed: Level 3 triggers auto credit block');
}

// Test 5: Promise to pay breached triggers escalation & credit block even if level wouldn't block
{
  const input: CustomerDunningInput = {
    customerId: 105,
    customerName: 'مركز التوحيد',
    balance: 8000,
    creditTermsDays: 0,
    invoices: [
      {
        id: 7,
        invoiceNumber: 'INV-700',
        createdAt: '2026-09-20T12:00:00Z', // 11 days overdue -> Level 1 (would not auto block)
        total: 8000,
        paidAmount: 0,
      },
    ],
    currentCase: {
      status: 'promised_to_pay',
      promisedPaymentDate: '2026-09-28', // Expired 3 days ago relative to asOf (2026-10-01)
      promisedAmount: 8000,
    },
    asOfDate: asOf,
  };

  const res = evaluateCustomerDunning(input, testLevels);
  assert.equal(res.recommendedStatus, 'escalated');
  assert.equal(res.shouldBlockCredit, true);
  assert.ok(res.creditBlockReason?.includes('إخلال بوعد السداد'));
  console.log('✓ Test 5 Passed: Breached payment promise escalates case and blocks credit');
}

// Test 6: Valid unexpired promise to pay preserves promised_to_pay status
{
  const input: CustomerDunningInput = {
    customerId: 106,
    customerName: 'مكتب الهدى',
    balance: 8000,
    creditTermsDays: 0,
    invoices: [
      {
        id: 8,
        invoiceNumber: 'INV-800',
        createdAt: '2026-09-20T12:00:00Z',
        total: 8000,
        paidAmount: 0,
      },
    ],
    currentCase: {
      status: 'promised_to_pay',
      promisedPaymentDate: '2026-10-05', // In the future
      promisedAmount: 8000,
    },
    asOfDate: asOf,
  };

  const res = evaluateCustomerDunning(input, testLevels);
  assert.equal(res.recommendedStatus, 'promised_to_pay');
  assert.equal(res.shouldBlockCredit, false);
  console.log('✓ Test 6 Passed: Active valid payment promise preserves status');
}

// Test 7: Template rendering and WhatsApp link creation
{
  const message = renderDunningMessage(
    'عزيزنا {customer_name}، نود تذكيركم بمبلغ {total_overdue} {currency} لدى {company_name}. متأخر {days_overdue} يوم.',
    {
      customerName: 'أحمد محمود',
      totalOverdue: 12500.5,
      daysOverdue: 18,
      companyName: 'مؤسسة السعيد',
      currency: 'ج.م',
    },
  );

  assert.ok(message.includes('أحمد محمود'));
  assert.ok(message.includes('مؤسسة السعيد'));
  assert.ok(message.includes('18'));

  const url = buildWhatsAppCollectionUrl('01099887766', message);
  assert.ok(url?.startsWith('https://wa.me/01099887766?text='));
  console.log('✓ Test 7 Passed: Template rendering and WhatsApp link generation');
}

console.log('\nAll 7 AR Dunning Pure Engine tests passed with 100% precision.');
