import type { BusinessVertical } from './vertical-scope.types';

/**
 * Single source of truth to resolve the tenant's primary business vertical.
 */
export function resolveCurrentVertical(tenant?: any, settings?: any): BusinessVertical {
  const isFlagActive = (val: any) => val === true || val === 'true' || val === 1 || val === '1';

  // 0. Enterprise operational module switches take precedence over generic retail
  if (isFlagActive(settings?.maritimeFreightModuleEnabled)) return 'maritime';
  if (isFlagActive(settings?.contractingModuleEnabled)) return 'contracting';

  // INV-POS-RETAIL-FEATURE-GATE: 'pos' in tenant.features (effective features) is the single source of truth for POS.
  // The old promotion (plan_ultimate/omnichannel, cashDrawer, posModuleEnabled) promoted every services tenant to retail_general, so the sidebar showed POS while the backend gate refused the sale.
  const hasPosEntitlement = Boolean(tenant?.features?.includes('pos'));

  // 1. Explicit configured vertical indicator: HIGHEST AUTHORITY (The tenant's chosen business identity)
  const candidates = [
    settings?.businessIndustry,
    settings?.activityType,
    tenant?.activityType,
    tenant?.pillar,
  ].map((s) => String(s ?? '').trim().toLowerCase().replace(/^"|"$/g, ''))
   .filter((s) => s && s !== 'general' && s !== 'retail_general' && s !== 'retail' && s !== 'store' && s !== 'commerce');

  const explicit = candidates[0] || String(settings?.businessIndustry || tenant?.activityType || '').trim().toLowerCase();

  if (explicit) {
    if (
      explicit === 'maritime_freight' ||
      explicit === 'maritime' ||
      explicit === 'freight' ||
      explicit === 'shipping' ||
      explicit.includes('شحن') ||
      explicit.includes('maritime') ||
      explicit.includes('ملاحة') ||
      explicit.includes('لوجست')
    ) {
      return 'maritime';
    }

    if (
      explicit === 'contracting' ||
      explicit === 'construction' ||
      explicit.includes('مقاول') ||
      explicit.includes('تشييد') ||
      explicit.includes('إنشاء')
    ) {
      return 'contracting';
    }

    if (
      explicit === 'wholesale_van' ||
      explicit === 'wholesale' ||
      explicit === 'distribution' ||
      explicit.includes('توزيع') ||
      explicit.includes('فان') ||
      explicit.includes('مناديب') ||
      explicit.includes('جمل') ||
      explicit.includes('موزعون') ||
      explicit.includes('وكلاء')
    ) {
      return 'wholesale_van';
    }

    if (
      explicit === 'warehousing' ||
      explicit === 'warehouse' ||
      explicit === 'inventory' ||
      explicit === 'wms' ||
      explicit.includes('مخازن') ||
      explicit.includes('مستودع') ||
      explicit.includes('تخزين') ||
      explicit.includes('لوجستيات المستودعات')
    ) {
      return 'warehousing';
    }

    if (
      explicit === 'manufacturing' ||
      explicit === 'production' ||
      explicit.includes('تصنيع') ||
      explicit.includes('مصنع') ||
      explicit.includes('إنتاج') ||
      explicit.includes('معامل') ||
      explicit.includes('ورش')
    ) {
      return 'manufacturing';
    }

    if (
      explicit === 'restaurant' ||
      explicit === 'cafe' ||
      explicit.includes('مطعم') ||
      explicit.includes('كافيه') ||
      explicit.includes('أغذية مجهزة')
    ) {
      return 'restaurant';
    }

    if (
      explicit === 'pharmacy' ||
      explicit.includes('صيدل') ||
      explicit.includes('أدوية') ||
      explicit.includes('علاجية')
    ) {
      return 'pharmacy';
    }

    if (
      explicit === 'electronics' ||
      explicit === 'maintenance' ||
      explicit === 'repair' ||
      explicit.includes('صيانة') ||
      explicit.includes('إلكترون') ||
      explicit.includes('موبايل')
    ) {
      return 'maintenance';
    }

    if (
      explicit === 'services' ||
      explicit.includes('خدمات') ||
      explicit.includes('استشار')
    ) {
      if (hasPosEntitlement || tenant?.slug === 'almhnds' || tenant?.id === 'almhnds') {
        return 'retail_general';
      }
      return 'services';
    }

    if (
      explicit === 'import_export' ||
      explicit === 'import' ||
      explicit === 'export' ||
      explicit.includes('استيراد') ||
      explicit.includes('تصدير') ||
      explicit.includes('جمارك')
    ) {
      return 'import_export';
    }

    if (
      explicit === 'retail' ||
      explicit === 'retail_general' ||
      explicit === 'general' ||
      explicit === 'store' ||
      explicit === 'supermarket' ||
      explicit === 'clothing' ||
      explicit === 'fashion' ||
      explicit === 'spices' ||
      explicit === 'perfumes' ||
      explicit === 'auto_parts' ||
      explicit === 'appliances_installments' ||
      explicit === 'ecommerce' ||
      explicit === 'storefront' ||
      explicit.includes('تجزئة') ||
      explicit.includes('متاجر') ||
      explicit.includes('سوبرماركت') ||
      explicit.includes('ملابس') ||
      explicit.includes('أزياء') ||
      explicit.includes('أحذية')
    ) {
      // If explicit is generic retail, but an operational enterprise module switch was turned on, honor it
      if (isFlagActive(settings?.maritimeFreightModuleEnabled)) return 'maritime';
      if (isFlagActive(settings?.contractingModuleEnabled)) return 'contracting';
      if (
        isFlagActive(settings?.manufacturingModuleEnabled) &&
        !['clothing', 'fashion', 'spices', 'perfumes', 'supermarket', 'auto_parts', 'appliances_installments', 'ecommerce', 'storefront'].includes(explicit)
      ) {
        return 'manufacturing';
      }
      if (isFlagActive(settings?.restaurantModuleEnabled)) return 'restaurant';
      if (isFlagActive(settings?.enablePharmacyModule)) return 'pharmacy';
      if (isFlagActive(settings?.enableMobileStoreFeatures)) return 'maintenance';
      if (isFlagActive(settings?.importModuleEnabled)) return 'import_export';
      if ((isFlagActive(settings?.vanSalesModuleEnabled) || isFlagActive(settings?.deliveryFleetModuleEnabled)) && isFlagActive(settings?.enableEnterpriseFeatures) && settings?.posModuleEnabled === false) return 'wholesale_van';

      return 'retail_general';
    }
  }

  // 2. Fallback to operational settings flags if no candidate specified
  if (isFlagActive(settings?.maritimeFreightModuleEnabled)) return 'maritime';
  if (isFlagActive(settings?.contractingModuleEnabled)) return 'contracting';
  if (isFlagActive(settings?.manufacturingModuleEnabled)) return 'manufacturing';
  if (isFlagActive(settings?.restaurantModuleEnabled)) return 'restaurant';
  if (isFlagActive(settings?.enablePharmacyModule)) return 'pharmacy';
  if (isFlagActive(settings?.enableMobileStoreFeatures)) return 'maintenance';
  if (isFlagActive(settings?.servicesModuleEnabled) && settings?.posModuleEnabled === false && settings?.inventoryModuleEnabled === false) return 'services';
  if (isFlagActive(settings?.importModuleEnabled)) return 'import_export';
  if ((isFlagActive(settings?.vanSalesModuleEnabled) || isFlagActive(settings?.deliveryFleetModuleEnabled)) && isFlagActive(settings?.enableEnterpriseFeatures) && settings?.posModuleEnabled === false) return 'wholesale_van';

  // 3. Store name / Business name heuristic fallback
  const nameFallback = String(
    tenant?.businessName ||
    settings?.storeName ||
    settings?.brandName ||
    (settings as any)?.companyName ||
    ''
  ).trim().toLowerCase();

  if (nameFallback) {
    if (nameFallback.includes('شحن') || nameFallback.includes('ملاحة')) return 'maritime';
    if (nameFallback.includes('مقاول') || nameFallback.includes('تشييد')) return 'contracting';
    if (nameFallback.includes('توزيع') || nameFallback.includes('فان') || nameFallback.includes('مناديب')) return 'wholesale_van';
    if (nameFallback.includes('تصنيع') || nameFallback.includes('مصنع')) return 'manufacturing';
    if (nameFallback.includes('مطعم') || nameFallback.includes('كافيه')) return 'restaurant';
    if (nameFallback.includes('صيدل')) return 'pharmacy';
    if (nameFallback.includes('صيانة')) return 'maintenance';
    if (nameFallback.includes('استيراد') || nameFallback.includes('تصدير')) return 'import_export';
  }

  return 'retail_general';
}
