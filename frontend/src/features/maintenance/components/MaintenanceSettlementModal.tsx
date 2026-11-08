/* MaintenanceSettlementModal — delivery settlement (D-M1-1: NO discount concept).
 * The final agreed amount IS the revenue: the operator edits the final amount,
 * the amount to collect is derived (final − advance) and shown, never edited.
 * The payment method is sent through so the backend posts card/wallet/instapay
 * to 1120 instead of cash 1110. */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { XIcon } from '@/shared/components/icons/AppIcons';
import { MaintenanceIcons as Icons } from './MaintenanceConstants';
import type { MaintenancePaymentMethod } from '../api/maintenance.api';
import type { MaintenanceTicket } from '@/types/domain-models/maintenance';

interface MaintenanceSettlementModalProps {
  settlementTicket: MaintenanceTicket | null;
  onClose: () => void;
  onConfirm: (finalCost: number, collectedAmount: number, paymentMethod: MaintenancePaymentMethod) => void;
  isPending: boolean;
}

export function MaintenanceSettlementModal({
  settlementTicket,
  onClose,
  onConfirm,
  isPending,
}: MaintenanceSettlementModalProps) {
  const { t } = useTranslation();
  const [finalAmount, setFinalAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<MaintenancePaymentMethod>('cash');

  const ticketId = settlementTicket?.id ?? null;
  useEffect(() => {
    if (settlementTicket) {
      setFinalAmount(settlementTicket.finalCost || settlementTicket.expectedCost || 0);
      setPaymentMethod('cash');
    }
  }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!settlementTicket) return null;

  const advancePaid = settlementTicket.advancePayment || 0;
  const collectedAmount = Math.max(0, finalAmount - advancePaid);
  const finalBelowAdvance = finalAmount < advancePaid;

  return (
    <DialogShell
      open={Boolean(settlementTicket)}
      onClose={onClose}
      width="min(540px, 95vw)"
      ariaLabel={t('maintenance.maintenance_settlement_modal.s0', "تأكيد تحصيل وتسليم جهاز الصيانة")}
    >
      <div className="page-stack" dir="rtl" style={{ gap: '14px', padding: '20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', color: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icons.CheckCircle />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>
                {t('maintenance.maintenance_settlement_modal.s1', "تحصيل وتسليم الجهاز:")} <span style={{ fontFamily: 'monospace', color: '#0f172a' }}>{settlementTicket.ticketNo}</span>
              </h3>
              <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                {t('maintenance.maintenance_settlement_modal.s2', "العميل:")} <strong>{settlementTicket.customerName}</strong> ({settlementTicket.deviceBrand ? `${settlementTicket.deviceBrand} ` : ''}{settlementTicket.deviceModel})
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', width: '28px', height: '28px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}
          >
            <XIcon size={14} />
          </button>
        </div>

        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', textAlign: 'center', fontSize: '0.78rem' }}>
          <div style={{ background: '#fff', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
            <div style={{ color: '#64748b', marginBottom: '2px' }}>{t('maintenance.maintenance_settlement_modal.s3', "إجمالي الحساب")}</div>
            <strong style={{ fontSize: '0.95rem', color: '#0f172a' }}>{finalAmount.toFixed(2)} <CurrencySymbol /></strong>
          </div>
          <div style={{ background: '#fff', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
            <div style={{ color: '#64748b', marginBottom: '2px' }}>{t('maintenance.maintenance_settlement_modal.s4', "المدفوع مقدماً")}</div>
            <strong style={{ fontSize: '0.95rem', color: '#0f172a' }}>{advancePaid.toFixed(2)} <CurrencySymbol /></strong>
          </div>
          <div style={{ background: '#ffffff', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
            <div style={{ color: '#475569', marginBottom: '2px' }}>{t('maintenance.maintenance_settlement_modal.s5', "المطلوب تحصيله")}</div>
            <strong style={{ fontSize: '0.95rem', color: '#0f172a' }}>{collectedAmount.toFixed(2)} <CurrencySymbol /></strong>
          </div>
        </div>

        <div style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '12px' }}>
          <label htmlFor="maintenance-settlement-final-amount" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('maintenance.maintenance_settlement_modal.s21', "المبلغ النهائي المتفق عليه مع العميل:")}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              id="maintenance-settlement-final-amount"
              type="number"
              min="0"
              step="5"
              className="purchase-prototype-field-input"
              value={finalAmount}
              onChange={(e) => setFinalAmount(Number(e.target.value))}
              style={{ width: '100%', height: '38px', fontSize: '1.1rem', fontWeight: 800, padding: '0 12px', borderRadius: '6px', border: '1px solid #cbd5e1', color: '#0f172a' }}
            />
            <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#64748b', whiteSpace: 'nowrap' }}><CurrencySymbol /></span>
          </div>
          {finalBelowAdvance && (
            <div style={{ marginTop: '6px', fontSize: '0.78rem', fontWeight: 700, color: '#b91c1c' }}>
              {t('maintenance.maintenance_settlement_modal.s22', "المبلغ النهائي لا يمكن أن يكون أقل من العربون المدفوع مقدماً.")}
            </div>
          )}
        </div>

        <div style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '12px' }}>
          <label htmlFor="maintenance-settlement-payment-method" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('maintenance.maintenance_settlement_modal.s23', "طريقة الدفع:")}
          </label>
          <select
            id="maintenance-settlement-payment-method"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as MaintenancePaymentMethod)}
            className="purchase-prototype-field-input"
            style={{ width: '100%', padding: '6px 8px', borderRadius: '5px', border: '1px solid #cbd5e1', background: '#fff', fontWeight: 600, fontSize: '0.85rem' }}
          >
            <option value="cash">{t('maintenance.maintenance_settlement_modal.s24', "نقدي")}</option>
            <option value="card">{t('maintenance.maintenance_settlement_modal.s25', "بطاقة بنكية")}</option>
            <option value="wallet">{t('maintenance.maintenance_settlement_modal.s26', "محفظة إلكترونية")}</option>
            <option value="instapay">{t('maintenance.maintenance_settlement_modal.s27', "إنستاباي")}</option>
          </select>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
          <Button type="button" variant="secondary" onClick={onClose} style={{ fontSize: '0.85rem' }}>
            {t('maintenance.maintenance_settlement_modal.s18', "إلغاء")}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => onConfirm(finalAmount, collectedAmount, paymentMethod)}
            disabled={isPending || finalBelowAdvance}
            style={{ padding: '7px 20px', fontWeight: 700, fontSize: '0.85rem' }}
          >
            {isPending ? t('maintenance.maintenance_settlement_modal.s19', "جاري التحصيل...") : t('maintenance.maintenance_settlement_modal.s20', "تأكيد التحصيل والتسليم النهائي")}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
