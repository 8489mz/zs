import { useMemo, useRef, useState } from 'react';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { BarcodePrintItem } from '@/lib/barcode-labels';

interface BarcodeBatchItemsPanelProps {
  items: BarcodePrintItem[];
  activeIndex: number;
  totalCopies: number;
  zeroStockCount: number;
  canPruneZeroStock: boolean;
  onSelectActive: (index: number) => void;
  onUpdateCopies: (index: number, nextCopies: number) => void;
  onToggleItem: (index: number) => void;
  onSelectOnly: (index: number) => void;
  onSetAllCopies: (qty: number) => void;
  onSetAllByStock: () => void;
  onAdjustAllCopies: (delta: number) => void;
  onRemoveZeroStock: () => void;
}

export function BarcodeBatchItemsPanel({
  items,
  activeIndex,
  totalCopies,
  zeroStockCount,
  canPruneZeroStock,
  onSelectActive,
  onUpdateCopies,
  onToggleItem,
  onSelectOnly,
  onSetAllCopies,
  onSetAllByStock,
  onAdjustAllCopies,
  onRemoveZeroStock,
}: BarcodeBatchItemsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  const selectedVariantsCount = useMemo(
    () => items.filter((it) => Number(it.copies || 0) > 0).length,
    [items],
  );

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => {
        if (!q) return true;
        const p = item.product;
        const hay = `${p.name || ''} ${p.nameEn || ''} ${p.color || ''} ${p.size || ''} ${p.barcode || ''} ${item.unit?.barcode || ''}`.toLowerCase();
        return hay.includes(q);
      });
  }, [items, searchQuery]);

  return (
    <div
      style={{
        background: '#f8fafc',
        padding: '12px 14px',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        height: '100%',
        minHeight: 0,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
          <AppIcons.Tag size={15} />
          <span>الأصناف والكميات ({selectedVariantsCount}/{items.length})</span>
        </div>
        <span
          className="nav-pill"
          style={{
            fontSize: '0.72rem',
            background: totalCopies > 0 ? '#eef2ff' : '#fef2f2',
            color: totalCopies > 0 ? '#170e5e' : '#b91c1c',
            borderColor: totalCopies > 0 ? '#c7d2fe' : '#fecaca',
          }}
        >
          الإجمالي: {totalCopies} ملصق
        </span>
      </div>

      {/* شريط التحكم السريع للدفعة */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        <button
          type="button"
          onClick={onSetAllByStock}
          style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            padding: '3px 8px',
            border: '1px solid #170e5e',
            borderRadius: '5px',
            background: '#eff6ff',
            color: '#170e5e',
            cursor: 'pointer',
          }}
          title="تعيين الكمية لتطابق رصيد المخزن الفعلي (والرصيد 0 يأخذ صفر ملصق)"
        >
          حسب المخزن
        </button>
        <button
          type="button"
          onClick={() => onSetAllCopies(1)}
          style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            padding: '3px 8px',
            border: '1px solid #cbd5e1',
            borderRadius: '5px',
            background: '#ffffff',
            color: '#1e293b',
            cursor: 'pointer',
          }}
          title="تعيين ملصق واحد لكل الأصناف"
        >
          1 لكل صنف
        </button>
        <button
          type="button"
          onClick={() => onSetAllCopies(0)}
          style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            padding: '3px 8px',
            border: '1px solid #cbd5e1',
            borderRadius: '5px',
            background: '#ffffff',
            color: '#475569',
            cursor: 'pointer',
          }}
          title="تصفير كل الكميات لتحديد صنف معين فقط"
        >
          تصفير الكل
        </button>
        <button
          type="button"
          onClick={() => onAdjustAllCopies(1)}
          style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            padding: '3px 7px',
            border: '1px solid #cbd5e1',
            borderRadius: '5px',
            background: '#ffffff',
            cursor: 'pointer',
          }}
        >
          +1 للكل
        </button>
        <button
          type="button"
          onClick={() => onAdjustAllCopies(-1)}
          style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            padding: '3px 7px',
            border: '1px solid #cbd5e1',
            borderRadius: '5px',
            background: '#ffffff',
            cursor: 'pointer',
          }}
        >
          -1 للكل
        </button>
        {zeroStockCount > 0 && (
          <button
            type="button"
            onClick={onRemoveZeroStock}
            disabled={!canPruneZeroStock}
            style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              padding: '3px 8px',
              border: '1px solid #fde68a',
              borderRadius: '5px',
              background: canPruneZeroStock ? '#fefce8' : '#f8fafc',
              color: canPruneZeroStock ? '#b45309' : '#94a3b8',
              cursor: canPruneZeroStock ? 'pointer' : 'not-allowed',
            }}
            title="حذف الأصناف التي رصيدها صفر نهائياً من القائمة"
          >
            حذف رصيد 0 ({zeroStockCount})
          </button>
        )}
      </div>

      {items.length > 5 && (
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث باللون أو المقاس أو الباركود..."
            style={{
              width: '100%',
              height: '30px',
              fontSize: '0.76rem',
              padding: '4px 10px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              boxSizing: 'border-box',
            }}
          />
        </div>
      )}

      {/* قائمة الأصناف المستقلة بمساحة كاملة دون أي سكرول متداخل */}
      <div
        ref={listRef}
        onWheel={(e) => {
          const el = listRef.current;
          if (el && el.scrollHeight > el.clientHeight) {
            el.scrollTop += e.deltaY;
          }
        }}
        className="thin-scrollbar"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          paddingInlineEnd: '2px',
        }}
      >
        {filteredEntries.map(({ item, idx }) => {
          const qty = Math.max(0, Number(item.copies ?? 0));
          const isSelected = qty > 0;
          const isActive = activeIndex === idx;
          const variantMeta = [item.product.color, item.product.size].filter(Boolean).join(' · ');

          return (
            <div
              key={item.product.id || idx}
              onClick={() => onSelectActive(idx)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                padding: '8px 10px',
                borderRadius: '7px',
                background: isActive ? '#eff6ff' : isSelected ? '#ffffff' : '#f1f5f9',
                border: `1px solid ${isActive ? '#3b82f6' : isSelected ? '#cbd5e1' : '#e2e8f0'}`,
                opacity: isSelected || isActive ? 1 : 0.72,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0, flex: 1, cursor: 'pointer' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleItem(idx)}
                    style={{ accentColor: '#170e5e', width: '15px', height: '15px', flexShrink: 0, cursor: 'pointer' }}
                  />
                  <span
                    onClick={() => onSelectActive(idx)}
                    style={{
                      fontSize: '0.78rem',
                      fontWeight: isActive ? 800 : 700,
                      color: '#0f172a',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {item.product.name || item.product.nameEn || '-'}
                  </span>
                </label>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectOnly(idx);
                  }}
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: '4px',
                    border: '1px solid #cbd5e1',
                    background: isSelected && selectedVariantsCount === 1 ? '#170e5e' : '#ffffff',
                    color: isSelected && selectedVariantsCount === 1 ? '#ffffff' : '#170e5e',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                  title="طباعة هذا الصنف فقط وتصفير بقية الأصناف"
                >
                  هذا فقط
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', fontSize: '0.69rem', color: '#475569' }}>
                  {variantMeta && (
                    <span style={{ padding: '1px 6px', borderRadius: '4px', background: '#f8fafc', border: '1px solid #cbd5e1', fontWeight: 700, color: '#0f172a' }}>
                      {variantMeta}
                    </span>
                  )}
                  <span>({item.unit?.name || 'قطعة'})</span>
                  {item.product.stock != null && (
                    <span
                      style={{
                        padding: '1px 5px',
                        borderRadius: '4px',
                        background: Number(item.product.stock) > 0 ? '#e2e8f0' : '#fee2e2',
                        color: Number(item.product.stock) > 0 ? '#1e293b' : '#b91c1c',
                        fontWeight: 700,
                      }}
                    >
                      رصيد: {item.product.stock}
                    </span>
                  )}
                </div>

                {/* عداد RTL قياسي: [+] يميناً ثم القيمة ثم [-] يساراً */}
                <div
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    aria-label="زيادة الكمية"
                    onClick={() => onUpdateCopies(idx, qty + 1)}
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#170e5e',
                      fontWeight: 800,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                    }}
                  >
                    +
                  </button>
                  <input
                    type="number"
                    min="0"
                    max="500"
                    value={qty}
                    onChange={(e) => onUpdateCopies(idx, Math.max(0, Number(e.target.value || 0)))}
                    style={{
                      width: '44px',
                      height: '24px',
                      fontSize: '0.76rem',
                      fontWeight: 700,
                      textAlign: 'center',
                      padding: '0 2px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                  <button
                    type="button"
                    aria-label="إنقاص الكمية"
                    onClick={() => onUpdateCopies(idx, Math.max(0, qty - 1))}
                    disabled={qty <= 0}
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      background: qty <= 0 ? '#f1f5f9' : '#ffffff',
                      color: qty <= 0 ? '#94a3b8' : '#170e5e',
                      fontWeight: 800,
                      fontSize: '0.82rem',
                      cursor: qty <= 0 ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                    }}
                  >
                    -
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {filteredEntries.length === 0 && (
          <div style={{ textAlign: 'center', padding: '24px 10px', fontSize: '0.78rem', color: '#64748b' }}>
            لا توجد نتائج مطابقة للبحث.
          </div>
        )}
      </div>
    </div>
  );
}
