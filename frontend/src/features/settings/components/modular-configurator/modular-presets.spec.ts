/*
New file: frontend/src/features/settings/components/modular-configurator/modular-presets.spec.ts
Pins the variants module rename and the retail-preset unblock (package C).

THE GAP: the variants module (clothingModuleEnabled) was named as a
clothing-only matrix and was forced OFF by the disabledModules of every
retail-trade preset, so a retail tenant applying its own preset lost the
module even though variants (colours and sizes) describe any product.

THE RULE: the module is now "الأصناف المتغيرة (ألوان ومقاسات)" on the
Ultimate tier, and no goods-selling preset forces it off. Service and
project verticals (contracting, maritime, restaurant, manufacturing,
services) keep it in disabledModules as their curated default — a tenant
there can still enable it by hand. Fashion, clothing and perfumes keep
recommending it as before.

WHAT THIS PINS, driving the REAL modular-presets data:
- The SYSTEM_MODULES entry is renamed and stays on plan_ultimate.
- Every goods-selling preset (retail, warehousing, wholesale,
  supermarket, appliances_installments, electronics, pharmacy,
  import_export) no longer lists clothingModuleEnabled in
  disabledModules, and does not recommend it either (off by default,
  enableable by hand).
- Fashion, clothing and perfumes still list it in recommendedModules.
- Contracting, maritime, restaurant, manufacturing and services still
  list it in disabledModules.
- Ecommerce, spices and custom never listed it either way.
*/

import { describe, expect, it } from 'vitest';
import {
  INDUSTRY_PRESETS,
  SYSTEM_MODULES,
  type IndustryPresetId,
} from '@/features/settings/components/modular-configurator/modular-presets';

type VariantsStatus = 'disabled' | 'recommended' | 'neither';

/* Per-preset enumeration, decided on whether the preset sells physical
   goods (variants describe the goods) or is a service/project vertical
   (variants are not part of its curated default). */
const EXPECTED_VARIANTS_STATUS: Record<IndustryPresetId, VariantsStatus> = {
  retail: 'neither',
  warehousing: 'neither',
  wholesale: 'neither',
  supermarket: 'neither',
  appliances_installments: 'neither',
  electronics: 'neither',
  pharmacy: 'neither',
  import_export: 'neither',
  fashion: 'recommended',
  clothing: 'recommended',
  perfumes: 'recommended',
  contracting: 'disabled',
  maritime: 'disabled',
  restaurant: 'disabled',
  manufacturing: 'disabled',
  services: 'disabled',
  ecommerce: 'neither',
  spices: 'neither',
  custom: 'neither',
};

describe('modular-presets variants module (package C)', () => {
  it('renames the variants module and keeps it on the Ultimate tier', () => {
    const variants = SYSTEM_MODULES.find((mod) => mod.key === 'clothingModuleEnabled');
    expect(variants).toBeDefined();
    expect(variants?.title).toBe('الأصناف المتغيرة (ألوان ومقاسات)');
    expect(variants?.requiredPlan).toBe('plan_ultimate');
  });

  it.each(Object.entries(EXPECTED_VARIANTS_STATUS))(
    'preset %s lists variants as %s',
    (presetId, expected) => {
      const preset = INDUSTRY_PRESETS[presetId as IndustryPresetId];
      expect(preset).toBeDefined();
      const isDisabled = preset.disabledModules.includes('clothingModuleEnabled');
      const isRecommended = preset.recommendedModules.includes('clothingModuleEnabled');
      if (expected === 'disabled') {
        expect(isDisabled).toBe(true);
        expect(isRecommended).toBe(false);
      } else if (expected === 'recommended') {
        expect(isRecommended).toBe(true);
        expect(isDisabled).toBe(false);
      } else {
        expect(isDisabled).toBe(false);
        expect(isRecommended).toBe(false);
      }
    },
  );

  it('covers every industry preset in the enumeration', () => {
    expect(Object.keys(EXPECTED_VARIANTS_STATUS).sort()).toEqual(
      Object.keys(INDUSTRY_PRESETS).sort(),
    );
  });

  it('never forces weightedBarcodeEnabled off in any preset or locks it behind posModuleEnabled', () => {
    const scaleMod = SYSTEM_MODULES.find((mod) => mod.key === 'weightedBarcodeEnabled');
    expect(scaleMod).toBeDefined();
    expect(scaleMod?.dependencies || []).toEqual([]);
    for (const preset of Object.values(INDUSTRY_PRESETS)) {
      expect(preset.disabledModules).not.toContain('weightedBarcodeEnabled');
    }
  });
});
