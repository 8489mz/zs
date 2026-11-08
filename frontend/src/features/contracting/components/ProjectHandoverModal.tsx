import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { CustomSelect } from '@/shared/ui/custom-select';
import { Field } from '@/shared/ui/field';
import { contractingApi } from '../api/contracting.api';
import {
  ContractingProjectHandover,
  HandoverType,
  ContractingProject,
} from '../contracting.types';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';

interface ProjectHandoverModalProps {
  open: boolean;
  onClose: () => void;
  project: ContractingProject;
  onRefreshProject?: () => void;
}

export function ProjectHandoverModal({
  open,
  onClose,
  project,
  onRefreshProject,
}: ProjectHandoverModalProps) {
  const { t: __t } = useTranslation();
  const { currencySymbol, currencyCode } = useSystemCurrency();
  const [handovers, setHandovers] = useState<ContractingProjectHandover[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'protocols' | 'create'>('protocols');

  // Form State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [handoverType, setHandoverType] = useState<HandoverType>('preliminary');
  const [handoverNumber, setHandoverNumber] = useState('');
  const [handoverDate, setHandoverDate] = useState(new Date().toISOString().split('T')[0]);
  const [consultantRep, setConsultantRep] = useState('');
  const [clientRep, setClientRep] = useState(project.clientName || '');
  const [contractorRep, setContractorRep] = useState(project.projectManager || '');
  const [outstandingSnagCount, setOutstandingSnagCount] = useState('0');
  const [warrantyDurationMonths, setWarrantyDurationMonths] = useState('12');
  const [retentionReleasePercent, setRetentionReleasePercent] = useState('50');
  const [committeeReport, setCommitteeReport] = useState('');
  const [notes, setNotes] = useState('');

  // Approval state
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const loadHandovers = useCallback(async () => {
    if (!project?.id) return;
    setLoading(true);
    try {
      const list = await contractingApi.getProjectHandovers(project.id);
      setHandovers(list || []);
      // Suggest handover number
      const nextNum = `HO-${(list?.length || 0) + 1}`;
      setHandoverNumber(nextNum);
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تحميل محاضر استلام المشروع');
    } finally {
      setLoading(false);
    }
  }, [project?.id]);

  useEffect(() => {
    if (open) {
      loadHandovers();
    }
  }, [open, loadHandovers]);

  // Calculate release amount — INV-FE3-FRONTEND-BOOK-DIGITS: the release
  // is money posted on the handover; the old Math.round rounded it to
  // whole units (a 1,000.500 release posted as 1,001). It now rounds at
  // the tenant's book digits.
  const totalHeld = Number(project.retentionTotalHeld || 0);
  const calculatedReleaseAmount = roundMoneyValue((totalHeld * (Number(retentionReleasePercent) || 0)) / 100, currencyMoneyDigits(currencyCode));

  const handleCreateHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handoverNumber.trim()) {
      toast.error('يرجى تحديد رقم أو كود محضر الاستلام');
      return;
    }

    // Compute warranty dates
    const startDate = handoverDate;
    const endDateObj = new Date(handoverDate);
    endDateObj.setMonth(endDateObj.getMonth() + (parseInt(warrantyDurationMonths) || 12));
    const endDate = endDateObj.toISOString().split('T')[0];

    setIsSubmitting(true);
    try {
      await contractingApi.createProjectHandover(project.id, {
        handoverType,
        handoverNumber: handoverNumber.trim(),
        handoverDate,
        consultantRepresentative: consultantRep.trim() || undefined,
        clientRepresentative: clientRep.trim() || undefined,
        contractorRepresentative: contractorRep.trim() || undefined,
        committeeReport: committeeReport.trim() || undefined,
        outstandingSnagCount: parseInt(outstandingSnagCount) || 0,
        warrantyStartDate: startDate,
        warrantyEndDate: endDate,
        retentionReleasePercent: Number(retentionReleasePercent) || 0,
        retentionReleaseAmount: calculatedReleaseAmount,
        notes: notes.trim() || undefined,
      } as any);

      toast.success('تم تسجيل محضر الاستلام بنجاح');
      setActiveTab('protocols');
      await loadHandovers();
      onRefreshProject?.();
    } catch (err: any) {
      toast.error(err?.message || 'فشل تسجيل محضر الاستلام');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = async (id: string, hType: HandoverType) => {
    const isPrelim = hType === 'preliminary';
    const confirmed = await systemConfirm({
      title: isPrelim ? 'اعتماد محضر الاستلام الابتدائي' : 'اعتماد محضر الاستلام النهائي',
      message: isPrelim
        ? 'باعتماد الاستلام الابتدائي تبدأ فترة الضمان العشري/التشغيلي ويتم التصريح بالإفراج عن الشريحة الأولى لضمان حسن التنفيذ. هل تود المتابعة؟'
        : 'باعتماد الاستلام النهائي يتم إنهاء المشروع رسمياً وإبراء ذمة المقاول والإفراج عن كامل الضمانات المحتجزة. هل تود المتابعة؟',
      confirmText: 'نعم، اعتمد المحضر رسمياً',
      variant: 'primary',
    });
    if (!confirmed) return;

    setApprovingId(id);
    try {
      await contractingApi.approveProjectHandover(id, {
        approvedBy: project.projectManager || 'مدير المشاريع',
        notes: 'تمت المصادقة واعتماد المحضر بحضور لجنة الاستلام الفنية',
      });
      toast.success('تم اعتماد وتفعيل محضر الاستلام رسمياً');
      await loadHandovers();
      onRefreshProject?.();
    } catch (err: any) {
      toast.error(err?.message || 'فشل اعتماد المحضر');
    } finally {
      setApprovingId(null);
    }
  };

  const prelimHandover = handovers.find((h) => h.handoverType === 'preliminary' && h.status === 'approved');
  const finalHandover = handovers.find((h) => h.handoverType === 'final' && h.status === 'approved');

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={`محاضر الاستلام الابتدائي والنهائي وضمان الأعمال - ${project.name}`}
      subtitle={__t('contracting.project_handover_modal.s0', "بروتوكول لجان التسليم، بدء فترة الضمان والصيانة، والإفراج المالي عن مبالغ حسن التنفيذ (Retentions)")}
      width="min(1060px, 96vw)"
      minHeight="min(560px, 85vh)"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} dir="rtl">
        {/* بطاقات الموقف التشغيلي للتسليم */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
            <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{__t('contracting.project_handover_modal.s1', "الاستلام الابتدائي")}</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: prelimHandover ? '#15803d' : '#a16207', marginTop: '2px' }}>
              {prelimHandover ? `معتمد (${prelimHandover.handoverDate})` : __t('contracting.project_handover_modal.s2', "قيد الإجراء / لم يسلّم")}
            </div>
          </div>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
            <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{__t('contracting.project_handover_modal.s3', "فترة الضمان والصيانة")}</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#170e5e', marginTop: '2px' }}>
              {prelimHandover ? `${prelimHandover.warrantyStartDate} ~ ${prelimHandover.warrantyEndDate}` : __t('contracting.project_handover_modal.s4', "تبدأ فور الاستلام الابتدائي")}
            </div>
          </div>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
            <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{__t('contracting.project_handover_modal.s5', "إجمالي الضمان المحتجز بالمشروع")}</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
              {totalHeld.toLocaleString('ar-EG')} <span style={{ fontSize: '0.72rem' }}>{currencySymbol}</span>
            </div>
          </div>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
            <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{__t('contracting.project_handover_modal.s6', "الاستلام النهائي والإبراء التام")}</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: finalHandover ? '#15803d' : '#64748b', marginTop: '2px' }}>
              {finalHandover ? `معتمد (${finalHandover.handoverDate})` : __t('contracting.project_handover_modal.s7', "بانتهاء فترة الضمان")}
            </div>
          </div>
        </div>

        {/* شريط التبديل */}
        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
          <button
            type="button"
            onClick={() => setActiveTab('protocols')}
            style={{
              padding: '6px 16px',
              borderRadius: '6px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.8125rem',
              background: activeTab === 'protocols' ? '#170e5e' : '#f1f5f9',
              color: activeTab === 'protocols' ? '#ffffff' : '#475569',
              transition: 'all 0.15s ease',
            }}
          >
            {__t('contracting.project_handover_modal.s8', "سجل محاضر الاستلام (")}{handovers.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('create')}
            style={{
              padding: '6px 16px',
              borderRadius: '6px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.8125rem',
              background: activeTab === 'create' ? '#170e5e' : '#f1f5f9',
              color: activeTab === 'create' ? '#ffffff' : '#475569',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
            }}
          >
            <AppIcons.Plus size={14} />
            <span>{__t('contracting.project_handover_modal.s9', "تحرير محضر استلام جديد (ابتدائي / نهائي)")}</span>
          </button>
        </div>

        {/* تبويب التحرير */}
        {activeTab === 'create' ? (
          <form onSubmit={handleCreateHandover} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
              <Field label={__t('contracting.project_handover_modal.s10', "نوع محضر الاستلام *")}>
                <CustomSelect
                  value={handoverType}
                  onChange={(val) => {
                    const t = val as HandoverType;
                    setHandoverType(t);
                    setRetentionReleasePercent(t === 'preliminary' ? '50' : '100');
                  }}
                  options={[
                    { value: 'preliminary', label: __t('contracting.project_handover_modal.s11', "استلام ابتدائي (Preliminary Handover) - بدء الضمان") },
                    { value: 'final', label: __t('contracting.project_handover_modal.s12', "استلام نهائي (Final Handover) - إبراء الذمة التام") },
                  ]}
                />
              </Field>

              <Field label={__t('contracting.project_handover_modal.s13', "رقم / كود المحضر التعاقدي *")}>
                <input
                  type="text"
                  value={handoverNumber}
                  onChange={(e) => setHandoverNumber(e.target.value)}
                  style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem' }}
                />
              </Field>

              <Field label={__t('contracting.project_handover_modal.s14', "تاريخ المعاينة وتوقيع المحضر *")}>
                <input
                  type="date"
                  value={handoverDate}
                  onChange={(e) => setHandoverDate(e.target.value)}
                  style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem' }}
                />
              </Field>

              <Field label={__t('contracting.project_handover_modal.s15', "ممثل الاستشاري المشرف (رئيس اللجنة)")}>
                <input
                  type="text"
                  placeholder={__t('contracting.project_handover_modal.s16', "اسم المهندس الاستشاري ممثل جهة الإشراف...")}
                  value={consultantRep}
                  onChange={(e) => setConsultantRep(e.target.value)}
                  style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem' }}
                />
              </Field>

              <Field label={__t('contracting.project_handover_modal.s17', "ممثل المالك / العميل")}>
                <input
                  type="text"
                  value={clientRep}
                  onChange={(e) => setClientRep(e.target.value)}
                  style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem' }}
                />
              </Field>

              <Field label={__t('contracting.project_handover_modal.s18', "ممثل المقاول (مهندس المشروع)")}>
                <input
                  type="text"
                  value={contractorRep}
                  onChange={(e) => setContractorRep(e.target.value)}
                  style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem' }}
                />
              </Field>

              <Field label={__t('contracting.project_handover_modal.s19', "عدد الملاحظات المتبقية (Punch List)")}>
                <input
                  type="number"
                  min="0"
                  value={outstandingSnagCount}
                  onChange={(e) => setOutstandingSnagCount(e.target.value)}
                  style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem' }}
                />
              </Field>

              <Field label={__t('contracting.project_handover_modal.s20', "مدة الضمان والصيانة (بالأشهر)")}>
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={warrantyDurationMonths}
                  onChange={(e) => setWarrantyDurationMonths(e.target.value)}
                  style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem' }}
                />
              </Field>

              <Field label={__t('contracting.project_handover_modal.s21', "نسبة الإفراج عن ضمان الأعمال المحتجز %")}>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={retentionReleasePercent}
                  onChange={(e) => setRetentionReleasePercent(e.target.value)}
                  style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem', fontWeight: 700 }}
                />
              </Field>

              <div style={{ gridColumn: 'span 3', background: '#f0fdf4', padding: '10px 14px', borderRadius: '6px', border: '1px solid #bbf7d0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8125rem', color: '#166534', fontWeight: 600 }}>
                  {__t('contracting.project_handover_modal.s22', "المبلغ المالي المصرح بالإفراج عنه وصرفه من حساب الضمان:")}
                </span>
                <strong style={{ fontSize: '1.05rem', color: '#15803d', fontWeight: 800 }}>
                  {calculatedReleaseAmount.toLocaleString('ar-EG')} {currencySymbol}
                </strong>
              </div>

              <div style={{ gridColumn: 'span 3' }}>
                <Field label={__t('contracting.project_handover_modal.s23', "نص تقرير لجنة الاستلام وتوصيات الإشراف")}>
                  <textarea
                    rows={3}
                    placeholder={__t('contracting.project_handover_modal.s24', "اجتمعت اللجنة وقامت بالمعاينة الميدانية وتبين اكتمال الأعمال ومطابقتها للمواصفات الفنية والرسومات التنفيذية مع التعهد بإصلاح الملاحظات المرفقة خلال 14 يوماً...")}
                    value={committeeReport}
                    onChange={(e) => setCommitteeReport(e.target.value)}
                    style={{ width: '100%', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '8px 10px', fontSize: '0.8125rem', resize: 'vertical' }}
                  />
                </Field>
              </div>

              <div style={{ gridColumn: 'span 3' }}>
                <Field label={__t('contracting.project_handover_modal.s25', "ملاحظات وشروط إضافية")}>
                  <input
                    type="text"
                    placeholder={__t('contracting.project_handover_modal.s26', "أي شروط أو ملحوظات ملحقة بمحضر الاستلام...")}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem' }}
                  />
                </Field>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setActiveTab('protocols')}
                style={{
                  height: '36px',
                  padding: '0 16px',
                  borderRadius: '8px',
                  fontWeight: 600,
                  background: '#f1f5f9',
                  color: '#475569',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {__t('contracting.project_handover_modal.s27', "إلغاء")}
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                style={{
                  height: '36px',
                  padding: '0 20px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <AppIcons.Check size={16} />
                <span>{isSubmitting ? __t('contracting.project_handover_modal.s28', "جاري الحفظ...") : __t('contracting.project_handover_modal.s29', "حفظ محضر الاستلام")}</span>
              </button>
            </div>
          </form>
        ) : (
          /* جدول المحاضر */
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', minHeight: '280px', display: 'flex', flexDirection: 'column' }}>
            {loading ? (
              <div style={{ flex: 1, minHeight: '280px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '32px' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', border: '3px solid #e2e8f0', borderTopColor: '#170e5e', animation: 'spin 0.8s linear infinite' }} />
                <span style={{ fontSize: 'var(--font-subtitle)', color: '#94a3b8', fontWeight: 600 }}>{__t('contracting.project_handover_modal.s30', "جاري تحميل محاضر الاستلام...")}</span>
              </div>
            ) : handovers.length === 0 ? (
              <div style={{ flex: 1, minHeight: '280px', padding: '40px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ color: '#94a3b8', marginBottom: '10px' }}>
                  <AppIcons.ShieldCheck size={42} />
                </div>
                <div style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {__t('contracting.project_handover_modal.s31', "لا توجد محاضر استلام مسجلة لهذا المشروع حتى الآن")}
                </div>
                <div style={{ fontSize: 'var(--font-subtitle)', color: '#64748b', maxWidth: '380px', margin: '0 auto 14px' }}>
                  {__t('contracting.project_handover_modal.s32', "عند جاهزية المشروع، يتم تحرير محضر الاستلام الابتدائي لبدء سريان الضمان والإفراج عن مستحقات الضمان المحتجزة.")}
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('create')}
                  style={{
                    height: '34px',
                    padding: '0 16px',
                    borderRadius: '6px',
                    fontWeight: 700,
                    background: '#170e5e',
                    color: '#ffffff',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '0.8125rem',
                  }}
                >
                  {__t('contracting.project_handover_modal.s33', "تحرير أول محضر استلام")}
                </button>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>{__t('contracting.project_handover_modal.s34', "رقم المحضر والنوع")}</th>
                      <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>{__t('contracting.project_handover_modal.s35', "تاريخ التسليم")}</th>
                      <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>{__t('contracting.project_handover_modal.s36', "سريان الضمان")}</th>
                      <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>{__t('contracting.project_handover_modal.s37', "الإفراج عن الضمان")}</th>
                      <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>{__t('contracting.project_handover_modal.s38', "ملاحظات عالقة")}</th>
                      <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>{__t('contracting.project_handover_modal.s39', "الحالة")}</th>
                      <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569', textAlign: 'center' }}>{__t('contracting.project_handover_modal.s40', "الإجراءات")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {handovers.map((h) => {
                      const isApproved = h.status === 'approved';
                      return (
                        <tr key={h.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', fontWeight: 700, color: '#170e5e' }}>
                            <div>{h.handoverNumber}</div>
                            <span style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>
                              {h.handoverType === 'preliminary' ? __t('contracting.project_handover_modal.s41', "استلام ابتدائي") : __t('contracting.project_handover_modal.s42', "استلام نهائي")}
                            </span>
                          </td>
                          <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', color: '#475569' }}>
                            {h.handoverDate}
                          </td>
                          <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', color: '#475569' }}>
                            {h.warrantyStartDate ? `${h.warrantyStartDate} ~ ${h.warrantyEndDate}` : '—'}
                          </td>
                          <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', fontWeight: 700, color: '#15803d' }}>
                            {Number(h.retentionReleaseAmount || 0).toLocaleString('ar-EG')} {currencySymbol} ({h.retentionReleasePercent}%)
                          </td>
                          <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', color: h.outstandingSnagCount > 0 ? '#b91c1c' : '#15803d', fontWeight: 600 }}>
                            {h.outstandingSnagCount > 0 ? `${h.outstandingSnagCount} ملاحظة معلقة` : __t('contracting.project_handover_modal.s43', "0 (مطابق تماماً)")}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                fontSize: 'var(--font-badge)',
                                fontWeight: 600,
                                background: isApproved ? '#dcfce7' : '#fef9c3',
                                color: isApproved ? '#15803d' : '#a16207',
                                border: `1px solid ${isApproved ? '#bbf7d0' : '#fde68a'}`,
                              }}
                            >
                              {isApproved ? __t('contracting.project_handover_modal.s44', "معتمد رسمياً") : __t('contracting.project_handover_modal.s45', "مسودة قيد الاعتماد")}
                            </span>
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            {!isApproved && (
                              <button
                                type="button"
                                disabled={approvingId === h.id}
                                onClick={() => handleApprove(h.id, h.handoverType)}
                                style={{
                                  height: '28px',
                                  padding: '0 12px',
                                  borderRadius: '6px',
                                  fontSize: 'var(--font-badge)',
                                  fontWeight: 600,
                                  background: '#15803d',
                                  color: '#ffffff',
                                  border: 'none',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                <AppIcons.Check size={12} />
                                <span>{approvingId === h.id ? __t('contracting.project_handover_modal.s46', "جاري الاعتماد...") : __t('contracting.project_handover_modal.s47', "اعتماد المحضر")}</span>
                              </button>
                            )}
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
      </div>
    </StandardDialog>
  );
}
