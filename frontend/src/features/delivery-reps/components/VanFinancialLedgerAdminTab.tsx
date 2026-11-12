import { useTranslation } from 'react-i18next';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { Button } from '@/shared/ui/button';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { CustomSelect } from '@/shared/ui/custom-select';
import { toast } from '@/shared/components/system-alert';
import { deliveryRepsApi, DeliveryRep } from '@/shared/api/delivery-reps.api';
import {
  vanSalesApi,
  VanRepFinancialSettlementItem,
  VanRepFinancialLedgerResponse,
} from '../api/van-sales.api';
import {
  CreditCardIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  RefreshCwIcon,
  PlusCircleIcon,
  SearchIcon,
  SlidersIcon,
  SendIcon,
  CheckIcon,
  XIcon,
} from '@/shared/components/icons/AppIcons';

export function VanFinancialLedgerAdminTab() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
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
    () => new Date().toISOString().slice(0, 7)
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

  // Mutations
  const settleMutation = useMutation({
    mutationFn: ({
      id,
      method,
      notes,
      reason,
      supervisorPin,
    }: {
      id: number;
      method: 'cash' | 'waiver';
      notes?: string;
      reason?: string;
      supervisorPin?: string;
    }) => vanSalesApi.settleRepFinancialItem(id, { method, notes, reason, supervisorPin }),
    onSuccess: (res) => {
      toast.success(
        res.status === 'settled'
          ? `تم إثبات السداد النقدي بنجاح وحفظ سند القبض #${res.receiptVoucherNo}`
          : 'تم اعتماد الإعفاء الإداري وإغلاق البند بنجاح'
      );
      setSettleModalItem(null);
      setSettleNotes('');
      setSettlePin('');
      queryClient.invalidateQueries({ queryKey: ['van-rep-financial-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['van-sales-trips'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل إجراء التسوية');
    },
  });

  const pushPayrollMutation = useMutation({
    mutationFn: ({
      settlementIds,
      targetMonth,
    }: {
      settlementIds: number[];
      targetMonth?: string;
    }) => vanSalesApi.pushRepShortagesToPayroll({ settlementIds, targetMonth }),
    onSuccess: (res) => {
      toast.success(
        `تم ترحيل ${res.processedCount} بند بنجاح كاستقطاع لمسير رواتب شهر ${res.targetMonth}`
      );
      setIsPushPayrollOpen(false);
      setSelectedIds([]);
      queryClient.invalidateQueries({ queryKey: ['van-rep-financial-ledger'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل ترحيل البنود للرواتب');
    },
  });

  const addBonusMutation = useMutation({
    mutationFn: (payload: {
      repId: number;
      entryType: 'bonus' | 'commission';
      amount: number;
      notes: string;
    }) => vanSalesApi.addRepBonusOrCommission(payload),
    onSuccess: (res) => {
      toast.success(`تم قيد ${bonusType === 'bonus' ? 'المكافأة' : 'العمولة'} للمندوب ${res.repName} بنجاح`);
      setIsAddBonusOpen(false);
      setBonusAmount('');
      setBonusNotes('');
      setBonusRepId('');
      queryClient.invalidateQueries({ queryKey: ['van-rep-financial-ledger'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل قيد المكافأة');
    },
  });

  const { data: candidateEmployees = [] } = useQuery({
    queryKey: ['van-candidate-hr-employees'],
    queryFn: () => vanSalesApi.getCandidateEmployees(),
    enabled: Boolean(linkingRep),
  });

  const linkRepMutation = useMutation({
    mutationFn: ({ repId, employeeId }: { repId: number; employeeId: number | null }) =>
      vanSalesApi.linkRepToEmployee({ repId, employeeId }),
    onSuccess: () => {
      toast.success('تم تحديث ربط المندوب بالموظف بنجاح');
      setLinkingRep(null);
      queryClient.invalidateQueries({ queryKey: ['van-rep-financial-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-reps'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-reps-list'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل تحديث ربط المندوب بالموظف');
    },
  });

  const autoCreateEmployeeMutation = useMutation({
    mutationFn: (repId: number) => vanSalesApi.autoCreateEmployee({ repId }),
    onSuccess: (res) => {
      toast.success(`تم إنشاء ملف موظف HR جديد (${res.displayName}) وربطه بالمندوب بنجاح!`);
      setLinkingRep(null);
      queryClient.invalidateQueries({ queryKey: ['van-rep-financial-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-reps'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-reps-list'] });
      queryClient.invalidateQueries({ queryKey: ['van-candidate-hr-employees'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل إنشاء ملف موظف HR');
    },
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

  const getEntryTypeBadge = (type: string) => {
    switch (type) {
      case 'cash_shortage':
        return { label: 'عجز نقدي (كاش)', bg: '#f8fafc', color: '#991b1b', border: '#fecaca' };
      case 'stock_shortage':
        return { label: 'عجز بضاعة ومخزون', bg: '#f8fafc', color: '#9a3412', border: '#fed7aa' };
      case 'cash_overage':
        return { label: 'فائض نقدي', bg: '#f8fafc', color: '#1e40af', border: '#bfdbfe' };
      case 'commission':
        return { label: 'عمولة مبيعات', bg: '#f8fafc', color: '#065f46', border: '#a7f3d0' };
      case 'bonus':
        return { label: 'مكافأة / بونص تارجت', bg: '#f8fafc', color: '#170e5e', border: '#e2e8f0' };
      case 'cash_reimbursement':
        return { label: 'سداد نقدي بالخزينة', bg: '#f8fafc', color: '#166534', border: '#bbf7d0' };
      default:
        return { label: type, bg: '#f8fafc', color: '#475569', border: '#e2e8f0' };
    }
  };

  const getStatusBadge = (status: string, _method?: string | null, voucher?: string | null) => {
    switch (status) {
      case 'pending':
        return { label: isEn ? 'Pending & Unsettled' : 'معلق وغير مسدد', bg: '#fef2f2', color: '#991b1b', border: '#fecaca' };
      case 'settled':
        return {
          label: voucher ? (isEn ? `Cash Payment (#${voucher})` : `سداد نقدي (#${voucher})`) : (isEn ? 'Settled in Safe' : 'تم السداد بالخزينة'),
          bg: '#f0fdf4',
          color: '#166534',
          border: '#bbf7d0',
        };
      case 'pushed_to_payroll':
        return { label: isEn ? 'Transferred to Payroll' : 'مرحل لمسير الرواتب', bg: '#f8fafc', color: '#170e5e', border: '#e2e8f0' };
      case 'waived':
        return { label: isEn ? 'Administrative Waiver' : 'إعفاء إداري معتمد', bg: '#f8fafc', color: '#475569', border: '#e2e8f0' };
      default:
        return { label: status, bg: '#f8fafc', color: '#475569', border: '#e2e8f0' };
    }
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
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '10px',
          width: '100%',
        }}
      >
        {/* Card 1: Pending Shortages */}
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '14px 16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '11.5px', color: '#475569', fontWeight: 700 }}>
              {t('delivery_reps.van_financial_ledger_admin_tab.s0', "إجمالي العجوزات المعلقة")}
            </span>
            <div
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '8px',
                backgroundColor: '#f8fafc',
                border: '1px solid #edf2f7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AlertTriangleIcon size={15} color="#475569" />
            </div>
          </div>
          <div style={{ fontSize: '20px', fontWeight: 800, color: summary.totalPendingShortages > 0 ? '#b91c1c' : '#0f172a', fontFamily: 'monospace' }}>
            {summary.totalPendingShortages.toFixed(2)}{' '}
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}><CurrencySymbol /></span>
          </div>
          <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '4px' }}>
            {t('delivery_reps.van_financial_ledger_admin_tab.s1', "مطالب بها المناديب ولم تسدد")}
          </div>
        </div>

        {/* Card 2: Settled in Drawer */}
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '14px 16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '11.5px', color: '#475569', fontWeight: 700 }}>
              {t('delivery_reps.van_financial_ledger_admin_tab.s2', "مسدد نقداً بالخزينة")}
            </span>
            <div
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '8px',
                backgroundColor: '#f8fafc',
                border: '1px solid #edf2f7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CheckCircleIcon size={15} color="#475569" />
            </div>
          </div>
          <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', fontFamily: 'monospace' }}>
            {summary.totalSettledShortages.toFixed(2)}{' '}
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}><CurrencySymbol /></span>
          </div>
          <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '4px' }}>
            {t('delivery_reps.van_financial_ledger_admin_tab.s3', "تم توريدها بموجب سندات قبض")}
          </div>
        </div>

        {/* Card 3: Pushed to Payroll */}
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '14px 16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '11.5px', color: '#475569', fontWeight: 700 }}>
              {t('delivery_reps.van_financial_ledger_admin_tab.s4', "مرحل لمسير الرواتب")}
            </span>
            <div
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '8px',
                backgroundColor: '#f8fafc',
                border: '1px solid #edf2f7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <SendIcon size={15} color="#475569" />
            </div>
          </div>
          <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', fontFamily: 'monospace' }}>
            {summary.totalPushedToPayroll.toFixed(2)}{' '}
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}><CurrencySymbol /></span>
          </div>
          <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '4px' }}>
            {t('delivery_reps.van_financial_ledger_admin_tab.s5', "استقطاعات معتمدة بمسير الشهور")}
          </div>
        </div>

        {/* Card 4: Total Commissions & Bonuses */}
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '14px 16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '11.5px', color: '#475569', fontWeight: 700 }}>
              {t('delivery_reps.van_financial_ledger_admin_tab.s6', "العمولات والمكافآت")}
            </span>
            <div
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '8px',
                backgroundColor: '#f8fafc',
                border: '1px solid #edf2f7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CreditCardIcon size={15} color="#475569" />
            </div>
          </div>
          <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', fontFamily: 'monospace' }}>
            {summary.totalCommissions.toFixed(2)}{' '}
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}><CurrencySymbol /></span>
          </div>
          <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '4px' }}>
            {t('delivery_reps.van_financial_ledger_admin_tab.s7', "بونص تارجت وعمولات مبيعات")}
          </div>
        </div>

        {/* Card 5: Net Balance */}
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '14px 16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '11.5px', color: '#475569', fontWeight: 700 }}>
              {t('delivery_reps.van_financial_ledger_admin_tab.s8', "صافي رصيد العهد المعلقة")}
            </span>
            <div
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '8px',
                backgroundColor: '#f8fafc',
                border: '1px solid #edf2f7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <SlidersIcon size={15} color="#475569" />
            </div>
          </div>
          <div
            style={{
              fontSize: '20px',
              fontWeight: 800,
              color: summary.netRepBalance < 0 ? '#b91c1c' : '#0f172a',
              fontFamily: 'monospace',
            }}
          >
            {summary.netRepBalance.toFixed(2)}{' '}
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}><CurrencySymbol /></span>
          </div>
          <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '4px' }}>
            {summary.netRepBalance < 0 ? t('delivery_reps.van_financial_ledger_admin_tab.s9', "صافي مطلوب من المناديب") : t('delivery_reps.van_financial_ledger_admin_tab.s10', "صافي مستحق للمناديب")}
          </div>
        </div>
      </div>

      {/* 2. Control Toolbar & Filters */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          padding: '10px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          {/* Right Filters */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', flex: 1, minWidth: '280px' }}>
            {/* Rep Selector */}
            <div style={{ width: '200px' }}>
              <CustomSelect
                value={selectedRepId}
                onChange={(val) => setSelectedRepId(val)}
                options={[
                  { value: '', label: t('delivery_reps.van_financial_ledger_admin_tab.s11', "كافة مناديب التوزيع") },
                  ...allReps.map((r) => ({
                    value: String(r.id),
                    label: `${r.name} ${r.phone ? `(${r.phone})` : ''}`,
                  })),
                ]}
                placeholder={t('delivery_reps.van_financial_ledger_admin_tab.s12', "اختر المندوب")}
              />
            </div>

            {/* Status Filter */}
            <div style={{ width: '160px' }}>
              <CustomSelect
                value={selectedStatus}
                onChange={(val) => setSelectedStatus(val)}
                options={[
                  { value: 'all', label: t('delivery_reps.van_financial_ledger_admin_tab.s13', "كافة الحالات") },
                  { value: 'pending', label: t('delivery_reps.van_financial_ledger_admin_tab.s14', "المعلقة فقط (عجز)") },
                  { value: 'settled', label: t('delivery_reps.van_financial_ledger_admin_tab.s15', "المسددة بالخزينة") },
                  { value: 'pushed_to_payroll', label: t('delivery_reps.van_financial_ledger_admin_tab.s16', "المرحلة للرواتب") },
                  { value: 'waived', label: t('delivery_reps.van_financial_ledger_admin_tab.s17', "المعفاة إدارياً") },
                ]}
                placeholder={t('delivery_reps.van_financial_ledger_admin_tab.s18', "حالة التسوية")}
              />
            </div>

            {/* Date Range */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                style={{
                  height: '32px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: '0 6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#334155',
                }}
                title={t('delivery_reps.van_financial_ledger_admin_tab.s19', "من تاريخ")}
              />
              <span style={{ fontSize: '11px', color: '#64748b' }}>{t('delivery_reps.van_financial_ledger_admin_tab.s20', "إلى")}</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                style={{
                  height: '32px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: '0 6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#334155',
                }}
                title={t('delivery_reps.van_financial_ledger_admin_tab.s21', "إلى تاريخ")}
              />
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#dc2626',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: '0 4px',
                  }}
                >
                  {t('delivery_reps.van_financial_ledger_admin_tab.s22', "إلغاء")}
                </button>
              )}
            </div>

            {/* Search Input */}
            <div style={{ position: 'relative', width: '200px' }}>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t('delivery_reps.van_financial_ledger_admin_tab.s23', "بحث برقم الرحلة، السند، السبب...")}
                style={{
                  width: '100%',
                  height: '32px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '0 26px 0 8px',
                  fontSize: '11px',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ position: 'absolute', top: '50%', right: '8px', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#94a3b8' }}>
                <SearchIcon size={12} />
              </div>
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  style={{ position: 'absolute', top: '50%', left: '6px', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                >
                  <XIcon size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Left Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Button
              variant="secondary"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              style={{
                height: '32px',
                padding: '0 10px',
                fontSize: '11.5px',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <RefreshCwIcon size={13} className={isRefreshing ? 'animate-spin' : ''} />
              <span>{t('delivery_reps.van_financial_ledger_admin_tab.s24', "تحديث")}</span>
            </Button>

            <Button
              variant="secondary"
              onClick={() => handleOpenAddBonus()}
              style={{
                height: '32px',
                padding: '0 10px',
                fontSize: '11.5px',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                color: '#170e5e',
                backgroundColor: '#ffffff',
                borderColor: '#e2e8f0',
              }}
            >
              <PlusCircleIcon size={13} color="#170e5e" />
              <span>{t('delivery_reps.van_financial_ledger_admin_tab.s25', "+ إضافة بونص / عمولة")}</span>
            </Button>

            <Button
              variant="primary"
              onClick={() => setIsPushPayrollOpen(true)}
              disabled={selectedIds.length === 0}
              style={{
                height: '32px',
                padding: '0 12px',
                fontSize: '11.5px',
                fontWeight: 800,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                backgroundColor: selectedIds.length > 0 ? '#170e5e' : '#cbd5e1',
                cursor: selectedIds.length > 0 ? 'pointer' : 'not-allowed',
              }}
            >
              <SendIcon size={13} color="#ffffff" />
              <span>{t('delivery_reps.van_financial_ledger_admin_tab.s26', "ترحيل للمرتبات (")}{selectedIds.length})</span>
            </Button>
          </div>
        </div>
      </div>

      {/* 3. Representatives Summary Cards (Shown when All Reps is viewed) */}
      {!selectedRepId && summary.repsBreakdown.length > 0 && (
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            padding: '10px 14px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
            <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
            <h4 style={{ margin: 0, fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
              {t('delivery_reps.van_financial_ledger_admin_tab.s27', "موقف ذمم وعجوزات مناديب التوزيع (")}{summary.repsBreakdown.length} {t('delivery_reps.van_financial_ledger_admin_tab.s28', "مندوب)")}
            </h4>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: '8px',
            }}
          >
            {summary.repsBreakdown.map((r) => (
              <div
                key={r.repId}
                style={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '8px 12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: '12px', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.repName}
                  </div>
                  <div style={{ fontSize: '10px', color: '#64748b', display: 'flex', gap: '4px', alignItems: 'center', marginTop: '2px' }}>
                    <span>{r.itemsCount} {t('delivery_reps.van_financial_ledger_admin_tab.s29', "حركات")}</span>
                    {r.employeeName ? (
                      <span
                        style={{ color: '#166534', fontWeight: 600, cursor: 'pointer' }}
                        title={t('delivery_reps.van_financial_ledger_admin_tab.s30', "انقر لتعديل ربط موظف HR")}
                        onClick={() => {
                          setLinkingRep({ repId: r.repId, repName: r.repName, employeeId: r.employeeId || null });
                          setSelectedCandidateEmployeeId(r.employeeId ? String(r.employeeId) : '');
                        }}
                      >
                        {t('delivery_reps.van_financial_ledger_admin_tab.s31', "• موظف:")} {r.employeeName}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setLinkingRep({ repId: r.repId, repName: r.repName, employeeId: r.employeeId || null });
                          setSelectedCandidateEmployeeId(r.employeeId ? String(r.employeeId) : '');
                        }}
                        style={{
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          color: '#475569',
                          borderRadius: '4px',
                          padding: '1px 6px',
                          fontSize: '9.5px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                        title={t('delivery_reps.van_financial_ledger_admin_tab.s32', "انقر لربط المندوب بملف موظف HR")}
                      >
                        {t('delivery_reps.van_financial_ledger_admin_tab.s33', "+ ربط بـ HR")}
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ textAlign: 'left', flexShrink: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: 900, color: r.pendingShortages > 0 ? '#b91c1c' : '#166534', fontFamily: 'monospace' }}>
                    {r.pendingShortages > 0 ? `-${Number(r.pendingShortages).toFixed(2)}` : '0.00'} <CurrencySymbol />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px' }}>
                    <button
                      type="button"
                      onClick={() => setSelectedRepId(String(r.repId))}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#170e5e',
                        fontSize: '10px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      {t('delivery_reps.van_financial_ledger_admin_tab.s34', "كشف الحساب ←")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenAddBonus(String(r.repId))}
                      style={{
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        color: '#170e5e',
                        borderRadius: '4px',
                        fontSize: '9.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: '1px 6px',
                      }}
                      title={t('delivery_reps.van_financial_ledger_admin_tab.s35', "قيد مكافأة أو عمولة لهذا المندوب")}
                    >
                      {t('delivery_reps.van_financial_ledger_admin_tab.s36', "+ بونص")}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Detailed Financial Ledger Table */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}
      >
        <div
          style={{
            padding: '10px 14px',
            borderBottom: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
            <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
              {t('delivery_reps.van_financial_ledger_admin_tab.s37', "سجل حركات العجوزات والعهد والعمولات (")}{displayItems.length} {t('delivery_reps.van_financial_ledger_admin_tab.s38', "حركة)")}
            </h4>
            {selectedRepId && (
              <span
                style={{
                  fontSize: '11px',
                  backgroundColor: '#eef2ff',
                  color: '#170e5e',
                  border: '1px solid #c7d2fe',
                  borderRadius: '4px',
                  padding: '1px 8px',
                  fontWeight: 700,
                }}
              >
                {t('delivery_reps.van_financial_ledger_admin_tab.s39', "المندوب:")} {allReps.find((r) => String(r.id) === selectedRepId)?.name || `#${selectedRepId}`}
              </span>
            )}
          </div>

          {selectedRepId && (
            <button
              type="button"
              onClick={() => setSelectedRepId('')}
              style={{
                background: 'none',
                border: 'none',
                color: '#64748b',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {t('delivery_reps.van_financial_ledger_admin_tab.s40', "عرض كافة المناديب ✕")}
            </button>
          )}
        </div>

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#64748b', fontSize: '13px' }}>
            {t('delivery_reps.van_financial_ledger_admin_tab.s41', "جاري تحميل حركات المركز المالي...")}
          </div>
        ) : displayItems.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
            <CheckCircleIcon size={36} color="#16a34a" style={{ margin: '0 auto 8px', display: 'block' }} />
            <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
              {t('delivery_reps.van_financial_ledger_admin_tab.s42', "لا توجد حركات مالية مطابقة للفلتر المحدد")}
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>
              {t('delivery_reps.van_financial_ledger_admin_tab.s43', "كافة عهد المناديب مطابقة تماماً ومسواة بنسبة 100%.")}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                  <th style={{ padding: '9px 10px', textAlign: 'center', width: '36px' }}>
                    <input
                      type="checkbox"
                      checked={
                        selectedIds.length > 0 &&
                        selectedIds.length === displayItems.filter((i) => i.status === 'pending').length
                      }
                      onChange={handleToggleSelectAll}
                      style={{ cursor: 'pointer' }}
                      title={t('delivery_reps.van_financial_ledger_admin_tab.s44', "تحديد الكل")}
                    />
                  </th>
                  <th style={{ padding: '9px 8px', fontWeight: 700 }}>{t('delivery_reps.van_financial_ledger_admin_tab.s45', "التاريخ والتوقيت")}</th>
                  <th style={{ padding: '9px 8px', fontWeight: 700 }}>{t('delivery_reps.van_financial_ledger_admin_tab.s46', "المندوب")}</th>
                  <th style={{ padding: '9px 8px', fontWeight: 700 }}>{t('delivery_reps.van_financial_ledger_admin_tab.s47', "الرحلة / المركبة")}</th>
                  <th style={{ padding: '9px 8px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_financial_ledger_admin_tab.s48', "نوع الحركة")}</th>
                  <th style={{ padding: '9px 8px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_financial_ledger_admin_tab.s49', "المبلغ")}</th>
                  <th style={{ padding: '9px 8px', fontWeight: 700 }}>{t('delivery_reps.van_financial_ledger_admin_tab.s50', "البيان والسبب")}</th>
                  <th style={{ padding: '9px 8px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_financial_ledger_admin_tab.s51', "حالة التسوية")}</th>
                  <th style={{ padding: '9px 8px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_financial_ledger_admin_tab.s52', "إجراءات التسوية")}</th>
                </tr>
              </thead>
              <tbody>
                {displayItems.map((it) => {
                  const typeBadge = getEntryTypeBadge(it.entryType);
                  const statusBadge = getStatusBadge(it.status, it.settlementMethod, it.receiptVoucherNo);
                  const isPending = it.status === 'pending';
                  const isShortage = ['cash_shortage', 'stock_shortage'].includes(it.entryType);

                  return (
                    <tr
                      key={it.id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        backgroundColor: selectedIds.includes(it.id) ? '#f8fafc' : undefined,
                      }}
                    >
                      {/* Checkbox */}
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        {isPending && isShortage ? (
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(it.id)}
                            onChange={() => handleToggleItem(it.id)}
                            style={{ cursor: 'pointer' }}
                          />
                        ) : (
                          <span style={{ color: '#cbd5e1' }}>—</span>
                        )}
                      </td>

                      {/* Date */}
                      <td style={{ padding: '8px 8px', whiteSpace: 'nowrap', color: '#334155', fontSize: '11px' }}>
                        <div>{new Date(it.createdAt).toLocaleDateString('ar-EG')}</div>
                        <div style={{ color: '#94a3b8', fontSize: '10px' }}>
                          {new Date(it.createdAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>

                      {/* Rep Name */}
                      <td style={{ padding: '8px 8px' }}>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>{it.repName}</div>
                        <div style={{ fontSize: '10px', color: '#64748b' }}>
                          {it.employeeName ? (
                            <span
                              style={{ color: '#15803d', cursor: 'pointer' }}
                              title={t('delivery_reps.van_financial_ledger_admin_tab.s53', "انقر لتعديل ربط الموظف")}
                              onClick={() => {
                                setLinkingRep({ repId: it.repId, repName: it.repName, employeeId: it.employeeId || null });
                                setSelectedCandidateEmployeeId(it.employeeId ? String(it.employeeId) : '');
                              }}
                            >
                              {t('delivery_reps.van_financial_ledger_admin_tab.s54', "موظف HR:")} {it.employeeName}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setLinkingRep({ repId: it.repId, repName: it.repName, employeeId: it.employeeId || null });
                                setSelectedCandidateEmployeeId(it.employeeId ? String(it.employeeId) : '');
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#64748b',
                                fontSize: '10px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                padding: 0,
                              }}
                              title={t('delivery_reps.van_financial_ledger_admin_tab.s55', "انقر لربط المندوب بملف موظف HR")}
                            >
                              {t('delivery_reps.van_financial_ledger_admin_tab.s56', "+ ربط بملف HR")}
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Trip Info */}
                      <td style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}>
                        {it.tripId ? (
                          <div>
                            <span style={{ fontWeight: 800, fontFamily: 'monospace', color: '#170e5e' }}>
                              {t('delivery_reps.van_financial_ledger_admin_tab.s57', "رحلة #")}{it.tripId}
                            </span>
                            <div style={{ fontSize: '10px', color: '#64748b' }}>
                              {it.vehiclePlate || it.shiftName || t('delivery_reps.van_financial_ledger_admin_tab.s58', "تصفية مسائية")}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>{t('delivery_reps.van_financial_ledger_admin_tab.s59', "تسوية إدارية مباشرة")}</span>
                        )}
                      </td>

                      {/* Type Badge */}
                      <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            fontSize: '10.5px',
                            fontWeight: 700,
                            backgroundColor: typeBadge.bg,
                            color: typeBadge.color,
                            border: `1px solid ${typeBadge.border}`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {typeBadge.label}
                        </span>
                      </td>

                      {/* Amount */}
                      <td
                        style={{
                          padding: '8px 8px',
                          textAlign: 'center',
                          fontFamily: 'monospace',
                          fontWeight: 900,
                          fontSize: '13px',
                          color: isShortage ? '#b91c1c' : '#166534',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {isShortage ? `-${Number(it.amount).toFixed(2)}` : `+${Number(it.amount).toFixed(2)}`}{' '}
                        <CurrencySymbol />
                      </td>

                      {/* Notes / Reason */}
                      <td style={{ padding: '8px 8px', maxWidth: '240px', fontSize: '11px', color: '#334155' }}>
                        <div style={{ whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.4 }}>
                          {it.notes || t('delivery_reps.van_financial_ledger_admin_tab.s60', "لا توجد ملاحظات مدونة")}
                        </div>
                        {it.settledByName && (
                          <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>
                            {t('delivery_reps.van_financial_ledger_admin_tab.s61', "بواسطة:")} {it.settledByName}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            fontSize: '10.5px',
                            fontWeight: 700,
                            backgroundColor: statusBadge.bg,
                            color: statusBadge.color,
                            border: `1px solid ${statusBadge.border}`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {statusBadge.label}
                        </span>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                        {isPending ? (
                          <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                            <button
                              type="button"
                              onClick={() => {
                                setSettleModalItem(it);
                                setSettleMethod('cash');
                                setSettleNotes('');
                                setSettlePin('');
                              }}
                              style={{
                                height: '26px',
                                padding: '0 8px',
                                borderRadius: '6px',
                                border: '1px solid #bbf7d0',
                                backgroundColor: '#ffffff',
                                color: '#15803d',
                                fontSize: '10.5px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                              }}
                              title={t('delivery_reps.van_financial_ledger_admin_tab.s62', "تسجيل سداد نقدي بالخزينة وإصدار سند قبض")}
                            >
                              {t('delivery_reps.van_financial_ledger_admin_tab.s63', "سداد كاش")}
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setSettleModalItem(it);
                                setSettleMethod('waiver');
                                setSettleNotes('');
                                setSettlePin('');
                              }}
                              style={{
                                height: '26px',
                                padding: '0 8px',
                                borderRadius: '6px',
                                border: '1px solid #e2e8f0',
                                backgroundColor: '#ffffff',
                                color: '#475569',
                                fontSize: '10.5px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                              }}
                              title={t('delivery_reps.van_financial_ledger_admin_tab.s64', "إعفاء وتسوية إدارية")}
                            >
                              {t('delivery_reps.van_financial_ledger_admin_tab.s65', "إعفاء")}
                            </button>

                            {isShortage && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedIds([it.id]);
                                  setIsPushPayrollOpen(true);
                                }}
                                style={{
                                  height: '26px',
                                  padding: '0 8px',
                                  borderRadius: '6px',
                                  border: '1px solid #e2e8f0',
                                  backgroundColor: '#ffffff',
                                  color: '#170e5e',
                                  fontSize: '10.5px',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap',
                                  boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                                }}
                                title={t('delivery_reps.van_financial_ledger_admin_tab.s66', "ترحيل كاستقطاع لمسير الرواتب")}
                              >
                                {t('delivery_reps.van_financial_ledger_admin_tab.s67', "للمرتبات ↗")}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span style={{ fontSize: '11px', color: '#166534', fontWeight: 700 }}>
                            <CheckIcon size={12} color="#166534" style={{ display: 'inline', verticalAlign: 'middle', marginInlineEnd: '2px' }} />
                            {t('delivery_reps.van_financial_ledger_admin_tab.s68', "تم الإقفال")}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL 1: Settle Item Modal (Cash or Administrative Waiver) */}
      {settleModalItem && (
        <StandardDialog
          isOpen={Boolean(settleModalItem)}
          onClose={() => { setSettleModalItem(null); setSettlePin(''); }}
          title={settleMethod === 'cash' ? t('delivery_reps.van_financial_ledger_admin_tab.s69', "إثبات سداد نقدي وتوريد للخزينة") : t('delivery_reps.van_financial_ledger_admin_tab.s70', "تسوية وإعفاء إداري معتمد")}
          subtitle={`المندوب: ${settleModalItem.repName} | المبلغ: ${Number(settleModalItem.amount).toFixed(2)} ج.م`}
          width="480px"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 0' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setSettleMethod('cash')}
                style={{
                  flex: 1,
                  height: '36px',
                  borderRadius: '7px',
                  border: settleMethod === 'cash' ? '1.5px solid #16a34a' : '1px solid #cbd5e1',
                  backgroundColor: settleMethod === 'cash' ? '#f0fdf4' : '#f8fafc',
                  color: settleMethod === 'cash' ? '#15803d' : '#475569',
                  fontWeight: 800,
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                {t('delivery_reps.van_financial_ledger_admin_tab.s71', "سداد نقدي بالخزينة (سند قبض)")}
              </button>
              <button
                type="button"
                onClick={() => setSettleMethod('waiver')}
                style={{
                  flex: 1,
                  height: '36px',
                  borderRadius: '7px',
                  border: settleMethod === 'waiver' ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                  backgroundColor: settleMethod === 'waiver' ? '#eef2ff' : '#f8fafc',
                  color: settleMethod === 'waiver' ? '#170e5e' : '#475569',
                  fontWeight: 800,
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                {t('delivery_reps.van_financial_ledger_admin_tab.s72', "إعفاء / تسوية إدارية")}
              </button>
            </div>

            <div
              style={{
                backgroundColor: settleMethod === 'cash' ? '#f0fdf4' : '#f8fafc',
                border: `1px solid ${settleMethod === 'cash' ? '#bbf7d0' : '#e2e8f0'}`,
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '12px',
                color: '#334155',
                lineHeight: 1.5,
              }}
            >
              {settleMethod === 'cash' ? (
                <div>
                  {t('delivery_reps.van_financial_ledger_admin_tab.s73', "سيتم تسجيل استلام مبلغ")} <strong>{Number(settleModalItem.amount).toFixed(2)} {t('delivery_reps.van_financial_ledger_admin_tab.s74', "ج.م")}</strong> {t('delivery_reps.van_financial_ledger_admin_tab.s75', "نقداً من المندوب في الخزينة الرئيسية، وتوليد رقم سند قبض رسمي وتصفير هذا العجز نهائياً.")}
                </div>
              ) : (
                <div>
                  {t('delivery_reps.van_financial_ledger_admin_tab.s76', "سيتم إعفاء المندوب من هذا المبلغ واعتباره تسوية إدارية مبررة دون خصمها من المندوب أو سدادها نقدياً.")}
                </div>
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                {t('delivery_reps.van_financial_ledger_admin_tab.s77', "ملاحظات ومبررات التسوية:")}
                {settleMethod === 'waiver' && <span style={{ color: '#dc2626' }}> *</span>}
              </label>
              <textarea
                value={settleNotes}
                onChange={(e) => setSettleNotes(e.target.value)}
                placeholder={settleMethod === 'cash' ? t('delivery_reps.van_financial_ledger_admin_tab.s78', "مثال: تم التوريد نقداً لأمين الخزينة...") : t('delivery_reps.van_financial_ledger_admin_tab.s79', "مثال: إعفاء بنسبة العجز المقبولة بقرار الإدارة...")}
                rows={3}
                style={{
                  width: '100%',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: '8px 10px',
                  fontSize: '12px',
                  boxSizing: 'border-box',
                }}
              />
              {settleMethod === 'waiver' && !settleNotes.trim() && (
                <div style={{ fontSize: '11px', color: '#dc2626', marginTop: '4px' }}>
                  {t('delivery_reps.van_financial_ledger_admin_tab.s86', "سبب الإعفاء إلزامي — لا يمكن اعتماد الإعفاء بدون سبب مسجل.")}
                </div>
              )}
            </div>

            {settleMethod === 'waiver' && Number(settleModalItem.amount) > REP_WAIVER_PIN_THRESHOLD_DEFAULT && (
              <div>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                  {t('delivery_reps.van_financial_ledger_admin_tab.s87', "رمز اعتماد المشرف (PIN):")}
                  <span style={{ color: '#dc2626' }}> *</span>
                </label>
                <input
                  type="password"
                  value={settlePin}
                  onChange={(e) => setSettlePin(e.target.value)}
                  placeholder={t('delivery_reps.van_financial_ledger_admin_tab.s88', "أدخل رمز المشرف أو كلمة مرور المدير")}
                  autoComplete="off"
                  style={{
                    width: '100%',
                    height: '35px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    padding: '0 10px',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  {t('delivery_reps.van_financial_ledger_admin_tab.s89', "المبلغ فوق حد الاعتماد (500) فيتطلب اعتماد مشرف؛ ولا يجوز لمن اعتمد تصفية الرحلة أن يعتمد إعفاءها.")}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <Button
                variant="primary"
                onClick={() =>
                  settleMutation.mutate({
                    id: settleModalItem.id,
                    method: settleMethod,
                    notes: settleNotes.trim() || undefined,
                    reason: settleMethod === 'waiver' ? settleNotes.trim() || undefined : undefined,
                    supervisorPin:
                      settleMethod === 'waiver' && Number(settleModalItem.amount) > REP_WAIVER_PIN_THRESHOLD_DEFAULT
                        ? settlePin.trim() || undefined
                        : undefined,
                  })
                }
                disabled={
                  settleMutation.isPending ||
                  (settleMethod === 'waiver' &&
                    (!settleNotes.trim() ||
                      (Number(settleModalItem.amount) > REP_WAIVER_PIN_THRESHOLD_DEFAULT && !settlePin.trim())))
                }
                style={{
                  flex: 1,
                  height: '36px',
                  backgroundColor: settleMethod === 'cash' ? '#16a34a' : '#170e5e',
                  fontSize: '12.5px',
                  fontWeight: 800,
                }}
              >
                {settleMutation.isPending ? t('delivery_reps.van_financial_ledger_admin_tab.s80', "جاري الحفظ...") : settleMethod === 'cash' ? t('delivery_reps.van_financial_ledger_admin_tab.s81', "تأكيد استلام النقدية وإصدار السند") : t('delivery_reps.van_financial_ledger_admin_tab.s82', "اعتماد الإعفاء والتسوية")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setSettleModalItem(null)}
                style={{ height: '36px' }}
              >
                {t('delivery_reps.van_financial_ledger_admin_tab.s83', "إلغاء")}
              </Button>
            </div>
          </div>
        </StandardDialog>
      )}

      {/* MODAL 2: Add Rep Bonus / Commission Modal */}
      {isAddBonusOpen && (
        <StandardDialog
          isOpen={isAddBonusOpen}
          onClose={() => setIsAddBonusOpen(false)}
          title={t('delivery_reps.van_financial_ledger_admin_tab.s84', "قيد مكافأة تميز أو عمولة بيع للمندوب")}
          subtitle={t('delivery_reps.van_financial_ledger_admin_tab.s85', "تضاف لرصيد المندوب في المركز المالي ويمكن ترحيلها مع مسير الرواتب")}
          width="480px"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 0' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                {t('delivery_reps.van_financial_ledger_admin_tab.s86', "اختيار المندوب:")}
              </label>
              <CustomSelect
                value={bonusRepId}
                onChange={(val) => setBonusRepId(val)}
                options={[
                  { value: '', label: t('delivery_reps.van_financial_ledger_admin_tab.s87', "-- اختر المندوب --") },
                  ...allReps.map((r) => ({
                    value: String(r.id),
                    label: `${r.name} ${r.phone ? `(${r.phone})` : ''}`,
                  })),
                ]}
                placeholder={t('delivery_reps.van_financial_ledger_admin_tab.s88', "اختر المندوب")}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setBonusType('bonus')}
                style={{
                  flex: 1,
                  height: '34px',
                  borderRadius: '6px',
                  border: bonusType === 'bonus' ? '1.5px solid #6d28d9' : '1px solid #cbd5e1',
                  backgroundColor: bonusType === 'bonus' ? '#f5f3ff' : '#f8fafc',
                  color: bonusType === 'bonus' ? '#6d28d9' : '#475569',
                  fontWeight: 800,
                  fontSize: '11.5px',
                  cursor: 'pointer',
                }}
              >
                {t('delivery_reps.van_financial_ledger_admin_tab.s89', "مكافأة / بونص تحقيق تارجت")}
              </button>
              <button
                type="button"
                onClick={() => setBonusType('commission')}
                style={{
                  flex: 1,
                  height: '34px',
                  borderRadius: '6px',
                  border: bonusType === 'commission' ? '1.5px solid #16a34a' : '1px solid #cbd5e1',
                  backgroundColor: bonusType === 'commission' ? '#f0fdf4' : '#f8fafc',
                  color: bonusType === 'commission' ? '#16a34a' : '#475569',
                  fontWeight: 800,
                  fontSize: '11.5px',
                  cursor: 'pointer',
                }}
              >
                {t('delivery_reps.van_financial_ledger_admin_tab.s90', "عمولة بيع وتوزيع")}
              </button>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                {t('delivery_reps.van_financial_ledger_admin_tab.s91', "المبلغ بالجنية (ج.م):")}
              </label>
              <input
                type="number"
                step="0.01"
                value={bonusAmount}
                onChange={(e) => setBonusAmount(e.target.value)}
                placeholder="0.00"
                style={{
                  width: '100%',
                  height: '36px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: '0 10px',
                  fontSize: '14px',
                  fontWeight: 800,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                {t('delivery_reps.van_financial_ledger_admin_tab.s92', "البيان وسبب الصرف:")}
              </label>
              <textarea
                value={bonusNotes}
                onChange={(e) => setBonusNotes(e.target.value)}
                placeholder={t('delivery_reps.van_financial_ledger_admin_tab.s93', "مثال: تحقيق 110% من المستهدف البيعي للأسبوع الثاني...")}
                rows={2}
                style={{
                  width: '100%',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: '8px 10px',
                  fontSize: '12px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <Button
                variant="primary"
                onClick={() =>
                  addBonusMutation.mutate({
                    repId: Number(bonusRepId),
                    entryType: bonusType,
                    amount: Number(bonusAmount),
                    notes: bonusNotes.trim(),
                  })
                }
                disabled={addBonusMutation.isPending || !bonusRepId || !Number(bonusAmount)}
                style={{
                  flex: 1,
                  height: '36px',
                  backgroundColor: '#6d28d9',
                  fontSize: '12.5px',
                  fontWeight: 800,
                }}
              >
                {addBonusMutation.isPending ? t('delivery_reps.van_financial_ledger_admin_tab.s94', "جاري القيد...") : t('delivery_reps.van_financial_ledger_admin_tab.s95', "اعتماد وقيد المكافأة")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setIsAddBonusOpen(false)}
                style={{ height: '36px' }}
              >
                {t('delivery_reps.van_financial_ledger_admin_tab.s96', "إلغاء")}
              </Button>
            </div>
          </div>
        </StandardDialog>
      )}

      {/* MODAL 3: Bulk Push to Payroll Modal */}
      {isPushPayrollOpen && (
        <StandardDialog
          isOpen={isPushPayrollOpen}
          onClose={() => setIsPushPayrollOpen(false)}
          title={t('delivery_reps.van_financial_ledger_admin_tab.s97', "ترحيل العجوزات المحددة كاستقطاعات لمسير الرواتب")}
          subtitle={`تم تحديد ${selectedIds.length} بند للتسوية والخصم الرسمي من راتب المندوب`}
          width="480px"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 0' }}>
            <div
              style={{
                backgroundColor: '#eef2ff',
                border: '1px solid #c7d2fe',
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '12px',
                color: '#3730a3',
                lineHeight: 1.5,
              }}
            >
              {t('delivery_reps.van_financial_ledger_admin_tab.s98', "سيتم نقل هذه العجوزات مباشرة إلى موديول الرواتب والأجور (HR) كبند استقطاع رسمي تحت مسمى (عجز عهدة سيارة توزيع) في مسير الشهر المحدد، وبذلك تقفل في كشف حساب المندوب.")}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                {t('delivery_reps.van_financial_ledger_admin_tab.s99', "مسير راتب شهر الاستحقاق:")}
              </label>
              <input
                type="month"
                value={payrollTargetMonth}
                onChange={(e) => setPayrollTargetMonth(e.target.value)}
                style={{
                  width: '100%',
                  height: '36px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: '0 10px',
                  fontSize: '13px',
                  fontWeight: 700,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <Button
                variant="primary"
                onClick={() =>
                  pushPayrollMutation.mutate({
                    settlementIds: selectedIds,
                    targetMonth: payrollTargetMonth,
                  })
                }
                disabled={pushPayrollMutation.isPending || selectedIds.length === 0}
                style={{
                  flex: 1,
                  height: '36px',
                  backgroundColor: '#170e5e',
                  fontSize: '12.5px',
                  fontWeight: 800,
                }}
              >
                {pushPayrollMutation.isPending ? t('delivery_reps.van_financial_ledger_admin_tab.s100', "جاري الترحيل...") : t('delivery_reps.van_financial_ledger_admin_tab.s101', "تأكيد الترحيل لمسير الرواتب")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setIsPushPayrollOpen(false)}
                style={{ height: '36px' }}
              >
                {t('delivery_reps.van_financial_ledger_admin_tab.s102', "إلغاء")}
              </Button>
            </div>
          </div>
        </StandardDialog>
      )}

      {/* MODAL 4: Link Delivery Rep to HR Employee */}
      {linkingRep && (
        <StandardDialog
          isOpen={Boolean(linkingRep)}
          onClose={() => setLinkingRep(null)}
          title={t('delivery_reps.van_financial_ledger_admin_tab.s103', "ربط مندوب التوزيع بملف موظف في الموارد البشرية (HR)")}
          subtitle={`المندوب: ${linkingRep.repName} (معرف #${linkingRep.repId})`}
          width="480px"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '8px 0' }}>
            <div
              style={{
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '12px',
                color: '#1e40af',
                lineHeight: 1.5,
              }}
            >
              {t('delivery_reps.van_financial_ledger_admin_tab.s104', "ربط المندوب بموظف HR يسمح بترحيل أي عجوزات مالية مباشرة كاستقطاعات رسمية في مسير رواتب الموظف، وكذلك صرف العمولات والمكافآت مع الراتب الشهري.")}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#0f172a', marginBottom: '6px' }}>
                {t('delivery_reps.van_financial_ledger_admin_tab.s105', "اختر الموظف المطابق من شجرة الموارد البشرية:")}
              </label>
              <CustomSelect
                value={selectedCandidateEmployeeId}
                onChange={(val) => setSelectedCandidateEmployeeId(val)}
                options={[
                  { value: '', label: t('delivery_reps.van_financial_ledger_admin_tab.s106', "-- غير مربوط بأي موظف (فصل الارتباط) --") },
                  ...candidateEmployees.map((emp) => ({
                    value: String(emp.id),
                    label: `${emp.displayName} ${emp.employeeNo ? `(كود: ${emp.employeeNo})` : ''} ${emp.nationalId ? `(رقم قومي: ${emp.nationalId})` : ''}`,
                  })),
                ]}
                placeholder={t('delivery_reps.van_financial_ledger_admin_tab.s107', "اختر موظف HR")}
              />
            </div>

            {candidateEmployees.length === 0 && (
              <div style={{ fontSize: '11.5px', color: '#b45309', backgroundColor: '#fef3c7', padding: '8px 10px', borderRadius: '6px', border: '1px solid #fde68a' }}>
                {t('delivery_reps.van_financial_ledger_admin_tab.s108', "لا يوجد موظفون متاحون حالياً في دليل الموارد البشرية. يمكنك إنشاء ملف موظف رسمي للمندوب فوراً بالزر أدناه:")}
              </div>
            )}

            <div style={{ paddingTop: '2px' }}>
              <Button
                variant="secondary"
                onClick={() => autoCreateEmployeeMutation.mutate(linkingRep.repId)}
                disabled={autoCreateEmployeeMutation.isPending}
                style={{
                  width: '100%',
                  height: '36px',
                  backgroundColor: '#f8fafc',
                  border: '1.5px dashed #6366f1',
                  color: '#4338ca',
                  fontSize: '12px',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <span>{autoCreateEmployeeMutation.isPending ? t('delivery_reps.van_financial_ledger_admin_tab.s109', "جاري إنشاء ملف الموظف والربط...") : `+ إنشاء ملف موظف جديد في HR للمندوب (${linkingRep.repName}) وربطه فوراً`}</span>
              </Button>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <Button
                variant="primary"
                onClick={() =>
                  linkRepMutation.mutate({
                    repId: linkingRep.repId,
                    employeeId: selectedCandidateEmployeeId ? Number(selectedCandidateEmployeeId) : null,
                  })
                }
                disabled={linkRepMutation.isPending || autoCreateEmployeeMutation.isPending}
                style={{
                  flex: 1,
                  height: '36px',
                  backgroundColor: '#170e5e',
                  fontSize: '12.5px',
                  fontWeight: 800,
                }}
              >
                {linkRepMutation.isPending ? t('delivery_reps.van_financial_ledger_admin_tab.s110', "جاري الحفظ...") : t('delivery_reps.van_financial_ledger_admin_tab.s111', "حفظ وتحديث الربط")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setLinkingRep(null)}
                style={{ height: '36px' }}
              >
                {t('delivery_reps.van_financial_ledger_admin_tab.s112', "إلغاء")}
              </Button>
            </div>
          </div>
        </StandardDialog>
      )}
    </div>
  );
}
