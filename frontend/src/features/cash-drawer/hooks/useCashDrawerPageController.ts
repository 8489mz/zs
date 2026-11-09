import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { formatCurrency } from '@/lib/format';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { useCashierShifts } from '@/features/cash-drawer/hooks/useCashierShifts';
import { useCashDrawerCatalog } from '@/features/cash-drawer/hooks/useCashDrawerCatalog';
import { useCashDrawerMutations } from '@/features/cash-drawer/hooks/useCashDrawerMutations';
import { useCashDrawerPageActions } from '@/features/cash-drawer/hooks/useCashDrawerPageActions';
import { useAuthStore } from '@/stores/auth-store';
import type { CashierShift } from '@/types/domain';

export interface OpenShiftValues {
  openingCash: number;
  note: string;
  branchId: string;
  locationId: string;
  password?: string;
}

export interface MovementValues {
  shiftId: string;
  type: 'cash_in' | 'cash_out' | 'safe_drop' | 'safe_replenishment';
  amount: number;
  note: string;
  /** Caller-named counterpart cash/bank account for safe_drop / safe_replenishment. */
  counterpartAccountId?: string;
  managerPin?: string;
}

export interface CloseShiftValues {
  shiftId: string;
  countedCash: number;
  cardDeclaredTotal: number;
  cardOperationCount: number;
  walletDeclaredTotal: number;
  walletOperationCount: number;
  instapayDeclaredTotal: number;
  instapayOperationCount: number;
  cardDetails: Array<{ amount?: number; reference?: string }>;
  walletDetails: Array<{ amount?: number; reference?: string }>;
  instapayDetails: Array<{ amount?: number; reference?: string }>;
  note: string;
  managerPin?: string;
  /**
   * INV-REST-SHIFT-CLOSE-CONTROL (I21): the second approver's
   * secret, required when |variance| is over the
   * shortage-tolerance cap. Sent only when the close actually
   * needs it; the server decides.
   */
  approverSecret?: string;
  /**
   * INV-REST-SHIFT-CLOSE-CONTROL (I20): override for a close
   * blocked by open tables / draft sales — a different manager's
   * secret plus a reason of at least 10 characters.
   */
  openTablesOverrideSecret?: string;
  openTablesOverrideReason?: string;
}

export type CashDrawerConfirmAction =
  | { kind: 'movement'; values: MovementValues }
  | { kind: 'close-shift'; values: CloseShiftValues };

