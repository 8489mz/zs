export interface CustomerRepLedgerEntryInput {
  customerId: number;
  repId: number | null;
  repName?: string | null;
  amount: number; // positive = debit (sale), negative = credit (payment / return)
}

export interface CustomerRepBalanceItem {
  repId: number;
  repName: string;
  balance: number;
  totalDebit: number;
  totalCredit: number;
}

export interface CustomerRepBalanceBreakdown {
  customerId: number;
  totalCustomerBalance: number;
  totalRepBalance: number;
  unassignedBalance: number;
  repBalances: CustomerRepBalanceItem[];
  byRepId: Record<number, CustomerRepBalanceItem>;
}

/**
 * Extracts all assigned representative IDs from customer metadata,
 * supporting both legacy single `assigned_rep_id` and multi-rep `assigned_rep_ids`.
 */
export function extractAssignedRepIds(metadata: Record<string, any> | string | null | undefined): number[] {
  let metaObj: Record<string, any> | null = null;
  if (metadata) {
    if (typeof metadata === 'string') {
      try {
        metaObj = JSON.parse(metadata);
      } catch {
        metaObj = null;
      }
    } else if (typeof metadata === 'object') {
      metaObj = metadata;
    }
  }
  if (!metaObj) return [];

  const ids = new Set<number>();
  if (Array.isArray(metaObj.assigned_rep_ids)) {
    for (const raw of metaObj.assigned_rep_ids) {
      const n = Number(raw);
      if (Number.isInteger(n) && n > 0) ids.add(n);
    }
  }
  if (metaObj.assigned_rep_id !== undefined && metaObj.assigned_rep_id !== null) {
    const single = Number(metaObj.assigned_rep_id);
    if (Number.isInteger(single) && single > 0) ids.add(single);
  }
  if (Array.isArray(metaObj.rep_schedules)) {
    for (const item of metaObj.rep_schedules) {
      const n = Number(item?.repId ?? item?.rep_id);
      if (Number.isInteger(n) && n > 0) ids.add(n);
    }
  }
  return Array.from(ids);
}
