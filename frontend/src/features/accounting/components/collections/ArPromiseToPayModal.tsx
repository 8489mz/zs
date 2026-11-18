import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/components/system-alert';
import { arCollectionsApi, type ArCollectionCaseItem } from '../../api/ar-collections.api';
import { CalendarIcon, ClockIcon } from '@/shared/components/icons/AppIcons';
import { todayLocalDateKey } from '@/lib/format';

interface ArPromiseToPayModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  caseItem: ArCollectionCaseItem | null;
}

export const ArPromiseToPayModal: React.FC<ArPromiseToPayModalProps> = ({
  open,
  onClose,
  onSuccess,
  caseItem,
}) => {
  const { t } = useTranslation();
  const [promisedDate, setPromisedDate] = useState('');
  const [promisedAmount, setPromisedAmount] = useState<number>(0);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (caseItem) {
      // Default promised amount to total overdue
      setPromisedAmount(Number(caseItem.total_overdue) || 0);
      // Default date to 7 days from now
      const d = new Date();
      d.setDate(d.getDate() + 7);
      setPromisedDate(todayLocalDateKey(d));
      setNotes('');
    }
  }, [caseItem]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!caseItem) return;

    if (!promisedDate) {
      toast.warning('يرجى تحديد تاريخ التعهد بالسداد.');
      return;
    }

    if (promisedAmount <= 0) {
      toast.warning('يرجى إدخال مبلغ تعهد سداد صحيح.');
      return;
    }

    setIsSubmitting(true);
    try {
      await arCollectionsApi.recordPromiseToPay(caseItem.id, {
        promisedDate,
        promisedAmount,
        notes: notes.trim() || undefined,
      });

      toast.success(`تم تسجيل تعهد السداد للعميل ${caseItem.customer_name} بنجاح.`);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تسجيل تعهد السداد');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('accounting.collections.ar_promise_to_pay_modal.s0', "تسجيل تعهد بالسداد (Promise to Pay)")}
      subtitle={`العميل: ${caseItem?.customer_name || ''} | إجمالي المتأخرات: ${Number(caseItem?.total_overdue || 0).toLocaleString('ar-EG')} ج.م`}
      size="sm"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ backgroundColor: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: '#1e293b', fontSize: '13px', fontWeight: 600 }}>
            <CalendarIcon size={16} color="#170e5e" />
            <span>{t('accounting.collections.ar_promise_to_pay_modal.s1', "بيانات موعد السداد الملتزم به")}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                {t('accounting.collections.ar_promise_to_pay_modal.s2', "تاريخ السداد المتعهد به *")}
              </label>
              <input
                type="date"
                required
                value={promisedDate}
                onChange={(e) => setPromisedDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  outline: 'none',
                  backgroundColor: '#ffffff',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                {t('accounting.collections.ar_promise_to_pay_modal.s3', "المبلغ المتعهد بسداده (ج.م) *")}
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={promisedAmount || ''}
                onChange={(e) => setPromisedAmount(parseFloat(e.target.value) || 0)}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  outline: 'none',
                  backgroundColor: '#ffffff',
                  fontWeight: 600,
                  color: '#170e5e',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                {t('accounting.collections.ar_promise_to_pay_modal.s4', "ملاحظات الاتفاق")}
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('accounting.collections.ar_promise_to_pay_modal.s5', "مثال: تم الاتفاق هاتفياً مع المدير المالي للشركة بالسداد بشيك أو تحويل بنكي...")}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '12.5px',
                  outline: 'none',
                  resize: 'none',
                  fontFamily: 'inherit',
                }}
              />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11.5px', color: '#64748b', backgroundColor: '#f1f5f9', padding: '8px 12px', borderRadius: '6px' }}>
          <ClockIcon size={14} color="#64748b" />
          <span>{t('accounting.collections.ar_promise_to_pay_modal.s6', "سيقوم النظام بمراقبة موعد السداد، وتصعيد الملف تلقائياً في حال عدم الالتزام.")}</span>
        </div>

        <StandardDialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t('accounting.collections.ar_promise_to_pay_modal.s7', "إلغاء")}
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            style={{ backgroundColor: '#170e5e', color: '#ffffff' }}
          >
            {isSubmitting ? t('accounting.collections.ar_promise_to_pay_modal.s8', "جاري الحفظ...") : t('accounting.collections.ar_promise_to_pay_modal.s9', "تثبيت تعهد السداد")}
          </Button>
        </StandardDialogFooter>
      </form>
    </StandardDialog>
  );
};