export function useCashDrawerPageController() {
  const currentUser = useAuthStore((state) => state.user);
  const userRole = String(currentUser?.role || '').trim();
  const isBlindCloseUser = userRole === 'cashier';
  const isManagerReviewer = ['admin', 'super_admin', 'manager'].includes(userRole);
  const canViewSensitiveTotals = !isBlindCloseUser;

  const [search, setSearch] = useState('');
  const [shiftFilter, setShiftFilter] = useState<'all' | 'open' | 'closed' | 'pending_review' | 'variance' | 'today'>('all');
  const [copyFeedback, setCopyFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [shiftPage, setShiftPage] = useState(1);
  const [shiftPageSize, setShiftPageSize] = useState(20);
  const [confirmAction, setConfirmAction] = useState<CashDrawerConfirmAction | null>(null);
  const [reviewTargetShift, setReviewTargetShift] = useState<CashierShift | null>(null);
  const [reviewManagerNote, setReviewManagerNote] = useState('');

  const query = useCashierShifts({ page: shiftPage, pageSize: shiftPageSize, search, filter: shiftFilter });
  const openShiftOptionsQuery = useCashierShifts({ page: 1, pageSize: 100, filter: 'open' });
  const { branches, locations } = useCashDrawerCatalog();
  const rows = query.data?.rows || [];
  const pagination = query.data?.pagination;
  const summary = query.data?.summary || { totalItems: 0, openShiftCount: 0, pendingReviewCount: 0, openShiftDocNo: '', totalVariance: 0 };

  const openForm = useForm<OpenShiftValues>({ defaultValues: { openingCash: 0, note: '', branchId: '', locationId: '', password: '' } });
  const movementForm = useForm<MovementValues>({ defaultValues: { shiftId: '', type: 'cash_in', amount: 0, note: '', counterpartAccountId: '', managerPin: '' } });
  const closeForm = useForm<CloseShiftValues>({
    defaultValues: {
      shiftId: '',
      countedCash: undefined as unknown as number,
      cardDeclaredTotal: undefined as unknown as number,
      cardOperationCount: 0,
      walletDeclaredTotal: undefined as unknown as number,
      walletOperationCount: 0,
      instapayDeclaredTotal: undefined as unknown as number,
      instapayOperationCount: 0,
      cardDetails: [],
      walletDetails: [],
      instapayDetails: [],
      note: '',
      managerPin: '',
      approverSecret: '',
      openTablesOverrideSecret: '',
      openTablesOverrideReason: '',
    },
  });

  const { openMutation, movementMutation, closeMutation, reviewMutation } = useCashDrawerMutations({
    onOpenSuccess: () => {
      const defaultBranch = (currentUser?.defaultBranchId && branches.find(b => String(b.id) === String(currentUser.defaultBranchId)))
        || branches.find(b => b.name.includes('الرئيسي') || b.name.toLowerCase().includes('main'))
        || branches[0];
      const branchId = defaultBranch?.id || '';
      const branchLocations = locations.filter(l => !l.branchId || String(l.branchId) === String(branchId));
      const defaultLocation = (defaultBranch?.defaultStockLocationId && locations.find(l => String(l.id) === String(defaultBranch.defaultStockLocationId)))
        || branchLocations.find(l => l.name.includes('الرئيسي') || l.name.toLowerCase().includes('main'))
        || branchLocations[0]
        || locations[0];
      openForm.reset({
        openingCash: 0,
        note: '',
        branchId,
        locationId: defaultLocation?.id || '',
        password: '',
      });
    },
    onMovementSuccess: () => movementForm.reset({ shiftId: '', type: 'cash_in', amount: 0, note: '', counterpartAccountId: '', managerPin: '' }),
    onCloseSuccess: () => closeForm.reset({
      shiftId: '',
      countedCash: undefined as unknown as number,
      cardDeclaredTotal: undefined as unknown as number,
      cardOperationCount: 0,
      walletDeclaredTotal: undefined as unknown as number,
      walletOperationCount: 0,
      instapayDeclaredTotal: undefined as unknown as number,
      instapayOperationCount: 0,
      cardDetails: [],
      walletDetails: [],
      instapayDetails: [],
      note: '',
      managerPin: '',
      approverSecret: '',
      openTablesOverrideSecret: '',
      openTablesOverrideReason: '',
    }),
    onReviewSuccess: () => {
      setReviewManagerNote('');
      setReviewTargetShift(null);
    },
  });

  useEffect(() => {
    if (branches.length === 0 && locations.length === 0) return;
    const currentBranchId = openForm.getValues('branchId');
    const defaultBranch = (currentUser?.defaultBranchId && branches.find(b => String(b.id) === String(currentUser.defaultBranchId)))
      || branches.find(b => b.name.includes('الرئيسي') || b.name.toLowerCase().includes('main'))
      || branches[0];
    const resolvedBranchId = currentBranchId || defaultBranch?.id || '';

    if (!currentBranchId && resolvedBranchId) {
      openForm.setValue('branchId', resolvedBranchId);
    }

    const currentLocationId = openForm.getValues('locationId');
    const branchLocations = locations.filter(l => !l.branchId || String(l.branchId) === String(resolvedBranchId));
    const defaultLocation = (defaultBranch?.defaultStockLocationId && locations.find(l => String(l.id) === String(defaultBranch.defaultStockLocationId)))
      || branchLocations.find(l => l.name.includes('الرئيسي') || l.name.toLowerCase().includes('main'))
      || branchLocations[0]
      || locations[0];

    if (!currentLocationId && defaultLocation?.id) {
      openForm.setValue('locationId', defaultLocation.id);
    }
  }, [branches, locations, currentUser?.defaultBranchId, openForm]);

  useEffect(() => {
    setShiftPage(1);
  }, [search, shiftFilter]);

  const openOptions = useMemo(() => openShiftOptionsQuery.data?.rows || [], [openShiftOptionsQuery.data?.rows]);

  const myOpenShift = useMemo(() => {
    if (!currentUser) return null;
    const currentId = String(currentUser.id || (currentUser as any).userId || '').trim();
    const currentUsername = String(currentUser.username || '').trim().toLowerCase();
    const currentDisplayName = String(currentUser.displayName || '').trim().toLowerCase();

    return openOptions.find((shift) => {
      const shiftOpenerId = String(shift.openedById || '').trim();
      if (currentId && shiftOpenerId && shiftOpenerId === currentId) return true;
      const shiftOpenerName = String(shift.openedByName || '').trim().toLowerCase();
      if (currentUsername && shiftOpenerName === currentUsername) return true;
      if (currentDisplayName && shiftOpenerName === currentDisplayName) return true;
      return false;
    }) || null;
  }, [openOptions, currentUser]);

  const hasMyOpenShift = Boolean(myOpenShift);
  const isSuperAdminOrManager = ['super_admin', 'admin', 'manager'].includes(userRole);

  const canOpenShift = !hasMyOpenShift;
  const openDisabledHint = hasMyOpenShift ? 'لديك وردية مفتوحة بالفعل، يجب إغلاقها أولاً لفتح وردية جديدة.' : '';

  const canCloseShift = isSuperAdminOrManager ? openOptions.length > 0 : hasMyOpenShift;
  const closeDisabledHint = isSuperAdminOrManager
    ? (openOptions.length === 0 ? 'لا توجد أي ورديات مفتوحة حالياً في النظام لإغلاقها.' : '')
    : (!hasMyOpenShift ? 'لا توجد لديك وردية مفتوحة لإغلاقها.' : '');

  const canRecordMovement = isSuperAdminOrManager ? openOptions.length > 0 : hasMyOpenShift;
  const movementDisabledHint = isSuperAdminOrManager
    ? (openOptions.length === 0 ? 'لا توجد أي ورديات مفتوحة لتسجيل حركة نقدية عليها.' : '')
    : (!hasMyOpenShift ? 'يجب فتح وردية أولاً لتسجيل حركة درج النقدية.' : '');

  useEffect(() => {
    const targetShiftId = myOpenShift?.id || (isSuperAdminOrManager ? openOptions[0]?.id : '');
    if (targetShiftId) {
      movementForm.setValue('shiftId', String(targetShiftId));
      closeForm.setValue('shiftId', String(targetShiftId));
    }
  }, [closeForm, movementForm, openOptions, myOpenShift, isSuperAdminOrManager]);

  const selectedCloseShift = openOptions.find((shift) => String(shift.id) === String(closeForm.watch('shiftId'))) || null;

  useEffect(() => {
    if (selectedCloseShift) {
      const cardCount = Number(selectedCloseShift.cardOperationCount || 0);
      const walletCount = Number(selectedCloseShift.walletOperationCount || 0);
      const instapayCount = Number(selectedCloseShift.instapayOperationCount || 0);

      closeForm.setValue('cardOperationCount', cardCount, { shouldDirty: false });
      closeForm.setValue('walletOperationCount', walletCount, { shouldDirty: false });
      closeForm.setValue('instapayOperationCount', instapayCount, { shouldDirty: false });
    }
  }, [
    selectedCloseShift?.id,
    selectedCloseShift?.cardOperationCount,
    selectedCloseShift?.walletOperationCount,
    selectedCloseShift?.instapayOperationCount,
    closeForm,
  ]);

  const closeExpectedCash = Number(selectedCloseShift?.expectedCash || 0);
  const closeCountedCash = Number(closeForm.watch('countedCash') || 0);
  // INV-FE1-FRONTEND-BOOK-DIGITS: close variance preview rounds at
  // the tenant's book digits (global system currency).
  const closeVariancePreview = roundMoneyValue(closeCountedCash - closeExpectedCash, currencyMoneyDigits(getGlobalSystemCurrency()));
  const closeNoteValue = String(closeForm.watch('note') || '').trim();

  const openShift = openOptions[0] || (summary.openShiftDocNo ? { docNo: summary.openShiftDocNo } : null);
  const openShiftCount = summary.openShiftCount;
  const pendingReviewCount = Number(summary.pendingReviewCount || 0);
  const totalVariance = Number(summary.totalVariance || 0);

  const { exportShiftRows, printShiftRows } = useCashDrawerPageActions({ search, shiftFilter, totalItems: summary.totalItems, openShiftCount, totalVariance });

  const resetShiftView = () => {
    setSearch('');
    setShiftFilter('all');
    setShiftPage(1);
  };

  const copyShiftSummary = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    const lines = [
      'ملخص الورديات والدرج النقدي',
      `عدد الورديات المطابقة: ${summary.totalItems}`,
      `الورديات المفتوحة: ${openShiftCount}`,
      `في انتظار مراجعة المدير: ${pendingReviewCount}`,
      `الوردية النشطة: ${openShift?.openedByName || openShift?.docNo || 'لا يوجد'}`,
      `إجمالي الفروقات: ${formatCurrency(totalVariance)}`,
    ];

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopyFeedback({ kind: 'success', text: 'تم نسخ ملخص الورديات بنجاح.' });
    } catch {
      setCopyFeedback({ kind: 'error', text: 'تعذر نسخ ملخص الورديات.' });
    }
  };

  const performConfirmedAction = async (managerPin: string) => {
    if (!confirmAction) return;
    try {
      if (confirmAction.kind === 'movement') {
        await movementMutation.mutateAsync({ ...confirmAction.values, managerPin });
        setConfirmAction(null);
        return;
      }
      if (confirmAction.kind === 'close-shift') {
        await closeMutation.mutateAsync({ ...confirmAction.values, managerPin });
        setConfirmAction(null);
      }
    } catch {
      // mutation hooks already expose structured errors in page feedback areas.
    }
  };

  // INV-REST-SAFE-TRANSFER-TYPES: movements post through the
  // confirm dialog, which collects the approval secret the backend
  // requires for every movement (manager PIN for cash_out /
  // safe_drop by non-managers, own password otherwise). The direct
  // mutation path sent managerPin '' and every movement failed
  // server-side (CURRENT_USER_PASSWORD_REQUIRED / MANAGER_PIN_INVALID),
  // so the safe-transfer options would have been dead on arrival.
  // This restores the routing from c1483d61 that 1613c95b dropped
  // when the approval check was (temporarily) removed server-side.
  const handleMovementSubmit = movementForm.handleSubmit((values) => {
    setConfirmAction({ kind: 'movement', values });
  });

  const handleCloseSubmit = closeForm.handleSubmit(async (values) => {
    try {
      await closeMutation.mutateAsync(values);
    } catch {
      // hook exposes error
    }
  });

  const openReviewDialog = (shift: CashierShift) => {
    reviewMutation.reset?.();
    setReviewManagerNote('');
    setReviewTargetShift(shift);
  };

  const closeReviewDialog = () => {
    reviewMutation.reset?.();
    setReviewManagerNote('');
    setReviewTargetShift(null);
  };

  const submitPendingReview = async (decision: 'approve' | 'reject' = 'approve') => {
    if (!reviewTargetShift?.id) return;
    try {
      await reviewMutation.mutateAsync({ shiftId: String(reviewTargetShift.id), decision, note: reviewManagerNote });
    } catch {
      // mutation hook exposes the error state for the dialog.
    }
  };

  return {
    currentUser,
    userRole,
    isBlindCloseUser,
    isManagerReviewer,
    canViewSensitiveTotals,
    search,
    shiftFilter,
    copyFeedback,
    shiftPage,
    shiftPageSize,
    confirmAction,
    query,
    rows,
    pagination,
    summary,
    openForm,
    movementForm,
    closeForm,
    openMutation,
    movementMutation,
    closeMutation,
    reviewMutation,
    branches,
    locations,
    openOptions,
    myOpenShift,
    hasMyOpenShift,
    canOpenShift,
    canCloseShift,
    canRecordMovement,
    openDisabledHint,
    closeDisabledHint,
    movementDisabledHint,
    closeExpectedCash,
    closeVariancePreview,
    closeNoteValue,
    openShift,
    openShiftCount,
    pendingReviewCount,
    totalVariance,
    reviewTargetShift,
    reviewManagerNote,
    setSearch,
    setShiftFilter,
    setShiftPage,
    setShiftPageSize,
    setConfirmAction,
    setReviewManagerNote,
    exportShiftRows,
    printShiftRows,
    resetShiftView,
    copyShiftSummary,
    performConfirmedAction,
    handleMovementSubmit,
    handleCloseSubmit,
    openReviewDialog,
    closeReviewDialog,
    submitPendingReview,
  };
}
