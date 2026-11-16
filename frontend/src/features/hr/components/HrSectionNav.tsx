import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState, MouseEvent as ReactMouseEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { canAccessPath, isAttendanceOnlyHrUser } from '@/shared/hooks/use-permission';
import { useAuthStore } from '@/stores/auth-store';

const HR_SECTIONS = [
  { label: 'نظرة عامة', shortLabel: 'نظرة عامة', to: '/hr', match: (pathname: string) => pathname === '/hr' },
  { label: 'الموظفون', shortLabel: 'الموظفون', to: '/hr/employees', match: (pathname: string) => pathname.startsWith('/hr/employees') },
  { label: 'الحضور والانصراف', shortLabel: 'الحضور', to: '/hr/attendance', match: (pathname: string) => pathname.startsWith('/hr/attendance') },
  { label: 'الإجازات', shortLabel: 'الإجازات', to: '/hr/leaves', match: (pathname: string) => pathname.startsWith('/hr/leaves') },
  { label: 'السلف', shortLabel: 'السلف', to: '/hr/loans', match: (pathname: string) => pathname.startsWith('/hr/loans') },
  { label: 'المرتبات', shortLabel: 'المرتبات', to: '/hr/payroll', match: (pathname: string) => pathname.startsWith('/hr/payroll') },
  { label: 'مخالصات نهاية الخدمة', shortLabel: 'نهاية الخدمة', to: '/hr/settlements', match: (pathname: string) => pathname.startsWith('/hr/settlements') },
  { label: 'المستندات', shortLabel: 'المستندات', to: '/hr/documents', match: (pathname: string) => pathname.startsWith('/hr/documents') },
  { label: 'العُهد', shortLabel: 'العُهد', to: '/hr/assets', match: (pathname: string) => pathname.startsWith('/hr/assets') },
  { label: 'التقارير', shortLabel: 'التقارير', to: '/hr/reports', match: (pathname: string) => pathname.startsWith('/hr/reports') },
  { label: 'الإعدادات', shortLabel: 'الإعدادات', to: '/hr/settings', match: (pathname: string) => pathname.startsWith('/hr/settings') },
];

export function HrSectionNav() {
  const { t: __t } = useTranslation();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const attendanceOnly = isAttendanceOnlyHrUser(user);
  const visibleSections = HR_SECTIONS.filter((section) => {
    if (section.to === '/hr' && attendanceOnly) return false;
    return canAccessPath(user, section.to);
  });
  const navRef = useRef<HTMLDivElement | null>(null);
  const activeLinkRef = useRef<HTMLAnchorElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  
  const isDragging = useRef(false);
  const startX = useRef(0);
  const scrollLeftPos = useRef(0);

  function checkScroll() {
    const el = navRef.current;
    if (!el) return;
    const hasOverflow = el.scrollWidth > el.clientWidth + 2;
    if (!hasOverflow) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    const maxScroll = el.scrollWidth - el.clientWidth;
    const currentScroll = Math.abs(el.scrollLeft);
    setCanScrollRight(currentScroll > 4);
    setCanScrollLeft(currentScroll < maxScroll - 4);
  }

  useEffect(() => {
    checkScroll();
    const handleResize = () => checkScroll();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (activeLinkRef.current) {
      try {
        activeLinkRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      } catch {}
    }
    const t = setTimeout(checkScroll, 100);
    return () => clearTimeout(t);
  }, [location.pathname]);

  const scrollByAmount = (offset: number) => {
    if (navRef.current) {
      navRef.current.scrollBy({ left: offset, behavior: 'smooth' });
      setTimeout(checkScroll, 250);
    }
  };

  const handleMouseDown = (e: ReactMouseEvent) => {
    if (!navRef.current) return;
    isDragging.current = true;
    startX.current = e.pageX - navRef.current.offsetLeft;
    scrollLeftPos.current = navRef.current.scrollLeft;
  };

  const handleMouseMove = (e: ReactMouseEvent) => {
    if (!isDragging.current || !navRef.current) return;
    e.preventDefault();
    const x = e.pageX - navRef.current.offsetLeft;
    const walk = (x - startX.current) * 1.5;
    navRef.current.scrollLeft = scrollLeftPos.current - walk;
    checkScroll();
  };

  const handleMouseUpOrLeave = () => {
    isDragging.current = false;
  };

  if (visibleSections.length <= 1) {
    return null;
  }

  return (
    <div className="hr-nav-wrapper" style={{ position: 'relative', width: '100%', minWidth: 0, display: 'flex', alignItems: 'center' }}>
      {/* Scroll Right Button (in RTL: moves toward beginning) */}
      {canScrollRight && (
        <button
          type="button"
          className="hr-nav-arrow-btn hr-nav-arrow-right"
          onClick={() => scrollByAmount(160)}
          aria-label={__t('hr.hr_section_nav.s0', "تمرير لليمين")}
          style={{
            position: 'absolute',
            right: '-4px',
            zIndex: 10,
            width: '26px',
            height: '26px',
            borderRadius: '50%',
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            boxShadow: '0 2px 6px rgba(0,0,0,0.14)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#1e293b',
            fontSize: '12px',
            fontWeight: 800,
          }}
        >
          &#x276F;
        </button>
      )}

      <nav
        ref={navRef}
        className="hr-section-nav"
        aria-label={__t('hr.hr_section_nav.s1', "تنقل الموارد البشرية")}
        onScroll={checkScroll}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        style={{
          display: 'flex',
          flexWrap: 'nowrap',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-x',
          gap: '6px',
          width: '100%',
          minWidth: 0,
          padding: '2px 4px 6px 4px',
          scrollbarWidth: 'none',
          userSelect: 'none',
        }}
      >
        {visibleSections.map((section) => {
          const isActive = section.match(location.pathname);
          return (
            <Link
              key={section.to}
              to={section.to}
              ref={isActive ? activeLinkRef : null}
              className={`hr-section-nav-link ${isActive ? 'is-active active' : ''}`}
              title={section.label}
              style={{
                flexShrink: 0,
                whiteSpace: 'nowrap',
                textDecoration: 'none',
                height: '32px',
                minHeight: '32px',
                maxHeight: '32px',
                padding: '0 14px',
                fontSize: '0.8125rem',
                fontWeight: 600,
                borderRadius: '8px',
                border: `1px solid ${isActive ? '#170e5e' : '#e2e8f0'}`,
                background: isActive ? '#170e5e' : '#f8fafc',
                color: isActive ? '#ffffff' : '#475569',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'none',
                boxSizing: 'border-box',
              }}
            >
              <span className="hr-nav-text-full">{section.label}</span>
              <span className="hr-nav-text-short">{section.shortLabel}</span>
            </Link>
          );
        })}
      </nav>

      {/* Scroll Left Button (in RTL: moves toward end) */}
      {canScrollLeft && (
        <button
          type="button"
          className="hr-nav-arrow-btn hr-nav-arrow-left"
          onClick={() => scrollByAmount(-160)}
          aria-label={__t('hr.hr_section_nav.s2', "تمرير لليسار")}
          style={{
            position: 'absolute',
            left: '-4px',
            zIndex: 10,
            width: '26px',
            height: '26px',
            borderRadius: '50%',
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            boxShadow: '0 2px 6px rgba(0,0,0,0.14)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#1e293b',
            fontSize: '12px',
            fontWeight: 800,
          }}
        >
          &#x276E;
        </button>
      )}
    </div>
  );
}
