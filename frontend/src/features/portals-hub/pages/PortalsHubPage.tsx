import { useTranslation } from 'react-i18next';
import { useState, useMemo, useRef } from 'react';
import { SearchIcon, CompassIcon } from '@/shared/components/icons/AppIcons';
import { useAuthStore } from '@/stores/auth-store';
import { PORTALS_LIST, resolvePortalDestination, type PortalItem } from '../components/portals-data';
import { PortalCard } from '../components/PortalCard';
import { PortalQrModal } from '../components/PortalQrModal';

export function PortalsHubPage() {
  const { t } = useTranslation();
  const tenantSlug = useAuthStore((s) => s.tenant?.slug);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [activeQrPortal, setActiveQrPortal] = useState<PortalItem | null>(null);
  const [copied, setCopied] = useState(false);

  // INV-HUB-DEAD-END: render every card at its resolved destination, so no
  // card links to a path that matches no route (the storefront card used to
  // link to the bare `/store`, which lands on NotFound).
  const resolvedPortals = useMemo(
    () => PORTALS_LIST.map((portal) => ({ ...portal, path: resolvePortalDestination(portal, tenantSlug) })),
    [tenantSlug],
  );

  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const hasDraggedRef = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    startXRef.current = e.pageX - (tabsContainerRef.current?.offsetLeft || 0);
    scrollLeftRef.current = tabsContainerRef.current?.scrollLeft || 0;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current || !tabsContainerRef.current) return;
    const x = e.pageX - (tabsContainerRef.current.offsetLeft || 0);
    const walk = x - startXRef.current;
    if (Math.abs(walk) > 4) {
      hasDraggedRef.current = true;
    }
    tabsContainerRef.current.scrollLeft = scrollLeftRef.current - walk;
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const filteredPortals = useMemo(() => {
    return resolvedPortals.filter((portal) => {
      const matchCat = selectedCategory === 'all' || portal.category === selectedCategory;
      if (!matchCat) return false;

      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        portal.title.toLowerCase().includes(q) ||
        portal.description.toLowerCase().includes(q) ||
        portal.path.toLowerCase().includes(q) ||
        portal.keywords.some((k) => k.toLowerCase().includes(q))
      );
    });
  }, [search, selectedCategory, resolvedPortals]);

  const handleCopyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="page-stack page-shell portals-hub-page"
      dir="rtl"
      style={{
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
      }}
    >
      {/* Top Header (Unified Portals Standard) */}
      <header
        style={{
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          paddingTop: 'calc(12px + env(safe-area-inset-top, 0px))',
          paddingRight: 'max(16px, env(safe-area-inset-right, 0px))',
          paddingBottom: '12px',
          paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          position: 'sticky',
          top: 0,
          zIndex: 40,
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            maxWidth: '1280px',
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              backgroundColor: '#eff6ff',
              border: '1px solid #c7d2fe',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <CompassIcon size={20} color="#170e5e" />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1
              style={{
                margin: 0,
                fontSize: '13.5px',
                fontWeight: 900,
                color: '#0f172a',
                lineHeight: 1.25,
                whiteSpace: 'nowrap',
              }}
            >
              {t('portals_hub.portals_hub_page.s0', "مركز البوابات الرقمية وشاشات الخدمة الذاتية")}
            </h1>
            <span
              style={{
                fontSize: '11px',
                color: '#64748b',
                display: 'block',
                marginTop: '2px',
                whiteSpace: 'nowrap',
              }}
            >
              {t('portals_hub.portals_hub_page.s1', "دليل الوصول الموحد لكافة بوابات وشاشات المنظومة")}
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main
        className="document-prototype-column"
        style={{
          padding: '14px 16px 88px',
          maxWidth: '1280px',
          width: 'min(100%, 1280px)',
          margin: '0 auto',
          boxSizing: 'border-box',
        }}
      >
        {/* Toolbar & Filter Pills (Strictly Single Line, Zero Scroll) */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '8px 10px',
            marginBottom: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <div style={{ position: 'relative', width: '100%' }}>
            <span style={{ position: 'absolute', right: '10px', top: '8px', color: '#94a3b8' }}>
              <SearchIcon size={14} />
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('portals_hub.portals_hub_page.s2', "ابحث عن بوابة، شاشة، أو دور وظيفي...")}
              style={{
                width: '100%',
                height: '32px',
                paddingRight: '32px',
                paddingLeft: '10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '11.5px',
                outline: 'none',
                boxSizing: 'border-box',
                backgroundColor: '#f8fafc',
              }}
            />
          </div>

          <div
            style={{
              position: 'relative',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {/* Scroll Left Button */}
            <button
              type="button"
              onClick={() => {
                if (tabsContainerRef.current) {
                  tabsContainerRef.current.scrollBy({ left: -140, behavior: 'smooth' });
                }
              }}
              title={t('portals_hub.portals_hub_page.s3', "تمرير لليسار")}
              aria-label={t('portals_hub.portals_hub_page.s4', "تمرير لليسار")}
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#475569',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0,
                padding: 0,
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>

            <div
              ref={tabsContainerRef}
              className="portals-hub-category-tabs"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={(e) => {
                if (e.deltaY !== 0 && tabsContainerRef.current) {
                  tabsContainerRef.current.scrollLeft -= e.deltaY;
                }
              }}
              style={{
                display: 'flex',
                flexWrap: 'nowrap',
                overflowX: 'auto',
                alignItems: 'center',
                gap: '4px',
                backgroundColor: '#f1f5f9',
                padding: '3px',
                borderRadius: '8px',
                flex: 1,
                minWidth: 0,
                boxSizing: 'border-box',
                scrollbarWidth: 'none',
                WebkitOverflowScrolling: 'touch',
                touchAction: 'pan-x pan-y',
                cursor: 'grab',
                userSelect: 'none',
              }}
            >
              {[
                { id: 'all', label: `الكل (${resolvedPortals.length})` },
                { id: 'logistics', label: t('portals_hub.portals_hub_page.s5', "شحن ولوجستيات") },
                { id: 'projects', label: t('portals_hub.portals_hub_page.s6', "مشاريع ومقاولات") },
                { id: 'staff', label: t('portals_hub.portals_hub_page.s7', "خدمة ذاتية") },
                { id: 'field', label: t('portals_hub.portals_hub_page.s8', "توزيع وميداني") },
                { id: 'branch', label: t('portals_hub.portals_hub_page.s9', "تشغيل وصالة") },
                { id: 'management', label: t('portals_hub.portals_hub_page.s10', "إدارة ورقابة") },
              ].map((tab) => {
                const isActive = selectedCategory === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={(e) => {
                      if (hasDraggedRef.current) return;
                      setSelectedCategory(tab.id);
                      e.currentTarget.scrollIntoView?.({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                    }}
                    style={{
                      flex: '0 0 auto',
                      minWidth: 'max-content',
                      height: '26px',
                      padding: '0 10px',
                      borderRadius: '6px',
                      border: 'none',
                      backgroundColor: isActive ? '#ffffff' : 'transparent',
                      color: isActive ? '#170e5e' : '#475569',
                      fontWeight: 800,
                      fontSize: '11px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: isActive ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                      transition: 'background-color 0.15s ease, color 0.15s ease',
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Scroll Right Button */}
            <button
              type="button"
              onClick={() => {
                if (tabsContainerRef.current) {
                  tabsContainerRef.current.scrollBy({ left: 140, behavior: 'smooth' });
                }
              }}
              title={t('portals_hub.portals_hub_page.s11', "تمرير لليمين")}
              aria-label={t('portals_hub.portals_hub_page.s12', "تمرير لليمين")}
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#475569',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0,
                padding: 0,
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>
        </div>

        {/* Portals Cards Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
          {filteredPortals.map((portal) => (
            <PortalCard
              key={portal.id}
              portal={portal}
              onOpenQr={(p) => setActiveQrPortal(p)}
            />
          ))}
        </div>
      </main>

      {/* QR Modal */}
      <PortalQrModal
        portal={activeQrPortal}
        onClose={() => setActiveQrPortal(null)}
        copied={copied}
        onCopy={handleCopyLink}
      />
    </div>
  );
}

export default PortalsHubPage;

