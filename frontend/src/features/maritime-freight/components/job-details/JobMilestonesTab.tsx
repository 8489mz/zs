import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { CustomSelect } from '@/shared/ui/custom-select';
import { maritimeApi, MaritimeJob } from '../../api/maritime-freight.api';
import { DCSA_STANDARD_MILESTONES, DcsaMilestoneKey } from '../../maritime-freight.types';
import { toast, systemConfirm } from '@/shared/components/system-alert';

interface JobMilestonesTabProps {
  job: MaritimeJob;
  fetchJob: () => Promise<void>;
  onUpdated: () => void;
  submitOnce: (key: string, action: () => Promise<void>) => Promise<void>;
}

export function JobMilestonesTab({ job, fetchJob, onUpdated, submitOnce }: JobMilestonesTabProps) {
  const { t } = useTranslation();
  const [nextMilestone, setNextMilestone] = useState<DcsaMilestoneKey>('GTI');
  const [milestoneNotes, setMilestoneNotes] = useState('');
  const [sendingWhatsAppKey, setSendingWhatsAppKey] = useState<string | null>(null);

  const handleAdvanceMilestone = async () => {
    try {
      await maritimeApi.addJobMilestone(job.id, nextMilestone, milestoneNotes || undefined);
      setMilestoneNotes('');
      await fetchJob();
      onUpdated();
      toast.success('تم تسجيل المرحلة الملاحية وتحديث التتبع بنجاح');
    } catch (err: any) {
      toast.error(err?.message || 'فشل تحديث المرحلة الملاحية');
    }
  };

  const handleReleaseDo = async () => {
    const confirmed = await systemConfirm({
      title: 'اعتماد وتسليم إذن التسليم الملاحي D/O',
      badge: job.job_number,
      message: 'هل أنت متأكد من اعتماد وتسليم إذن التسليم الملاحي الرسمي (Delivery Order) للعميل؟',
      impactItems: [
        'تسجيل مرحلة D/O الرسمية في سجل الشحنة وتحديث بوابات التتبع للعميل.',
        'إتمام إجراءات الإفراج الجمركي والسماح بخروج الحاويات من ساحات الميناء.',
      ],
      confirmText: 'اعتماد وتسليم إذن الإفراج',
      cancelText: 'تراجع',
      variant: 'primary',
    });
    if (!confirmed) return;
    try {
      await maritimeApi.releaseDeliveryOrder(job.id);
      await fetchJob();
      onUpdated();
      toast.success('تم اعتماد وتسليم إذن التسليم D/O بنجاح');
    } catch (err: any) {
      toast.error(err?.message || 'فشل تسليم إذن الإفراج');
    }
  };

  const handleSendDirectWhatsApp = async (milestoneKey: string) => {
    if (!job) return;
    try {
      setSendingWhatsAppKey(milestoneKey);
      const res = await maritimeApi.sendJobMilestoneWhatsApp(job.id, milestoneKey, job.customer_phone || undefined);
      if (res.success) {
        toast.success('تم إرسال إشعار الواتساب للعميل عبر بوابة Cloud WhatsApp بنجاح');
      } else {
        toast.info(res.message || 'تمت محاولة الإرسال');
      }
    } catch (err: any) {
      toast.error(err?.message || 'فشل إرسال إشعار الواتساب المباشر');
    } finally {
      setSendingWhatsAppKey(null);
    }
  };

  return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* ترقية المرحلة */}
          <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '4px' }}>{t('maritime_freight.job_details_modal.s130', "ترقية المرحلة الملاحية (DCSA Milestone)")}</div>
              <CustomSelect
                value={nextMilestone}
                onChange={(val) => setNextMilestone(val as DcsaMilestoneKey)}
                options={DCSA_STANDARD_MILESTONES.map((m) => ({
                  value: m.key,
                  label: `[${m.key}] ${m.title_ar} - ${m.title_en}`,
                }))}
                placeholder={t('maritime_freight.job_details_modal.s131', "اختر المرحلة الملاحية...")}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '4px' }}>{t('maritime_freight.job_details_modal.s132', "ملاحظات المرحلة أو الموقع")}</div>
              <input
                type="text"
                value={milestoneNotes}
                onChange={(e) => setMilestoneNotes(e.target.value)}
                placeholder={t('maritime_freight.job_details_modal.s133', "مثال: رست السفينة برصيف 45")}
                style={{ width: '100%', height: '36px', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '0 8px', fontSize: '0.85rem' }}
              />
            </div>
            <button
              type="button"
              onClick={() => submitOnce('milestone', handleAdvanceMilestone)}
              style={{
                height: '36px',
                marginTop: '18px',
                padding: '0 16px',
                background: '#170e5e',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t('maritime_freight.job_details_modal.s134', "تحديث المرحلة")}
            </button>
          </div>

          {/* زر تسليم إذن التسليم D/O */}
          {!job.delivery_order_released && (
            <div style={{ padding: '12px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '0.85rem', color: '#92400e', fontWeight: 600 }}>
                {t('maritime_freight.job_details_modal.s135', "إذن التسليم (Delivery Order D/O) محتجز حتى تحصيل مستحقات الشحن.")}
              </div>
              <button
                type="button"
                onClick={() => submitOnce('release-do', handleReleaseDo)}
                style={{
                  padding: '6px 14px',
                  background: '#d97706',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t('maritime_freight.job_details_modal.s136', "اعتماد وتسليم إذن الإفراج (Release D/O)")}
              </button>
            </div>
          )}

          {/* السجل الزمني للمحطات */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
            {job.milestones?.map((m, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 14px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flex: 1 }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#dbeafe', color: '#1e40af', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.78rem', flexShrink: 0 }}>
                    {idx + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0f172a' }}>{m.milestone_title}</div>
                    {m.notes && <div style={{ fontSize: '0.8rem', color: '#475569', marginTop: '2px' }}>{m.notes}</div>}
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '4px' }}>
                      {new Date(m.occurred_at).toLocaleString('ar-EG')}
                    </div>
                  </div>
                </div>

                {job.customer_phone && (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      disabled={sendingWhatsAppKey === m.milestone_key}
                      onClick={() => handleSendDirectWhatsApp(m.milestone_key)}
                      title={t('maritime_freight.job_details_modal.s137', "إرسال إشعار فوري عبر بوابة Cloud WhatsApp")}
                      style={{
                        padding: '4px 10px',
                        background: '#15803d',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        cursor: sendingWhatsAppKey === m.milestone_key ? 'not-allowed' : 'pointer',
                        whiteSpace: 'nowrap',
                        opacity: sendingWhatsAppKey === m.milestone_key ? 0.7 : 1,
                      }}
                    >
                      {sendingWhatsAppKey === m.milestone_key ? t('maritime_freight.job_details_modal.s138', "جاري الإرسال...") : t('maritime_freight.job_details_modal.s139', "إرسال سحابي فوري")}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const alertData = await maritimeApi.getJobWhatsAppAlert(job.id, m.milestone_key);
                          const cleanPhone = (alertData.customerPhone || job.customer_phone || '').replace(/[^0-9]/g, '');
                          if (cleanPhone) {
                            window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(alertData.message)}`, '_blank');
                          } else {
                            toast.warning(t('maritime_freight.job_details_modal.s140', "لا يوجد رقم هاتف مسجل للعميل"));
                          }
                        } catch (err: any) {
                          toast.error(err?.message || t('maritime_freight.job_details_modal.s141', "فشل توليد رسالة واتساب"));
                        }
                      }}
                      title={t('maritime_freight.job_details_modal.s142', "فتح تطبيق أو ويب واتساب مباشرة")}
                      style={{
                        padding: '4px 8px',
                        background: '#f0fdf4',
                        color: '#166534',
                        border: '1px solid #bbf7d0',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t('maritime_freight.job_details_modal.s143', "فتح واتساب")}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
  );
}
