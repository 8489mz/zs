import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import type { PreSalesOrderRecord } from '../../api/van-sales.api';
import { Button } from '@/shared/ui/button';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';

export interface PreSalesConsolidateDialogProps {
  consolidateMutation: { isPending: boolean };
  consolidateNotes: string;
  consolidateTargetRepId: number | '';
  handleConfirmConsolidate: () => void;
  orders: PreSalesOrderRecord[];
  reps: Array<{ id: number; name: string }>;
  selectedOrderIds: number[];
  setConsolidateNotes: Dispatch<SetStateAction<string>>;
  setConsolidateTargetRepId: Dispatch<SetStateAction<number | ''>>;
  setShowConsolidateDialog: Dispatch<SetStateAction<boolean>>;
}

export function PreSalesConsolidateDialog({
  consolidateMutation,
  consolidateNotes,
  consolidateTargetRepId,
  handleConfirmConsolidate,
  orders,
  reps,
  selectedOrderIds,
  setConsolidateNotes,
  setConsolidateTargetRepId,
  setShowConsolidateDialog,
}: PreSalesConsolidateDialogProps) {
  const { t } = useTranslation();
  return (
    <StandardDialog
      open={true}
      onClose={() => setShowConsolidateDialog(false)}
      title={t('delivery_reps.van_pre_sales_admin_tab.s71', "تجميع الطلبيات المعتمدة وتوليد إذن تحميل للسيارة")}
      subtitle={t('delivery_reps.van_pre_sales_admin_tab.s72', "سيتم دمج كميات الأصناف من الطلبيات المختارة في إذن تحميل صباحي موحد وتحرير حجز الطلبيات لصالح السيارة")}
      badge={t('delivery_reps.van_pre_sales_admin_tab.s73', "تجهيز سيارة التوزيع")}
      width="min(520px, 96vw)"
      footerActions={
        <StandardDialogFooter
          onClose={() => setShowConsolidateDialog(false)}
          cancelText={t('delivery_reps.van_pre_sales_admin_tab.s74', "تراجع")}
          extraActions={
            <Button
              variant="primary"
              onClick={handleConfirmConsolidate}
              disabled={consolidateMutation.isPending || !consolidateTargetRepId}
              style={{ backgroundColor: '#170e5e', color: '#fff', fontWeight: 800, fontSize: '12px' }}
            >
              {consolidateMutation.isPending
                ? t('delivery_reps.van_pre_sales_admin_tab.s75', "جاري التجميع والتوليد...")
                : `توليد إذن التحميل (${selectedOrderIds.length} طلبيات)`}
            </Button>
          }
        />
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '10px 12px',
            fontSize: '12px',
            color: '#334155',
          }}
        >
          <div>
            {t('delivery_reps.van_pre_sales_admin_tab.s76', "عدد الطلبيات المختارة للدمج:")} <strong>{selectedOrderIds.length} {t('delivery_reps.van_pre_sales_admin_tab.s77', "طلبيات معتمدة")}</strong>
          </div>
          <div style={{ marginTop: '4px' }}>
            {t('delivery_reps.van_pre_sales_admin_tab.s78', "إجمالي القيمة التقديرية للطلبيات:")}{' '}
            <strong style={{ color: '#170e5e' }}>
              {orders
                .filter((o) => selectedOrderIds.includes(o.id))
                .reduce((s, o) => s + Number(o.totalAmount || 0), 0)
                .toFixed(2)}{' '}
              <CurrencySymbol />
            </strong>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <label style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a' }}>
            {t('delivery_reps.van_pre_sales_admin_tab.s79', "مندوب التوزيع / السيارة المستلمة للبضاعة:")}
          </label>
          <select
            value={consolidateTargetRepId}
            onChange={(e) => setConsolidateTargetRepId(e.target.value ? Number(e.target.value) : '')}
            style={{
              height: '36px',
              padding: '0 10px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '12.5px',
              color: '#0f172a',
            }}
          >
            <option value="">{t('delivery_reps.van_pre_sales_admin_tab.s80', "— اختر مندوب التوزيع —")}</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <label style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a' }}>
            {t('delivery_reps.van_pre_sales_admin_tab.s81', "ملاحظات إذن التحميل لأمين المخزن (اختياري):")}
          </label>
          <textarea
            rows={2}
            value={consolidateNotes}
            onChange={(e) => setConsolidateNotes(e.target.value)}
            placeholder={t('delivery_reps.van_pre_sales_admin_tab.s82', "مثال: تحميل خط سير الصباح لطلبيات الجملة المعتمدة...")}
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
      </div>
    </StandardDialog>
  );
}
