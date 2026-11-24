import { Button } from '@/shared/ui/button';
import type { useTranslation } from 'react-i18next';

export interface ProductsTableCardHeaderProps {
  t: ReturnType<typeof useTranslation>['t'];
  setIsStudioOpen: (val: boolean) => void;
  __t: ReturnType<typeof useTranslation>['t'];
  handleAutoAssignIcons: () => Promise<void>;
  isAutoAssigning: boolean;
}

export function ProductsTableCardHeader({ t, setIsStudioOpen, __t, handleAutoAssignIcons, isAutoAssigning }: ProductsTableCardHeaderProps) {
  return (
    <>
    <div className="section-header-compact-row">
      <h3 className="document-prototype-section-title">{t('products.current_items_list', 'قائمة الأصناف الحالية')}</h3>
      <div className="section-header-actions-group">
        <Button
          variant="secondary"
          onClick={() => setIsStudioOpen(true)}
          className="section-header-action-btn"
          title={__t('products.products_table_card.s0', "تخصيص ألوان الأيقونات لكل المنظومة أو إلغاء وتفريغ الأيقونات")}
        >
          {t('products.icons_btn', 'الأيقونات')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void handleAutoAssignIcons()}
          disabled={isAutoAssigning}
          className="section-header-action-btn"
          style={{ marginInlineStart: '6px' }}
          title={__t('products.products_table_card.s1', "فحص أسماء الأصناف وتعيين الأيقونات المناسبة لها تلقائياً")}
        >
          {isAutoAssigning ? __t('products.products_table_card.s2', "جارٍ الضبط...") : t('products.smart_assign_btn', 'ضبط ذكي')}
        </Button>
      </div>
    </div>
    <p className="muted small section-header-subtitle">
      {t('products.items_list_desc', 'إدارة وتسعير ومتابعة مخزون المنتجات والأصناف.')}
    </p>
    </>
  );
}
