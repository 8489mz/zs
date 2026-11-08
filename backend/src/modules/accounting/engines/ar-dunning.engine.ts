/**
 * AR Dunning & Collection Pure Engine
 *
 * Implements deterministic calculation for:
 * 1. Invoice-level overdue days and FIFO balance allocation.
 * 2. Automated dunning tier qualification (Friendly -> Formal -> Warning -> Legal).
 * 3. Credit block evaluation based on overdue thresholds and breached payment promises.
 * 4. Message templating & WhatsApp dispatch link generation.
 *
 * All functions are pure, side-effect free, and fully testable.
 *
 * Money amounts round at the caller's book digits (MoneyDigits), which
 * defaults to 2 for callers that have not been wired to the tenant's
 * currency yet; the live caller (ar-collections syncCollections) is
 * wired to tenantBaseCurrency (D6c wiring follow-up, U3).
 */
import { roundMoney, type MoneyDigits } from './money-minor-units.engine';

export interface DunningLevel {
  id: string;
  tenant_id?: string;
  level_order: number;
  level_name: string;
  days_past_due: number;
  auto_block_sales: boolean;
  action_type: string; // 'whatsapp' | 'manual_call' | 'legal' | 'email'
  template_text: string;
}

export interface InputInvoice {
  id: number | string;
  invoiceNumber?: string;
  createdAt: string | Date;
  dueDate?: string | Date | null;
  total: number;
  paidAmount: number;
}

export interface OverdueInvoice {
  id: number | string;
  invoiceNumber?: string;
  createdAt: string;
  dueDate: string;
  total: number;
  paidAmount: number;
  unpaidAmount: number;
  allocatedOverdueAmount: number;
  daysOverdue: number;
}

export interface CustomerDunningInput {
  customerId: number;
  customerName: string;
  phone?: string | null;
  balance: number;
  creditLimit?: number;
  isCreditBlocked?: boolean;
  creditTermsDays?: number; // e.g. 0 (due immediately), 30, 60 days
  invoices: InputInvoice[];
  /** Pre-aggregated FIFO exposure from the database for bulk collection sync. */
  overdueSummary?: { totalOverdue: number; oldestOverdueDays: number };
  asOfDate?: string | Date;
  currentCase?: {
    status: string; // 'open' | 'promised_to_pay' | 'escalated' | 'settled' | 'disputed'
    promisedPaymentDate?: string | null;
    promisedAmount?: number | null;
  } | null;
}

export interface EvaluatedDunningResult {
  customerId: number;
  customerName: string;
  phone?: string;
  totalBalance: number;
  totalOverdue: number;
  oldestOverdueDays: number;
  activeDunningLevel: DunningLevel | null;
  recommendedStatus: 'open' | 'promised_to_pay' | 'escalated' | 'settled';
  shouldBlockCredit: boolean;
  creditBlockReason: string | null;
  overdueInvoices: OverdueInvoice[];
  formattedReminderText?: string;
  whatsAppUrl?: string;
}

/**
 * Calculates days overdue relative to asOfDate.
 * If dueDate is not explicitly provided, falls back to createdAt + creditTermsDays.
 */
export function calculateInvoiceOverdueDays(
  invoice: { createdAt: string | Date; dueDate?: string | Date | null },
  asOfDate: Date,
  creditTermsDays = 0,
): { daysOverdue: number; effectiveDueDate: Date } {
  let effectiveDueDate: Date;
  if (invoice.dueDate) {
    effectiveDueDate = new Date(invoice.dueDate);
  } else {
    effectiveDueDate = new Date(invoice.createdAt);
    if (creditTermsDays > 0) {
      effectiveDueDate.setDate(effectiveDueDate.getDate() + creditTermsDays);
    }
  }

  const diffMs = asOfDate.getTime() - effectiveDueDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return {
    daysOverdue: Math.max(0, diffDays),
    effectiveDueDate,
  };
}

/**
 * Allocates outstanding customer balance against invoices (FIFO - oldest unpaid first).
 * Returns the list of invoices that carry overdue amounts.
 */
