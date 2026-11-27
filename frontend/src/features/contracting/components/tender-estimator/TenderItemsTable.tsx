import React, {type Dispatch, type SetStateAction} from 'react';
import type { TFunction } from 'i18next';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { TenderItem, TenderItemComponent } from './tender-estimator.types';

export interface TenderItemsTableProps {
  items: TenderItem[];
  t: TFunction;
  calculateItemRates: (item: TenderItem) => {
    directCostPerUnit: number;
    costWithWaste: number;
    totalCostPerUnit: number;
    profitAmountPerUnit: number;
    sellingPricePerUnit: number;
    totalDirectCost: number;
    totalTenderCost: number;
    totalSellingPrice: number;
    totalProfit: number;
    componentsDetail: (TenderItemComponent & {
      unitDirectCost: number;
      totalQtyForTender: number;
      totalCostForTender: number;
    })[];
  };
  expandedItemId: string | null;
  setItems: Dispatch<SetStateAction<TenderItem[]>>;
  formatCurrency: (val: number | string | undefined | null) => string;
  setExpandedItemId: Dispatch<SetStateAction<string | null>>;
}

export function TenderItemsTable({
  items,
  t,
  calculateItemRates,
  expandedItemId,
  setItems,
  formatCurrency,
  setExpandedItemId,
}: TenderItemsTableProps) {
  return (
    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {items.length === 0 ? (
        <div style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>
          {t('contracting.tender_estimator_modal.s42', "لا توجد بنود مضافة للعطاء حتى الآن. انقر على")} <strong>{t('contracting.tender_estimator_modal.s43', "استيراد مقايسة Excel")}</strong> {t('contracting.tender_estimator_modal.s44', "أو")} <strong>{t('contracting.tender_estimator_modal.s45', "سحب من المقايسة المرجعية")}</strong> {t('contracting.tender_estimator_modal.s46', "أو")} <strong>{t('contracting.tender_estimator_modal.s47', "حصر سريع من الرسومات")}</strong> {t('contracting.tender_estimator_modal.s48', "لبدء التسعير والتفكيك الهندسي.")}
        </div>
      ) : (
        <div
          className="thin-scrollbar"
          style={{
            maxHeight: '380px',
            overflowY: 'auto',
            overflowX: 'hidden',
            position: 'relative',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-body)', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 'auto' }} />
              <col style={{ width: '55px' }} />
              <col style={{ width: '90px' }} />
              <col style={{ width: '105px' }} />
              <col style={{ width: '80px' }} />
              <col style={{ width: '105px' }} />
              <col style={{ width: '125px' }} />
              <col style={{ width: '95px' }} />
              <col style={{ width: '45px' }} />
            </colgroup>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: 'var(--font-table-head)', position: 'sticky', top: 0, zIndex: 2 }}>
                <th style={{ padding: '8px 12px', textAlign: 'start' }}>{t('contracting.tender_estimator_modal.s49', "البند والوصف الهندسي")}</th>
                <th style={{ padding: '8px 4px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s50', "الوحدة")}</th>
                <th style={{ padding: '8px 4px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s51', "الكمية")}</th>
                <th style={{ padding: '8px 4px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s52', "ت. الوحدة (BOM)")}</th>
                <th style={{ padding: '8px 4px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s53', "هامش الربح")}</th>
                <th style={{ padding: '8px 4px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s54', "سعر البيع")}</th>
                <th style={{ padding: '8px 8px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s55', "إجمالي القيمة للعميل")}</th>
                <th style={{ padding: '8px 4px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s56', "تفكيك الكود")}</th>
                <th style={{ padding: '8px 4px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s57', "حذف")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const calc = calculateItemRates(item);
                const isExpanded = expandedItemId === item.id;

                return (
                  <React.Fragment key={item.id}>
                    <tr style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                          <span style={{ padding: '2px 5px', borderRadius: '4px', background: '#e0e7ff', color: '#3730a3', fontSize: '11px', fontWeight: 700, flexShrink: 0, marginTop: '2px' }}>
                            {item.itemCode}
                          </span>
                          <strong style={{ color: '#1e293b', fontSize: 'var(--font-body)', lineHeight: 1.35 }} title={item.description}>
                            {item.description}
                          </strong>
                        </div>
                        {item.notes && (
                          <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b', lineHeight: 1.3 }}>{item.notes}</p>
                        )}
                      </td>
                      <td style={{ padding: '8px 4px', textAlign: 'center', color: '#475569', fontWeight: 600, fontSize: 'var(--font-micro)' }}>
                        {item.unit}
                      </td>
                      <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                        <input
                          type="number"
                          min="0"
                          value={item.estimatedQty}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, estimatedQty: val } : it)));
                          }}
                          style={{ width: '100%', maxWidth: '75px', height: '28px', padding: '0 4px', textAlign: 'center', borderRadius: '5px', border: '1px solid #cbd5e1', fontSize: 'var(--font-body)', fontWeight: 700, color: '#170e5e' }}
                        />
                      </td>
                      <td style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 600, color: '#475569', fontSize: 'var(--font-micro)', whiteSpace: 'nowrap' }}>
                        {formatCurrency(calc.totalCostPerUnit)}
                      </td>
                      <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={item.profitMarkupPercent}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, profitMarkupPercent: val } : it)));
                            }}
                            style={{ width: '46px', height: '28px', padding: '0 2px', textAlign: 'center', borderRadius: '5px', border: '1px solid #cbd5e1', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#15803d' }}
                          />
                          <span style={{ fontSize: '10px', color: '#64748b' }}>%</span>
                        </div>
                      </td>
                      <td style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700, color: '#170e5e', fontSize: 'var(--font-micro)', whiteSpace: 'nowrap' }}>
                        {formatCurrency(calc.sellingPricePerUnit)}
                      </td>
                      <td style={{ padding: '8px 8px', textAlign: 'center', fontWeight: 800, color: '#0f172a', fontSize: 'var(--font-body)', whiteSpace: 'nowrap' }}>
                        {formatCurrency(calc.totalSellingPrice)}
                      </td>
                      <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                          style={{
                            padding: '3px 8px',
                            borderRadius: '5px',
                            border: '1px solid #cbd5e1',
                            background: isExpanded ? '#170e5e' : '#ffffff',
                            color: isExpanded ? '#ffffff' : '#170e5e',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <AppIcons.Sliders size={11} />
                          <span>{isExpanded ? t('contracting.tender_estimator_modal.s58', "إخفاء") : 'BOM'}</span>
                        </button>
                      </td>
                      <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => setItems((prev) => prev.filter((it) => it.id !== item.id))}
                          title={t('contracting.tender_estimator_modal.s59', "حذف البند من العطاء")}
                          style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', padding: '2px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <AppIcons.Trash2 size={15} />
                        </button>
                      </td>
                    </tr>

                    {/* لوحة تفكيك الكود الهندسي القياسي (BOM Exploder) */}
                    {isExpanded && (
                      <tr style={{ background: '#f8fafc' }}>
                        <td colSpan={9} style={{ padding: '10px 14px', borderBottom: '2px solid #cbd5e1' }}>
                          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
                              <strong style={{ fontSize: 'var(--font-subtitle)', color: '#170e5e', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <AppIcons.CheckShield size={14} />
                                <span>{t('contracting.tender_estimator_modal.s60', "مكونات واستهلاكات الكود الهندسي للبند:")} {item.description} {t('contracting.tender_estimator_modal.s61', "(إجمالي كمية البند:")} {item.estimatedQty} {item.unit})</span>
                              </strong>
                              <span style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>
                                {t('contracting.tender_estimator_modal.s62', "هالك:")} {item.wastePercent}{t('contracting.tender_estimator_modal.s63', "% | إداريات:")} {item.overheadPercent}{t('contracting.tender_estimator_modal.s64', "% | ربح:")} {item.profitMarkupPercent}%
                              </span>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '8px', marginBottom: '8px' }}>
                              {calc.componentsDetail.map((comp) => (
                                <div key={comp.componentCode} style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 10px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={comp.componentName}>
                                      {comp.componentName}
                                    </span>
                                    <span style={{ fontSize: '10px', color: '#64748b' }}>({comp.unit})</span>
                                  </div>

                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '4px' }}>
                                    <strong style={{ fontSize: 'var(--font-body)', color: '#1e293b' }} dir="ltr">
                                      {comp.totalQtyForTender} {comp.unit}
                                    </strong>
                                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#170e5e' }}>
                                      {formatCurrency(comp.totalCostForTender)}
                                    </span>
                                  </div>

                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginTop: '6px', paddingTop: '4px', borderTop: '1px dashed #e2e8f0' }}>
                                    <div>
                                      <label style={{ display: 'block', fontSize: '9.5px', color: '#64748b', marginBottom: '1px' }}>{t('contracting.tender_estimator_modal.s65', "المعدل/")}{item.unit}:</label>
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
                                              const newComps = (it.components || []).map((c) =>
                                                c.componentCode === comp.componentCode ? { ...c, qtyPerUnit: val } : c
                                              );
                                              return { ...it, components: newComps };
                                            })
                                          );
                                        }}
                                        style={{ width: '100%', height: '24px', padding: '0 2px', textAlign: 'center', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: 700, color: '#170e5e' }}
                                      />
                                    </div>
                                    <div>
                                      <label style={{ display: 'block', fontSize: '9.5px', color: '#64748b', marginBottom: '1px' }}>{t('contracting.tender_estimator_modal.s66', "سعر الوحدة:")}</label>
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
                                              const newComps = (it.components || []).map((c) =>
                                                c.componentCode === comp.componentCode ? { ...c, unitRate: val } : c
                                              );
                                              return { ...it, components: newComps };
                                            })
                                          );
                                        }}
                                        style={{ width: '100%', height: '24px', padding: '0 2px', textAlign: 'center', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: 700, color: '#0369a1' }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '14px', fontSize: 'var(--font-micro)', borderTop: '1px solid #e2e8f0', paddingTop: '6px', flexWrap: 'wrap' }}>
                              <span>{t('contracting.tender_estimator_modal.s67', "التكلفة المباشرة:")} <strong>{formatCurrency(calc.totalDirectCost)}</strong></span>
                              <span>{t('contracting.tender_estimator_modal.s68', "التكلفة الشاملة بالإداريات:")} <strong>{formatCurrency(calc.totalTenderCost)}</strong></span>
                              <span style={{ color: '#15803d' }}>{t('contracting.tender_estimator_modal.s69', "صافي ربح البند:")} <strong>{formatCurrency(calc.totalProfit)}</strong></span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
