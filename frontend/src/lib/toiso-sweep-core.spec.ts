/*
 * toISOString date-key sweep, package 1 (core) — INV-TOISO-DATE-SWEEP-CORE.
 *
 * Pins the new tenant-date helpers in frontend/src/lib/format.ts and ratchets
 * the package-1 file list: no `toISOString().slice(0, 10)` /
 * `toISOString().split('T')[0]` may remain in any listed production file.
 *
 * The bug: 01:00 in Cairo is still the previous UTC day, so a business date
 * defaulted from the UTC slice keys yesterday for the first two hours after
 * midnight (UTC+2; three hours for UTC+3 zones). Month-start defaults built
 * the same way (`new Date(y, m, 1).toISOString()...`) key the last day of the
 * PREVIOUS month. The helpers key from calendar parts instead.
 *
 * Kept sites are NOT in this list: the 14 display-only export-filename /
 * prose-note sites and the bank-statement serial site stay, and are ratcheted
 * by toiso-sweep-remainder.spec.ts (package 3).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  addDaysLocalDateKey,
  addDaysTenantDateKey,
  todayLocalDateKey,
  todayTenantDateKey,
} from './format';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SLICE_RE = /toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/g;
const SPLIT_RE = /toISOString\(\)\s*\.split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]/g;

/* Package-1 production files (helpers live in frontend/src/lib/format.ts). */
const PACKAGE_1_FILES = [
  'frontend/src/lib/format.ts',
  'frontend/src/app/router/route-prefetch.ts',
  'frontend/src/features/accounting/components/ManualJournalEntryDialog.tsx',
  'frontend/src/features/accounting/components/PdcChequeActionModal.tsx',
  'frontend/src/features/accounting/components/PdcChequeCreateModal.tsx',
  'frontend/src/features/accounting/components/collections/ArPromiseToPayModal.tsx',
  'frontend/src/features/accounting/pages/AccountingFixedAssetsPage.tsx',
  'frontend/src/features/accounting/pages/AccountingForexRevaluationPage.tsx',
  'frontend/src/features/accounting/pages/AccountingSettingsPage.tsx',
  'frontend/src/features/accounting/pages/AgedDebtsPage.tsx',
  'frontend/src/features/accounting/pages/BalanceSheetPage.tsx',
  'frontend/src/features/accounting/pages/BankReconciliationPage.tsx',
  'frontend/src/features/accounting/pages/CashFlowStatementPage.tsx',
  'frontend/src/features/accounting/pages/PdcChequesPage.tsx',
  'frontend/src/features/accounting/pages/WithholdingTaxPage.tsx',
  'frontend/src/features/accounts/components/SupplierBalanceScheduleCard.tsx',
  'frontend/src/features/purchases/components/PurchasePaymentScheduleCard.tsx',
  'frontend/src/features/purchases/components/new-purchase-order/useNewPurchaseOrderController.ts',
  'frontend/src/features/purchases/components/new-purchase-order/hooks/use-purchase-order-form-state.ts',
  'frontend/src/features/purchases/components/new-purchase-order/hooks/use-purchase-order-lines.ts',
  'frontend/src/features/purchases/components/new-purchase-order/hooks/use-purchase-order-validation.ts',
  'frontend/src/features/purchases/components/new-purchase-order/hooks/use-purchase-order-submit.ts',
  'frontend/src/features/purchases/pages/CreatePurchaseOrderPage.tsx',
  'frontend/src/features/sales/hooks/useSalesOverview.ts',
  'frontend/src/features/sales/pages/CreateSalesOrderPage.tsx',
  'frontend/src/features/sales/pages/CreateQuotationPage.tsx',
  'frontend/src/features/sales/components/CreateInstallmentPlanModal.tsx',
  'frontend/src/features/sales/components/CreateSubscriptionModal.tsx',
  'frontend/src/features/sales/pages/SubscriptionsListPage.tsx',
  'frontend/src/features/sales/pages/VatDeclarationPage.tsx',
  'frontend/src/features/pos/components/pos-workspace/PosTableReservationsModal.tsx',
  'frontend/src/features/reports/pages/PivotBuilderPage.tsx',
  'frontend/src/features/dashboard/pages/OwnerCompanionPage.tsx',
  'frontend/src/features/dashboard/pages/OwnerMobileDashboardPage.tsx',
  'frontend/src/features/delivery-reps/components/VanVisitsTrackingAdminTab.tsx',
  'frontend/src/features/delivery-reps/components/VanFinancialLedgerAdminTab.tsx',
  'frontend/src/features/delivery-reps/components/van-financial-ledger/ledger-add-bonus-modal.tsx',
  'frontend/src/features/delivery-reps/components/van-financial-ledger/ledger-badges.ts',
  'frontend/src/features/delivery-reps/components/van-financial-ledger/ledger-filter-bar.tsx',
  'frontend/src/features/delivery-reps/components/van-financial-ledger/ledger-kpi-cards.tsx',
  'frontend/src/features/delivery-reps/components/van-financial-ledger/ledger-link-rep-modal.tsx',
  'frontend/src/features/delivery-reps/components/van-financial-ledger/ledger-push-payroll-modal.tsx',
  'frontend/src/features/delivery-reps/components/van-financial-ledger/ledger-reps-breakdown.tsx',
  'frontend/src/features/delivery-reps/components/van-financial-ledger/ledger-settle-modal.tsx',
  'frontend/src/features/delivery-reps/components/van-financial-ledger/ledger-table.tsx',
  'frontend/src/features/delivery-reps/components/van-financial-ledger/use-ledger-mutations.ts',
  'frontend/src/shared/components/UniversalDocumentFormTemplate.tsx',
  'frontend/src/features/settings/components/workspace-sections/marketplaces/marketplace-settlements.tsx',
  'frontend/src/lib/barcode-labels.ts',
];

