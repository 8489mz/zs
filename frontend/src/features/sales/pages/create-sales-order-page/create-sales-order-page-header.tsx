import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { DraftRestoredBanner } from '@/shared/components/DraftRestoredBanner';
import { formatCurrencyWithSymbol } from '@/lib/format';
import { toast } from '@/shared/components/system-alert';
import { useTranslation } from 'react-i18next';
import type { NavigateFunction } from 'react-router-dom';

export interface CreateSalesOrderPageHeaderProps {
  t: ReturnType<typeof useTranslation>['t'];
  navigate: NavigateFunction;
  totalAmount: number;
  currency: string;
  handleSubmit: () => void;
  isSubmitting: boolean;
  isDraftRestored: boolean;
  resetForm: () => void;
  dismissRestoredNotice: () => void;
}
export function CreateSalesOrderPageHeader({ t, navigate, totalAmount, currency, handleSubmit, isSubmitting, isDraftRestored, resetForm, dismissRestoredNotice }: CreateSalesOrderPageHeaderProps) {
  return (
    <>
    {/* Universal Document Header */}
    <PageHeader
      title={t('sales.create_sales_order_page.s0', "أمر بيع جديد")}
      onBack={() => navigate('/sales/orders')}
      badge={
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span className="document-prototype-status-badge is-draft">{t('sales.create_sales_order_page.s1', "مسودة")}</span>
          <span className="nav-pill" style={{ fontWeight: 700, color: '#0f172a' }}>
            {t('sales.create_sales_order_page.s2', "الإجمالي:")} {formatCurrencyWithSymbol(totalAmount, currency)}
          </span>
        </div>
      }
      actions={
        <div className="actions compact-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Button
            variant="secondary"
            type="button"
            className="purchase-prototype-toolbar-action purchase-prototype-toolbar-action-secondary"
            onClick={() => navigate('/sales/orders')}
            style={{ color: 'var(--danger-color)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
          >
            <span>{t('sales.create_sales_order_page.s3', "إلغاء المسودة")}</span>
          </Button>
          <Button
            variant="secondary"
            type="button"
            className="purchase-prototype-toolbar-action purchase-prototype-toolbar-action-secondary"
            onClick={() => {
              toast.success(t('sales.create_sales_order_page.s4', "تم حفظ مسودة أمر البيع بنجاح"));
            }}
          >
            <span>{t('sales.create_sales_order_page.s5', "حفظ كمسودة")}</span>
          </Button>
          <Button
            type="button"
            className="purchase-prototype-toolbar-action purchase-prototype-toolbar-action-primary"
            onClick={() => handleSubmit()}
            disabled={isSubmitting}
            style={{ backgroundColor: '#170e5e', color: '#ffffff' }}
          >
            <span>{isSubmitting ? t('sales.create_sales_order_page.s6', "جارٍ الاعتماد...") : t('sales.create_sales_order_page.s7', "اعتماد أمر البيع")}</span>
          </Button>
        </div>
      }
    />

    <DraftRestoredBanner
      show={isDraftRestored}
      onClear={resetForm}
      onDismiss={dismissRestoredNotice}
    />
    </>
  );
}
