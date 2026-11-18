import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { DialogShell } from '@/shared/components/dialog-shell';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { CustomSelect } from '@/shared/ui/custom-select';
import { Field } from '@/shared/ui/field';
import { contractingApi } from '../api/contracting.api';
import {
  ContractingSnagItem,
  SnagSeverity,
  SnagStatus,
  ContractingSubcontract,
} from '../contracting.types';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import { todayLocalDateKey } from '@/lib/format';

interface SnagListModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName?: string;
}

const SEVERITY_CONFIG: Record<SnagSeverity, { bg: string; color: string; border: string; label: string }> = {
  low: { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1', label: 'بسيطة (Low)' },
  medium: { bg: '#fef9c3', color: '#a16207', border: '#fde68a', label: 'متوسطة (Medium)' },
  high: { bg: '#fed7aa', color: '#c2410c', border: '#fdba74', label: 'عالية الأهمية (High)' },
  critical: { bg: '#fee2e2', color: '#b91c1c', border: '#fecaca', label: 'حرجة / مانعة للتسليم (Critical)' },
};

const STATUS_CONFIG: Record<SnagStatus, { bg: string; color: string; border: string; label: string }> = {
  open: { bg: '#fee2e2', color: '#b91c1c', border: '#fecaca', label: 'مفتوحة (Open)' },
  in_progress: { bg: '#fef9c3', color: '#a16207', border: '#fde68a', label: 'قيد الإصلاح (In Progress)' },
  rectified: { bg: '#e0e7ff', color: '#3730a3', border: '#c7d2fe', label: 'تم الإصلاح - بانتظار الفحص' },
  verified_closed: { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0', label: 'مغلقة ومعتمدة (Closed)' },
};

export function SnagListModal({ open, onClose, projectId, projectName }: SnagListModalProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ContractingSnagItem[]>([]);
  const [subcontracts, setSubcontracts] = useState<ContractingSubcontract[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'list' | 'create'>('list');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');

  // Form state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [itemTitle, setItemTitle] = useState('');
  const [locationDesc, setLocationDesc] = useState('');
  const [severity, setSeverity] = useState<SnagSeverity>('medium');
  const [responsibleParty, setResponsibleParty] = useState<'main_contractor' | 'subcontractor'>('main_contractor');
  const [subcontractId, setSubcontractId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  // Rectification review modal
  const [rectifyingItem, setRectifyingItem] = useState<ContractingSnagItem | null>(null);
  const [newStatus, setNewStatus] = useState<SnagStatus>('rectified');
  const [rectificationNotes, setRectificationNotes] = useState('');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const loadData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [snags, subs] = await Promise.all([
        contractingApi.getSnagItems(projectId),
        contractingApi.getSubcontracts(projectId).catch(() => []),
      ]);
      setItems(snags || []);
      setSubcontracts(subs || []);
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تحميل قائمة العيوب والملاحظات');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [open, loadData]);

  const handleCreateSnag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemTitle.trim() || !locationDesc.trim()) {
      toast.error('يرجى كتابة وصف الملاحظة وتحديد موقعها بدقة');
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedSub = subcontracts.find((s) => s.id === subcontractId);
      await contractingApi.createSnagItem(projectId, {
        itemTitle: itemTitle.trim(),
        locationDesc: locationDesc.trim(),
        severity,
        responsibleParty,
        subcontractId: subcontractId || undefined,
        subcontractorId: selectedSub?.subcontractorId,
        assignedTo: assignedTo.trim() || undefined,
        dueDate: dueDate || undefined,
        notes: notes.trim() || undefined,
      } as any);

      toast.success('تم تسجيل الملاحظة الهندسية في القائمة بنجاح');
      setItemTitle('');
      setLocationDesc('');
      setAssignedTo('');
      setNotes('');
      setActiveTab('list');
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'فشل تسجيل الملاحظة');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (!rectifyingItem) return;
    setIsUpdatingStatus(true);
    try {
      await contractingApi.updateSnagItemStatus(rectifyingItem.id, {
        status: newStatus,
        rectificationNotes: rectificationNotes.trim() || undefined,
        closedDate: newStatus === 'verified_closed' ? todayLocalDateKey() : undefined,
      });
      toast.success('تم تحديث حالة الملاحظة بنجاح');
      setRectifyingItem(null);
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'فشل تحديث حالة الملاحظة');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    const confirmed = await systemConfirm({
      title: 'حذف ملاحظة هندسية',
      message: `هل أنت متأكد من حذف الملاحظة "${title}" نهائياً من القائمة؟`,
      confirmText: 'نعم، احذف الملاحظة',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await contractingApi.deleteSnagItem(id);
      toast.success('تم حذف الملاحظة بنجاح');
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'تعذر حذف الملاحظة');
    }
  };

  // KPIs
  const totalSnags = items.length;
  const openCount = items.filter((i) => i.status === 'open').length;
  const inProgressCount = items.filter((i) => i.status === 'in_progress').length;
  const rectifiedCount = items.filter((i) => i.status === 'rectified').length;
  const closedCount = items.filter((i) => i.status === 'verified_closed').length;

  const filteredItems = items.filter((i) => {
    if (statusFilter !== 'all' && i.status !== statusFilter) return false;
    if (severityFilter !== 'all' && i.severity !== severityFilter) return false;
    return true;
  });

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={`قائمة الملاحظات وعيوب المصنعية والتسليم (Punch List) - ${projectName || t('contracting.snag_list_modal.s0', "المشروع")}`}
      subtitle={t('contracting.snag_list_modal.s1', "حصر عيوب التشطيب والملاحظات الاستشارية، تعيين المسؤوليات، ومتابعة الإغلاق قبل الاستلام والتحاسب")}
      width="min(1080px, 96vw)"
      minHeight="min(560px, 85vh)"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} dir="rtl">
        {/* شريط الإحصائيات لمتابعة العيوب */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
            <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{t('contracting.snag_list_modal.s2', "إجمالي الملاحظات")}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
              {loading ? '—' : totalSnags}
            </div>
          </div>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
            <div style={{ fontSize: 'var(--font-micro)', color: '#b91c1c', fontWeight: 600 }}>{t('contracting.snag_list_modal.s3', "ملاحظات مفتوحة")}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#b91c1c', marginTop: '2px' }}>
              {loading ? '—' : openCount}
            </div>
          </div>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
            <div style={{ fontSize: 'var(--font-micro)', color: '#a16207', fontWeight: 600 }}>{t('contracting.snag_list_modal.s4', "جاري الإصلاح")}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#a16207', marginTop: '2px' }}>
              {loading ? '—' : inProgressCount}
            </div>
          </div>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
            <div style={{ fontSize: 'var(--font-micro)', color: '#3730a3', fontWeight: 600 }}>{t('contracting.snag_list_modal.s5', "تم الإصلاح (بانتظار الفحص)")}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#3730a3', marginTop: '2px' }}>
              {loading ? '—' : rectifiedCount}
            </div>
          </div>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
            <div style={{ fontSize: 'var(--font-micro)', color: '#15803d', fontWeight: 600 }}>{t('contracting.snag_list_modal.s6', "مغلقة ومسلّمة نهائياً")}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#15803d', marginTop: '2px' }}>
              {loading ? '—' : closedCount}
            </div>
          </div>
        </div>

        {/* شريط التحكم والتبديل والتصفية */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
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
              {t('contracting.snag_list_modal.s7', "جدول الملاحظات والعيوب (")}{items.length})
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
              <span>{t('contracting.snag_list_modal.s8', "إضافة ملاحظة / عيب جديد")}</span>
            </button>
          </div>

          {activeTab === 'list' && (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              {/* تصفية الحالة */}
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{t('contracting.snag_list_modal.s9', "الحالة:")}</span>
                {[
                  { key: 'all', label: t('contracting.snag_list_modal.s10', "الكل") },
                  { key: 'open', label: t('contracting.snag_list_modal.s11', "مفتوحة") },
                  { key: 'in_progress', label: t('contracting.snag_list_modal.s12', "قيد الإصلاح") },
                  { key: 'rectified', label: t('contracting.snag_list_modal.s13', "مُصلحة") },
                  { key: 'verified_closed', label: t('contracting.snag_list_modal.s14', "مغلقة") },
                ].map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setStatusFilter(s.key)}
                    style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      border: '1px solid',
                      borderColor: statusFilter === s.key ? '#170e5e' : '#e2e8f0',
                      background: statusFilter === s.key ? '#170e5e' : '#ffffff',
                      color: statusFilter === s.key ? '#ffffff' : '#64748b',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* تصفية الخطورة */}
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{t('contracting.snag_list_modal.s15', "الخطورة:")}</span>
                {[
                  { key: 'all', label: t('contracting.snag_list_modal.s16', "الكل") },
                  { key: 'critical', label: t('contracting.snag_list_modal.s17', "حرجة") },
                  { key: 'high', label: t('contracting.snag_list_modal.s18', "عالية") },
                  { key: 'medium', label: t('contracting.snag_list_modal.s19', "متوسطة") },
                  { key: 'low', label: t('contracting.snag_list_modal.s20', "بسيطة") },
                ].map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSeverityFilter(s.key)}
                    style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      border: '1px solid',
                      borderColor: severityFilter === s.key ? '#170e5e' : '#e2e8f0',
                      background: severityFilter === s.key ? '#170e5e' : '#ffffff',
                      color: severityFilter === s.key ? '#ffffff' : '#64748b',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* نموذج إضافة ملاحظة جديدة */}
        {activeTab === 'create' ? (
          <form onSubmit={handleCreateSnag} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px' }}>
              <Field label={t('contracting.snag_list_modal.s21', "وصف الملاحظة أو العيب الفني *")}>
                <input
                  type="text"
                  placeholder={t('contracting.snag_list_modal.s22', "مثال: تعشيش خرساني بالعمود C3، أو شروخ دهانات بالحائط الشرقي")}
                  value={itemTitle}
                  onChange={(e) => setItemTitle(e.target.value)}
                  style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem' }}
                />
              </Field>

              <Field label={t('contracting.snag_list_modal.s23', "مستوى الأهمية والخطورة *")}>
                <CustomSelect
                  value={severity}
                  onChange={(val) => setSeverity(val as SnagSeverity)}
                  options={[
                    { value: 'critical', label: t('contracting.snag_list_modal.s24', "حرجة / مانعة للاستلام (Critical)") },
                    { value: 'high', label: t('contracting.snag_list_modal.s25', "عالية الأهمية (High)") },
                    { value: 'medium', label: t('contracting.snag_list_modal.s26', "متوسطة (Medium)") },
                    { value: 'low', label: t('contracting.snag_list_modal.s27', "بسيطة / رتوش نهائية (Low)") },
                  ]}
                />
              </Field>

              <Field label={t('contracting.snag_list_modal.s28', "الجهة المسؤولة عن التدارك *")}>
                <CustomSelect
                  value={responsibleParty}
                  onChange={(val) => setResponsibleParty(val as any)}
                  options={[
                    { value: 'main_contractor', label: t('contracting.snag_list_modal.s29', "المقاول الرئيسي (تنفيذ ذاتي)") },
                    { value: 'subcontractor', label: t('contracting.snag_list_modal.s30', "مقاول باطن متخصص") },
                  ]}
                />
              </Field>

              <Field label={t('contracting.snag_list_modal.s31', "الموقع التفصيلي الدقيق بالمشروع *")}>
                <input
                  type="text"
                  placeholder={t('contracting.snag_list_modal.s32', "مثال: الدور الثاني - المدخل الرئيسي - محور B4")}
                  value={locationDesc}
                  onChange={(e) => setLocationDesc(e.target.value)}
                  style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem' }}
                />
              </Field>

              {responsibleParty === 'subcontractor' ? (
                <Field label={t('contracting.snag_list_modal.s33', "عقد مقاول الباطن المسؤول")}>
                  <CustomSelect
                    value={subcontractId}
                    onChange={setSubcontractId}
                    placeholder={t('contracting.snag_list_modal.s34', "اختر مقاول الباطن...")}
                    options={[
                      { value: '', label: t('contracting.snag_list_modal.s35', "غير محدد") },
                      ...subcontracts.map((s) => ({
                        value: s.id,
                        label: `${s.contractNumber} - ${s.subcontractorName || t('contracting.snag_list_modal.s36', "مقاول باطن")}`,
                      })),
                    ]}
                  />
                </Field>
              ) : (
                <Field label={t('contracting.snag_list_modal.s37', "المكلف بالإصلاح أو المشرف الميداني")}>
                  <input
                    type="text"
                    placeholder={t('contracting.snag_list_modal.s38', "مثال: فني الترميم / م. حسن")}
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                    style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem' }}
                  />
                </Field>
              )}

              <Field label={t('contracting.snag_list_modal.s39', "تاريخ المعالجة المستهدف (Due Date)")}>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem' }}
                />
              </Field>

              <div style={{ gridColumn: 'span 3' }}>
                <Field label={t('contracting.snag_list_modal.s40', "طريقة المعالجة المعتمدة أو ملاحظات الاستشاري")}>
                  <input
                    type="text"
                    placeholder={t('contracting.snag_list_modal.s41', "يتم تكسير الأجزاء الضعيفة وتطهير حديد التسليح ودهان مادة إيبوكسية ثم المونة غير القابلة للانكماش (Grout)...")}
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
                {t('contracting.snag_list_modal.s42', "إلغاء")}
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
                <span>{isSubmitting ? t('contracting.snag_list_modal.s43', "جاري الحفظ...") : t('contracting.snag_list_modal.s44', "تسجيل الملاحظة في القائمة")}</span>
              </button>
            </div>
          </form>
        ) : (
          /* جدول الملاحظات */
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', minHeight: '280px', display: 'flex', flexDirection: 'column' }}>
            {loading ? (
              <div style={{ flex: 1, minHeight: '280px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '32px' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', border: '3px solid #e2e8f0', borderTopColor: '#170e5e', animation: 'spin 0.8s linear infinite' }} />
                <span style={{ fontSize: 'var(--font-subtitle)', color: '#94a3b8', fontWeight: 600 }}>{t('contracting.snag_list_modal.s45', "جاري تحميل قائمة العيوب والملاحظات...")}</span>
              </div>
            ) : filteredItems.length === 0 ? (
              <div style={{ flex: 1, minHeight: '280px', padding: '40px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ color: '#15803d', marginBottom: '10px' }}>
                  <AppIcons.CheckCircle size={42} />
                </div>
                <div style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('contracting.snag_list_modal.s46', "سجل الملاحظات خالٍ تماماً (أو لا توجد عناصر تطابق الفلتر)")}
                </div>
                <div style={{ fontSize: 'var(--font-subtitle)', color: '#64748b', maxWidth: '380px', margin: '0 auto 14px' }}>
                  {t('contracting.snag_list_modal.s47', "توثيق الملاحظات يساعد في ضبط جودة الأعمال وتوجيه مقاولي الباطن لتفادي حجز الدفعات أو تأخير الاستلام.")}
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
                  {t('contracting.snag_list_modal.s48', "إضافة ملاحظة جديدة")}
                </button>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>{t('contracting.snag_list_modal.s49', "الملاحظة والموقع")}</th>
                      <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>{t('contracting.snag_list_modal.s50', "مستوى الخطورة")}</th>
                      <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>{t('contracting.snag_list_modal.s51', "الجهة المسؤولة")}</th>
                      <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>{t('contracting.snag_list_modal.s52', "تاريخ الاستحقاق")}</th>
                      <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>{t('contracting.snag_list_modal.s53', "الحالة")}</th>
                      <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569', textAlign: 'center' }}>{t('contracting.snag_list_modal.s54', "الإجراءات")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item) => {
                      const sevCfg = SEVERITY_CONFIG[item.severity] || SEVERITY_CONFIG.medium;
                      const statCfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.open;
                      return (
                        <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', maxWidth: '320px' }}>
                            <div style={{ fontWeight: 700, color: '#0f172a' }}>{item.description}</div>
                            <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', marginTop: '2px' }}>
                              {t('contracting.snag_list_modal.s55', "الموقع:")} {item.location}
                            </div>
                            {item.rectificationNotes && (
                              <div style={{ fontSize: 'var(--font-micro)', color: '#15803d', marginTop: '2px' }}>
                                {t('contracting.snag_list_modal.s56', "المعالجة:")} {item.rectificationNotes}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: 'var(--font-micro)',
                                fontWeight: 700,
                                background: sevCfg.bg,
                                color: sevCfg.color,
                                border: `1px solid ${sevCfg.border}`,
                              }}
                            >
                              {sevCfg.label}
                            </span>
                          </td>
                          <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', color: '#475569' }}>
                            <div>{(item as any).subcontractorName || (item.assignedTo ? item.assignedTo : t('contracting.snag_list_modal.s57', "المقاول الرئيسي"))}</div>
                          </td>
                          <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', color: '#475569' }}>
                            {item.targetDate || '—'}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                fontSize: 'var(--font-badge)',
                                fontWeight: 600,
                                background: statCfg.bg,
                                color: statCfg.color,
                                border: `1px solid ${statCfg.border}`,
                              }}
                            >
                              {statCfg.label}
                            </span>
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                              <button
                                type="button"
                                onClick={() => {
                                  setRectifyingItem(item);
                                  setNewStatus(item.status);
                                  setRectificationNotes(item.rectificationNotes || '');
                                }}
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
                                <span>{t('contracting.snag_list_modal.s58', "تحديث المعالجة")}</span>
                              </button>
                              {item.status !== 'verified_closed' && (
                                <button
                                  type="button"
                                  onClick={() => handleDelete(item.id, item.description)}
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

        {/* نافذة تحديث حالة المعالجة */}
        {rectifyingItem && (
          <DialogShell
            open={!!rectifyingItem}
            onClose={() => setRectifyingItem(null)}
            width="min(480px, 92vw)"
          >
            <div className="standard-dialog-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', padding: '16px 20px' }}>
              <div>
                <h3 className="standard-dialog-title" style={{ fontSize: '1rem', fontWeight: 800, color: '#170e5e', margin: 0 }}>
                  {t('contracting.snag_list_modal.s59', "تحديث حالة معالجة الملاحظة")}
                </h3>
                <span className="standard-dialog-subtitle" style={{ fontSize: '0.8rem', color: '#64748b' }}>
                  {t('contracting.snag_list_modal.s60', "توثيق الإجراء الميداني ومعاينة الاستلام")}
                </span>
              </div>
              <button
                type="button"
                className="standard-dialog-close-btn"
                onClick={() => setRectifyingItem(null)}
                aria-label={t('contracting.snag_list_modal.s61', "إغلاق")}
              >
                <AppIcons.X size={18} />
              </button>
            </div>

            <div className="standard-dialog-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '0.82rem', color: '#334155', background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <strong style={{ color: '#0f172a' }}>{t('contracting.snag_list_modal.s62', "الملاحظة:")}</strong> {rectifyingItem.description}
              </div>

              <Field label={t('contracting.snag_list_modal.s63', "الحالة الجديدة للملاحظة *")}>
                <CustomSelect
                  value={newStatus}
                  onChange={(val) => setNewStatus(val as SnagStatus)}
                  options={[
                    { value: 'open', label: t('contracting.snag_list_modal.s64', "مفتوحة (Open) - لم تبدأ المعالجة بعد") },
                    { value: 'in_progress', label: t('contracting.snag_list_modal.s65', "قيد المعالجة (In Progress) - جاري العمل عليها") },
                    { value: 'rectified', label: t('contracting.snag_list_modal.s66', "تم الإصلاح (Rectified) - بانتظار معاينة الاستشاري") },
                    { value: 'verified_closed', label: t('contracting.snag_list_modal.s67', "معتمدة ومغلقة (Closed) - تمت المعاينة وإغلاق الملاحظة") },
                  ]}
                />
              </Field>

              <Field label={t('contracting.snag_list_modal.s68', "ملاحظات المعالجة وتفاصيل المواد المستخدمة")}>
                <textarea
                  rows={3}
                  value={rectificationNotes}
                  onChange={(e) => setRectificationNotes(e.target.value)}
                  placeholder={t('contracting.snag_list_modal.s69', "تم إصلاح العيب ومعاينة السطح واستلامه بواسطة مهندس الموقع...")}
                  style={{ width: '100%', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '8px 10px', fontSize: '0.8125rem', resize: 'vertical', boxSizing: 'border-box' }}
                />
              </Field>
            </div>

            <div className="standard-dialog-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '14px 20px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <button
                type="button"
                onClick={() => setRectifyingItem(null)}
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
                {t('contracting.snag_list_modal.s70', "إلغاء")}
              </button>
              <button
                type="button"
                disabled={isUpdatingStatus}
                onClick={handleUpdateStatus}
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
                {isUpdatingStatus ? t('contracting.snag_list_modal.s71', "جاري الحفظ...") : t('contracting.snag_list_modal.s72', "تثبيت التحديث")}
              </button>
            </div>
          </DialogShell>
        )}
      </div>
    </StandardDialog>
  );
}
