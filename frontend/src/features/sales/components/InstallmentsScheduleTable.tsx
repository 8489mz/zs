import { useTranslation } from 'react-i18next';
import React from 'react';
import { Button } from '@/shared/ui/button';
import { formatCurrency, formatDateOnly } from '@/lib/format';
import { CustomerInstallmentItem } from '@/features/sales/api/installments.api';
import { MessageSquareIcon, CheckIcon } from '@/shared/components/icons/AppIcons';

export const installmentStatusBadges: Record<string, { label: string; bg: string; color: string }> = {
  pending: { label: 'قيد الانتظار', bg: '#f1f5f9', color: '#475569' },
  partially_paid: { label: 'مسدد جزئياً', bg: '#eff6ff', color: '#1d4ed8' },
  paid: { label: 'تم السداد', bg: '#dcfce7', color: '#166534' },
  overdue: { label: 'متأخر ومستحق', bg: '#fee2e2', color: '#991b1b' },
  active: { label: 'ساري ونشط', bg: '#e0f2fe', color: '#0369a1' },
  completed: { label: 'مكتمل بالكامل', bg: '#dcfce7', color: '#166534' },
};

interface InstallmentsScheduleTableProps {
  isLoading: boolean;
  installments: CustomerInstallmentItem[];
  onPay: (inst: CustomerInstallmentItem) => void;
  onSendReminder: (inst: CustomerInstallmentItem) => void;
}

export const InstallmentsScheduleTable: React.FC<InstallmentsScheduleTableProps> = ({
  isLoading,
  installments,
  onPay,
  onSendReminder,
}) => {
  const { t } = useTranslation();
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '13px' }}>
        <thead>
          <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
            <th style={{ padding: '12px 16px' }}>{t('sales.installments_schedule_table.s0', "رقم العقد")}</th>
            <th style={{ padding: '12px 16px' }}>{t('sales.installments_schedule_table.s1', "العميل")}</th>
            <th style={{ padding: '12px 16px' }}>{t('sales.installments_schedule_table.s2', "رقم القسط")}</th>
            <th style={{ padding: '12px 16px' }}>{t('sales.installments_schedule_table.s3', "تاريخ الاستحقاق")}</th>
            <th style={{ padding: '12px 16px' }}>{t('sales.installments_schedule_table.s4', "قيمة القسط")}</th>
            <th style={{ padding: '12px 16px' }}>{t('sales.installments_schedule_table.s5', "المبلغ المسدد")}</th>
            <th style={{ padding: '12px 16px' }}>{t('sales.installments_schedule_table.s6', "المتبقي")}</th>
            <th style={{ padding: '12px 16px' }}>{t('sales.installments_schedule_table.s7', "الحالة")}</th>
            <th style={{ padding: '12px 16px', textAlign: 'center' }}>{t('sales.installments_schedule_table.s8', "إجراء السداد والتذكير")}</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={9} style={{ textAlign: 'center', padding: '32px', color: '#64748b' }}>
                {t('sales.installments_schedule_table.s9', "جاري تحميل جدول الأقساط...")}
              </td>
            </tr>
          ) : installments.length === 0 ? (
            <tr>
              <td colSpan={9} style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>
                {t('sales.installments_schedule_table.s10', "لا توجد أقساط مطابقة للشروط المحددة")}
              </td>
            </tr>
          ) : (
            installments.map((inst) => {
              const badge = installmentStatusBadges[inst.status] || { label: inst.status, bg: '#f1f5f9', color: '#475569' };
              const rem = inst.remaining_installment ?? inst.remaining_amount ?? (Number(inst.amount) - Number(inst.paid_amount || 0));
              return (
                <tr key={inst.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 16px', fontWeight: '600' }}>
                    <span style={{ color: '#170e5e', fontFamily: 'monospace' }}>{inst.plan_number}</span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: '600', color: '#0f172a' }}>{inst.customer_name}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>{inst.customer_phone || '-'}</div>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ backgroundColor: '#f1f5f9', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: '600' }}>
                      #{inst.installment_number}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', color: inst.status === 'overdue' ? '#dc2626' : '#0f172a', fontWeight: inst.status === 'overdue' ? '700' : 'normal' }}>
                    {formatDateOnly(inst.due_date)}
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: '600' }}>
                    {formatCurrency(inst.amount)}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#166534' }}>
                    {formatCurrency(inst.paid_amount)}
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: 'bold', color: rem > 0 ? '#b91c1c' : '#166534' }}>
                    {formatCurrency(rem)}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span
                      style={{
                        backgroundColor: badge.bg,
                        color: badge.color,
                        padding: '4px 10px',
                        borderRadius: '20px',
                        fontSize: '11px',
                        fontWeight: '700',
                      }}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                    {inst.status !== 'paid' ? (
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                        <Button
                          variant="primary"
                          onClick={() => onPay(inst)}
                          style={{ padding: '4px 10px', fontSize: '12px' }}
                        >
                          {t('sales.installments_schedule_table.s11', "تحصيل دفعة")}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => onSendReminder(inst)}
                          disabled={!inst.customer_phone}
                          style={{
                            padding: '4px 8px',
                            fontSize: '11px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: '#f0fdf4',
                            borderColor: '#bbf7d0',
                            color: '#15803d',
                          }}
                          title={inst.customer_phone ? t('sales.installments_schedule_table.s12', "إرسال تذكير بموعد القسط عبر واتساب") : t('sales.installments_schedule_table.s13', "رقم الهاتف غير مسجل")}
                        >
                          <MessageSquareIcon size={13} />
                          <span>{t('sales.installments_schedule_table.s14', "تذكير")}</span>
                        </Button>
                      </div>
                    ) : (
                      <span style={{ fontSize: '12px', color: '#166534', fontWeight: '600', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <CheckIcon size={13} />
                        <span>{t('sales.installments_schedule_table.s15', "مسدد بالكامل")} {inst.receipt_no ? `(${inst.receipt_no})` : ''}</span>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
