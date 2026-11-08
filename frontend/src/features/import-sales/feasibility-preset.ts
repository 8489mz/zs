/*
 * I2-P8: truck-parts feasibility preset.
 *
 * A new feasibility study starts EMPTY — no forced rows, no forced
 * costs. The truck-parts bundle below is offered as a selectable
 * preset, never pre-loaded: it is the exact 5 library rows and the
 * exact cost values the form used to force on every new study
 * (goods $38,050; freight $3,500; clearance 48,000 EGP; travel
 * 15,000 EGP). Nothing here is invented; the preset only re-homes
 * the old hardcoded initial state so the user picks it explicitly.
 * buildTruckPartsPreset() returns fresh copies on every call so the
 * caller can mutate the returned rows as form state.
 */

export type FeasibilityPresetItem = {
  name: string;
  hsCode: string;
  qty: number;
  factoryPriceUsd: number;
  unitWeightKg?: number;
  unitCbm?: number;
  expectedLocalMarketPriceEgp?: number;
};

export const TRUCK_PARTS_PRESET_ITEMS: ReadonlyArray<FeasibilityPresetItem> = [
  {
    name: 'طقم تيل فرامل وبطانات مكابح شاحنات وتريلات ثقيلة',
    hsCode: '8708.30.10',
    qty: 600,
    factoryPriceUsd: 14.5,
    unitWeightKg: 4.8,
    unitCbm: 0.008,
    expectedLocalMarketPriceEgp: 1350,
  },
  {
    name: 'طقم بستم وشنابر محرك ديزل 6 سلندر شاحنات نقل ثقيل',
    hsCode: '8409.99.10',
    qty: 250,
    factoryPriceUsd: 42,
    unitWeightKg: 12.5,
    unitCbm: 0.024,
    expectedLocalMarketPriceEgp: 3600,
  },
  {
    name: 'طقم دبرياج كامل (ديسك + اسطوانة + بلية) شاحنات نقل ثقيل',
    hsCode: '8708.93.10',
    qty: 120,
    factoryPriceUsd: 95,
    unitWeightKg: 32,
    unitCbm: 0.045,
    expectedLocalMarketPriceEgp: 8200,
  },
  {
    name: 'شواحن توربينية (تيربو) لمحركات شاحنات النقل الثقيل والديزل',
    hsCode: '8414.80.10',
    qty: 60,
    factoryPriceUsd: 95,
    unitWeightKg: 9.5,
    unitCbm: 0.018,
    expectedLocalMarketPriceEgp: 10500,
  },
  {
    name: 'فلاتر زيت وفلاتر وقود ديزل (جاز) لشاحنات وسيارات النقل',
    hsCode: '8421.23.10',
    qty: 500,
    factoryPriceUsd: 3.5,
    unitWeightKg: 0.85,
    unitCbm: 0.003,
    expectedLocalMarketPriceEgp: 360,
  },
];

export type FeasibilityPresetCosts = {
  shippingUsd: number;
  insuranceUsd: number;
  clearanceEgp: number;
  transportEgp: number;
  travelEgp: number;
};

/* The cost values the form used to force on every new study. */
export const TRUCK_PARTS_PRESET_COSTS: FeasibilityPresetCosts = {
  shippingUsd: 3500,
  insuranceUsd: 200,
  clearanceEgp: 48000,
  transportEgp: 12000,
  travelEgp: 15000,
};

/* A fresh study starts with no costs assumed. */
export const EMPTY_FEASIBILITY_COSTS: FeasibilityPresetCosts = {
  shippingUsd: 0,
  insuranceUsd: 0,
  clearanceEgp: 0,
  transportEgp: 0,
  travelEgp: 0,
};

export function buildTruckPartsPreset(): { items: FeasibilityPresetItem[]; costs: FeasibilityPresetCosts } {
  return {
    items: TRUCK_PARTS_PRESET_ITEMS.map((it) => ({ ...it })),
    costs: { ...TRUCK_PARTS_PRESET_COSTS },
  };
}
