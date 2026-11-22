/*
 * toISOString date-key sweep, package 2 (modules) — INV-TOISO-DATE-SWEEP-MODULES.
 *
 * Ratchets the package-2 file list (HR, contracting, maritime, import-sales,
 * products): no `toISOString().slice(0, 10)` / `toISOString().split('T')[0]`
 * may remain in any listed production file, and no `toISOString().slice(2, 10)`
 * document-number date may remain either. The helper behaviour itself is
 * pinned by toiso-sweep-core.spec.ts (package 1); this spec pins the two
 * package-2 shapes that differ from a plain today-default: the YYMMDD
 * document-number date and the warranty end date derived from a calendar day.
 *
 * Kept sites are NOT in this list: the 14 display-only export-filename /
 * prose-note sites and the bank-statement serial site stay, and are ratcheted
 * by toiso-sweep-remainder.spec.ts (package 3).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { addDaysLocalDateKey, todayLocalDateKey, todayTenantDateKey } from './format';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SLICE_RE = /toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/g;
const SPLIT_RE = /toISOString\(\)\s*\.split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]/g;
const DOCNUM_RE = /toISOString\(\)\s*\.slice\(\s*2\s*,\s*10\s*\)/g;

/* Package-2 production files. */
const PACKAGE_2_FILES = [
  'frontend/src/features/hr/components/payroll/CreatePayrollRunModal.tsx',
  'frontend/src/features/hr/pages/EmployeeProfilePage.tsx',
  'frontend/src/features/hr/pages/HrComingSoonPage.tsx',
  'frontend/src/features/hr/pages/HrEndOfServicePage.tsx',
  'frontend/src/features/hr/pages/assets/hr-assets.helpers.ts',
  'frontend/src/features/hr/pages/leaves/hr-leaves.helpers.ts',
  'frontend/src/features/hr/pages/loans/hr-loans.helpers.ts',
  'frontend/src/features/hr/pages/reports/hr-reports.helpers.ts',
  'frontend/src/shared/layout/quick-attendance-shortcut.tsx',
  'frontend/src/features/contracting/components/AwardTenderModal.tsx',
  'frontend/src/features/contracting/components/CreateDailyLogModal.tsx',
  'frontend/src/features/contracting/components/CreateGuaranteeModal.tsx',
  'frontend/src/features/contracting/components/CreateMaterialRequisitionModal.tsx',
  'frontend/src/features/contracting/components/CreateRfiModal.tsx',
  'frontend/src/features/contracting/components/CreateScheduleTaskModal.tsx',
  'frontend/src/features/contracting/components/EquipmentFuelLogsModal.tsx',
  'frontend/src/features/contracting/components/FieldIndirectCostModal.tsx',
  'frontend/src/features/contracting/components/GuaranteesDirectoryModal.tsx',
  'frontend/src/features/contracting/components/LaborAttendanceModal.tsx',
  'frontend/src/features/contracting/components/MaterialSubmittalsModal.tsx',
  'frontend/src/features/contracting/components/MeetingMinutesModal.tsx',
  'frontend/src/features/contracting/components/PettyCashModal.tsx',
  'frontend/src/features/contracting/components/ProjectHandoverModal.tsx',
  'frontend/src/features/contracting/components/RecordSubcontractorPaymentModal.tsx',
  'frontend/src/features/contracting/components/ScheduleGeneratorModal.tsx',
  'frontend/src/features/contracting/components/SiteMobilizationModal.tsx',
  'frontend/src/features/contracting/components/SnagListModal.tsx',
  'frontend/src/features/contracting/components/SubcontractorBackChargesModal.tsx',
  'frontend/src/features/contracting/components/SupplierReturnsModal.tsx',
  'frontend/src/features/contracting/components/SuppliersDirectoryModal.tsx',
  'frontend/src/features/contracting/components/WorkInspectionModal.tsx',
  'frontend/src/features/import-sales/ChinaSourcingPage.tsx',
  'frontend/src/features/import-sales/ContainerDepositsManager.tsx',
  'frontend/src/features/import-sales/PartnerLedgerComponents.tsx',
  'frontend/src/features/import-sales/ProfitPool.tsx',
  'frontend/src/features/import-sales/api/shipments.api.ts',
  'frontend/src/features/import-sales/api/shipments/shipments-approvals-fx.ts',
  'frontend/src/features/import-sales/api/shipments/shipments-brokers.ts',
  'frontend/src/features/import-sales/api/shipments/shipments-containers-samples.ts',
  'frontend/src/features/import-sales/api/shipments/shipments-core.ts',
  'frontend/src/features/import-sales/api/shipments/shipments-partners.ts',
  'frontend/src/features/import-sales/api/shipments/shipments-profit-flow.ts',
  'frontend/src/features/import-sales/api/shipments/shipments-proforma-quotations.ts',
  'frontend/src/features/import-sales/api/shipments/shipments-projects.ts',
  'frontend/src/features/import-sales/api/shipments/shipments-receipts-items.ts',
  'frontend/src/features/import-sales/api/shipments/shipments-receiving-late-expense.ts',
  'frontend/src/features/import-sales/api/shipments/shipments-suppliers-customs.ts',
  'frontend/src/features/import-sales/CustomsBrokerManager.tsx',
  'frontend/src/features/maritime-freight/components/ContainerReturnModal.tsx',
  'frontend/src/features/maritime-freight/components/JobDetailsModal.tsx',
  'frontend/src/features/maritime-freight/utils/maritime-documents.ts',
  'frontend/src/features/products/components/BarcodeFoodStatementSection.tsx',
  'frontend/src/features/products/components/BarcodePrintDialog.tsx',
];

