import { useTranslation } from 'react-i18next';
import { TrendingUpIcon, SlidersIcon } from '@/shared/components/icons/AppIcons';
import type { Dispatch, SetStateAction } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { StorefrontAnalytics } from '../../types/storefront.types';
import type { NavigateFunction } from 'react-router-dom';

export interface MerchantOrdersViewSwitcherProps {
  setViewMode: Dispatch<SetStateAction<'overview' | 'orders' | 'abandoned'>>;
  viewMode: 'overview' | 'orders' | 'abandoned';
  counts: Record<string, number> | undefined;
  analyticsQuery: UseQueryResult<{ ok: boolean } & StorefrontAnalytics, Error>;
  navigate: NavigateFunction;
}

export function MerchantOrdersViewSwitcher({
  setViewMode,
  viewMode,
  counts,
  analyticsQuery,
  navigate,
}: MerchantOrdersViewSwitcherProps) {
  const { t } = useTranslation();
  return (
    <div
      className="merchant-orders-view-switcher"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        marginBottom: '14px',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
        maxWidth: '100%',
        paddingBottom: '4px',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setViewMode('overview')}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            border: viewMode === 'overview' ? '2px solid #170e5e' : '1px solid #cbd5e1',
            background: viewMode === 'overview' ? '#170e5e' : '#ffffff',
            color: viewMode === 'overview' ? '#ffffff' : '#334155',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: viewMode === 'overview' ? '0 2px 6px rgba(23, 14, 94, 0.2)' : 'none',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          <TrendingUpIcon size={14} color={viewMode === 'overview' ? '#ffffff' : '#475569'} />
          <span>لوحة القيادة والتحليلات (Overview)</span>
        </button>

        <button
          type="button"
          onClick={() => setViewMode('orders')}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            border: viewMode === 'orders' ? '2px solid #170e5e' : '1px solid #cbd5e1',
            background: viewMode === 'orders' ? '#170e5e' : '#ffffff',
            color: viewMode === 'orders' ? '#ffffff' : '#334155',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: viewMode === 'orders' ? '0 2px 6px rgba(23, 14, 94, 0.2)' : 'none',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          <span>{t('storefront.merchant_online_orders_page.s21', "طلبات المتجر ومسار التجهيز")}</span>
          <span
            style={{
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: '999px',
              background: viewMode === 'orders' ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
              color: viewMode === 'orders' ? '#ffffff' : '#0f172a',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {counts?.all || 0}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setViewMode('abandoned')}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            border: viewMode === 'abandoned' ? '2px solid #170e5e' : '1px solid #cbd5e1',
            background: viewMode === 'abandoned' ? '#170e5e' : '#ffffff',
            color: viewMode === 'abandoned' ? '#ffffff' : '#334155',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: viewMode === 'abandoned' ? '0 2px 6px rgba(23, 14, 94, 0.2)' : 'none',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          <span>{t('storefront.merchant_online_orders_page.s22', "السلات المتروكة (Abandoned Carts)")}</span>
          {(analyticsQuery.data?.unrecoveredAbandoned ?? 0) > 0 ? (
            <span
              style={{
                fontSize: '11px',
                padding: '1px 6px',
                borderRadius: '999px',
                background: viewMode === 'abandoned' ? '#ef4444' : '#fee2e2',
                color: viewMode === 'abandoned' ? '#ffffff' : '#991b1b',
                fontWeight: 800,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {analyticsQuery.data?.unrecoveredAbandoned}
            </span>
          ) : null}
        </button>
      </div>

      <button
        type="button"
        onClick={() => navigate('/settings/storefront')}
        style={{
          padding: '7px 14px',
          borderRadius: '8px',
          border: '1px solid #cbd5e1',
          background: '#f8fafc',
          color: '#170e5e',
          fontSize: '12px',
          fontWeight: 800,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          whiteSpace: 'nowrap',
        }}
      >
        <SlidersIcon size={14} color="#170e5e" />
        <span>تهيئة وهوية المتجر (Settings)</span>
      </button>
    </div>
  );
}
