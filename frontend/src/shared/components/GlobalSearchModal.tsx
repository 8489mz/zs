import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CompassIcon, PackageIcon, ReceiptIcon, UsersIcon } from '@/shared/components/icons/AppIcons';
import { ClientPortal } from '@/shared/components/ClientPortal';
import { useToolbarStore } from '@/stores/toolbar-store';
import { useAuthStore } from '@/stores/auth-store';
import { navigationItems } from '@/app/router/registry';
import { canAccessNavigationItem, matchesNavigationSearch } from '@/app/router/access';
import { normalizeArabicSearchKey } from '@/lib/arabic-normalization';
import { productsApi } from '@/features/products/api/products.api';
import { salesApi } from '@/features/sales/api/sales.api';
import { customersApi } from '@/features/customers/api/customers.api';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { resolveCurrentVertical, isRouteAllowedInVertical } from '@/shared/verticals/vertical-scope';
import type { Product, Sale, Customer } from '@/types/domain';

export function GlobalSearchModal() {
  const { t } = useTranslation();
  const { isGlobalSearchOpen, setGlobalSearchOpen, globalSearchQuery, setGlobalSearchQuery } = useToolbarStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [debouncedQuery, setDebouncedQuery] = useState(globalSearchQuery);
  const { data: settings } = useSettingsQuery();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(globalSearchQuery), 300);
    return () => clearTimeout(timer);
  }, [globalSearchQuery]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === '/' || e.code === 'Slash')) {
        e.preventDefault();
        setGlobalSearchOpen(!isGlobalSearchOpen);
      }
      if (e.key === 'Escape' && isGlobalSearchOpen) {
        setGlobalSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isGlobalSearchOpen, setGlobalSearchOpen]);

  useEffect(() => {
    if (isGlobalSearchOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isGlobalSearchOpen]);

  const handleClose = () => {
    setGlobalSearchOpen(false);
    setGlobalSearchQuery('');
  };

  const hasQuery = debouncedQuery.trim().length > 0;
  const user = useAuthStore((state) => state.user);
  const normalizedQuery = useMemo(() => normalizeArabicSearchKey(debouncedQuery), [debouncedQuery]);

  const tenant = useAuthStore((state) => state.tenant);
  const currentVertical = resolveCurrentVertical(tenant, settings);

  const navMatches = useMemo(() => {
    if (!hasQuery || !user) return [];
    return navigationItems
      .filter((item) => canAccessNavigationItem(user, item))
      .filter((item) => isRouteAllowedInVertical(currentVertical, item.key || item.to, settings))
      .filter((item) => matchesNavigationSearch(item, normalizedQuery))
      .slice(0, 6);
  }, [hasQuery, user, currentVertical, settings, normalizedQuery]);

  // Real API queries
  const { data: productsData, isLoading: isLoadingProducts } = useQuery({
    queryKey: ['products-search', debouncedQuery],
    queryFn: () => productsApi.listPage({ q: debouncedQuery, page: 1, pageSize: 5 }),
    enabled:
      hasQuery &&
      isGlobalSearchOpen &&
      currentVertical !== 'maritime' &&
      isRouteAllowedInVertical(currentVertical, 'products', settings) &&
      settings?.inventoryModuleEnabled !== false,
  });

  const { data: salesData, isLoading: isLoadingSales } = useQuery({
    queryKey: ['sales-search', debouncedQuery],
    queryFn: () => salesApi.listPage({ search: debouncedQuery, page: 1, pageSize: 5 }),
    enabled:
      hasQuery &&
      isGlobalSearchOpen &&
      currentVertical !== 'contracting' &&
      isRouteAllowedInVertical(currentVertical, 'sales', settings) &&
      settings?.posModuleEnabled !== false,
  });

  const { data: customersData, isLoading: isLoadingCustomers } = useQuery({
    queryKey: ['customers-search', debouncedQuery],
    queryFn: () => customersApi.listPage({ q: debouncedQuery, page: 1, pageSize: 5 }),
    enabled:
      hasQuery &&
      isGlobalSearchOpen &&
      isRouteAllowedInVertical(currentVertical, 'customers', settings) &&
      (settings?.posModuleEnabled !== false || settings?.enableEnterpriseFeatures === true || settings?.installmentsModuleEnabled === true),
  });

  const isLoading = isLoadingProducts || isLoadingSales || isLoadingCustomers;

  const handleNavigate = (path: string) => {
    navigate(path);
    handleClose();
  };

  const renderResults = () => {
    if (!hasQuery) {
      return (
        <div className="global-search-empty">
          <p>{t('shared.global_search_modal.s0', "اكتب للبحث في الصفحات، الأصناف، الفواتير، والعملاء...")}</p>
        </div>
      );
    }

    if (isLoading && navMatches.length === 0) {
      return (
        <div className="global-search-empty">
          <p>{t('shared.global_search_modal.s1', "جاري البحث...")}</p>
        </div>
      );
    }

    const products = productsData?.products || [];
    const sales = salesData?.rows || [];
    const customers = customersData?.customers || [];

    if (products.length === 0 && sales.length === 0 && customers.length === 0 && navMatches.length === 0) {
      return (
        <div className="global-search-empty">
          <p>{t('shared.global_search_modal.s2', "لم يتم العثور على نتائج مطابقة لـ \"")}{debouncedQuery}"</p>
        </div>
      );
    }

    return (
      <div className="global-search-results">
        {navMatches.length > 0 && (
          <>
            <div className="global-search-group-title">{t('shared.global_search_modal.s3', "الصفحات والتنقل")}</div>
            {navMatches.map((item) => (
              <div key={item.key} className="global-search-item" onClick={() => handleNavigate(item.to)}>
                <div className="global-search-item-icon"><CompassIcon size={18} /></div>
                <div className="global-search-item-content">
                  <span className="global-search-item-title">{item.label}</span>
                  <span className="global-search-item-subtitle">{item.to}</span>
                </div>
              </div>
            ))}
          </>
        )}
        {products.length > 0 && (
          <>
            <div className="global-search-group-title">{t('shared.global_search_modal.s4', "المنتجات")}</div>
            {products.map((p: Product) => (
              <div key={p.id} className="global-search-item" onClick={() => handleNavigate(`/products/${p.id}/edit`)}>
                <div className="global-search-item-icon"><PackageIcon size={18} /></div>
                <div className="global-search-item-content">
                  <span className="global-search-item-title">{p.name}</span>
                  <span className="global-search-item-subtitle">{p.barcode ? `باركود: ${p.barcode}` : t('shared.global_search_modal.s5', "بدون باركود")}</span>
                </div>
              </div>
            ))}
          </>
        )}

        {sales.length > 0 && (
          <>
            <div className="global-search-group-title">{t('shared.global_search_modal.s6', "فواتير المبيعات")}</div>
            {sales.map((s: Sale) => (
              <div key={s.id} className="global-search-item" onClick={() => handleNavigate(`/sales`)}>
                <div className="global-search-item-icon"><ReceiptIcon size={18} /></div>
                <div className="global-search-item-content">
                  <span className="global-search-item-title">{t('shared.global_search_modal.s7', "فاتورة مبيعات #")}{s.docNo || s.id.slice(0, 8)}</span>
                  <span className="global-search-item-subtitle">{t('shared.global_search_modal.s8', "الإجمالي:")} {s.total}</span>
                </div>
              </div>
            ))}
          </>
        )}

        {customers.length > 0 && (
          <>
            <div className="global-search-group-title">{t('shared.global_search_modal.s9', "العملاء")}</div>
            {customers.map((c: Customer) => (
              <div key={c.id} className="global-search-item" onClick={() => handleNavigate(`/customers`)}>
                <div className="global-search-item-icon"><UsersIcon size={18} /></div>
                <div className="global-search-item-content">
                  <span className="global-search-item-title">{c.name}</span>
                  <span className="global-search-item-subtitle">{c.phone || t('shared.global_search_modal.s10', "بدون هاتف")}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    );
  };

  if (!isGlobalSearchOpen) return null;

  return (
    <ClientPortal targetId="root">
      <div className="global-search-overlay" onClick={handleClose}>
        <div className="global-search-modal" onClick={(e) => e.stopPropagation()}>
          <div className="global-search-input-wrapper">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              ref={inputRef}
              className="global-search-input"
              type="text"
              placeholder={`ابحث في أي مكان... (\u200ECtrl+/\u200E)`}
              value={globalSearchQuery}
              onChange={(e) => setGlobalSearchQuery(e.target.value)}
            />
            <div className="global-search-badge">ESC</div>
          </div>
          {renderResults()}
        </div>
      </div>
    </ClientPortal>
  );
}
