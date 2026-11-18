// Close-branch head — inline <style>, modal header and the
// offline-pending warning. Pure move; the panel keeps all state
// and mounts this component before the close form.

import { useTranslation } from 'react-i18next';
import { type UseFormReturn } from 'react-hook-form';
import type { CashierShift } from '@/types/domain';
import type { CloseShiftValues } from '@/features/cash-drawer/hooks/useCashDrawerPageController';
import { XIcon } from '@/shared/components/icons/AppIcons';
import { AlertCircleIcon } from './cash-drawer-form-icons';

interface CashDrawerCloseStyleHeaderProps {
  closeForm: UseFormReturn<CloseShiftValues>;
  myOpenShift?: CashierShift | null;
  openOptions: CashierShift[];
  offlinePendingCount: number;
  onCloseForm: () => void;
}

export function CashDrawerCloseStyleHeader({
  closeForm,
  myOpenShift,
  openOptions,
  offlinePendingCount,
  onCloseForm,
}: CashDrawerCloseStyleHeaderProps) {
  const { t } = useTranslation();
  return (
    <>
          <style>{`
            .cash-drawer-adaptive-dialog {
              height: auto !important;
              max-height: min(92vh, calc(100vh - 24px)) !important;
              display: flex !important;
              flex-direction: column !important;
              overflow: hidden !important;
              width: min(940px, calc(100vw - 16px)) !important;
              margin: auto !important;
              border-radius: 14px !important;
              touch-action: pan-y !important;
            }
            .cash-drawer-modal-scroll {
              flex: 1 1 auto !important;
              min-height: 0 !important;
              overflow-y: auto !important;
              overscroll-behavior: contain !important;
              -webkit-overflow-scrolling: touch !important;
              touch-action: pan-y !important;
              padding: 20px 24px 24px 24px;
              box-sizing: border-box !important;
              width: 100% !important;
              display: flex;
              flex-direction: column;
              gap: 12px;
            }
            @media (max-width: 860px) {
              .cash-drawer-adaptive-dialog {
                height: min(92vh, calc(100dvh - 24px)) !important;
                max-height: min(92vh, calc(100dvh - 24px)) !important;
                width: calc(100vw - 16px) !important;
              }
              .cash-drawer-modal-scroll {
                flex: 1 1 0% !important;
                padding: 14px 16px 28px 16px !important;
              }
            }
            .cash-drawer-form-title {
              margin: 0 0 16px 0;
              font-size: 1.25rem;
              font-weight: 800;
              color: #0f172a;
            }
            input.no-spin-arrows::-webkit-outer-spin-button,
            input.no-spin-arrows::-webkit-inner-spin-button {
              -webkit-appearance: none !important;
              margin: 0 !important;
              display: none !important;
            }
            input.no-spin-arrows {
              -moz-appearance: textfield !important;
              appearance: textfield !important;
            }
            .close-shift-modal-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 12px;
              margin-bottom: 14px;
              padding-bottom: 12px;
              border-bottom: 1px solid #f1f5f9;
            }
            .close-shift-modal-title-col {
              flex: 1;
              min-width: 0;
            }
            .close-shift-modal-title {
              margin: 0;
              font-size: 1.25rem;
              color: #0f172a;
              font-weight: 800;
            }
            .close-shift-modal-subtitle {
              font-size: 0.8rem;
              color: #64748b;
              margin-top: 2px;
            }
            .close-shift-modal-badge-chip {
              display: inline-flex;
              align-items: center;
              gap: 8px;
              padding: 6px 12px;
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 8px;
              font-size: 0.85rem;
              font-weight: 700;
              color: #0f172a;
              white-space: nowrap;
              flex-shrink: 0;
            }
            .close-shift-financial-card {
              grid-column: 1 / -1;
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 10px;
              padding: 12px;
            }
            .close-shift-financial-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
              gap: 8px;
            }
            .close-shift-fin-item {
              display: flex;
              flex-direction: column;
              padding: 6px 8px;
              background: #ffffff;
              border: 1px solid #e2e8f0;
              border-radius: 6px;
              gap: 2px;
            }
            .close-shift-fin-item.close-shift-fin-highlight {
              background: #f1f5f9;
              border-color: #cbd5e1;
            }
            .close-shift-fin-label {
              font-size: 0.72rem;
              color: #64748b;
              font-weight: 600;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .close-shift-fin-value {
              font-size: 0.88rem;
              font-weight: 800;
              color: #0f172a;
            }
            .close-shift-fin-value.tone-green { color: #16a34a; }
            .close-shift-fin-value.tone-blue { color: #2563eb; }
            .close-shift-fin-value.tone-red { color: #dc2626; }
            .close-shift-fin-value.tone-primary { color: #170c5c; }
            .close-shift-fin-footnote {
              font-size: 0.72rem;
              color: #94a3b8;
              margin-top: 8px;
              line-height: 1.4;
              border-top: 1px dashed #e2e8f0;
              padding-top: 6px;
            }
            .close-shift-auth-row {
              grid-column: 1 / -1;
              display: flex;
              flex-direction: row;
              align-items: flex-start;
              gap: 12px;
              width: 100%;
            }
            .close-shift-note-col {
              flex: 1;
              min-width: 0;
            }
            .close-shift-pin-col {
              width: 260px;
              flex-shrink: 0;
            }
            @media (max-width: 640px) {
              .cash-drawer-modal-scroll {
                padding: 12px 14px 32px 14px !important;
                gap: 8px !important;
              }
              .close-shift-modal-header {
                flex-direction: column !important;
                align-items: stretch !important;
                gap: 6px !important;
                margin-bottom: 10px !important;
                padding-bottom: 8px !important;
              }
              .close-shift-modal-title {
                font-size: 1.1rem !important;
              }
              .close-shift-modal-subtitle {
                font-size: 0.72rem !important;
                line-height: 1.35 !important;
              }
              .close-shift-modal-badge-chip {
                width: 100% !important;
                justify-content: space-between !important;
                box-sizing: border-box !important;
                padding: 4px 10px !important;
                font-size: 0.78rem !important;
              }
              .close-shift-financial-card {
                padding: 8px !important;
                margin-bottom: 4px !important;
              }
              .close-shift-financial-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                gap: 6px !important;
              }
              .close-shift-fin-item {
                padding: 4px 6px !important;
              }
              .close-shift-fin-label {
                font-size: 0.68rem !important;
              }
              .close-shift-fin-value {
                font-size: 0.82rem !important;
              }
              .close-shift-fin-footnote {
                font-size: 0.68rem !important;
                line-height: 1.3 !important;
                margin-top: 6px !important;
                padding-top: 4px !important;
              }
              .close-shift-auth-row {
                flex-direction: column !important;
                gap: 8px !important;
              }
              .close-shift-pin-col {
                width: 100% !important;
              }
              .form-grid {
                gap: 8px !important;
              }
              .form-grid .field {
                margin-bottom: 4px !important;
              }
            }
          `}</style>

          <div className="close-shift-modal-header">
            <div className="close-shift-modal-title-col">
              <h2 className="close-shift-modal-title">{t('cash_drawer.cash_drawer_forms_panel.s44', "إغلاق وردية نقطة البيع")}</h2>
              <div className="close-shift-modal-subtitle">
                {t('cash_drawer.cash_drawer_forms_panel.s45', "تسجيل إقرار مبيعات النقدية والمدفوعات الإلكترونية ومطابقة بونات الدفع")}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <div className="close-shift-modal-badge-chip">
                <span>{(myOpenShift || openOptions.find(s => String(s.id) === String(closeForm.watch('shiftId'))) || openOptions[0])?.openedByName || t('cash_drawer.cash_drawer_forms_panel.s46', "الوردية الحالية")}{(myOpenShift || openOptions.find(s => String(s.id) === String(closeForm.watch('shiftId'))) || openOptions[0])?.docNo ? ` — ${(myOpenShift || openOptions.find(s => String(s.id) === String(closeForm.watch('shiftId'))) || openOptions[0])?.docNo}` : ''}</span>
                <span className="badge badge-success" style={{ fontSize: '0.72rem' }}>{t('cash_drawer.cash_drawer_forms_panel.s47', "وردية نشطة")}</span>
              </div>
              <button
                type="button"
                onClick={onCloseForm}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  background: '#f8fafc',
                  color: '#64748b',
                  cursor: 'pointer',
                  flexShrink: 0,
                  padding: 0,
                }}
                title={t('common.close', 'إغلاق')}
              >
                <XIcon size={18} />
              </button>
            </div>
          </div>

          {offlinePendingCount !== 0 && (
            <div style={{
              marginBottom: '16px',
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: '10px',
              padding: '12px 16px',
              color: '#92400e',
              fontSize: '0.85rem',
              lineHeight: 1.5,
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
            }}>
              <div style={{ flexShrink: 0, marginTop: '2px' }}>
                <AlertCircleIcon size={18} color="#d97706" />
              </div>
              <div>
                <div style={{ fontWeight: 800, marginBottom: '2px' }}>
                  {offlinePendingCount < 0
                    ? 'تحذير: تعذر قراءة سجل فواتير الأوفلاين؛ لا يمكن إغلاق الوردية قبل إصلاح بيانات الجهاز'
                    : <>{t('cash_drawer.cash_drawer_forms_panel.s48', "تنبيه: توجد")} {offlinePendingCount} {t('cash_drawer.cash_drawer_forms_panel.s49', "فواتير مسجلة محلياً بدون إنترنت لم يتم ترحيلها للخادم بعد.")}</>}
                </div>
                <div>
                  {t('cash_drawer.cash_drawer_forms_panel.s50', "يرجى التأكد من اتصال الجهاز بالإنترنت والانتظار حتى يتم ترحيل كافة الفواتير تلقائياً قبل إغلاق الوردية، لضمان دقة الحسابات ومطابقة النقدية في الدرج.")}
                </div>
              </div>
            </div>
          )}
    </>
  );
}
