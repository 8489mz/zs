import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { formatCurrency, formatDateOnly } from '@/lib/format';
import {CalendarIcon, CheckIcon, Trash2Icon, AppIcons} from '@/shared/components/icons/AppIcons';
import { crmApi, type CrmDeal, type DealStage, type CrmActivity } from '../api/crm.api';
import { STAGES, PRIORITIES, ACTIVITY_LABELS } from './CrmConstants';
import { CustomSelect } from '@/shared/ui/custom-select';
import { toast, systemConfirm } from '@/shared/components/system-alert';

export interface CrmDealDetailModalProps {
  dealId: number | null;
  onClose: () => void;
  onStageChange?: (deal: CrmDeal, stage: DealStage) => void;
  onFeedback?: (type: 'success' | 'error', text: string) => void;
}

export function CrmDealDetailModal({
  dealId,
  onClose,
  onStageChange,
  onFeedback,
}: CrmDealDetailModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [newActivitySummary, setNewActivitySummary] = useState('');
  const [newActivityType, setNewActivityType] = useState('call');
  const [newActivityDueDate, setNewActivityDueDate] = useState('');

  const { data: activeDealDetail } = useQuery({
    queryKey: ['crm-deal-detail', dealId],
    queryFn: () => crmApi.get(dealId!),
    enabled: Boolean(dealId),
  });

  const deleteDealMutation = useMutation({
    mutationFn: crmApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-deals'] });
      queryClient.invalidateQueries({ queryKey: ['crm-summary'] });
      onClose();
      onFeedback?.('success', 'تم حذف الفرصة البيعية بنجاح.');
    },
    onError: (err: any) => {
      onFeedback?.('error', err?.message || 'فشل حذف الفرصة.');
    },
  });

  const addActivityMutation = useMutation({
    mutationFn: ({ dealId, data }: { dealId: number; data: any }) => crmApi.addActivity(dealId, data),
    onSuccess: () => {
      if (dealId) {
        queryClient.invalidateQueries({ queryKey: ['crm-deal-detail', dealId] });
      }
      setNewActivitySummary('');
      setNewActivityDueDate('');
      onFeedback?.('success', 'تم تسجيل النشاط بنجاح.');
    },
    onError: (err: any) => {
      onFeedback?.('error', err?.message || 'فشل إضافة النشاط.');
    },
  });

  const toggleActivityMutation = useMutation({
    mutationFn: crmApi.toggleActivity,
    onSuccess: () => {
      if (dealId) {
        queryClient.invalidateQueries({ queryKey: ['crm-deal-detail', dealId] });
      }
    },
  });

  const convertCustomerMutation = useMutation({
    mutationFn: crmApi.convertToCustomer,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['crm-deals'] });
      queryClient.invalidateQueries({ queryKey: ['crm-summary'] });
      if (dealId) {
        queryClient.invalidateQueries({ queryKey: ['crm-deal-detail', dealId] });
      }
      onFeedback?.('success', `تم تحويل الفرصة إلى عميل مسجل برقم #${res.customerId} بنجاح.`);
    },
    onError: (err: any) => {
      onFeedback?.('error', err?.message || 'فشل تحويل الفرصة إلى عميل.');
    },
  });

  if (!dealId || !activeDealDetail?.deal) return null;

  const currentStage = STAGES.find((s) => s.key === activeDealDetail.deal.stage);

  return (
    <StandardDialog
      open={Boolean(dealId)}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>{activeDealDetail.deal.title}</span>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '999px',
              background: currentStage?.bg || '#f1f5f9',
              color: currentStage?.color || '#475569',
            }}
          >
            {t(`crm.stage.${activeDealDetail.deal.stage}`, currentStage?.label || activeDealDetail.deal.stage)}
          </span>
        </div>
      }
      subtitle={`${activeDealDetail.deal.companyName ? `${activeDealDetail.deal.companyName} • ` : ''}${activeDealDetail.deal.contactName || t('crm.crm_deal_detail_modal.s0', "بدون جهة اتصال")}${activeDealDetail.deal.contactPhone ? ` (${activeDealDetail.deal.contactPhone})` : ''}`}
      width="min(880px, 95vw)"
      minHeight="auto"
      footerActions={(
        <StandardDialogFooter
          onCancel={onClose}
          cancelText={t('crm.crm_deal_detail_modal.s1', "إغلاق")}
          extraActions={(
            <Button
              variant="secondary"
              style={{ color: '#dc2626', borderColor: '#fecaca', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              onClick={async () => {
                const confirmed = await systemConfirm({
                  title: t('crm.crm_deal_detail_modal.s2', "حذف الفرصة البيعية"),
                  message: `هل أنت متأكد من رغبتك في حذف فرصة "${activeDealDetail.deal.title}" نهائياً؟ لا يمكن التراجع عن هذا الإجراء.`,
                  confirmText: t('crm.crm_deal_detail_modal.s3', "تأكيد الحذف"),
                  cancelText: t('crm.crm_deal_detail_modal.s4', "إلغاء"),
                  variant: 'danger',
                });
                if (confirmed) {
                  deleteDealMutation.mutate(activeDealDetail.deal.id);
                }
              }}
              disabled={deleteDealMutation.isPending}
            >
              <Trash2Icon size={14} />
              <span>{deleteDealMutation.isPending ? t('crm.crm_deal_detail_modal.s5', "جاري الحذف...") : t('crm.crm_deal_detail_modal.s6', "حذف الفرصة")}</span>
            </Button>
          )}
        />
      )}
    >
      <style>{`
        .deal-detail-compact .field {
          margin-bottom: 0 !important;
          gap: 3px !important;
        }
        .deal-detail-compact .field span {
          font-size: 0.74rem !important;
          font-weight: 600 !important;
          color: #334155 !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }
        .deal-detail-compact input {
          height: 33px !important;
          font-size: 0.8125rem !important;
          border-radius: 6px !important;
          padding: 0 10px !important;
          border: 1px solid #cbd5e1 !important;
          background: #ffffff !important;
          box-sizing: border-box !important;
          outline: none !important;
        }
        .deal-detail-compact input:focus {
          border-color: #170e5e !important;
          box-shadow: 0 0 0 1px #170e5e !important;
        }
        .deal-detail-compact .custom-select-trigger {
          min-height: 33px !important;
          height: 33px !important;
          font-size: 0.8125rem !important;
          border-radius: 6px !important;
        }
      `}</style>

      <div className="deal-detail-compact" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} dir="rtl">
        {/* Card 1: شريط الإجراءات والتحويل السريع */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '10px 14px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {activeDealDetail.deal.customerId ? (
              <span
                style={{
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  color: '#16a34a',
                  background: '#ecfdf5',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  border: '1px solid #bbf7d0',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <CheckIcon size={14} color="#16a34a" />
                {t('crm.crm_deal_detail_modal.s7', "عميل مسجل بالمنظومة (رقم #")}{activeDealDetail.deal.customerId})
              </span>
            ) : (
              <Button
                variant="primary"
                style={{ background: '#16a34a', color: '#ffffff', fontSize: '0.78rem', height: '32px' }}
                onClick={() => convertCustomerMutation.mutate(activeDealDetail.deal.id)}
                disabled={convertCustomerMutation.isPending}
              >
                {convertCustomerMutation.isPending ? t('crm.crm_deal_detail_modal.s8', "جاري التحويل...") : t('crm.crm_deal_detail_modal.s9', "تحويل إلى عميل مسجل")}
              </Button>
            )}

            {activeDealDetail.deal.contactPhone && (
              <Button
                variant="secondary"
                style={{ fontSize: '0.78rem', height: '32px', color: '#059669', borderColor: '#a7f3d0' }}
                onClick={() => {
                  const cleanPhone = activeDealDetail.deal.contactPhone?.replace(/\D/g, '') || '';
                  window.open(
                    `https://wa.me/${cleanPhone}?text=${encodeURIComponent(
                      `مرحباً ${activeDealDetail.deal.contactName || ''}، بخصوص فرصة: ${activeDealDetail.deal.title}`
                    )}`,
                    '_blank'
                  );
                }}
              >
                {t('crm.crm_deal_detail_modal.s10', "مراسلة واتساب")}
              </Button>
            )}

            <Button
              variant="secondary"
              style={{ fontSize: '0.78rem', height: '32px' }}
              onClick={() => navigate('/pos')}
            >
              {t('crm.crm_deal_detail_modal.s11', "فتح نقطة البيع (POS)")}
            </Button>
          </div>

          {/* Stage advancement dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '220px' }}>
            <span style={{ fontSize: '0.76rem', fontWeight: 600, color: '#64748b', whiteSpace: 'nowrap' }}>{t('crm.crm_deal_detail_modal.s12', "نقل المرحلة:")}</span>
            <div style={{ flex: 1 }}>
              <CustomSelect
                value={activeDealDetail.deal.stage}
                onChange={(val) => onStageChange?.(activeDealDetail.deal, val as DealStage)}
                options={[
                  ...STAGES.map((s) => ({ value: s.key, label: s.label })),
                  { value: 'lost', label: t('crm.crm_deal_detail_modal.s13', "صفقة خاسرة") },
                ]}
                placeholder={t('crm.crm_deal_detail_modal.s14', "اختر المرحلة...")}
              />
            </div>
          </div>
        </div>

        {/* Card 2: ملخص المؤشرات المالية والجدول الزمني */}
        <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
            <AppIcons.DollarSign size={15} />
            <span>{t('crm.crm_deal_detail_modal.s15', "بيانات القيمة والأولوية والجدول الزمني")}</span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '10px',
            }}
          >
            <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '0.72rem', color: '#64748b' }}>{t('crm.crm_deal_detail_modal.s16', "القيمة المتوقعة")}</span>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#170e5e', marginTop: '2px' }}>
                {formatCurrency(activeDealDetail.deal.expectedAmount)}
              </div>
            </div>

            <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '0.72rem', color: '#64748b' }}>{t('crm.crm_deal_detail_modal.s17', "نسبة الفوز المتوقعة")}</span>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0284c7', marginTop: '2px' }}>
                {activeDealDetail.deal.probability}%
              </div>
            </div>

            <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '0.72rem', color: '#64748b' }}>{t('crm.crm_deal_detail_modal.s18', "مستوى الأولوية")}</span>
              <div style={{ fontSize: '0.84rem', fontWeight: 700, marginTop: '3px' }}>
                {PRIORITIES[activeDealDetail.deal.priority]?.label || activeDealDetail.deal.priority}
              </div>
            </div>

            <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '0.72rem', color: '#64748b' }}>{t('crm.crm_deal_detail_modal.s19', "تاريخ الإغلاق المتوقع")}</span>
              <div style={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155', marginTop: '3px' }}>
                {activeDealDetail.deal.expectedCloseDate ? formatDateOnly(activeDealDetail.deal.expectedCloseDate) : '—'}
              </div>
            </div>
          </div>

          {/* Notes Section */}
          {activeDealDetail.deal.notes && (
            <div
              style={{
                background: '#fffbeb',
                border: '1px solid #fef3c7',
                borderRadius: '6px',
                padding: '8px 12px',
                marginTop: '10px',
                fontSize: '0.8rem',
                color: '#92400e',
              }}
            >
              <strong style={{ display: 'block', marginBottom: '2px' }}>{t('crm.crm_deal_detail_modal.s20', "ملاحظات الصفقة:")}</strong>
              <div>{activeDealDetail.deal.notes}</div>
            </div>
          )}
        </div>

        {/* Card 3: سجل المتابعات والأنشطة */}
        <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
            <AppIcons.Clock size={15} />
            <span>{t('crm.crm_deal_detail_modal.s21', "سجل المتابعات والأنشطة (Activity Timeline)")}</span>
          </div>

          {/* Add Activity Form */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              padding: '10px',
              marginBottom: '10px',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 160px auto', gap: '8px', alignItems: 'center' }}>
              <CustomSelect
                value={newActivityType}
                onChange={(val) => setNewActivityType(val)}
                options={[
                  { value: 'call', label: t('crm.crm_deal_detail_modal.s22', "مكالمة هاتفية") },
                  { value: 'meeting', label: t('crm.crm_deal_detail_modal.s23', "اجتماع عمل") },
                  { value: 'task', label: t('crm.crm_deal_detail_modal.s24', "مهمة متابعة") },
                  { value: 'note', label: t('crm.crm_deal_detail_modal.s25', "ملاحظة") },
                ]}
                placeholder={t('crm.crm_deal_detail_modal.s26', "نوع النشاط...")}
              />

              <input
                type="text"
                placeholder={t('crm.crm_deal_detail_modal.s27', "ملخص المتابعة أو المهمة المطلوبة...")}
                value={newActivitySummary}
                onChange={(e) => setNewActivitySummary(e.target.value)}
              />

              <input
                type="date"
                value={newActivityDueDate}
                onChange={(e) => setNewActivityDueDate(e.target.value)}
              />

              <Button
                variant="primary"
                style={{ background: '#170e5e', color: '#ffffff', fontSize: '0.78rem', height: '33px' }}
                onClick={() => {
                  if (!newActivitySummary.trim()) {
                    toast.warning(t('crm.crm_deal_detail_modal.s28', "يرجى كتابة ملخص النشاط."));
                    return;
                  }
                  addActivityMutation.mutate({
                    dealId: activeDealDetail.deal.id,
                    data: {
                      activityType: newActivityType,
                      summary: newActivitySummary,
                      dueDate: newActivityDueDate || null,
                    },
                  });
                }}
                disabled={addActivityMutation.isPending}
              >
                {t('crm.crm_deal_detail_modal.s29', "إضافة نشاط")}
              </Button>
            </div>
          </div>

          {/* Timeline List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px', overflowY: 'auto' }}>
            {activeDealDetail.activities?.map((act: CrmActivity) => (
              <div
                key={act.id}
                style={{
                  background: act.isCompleted ? '#f1f5f9' : '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input
                    type="checkbox"
                    checked={act.isCompleted}
                    onChange={() => toggleActivityMutation.mutate(act.id)}
                    style={{ cursor: 'pointer', width: '15px', height: '15px' }}
                  />
                  <div>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: '#e0e7ff',
                        color: '#3730a3',
                        marginLeft: '8px',
                      }}
                    >
                      {ACTIVITY_LABELS[act.activityType] || act.activityType}
                    </span>
                    <span
                      style={{
                        fontSize: '0.8125rem',
                        color: act.isCompleted ? '#94a3b8' : '#1e293b',
                        textDecoration: act.isCompleted ? 'line-through' : 'none',
                      }}
                    >
                      {act.summary}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.72rem', color: '#94a3b8' }}>
                  {act.dueDate && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <CalendarIcon size={12} />
                      {formatDateOnly(act.dueDate)}
                    </span>
                  )}
                  <span>{formatDateOnly(act.createdAt)}</span>
                </div>
              </div>
            ))}

            {(!activeDealDetail.activities || activeDealDetail.activities.length === 0) && (
              <div style={{ textAlign: 'center', padding: '16px', color: '#94a3b8', fontSize: '0.78rem' }}>
                {t('crm.crm_deal_detail_modal.s30', "لا توجد أنشطة مسجلة حتى الآن")}
              </div>
            )}
          </div>
        </div>
      </div>
    </StandardDialog>
  );
}
