/**
 * accounting-types — shared type aliases for the accounting split.
 * Pure move from accounting.service.ts: the 5 top-level type aliases
 * (byte-identical except each is 'export type' — in the facade they
 * were module-local, but the facade kernel + slices import them from
 * here) + the exported free function bankStatementAmountsEqual with
 * its JSDoc (byte-identical). Created with the S1 merge (the first);
 * S2 uses DraftJournalLineInput + DraftJournalEntryInput, S4 uses
 * OpeningBalanceAccount + OpeningBalanceLine, the kernel uses
 * PartnerType. The facade re-exports bankStatementAmountsEqual
 * (merge-owned) because bank-rec-precision.spec.ts:18 imports it
 * from the service file. Slices NEVER import the facade file.
 */

import { roundMoney, type MoneyDigits } from './engines/money-minor-units.engine';

/**
 * Statement-vs-GL amount equality at book precision. Both sides are
 * rounded to the tenant minor unit first (absorbing float noise such as
 * 0.1 + 0.2 vs 0.3); any remaining difference is real money and must NOT
 * auto-match. The old < 0.01 tolerance silently matched KWD differences
 * of up to 9 fils as an "exact" match and then marked the line reconciled,
 * hiding the gap from every later check.
 */
export function bankStatementAmountsEqual(a: number, b: number, digits: MoneyDigits): boolean {
  return roundMoney(a, digits) === roundMoney(b, digits);
}

export type PartnerType = 'none' | 'customer' | 'supplier';

export type DraftJournalLineInput = {
  accountId: number;
  costCenterId?: number | null;
  description?: string;
  debit?: number;
  credit?: number;
  partnerType?: PartnerType;
  partnerId?: number | null;
  branchId?: number | null;
  locationId?: number | null;
};

export type DraftJournalEntryInput = {
  entryDate?: Date;
  description?: string;
  sourceType?: string;
  sourceId?: number | null;
  branchId?: number | null;
  locationId?: number | null;
  lines: DraftJournalLineInput[];
};

export type OpeningBalanceAccount = {
  id: number;
  code: string;
  nameAr: string;
  accountType: string;
  isActive: boolean;
  allowManualEntries: boolean;
};

export type OpeningBalanceLine = {
  accountId: number;
  accountCode: string;
  accountNameAr: string;
  description: string;
  debit: number;
  credit: number;
};
