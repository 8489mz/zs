import { useTranslation } from 'react-i18next';
import { isCashDrawerTransferType } from '@/features/cash-drawer/lib/cash-drawer-movement-request-key';
import { useCounterpartAccounts } from '@/features/cash-drawer/hooks/useCounterpartAccounts';
import { useEffect, useMemo, useState } from 'react';
import { type UseFormReturn } from 'react-hook-form';
import { DialogShell } from '@/shared/components/dialog-shell';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import type { Branch, CashierShift, Location } from '@/types/domain';
import type { CloseShiftValues, MovementValues, OpenShiftValues } from '@/features/cash-drawer/hooks/useCashDrawerPageController';
import { getOfflineSalesQueue } from '@/features/pos';
import {
  PaymentChannelRow,
  type DetailChannel,
} from '@/features/cash-drawer/components/cash-drawer-forms/PaymentChannelRow';
import { CashDrawerOpenForm, type MutationLike } from '@/features/cash-drawer/components/cash-drawer-forms/CashDrawerOpenForm';
import { CashDrawerMovementForm } from '@/features/cash-drawer/components/cash-drawer-forms/CashDrawerMovementForm';
import { CashDrawerCloseStyleHeader } from '@/features/cash-drawer/components/cash-drawer-forms/CashDrawerCloseStyleHeader';
import { CashDrawerCloseForm } from '@/features/cash-drawer/components/cash-drawer-forms/CashDrawerCloseForm';
import { CardIcon, InstaPayIcon, WalletIcon } from '@/features/cash-drawer/components/cash-drawer-forms/cash-drawer-form-icons';

interface CashDrawerFormsPanelProps {
  activeForm: 'open' | 'movement' | 'close' | null;
  onCloseForm: () => void;
  branches: Branch[];
  locations: Location[];
  openOptions: CashierShift[];
  myOpenShift?: CashierShift | null;
  isManager?: boolean;
  openForm: UseFormReturn<OpenShiftValues>;
  movementForm: UseFormReturn<MovementValues>;
  closeForm: UseFormReturn<CloseShiftValues>;
  openMutation: MutationLike & { mutate: (values: OpenShiftValues) => void };
  movementMutation: MutationLike;
  closeMutation: MutationLike;
  closeExpectedCash: number;
  closeVariancePreview: number;
  closeNoteValue: string;
  isBlindCloseMode?: boolean;
  requirePasswordOnShiftOpen?: boolean;
  onMovementSubmit: () => void;
  onCloseSubmit: () => void;
}

