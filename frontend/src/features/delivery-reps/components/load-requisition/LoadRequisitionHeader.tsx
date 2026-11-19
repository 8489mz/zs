import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { CustomSelect, type SelectOption } from '@/shared/ui/custom-select';
import { ArrowRightIcon, CheckCircleIcon, ClockIcon, RefreshCwIcon } from '@/shared/components/icons/AppIcons';
import type { RequisitionLineItem } from './LoadRequisitionTypes';
import type { VanLoadRequisitionRecord } from '../../hooks/useDriverLoadRequisition';

export interface LoadRequisitionHeaderProps {
  isAdmin: boolean;
  isMobile: boolean;
  distinctItemsCount: number;
  validLines: RequisitionLineItem[];
  isSubmitting: boolean;
  isCancellingRequisition: boolean;
  pendingRequisition: VanLoadRequisitionRecord | null;
  isDraftRestored: boolean;
  selectedWarehouseFilter: string;
  setSelectedWarehouseFilter: (value: string) => void;
  warehouseSelectOptions: SelectOption[];
  isLoadingWarehouses: boolean;
  selectedRepId: string;
  setSelectedRepId: (value: string) => void;
  repSelectOptions: SelectOption[];
  adminRepsQuery: { isLoading: boolean };
  driverName: string;
  displayVehiclePlate: string;
  dismissRestoredNotice: () => void;
  handleGoBack: () => void;
  handleClearDraft: () => Promise<void>;
  handleCancelPendingAndRestore: () => Promise<void>;
  handleSubmit: () => Promise<void>;
  handleAdminSubmit: (dispatchImmediately: boolean) => Promise<void>;
  adminSubmitMutation: { isPending: boolean };
}

