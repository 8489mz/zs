import { useState, useEffect, Fragment } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AppAccountMenu } from '@/shared/layout/app-account-menu';
import { useToolbarStore } from '@/stores/toolbar-store';
import { ManagerNotificationsBell } from '@/features/dashboard/components/ManagerNotificationsBell';
import { useOfflineUpdateCheck } from '@/shared/hooks/use-offline-update-check';
import { resolveAutoBreadcrumbs } from '@/shared/layout/breadcrumbs.helper';
import { FullScreenToggleButton } from '@/shared/components/FullScreenToggleButton';
import { AiBusinessCopilotModal } from '@/features/ai-copilot/components/AiBusinessCopilotModal';
import { AiRobotIcon } from '@/shared/ui/AiRobotIcon';
import { useTranslation } from 'react-i18next';
import { ArrowRightIcon } from '@/shared/components/icons/AppIcons';
import { LanguageSwitcherMenu } from '@/shared/layout/LanguageSwitcherMenu';
import { useTabsStore } from '@/stores/tabs-store';
import { AppBrowserTabBar, resolveRouteMetadata } from '@/shared/layout/AppBrowserTabBar';
import { translateUiText } from '@/lib/auto-translator';

export function isRootLandingRoute(pathname: string): boolean {
  const clean = pathname.replace(/\/+$/, '') || '/';
  
  // Exact universal module root matches
  const rootRoutes = new Set([
    '',
    '/',
    '/dashboard',
    '/contracting',
    '/pos',
    '/van-sales',
    '/inventory/van-sales',
    '/manufacturing',
    '/driver',
    '/setup',
    '/activate',
    '/profile',
  ]);
  
  if (rootRoutes.has(clean)) return true;

  // Maritime workspace roots (all top-level maritime tabs belong to the main maritime workspace)
  if (clean === '/maritime' || clean === '/maritime-freight' || /^\/(maritime|maritime-freight)\/(inquiries|rfqs|matrix|quotations|jobs|containers|lines|settings)$/.test(clean)) {
    return true;
  }

  // Contracting workspace roots
  if (clean === '/contracting' || /^\/contracting\/(projects|sov|subcontractors|claims|settings)$/.test(clean)) {
    return true;
  }

  return false;
}

