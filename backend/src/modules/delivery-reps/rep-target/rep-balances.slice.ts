import { type MoneyDigits, roundMoney as roundBookMoney } from '../../accounting/engines/money-minor-units.engine';
import { isValidCoordinatePair } from './rep-geo.slice';
import type { CustomerRepLedgerEntryInput, CustomerRepBalanceBreakdown } from './rep-ids.slice';

/**
 * H9 (D4): a visit carries usable GPS only when both coordinates are
 * finite, in range, and not the (0, 0) "no fix" pair — the same
 * validity rule as isValidCoordinatePair. Null, undefined, NaN, or
 * (0, 0) all count as missing GPS.
 */
export function hasGpsCoordinates(lat: unknown, lng: unknown): boolean {
  return isValidCoordinatePair(Number(lat), Number(lng));
}

/**
 * Pure aggregation engine for Rep-to-Rep Customer Account Isolation (عزل حسابات المناديب للعميل المشترك).
 * Ensures that if Rep 1 is owed 500 EGP and Rep 2 is owed 2,000 EGP by the same shop (e.g. "محل البركة" C-0002),
 * each rep's balance is strictly isolated, while the Supervisor/Owner sees the unified 2,500 EGP total
 * alongside each rep's exact share.
 */
export function aggregateCustomerBalancesByRep(
  entries: CustomerRepLedgerEntryInput[],
  // Defaulted (not `?`) so the required `digits` may follow it: a
  // required parameter cannot follow an optional one (TS1016).
  customerTotalBalances: Record<number, number> | undefined = undefined,
  digits: MoneyDigits,
): Map<number, CustomerRepBalanceBreakdown> {
  const result = new Map<number, CustomerRepBalanceBreakdown>();

  const ensureCustomer = (customerId: number): CustomerRepBalanceBreakdown => {
    let item = result.get(customerId);
    if (!item) {
      item = {
        customerId,
        totalCustomerBalance: 0,
        totalRepBalance: 0,
        unassignedBalance: 0,
        repBalances: [],
        byRepId: {},
      };
      result.set(customerId, item);
    }
    return item;
  };

  if (customerTotalBalances) {
    for (const [cidKey, bal] of Object.entries(customerTotalBalances)) {
      const cid = Number(cidKey);
      if (Number.isInteger(cid) && cid > 0) {
        const item = ensureCustomer(cid);
        item.totalCustomerBalance = roundBookMoney(Number(bal || 0), digits);
      }
    }
  }

  for (const row of entries || []) {
    const cid = Number(row.customerId);
    if (!Number.isInteger(cid) || cid <= 0) continue;
    const amt = roundBookMoney(Number(row.amount || 0), digits);
    if (amt === 0) continue;

    const item = ensureCustomer(cid);
    const repId = row.repId !== undefined && row.repId !== null ? Number(row.repId) : null;

    if (repId && Number.isInteger(repId) && repId > 0) {
      let repItem = item.byRepId[repId];
      if (!repItem) {
        repItem = {
          repId,
          repName: String(row.repName || `مندوب #${repId}`).trim(),
          balance: 0,
          totalDebit: 0,
          totalCredit: 0,
        };
        item.byRepId[repId] = repItem;
      } else if (row.repName && repItem.repName.startsWith('مندوب #')) {
        repItem.repName = String(row.repName).trim();
      }

      repItem.balance = roundBookMoney(repItem.balance + amt, digits);
      if (amt > 0) {
        repItem.totalDebit = roundBookMoney(repItem.totalDebit + amt, digits);
      } else {
        repItem.totalCredit = roundBookMoney(repItem.totalCredit + Math.abs(amt), digits);
      }
    } else {
      item.unassignedBalance = roundBookMoney(item.unassignedBalance + amt, digits);
    }
  }

  for (const [cid, item] of result.entries()) {
    const repList = Object.values(item.byRepId).sort((a, b) => {
      if (b.balance !== a.balance) return b.balance - a.balance;
      return a.repId - b.repId;
    });
    item.repBalances = repList;
    item.totalRepBalance = roundBookMoney(repList.reduce((sum, r) => sum + r.balance, 0), digits);

    const hasExplicitCustomerTotal =
      customerTotalBalances !== undefined &&
      Object.prototype.hasOwnProperty.call(customerTotalBalances, cid);

    if (hasExplicitCustomerTotal) {
      const explicitTotal = roundBookMoney(Number(customerTotalBalances![cid] || 0), digits);
      item.totalCustomerBalance = explicitTotal;
      item.unassignedBalance = roundBookMoney(explicitTotal - item.totalRepBalance, digits);
    } else {
      item.totalCustomerBalance = roundBookMoney(item.totalRepBalance + item.unassignedBalance, digits);
    }
  }

  return result;
}

/**
 * Resolves the isolated balance visible to a specific rep (`repId`) for a customer.
 * - Strictly returns only `repId`'s own ledger balance (`byRepId[repId].balance`).
 * - Fallback: If no rep has any ledger balance on this customer (`totalRepBalance === 0`)
 *   AND the customer has a legacy opening balance (`unassignedBalance > 0`)
 *   AND the customer is exclusively assigned to this single rep (`assignedRepIds.length === 1 && assignedRepIds[0] === repId`),
 *   returns `unassignedBalance`.
 * - Otherwise returns `0` if `repId` has no ledger transactions with the customer (never leaks another rep's balance).
 */
