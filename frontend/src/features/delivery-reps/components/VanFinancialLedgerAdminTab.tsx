import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { deliveryRepsApi, DeliveryRep } from '@/shared/api/delivery-reps.api';
import {
  vanSalesApi,
  VanRepFinancialSettlementItem,
  VanRepFinancialLedgerResponse,
} from '../api/van-sales.api';
import { todayLocalDateKey } from '@/lib/format';
import { useLedgerMutations } from './van-financial-ledger/use-ledger-mutations';
import { LedgerKpiCards } from './van-financial-ledger/ledger-kpi-cards';
import { LedgerFilterBar } from './van-financial-ledger/ledger-filter-bar';
import { LedgerRepsBreakdown } from './van-financial-ledger/ledger-reps-breakdown';
import { LedgerTable } from './van-financial-ledger/ledger-table';
import { LedgerSettleModal } from './van-financial-ledger/ledger-settle-modal';
import { LedgerAddBonusModal } from './van-financial-ledger/ledger-add-bonus-modal';
import { LedgerPushPayrollModal } from './van-financial-ledger/ledger-push-payroll-modal';
import { LedgerLinkRepModal } from './van-financial-ledger/ledger-link-rep-modal';

export function VanFinancialLedgerAdminTab() {
  const queryClient = useQueryClient();

  // Filters state
  const [selectedRepId, setSelectedRepId] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Selection state for bulk actions
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Modals state
  const [settleModalItem, setSettleModalItem] = useState<VanRepFinancialSettlementItem | null>(null);
  const [settleMethod, setSettleMethod] = useState<'cash' | 'waiver'>('cash');
  const [settleNotes, setSettleNotes] = useState('');
  // M5 (INV-REP-WAIVER-APPROVAL-RULE): a waiver above this amount
  // needs a supervisor PIN on the server (settings key
  // repWaiverApprovalThreshold, default 500 in tenant base-currency
  // units — the Q6 equivalent). The server is the authority; this
  // default only decides when the UI shows the PIN field.
  const REP_WAIVER_PIN_THRESHOLD_DEFAULT = 500;
  const [settlePin, setSettlePin] = useState('');

  const [isAddBonusOpen, setIsAddBonusOpen] = useState(false);
  const [bonusRepId, setBonusRepId] = useState<string>('');
  const [bonusType, setBonusType] = useState<'bonus' | 'commission'>('bonus');
  const [bonusAmount, setBonusAmount] = useState('');
  const [bonusNotes, setBonusNotes] = useState('');

  const [isPushPayrollOpen, setIsPushPayrollOpen] = useState(false);
  const [payrollTargetMonth, setPayrollTargetMonth] = useState(
    () => todayLocalDateKey().slice(0, 7)
  );

  const [linkingRep, setLinkingRep] = useState<{
    repId: number;
    repName: string;
    employeeId: number | null;
  } | null>(null);
  const [selectedCandidateEmployeeId, setSelectedCandidateEmployeeId] = useState<string>('');

  // 1. Fetch Delivery Representatives Directory
  const { data: repsData } = useQuery<DeliveryRep[]>({
    queryKey: ['delivery-reps'],
    queryFn: () => deliveryRepsApi.list(),
  });

  // 2. Fetch Financial Ledger Data
  const {
    data: ledgerData,
    isLoading,
    refetch,
  } = useQuery<VanRepFinancialLedgerResponse>({
    queryKey: ['van-rep-financial-ledger', selectedRepId, selectedStatus, dateFrom, dateTo],
    queryFn: () =>
      vanSalesApi.getRepFinancialLedger({
        repId: selectedRepId ? Number(selectedRepId) : undefined,
        status: selectedStatus !== 'all' ? selectedStatus : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      }),
  });

  const items = ledgerData?.items || [];
  const summary = ledgerData?.summary || {
    totalPendingShortages: 0,
    totalSettledShortages: 0,
    totalWaivedShortages: 0,
    totalPushedToPayroll: 0,
    totalCommissions: 0,
    netRepBalance: 0,
    repsBreakdown: [],
  };

  // Unified, multi-source reps list ensuring representatives are NEVER missing
  const allReps = useMemo(() => {
    const map = new Map<string, { id: number; name: string; phone?: string; vehicle_plate?: string }>();

    // 1. From deliveryRepsApi query
    const listFromApi = Array.isArray(repsData)
      ? repsData
      : (repsData && typeof repsData === 'object' && Array.isArray((repsData as any).items))
        ? (repsData as any).items
        : (repsData && typeof repsData === 'object' && Array.isArray((repsData as any).deliveryReps))
          ? (repsData as any).deliveryReps
          : [];

    for (const r of listFromApi) {
      if (r && r.id) {
        map.set(String(r.id), {
          id: Number(r.id),
          name: String(r.name || `مندوب #${r.id}`),
          phone: r.phone || undefined,
          vehicle_plate: r.vehicle_plate || (r as any).vehiclePlate || undefined,
        });
      }
    }

    // 2. From summary.repsBreakdown (always comes directly with financial ledger data)
    for (const rb of summary.repsBreakdown || []) {
      if (rb && rb.repId) {
        const key = String(rb.repId);
        if (!map.has(key)) {
          map.set(key, {
            id: Number(rb.repId),
            name: String(rb.repName || `مندوب #${rb.repId}`),
            phone: rb.repPhone || undefined,
          });
        }
      }
    }

    // 3. From items (in case of filtered movements)
    for (const it of items || []) {
      if (it && it.repId) {
        const key = String(it.repId);
        if (!map.has(key)) {
          map.set(key, {
            id: Number(it.repId),
            name: String(it.repName || `مندوب #${it.repId}`),
            phone: it.repPhone || undefined,
            vehicle_plate: it.vehiclePlate || undefined,
          });
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [repsData, summary.repsBreakdown, items]);

  // Filtered items by search term
  const displayItems = useMemo(() => {
    if (!searchTerm.trim()) return items;
    const q = searchTerm.trim().toLowerCase();
    return items.filter(
      (it) =>
        (it.repName?.toLowerCase() || '').includes(q) ||
        (it.notes?.toLowerCase() || '').includes(q) ||
        (it.receiptVoucherNo?.toLowerCase() || '').includes(q) ||
        (it.tripId && String(it.tripId).includes(q)) ||
        (it.vehiclePlate?.toLowerCase() || '').includes(q)
    );
  }, [items, searchTerm]);

  const {
    settleMutation,
    pushPayrollMutation,
    addBonusMutation,
    candidateEmployees,
    linkRepMutation,
    autoCreateEmployeeMutation,
  } = useLedgerMutations({
    queryClient,
    bonusType,
    linkingRep,
    setBonusAmount,
    setBonusNotes,
    setBonusRepId,
    setIsAddBonusOpen,
    setIsPushPayrollOpen,
    setLinkingRep,
    setSelectedIds,
    setSettleModalItem,
    setSettleNotes,
    setSettlePin,
  });

  const handleOpenAddBonus = (targetRepId?: string) => {
    const candidateId = targetRepId || selectedRepId || (allReps.length === 1 ? String(allReps[0].id) : '');
    setBonusRepId(candidateId);
    setBonusAmount('');
    setBonusNotes('');
    setBonusType('bonus');
    setIsAddBonusOpen(true);
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setTimeout(() => setIsRefreshing(false), 400);
  };

  const handleToggleSelectAll = () => {
    const pendingIds = displayItems.filter((i) => i.status === 'pending').map((i) => i.id);
    if (selectedIds.length === pendingIds.length && pendingIds.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(pendingIds);
    }
  };

  const handleToggleItem = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };


  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        width: '100%',
        maxWidth: '1280px',
        margin: '0 auto',
      }}
      dir="rtl"
    >
      {/* 1. Enterprise Financial KPI Cards */}
      <LedgerKpiCards summary={summary} />

      {/* 2. Control Toolbar & Filters */}
      <LedgerFilterBar
        allReps={allReps}
        dateFrom={dateFrom}
        dateTo={dateTo}
        handleManualRefresh={handleManualRefresh}
        handleOpenAddBonus={handleOpenAddBonus}
        isRefreshing={isRefreshing}
        searchTerm={searchTerm}
        selectedIds={selectedIds}
        selectedRepId={selectedRepId}
        selectedStatus={selectedStatus}
        setDateFrom={setDateFrom}
        setDateTo={setDateTo}
        setIsPushPayrollOpen={setIsPushPayrollOpen}
        setSearchTerm={setSearchTerm}
        setSelectedRepId={setSelectedRepId}
        setSelectedStatus={setSelectedStatus}
      />

      {/* 3. Representatives Summary Cards (Shown when All Reps is viewed) */}
      <LedgerRepsBreakdown
        summary={summary}
        selectedRepId={selectedRepId}
        setLinkingRep={setLinkingRep}
        setSelectedCandidateEmployeeId={setSelectedCandidateEmployeeId}
        setSelectedRepId={setSelectedRepId}
        handleOpenAddBonus={handleOpenAddBonus}
      />

      {/* 4. Detailed Financial Ledger Table */}
      <LedgerTable
        allReps={allReps}
        displayItems={displayItems}
        handleToggleItem={handleToggleItem}
        handleToggleSelectAll={handleToggleSelectAll}
        isLoading={isLoading}
        selectedIds={selectedIds}
        selectedRepId={selectedRepId}
        setIsPushPayrollOpen={setIsPushPayrollOpen}
        setLinkingRep={setLinkingRep}
        setSelectedCandidateEmployeeId={setSelectedCandidateEmployeeId}
        setSelectedIds={setSelectedIds}
        setSelectedRepId={setSelectedRepId}
        setSettleMethod={setSettleMethod}
        setSettleModalItem={setSettleModalItem}
        setSettleNotes={setSettleNotes}
        setSettlePin={setSettlePin}
      />

      {/* MODAL 1: Settle Item Modal (Cash or Administrative Waiver) */}
      <LedgerSettleModal
        REP_WAIVER_PIN_THRESHOLD_DEFAULT={REP_WAIVER_PIN_THRESHOLD_DEFAULT}
        setSettleMethod={setSettleMethod}
        setSettleModalItem={setSettleModalItem}
        setSettleNotes={setSettleNotes}
        setSettlePin={setSettlePin}
        settleMethod={settleMethod}
        settleModalItem={settleModalItem}
        settleMutation={settleMutation}
        settleNotes={settleNotes}
        settlePin={settlePin}
      />

      {/* MODAL 2: Add Rep Bonus / Commission Modal */}
      <LedgerAddBonusModal
        addBonusMutation={addBonusMutation}
        allReps={allReps}
        bonusAmount={bonusAmount}
        bonusNotes={bonusNotes}
        bonusRepId={bonusRepId}
        bonusType={bonusType}
        isAddBonusOpen={isAddBonusOpen}
        setBonusAmount={setBonusAmount}
        setBonusNotes={setBonusNotes}
        setBonusRepId={setBonusRepId}
        setBonusType={setBonusType}
        setIsAddBonusOpen={setIsAddBonusOpen}
      />

      {/* MODAL 3: Bulk Push to Payroll Modal */}
      <LedgerPushPayrollModal
        isPushPayrollOpen={isPushPayrollOpen}
        payrollTargetMonth={payrollTargetMonth}
        pushPayrollMutation={pushPayrollMutation}
        selectedIds={selectedIds}
        setIsPushPayrollOpen={setIsPushPayrollOpen}
        setPayrollTargetMonth={setPayrollTargetMonth}
      />

      {/* MODAL 4: Link Delivery Rep to HR Employee */}
      <LedgerLinkRepModal
        autoCreateEmployeeMutation={autoCreateEmployeeMutation}
        candidateEmployees={candidateEmployees}
        linkRepMutation={linkRepMutation}
        linkingRep={linkingRep}
        selectedCandidateEmployeeId={selectedCandidateEmployeeId}
        setLinkingRep={setLinkingRep}
        setSelectedCandidateEmployeeId={setSelectedCandidateEmployeeId}
      />
    </div>
  );
}
