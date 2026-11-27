import { useTranslation } from 'react-i18next';
import {Fragment, type Dispatch, type SetStateAction} from 'react';
import type { TenderItem } from './tender-page-types';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { getTextDirection } from '@/lib/arabic-normalization';

const formatUnitLabel = (unit?: string, compCode?: string): string => {
  const u = (unit || '').toLowerCase().trim();
  if (u === 'm2' || u === 'sqm') return 'م²';
  if (u === 'm3' || u === 'cbm') return 'م³';
  if (u === 'm' || u === 'lm') return 'م.ط';
  if (u === 'ton') return 'طن';
  if (u === 'kg') return 'كجم';
  if (u === 'item' || u === 'pcs' || u === 'piece') {
    if (compCode && (compCode.includes('BRK') || compCode.includes('BLK') || compCode.includes('طوب'))) return 'طوبة';
    return 'عدد';
  }
  if (u === 'ls') return 'مقطوعية';
  if (u === 'point') return 'نقطة';
  if (u === 'set') return 'طقم';
  return unit || '';
};

export interface TenderItemsTableProps {
  items: TenderItem[];
  setItems: Dispatch<SetStateAction<TenderItem[]>>;
  expandedItemId: string | null;
  setExpandedItemId: (value: string | null) => void;
  selectedTradeFilter: string;
  setSelectedTradeFilter: (value: string) => void;
  availableTrades: string[];
  availableSourceFiles: Array<{ fileName: string; count: number }>;
  displayedItems: TenderItem[];
  tradeSubtotal: number;
  activeScopeLabel: string;
  TRADE_LABELS: Record<string, string>;
  calculateItemRates: (item: TenderItem) => { directCost: number; sellingUnitPrice: number; totalItemValue: number; totalItemDirectCost: number; totalItemProfit: number };
  formatCurrency: (amount: number) => string;
  handleAddComponent: (itemId: string) => void;
  handleRemoveComponent: (itemId: string, compIdx: number) => void;
  setIsImportBoqOpen: (open: boolean) => void;
  setIsImportMasterOpen: (open: boolean) => void;
}

