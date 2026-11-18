import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { CustomSelect } from '@/shared/ui/custom-select';
import { Field } from '@/shared/ui/field';
import { contractingApi } from '../api/contracting.api';
import type { ContractingMeetingMinute, ContractingMeetingMinuteDetail, MeetingAttendee } from '../contracting.types';
import { toast } from '@/shared/components/system-alert';
import { todayLocalDateKey } from '@/lib/format';

interface MeetingMinutesModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName?: string;
}

const MEETING_TYPE_LABELS: Record<string, string> = {
  site_progress: 'اجتماع متابعة موقع',
  coordination: 'اجتماع تنسيق فني',
  kickoff: 'اجتماع افتتاحي',
  client: 'اجتماع مع المالك',
  consultant: 'اجتماع مع الاستشاري',
  other: 'أخرى',
};

export function MeetingMinutesModal({ open, onClose, projectId, projectName }: MeetingMinutesModalProps) {
  const { t } = useTranslation();
  const [minutes, setMinutes] = useState<ContractingMeetingMinute[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'list' | 'create'>('list');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [meetingType, setMeetingType] = useState('site_progress');
  const [meetingDate, setMeetingDate] = useState(todayLocalDateKey());
  const [location, setLocation] = useState('');
  const [attendeesText, setAttendeesText] = useState('');
  const [agenda, setAgenda] = useState('');
  const [summary, setSummary] = useState('');
  const [preparedBy, setPreparedBy] = useState('');

  const [detail, setDetail] = useState<ContractingMeetingMinuteDetail | null>(null);
  const [actionDescription, setActionDescription] = useState('');
  const [actionOwner, setActionOwner] = useState('');
  const [actionDueDate, setActionDueDate] = useState('');

  const loadData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await contractingApi.listMeetingMinutes(projectId);
      setMinutes(data || []);
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تحميل محاضر الاجتماعات');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) loadData();
  }, [open, loadData]);

  const openDetail = async (id: string) => {
    try {
      const d = await contractingApi.getMeetingMinuteDetail(id);
      setDetail(d);
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تحميل تفاصيل المحضر');
    }
  };

  const parseAttendees = (): MeetingAttendee[] => {
    return attendeesText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, company, role] = line.split(',').map((s) => s.trim());
        return { name: name || line, company: company || undefined, role: role || undefined };
      });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await contractingApi.createMeetingMinute(projectId, {
        meetingType,
        meetingDate,
        location: location.trim() || undefined,
        attendees: parseAttendees(),
        agenda: agenda.trim() || undefined,
        summary: summary.trim() || undefined,
        preparedBy: preparedBy.trim() || undefined,
      });
      toast.success('تم تسجيل محضر الاجتماع برقم رسمي بنجاح');
      setLocation('');
      setAttendeesText('');
      setAgenda('');
      setSummary('');
      setActiveTab('list');
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'فشل تسجيل محضر الاجتماع');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddAction = async () => {
    if (!detail || !actionDescription.trim()) {
      toast.error('يرجى إدخال وصف بند المتابعة');
      return;
    }
    try {
      setIsSubmitting(true);
      await contractingApi.addMeetingActionItem(detail.minute.id, {
        description: actionDescription.trim(),
        ownerName: actionOwner.trim() || undefined,
        dueDate: actionDueDate || undefined,
      });
      toast.success('تم إضافة بند المتابعة');
      setActionDescription('');
      setActionOwner('');
      setActionDueDate('');
      await openDetail(detail.minute.id);
    } catch (err: any) {
      toast.error(err?.message || 'فشل إضافة بند المتابعة');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleAction = async (actionId: string, current: 'open' | 'closed') => {
    if (!detail) return;
    try {
      await contractingApi.updateMeetingActionItemStatus(actionId, current === 'open' ? 'closed' : 'open');
      await openDetail(detail.minute.id);
    } catch (err: any) {
      toast.error(err?.message || 'فشل تحديث حالة البند');
    }
  };

  if (detail) {
    return (
      <StandardDialog
        open={open}
        onClose={onClose}
        title={`محضر اجتماع رقم [${detail.minute.minuteNumber}]`}
        subtitle={`${MEETING_TYPE_LABELS[detail.minute.meetingType] || detail.minute.meetingType} — ${detail.minute.meetingDate} — ${projectName || ''}`}
        maxWidth="900px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">
          <button
            type="button"
            onClick={() => setDetail(null)}
            style={{ alignSelf: 'flex-start', padding: '4px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#334155', cursor: 'pointer', fontWeight: 600, fontSize: 'var(--font-micro)' }}
          >
            {t('contracting.meeting_minutes_modal.s0', "← العودة لسجل المحاضر")}
          </button>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: 'var(--font-body)' }}>
            <div><strong>{t('contracting.meeting_minutes_modal.s1', "الموقع:")}</strong> {detail.minute.location || '—'}</div>
            <div><strong>{t('contracting.meeting_minutes_modal.s2', "مُعِد المحضر:")}</strong> {detail.minute.preparedBy || '—'}</div>
          </div>

          {detail.minute.attendees.length > 0 && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px' }}>
              <strong style={{ fontSize: 'var(--font-table-head)' }}>{t('contracting.meeting_minutes_modal.s3', "الحضور:")}</strong>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}>
                {detail.minute.attendees.map((a, i) => (
                  <span key={i} style={{ padding: '3px 10px', borderRadius: '6px', background: '#eef2ff', color: '#170e5e', fontSize: 'var(--font-micro)', fontWeight: 600 }}>
                    {a.name}{a.company ? ` (${a.company})` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {detail.minute.summary && (
            <div>
              <strong style={{ fontSize: 'var(--font-table-head)' }}>{t('contracting.meeting_minutes_modal.s4', "ملخص الاجتماع:")}</strong>
              <p style={{ margin: '6px 0 0', color: '#334155', fontSize: 'var(--font-body)' }}>{detail.minute.summary}</p>
            </div>
          )}

          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
            <h4 style={{ margin: '0 0 10px', fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#170e5e' }}>{t('contracting.meeting_minutes_modal.s5', "بنود المتابعة (Action Items)")}</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px', marginBottom: '10px' }}>
              <input type="text" placeholder={t('contracting.meeting_minutes_modal.s6', "وصف البند")} value={actionDescription} onChange={(e) => setActionDescription(e.target.value)} style={{ height: '32px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
              <input type="text" placeholder={t('contracting.meeting_minutes_modal.s7', "المسؤول")} value={actionOwner} onChange={(e) => setActionOwner(e.target.value)} style={{ height: '32px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
              <input type="date" value={actionDueDate} onChange={(e) => setActionDueDate(e.target.value)} style={{ height: '32px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
              <button type="button" onClick={handleAddAction} disabled={isSubmitting} style={{ height: '32px', borderRadius: '6px', border: 'none', background: '#170e5e', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                {t('contracting.meeting_minutes_modal.s8', "إضافة بند")}
              </button>
            </div>

            <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
              {detail.actionItems.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: 'var(--font-micro)', textAlign: 'center', padding: '10px' }}>{t('contracting.meeting_minutes_modal.s9', "لا توجد بنود متابعة بعد")}</div>
              ) : (
                detail.actionItems.map((item) => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 6px', borderBottom: '1px solid #f1f5f9' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: item.status === 'closed' ? '#94a3b8' : '#0f172a', textDecoration: item.status === 'closed' ? 'line-through' : 'none' }}>
                        {item.description}
                      </div>
                      <div style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>
                        {item.ownerName || t('contracting.meeting_minutes_modal.s10', "بدون مسؤول")} {item.dueDate ? `— موعد: ${item.dueDate}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleAction(item.id, item.status)}
                      style={{
                        padding: '3px 10px',
                        borderRadius: '6px',
                        fontSize: 'var(--font-micro)',
                        fontWeight: 700,
                        cursor: 'pointer',
                        border: '1px solid #cbd5e1',
                        background: item.status === 'closed' ? '#dcfce7' : '#fff',
                        color: item.status === 'closed' ? '#15803d' : '#334155',
                      }}
                    >
                      {item.status === 'closed' ? t('contracting.meeting_minutes_modal.s11', "مغلق") : t('contracting.meeting_minutes_modal.s12', "مفتوح — إغلاق")}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </StandardDialog>
    );
  }

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('contracting.meeting_minutes_modal.s13', "محاضر الاجتماعات وبنود المتابعة (Meeting Minutes)")}
      subtitle={`توثيق اجتماعات الموقع والتنسيق مع الأطراف وتتبع تنفيذ القرارات — ${projectName || ''}`}
      maxWidth="1000px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">
        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px' }}>
          <button type="button" onClick={() => setActiveTab('list')} style={{ padding: '6px 16px', borderRadius: '8px', fontWeight: 700, fontSize: 'var(--font-table-head)', border: activeTab === 'list' ? '1.5px solid #170e5e' : '1px solid #cbd5e1', background: activeTab === 'list' ? '#170e5e' : '#f8fafc', color: activeTab === 'list' ? '#fff' : '#334155', cursor: 'pointer' }}>
            {t('contracting.meeting_minutes_modal.s14', "السجل (")}{minutes.length})
          </button>
          <button type="button" onClick={() => setActiveTab('create')} style={{ padding: '6px 16px', borderRadius: '8px', fontWeight: 700, fontSize: 'var(--font-table-head)', border: activeTab === 'create' ? '1.5px solid #170e5e' : '1px solid #cbd5e1', background: activeTab === 'create' ? '#170e5e' : '#f8fafc', color: activeTab === 'create' ? '#fff' : '#334155', cursor: 'pointer' }}>
            {t('contracting.meeting_minutes_modal.s15', "محضر اجتماع جديد")}
          </button>
        </div>

        {activeTab === 'create' && (
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
              <Field label={t('contracting.meeting_minutes_modal.s16', "نوع الاجتماع")}>
                <CustomSelect value={meetingType} onChange={(val) => setMeetingType(val || 'site_progress')} options={Object.entries(MEETING_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
              </Field>
              <Field label={t('contracting.meeting_minutes_modal.s17', "تاريخ الاجتماع")}>
                <input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
              </Field>
              <Field label={t('contracting.meeting_minutes_modal.s18', "مكان الاجتماع")}>
                <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t('contracting.meeting_minutes_modal.s19', "مكتب الموقع")} style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
              </Field>
              <Field label={t('contracting.meeting_minutes_modal.s20', "مُعِد المحضر")}>
                <input type="text" value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
              </Field>
            </div>

            <Field label={t('contracting.meeting_minutes_modal.s21', "الحضور (سطر لكل شخص: الاسم, الجهة, الدور)")}>
              <textarea
                value={attendeesText}
                onChange={(e) => setAttendeesText(e.target.value)}
                placeholder={t('contracting.meeting_minutes_modal.s22', "م. أحمد خليل, الاستشاري العام, مدير المشروع\nم. سارة محمود, المقاول العام, مهندس موقع")}
                rows={3}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </Field>

            <Field label={t('contracting.meeting_minutes_modal.s23', "جدول الأعمال")}>
              <textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={2} style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
            </Field>

            <Field label={t('contracting.meeting_minutes_modal.s24', "ملخص القرارات والمناقشات")}>
              <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
            </Field>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" onClick={() => setActiveTab('list')} style={{ height: '36px', padding: '0 16px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', color: '#475569', cursor: 'pointer', fontWeight: 600 }}>{t('contracting.meeting_minutes_modal.s25', "إلغاء")}</button>
              <button type="submit" disabled={isSubmitting} style={{ height: '36px', padding: '0 20px', borderRadius: '6px', border: 'none', background: '#170e5e', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>
                {isSubmitting ? t('contracting.meeting_minutes_modal.s26', "جارٍ الحفظ...") : t('contracting.meeting_minutes_modal.s27', "حفظ وتوثيق المحضر")}
              </button>
            </div>
          </form>
        )}

        {activeTab === 'list' && (
          <div style={{ maxHeight: '420px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
            {loading ? (
              <div style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>{t('contracting.meeting_minutes_modal.s28', "جارٍ التحميل...")}</div>
            ) : minutes.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                <AppIcons.FileText size={36} style={{ color: '#94a3b8', margin: '0 auto 8px' }} />
                <div style={{ fontWeight: 700, color: '#334155' }}>{t('contracting.meeting_minutes_modal.s29', "لا توجد محاضر اجتماعات مسجلة بعد")}</div>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: 'var(--font-body)' }}>
                <thead style={{ background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0' }}>
                  <tr>
                    <th style={{ padding: '10px 12px' }}>{t('contracting.meeting_minutes_modal.s30', "رقم المحضر")}</th>
                    <th style={{ padding: '10px 12px' }}>{t('contracting.meeting_minutes_modal.s31', "النوع")}</th>
                    <th style={{ padding: '10px 12px' }}>{t('contracting.meeting_minutes_modal.s32', "التاريخ")}</th>
                    <th style={{ padding: '10px 12px' }}>{t('contracting.meeting_minutes_modal.s33', "الموقع")}</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center' }}>{t('contracting.meeting_minutes_modal.s34', "الإجراءات")}</th>
                  </tr>
                </thead>
                <tbody>
                  {minutes.map((m) => (
                    <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: '#170e5e' }}>{m.minuteNumber}</td>
                      <td style={{ padding: '10px 12px', fontSize: 'var(--font-micro)' }}>{MEETING_TYPE_LABELS[m.meetingType] || m.meetingType}</td>
                      <td style={{ padding: '10px 12px', fontSize: 'var(--font-micro)', color: '#64748b' }}>{m.meetingDate}</td>
                      <td style={{ padding: '10px 12px', fontSize: 'var(--font-micro)', color: '#64748b' }}>{m.location || '—'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <button type="button" onClick={() => openDetail(m.id)} style={{ padding: '4px 10px', borderRadius: '6px', fontSize: 'var(--font-micro)', fontWeight: 700, background: '#fff', border: '1px solid #cbd5e1', color: '#170e5e', cursor: 'pointer' }}>
                          {t('contracting.meeting_minutes_modal.s35', "عرض وبنود المتابعة")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </StandardDialog>
  );
}
