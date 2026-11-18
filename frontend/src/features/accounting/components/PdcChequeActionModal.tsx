import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerClock } from '@/shared/hooks/use-server-clock';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { FileTextIcon, CalendarIcon, AlertTriangleIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency, todayLocalDateKey } from '@/lib/format';
import { pdcChequesApi, type PdcCheque } from '../api/accounting.api';

export type PdcActionType = 'deposit' | 'collect' | 'clear' | 'bounce' | 'endorse' | 'return' | null;

export interface PdcChequeActionModalProps {
  open: boolean;
  action: PdcActionType;
  cheque: PdcCheque | null;
  onClose: () => void;
  onSuccess?: () => void;
  /** Server instant (ISO) from the page's cheques list response. */
  serverTime?: string;
  /** Tenant zone from the page's cheques list response. */
  serverTimezone?: string;
}

const BOUNCE_REASON_OPTIONS = [
  { value: 'عدم كفاية الرصيد', label: 'عدم كفاية الرصيد (رفض مالي)' },
  { value: 'اختلاف التوقيع', label: 'اختلاف التوقيع عن نموذج البنك' },
  { value: 'شيك ملغى أو عليه أمر إيقاف صرف', label: 'شيك ملغى أو عليه أمر إيقاف صرف' },
  { value: 'خطأ أو شطب في كتابة المبلغ أو التاريخ', label: 'خطأ أو شطب في كتابة المبلغ أو التاريخ' },
  { value: 'الحساب مغلق بالبنك', label: 'الحساب مغلق بالبنك' },
  { value: 'سبب بنكي آخر', label: 'سبب بنكي آخر' },
];

