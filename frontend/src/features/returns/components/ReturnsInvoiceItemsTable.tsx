import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/shared/ui/empty-state';
import { formatCurrency } from '@/lib/format';
import { remainingInvoiceLineQuantity, isReturnLineSelected } from '@/features/returns/lib/return-remaining-quantity';
import type { PurchaseItem, SaleItem } from '@/types/domain';

export function ReturnsInvoiceItemsTable({
  invoiceItems,
  selectedItems,
  selectedSerials,
  onToggleItem,
  onSetItemQty,
  onSetSerials,
  returnedQtyByLine = {},
  blockedProductIds = [],
  returnHistoryReady = false,
}: {
  invoiceItems: Array<SaleItem | PurchaseItem>;
  selectedItems: Record<string, string>;
  selectedSerials: Record<string, string>;
  onToggleItem: (itemId: string, checked: boolean) => void;
  onSetItemQty: (itemId: string, value: string) => void;
  onSetSerials: (itemId: string, value: string) => void;
  returnedQtyByLine?: Record<string, number>;
  blockedProductIds?: string[];
  returnHistoryReady?: boolean;
}) {
  const { t } = useTranslation();

  if (!invoiceItems.length) {
    return <EmptyState title={t('returns.empty_invoice_title', 'اختر فاتورة أولًا')} hint={t('returns.empty_invoice_hint', 'بعد اختيار الفاتورة ستظهر البنود لتحديد أكثر من بند في نفس المرتجع.')} />;
  }

  return (
    <div className="section-stack" style={{ gap: '8px' }}>
      <div className="surface-note" style={{ fontSize: '12px', color: '#64748b', padding: '6px 10px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
        {t('returns.items_note', 'اختر بندًا أو أكثر ثم حدد الكمية لكل بند. التحقق النهائي يتم من السيرفر عند الحفظ.')}
      </div>
      <div style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid #e2e8f0', background: '#ffffff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
          <colgroup>
            <col style={{ width: '48px' }} />
            <col style={{ width: 'auto' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '110px' }} />
            <col style={{ width: '110px' }} />
          </colgroup>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: '12px', fontWeight: 700, color: '#475569' }}>{t('returns.col_select', 'اختيار')}</th>
              <th style={{ padding: '8px 10px', textAlign: 'start', fontSize: '12px', fontWeight: 700, color: '#475569' }}>{t('returns.col_product', 'الصنف')}</th>
              <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: '12px', fontWeight: 700, color: '#475569' }}>{t('returns.col_base_qty', 'الكمية الأصلية')}</th>
              <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: '12px', fontWeight: 700, color: '#475569' }}>{t('returns.col_return_qty', 'الكمية المرتجعة')}</th>
              <th style={{ padding: '8px 10px', textAlign: 'end', fontSize: '12px', fontWeight: 700, color: '#475569' }}>{t('returns.col_expected_val', 'القيمة المتوقعة')}</th>
            </tr>
          </thead>
          <tbody>
            {invoiceItems.map((item) => {
              const itemId = String(item.id || item.productId || '');
              // SPICE-PKG3 (a): selection is key presence — a weighed
              // line corrected through '' / 0 stays selected and its
              // input stays enabled; qty > 0 would un-check it mid-edit.
              const isSelected = isReturnLineSelected(selectedItems, itemId);
              const qty = Number(selectedItems[itemId] || 0);
              const baseQty = Number(item.qty || 0);
              const alreadyReturnedQty = Number(returnedQtyByLine[itemId] || 0);
              const legacyBlocked = blockedProductIds.includes(String(item.productId));
              const remainingQty = remainingInvoiceLineQuantity(baseQty, alreadyReturnedQty,
                returnHistoryReady, legacyBlocked);
              const isFullyReturned = remainingQty <= 0.000001;
              const lineTotal = qty > 0 ? qty * (baseQty > 0 ? Number(item.total || 0) / baseQty : 0) : 0;
              return (
                <tr key={itemId} style={{ borderBottom: '1px solid #f1f5f9', background: isSelected ? '#f8fafc' : '#ffffff', opacity: isFullyReturned ? 0.58 : 1 }}>
                  <td style={{ textAlign: 'center', padding: '8px' }}>
                    <input type="checkbox" checked={isSelected} onChange={(e) => onToggleItem(itemId, e.target.checked)} disabled={isFullyReturned} title={isFullyReturned ? t('returns.fully_returned_hint', 'هذا الصنف تم إرجاعه بالكامل ولا يمكن إرجاعه مرة أخرى.') : undefined} />
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#0f172a' }}>{item.name || '—'}</div>
                    {legacyBlocked ? <span className="status-pill danger" style={{ fontSize: '10.5px' }}>مرتجع قديم يحتاج تسوية</span> : null}
                    {isFullyReturned && !legacyBlocked ? <span className="status-pill danger" style={{ fontSize: '10.5px' }}>{t('returns.fully_returned_pill', 'تم إرجاعه بالكامل')}</span> : alreadyReturnedQty > 0 ? <span className="status-pill warning" style={{ fontSize: '10.5px' }}>{t('returns.remaining_qty', 'متبقي للإرجاع: {{qty}}', { qty: remainingQty })}</span> : null}
                    {'serials' in item && Array.isArray(item.serials) && item.serials.length > 0 ? (
                      <label style={{ display: 'block', marginTop: 4, fontSize: '11px', color: '#64748b' }}>
                        {t('returns.serials_label', 'سيريالات المرتجع الجزئي')}
                        <input type="text" value={selectedSerials[itemId] || ''}
                          onChange={(event) => onSetSerials(itemId, event.target.value)}
                          placeholder={item.serials.join(', ')} disabled={!isSelected || isFullyReturned}
                          aria-label={t('returns.serials_aria', 'سيريالات مرتجع {{name}}', { name: item.name })}
                          style={{ width: '100%', padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '11.5px', marginTop: '2px' }}
                        />
                      </label>
                    ) : null}
                  </td>
                  <td style={{ textAlign: 'center', padding: '8px', fontSize: '12.5px', fontWeight: 700, color: '#0f172a' }}>{baseQty}</td>
                  <td style={{ textAlign: 'center', padding: '8px' }}>
                    <input
                      type="number"
                      min="0"
                      max={remainingQty || undefined}
                      step="0.001"
                      value={selectedItems[itemId] || ''}
                      onChange={(e) => onSetItemQty(itemId, e.target.value)}
                      disabled={!isSelected || isFullyReturned}
                      style={{
                        width: '75px',
                        padding: '4px 6px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        textAlign: 'center',
                        fontSize: '12.5px',
                        fontWeight: 700,
                        color: '#0f172a',
                      }}
                    />
                  </td>
                  <td style={{ textAlign: 'end', padding: '8px 10px', fontSize: '12.5px', fontWeight: 800, color: isSelected ? '#170e5e' : '#94a3b8' }}>
                    {isSelected ? formatCurrency(lineTotal) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