describe('todayTenantDateKey', () => {
  it('keys 01:00 in Cairo to the Cairo day, not the previous UTC day', () => {
    const instant = new Date('2026-11-09T00:03:00+02:00');
    // The old expression keys this to 2026-11-08 — the bug this sweep fixes.
    expect(instant.toISOString().slice(0, 10)).toBe('2026-11-08');
    expect(todayTenantDateKey('Africa/Cairo', instant)).toBe('2026-11-09');
  });

  it('keys the same instant differently per zone (Dubai is a day ahead of UTC here)', () => {
    const instant = new Date('2026-11-08T21:30:00.000Z');
    expect(todayTenantDateKey('Africa/Cairo', instant)).toBe('2026-11-08');
    expect(todayTenantDateKey('Asia/Dubai', instant)).toBe('2026-11-09');
  });

  it('keys a west-of-UTC zone to the previous UTC day when the local day is', () => {
    const instant = new Date('2026-11-09T03:00:00.000Z');
    expect(todayTenantDateKey('America/New_York', instant)).toBe('2026-11-08');
    expect(todayTenantDateKey('Africa/Cairo', instant)).toBe('2026-11-09');
  });

  it('falls back to the browser-local day for an invalid zone, never silently to Cairo', () => {
    const instant = new Date(2026, 10, 9, 12, 0, 0);
    expect(todayTenantDateKey('Mars/Olympus', instant)).toBe(todayLocalDateKey(instant));
  });

  it('returns a key for an invalid instant instead of an empty marker', () => {
    expect(todayTenantDateKey('Africa/Cairo', new Date('not-a-date'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('addDaysTenantDateKey', () => {
  it('adds whole calendar days across a month boundary', () => {
    expect(addDaysTenantDateKey('Africa/Cairo', 1, new Date('2026-11-30T12:00:00.000Z'))).toBe('2026-12-01');
    expect(addDaysTenantDateKey('Africa/Cairo', -1, new Date('2026-01-01T12:00:00.000Z'))).toBe('2025-12-31');
  });

  it('counts a +14-day due date from the zone day, not from UTC milliseconds', () => {
    // 01:30 Cairo on 2026-11-09 is 2026-11-08 in UTC; +14 calendar days is 2026-11-23.
    expect(addDaysTenantDateKey('Africa/Cairo', 14, new Date('2026-11-08T23:30:00.000Z'))).toBe('2026-11-23');
  });

  it('does not drift across a DST transition (New York, DST ends 2026-11-01)', () => {
    // 00:30 EDT on Oct 31 + 2 calendar days is Nov 2; raw +48h of
    // milliseconds lands at 23:30 EST on Nov 1 — the wrong day.
    const instant = new Date('2026-10-31T04:30:00.000Z');
    const msShifted = new Date(instant.getTime() + 2 * 86400000);
    // Raw +48h lands at 23:30 EST on Nov 1 in the zone — the wrong day.
    expect(todayTenantDateKey('America/New_York', msShifted)).toBe('2026-11-01');
    expect(addDaysTenantDateKey('America/New_York', 2, instant)).toBe('2026-11-02');
  });
});

describe('addDaysLocalDateKey', () => {
  it('adds calendar days from local parts', () => {
    expect(addDaysLocalDateKey(5, new Date(2026, 10, 28, 12, 0, 0))).toBe('2026-12-03');
    expect(addDaysLocalDateKey(-14, new Date(2026, 10, 9, 12, 0, 0))).toBe('2026-10-26');
    expect(addDaysLocalDateKey(7, new Date(2026, 10, 9, 12, 0, 0))).toBe('2026-11-16');
  });
});

describe('package-1 UTC-slice ratchet', () => {
  it('no toISOString date-key pattern remains in any package-1 file', () => {
    const offenders: string[] = [];
    for (const rel of PACKAGE_1_FILES) {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      const slices = text.match(SLICE_RE) || [];
      const splits = text.match(SPLIT_RE) || [];
      if (slices.length + splits.length > 0) {
        offenders.push(`${rel}: ${slices.length} slice + ${splits.length} split`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the tenant-zone helper is used where the zone is in scope (PDC cheques page)', () => {
    const text = fs.readFileSync(
      path.join(REPO_ROOT, 'frontend/src/features/accounting/pages/PdcChequesPage.tsx'),
      'utf8',
    );
    expect(text).toContain('todayTenantDateKey(');
    expect(text).toContain('addDaysTenantDateKey(');
  });
});
