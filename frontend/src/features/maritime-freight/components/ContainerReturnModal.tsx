import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { maritimeApi, MaritimeContainer } from '../api/maritime-freight.api';
import { todayLocalDateKey } from '@/lib/format';

interface ContainerReturnModalProps {
  open: boolean;
  container: MaritimeContainer | null;
  onClose: () => void;
  onUpdated: () => void;
}

export function ContainerReturnModal({ open, container, onClose, onUpdated }: ContainerReturnModalProps) {
  const { t } = useTranslation();
  const [emptyReturnedAt, setEmptyReturnedAt] = useState(todayLocalDateKey());
  const [depositStatus, setDepositStatus] = useState<'held_by_line' | 'pending_return_proof' | 'refunded_to_treasury'>('pending_return_proof');
  const [emptyReturnProofUrl, setEmptyReturnProofUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!container) return null;

  const handleSave = async () => {
    try {
      setIsSubmitting(true);
      setErrorMsg(null);
      await maritimeApi.updateContainer(container.id, {
        emptyReturnedAt,
        depositStatus,
        emptyReturnProofUrl: emptyReturnProofUrl || undefined,
        notes: notes || undefined,
      });

      onUpdated();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'فشل تسجيل إرجاع الحاوية');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={`إرجاع الحاوية الفارغة وتأمين الخط الملاحي: ${container.container_number}`}
      subtitle={`العملية: ${container.job_number} | الخط الملاحي: ${container.shipping_line_name}`}
      width="min(600px, 95vw)"
      footerActions={(
        <StandardDialogFooter
          onCancel={onClose}
          onSubmit={handleSave}
          isSubmitting={isSubmitting}
          submitText={t('maritime_freight.container_return_modal.s0', "تأكيد إرجاع الحاوية وتحديث التأمين")}
          cancelText={t('maritime_freight.container_return_modal.s1', "إلغاء")}
        />
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {errorMsg && (
          <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '0.85rem' }}>
            {errorMsg}
          </div>
        )}

        <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{t('maritime_freight.container_return_modal.s2', "مبلغ التأمين المحتجز لدى التوكيل")}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#170e5e', marginTop: '2px' }}>
              {Number(container.deposit_amount).toLocaleString()} {container.deposit_currency}
            </div>
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{t('maritime_freight.container_return_modal.s3', "أيام السماح / الموعد النهائي")}</div>
            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#334155' }}>
              {container.free_days} {t('maritime_freight.container_return_modal.s4', "يوم (")}{container.return_deadline || t('maritime_freight.container_return_modal.s5', "غير محدد")})
            </div>
          </div>
        </div>

        <Field label={t('maritime_freight.container_return_modal.s6', "تاريخ إرجاع الحاوية الفارغة للساحة (Return Date) *")}>
          <input
            type="date"
            value={emptyReturnedAt}
            onChange={(e) => setEmptyReturnedAt(e.target.value)}
            style={{ width: '100%', height: '38px', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.85rem' }}
          />
        </Field>

        <Field label={t('maritime_freight.container_return_modal.s7', "حالة مبلغ تأمين الحاوية *")}>
          <CustomSelect
            value={depositStatus}
            onChange={(val) => setDepositStatus(val as any)}
            options={[
              { value: 'pending_return_proof', label: t('maritime_freight.container_return_modal.s8', "بانتظار إشعار ومطابقة إيصال الرد من التوكيل (Pending Return Proof)") },
              { value: 'refunded_to_treasury', label: t('maritime_freight.container_return_modal.s9', "تم استرداد التأمين نقداً وإيداعه بالخزينة (Refunded to Treasury)") },
              { value: 'held_by_line', label: t('maritime_freight.container_return_modal.s10', "محتجز لدى الخط لوجود مطالبات أو غرامات (Held by Line)") },
            ]}
          />
        </Field>

        <Field label={t('maritime_freight.container_return_modal.s11', "رقم أو رابط إيصال إرجاع الفارغ (EIR / Yard Receipt)")}>
          <input
            type="text"
            value={emptyReturnProofUrl}
            onChange={(e) => setEmptyReturnProofUrl(e.target.value)}
            placeholder={t('maritime_freight.container_return_modal.s12', "مثال: رقم إيصال ساحة المستودع EIR-88231")}
            style={{ width: '100%', height: '38px', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.85rem' }}
          />
        </Field>

        <Field label={t('maritime_freight.container_return_modal.s13', "ملاحظات")}>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('maritime_freight.container_return_modal.s14', "حالة الحاوية عند التسليم، نظافة الأرضيات، إلخ")}
            style={{ width: '100%', height: '38px', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.85rem' }}
          />
        </Field>
      </div>
    </StandardDialog>
  );
}
