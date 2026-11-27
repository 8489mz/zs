export function normalizeUnitName(rawUnit?: string): string {
  const trimmed = String(rawUnit || '').trim();
  if (!trimmed) return 'قطعة';

  const lower = trimmed.toLowerCase().replace(/\s+/g, ' ');

  // Keep kg and g in English as short abbreviations.
  // SPICE-PKG3 (b): cover every weighed spelling the catalog
  // actually uses — 'كيلو جرام' (spaced) and 'كيلوغرام' /
  // 'kilo' / 'kilogram' (manufacturing unit aliases) and 'جم'
  // (van-services weight regex) were all returned raw before,
  // so a tile/search add of those products never counted as weighed.
  if (lower === 'kg' || lower === 'كجم' || lower === 'كيلو' || lower === 'كيلوجرام' || lower === 'كيلوغرام' || lower === 'كيلو جرام' || lower === 'kilo' || lower === 'kilogram' || lower === 'kilograms') return 'kg';
  if (lower === 'g' || lower === 'gm' || lower === 'gram' || lower === 'grams' || lower === 'جرام' || lower === 'جم') return 'g';

  // English words to Arabic & normalizations
  if (['piece', 'pieces', 'pcs', 'pc', 'item', 'items', 'unit', 'units', 'قطعه', 'حبة', 'حبه'].includes(lower)) return 'قطعة';
  if (['box', 'boxes', 'carton', 'cartons', 'كرتونه'].includes(lower)) return 'كرتونة';
  if (['packet', 'pack', 'packs'].includes(lower)) return 'باكت';
  if (['bottle', 'bottles'].includes(lower)) return 'زجاجة';
  if (['can', 'cans'].includes(lower)) return 'علبة';
  if (['liter', 'liters', 'ltr', 'l'].includes(lower)) return 'لتر';
  if (['meter', 'meters', 'm'].includes(lower)) return 'متر';
  if (['service', 'services', 'خدمه'].includes(lower)) return 'خدمة';

  return trimmed;
}
