import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/shared/ui/button';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { CustomSelect } from '@/shared/ui/custom-select';

export interface LedgerAddBonusModalProps {
  addBonusMutation: {
    mutate: (variables: {
      repId: number;
      entryType: 'bonus' | 'commission';
      amount: number;
      notes: string;
    }) => void;
    isPending: boolean;
  };
  allReps: { id: number; name: string; phone?: string; vehicle_plate?: string }[];
  bonusAmount: string;
  bonusNotes: string;
  bonusRepId: string;
  bonusType: 'bonus' | 'commission';
  isAddBonusOpen: boolean;
  setBonusAmount: Dispatch<SetStateAction<string>>;
  setBonusNotes: Dispatch<SetStateAction<string>>;
  setBonusRepId: Dispatch<SetStateAction<string>>;
  setBonusType: Dispatch<SetStateAction<'bonus' | 'commission'>>;
  setIsAddBonusOpen: Dispatch<SetStateAction<boolean>>;
}

export function LedgerAddBonusModal({
  addBonusMutation,
  allReps,
  bonusAmount,
  bonusNotes,
  bonusRepId,
  bonusType,
  isAddBonusOpen,
  setBonusAmount,
  setBonusNotes,
  setBonusRepId,
  setBonusType,
  setIsAddBonusOpen,
}: LedgerAddBonusModalProps) {
  const { t } = useTranslation();
  return (
    <>
      {isAddBonusOpen && (
        <StandardDialog
          isOpen={isAddBonusOpen}
          onClose={() => setIsAddBonusOpen(false)}
          title={t('delivery_reps.van_financial_ledger_admin_tab.s84', "قيد مكافأة تميز أو عمولة بيع للمندوب")}
          subtitle={t('delivery_reps.van_financial_ledger_admin_tab.s85', "تضاف لرصيد المندوب في المركز المالي ويمكن ترحيلها مع مسير الرواتب")}
          width="480px"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 0' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                {t('delivery_reps.van_financial_ledger_admin_tab.s86', "اختيار المندوب:")}
              </label>
              <CustomSelect
                value={bonusRepId}
                onChange={(val) => setBonusRepId(val)}
                options={[
                  { value: '', label: t('delivery_reps.van_financial_ledger_admin_tab.s87', "-- اختر المندوب --") },
                  ...allReps.map((r) => ({
                    value: String(r.id),
                    label: `${r.name} ${r.phone ? `(${r.phone})` : ''}`,
                  })),
                ]}
                placeholder={t('delivery_reps.van_financial_ledger_admin_tab.s88', "اختر المندوب")}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setBonusType('bonus')}
                style={{
                  flex: 1,
                  height: '34px',
                  borderRadius: '6px',
                  border: bonusType === 'bonus' ? '1.5px solid #6d28d9' : '1px solid #cbd5e1',
                  backgroundColor: bonusType === 'bonus' ? '#f5f3ff' : '#f8fafc',
                  color: bonusType === 'bonus' ? '#6d28d9' : '#475569',
                  fontWeight: 800,
                  fontSize: '11.5px',
                  cursor: 'pointer',
                }}
              >
                {t('delivery_reps.van_financial_ledger_admin_tab.s89', "مكافأة / بونص تحقيق تارجت")}
              </button>
              <button
                type="button"
                onClick={() => setBonusType('commission')}
                style={{
                  flex: 1,
                  height: '34px',
                  borderRadius: '6px',
                  border: bonusType === 'commission' ? '1.5px solid #16a34a' : '1px solid #cbd5e1',
                  backgroundColor: bonusType === 'commission' ? '#f0fdf4' : '#f8fafc',
                  color: bonusType === 'commission' ? '#16a34a' : '#475569',
                  fontWeight: 800,
                  fontSize: '11.5px',
                  cursor: 'pointer',
                }}
              >
                {t('delivery_reps.van_financial_ledger_admin_tab.s90', "عمولة بيع وتوزيع")}
              </button>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                {t('delivery_reps.van_financial_ledger_admin_tab.s91', "المبلغ بالجنية (ج.م):")}
              </label>
              <input
                type="number"
                step="0.01"
                value={bonusAmount}
                onChange={(e) => setBonusAmount(e.target.value)}
                placeholder="0.00"
                style={{
                  width: '100%',
                  height: '36px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: '0 10px',
                  fontSize: '14px',
                  fontWeight: 800,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                {t('delivery_reps.van_financial_ledger_admin_tab.s92', "البيان وسبب الصرف:")}
              </label>
              <textarea
                value={bonusNotes}
                onChange={(e) => setBonusNotes(e.target.value)}
                placeholder={t('delivery_reps.van_financial_ledger_admin_tab.s93', "مثال: تحقيق 110% من المستهدف البيعي للأسبوع الثاني...")}
                rows={2}
                style={{
                  width: '100%',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: '8px 10px',
                  fontSize: '12px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <Button
                variant="primary"
                onClick={() =>
                  addBonusMutation.mutate({
                    repId: Number(bonusRepId),
                    entryType: bonusType,
                    amount: Number(bonusAmount),
                    notes: bonusNotes.trim(),
                  })
                }
                disabled={addBonusMutation.isPending || !bonusRepId || !Number(bonusAmount)}
                style={{
                  flex: 1,
                  height: '36px',
                  backgroundColor: '#6d28d9',
                  fontSize: '12.5px',
                  fontWeight: 800,
                }}
              >
                {addBonusMutation.isPending ? t('delivery_reps.van_financial_ledger_admin_tab.s94', "جاري القيد...") : t('delivery_reps.van_financial_ledger_admin_tab.s95', "اعتماد وقيد المكافأة")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setIsAddBonusOpen(false)}
                style={{ height: '36px' }}
              >
                {t('delivery_reps.van_financial_ledger_admin_tab.s96', "إلغاء")}
              </Button>
            </div>
          </div>
        </StandardDialog>
      )}
    </>
  );
}