export function PdcChequeActionModal({
  open,
  action,
  cheque,
  onClose,
  onSuccess,
  serverTime,
  serverTimezone,
}: PdcChequeActionModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const serverClock = useServerClock(serverTime, serverTimezone);
  const [actionDate, setActionDate] = useState(() => todayLocalDateKey());
  const [bouncedReason, setBouncedReason] = useState('عدم كفاية الرصيد');
  const [bouncedFee, setBouncedFee] = useState('0');
  const [endorsedSupplier, setEndorsedSupplier] = useState('');
  const [actionNotes, setActionNotes] = useState('');
  const [settlementRate, setSettlementRate] = useState('');

  useEffect(() => {
    if (open) {
      // P8 (RC-7): default the action date from the server day in the
      // tenant zone — the old default was a UTC slice, yesterday for the
      // first two hours after midnight (UTC+2). The input stays editable.
      setActionDate(serverClock.todayKey() || todayLocalDateKey());
      setBouncedReason('عدم كفاية الرصيد');
      setBouncedFee('0');
      setEndorsedSupplier('');
      setActionNotes('');
      setSettlementRate('');
    }
  }, [open, action]);

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: any }) =>
      pdcChequesApi.updateStatus(id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pdc-cheques-list'] });
      void queryClient.invalidateQueries({ queryKey: ['pdc-cheques-stats'] });
      if (onSuccess) onSuccess();
      onClose();
    },
  });

  const handleActionSubmit = () => {
    if (!cheque || !action) return;

    const payload: any = {
      action,
      actionDate,
      notes: actionNotes.trim() || undefined,
      settlementExchangeRate: settlementRate ? Number(settlementRate) : undefined,
    };

    if (action === 'bounce') {
      payload.bouncedReason = bouncedReason;
      payload.bouncedFee = Number(bouncedFee) || 0;
    } else if (action === 'endorse') {
      payload.endorsedToSupplierName = endorsedSupplier.trim();
    }

    updateStatusMutation.mutate({ id: cheque.id, payload });
  };

  if (!open || !cheque || !action) return null;

  const getDialogTitle = () => {
    if (action === 'deposit') return 'إيداع الشيك برسم التحصيل بالبنك';
    if (action === 'collect') return 'تأكيد تحصيل الشيك بالبنك';
    if (action === 'clear') return 'تأكيد صرف ورقة الدفع بنكياً';
    if (action === 'bounce') return 'تسجيل ارتداد / رفض الشيك';
    if (action === 'endorse') return 'تظهير الشيك لمورد';
    if (action === 'return') return 'إرجاع الشيك للعميل';
    return 'إجراء على الشيك';
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={getDialogTitle()}
      subtitle={t('accounting.pdc_cheque_action_modal.s0', "تنفيذ الحركة المحاسبية وتحديث حالة الشيك في الحافظة")}
      size="md"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {(action === 'collect' || action === 'clear') && <label className="field">
          <span>{t('accounting.arch02.settlementRate', 'سعر الصرف الفعلي للتسوية (اختياري؛ الافتراضي السعر المسجل)')}</span>
          <input type="number" min="0.000001" step="0.000001" value={settlementRate} onChange={event => setSettlementRate(event.target.value)} />
        </label>}
        {/* Card 1: Cheque Details Card */}
        <div style={{
          backgroundColor: '#f8fafc',
          borderRadius: '10px',
          padding: '14px 16px',
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px' }}>
            <FileTextIcon size={15} style={{ color: '#170e5e' }} />
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>{t('accounting.pdc_cheque_action_modal.s1', "بيانات الشيك الحالي")}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', backgroundColor: '#ffffff', borderRadius: '6px', border: '1px solid #f1f5f9' }}>
              <span style={{ color: '#64748b' }}>{t('accounting.pdc_cheque_action_modal.s2', "رقم الشيك:")}</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1e293b' }}>
                {cheque.cheque_number}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', backgroundColor: '#ffffff', borderRadius: '6px', border: '1px solid #f1f5f9' }}>
              <span style={{ color: '#64748b' }}>{t('accounting.pdc_cheque_action_modal.s3', "الطرف:")}</span>
              <span style={{ fontWeight: 600, color: '#1e293b' }}>{cheque.partner_name}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', backgroundColor: '#ffffff', borderRadius: '6px', border: '1px solid #f1f5f9' }}>
              <span style={{ color: '#64748b' }}>{t('accounting.pdc_cheque_action_modal.s4', "المبلغ:")}</span>
              <span style={{ fontWeight: 800, color: '#047857' }}>
                {formatCurrency(cheque.amount)} {cheque.currency}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', backgroundColor: '#ffffff', borderRadius: '6px', border: '1px solid #f1f5f9' }}>
              <span style={{ color: '#64748b' }}>{t('accounting.pdc_cheque_action_modal.s5', "البنك:")}</span>
              <span style={{ fontWeight: 600, color: '#334155' }}>{cheque.bank_name}</span>
            </div>
          </div>
        </div>

        {/* Card 2: Action Inputs Card */}
        <div style={{
          backgroundColor: '#f8fafc',
          borderRadius: '10px',
          padding: '14px 16px',
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px' }}>
            <CalendarIcon size={15} style={{ color: '#170e5e' }} />
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>{t('accounting.pdc_cheque_action_modal.s6', "تفاصيل حركة التنفيذ")}</span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              {t('accounting.pdc_cheque_action_modal.s7', "تاريخ الإجراء")} <span style={{ color: '#e11d48' }}>*</span>
            </label>
            <input
              type="date"
              value={actionDate}
              onChange={(e) => setActionDate(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                fontSize: '12px',
                color: '#1e293b',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {action === 'bounce' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px', backgroundColor: '#fff1f2', borderRadius: '8px', border: '1px solid #fecdd3' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#be123c', fontWeight: 700, fontSize: '12px' }}>
                <AlertTriangleIcon size={16} />
                <span>{t('accounting.pdc_cheque_action_modal.s8', "بيانات الرفض والارتداد البنكي")}</span>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('accounting.pdc_cheque_action_modal.s9', "سبب الرفض / الارتداد")} <span style={{ color: '#e11d48' }}>*</span>
                </label>
                <CustomSelect
                  value={bouncedReason}
                  onChange={(val) => setBouncedReason(val)}
                  options={BOUNCE_REASON_OPTIONS}
                  placeholder={t('accounting.pdc_cheque_action_modal.s10', "اختر سبب الارتداد")}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('accounting.pdc_cheque_action_modal.s11', "مصاريف الرفض البنكية (إن وجدت)")}
                </label>
                <input
                  type="number"
                  value={bouncedFee}
                  onChange={(e) => setBouncedFee(e.target.value)}
                  placeholder="0.00"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    fontSize: '12px',
                    color: '#1e293b',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          )}

          {action === 'endorse' && (
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('accounting.pdc_cheque_action_modal.s12', "اسم المورد المراد تظهير الشيك إليه")} <span style={{ color: '#e11d48' }}>*</span>
              </label>
              <input
                type="text"
                value={endorsedSupplier}
                onChange={(e) => setEndorsedSupplier(e.target.value)}
                placeholder={t('accounting.pdc_cheque_action_modal.s13', "اسم المورد المستحق للسداد")}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  fontSize: '12px',
                  color: '#1e293b',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              {t('accounting.pdc_cheque_action_modal.s14', "ملاحظات")}
            </label>
            <input
              type="text"
              value={actionNotes}
              onChange={(e) => setActionNotes(e.target.value)}
              placeholder={t('accounting.pdc_cheque_action_modal.s15', "ملاحظات حول الإجراء...")}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                fontSize: '12px',
                color: '#1e293b',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>
      </div>

      <StandardDialogFooter>
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
          style={{ padding: '8px 18px', fontSize: '13px', borderRadius: '8px' }}
        >
          {t('accounting.pdc_cheque_action_modal.s16', "إلغاء")}
        </Button>
        <Button
          type="button"
          onClick={handleActionSubmit}
          disabled={updateStatusMutation.isPending || (action === 'endorse' && !endorsedSupplier.trim())}
          style={{
            backgroundColor: '#170e5e',
            color: '#ffffff',
            padding: '8px 22px',
            fontSize: '13px',
            fontWeight: 700,
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            opacity: updateStatusMutation.isPending ? 0.6 : 1,
          }}
        >
          {updateStatusMutation.isPending ? t('accounting.pdc_cheque_action_modal.s17', "جاري التنفيذ...") : t('accounting.pdc_cheque_action_modal.s18', "تأكيد الإجراء")}
        </Button>
      </StandardDialogFooter>
    </StandardDialog>
  );
}
