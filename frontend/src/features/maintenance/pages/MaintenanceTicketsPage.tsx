import { useTranslation } from 'react-i18next';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { maintenanceApi } from '@/features/maintenance/api/maintenance.api';
import type { MaintenanceTicket } from '@/types/domain-models/maintenance';
import { getMaintenanceProfile } from '@/features/maintenance/constants/maintenance-profiles';
import { SYSTEM_DEFAULTS } from '@/config/system-defaults.constants';
import { MaintenanceReceiptModal } from '../components/MaintenanceReceiptModal';
import { PlusIcon, RefreshCwIcon } from '@/shared/components/icons/AppIcons';
import { MaintenanceSettlementModal } from '../components/MaintenanceSettlementModal';
import { MaintenanceCreateTicketModal } from '../components/MaintenanceCreateTicketModal';
import { MaintenanceDetailModal } from '../components/MaintenanceDetailModal';
import { MaintenanceTicketsKpiCards } from '../components/tickets/MaintenanceTicketsKpiCards';
import { MaintenanceTicketsFilterBar } from '../components/tickets/MaintenanceTicketsFilterBar';
import { MaintenanceTicketsTable } from '../components/tickets/MaintenanceTicketsTable';

export function MaintenanceTicketsPage() {
  const { t: __t } = useTranslation();
  const queryClient = useQueryClient();
  const maintenanceProfile = getMaintenanceProfile();

  // Filters & State
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<MaintenanceTicket | null>(null);
  const [receiptTicket, setReceiptTicket] = useState<MaintenanceTicket | null>(null);

  // Settlement Delivery Modal State
  const [settlementTicket, setSettlementTicket] = useState<MaintenanceTicket | null>(null);
  const [collectedAmount, setCollectedAmount] = useState<number>(0);
  const [discountReason, setDiscountReason] = useState<string>('فصال ومراعاة عميل');
  const [customReason, setCustomReason] = useState<string>('');

  const openSettlementModal = (ticket: MaintenanceTicket) => {
    setSettlementTicket(ticket);
    const rem = Math.max(0, (ticket.finalCost || ticket.expectedCost || 0) - (ticket.advancePayment || 0));
    setCollectedAmount(rem);
    setDiscountReason('فصال ومراعاة عميل');
    setCustomReason('');
  };

  // Queries
  const { data: ticketsData, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['maintenance-tickets', filterStatus, searchQuery, page],
    queryFn: () =>
      maintenanceApi.list({
        status: filterStatus === 'all' ? undefined : filterStatus,
        q: searchQuery.trim() || undefined,
        page,
        pageSize: 15,
      }),
  });

  const { data: allTicketsSummary } = useQuery({
    queryKey: ['maintenance-tickets-summary'],
    queryFn: () => maintenanceApi.list({ pageSize: 1000 }),
    staleTime: 30_000,
  });

  // KPI Metrics Calculations
  const allTicketsList = useMemo(() => {
    return allTicketsSummary?.tickets || [];
  }, [allTicketsSummary]);

  const inProgressCount = useMemo(() => {
    return allTicketsList.filter((t) => t.status === 'in_progress' || t.status === 'received' || t.status === 'waiting_parts').length;
  }, [allTicketsList]);

  const readyCount = useMemo(() => {
    return allTicketsList.filter((t) => t.status === 'repaired').length;
  }, [allTicketsList]);

  const deliveredCount = useMemo(() => {
    return allTicketsList.filter((t) => t.status === 'delivered').length;
  }, [allTicketsList]);

  const receivedCount = useMemo(() => {
    return allTicketsList.filter((t) => t.status === 'received').length;
  }, [allTicketsList]);

  const totalRemainingSum = useMemo(() => {
    return allTicketsList.reduce((sum, t) => {
      const rem = Math.max(0, (t.finalCost || t.expectedCost || 0) - (t.advancePayment || 0));
      return sum + rem;
    }, 0);
  }, [allTicketsList]);

  // Status Change Mutation
  const statusMutation = useMutation({
    mutationFn: ({ id, status, collectedAmount, technicianNotes }: { id: string | number; status: string; collectedAmount?: number; technicianNotes?: string }) =>
      maintenanceApi.updateStatus(id, {
        status: status as any,
        collectedAmount,
        technicianNotes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['maintenance-tickets-summary'] });
    },
  });

  const tickets = ticketsData?.tickets || [];
  const totalItems = ticketsData?.pagination?.totalItems || 0;
  const totalPages = Math.ceil(totalItems / 15) || 1;

  const handleCopyPhone = (phone: string) => {
    navigator.clipboard.writeText(phone);
    setCopiedPhone(phone);
    setTimeout(() => setCopiedPhone(null), 2000);
  };

  const getStatusMeta = (status: string) => {
    switch (status) {
      case 'received':
        return { label: 'استلام جديد', bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' };
      case 'in_progress':
        return { label: 'قيد الصيانة', bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' };
      case 'waiting_parts':
        return { label: 'انتظار قطع غيار', bg: '#fefce8', color: '#a16207', border: '#fef08a' };
      case 'repaired':
        return { label: 'جاهز للتسليم', bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' };
      case 'delivered':
        return { label: 'تم التسليم', bg: '#f8fafc', color: '#0f172a', border: '#cbd5e1' };
      case 'cancelled':
        return { label: 'ملغي', bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' };
      default:
        return { label: status, bg: '#f8fafc', color: '#475569', border: '#e2e8f0' };
    }
  };

  const formatDate = (dt: string) => {
    if (!dt) return '—';
    const d = new Date(dt);
    return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
  };

  return (
    <div className="page-stack page-shell" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        <PageHeader
          title={`تذاكر الصيانة وإصلاح ${maintenanceProfile.shortTitle}`}
          description={`إدارة استلام، فحص، صيانة وتسليم ${maintenanceProfile.shortTitle} مع قطع الغيار والتكاليف المالية المترتبة`}
          badge={<span className="nav-pill" style={{ background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0' }}>{totalItems} {__t('maintenance.maintenance_tickets_page.s0', "تذكرة")}</span>}
          actions={
            <div className="actions compact-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button
                variant="primary"
                onClick={() => setCreateModalOpen(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}
              >
                <PlusIcon size={16} />
                <span>{__t('maintenance.maintenance_tickets_page.s1', "استلام جهاز صيانة جديد")}</span>
              </Button>
              <Button
                variant="secondary"
                onClick={() => void refetch()}
                disabled={isRefetching}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <RefreshCwIcon size={16} />
                <span>{__t('maintenance.maintenance_tickets_page.s2', "تحديث")}</span>
              </Button>
            </div>
          }
        />

        {/* KPI Metrics Summary Cards */}
        <MaintenanceTicketsKpiCards
          inProgressCount={inProgressCount}
          readyCount={readyCount}
          deliveredCount={deliveredCount}
          totalRemainingSum={totalRemainingSum}
        />

        {/* Filter Toolbar & Search Bar */}
        <MaintenanceTicketsFilterBar
          filterStatus={filterStatus}
          setFilterStatus={setFilterStatus}
          setPage={setPage}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          totalItems={totalItems}
          receivedCount={receivedCount}
          inProgressCount={inProgressCount}
          readyCount={readyCount}
          deliveredCount={deliveredCount}
          serialLabel={maintenanceProfile.serialLabel}
        />

        {/* Tickets Table */}
        <MaintenanceTicketsTable
          isLoading={isLoading}
          isError={isError}
          tickets={tickets}
          totalItems={totalItems}
          page={page}
          totalPages={totalPages}
          setPage={setPage}
          serialLabel={maintenanceProfile.serialLabel}
          copiedPhone={copiedPhone}
          onCopyPhone={handleCopyPhone}
          onOpenDetail={(t) => setSelectedTicket(t)}
          onOpenReceipt={(t) => setReceiptTicket(t)}
          onOpenSettlement={openSettlementModal}
          onChangeStatus={(id, status) => statusMutation.mutate({ id, status })}
          getStatusMeta={getStatusMeta}
          formatDate={formatDate}
        />

        {/* 1. Modal: Create New Maintenance Ticket */}
        <MaintenanceCreateTicketModal
          open={createModalOpen}
          onClose={() => setCreateModalOpen(false)}
          maintenanceProfile={maintenanceProfile}
          onSuccess={(newTicket) => {
            setCreateModalOpen(false);
            queryClient.invalidateQueries({ queryKey: ['maintenance-tickets'] });
            queryClient.invalidateQueries({ queryKey: ['maintenance-tickets-summary'] });
            setReceiptTicket(newTicket);
          }}
        />

        {/* 2. Modal: Selected Ticket Details & Parts Management */}
        <MaintenanceDetailModal
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onOpenSettlement={openSettlementModal}
          onSendWhatsApp={(t) => { void t; }}
          onPrintReceipt={(t) => setReceiptTicket(t)}
          maintenanceProfile={maintenanceProfile}
          commissionRate={SYSTEM_DEFAULTS.TECHNICIAN_COMMISSION_RATE}
        />

        {/* 3. Modal: Delivery Settlement Modal */}
        <MaintenanceSettlementModal
          settlementTicket={settlementTicket}
          collectedAmount={collectedAmount}
          setCollectedAmount={setCollectedAmount}
          discountReason={discountReason}
          setDiscountReason={setDiscountReason}
          customReason={customReason}
          setCustomReason={setCustomReason}
          isPending={statusMutation.isPending}
          onClose={() => setSettlementTicket(null)}
          onConfirm={() => {
            if (!settlementTicket) return;
            statusMutation.mutate(
              {
                id: settlementTicket.id,
                status: 'delivered',
                collectedAmount,
                technicianNotes: discountReason === 'custom' ? customReason : discountReason,
              },
              {
                onSuccess: () => setSettlementTicket(null),
              },
            );
          }}
        />

        {/* 4. Modal: Printable Receipt & Sticker */}
        <MaintenanceReceiptModal
          open={Boolean(receiptTicket)}
          ticket={receiptTicket}
          onClose={() => setReceiptTicket(null)}
        />
      </main>
    </div>
  );
}

export default MaintenanceTicketsPage;
