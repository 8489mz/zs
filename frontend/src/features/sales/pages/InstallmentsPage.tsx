import { useTranslation } from 'react-i18next';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { PageHeader } from '@/shared/components/page-header';
import { StatsGrid } from '@/shared/components/stats-grid';
import { formatCurrency } from '@/lib/format';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import {
  installmentsApi,
  type InstallmentPlanItem,
  type CustomerInstallmentItem,
} from '@/features/sales/api/installments.api';
import { useCustomersListInstallmentsQuery } from '@/shared/hooks/use-catalog-queries';
import { openWhatsAppChat, formatInstallmentReminderMessage } from '@/lib/whatsapp';
import { InstallmentsScheduleTable } from '../components/InstallmentsScheduleTable';
import { InstallmentPlansTable } from '../components/InstallmentPlansTable';
import { CreateInstallmentPlanModal } from '../components/CreateInstallmentPlanModal';
import { InstallmentModalsManager } from '../components/InstallmentModalsManager';

export function InstallmentsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'schedule' | 'plans'>('schedule');
  const [scheduleStatusFilter, setScheduleStatusFilter] = useState<'all' | 'overdue' | 'due_now' | 'pending' | 'paid'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [createPlanModalOpen, setCreatePlanModalOpen] = useState(false);
  const [payModalInstallment, setPayModalInstallment] = useState<CustomerInstallmentItem | null>(null);
  const [payAmount, setPayAmount] = useState<string>('');
  const [payMethod, setPayMethod] = useState<'cash' | 'card' | 'bank_transfer' | 'instapay'>('cash');
  const [payNotes, setPayNotes] = useState('');
  const [selectedPlanDetails, setSelectedPlanDetails] = useState<InstallmentPlanItem | null>(null);
  const [receiptData, setReceiptData] = useState<{
    receipt_no: string;
    paid_amount: number;
    installment_number: number;
    paid_at: string;
    payment_method: string;
    customer_name: string;
    customer_phone: string;
  } | null>(null);

  // Queries
  const metricsQuery = useQuery({
    queryKey: ['installments-metrics'],
    queryFn: installmentsApi.getMetrics,
  });

  const customersQuery = useCustomersListInstallmentsQuery();

  const scheduleQuery = useQuery({
    queryKey: ['installments-schedule', scheduleStatusFilter, searchQuery],
    queryFn: async () => {
      const res = await installmentsApi.listSchedule({
        status: scheduleStatusFilter,
        search: searchQuery,
      });
      return res.installments || [];
    },
  });

  const filteredSchedule = useMemo(() => {
    const list = scheduleQuery.data || [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((inst) =>
      String(inst.plan_number || '').toLowerCase().includes(q) ||
      String(inst.customer_name || '').toLowerCase().includes(q) ||
      String(inst.customer_phone || '').toLowerCase().includes(q)
    );
  }, [scheduleQuery.data, searchQuery]);

  const plansQuery = useQuery({
    queryKey: ['installments-plans', searchQuery],
    queryFn: async () => {
      const res = await installmentsApi.listPlans({
        search: searchQuery,
      });
      return res.plans || [];
    },
  });

  const planDetailsQuery = useQuery({
    queryKey: ['installment-plan-details', selectedPlanDetails?.id],
    queryFn: async () => {
      if (!selectedPlanDetails?.id) return null;
      return await installmentsApi.getPlanDetails(selectedPlanDetails.id);
    },
    enabled: !!selectedPlanDetails?.id,
  });

  // Mutations
  const createPlanMutation = useMutation({
    mutationFn: (data: any) => installmentsApi.createPlan(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['installments-plans'] });
      queryClient.invalidateQueries({ queryKey: ['installments-schedule'] });
      setCreatePlanModalOpen(false);
    },
  });

  const payMutation = useMutation({
    mutationFn: async () => {
      if (!payModalInstallment) return;
      return await installmentsApi.payInstallment(payModalInstallment.id, {
        amount: Number(payAmount),
        paymentMethod: payMethod,
        notes: payNotes,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['installments-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['installments-plans'] });
      queryClient.invalidateQueries({ queryKey: ['installments-schedule'] });
      if (selectedPlanDetails) {
        queryClient.invalidateQueries({ queryKey: ['installment-plan-details', selectedPlanDetails.id] });
      }
      setPayModalInstallment(null);
      if (data?.receipt) {
        setReceiptData(data.receipt);
      }
    },
  });

  const openPayModal = (inst: CustomerInstallmentItem) => {
    const remaining = inst.remaining_installment ?? (Number(inst.amount) - Number(inst.paid_amount || 0));
    setPayModalInstallment(inst);
    setPayAmount(String(remaining > 0 ? remaining : inst.amount));
    setPayMethod('cash');
    setPayNotes('');
  };

  const handleSendInstallmentReminder = (inst: CustomerInstallmentItem) => {
    if (!inst.customer_phone) {
      alert('رقم هاتف العميل غير مسجل لهذا القسط.');
      return;
    }
    const message = formatInstallmentReminderMessage({
      customerName: inst.customer_name || 'العميل',
      installmentNumber: inst.installment_number,
      totalInstallments: inst.installment_count,
      amount: inst.amount,
      dueDate: inst.due_date,
      planNumber: inst.plan_number,
    });
    openWhatsAppChat(inst.customer_phone, message);
  };

  const handleSendReceiptWhatsApp = () => {
    if (!receiptData) return;
    if (!receiptData.customer_phone) {
      alert('رقم هاتف العميل غير متوفر.');
      return;
    }
    const formattedDate = new Date(receiptData.paid_at).toLocaleDateString('ar-EG');
    const message = `مرحباً أستاذ/ة *${receiptData.customer_name}*،\nتم استلام دفعة قسطكم بنجاح!\n• رقم الإيصال: *#${receiptData.receipt_no}*\n• المبلغ المسدد: *${Number(receiptData.paid_amount).toLocaleString()} ${getGlobalCurrencySymbol()}*\n• القسط: *#${receiptData.installment_number}*\n• طريقة الدفع: ${receiptData.payment_method}\n• التاريخ: ${formattedDate}\n\nشكراً لتعاملكم معنا!`;
    openWhatsAppChat(receiptData.customer_phone, message);
  };

  const metrics = metricsQuery.data || {
    active_plans: 0,
    total_plans: 0,
    active_total_amount: 0,
    total_collected: 0,
    unpaid_amount: 0,
    overdue_count: 0,
    overdue_amount: 0,
  };

  const stats = [
    { key: 'active', label: 'الخطط والعقود النشطة', value: formatCurrency(metrics.active_total_amount) },
    { key: 'collected', label: 'إجمالي المبالغ المحصلة', value: formatCurrency(metrics.total_collected) },
    { key: 'unpaid', label: 'المتبقي قيد التحصيل', value: formatCurrency(metrics.unpaid_amount) },
    { key: 'overdue', label: 'الأقساط المتأخرة المستحقة', value: `${formatCurrency(metrics.overdue_amount)} (${metrics.overdue_count} قسط)` },
  ] as const;

  return (
    <div className="page-stack page-shell installments-workspace" dir="rtl">
      <div className="document-prototype-column" style={{ paddingBottom: '32px' }}>
        <PageHeader
          title={t('sales.installments_page.s0', "نظام إدارة أقساط العملاء (Installments Engine)")}
          description={t('sales.installments_page.s1', "جدولة وتوزيع مبيعات الآجل على أقساط شهرية، احتساب نسب الفائدة، ومتابعة التحصيلات والإيصالات.")}
          badge={<span className="nav-pill">{metrics.active_plans} {t('sales.installments_page.s2', "عقد نشط")}</span>}
          actions={
            <div className="actions compact-actions">
              <Button
                variant="primary"
                onClick={() => setCreatePlanModalOpen(true)}
              >
                {t('sales.installments_page.s3', "+ إنشاء خطة تقسيط جديدة")}
              </Button>
            </div>
          }
        />

        <StatsGrid items={stats} />

        <section className="document-prototype-section">
          <div className="section-header-compact-row" style={{ marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button
                type="button"
                variant={activeTab === 'schedule' ? 'primary' : 'secondary'}
                onClick={() => setActiveTab('schedule')}
              >
                {t('sales.installments_page.s4', "جدول الأقساط والاستحقاقات")}
              </Button>
              <Button
                type="button"
                variant={activeTab === 'plans' ? 'primary' : 'secondary'}
                onClick={() => setActiveTab('plans')}
              >
                {t('sales.installments_page.s5', "عقود وخطط التقسيط")}
              </Button>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder={t('sales.installments_page.s6', "بحث برقم الخطة، اسم العميل، الهاتف...")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  padding: '7px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  width: '240px',
                  outline: 'none',
                }}
              />

              {activeTab === 'schedule' && (
                <select
                  value={scheduleStatusFilter}
                  onChange={(e) => setScheduleStatusFilter(e.target.value as any)}
                  style={{
                    padding: '7px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    outline: 'none',
                    backgroundColor: '#ffffff',
                  }}
                >
                  <option value="all">{t('sales.installments_page.s7', "كل الحالات")}</option>
                  <option value="overdue">{t('sales.installments_page.s8', "المتأخرة فقط")}</option>
                  <option value="due_now">{t('sales.installments_page.s9', "مستحقة اليوم أو قبل")}</option>
                  <option value="pending">{t('sales.installments_page.s10', "غير مسددة")}</option>
                  <option value="paid">{t('sales.installments_page.s11', "المسددة")}</option>
                </select>
              )}
            </div>
          </div>

          {activeTab === 'schedule' ? (
            <InstallmentsScheduleTable
              isLoading={scheduleQuery.isLoading}
              installments={filteredSchedule}
              onPay={openPayModal}
              onSendReminder={handleSendInstallmentReminder}
            />
          ) : (
            <InstallmentPlansTable
              isLoading={plansQuery.isLoading}
              plans={plansQuery.data || []}
              onViewDetails={(plan) => setSelectedPlanDetails(plan)}
            />
          )}
        </section>
      </div>

      <CreateInstallmentPlanModal
        open={createPlanModalOpen}
        onClose={() => setCreatePlanModalOpen(false)}
        customers={customersQuery.data || []}
        onSubmit={(data) => createPlanMutation.mutate(data)}
        isPending={createPlanMutation.isPending}
      />

      <InstallmentModalsManager
        payModalInstallment={payModalInstallment}
        onClosePayModal={() => setPayModalInstallment(null)}
        payAmount={payAmount}
        onChangePayAmount={setPayAmount}
        payMethod={payMethod}
        onChangePayMethod={setPayMethod}
        payNotes={payNotes}
        onChangePayNotes={setPayNotes}
        onConfirmPay={() => payMutation.mutate()}
        isPaying={payMutation.isPending}
        receiptData={receiptData}
        onCloseReceipt={() => setReceiptData(null)}
        onSendReceiptWhatsApp={handleSendReceiptWhatsApp}
        selectedPlanDetails={selectedPlanDetails}
        onClosePlanDetails={() => setSelectedPlanDetails(null)}
        planDetailsSchedule={planDetailsQuery.data?.installments || []}
        onOpenPayForInstallment={openPayModal}
      />
    </div>
  );
}
