import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/shared/ui/button';
import { StandardDialog } from '@/shared/components/StandardDialog';
import type { VanRepFinancialSettlementItem } from '../../api/van-sales.api';
import type { useLedgerMutations } from './use-ledger-mutations';

export interface LedgerSettleModalProps {
  REP_WAIVER_PIN_THRESHOLD_DEFAULT: number;
  setSettleMethod: Dispatch<SetStateAction<'cash' | 'waiver'>>;
  setSettleModalItem: Dispatch<SetStateAction<VanRepFinancialSettlementItem | null>>;
  setSettleNotes: Dispatch<SetStateAction<string>>;
  setSettlePin: Dispatch<SetStateAction<string>>;
  settleMethod: 'cash' | 'waiver';
  settleModalItem: VanRepFinancialSettlementItem | null;
  settleMutation: ReturnType<typeof useLedgerMutations>['settleMutation'];
  settleNotes: string;
  settlePin: string;
}

export function LedgerSettleModal({
  REP_WAIVER_PIN_THRESHOLD_DEFAULT,
  setSettleMethod,
  setSettleModalItem,
  setSettleNotes,
  setSettlePin,
  settleMethod,
  settleModalItem,
  settleMutation,
  settleNotes,
  settlePin,
}: LedgerSettleModalProps) {
  const { t } = useTranslation();
  return (
    settleModalItem && (
      <StandardDialog
        isOpen={Boolean(settleModalItem)}
        onClose={() => { setSettleModalItem(null); setSettlePin(''); }}
        title={settleMethod === 'cash' ? t('delivery_reps.van_financial_ledger_admin_tab.s69', "إثبات سداد نقدي وتوريد للخزينة") : t('delivery_reps.van_financial_ledger_admin_tab.s70', "تسوية وإعفاء إداري معتمد")}
        subtitle={`المندوب: ${settleModalItem.repName} | المبلغ: ${Number(settleModalItem.amount).toFixed(2)} ج.م`}
        width="480px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 0' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setSettleMethod('cash')}
              style={{
                flex: 1,
                height: '36px',
                borderRadius: '7px',
                border: settleMethod === 'cash' ? '1.5px solid #16a34a' : '1px solid #cbd5e1',
                backgroundColor: settleMethod === 'cash' ? '#f0fdf4' : '#f8fafc',
                color: settleMethod === 'cash' ? '#15803d' : '#475569',
                fontWeight: 800,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              {t('delivery_reps.van_financial_ledger_admin_tab.s71', "سداد نقدي بالخزينة (سند قبض)")}
            </button>
            <button
              type="button"
              onClick={() => setSettleMethod('waiver')}
              style={{
                flex: 1,
                height: '36px',
                borderRadius: '7px',
                border: settleMethod === 'waiver' ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                backgroundColor: settleMethod === 'waiver' ? '#eef2ff' : '#f8fafc',
                color: settleMethod === 'waiver' ? '#170e5e' : '#475569',
                fontWeight: 800,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              {t('delivery_reps.van_financial_ledger_admin_tab.s72', "إعفاء / تسوية إدارية")}
            </button>
          </div>

          <div
            style={{
              backgroundColor: settleMethod === 'cash' ? '#f0fdf4' : '#f8fafc',
              border: `1px solid ${settleMethod === 'cash' ? '#bbf7d0' : '#e2e8f0'}`,
              borderRadius: '8px',
              padding: '10px 12px',
              fontSize: '12px',
              color: '#334155',
              lineHeight: 1.5,
            }}
          >
            {settleMethod === 'cash' ? (
              <div>
                {t('delivery_reps.van_financial_ledger_admin_tab.s73', "سيتم تسجيل استلام مبلغ")} <strong>{Number(settleModalItem.amount).toFixed(2)} {t('delivery_reps.van_financial_ledger_admin_tab.s74', "ج.م")}</strong> {t('delivery_reps.van_financial_ledger_admin_tab.s75', "نقداً من المندوب في الخزينة الرئيسية، وتوليد رقم سند قبض رسمي وتصفير هذا العجز نهائياً.")}
              </div>
            ) : (
              <div>
                {t('delivery_reps.van_financial_ledger_admin_tab.s76', "سيتم إعفاء المندوب من هذا المبلغ واعتباره تسوية إدارية مبررة دون خصمها من المندوب أو سدادها نقدياً.")}
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
              {t('delivery_reps.van_financial_ledger_admin_tab.s77', "ملاحظات ومبررات التسوية:")}
              {settleMethod === 'waiver' && <span style={{ color: '#dc2626' }}> *</span>}
            </label>
            <textarea
              value={settleNotes}
              onChange={(e) => setSettleNotes(e.target.value)}
              placeholder={settleMethod === 'cash' ? t('delivery_reps.van_financial_ledger_admin_tab.s78', "مثال: تم التوريد نقداً لأمين الخزينة...") : t('delivery_reps.van_financial_ledger_admin_tab.s79', "مثال: إعفاء بنسبة العجز المقبولة بقرار الإدارة...")}
              rows={3}
              style={{
                width: '100%',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                padding: '8px 10px',
                fontSize: '12px',
                boxSizing: 'border-box',
              }}
            />
            {settleMethod === 'waiver' && !settleNotes.trim() && (
              <div style={{ fontSize: '11px', color: '#dc2626', marginTop: '4px' }}>
                {t('delivery_reps.van_financial_ledger_admin_tab.s86', "سبب الإعفاء إلزامي — لا يمكن اعتماد الإعفاء بدون سبب مسجل.")}
              </div>
            )}
          </div>

          {settleMethod === 'waiver' && Number(settleModalItem.amount) > REP_WAIVER_PIN_THRESHOLD_DEFAULT && (
            <div>
              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                {t('delivery_reps.van_financial_ledger_admin_tab.s87', "رمز اعتماد المشرف (PIN):")}
                <span style={{ color: '#dc2626' }}> *</span>
              </label>
              <input
                type="password"
                value={settlePin}
                onChange={(e) => setSettlePin(e.target.value)}
                placeholder={t('delivery_reps.van_financial_ledger_admin_tab.s88', "أدخل رمز المشرف أو كلمة مرور المدير")}
                autoComplete="off"
                style={{
                  width: '100%',
                  height: '35px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: '0 10px',
                  fontSize: '12px',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                {t('delivery_reps.van_financial_ledger_admin_tab.s89', "المبلغ فوق حد الاعتماد (500) فيتطلب اعتماد مشرف؛ ولا يجوز لمن اعتمد تصفية الرحلة أن يعتمد إعفاءها.")}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
            <Button
              variant="primary"
              onClick={() =>
                settleMutation.mutate({
                  id: settleModalItem.id,
                  method: settleMethod,
                  notes: settleNotes.trim() || undefined,
                  reason: settleMethod === 'waiver' ? settleNotes.trim() || undefined : undefined,
                  supervisorPin:
                    settleMethod === 'waiver' && Number(settleModalItem.amount) > REP_WAIVER_PIN_THRESHOLD_DEFAULT
                      ? settlePin.trim() || undefined
                      : undefined,
                })
              }
              disabled={
                settleMutation.isPending ||
                (settleMethod === 'waiver' &&
                  (!settleNotes.trim() ||
                    (Number(settleModalItem.amount) > REP_WAIVER_PIN_THRESHOLD_DEFAULT && !settlePin.trim())))
              }
              style={{
                flex: 1,
                height: '36px',
                backgroundColor: settleMethod === 'cash' ? '#16a34a' : '#170e5e',
                fontSize: '12.5px',
                fontWeight: 800,
              }}
            >
              {settleMutation.isPending ? t('delivery_reps.van_financial_ledger_admin_tab.s80', "جاري الحفظ...") : settleMethod === 'cash' ? t('delivery_reps.van_financial_ledger_admin_tab.s81', "تأكيد استلام النقدية وإصدار السند") : t('delivery_reps.van_financial_ledger_admin_tab.s82', "اعتماد الإعفاء والتسوية")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setSettleModalItem(null)}
              style={{ height: '36px' }}
            >
              {t('delivery_reps.van_financial_ledger_admin_tab.s83', "إلغاء")}
            </Button>
          </div>
        </div>
      </StandardDialog>
    )
  );
}
