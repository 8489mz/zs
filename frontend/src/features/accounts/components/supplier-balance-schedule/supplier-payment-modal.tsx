import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { formatCurrency } from '@/lib/format';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import type { SupplierPaymentScheduleItem } from '@/features/accounts/api/supplier-balance-schedule.api';

export interface SupplierPaymentModalProps {
  paymentAmount: string;
  paymentNote: string;
  paymentTarget: SupplierPaymentScheduleItem;
  schedulePaymentChannel: 'cash' | 'bank' | 'card' | 'wallet' | 'instapay';
  schedulePaymentInstapayAddress: string;
  setPaymentAmount: Dispatch<SetStateAction<string>>;
  setPaymentNote: Dispatch<SetStateAction<string>>;
  setPaymentTarget: Dispatch<SetStateAction<SupplierPaymentScheduleItem | null>>;
  setSchedulePaymentChannel: Dispatch<SetStateAction<'cash' | 'bank' | 'card' | 'wallet' | 'instapay'>>;
  setSchedulePaymentInstapayAddress: Dispatch<SetStateAction<string>>;
  settleMutation: {
    mutate: (variables: {
      row: SupplierPaymentScheduleItem;
      amount?: number;
      paymentNote?: string;
    }) => void;
    isPending: boolean;
  };
  supplierName: string;
}

export function SupplierPaymentModal({
  paymentAmount,
  paymentNote,
  paymentTarget,
  schedulePaymentChannel,
  schedulePaymentInstapayAddress,
  setPaymentAmount,
  setPaymentNote,
  setPaymentTarget,
  setSchedulePaymentChannel,
  setSchedulePaymentInstapayAddress,
  settleMutation,
  supplierName,
}: SupplierPaymentModalProps) {
  const { t } = useTranslation();
  return (
    <div className="dialog-overlay supplier-payment-dialog-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setPaymentTarget(null); }}>
      <div className="dialog-shell supplier-payment-dialog" role="dialog" aria-modal="true" aria-label={`تأكيد تسليم الدفعة إلى ${supplierName}`}>
        <div className="dialog-card supplier-payment-dialog-card">
          <div className="supplier-payment-dialog-header supplier-payment-dialog-header--centered">
            <div>
              <h3>{t('accounts.supplier_balance_schedule_card.s95', "تأكيد تسليم الدفعة إلى")} {supplierName}</h3>
              <p className="muted">{t('accounts.supplier_balance_schedule_card.s96', "دفعة")} {paymentTarget.installmentNo} {t('accounts.supplier_balance_schedule_card.s97', "— المتبقي")} {formatCurrency(paymentTarget.remainingAmount)}</p>
            </div>
          </div>
          <div className="form-grid supplier-payment-dialog-form">
            <Field label={t('accounts.supplier_balance_schedule_card.s98', "المبلغ المدفوع")}>
              <input type="number" min="0.01" step="0.01" max={paymentTarget.remainingAmount} value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
            </Field>
            <Field label="وسيلة سداد القسط">
               <select value={schedulePaymentChannel} onChange={e => setSchedulePaymentChannel(e.target.value as typeof schedulePaymentChannel)} disabled={settleMutation.isPending}>
                 <option value="cash">نقدي (درج الكاشير)</option>
                 <option value="bank">تحويل بنكي</option>
                 <option value="card">بطاقة</option>
                 <option value="wallet">محفظة إلكترونية</option>
                 <option value="instapay">إنستاباي</option>
               </select>
             </Field>
             {schedulePaymentChannel === 'instapay' && (
               <Field label={t('accounts.supplier_balance_schedule_card.s115', "رقم حساب إنستاباي (IPA)")}>
                 <input type="text" value={schedulePaymentInstapayAddress} onChange={(event) => setSchedulePaymentInstapayAddress(event.target.value)} placeholder={t('accounts.supplier_balance_schedule_card.s116', "مثال: name@instapay")} disabled={settleMutation.isPending} />
               </Field>
             )}
             <Field label={t('accounts.supplier_balance_schedule_card.s99', "ملاحظات اختيارية")}>
              <textarea rows={3} value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} placeholder={t('accounts.supplier_balance_schedule_card.s100', "مثال: تم التسليم لمندوب المورد / رقم إيصال / ملاحظة داخلية")} />
            </Field>
          </div>
          <div className="actions compact-actions supplier-payment-dialog-actions">
            <Button type="button" onClick={() => settleMutation.mutate({ row: paymentTarget, amount: paymentAmount ? Number(paymentAmount) : undefined, paymentNote })} disabled={settleMutation.isPending}>{t('accounts.supplier_balance_schedule_card.s101', "تأكيد تسليم الدفعة للمورد")}</Button>
            <Button type="button" variant="secondary" onClick={() => setPaymentTarget(null)} disabled={settleMutation.isPending}>{t('accounts.supplier_balance_schedule_card.s102', "إلغاء")}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
