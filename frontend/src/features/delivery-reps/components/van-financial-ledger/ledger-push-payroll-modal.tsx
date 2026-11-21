import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/shared/ui/button';
import { StandardDialog } from '@/shared/components/StandardDialog';
import type { useLedgerMutations } from './use-ledger-mutations';

export interface LedgerPushPayrollModalProps {
  isPushPayrollOpen: boolean;
  payrollTargetMonth: string;
  pushPayrollMutation: ReturnType<typeof useLedgerMutations>['pushPayrollMutation'];
  selectedIds: number[];
  setIsPushPayrollOpen: Dispatch<SetStateAction<boolean>>;
  setPayrollTargetMonth: Dispatch<SetStateAction<string>>;
}

export function LedgerPushPayrollModal({
  isPushPayrollOpen,
  payrollTargetMonth,
  pushPayrollMutation,
  selectedIds,
  setIsPushPayrollOpen,
  setPayrollTargetMonth,
}: LedgerPushPayrollModalProps) {
  const { t } = useTranslation();
  return (
    <>
      {isPushPayrollOpen && (
        <StandardDialog
          isOpen={isPushPayrollOpen}
          onClose={() => setIsPushPayrollOpen(false)}
          title={t('delivery_reps.van_financial_ledger_admin_tab.s97', "ترحيل العجوزات المحددة كاستقطاعات لمسير الرواتب")}
          subtitle={`تم تحديد ${selectedIds.length} بند للتسوية والخصم الرسمي من راتب المندوب`}
          width="480px"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 0' }}>
            <div
              style={{
                backgroundColor: '#eef2ff',
                border: '1px solid #c7d2fe',
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '12px',
                color: '#3730a3',
                lineHeight: 1.5,
              }}
            >
              {t('delivery_reps.van_financial_ledger_admin_tab.s98', "سيتم نقل هذه العجوزات مباشرة إلى موديول الرواتب والأجور (HR) كبند استقطاع رسمي تحت مسمى (عجز عهدة سيارة توزيع) في مسير الشهر المحدد، وبذلك تقفل في كشف حساب المندوب.")}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                {t('delivery_reps.van_financial_ledger_admin_tab.s99', "مسير راتب شهر الاستحقاق:")}
              </label>
              <input
                type="month"
                value={payrollTargetMonth}
                onChange={(e) => setPayrollTargetMonth(e.target.value)}
                style={{
                  width: '100%',
                  height: '36px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: '0 10px',
                  fontSize: '13px',
                  fontWeight: 700,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <Button
                variant="primary"
                onClick={() =>
                  pushPayrollMutation.mutate({
                    settlementIds: selectedIds,
                    targetMonth: payrollTargetMonth,
                  })
                }
                disabled={pushPayrollMutation.isPending || selectedIds.length === 0}
                style={{
                  flex: 1,
                  height: '36px',
                  backgroundColor: '#170e5e',
                  fontSize: '12.5px',
                  fontWeight: 800,
                }}
              >
                {pushPayrollMutation.isPending ? t('delivery_reps.van_financial_ledger_admin_tab.s100', "جاري الترحيل...") : t('delivery_reps.van_financial_ledger_admin_tab.s101', "تأكيد الترحيل لمسير الرواتب")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setIsPushPayrollOpen(false)}
                style={{ height: '36px' }}
              >
                {t('delivery_reps.van_financial_ledger_admin_tab.s102', "إلغاء")}
              </Button>
            </div>
          </div>
        </StandardDialog>
      )}
    </>
  );
}
