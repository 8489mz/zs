import { PageHeader } from '@/shared/components/page-header';
import { ClockIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrencyWithSymbol } from '@/lib/format';
import { Button } from '@/shared/ui/button';
import { systemConfirm } from '@/shared/components/system-alert';
import type { useTranslation } from 'react-i18next';
import type { useNavigate } from 'react-router-dom';

export interface CreateQuotationPageHeaderProps {
  t: ReturnType<typeof useTranslation>['t'];
  calculations: { rawSubtotal: number; totalDiscount: number; netTaxable: number; taxTotal: number; grandTotal: number };
  currency: string;
  clearDraft: () => void;
  navigate: ReturnType<typeof useNavigate>;
  handleSubmit: (approve: boolean) => void;
  isSubmitting: boolean;
}

export function CreateQuotationPageHeader(props: CreateQuotationPageHeaderProps) {
  const { t, calculations, currency, clearDraft, navigate, handleSubmit, isSubmitting } = props;
  return (
    <>
    {/* Universal Page Header */}
    <PageHeader
      title={t('sales.create_quotation_page.s0', "إنشاء عرض سعر جديد (Quotation)")}
      description={t('sales.create_quotation_page.s1', "تجهيز وتسعير عروض الأسعار الرسمية للعملاء، حساب الضرائب والخصومات، وتوثيق الشروط التعاقدية وفترة الصلاحية.")}
      badge={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="badge is-draft" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <ClockIcon size={12} />
            {t('sales.create_quotation_page.s2', "مسودة عرض سعر")}
          </span>
          <span className="badge" style={{ backgroundColor: '#f1f5f9', color: '#1e293b', fontWeight: 700 }}>
            {formatCurrencyWithSymbol(calculations.grandTotal, currency)}
          </span>
        </div>
      }
      actions={
        <div className="actions compact-actions" style={{ display: 'flex', gap: '8px' }}>
          <Button
            variant="secondary"
            onClick={async () => {
              const ok = await systemConfirm({
                title: t('sales.create_quotation_page.s3', "إلغاء المسودة"),
                message: t('sales.create_quotation_page.s4', "هل أنت متأكد من إلغاء المسودة والعودة؟"),
                confirmText: t('sales.create_quotation_page.s5', "إلغاء المسودة"),
                variant: 'danger',
              });
              if (ok) {
                clearDraft();
                navigate('/quotations');
              }
            }}
            style={{ color: '#dc2626', borderColor: '#fecaca' }}
          >
            {t('sales.create_quotation_page.s6', "إلغاء المسودة")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => handleSubmit(false)}
            disabled={isSubmitting}
          >
            {t('sales.create_quotation_page.s7', "حفظ كمسودة")}
          </Button>
          <Button
            variant="primary"
            onClick={() => handleSubmit(true)}
            disabled={isSubmitting}
            style={{ backgroundColor: '#170e5e', color: '#ffffff', minWidth: '130px' }}
          >
            {isSubmitting ? t('sales.create_quotation_page.s8', "جاري الحفظ...") : t('sales.create_quotation_page.s9', "اعتماد عرض السعر")}
          </Button>
        </div>
      }
    />
    </>
  );
}
