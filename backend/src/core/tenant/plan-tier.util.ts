/**
 * Single source of truth on the backend for normalizing plan identifiers across
 * both the legacy 4-tier plans (plan_basic / plan_pro / plan_ultimate / plan_omnichannel)
 * and the 15 band×level plans (tier_band1_L1 .. tier_band5_L3 / BAND1_L1 .. BAND5_L3).
 */

export type PlanRank = 1 | 2 | 3 | 4;
export type CatalogLevelId = 'L1' | 'L2' | 'L3';

const LEGACY_RANK_MAP: Record<string, PlanRank> = {
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

const LEVEL_1_FEATURES = ['sales', 'catalog', 'sessions', 'cashDrawer'] as const;
const LEVEL_2_OPERATIONS = ['purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments'] as const;
const LEVEL_3_FINANCE_COMPLIANCE = ['accounting', 'fixed_assets', 'hr', 'taxIntegration', 'vat_declaration'] as const;

const LEGACY_PRO_FEATURES = [
  'sales',
  'catalog',
  'sessions',
  'cashDrawer',
  'purchases',
  'inventory',
  'reports',
] as const;
const LEGACY_ULTIMATE_CORE_FEATURES = [
  'sales',
  'catalog',
  'sessions',
  'cashDrawer',
  'purchases',
  'inventory',
  'reports',
  'hr',
  'deliveryReps',
  'loyalty',
  'maintenance',
  'clothing',
  'restaurant',
  'accounting',
  'fixed_assets',
  'installments',
  'taxIntegration',
  'vat_declaration',
  'manufacturing',
  'import',
  'pharmacy',
] as const;

const TIERED_PLAN_DISPLAY_NAMES: Record<string, string> = {
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

export function normalizePlanKey(planId?: string | null): string {
  return String(planId || '')
    .trim()
    .toLowerCase();
}

export function resolvePlanRank(planId?: string | null): PlanRank | null {
  const normalized = normalizePlanKey(planId);
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

export function resolveCatalogLevelId(codeOrPlanId?: string | null): CatalogLevelId | null {
  const normalized = normalizePlanKey(codeOrPlanId);
  if (!normalized) return null;
  if (['basic', 'plan_basic', 'starter', 'plan_starter', 'standard', '1'].includes(normalized)) {
    return 'L1';
  }
  if (['pro', 'plan_pro', '2'].includes(normalized)) {
    return 'L2';
  }
  if (
    [
      'ultimate',
      'plan_ultimate',
      'enterprise',
      'plan_enterprise',
      'omnichannel',
      'plan_omnichannel',
      '3',
      '4',
    ].includes(normalized)
  ) {
    return 'L3';
  }
  const match = normalized.match(TIERED_PLAN_PATTERN);
  if (match) {
    return `L${match[2]}` as CatalogLevelId;
  }
  return null;
}

export function isOmnichannelPlanId(planId?: string | null): boolean {
  return resolvePlanRank(planId) === 4;
}

export function isEnterpriseOrUltimatePlan(planId?: string | null): boolean {
  const rank = resolvePlanRank(planId);
  return rank === 3 || rank === 4;
}

export function resolvePlanDisplayName(planId?: string | null): string {
  const normalized = normalizePlanKey(planId);
  if (!normalized) return 'المتكاملة';

  if (['plan_omnichannel', 'omnichannel', '4'].includes(normalized)) return 'التجارة الشاملة';
  if (['plan_ultimate', 'ultimate', 'enterprise', 'plan_enterprise', '3'].includes(normalized)) return 'المتكاملة';
  if (['plan_pro', 'pro', '2'].includes(normalized)) return 'المتقدمة';
  if (['plan_basic', 'basic', 'plan_starter', 'starter', '1'].includes(normalized)) return 'الأساسية';

  const match = normalized.match(TIERED_PLAN_PATTERN);
  if (match) {
    const key = `band${match[1]}_l${match[2]}`;
    if (TIERED_PLAN_DISPLAY_NAMES[key]) return TIERED_PLAN_DISPLAY_NAMES[key];
  }

  return 'المتكاملة';
}

export function getFallbackPlanFeatures(
  planId?: string | null,
  options: { includeServicesOnPro?: boolean; includeBand5MarkersOnUltimate?: boolean } = {},
): string[] {
  const normalized = normalizePlanKey(planId);
  if (!normalized) return [];

  const { includeServicesOnPro = false, includeBand5MarkersOnUltimate = true } = options;

  if (['plan_basic', 'basic', 'plan_starter', 'starter', '1'].includes(normalized)) {
    return [...LEVEL_1_FEATURES];
  }

  if (['plan_pro', 'pro', '2'].includes(normalized)) {
    return includeServicesOnPro ? [...LEGACY_PRO_FEATURES, 'services'] : [...LEGACY_PRO_FEATURES];
  }

  if (['plan_ultimate', 'ultimate', 'enterprise', 'plan_enterprise', '3'].includes(normalized)) {
    const base = [...LEGACY_ULTIMATE_CORE_FEATURES];
    if (includeServicesOnPro) base.push('services' as never);
    if (includeBand5MarkersOnUltimate) base.push('maritime_freight' as never, 'contracting' as never);
    return base;
  }

  if (['plan_omnichannel', 'omnichannel', '4'].includes(normalized)) {
    const base = [...LEGACY_ULTIMATE_CORE_FEATURES, 'storefront'];
    if (includeServicesOnPro) base.push('services' as never);
    if (includeBand5MarkersOnUltimate) base.push('maritime_freight' as never, 'contracting' as never);
    return base;
  }

  const match = normalized.match(TIERED_PLAN_PATTERN);
  if (match) {
    const level = Number(match[2]);
    if (level === 1) return [...LEVEL_1_FEATURES];
    if (level === 2) return [...LEVEL_1_FEATURES, ...LEVEL_2_OPERATIONS];
    if (level === 3) return [...LEVEL_1_FEATURES, ...LEVEL_2_OPERATIONS, ...LEVEL_3_FINANCE_COMPLIANCE];
  }

  return [];
}
