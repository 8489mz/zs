import { useTranslation } from 'react-i18next';
import { useEffect, useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { toast } from '@/shared/components/system-alert';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { maintenanceApi, summarizeTicketCounts, type MaintenancePaymentMethod, type UpsertMaintenanceTicketPayload } from '@/features/maintenance/api/maintenance.api';
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
  /* Same source as the receipt utils and ImeiHistoryPage: the tenant's
   * settings maintenanceProfile; getMaintenanceProfile falls back to
   * mobile when the tenant never set one. */
  const settingsQuery = useSettingsQuery();
  const maintenanceProfile = getMaintenanceProfile(settingsQuery.data?.maintenanceProfile);

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

  // Edit Ticket Dialog State (non-financial fields only; delivered tickets
  // are frozen by the backend and never offered edit)
  const [editTicket, setEditTicket] = useState<MaintenanceTicket | null>(null);

  const openSettlementModal = (ticket: MaintenanceTicket) => {
    setSettlementTicket(ticket);
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

  /* Aggregate counts endpoint — the old pageSize:1000 summary list went
   * silently wrong past 100 tickets (the backend caps pageSize at 100).
   * The endpoint is package 5's work; until it merges this query 404s and
   * the KPIs fall back to 0 — the list itself is unaffected. */
  const { data: countsData } = useQuery({
    queryKey: ['maintenance-tickets-counts'],
    queryFn: () => maintenanceApi.getCounts(),
    staleTime: 30_000,
  });

  // KPI Metrics Calculations (from the aggregate counts, same groupings as before)
  const { inProgressCount, readyCount, deliveredCount, receivedCount, totalRemainingSum } = useMemo(() => {
    if (!countsData?.counts) {
      return { inProgressCount: 0, readyCount: 0, deliveredCount: 0, receivedCount: 0, totalRemainingSum: 0 };
    }
    return summarizeTicketCounts(countsData.counts, countsData.totalRemaining);
  }, [countsData]);

  // Status Change Mutation
  const statusMutation = useMutation({
    mutationFn: ({ id, status, finalCost, collectedAmount, paymentMethod }: { id: string | number; status: string; finalCost?: number; collectedAmount?: number; paymentMethod?: MaintenancePaymentMethod }) =>
      maintenanceApi.updateStatus(id, {
        status: status as any,
        finalCost,
        collectedAmount,
        paymentMethod,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['maintenance-tickets-counts'] });
    },
  });

  // Edit Ticket Mutation (non-financial fields only — PUT maintenanceApi.update).
  // NOTE: the backend also freezes the edit when an advance was collected or
  // parts were issued (MAINTENANCE_REVERSAL_REQUIRED); that freeze is a
  // backend rule outside this package — the failure surfaces as a toast.
  const editMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string | number; payload: UpsertMaintenanceTicketPayload }) =>
      maintenanceApi.update(id, payload),
    onSuccess: (_res, { id, payload }) => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['maintenance-tickets-counts'] });
      setEditTicket(null);
      toast.success('تم حفظ تعديل بيانات التذكرة');
      setSelectedTicket((prev) =>
        prev && String(prev.id) === String(id)
          ? {
              ...prev,
              customerName: payload.customerName,
              customerPhone: payload.customerPhone,
              deviceBrand: payload.deviceBrand ?? prev.deviceBrand,
              deviceModel: payload.deviceModel,
              serialNumber: payload.serialNumber ?? prev.serialNumber,
              problemDescription: payload.problemDescription,
              deviceCondition: payload.deviceCondition ?? prev.deviceCondition,
              technicianName: payload.technicianName ?? prev.technicianName,
              warrantyDays: payload.warrantyDays ?? prev.warrantyDays,
            }
          : prev,
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ التعديل');
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
            queryClient.invalidateQueries({ queryKey: ['maintenance-tickets-counts'] });
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
          isPending={statusMutation.isPending}
          onClose={() => setSettlementTicket(null)}
          onConfirm={(finalCost, collectedAmount, paymentMethod) => {
            if (!settlementTicket) return;
            statusMutation.mutate(
              {
                id: settlementTicket.id,
                status: 'delivered',
                finalCost,
                collectedAmount,
                paymentMethod,
              },
              {
                onSuccess: () => setSettlementTicket(null),
              },
            );
          }}
        />

        {/* Edit trigger: the per-row actions column lives in
            MaintenanceTicketsTable (outside this package's file list), so
            the edit entry point is offered here while a ticket's detail is
            open — delivered tickets are frozen and never offered edit. */}
        {selectedTicket && selectedTicket.status !== 'delivered' && !editTicket && (
          <button
            type="button"
            onClick={() => {
              setEditTicket(selectedTicket);
              setSelectedTicket(null);
            }}
            style={{
              position: 'fixed',
              bottom: '20px',
              left: '20px',
              zIndex: 10001,
              padding: '9px 16px',
              borderRadius: '8px',
              border: '1px solid #170e5e',
              background: '#170e5e',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 800,
              fontSize: '0.85rem',
              boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
            }}
          >
            {__t('maintenance.maintenance_tickets_page.s3', "تعديل بيانات التذكرة")}
          </button>
        )}

        {/* 5. Dialog: Edit Ticket (non-financial fields only) */}
        <MaintenanceTicketEditDialog
          ticket={editTicket}
          isPending={editMutation.isPending}
          onClose={() => setEditTicket(null)}
          onSave={(payload) => {
            if (!editTicket) return;
            editMutation.mutate({ id: editTicket.id, payload });
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

/* Compact edit dialog for a ticket's NON-financial fields. The create modal
 * (MaintenanceCreateTicketModal) has no edit mode and must not be changed,
 * so the form lives here. Financials (expected/final cost, advance, status)
 * are sent back unchanged — the backend rejects any change to them here —
 * and the dialog is never offered for delivered tickets. */
function MaintenanceTicketEditDialog({
  ticket,
  isPending,
  onClose,
  onSave,
}: {
  ticket: MaintenanceTicket | null;
  isPending: boolean;
  onClose: () => void;
  onSave: (payload: UpsertMaintenanceTicketPayload) => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<UpsertMaintenanceTicketPayload | null>(null);

  const ticketId = ticket?.id ?? null;
  useEffect(() => {
    if (!ticket) {
      setForm(null);
      return;
    }
    const numericId = (v: string | null | undefined) => {
      if (v == null || v === '') return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    setForm({
      customerName: ticket.customerName,
      customerPhone: ticket.customerPhone,
      deviceBrand: ticket.deviceBrand ?? '',
      deviceModel: ticket.deviceModel,
      serialNumber: ticket.serialNumber ?? '',
      problemDescription: ticket.problemDescription,
      deviceCondition: ticket.deviceCondition ?? '',
      technicianId: numericId(ticket.technicianId),
      technicianName: ticket.technicianName ?? '',
      branchId: numericId(ticket.branchId),
      locationId: numericId(ticket.locationId),
      warrantyDays: ticket.warrantyDays ?? 30,
      expectedCost: ticket.expectedCost,
      finalCost: ticket.finalCost,
    });
  }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ticket || !form) return null;

  const set = (patch: Partial<UpsertMaintenanceTicketPayload>) => setForm({ ...form, ...patch });

  const handleSave = () => {
    const missing: string[] = [];
    if (!form.customerName.trim()) missing.push('اسم العميل');
    if (!form.customerPhone.trim()) missing.push('الهاتف');
    if (!form.deviceModel.trim()) missing.push('موديل الجهاز');
    if (!form.problemDescription.trim()) missing.push('وصف العطل');
    if (missing.length > 0) {
      toast.error(`يرجى ملء الحقول الأساسية التالية: ${missing.join('، ')}`);
      return;
    }
    onSave(form);
  };

  const field = (label: string, input: React.ReactNode, span2 = false) => (
    <label style={{ display: 'block', gridColumn: span2 ? 'span 2' : undefined }}>
      <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '5px' }}>{label}</span>
      {input}
    </label>
  );
  const inputStyle: React.CSSProperties = {
    width: '100%', height: '35px', padding: '0 12px', borderRadius: '6px',
    border: '1px solid #cbd5e1', background: '#fff', fontSize: '0.85rem', boxSizing: 'border-box',
  };

  return (
    <DialogShell open={Boolean(ticket)} onClose={onClose} width="min(640px, 95vw)" zIndex={10002} ariaLabel={t('maintenance.maintenance_tickets_page.s4', "تعديل بيانات تذكرة الصيانة")}>
      <div className="page-stack" dir="rtl" style={{ gap: '14px', padding: '20px 24px' }}>
        <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
          {t('maintenance.maintenance_tickets_page.s5', "تعديل بيانات التذكرة:")} <span style={{ fontFamily: 'monospace' }}>{ticket.ticketNo}</span>
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 12px' }}>
          {field(t('maintenance.maintenance_tickets_page.s6', "اسم العميل"), (
            <input value={form.customerName} onChange={(e) => set({ customerName: e.target.value })} style={inputStyle} />
          ))}
          {field(t('maintenance.maintenance_tickets_page.s7', "هاتف العميل"), (
            <input value={form.customerPhone} onChange={(e) => set({ customerPhone: e.target.value })} style={inputStyle} dir="ltr" />
          ))}
          {field(t('maintenance.maintenance_tickets_page.s8', "ماركة الجهاز"), (
            <input value={form.deviceBrand || ''} onChange={(e) => set({ deviceBrand: e.target.value })} style={inputStyle} />
          ))}
          {field(t('maintenance.maintenance_tickets_page.s9', "موديل الجهاز"), (
            <input value={form.deviceModel} onChange={(e) => set({ deviceModel: e.target.value })} style={inputStyle} />
          ))}
          {field(t('maintenance.maintenance_tickets_page.s10', "السيريال / IMEI"), (
            <input value={form.serialNumber || ''} onChange={(e) => set({ serialNumber: e.target.value })} style={inputStyle} dir="ltr" />
          ))}
          {field(t('maintenance.maintenance_tickets_page.s11', "اسم الفني"), (
            <input value={form.technicianName || ''} onChange={(e) => set({ technicianName: e.target.value })} style={inputStyle} />
          ))}
          {field(t('maintenance.maintenance_tickets_page.s12', "وصف العطل"), (
            <textarea
              value={form.problemDescription}
              onChange={(e) => set({ problemDescription: e.target.value })}
              style={{ ...inputStyle, height: 'auto', minHeight: '60px', lineHeight: 1.5, padding: '8px 12px' }}
            />
          ), true)}
          {field(t('maintenance.maintenance_tickets_page.s13', "حالة الجهاز الظاهرية"), (
            <input value={form.deviceCondition || ''} onChange={(e) => set({ deviceCondition: e.target.value })} style={inputStyle} />
          ))}
          {field(t('maintenance.maintenance_tickets_page.s14', "أيام الضمان"), (
            <input type="number" min="0" value={form.warrantyDays ?? 30} onChange={(e) => set({ warrantyDays: Number(e.target.value) })} style={inputStyle} />
          ))}
          {field(t('maintenance.maintenance_tickets_page.s15', "الفرع (رقم، اختياري)"), (
            <input
              type="number" min="0" placeholder="—"
              value={form.branchId ?? ''} onChange={(e) => set({ branchId: e.target.value === '' ? undefined : Number(e.target.value) })}
              style={inputStyle}
            />
          ))}
          {field(t('maintenance.maintenance_tickets_page.s16', "الموقع / المخزن (رقم، اختياري)"), (
            <input
              type="number" min="0" placeholder="—"
              value={form.locationId ?? ''} onChange={(e) => set({ locationId: e.target.value === '' ? undefined : Number(e.target.value) })}
              style={inputStyle}
            />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
          <Button type="button" variant="secondary" onClick={onClose} style={{ fontSize: '0.85rem' }}>
            {t('maintenance.maintenance_tickets_page.s17', "إلغاء")}
          </Button>
          <Button type="button" variant="primary" onClick={handleSave} disabled={isPending} style={{ padding: '7px 20px', fontWeight: 700, fontSize: '0.85rem' }}>
            {isPending ? t('maintenance.maintenance_tickets_page.s18', "جاري الحفظ...") : t('maintenance.maintenance_tickets_page.s19', "حفظ التعديل")}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
