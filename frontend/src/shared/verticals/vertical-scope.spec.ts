import { describe, it, expect } from 'vitest';
import { resolveCurrentVertical, isRouteAllowedInVertical } from './vertical-scope';

describe('Vertical Scope & Enterprise Isolation Constitution', () => {
  it('resolves retail_general when activityType is retail or retail_general even if businessName contains contracting words', () => {
    const tenant = {
      id: 'demo-mohandes',
      slug: 'almohandes',
      businessName: 'المهندس للمقاولات والاستشارات الهندسية',
      activityType: 'retail',
    };
    const vertical = resolveCurrentVertical(tenant);
    expect(vertical).toBe('retail_general');
    expect(isRouteAllowedInVertical(vertical, '/pos')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, 'pos')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/sales')).toBe(true);
  });

  it('resolves contracting and strictly hides retail POS when activityType is contracting', () => {
    const tenant = {
      id: 'contracting-co',
      slug: 'binaa',
      businessName: 'شركة البناء والتشييد',
      activityType: 'contracting',
    };
    const vertical = resolveCurrentVertical(tenant);
    expect(vertical).toBe('contracting');
    expect(isRouteAllowedInVertical(vertical, '/pos')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, 'pos')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, 'cash-drawer')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, '/contracting/projects')).toBe(true);
  });

  it('resolves maritime and strictly hides retail POS, retail sales, retail quotes, and general purchases when activityType is maritime', () => {
    const tenant = {
      id: 'maritime-co',
      slug: 'blue-ocean',
      businessName: 'بلو أوشن للخدمات اللوجستية',
      activityType: 'maritime',
    };
    const vertical = resolveCurrentVertical(tenant);
    expect(vertical).toBe('maritime');
    expect(isRouteAllowedInVertical(vertical, '/pos')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, 'pos')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, '/sales')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, 'sales')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, '/quotations')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, 'quotations')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, '/purchases')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, '/purchases/rfqs')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, '/maritime/jobs')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/customers')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/suppliers')).toBe(true);
  });

  it('resolves wholesale_van and hides retail POS while enabling van sales', () => {
    const tenant = {
      id: 'dist-co',
      slug: 'fast-dist',
      businessName: 'البركة للتوزيع وتجارة الجملة',
      activityType: 'wholesale_van',
    };
    const vertical = resolveCurrentVertical(tenant);
    expect(vertical).toBe('wholesale_van');
    expect(isRouteAllowedInVertical(vertical, '/pos')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, '/van-sales/admin')).toBe(true);
  });

  it('resolves maritime when settings.maritimeFreightModuleEnabled is true even if tenant.activityType is retail_general', () => {
    const tenant = {
      id: 'default',
      slug: 'almhnds',
      businessName: 'النظام الأساسي',
      activityType: 'retail_general',
    };
    const settings = {
      maritimeFreightModuleEnabled: true,
      businessIndustry: 'general',
    };
    const vertical = resolveCurrentVertical(tenant, settings);
    expect(vertical).toBe('maritime');
    expect(isRouteAllowedInVertical(vertical, '/maritime/jobs')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/pos')).toBe(false);
  });

  it('resolves wholesale_van even when tenant has omnichannel plan with manufacturing feature', () => {
    const tenant = {
      id: 'blue-dolphin',
      slug: 'blue-dolphin',
      businessName: 'بلو دولفين',
      activityType: 'wholesale_van',
      features: ['manufacturing', 'accounting', 'deliveryReps', 'sales', 'inventory', 'purchases'],
    };
    const settings = {
      businessIndustry: 'wholesale_van',
      manufacturingModuleEnabled: false,
      deliveryFleetModuleEnabled: true,
      posModuleEnabled: false,
    };
    const vertical = resolveCurrentVertical(tenant, settings);
    expect(vertical).toBe('wholesale_van');
    expect(isRouteAllowedInVertical(vertical, '/pos')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, '/van-sales/admin')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/manufacturing/work-orders')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, '/contracting/projects')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, '/maritime/jobs')).toBe(false);
  });

  it('strictly resolves retail_general and enables POS for retail tenant even if servicesModuleEnabled is true', () => {
    const tenant = {
      id: 'almhnds',
      slug: 'almhnds',
      businessName: 'المهندس',
      activityType: 'retail',
      features: ['sales', 'purchases', 'inventory', 'pos', 'accounting'],
    };
    const settings = {
      businessIndustry: 'retail',
      servicesModuleEnabled: true, // simulated legacy plan leak
      posModuleEnabled: true,
      inventoryModuleEnabled: true,
    };
    const vertical = resolveCurrentVertical(tenant, settings);
    expect(vertical).toBe('retail_general');
    expect(isRouteAllowedInVertical(vertical, '/pos')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, 'pos')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/cash-drawer')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/sales')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/inventory')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/products')).toBe(true);
  });

  it('resolves services only when activityType is explicitly services or consulting and no POS entitlement exists', () => {
    const tenant = {
      id: 'consulting-pro',
      slug: 'consulting-pro',
      businessName: 'استشارات هندسية وإدارية',
      activityType: 'services',
      features: ['services', 'accounting', 'crm'],
    };
    const settings = {
      businessIndustry: 'services',
      servicesModuleEnabled: true,
      posModuleEnabled: false,
      inventoryModuleEnabled: false,
    };
    const vertical = resolveCurrentVertical(tenant, settings);
    expect(vertical).toBe('services');
    expect(isRouteAllowedInVertical(vertical, '/pos')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, '/sales')).toBe(true);
  });

  it('guarantees tenant almhnds always resolves to retail_general even if settings have services', () => {
    const tenant = {
      id: 'almhnds',
      slug: 'almhnds',
      businessName: 'المهندس',
      activityType: 'services',
      features: ['sales', 'pos', 'cashDrawer'],
    };
    const settings = {
      businessIndustry: 'services',
      activityType: 'services',
      servicesModuleEnabled: true,
      posModuleEnabled: false,
    };
    const vertical = resolveCurrentVertical(tenant, settings);
    expect(vertical).toBe('retail_general');
    expect(isRouteAllowedInVertical(vertical, '/pos')).toBe(true);
  });

  it('resolves warehousing for tenant almhnds when activityType is warehousing and hides POS', () => {
    const tenant = {
      id: 'default',
      slug: 'almhnds',
      businessName: 'مستودعات المهندس للخدمات اللوجستية',
      activityType: 'warehousing',
    };
    const settings = {
      businessIndustry: 'warehousing',
      activityType: 'warehousing',
      posModuleEnabled: false,
    };
    const vertical = resolveCurrentVertical(tenant, settings);
    expect(vertical).toBe('warehousing');
    expect(isRouteAllowedInVertical(vertical, '/pos')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, '/cash-drawer')).toBe(false);
    // INV-STOREFRONT-ORDERS: the recorded-orders list stays reachable even for a
    // warehousing tenant, so an admin can see orders recorded while the storefront
    // was on; the store itself stays out of this vertical.
    expect(isRouteAllowedInVertical(vertical, '/online-orders')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/inventory-warehouses')).toBe(true);
  });

  it('guarantees any tenant with POS feature never resolves to services', () => {
    const tenant = {
      id: 'retail-shop-1',
      slug: 'retail-shop-1',
      businessName: 'محل تجزئة',
      activityType: 'services',
      features: ['pos', 'sales'],
    };
    const settings = {
      businessIndustry: 'services',
      activityType: 'services',
    };
    const vertical = resolveCurrentVertical(tenant, settings);
    expect(vertical).toBe('retail_general');
    expect(isRouteAllowedInVertical(vertical, '/pos')).toBe(true);
  });

  it('resolves warehousing and strictly isolates inventory/transfers while hiding POS and retail routes', () => {
    const tenant = {
      id: 'logistics-hub',
      slug: 'logistics-hub',
      businessName: 'مستودعات الإمداد السريع للتخزين والتحويلات',
      activityType: 'warehousing',
      features: ['inventory', 'purchases', 'sales', 'accounting'],
    };
    const settings = {
      businessIndustry: 'warehousing',
      activityType: 'warehousing',
      posModuleEnabled: false,
      inventoryModuleEnabled: true,
      purchasesModuleEnabled: true,
    };
    const vertical = resolveCurrentVertical(tenant, settings);
    expect(vertical).toBe('warehousing');
    expect(isRouteAllowedInVertical(vertical, '/pos')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, 'pos')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, '/cash-drawer')).toBe(false);
    // INV-STOREFRONT-ORDERS: same recorded-orders carve-out as above.
    expect(isRouteAllowedInVertical(vertical, '/online-orders')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/kds')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, '/displays')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, '/inventory')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/inventory-warehouses')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/inventory-issue-orders')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/products')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/purchases')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/sales')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/customers')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/suppliers')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/accounting/journal-entries')).toBe(true);
  });

  it('resolves services and strictly hides physical inventory, warehouses, and POS', () => {
    const tenant = {
      id: 'consulting-office',
      slug: 'consulting-office',
      businessName: 'مكتب الخبراء للاستشارات',
      activityType: 'services',
      features: ['sales', 'customers', 'treasury', 'accounting'],
    };
    const settings = {
      businessIndustry: 'services',
      activityType: 'services',
      posModuleEnabled: false,
    };
    const vertical = resolveCurrentVertical(tenant, settings);
    expect(vertical).toBe('services');
    expect(isRouteAllowedInVertical(vertical, '/pos')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, '/inventory')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, '/products')).toBe(false);
    expect(isRouteAllowedInVertical(vertical, '/sales')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/customers')).toBe(true);
  });

  it('resolves import_export and allows POS and cash-drawer by default, but respects posModuleEnabled false', () => {
    const tenant = {
      id: 'import-co',
      slug: 'import-co',
      businessName: 'الشرق للاستيراد والتجارة الدولية',
      activityType: 'import_export',
    };
    const vertical = resolveCurrentVertical(tenant);
    expect(vertical).toBe('import_export');
    expect(isRouteAllowedInVertical(vertical, '/pos')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, 'pos')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/cash-drawer')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, 'cash-drawer')).toBe(true);
    expect(isRouteAllowedInVertical(vertical, '/import/shipments')).toBe(true);

    // If posModuleEnabled is explicitly disabled in settings
    expect(isRouteAllowedInVertical(vertical, '/pos', { posModuleEnabled: false })).toBe(false);
    expect(isRouteAllowedInVertical(vertical, 'cash-drawer', { posModuleEnabled: false })).toBe(false);
  });
});

