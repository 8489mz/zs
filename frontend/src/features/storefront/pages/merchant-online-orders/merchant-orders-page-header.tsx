import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/shared/components/page-header';
import { Trash2Icon, CheckIcon, CopyIcon } from '@/shared/components/icons/AppIcons';
import type { Dispatch, SetStateAction } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';

export interface MerchantOrdersPageHeaderProps {
  storeUrl: string;
  pendingOrdersCount: number;
  setAdminPassword: Dispatch<SetStateAction<string>>;
  setIsBulkCancelModalOpen: Dispatch<SetStateAction<boolean>>;
  handleCopyLink: () => void;
  copySuccess: boolean;
  handleReapExpired: () => Promise<void>;
  reapExpiredMutation: UseMutationResult<{ reapedOrdersCount: number; reapedOrderNumbers: string[]; scannedCount: number }, Error, void>;
}

export function MerchantOrdersPageHeader({
  storeUrl,
  pendingOrdersCount,
  setAdminPassword,
  setIsBulkCancelModalOpen,
  handleCopyLink,
  copySuccess,
  handleReapExpired,
  reapExpiredMutation,
}: MerchantOrdersPageHeaderProps) {
  const { t } = useTranslation();
  return (
    <PageHeader
      title={t('storefront.merchant_online_orders_page.s0', "إدارة ومتابعة طلبات المتجر الإلكتروني")}
      badge={<span className="nav-pill" style={{ background: '#f0f3ff', color: '#170e5e', border: '1px solid #d8e0fc' }}>{t('storefront.merchant_online_orders_page.s1', "مباشر ومربوط بالمخزن")}</span>}
      description={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
          <span style={{ fontSize: '12.5px', color: '#64748b' }}>{t('storefront.merchant_online_orders_page.s2', "رابط متجرك للزبائن:")}</span>
          <span style={{ fontSize: '13px', fontFamily: 'monospace', direction: 'ltr', color: '#170e5e', fontWeight: 800 }}>
            {storeUrl}
          </span>
        </div>
      }
      actions={
        <div className="actions compact-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {pendingOrdersCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setAdminPassword('');
                setIsBulkCancelModalOpen(true);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                height: '36px',
                padding: '0 14px',
                borderRadius: '8px',
                background: '#fef2f2',
                color: '#dc2626',
                border: '1px solid #fecaca',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(220, 38, 38, 0.05)',
                boxSizing: 'border-box',
              }}
            >
              <Trash2Icon size={14} color="#dc2626" />
              <span>{t('storefront.merchant_online_orders_page.s3', "إلغاء الطلبات المعلقة (")}{pendingOrdersCount.toLocaleString()})</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleCopyLink}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              height: '36px',
              padding: '0 14px',
              borderRadius: '8px',
              background: '#ffffff',
              color: copySuccess ? '#166534' : '#334155',
              border: copySuccess ? '1.5px solid #22c55e' : '1px solid #cbd5e1',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
              boxSizing: 'border-box',
            }}
          >
            {copySuccess ? <CheckIcon size={14} color="#166534" /> : <CopyIcon size={14} color="#64748b" />}
            <span>{copySuccess ? t('storefront.merchant_online_orders_page.s4', "تم نسخ الرابط!") : t('storefront.merchant_online_orders_page.s5', "نسخ رابط المتجر")}</span>
          </button>
          <a
            href={storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              height: '36px',
              padding: '0 14px',
              borderRadius: '8px',
              background: '#170e5e',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 700,
              textDecoration: 'none',
              boxShadow: '0 1px 3px rgba(23,14,94,0.2)',
              boxSizing: 'border-box',
            }}
          >
            <span>{t('storefront.merchant_online_orders_page.s6', "معاينة المتجر كزبون")}</span>
            <span style={{ fontSize: '13px' }}>↗</span>
          </a>
          {/* D-SF-12: manual expired-reservation reap — the scheduler runs it every 2 min; this runs it now. */}
          <button
            type="button"
            onClick={handleReapExpired}
            disabled={reapExpiredMutation.isPending}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              height: '36px',
              padding: '0 14px',
              borderRadius: '8px',
              background: '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              fontWeight: 700,
              fontSize: '13px',
              cursor: reapExpiredMutation.isPending ? 'wait' : 'pointer',
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
              boxSizing: 'border-box',
            }}
          >
            <span>{reapExpiredMutation.isPending ? t('storefront.merchant_online_orders_page.s59', "جارٍ فحص الطلبات المنتهية...") : t('storefront.merchant_online_orders_page.s60', "فحص الطلبات المنتهية الآن")}</span>
          </button>
        </div>
      }
    />
  );
}
