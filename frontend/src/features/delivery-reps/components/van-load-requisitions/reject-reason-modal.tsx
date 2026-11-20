import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { StandardDialog } from '@/shared/components/StandardDialog';
import type { VanLoadRequisitionRecord } from '../../api/van-sales.api';

export interface RejectReasonModalProps {
  rejectModalReq: VanLoadRequisitionRecord | null;
  rejectReasonInput: string;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
  isPending: boolean;
  onClose: () => void;
}

export function RejectReasonModal({
  rejectModalReq,
  rejectReasonInput,
  onReasonChange,
  onConfirm,
  isPending,
  onClose,
}: RejectReasonModalProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* Reject Reason Modal */}
      {rejectModalReq && (
        <StandardDialog
          open={Boolean(rejectModalReq)}
          onClose={() => onClose()}
          title={`رفض إذن تحميل البضاعة #${rejectModalReq.docNo}`}
          subtitle={`المندوب: ${rejectModalReq.repName} • المستودع: ${rejectModalReq.sourceWarehouseName}`}
          maxWidth="480px"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} dir="rtl">
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('delivery_reps.van_load_requisitions_admin_tab.s122', "سبب رفض إذن التحميل")} <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <textarea
                rows={3}
                placeholder={t('delivery_reps.van_load_requisitions_admin_tab.s123', "وضح سبب رفض طلب التحميل ليظهر للمندوب في تطبيق الفان...")}
                value={rejectReasonInput}
                onChange={(e) => onReasonChange(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button variant="secondary" onClick={() => onClose()}>
                {t('delivery_reps.van_load_requisitions_admin_tab.s124', "إلغاء")}
              </Button>
              <Button
                variant="danger"
                disabled={isPending}
                onClick={onConfirm}
                style={{ backgroundColor: '#dc2626', color: '#ffffff' }}
              >
                {isPending ? t('delivery_reps.van_load_requisitions_admin_tab.s125', "جاري الرفض...") : t('delivery_reps.van_load_requisitions_admin_tab.s126', "تأكيد رفض الإذن")}
              </Button>
            </div>
          </div>
        </StandardDialog>
      )}
    </>
  );
}
