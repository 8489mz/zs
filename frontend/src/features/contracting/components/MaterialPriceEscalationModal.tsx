import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { CustomSelect } from '@/shared/ui/custom-select';
import { Field } from '@/shared/ui/field';
import { contractingApi } from '../api/contracting.api';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import type {
  ContractingMaterialEscalation,
  MaterialEscalationType,
  MaterialEscalationStatus,
  ContractingInvoice,
} from '../contracting.types';
import { toast } from '@/shared/components/system-alert';

interface MaterialPriceEscalationModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName?: string;
}

const MATERIAL_PRESETS: Record<MaterialEscalationType, { label: string; unit: string; defaultBase: number; defaultCurrent: number }> = {
  rebar_steel: { label: 'حديد تسليح (Rebar Steel)', unit: 'ton', defaultBase: 38000, defaultCurrent: 44500 },
  portland_cement: { label: 'أسمنت بورتلاندي 42.5 (Portland Cement)', unit: 'ton', defaultBase: 2300, defaultCurrent: 2850 },
  ready_mix: { label: 'خرسانة جاهزة مسلحة C30 (Ready-Mix Concrete)', unit: 'm3', defaultBase: 1450, defaultCurrent: 1850 },
  bitumen: { label: 'عزل وممبرين بيتوميني (Bituminous Waterproofing)', unit: 'm2', defaultBase: 160, defaultCurrent: 210 },
  sand_gravel: { label: 'سن ورمل إحلال ورصف (Aggregates & Sand)', unit: 'm3', defaultBase: 240, defaultCurrent: 320 },
  other: { label: 'خامة أخرى مخصصة', unit: 'unit', defaultBase: 0, defaultCurrent: 0 },
};

