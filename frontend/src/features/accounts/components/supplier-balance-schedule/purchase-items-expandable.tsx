import { useTranslation } from 'react-i18next';
import { usePurchaseDetailQuery } from '@/shared/hooks/use-catalog-queries';
import { formatCurrency } from '@/lib/format';

export function PurchaseItemsExpandable({ purchaseId, onSelectAmount }: { purchaseId: string; onSelectAmount?: (amount: number, invoiceDocNo: string) => void }) {
  const { t } = useTranslation();
  const { data: purchase, isLoading, error } = usePurchaseDetailQuery(purchaseId);

  if (isLoading) {
    return (
      <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px', fontSize: '0.85rem', color: '#64748b' }}>
        {t('accounts.supplier_balance_schedule_card.s0', "جاري جلب تفاصيل وأصناف فاتورة المشتريات #")}{purchaseId}...
      </div>
    );
  }

  if (error || !purchase) {
    return (
      <div style={{ padding: '12px', background: '#fef2f2', borderRadius: '6px', fontSize: '0.85rem', color: '#b91c1c' }}>
        {t('accounts.supplier_balance_schedule_card.s1', "تعذر تحميل تفاصيل فاتورة المشتريات #")}{purchaseId}
      </div>
    );
  }

  const items = purchase.items || [];
  const total = Number(purchase.total || 0);
  const docNumber = purchase.docNo || `P-${purchase.id}`;

  return (
    <div style={{ padding: '12px 14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', margin: '6px 0 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <strong style={{ fontSize: '0.88rem', color: '#0f172a' }}>
            {t('accounts.supplier_balance_schedule_card.s2', "أصناف فاتورة المشتريات:")} {docNumber}
          </strong>
          <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
            ({items.length} {t('accounts.supplier_balance_schedule_card.s3', "أصناف)")}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.82rem' }}>
          <span>{t('accounts.supplier_balance_schedule_card.s4', "إجمالي الفاتورة:")} <b>{formatCurrency(total)}</b></span>
          <span>{t('accounts.supplier_balance_schedule_card.s5', "طريقة الدفع:")} <b>{purchase.paymentType === 'credit' ? t('accounts.supplier_balance_schedule_card.s6', "آجل") : t('accounts.supplier_balance_schedule_card.s7', "نقدي")}</b></span>
          {total > 0 && onSelectAmount ? (
            <button
              type="button"
              onClick={() => onSelectAmount(total, docNumber)}
              style={{
                background: '#eff6ff',
                color: '#2563eb',
                border: '1px solid #bfdbfe',
                borderRadius: '4px',
                padding: '2px 8px',
                fontSize: '0.76rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {t('accounts.supplier_balance_schedule_card.s8', "سداد قيمة هذه الفاتورة (")}{formatCurrency(total)})
            </button>
          ) : null}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', background: '#ffffff', borderRadius: '6px', overflow: 'hidden' }}>
          <thead>
            <tr style={{ background: '#f1f5f9', color: '#475569', textAlign: 'right' }}>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{t('accounts.supplier_balance_schedule_card.s9', "الصنف")}</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{t('accounts.supplier_balance_schedule_card.s10', "الوحدة")}</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{t('accounts.supplier_balance_schedule_card.s11', "الكمية")}</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{t('accounts.supplier_balance_schedule_card.s12', "سعر الشراء")}</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{t('accounts.supplier_balance_schedule_card.s13', "الإجمالي")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: any, idx: number) => {
              const name = item.productName || item.name || item.product?.name || t('accounts.supplier_balance_schedule_card.s14', "صنف");
              const unit = item.unitName || item.unit || '—';
              const qty = Number(item.qty || item.quantity || 1);
              const price = Number(item.costPrice ?? item.price ?? item.unitCost ?? 0);
              const lineTotal = Number(item.lineTotal ?? item.total ?? (qty * price));
              return (
                <tr key={item.id || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '6px 10px', fontWeight: 600, color: '#1e293b' }}>{name}</td>
                  <td style={{ padding: '6px 10px', color: '#64748b' }}>{unit}</td>
                  <td style={{ padding: '6px 10px', fontWeight: 600 }}>{qty}</td>
                  <td style={{ padding: '6px 10px', color: '#475569' }}>{formatCurrency(price)}</td>
                  <td style={{ padding: '6px 10px', fontWeight: 700, color: '#0f172a' }}>{formatCurrency(lineTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
