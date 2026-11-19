import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { RefreshCwIcon } from '@/shared/components/icons/AppIcons';
import { VanFloatingActionBar } from '../VanFloatingActionBar';
import type { RequisitionLineItem } from './LoadRequisitionTypes';
import type { VanLoadRequisitionRecord } from '../../hooks/useDriverLoadRequisition';

export interface LoadRequisitionSummaryBarProps {
  distinctItemsCount: number;
  distinctWarehousesCount: number;
  totalUnitsCount: number;
  totalEstimatedValue: number;
  validLines: RequisitionLineItem[];
  selectedWarehouseFilter: string;
  activeViewTab: 'catalog' | 'selected';
  setActiveViewTab: (tab: 'catalog' | 'selected') => void;
  isAdmin: boolean;
  pendingRequisition: VanLoadRequisitionRecord | null;
  isSubmitting: boolean;
  isCancellingRequisition: boolean;
  hasDraftContent: boolean;
  hasSavedDraft: boolean;
  handleAdminSubmit: (dispatchImmediately: boolean) => Promise<void>;
  handleCancelPendingAndRestore: () => Promise<void>;
  handleSubmit: () => Promise<void>;
  handleClearDraft: () => Promise<void>;
  adminSubmitMutation: { isPending: boolean };
}

