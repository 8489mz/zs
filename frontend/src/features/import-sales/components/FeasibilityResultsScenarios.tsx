import { CheckCircleIcon } from '@/shared/components/icons/AppIcons';
import { formatMarketProfitEgp } from '../utils/import-display-formatters';

export interface FeasibilityResultsScenariosProps {
  feasibilityResult: any;
  targetMarkup: number;
  feasibilityProjectId: string | null;
  onConvertFeasibility: () => void;
  convertFeasibilityMutation: { isPending: boolean };
  updateProjectMutation: { isPending: boolean };
}

export function FeasibilityResultsScenarios({
  feasibilityResult,
  targetMarkup,
  feasibilityProjectId,
  onConvertFeasibility,
  convertFeasibilityMutation,
  updateProjectMutation,
}: FeasibilityResultsScenariosProps) {
  return (
    <>
              {/* 3. Three Decision Scenarios */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {/* Base Scenario */}
                <div style={{ backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#170e5e', marginBottom: 6 }}>
                    1. السيناريو الأساسي (Base Scenario)
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#1e293b' }}>
                    السيولة المطلوبة للتمويل: {feasibilityResult.scenarios.base.totalInvestmentEgp.toLocaleString()} ج.م
                  </div>
                  <div style={{ fontSize: '9.5px', color: '#64748b', marginBottom: 4 }}>
                    شاملة سعر المصنع، النولون، والجمارك المحسوبة
                  </div>
                  <div style={{ fontSize: '11px', color: '#475569' }}>
                    المبيعات المستهدفة: {feasibilityResult.scenarios.base.expectedRevenueEgp.toLocaleString()} ج.م
                  </div>
                  <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#059669', marginTop: 4 }}>
                    صافي الربح: {feasibilityResult.scenarios.base.expectedNetProfitEgp.toLocaleString()} ج.م (
                    {feasibilityResult.scenarios.base.roiPercentage}%)
                  </div>
                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: 4 }}>
                    نقطة التعادل: بيع {feasibilityResult.scenarios.base.breakEvenUnits} قطعة من أصل{' '}
                    {feasibilityResult.totalUnitsCount} لاسترداد التكلفة الاستثمارية بالكامل.
                  </div>
                </div>

                {/* Best Scenario */}
                <div style={{ backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#047857', marginBottom: 6 }}>
                    2. السيناريو المتفائل (Best Scenario)
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#047857' }}>
                    السيولة المطلوبة للتمويل: {feasibilityResult.scenarios.best.totalInvestmentEgp.toLocaleString()} ج.م
                  </div>
                  <div style={{ fontSize: '9.5px', color: '#047857', fontWeight: 700, marginBottom: 4 }}>
                    وفر{' '}
                    {(
                      feasibilityResult.scenarios.base.totalInvestmentEgp -
                      feasibilityResult.scenarios.best.totalInvestmentEgp
                    ).toLocaleString()}{' '}
                    ج.م في الكاش بفضل خصم الشحن
                  </div>
                  <div style={{ fontSize: '11px', color: '#475569' }}>
                    المبيعات المتوقعة: {feasibilityResult.scenarios.best.expectedRevenueEgp.toLocaleString()} ج.م
                  </div>
                  <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#047857', marginTop: 4 }}>
                    صافي الربح: {feasibilityResult.scenarios.best.expectedNetProfitEgp.toLocaleString()} ج.م (
                    {feasibilityResult.scenarios.best.roiPercentage}%)
                  </div>
                  <div style={{ fontSize: '10px', color: '#047857', marginTop: 4 }}>
                    وفر 5% في نولون الشحن مع سرعة تصريف البضاعة بسعر ممتاز.
                  </div>
                </div>

                {/* Worst Scenario */}
                <div style={{ backgroundColor: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#be123c', marginBottom: 6 }}>
                    3. السيناريو المتحفظ (Worst Scenario)
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#be123c' }}>
                    السيولة المطلوبة للتمويل: {feasibilityResult.scenarios.worst.totalInvestmentEgp.toLocaleString()} ج.م
                  </div>
                  <div style={{ fontSize: '9.5px', color: '#be123c', fontWeight: 700, marginBottom: 4 }}>
                    زيادة{' '}
                    {(
                      feasibilityResult.scenarios.worst.totalInvestmentEgp -
                      feasibilityResult.scenarios.base.totalInvestmentEgp
                    ).toLocaleString()}{' '}
                    ج.م كاش تحوطاً للأرضيات والتأخير
                  </div>
                  <div style={{ fontSize: '11px', color: '#475569' }}>
                    المبيعات المتحفظة: {feasibilityResult.scenarios.worst.expectedRevenueEgp.toLocaleString()} ج.م
                  </div>
                  <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#be123c', marginTop: 4 }}>
                    صافي الربح: {feasibilityResult.scenarios.worst.expectedNetProfitEgp.toLocaleString()} ج.م (
                    {feasibilityResult.scenarios.worst.roiPercentage}%)
                  </div>
                  <div style={{ fontSize: '10px', color: '#be123c', marginTop: 4 }}>
                    تحوط ضد انخفاض السعر 10% واحتساب 15,000 ج.م غرامات أرضيات تأخير.
                  </div>
                </div>
              </div>

              {/* 4. Detailed Landed Cost & Market Arbitrage Table */}
              <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>
                  تحليل تكلفة القطعة الواصلة وهوامش الربح مقارنة بأسعار السوق المصري
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #cbd5e1' }}>
                        <th style={{ padding: '6px 8px', fontSize: '11px', color: '#475569' }}>الصنف</th>
                        <th style={{ padding: '6px 8px', fontSize: '11px', color: '#475569' }}>الكمية</th>
                        <th style={{ padding: '6px 8px', fontSize: '11px', color: '#475569' }}>سعر المصنع ($)</th>
                        <th style={{ padding: '6px 8px', fontSize: '11px', color: '#475569' }}>تكلفة القطعة الواصلة (ج.م)</th>
                        <th style={{ padding: '6px 8px', fontSize: '11px', color: '#475569' }}>سعر الجملة المقترح ({targetMarkup}%)</th>
                        <th style={{ padding: '6px 8px', fontSize: '11px', color: '#475569' }}>سعر السوق المحلي (ج.م)</th>
                        <th style={{ padding: '6px 8px', fontSize: '11px', color: '#475569' }}>صافي ربح القطعة (ج.م)</th>
                        <th style={{ padding: '6px 8px', fontSize: '11px', color: '#475569' }} title="هامش الربح الفعلي المحقق بناءً على سعر البيع في السوق المصري مقارنة بالتكلفة الواصلة">هامش ربح السوق %</th>
                        <th style={{ padding: '6px 8px', fontSize: '11px', color: '#475569' }}>إجمالي ربح الصنف (ج.م)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {feasibilityResult.items.map((it: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '6px 8px', fontSize: '11.5px', fontWeight: 700 }}>{it.name}</td>
                          <td style={{ padding: '6px 8px', fontSize: '11.5px' }}>{it.qty}</td>
                          <td style={{ padding: '6px 8px', fontSize: '11.5px', fontFamily: 'monospace' }}>${it.factoryPriceUsd}</td>
                          <td style={{ padding: '6px 8px', fontSize: '11.5px', fontWeight: 800, color: '#170e5e' }}>
                            {it.unitLandedCostEgp} ج.م
                          </td>
                          <td style={{ padding: '6px 8px', fontSize: '11.5px', fontWeight: 700, color: '#0284c7' }}>
                            {it.suggestedWholesalePriceEgp} ج.م
                          </td>
                          <td style={{ padding: '6px 8px', fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>
                            {it.expectedLocalMarketPriceEgp ? `${it.expectedLocalMarketPriceEgp.toLocaleString()} ج.م` : '—'}
                          </td>
                          <td
                            style={{
                              padding: '6px 8px',
                              fontSize: '11.5px',
                              fontWeight: 800,
                              color: (it.unitNetProfitVsMarketEgp || 0) >= 0 ? '#15803d' : '#b91c1c',
                            }}
                          >
                            {formatMarketProfitEgp(it.unitNetProfitVsMarketEgp)}
                          </td>
                          <td style={{ padding: '6px 8px', fontSize: '11.5px', fontWeight: 700, color: '#15803d' }}>
                            {it.marginVsMarketPercent !== undefined ? `${it.marginVsMarketPercent}%` : '—'}
                          </td>
                          <td
                            style={{
                              padding: '6px 8px',
                              fontSize: '11.5px',
                              fontWeight: 800,
                              color: '#15803d',
                              backgroundColor: '#f0fdf4',
                            }}
                          >
                            {it.totalProfitVsMarketEgp !== undefined
                              ? `${it.totalProfitVsMarketEgp.toLocaleString()} ج.م`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Conversion Button */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, paddingTop: 8 }}>
                {!feasibilityProjectId && (
                  <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#b45309' }}>
                    الاعتماد متاح فقط عند فتح دراسة الجدوى من صف مشروع قائم — لن يتم إنشاء مشروع جديد من هنا.
                  </span>
                )}
                <button
                  type="button"
                  onClick={onConvertFeasibility}
                  disabled={convertFeasibilityMutation.isPending || updateProjectMutation.isPending || !feasibilityProjectId}
                  title={feasibilityProjectId ? 'اعتماد دراسة الجدوى على المشروع الحالي' : 'افتح دراسة الجدوى من صف المشروع لاعتمادها عليه'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 18px',
                    backgroundColor: '#15803d',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: '12.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <CheckCircleIcon size={16} />
                  <span>
                    {convertFeasibilityMutation.isPending
                      ? 'جاري التحويل...'
                      : 'اعتماد دراسة الجدوى وتحويلها لمشروع استيراد معتمد'}
                  </span>
                </button>
              </div>
    </>
  );
}