export function GlobalAppToolbar() {
  const { t: __t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const isLtr = i18n.dir() === 'ltr';
  const [isAiCopilotOpen, setIsAiCopilotOpen] = useState(false);
  const { breadcrumbs, toggleMobileSidebar, setGlobalSearchOpen } = useToolbarStore();
  const { data: updateInfo } = useOfflineUpdateCheck('desktop');

  const { tabs, syncCurrentRoute } = useTabsStore();

  const [isMobileScreen, setIsMobileScreen] = useState(() => {
    if (typeof window !== 'undefined') return window.innerWidth <= 900;
    return false;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobileScreen(window.innerWidth <= 900);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Sync route changes with active tab
  useEffect(() => {
    const fullPath = location.pathname + location.search;
    const meta = resolveRouteMetadata(location.pathname);
    syncCurrentRoute(fullPath, meta.title, meta.iconKey);
  }, [location.pathname, location.search, syncCurrentRoute]);

  const activeBreadcrumbs = resolveAutoBreadcrumbs(location.pathname, breadcrumbs);
  const isRootPage = isRootLandingRoute(location.pathname);
  const canGoBack = typeof window !== 'undefined' && window.history.length > 1 && (window.history.state?.idx ?? 0) > 0;
  const showBackButton = !isRootPage && canGoBack;
  const showTabs = tabs.length > 1 && !isMobileScreen;

  const handleGoBack = () => {
    if (canGoBack) {
      navigate(-1);
    }
  };

  const formatBreadcrumbLabel = (rawLabel: string) => {
    if (!rawLabel || i18n.language === 'ar') return rawLabel;
    const clean = rawLabel.trim();
    const commonCrumbs: Record<string, string> = {
      'الرئيسية': 'sidebar.dashboard',
      'المبيعات': 'sidebar.sales',
      'العملاء': 'sidebar.customers',
      'المشتريات': 'sidebar.purchases',
      'المشتريات والموردين': 'sidebar.purchases_suppliers',
      'الموردين': 'sidebar.suppliers',
      'المخزون والأصناف': 'sidebar.inventory',
      'قائمة الأصناف': 'sidebar.products',
      'المالية والمحاسبة': 'sidebar.finance',
      'الخزينة والبنوك': 'sidebar.treasury',
      'المصروفات': 'sidebar.expenses',
      'الحسابات': 'sidebar.accounts',
      'سجل الفواتير': 'sidebar.invoices',
      'سجل فواتير المشتريات': 'sidebar.bills',
      'إنشاء فاتورة شراء': 'sidebar.new_bill',
      'تذاكر الصيانة': 'sidebar.maintenance_tickets',
      'قسم الصيانة': 'sidebar.maintenance',
      'عروض الأسعار': 'sidebar.quotations',
      'أوامر البيع وحجز المخزون': 'sidebar.sales_orders',
      'إدارة علاقات العملاء (CRM)': 'Customer Relationship Management (CRM)',
      'المركبات والأساطيل': 'Vehicles & Fleet',
      'المركبات والأسطول': 'Vehicles & Fleet',
      'المقاولات والمشاريع': 'Contracting & Projects',
      'الشحن البحري': 'Maritime Freight',
      'نقاط البيع': 'Point of Sale (POS)',
      'المتجر الإلكتروني': 'Online Storefront',
    };
    if (commonCrumbs[clean]) {
      const val = commonCrumbs[clean];
      if (val.startsWith('sidebar.')) {
        const tr = t(val);
        if (tr && tr !== val) return tr;
      } else {
        return val;
      }
    }
    const fromDict = translateUiText(clean);
    if (fromDict && fromDict !== clean) return fromDict;
    const fromI18n = t(clean);
    if (fromI18n && fromI18n !== clean) return fromI18n;
    return clean;
  };

  return (
    <div className="purchase-prototype-workspace-toolbar">
      <div className="purchase-prototype-toolbar-inner">
        <button 
          type="button" 
          className="mobile-sidebar-toggle" 
          onClick={toggleMobileSidebar}
          aria-label="Toggle Menu"
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>

        {showBackButton && (
          <button
            type="button"
            onClick={handleGoBack}
            className="toolbar-back-btn"
            style={{
              background: '#ffffff',
              border: '1.5px solid #94a3b8',
              borderRadius: '8px',
              width: '34px',
              height: '34px',
              minWidth: '34px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#170e5e',
              marginInlineEnd: '6px',
              flexShrink: 0,
              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.1)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#ede9fe';
              e.currentTarget.style.borderColor = '#7c3aed';
              e.currentTarget.style.color = '#170e5e';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#ffffff';
              e.currentTarget.style.borderColor = '#94a3b8';
              e.currentTarget.style.color = '#170e5e';
            }}
            title={isLtr ? "Go back (Alt + Backspace)" : __t('shared.layout.global_app_toolbar.s0', "رجوع للصفحة السابقة (Alt + Backspace)")}
            aria-label={isLtr ? "Go back" : __t('shared.layout.global_app_toolbar.s1', "رجوع للصفحة السابقة")}
          >
            <ArrowRightIcon size={20} strokeWidth={2.8} color="currentColor" style={{ transform: isLtr ? 'scaleX(-1)' : 'none' }} />
          </button>
        )}

        {showTabs ? (
          <AppBrowserTabBar />
        ) : (
          <div 
            className="purchase-prototype-breadcrumb"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              flexWrap: 'nowrap',
              minWidth: 0,
              flex: '1 1 auto',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {activeBreadcrumbs.map((crumb, index) => {
              const isLast = index === activeBreadcrumbs.length - 1;
              const formattedLabel = formatBreadcrumbLabel(crumb.label || '');
              if (isLast) {
                const charCount = formattedLabel.length;
                // Responsive dynamic font sizing: shrinks when text is long or space is tight
                const dynamicFontSize = charCount > 40 ? '0.78rem' : charCount > 25 ? '0.84rem' : '0.94rem';

                return (
                  <strong
                    key={index}
                    title={formattedLabel}
                    style={{
                      fontSize: dynamicFontSize,
                      color: '#0f172a',
                      fontWeight: 800,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      minWidth: 0,
                      maxWidth: 'min(480px, 45vw)',
                      display: 'inline-block',
                      verticalAlign: 'middle',
                      lineHeight: 1.25,
                    }}
                  >
                    {formattedLabel}
                  </strong>
                );
              }

              return (
                <Fragment key={index}>
                  <span 
                    style={{ 
                      cursor: crumb.to ? 'pointer' : 'default', 
                      color: crumb.to ? '#64748b' : 'inherit',
                      flexShrink: 0,
                      whiteSpace: 'nowrap',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                    }} 
                    onClick={() => crumb.to && navigate(crumb.to)}
                  >
                    {formattedLabel}
                  </span>
                  <span style={{ color: '#cbd5e1', flexShrink: 0, userSelect: 'none', marginInline: '1px' }}>{isLtr ? '›' : '‹'}</span>
                </Fragment>
              );
            })}
          </div>
        )}

        <div className="purchase-prototype-toolbar-actions">
          {updateInfo?.updateAvailable && updateInfo.latestVersion && (
            <button
              type="button"
              className="system-update-toolbar-alert"
              onClick={() => navigate('/updates')}
              title={`يتوفر تحديث جديد للمنظومة (v${updateInfo.latestVersion}) — اضغط للترقية`}
            >
              <span className="system-update-pulse-dot" />
              <span>{__t('shared.layout.global_app_toolbar.s2', "تحديث متوفر: v")}{updateInfo.latestVersion}</span>
            </button>
          )}
          {/* Mobile compact search button */}
          <button
            type="button"
            className="mobile-search-icon-btn"
            onClick={() => setGlobalSearchOpen(true)}
            aria-label={__t('shared.layout.global_app_toolbar.s3', "بحث سريع")}
            title={__t('shared.layout.global_app_toolbar.s4', "بحث شامل")}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </button>

          <div 
            className="purchase-prototype-search-container desktop-only-toolbar-item" 
            role="search"
            style={{ minWidth: 0, flexShrink: 1 }}
          >
            <button 
              className="purchase-prototype-search" 
              onClick={() => setGlobalSearchOpen(true)} 
              aria-label={t('common.search_placeholder', 'ابحث في أي مكان...')}
              style={{
                width: 'clamp(8.5rem, 12vw, 11.5rem)',
                transition: 'width 0.2s ease',
              }}
            >
              <span aria-hidden="true">⌕</span>
              <span style={{ flex: 1, textAlign: isLtr ? 'left' : 'right', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t('common.search_placeholder', 'ابحث في أي مكان...')}
              </span>
              <div className="purchase-prototype-search-shortcut" dir="ltr">
                <kbd>Ctrl</kbd> + <kbd>/</kbd>
              </div>
            </button>
          </div>
          <button 
            type="button"
            className="desktop-only-toolbar-item"
            style={{ width: 36, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--surface-sunken)', border: '1px solid var(--border-color)', borderRadius: 8, cursor: 'pointer', flexShrink: 0 }}
            title={t('common.refresh', 'تحديث البيانات (Refresh)')}
            onClick={() => window.location.reload()}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
          <div className="desktop-only-toolbar-item" style={{ display: 'flex', alignItems: 'center' }}>
            <FullScreenToggleButton />
          </div>
          <button
            type="button"
            onClick={() => setIsAiCopilotOpen(true)}
            title={t('common.copilot', 'المستشار الذكي (زاد AI)')}
            style={{
              height: 32,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '0 10px',
              backgroundColor: '#eff6ff',
              border: '1px solid #bfdbfe',
              color: '#1e40af',
              borderRadius: 8,
              cursor: 'pointer',
              flexShrink: 0,
              fontSize: '12px',
              fontWeight: 800,
            }}
          >
            <AiRobotIcon size={17} />
            <span className="desktop-only-toolbar-item">{__t('shared.layout.global_app_toolbar.s5', "زاد AI")}</span>
          </button>

          {/* Multi-language Switcher Menu */}
          <LanguageSwitcherMenu />

          <ManagerNotificationsBell />
          <AppAccountMenu />
        </div>
      </div>
      <AiBusinessCopilotModal open={isAiCopilotOpen} onClose={() => setIsAiCopilotOpen(false)} />
    </div>
  );
}
