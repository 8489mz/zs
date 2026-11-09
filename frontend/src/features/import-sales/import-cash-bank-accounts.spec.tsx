/*
 * I5 isCashBank sweep (INV-IMPORT-ISCASHBANK-SWEEP).
 *
 * WHAT WAS WRONG (grounded by I4-D7, proven by the coordinator from live
 * code at 4b81a523, still true at 42c20173): the AccountingAccount type has
 * NO top-level `isCashBank` — the flag lives ONLY under
 * `flags: { isCashBank, ... }`. Every filter reading top-level
 * `a.isCashBank` read `undefined` and matched nothing, so the cash/bank
 * dropdowns offered the wrong accounts:
 * - ContainerDepositsManager (I3-D8 code): `a.isCashBank === true` —
 *   the deposit treasury dropdown offered ZERO accounts live (deposits
 *   were not blocked — treasury unset falls back to the settings bank —
 *   but the CHOICE was gone).
 * - CustomsBrokerManager / SupplierCredit:
 *   `a.accountGroup === 'current_assets' || a.isCashBank` — the
 *   isCashBank arm never matched and the accountGroup arm offered ONLY
 *   the three parent accounts (1100/1160/1170), which the backend bank
 *   role rejects (is_cash_bank false).
 * - ShipmentDetailsPage: `a.isCashBank || a.code === '1110' || ...` —
 *   partially saved by the code fallback for 1110/1120, but the flags
 *   arm itself never matched.
 *
 * WHAT THIS PINS (the real helper + the real call sites):
 * - isCashBankAccount admits real cash/bank leaves (1110/1120) and
 *   rejects the parent accounts (1100/1160/1170), the receivable
 *   control account (1130), rows with missing flags, and rows that
 *   carry the flag ONLY top-level (the old read shape).
 * - Each of the four components filters through isCashBankAccount and
 *   contains no remaining top-level `a.isCashBank` code read.
 * - CustomsBrokerManager and SupplierCredit no longer contain the
 *   `accountGroup === 'current_assets'` arm (the parent-offering arm).
 * - ShipmentDetailsPage keeps its code / accountGroup fallback arms
 *   (1110/1120/1160/cash_bank) and its parent exclusion, so its
 *   offered set is not narrowed by this sweep.
 *
 * FAILS ON BASE: the helper does not exist there, so the import itself
 * fails and every case in this file fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isCashBankAccount } from '@/features/accounting';

// Fixture chart mirroring the seeded COA shape: parents carry
// accountGroup 'current_assets' with flags.isCashBank false; real
// cash/bank leaves carry group 'cash_bank' with flags.isCashBank true.
// No row carries a top-level isCashBank — the endpoint never sends one.
const account = (overrides: Record<string, unknown>) => ({
  id: '1',
  code: '1110',
  nameAr: 'الصندوق',
  nameEn: 'Cash',
  accountType: 'asset',
  accountGroup: 'cash_bank',
  parentId: '',
  depth: 1,
  normalBalance: 'debit',
  balance: 0,
  isActive: true,
  isSystem: false,
  allowManualEntries: true,
  isControlAccount: false,
  isMonetary: true,
  revaluationCurrency: null,
  flags: { isCashBank: true, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  sortOrder: 0,
  ...overrides,
});

const PARENT_1100 = account({ id: 'p1', code: '1100', nameAr: 'الأصول المتداولة', accountGroup: 'current_assets', isParent: true, flags: { isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false } });
const PARENT_1160 = account({ id: 'p2', code: '1160', nameAr: 'أصول متداولة أخرى', accountGroup: 'current_assets', isParent: true, flags: { isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false } });
const PARENT_1170 = account({ id: 'p3', code: '1170', nameAr: 'أصول متداولة أخرى 2', accountGroup: 'current_assets', isParent: true, flags: { isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false } });
const CASH_1110 = account({ id: 'c1', code: '1110' });
const BANK_1120 = account({ id: 'c2', code: '1120', nameAr: 'البنك' });
const RECEIVABLE_1130 = account({ id: 'r1', code: '1130', nameAr: 'العملاء', accountGroup: 'current_assets', flags: { isCashBank: false, isReceivable: true, isPayable: false, isInventory: false, isTax: false } });
// The old read shape: a row that carries the flag ONLY top-level.
// The endpoint never sends this shape; it proves the helper ignores it.
const TOP_LEVEL_ONLY = { ...account({ id: 't1', code: '1199', flags: { isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false } }), isCashBank: true };

const CHART = [PARENT_1100, PARENT_1160, PARENT_1170, CASH_1110, BANK_1120, RECEIVABLE_1130];

const readSource = (file: string) =>
  fs.readFileSync(path.resolve(__dirname, file), 'utf8');

describe('isCashBankAccount (INV-IMPORT-ISCASHBANK-SWEEP)', () => {
  it('admits the real cash/bank leaves 1110 and 1120', () => {
    expect(CHART.filter(isCashBankAccount).map((a) => a.code)).toEqual(['1110', '1120']);
  });

  it('rejects the parent current-asset accounts 1100/1160/1170', () => {
    expect(isCashBankAccount(PARENT_1100)).toBe(false);
    expect(isCashBankAccount(PARENT_1160)).toBe(false);
    expect(isCashBankAccount(PARENT_1170)).toBe(false);
  });

  it('rejects the receivable control account 1130', () => {
    expect(isCashBankAccount(RECEIVABLE_1130)).toBe(false);
  });

  it('rejects rows with missing flags and null/undefined rows', () => {
    expect(isCashBankAccount(account({ flags: null }))).toBe(false);
    expect(isCashBankAccount(account({ flags: undefined }))).toBe(false);
    expect(isCashBankAccount(null)).toBe(false);
    expect(isCashBankAccount(undefined)).toBe(false);
  });

  it('ignores a top-level isCashBank flag (the old read shape matches nothing)', () => {
    // The old predicate `a.isCashBank === true` admits this row; the
    // endpoint never sends that shape, and the helper must not trust it.
    expect((TOP_LEVEL_ONLY as any).isCashBank).toBe(true);
    expect(isCashBankAccount(TOP_LEVEL_ONLY as any)).toBe(false);
  });

  it('the old top-level predicate offered zero accounts on real endpoint rows', () => {
    // Mechanism of the live defect: no endpoint row carries a top-level
    // flag, so the old filter matched nothing — the deposit dropdown
    // offered zero accounts.
    const offeredByOldRead = CHART.filter((a: any) => a.isCashBank === true);
    expect(offeredByOldRead).toEqual([]);
    expect(CHART.filter(isCashBankAccount).length).toBe(2);
  });
});

describe('the four swept dropdowns filter through the helper', () => {
  const SWEPT = [
    'ContainerDepositsManager.tsx',
    'CustomsBrokerManager.tsx',
    'SupplierCredit.tsx',
    'ShipmentDetailsPage.tsx',
  ];

  it.each(SWEPT)('%s filters through isCashBankAccount', (file) => {
    const source = readSource(file);
    expect(source).toContain('isCashBankAccount');
    expect(source).toContain("from '@/features/accounting'");
  });

  it.each(SWEPT)('%s has no remaining top-level a.isCashBank code read', (file) => {
    const source = readSource(file);
    expect(source).not.toContain('a.isCashBank === true');
    expect(source).not.toContain('|| a.isCashBank');
    expect(source).not.toContain('a.isCashBank ||');
    expect(source).not.toContain('=> a.isCashBank');
  });

  it('CustomsBrokerManager and SupplierCredit no longer offer the parent-accounts arm', () => {
    for (const file of ['CustomsBrokerManager.tsx', 'SupplierCredit.tsx']) {
      expect(readSource(file)).not.toContain("accountGroup === 'current_assets'");
    }
  });

  it('ShipmentDetailsPage keeps its fallback arms and its parent exclusion (offered set not narrowed)', () => {
    const source = readSource('ShipmentDetailsPage.tsx');
    expect(source).toContain("a.code === '1110'");
    expect(source).toContain("a.code === '1120'");
    expect(source).toContain("a.code === '1160'");
    expect(source).toContain("a.accountGroup === 'cash_bank'");
    expect(source).toContain('a.isParent');
    expect(source).toContain("a.code === '1100'");
  });
});