describe('package-2 document-number and derived dates', () => {
  it('a YYMMDD document number keys the local day, not the previous UTC day', () => {
    // 00:03 in Cairo is still 22:03 UTC on the previous day, so the old
    // UTC-slice expression numbers a contract/advance 261108 — the wrong
    // business day. Both assertions are runner-TZ independent: the UTC
    // slice is always UTC, and the local-parts key of a locally built
    // Nov 9 date is always 261109.
    const cairoInstant = new Date('2026-11-09T00:03:00+02:00');
    expect(cairoInstant.toISOString().slice(2, 10).replace(/-/g, '')).toBe('261108');
    expect(todayTenantDateKey('Africa/Cairo', cairoInstant).slice(2).replace(/-/g, '')).toBe('261109');
    expect(todayLocalDateKey(new Date(2026, 10, 9, 0, 3, 0)).slice(2).replace(/-/g, '')).toBe('261109');
  });

  it('a warranty end date derived from a calendar day keeps that day', () => {
    const handover = new Date(2026, 10, 9, 0, 0, 0);
    const end = new Date(handover);
    end.setMonth(end.getMonth() + 12);
    expect(todayLocalDateKey(end)).toBe('2027-11-09');
  });

  it('a +365-day guarantee expiry counts calendar days', () => {
    expect(addDaysLocalDateKey(365, new Date(2026, 10, 9, 12, 0, 0))).toBe('2027-11-09');
  });
});

describe('package-2 UTC-slice ratchet', () => {
  it('no toISOString date-key pattern remains in any package-2 file', () => {
    // The package-3 addDays line in ScheduleGeneratorModal was allowed
    // here (1) until package 3 fixed it; the allowance is now 0 and the
    // whole-tree ratchet in toiso-sweep-remainder.spec.ts is the authority.
    const allowed: Record<string, number> = {};
    const offenders: string[] = [];
    for (const rel of PACKAGE_2_FILES) {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      const slices = text.match(SLICE_RE) || [];
      const splits = text.match(SPLIT_RE) || [];
      const docnums = text.match(DOCNUM_RE) || [];
      const total = slices.length + splits.length + docnums.length;
      const want = allowed[rel] || 0;
      if (total !== want) {
        offenders.push(`${rel}: ${total} patterns, want ${want}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the document numbers now derive from the local-parts key', () => {
    for (const rel of [
      'frontend/src/features/contracting/components/AwardTenderModal.tsx',
      'frontend/src/features/import-sales/CustomsBrokerManager.tsx',
    ]) {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      expect(text).toContain('todayLocalDateKey().slice(2)');
    }
  });
});
