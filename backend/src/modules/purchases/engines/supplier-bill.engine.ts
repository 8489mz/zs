import { AppError } from '../../../common/errors/app-error';
import { fromMinorUnits, toMinorUnits, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

/*
 * supplier-bill.engine.ts — INV-SUPPLIER-NONSTOCK-BILL.
 *
 * Pure helpers for non-stock supplier bills. No database, no clock, no
 * rounding of user input: a line amount is VALIDATED to the tenant's book
 * precision (toMinorUnits fails closed, exactly like the payment services'
 * INVALID_AMOUNT) and the total is the exact sum in integer minor units,
 * so no remainder can leak. roundMoney is deliberately NOT used here —
 * its own doc says explicit rounding is for derived values (FX and
 * percentage allocations), not user inputs.
 */

export type SupplierBillLineInput = { amount: number };

export function buildBillTotal(lines: SupplierBillLineInput[], digits: MoneyDigits): number {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new AppError('Supplier bill needs at least one line', 'SUPPLIER_BILL_NO_LINES', 400);
  }
  let totalMinor = 0;
  for (const line of lines) {
    const amount = Number((line as { amount?: unknown }).amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError('Supplier bill line amount must be positive', 'SUPPLIER_BILL_INVALID_AMOUNT', 400);
    }
    let minor: number;
    try {
      minor = toMinorUnits(amount, digits);
    } catch {
      throw new AppError(
        'Supplier bill line amount exceeds currency minor-unit precision',
        'SUPPLIER_BILL_INVALID_AMOUNT',
        400,
      );
    }
    totalMinor += minor;
  }
  return fromMinorUnits(totalMinor, digits);
}

/* Accounts a bill line may never post to: cash/bank, receivables,
 * inventory, the payable itself, any advance asset, and tax accounts.
 * A line must land on a real expense or a real asset — that is the whole
 * point of the document: the amount is consumed or owned, never stocked
 * and never a settlement of itself. */
const BLOCKED_BILL_ACCOUNT_CODES = new Set([
  '1110',
  '1120', // cash, bank
  '1130', // customers receivable
  '1140', // inventory
  '2110', // suppliers payable (the credit side of this very bill)
  '1185',
  '1160',
  '1165', // supplier / employee / subcontractor advances
  '1150',
  '2120',
  '2126',
  '2150', // tax receivable / payable / advances
]);

export type BillLineAccountRow =
  | {
      id: number;
      code: string;
      account_type: string;
      normal_balance?: string | null;
      is_active?: boolean | null;
      is_control_account?: boolean | null;
    }
  | null
  | undefined;

export function validateBillLineAccount(account: BillLineAccountRow, description: string): void {
  const label = description ? ` for line "${description}"` : '';
  if (!account) {
    throw new AppError(`Supplier bill line account not found${label}`, 'SUPPLIER_BILL_INVALID_ACCOUNT', 400);
  }
  if (account.is_active === false) {
    throw new AppError(
      `Supplier bill line account ${account.code} is inactive${label}`,
      'SUPPLIER_BILL_INVALID_ACCOUNT',
      400,
    );
  }
  if (account.account_type !== 'expense' && account.account_type !== 'asset') {
    throw new AppError(
      `Supplier bill line account ${account.code} must be an expense or asset account${label}`,
      'SUPPLIER_BILL_INVALID_ACCOUNT',
      400,
    );
  }
  // normal_balance derives from the type (debit for expense/asset); a
  // legacy row with no normal_balance set is accepted on its type, only
  // an explicit credit balance is rejected.
  if (account.normal_balance && account.normal_balance !== 'debit') {
    throw new AppError(
      `Supplier bill line account ${account.code} must have a debit balance${label}`,
      'SUPPLIER_BILL_INVALID_ACCOUNT',
      400,
    );
  }
  if (account.is_control_account === true) {
    throw new AppError(
      `Supplier bill line account ${account.code} is a control account${label}`,
      'SUPPLIER_BILL_INVALID_ACCOUNT',
      400,
    );
  }
  if (BLOCKED_BILL_ACCOUNT_CODES.has(String(account.code))) {
    throw new AppError(
      `Supplier bill line account ${account.code} cannot receive a bill line${label}`,
      'SUPPLIER_BILL_INVALID_ACCOUNT',
      400,
    );
  }
}
