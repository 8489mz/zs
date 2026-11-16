import { getSystemVertical } from './vertical-catalog';

export type FrontendPlanRank = 1 | 2 | 3 | 4;
export type FrontendCatalogLevelId = 'L1' | 'L2' | 'L3';

const LEGACY_RANK_MAP: Record<string, FrontendPlanRank> = {
  '1': 1,
  basic: 1,
  plan_basic: 1,
  starter: 1,
  plan_starter: 1,
  standard: 1,
  '2': 2,
  pro: 2,
  plan_pro: 2,
  '3': 3,
  ultimate: 3,
  plan_ultimate: 3,
  enterprise: 3,
  plan_enterprise: 3,
  '4': 4,
  omnichannel: 4,
  plan_omnichannel: 4,
};

const TIERED_PLAN_PATTERN = /^(?:tier_)?band([1-5])_l([123])$/i;

const TIERED_PLAN_NAMES_AR: Record<string, string> = {
  band1_l1: 'تجزئة عامة — محل',
  band1_l2: 'تجزئة عامة — متعدد الفروع',
  band1_l3: 'تجزئة عامة — سلسلة ومؤسسة',
  band2_l1: 'معارض عالية القيمة — محل/معرض',
  band2_l2: 'معارض عالية القيمة — متعدد الفروع',
  band2_l3: 'معارض عالية القيمة — سلسلة ومؤسسة',
  band3_l1: 'مطاعم وكافيهات — فرع واحد',
  band3_l2: 'مطاعم وكافيهات — ثلاثة فروع',
  band3_l3: 'مطاعم وكافيهات — سلسلة',
  band4_l1: 'الشركات — أساسي',
  band4_l2: 'الشركات — شركة',
  band4_l3: 'الشركات — مؤسسة',
  band5_l1: 'القطاعات المؤسسية والشحن — مكتب',
  band5_l2: 'القطاعات المؤسسية والشحن — شركة',
  band5_l3: 'القطاعات المؤسسية والشحن — مؤسسة',
};

const TIERED_PLAN_NAMES_EN: Record<string, string> = {
  band1_l1: 'Retail — Single Store (Level 1)',
  band1_l2: 'Retail — Multi-Branch (Level 2)',
  band1_l3: 'Retail — Chain & Enterprise (Level 3)',
  band2_l1: 'Showrooms — Single Store (Level 1)',
  band2_l2: 'Showrooms — Multi-Branch (Level 2)',
  band2_l3: 'Showrooms — Chain & Enterprise (Level 3)',
  band3_l1: 'Restaurants — Single Branch (Level 1)',
  band3_l2: 'Restaurants — Three Branches (Level 2)',
  band3_l3: 'Restaurants — Chain (Level 3)',
  band4_l1: 'Corporate — Starter (Level 1)',
  band4_l2: 'Corporate — Business (Level 2)',
  band4_l3: 'Corporate — Enterprise (Level 3)',
  band5_l1: 'Enterprise Sectors — Office (Level 1)',
  band5_l2: 'Enterprise Sectors — Company (Level 2)',
  band5_l3: 'Enterprise Sectors — Institution (Level 3)',
};

export function normalizeFrontendPlanKey(planId?: string | null): string {
  return String(planId || '').trim().toLowerCase();
}

export function isTieredBandPlan(planId?: string | null): boolean {
  return TIERED_PLAN_PATTERN.test(normalizeFrontendPlanKey(planId));
}

export function resolveFrontendPlanRank(planId?: string | null): FrontendPlanRank | null {
  const normalized = normalizeFrontendPlanKey(planId);
  if (!normalized) return null;
  if (normalized in LEGACY_RANK_MAP) {
    return LEGACY_RANK_MAP[normalized];
  }
  const match = normalized.match(TIERED_PLAN_PATTERN);
  if (match) {
    const level = Number(match[2]);
    if (level === 1 || level === 2 || level === 3) return level;
  }
  return null;
}

export function resolveFrontendCatalogLevel(codeOrPlanId?: string | null): FrontendCatalogLevelId | null {
  const normalized = normalizeFrontendPlanKey(codeOrPlanId);
  if (!normalized) return null;
  if (['basic', 'plan_basic', 'starter', 'plan_starter', 'standard', '1'].includes(normalized)) {
    return 'L1';
  }
  if (['pro', 'plan_pro', '2'].includes(normalized)) {
    return 'L2';
  }
  if (['ultimate', 'plan_ultimate', 'enterprise', 'plan_enterprise', 'omnichannel', 'plan_omnichannel', '3', '4'].includes(normalized)) {
    return 'L3';
  }
  const match = normalized.match(TIERED_PLAN_PATTERN);
  if (match) {
    return `L${match[2]}` as FrontendCatalogLevelId;
  }
  return null;
}

export function resolveFrontendPlanDisplayName(planId?: string | null, isEn = false): string | null {
  const normalized = normalizeFrontendPlanKey(planId);
  if (!normalized) return null;

  if (['plan_basic', 'basic', 'plan_starter', 'starter', 'standard', '1'].includes(normalized)) {
    return isEn ? 'Basic Plan' : 'الباقة الأساسية';
  }
  if (['plan_pro', 'pro', '2'].includes(normalized)) {
    return isEn ? 'Pro Enterprise Plan' : 'باقة النمو (الاحترافية)';
  }
  if (['plan_ultimate', 'ultimate', 'enterprise', 'plan_enterprise', '3'].includes(normalized)) {
    return isEn ? 'Ultimate Enterprise Plan' : 'الباقة المتكاملة (Ultimate ERP)';
  }
  if (['plan_omnichannel', 'omnichannel', '4'].includes(normalized)) {
    return isEn ? 'Omnichannel Enterprise Plan' : 'باقة التجارة الشاملة (Omnichannel)';
  }

  const match = normalized.match(TIERED_PLAN_PATTERN);
  if (match) {
    const key = `band${match[1]}_l${match[2]}`;
    return isEn ? (TIERED_PLAN_NAMES_EN[key] || null) : (TIERED_PLAN_NAMES_AR[key] || null);
  }

  return null;
}

export function resolveBandForVertical(verticalKey?: string | null): 1 | 2 | 3 | 4 | 5 {
  return getSystemVertical(verticalKey).band;
}
