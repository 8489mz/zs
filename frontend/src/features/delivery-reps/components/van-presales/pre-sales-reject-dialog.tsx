import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/shared/ui/button';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';

export interface PreSalesRejectDialogProps {
  handleConfirmReject: () => void;
  rejectMutation: { isPending: boolean };
  rejectionReason: string;
  setRejectingOrderId: Dispatch<SetStateAction<number | null>>;
  setRejectionReason: Dispatch<SetStateAction<string>>;
}

export function PreSalesRejectDialog({
  handleConfirmReject,
  rejectMutation,
  rejectionReason,
  setRejectingOrderId,
  setRejectionReason,
}: PreSalesRejectDialogProps) {
  const { t } = useTranslation();
  return (
    <StandardDialog
      open={true}
      onClose={() => setRejectingOrderId(null)}
      title={t('delivery_reps.van_pre_sales_admin_tab.s83', "رفض طلبية المندوب")}
      subtitle={t('delivery_reps.van_pre_sales_admin_tab.s84', "سيتم إلغاء الطلبية وتحرير حجز الأصناف وإعادتها فوراً للرصيد المتاح بالمخزن")}
      badge={t('delivery_reps.van_pre_sales_admin_tab.s85', "إلغاء حجز")}
      width="min(460px, 96vw)"
      footerActions={
        <StandardDialogFooter
          onClose={() => setRejectingOrderId(null)}
          cancelText={t('delivery_reps.van_pre_sales_admin_tab.s86', "تراجع")}
          extraActions={
            <Button
              variant="primary"
              onClick={handleConfirmReject}
              disabled={rejectMutation.isPending || !rejectionReason.trim()}
              style={{ backgroundColor: '#b91c1c', color: '#fff', fontWeight: 800, fontSize: '12px' }}
            >
              {rejectMutation.isPending ? t('delivery_reps.van_pre_sales_admin_tab.s87', "جاري التحرير...") : t('delivery_reps.van_pre_sales_admin_tab.s88', "تأكيد الرفض وتحرير المخزون")}
            </Button>
          }
        />
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <label style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a' }}>
          {t('delivery_reps.van_pre_sales_admin_tab.s89', "سبب الرفض (سيظهر للمندوب في سجله):")}
        </label>
        <textarea
          rows={3}
          value={rejectionReason}
          onChange={(e) => setRejectionReason(e.target.value)}
          placeholder={t('delivery_reps.van_pre_sales_admin_tab.s90', "مثال: رصيد العميل تجاوز سقف الائتمان / خط سير غير مصرح...")}
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            fontSize: '12.5px',
            boxSizing: 'border-box',
          }}
        />
      </div>
    </StandardDialog>
  );
}
