/*
 * I5-D1: POS availability rule (INV-IMPORT-POS-ENTERPRISE-MODE).
 *
 * GROUNDING (live trial phase 2, problem 1): /pos on the trial tenant
 * ("اختبار سرعة 10K", operation mode "مؤسسة تجارية متقدمة (Enterprise
 * Trading)") renders the disabled state, and the sales register's
 * "فتح الكاشير" button links to that same disabled page.
 *
 * VERDICT — BY DESIGN, not a code defect:
 * - The /pos route exists (routes/definitions.tsx) and its guard only
 *   requires the 'sales' feature (app/router/access.ts); nothing 404s
 *   and no permission is wrongly denied.
 * - POS-off is decided by the tenant's industry vertical and the stored
 *   posModuleEnabled flag, NOT by the Enterprise mode toggle:
 *   enableEnterpriseFeatures is never consulted by PosPage or by the
 *   sidebar POS gate (app-shell.tsx). For a warehousing/wholesale/
 *   contracting/maritime vertical, SettingsMainForm forces
 *   enableEnterpriseFeatures=true AND posModuleEnabled=false at every
 *   save, so the mode and POS-off travel together downstream of the
 *   industry — switching the mode toggle to Simple Retail would NOT
 *   re-enable POS (PosPage gates on the vertical directly, and the
 *   next settings save re-forces posModuleEnabled=false).
 * - The real defects were in the UI: (1) the sales register offered
 *   "فتح الكاشير" as a live link to the disabled page — a dead end;
 *   (2) the /pos disabled state never named the current operation mode
 *   nor the working sale path (sales orders -> invoice, fixed by I3-D3).
 *
 * This module is the single source of truth for that rule: PosPage and
 * the sales register header both read it, so the page and the entry can
 * never disagree about whether POS is available.
 */
export type PosDisabledReason = 'module-off' | 'wholesale' | 'warehousing' | 'specialized';

export interface PosSettingsLike {
  businessIndustry?: string | null;
  activityType?: string | null;
  posModuleEnabled?: boolean;
  enableEnterpriseFeatures?: boolean;
}

export function getPosAvailability(
  settings: PosSettingsLike | null | undefined,
): { available: boolean; reason: PosDisabledReason | null } {
  const rawIndustry = String(settings?.businessIndustry || settings?.activityType || '').toLowerCase();
  const isWholesaleVertical =
    rawIndustry === 'wholesale_van' ||
    rawIndustry === 'wholesale' ||
    rawIndustry === 'distribution' ||
    rawIndustry === 'توزيع' ||
    rawIndustry === 'فان' ||
    rawIndustry === 'مناديب' ||
    rawIndustry.includes('توزيع') ||
    rawIndustry.includes('فان') ||
    rawIndustry.includes('wholesale');
  const isWarehousingVertical =
    rawIndustry === 'warehousing' ||
    rawIndustry === 'warehouse' ||
    rawIndustry === 'wms' ||
    rawIndustry.includes('مخازن') ||
    rawIndustry.includes('مستودع');
  const isNonRetailVertical =
    isWholesaleVertical ||
    isWarehousingVertical ||
    rawIndustry === 'contracting' ||
    rawIndustry === 'maritime' ||
    rawIndustry === 'services';
  // Reason precedence matches the disabled-state message order in PosPage.
  if (isWholesaleVertical) return { available: false, reason: 'wholesale' };
  if (isWarehousingVertical) return { available: false, reason: 'warehousing' };
  if (isNonRetailVertical) return { available: false, reason: 'specialized' };
  if (settings?.posModuleEnabled === false) return { available: false, reason: 'module-off' };
  return { available: true, reason: null };
}

export function isPosAvailable(settings: PosSettingsLike | null | undefined): boolean {
  return getPosAvailability(settings).available;
}
