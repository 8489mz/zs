import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { formatCurrency, formatDateTimeArabic, formatWhatsAppNumber } from '@/lib/format';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { openWhatsApp } from '@/lib/whatsapp';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { CheckCircleIcon, WhatsAppIcon } from './supplier-schedule-helpers';
import type { Supplier } from '@/types/domain';
import type { Dispatch, SetStateAction } from 'react';

export interface SupplierDirectSuccessModalProps {
  directSuccessReceipt: { amountPaid: number; remainingBalance: number; note?: string };
  setDirectSuccessReceipt: Dispatch<SetStateAction<{ amountPaid: number; remainingBalance: number; note?: string } | null>>;
  supplier: Supplier | null;
  supplierName: string;
}

export function SupplierDirectSuccessModal({ directSuccessReceipt, setDirectSuccessReceipt, supplier, supplierName }: SupplierDirectSuccessModalProps) {
  const { t } = useTranslation();
  const { data: settings } = useSettingsQuery();
  return (
    <div className="dialog-overlay supplier-payment-dialog-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setDirectSuccessReceipt(null); }}>
      <div className="dialog-shell supplier-payment-dialog" role="dialog" aria-modal="true" aria-label={t('accounts.supplier_balance_schedule_card.s110', "تم تسجيل السداد بنجاح")}>
        <div className="dialog-card supplier-payment-dialog-card" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem', color: '#16a34a' }}>
            <CheckCircleIcon size={52} />
          </div>
          <h3 style={{ marginBottom: '0.5rem' }}>{t('accounts.supplier_balance_schedule_card.s111', "تم تسجيل صرف المبلغ بنجاح")}</h3>
          <p className="muted" style={{ marginBottom: '1.5rem' }}>
            {t('accounts.supplier_balance_schedule_card.s112', "تم سداد")} {formatCurrency(directSuccessReceipt.amountPaid)} {t('accounts.supplier_balance_schedule_card.s113', "لصالح المورد")} {supplierName} {t('accounts.supplier_balance_schedule_card.s114', "(الرصيد المتبقي له:")} {formatCurrency(directSuccessReceipt.remainingBalance)}).
          </p>

          <div className="actions compact-actions supplier-payment-dialog-actions" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button
              type="button"
              onClick={() => {
                const rawPhone = supplier?.phone || '';
                const phone = formatWhatsAppNumber(rawPhone);
                const remaining = directSuccessReceipt.remainingBalance;
                const noteLine = directSuccessReceipt.note ? `\n• البيان: *${directSuccessReceipt.note}*` : '';
                const text = `مرحباً ${supplierName}،\nتم تسجيل صرف دفعة نقدية لكم بقيمة: *${formatCurrency(directSuccessReceipt.amountPaid)} ${getGlobalCurrencySymbol()}*${noteLine}\n• التاريخ والوقت: ${formatDateTimeArabic()}\n• إجمالي الرصيد المتبقي لكم: *${formatCurrency(remaining)} ${getGlobalCurrencySymbol()}*\nشكراً لتعاملكم معنا.`;
                const encodedText = encodeURIComponent(text);
                let url = `https://wa.me/${phone}?text=${encodedText}`;
                if (settings?.whatsappLinkMode === 'web') {
                  url = `https://web.whatsapp.com/send/?phone=${phone}&text=${encodedText}`;
                } else if (settings?.whatsappLinkMode === 'app') {
                  url = `whatsapp://send?phone=${phone}&text=${encodedText}`;
                }
                openWhatsApp(url);
                setDirectSuccessReceipt(null);
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <WhatsAppIcon size={16} /> {t('accounts.supplier_balance_schedule_card.s115', "إرسال إيصال للمورد عبر واتساب")}
              </span>
            </Button>
            <Button type="button" variant="secondary" onClick={() => setDirectSuccessReceipt(null)}>
              {t('accounts.supplier_balance_schedule_card.s116', "إغلاق")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
