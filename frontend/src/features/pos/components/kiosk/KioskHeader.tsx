/* KioskHeader — the 66px kiosk header: brand + dining mode, quick search, live clock, language toggle, reset. Pure presentational slice of SelfOrderingKioskPage; all state and handlers live in the facade. */

import { useTranslation } from 'react-i18next';
import { DisplayLanguageToggle } from '@/shared/components/DisplayLanguageToggle';
import { ArrowRightIcon, SearchIcon, UtensilsIcon, XIcon } from '@/shared/components/icons/AppIcons';

interface KioskHeaderProps {
  storeDisplayName: string;
  diningMode: 'dine_in' | 'takeaway' | null;
  onToggleDiningMode: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  currentTime: string;
  currentLang: string;
  onToggleLanguage: () => void;
  onReset: () => void;
}

export function KioskHeader({
  storeDisplayName,
  diningMode,
  onToggleDiningMode,
  searchQuery,
  onSearchChange,
  currentTime,
  currentLang,
  onToggleLanguage,
  onReset,
}: KioskHeaderProps) {
  const { t: __t } = useTranslation();

  return (
    <>
      {/* 1. Header: الهيدر المؤسسي المتناسق (66px) */}
      <header
        style={{
          height: '66px',
          minHeight: '66px',
          backgroundColor: '#ffffff',
          borderBottom: '1.5px solid #e2e8f0',
          padding: '0 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxSizing: 'border-box',
          zIndex: 40,
        }}
      >
        {/* بيانات المطعم والوضع */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              backgroundColor: '#170e5e',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <UtensilsIcon size={20} color="#ffffff" />
          </div>

          <div>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 900, color: '#0f172a' }}>
              {storeDisplayName}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  color: diningMode === 'dine_in' ? '#1e40af' : '#15803d',
                }}
              >
                {__t('pos.self_ordering_kiosk_page.s35', __t('pos.self_ordering_kiosk_page.s35', "الوضع:"))} {diningMode === 'dine_in' ? __t('pos.self_ordering_kiosk_page.s36', __t('pos.self_ordering_kiosk_page.s36', "تناول بالصالة")) : __t('pos.self_ordering_kiosk_page.s37', __t('pos.self_ordering_kiosk_page.s37', "استلام سفري"))}
              </span>
              <button
                type="button"
                onClick={onToggleDiningMode}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  fontSize: '11px',
                  fontWeight: 700,
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {__t('pos.self_ordering_kiosk_page.s38', __t('pos.self_ordering_kiosk_page.s38', "(تغيير)"))}
              </button>
            </div>
          </div>
        </div>

        {/* خانة البحث السريع باللمس */}
        <div style={{ flex: 1, maxWidth: '340px', margin: '0 16px', position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#94a3b8',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <SearchIcon size={16} />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={__t('pos.self_ordering_kiosk_page.s39', __t('pos.self_ordering_kiosk_page.s39', "ابحث عن صنف..."))}
            style={{
              width: '100%',
              height: '38px',
              borderRadius: '12px',
              border: '1.5px solid #e2e8f0',
              padding: '0 36px 0 32px',
              fontSize: '12.5px',
              fontWeight: 600,
              backgroundColor: '#f8fafc',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '4px',
              }}
            >
              <XIcon size={14} />
            </button>
          )}
        </div>

        {/* الساعة وأزرار التبديل والبدء من جديد */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <DisplayLanguageToggle currentLang={currentLang} onToggle={onToggleLanguage} style={{ height: '36px', fontSize: '13px' }} />

          {currentTime && (
            <div
              style={{
                fontSize: '12.5px',
                fontWeight: 800,
                color: '#475569',
                backgroundColor: '#f1f5f9',
                padding: '6px 10px',
                borderRadius: '10px',
              }}
            >
              {currentTime}
            </div>
          )}

          <button
            type="button"
            onClick={onReset}
            style={{
              backgroundColor: '#f1f5f9',
              border: 'none',
              borderRadius: '10px',
              padding: '7px 12px',
              fontSize: '12px',
              fontWeight: 800,
              color: '#475569',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <ArrowRightIcon size={14} />
            <span>{__t('pos.self_ordering_kiosk_page.s42', __t('pos.self_ordering_kiosk_page.s42', "البدء من جديد"))}</span>
          </button>
        </div>
      </header>
    </>
  );
}
