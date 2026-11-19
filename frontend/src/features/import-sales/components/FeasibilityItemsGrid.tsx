import type { Dispatch, SetStateAction } from 'react';
import { CheckShieldIcon, PlusCircleIcon, SlidersIcon, TruckIcon, XIcon } from '@/shared/components/icons/AppIcons';
import { SearchableCombobox } from '@/shared/ui/searchable-combobox';
import { parseFeasibilityNumberInput } from '../utils/import-display-formatters';

export interface FeasibilityItem {
  name: string;
  productId?: number | '';
  partNumber?: string;
  oemNumber?: string;
  hsCode: string;
  qty: number | string;
  factoryPriceUsd: number | string;
  unitWeightKg?: number | string;
  unitCbm?: number | string;
  expectedLocalMarketPriceEgp?: number | string;
}

export interface FeasibilityItemsGridProps {
  items: FeasibilityItem[];
  products: any[];
  calculateFeasibilityMutation: { isPending: boolean };
  setPickerSector: Dispatch<SetStateAction<string>>;
  setPickerSearch: Dispatch<SetStateAction<string>>;
  setIsTariffPickerOpen: Dispatch<SetStateAction<boolean>>;
  handleAddItem: () => void;
  handleRemoveItem: (index: number) => void;
  handleUpdateItem: (index: number, field: string, value: any) => void;
  handleFeasibilityNameChange: (index: number, value: string) => void;
  handleLinkFeasibilityItem: (index: number, product: any) => void;
  handleAutoBalanceContainerLoad: (targetTons: number) => void;
  handleRunFeasibility: () => void;
}