export function LoadRequisitionHeader({
  isAdmin,
  isMobile,
  distinctItemsCount,
  validLines,
  isSubmitting,
  isCancellingRequisition,
  pendingRequisition,
  isDraftRestored,
  selectedWarehouseFilter,
  setSelectedWarehouseFilter,
  warehouseSelectOptions,
  isLoadingWarehouses,
  selectedRepId,
  setSelectedRepId,
  repSelectOptions,
  adminRepsQuery,
  driverName,
  displayVehiclePlate,
  dismissRestoredNotice,
  handleGoBack,
  handleClearDraft,
  handleCancelPendingAndRestore,
  handleSubmit,
  handleAdminSubmit,
  adminSubmitMutation,
}: LoadRequisitionHeaderProps) {
  const { t } = useTranslation();

  return (
    <>
        {/* Top Header Bar */}
        <header
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            padding: '8px 12px',
            marginBottom: '8px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <button
              type="button"
              onClick={handleGoBack}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '7px',
                backgroundColor: '#f1f5f9',
                border: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#475569',
                flexShrink: 0,
              }}
              title={t('delivery_reps.driver_new_load_requisition_view.s29', "العودة للقائمة")}
            >
              <ArrowRightIcon size={16} />
            </button>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <h1 style={{ margin: 0, fontSize: isMobile ? '13px' : '14px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {isAdmin ? t('delivery_reps.driver_new_load_requisition_view.s30', "إسناد وصرف إذن تحميل السيارة") : t('delivery_reps.driver_new_load_requisition_view.s31', "طلب شحن وتحميل سيارة التوزيع")}
                </h1>
                <span
                  style={{
                    backgroundColor: isAdmin ? '#fef3c7' : '#e0e7ff',
                    color: isAdmin ? '#92400e' : '#3730a3',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: '5px',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {isAdmin ? t('delivery_reps.driver_new_load_requisition_view.s32', "إسناد إداري") : t('delivery_reps.driver_new_load_requisition_view.s33', "مسودة جديدة")}
                </span>
                {isMobile && distinctItemsCount > 0 && (
                  <span
                    style={{
                      backgroundColor: '#f0fdf4',
                      color: '#15803d',
                      fontSize: '10.5px',
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: '5px',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    ({distinctItemsCount} {t('delivery_reps.driver_new_load_requisition_view.s34', "بالطلب)")}
                  </span>
                )}
              </div>
            </div>
          </div>

          {!isMobile && (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
              {isAdmin ? (
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => handleAdminSubmit(true)}
                  disabled={isSubmitting || validLines.length === 0}
                  style={{
                    backgroundColor: '#170e5e',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 800,
                    padding: '6px 12px',
                    whiteSpace: 'nowrap',
                    height: '32px',
                  }}
                >
                  {adminSubmitMutation.isPending ? t('delivery_reps.driver_new_load_requisition_view.s35', "جاري الصرف...") : `صرف وتحميل (${distinctItemsCount})`}
                </Button>
              ) : pendingRequisition ? (
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleCancelPendingAndRestore}
                  disabled={isCancellingRequisition}
                  style={{
                    backgroundColor: '#b45309',
                    color: '#ffffff',
                    fontSize: '11.5px',
                    fontWeight: 800,
                    padding: '6px 12px',
                    whiteSpace: 'nowrap',
                    height: '32px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                  title={`لديك طلب معلق #${pendingRequisition.docNo} - انقر لإلغائه وتعديل أصنافه`}
                >
                  <RefreshCwIcon size={12} />
                  {isCancellingRequisition ? t('delivery_reps.driver_new_load_requisition_view.s36', "جاري الإلغاء...") : t('delivery_reps.driver_new_load_requisition_view.s37', "إلغاء المعلق وتعديل الأصناف")}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleSubmit}
                  disabled={isSubmitting || validLines.length === 0}
                  style={{
                    backgroundColor: '#170e5e',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 800,
                    padding: '6px 12px',
                    whiteSpace: 'nowrap',
                    height: '32px',
                  }}
                >
                  {isSubmitting ? t('delivery_reps.driver_new_load_requisition_view.s38', "جارٍ الإرسال...") : `إرسال للمشرف (${distinctItemsCount})`}
                </Button>
              )}
            </div>
          )}
        </header>

        {/* Pending Requisition Warning & Recovery Banner */}
        {pendingRequisition && !isAdmin && (
          <div
            style={{
              marginBottom: '10px',
              padding: '12px 14px',
              backgroundColor: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: '10px',
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              alignItems: isMobile ? 'stretch' : 'center',
              justifyContent: 'space-between',
              gap: '10px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <div
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '8px',
                  backgroundColor: '#fef3c7',
                  border: '1px solid #fde68a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <ClockIcon size={18} color="#b45309" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 800, color: '#92400e', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>{t('delivery_reps.driver_new_load_requisition_view.s39', "طلب إذن تحميل معلق برقم #")}{pendingRequisition.docNo}</span>
                  <span style={{ fontSize: '10.5px', padding: '1px 6px', borderRadius: '4px', backgroundColor: '#fef3c7', color: '#b45309', fontWeight: 700 }}>
                    {t('delivery_reps.driver_new_load_requisition_view.s40', "قيد انتظار مراجعة المشرف")}
                  </span>
                </div>
                <div style={{ fontSize: '11.5px', color: '#78350f', marginTop: '3px' }}>
                  {t('delivery_reps.driver_new_load_requisition_view.s41', "المستودع:")} <strong>{pendingRequisition.sourceWarehouseName || t('delivery_reps.driver_new_load_requisition_view.s42', "المستودع الرئيسي")}</strong> {t('delivery_reps.driver_new_load_requisition_view.s43', "| الأصناف:")} <strong>{pendingRequisition.requestedItems?.length || 0} {t('delivery_reps.driver_new_load_requisition_view.s44', "صنف")}</strong>{t('delivery_reps.driver_new_load_requisition_view.s45', ". لمنع تكرار الطلبات، يلزم إلغاء الطلب المعلق أولاً لتعديل كمياته أو انتظار اعتماده وصرفه.")}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <Button
                type="button"
                variant="primary"
                onClick={handleCancelPendingAndRestore}
                disabled={isCancellingRequisition}
                style={{
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  fontSize: '12px',
                  fontWeight: 800,
                  padding: '7px 14px',
                  borderRadius: '8px',
                  whiteSpace: 'nowrap',
                  height: '34px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <RefreshCwIcon size={13} />
                {isCancellingRequisition ? t('delivery_reps.driver_new_load_requisition_view.s46', "جاري الإلغاء...") : t('delivery_reps.driver_new_load_requisition_view.s47', "إلغاء الطلب المعلق وتعديل الأصناف")}
              </Button>
            </div>
          </div>
        )}

        {/* Draft Restored Banner */}
        {isDraftRestored && (
          <div
            style={{
              marginBottom: '8px',
              padding: '8px 12px',
              backgroundColor: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              fontSize: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#1e40af' }}>
              <CheckCircleIcon size={15} />
              <span>
                <strong>{t('delivery_reps.driver_new_load_requisition_view.s48', "تم استرجاع المسودة تلقائياً:")}</strong> ({validLines.length} {t('delivery_reps.driver_new_load_requisition_view.s49', "صنف محفوظ).")}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleClearDraft}
                style={{
                  fontSize: '11px',
                  color: '#b91c1c',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 700,
                  textDecoration: 'underline',
                  padding: '2px 4px',
                }}
              >
                {t('delivery_reps.driver_new_load_requisition_view.s50', "حذف")}
              </button>
              <button
                type="button"
                onClick={dismissRestoredNotice}
                style={{
                  fontSize: '11px',
                  color: '#1e40af',
                  backgroundColor: '#dbeafe',
                  border: '1px solid #bfdbfe',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  padding: '2px 8px',
                }}
              >
                {t('delivery_reps.driver_new_load_requisition_view.s51', "إغلاق")}
              </button>
            </div>
          </div>
        )}

        {/* Basic Info Section (Source Warehouse & Representative) */}
        <section
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid #cbd5e1',
            padding: '8px 12px',
            marginBottom: '8px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '6px',
              paddingBottom: '4px',
              borderBottom: '1px solid #f1f5f9',
            }}
          >
            <div style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px' }} />
            <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
              {t('delivery_reps.driver_new_load_requisition_view.s52', "المعلومات الأساسية لطلب التحميل")}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '2px' }}>
                {t('delivery_reps.driver_new_load_requisition_view.s53', "من مخزن (مستودع الصرف)")}
              </label>
              <CustomSelect
                value={selectedWarehouseFilter}
                onChange={(val) => setSelectedWarehouseFilter(val)}
                options={warehouseSelectOptions}
                placeholder={t('delivery_reps.driver_new_load_requisition_view.s54', "اختر المستودع...")}
                disabled={isLoadingWarehouses}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'row', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
              <div style={{ flex: '1 1 50%', minWidth: 0 }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '2px', whiteSpace: 'nowrap' }}>
                  {isAdmin ? t('delivery_reps.driver_new_load_requisition_view.s55', "المندوب (السائق) *") : t('delivery_reps.driver_new_load_requisition_view.s56', "المندوب (المستلم)")}
                </label>
                {isAdmin ? (
                  <CustomSelect
                    value={selectedRepId}
                    onChange={(val) => setSelectedRepId(val)}
                    options={repSelectOptions}
                    placeholder={t('delivery_reps.driver_new_load_requisition_view.s57', "اختر المندوب...")}
                    disabled={adminRepsQuery.isLoading}
                  />
                ) : (
                  <input
                    type="text"
                    readOnly
                    value={driverName}
                    style={{
                      width: '100%',
                      height: '32px',
                      backgroundColor: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      borderRadius: '7px',
                      padding: '0 8px',
                      fontSize: '11.5px',
                      color: '#0f172a',
                      fontWeight: 700,
                      boxSizing: 'border-box',
                    }}
                  />
                )}
              </div>

              <div style={{ flex: '1 1 50%', minWidth: 0 }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '2px', whiteSpace: 'nowrap' }}>
                  {t('delivery_reps.driver_new_load_requisition_view.s58', "السيارة")}
                </label>
                <input
                  type="text"
                  readOnly
                  value={displayVehiclePlate}
                  style={{
                    width: '100%',
                    height: '32px',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '7px',
                    padding: '0 8px',
                    fontSize: '11.5px',
                    color: '#0f172a',
                    fontWeight: 700,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          </div>
        </section>

    </>
  );
}
