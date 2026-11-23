import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import type { useTranslation } from 'react-i18next';
import type { StockCountType } from './inventory-composer-cards-shared';
import type { Product, StockCountItem } from '@/types/domain';

export interface StockCountComposerTableProps {
  filteredItems: StockCountItem[];
  t: ReturnType<typeof useTranslation>['t'];
  canShowExpectedCount: boolean;
  pagination: { page: number; pageSize: number; pageSizeOptions: number[]; totalItems: number; totalPages: number; rangeStart: number; rangeEnd: number; rows: StockCountItem[]; hasPreviousPage: boolean; hasNextPage: boolean; goToPage: (nextPage: number) => void; setPageSize: (nextPageSize: number) => void; resetPagination: () => void; };
  products: Product[];
  updateCountItemById: (id: string, patch: Partial<StockCountItem>) => void;
  removeCountItemById: (id: string) => void;
  items: StockCountItem[];
  countType: StockCountType;
}

export function StockCountComposerTable({ filteredItems, t, canShowExpectedCount, pagination, products, updateCountItemById, removeCountItemById, items, countType }: StockCountComposerTableProps) {
  return (
    <div className="table-wrap stock-count-items-table-wrap">
      {filteredItems.length ? (
        <>
        <table className="stock-count-items-table">
          <thead>
            <tr>
              <th style={{ width: '40px', textAlign: 'center' }}>#</th>
              <th>{t('inventory.sections.inventory_composer_cards.s74', "الصنف")}</th>
              {canShowExpectedCount ? <th style={{ textAlign: 'center' }}>{t('inventory.sections.inventory_composer_cards.s75', "كمية النظام")}</th> : null}
              <th style={{ width: '130px', textAlign: 'center' }}>{t('inventory.sections.inventory_composer_cards.s76', "الكمية المعدودة")}</th>
              {canShowExpectedCount ? <th style={{ textAlign: 'center' }}>{t('inventory.sections.inventory_composer_cards.s77', "الفرق")}</th> : null}
              <th>{t('inventory.sections.inventory_composer_cards.s78', "سبب الفرق")}</th>
              <th style={{ width: '70px', textAlign: 'center' }}>{t('inventory.sections.inventory_composer_cards.s79', "إجراء")}</th>
            </tr>
          </thead>
          <tbody>
            {pagination.rows.map((item, index) => {
              const prod = products.find((p) => String(p.id) === String(item.productId));
              const isSerialized = Boolean(prod?.trackSerials || (item.countedSerials && item.countedSerials.length > 0));
              const hasBatchTracking = Boolean(item.batchCountsText);
              return (
                <tr key={item.id}>
                  <td style={{ textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>{pagination.rangeStart + index}</td>
                  <td>
                    <strong>{item.productName}</strong>
                    {(isSerialized || hasBatchTracking) ? (
                      <div style={{ marginTop: 4, display: 'grid', gap: 3 }}>
                        {isSerialized ? (
                          <textarea
                            rows={2}
                            style={{ fontSize: 11, minWidth: 130 }}
                            placeholder="السيريالات الموجودة فعلاً (رقم في كل سطر)"
                            value={(item.countedSerials || []).join('\n')}
                            onChange={event => updateCountItemById(item.id, {
                              countedSerials: event.target.value.split(/[\n,،]+/).map(s => s.trim()).filter(Boolean),
                            })}
                          />
                        ) : null}
                        {hasBatchTracking ? (
                          <textarea
                            rows={2}
                            style={{ fontSize: 11, minWidth: 130 }}
                            placeholder="رصيد التشغيلات: رقم:كمية؛ الجديدة NEW:الرقم:YYYY-MM-DD:كمية"
                            value={item.batchCountsText || ''}
                            onChange={event => updateCountItemById(item.id, { batchCountsText: event.target.value })}
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                {canShowExpectedCount ? <td style={{ textAlign: 'center' }} className="muted">{item.expectedQty || 0}</td> : null}
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    placeholder="—"
                    style={{
                      textAlign: 'center',
                      fontWeight: 'bold',
                      backgroundColor: (item.countedQty === '' || item.countedQty == null) ? '#fafafa' : '#ffffff',
                      color: (item.countedQty === '' || item.countedQty == null) ? '#94a3b8' : '#0f172a',
                    }}
                    value={item.countedQty === '' || item.countedQty == null ? '' : String(item.countedQty)}
                    onChange={(event) => {
                      const val = event.target.value;
                      if (val === '') {
                        updateCountItemById(item.id, { countedQty: '', isCounted: false });
                      } else {
                        updateCountItemById(item.id, { countedQty: Number(val), isCounted: true });
                      }
                    }}
                  />
                </td>
                {canShowExpectedCount ? (
                  <td style={{ textAlign: 'center' }}>
                    {item.isCounted === false || item.countedQty === '' || item.countedQty == null ? (
                      <span className="muted" style={{ fontSize: '12px' }}>—</span>
                    ) : Number(item.varianceQty || 0) === 0 ? (
                      <span className="stock-count-variance stock-count-variance--zero">{t('inventory.sections.inventory_composer_cards.s80', "مطابق (0)")}</span>
                    ) : Number(item.varianceQty || 0) < 0 ? (
                      <span className="stock-count-variance stock-count-variance--deficit">{t('inventory.sections.inventory_composer_cards.s81', "عجز")} {item.varianceQty}</span>
                    ) : (
                      <span className="stock-count-variance stock-count-variance--surplus">{t('inventory.sections.inventory_composer_cards.s82', "زيادة +")}{item.varianceQty}</span>
                    )}
                  </td>
                ) : null}
                <td>
                  <input value={item.reason || ''} onChange={(event) => updateCountItemById(item.id, { reason: event.target.value })} placeholder={t('inventory.sections.inventory_composer_cards.s83', "سبب الفرق")} />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <Button type="button" variant="secondary" onClick={() => removeCountItemById(item.id)}>{t('inventory.sections.inventory_composer_cards.s84', "إزالة")}</Button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
                      {/* Slim Bottom Footer Bar */}
        <div
          className="stock-count-table-footer-bar"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '8px 14px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            marginTop: '10px',
            flexWrap: 'wrap',
          }}
        >
          {/* Right side: Range info and Page Size selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: '#475569', fontWeight: '600' }}>
              {t('pagination.range', 'عرض {{rangeStart}}-{{rangeEnd}} من أصل {{totalItems}} {{itemLabel}}', {
                rangeStart: pagination.rangeStart,
                rangeEnd: pagination.rangeEnd,
                totalItems: pagination.totalItems,
                itemLabel: t('inventory.sections.inventory_composer_cards.s60', 'صنف'),
              })}
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11.5px', color: '#64748b' }}>{t('pagination.per_page', 'لكل صفحة:')}</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                {[25, 50, 100].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => pagination.setPageSize(size)}
                    style={{
                      padding: '3px 9px',
                      fontSize: '11.5px',
                      fontWeight: '700',
                      borderRadius: '5px',
                      border: pagination.pageSize === size ? '1.5px solid #2563eb' : '1px solid #cbd5e1',
                      background: pagination.pageSize === size ? '#eff6ff' : '#ffffff',
                      color: pagination.pageSize === size ? '#1d4ed8' : '#475569',
                      cursor: 'pointer',
                      transition: 'all 120ms ease',
                    }}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Left side: Navigation buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: '700', color: '#334155' }}>
              {t('pagination.page_of', 'صفحة {{page}} من {{totalPages}}', {
                page: pagination.page,
                totalPages: pagination.totalPages,
              })}
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <Button
                variant="secondary"
                type="button"
                onClick={() => pagination.goToPage(pagination.page - 1)}
                disabled={!pagination.hasPreviousPage}
                style={{ padding: '3px 10px', fontSize: '12px', height: '28px', minHeight: '28px' }}
              >
                {t('pagination.prev', 'السابق')}
              </Button>
              <Button
                variant="secondary"
                type="button"
                onClick={() => pagination.goToPage(pagination.page + 1)}
                disabled={!pagination.hasNextPage}
                style={{ padding: '3px 10px', fontSize: '12px', height: '28px', minHeight: '28px' }}
              >
                {t('pagination.next', 'التالي')}
              </Button>
            </div>
          </div>
        </div>
        </>
      ) : items.length ? (
        <EmptyState
          title={t('inventory.sections.inventory_composer_cards.s85', "لا توجد نتائج مطابقة للبحث")}
          hint={t('inventory.sections.inventory_composer_cards.s86', "جرب البحث بكلمة أخرى أو اضغط على تصنيف (الكل).")}
        />
      ) : (
        <EmptyState
          title={t('inventory.sections.inventory_composer_cards.s87', "لا توجد عناصر في جلسة الجرد حتى الآن")}
          hint={countType === 'category' || countType === 'supplier' || countType === 'full' ? t('inventory.sections.inventory_composer_cards.s88', "اضغط على زر (إدخال إلكتروني) بالأعلى لتنزيل الأصناف، أو استخدم مسح الباركود.") : t('inventory.sections.inventory_composer_cards.s89', "استخدم ماسح الباركود أو الإضافة اليدوية بالأعلى لبدء تسجيل الأصناف.")}
        />
      )}
    </div>
  );
}