export function FeasibilityItemsGrid({
  items,
  products,
  calculateFeasibilityMutation,
  setPickerSector,
  setPickerSearch,
  setIsTariffPickerOpen,
  handleAddItem,
  handleRemoveItem,
  handleUpdateItem,
  handleFeasibilityNameChange,
  handleLinkFeasibilityItem,
  handleAutoBalanceContainerLoad,
  handleRunFeasibility,
}: FeasibilityItemsGridProps) {
  return (
    <>
      {/* Items Table Header & Quick Action Buttons */}
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 10,
            padding: '8px 12px',
            backgroundColor: '#f8fafc',
            borderRadius: 8,
            border: '1px solid #e2e8f0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>أصناف الشحنة المستهدفة</span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: '#170e5e',
                backgroundColor: '#eef2ff',
                padding: '2px 8px',
                borderRadius: 12,
                border: '1px solid #c7d2fe',
              }}
            >
              {items.length} صنف
            </span>
          </div>

          {/* Action Buttons: Truck Spare Parts Library, All Sectors Library, and Manual Row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => {
                setPickerSector('commercial_vehicles_spare_parts');
                setPickerSearch('');
                setIsTariffPickerOpen(true);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                backgroundColor: '#170e5e',
                color: '#ffffff',
                border: 'none',
                borderRadius: 6,
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(23, 14, 94, 0.15)',
              }}
            >
              <CheckShieldIcon size={14} />
              <span>مكتبة قطع غيار النقل والتريلات (جمارك 5%)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setPickerSector('all');
                setPickerSearch('');
                setIsTariffPickerOpen(true);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                backgroundColor: '#ffffff',
                color: '#170e5e',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <span>كافة القطاعات</span>
            </button>

            <button
              type="button"
              onClick={handleAddItem}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 10px',
                background: 'none',
                border: '1px dashed #94a3b8',
                color: '#475569',
                borderRadius: 6,
                fontSize: '11.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <PlusCircleIcon size={13} />
              <span>+ إضافة صنف يدوياً</span>
            </button>
          </div>
        </div>

        <div style={{ overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', minWidth: 840 }}>
            <thead>
              <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #cbd5e1' }}>
                <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>اسم الصنف</th>
                <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#334155', width: 125 }}>رقم القطعة (OEM)</th>
                <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#334155', width: 110 }}>البند HS Code</th>
                <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#334155', width: 80 }}>الكمية</th>
                <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#334155', width: 95 }}>المصنع ($)</th>
                <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#334155', width: 95 }}>الوزن (كجم)</th>
                <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#334155', width: 95 }}>الحجم (CBM)</th>
                <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#334155', width: 115 }}>سعر السوق (ج.م)</th>
                <th style={{ padding: '8px 10px', width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '6px 8px' }}>
                    <SearchableCombobox
                      inline
                      placeholder="ابحث عن صنف حقيقي..."
                      value={it.name}
                      onChange={(value) => handleFeasibilityNameChange(idx, value)}
                      options={products || []}
                      search={(p: any, q: string) =>
                        (p.name || '').toLowerCase().includes(q.toLowerCase()) ||
                        (p.barcode || '').toLowerCase().includes(q.toLowerCase()) ||
                        (p.styleCode || '').toLowerCase().includes(q.toLowerCase())
                      }
                      getLabel={(p: any) => p.name}
                      getMeta={(p: any) => (p.barcode ? `كود: ${p.barcode}` : p.styleCode ? `Code: ${p.styleCode}` : '')}
                      onSelect={(p: any) => handleLinkFeasibilityItem(idx, p)}
                      showIdleHelper={false}
                    />
                    {it.productId ? (
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#15803d', marginTop: 2 }}>
                        مربوط بصنف حقيقي (#{it.productId})
                      </div>
                    ) : (
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#b45309', marginTop: 2 }}>
                        غير مربوط — اختر الصنف من القائمة
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      type="text"
                      value={it.partNumber || it.oemNumber || ''}
                      onChange={(e) => handleUpdateItem(idx, 'partNumber' as any, e.target.value)}
                      placeholder="WG9100440030"
                      style={{ width: '100%', height: 30, padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: '12px', fontFamily: 'monospace' }}
                    />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      type="text"
                      value={it.hsCode}
                      onChange={(e) => handleUpdateItem(idx, 'hsCode', e.target.value)}
                      placeholder="8708.30"
                      style={{ width: '100%', height: 30, padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: '12px', fontFamily: 'monospace' }}
                    />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      type="number"
                      value={it.qty ?? ''}
                      onChange={(e) => handleUpdateItem(idx, 'qty', parseFeasibilityNumberInput(e.target.value))}
                      style={{ width: '100%', height: 30, padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: '12px' }}
                    />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      type="number"
                      step="0.01"
                      value={it.factoryPriceUsd ?? ''}
                      onChange={(e) => handleUpdateItem(idx, 'factoryPriceUsd', parseFeasibilityNumberInput(e.target.value))}
                      style={{ width: '100%', height: 30, padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: '12px' }}
                    />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="مثال: 5"
                      value={it.unitWeightKg ?? ''}
                      onChange={(e) => handleUpdateItem(idx, 'unitWeightKg', parseFeasibilityNumberInput(e.target.value))}
                      style={{ width: '100%', height: 30, padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: '12px' }}
                    />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      type="number"
                      step="0.001"
                      placeholder="0.01"
                      value={it.unitCbm ?? ''}
                      onChange={(e) => handleUpdateItem(idx, 'unitCbm', parseFeasibilityNumberInput(e.target.value))}
                      style={{ width: '100%', height: 30, padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: '12px' }}
                    />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      type="number"
                      placeholder="سعر المحل..."
                      value={it.expectedLocalMarketPriceEgp ?? ''}
                      onChange={(e) => handleUpdateItem(idx, 'expectedLocalMarketPriceEgp', parseFeasibilityNumberInput(e.target.value))}
                      style={{ width: '100%', height: 30, padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: '12px', fontWeight: 600, color: '#166534' }}
                    />
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                    {/* I2-P8: the delete control is rendered for EVERY
                        row, including the last one. The old
                        `items.length > 1` guard hid it on the sole
                        remaining row, so the grid could never be
                        emptied and the last row had to be overwritten
                        in place (trial problem 8). */}
                    <button
                      type="button"
                      aria-label="حذف الصنف"
                      title="حذف الصنف"
                      onClick={() => handleRemoveItem(idx)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4 }}
                    >
                      <XIcon size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: '18px 12px', textAlign: 'center', fontSize: '12px', color: '#64748b' }}>
                    لا توجد أصناف بعد — اختر قالباً من الأعلى أو أضف صنفاً من المكتبة أو يدوياً
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Live Container & Cargo Metric Summary Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
            marginTop: 8,
            padding: '8px 14px',
            backgroundColor: '#f1f5f9',
            borderRadius: 8,
            border: '1px solid #cbd5e1',
            fontSize: '11.5px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <TruckIcon size={16} color="#170e5e" />
            <span style={{ fontWeight: 800, color: '#0f172a' }}>مؤشر حمولة الحاوية اللحظي:</span>
            <span style={{ color: '#334155' }}>
              الوزن الإجمالي:{' '}
              <strong>
                {(items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitWeightKg) || 0), 0) / 1000).toFixed(2)} طن
              </strong>
            </span>
            <span style={{ color: '#94a3b8' }}>|</span>
            <span style={{ color: '#334155' }}>
              الحجم المكعب:{' '}
              <strong>
                {items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitCbm) || 0), 0).toFixed(2)} CBM
              </strong>
            </span>
            <span style={{ color: '#94a3b8' }}>|</span>
            <span style={{ color: '#334155' }}>
              قيمة بضاعة المصنع:{' '}
              <strong>
                ${items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.factoryPriceUsd) || 0), 0).toLocaleString()}
              </strong>
            </span>
          </div>

          {(() => {
            const totalTons = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitWeightKg) || 0), 0) / 1000;
            const totalCbm = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitCbm) || 0), 0);
            const isOverweight = totalTons > 25.0;

            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span
                  style={{
                    padding: '3px 10px',
                    borderRadius: 4,
                    fontSize: '11px',
                    fontWeight: 700,
                    backgroundColor: isOverweight ? '#fee2e2' : totalTons >= 22 ? '#dcfce7' : '#e0e7ff',
                    color: isOverweight ? '#b91c1c' : totalTons >= 22 ? '#166534' : '#1e1b4b',
                    border: isOverweight ? '1px solid #fca5a5' : '1px solid transparent',
                  }}
                >
                  {isOverweight
                    ? `تحذير حمولة زائدة (${totalTons.toFixed(1)} طن - تتجاوز 25 طن المسموح بموانئ مصر)`
                    : totalTons >= 22
                    ? `حمولة قانونية مثالية (${totalTons.toFixed(1)} طن - استغلال كامل للحاوية 40FT)`
                    : totalCbm > 30 || totalTons > 14
                    ? 'الحاوية الموصى بها: 40FT Standard'
                    : 'الحاوية الموصى بها: 20FT Standard'}
                </span>

                <button
                  type="button"
                  onClick={() => handleAutoBalanceContainerLoad(24.5)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 10px',
                    backgroundColor: isOverweight ? '#170e5e' : '#f8fafc',
                    color: isOverweight ? '#ffffff' : '#170e5e',
                    border: '1px solid #cbd5e1',
                    borderRadius: 5,
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: isOverweight ? '0 1px 3px rgba(23, 14, 94, 0.25)' : 'none',
                  }}
                  title="موازنة كميات الأصناف تلقائياً بنسبة وتناسب للوصول للحمولة القانونية المسموحة (24.5 طن) وتفادي غرامات الميزان"
                >
                  <SlidersIcon size={12} />
                  <span>موازنة الحمولة للحد القانوني (24.5 طن)</span>
                </button>
              </div>
            );
          })()}
        </div>
      </div>

      <div style={{ textAlign: 'left' }}>
        <button
          type="button"
          onClick={handleRunFeasibility}
          disabled={calculateFeasibilityMutation.isPending}
          style={{
            backgroundColor: '#170e5e',
            color: '#ffffff',
            border: 'none',
            borderRadius: 8,
            padding: '8px 22px',
            fontSize: '12.5px',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 1px 3px rgba(23, 14, 94, 0.2)',
          }}
        >
          {calculateFeasibilityMutation.isPending ? 'جاري الحساب والتدقيق...' : 'حساب الجدوى والسيناريوهات الثلاثة'}
        </button>
      </div>
    </>
  );
}