export function allocateCustomerOverdueFifo(
  balance: number,
  invoices: InputInvoice[],
  asOfDate: Date,
  creditTermsDays = 0,
  moneyDigits: MoneyDigits = 2,
): { overdueInvoices: OverdueInvoice[]; totalOverdue: number; oldestOverdueDays: number } {
  if (balance <= 0.01 || !invoices.length) {
    return { overdueInvoices: [], totalOverdue: 0, oldestOverdueDays: 0 };
  }

  // Sort invoices ascending by creation date (oldest first for FIFO allocation)
  const sorted = [...invoices].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  let remainingBalance = roundMoney(balance, moneyDigits);
  const overdueInvoices: OverdueInvoice[] = [];
  let totalOverdue = 0;
  let maxOverdueDays = 0;

  for (const inv of sorted) {
    if (remainingBalance <= 0) break;

    const invoiceUnpaid = Math.max(0, roundMoney(inv.total - inv.paidAmount, moneyDigits));
    if (invoiceUnpaid <= 0) continue;

    const allocated = Math.min(remainingBalance, invoiceUnpaid);
    const { daysOverdue, effectiveDueDate } = calculateInvoiceOverdueDays(inv, asOfDate, creditTermsDays);

    if (daysOverdue > 0 && allocated > 0) {
      totalOverdue = roundMoney(totalOverdue + allocated, moneyDigits);
      if (daysOverdue > maxOverdueDays) {
        maxOverdueDays = daysOverdue;
      }

      overdueInvoices.push({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        createdAt: new Date(inv.createdAt).toISOString().slice(0, 10),
        dueDate: effectiveDueDate.toISOString().slice(0, 10),
        total: roundMoney(inv.total, moneyDigits),
        paidAmount: roundMoney(inv.paidAmount, moneyDigits),
        unpaidAmount: invoiceUnpaid,
        allocatedOverdueAmount: roundMoney(allocated, moneyDigits),
        daysOverdue,
      });
    }

    remainingBalance = roundMoney(remainingBalance - allocated, moneyDigits);
  }

  // If there is still unallocated balance (e.g. opening balances or legacy debit notes),
  // and we had at least some overdue days, keep that exposure accounted for
  if (remainingBalance > 0 && maxOverdueDays > 0) {
    totalOverdue = roundMoney(totalOverdue + remainingBalance, moneyDigits);
  }

  return {
    overdueInvoices,
    totalOverdue,
    oldestOverdueDays: maxOverdueDays,
  };
}

/**
 * Determines the matching dunning level based on the oldest overdue days.
 * Levels are ordered by days_past_due ascending.
 */
export function determineDunningLevel(
  oldestOverdueDays: number,
  levels: DunningLevel[],
): DunningLevel | null {
  if (oldestOverdueDays <= 0 || !levels.length) return null;

  const sortedLevels = [...levels].sort((a, b) => a.days_past_due - b.days_past_due);
  let matched: DunningLevel | null = null;

  for (const lvl of sortedLevels) {
    if (oldestOverdueDays >= lvl.days_past_due) {
      matched = lvl;
    }
  }

  return matched;
}

/**
 * Renders template variables safely:
 * {customer_name}, {total_overdue}, {days_overdue}, {company_name}, {currency}
 */
export function renderDunningMessage(
  template: string,
  vars: {
    customerName: string;
    totalOverdue: number;
    daysOverdue: number;
    companyName?: string;
    currency?: string;
  },
): string {
  const currencyStr = vars.currency || 'ج.م';
  const companyStr = vars.companyName || 'إدارة الحسابات';
  const overdueFormatted = vars.totalOverdue.toLocaleString('ar-EG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return template
    .replace(/{customer_name}/g, vars.customerName)
    .replace(/{total_overdue}/g, overdueFormatted)
    .replace(/{days_overdue}/g, String(vars.daysOverdue))
    .replace(/{company_name}/g, companyStr)
    .replace(/{currency}/g, currencyStr);
}

/**
 * Builds standard WhatsApp direct link with sanitized international phone number.
 */
export function buildWhatsAppCollectionUrl(
  phone: string | undefined | null,
  message: string,
): string | undefined {
  if (!phone) return undefined;
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.length < 8) return undefined;

  const phoneParam = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  return `https://wa.me/${phoneParam}?text=${encodeURIComponent(message)}`;
}