function normalizeCount(value: unknown): number {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function closeErrorCode(error: unknown): string {
  const candidate = error as { code?: unknown } | null;
  return typeof candidate?.code === 'string' ? candidate.code : '';
}

export function CashDrawerFormsPanel(props: CashDrawerFormsPanelProps) {
  const { t } = useTranslation();
  const locationList = Array.isArray(props.locations) ? props.locations : [];
  const isBlindCloseMode = props.isBlindCloseMode === true;

  const selectedCloseShift = props.openOptions.find((shift) => String(shift.id) === String(props.closeForm.watch('shiftId'))) || null;
  const closeCashSalesTotal = Number(selectedCloseShift?.cashSalesTotal || 0);
  const closeCardSalesTotal = Number(selectedCloseShift?.cardSalesTotal || 0);
  const closeCreditSalesTotal = Number(selectedCloseShift?.creditSalesTotal || 0);
  const closeDeliverySalesTotal = Number(selectedCloseShift?.deliverySalesTotal || 0);
  const closeShiftSalesTotal = Number(selectedCloseShift?.shiftSalesTotal || 0);
  const closeServiceCashTotal = Number(selectedCloseShift?.serviceCashTotal || 0);
  const closeCashDrawerMovementTotal = Number(selectedCloseShift?.cashDrawerMovementTotal || 0);
  const closeSaleReturnCashRefundTotal = Number(selectedCloseShift?.saleReturnCashRefundTotal || 0);
  const closeExpensesTotal = Number(selectedCloseShift?.expensesTotal || 0);
  const closeSupplierPaymentsTotal = Number(selectedCloseShift?.supplierPaymentsTotal || 0);
  // INV-REST-SHIFT-CLOSE-CONTROL (I25): the two expected-cash
  // components the close card used to hide, plus the opening cash
  // the footnote used to mention without showing.
  const closeOpeningCash = Number(selectedCloseShift?.openingCash || 0);
  const closeCustomerCollectionsTotal = Number(selectedCloseShift?.customerCollectionsTotal || 0);
  const closeCancelledSaleCashTotal = Number(selectedCloseShift?.cancelledSaleCashTotal || 0);
  const showOpenTablesOverride = closeErrorCode(props.closeMutation.error) === 'SHIFT_CLOSE_OPEN_TABLES';

  // INV-SHIFT-EXPECTED-PER-METHOD-COLLECTIONS: close counts cover the
  // same operations as the electronic expected totals (POS sales AND
  // customer-account receipts). Defaults stay 0 for open shifts.
  const cardOperationCount = normalizeCount(selectedCloseShift?.cardOperationCount ?? props.closeForm.watch('cardOperationCount')) + normalizeCount(selectedCloseShift?.customerCollectionsByChannel?.cardCount || 0);
  const walletOperationCount = normalizeCount(selectedCloseShift?.walletOperationCount ?? props.closeForm.watch('walletOperationCount')) + normalizeCount(selectedCloseShift?.customerCollectionsByChannel?.walletCount || 0);
  const instapayOperationCount = normalizeCount(selectedCloseShift?.instapayOperationCount ?? props.closeForm.watch('instapayOperationCount')) + normalizeCount(selectedCloseShift?.customerCollectionsByChannel?.instapayCount || 0);

  const [showCardDetails, setShowCardDetails] = useState(false);
  const [showWalletDetails, setShowWalletDetails] = useState(false);
  const [showInstapayDetails, setShowInstapayDetails] = useState(false);
  const isKwd = getGlobalSystemCurrency() === 'KWD';

  // INV-REST-SAFE-TRANSFER-TYPES: the counterpart picker lists only
  // the accounts the backend accepts for a safe transfer (active
  // cash/bank assets with a debit normal balance). Anything else
  // would be rejected server-side, so it is never offered — the
  // same filter rule as the import treasury dropdowns
  // (INV-IMPORT-ISCASHBANK-SWEEP).
  // INV-CASH-DRAWER-COUNTERPART-CASHIER-ACCESS: counterpart accounts
  // come from the narrow cash-drawer endpoint (see
  // useCounterpartAccounts) — the old query hit the admin-only
  // chart endpoint and a cashier's 403 was swallowed into an empty
  // list. A failed load now surfaces its real reason (s110/s111)
  // instead of the misleading "no accounts" hint. The drawer cash
  // account itself (1110) is still excluded inside the hook.
  const { accounts: cashBankAccounts, loadFailed: accountsLoadFailed, loadForbidden: accountsLoadForbidden } = useCounterpartAccounts();
  const movementType = props.movementForm.watch('type');
  const isTransferMovement = isCashDrawerTransferType(movementType);

  const [offlinePendingCount, setOfflinePendingCount] = useState(() => {
    try {
      return getOfflineSalesQueue().length;
    } catch {
      // Unknown queue size is NOT zero. The close must fail closed.
      return -1;
    }
  });

  useEffect(() => {
    const handleUpdate = () => {
      try {
        setOfflinePendingCount(getOfflineSalesQueue().length);
      } catch {
        setOfflinePendingCount(-1);
      }
    };
    window.addEventListener('pos-offline-queue-updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener('pos-offline-queue-updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  useEffect(() => {
    if (selectedCloseShift) {
      props.closeForm.setValue('cardOperationCount', cardOperationCount, { shouldDirty: false });
      props.closeForm.setValue('walletOperationCount', walletOperationCount, { shouldDirty: false });
      props.closeForm.setValue('instapayOperationCount', instapayOperationCount, { shouldDirty: false });
    }
  }, [
    selectedCloseShift?.id,
    cardOperationCount,
    walletOperationCount,
    instapayOperationCount,
    props.closeForm,
  ]);

  const ensureDetailsLength = (field: DetailChannel, size: number) => {
    const current = props.closeForm.getValues(field) || [];
    const next = [...current];
    if (next.length > size) next.length = size;
    while (next.length < size) {
      next.push({ amount: undefined });
    }
    props.closeForm.setValue(field, next, { shouldDirty: false });
  };

  useEffect(() => {
    ensureDetailsLength('cardDetails', cardOperationCount);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardOperationCount]);

  useEffect(() => {
    ensureDetailsLength('walletDetails', walletOperationCount);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletOperationCount]);

  useEffect(() => {
    ensureDetailsLength('instapayDetails', instapayOperationCount);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instapayOperationCount]);

  useEffect(() => {
    if (props.activeForm) {
      props.openMutation.reset?.();
      props.movementMutation.reset?.();
      props.closeMutation.reset?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.activeForm]);

  useEffect(() => {
    if (!props.activeForm) return;

    const isCurrentSuccess =
      (props.activeForm === 'open' && props.openMutation.isSuccess) ||
      (props.activeForm === 'movement' && props.movementMutation.isSuccess) ||
      (props.activeForm === 'close' && props.closeMutation.isSuccess);

    if (isCurrentSuccess) {
      const timeout = setTimeout(() => {
        props.onCloseForm();
      }, 1200);
      return () => clearTimeout(timeout);
    }
  }, [
    props.activeForm,
    props.openMutation.isSuccess,
    props.movementMutation.isSuccess,
    props.closeMutation.isSuccess,
    props.onCloseForm,
  ]);

  const watchedBranchId = props.openForm.watch('branchId');
  const availableLocations = useMemo(() => {
    if (!watchedBranchId) return locationList;
    const branchSpecific = locationList.filter((loc) => !loc.branchId || String(loc.branchId) === String(watchedBranchId));
    return branchSpecific.length > 0 ? branchSpecific : locationList;
  }, [locationList, watchedBranchId]);

  return (
    <DialogShell
      open={!!props.activeForm}
      onClose={props.onCloseForm}
      width={props.activeForm === 'close' ? 'min(940px, calc(100vw - 16px))' : 'min(600px, calc(100vw - 16px))'}
      shellClassName="cash-drawer-adaptive-dialog"
    >
      {props.activeForm === 'open' && (
        <CashDrawerOpenForm
          openForm={props.openForm}
          openMutation={props.openMutation}
          branches={props.branches}
          locationList={locationList}
          availableLocations={availableLocations}
          requirePasswordOnShiftOpen={props.requirePasswordOnShiftOpen}
          onCloseForm={props.onCloseForm}
        />
      )}

      {props.activeForm === 'movement' && (
        <CashDrawerMovementForm
          movementForm={props.movementForm}
          movementMutation={props.movementMutation}
          openOptions={props.openOptions}
          myOpenShift={props.myOpenShift}
          isManager={props.isManager}
          cashBankAccounts={cashBankAccounts}
          accountsLoadFailed={accountsLoadFailed}
          accountsLoadForbidden={accountsLoadForbidden}
          isTransferMovement={isTransferMovement}
          onMovementSubmit={props.onMovementSubmit}
          onCloseForm={props.onCloseForm}
        />
      )}

      {props.activeForm === 'close' && (
        <div className="cash-drawer-modal-scroll">
          <CashDrawerCloseStyleHeader
            closeForm={props.closeForm}
            myOpenShift={props.myOpenShift}
            openOptions={props.openOptions}
            offlinePendingCount={offlinePendingCount}
            onCloseForm={props.onCloseForm}
          />
          <CashDrawerCloseForm
            closeForm={props.closeForm}
            closeMutation={props.closeMutation}
            onCloseSubmit={props.onCloseSubmit}
            onCloseForm={props.onCloseForm}
            isManager={props.isManager}
            myOpenShift={props.myOpenShift}
            openOptions={props.openOptions}
            selectedCloseShift={selectedCloseShift}
            closeOpeningCash={closeOpeningCash}
            closeCashSalesTotal={closeCashSalesTotal}
            closeCardSalesTotal={closeCardSalesTotal}
            closeDeliverySalesTotal={closeDeliverySalesTotal}
            closeServiceCashTotal={closeServiceCashTotal}
            closeCreditSalesTotal={closeCreditSalesTotal}
            closeSaleReturnCashRefundTotal={closeSaleReturnCashRefundTotal}
            closeCashDrawerMovementTotal={closeCashDrawerMovementTotal}
            closeExpensesTotal={closeExpensesTotal}
            closeSupplierPaymentsTotal={closeSupplierPaymentsTotal}
            closeCustomerCollectionsTotal={closeCustomerCollectionsTotal}
            closeCancelledSaleCashTotal={closeCancelledSaleCashTotal}
            closeShiftSalesTotal={closeShiftSalesTotal}
            isBlindCloseMode={isBlindCloseMode}
            closeExpectedCash={props.closeExpectedCash}
            closeVariancePreview={props.closeVariancePreview}
            closeNoteValue={props.closeNoteValue}
            showOpenTablesOverride={showOpenTablesOverride}
            offlinePendingCount={offlinePendingCount}
            cardRow={
                    <PaymentChannelRow
                      title={isKwd ? t('cash_drawer.cash_drawer_forms_panel.s59', "بطاقات K-NET وفيزا") : t('cash_drawer.cash_drawer_forms_panel.s60', "فيزا وماكينات POS")}
                      subtitle={isKwd ? t('cash_drawer.cash_drawer_forms_panel.s61', "مدفوعات كي نت والبطاقات البنكية حسب تقرير الماكينة") : t('cash_drawer.cash_drawer_forms_panel.s62', "مدفوعات البطاقات البنكية حسب تقرير الماكينة")}
                      icon={<CardIcon size={18} color="#2563eb" />}
                      themeColor="#2563eb"
                      bgLight="#eff6ff"
                      borderColor="#dbeafe"
                      count={cardOperationCount}
                      control={props.closeForm.control}
                      declaredFieldName="cardDeclaredTotal"
                      detailsFieldName="cardDetails"
                      isOpen={showCardDetails}
                      onToggle={() => setShowCardDetails((v) => !v)}
                      register={props.closeForm.register}
                      setValue={props.closeForm.setValue}
                      onApplyTotalToDeclared={(total) => props.closeForm.setValue('cardDeclaredTotal', total, { shouldDirty: true })}
                      disabled={props.closeMutation.isPending}
                    />
            }
            walletRow={
                    <PaymentChannelRow
                      title={isKwd ? t('cash_drawer.cash_drawer_forms_panel.s63', "المحافظ وروابط الدفع") : t('cash_drawer.cash_drawer_forms_panel.s64', "المحافظ الإلكترونية")}
                      subtitle={isKwd ? t('cash_drawer.cash_drawer_forms_panel.s65', "Apple Pay والمحافظ الرقمية وروابط الدفع") : t('cash_drawer.cash_drawer_forms_panel.s66', "فودافون كاش، أورنج، اتصالات كاش، وي باي")}
                      icon={<WalletIcon size={18} color="#7c3aed" />}
                      themeColor="#7c3aed"
                      bgLight="#f5f3ff"
                      borderColor="#ede9fe"
                      count={walletOperationCount}
                      control={props.closeForm.control}
                      declaredFieldName="walletDeclaredTotal"
                      detailsFieldName="walletDetails"
                      isOpen={showWalletDetails}
                      onToggle={() => setShowWalletDetails((v) => !v)}
                      register={props.closeForm.register}
                      setValue={props.closeForm.setValue}
                      onApplyTotalToDeclared={(total) => props.closeForm.setValue('walletDeclaredTotal', total, { shouldDirty: true })}
                      disabled={props.closeMutation.isPending}
                    />
            }
            instapayRow={
                    <PaymentChannelRow
                      title={isKwd ? t('cash_drawer.cash_drawer_forms_panel.s67', "عمليات كي نت / روابط الدفع") : t('cash_drawer.cash_drawer_forms_panel.s68', "تحويلات InstaPay")}
                      subtitle={isKwd ? t('cash_drawer.cash_drawer_forms_panel.s69', "عمليات الدفع عبر شبكة K-NET وروابط الدفع الإلكتروني") : t('cash_drawer.cash_drawer_forms_panel.s70', "التحويلات البنكية اللحظية وتطبيق إنستاباي")}
                      icon={<InstaPayIcon size={18} color="#059669" />}
                      themeColor="#059669"
                      bgLight="#ecfdf5"
                      borderColor="#d1fae5"
                      count={instapayOperationCount}
                      control={props.closeForm.control}
                      declaredFieldName="instapayDeclaredTotal"
                      detailsFieldName="instapayDetails"
                      isOpen={showInstapayDetails}
                      onToggle={() => setShowInstapayDetails((v) => !v)}
                      register={props.closeForm.register}
                      setValue={props.closeForm.setValue}
                      onApplyTotalToDeclared={(total) => props.closeForm.setValue('instapayDeclaredTotal', total, { shouldDirty: true })}
                      disabled={props.closeMutation.isPending}
                    />
            }
          />
        </div>
      )}
    </DialogShell>
  );
}
