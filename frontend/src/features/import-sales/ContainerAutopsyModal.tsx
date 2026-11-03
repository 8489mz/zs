import { StandardDialog } from '@/shared/components/StandardDialog';
import { useContainerAutopsyQuery } from './api/shipments.api';
import { formatCurrency } from '@/lib/format';
import {
  DownloadIcon,
  RefreshCwIcon,
  AlertTriangleIcon,
  FileTextIcon,
} from '@/shared/components/icons/AppIcons';
import { downloadExcelFile } from '@/lib/browser';
import { toast } from '@/shared/components/system-alert';

interface ContainerAutopsyModalProps {
  isOpen: boolean;
  onClose: () => void;
  shipmentId: string;
}

export function ContainerAutopsyModal({ isOpen, onClose, shipmentId }: ContainerAutopsyModalProps) {
  const { data: autopsy, isLoading } = useContainerAutopsyQuery(shipmentId);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleExportExcel = async () => {
    if (!autopsy) return;
    try {
      const headers = [
        'بيان الصنف',
        'الكمية المشحونة',
        'المستلم الفعلي',
        'سعر المصنع ($)',
        'تكلفة الوحدة الواصلة (ج.م)',
        'إجمالي تكلفة البند الواصلة (ج.م)',
      ];
      const rows: Array<Array<string | number | null | undefined>> = (autopsy.items || []).map((item: any) => [
        item.product_name || `صنف #${item.product_id}`,
        item.quantity,
        item.received_quantity ?? item.quantity,
        Number(item.factory_unit_price_usd || 0),
        Number((Number(item.landed_cost_egp) / Number((item.received_quantity ?? item.quantity) || 1)).toFixed(2)),
        Number(Number(item.landed_cost_egp || 0).toFixed(2)),
      ]);

      rows.push(['---', '---', '---', '---', '---', '---']);
      rows.push(['رقم الحاوية', autopsy.operational.containerNumber, 'بوليصة الشحن', autopsy.operational.billOfLading || '—', 'المورد', autopsy.operational.supplierName || '—']);
      rows.push(['إجمالي التكلفة الواصلة (Landed Cost EGP)', Number(autopsy.landedCosts.totalLandedCostEgp || 0), '', '', '', '']);
      rows.push(['إجمالي مبيعات الحاوية (Gross Sales EGP)', Number(autopsy.salesAndInventory.grossSalesEgp || 0), '', '', '', '']);
      rows.push(['هامش التداول الإجمالي (Gross Trading Margin EGP)', Number(autopsy.profitability.realizedGrossTradingMarginEgp || 0), '', '', '', '']);
      rows.push(['العائد على الاستثمار (ROI %)', `%`, '', '', '', '']);
      rows.push(['قيمة المخزون المتبقي (Landed Value EGP)', Number(autopsy.salesAndInventory.unsoldStockLandedValueEgp || 0), '', '', '', '']);

      await downloadExcelFile(`كشف_تشريح_الحاوية_${autopsy.operational.containerNumber || shipmentId}.xlsx`, headers, rows);
      toast.success('تم تصدير كشف تشريح الحاوية إلى ملف إكسل بنجاح');
    } catch (err: any) {
      toast.error('فشل تصدير الإكسل: ' + (err?.message || 'خطأ'));
    }
  };

  return (
    <StandardDialog
      isOpen={isOpen}
      onClose={onClose}
      title="كشف تشريح ربحية الحاوية الفردية (Container P&L Autopsy Sheet)"
      subtitle="تحليل مالي وميداني شامل لتكلفة الحاوية الواصلة ومبيعاتها وأرباحها المحققة والمتبقية"
      width="1180px"
      compact
    >
      {isLoading ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748b' }}>
          <RefreshCwIcon size={28} className="spin" />
          <p style={{ marginTop: 12, fontSize: 13, fontWeight: 600 }}>جاري استخراج بيانات الحاوية والمطابقة المالية...</p>
        </div>
      ) : !autopsy ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#ef4444' }}>
          <AlertTriangleIcon size={32} />
          <p style={{ marginTop: 12, fontSize: 14, fontWeight: 700 }}>تعذر تحميل بيانات تشريح الحاوية</p>
        </div>
      ) : (
        <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Action Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>رقم الحاوية:</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: '#170e5e', fontFamily: 'monospace', backgroundColor: '#eef2ff', padding: '2px 8px', borderRadius: 4 }}>
                {autopsy.operational.containerNumber}
              </span>
              <span style={{ fontSize: 12, color: '#64748b' }}>({autopsy.operational.containerSize || '40HQ'} - {autopsy.operational.freightType || 'FCL'})</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={handleExportExcel}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 6,
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  color: '#15803d',
                }}
              >
                <FileTextIcon size={14} />
                تصدير إكسل (Excel)
              </button>
              <button
                type="button"
                onClick={handlePrint}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  backgroundColor: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  color: '#334155',
                }}
              >
                <DownloadIcon size={14} />
                طباعة الكشف التنفيذي
              </button>
            </div>
          </div>

          {/* KPI Dashboard Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>إجمالي التكلفة الواصلة (Landed Cost)</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#170e5e', marginTop: 4 }}>
                {formatCurrency(autopsy.landedCosts.totalLandedCostEgp)}
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                متوسط تكلفة القطعة: {formatCurrency(autopsy.landedCosts.avgCostPerUnitEgp)}
              </div>
              {autopsy.landedCosts.exchangeRateAssumed && (
                <div style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>
                  سعر الصرف مفترض (50) لعدم وجود سعر وصول أو تسعير — كل أرقام الجنيه هنا تقديرية.
                </div>
              )}
            </div>

            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>إجمالي مبيعات وحجوزات الحاوية</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#0369a1', marginTop: 4 }}>
                {formatCurrency(autopsy.salesAndInventory.grossSalesEgp)}
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                عربون محصل: {formatCurrency(autopsy.salesAndInventory.depositsCollectedEgp)}
              </div>
            </div>

            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>هامش التداول الإجمالي (Gross Trading Margin)</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: autopsy.profitability.realizedGrossTradingMarginEgp >= 0 ? '#15803d' : '#b91c1c', marginTop: 4 }}>
                {formatCurrency(autopsy.profitability.realizedGrossTradingMarginEgp)}
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                العائد الاستثماري: {autopsy.profitability.roiPercentage}% ROI
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                هامش إجمالي قبل المصاريف التشغيلية والتكاليف المرحّلة؛ صافي الربح في تقرير أرباح المشروع.
              </div>
            </div>

            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>مخزون متبقي بالمستودع (Lots)</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#b45309', marginTop: 4 }}>
                {formatCurrency(autopsy.salesAndInventory.unsoldStockLandedValueEgp)}
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                وحدات غير مباعة: {autopsy.operational.totalRemainingUnits} من أصل {autopsy.operational.totalUnitsReceived}
              </div>
            </div>
          </div>

          {/* Operational & Logistic Data */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {/* Operational Details Card */}
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, backgroundColor: '#ffffff' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a', borderBottom: '1px solid #f1f5f9', paddingBottom: 6, marginBottom: 8 }}>
                بيانات الشحن واللوجستيات
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 8, columnGap: 12, fontSize: 12 }}>
                <div>
                  <span style={{ color: '#64748b' }}>المشروع: </span>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>{autopsy.operational.projectTitle || '—'}</span>
                </div>
                <div>
                  <span style={{ color: '#64748b' }}>المورد: </span>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>{autopsy.operational.supplierName || '—'}</span>
                </div>
                <div>
                  <span style={{ color: '#64748b' }}>بوليصة الشحن (B/L): </span>
                  <span style={{ fontWeight: 600, color: '#0f172a', fontFamily: 'monospace' }}>{autopsy.operational.billOfLading || '—'}</span>
                </div>
                <div>
                  <span style={{ color: '#64748b' }}>الخط الملاحي: </span>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>{autopsy.operational.carrierName || '—'}</span>
                </div>
                <div>
                  <span style={{ color: '#64748b' }}>ميناء الشحن / الوصول: </span>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>{autopsy.operational.portOfLoading} &larr; {autopsy.operational.portOfDischarge}</span>
                </div>
                <div>
                  <span style={{ color: '#64748b' }}>حالة الحاوية: </span>
                  <span style={{ fontWeight: 700, color: autopsy.operational.containerStatus === 'empty_returned' ? '#15803d' : '#d97706' }}>
                    {autopsy.operational.containerStatus === 'empty_returned' ? 'تم تسليم الفارغ والمطابقة' : 'قيد الاستلام والتفريغ'}
                  </span>
                </div>
              </div>
            </div>

            {/* Cost Anatomy Breakdown Card */}
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, backgroundColor: '#ffffff' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a', borderBottom: '1px solid #f1f5f9', paddingBottom: 6, marginBottom: 8 }}>
                التشريح التفصيلي لبنود التكلفة (Cost Breakdown)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#475569' }}>قيمة البضاعة فوب (USD {autopsy.landedCosts.factoryTotalUsd}):</span>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>{formatCurrency(autopsy.landedCosts.factoryTotalEgp)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#475569' }}>الشحن البحري الدولي (Ocean Freight):</span>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>{formatCurrency(autopsy.landedCosts.shippingEgp)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#475569' }}>الجمارك ومصاريف الميناء المسواة:</span>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>{formatCurrency(autopsy.landedCosts.customsEgp)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#475569' }}>النقل والتعتيق الداخلي:</span>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>{formatCurrency(autopsy.landedCosts.transportEgp)}</span>
                </div>
                {autopsy.landedCosts.demurrageEgp > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#b91c1c' }}>
                    <span>غرامات أرضيات وتأخير (Demurrage):</span>
                    <span style={{ fontWeight: 700 }}>{formatCurrency(autopsy.landedCosts.demurrageEgp)}</span>
                  </div>
                )}
                {autopsy.landedCosts.lateExpensesEgp > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#b45309' }}>
                    <span>مصاريف متأخرة موزعة (IAS 2 Split):</span>
                    <span style={{ fontWeight: 700 }}>{formatCurrency(autopsy.landedCosts.lateExpensesEgp)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e2e8f0', paddingTop: 6, fontWeight: 800 }}>
                  <span style={{ color: '#170e5e' }}>إجمالي التكلفة الواصلة للحاوية:</span>
                  <span style={{ color: '#170e5e', fontSize: 13 }}>{formatCurrency(autopsy.landedCosts.totalLandedCostEgp)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Items & Lots Summary Table */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ backgroundColor: '#f8fafc', padding: '8px 12px', borderBottom: '1px solid #e2e8f0', fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>
              متابعة تشغيلات الأصناف (Lots Provenance & Traceability)
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>
                  <th style={{ padding: '8px 10px', color: '#475569', fontWeight: 600 }}>بيان الصنف</th>
                  <th style={{ padding: '8px 10px', color: '#475569', fontWeight: 600 }}>الكمية المشحونة</th>
                  <th style={{ padding: '8px 10px', color: '#475569', fontWeight: 600 }}>المستلم الفعلي</th>
                  <th style={{ padding: '8px 10px', color: '#475569', fontWeight: 600 }}>سعر المصنع ($)</th>
                  <th style={{ padding: '8px 10px', color: '#475569', fontWeight: 600 }}>تكلفة الوحدة الواصلة</th>
                  <th style={{ padding: '8px 10px', color: '#475569', fontWeight: 600 }}>إجمالي تكلفة البند</th>
                </tr>
              </thead>
              <tbody>
                {autopsy.items && autopsy.items.map((item: any) => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600, color: '#0f172a' }}>{item.product_name || `صنف #${item.product_id}`}</td>
                    <td style={{ padding: '8px 10px' }}>{item.quantity}</td>
                    <td style={{ padding: '8px 10px', color: Number(item.received_quantity ?? item.quantity) < Number(item.quantity) ? '#b91c1c' : '#15803d', fontWeight: 600 }}>
                      {item.received_quantity ?? item.quantity}
                    </td>
                    <td style={{ padding: '8px 10px' }}>${Number(item.factory_unit_price_usd).toFixed(2)}</td>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: '#170e5e' }}>
                      {formatCurrency(Number(item.landed_cost_egp) / Number((item.received_quantity ?? item.quantity) || 1))}
                    </td>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0f172a' }}>{formatCurrency(Number(item.landed_cost_egp))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer note */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#64748b' }}>
            <div>* التكاليف المحسوبة مستخرجة من أذونات استلام المخازن وقيود اليومية المحاسبية المعتمدة وفق معيار IAS 2.</div>
            <div>معتمد من ZS International Trade Engine</div>
          </div>
        </div>
      )}
    </StandardDialog>
  );
}