export function TenderItemsTable({
  items,
  setItems,
  expandedItemId,
  setExpandedItemId,
  selectedTradeFilter,
  setSelectedTradeFilter,
  availableTrades,
  availableSourceFiles,
  displayedItems,
  tradeSubtotal,
  activeScopeLabel,
  TRADE_LABELS,
  calculateItemRates,
  formatCurrency,
  handleAddComponent,
  handleRemoveComponent,
  setIsImportBoqOpen,
  setIsImportMasterOpen,
}: TenderItemsTableProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* 4. Table of Tender Items */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
        {items.length === 0 ? (
          <div style={{ padding: '44px 20px', textAlign: 'center', color: '#64748b' }}>
            <div style={{ color: '#94a3b8', marginBottom: '10px', display: 'flex', justifyContent: 'center' }}>
              <AppIcons.FileSpreadsheet size={42} />
            </div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#1e293b' }}>{t('contracting.contracting_tender_page.s47', "لم يتم إضافة أي بنود لدراسة هذا العطاء بعد")}</div>
            <div style={{ fontSize: '13px', marginTop: '6px', color: '#64748b', maxWidth: '500px', marginInline: 'auto' }}>
              {t('contracting.contracting_tender_page.s48', "ارفع شيت مقايسة العطاء المسلّم من المالك (Excel)، أو اسحب بنوداً نمطية من المقايسة المرجعية، أو ابدأ بحصر سريع من اللوحات الهندسية.")}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '16px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setIsImportBoqOpen(true)}
                style={{
                  height: '36px',
                  padding: '0 18px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  boxShadow: '0 1px 3px rgba(23, 14, 94, 0.15)',
                }}
              >
                <AppIcons.FileSpreadsheet size={15} />
                <span>{t('contracting.contracting_tender_page.s49', "استيراد مقايسة العطاء من Excel (BOQ)")}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsImportMasterOpen(true)}
                style={{
                  height: '36px',
                  padding: '0 16px',
                  borderRadius: '8px',
                  fontWeight: 600,
                  background: '#ffffff',
                  color: '#334155',
                  border: '1px solid #cbd5e1',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                <AppIcons.Layers size={15} />
                <span>{t('contracting.contracting_tender_page.s50', "سحب من المقايسة المرجعية")}</span>
              </button>
            </div>
          </div>
        ) : (
          <div>
            {/* Trade & File Navigation Tabs & Subtotals */}
            {(availableSourceFiles.length > 1 || availableTrades.length > 0) && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  padding: '10px 16px',
                  background: '#f8fafc',
                  borderBottom: '1px solid #e2e8f0',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569', marginInlineEnd: '4px' }}>
                    {availableSourceFiles.length > 1 ? t('contracting.contracting_tender_page.s51', "تبويب ملفات المقايسة:") : t('contracting.contracting_tender_page.s52', "تصفية حسب التخصص:")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedTradeFilter('all')}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '20px',
                      border: selectedTradeFilter === 'all' ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                      background: selectedTradeFilter === 'all' ? '#170e5e' : '#ffffff',
                      color: selectedTradeFilter === 'all' ? '#ffffff' : '#334155',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {t('contracting.contracting_tender_page.s53', "كافة البنود (")}{items.length})
                  </button>
                  {availableSourceFiles.length > 1
                    ? availableSourceFiles.map(({ fileName, count }) => {
                        const isSelected = selectedTradeFilter === `file:${fileName}`;
                        return (
                          <button
                            key={fileName}
                            type="button"
                            onClick={() => setSelectedTradeFilter(`file:${fileName}`)}
                            style={{
                              padding: '4px 12px',
                              borderRadius: '20px',
                              border: isSelected ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                              background: isSelected ? '#170e5e' : '#ffffff',
                              color: isSelected ? '#ffffff' : '#334155',
                              fontSize: '12px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            {t('contracting.contracting_tender_page.s54', "ملف:")} {fileName} ({count})
                          </button>
                        );
                      })
                    : availableTrades.map((tr) => {
                        const count = items.filter((it) => it.trade === tr).length;
                        const label = TRADE_LABELS[tr] || tr;
                        const isSelected = selectedTradeFilter === tr;
                        return (
                          <button
                            key={tr}
                            type="button"
                            onClick={() => setSelectedTradeFilter(tr)}
                            style={{
                              padding: '4px 12px',
                              borderRadius: '20px',
                              border: isSelected ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                              background: isSelected ? '#170e5e' : '#ffffff',
                              color: isSelected ? '#ffffff' : '#334155',
                              fontSize: '12px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            {label} ({count})
                          </button>
                        );
                      })}
                </div>

                {selectedTradeFilter !== 'all' && (
                  <div style={{ fontSize: '12px', color: '#170e5e', fontWeight: 700 }}>
                    {t('contracting.contracting_tender_page.s55', "إجمالي")} {activeScopeLabel}:{' '}
                    <strong style={{ fontSize: '13.5px' }}>{formatCurrency(tradeSubtotal)}</strong>
                  </div>
                )}
              </div>
            )}

            <div style={{ overflowX: 'auto', width: '100%' }}>
              <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 'var(--font-body)', textAlign: 'right' }}>
                <colgroup>
                  <col style={{ width: '85px' }} />
                  <col style={{ width: 'auto', minWidth: '220px' }} />
                  <col style={{ width: '60px' }} />
                  <col style={{ width: '85px' }} />
                  <col style={{ width: '100px' }} />
                  <col style={{ width: '75px' }} />
                  <col style={{ width: '105px' }} />
                  <col style={{ width: '115px' }} />
                  <col style={{ width: '115px' }} />
                  <col style={{ width: '40px' }} />
                </colgroup>
                <thead style={{ background: '#f8fafc' }}>
                  <tr>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>{t('contracting.contracting_tender_page.s56', "كود البند")}</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>{t('contracting.contracting_tender_page.s57', "بيان الأعمال والمواصفات")}</th>
                    <th style={{ padding: '10px 10px', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'center' }}>{t('contracting.contracting_tender_page.s58', "الوحدة")}</th>
                    <th style={{ padding: '10px 10px', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'center' }}>{t('contracting.contracting_tender_page.s59', "الكمية")}</th>
                    <th style={{ padding: '10px 10px', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>{t('contracting.contracting_tender_page.s60', "التكلفة المباشرة")}</th>
                    <th style={{ padding: '10px 8px', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'center' }}>{t('contracting.contracting_tender_page.s61', "هامش الربح %")}</th>
                    <th style={{ padding: '10px 10px', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>{t('contracting.contracting_tender_page.s62', "سعر الفئة المقترح")}</th>
                    <th style={{ padding: '10px 10px', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>{t('contracting.contracting_tender_page.s63', "إجمالي القيمة")}</th>
                    <th style={{ padding: '10px 8px', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'center' }}>{t('contracting.contracting_tender_page.s64', "تفكيك الكود")}</th>
                    <th style={{ padding: '10px 8px', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'center' }}>{t('contracting.contracting_tender_page.s65', "حذف")}</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedItems.map((item) => {
                    const rates = calculateItemRates(item);
                    const isExpanded = expandedItemId === item.id;
                    const textDir = getTextDirection(item.description);

                    return (
                      <Fragment key={item.id}>
                        <tr style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s ease' }}>
                          <td style={{ padding: '12px 12px', fontWeight: 700, color: '#170e5e', verticalAlign: 'middle', wordBreak: 'break-word', fontSize: '13px' }}>
                            {item.itemCode}
                          </td>
                          <td
                            style={{
                              padding: '12px 12px',
                              whiteSpace: 'normal',
                              wordBreak: 'break-word',
                              lineHeight: 1.55,
                              textAlign: 'justify',
                              textJustify: 'inter-word',
                              textAlignLast: textDir === 'rtl' ? 'right' : 'left',
                              direction: textDir,
                              color: '#1e293b',
                              verticalAlign: 'middle',
                            }}
                          >
                            <div style={{ fontWeight: 600, fontSize: '13px' }}>{item.description}</div>
                            {item.notes && (
                              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px' }}>
                                {item.notes}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '12px 8px', color: '#475569', fontWeight: 600, textAlign: 'center', verticalAlign: 'middle', fontSize: '12.5px' }}>
                            {formatUnitLabel(item.unit)}
                          </td>
                          <td style={{ padding: '12px 8px', fontWeight: 700, color: '#0f172a', verticalAlign: 'middle', textAlign: 'center' }}>
                            <input
                              type="number"
                              min="0"
                              value={item.estimatedQty}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, estimatedQty: val } : it)));
                              }}
                              style={{
                                width: '72px',
                                height: '28px',
                                padding: '0 4px',
                                border: '1px solid #cbd5e1',
                                borderRadius: '6px',
                                fontSize: '12.5px',
                                fontWeight: 700,
                                textAlign: 'center',
                                color: '#0f172a',
                                background: '#ffffff',
                                boxSizing: 'border-box',
                              }}
                            />
                          </td>
                          <td style={{ padding: '12px 10px', color: '#475569', fontWeight: 600, verticalAlign: 'middle', whiteSpace: 'nowrap', fontSize: '12.5px' }}>
                            {formatCurrency(rates.directCost)}
                          </td>
                          <td style={{ padding: '12px 6px', textAlign: 'center', verticalAlign: 'middle' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={item.profitMarkupPercent}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, profitMarkupPercent: val } : it)));
                                }}
                                style={{
                                  width: '44px',
                                  height: '28px',
                                  padding: '0 4px',
                                  textAlign: 'center',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                  fontSize: '12.5px',
                                  fontWeight: 700,
                                  color: '#15803d',
                                  background: '#ffffff',
                                  boxSizing: 'border-box',
                                }}
                              />
                              <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>%</span>
                            </div>
                          </td>
                          <td style={{ padding: '12px 10px', fontWeight: 800, color: '#170e5e', verticalAlign: 'middle', whiteSpace: 'nowrap', fontSize: '13px' }}>
                            {formatCurrency(rates.sellingUnitPrice)}
                          </td>
                          <td style={{ padding: '12px 10px', fontWeight: 800, color: '#0f172a', verticalAlign: 'middle', whiteSpace: 'nowrap', fontSize: '13px' }}>
                            {formatCurrency(rates.totalItemValue)}
                          </td>
                          <td style={{ padding: '12px 6px', textAlign: 'center', verticalAlign: 'middle' }}>
                            <button
                              type="button"
                              onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                              title={isExpanded ? t('contracting.contracting_tender_page.s66', "إغلاق شجرة الموارد") : t('contracting.contracting_tender_page.s67', "شجرة تحليل الموارد والتكلفة (BOM)")}
                              style={{
                                height: '28px',
                                padding: '0 10px',
                                borderRadius: '6px',
                                background: isExpanded ? '#170e5e' : '#ffffff',
                                color: isExpanded ? '#ffffff' : '#170e5e',
                                border: isExpanded ? '1px solid #170e5e' : '1px solid #cbd5e1',
                                fontSize: '11.5px',
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '5px',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                boxSizing: 'border-box',
                                boxShadow: isExpanded ? '0 1px 3px rgba(23,14,94,0.2)' : '0 1px 2px rgba(0,0,0,0.03)',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              <AppIcons.Sliders size={12} style={{ color: isExpanded ? '#ffffff' : '#170e5e', flexShrink: 0 }} />
                              <span>{isExpanded ? t('contracting.contracting_tender_page.s68', "إغلاق") : 'BOM'}</span>
                            </button>
                          </td>
                          <td style={{ padding: '12px 6px', textAlign: 'center', verticalAlign: 'middle' }}>
                            <button
                              type="button"
                              title={t('contracting.contracting_tender_page.s69', "حذف البند من دراسة العطاء")}
                              onClick={() => setItems((prev) => prev.filter((it) => it.id !== item.id))}
                              style={{
                                width: '28px',
                                height: '28px',
                                borderRadius: '6px',
                                border: '1px solid transparent',
                                background: 'transparent',
                                color: '#94a3b8',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.15s ease',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.color = '#dc2626';
                                e.currentTarget.style.background = '#fef2f2';
                                e.currentTarget.style.borderColor = '#fecaca';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.color = '#94a3b8';
                                e.currentTarget.style.background = 'transparent';
                                e.currentTarget.style.borderColor = 'transparent';
                              }}
                            >
                              <AppIcons.Trash2 size={15} />
                            </button>
                          </td>
                        </tr>

                        {/* Expandable BOM Exploder */}
                        {isExpanded && (
                          <tr>
                            <td colSpan={10} style={{ padding: '14px 18px', background: '#f8fafc', borderBottom: '2px solid #cbd5e1', boxSizing: 'border-box' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px', minWidth: 0 }}>
                                <div style={{ fontWeight: 700, fontSize: '13px', color: '#170e5e', display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, maxWidth: '650px' }}>
                                  <AppIcons.Sliders size={16} style={{ flexShrink: 0 }} />
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: textDir }}>
                                    {t('contracting.contracting_tender_page.s70', "تفكيك الكود الهندسي وتخصيص الموارد: [")}{item.itemCode}] {item.description}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                  <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '3px 10px', fontSize: '12px', color: '#334155' }}>
                                    {t('contracting.contracting_tender_page.s71', "كمية البند:")} <strong style={{ color: '#0f172a' }}>{item.estimatedQty.toLocaleString()} {formatUnitLabel(item.unit)}</strong>
                                  </div>
                                  <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '3px 10px', fontSize: '12px', color: '#334155' }}>
                                    {t('contracting.contracting_tender_page.s72', "التكلفة المباشرة للوحدة:")} <strong style={{ color: '#170e5e', fontWeight: 800 }}>{formatCurrency(rates.directCost)}</strong>
                                  </div>
                                <button
                                  type="button"
                                  onClick={() => handleAddComponent(item.id)}
                                  style={{
                                    height: '28px',
                                    padding: '0 12px',
                                    borderRadius: '6px',
                                    border: '1px solid #170e5e',
                                    background: '#eef2ff',
                                    color: '#170e5e',
                                    fontSize: '11.5px',
                                    fontWeight: 700,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                  }}
                                >
                                  <AppIcons.Plus size={13} />
                                  <span>{t('contracting.contracting_tender_page.s73', "إضافة خامة / مورد")}</span>
                                </button>
                              </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
                              {item.components.map((comp, cIdx) => (
                                <div
                                  key={cIdx}
                                  style={{
                                    background: '#ffffff',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '8px',
                                    padding: '10px 12px',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                                    <input
                                      type="text"
                                      value={comp.componentName}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setItems((prev) =>
                                          prev.map((it) => {
                                            if (it.id !== item.id) return it;
                                            const newComps = it.components.map((c, idx) =>
                                              idx === cIdx ? { ...c, componentName: val } : c
                                            );
                                            return { ...it, components: newComps };
                                          })
                                        );
                                      }}
                                      style={{
                                        flex: 1,
                                        fontSize: '12px',
                                        fontWeight: 700,
                                        color: '#0f172a',
                                        border: '1px solid transparent',
                                        borderRadius: '4px',
                                        padding: '2px 4px',
                                        background: 'transparent',
                                      }}
                                      onFocus={(e) => (e.target.style.border = '1px solid #94a3b8')}
                                      onBlur={(e) => (e.target.style.border = '1px solid transparent')}
                                    />
                                    <button
                                      type="button"
                                      title={t('contracting.contracting_tender_page.s74', "حذف هذا المورد من البند")}
                                      onClick={() => handleRemoveComponent(item.id, cIdx)}
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        color: '#94a3b8',
                                        cursor: 'pointer',
                                        padding: '2px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        borderRadius: '4px',
                                      }}
                                      onMouseEnter={(e) => (e.currentTarget.style.color = '#dc2626')}
                                      onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
                                    >
                                      <AppIcons.Trash2 size={13} />
                                    </button>
                                  </div>

                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0' }}>
                                    <div>
                                      <label style={{ display: 'block', fontSize: '10.5px', color: '#475569', fontWeight: 600, marginBottom: '3px' }}>
                                        {t('contracting.contracting_tender_page.s75', "المعدل/")}{formatUnitLabel(item.unit)}:
                                      </label>
                                      <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #cbd5e1', borderRadius: '6px', overflow: 'hidden', background: '#ffffff', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                                        <input
                                          type="number"
                                          step="any"
                                          min="0"
                                          value={comp.qtyPerUnit}
                                          onChange={(e) => {
                                            const val = Number(e.target.value);
                                            setItems((prev) =>
                                              prev.map((it) => {
                                                if (it.id !== item.id) return it;
                                                const newComps = it.components.map((c, idx) =>
                                                  idx === cIdx ? { ...c, qtyPerUnit: val } : c
                                                );
                                                return { ...it, components: newComps };
                                              })
                                            );
                                          }}
                                          style={{
                                            width: '100%',
                                            height: '28px',
                                            padding: '0 6px',
                                            border: 'none',
                                            textAlign: 'center',
                                            fontSize: '12px',
                                            fontWeight: 700,
                                            color: '#170e5e',
                                            outline: 'none',
                                            background: 'transparent',
                                          }}
                                        />
                                        <span style={{ fontSize: '10.5px', color: '#475569', background: '#f1f5f9', padding: '0 7px', height: '28px', display: 'flex', alignItems: 'center', borderInlineStart: '1px solid #e2e8f0', whiteSpace: 'nowrap', fontWeight: 600 }}>
                                          {formatUnitLabel(comp.unit, comp.componentCode)}
                                        </span>
                                      </div>
                                    </div>

                                    <div>
                                      <label style={{ display: 'block', fontSize: '10.5px', color: '#475569', fontWeight: 600, marginBottom: '3px' }}>
                                        {t('contracting.contracting_tender_page.s76', "سعر الوحدة:")}
                                      </label>
                                      <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #cbd5e1', borderRadius: '6px', overflow: 'hidden', background: '#ffffff', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                                        <input
                                          type="number"
                                          step="any"
                                          min="0"
                                          value={comp.unitRate}
                                          onChange={(e) => {
                                            const val = Number(e.target.value);
                                            setItems((prev) =>
                                              prev.map((it) => {
                                                if (it.id !== item.id) return it;
                                                const newComps = it.components.map((c, idx) =>
                                                  idx === cIdx ? { ...c, unitRate: val } : c
                                                );
                                                return { ...it, components: newComps };
                                              })
                                            );
                                          }}
                                          style={{
                                            width: '100%',
                                            height: '28px',
                                            padding: '0 6px',
                                            border: 'none',
                                            textAlign: 'center',
                                            fontSize: '12px',
                                            fontWeight: 700,
                                            color: '#15803d',
                                            outline: 'none',
                                            background: 'transparent',
                                          }}
                                        />
                                        <span style={{ fontSize: '10.5px', color: '#475569', background: '#f1f5f9', padding: '0 7px', height: '28px', display: 'flex', alignItems: 'center', borderInlineStart: '1px solid #e2e8f0', whiteSpace: 'nowrap', fontWeight: 600 }}>
                                          {t('contracting.contracting_tender_page.s77', "ج.م")}
                                        </span>
                                      </div>
                                    </div>
                                  </div>

                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', paddingTop: '6px', borderTop: '1px solid #f1f5f9', fontSize: '11px', color: '#64748b' }}>
                                    <span>{t('contracting.contracting_tender_page.s78', "إجمالي احتياج المشروع (شامل الهالك):")}</span>
                                    <strong style={{ color: '#0f172a', direction: 'ltr', display: 'inline-block' }}>
                                      {(comp.qtyPerUnit * item.estimatedQty * (1 + (item.wastePercent || 0) / 100)).toLocaleString(undefined, { maximumFractionDigits: 1 })} {formatUnitLabel(comp.unit, comp.componentCode)}
                                    </strong>
                                  </div>

                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '3px', fontSize: '11px', color: '#64748b' }}>
                                    <span>{t('contracting.contracting_tender_page.s79', "حصة")} {formatUnitLabel(item.unit)} {t('contracting.contracting_tender_page.s80', "من التكلفة المباشرة:")}</span>
                                    <strong style={{ color: '#170e5e', fontWeight: 800 }}>
                                      {formatCurrency(comp.qtyPerUnit * comp.unitRate)}
                                    </strong>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
