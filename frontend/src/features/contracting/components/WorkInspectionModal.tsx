import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { DialogShell } from '@/shared/components/dialog-shell';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { CustomSelect } from '@/shared/ui/custom-select';
import { Field } from '@/shared/ui/field';
import { contractingApi } from '../api/contracting.api';
import {
  ContractingInspectionRequest,
  InspectionStatus,
  ContractingBoqItem,
  ContractingSubcontract,
} from '../contracting.types';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import { todayLocalDateKey } from '@/lib/format';

interface WorkInspectionModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName?: string;
}

const TRADE_LABELS: Record<string, string> = {
  civil_concrete: 'أعمال خرسانات وهيكل مدني',
  masonry_insulation: 'أعمال مباني وعزل مائي وحراري',
  finishes: 'أعمال تشطيبات وبياض ودهانات',
  doors_windows_facades: 'ألوميتال وواجهات وأبواب',
  steel_structures: 'منشآت معدنية وحديد تسليح',
  electrical: 'أعمال التمديدات الكهربائية',
  smart_systems_elv: 'تيار خفيف وأنظمة إنذار',
  plumbing: 'أعمال الصرف والسباكة والتغذية',
  hvac: 'أعمال التكييف والتهوية',
};

const TRADE_OPTIONS = Object.entries(TRADE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const INSPECTION_TYPE_OPTIONS = [
  { value: 'work_inspection', label: 'استلام أعمال تنفيذية ومطابقة الموقع' },
  { value: 'material_inspection', label: 'معاينة واعتماد مواد وتشوينات بالموقع (MIR)' },
  { value: 'pre_pour_concrete', label: 'استلام حدادة ونجارة قبل الصب (Pre-Pour)' },
  { value: 'final_trade_inspection', label: 'استلام نهائي لبند تشغيلي' },
];

const STATUS_CONFIG: Record<InspectionStatus, { bg: string; color: string; border: string; label: string }> = {
  submitted: { bg: '#fef9c3', color: '#a16207', border: '#fde68a', label: 'قيد الفحص الاستشاري' },
  approved: { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0', label: 'معتمد ومقبول (Approved)' },
  approved_with_notes: { bg: '#e0e7ff', color: '#3730a3', border: '#c7d2fe', label: 'معتمد بملاحظات (Approved w/ Notes)' },
  rejected: { bg: '#fee2e2', color: '#b91c1c', border: '#fecaca', label: 'مرفوض - إعادة فحص (Rejected)' },
};

export function WorkInspectionModal({ open, onClose, projectId, projectName }: WorkInspectionModalProps) {
  const { t } = useTranslation();
  const [requests, setRequests] = useState<ContractingInspectionRequest[]>([]);
  const [boqItems, setBoqItems] = useState<ContractingBoqItem[]>([]);
  const [subcontracts, setSubcontracts] = useState<ContractingSubcontract[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'list' | 'create'>('list');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // New Request Form State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tradeCategory, setTradeCategory] = useState('civil_concrete');
  const [inspectionType, setInspectionType] = useState('work_inspection');
  const [locationGrid, setLocationGrid] = useState('');
  const [scheduledDate, setScheduledDate] = useState(todayLocalDateKey());
  const [selectedBoqItemId, setSelectedBoqItemId] = useState('');
  const [selectedSubcontractId, setSelectedSubcontractId] = useState('');
  const [consultantName, setConsultantName] = useState('');
  const [notes, setNotes] = useState('');

  // Decision Review State
  const [reviewingItem, setReviewingItem] = useState<ContractingInspectionRequest | null>(null);
  const [reviewStatus, setReviewStatus] = useState<InspectionStatus>('approved');
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewConsultantName, setReviewConsultantName] = useState('');
  const [isSavingDecision, setIsSavingDecision] = useState(false);

  const loadData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [reqs, boqs, subs] = await Promise.all([
        contractingApi.getInspectionRequests(projectId),
        contractingApi.getBoqItems(projectId).catch(() => []),
        contractingApi.getSubcontracts(projectId).catch(() => []),
      ]);
      setRequests(reqs || []);
      setBoqItems(boqs || []);
      setSubcontracts(subs || []);
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تحميل طلبات استلام وفحص الأعمال');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [open, loadData]);

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locationGrid.trim()) {
      toast.error('يرجى تحديد المحاور وموقع الأعمال المراد استلامها بدقة');
      return;
    }

    setIsSubmitting(true);
    try {
      await contractingApi.createInspectionRequest(projectId, {
        tradeCategory,
        inspectionType,
        locationGrid: locationGrid.trim(),
        scheduledDate,
        boqItemId: selectedBoqItemId || undefined,
        subcontractId: selectedSubcontractId || undefined,
        consultantName: consultantName.trim() || undefined,
        notes: notes.trim() || undefined,
      } as any);

      toast.success('تم تقديم طلب استلام الأعمال (WIR) للاستشاري بنجاح');
      setLocationGrid('');
      setNotes('');
      setActiveTab('list');
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'فشل تقديم طلب الاستلام');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenReview = (item: ContractingInspectionRequest) => {
    setReviewingItem(item);
    setReviewStatus((item.status as InspectionStatus) || 'approved');
    setReviewNotes(item.consultantNotes || '');
    setReviewConsultantName(item.consultantName || '');
  };

  const handleSaveDecision = async () => {
    if (!reviewingItem) return;
    setIsSavingDecision(true);
    try {
      await contractingApi.updateInspectionRequestStatus(reviewingItem.id, {
        status: reviewStatus,
        consultantNotes: reviewNotes.trim() || undefined,
        consultantName: reviewConsultantName.trim() || undefined,
        consultantDecisionDate: todayLocalDateKey(),
      });
      toast.success('تم حفظ وتوثيق قرار الاستشاري الهندسي بنجاح');
      setReviewingItem(null);
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'فشل حفظ قرار الاستشاري');
    } finally {
      setIsSavingDecision(false);
    }
  };

  const handleDelete = async (id: string, wirNum: string) => {
    const confirmed = await systemConfirm({
      title: 'حذف طلب استلام الأعمال',
      message: `هل أنت متأكد من رغبتك في حذف طلب الاستلام رقم [${wirNum}] نهائياً؟`,
      confirmText: 'نعم، احذف الطلب',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await contractingApi.deleteInspectionRequest(id);
      toast.success('تم حذف طلب الاستلام بنجاح');
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'تعذر حذف طلب الاستلام');
    }
  };

  // KPIs
  const totalCount = requests.length;
  const approvedCount = requests.filter((r) => r.status === 'approved').length;
  const approvedWithNotesCount = requests.filter((r) => r.status === 'approved_with_notes').length;
  const rejectedCount = requests.filter((r) => r.status === 'rejected').length;
  const pendingCount = requests.filter((r) => r.status === 'submitted').length;

  const filteredRequests = requests.filter((r) => {
    if (statusFilter === 'all') return true;
    return r.status === statusFilter;
  });

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={`طلبات استلام الأعمال وضبط الجودة (WIR) - ${projectName || t('contracting.work_inspection_modal.s0', "المشروع")}`}
      subtitle={t('contracting.work_inspection_modal.s1', "محاضر الاستلام الميداني للمهندس الاستشاري، فحص حدادة ونجارة الصب، والمطابقة الفنية قبل المستخلصات")}
      width="min(1080px, 96vw)"
      minHeight="min(560px, 85vh)"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} dir="rtl">
        {/* شريط المؤشرات الهندسية */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
            <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{t('contracting.work_inspection_modal.s2', "إجمالي طلبات الفحص")}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
              {loading ? '—' : totalCount}
            </div>
          </div>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
            <div style={{ fontSize: 'var(--font-micro)', color: '#a16207', fontWeight: 600 }}>{t('contracting.work_inspection_modal.s3', "قيد الفحص الميداني")}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#a16207', marginTop: '2px' }}>
              {loading ? '—' : pendingCount}
            </div>
          </div>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
            <div style={{ fontSize: 'var(--font-micro)', color: '#15803d', fontWeight: 600 }}>{t('contracting.work_inspection_modal.s4', "معتمد نهائياً ومصرح")}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#15803d', marginTop: '2px' }}>
              {loading ? '—' : approvedCount}
            </div>
          </div>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
            <div style={{ fontSize: 'var(--font-micro)', color: '#3730a3', fontWeight: 600 }}>{t('contracting.work_inspection_modal.s5', "معتمد بملاحظات")}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#3730a3', marginTop: '2px' }}>
              {loading ? '—' : approvedWithNotesCount}
            </div>
          </div>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
            <div style={{ fontSize: 'var(--font-micro)', color: '#b91c1c', fontWeight: 600 }}>{t('contracting.work_inspection_modal.s6', "مرفوض - إعادة فحص")}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#b91c1c', marginTop: '2px' }}>
              {loading ? '—' : rejectedCount}
            </div>
          </div>
        </div>

        {/* شريط التبديل بين العرض والإنشاء */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setActiveTab('list')}
              style={{
                padding: '6px 16px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '0.8125rem',
                background: activeTab === 'list' ? '#170e5e' : '#f1f5f9',
                color: activeTab === 'list' ? '#ffffff' : '#475569',
                transition: 'all 0.15s ease',
              }}
            >
              {t('contracting.work_inspection_modal.s7', "سجل طلبات الاستلام بالموقع (")}{requests.length})
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
              <span>{t('contracting.work_inspection_modal.s8', "تقديم طلب استلام جديد (WIR)")}</span>
            </button>
          </div>

          {activeTab === 'list' && (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{t('contracting.work_inspection_modal.s9', "تصفية:")}</span>
              {[
                { key: 'all', label: t('contracting.work_inspection_modal.s10', "الكل") },
                { key: 'submitted', label: t('contracting.work_inspection_modal.s11', "قيد الفحص") },
                { key: 'approved', label: t('contracting.work_inspection_modal.s12', "معتمد") },
                { key: 'approved_with_notes', label: t('contracting.work_inspection_modal.s13', "بملاحظات") },
                { key: 'rejected', label: t('contracting.work_inspection_modal.s14', "مرفوض") },
              ].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setStatusFilter(f.key)}
                  style={{
                    padding: '3px 10px',
                    borderRadius: '4px',
                    border: '1px solid',
                    borderColor: statusFilter === f.key ? '#170e5e' : '#e2e8f0',
                    background: statusFilter === f.key ? '#170e5e' : '#ffffff',
                    color: statusFilter === f.key ? '#ffffff' : '#64748b',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* تبويب الإنشاء: نموذج تقديم طلب استلام جديد */}
        {activeTab === 'create' ? (
          <form onSubmit={handleCreateRequest} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
              <Field label={t('contracting.work_inspection_modal.s15', "التخصص الهندسي *")}>
                <CustomSelect
                  value={tradeCategory}
                  onChange={setTradeCategory}
                  options={TRADE_OPTIONS}
                />
              </Field>

              <Field label={t('contracting.work_inspection_modal.s16', "نوع إجراء الاستلام *")}>
                <CustomSelect
                  value={inspectionType}
                  onChange={setInspectionType}
                  options={INSPECTION_TYPE_OPTIONS}
                />
              </Field>

              <Field label={t('contracting.work_inspection_modal.s17', "تاريخ المعاينة الميدانية المقترح *")}>
                <input
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem' }}
                />
              </Field>

              <Field label={t('contracting.work_inspection_modal.s18', "المحاور وموقع العمل التفصيلي (Grid/Location) *")}>
                <input
                  type="text"
                  placeholder={t('contracting.work_inspection_modal.s19', "مثال: سقف الدور الأول - المحاور A1 إلى D4")}
                  value={locationGrid}
                  onChange={(e) => setLocationGrid(e.target.value)}
                  style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem' }}
                />
              </Field>

              <Field label={t('contracting.work_inspection_modal.s20', "بند المقايسة المرتبط (اختياري)")}>
                <CustomSelect
                  value={selectedBoqItemId}
                  onChange={setSelectedBoqItemId}
                  placeholder={t('contracting.work_inspection_modal.s21', "اختر بند المقايسة...")}
                  options={[
                    { value: '', label: t('contracting.work_inspection_modal.s22', "بدون ارتباط ببند مقايسة") },
                    ...boqItems.map((b) => ({
                      value: b.id,
                      label: `${b.itemCode} - ${b.description.slice(0, 35)}...`,
                    })),
                  ]}
                />
              </Field>

              <Field label={t('contracting.work_inspection_modal.s23', "عقد مقاول الباطن المنفذ (اختياري)")}>
                <CustomSelect
                  value={selectedSubcontractId}
                  onChange={setSelectedSubcontractId}
                  placeholder={t('contracting.work_inspection_modal.s24', "اختر مقاول الباطن...")}
                  options={[
                    { value: '', label: t('contracting.work_inspection_modal.s25', "تنفيذ ذاتي (الشركة الرئيسية)") },
                    ...subcontracts.map((s) => ({
                      value: s.id,
                      label: `${s.contractNumber} - ${s.subcontractorName || t('contracting.work_inspection_modal.s26', "مقاول باطن")}`,
                    })),
                  ]}
                />
              </Field>

              <Field label={t('contracting.work_inspection_modal.s27', "اسم المهندس الاستشاري المشرف")}>
                <input
                  type="text"
                  placeholder={t('contracting.work_inspection_modal.s28', "مثال: م. أحمد عبد الرحمن (دار الهندسة)")}
                  value={consultantName}
                  onChange={(e) => setConsultantName(e.target.value)}
                  style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem' }}
                />
              </Field>

              <div style={{ gridColumn: 'span 2' }}>
                <Field label={t('contracting.work_inspection_modal.s29', "شروط ومعايير الفحص وملاحظات مهندس الموقع")}>
                  <input
                    type="text"
                    placeholder={t('contracting.work_inspection_modal.s30', "تم الانتهاء من تربيط أسياخ التسليح واختبار ضغط مواسير السباكة المدمجة...")}
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
                onClick={() => setActiveTab('list')}
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
                {t('contracting.work_inspection_modal.s31', "إلغاء")}
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
                <span>{isSubmitting ? t('contracting.work_inspection_modal.s32', "جاري الإرسال...") : t('contracting.work_inspection_modal.s33', "تقديم طلب الاستلام للاستشاري")}</span>
              </button>
            </div>
          </form>
        ) : (
          /* تبويب السجل: جدول طلبات الاستلام */
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', minHeight: '280px', display: 'flex', flexDirection: 'column' }}>
            {loading ? (
              <div style={{ flex: 1, minHeight: '280px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '32px' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', border: '3px solid #e2e8f0', borderTopColor: '#170e5e', animation: 'spin 0.8s linear infinite' }} />
                <span style={{ fontSize: 'var(--font-subtitle)', color: '#94a3b8', fontWeight: 600 }}>{t('contracting.work_inspection_modal.s34', "جاري تحميل طلبات الاستلام...")}</span>
              </div>
            ) : filteredRequests.length === 0 ? (
              <div style={{ flex: 1, minHeight: '280px', padding: '40px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ color: '#94a3b8', marginBottom: '10px' }}>
                  <AppIcons.FileText size={42} />
                </div>
                <div style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('contracting.work_inspection_modal.s35', "لا توجد طلبات استلام أعمال تطابق الفلتر الحالي")}
                </div>
                <div style={{ fontSize: 'var(--font-subtitle)', color: '#64748b', maxWidth: '380px', margin: '0 auto 14px' }}>
                  {t('contracting.work_inspection_modal.s36', "سجل طلبات الفحص والاستلام (WIR) يضمن توثيق موافقة الاستشاري قبل صب الخرسانات أو ترحيل المستخلصات.")}
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
                  {t('contracting.work_inspection_modal.s37', "تقديم أول طلب استلام")}
                </button>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>{t('contracting.work_inspection_modal.s38', "رقم الطلب (WIR)")}</th>
                      <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>{t('contracting.work_inspection_modal.s39', "التخصص والمحاور")}</th>
                      <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>{t('contracting.work_inspection_modal.s40', "تاريخ المعاينة")}</th>
                      <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>{t('contracting.work_inspection_modal.s41', "الاستشاري المشرف")}</th>
                      <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>{t('contracting.work_inspection_modal.s42', "الحالة")}</th>
                      <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569', textAlign: 'center' }}>{t('contracting.work_inspection_modal.s43', "الإجراءات")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((r) => {
                      const cfg = STATUS_CONFIG[r.status] || STATUS_CONFIG.submitted;
                      return (
                        <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', fontWeight: 700, color: '#170e5e', fontFamily: 'monospace' }}>
                            {r.requestNumber}
                          </td>
                          <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)' }}>
                            <div style={{ fontWeight: 700, color: '#0f172a' }}>{TRADE_LABELS[r.discipline] || r.discipline}</div>
                            <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', marginTop: '2px' }}>
                              {t('contracting.work_inspection_modal.s44', "الموقع:")} {r.locationDetails}
                            </div>
                            {r.boqItemDescription && (
                              <div style={{ fontSize: 'var(--font-micro)', color: '#2563eb' }}>
                                {t('contracting.work_inspection_modal.s45', "البند:")} {r.boqItemDescription.slice(0, 30)}...
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', color: '#475569' }}>
                            {r.inspectionDate}
                          </td>
                          <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', color: '#475569' }}>
                            <div>{r.consultantName || '—'}</div>
                            {r.consultantNotes && (
                              <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', marginTop: '2px' }}>
                                {t('contracting.work_inspection_modal.s46', "ملاحظة:")} {r.consultantNotes}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                fontSize: 'var(--font-badge)',
                                fontWeight: 600,
                                background: cfg.bg,
                                color: cfg.color,
                                border: `1px solid ${cfg.border}`,
                              }}
                            >
                              {cfg.label}
                            </span>
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                              <button
                                type="button"
                                onClick={() => handleOpenReview(r)}
                                style={{
                                  height: '28px',
                                  padding: '0 10px',
                                  borderRadius: '6px',
                                  fontSize: 'var(--font-badge)',
                                  fontWeight: 600,
                                  background: '#f8fafc',
                                  color: '#170e5e',
                                  border: '1px solid #cbd5e1',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                <AppIcons.Edit size={12} />
                                <span>{t('contracting.work_inspection_modal.s47', "قرار الاستشاري")}</span>
                              </button>
                              {r.status === 'submitted' && (
                                <button
                                  type="button"
                                  onClick={() => handleDelete(r.id, r.requestNumber)}
                                  style={{
                                    height: '28px',
                                    padding: '0 8px',
                                    borderRadius: '6px',
                                    fontSize: 'var(--font-badge)',
                                    fontWeight: 600,
                                    background: '#fee2e2',
                                    color: '#b91c1c',
                                    border: 'none',
                                    cursor: 'pointer',
                                  }}
                                >
                                  <AppIcons.Trash size={13} />
                                </button>
                              )}
                            </div>
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

        {/* نافذة اعتماد وتوثيق قرار الاستشاري */}
        {reviewingItem && (
          <DialogShell
            open={!!reviewingItem}
            onClose={() => setReviewingItem(null)}
            width="min(500px, 92vw)"
          >
            <div className="standard-dialog-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', padding: '16px 20px' }}>
              <div>
                <h3 className="standard-dialog-title" style={{ fontSize: '1rem', fontWeight: 800, color: '#170e5e', margin: 0 }}>
                  {t('contracting.work_inspection_modal.s48', "توثيق قرار الاستشاري")}
                </h3>
                <span className="standard-dialog-subtitle" style={{ fontSize: '0.8rem', color: '#64748b' }}>
                  {t('contracting.work_inspection_modal.s49', "طلب فحص رقم")} {reviewingItem.requestNumber}
                </span>
              </div>
              <button
                type="button"
                className="standard-dialog-close-btn"
                onClick={() => setReviewingItem(null)}
                aria-label={t('contracting.work_inspection_modal.s50', "إغلاق")}
              >
                <AppIcons.X size={18} />
              </button>
            </div>

            <div className="standard-dialog-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <Field label={t('contracting.work_inspection_modal.s51', "قرار المعاينة والاستلام *")}>
                <CustomSelect
                  value={reviewStatus}
                  onChange={(val) => setReviewStatus(val as InspectionStatus)}
                  options={[
                    { value: 'approved', label: t('contracting.work_inspection_modal.s52', "معتمد ومقبول (Approved) - مصرح ببدء المرحلة التالية") },
                    { value: 'approved_with_notes', label: t('contracting.work_inspection_modal.s53', "معتمد بملاحظات (Approved with Notes) - تدارك قبل المرحلة اللاحقة") },
                    { value: 'rejected', label: t('contracting.work_inspection_modal.s54', "مرفوض (Rejected) - يتطلب معالجة وإعادة تقديم فحص جديد") },
                  ]}
                />
              </Field>

              <Field label={t('contracting.work_inspection_modal.s55', "اسم الاستشاري / المهندس الموقع")}>
                <input
                  type="text"
                  value={reviewConsultantName}
                  onChange={(e) => setReviewConsultantName(e.target.value)}
                  placeholder={t('contracting.work_inspection_modal.s56', "اسم الاستشاري الممضي على المحضر...")}
                  style={{ width: '100%', height: '36px', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem', boxSizing: 'border-box' }}
                />
              </Field>

              <Field label={t('contracting.work_inspection_modal.s57', "ملاحظات وتوجيهات الاستشاري الفنية")}>
                <textarea
                  rows={3}
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder={t('contracting.work_inspection_modal.s58', "اكتب التوجيهات الفنية أو شروط الصب أو أسباب الرفض بدقة...")}
                  style={{ width: '100%', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '8px 10px', fontSize: '0.8125rem', resize: 'vertical', boxSizing: 'border-box' }}
                />
              </Field>
            </div>

            <div className="standard-dialog-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '14px 20px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <button
                type="button"
                onClick={() => setReviewingItem(null)}
                style={{
                  height: '36px',
                  padding: '0 16px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#475569',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                {t('contracting.work_inspection_modal.s59', "إلغاء")}
              </button>
              <button
                type="button"
                disabled={isSavingDecision}
                onClick={handleSaveDecision}
                style={{
                  height: '36px',
                  padding: '0 20px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#170e5e',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                {isSavingDecision ? t('contracting.work_inspection_modal.s60', "جاري الحفظ...") : t('contracting.work_inspection_modal.s61', "تثبيت القرار الهندسي")}
              </button>
            </div>
          </DialogShell>
        )}
      </div>
    </StandardDialog>
  );
}
