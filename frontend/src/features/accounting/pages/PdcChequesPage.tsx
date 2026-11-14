import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { formatCurrency } from '@/lib/format';
import {
  PlusIcon,
  RefreshCwIcon,
  DownloadIcon,
} from '@/shared/components/icons/AppIcons';
import {
  pdcChequesApi,
  type PdcCheque,
  type PdcChequesStats,
  type ChequeType,
} from '@/features/accounting/api/accounting.api';
import { PageHeader } from '@/shared/components/page-header';
import { StatsGrid } from '@/shared/components/stats-grid';
import { useAppToolbar } from '@/stores/toolbar-store';
import { PdcChequeCreateModal } from '../components/PdcChequeCreateModal';
import { PdcChequeActionModal, type PdcActionType } from '../components/PdcChequeActionModal';
import { PdcChequeVoucherModal } from '../components/PdcChequeVoucherModal';
import { PdcChequesFilterToolbar } from '../components/PdcChequesFilterToolbar';
import { PdcChequesTable, STATUS_LABELS } from '../components/PdcChequesTable';
import { TreasuryNavTabs } from '@/features/treasury';

export function PdcChequesPage() {
  const { t } = useTranslation();
  useAppToolbar([{ label: 'المالية والمحاسبة', to: '/accounting' }, { label: 'حافظة الشيكات (PDC)' }]);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'receivable' | 'payable' | 'alerts'>('receivable');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createChequeType, setCreateChequeType] = useState<ChequeType>('receivable');
  const [selectedCheque, setSelectedCheque] = useState<PdcCheque | null>(null);
  const [activeActionModal, setActiveActionModal] = useState<PdcActionType | 'voucher'>(null);


  // Queries
  const statsQuery = useQuery({
    queryKey: ['pdc-cheques-stats'],
    queryFn: () => pdcChequesApi.stats(),
  });

  const chequesQuery = useQuery({
    queryKey: [
      'pdc-cheques-list',
      activeTab === 'alerts' ? undefined : activeTab,
      statusFilter,
      search,
      dueFrom,
      dueTo,
    ],
    queryFn: () =>
      pdcChequesApi.list({
        type: activeTab === 'alerts' ? undefined : activeTab,
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: search.trim() || undefined,
        dueFrom: dueFrom || undefined,
        dueTo: dueTo || undefined,
        limit: 100,
      }),
  });

  // Mutations
  const updateStatusMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: any }) =>
      pdcChequesApi.updateStatus(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdc-cheques-list'] });
      queryClient.invalidateQueries({ queryKey: ['pdc-cheques-stats'] });
      setActiveActionModal(null);
      setSelectedCheque(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => pdcChequesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdc-cheques-list'] });
      queryClient.invalidateQueries({ queryKey: ['pdc-cheques-stats'] });
    },
  });

  const openCreateModal = (type: ChequeType) => {
    setCreateChequeType(type);
    setShowCreateModal(true);
  };

  const handleDirectAction = (cheque: PdcCheque, action: 'restore_to_safe' | 'cancel') => {
    if (!confirm(`هل أنت متأكد من تنفيذ هذا الإجراء للشيك رقم ${cheque.cheque_number}؟`)) return;
    updateStatusMutation.mutate({
      id: cheque.id,
      payload: { action },
    });
  };

  const handleDeleteCheque = (cheque: PdcCheque) => {
    if (!confirm(`هل أنت متأكد من حذف الشيك رقم ${cheque.cheque_number} نهائياً؟`)) return;
    deleteMutation.mutate(cheque.id);
  };

  const stats: PdcChequesStats | undefined = statsQuery.data;
  const cheques: PdcCheque[] = chequesQuery.data?.data || [];

  const todayStr = new Date().toISOString().slice(0, 10);
  const in7DaysStr = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Filter for alerts tab
  const displayedCheques = activeTab === 'alerts'
    ? cheques.filter((c) => {
        const isSettled = ['collected', 'cleared', 'cancelled', 'returned'].includes(c.status);
        if (isSettled) return false;
        return c.due_date < todayStr || (c.due_date >= todayStr && c.due_date <= in7DaysStr);
      })
    : cheques;

  // Export to CSV
  const handleExportCsv = () => {
    if (displayedCheques.length === 0) return;
    const headers = [
      'رقم الشيك',
      'النوع',
      'الطرف (العميل/المورد)',
      'البنك المسحوب عليه',
      'الفرع',
      'المبلغ',
      'العملة',
      'تاريخ التحرير',
      'تاريخ الاستحقاق',
      'الحالة',
      'ملاحظات',
    ];
    const rows = displayedCheques.map((c) => [
      `"${c.cheque_number}"`,
      c.type === 'receivable' ? 'ورقة قبض' : 'ورقة دفع',
      `"${c.partner_name}"`,
      `"${c.bank_name}"`,
      `"${c.branch_name || ''}"`,
      c.amount,
      c.currency,
      c.issue_date,
      c.due_date,
      STATUS_LABELS[c.status]?.text || c.status,
      `"${c.notes || ''}"`,
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `PDC_Cheques_${activeTab}_${todayStr}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-stack page-shell pdc-cheques-page" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '100px', width: '100%' }}>
        <PageHeader
          title={t('accounting.pdc_cheques_page.s0', "حافظة الشيكات وأوراق القبض والدفع (PDC)")}
          description={t('accounting.pdc_cheques_page.s1', "إدارة دورة أوراق القبض والدفع، الإيداع البنكي برسم التحصيل، الصرف، الارتداد، والتظهير.")}
          badge={<span className="nav-pill">{(stats?.receivables.totalCount || 0) + (stats?.payables.totalCount || 0)} {t('accounting.pdc_cheques_page.s2', "شيك")}</span>}
          actions={(
            <div className="actions compact-actions page-header-actions">
              <Button
                onClick={() => openCreateModal('receivable')}
                className="btn btn-primary flex items-center gap-1.5"
                style={{ backgroundColor: '#170e5e', color: '#ffffff' }}
              >
                <PlusIcon size={15} />
                <span>{t('accounting.pdc_cheques_page.s3', "+ تسجيل ورقة قبض")}</span>
              </Button>

              <Button
                onClick={() => openCreateModal('payable')}
                variant="secondary"
                className="flex items-center gap-1.5"
              >
                <PlusIcon size={15} />
                <span>{t('accounting.pdc_cheques_page.s4', "+ تحرير ورقة دفع")}</span>
              </Button>

              <Button
                onClick={handleExportCsv}
                variant="secondary"
                className="flex items-center gap-1"
                title={t('accounting.pdc_cheques_page.s5', "تصدير إلى CSV")}
              >
                <DownloadIcon size={14} />
                <span>{t('accounting.pdc_cheques_page.s6', "تصدير")}</span>
              </Button>

              <Button
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ['pdc-cheques-list'] });
                  queryClient.invalidateQueries({ queryKey: ['pdc-cheques-stats'] });
                }}
                variant="secondary"
                className="flex items-center gap-1"
                title={t('accounting.pdc_cheques_page.s7', "تحديث البيانات")}
              >
                <RefreshCwIcon size={14} />
                <span>{t('accounting.pdc_cheques_page.s8', "تحديث")}</span>
              </Button>
            </div>
          )}
        />

        <TreasuryNavTabs currentTab="cheques" />

        {/* KPI Metric Summary Cards */}
        <div style={{ marginBottom: '16px' }}>
          <StatsGrid
            items={[
              {
                key: 'rec',
                label: t('accounting.pdc_cheques_page.s9', "أوراق القبض (عملاء)"),
                value: `${formatCurrency(stats?.receivables.totalAmount || 0)} (${stats?.receivables.totalCount || 0})`,
              },
              {
                key: 'safe',
                label: t('accounting.pdc_cheques_page.s10', "في الخزينة (جاهزة للإيداع)"),
                value: `${formatCurrency(stats?.receivables.inSafeAmount || 0)} (${stats?.receivables.inSafeCount || 0})`,
              },
              {
                key: 'col',
                label: t('accounting.pdc_cheques_page.s11', "برسم التحصيل بالبنك"),
                value: `${formatCurrency(stats?.receivables.underCollectionAmount || 0)} (${stats?.receivables.underCollectionCount || 0})`,
              },
              {
                key: 'pay',
                label: t('accounting.pdc_cheques_page.s12', "أوراق الدفع (موردين)"),
                value: `${formatCurrency(stats?.payables.totalAmount || 0)} (${stats?.payables.issuedCount || 0})`,
              },
            ]}
          />
        </div>

        {/* Main Workspace Panel & Table */}
        <section className="document-prototype-section workspace-panel">
          <div className="section-header-compact-row">
            <h3 className="document-prototype-section-title">{t('accounting.pdc_cheques_page.s13', "حافظة وسجل الشيكات البنكية")}</h3>
            <div className="section-header-actions-group">
              <span className="text-xs text-slate-500 font-medium">{t('accounting.pdc_cheques_page.s14', "عرض")} {displayedCheques.length} {t('accounting.pdc_cheques_page.s15', "شيك")}</span>
            </div>
          </div>
          <p className="muted small section-header-subtitle">
            {t('accounting.pdc_cheques_page.s16', "متابعة استحقاق الشيكات، الإيداع، الصرف البنكي، والارتداد والتظهير المحاسبي.")}
          </p>

          <PdcChequesFilterToolbar
            activeTab={activeTab}
            onTabChange={(tab) => {
              setActiveTab(tab);
              setStatusFilter('all');
            }}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            search={search}
            onSearchChange={setSearch}
            dueFrom={dueFrom}
            onDueFromChange={setDueFrom}
            dueTo={dueTo}
            onDueToChange={setDueTo}
            stats={stats}
            onReset={() => {
              setSearch('');
              setDueFrom('');
              setDueTo('');
              setStatusFilter('all');
            }}
          />

          <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', backgroundColor: '#ffffff' }}>
            <PdcChequesTable
              isLoading={chequesQuery.isLoading}
              cheques={displayedCheques}
              todayStr={todayStr}
              in7DaysStr={in7DaysStr}
              onOpenActionModal={(c, act) => {
                setSelectedCheque(c);
                setActiveActionModal(act);
              }}
              onDirectAction={handleDirectAction}
              onDeleteCheque={handleDeleteCheque}
            />
          </div>
        </section>
      </main>

      {/* Modal 1: Register New Cheque */}
      <PdcChequeCreateModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        chequeType={createChequeType}
      />

      {/* Modal 2: Lifecycle Actions (Deposit, Collect, Clear, Bounce, Endorse) */}
      <PdcChequeActionModal
        open={Boolean(activeActionModal && activeActionModal !== 'voucher' && selectedCheque)}
        action={activeActionModal as PdcActionType}
        cheque={selectedCheque}
        serverTime={chequesQuery.data?.serverTime}
        serverTimezone={chequesQuery.data?.serverTimezone}
        onClose={() => {
          setActiveActionModal(null);
          setSelectedCheque(null);
        }}
      />

      {/* Modal 3: Cheque Voucher Print Preview */}
      <PdcChequeVoucherModal
        open={Boolean(activeActionModal === 'voucher' && selectedCheque)}
        cheque={selectedCheque}
        onClose={() => {
          setActiveActionModal(null);
          setSelectedCheque(null);
        }}
        statusLabels={STATUS_LABELS}
      />
    </div>
  );
}

export default PdcChequesPage;
