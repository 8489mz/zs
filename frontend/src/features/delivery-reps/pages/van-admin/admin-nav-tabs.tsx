import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { TruckIcon, UsersIcon, SlidersIcon, FileTextIcon, CreditCardIcon, CheckCircleIcon, CheckShieldIcon, MapPinIcon } from '@/shared/components/icons/AppIcons';
import type { SetURLSearchParams } from 'react-router-dom';
import type { VanFieldReturnRecord, VanLoadRequisitionRecord } from '../../api/van-sales.api';
import type { DeliveryRep } from '../../hooks/useVanSalesAdmin';
import type { VanAdminTabKey } from './van-admin-types';

export interface AdminNavTabsProps {
  activeTab: VanAdminTabKey;
  pendingRequisitions: VanLoadRequisitionRecord[];
  pendingReturns: VanFieldReturnRecord[];
  pendingShortagesCount: number;
  setActiveTab: Dispatch<SetStateAction<VanAdminTabKey>>;
  setSearchParams: SetURLSearchParams;
  suspicionEventsCount: number;
  vanDrivers: DeliveryRep[];
}

export function AdminNavTabs({
  activeTab,
  pendingRequisitions,
  pendingReturns,
  pendingShortagesCount,
  setActiveTab,
  setSearchParams,
  suspicionEventsCount,
  vanDrivers,
}: AdminNavTabsProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        background: '#ffffff',
        padding: '8px',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Row 1: Core Field Operations, Cash/Stock Ledgers & Requisitions */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
          gap: '6px',
          width: '100%',
        }}
      >
        {[
          {
            key: 'trips' as const,
            label: t('delivery_reps.van_sales_admin_management_page.s4', "رحلات التوزيع"),
            icon: <SlidersIcon size={14} />,
          },
          {
            key: 'financial_ledger' as const,
            label: t('delivery_reps.van_sales_admin_management_page.s5', "تسويات وحسابات المناديب"),
            count: pendingShortagesCount > 0 ? pendingShortagesCount : undefined,
            badgeBg: '#fee2e2',
            badgeColor: '#dc2626',
            icon: <CreditCardIcon size={14} />,
          },
          {
            key: 'requisitions' as const,
            label: t('delivery_reps.van_sales_admin_management_page.s6', "أذونات التحميل"),
            count: pendingRequisitions.length > 0 ? pendingRequisitions.length : undefined,
            badgeBg: '#fef3c7',
            badgeColor: '#b45309',
            icon: <TruckIcon size={14} />,
          },
          {
            key: 'presales' as const,
            label: t('delivery_reps.van_sales_admin_management_page.s7', "طلبيات وحجوزات الميدان"),
            icon: <FileTextIcon size={14} />,
          },
          {
            key: 'returns' as const,
            label: t('delivery_reps.van_sales_admin_management_page.s8', "مرتجعات الميدان"),
            count: pendingReturns.length > 0 ? pendingReturns.length : undefined,
            badgeBg: '#fee2e2',
            badgeColor: '#b91c1c',
            icon: <FileTextIcon size={14} />,
          },
          {
            key: 'routes_kpis' as const,
            label: t('delivery_reps.van_sales_admin_management_page.s9', "خطوط السير والرقابة"),
            icon: <MapPinIcon size={14} />,
          },
        ].map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setActiveTab(tab.key);
                setSearchParams({ tab: tab.key });
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                height: '36px',
                padding: '0 8px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                border: isActive ? '1px solid #170e5e' : '1px solid #e2e8f0',
                background: isActive ? '#170e5e' : '#f8fafc',
                color: isActive ? '#ffffff' : '#334155',
                cursor: 'pointer',
                transition: 'none',
                boxSizing: 'border-box',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = '#f1f5f9';
                  e.currentTarget.style.borderColor = '#cbd5e1';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = '#f8fafc';
                  e.currentTarget.style.borderColor = '#e2e8f0';
                }
              }}
            >
              <span style={{ display: 'inline-flex', flexShrink: 0, opacity: isActive ? 1 : 0.85 }}>
                {tab.icon}
              </span>
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.label}
              </span>
              {tab.count !== undefined && (
                <span
                  style={{
                    flexShrink: 0,
                    background: isActive
                      ? 'rgba(255,255,255,0.22)'
                      : tab.badgeBg || '#e2e8f0',
                    color: isActive ? '#ffffff' : tab.badgeColor || '#475569',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: '10px',
                    minWidth: '16px',
                    textAlign: 'center',
                    lineHeight: '15px',
                  }}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Subtle Row Separator */}
      <div style={{ height: '1px', backgroundColor: '#f1f5f9', margin: '1px 2px' }} />

      {/* Row 2: Governance, Commercial, Tracking & Fleet */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
          gap: '6px',
          width: '100%',
        }}
      >
        {[
          {
            key: 'radar' as const,
            label: t('delivery_reps.van_sales_admin_management_page.s10', "رادار الشبهات والأمان"),
            count: suspicionEventsCount > 0 ? suspicionEventsCount : undefined,
            badgeBg: '#fee2e2',
            badgeColor: '#dc2626',
            icon: <CheckShieldIcon size={14} />,
          },
          {
            key: 'visits_tracking' as const,
            label: t('delivery_reps.van_sales_admin_management_page.s11', "التتبع والميدان Live"),
            icon: <MapPinIcon size={14} />,
          },
          {
            key: 'targets' as const,
            label: t('delivery_reps.van_sales_admin_management_page.s12', "مستهدفات البيع والتارجت"),
            icon: <CheckCircleIcon size={14} />,
          },
          {
            key: 'promotions' as const,
            label: t('delivery_reps.van_sales_admin_management_page.s13', "عروض وخلطات الأسعار"),
            icon: <SlidersIcon size={14} />,
          },
          {
            key: 'fleet' as const,
            label: t('delivery_reps.van_sales_admin_management_page.s14', "أسطول وسيارات الفان"),
            icon: <TruckIcon size={14} />,
          },
          {
            key: 'drivers' as const,
            label: t('delivery_reps.van_sales_admin_management_page.s15', "بيانات مناديب التوزيع"),
            count: vanDrivers.length,
            badgeBg: '#e2e8f0',
            badgeColor: '#334155',
            icon: <UsersIcon size={14} />,
          },
        ].map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setActiveTab(tab.key);
                setSearchParams({ tab: tab.key });
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                height: '36px',
                padding: '0 8px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                border: isActive ? '1px solid #170e5e' : '1px solid #e2e8f0',
                background: isActive ? '#170e5e' : '#f8fafc',
                color: isActive ? '#ffffff' : '#334155',
                cursor: 'pointer',
                transition: 'none',
                boxSizing: 'border-box',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = '#f1f5f9';
                  e.currentTarget.style.borderColor = '#cbd5e1';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = '#f8fafc';
                  e.currentTarget.style.borderColor = '#e2e8f0';
                }
              }}
            >
              <span style={{ display: 'inline-flex', flexShrink: 0, opacity: isActive ? 1 : 0.85 }}>
                {tab.icon}
              </span>
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.label}
              </span>
              {tab.count !== undefined && (
                <span
                  style={{
                    flexShrink: 0,
                    background: isActive
                      ? 'rgba(255,255,255,0.22)'
                      : tab.badgeBg || '#e2e8f0',
                    color: isActive ? '#ffffff' : tab.badgeColor || '#475569',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: '10px',
                    minWidth: '16px',
                    textAlign: 'center',
                    lineHeight: '15px',
                  }}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
