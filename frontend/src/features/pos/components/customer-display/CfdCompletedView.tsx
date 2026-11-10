import { useTranslation } from 'react-i18next';
import React from 'react';
import { CheckIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';
import type { CustomerDisplayPayload } from '@/features/pos/types/pos-customer-display.types';

interface CfdCompletedViewProps {
  payload: CustomerDisplayPayload;
}

export const CfdCompletedView: React.FC<CfdCompletedViewProps> = ({ payload }) => {
  const { t } = useTranslation();
  return (
    <div className="cfd-completed-view">
      <div className="cfd-completed-card">
        <div className="cfd-success-icon-wrap" aria-hidden="true">
          <CheckIcon size={40} color="#16a34a" strokeWidth={2.5} />
        </div>

        <div className="cfd-completed-title">{t('pos.customer_display.cfd_completed_view.s0', "تمت عملية الشراء بنجاح!")}</div>
        <div className="cfd-completed-subtitle">
          {t('pos.customer_display.cfd_completed_view.s1', "شكراً لزيارتكم في")} {payload.storeName}{t('pos.customer_display.cfd_completed_view.s2', ". نسعد دائماً بخدمتكم ونتطلع لرؤيتكم قريباً!")}
        </div>

        {payload.completedSale && (
          <div className="cfd-sale-meta-grid">
            <div className="cfd-sale-meta-box">
              <div className="cfd-sale-meta-label">{t('pos.customer_display.cfd_completed_view.s3', "رقم الفاتورة")}</div>
              <div className="cfd-sale-meta-val">#{payload.completedSale.docNo}</div>
            </div>

            <div className="cfd-sale-meta-box">
              <div className="cfd-sale-meta-label">{t('pos.customer_display.cfd_completed_view.s4', "المبلغ الإجمالي")}</div>
              <div className="cfd-sale-meta-val">{formatCurrency(payload.completedSale.total)}</div>
            </div>

            <div className="cfd-sale-meta-box">
              <div className="cfd-sale-meta-label">{t('pos.customer_display.cfd_completed_view.s5', "المبلغ المدفوع")}</div>
              <div className="cfd-sale-meta-val">{formatCurrency(payload.completedSale.paidAmount)}</div>
            </div>

            <div className="cfd-sale-meta-box">
              <div className="cfd-sale-meta-label">{t('pos.customer_display.cfd_completed_view.s6', "طريقة السداد")}</div>
              <div className="cfd-sale-meta-val" style={{ fontSize: '15px' }}>{t('pos.customer_display.cfd_completed_view.s7', "نقداً / إلكتروني")}</div>
            </div>

            {payload.completedSale.change > 0 && (
              <div className="cfd-sale-change-box">
                <div className="cfd-sale-meta-label" style={{ color: '#166534', fontSize: '14px' }}>
                  {t('pos.customer_display.cfd_completed_view.s8', "المتبقي المسترد للعميل")}
                </div>
                <div className="cfd-sale-meta-val">
                  {formatCurrency(payload.completedSale.change)}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '14px' }}>
          {t('pos.customer_display.cfd_completed_view.s9', "سيتم العودة للشاشة الرئيسية تلقائياً خلال ثوانٍ...")}
        </div>
      </div>
    </div>
  );
};
