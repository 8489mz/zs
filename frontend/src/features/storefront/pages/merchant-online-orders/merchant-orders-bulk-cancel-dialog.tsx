import { useTranslation } from 'react-i18next';
import { StandardDialog } from '@/shared/components/StandardDialog';
import type { Dispatch, SetStateAction } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';

export interface MerchantOrdersBulkCancelDialogProps {
  isBulkCancelModalOpen: boolean;
  bulkCancelMutation: UseMutationResult<{ ok: boolean; cancelledCount: number; message: string }, Error, void>;
  setIsBulkCancelModalOpen: Dispatch<SetStateAction<boolean>>;
  setAdminPassword: Dispatch<SetStateAction<string>>;
  adminPassword: string;
  pendingOrdersCount: number;
}

export function MerchantOrdersBulkCancelDialog({
  isBulkCancelModalOpen,
  bulkCancelMutation,
  setIsBulkCancelModalOpen,
  setAdminPassword,
  adminPassword,
  pendingOrdersCount,
}: MerchantOrdersBulkCancelDialogProps) {
  const { t } = useTranslation();
  return (
    <StandardDialog
      open={isBulkCancelModalOpen}
      onClose={() => {
        if (!bulkCancelMutation.isPending) {
          setIsBulkCancelModalOpen(false);
          setAdminPassword('');
        }
      }}
      title={t('storefront.merchant_online_orders_page.s57', "إلغاء جماعي للطلبات المعلقة")}
      subtitle={t('storefront.merchant_online_orders_page.s58', "يتطلب إدخال كلمة مرور مسؤول النظام (Admin) لتأكيد الإلغاء")}
      width="480px"
      footerActions={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
          <button
            type="button"
            disabled={bulkCancelMutation.isPending}
            onClick={() => {
              setIsBulkCancelModalOpen(false);
              setAdminPassword('');
            }}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#475569',
              fontSize: '13px',
              fontWeight: 700,
              cursor: bulkCancelMutation.isPending ? 'not-allowed' : 'pointer',
            }}
          >
            {t('storefront.merchant_online_orders_page.s59', "تراجع")}
          </button>
          <button
            type="button"
            disabled={bulkCancelMutation.isPending || !adminPassword.trim()}
            onClick={() => bulkCancelMutation.mutate()}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              border: 'none',
              background: '#dc2626',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 700,
              cursor: (bulkCancelMutation.isPending || !adminPassword.trim()) ? 'not-allowed' : 'pointer',
              opacity: (bulkCancelMutation.isPending || !adminPassword.trim()) ? 0.6 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {bulkCancelMutation.isPending ? t('storefront.merchant_online_orders_page.s60', "جاري الإلغاء وفك الحجز...") : `تأكيد إلغاء ${pendingOrdersCount.toLocaleString()} طلب`}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '6px 0' }}>
        <div
          style={{
            background: '#fff1f2',
            border: '1px solid #fecdd3',
            borderRadius: '8px',
            padding: '12px 14px',
            color: '#9f1239',
            fontSize: '12.5px',
            lineHeight: 1.5,
          }}
        >
          <strong>{t('storefront.merchant_online_orders_page.s61', "تنبيه أمني وإداري:")}</strong> {t('storefront.merchant_online_orders_page.s62', "سيتم إلغاء كافة الطلبات ذات الحالة \"قيد الانتظار\" (")}{pendingOrdersCount.toLocaleString()} {t('storefront.merchant_online_orders_page.s63', "طلب) وإلغاء حجز المخزون الخاص بها فوراً. هذا الإجراء مخصص لمسؤولي المنشأة فقط ولا يُسمح للكاشير بتنفيذه.")}
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
            {t('storefront.merchant_online_orders_page.s64', "كلمة مرور المسؤول (Admin Password)")} <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <input
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            placeholder={t('storefront.merchant_online_orders_page.s65', "أدخل كلمة مرور الأدمن للتأكيد...")}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && adminPassword.trim() && !bulkCancelMutation.isPending) {
                bulkCancelMutation.mutate();
              }
            }}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1.5px solid #cbd5e1',
              fontSize: '13px',
              outline: 'none',
            }}
          />
          <span style={{ display: 'block', fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
            {t('storefront.merchant_online_orders_page.s66', "لن يتم قبول كلمة مرور الكاشير أو أي مستخدم لا يملك صلاحية مدير النظام (Admin).")}
          </span>
        </div>
      </div>
    </StandardDialog>
  );
}
