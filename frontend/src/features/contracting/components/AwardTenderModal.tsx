import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { contractingApi } from '../api/contracting.api';
import { toast } from '@/shared/components/system-alert';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { todayLocalDateKey } from '@/lib/format';

interface AwardTenderModalProps {
  open: boolean;
  projectId: string;
  projectCode?: string;
  projectName?: string;
  clientName?: string;
  contractValue?: number;
  initialDownPayment?: number;
  initialRetentionPercent?: number;
  onClose: () => void;
  onSuccess: () => void;
}

export function AwardTenderModal({
  open,
  projectId,
  projectCode,
  projectName,
  clientName,
  contractValue = 0,
  initialDownPayment = 0,
  initialRetentionPercent = 5,
  onClose,
  onSuccess,
}: AwardTenderModalProps) {
  const { t } = useTranslation();
  const { currencySymbol, formatCurrency } = useSystemCurrency();

  const [contractRef, setContractRef] = useState(`CNT-${todayLocalDateKey().slice(2).replace(/-/g, '')}-0001`);
  const [contractDate, setContractDate] = useState(todayLocalDateKey());
  const [startDate] = useState(todayLocalDateKey());
  const [downPaymentAmount, setDownPaymentAmount] = useState<number | ''>(initialDownPayment || Math.round(contractValue * 0.1));
  const [retentionPercent, setRetentionPercent] = useState<number>(initialRetentionPercent || 5);
  const [projectManager, setProjectManager] = useState('');
  const [consultantName, setConsultantName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await contractingApi.awardTender(projectId, {
        contractRef: contractRef.trim() || undefined,
        contractDate: contractDate || undefined,
        startDate: startDate || undefined,
        downPaymentAmount: downPaymentAmount !== '' ? Number(downPaymentAmount) : 0,
        retentionPercent: Number(retentionPercent) || 5,
        projectManager: projectManager.trim() || undefined,
        consultantName: consultantName.trim() || undefined,
      });
      toast.success('تمت ترسية العطاء وتوقيع العقد بنجاح! تحول المشروع الآن إلى مشروع تنفيذي ساري.');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'تعذر ترسية العطاء');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('contracting.award_tender_modal.s0', "اعتماد وترسية العطاء وتوقيع العقد الرسمي")}
      subtitle={`المشروع: [${projectCode || ''}] ${projectName || ''} - العميل: ${clientName || t('contracting.award_tender_modal.s1', "العميل الموقر")}`}
      width="720px"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#166534' }}>
              {t('contracting.award_tender_modal.s2', "الترسية الرسمية والتحويل لمشروع تنفيذي ساري (Active Project)")}
            </div>
            <div style={{ fontSize: 'var(--font-subtitle)', color: '#15803d', marginTop: '2px' }}>
              {t('contracting.award_tender_modal.s3', "سيتم تثبيت مقايسة العطاء كـ خط أساس تعاقدي (Contractual SOV Baseline) وفتح بوابات التوريدات والمستخلصات وجانت.")}
            </div>
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 'var(--font-micro)', color: '#15803d', fontWeight: 600 }}>{t('contracting.award_tender_modal.s4', "إجمالي القيمة التعاقدية")}</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#166534' }}>
              {formatCurrency(contractValue)}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: 'var(--font-body)', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
              {t('contracting.award_tender_modal.s5', "رقم العقد التعاقدي الرسمي")}
            </label>
            <input
              type="text"
              value={contractRef}
              onChange={(e) => setContractRef(e.target.value)}
              placeholder={t('contracting.award_tender_modal.s6', "مثال: CNT-260918-0001")}
              style={{
                width: '100%',
                height: '38px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: 'var(--font-body)',
                color: '#0f172a',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 'var(--font-body)', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
              {t('contracting.award_tender_modal.s7', "تاريخ توقيع العقد")}
            </label>
            <input
              type="date"
              value={contractDate}
              onChange={(e) => setContractDate(e.target.value)}
              style={{
                width: '100%',
                height: '38px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: 'var(--font-body)',
                color: '#0f172a',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: 'var(--font-body)', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
              {t('contracting.award_tender_modal.s8', "قيمة الدفعة المقدمة التعاقدية (")}{currencySymbol})
            </label>
            <input
              type="number"
              min={0}
              step="any"
              value={downPaymentAmount}
              onChange={(e) => setDownPaymentAmount(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="0"
              style={{
                width: '100%',
                height: '38px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: 'var(--font-body)',
                color: '#0f172a',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 'var(--font-body)', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
              {t('contracting.award_tender_modal.s9', "نسبة ضمان الأعمال المحتجزة (Retention %)")}
            </label>
            <input
              type="number"
              min={0}
              max={50}
              step="0.5"
              value={retentionPercent}
              onChange={(e) => setRetentionPercent(Number(e.target.value))}
              placeholder="5.0"
              style={{
                width: '100%',
                height: '38px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: 'var(--font-body)',
                color: '#0f172a',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: 'var(--font-body)', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
              {t('contracting.award_tender_modal.s10', "مهندس / مدير المشروع المسؤول")}
            </label>
            <input
              type="text"
              value={projectManager}
              onChange={(e) => setProjectManager(e.target.value)}
              placeholder={t('contracting.award_tender_modal.s11', "مثال: م. أحمد عبد العزيز")}
              style={{
                width: '100%',
                height: '38px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: 'var(--font-body)',
                color: '#0f172a',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 'var(--font-body)', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
              {t('contracting.award_tender_modal.s12', "الاستشاري المشرف أو ممثل المالك")}
            </label>
            <input
              type="text"
              value={consultantName}
              onChange={(e) => setConsultantName(e.target.value)}
              placeholder={t('contracting.award_tender_modal.s13', "مثال: مكتب صبور للاستشارات الهندسية")}
              style={{
                width: '100%',
                height: '38px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: 'var(--font-body)',
                color: '#0f172a',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              height: '36px',
              padding: '0 16px',
              borderRadius: '8px',
              fontWeight: 600,
              background: '#ffffff',
              color: '#475569',
              border: '1px solid #cbd5e1',
              cursor: 'pointer',
              fontSize: 'var(--font-body)',
            }}
          >
            {t('contracting.award_tender_modal.s14', "إلغاء")}
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
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              fontSize: 'var(--font-body)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              opacity: isSubmitting ? 0.7 : 1,
              boxShadow: '0 1px 3px rgba(23, 14, 94, 0.2)',
            }}
          >
            <AppIcons.CheckShield size={16} />
            <span>{isSubmitting ? t('contracting.award_tender_modal.s15', "جاري الترسية والتحويل...") : t('contracting.award_tender_modal.s16', "اعتماد وترسية العطاء رسمياً")}</span>
          </button>
        </div>
      </form>
    </StandardDialog>
  );
}
