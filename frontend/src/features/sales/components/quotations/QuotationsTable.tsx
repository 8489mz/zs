import { useTranslation } from 'react-i18next';
import React from 'react';
import { Quotation } from '@/features/sales/api/quotations.api';
import { Trash2Icon } from '@/shared/components/icons/AppIcons';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { systemConfirm } from '@/shared/components/system-alert';

interface QuotationsTableProps {
  quotations: Quotation[];
  getStatusBadge: (status: string, saleId?: number) => React.ReactNode;
  onPrint: (q: Quotation) => void;
  onConvert: (id: number) => void;
  onDelete: (id: number) => void;
  isConvertPending: boolean;
}

export function QuotationsTable({
  quotations,
  getStatusBadge,
  onPrint,
  onConvert,
  onDelete,
  isConvertPending,
}: QuotationsTableProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'start' }}>
            <th style={{ padding: '12px 16px', fontWeight: 800 }}>{t('sales.quotations.quotations_table.s0', "رقم العرض")}</th>
            <th style={{ padding: '12px 16px', fontWeight: 800 }}>{t('sales.quotations.quotations_table.s1', "العميل")}</th>
            <th style={{ padding: '12px 16px', fontWeight: 800 }}>{t('sales.quotations.quotations_table.s2', "الهاتف")}</th>
            <th style={{ padding: '12px 16px', fontWeight: 800 }}>{t('sales.quotations.quotations_table.s3', "الإجمالي")}</th>
            <th style={{ padding: '12px 16px', fontWeight: 800 }}>{t('sales.quotations.quotations_table.s4', "الحالة")}</th>
            <th style={{ padding: '12px 16px', fontWeight: 800 }}>{t('sales.quotations.quotations_table.s5', "التاريخ")}</th>
            <th style={{ padding: '12px 16px', fontWeight: 800, textAlign: 'center' }}>{t('sales.quotations.quotations_table.s6', "الإجراءات")}</th>
          </tr>
        </thead>
        <tbody>
          {quotations.map((q) => (
            <tr key={q.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '12px 16px', fontWeight: 800, color: '#170e5e' }}>#{q.quotation_number}</td>
              <td style={{ padding: '12px 16px', fontWeight: 700 }}>{q.customer_name}</td>
              <td style={{ padding: '12px 16px', color: '#64748b' }}>{q.customer_phone || '-'}</td>
              <td style={{ padding: '12px 16px', fontWeight: 800, color: '#0f172a' }}>
                {Number(q.total_amount).toLocaleString(isEn ? 'en-US' : 'ar-EG')} {getGlobalCurrencySymbol()}
              </td>
              <td style={{ padding: '12px 16px' }}>{getStatusBadge(q.status, q.sale_id ?? undefined)}</td>
              <td style={{ padding: '12px 16px', color: '#64748b', fontSize: '12px' }}>
                {new Date(q.created_at).toLocaleDateString(isEn ? 'en-US' : 'ar-EG')}
              </td>
              <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => onPrint(q)}
                    title={t('sales.quotations.quotations_table.s7', "طباعة / تصدير PDF")}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      padding: '4px 10px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      color: '#0f172a',
                    }}
                  >
                    {t('sales.quotations.quotations_table.s8', "طباعة")}
                  </button>

                  {q.status !== 'converted' && (
                    <button
                      type="button"
                      disabled={isConvertPending}
                      onClick={async () => {
                        // I3-D3: NEVER gate on the synchronous raw confirm(...)
                        // here. SystemAlertProvider replaces window.confirm
                        // with a shim that always returns false, so this
                        // convert was a silent no-op (no request, no toast).
                        const ok = await systemConfirm({
                          title: 'تحويل عرض السعر إلى فاتورة',
                          message: `هل أنت متأكد من تحويل عرض السعر #${q.quotation_number} إلى فاتورة بيع نهائية؟`,
                          confirmText: 'تحويل لفاتورة',
                          cancelText: 'إلغاء',
                        });
                        if (ok) {
                          onConvert(q.id);
                        }
                      }}
                      title={t('sales.quotations.quotations_table.s9', "تحويل إلى فاتورة بيع")}
                      style={{
                        background: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        fontSize: '12px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        color: '#1d4ed8',
                      }}
                    >
                      {t('sales.quotations.quotations_table.s10', "تحويل لفاتورة")}
                    </button>
                  )}

                  {q.status !== 'converted' && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(t('sales.quotations.quotations_table.s11', "هل تريد حذف عرض السعر؟"))) {
                          onDelete(q.id);
                        }
                      }}
                      title={t('sales.quotations.quotations_table.s12', "حذف")}
                      style={{
                        background: '#fff1f2',
                        border: '1px solid #fecdd3',
                        borderRadius: '6px',
                        padding: '5px 8px',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Trash2Icon size={14} color="#e11d48" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
