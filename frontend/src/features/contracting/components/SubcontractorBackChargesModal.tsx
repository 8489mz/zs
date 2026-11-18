import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { CustomSelect } from '@/shared/ui/custom-select';
import { Field } from '@/shared/ui/field';
import { contractingApi } from '../api/contracting.api';
import type {
  ContractingSubcontractorBackcharge,
  BackchargeCategory,
  BackchargeStatus,
  ContractingSubcontract,
} from '../contracting.types';
import { toast } from '@/shared/components/system-alert';
import { todayLocalDateKey } from '@/lib/format';

interface SubcontractorBackChargesModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName?: string;
}

const CATEGORY_CONFIG: Record<BackchargeCategory, { label: string; hint: string }> = {
  damage_rework: { label: 'إتلاف أعمال وإعادة تنفيذ (Damage & Rework)', hint: 'تلفيات أحدثها المقاول في أعمال مقاولين آخرين أو بنود سابقة' },
  safety_fine: { label: 'غرامات ومخالفات السلامة (Safety & HSE Violations)', hint: 'عدم ارتداء مهمات الوقاية أو ارتكاب مخالفات أمن صناعي' },
  equipment_usage: { label: 'استخدام معدات ورافعات المقاول العام (Equipment Usage)', hint: 'استهلاك الرافعات البرجية، اللوادر، أو مولدات الكهرباء' },
  material_supplied: { label: 'توريد خامات نيابة عن المقاول (Material Supplied)', hint: 'صرف أسمنت أو حديد أو مستلزمات من مخزن المقاول العام' },
  site_cleanup: { label: 'نظافة الموقع ورفع المخلفات (Site Housekeeping)', hint: 'تكاليف نظافة موقع العمل لتقاعس المقاول عن تنظيف منطقته' },
  other: { label: 'خصومات وبنود جزائية أخرى (Other Deductions)', hint: 'أي استقطاعات تعاقدية أو شروط جزائية أخرى' },
};