const ESCALATION_STATUS_CONFIG: Record<MaterialEscalationStatus, { bg: string; color: string; border: string; label: string }> = {
  draft: { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1', label: 'مسودة قيد الإعداد' },
  submitted_to_client: { bg: '#eff6ff', color: '#1e40af', border: '#bfdbfe', label: 'مرفوعة لجهة الإسناد/المالك' },
  approved_by_consultant: { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0', label: 'معتمدة رسمياً من الاستشاري' },
  settled_in_ipc: { bg: '#e0e7ff', color: '#3730a3', border: '#c7d2fe', label: 'مسواة ومدرجة بالمستخلص الجاري' },
  rejected: { bg: '#fee2e2', color: '#b91c1c', border: '#fecaca', label: 'مرفوضة / غير مطابقة' },
};

export function MaterialPriceEscalationModal({ open, onClose, projectId, projectName }: MaterialPriceEscalationModalProps) {
  const { t } = useTranslation();
  const [escalations, setEscalations] = useState<ContractingMaterialEscalation[]>([]);
  const [invoices, setInvoices] = useState<ContractingInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'list' | 'calculate'>('list');

  // Form State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [materialType, setMaterialType] = useState<MaterialEscalationType>('rebar_steel');
  const [materialName, setMaterialName] = useState('حديد تسليح عالي المقاومة مشرشر');
  const [basePriceContract, setBasePriceContract] = useState<number>(38000);
  const [currentMarketPrice, setCurrentMarketPrice] = useState<number>(44500);
  const [executedQuantity, setExecutedQuantity] = useState<number>(50);
  const [unit, setUnit] = useState('ton');
  const [bulletinSourceReference, setBulletinSourceReference] = useState('نشرة الأرقام القياسية لأسعار مواد البناء — وزارة الإسكان المصرية');
  const [notes] = useState('');

  // Status Change State
  const [updatingEscalation, setUpdatingEscalation] = useState<ContractingMaterialEscalation | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<MaterialEscalationStatus>('approved_by_consultant');
  const [selectedIpcId, setSelectedIpcId] = useState('');

  const loadData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [escData, invData] = await Promise.all([
        contractingApi.getMaterialEscalations(projectId),
        contractingApi.getInvoices(projectId).catch(() => []),
      ]);
      setEscalations(escData || []);
      setInvoices(invData || []);
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تحميل سجل مطالبات فروق الأسعار');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [open, loadData]);

  const handlePresetChange = (type: MaterialEscalationType) => {
    setMaterialType(type);
    const preset = MATERIAL_PRESETS[type];
    if (preset) {
      setMaterialName(preset.label.split('(')[0].trim());
      setUnit(preset.unit);
      if (preset.defaultBase > 0) setBasePriceContract(preset.defaultBase);
      if (preset.defaultCurrent > 0) setCurrentMarketPrice(preset.defaultCurrent);
    }
  };

  const calculatedDifference = Math.max(0, currentMarketPrice - basePriceContract);
  // INV-FE3-FRONTEND-BOOK-DIGITS: the total compensation is money, so it
  // rounds at the tenant's book digits, not hardcoded 2dp. (The
  // per-unit difference above is a unit price, not a money total — it
  // stays unrounded, like the other 4dp unit prices in contracting.)
  const calculatedTotalCompensation = roundMoneyValue(calculatedDifference * executedQuantity, currencyMoneyDigits(getGlobalSystemCurrency()));

  const handleCreateClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (calculatedDifference <= 0) {
      toast.error('يجب أن يكون السعر الحالي أعلى من السعر الأساسي للمطالبة بفرق سعر إيجابي');
      return;
    }
    if (executedQuantity <= 0) {
      toast.error('يرجى إدخال كمية منفذة صالحة');
      return;
    }
    try {
      setIsSubmitting(true);
      await contractingApi.createMaterialEscalation(projectId, {
        materialType,
        materialName: materialName.trim(),
        basePriceContract,
        currentMarketPrice,
        executedQuantity,
        unit,
        bulletinSourceReference: bulletinSourceReference.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      toast.success('تم إنشاء وتوثيق مطالبة فروق الأسعار بنجاح');
      setActiveTab('list');
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'فشل إنشاء مطالبة فروق الأسعار');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (!updatingEscalation) return;
    try {
      setIsSubmitting(true);
      await contractingApi.updateMaterialEscalationStatus(updatingEscalation.id, {
        status: selectedStatus,
        ipcInvoiceId: selectedIpcId || undefined,
      });

      toast.success('تم تحديث حالة مطالبة فروق الأسعار بنجاح');
      setUpdatingEscalation(null);
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'فشل تحديث الحالة');
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalApprovedCompensation = escalations
    .filter((e) => e.status === 'approved_by_consultant' || e.status === 'settled_in_ipc')
    .reduce((sum, e) => sum + e.totalCompensationAmount, 0);

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('contracting.material_price_escalation_modal.s0', "حاسبة ومطالبات فروق أسعار الخامات والتعويضات (Material Price Escalation Claims)")}
      subtitle={`حساب التعويضات الرسمية لفروق أسعار الحديد والأسمنت والخرسانة وتوليد ملاحق المطالبات — ${projectName || ''}`}
      maxWidth="1100px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">
        {/* شريط التبويبات العلوي وإجمالي المطالبات المعتمدة */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setActiveTab('list')}
              style={{
                padding: '6px 16px',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: 'var(--font-table-head)',
                border: activeTab === 'list' ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                background: activeTab === 'list' ? '#170e5e' : '#f8fafc',
                color: activeTab === 'list' ? '#ffffff' : '#334155',
                cursor: 'pointer',
              }}
            >
              {t('contracting.material_price_escalation_modal.s1', "سجل المطالبات (")}{escalations.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('calculate')}
              style={{
                padding: '6px 16px',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: 'var(--font-table-head)',
                border: activeTab === 'calculate' ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                background: activeTab === 'calculate' ? '#170e5e' : '#f8fafc',
                color: activeTab === 'calculate' ? '#ffffff' : '#334155',
                cursor: 'pointer',
              }}
            >
              {t('contracting.material_price_escalation_modal.s2', "حساب مطالبة تعويض جديدة")}
            </button>
          </div>

          <div style={{ fontSize: 'var(--font-table-head)', color: '#475569' }}>
            {t('contracting.material_price_escalation_modal.s3', "إجمالي التعويضات المستحقة المعتمدة:")}{' '}
            <strong style={{ color: '#15803d', fontSize: '1.1rem' }}>
              {totalApprovedCompensation.toLocaleString('en-US', { minimumFractionDigits: 2 })} {t('contracting.material_price_escalation_modal.s4', "ج.م")}
            </strong>
          </div>
        </div>

        {/* محتوى التبويب: حاسبة المطالبة */}
        {activeTab === 'calculate' && (
          <form onSubmit={handleCreateClaim} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
              <Field label={t('contracting.material_price_escalation_modal.s5', "نوع الخامة الأساسية")}>
                <CustomSelect
                  value={materialType}
                  onChange={(val) => handlePresetChange((val as MaterialEscalationType) || 'rebar_steel')}
                  options={Object.entries(MATERIAL_PRESETS).map(([key, item]) => ({
                    value: key,
                    label: item.label,
                  }))}
                />
              </Field>

              <Field label={t('contracting.material_price_escalation_modal.s6', "مسمى وتوصيف الخامة")}>
                <input
                  type="text"
                  value={materialName}
                  onChange={(e) => setMaterialName(e.target.value)}
                  style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
              </Field>

              <Field label={`السعر الأساسي في تاريخ العقد (ج.م / ${unit})`}>
                <input
                  type="number"
                  step="0.01"
                  value={basePriceContract}
                  onChange={(e) => setBasePriceContract(Number(e.target.value))}
                  style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
              </Field>

              <Field label={`السعر الحالي بنشرة الأسعار الرسمية (ج.م / ${unit})`}>
                <input
                  type="number"
                  step="0.01"
                  value={currentMarketPrice}
                  onChange={(e) => setCurrentMarketPrice(Number(e.target.value))}
                  style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
              </Field>

              <Field label={`الكمية المنفذة في الفترة المطالب بها (${unit})`}>
                <input
                  type="number"
                  step="0.001"
                  value={executedQuantity}
                  onChange={(e) => setExecutedQuantity(Number(e.target.value))}
                  style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
              </Field>

              <Field label={t('contracting.material_price_escalation_modal.s7', "وحدة القياس")}>
                <input
                  type="text"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
              </Field>
            </div>

            <Field label={t('contracting.material_price_escalation_modal.s8', "مرجع وسند النشرة الرسمية (Official Price Bulletin)")}>
              <input
                type="text"
                value={bulletinSourceReference}
                onChange={(e) => setBulletinSourceReference(e.target.value)}
                placeholder={t('contracting.material_price_escalation_modal.s9', "مثال: نشرة الجهاز المركزي للتعبئة والإحصاء / نشرة وزارة الإسكان والمجتمعات العمرانية رقم 24")}
                style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </Field>

            {/* بطاقة الحساب الفوري والناتج المالي للمطالبة */}
            <div
              style={{
                background: '#f0fdf4',
                border: '1.5px solid #bbf7d0',
                borderRadius: '10px',
                padding: '16px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '12px',
                textAlign: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: 'var(--font-micro)', fontWeight: 600, color: '#166534' }}>{t('contracting.material_price_escalation_modal.s10', "فرق السعر للوحدة الواحدة (ΔP)")}</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#15803d', marginTop: '4px' }}>
                  {calculatedDifference.toLocaleString('en-US', { minimumFractionDigits: 2 })} {t('contracting.material_price_escalation_modal.s11', "ج.م")}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-micro)', fontWeight: 600, color: '#166534' }}>{t('contracting.material_price_escalation_modal.s12', "إجمالي الكمية المنفذة المطالب بها")}</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#15803d', marginTop: '4px' }}>
                  {executedQuantity} {unit}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-micro)', fontWeight: 600, color: '#166534' }}>{t('contracting.material_price_escalation_modal.s13', "إجمالي قيمة التعويض المستحق المطلوب")}</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#170e5e', marginTop: '4px' }}>
                  {calculatedTotalCompensation.toLocaleString('en-US', { minimumFractionDigits: 2 })} {t('contracting.material_price_escalation_modal.s14', "ج.م")}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setActiveTab('list')}
                style={{ height: '36px', padding: '0 16px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#475569', cursor: 'pointer', fontWeight: 600 }}
              >
                {t('contracting.material_price_escalation_modal.s15', "إلغاء")}
              </button>
              <button
                type="submit"
                disabled={isSubmitting || calculatedTotalCompensation <= 0}
                style={{ height: '36px', padding: '0 20px', borderRadius: '6px', border: 'none', background: '#170e5e', color: '#ffffff', cursor: 'pointer', fontWeight: 700 }}
              >
                {isSubmitting ? t('contracting.material_price_escalation_modal.s16', "جارٍ الحفظ...") : t('contracting.material_price_escalation_modal.s17', "تثبيت وتوثيق مطالبة فروق الأسعار")}
              </button>
            </div>
          </form>
        )}

        {/* محتوى التبويب: جدول المطالبات */}
        {activeTab === 'list' && (
          <div style={{ maxHeight: '420px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
            {loading ? (
              <div style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>{t('contracting.material_price_escalation_modal.s18', "جارٍ تحميل سجل المطالبات...")}</div>
            ) : escalations.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                <AppIcons.Receipt size={36} style={{ color: '#94a3b8', margin: '0 auto 8px' }} />
                <div style={{ fontWeight: 700, color: '#334155' }}>{t('contracting.material_price_escalation_modal.s19', "لا توجد مطالبات فروق أسعار مسجلة بعد")}</div>
                <div style={{ fontSize: 'var(--font-subtitle)', marginTop: '4px' }}>{t('contracting.material_price_escalation_modal.s20', "اضغط على \"حساب مطالبة تعويض جديدة\" لإثبات فروق أسعار الحديد والأسمنت")}</div>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: 'var(--font-body)' }}>
                <thead style={{ background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0', position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={{ padding: '10px 12px', fontWeight: 700, color: '#334155' }}>{t('contracting.material_price_escalation_modal.s21', "رقم المطالبة")}</th>
                    <th style={{ padding: '10px 12px', fontWeight: 700, color: '#334155' }}>{t('contracting.material_price_escalation_modal.s22', "الخامة")}</th>
                    <th style={{ padding: '10px 12px', fontWeight: 700, color: '#334155' }}>{t('contracting.material_price_escalation_modal.s23', "سعر العقد")}</th>
                    <th style={{ padding: '10px 12px', fontWeight: 700, color: '#334155' }}>{t('contracting.material_price_escalation_modal.s24', "السعر الحالي")}</th>
                    <th style={{ padding: '10px 12px', fontWeight: 700, color: '#334155' }}>{t('contracting.material_price_escalation_modal.s25', "الكمية")}</th>
                    <th style={{ padding: '10px 12px', fontWeight: 700, color: '#334155' }}>{t('contracting.material_price_escalation_modal.s26', "مبلغ التعويض")}</th>
                    <th style={{ padding: '10px 12px', fontWeight: 700, color: '#334155' }}>{t('contracting.material_price_escalation_modal.s27', "الحالة")}</th>
                    <th style={{ padding: '10px 12px', fontWeight: 700, color: '#334155', textAlign: 'center' }}>{t('contracting.material_price_escalation_modal.s28', "الإجراءات")}</th>
                  </tr>
                </thead>
                <tbody>
                  {escalations.map((esc) => {
                    const statusCfg = ESCALATION_STATUS_CONFIG[esc.status] || ESCALATION_STATUS_CONFIG.draft;
                    return (
                      <tr key={esc.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 700, color: '#170e5e' }}>{esc.claimNumber}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 600, color: '#0f172a' }}>{esc.materialName}</td>
                        <td style={{ padding: '10px 12px', color: '#64748b' }}>{esc.basePriceContract.toLocaleString('en-US')} {t('contracting.material_price_escalation_modal.s29', "ج.م")}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 700, color: '#b91c1c' }}>{esc.currentMarketPrice.toLocaleString('en-US')} {t('contracting.material_price_escalation_modal.s30', "ج.م")}</td>
                        <td style={{ padding: '10px 12px' }}>{esc.executedQuantity} {esc.unit}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 800, color: '#15803d' }}>
                          {esc.totalCompensationAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })} {t('contracting.material_price_escalation_modal.s31', "ج.م")}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              fontSize: 'var(--font-micro)',
                              fontWeight: 700,
                              background: statusCfg.bg,
                              color: statusCfg.color,
                              border: `1px solid ${statusCfg.border}`,
                            }}
                          >
                            {statusCfg.label}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => {
                              setUpdatingEscalation(esc);
                              setSelectedStatus(esc.status);
                              setSelectedIpcId(esc.ipcInvoiceId || '');
                            }}
                            style={{
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: 'var(--font-micro)',
                              fontWeight: 700,
                              background: '#ffffff',
                              border: '1px solid #cbd5e1',
                              color: '#170e5e',
                              cursor: 'pointer',
                            }}
                          >
                            {t('contracting.material_price_escalation_modal.s32', "تعديل الحالة")}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* نافذة تعديل الحالة والربط بالمستخلص */}
        {updatingEscalation && (
          <div style={{ background: '#f8fafc', border: '1.5px solid #cbd5e1', borderRadius: '10px', padding: '16px' }}>
            <h4 style={{ margin: '0 0 10px', fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#170e5e' }}>
              {t('contracting.material_price_escalation_modal.s33', "تعديل حالة المطالبة والربط بالمستخلص: [")}{updatingEscalation.claimNumber}] {updatingEscalation.materialName}
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '10px' }}>
              <Field label={t('contracting.material_price_escalation_modal.s34', "الحالة الجديدة للمطالبة")}>
                <CustomSelect
                  value={selectedStatus}
                  onChange={(val) => setSelectedStatus((val as MaterialEscalationStatus) || 'approved_by_consultant')}
                  options={[
                    { value: 'draft', label: t('contracting.material_price_escalation_modal.s35', "مسودة قيد الإعداد") },
                    { value: 'submitted_to_client', label: t('contracting.material_price_escalation_modal.s36', "مرفوعة لجهة الإسناد / المالك") },
                    { value: 'approved_by_consultant', label: t('contracting.material_price_escalation_modal.s37', "معتمدة رسمياً من الاستشاري") },
                    { value: 'settled_in_ipc', label: t('contracting.material_price_escalation_modal.s38', "مسواة ومدرجة بالمستخلص الجاري") },
                    { value: 'rejected', label: t('contracting.material_price_escalation_modal.s39', "مرفوضة / غير مطابقة") },
                  ]}
                />
              </Field>

              <Field label={t('contracting.material_price_escalation_modal.s40', "ربط بمستخلص المالك الجاري (IPC Invoice)")}>
                <CustomSelect
                  value={selectedIpcId}
                  onChange={(val) => setSelectedIpcId(val || '')}
                  options={[
                    { value: '', label: t('contracting.material_price_escalation_modal.s41', "— اختياري: غير مربوط بمستخلص محدد —") },
                    ...invoices.map((inv) => ({
                      value: inv.id,
                      label: `[${inv.ipcNumber || (inv as any).invoiceNumber || ''}] المستخلص رقم ${inv.ipcNumber || (inv as any).invoiceNumber || ''} (${Number(inv.netPayable || (inv as any).netPayableAmount || 0).toLocaleString('en-US')} ج.م)`,
                    })),
                  ]}
                />
              </Field>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setUpdatingEscalation(null)}
                style={{ height: '32px', padding: '0 14px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#475569', cursor: 'pointer', fontWeight: 600 }}
              >
                {t('contracting.material_price_escalation_modal.s42', "إلغاء")}
              </button>
              <button
                type="button"
                onClick={handleUpdateStatus}
                disabled={isSubmitting}
                style={{ height: '32px', padding: '0 18px', borderRadius: '6px', border: 'none', background: '#15803d', color: '#ffffff', cursor: 'pointer', fontWeight: 700 }}
              >
                {isSubmitting ? t('contracting.material_price_escalation_modal.s43', "جارٍ الحفظ...") : t('contracting.material_price_escalation_modal.s44', "حفظ التحديث")}
              </button>
            </div>
          </div>
        )}
      </div>
    </StandardDialog>
  );
}
