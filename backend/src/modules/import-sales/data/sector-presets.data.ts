/**
 * Sector presets for import projects (INV-IMPORT-SECTOR-PRESET).
 *
 * A preset is a DATA choice the user makes per project — never a
 * hardcoded branch in the generic flow. The first preset is truck
 * spare parts, the importer's first sector; a project with no
 * preset behaves generically with no silent defaults (no invented
 * category, barcode, OEM number or markup). Adding a sector means
 * adding one entry here, never touching the import flow.
 */
export interface SectorPreset {
  /** Stable key stored on import_projects.sector_preset. */
  key: string;
  nameAr: string;
  nameEn: string;
  /** Category created for new products under this preset only. */
  categoryName: string;
  defaultBrand: string;
  defaultModel: string;
  defaultYearFrom: number;
  defaultYearTo: number;
  defaultOrigin: string;
  /** Markups applied to the estimated cost of NEW products only. */
  retailMarkup: number;
  wholesaleMarkup: number;
  /** Known item names to OEM numbers for this sector. */
  oemMap: Record<string, string>;
}

export const SECTOR_PRESETS: SectorPreset[] = [
  {
    key: 'truck_parts',
    nameAr: 'قطع غيار سيارات النقل الثقيل',
    nameEn: 'Truck Spare Parts',
    categoryName: 'قطع غيار شاحنات ونقل ثقيل',
    defaultBrand: 'شاحنات نقل ثقيل (HOWO / Shacman / Weichai)',
    defaultModel: 'ديزل تجاري',
    defaultYearFrom: 2018,
    defaultYearTo: 2026,
    defaultOrigin: 'الصين',
    retailMarkup: 1.35,
    wholesaleMarkup: 1.2,
    oemMap: {
      'طقم تيل فرامل وبطانات مكابح شاحنات وتريلات ثقيلة': 'WG9100440030',
      'طقم بستم وشنابر محرك ديزل 6 سلندر شاحنات نقل ثقيل': 'VG1560030010',
      'طقم دبرياج كامل (ديسك + اسطوانة + بلية) شاحنات نقل ثقيل': 'WG9114160010',
      'شواحن توربينية (تيربو) لمحركات شاحنات النقل الثقيل والديزل': 'VG1560118227',
      'فلاتر زيت وفلاتر وقود ديزل (جاز) لشاحنات وسيارات النقل': 'VG61000070005',
      'إطارات هوائية سلك جديدة للشاحنات والمقطورات (315/80R22.5 و 295/80R22.5)': 'TYR-31580R225',
      'سوست ورقية مصفحة متعددة الطبقات (ستست ورق وحديد شاحنات ومقطورات)': 'AZ9725520278',
      'محركات ديزل جديدة كاملة مخصصة لسيارات النقل والشاحنات التجارية': 'WD615.47-ENG',
      'فوانيس أمامية وخلفية وكشافات ضباب ولمبات إشارة للشاحنات والتريلات': 'WG9719720001',
      'مولدات كهرباء وشحن بطاريات (دينامو شاحنات 24V و 12V)': 'VG1560090012',
      'مواتير بادئ الحركة (مارش شاحنات ديزل 24V و 12V)': 'VG1560090001',
    },
  },
];

/**
 * Returns the preset for a stored key, or null when the project
 * has no preset (generic behaviour). An unknown non-empty key
 * also returns null — callers fail closed with
 * [IMPORT_UNKNOWN_SECTOR_PRESET] instead of guessing.
 */
export function resolveSectorPreset(key: string | null | undefined): SectorPreset | null {
  if (!key || !String(key).trim()) return null;
  return SECTOR_PRESETS.find((p) => p.key === String(key).trim()) ?? null;
}
