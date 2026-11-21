import { useMutation, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';
import { toast } from '@/shared/components/system-alert';
import { vanSalesApi, type VanRepFinancialSettlementItem } from '../../api/van-sales.api';

export function useLedgerMutations(args: {
  queryClient: QueryClient;
  bonusType: 'bonus' | 'commission';
  linkingRep: {
    repId: number;
    repName: string;
    employeeId: number | null;
  } | null;
  setBonusAmount: Dispatch<SetStateAction<string>>;
  setBonusNotes: Dispatch<SetStateAction<string>>;
  setBonusRepId: Dispatch<SetStateAction<string>>;
  setIsAddBonusOpen: Dispatch<SetStateAction<boolean>>;
  setIsPushPayrollOpen: Dispatch<SetStateAction<boolean>>;
  setLinkingRep: Dispatch<
    SetStateAction<{ repId: number; repName: string; employeeId: number | null } | null>
  >;
  setSelectedIds: Dispatch<SetStateAction<number[]>>;
  setSettleModalItem: Dispatch<SetStateAction<VanRepFinancialSettlementItem | null>>;
  setSettleNotes: Dispatch<SetStateAction<string>>;
  setSettlePin: Dispatch<SetStateAction<string>>;
}) {
  const {
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
  } = args;

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

  return {
    settleMutation,
    pushPayrollMutation,
    addBonusMutation,
    candidateEmployees,
    linkRepMutation,
    autoCreateEmployeeMutation,
  };
}
