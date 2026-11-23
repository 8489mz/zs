import type { BusinessVertical } from './vertical-scope.types';
import { normalizeKey } from './vertical-scope-normalize-key';

/**
 * Universal Vertical Isolation Check:
 * Enforces strict boundaries between business models across desktop, mobile, search, and routes.
 */
export function isRouteAllowedInVertical(vertical: BusinessVertical, target: string, settings?: any, grantedFeatures?: string[]): boolean {
  const key = normalizeKey(target);

  // INV-STOREFRONT-ORDERS: the recorded-orders list is the tenant's own order record,
  // not a storefront feature — every vertical allows it so an admin can always reach
  // orders recorded while the storefront was on. The store itself, its settings and
  // marketplaces stay blocked per vertical below. The page is still permission-gated
  // to 'sales' by the router (routePermissionMap).
  if (key === 'online-orders') {
    return true;
  }

  // P10 (INV-VAN-GENERAL-FEATURE-OVERRIDES): a super-admin per-tenant
  // override lifts the route for the granted feature even where the
  // vertical blocks it below (wholesale_van blocks 'pos'; warehousing /
  // services block 'pos' and 'cash-drawer'). grantedFeatures comes from
  // tenant.features, which the backend builds override-aware.
  if (grantedFeatures && grantedFeatures.length > 0) {
    const routeFeature =
      key === 'pos' || key.startsWith('pos/') ? 'pos'
      : key === 'cash-drawer' || key.startsWith('cash-drawer/') ? 'cashDrawer'
      : null;
    if (routeFeature && grantedFeatures.includes(routeFeature)) return true;
    // INV-POS-RETAIL-FEATURE-GATE: negative half of the P10 escape — a non-empty list lacking the route feature means hidden/excluded, so close the route instead of falling through to the retail default.
    // An empty/missing list keeps the legacy retail default.
    if (routeFeature) return false;
  }

  // Specific settings routes that belong exclusively to retail e-commerce or retail warehouse management
  if (
    key === 'settings/storefront' ||
    key === 'settings/marketplaces' ||
    key === 'settings/locations' ||
    key === 'settings/reference' ||
    key === 'settings/demo-data' ||
    key.startsWith('settings/storefront/') ||
    key.startsWith('settings/marketplaces/') ||
    key.startsWith('settings/locations/') ||
    key.startsWith('settings/reference/') ||
    key.startsWith('settings/demo-data/')
  ) {
    if (vertical === 'maritime') {
      return false;
    }
    if (vertical === 'contracting' && key !== 'settings/reference' && !key.startsWith('settings/reference/')) {
      return false;
    }
    if (key.includes('storefront') || key.includes('marketplaces')) {
      return settings?.storefrontModuleEnabled !== false;
    }
  }

  // Common universal infrastructure routes (always permitted for all verticals)
  if (
    key === '/' ||
    key === 'dashboard' ||
    key === 'login' ||
    key === 'onboarding' ||
    key === 'settings' ||
    key.startsWith('settings/') ||
    key.startsWith('settings-') ||
    key === 'audit' ||
    key === 'apps' ||
    key.startsWith('saas-admin') ||
    key.startsWith('hr') ||
    key === 'treasury' ||
    key === 'expenses' ||
    key.startsWith('accounting') ||
    key === 'accounts' ||
    key === 'vat-declaration'
  ) {
    return true;
  }

  switch (vertical) {
    case 'maritime': {
      // Strictly block retail POS, barcode, pricing center, general retail stock, other verticals
      const blockedKeys = [
        'pos',
        'cash-drawer',
        'online-orders',
        'kds',
        'displays',
        'signage',
        'product-modifiers',
        'pricing-center',
        'products',
        'products/new',
        'product-new',
        'product-categories',
        'products/categories',
        'inventory',
        'inventory-warehouses',
        'inventory/warehouses',
        'inventory-bins',
        'inventory/bins',
        'inventory-tree',
        'inventory/tree',
        'inventory-issue-orders',
        'inventory/issue-orders',
        'inventory-issue-order-new',
        'inventory/issue-orders/new',
        'inventory/van-sales',
        'reports-inventory',
        'reports/inventory',
        'delivery-reps',
        'van-sales-admin',
        'van-sales',
        'trade-in',
        'imei-history',
        'maintenance',
        'clothing',
        'sales',
        'sales/invoices',
        'sales-orders',
        'sales/orders',
        'returns',
        'price-lists',
        'sales/price-lists',
        'quotations',
        'purchases-rfqs',
        'purchases/rfqs',
        'purchases-orders',
        'purchases/orders',
        'purchases-reorder',
        'purchases',
        'purchases-new',
        'purchases/new',
        'purchase-returns',
        'reports-sales',
        'reports/sales',
        'reports-purchases',
        'reports/purchases',
        'installments',
        'contracting',
        'pharmacy',
        'manufacturing',
      ];

      if (blockedKeys.some((b) => key === b || key.startsWith(`${b}/`))) {
        return false;
      }
      if (key.startsWith('contracting-') || key.startsWith('contracting/')) return false;
      if (key.startsWith('pharmacy-') || key.startsWith('pharmacy/')) return false;
      if (key.startsWith('manufacturing-') || key.startsWith('manufacturing/')) return false;

      return true;
    }

    case 'contracting': {
      const blockedKeys = [
        'pos',
        'cash-drawer',
        'online-orders',
        'kds',
        'displays',
        'signage',
        'product-modifiers',
        'pricing-center',
        'delivery-reps',
        'van-sales-admin',
        'van-sales',
        'trade-in',
        'imei-history',
        'maintenance',
        'clothing',
        'sales-orders',
        'price-lists',
        'maritime',
        'pharmacy',
        'manufacturing',
      ];

      if (blockedKeys.some((b) => key === b || key.startsWith(`${b}/`))) {
        return false;
      }
      if (key.startsWith('maritime-') || key.startsWith('maritime/')) return false;
      if (key.startsWith('pharmacy-') || key.startsWith('pharmacy/')) return false;
      if (key.startsWith('manufacturing-') || key.startsWith('manufacturing/')) return false;

      return true;
    }

    case 'wholesale_van': {
      const blockedKeys = [
        'pos',
        'maritime',
        'contracting',
        'kds',
        'displays',
        'signage',
        'pharmacy',
        'manufacturing',
        'maintenance',
        'trade-in',
      ];

      if (blockedKeys.some((b) => key === b || key.startsWith(`${b}/`))) {
        return false;
      }
      if (key.startsWith('maritime-') || key.startsWith('maritime/')) return false;
      if (key.startsWith('contracting-') || key.startsWith('contracting/')) return false;
      if (key.startsWith('pharmacy-') || key.startsWith('pharmacy/')) return false;
      if (key.startsWith('manufacturing-') || key.startsWith('manufacturing/')) return false;

      return true;
    }

    case 'warehousing': {
      const blockedKeys = [
        'pos',
        'cash-drawer',
        'storefront',
        'marketplaces',
        'online-orders',
        'kds',
        'displays',
        'signage',
        'product-modifiers',
        'trade-in',
        'imei-history',
        'maintenance',
        'clothing',
        'maritime',
        'contracting',
        'pharmacy',
        'manufacturing',
        'delivery-reps',
        'van-sales-admin',
        'van-sales',
      ];

      if (blockedKeys.some((b) => key === b || key.startsWith(`${b}/`))) {
        return false;
      }
      if (key.startsWith('maritime-') || key.startsWith('maritime/')) return false;
      if (key.startsWith('contracting-') || key.startsWith('contracting/')) return false;
      if (key.startsWith('pharmacy-') || key.startsWith('pharmacy/')) return false;
      if (key.startsWith('manufacturing-') || key.startsWith('manufacturing/')) return false;
      if (key.startsWith('van-sales') || key.startsWith('driver-mobile')) return false;

      return true;
    }

    case 'manufacturing': {
      const blockedKeys = [
        'pos',
        'cash-drawer',
        'online-orders',
        'kds',
        'displays',
        'signage',
        'product-modifiers',
        'delivery-reps',
        'van-sales-admin',
        'trade-in',
        'imei-history',
        'maintenance',
        'clothing',
        'maritime',
        'contracting',
        'pharmacy',
      ];

      if (blockedKeys.some((b) => key === b || key.startsWith(`${b}/`))) {
        return false;
      }
      if (key.startsWith('maritime-') || key.startsWith('maritime/')) return false;
      if (key.startsWith('contracting-') || key.startsWith('contracting/')) return false;
      if (key.startsWith('pharmacy-') || key.startsWith('pharmacy/')) return false;

      return true;
    }

    case 'import_export': {
      if ((key === 'pos' || key === 'cash-drawer') && settings?.posModuleEnabled === false) {
        return false;
      }

      const blockedKeys = [
        'online-orders',
        'kds',
        'displays',
        'signage',
        'product-modifiers',
        'delivery-reps',
        'van-sales-admin',
        'trade-in',
        'imei-history',
        'maintenance',
        'clothing',
        'maritime',
        'contracting',
        'pharmacy',
      ];

      if (blockedKeys.some((b) => key === b || key.startsWith(`${b}/`))) {
        return false;
      }
      if (key.startsWith('maritime-') || key.startsWith('maritime/')) return false;
      if (key.startsWith('contracting-') || key.startsWith('contracting/')) return false;
      if (key.startsWith('pharmacy-') || key.startsWith('pharmacy/')) return false;

      return true;
    }

    case 'services': {
      const blockedKeys = [
        'pos',
        'cash-drawer',
        'online-orders',
        'kds',
        'displays',
        'signage',
        'product-modifiers',
        'delivery-reps',
        'van-sales-admin',
        'van-sales',
        'trade-in',
        'imei-history',
        'maintenance',
        'clothing',
        'maritime',
        'contracting',
        'pharmacy',
        'manufacturing',
        'pricing-center',
        'products',
        'products/new',
        'product-categories',
        'products/categories',
        'inventory',
        'inventory-warehouses',
        'inventory/warehouses',
        'inventory-bins',
        'inventory-tree',
        'inventory-issue-orders',
        'inventory-issue-order-new',
        'reports-inventory',
        'purchases-reorder',
      ];

      if (blockedKeys.some((b) => key === b || key.startsWith(`${b}/`))) {
        return false;
      }
      if (key.startsWith('maritime-') || key.startsWith('maritime/')) return false;
      if (key.startsWith('contracting-') || key.startsWith('contracting/')) return false;
      if (key.startsWith('pharmacy-') || key.startsWith('pharmacy/')) return false;
      if (key.startsWith('manufacturing-') || key.startsWith('manufacturing/')) return false;

      return true;
    }

    case 'retail_general':
    default: {
      // General retail blocks deep vertical suites unless explicitly activated
      if (key.startsWith('maritime-') || key.startsWith('maritime/')) {
        return settings?.maritimeFreightModuleEnabled === true;
      }
      if (key.startsWith('contracting-') || key.startsWith('contracting/')) {
        return settings?.contractingModuleEnabled === true;
      }
      if (key.startsWith('manufacturing-') || key.startsWith('manufacturing/')) {
        return settings?.manufacturingModuleEnabled === true;
      }
      if (key.startsWith('pharmacy-') || key.startsWith('pharmacy/')) {
        return settings?.pharmacyModuleEnabled === true;
      }
      return true;
    }
  }
}
