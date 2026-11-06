import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { customersApi } from '@/shared/api/customers.api';
import {
  getLoyaltyMovementLabel,
  resolveDisplayedLoyaltyBalance,
  summarizeLoyaltyLogs,
  type LoyaltyMovementTone,
} from '@/features/customers/lib/loyalty-movement-labels';
import { toast } from '@/shared/components/system-alert';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { Customer } from '@/types/domain';

interface CustomerLoyaltyModalProps {
  customer: Customer | null;
  onClose: () => void;
}

export function CustomerLoyaltyModal({ customer, onClose }: CustomerLoyaltyModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pointsChange, setPointsChange] = useState<number>(50);
  const [isDeduction, setIsDeduction] = useState(false);
  const [notes, setNotes] = useState('');
  // Server-confirmed balance from the last operation in this dialog. The
  // customer prop is a snapshot taken when the dialog opened and never
  // refreshes while it is open, so the card must not read it after an
  // operation or it stays stale until the dialog is closed and reopened.
  const [confirmedBalance, setConfirmedBalance] = useState<number | null>(null);

  useEffect(() => {
    setConfirmedBalance(null);
  }, [customer?.id]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['customer-loyalty-history', customer?.id],
    queryFn: () => (customer?.id ? customersApi.getLoyaltyHistory(customer.id) : Promise.resolve({ ok: true, logs: [] })),
    enabled: Boolean(customer?.id),
  });

  const adjustMutation = useMutation({
    mutationFn: () => {
      if (!customer?.id) return Promise.reject();
      const change = isDeduction ? -Math.abs(pointsChange) : Math.abs(pointsChange);
      return customersApi.adjustLoyaltyPoints(customer.id, change, notes.trim() || undefined, 'manual_adjust');
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer-loyalty-history', customer?.id] });
      refetch();
      if (result && typeof result.balance === 'number') setConfirmedBalance(result.balance);
      setNotes('');
      toast.success('تم تحديث رصيد نقاط الولاء بنجاح.');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل تحديث النقاط');
    },
  });

  if (!customer) return null;

  const logs = data?.logs || [];
  const { totalEarned, totalRedeemed } = summarizeLoyaltyLogs(logs);
  const currentBalance = resolveDisplayedLoyaltyBalance(confirmedBalance, Number((customer as any).loyaltyPoints || 0));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pointsChange <= 0) {
      toast.warning('يرجى تحديد عدد نقاط صحيح أكبر من صفر.');
      return;
    }
    adjustMutation.mutate();
  };

  return (
    <StandardDialog
      open={Boolean(customer)}
      onClose={onClose}
      title={`رصيد نقاط الولاء: ${customer.name}`}
      subtitle={t('customers.customer_loyalty_modal.s0', "إدارة وتعديل رصيد النقاط واستعراض سجل الحركات المكتسبة والمستبدلة")}
      width="min(680px, 95vw)"
      minHeight="auto"
      footerActions={(
        <StandardDialogFooter
          onCancel={onClose}
          cancelText={t('customers.customer_loyalty_modal.s1', "إغلاق")}
        />
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} dir="rtl">
        
        {/* Section 1: Summary Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 14px' }}>
            <div style={{ fontSize: '0.75rem', color: '#166534', fontWeight: 700 }}>{t('customers.customer_loyalty_modal.s2', "إجمالي النقاط المكتسبة")}</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#15803d', marginTop: '3px' }}>
              +{totalEarned.toLocaleString()}
            </div>
          </div>
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 14px' }}>
            <div style={{ fontSize: '0.75rem', color: '#991b1b', fontWeight: 700 }}>{t('customers.customer_loyalty_modal.s3', "إجمالي النقاط المستبدلة")}</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#b91c1c', marginTop: '3px' }}>
              {totalRedeemed.toLocaleString()}
            </div>
          </div>
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '10px 14px' }}>
            <div style={{ fontSize: '0.75rem', color: '#1e40af', fontWeight: 700 }}>{t('customers.customer_loyalty_modal.s4', "الرصيد الفعلي المتاح")}</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#1d4ed8', marginTop: '3px' }}>
              {currentBalance.toLocaleString()} {t('customers.customer_loyalty_modal.s5', "نقطة")}
            </div>
          </div>
        </div>

        {/* Section 2: Adjust Form */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
            <AppIcons.TrendingUp size={15} />
            <span>{t('customers.customer_loyalty_modal.s6', "إضافة أو خصم نقاط يدوياً (Manual Points Adjustment)")}</span>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                type="button"
                onClick={() => setIsDeduction(false)}
                style={{
                  height: '33px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  border: 'none',
                  cursor: 'pointer',
                  background: !isDeduction ? '#166534' : '#e2e8f0',
                  color: !isDeduction ? '#ffffff' : '#475569',
                  transition: 'background 0.15s',
                }}
              >
                {t('customers.customer_loyalty_modal.s7', "+ إضافة نقاط")}
              </button>
              <button
                type="button"
                onClick={() => setIsDeduction(true)}
                style={{
                  height: '33px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  border: 'none',
                  cursor: 'pointer',
                  background: isDeduction ? '#b91c1c' : '#e2e8f0',
                  color: isDeduction ? '#ffffff' : '#475569',
                  transition: 'background 0.15s',
                }}
              >
                {t('customers.customer_loyalty_modal.s8', "- خصم نقاط")}
              </button>
            </div>

            <input
              type="number"
              min="1"
              value={pointsChange}
              onChange={(e) => setPointsChange(Math.max(1, Number(e.target.value)))}
              style={{
                width: '90px',
                height: '33px',
                padding: '0 10px',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                fontSize: '0.8125rem',
                fontWeight: 700,
                textAlign: 'center',
                boxSizing: 'border-box',
              }}
            />

            <input
              type="text"
              placeholder={t('customers.customer_loyalty_modal.s9', "سبب العملية أو الملاحظة...")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{
                flex: '1 1 180px',
                height: '33px',
                padding: '0 10px',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                fontSize: '0.8125rem',
                boxSizing: 'border-box',
              }}
            />

            <Button
              variant="primary"
              type="submit"
              disabled={adjustMutation.isPending}
              style={{
                height: '33px',
                background: isDeduction ? '#b91c1c' : '#166534',
                borderColor: isDeduction ? '#991b1b' : '#15803d',
                fontSize: '0.8125rem',
                fontWeight: 700,
                padding: '0 16px',
              }}
            >
              {adjustMutation.isPending ? t('customers.customer_loyalty_modal.s10', "جاري التنفيذ...") : t('customers.customer_loyalty_modal.s11', "تنفيذ العملية")}
            </Button>
          </form>
        </div>

        {/* Section 3: History Table */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', fontWeight: 700, color: '#334155' }}>
            <AppIcons.Clock size={14} />
            <span>{t('customers.customer_loyalty_modal.s12', "سجل حركات ونقاط العميل (Transaction History)")}</span>
          </div>
          <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '0.8125rem' }}>{t('customers.customer_loyalty_modal.s13', "جاري التحميل...")}</div>
            ) : logs.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '0.8125rem' }}>
                {t('customers.customer_loyalty_modal.s14', "لا توجد حركات نقاط سابقة لهذا العميل.")}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'right', position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '7px 12px' }}>{t('customers.customer_loyalty_modal.s15', "التاريخ")}</th>
                    <th style={{ padding: '7px 12px' }}>{t('customers.customer_loyalty_modal.s16', "نوع الحركة")}</th>
                    <th style={{ padding: '7px 12px' }}>{t('customers.customer_loyalty_modal.s17', "عدد النقاط")}</th>
                    <th style={{ padding: '7px 12px' }}>{t('customers.customer_loyalty_modal.s18', "الرصيد بعد")}</th>
                    <th style={{ padding: '7px 12px' }}>{t('customers.customer_loyalty_modal.s19', "الملاحظات")}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log: any) => {
                    const label = getLoyaltyMovementLabel(log.action_type, Number(log.points_change));
                    const toneStyle: Record<LoyaltyMovementTone, { background: string; color: string }> = {
                      earn: { background: '#dcfce7', color: '#15803d' },
                      redeem: { background: '#fee2e2', color: '#b91c1c' },
                      clawback: { background: '#fef3c7', color: '#b45309' },
                      refund: { background: '#e0e7ff', color: '#4338ca' },
                      neutral: { background: '#f1f5f9', color: '#475569' },
                    };
                    const badgeStyle = toneStyle[label.tone];
                    const actionBadge = (
                      <span style={{ background: badgeStyle.background, color: badgeStyle.color, padding: '2px 7px', borderRadius: '4px', fontWeight: 700 }}>
                        {t(`customers.customer_loyalty_modal.${label.key}`, label.fallback)}
                      </span>
                    );

                    return (
                      <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '7px 12px', color: '#64748b' }}>
                          {new Date(log.created_at).toLocaleDateString('ar-EG')}
                        </td>
                        <td style={{ padding: '7px 12px' }}>
                          {actionBadge}
                        </td>
                        <td style={{ padding: '7px 12px', fontWeight: 800, color: Number(log.points_change) > 0 ? '#166534' : '#b91c1c' }}>
                          {Number(log.points_change) > 0 ? `+${log.points_change}` : log.points_change}
                        </td>
                        <td style={{ padding: '7px 12px', fontWeight: 700, color: '#170e5e' }}>{log.balance_after}</td>
                        <td style={{ padding: '7px 12px', color: '#64748b' }}>{log.notes || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>
    </StandardDialog>
  );
}
