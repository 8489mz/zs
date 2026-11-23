import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';

interface MerchantOrdersReaperBannerProps {
  reapStatusQuery: UseQueryResult<{ lastSweep: { completedAt: string; scannedCount: number; reapedOrdersCount: number; reapedOrderNumbers: string[]; skippedWhileRunning: boolean; wedgedReset: boolean; error: string | null } | null; onlineTimeoutMs: number; codTimeoutMs: number }, Error>;
}

export function MerchantOrdersReaperBanner({ reapStatusQuery }: MerchantOrdersReaperBannerProps) {
  const { t } = useTranslation();
  return (
    <div style={{ fontSize: '12.5px', color: '#64748b', marginBottom: '12px' }}>
      {reapStatusQuery.data.lastSweep ? (
        <>
          <span>{t('storefront.merchant_online_orders_page.s61', "آخر فحص تلقائي للطلبات المنتهية: ")}</span>
          <span>{new Date(reapStatusQuery.data.lastSweep.completedAt).toLocaleString(t('common.locale', 'en-US') === 'en-US' ? 'en-US' : 'ar-EG', { dateStyle: 'short', timeStyle: 'short' })}</span>
          <span>{t('storefront.merchant_online_orders_page.s62', " — تم فحص ")}</span>
          <span>{reapStatusQuery.data.lastSweep.scannedCount.toLocaleString()}</span>
          <span>{t('storefront.merchant_online_orders_page.s63', " طلب، وأُلغي ")}</span>
          <span>{reapStatusQuery.data.lastSweep.reapedOrdersCount.toLocaleString()}</span>
          {reapStatusQuery.data.lastSweep.skippedWhileRunning && (
            <span>{t('storefront.merchant_online_orders_page.s64', " — تم تخطي الفحص لأن الفحص السابق كان لا يزال يعمل")}</span>
          )}
          {reapStatusQuery.data.lastSweep.error && (
            <span>{t('storefront.merchant_online_orders_page.s65', " — خطأ: ")}{reapStatusQuery.data.lastSweep.error}</span>
          )}
        </>
      ) : (
        <span>{t('storefront.merchant_online_orders_page.s66', "الفحص التلقائي للطلبات المنتهية لم يعمل بعد.")}</span>
      )}
    </div>
  );
}
