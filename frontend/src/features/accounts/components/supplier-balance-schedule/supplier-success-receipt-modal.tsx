import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { formatCurrency, formatDateTimeArabic, formatWhatsAppNumber } from '@/lib/format';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { openWhatsApp } from '@/lib/whatsapp';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { CheckCircleIcon, WhatsAppIcon } from './supplier-schedule-helpers';
import type { Supplier } from '@/types/domain';
import type { SupplierPaymentScheduleItem } from '@/features/accounts/api/supplier-balance-schedule.api';
import type { Dispatch, SetStateAction } from 'react';

export interface SupplierSuccessReceiptModalProps {
  successReceipt: { row: SupplierPaymentScheduleItem; amountPaid: number; remainingBalance: number; note?: string };
  setSuccessReceipt: Dispatch<SetStateAction<{ row: SupplierPaymentScheduleItem; amountPaid: number; remainingBalance: number; note?: string } | null>>;
  supplier: Supplier | null;
  supplierName: string;
}

export function SupplierSuccessReceiptModal({ successReceipt, setSuccessReceipt, supplier, supplierName }: SupplierSuccessReceiptModalProps) {
  const { t } = useTranslation();
  const { data: settings } = useSettingsQuery();
  return (
    <div className="dialog-overlay supplier-payment-dialog-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setSuccessReceipt(null); }}>
      <div className="dialog-shell supplier-payment-dialog" role="dialog" aria-modal="true" aria-label={t('accounts.supplier_balance_schedule_card.s103', "تم الدفع بنجاح")}>
        <div className="dialog-card supplier-payment-dialog-card" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem', color: '#16a34a' }}>
            <CheckCircleIcon size={52} />
          </div>
          <h3 style={{ marginBottom: '0.5rem' }}>{t('accounts.supplier_balance_schedule_card.s104', "تم تسجيل الدفعة بنجاح")}</h3>
          <p className="muted" style={{ marginBottom: '1.5rem' }}>
            {t('accounts.supplier_balance_schedule_card.s105', "تم سداد")} {formatCurrency(successReceipt.amountPaid)} {t('accounts.supplier_balance_schedule_card.s106', "لصالح")} {supplierName} {t('accounts.supplier_balance_schedule_card.s107', "(المتبقي:")} {formatCurrency(successReceipt.remainingBalance)}).
          </p>

          <div className="actions compact-actions supplier-payment-dialog-actions" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button
              type="button"
              onClick={() => {
                const rawPhone = supplier?.phone || '';
                const phone = formatWhatsAppNumber(rawPhone);
                const remaining = successReceipt.remainingBalance;
                const noteSuffix = successReceipt.note ? ` (${successReceipt.note})` : '';
                const text = `مرحباً ${supplierName}،\nتم سداد دفعة نقدية لكم بقيمة: *${formatCurrency(successReceipt.amountPaid)} ${getGlobalCurrencySymbol()}*\n• البيان: *تسوية القسط رقم (${successReceipt.row.installmentNo}) من جدول المستحقات*${noteSuffix}\n• التاريخ والوقت: ${formatDateTimeArabic()}\n• إجمالي الرصيد المتبقي لكم: *${formatCurrency(remaining)} ${getGlobalCurrencySymbol()}*\nشكراً لتعاملكم معنا.`;
                const encodedText = encodeURIComponent(text);
                let url = `https://wa.me/${phone}?text=${encodedText}`;
                if (settings?.whatsappLinkMode === 'web') {
                  url = `https://web.whatsapp.com/send/?phone=${phone}&text=${encodedText}`;
                } else if (settings?.whatsappLinkMode === 'app') {
                  url = `whatsapp://send?phone=${phone}&text=${encodedText}`;
                }
                openWhatsApp(url);
                setSuccessReceipt(null);
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <WhatsAppIcon size={16} /> {t('accounts.supplier_balance_schedule_card.s108', "إرسال للمورد عبر واتساب")}
              </span>
            </Button>
            <Button type="button" variant="secondary" onClick={() => setSuccessReceipt(null)}>{t('accounts.supplier_balance_schedule_card.s109', "إغلاق النافذة")}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