/**
 * Evaluates the full dunning lifecycle for a single customer.
 */
export function evaluateCustomerDunning(
  input: CustomerDunningInput,
  levels: DunningLevel[],
  companyName?: string,
  moneyDigits: MoneyDigits = 2,
): EvaluatedDunningResult {
  const asOfDate = input.asOfDate ? new Date(input.asOfDate) : new Date();
  const totalBalance = roundMoney(input.balance || 0, moneyDigits);

  // If customer has zero or negative balance, any case is settled
  if (totalBalance <= 0.01) {
    return {
      customerId: input.customerId,
      customerName: input.customerName,
      phone: input.phone || undefined,
      totalBalance: 0,
      totalOverdue: 0,
      oldestOverdueDays: 0,
      activeDunningLevel: null,
      recommendedStatus: 'settled',
      shouldBlockCredit: false,
      creditBlockReason: null,
      overdueInvoices: [],
    };
  }

  // 1. Allocate overdue amounts via FIFO
  const { overdueInvoices, totalOverdue, oldestOverdueDays } = input.overdueSummary
    ? { overdueInvoices: [], ...input.overdueSummary }
    : allocateCustomerOverdueFifo(totalBalance, input.invoices, asOfDate, input.creditTermsDays ?? 0, moneyDigits);

  // 2. Identify active dunning level
  const activeLevel = determineDunningLevel(oldestOverdueDays, levels);

  // 3. Evaluate Promise to Pay vs Breached Promise
  let recommendedStatus: EvaluatedDunningResult['recommendedStatus'] = 'open';
  let isPromiseBreached = false;

  if (input.currentCase?.status === 'promised_to_pay' && input.currentCase.promisedPaymentDate) {
    const promiseDate = new Date(input.currentCase.promisedPaymentDate);
    promiseDate.setHours(23, 59, 59, 999);
    if (asOfDate.getTime() > promiseDate.getTime()) {
      // Promise expired without settlement -> Escalate
      isPromiseBreached = true;
      recommendedStatus = 'escalated';
    } else {
      // Promise is still active and valid
      recommendedStatus = 'promised_to_pay';
    }
  } else if (activeLevel && activeLevel.level_order >= 4) {
    recommendedStatus = 'escalated';
  } else if (totalOverdue > 0) {
    recommendedStatus = 'open';
  }

  // 4. Determine Credit Block Policy
  let shouldBlockCredit = false;
  let creditBlockReason: string | null = null;

  if (input.isCreditBlocked) {
    shouldBlockCredit = true;
    creditBlockReason = 'محظور مسبقاً بقرار إداري';
  } else if (isPromiseBreached) {
    shouldBlockCredit = true;
    creditBlockReason = `إخلال بوعد السداد المسجل بتاريخ ${input.currentCase?.promisedPaymentDate}`;
  } else if (activeLevel?.auto_block_sales) {
    shouldBlockCredit = true;
    creditBlockReason = `تجاوز مهلة السداد المسموحة وصولاً للمستوى (${activeLevel.level_name}) بتأخير ${oldestOverdueDays} يوماً`;
  }

  // 5. Build Reminder Text and WhatsApp URL
  let formattedReminderText: string | undefined;
  let whatsAppUrl: string | undefined;

  if (activeLevel && totalOverdue > 0) {
    formattedReminderText = renderDunningMessage(activeLevel.template_text, {
      customerName: input.customerName,
      totalOverdue,
      daysOverdue: oldestOverdueDays,
      companyName,
    });
    whatsAppUrl = buildWhatsAppCollectionUrl(input.phone, formattedReminderText);
  }

  return {
    customerId: input.customerId,
    customerName: input.customerName,
    phone: input.phone || undefined,
    totalBalance,
    totalOverdue,
    oldestOverdueDays,
    activeDunningLevel: activeLevel,
    recommendedStatus,
    shouldBlockCredit,
    creditBlockReason,
    overdueInvoices,
    formattedReminderText,
    whatsAppUrl,
  };
}