export function resolveIsolatedRepCustomerBalance(params: {
  repId: number;
  breakdown?: CustomerRepBalanceBreakdown | null;
  assignedRepIds?: number[];
  fallbackTotalBalance?: number;
  moneyDigits: MoneyDigits;
}): {
  repBalance: number;
  otherRepsBalance: number;
  totalCustomerBalance: number;
} {
  const repId = Number(params.repId);
  const breakdown = params.breakdown;
  const assignedIds = params.assignedRepIds || [];

  if (!breakdown) {
    const total = roundBookMoney(Number(params.fallbackTotalBalance || 0), params.moneyDigits);
    const isExclusivelyAssignedToRep = assignedIds.length === 1 && Number(assignedIds[0]) === repId;
    const repBal = isExclusivelyAssignedToRep ? total : 0;
    return {
      repBalance: repBal,
      otherRepsBalance: roundBookMoney(Math.max(0, total - repBal), params.moneyDigits),
      totalCustomerBalance: total,
    };
  }

  const ownEntry = breakdown.byRepId[repId];
  const ownLedgerBalance = ownEntry ? roundBookMoney(ownEntry.balance, params.moneyDigits) : 0;
  const otherRepsLedgerBalance = roundBookMoney(
    breakdown.repBalances
      .filter((r) => r.repId !== repId && r.balance > 0)
      .reduce((sum, r) => sum + r.balance, 0),
    params.moneyDigits,
  );

  const isExclusivelyAssignedToRep =
    assignedIds.length === 1 &&
    Number(assignedIds[0]) === repId &&
    otherRepsLedgerBalance === 0;

  const effectiveRepBalance =
    isExclusivelyAssignedToRep && breakdown.unassignedBalance > 0
      ? roundBookMoney(ownLedgerBalance + breakdown.unassignedBalance, params.moneyDigits)
      : ownLedgerBalance;

  return {
    repBalance: effectiveRepBalance,
    otherRepsBalance: otherRepsLedgerBalance,
    totalCustomerBalance: breakdown.totalCustomerBalance,
  };
}

/**
 * Validates that a field representative's collection from a shared customer
 * does not encroach upon or deduct from another representative's isolated debt balance.
 */
export function validateIsolatedRepCollection(params: {
  repId: number;
  collectionAmount: number;
  repBalance: number;
  otherRepsBalance: number;
  totalCustomerBalance: number;
  moneyDigits: MoneyDigits;
}): {
  allowed: boolean;
  errorCode?: string;
  errorMessage?: string;
  repPreviousBalance: number;
  repNewBalance: number;
  companyPreviousBalance: number;
  companyNewBalance: number;
} {
  const amount = roundBookMoney(Number(params.collectionAmount || 0), params.moneyDigits);
  const repPreviousBalance = roundBookMoney(Number(params.repBalance || 0), params.moneyDigits);
  const otherRepsBalance = roundBookMoney(Number(params.otherRepsBalance || 0), params.moneyDigits);
  const companyPreviousBalance = roundBookMoney(Number(params.totalCustomerBalance || 0), params.moneyDigits);

  if (amount <= 0) {
    return {
      allowed: false,
      errorCode: 'INVALID_COLLECTION_AMOUNT',
      errorMessage: 'يجب أن تكون قيمة التحصيل أكبر من الصفر',
      repPreviousBalance,
      repNewBalance: repPreviousBalance,
      companyPreviousBalance,
      companyNewBalance: companyPreviousBalance,
    };
  }

  // If the amount exceeds this rep's own balance AND another rep has balance on this customer,
  // block immediately to prevent mixing rep accounts!
  if (amount > repPreviousBalance && otherRepsBalance > 0) {
    return {
      allowed: false,
      errorCode: 'REP_ISOLATED_BALANCE_EXCEEDED',
      errorMessage:
        repPreviousBalance <= 0
          ? `لا توجد مديونية مستحقة لك على هذا العميل (رصيدك معه: 0 ج.م)، بينما توجد مديونية بقيمة (${otherRepsBalance} ج.م) تخص مناديب آخرين وعهدهم مستقلة.`
          : `لا يمكن تحصيل مبلغ (${amount} ج.م) أكبر من مديونية العميل الخاصة بعهدتك (${repPreviousBalance} ج.م). باقي مديونية العميل (${otherRepsBalance} ج.م) تخص مناديب آخرين وعهدهم مستقلة.`,
      repPreviousBalance,
      repNewBalance: repPreviousBalance,
      companyPreviousBalance,
      companyNewBalance: companyPreviousBalance,
    };
  }

  // INV-REP-COLLECTION-TOTAL-BALANCE-CAP: a field collection must never
  // exceed the customer's TOTAL debt (this rep's share + other reps'
  // balances + any unassigned balance). Before this cap the only guard
  // above fired when another rep held balance on the same customer, so
  // a sole-rep customer could be collected past zero and
  // customers.balance (and 1130) went negative with no recorded advance
  // intent. There is no advance concept on the field-collection path
  // (no advance flag on the payload, no advance column on
  // customer_payments), so anything above the total debt is refused
  // hard with a specific error naming both amounts. The cross-rep guard
  // above still runs first: collecting another rep's share stays
  // refused under its own code even when the total would allow it.
  if (amount > companyPreviousBalance) {
    return {
      allowed: false,
      errorCode: 'REP_COLLECTION_EXCEEDS_TOTAL_BALANCE',
      errorMessage: `لا يمكن تحصيل مبلغ (${amount} ج.م) أكبر من إجمالي مديونية العميل (${companyPreviousBalance} ج.م). لا توجد سلفة مسجلة على هذا العميل تسمح بالتحصيل الزائد.`,
      repPreviousBalance,
      repNewBalance: repPreviousBalance,
      companyPreviousBalance,
      companyNewBalance: companyPreviousBalance,
    };
  }

  return {
    allowed: true,
    repPreviousBalance,
    repNewBalance: roundBookMoney(repPreviousBalance - amount, params.moneyDigits),
    companyPreviousBalance,
    companyNewBalance: roundBookMoney(companyPreviousBalance - amount, params.moneyDigits),
  };
}
