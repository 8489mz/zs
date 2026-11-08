import { useState } from 'react';
import {
  useQuotationsQuery,
  useCreateQuotationMutation,
  useSelectQuotationMutation,
  useChinaSuppliersQuery,
} from '../api/shipments.api';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { formatCurrency } from '@/lib/format';
import { PlusCircleIcon } from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { useQuery } from '@tanstack/react-query';
import { http } from '@/lib/http';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';

export function ChinaQuotationsTab() {
  const { data: quotations = [], refetch } = useQuotationsQuery();
  const { data: suppliers = [] } = useChinaSuppliersQuery();
  const createQuotationMutation = useCreateQuotationMutation();
  const selectQuotationMutation = useSelectQuotationMutation();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedQuoteForApproval, setSelectedQuoteForApproval] = useState<any | null>(null);
  const [selectionReason, setSelectionReason] = useState('أفضل تكلفة واصلة مع مطابقة المواصفات الفنية المعتمدة');

  // Form State
  const [projectId, setProjectId] = useState('');
  const [supplierId, setSupplierId] = useState<number | ''>('');
  const [quotationNo, setQuotationNo] = useState('');
  const [itemName, setItemName] = useState('');
  const [incoterm, setIncoterm] = useState('FOB');
  const currency = 'USD';
  const [totalForeign, setTotalForeign] = useState<number>(45);
  const [exchangeRate, setExchangeRate] = useState<number>(50);
  const [shippingCostUsd, setShippingCostUsd] = useState<number>(3.5);
  const [customsDutyEgp, setCustomsDutyEgp] = useState<number>(5);
  const [leadTimeDays, setLeadTimeDays] = useState<number>(30);
  const [validUntil, setValidUntil] = useState('');

  // Fetch Projects
  const { data: projects = [] } = useQuery({
    queryKey: ['import-projects'],
    queryFn: async () => {
      const res = await http<any[]>('/api/import-sales/projects');
      return Array.isArray(res) ? res : (res as any)?.items || [];
    },
  });

  const selectedProject = projects.find((p: any) => String(p.id) === String(projectId));
  const projectFeas = typeof selectedProject?.feasibility_data === 'string'
    ? JSON.parse(selectedProject.feasibility_data || '{}')
    : (selectedProject?.feasibility_data || {});
  const projectItems: any[] = Array.isArray(projectFeas?.items) ? projectFeas.items : [];

  // INV-IMPORT-ESTIMATES-HONEST: the live estimate shows the EFFECTIVE
  // values it was computed from. When the operator clears the rate or
  // customs field, the computation falls back to 50 / 5% — the formula
  // line must say so instead of showing a blank input as if no
  // assumption was made.
  const effectiveEstimateRate = Number(exchangeRate || 50);
  const effectiveEstimateCustoms = Number(customsDutyEgp || 5);
  const estimateUsesAssumedInputs = !exchangeRate || !customsDutyEgp;
  // INV-FE2-FRONTEND-BOOK-DIGITS: the estimate is POSTed as
  // estimatedUnitCostEgp — an EGP-denominated amount, so it rounds at
  // EGP digits (2), the denomination of the amount.
  const estimatedUnitLandedCostEgp = roundMoneyValue(
    (Number(totalForeign || 0) + Number(shippingCostUsd || 0)) *
      effectiveEstimateRate *
      (1 + effectiveEstimateCustoms / 100) *
      1.14,
    currencyMoneyDigits('EGP'),
  );

  const handleCreateQuotation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId) {
      toast.error('يرجى اختيار المصنع');
      return;
    }
    try {
      await createQuotationMutation.mutateAsync({
        projectId: projectId || undefined,
        supplierId: Number(supplierId),
        quotationNo: quotationNo || `RFQ-${Date.now().toString().slice(-6)}`,
        itemName: itemName.trim() || `بند عرض سعر ${quotationNo || ''}`.trim(),
        incoterm,
        currency,
        unitPriceForeign: Number(totalForeign),
        exchangeRate: Number(exchangeRate),
        estimatedFreightUsd: Number(shippingCostUsd),
        estimatedCustomsRatePercent: Number(customsDutyEgp),
        estimatedUnitCostEgp: estimatedUnitLandedCostEgp,
        productionLeadDays: Number(leadTimeDays),
        expiryDate: validUntil || undefined,
      });
      toast.success('تم تسجيل عرض السعر RFQ للمقارنة بنجاح');
      setIsCreateOpen(false);
      setItemName('');
      setQuotationNo('');
      refetch();
    } catch (err: any) {
      toast.error('فشل تسجيل عرض السعر: ' + (err.message || 'خطأ'));
    }
  };

  const handleSelectQuotation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedQuoteForApproval) return;
    try {
      await selectQuotationMutation.mutateAsync({
        quotationId: selectedQuoteForApproval.id,
        selectionReason: selectionReason,
      });
      toast.success('تم اعتماد واختيار العرض الفائز وتحديث دراسة الجدوى');
      setSelectedQuoteForApproval(null);
      refetch();
    } catch (err: any) {
      toast.error('فشل اعتماد العرض: ' + (err.message || 'خطأ'));
    }
  };

  return (
    <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Top Action Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>
            مقارنة عروض أسعار المصانع (RFQ Quotations Comparison)
          </h2>
          <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>
            مقارنة تكلفة الفوب والشحن والجمارك وسعر الوحدة الواصلة بين عروض المصانع الصينية
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            backgroundColor: '#170e5e',
            color: '#ffffff',
            border: 'none',
            borderRadius: 6,
            fontSize: 12.5,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <PlusCircleIcon size={14} />
          تسجيل عرض سعر RFQ جديد
        </button>
      </div>

      {/* Table */}
      <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>
              <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>المصنع المورد</th>
              <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>رقم العرض / الصنف</th>
              <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>شرط التسليم</th>
              <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>سعر المصنع ($)</th>
              <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>تكلفة القطعة الواصلة</th>
              <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>مدة الإنتاج</th>
              <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>الحالة</th>
              <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600, textAlign: 'center' }}>الإجراء</th>
            </tr>
          </thead>
          <tbody>
            {quotations.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>
                  لا توجد عروض أسعار مسجلة للمقارنة حالياً
                </td>
              </tr>
            ) : (
              quotations.map((q: any) => (
                <tr key={q.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 700, color: '#0f172a' }}>
                    {q.supplier_name || `مورد #${q.supplier_id}`}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>{q.quotation_no || '—'}</div>
                    {q.item_name && <div style={{ fontSize: 11.5, color: '#64748b' }}>{q.item_name}</div>}
                  </td>
                  <td style={{ padding: '10px 14px', fontWeight: 600 }}>{q.incoterm}</td>
                  <td style={{ padding: '10px 14px', fontWeight: 700, color: '#0369a1' }}>
                    ${Number(q.unit_price_foreign ?? q.total_amount_foreign ?? 0).toLocaleString()}
                  </td>
                  <td style={{ padding: '10px 14px', fontWeight: 700, color: '#170e5e' }}>
                    {formatCurrency(Number(q.estimated_landed_cost_egp ?? q.estimated_unit_cost_egp ?? 0))}
                  </td>
                  <td style={{ padding: '10px 14px' }}>{q.production_lead_days ?? q.lead_time_days ?? 30} يوم</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        backgroundColor:
                          q.status === 'selected'
                            ? '#dcfce7'
                            : q.status === 'rejected'
                            ? '#fee2e2'
                            : '#fef3c7',
                        color:
                          q.status === 'selected'
                            ? '#166534'
                            : q.status === 'rejected'
                            ? '#b91c1c'
                            : '#b45309',
                      }}
                    >
                      {q.status === 'selected' ? 'معتمد ومختار' : q.status === 'rejected' ? 'مرفوض' : 'قيد المقارنة'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                    {q.status !== 'selected' ? (
                      <button
                        type="button"
                        onClick={() => setSelectedQuoteForApproval(q)}
                        style={{
                          padding: '4px 10px',
                          backgroundColor: '#15803d',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 4,
                          fontSize: 11.5,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        اعتماد العرض
                      </button>
                    ) : (
                      <span style={{ fontSize: 11.5, color: '#15803d', fontWeight: 700 }}>العرض الفائز</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal: Create Quotation */}
      <StandardDialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="تسجيل عرض سعر مصنع (Factory RFQ Quotation)"
        subtitle="مقارنة تكلفة الوحدة وشروط المصنع وحساب تكلفة القطعة الواصلة للمخازن (Landed Cost)"
        width="760px"
        compact
      >
        <form onSubmit={handleCreateQuotation} dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#170e5e', marginBottom: 3 }}>
                المصنع / المورد الدولي: *
              </label>
              <select
                className="input"
                style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
                value={supplierId}
                onChange={(e) => setSupplierId(Number(e.target.value))}
                required
              >
                <option value="">-- اختر المصنع --</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.city ? `(${s.city})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 3 }}>
                مشروع الاستيراد المعتمد:
              </label>
              <select
                className="input"
                style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">-- اختياري --</option>
                {projects.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.project_no} - {p.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {projectItems.length > 0 && (
            <div style={{ backgroundColor: '#f1f5f9', padding: '8px 12px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#170e5e', marginBottom: 3 }}>
                سحب الصنف من دراسة جدوى المشروع:
              </label>
              <select
                className="input"
                style={{ width: '100%', padding: '6px 8px', fontSize: 12.5 }}
                onChange={(e) => {
                  const sel = projectItems.find((it: any) => (it.name || it.productName) === e.target.value);
                  if (sel) {
                    setItemName(sel.name || sel.productName);
                    if (sel.factoryPriceUsd) setTotalForeign(Number(sel.factoryPriceUsd));
                  }
                }}
              >
                <option value="">-- اختر بند من دراسة الجدوى أو اكتب الصنف يدوياً بالأسفل --</option>
                {projectItems.map((it: any, idx: number) => (
                  <option key={idx} value={it.name || it.productName}>
                    {it.name || it.productName} (سعر الجدوى: ${it.factoryPriceUsd || it.unitPriceForeign || 0})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 3 }}>
              اسم الصنف / البند المطلوب تسعيره: *
            </label>
            <input
              type="text"
              className="input"
              style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
              value={itemName}
              placeholder="مثال: طقم تيل فرامل وبطانات مكابح شاحنات ثقيلة"
              onChange={(e) => setItemName(e.target.value)}
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 3 }}>
                رقم عرض السعر:
              </label>
              <input
                type="text"
                className="input"
                style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
                value={quotationNo}
                placeholder="RFQ-261024-0001"
                onChange={(e) => setQuotationNo(e.target.value)}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 3 }}>
                شرط التسليم (Incoterm):
              </label>
              <select
                className="input"
                style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
                value={incoterm}
                onChange={(e) => setIncoterm(e.target.value)}
              >
                <option value="FOB">FOB (تسليم على ظهر السفينة)</option>
                <option value="EXW">EXW (تسليم أرض المصنع)</option>
                <option value="CIF">CIF (شامل الشحن والتأمين)</option>
                <option value="CFR">CFR (شامل الشحن)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#0369a1', marginBottom: 3 }}>
                سعر وحدة الصنف من المصنع ($ - FOB): *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                className="input"
                style={{ width: '100%', padding: '7px 10px', fontSize: 13, fontWeight: 700, color: '#0369a1' }}
                value={totalForeign}
                onChange={(e) => setTotalForeign(Number(e.target.value))}
                placeholder="سعر القطعة بالدولار"
                required
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1.2fr', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 3 }}>
                سعر صرف التقدير (ج.م/$):
              </label>
              <input
                type="number"
                step="0.01"
                min="1"
                className="input"
                style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
                value={exchangeRate}
                onChange={(e) => setExchangeRate(Number(e.target.value))}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 3 }}>
                نصيب القطعة من الشحن البحري ($):
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                className="input"
                style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
                value={shippingCostUsd}
                onChange={(e) => setShippingCostUsd(Number(e.target.value))}
                placeholder="3.5$ للقطعة (أو 3500$ للحاوية)"
              />
              <span style={{ fontSize: 10.5, color: '#64748b' }}>نولون شحن القطعة (3,500$ للحاوية ÷ 1,000 قطعة)</span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 3 }}>
                نسبة التعريفة الجمركية المقدرة (%):
              </label>
              <input
                type="number"
                step="0.5"
                min="0"
                max="100"
                className="input"
                style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
                value={customsDutyEgp}
                onChange={(e) => setCustomsDutyEgp(Number(e.target.value))}
                placeholder="5% لقطع غيار الشاحنات"
              />
              <span style={{ fontSize: 10.5, color: '#64748b' }}>نسبة مئوية (5% لقطع النقل الثقيل)</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                مدة الإنتاج والتجهيز (أيام):
              </label>
              <input
                type="number"
                min="1"
                className="input"
                style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
                value={leadTimeDays}
                onChange={(e) => setLeadTimeDays(Number(e.target.value))}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                صلاحية العرض حتى تاريخ:
              </label>
              <input
                type="date"
                className="input"
                style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </div>
          </div>

          {/* Dynamic Live Landed Cost Calculation Card */}
          <div style={{ backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#065f46' }}>
                  التكلفة التقديرية الواصلة للقطعة (Estimated Landed Cost):
                </span>
                <span style={{ fontSize: 15, fontWeight: 800, color: '#047857', marginRight: 8 }}>
                  {formatCurrency(estimatedUnitLandedCostEgp)}
                </span>
              </div>
              <span style={{ fontSize: 11, color: '#047857' }}>
                (سعر المصنع ${totalForeign} + شحن القطعة ${shippingCostUsd}) × {effectiveEstimateRate} ج.م + جمارك {effectiveEstimateCustoms}% + ض.ق.م 14%
                {estimateUsesAssumedInputs ? ' — قيم مفترضة (سعر 50 / جمارك 5%)، حدد القيم الفعلية قبل الاعتماد' : ''}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => setIsCreateOpen(false)}
              style={{ padding: '7px 14px', backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12.5, cursor: 'pointer' }}
            >
              إلغاء
            </button>
            <button
              type="submit"
              style={{ padding: '7px 18px', backgroundColor: '#170e5e', color: '#ffffff', border: 'none', borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
            >
              حفظ العرض للمقارنة
            </button>
          </div>
        </form>
      </StandardDialog>

      {/* Modal: Select & Approve Quotation */}
      {selectedQuoteForApproval && (
        <StandardDialog
          isOpen={!!selectedQuoteForApproval}
          onClose={() => setSelectedQuoteForApproval(null)}
          title="اعتماد العرض الفائز (Award Quotation)"
          subtitle={`المصنع: ${selectedQuoteForApproval.supplier_name} | إجمالي القيمة: $${Number(selectedQuoteForApproval.total_amount_foreign).toLocaleString()}`}
          width="500px"
          compact
        >
          <form onSubmit={handleSelectQuotation} dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                مبررات الاختيار والاعتماد الفني: *
              </label>
              <textarea
                rows={3}
                className="input"
                style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
                value={selectionReason}
                onChange={(e) => setSelectionReason(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setSelectedQuoteForApproval(null)}
                style={{ padding: '7px 14px', backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12.5, cursor: 'pointer' }}
              >
                إلغاء
              </button>
              <button
                type="submit"
                style={{ padding: '7px 16px', backgroundColor: '#15803d', color: '#ffffff', border: 'none', borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
              >
                تأكيد الاعتماد والترسية
              </button>
            </div>
          </form>
        </StandardDialog>
      )}
    </div>
  );
}
