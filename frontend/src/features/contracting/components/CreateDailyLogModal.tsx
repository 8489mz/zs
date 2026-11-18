import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Field } from '@/shared/ui/field';
import { contractingApi } from '../api/contracting.api';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { todayLocalDateKey } from '@/lib/format';

interface CreateDailyLogModalProps {
  open: boolean;
  projectId: string;
  projectName?: string;
  onClose: () => void;
  onCreated?: () => void;
  onSuccess?: () => void;
}

export function CreateDailyLogModal({
  open,
  projectId,
  projectName,
  onClose,
  onCreated,
}: CreateDailyLogModalProps) {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    logDate: todayLocalDateKey(),
    weatherConditions: 'مشمس / معتدل',
    laborCount: '0',
    subcontractorLaborCount: '0',
    equipmentOnSite: '',
    workPerformed: '',
    delaysOrObstacles: '',
    materialsReceived: '',
    loggedBy: '',
  });

  const totalLabor = Number(formData.laborCount || 0) + Number(formData.subcontractorLaborCount || 0);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!formData.logDate) {
      setErrorMsg('يرجى تحديد تاريخ التقرير اليومي');
      return;
    }
    if (!formData.workPerformed.trim()) {
      setErrorMsg('يرجى توثيق الأعمال المنفذة في الموقع');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await contractingApi.createDailyLog(projectId, {
        logDate: formData.logDate,
        weatherConditions: formData.weatherConditions.trim() || undefined,
        laborCount: Number(formData.laborCount || 0),
        subcontractorLaborCount: Number(formData.subcontractorLaborCount || 0),
        equipmentOnSite: formData.equipmentOnSite.trim() || undefined,
        workPerformed: formData.workPerformed.trim(),
        delaysOrObstacles: formData.delaysOrObstacles.trim() || undefined,
        materialsReceived: formData.materialsReceived.trim() || undefined,
        loggedBy: formData.loggedBy.trim() || undefined,
      });
      onCreated?.();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'حدث خطأ أثناء حفظ التقرير اليومي للموقع');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('contracting.create_daily_log_modal.s0', "تقرير الموقع اليومي (Site Daily Diary Log)")}
      subtitle={projectName ? `المشروع: ${projectName}` : t('contracting.create_daily_log_modal.s1', "توثيق العمالة والمعدات والأعمال والمعوقات الميدانية")}
      width="min(920px, 95vw)"
      minHeight="auto"
      footerActions={(
        <StandardDialogFooter
          onCancel={onClose}
          onSubmit={() => handleSubmit()}
          submitText={t('contracting.create_daily_log_modal.s2', "حفظ وتوثيق التقرير اليومي")}
          isSubmitting={isSubmitting}
        />
      )}
    >
      <style>{`
        .daily-log-compact-modal .field {
          margin-bottom: 0 !important;
          gap: 3px !important;
        }
        .daily-log-compact-modal .field span {
          font-size: 0.74rem !important;
          font-weight: 600 !important;
          color: #334155 !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }
        .daily-log-compact-modal input,
        .daily-log-compact-modal textarea {
          height: 33px !important;
          font-size: 0.8125rem !important;
          border-radius: 6px !important;
          padding: 0 10px !important;
          border: 1px solid #cbd5e1 !important;
          background: #ffffff !important;
          box-sizing: border-box !important;
          outline: none !important;
          width: 100% !important;
          transition: border-color 0.15s, box-shadow 0.15s !important;
        }
        .daily-log-compact-modal textarea {
          height: auto !important;
          min-height: 48px !important;
          padding: 6px 10px !important;
          resize: vertical !important;
          line-height: 1.4 !important;
          font-family: inherit !important;
        }
        .daily-log-compact-modal input:focus,
        .daily-log-compact-modal textarea:focus {
          border-color: #170e5e !important;
          box-shadow: 0 0 0 2px rgba(23, 14, 94, 0.1) !important;
        }
      `}</style>

      <form onSubmit={handleSubmit} className="daily-log-compact-modal" style={{ display: 'flex', flexDirection: 'column', gap: '9px' }} dir="rtl">
        {errorMsg && (
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              color: '#991b1b',
              fontSize: '0.8rem',
              fontWeight: 600,
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* 1. بيانات اليومية والظروف الميدانية */}
        <div style={{ background: '#f8fafc', padding: '9px 13px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
            <AppIcons.Calendar size={15} />
            <span>{t('contracting.create_daily_log_modal.s3', "1. بيانات اليومية والظروف الميدانية (Log Date & Site Conditions)")}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.5fr 1.5fr', gap: '10px', alignItems: 'start' }}>
            <Field label={t('contracting.create_daily_log_modal.s4', "تاريخ التقرير *")}>
              <input
                type="date"
                value={formData.logDate}
                onChange={(e) => setFormData({ ...formData, logDate: e.target.value })}
                required
              />
            </Field>

            <Field label={t('contracting.create_daily_log_modal.s5', "حالة الطقس والأجواء")}>
              <input
                type="text"
                value={formData.weatherConditions}
                onChange={(e) => setFormData({ ...formData, weatherConditions: e.target.value })}
                placeholder={t('contracting.create_daily_log_modal.s6', "مثال: مشمس 28°C / معتدل")}
              />
            </Field>

            <Field label={t('contracting.create_daily_log_modal.s7', "مهندس الموقع / مُعد التقرير")}>
              <input
                type="text"
                value={formData.loggedBy}
                onChange={(e) => setFormData({ ...formData, loggedBy: e.target.value })}
                placeholder={t('contracting.create_daily_log_modal.s8', "اسم المهندس المشرف...")}
              />
            </Field>
          </div>
        </div>

        {/* 2. القوى العاملة والمعدات والتوريدات */}
        <div style={{ background: '#f8fafc', padding: '9px 13px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
            <AppIcons.Users size={15} />
            <span>{t('contracting.create_daily_log_modal.s9', "2. الموارد والمعدات بالموقع (Resources & Equipment on Site)")}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1.5fr 1.5fr', gap: '10px', alignItems: 'start' }}>
            <Field label={t('contracting.create_daily_log_modal.s10', "عمالة الشركة (الذاتية)")}>
              <input
                type="number"
                min="0"
                dir="ltr"
                value={formData.laborCount}
                onChange={(e) => setFormData({ ...formData, laborCount: e.target.value })}
                placeholder="0"
              />
            </Field>

            <Field label={t('contracting.create_daily_log_modal.s11', "عمالة مقاولي الباطن")}>
              <input
                type="number"
                min="0"
                dir="ltr"
                value={formData.subcontractorLaborCount}
                onChange={(e) => setFormData({ ...formData, subcontractorLaborCount: e.target.value })}
                placeholder="0"
              />
            </Field>

            <Field label={t('contracting.create_daily_log_modal.s12', "إجمالي القوى العاملة")}>
              <div
                style={{
                  height: '33px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  fontWeight: 800,
                  color: '#170e5e',
                  fontSize: '0.84rem',
                  boxSizing: 'border-box',
                }}
              >
                {totalLabor} {t('contracting.create_daily_log_modal.s13', "عامل")}
              </div>
            </Field>

            <Field label={t('contracting.create_daily_log_modal.s14', "المعدات والآليات بالموقع")}>
              <input
                type="text"
                value={formData.equipmentOnSite}
                onChange={(e) => setFormData({ ...formData, equipmentOnSite: e.target.value })}
                placeholder={t('contracting.create_daily_log_modal.s15', "مثال: ونش برجي، لودر CAT...")}
              />
            </Field>

            <Field label={t('contracting.create_daily_log_modal.s16', "المواد والتوريدات المستلمة اليوم")}>
              <input
                type="text"
                value={formData.materialsReceived}
                onChange={(e) => setFormData({ ...formData, materialsReceived: e.target.value })}
                placeholder={t('contracting.create_daily_log_modal.s17', "مثال: 50 طن حديد عز...")}
              />
            </Field>
          </div>
        </div>

        {/* 3. الأعمال المنفذة والمعوقات الميدانية */}
        <div style={{ background: '#f8fafc', padding: '9px 13px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
            <AppIcons.FileText size={15} />
            <span>{t('contracting.create_daily_log_modal.s18', "3. الأعمال المنفذة والمعوقات الميدانية (Executed Works & Obstacles)")}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Field label={t('contracting.create_daily_log_modal.s19', "الأعمال المنفذة والإنجاز اليومي *")}>
              <textarea
                rows={2}
                value={formData.workPerformed}
                onChange={(e) => setFormData({ ...formData, workPerformed: e.target.value })}
                placeholder={t('contracting.create_daily_log_modal.s20', "مثال: استكمال حدادة ونجارة سقف الدور الثاني وتمديد شبكة الكهرباء وصب الأعمدة...")}
                required
              />
            </Field>

            <Field label={t('contracting.create_daily_log_modal.s21', "معوقات أو ملاحظات طارئة (اختياري)")}>
              <input
                type="text"
                value={formData.delaysOrObstacles}
                onChange={(e) => setFormData({ ...formData, delaysOrObstacles: e.target.value })}
                placeholder={t('contracting.create_daily_log_modal.s22', "مثال: تأخر اعتماد عينات الاستشاري أو أعمال صيانة طارئة...")}
              />
            </Field>
          </div>
        </div>
      </form>
    </StandardDialog>
  );
}