const STATUS_CONFIG: Record<BackchargeStatus, { bg: string; color: string; border: string; label: string }> = {
  pending_approval: { bg: '#eff6ff', color: '#1e40af', border: '#bfdbfe', label: 'قيد الاعتماد والمراجعة' },
  applied_to_deduction: { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0', label: 'تم الخصم من المستخلص' },
  waived: { bg: '#f1f5f9', color: '#64748b', border: '#cbd5e1', label: 'تم الإعفاء / ملغاة' },
};

export function SubcontractorBackChargesModal({ open, onClose, projectId, projectName }: SubcontractorBackChargesModalProps) {
  const { t } = useTranslation();
  const [backcharges, setBackcharges] = useState<ContractingSubcontractorBackcharge[]>([]);
  const [subcontracts, setSubcontracts] = useState<ContractingSubcontract[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'list' | 'create'>('list');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Form State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [subcontractId, setSubcontractId] = useState('');
  const [beneficiarySubcontractId, setBeneficiarySubcontractId] = useState('');
  const [backchargeCategory, setBackchargeCategory] = useState<BackchargeCategory>('damage_rework');
  const [amount, setAmount] = useState<number | ''>('');
  const [occurrenceDate, setOccurrenceDate] = useState(todayLocalDateKey());
  const [description, setDescription] = useState('');

  // Status Action State
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [bcData, scData] = await Promise.all([
        contractingApi.getSubcontractorBackcharges(projectId),
        contractingApi.getSubcontracts(projectId).catch(() => []),
      ]);
      setBackcharges(bcData || []);
      setSubcontracts(scData || []);
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تحميل سجل خصومات مقاولي الباطن');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [open, loadData]);

  const handleCreateBackcharge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subcontractId) {
      toast.error('يرجى اختيار مقاول الباطن المستحق عليه الخصم');
      return;
    }
    if (!amount || Number(amount) <= 0) {
      toast.error('يرجى إدخال مبلغ الخصم بشكل صحيح');
      return;
    }
    if (!description.trim()) {
      toast.error('يرجى إدخال بيان وسبب الخصم');
      return;
    }

    try {
      setIsSubmitting(true);
      await contractingApi.createSubcontractorBackcharge(projectId, {
        subcontractId,
        beneficiarySubcontractId: beneficiarySubcontractId || undefined,
        backchargeCategory,
        amount: Number(amount),
        occurrenceDate,
        description: description.trim(),
      });
      toast.success('تم تسجيل إشعار الخصم بنجاح وجاري إدراجه في استقطاعات المستخلصات');
      setSubcontractId('');
      setBeneficiarySubcontractId('');
      setAmount('');
      setDescription('');
      setActiveTab('list');
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تسجيل إشعار الخصم');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: BackchargeStatus) => {
    try {
      setUpdatingId(id);
      await contractingApi.updateBackchargeStatus(id, { status: newStatus });
      toast.success('تم تحديث حالة إشعار الخصم بنجاح');
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تحديث حالة الخصم');
    } finally {
      setUpdatingId(null);
    }
  };

  const formatCurrency = (val: number = 0) =>
    Number(val || 0).toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ج.م';

  const totalAmount = backcharges.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
  const deductedAmount = backcharges
    .filter((c) => c.status === 'applied_to_deduction')
    .reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
  const pendingAmount = backcharges
    .filter((c) => c.status === 'pending_approval')
    .reduce((acc, c) => acc + (Number(c.amount) || 0), 0);

  const filteredList = backcharges.filter((item) => {
    if (categoryFilter === 'all') return true;
    return item.backchargeCategory === categoryFilter;
  });

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('contracting.subcontractor_back_charges_modal.s0', "سجل خصومات واستقطاعات مقاولي الباطن (Subcontractor Back-Charges)")}
      subtitle={`إدارة المطالبات العكسية وتلفيات الأعمال وخصومات الوقود والمعدات للمشروع: ${projectName || t('contracting.subcontractor_back_charges_modal.s1', "المشروع المحدد")}`}
      width="1180px"
      compact
      minHeight="min(580px, 86vh)"
    >
      {/* Top Tab Bar & Quick Stats */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setActiveTab('list')}
            style={{
              padding: '7px 14px',
              borderRadius: '8px',
              border: activeTab === 'list' ? '1px solid #170e5e' : '1px solid #e2e8f0',
              background: activeTab === 'list' ? '#170e5e' : '#ffffff',
              color: activeTab === 'list' ? '#ffffff' : '#475569',
              fontWeight: 700,
              fontSize: '12.5px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AppIcons.Layers size={14} />
            {t('contracting.subcontractor_back_charges_modal.s2', "سجل الخصومات (")}{backcharges.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('create')}
            style={{
              padding: '7px 14px',
              borderRadius: '8px',
              border: activeTab === 'create' ? '1px solid #170e5e' : '1px solid #e2e8f0',
              background: activeTab === 'create' ? '#170e5e' : '#ffffff',
              color: activeTab === 'create' ? '#ffffff' : '#475569',
              fontWeight: 700,
              fontSize: '12.5px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AppIcons.PlusCircle size={14} />
            {t('contracting.subcontractor_back_charges_modal.s3', "تسجيل إشعار خصم جديد")}
          </button>
        </div>

        {/* Mini KPI summary */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '4px 10px', borderRadius: '8px', fontSize: '11.5px' }}>
            {t('contracting.subcontractor_back_charges_modal.s4', "إجمالي الخصومات:")} <strong style={{ color: '#0f172a' }}>{formatCurrency(totalAmount)}</strong>
          </div>
          <div style={{ background: '#dcfce7', border: '1px solid #bbf7d0', padding: '4px 10px', borderRadius: '8px', fontSize: '11.5px', color: '#15803d' }}>
            {t('contracting.subcontractor_back_charges_modal.s5', "تم الخصم بالمستخلص:")} <strong>{formatCurrency(deductedAmount)}</strong>
          </div>
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', padding: '4px 10px', borderRadius: '8px', fontSize: '11.5px', color: '#1e40af' }}>
            {t('contracting.subcontractor_back_charges_modal.s6', "قيد المراجعة:")} <strong>{formatCurrency(pendingAmount)}</strong>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '12px' }}>
          <div className="spinner" style={{ width: '32px', height: '32px', border: '3px solid #e2e8f0', borderTopColor: '#170e5e', borderRadius: '50%' }} />
          <div style={{ color: '#64748b', fontSize: '13px' }}>{t('contracting.subcontractor_back_charges_modal.s7', "جاري تحميل سجلات الخصومات...")}</div>
        </div>
      ) : activeTab === 'create' ? (
        /* Create Form */
        <form onSubmit={handleCreateBackcharge} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 16px', fontSize: '12.5px', color: '#475569' }}>
            {t('contracting.subcontractor_back_charges_modal.s8', "يتم تسجيل هذا الإشعار وتوجيهه تلقائياً إلى مستخلص مقاول الباطن القادم ليتم استقطاعه تعاقدياً مع إمكانية إسناد التعويض لمقاول متضرر آخر أو المقاول العام.")}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <Field label={t('contracting.subcontractor_back_charges_modal.s9', "مقاول الباطن (المستحق عليه الخصم) *")}>
              <CustomSelect
                value={subcontractId}
                onChange={(val) => setSubcontractId(String(val))}
                options={subcontracts.map((s) => ({
                  value: s.id,
                  label: `${s.contractNumber} - ${s.subcontractorName || t('contracting.subcontractor_back_charges_modal.s10', "مقاول باطن")} (${s.scopeOfWork || t('contracting.subcontractor_back_charges_modal.s11', "أعمال")})`,
                }))}
                placeholder={t('contracting.subcontractor_back_charges_modal.s12', "-- اختر عقد مقاول الباطن --")}
              />
            </Field>

            <Field label={t('contracting.subcontractor_back_charges_modal.s13', "نوع وسبب الاستقطاع / الخصم *")}>
              <CustomSelect
                value={backchargeCategory}
                onChange={(val) => setBackchargeCategory(val as BackchargeCategory)}
                options={Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => ({
                  value: key,
                  label: cfg.label,
                }))}
              />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
            <Field label={t('contracting.subcontractor_back_charges_modal.s14', "قيمة مبلغ الخصم (ج.م) *")}>
              <input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : '')}
                placeholder="0.00"
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px' }}
                required
              />
            </Field>

            <Field label={t('contracting.subcontractor_back_charges_modal.s15', "تاريخ وقوع الحادثة / الخصم *")}>
              <input
                type="date"
                value={occurrenceDate}
                onChange={(e) => setOccurrenceDate(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px' }}
                required
              />
            </Field>

            <Field label={t('contracting.subcontractor_back_charges_modal.s16', "الطرف المستفيد من التعويض (اختياري)")}>
              <CustomSelect
                value={beneficiarySubcontractId}
                onChange={(val) => setBeneficiarySubcontractId(String(val))}
                options={[
                  { value: '', label: t('contracting.subcontractor_back_charges_modal.s17', "المقاول العام مباشرة (General Contractor)") },
                  ...subcontracts
                    .filter((s) => s.id !== subcontractId)
                    .map((s) => ({
                      value: s.id,
                      label: `تعويض لـ: ${s.subcontractorName} (${s.contractNumber})`,
                    })),
                ]}
              />
            </Field>
          </div>

          <Field label={t('contracting.subcontractor_back_charges_modal.s18', "بيان وتفاصيل أسباب الخصم والمستندات المؤيدة *")}>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('contracting.subcontractor_back_charges_modal.s19', "اكتب وصفاً وافياً لواقعة التلفيات أو المخالفة، رقم محضر الموقع، المعدات المستخدمة وساعات التشغيل...")}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', resize: 'vertical' }}
              required
            />
          </Field>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
            <button
              type="button"
              onClick={() => setActiveTab('list')}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#475569',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              {t('contracting.subcontractor_back_charges_modal.s20', "إلغاء")}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                padding: '8px 20px',
                borderRadius: '8px',
                border: 'none',
                background: '#170e5e',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {isSubmitting ? t('contracting.subcontractor_back_charges_modal.s21', "جاري الحفظ...") : t('contracting.subcontractor_back_charges_modal.s22', "حفظ إشعار الخصم")}
            </button>
          </div>
        </form>
      ) : (
        /* List View */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Filter Bar */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>{t('contracting.subcontractor_back_charges_modal.s23', "تصنيف الخصم:")}</span>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12px', background: '#fff' }}
            >
              <option value="all">{t('contracting.subcontractor_back_charges_modal.s24', "كل التصنيفات (")}{backcharges.length})</option>
              {Object.entries(CATEGORY_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          {filteredList.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: '10px' }}>
              {t('contracting.subcontractor_back_charges_modal.s25', "لا توجد استقطاعات أو خصومات مسجلة لمقاولي الباطن بهذا التصنيف.")}
            </div>
          ) : (
            <div style={{ overflowX: 'auto', maxHeight: '340px', border: '1px solid #e2e8f0', borderRadius: '10px' }} className="thin-scrollbar">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', textAlign: 'right' }}>
                <thead style={{ background: '#f8fafc', position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>{t('contracting.subcontractor_back_charges_modal.s26', "رقم الإشعار")}</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>{t('contracting.subcontractor_back_charges_modal.s27', "مقاول الباطن")}</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>{t('contracting.subcontractor_back_charges_modal.s28', "نوع الخصم")}</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>{t('contracting.subcontractor_back_charges_modal.s29', "البيان والتفاصيل")}</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>{t('contracting.subcontractor_back_charges_modal.s30', "التاريخ")}</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>{t('contracting.subcontractor_back_charges_modal.s31', "المبلغ")}</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>{t('contracting.subcontractor_back_charges_modal.s32', "الحالة")}</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'center' }}>{t('contracting.subcontractor_back_charges_modal.s33', "الإجراءات")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredList.map((item) => {
                    const statusCfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending_approval;
                    const catCfg = CATEGORY_CONFIG[item.backchargeCategory];
                    return (
                      <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 700, color: '#170e5e' }}>{item.voucherNumber}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{item.subcontractorName || t('contracting.subcontractor_back_charges_modal.s34', "مقاول باطن")}</td>
                        <td style={{ padding: '10px 12px', color: '#334155' }}>{catCfg?.label.split('(')[0] || item.backchargeCategory}</td>
                        <td style={{ padding: '10px 12px', maxWidth: '240px', color: '#475569' }}>{item.description}</td>
                        <td style={{ padding: '10px 12px', color: '#64748b' }}>{item.occurrenceDate}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 800, color: '#b91c1c' }}>{formatCurrency(item.amount)}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span
                            style={{
                              background: statusCfg.bg,
                              color: statusCfg.color,
                              border: `1px solid ${statusCfg.border}`,
                              padding: '3px 8px',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {statusCfg.label}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          {item.status === 'pending_approval' && (
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                              <button
                                type="button"
                                disabled={updatingId === item.id}
                                onClick={() => handleStatusChange(item.id, 'applied_to_deduction')}
                                style={{
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  background: '#dcfce7',
                                  border: '1px solid #bbf7d0',
                                  color: '#15803d',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                }}
                              >
                                {t('contracting.subcontractor_back_charges_modal.s35', "اعتماد الخصم")}
                              </button>
                              <button
                                type="button"
                                disabled={updatingId === item.id}
                                onClick={() => handleStatusChange(item.id, 'waived')}
                                style={{
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  background: '#f1f5f9',
                                  border: '1px solid #cbd5e1',
                                  color: '#64748b',
                                  fontSize: '11px',
                                  cursor: 'pointer',
                                }}
                              >
                                {t('contracting.subcontractor_back_charges_modal.s36', "إعفاء")}
                              </button>
                            </div>
                          )}
                          {item.status === 'applied_to_deduction' && (
                            <span style={{ fontSize: '11px', color: '#15803d', fontWeight: 600 }}>{t('contracting.subcontractor_back_charges_modal.s37', "مدرج بالمستخلص")}</span>
                          )}
                          {item.status === 'waived' && <span style={{ fontSize: '11px', color: '#94a3b8' }}>{t('contracting.subcontractor_back_charges_modal.s38', "ملغاة")}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </StandardDialog>
  );
}