export function LoadRequisitionSummaryBar({
  distinctItemsCount,
  distinctWarehousesCount,
  totalUnitsCount,
  totalEstimatedValue,
  validLines,
  selectedWarehouseFilter,
  activeViewTab,
  setActiveViewTab,
  isAdmin,
  pendingRequisition,
  isSubmitting,
  isCancellingRequisition,
  hasDraftContent,
  hasSavedDraft,
  handleAdminSubmit,
  handleCancelPendingAndRestore,
  handleSubmit,
  handleClearDraft,
  adminSubmitMutation,
}: LoadRequisitionSummaryBarProps) {
  const { t } = useTranslation();

  return (
    <>
        {/* BOTTOM SUMMARY CARD & ACTIONS */}
        <section
          style={{
            position: 'sticky',
            bottom: '10px',
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid #cbd5e1',
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            marginTop: '10px',
            zIndex: 30,
          }}
        >
          {distinctWarehousesCount > 1 && selectedWarehouseFilter === 'all' && (
            <div
              style={{
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '8px',
                padding: '6px 10px',
                fontSize: '11px',
                color: '#1e40af',
                fontWeight: 600,
                lineHeight: 1.45,
                textAlign: 'center',
              }}
            >
              {t('delivery_reps.driver_new_load_requisition_view.s98', "الأصناف المطلوبة تتوزع على (")}{distinctWarehousesCount}{t('delivery_reps.driver_new_load_requisition_view.s99', ") مستودعات مختلفة. سيقوم النظام تلقائياً بإصدار إذن تحميل مستقل لكل مستودع لضمان دقة الصرف المخزني.")}
            </div>
          )}

          {/* Mini-KPI Strip */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr auto 1.2fr',
              alignItems: 'center',
              width: '100%',
              gap: '4px',
              backgroundColor: '#f8fafc',
              padding: '6px 10px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>{t('delivery_reps.driver_new_load_requisition_view.s100', "الأصناف")}</span>
              <strong style={{ fontSize: '12.5px', color: '#0f172a' }}>{distinctItemsCount} {t('delivery_reps.driver_new_load_requisition_view.s101', "صنف")}</strong>
            </div>
            <div style={{ height: '18px', width: '1px', backgroundColor: '#cbd5e1' }} />
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>{t('delivery_reps.driver_new_load_requisition_view.s102', "القطع")}</span>
              <strong style={{ fontSize: '12.5px', color: '#0f172a' }}>{totalUnitsCount} {t('delivery_reps.driver_new_load_requisition_view.s103', "قطعة")}</strong>
            </div>
            <div style={{ height: '18px', width: '1px', backgroundColor: '#cbd5e1' }} />
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>{t('delivery_reps.driver_new_load_requisition_view.s104', "القيمة المقدرة")}</span>
              <strong style={{ fontSize: '13px', color: '#170e5e', fontWeight: 900 }}>
                {totalEstimatedValue.toFixed(2)} <CurrencySymbol />
              </strong>
            </div>
          </div>

          {/* Action Buttons Row */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <Button
              variant="secondary"
              type="button"
              onClick={() => setActiveViewTab(activeViewTab === 'catalog' ? 'selected' : 'catalog')}
              style={{
                flex: '1 1 auto',
                fontSize: '12px',
                fontWeight: 700,
                color: '#170e5e',
                borderColor: '#170e5e',
                padding: '7px 10px',
                height: '34px',
                whiteSpace: 'nowrap',
              }}
            >
              {activeViewTab === 'catalog'
                ? `مراجعة الأصناف (${distinctItemsCount})`
                : t('delivery_reps.driver_new_load_requisition_view.s105', "+ كتالوج الأصناف")}
            </Button>

            {isAdmin ? (
              <>
                <Button
                  variant="primary"
                  type="button"
                  onClick={() => handleAdminSubmit(true)}
                  disabled={isSubmitting || validLines.length === 0}
                  style={{
                    flex: '1.2 1 auto',
                    backgroundColor: '#170e5e',
                    color: '#ffffff',
                    fontWeight: 800,
                    fontSize: '12px',
                    padding: '7px 12px',
                    borderRadius: '7px',
                    height: '34px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {adminSubmitMutation.isPending ? t('delivery_reps.driver_new_load_requisition_view.s106', "جاري الصرف...") : `صرف وتحميل (${distinctItemsCount})`}
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => handleAdminSubmit(false)}
                  disabled={isSubmitting || validLines.length === 0}
                  style={{
                    flex: '0 0 auto',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    color: '#170e5e',
                    borderColor: '#cbd5e1',
                    padding: '7px 10px',
                    height: '34px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t('delivery_reps.driver_new_load_requisition_view.s107', "إذن معلق")}
                </Button>
              </>
            ) : pendingRequisition ? (
              <Button
                variant="primary"
                type="button"
                onClick={handleCancelPendingAndRestore}
                disabled={isCancellingRequisition}
                style={{
                  flex: '1.4 1 auto',
                  backgroundColor: '#b45309',
                  color: '#ffffff',
                  fontWeight: 800,
                  fontSize: '12px',
                  padding: '7px 12px',
                  borderRadius: '7px',
                  height: '34px',
                  whiteSpace: 'nowrap',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                }}
                title={`لديك طلب معلق #${pendingRequisition.docNo} - انقر لإلغائه وتعديل أصنافه`}
              >
                <RefreshCwIcon size={13} />
                {isCancellingRequisition ? t('delivery_reps.driver_new_load_requisition_view.s108', "جاري الإلغاء...") : `إلغاء المعلق (#${pendingRequisition.docNo}) وتعديل الأصناف`}
              </Button>
            ) : (
              <Button
                variant="primary"
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting || validLines.length === 0}
                style={{
                  flex: '1.4 1 auto',
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  fontWeight: 800,
                  fontSize: '12.5px',
                  padding: '7px 12px',
                  borderRadius: '7px',
                  height: '34px',
                  whiteSpace: 'nowrap',
                }}
              >
                {isSubmitting ? t('delivery_reps.driver_new_load_requisition_view.s109', "جارٍ الإرسال...") : `إرسال للمشرف (${distinctItemsCount})`}
              </Button>
            )}

            {(hasDraftContent || hasSavedDraft) && (
              <Button
                variant="secondary"
                type="button"
                onClick={handleClearDraft}
                style={{
                  fontSize: '11.5px',
                  fontWeight: 700,
                  color: '#dc2626',
                  borderColor: '#fca5a5',
                  backgroundColor: '#fef2f2',
                  padding: '7px 10px',
                  height: '34px',
                  whiteSpace: 'nowrap',
                  flex: '0 0 auto',
                }}
              >
                {t('delivery_reps.driver_new_load_requisition_view.s110', "حذف المسودة")}
              </Button>
            )}
          </div>
        </section>

      {/* Floating Action Button (FAB) on the left for load requisition */}
      <VanFloatingActionBar
        visible={activeViewTab === 'catalog' && distinctItemsCount > 0}
        itemCount={distinctItemsCount}
        actionText={t('delivery_reps.driver_new_load_requisition_view.s111', "مراجعة الإذن")}
        onAction={() => {
          setActiveViewTab('selected');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    </>
  );
}
