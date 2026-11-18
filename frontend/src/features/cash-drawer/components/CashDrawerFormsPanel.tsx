import { useTranslation } from 'react-i18next';
import { isCashDrawerTransferType } from '@/features/cash-drawer/lib/cash-drawer-movement-request-key';
import { useCounterpartAccounts } from '@/features/cash-drawer/hooks/useCounterpartAccounts';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { useEffect, useMemo, useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { Button } from '@/shared/ui/button';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { SubmitButton } from '@/shared/components/submit-button';
import { formatCurrency } from '@/lib/format';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { SINGLE_STORE_MODE } from '@/config/product-scope';
import type { Branch, CashierShift, Location } from '@/types/domain';
import type { CloseShiftValues, MovementValues, OpenShiftValues } from '@/features/cash-drawer/hooks/useCashDrawerPageController';
import { getOfflineSalesQueue } from '@/features/pos/lib/pos-offline-sync';
import { PrinterIcon, XIcon } from '@/shared/components/icons/AppIcons';
import { printZReport } from '@/features/cash-drawer/utils/cash-drawer-receipt';
import { PaymentChannelRow } from '@/features/cash-drawer/components/cash-drawer-forms/PaymentChannelRow';
import { AlertCircleIcon, CardIcon, CashIcon, InstaPayIcon, WalletIcon } from '@/features/cash-drawer/components/cash-drawer-forms/cash-drawer-form-icons';

interface MutationLike {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset?: () => void;
}

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
        <div className="cash-drawer-modal-scroll">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
            <h2 className="cash-drawer-form-title" style={{ margin: 0 }}>{t('cash_drawer.cash_drawer_forms_panel.s12', "فتح وردية نقطة بيع")}</h2>
            <button
              type="button"
              onClick={props.onCloseForm}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                background: '#f8fafc',
                color: '#64748b',
                cursor: 'pointer',
                flexShrink: 0,
                padding: 0,
              }}
              title={t('common.close', 'إغلاق')}
            >
              <XIcon size={18} />
            </button>
          </div>
        <form className="form-grid" onSubmit={props.openForm.handleSubmit((values) => props.openMutation.mutate(values))}>
          <Field label={t('cash_drawer.cash_drawer_forms_panel.s13', "رصيد الفتح")}><input type="number" step="0.01" {...props.openForm.register('openingCash', { valueAsNumber: true })} disabled={props.openMutation.isPending} onFocus={(e) => e.target.select()} /></Field>
          {!SINGLE_STORE_MODE ? <Field label={t('cash_drawer.cash_drawer_forms_panel.s14', "الفرع")}>
            <select
              {...props.openForm.register('branchId')}
              disabled={props.openMutation.isPending}
              onChange={(e) => {
                const nextBranchId = e.target.value;
                props.openForm.setValue('branchId', nextBranchId);
                const branchObj = props.branches.find(b => String(b.id) === String(nextBranchId));
                const nextLocs = locationList.filter(l => !l.branchId || String(l.branchId) === String(nextBranchId));
                const nextDefaultLoc = (branchObj?.defaultStockLocationId && locationList.find(l => String(l.id) === String(branchObj.defaultStockLocationId)))
                  || nextLocs.find(l => l.name.includes(t('cash_drawer.cash_drawer_forms_panel.s15', "الرئيسي")) || l.name.toLowerCase().includes('main'))
                  || nextLocs[0]
                  || locationList[0];
                if (nextDefaultLoc?.id) {
                  props.openForm.setValue('locationId', nextDefaultLoc.id);
                }
              }}
            >
              <option value="">{t('cash_drawer.cash_drawer_forms_panel.s16', "بدون فرع")}</option>
              {props.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </Field> : null}
          {SINGLE_STORE_MODE ? <Field label={t('cash_drawer.cash_drawer_forms_panel.s17', "المخزن الأساسي")}><input value={locationList[0]?.name || t('cash_drawer.cash_drawer_forms_panel.s18', "سيتم الربط تلقائيًا بالمخزن الأساسي")} disabled readOnly /></Field> : <Field label={t('cash_drawer.cash_drawer_forms_panel.s19', "المخزن")}>
            <Controller
              name="locationId"
              control={props.openForm.control}
              render={({ field }) => (
                <CustomSelect
                  value={field.value}
                  onChange={field.onChange}
                  disabled={props.openMutation.isPending}
                  options={[
                    { value: '', label: t('cash_drawer.cash_drawer_forms_panel.s20', "بدون مخزن") },
                    ...availableLocations.map((location) => ({ value: location.id, label: location.name })),
                  ]}
                />
              )}
            />
          </Field>}
          {props.requirePasswordOnShiftOpen ? (
            <Field label={t('cash_drawer.cash_drawer_forms_panel.open_password', "كلمة مرور المستخدم الحالي (تأكيد الفتح)")}>
              <input
                type="password"
                placeholder={t('cash_drawer.cash_drawer_forms_panel.open_password_ph', "أدخل كلمة المرور لتأكيد فتح الوردية")}
                required
                {...props.openForm.register('password', { required: props.requirePasswordOnShiftOpen })}
                disabled={props.openMutation.isPending}
                autoComplete="off"
                data-lpignore="true"
              />
            </Field>
          ) : null}
          <Field label={t('cash_drawer.cash_drawer_forms_panel.s21', "ملاحظة الافتتاح")}><textarea rows={2} {...props.openForm.register('note')} disabled={props.openMutation.isPending} /></Field>
          <MutationFeedback isError={props.openMutation.isError} isSuccess={props.openMutation.isSuccess} error={props.openMutation.error} errorFallback={t('cash_drawer.cash_drawer_forms_panel.s22', "تعذر فتح وردية نقطة البيع")} successText={t('cash_drawer.cash_drawer_forms_panel.s23', "تم فتح وردية نقطة البيع بنجاح.")} />
          <SubmitButton type="submit" isPending={props.openMutation.isPending} idleText={t('cash_drawer.cash_drawer_forms_panel.s24', "فتح وردية نقطة البيع")} pendingText={t('cash_drawer.cash_drawer_forms_panel.s25', "جارٍ الفتح...")} />
        </form>
        </div>
      )}

      {props.activeForm === 'movement' && (
        <div className="cash-drawer-modal-scroll">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
            <h2 className="cash-drawer-form-title" style={{ margin: 0 }}>{t('cash_drawer.cash_drawer_forms_panel.s26', "تسجيل حركة درج النقدية")}</h2>
            <button
              type="button"
              onClick={props.onCloseForm}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                background: '#f8fafc',
                color: '#64748b',
                cursor: 'pointer',
                flexShrink: 0,
                padding: 0,
              }}
              title={t('common.close', 'إغلاق')}
            >
              <XIcon size={18} />
            </button>
          </div>
        <form className="form-grid" onSubmit={props.onMovementSubmit}>
          {props.isManager && props.openOptions.length > 1 ? (
            <Field label={t('cash_drawer.cash_drawer_forms_panel.s27', "وردية نقطة البيع المفتوحة")}>
              <Controller
                name="shiftId"
                control={props.movementForm.control}
                render={({ field }) => (
                  <CustomSelect
                    value={field.value}
                    onChange={field.onChange}
                    disabled={props.movementMutation.isPending}
                    options={[
                      { value: '', label: t('cash_drawer.cash_drawer_forms_panel.s28', "اختر وردية نقطة البيع") },
                      ...props.openOptions.map((shift) => ({
                        value: shift.id,
                        label: `${shift.openedByName || t('cash_drawer.cash_drawer_forms_panel.s29', "وردية نقطة بيع")}${shift.docNo ? ` — ${shift.docNo}` : ''}${String(shift.id) === String(props.myOpenShift?.id) ? t('cash_drawer.cash_drawer_forms_panel.s30', " (ورديتي الحالية)") : ''}`,
                      })),
                    ]}
                  />
                )}
              />
            </Field>
          ) : (
            <Field label={t('cash_drawer.cash_drawer_forms_panel.s31', "وردية نقطة البيع")}>
              <div style={{
                padding: '10px 14px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '0.9rem',
                fontWeight: 700,
                color: '#0f172a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span>{(props.myOpenShift || props.openOptions.find(s => String(s.id) === String(props.movementForm.watch('shiftId'))) || props.openOptions[0])?.openedByName || t('cash_drawer.cash_drawer_forms_panel.s32', "الوردية الحالية")}{(props.myOpenShift || props.openOptions.find(s => String(s.id) === String(props.movementForm.watch('shiftId'))) || props.openOptions[0])?.docNo ? ` — ${(props.myOpenShift || props.openOptions.find(s => String(s.id) === String(props.movementForm.watch('shiftId'))) || props.openOptions[0])?.docNo}` : ''}</span>
                <span className="badge badge-success" style={{ fontSize: '0.75rem' }}>{t('cash_drawer.cash_drawer_forms_panel.s33', "وردية نشطة")}</span>
              </div>
            </Field>
          )}
          <Field label={t('cash_drawer.cash_drawer_forms_panel.s34', "النوع")}>
            <Controller
              name="type"
              control={props.movementForm.control}
              render={({ field }) => (
                <CustomSelect
                  value={field.value}
                  onChange={(value) => {
                    field.onChange(value);
                    if (!isCashDrawerTransferType(value)) {
                      props.movementForm.setValue('counterpartAccountId', '');
                    }
                  }}
                  disabled={props.movementMutation.isPending}
                  options={[
                    { value: 'cash_in', label: t('cash_drawer.cash_drawer_forms_panel.s35', "إيداع") },
                    { value: 'cash_out', label: t('cash_drawer.cash_drawer_forms_panel.s36', "صرف") },
                    { value: 'safe_drop', label: t('cash_drawer.cash_drawer_forms_panel.s105', "تحويل للخزنة (إيداع آمن)") },
                    { value: 'safe_replenishment', label: t('cash_drawer.cash_drawer_forms_panel.s106', "تغذية الدرج من الخزنة") },
                  ]}
                />
              )}
            />
          </Field>
          {isTransferMovement && (
            <Field
              label={t('cash_drawer.cash_drawer_forms_panel.s107', "الحساب المقابل (خزنة / بنك)")}
              hint={accountsLoadForbidden ? t('cash_drawer.cash_drawer_forms_panel.s110', "تعذّر تحميل الحسابات — لا تملك الصلاحية المطلوبة") : accountsLoadFailed ? t('cash_drawer.cash_drawer_forms_panel.s111', "تعذّر تحميل الحسابات — حاول مرة أخرى") : cashBankAccounts.length === 0 ? t('cash_drawer.cash_drawer_forms_panel.s109', "لا توجد حسابات نقدية أو بنكية نشطة") : undefined}
            >
              <Controller
                name="counterpartAccountId"
                control={props.movementForm.control}
                render={({ field }) => (
                  <CustomSelect
                    value={field.value || ''}
                    onChange={field.onChange}
                    disabled={props.movementMutation.isPending}
                    options={[
                      { value: '', label: t('cash_drawer.cash_drawer_forms_panel.s108', "اختر الحساب المقابل") },
                      ...cashBankAccounts.map((a) => ({
                        value: String(a.id),
                        label: `${a.code} — ${a.nameAr || a.nameEn || a.code}`,
                      })),
                    ]}
                  />
                )}
              />
            </Field>
          )}
          <Field label={t('cash_drawer.cash_drawer_forms_panel.s37', "المبلغ")}><input type="number" step="0.01" {...props.movementForm.register('amount', { valueAsNumber: true })} disabled={props.movementMutation.isPending} onFocus={(e) => e.target.select()} /></Field>
          <Field label={t('cash_drawer.cash_drawer_forms_panel.s38', "سبب الحركة *")}><textarea rows={2} placeholder={t('cash_drawer.cash_drawer_forms_panel.s39', "اكتب سبب الصرف أو الإيداع بوضوح")} required {...props.movementForm.register('note', { required: true })} disabled={props.movementMutation.isPending} /></Field>
          <MutationFeedback isError={props.movementMutation.isError} isSuccess={props.movementMutation.isSuccess} error={props.movementMutation.error} errorFallback={t('cash_drawer.cash_drawer_forms_panel.s40', "تعذر تسجيل الحركة")} successText={t('cash_drawer.cash_drawer_forms_panel.s41', "تم تسجيل حركة درج النقدية بنجاح.")} />
          <SubmitButton
            type="submit"
            isPending={props.movementMutation.isPending}
            disabled={!props.movementForm.watch('shiftId') || !(Number(props.movementForm.watch('amount')) > 0) || !String(props.movementForm.watch('note') || '').trim() || (isTransferMovement && !props.movementForm.watch('counterpartAccountId'))}
            idleText={t('cash_drawer.cash_drawer_forms_panel.s42', "حفظ الحركة")}
            pendingText={t('cash_drawer.cash_drawer_forms_panel.s43', "جارٍ الحفظ...")}
          />
        </form>
        </div>
      )}

      {props.activeForm === 'close' && (
        <div className="cash-drawer-modal-scroll">
          <style>{`
            .cash-drawer-adaptive-dialog {
              height: auto !important;
              max-height: min(92vh, calc(100vh - 24px)) !important;
              display: flex !important;
              flex-direction: column !important;
              overflow: hidden !important;
              width: min(940px, calc(100vw - 16px)) !important;
              margin: auto !important;
              border-radius: 14px !important;
              touch-action: pan-y !important;
            }
            .cash-drawer-modal-scroll {
              flex: 1 1 auto !important;
              min-height: 0 !important;
              overflow-y: auto !important;
              overscroll-behavior: contain !important;
              -webkit-overflow-scrolling: touch !important;
              touch-action: pan-y !important;
              padding: 20px 24px 24px 24px;
              box-sizing: border-box !important;
              width: 100% !important;
              display: flex;
              flex-direction: column;
              gap: 12px;
            }
            @media (max-width: 860px) {
              .cash-drawer-adaptive-dialog {
                height: min(92vh, calc(100dvh - 24px)) !important;
                max-height: min(92vh, calc(100dvh - 24px)) !important;
                width: calc(100vw - 16px) !important;
              }
              .cash-drawer-modal-scroll {
                flex: 1 1 0% !important;
                padding: 14px 16px 28px 16px !important;
              }
            }
            .cash-drawer-form-title {
              margin: 0 0 16px 0;
              font-size: 1.25rem;
              font-weight: 800;
              color: #0f172a;
            }
            input.no-spin-arrows::-webkit-outer-spin-button,
            input.no-spin-arrows::-webkit-inner-spin-button {
              -webkit-appearance: none !important;
              margin: 0 !important;
              display: none !important;
            }
            input.no-spin-arrows {
              -moz-appearance: textfield !important;
              appearance: textfield !important;
            }
            .close-shift-modal-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 12px;
              margin-bottom: 14px;
              padding-bottom: 12px;
              border-bottom: 1px solid #f1f5f9;
            }
            .close-shift-modal-title-col {
              flex: 1;
              min-width: 0;
            }
            .close-shift-modal-title {
              margin: 0;
              font-size: 1.25rem;
              color: #0f172a;
              font-weight: 800;
            }
            .close-shift-modal-subtitle {
              font-size: 0.8rem;
              color: #64748b;
              margin-top: 2px;
            }
            .close-shift-modal-badge-chip {
              display: inline-flex;
              align-items: center;
              gap: 8px;
              padding: 6px 12px;
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 8px;
              font-size: 0.85rem;
              font-weight: 700;
              color: #0f172a;
              white-space: nowrap;
              flex-shrink: 0;
            }
            .close-shift-financial-card {
              grid-column: 1 / -1;
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 10px;
              padding: 12px;
            }
            .close-shift-financial-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
              gap: 8px;
            }
            .close-shift-fin-item {
              display: flex;
              flex-direction: column;
              padding: 6px 8px;
              background: #ffffff;
              border: 1px solid #e2e8f0;
              border-radius: 6px;
              gap: 2px;
            }
            .close-shift-fin-item.close-shift-fin-highlight {
              background: #f1f5f9;
              border-color: #cbd5e1;
            }
            .close-shift-fin-label {
              font-size: 0.72rem;
              color: #64748b;
              font-weight: 600;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .close-shift-fin-value {
              font-size: 0.88rem;
              font-weight: 800;
              color: #0f172a;
            }
            .close-shift-fin-value.tone-green { color: #16a34a; }
            .close-shift-fin-value.tone-blue { color: #2563eb; }
            .close-shift-fin-value.tone-red { color: #dc2626; }
            .close-shift-fin-value.tone-primary { color: #170c5c; }
            .close-shift-fin-footnote {
              font-size: 0.72rem;
              color: #94a3b8;
              margin-top: 8px;
              line-height: 1.4;
              border-top: 1px dashed #e2e8f0;
              padding-top: 6px;
            }
            .close-shift-auth-row {
              grid-column: 1 / -1;
              display: flex;
              flex-direction: row;
              align-items: flex-start;
              gap: 12px;
              width: 100%;
            }
            .close-shift-note-col {
              flex: 1;
              min-width: 0;
            }
            .close-shift-pin-col {
              width: 260px;
              flex-shrink: 0;
            }
            @media (max-width: 640px) {
              .cash-drawer-modal-scroll {
                padding: 12px 14px 32px 14px !important;
                gap: 8px !important;
              }
              .close-shift-modal-header {
                flex-direction: column !important;
                align-items: stretch !important;
                gap: 6px !important;
                margin-bottom: 10px !important;
                padding-bottom: 8px !important;
              }
              .close-shift-modal-title {
                font-size: 1.1rem !important;
              }
              .close-shift-modal-subtitle {
                font-size: 0.72rem !important;
                line-height: 1.35 !important;
              }
              .close-shift-modal-badge-chip {
                width: 100% !important;
                justify-content: space-between !important;
                box-sizing: border-box !important;
                padding: 4px 10px !important;
                font-size: 0.78rem !important;
              }
              .close-shift-financial-card {
                padding: 8px !important;
                margin-bottom: 4px !important;
              }
              .close-shift-financial-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                gap: 6px !important;
              }
              .close-shift-fin-item {
                padding: 4px 6px !important;
              }
              .close-shift-fin-label {
                font-size: 0.68rem !important;
              }
              .close-shift-fin-value {
                font-size: 0.82rem !important;
              }
              .close-shift-fin-footnote {
                font-size: 0.68rem !important;
                line-height: 1.3 !important;
                margin-top: 6px !important;
                padding-top: 4px !important;
              }
              .close-shift-auth-row {
                flex-direction: column !important;
                gap: 8px !important;
              }
              .close-shift-pin-col {
                width: 100% !important;
              }
              .form-grid {
                gap: 8px !important;
              }
              .form-grid .field {
                margin-bottom: 4px !important;
              }
            }
          `}</style>

          <div className="close-shift-modal-header">
            <div className="close-shift-modal-title-col">
              <h2 className="close-shift-modal-title">{t('cash_drawer.cash_drawer_forms_panel.s44', "إغلاق وردية نقطة البيع")}</h2>
              <div className="close-shift-modal-subtitle">
                {t('cash_drawer.cash_drawer_forms_panel.s45', "تسجيل إقرار مبيعات النقدية والمدفوعات الإلكترونية ومطابقة بونات الدفع")}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <div className="close-shift-modal-badge-chip">
                <span>{(props.myOpenShift || props.openOptions.find(s => String(s.id) === String(props.closeForm.watch('shiftId'))) || props.openOptions[0])?.openedByName || t('cash_drawer.cash_drawer_forms_panel.s46', "الوردية الحالية")}{(props.myOpenShift || props.openOptions.find(s => String(s.id) === String(props.closeForm.watch('shiftId'))) || props.openOptions[0])?.docNo ? ` — ${(props.myOpenShift || props.openOptions.find(s => String(s.id) === String(props.closeForm.watch('shiftId'))) || props.openOptions[0])?.docNo}` : ''}</span>
                <span className="badge badge-success" style={{ fontSize: '0.72rem' }}>{t('cash_drawer.cash_drawer_forms_panel.s47', "وردية نشطة")}</span>
              </div>
              <button
                type="button"
                onClick={props.onCloseForm}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  background: '#f8fafc',
                  color: '#64748b',
                  cursor: 'pointer',
                  flexShrink: 0,
                  padding: 0,
                }}
                title={t('common.close', 'إغلاق')}
              >
                <XIcon size={18} />
              </button>
            </div>
          </div>

          {offlinePendingCount !== 0 && (
            <div style={{
              marginBottom: '16px',
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: '10px',
              padding: '12px 16px',
              color: '#92400e',
              fontSize: '0.85rem',
              lineHeight: 1.5,
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
            }}>
              <div style={{ flexShrink: 0, marginTop: '2px' }}>
                <AlertCircleIcon size={18} color="#d97706" />
              </div>
              <div>
                <div style={{ fontWeight: 800, marginBottom: '2px' }}>
                  {offlinePendingCount < 0
                    ? 'تحذير: تعذر قراءة سجل فواتير الأوفلاين؛ لا يمكن إغلاق الوردية قبل إصلاح بيانات الجهاز'
                    : <>{t('cash_drawer.cash_drawer_forms_panel.s48', "تنبيه: توجد")} {offlinePendingCount} {t('cash_drawer.cash_drawer_forms_panel.s49', "فواتير مسجلة محلياً بدون إنترنت لم يتم ترحيلها للخادم بعد.")}</>}
                </div>
                <div>
                  {t('cash_drawer.cash_drawer_forms_panel.s50', "يرجى التأكد من اتصال الجهاز بالإنترنت والانتظار حتى يتم ترحيل كافة الفواتير تلقائياً قبل إغلاق الوردية، لضمان دقة الحسابات ومطابقة النقدية في الدرج.")}
                </div>
              </div>
            </div>
          )}

          <form className="form-grid" onSubmit={props.onCloseSubmit}>
            {props.isManager && props.openOptions.length > 1 ? (
              <Field label={t('cash_drawer.cash_drawer_forms_panel.s51', "وردية نقطة البيع المفتوحة")}>
                <Controller
                  name="shiftId"
                  control={props.closeForm.control}
                  render={({ field }) => (
                    <CustomSelect
                      value={field.value}
                      onChange={field.onChange}
                      disabled={props.closeMutation.isPending}
                      options={[
                        { value: '', label: t('cash_drawer.cash_drawer_forms_panel.s52', "اختر وردية نقطة البيع") },
                        ...props.openOptions.map((shift) => ({
                          value: shift.id,
                          label: `${shift.openedByName || t('cash_drawer.cash_drawer_forms_panel.s53', "وردية نقطة بيع")}${shift.docNo ? ` — ${shift.docNo}` : ''}${String(shift.id) === String(props.myOpenShift?.id) ? t('cash_drawer.cash_drawer_forms_panel.s54', " (ورديتي الحالية)") : ''}`,
                        })),
                      ]}
                    />
                  )}
                />
              </Field>
            ) : null}

            {isBlindCloseMode ? (
              <>
                {/* 1. Cash Section */}
                <div
                  style={{
                    gridColumn: '1 / -1',
                    background: '#f0fdf4',
                    border: '1.5px solid #bbf7d0',
                    borderRadius: '10px',
                    padding: '14px 16px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '8px',
                        background: '#ffffff',
                        border: '1px solid #86efac',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <CashIcon size={20} color="#16a34a" />
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#14532d' }}>{t('cash_drawer.cash_drawer_forms_panel.s55', "النقدية المعدودة في درج النقدية")}</div>
                      <div style={{ fontSize: '0.75rem', color: '#15803d' }}>{t('cash_drawer.cash_drawer_forms_panel.s56', "المبلغ النقدي (الكاش) الفعلي الموجود داخل الدرج")}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#166534' }}>{t('cash_drawer.cash_drawer_forms_panel.s57', "المبلغ الفعلي:")}</span>
                    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        className="no-spin-arrows"
                        {...props.closeForm.register('countedCash', { valueAsNumber: true })}
                        disabled={props.closeMutation.isPending}
                        onFocus={(e) => e.target.select()}
                        style={{
                          width: '140px',
                          padding: '7px 30px 7px 12px',
                          fontSize: '1rem',
                          fontWeight: 800,
                          textAlign: 'center',
                          borderRadius: '6px',
                          border: '1.5px solid #86efac',
                          background: '#ffffff',
                          color: '#14532d',
                          MozAppearance: 'textfield',
                        }}
                      />
                      <span style={{ position: 'absolute', left: '8px', fontSize: '0.75rem', color: '#16a34a', pointerEvents: 'none' }}><CurrencySymbol /></span>
                    </div>
                  </div>
                </div>

                {/* 2. Electronic Payment Methods Section */}
                <div style={{ gridColumn: '1 / -1', marginTop: '6px', marginBottom: '4px' }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#1e293b', marginBottom: '8px' }}>
                    {t('cash_drawer.cash_drawer_forms_panel.s58', "المدفوعات الإلكترونية وماكينات الدفع")}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {/* Card / Visa / K-NET */}
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

                    {/* Wallets */}
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

                    {/* InstaPay / K-NET Electronic Links */}
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
                  </div>
                </div>

                {/* 3. Password & Optional Notes in Responsive Row */}
                <div className="close-shift-auth-row">
                  <div className="close-shift-note-col">
                    <Field label={t('cash_drawer.cash_drawer_forms_panel.s71', "ملاحظات الإغلاق (اختياري)")}>
                      <input
                        type="text"
                        placeholder={t('cash_drawer.cash_drawer_forms_panel.s72', "أية ملاحظات خاصة بوردية اليوم...")}
                        {...props.closeForm.register('note')}
                        disabled={props.closeMutation.isPending}
                        style={{ width: '100%' }}
                      />
                    </Field>
                  </div>

                  <div className="close-shift-pin-col">
                    <Field label={t('cash_drawer.cash_drawer_forms_panel.s73', "كلمة مرور المستخدم الحالي (تأكيد الإغلاق)")}>
                      <input
                        type="text"
                        className="secure-password-field"
                        placeholder={t('cash_drawer.cash_drawer_forms_panel.s74', "أدخل كلمة المرور لتأكيد الإغلاق")}
                        required
                        {...props.closeForm.register('managerPin')}
                        autoComplete="off"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        data-form-type="other"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        disabled={props.closeMutation.isPending}
                        style={{ width: '100%' }}
                      />
                    </Field>
                  </div>
                </div>

                <div className="muted small" style={{ gridColumn: '1 / -1' }}>
                  {t('cash_drawer.cash_drawer_forms_panel.s75', "سيتم تسجيل الإقرار وإرسال وردية نقطة البيع في انتظار مراجعة واعتماد الإدارة.")}
                </div>
              </>
            ) : (
              <>
                <Field label={t('cash_drawer.cash_drawer_forms_panel.s76', "النقدية المتوقعة")}><input value={formatCurrency(props.closeExpectedCash)} disabled readOnly /></Field>
                {selectedCloseShift ? (
                  <div className="close-shift-financial-card">
                    <div className="close-shift-financial-grid">
                      <div className="close-shift-fin-item">
                        <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s116', "رصيد الفتح")}</span>
                        <strong className="close-shift-fin-value">{formatCurrency(closeOpeningCash)}</strong>
                      </div>
                      <div className="close-shift-fin-item">
                        <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s77', "مبيعات نقدي")}</span>
                        <strong className="close-shift-fin-value tone-green">{formatCurrency(closeCashSalesTotal)}</strong>
                      </div>
                      <div className="close-shift-fin-item">
                        <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s78', "مبيعات فيزا")}</span>
                        <strong className="close-shift-fin-value tone-blue">{formatCurrency(closeCardSalesTotal)}</strong>
                      </div>
                      {closeDeliverySalesTotal > 0 ? (
                        <div className="close-shift-fin-item">
                          <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s79', "مبيعات دليفري")}</span>
                          <strong className="close-shift-fin-value">{formatCurrency(closeDeliverySalesTotal)}</strong>
                        </div>
                      ) : null}
                      {closeServiceCashTotal > 0 ? (
                        <div className="close-shift-fin-item">
                          <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s80', "خدمات نقدي")}</span>
                          <strong className="close-shift-fin-value">{formatCurrency(closeServiceCashTotal)}</strong>
                        </div>
                      ) : null}
                      {closeCreditSalesTotal > 0 ? (
                        <div className="close-shift-fin-item">
                          <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s81', "مبيعات آجل")}</span>
                          <strong className="close-shift-fin-value">{formatCurrency(closeCreditSalesTotal)}</strong>
                        </div>
                      ) : null}
                      {closeSaleReturnCashRefundTotal > 0 ? (
                        <div className="close-shift-fin-item">
                          <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s82', "مرتجعات نقدي")}</span>
                          <strong className="close-shift-fin-value tone-red">-{formatCurrency(closeSaleReturnCashRefundTotal)}</strong>
                        </div>
                      ) : null}
                      {closeCashDrawerMovementTotal !== 0 ? (
                        <div className="close-shift-fin-item">
                          <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s83', "حركات درج النقدية")}</span>
                          <strong className={`close-shift-fin-value ${closeCashDrawerMovementTotal < 0 ? 'tone-red' : 'tone-green'}`}>
                            {formatCurrency(closeCashDrawerMovementTotal)}
                          </strong>
                        </div>
                      ) : null}
                      {closeExpensesTotal > 0 ? (
                        <div className="close-shift-fin-item">
                          <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s84', "مصروفات مسجلة")}</span>
                          <strong className="close-shift-fin-value tone-red">-{formatCurrency(closeExpensesTotal)}</strong>
                        </div>
                      ) : null}
                      {closeSupplierPaymentsTotal > 0 ? (
                        <div className="close-shift-fin-item">
                          <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s85', "دفعات موردين")}</span>
                          <strong className="close-shift-fin-value tone-red">-{formatCurrency(closeSupplierPaymentsTotal)}</strong>
                        </div>
                      ) : null}
                      {closeCustomerCollectionsTotal > 0 ? (
                        <div className="close-shift-fin-item">
                          <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s117', "تحصيلات عملاء نقدي")}</span>
                          <strong className="close-shift-fin-value tone-green">+{formatCurrency(closeCustomerCollectionsTotal)}</strong>
                        </div>
                      ) : null}
                      {closeCancelledSaleCashTotal > 0 ? (
                        <div className="close-shift-fin-item">
                          <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s118', "نقدية فواتير ملغاة")}</span>
                          <strong className="close-shift-fin-value tone-green">+{formatCurrency(closeCancelledSaleCashTotal)}</strong>
                        </div>
                      ) : null}
                      <div className="close-shift-fin-item close-shift-fin-highlight">
                        <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s86', "إجمالي مبيعات الفواتير")}</span>
                        <strong className="close-shift-fin-value tone-primary">{formatCurrency(closeShiftSalesTotal)}</strong>
                      </div>
                      {Number(selectedCloseShift.freelanceDeliveryFeeTotal || 0) > 0 ? (
                        <>
                          <div className="close-shift-fin-item">
                            <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s87', "(-) رسوم طيارين")}</span>
                            <strong className="close-shift-fin-value tone-red">-{formatCurrency(selectedCloseShift.freelanceDeliveryFeeTotal || 0)}</strong>
                          </div>
                          <div className="close-shift-fin-item close-shift-fin-highlight">
                            <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s88', "صافي مبيعات المتجر")}</span>
                            <strong className="close-shift-fin-value tone-green">{formatCurrency(closeShiftSalesTotal - Number(selectedCloseShift.freelanceDeliveryFeeTotal || 0))}</strong>
                          </div>
                        </>
                      ) : null}
                      {Number(selectedCloseShift.tipSalesTotal || 0) > 0 ? (
                        <div className="close-shift-fin-item">
                          <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s89', "إكراميات مستحقة للعمالة (Tips)")}</span>
                          <strong className="close-shift-fin-value tone-primary">{formatCurrency(selectedCloseShift.tipSalesTotal || 0)}</strong>
                        </div>
                      ) : null}
                    </div>
                    <div className="close-shift-fin-footnote">
                      {t('cash_drawer.cash_drawer_forms_panel.s90', "النقدية المتوقعة = رصيد الفتح + مبيعات وخدمات النقدي + تحصيلات العملاء + نقدية الفواتير الملغاة - مرتجعات النقدي + حركات الدرج - المصروفات - دفعات الموردين.")}
                    </div>
                  </div>
                ) : null}
                <Field label={t('cash_drawer.cash_drawer_forms_panel.s91', "المبلغ المعدود")}><input type="number" min="0" step="0.01" className="no-spin-arrows" {...props.closeForm.register('countedCash', { valueAsNumber: true })} disabled={props.closeMutation.isPending} onFocus={(e) => e.target.select()} /></Field>

                <div className="close-shift-auth-row">
                  <div className="close-shift-note-col">
                    <Field label={t('cash_drawer.cash_drawer_forms_panel.s92', "ملاحظة الإغلاق")}>
                      <input
                        type="text"
                        placeholder={props.closeVariancePreview !== 0 ? t('cash_drawer.cash_drawer_forms_panel.s93', "اشرح سبب الفرق قبل إغلاق الوردية") : t('cash_drawer.cash_drawer_forms_panel.s94', "اختياري عند عدم وجود فرق")}
                        {...props.closeForm.register('note')}
                        disabled={props.closeMutation.isPending}
                        style={{ width: '100%' }}
                      />
                    </Field>
                  </div>

                  <div className="close-shift-pin-col">
                    <Field label={t('cash_drawer.cash_drawer_forms_panel.s95', "كلمة مرور المستخدم الحالي (تأكيد الإغلاق)")}>
                      <input
                        type="text"
                        className="secure-password-field"
                        placeholder={t('cash_drawer.cash_drawer_forms_panel.s96', "أدخل كلمة المرور لتأكيد الإغلاق")}
                        required
                        {...props.closeForm.register('managerPin')}
                        autoComplete="off"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        data-form-type="other"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        disabled={props.closeMutation.isPending}
                        style={{ width: '100%' }}
                      />
                    </Field>
                  </div>
                </div>

                <div className={props.closeVariancePreview !== 0 ? 'warning-box' : 'muted small'} style={{ gridColumn: '1 / -1' }}>
                  {t('cash_drawer.cash_drawer_forms_panel.s97', "الفرق المتوقع بعد الإغلاق:")} <strong>{formatCurrency(props.closeVariancePreview)}</strong>
                  {props.closeVariancePreview !== 0 ? t('cash_drawer.cash_drawer_forms_panel.s98', " — يلزم كتابة ملاحظة قبل إغلاق وردية نقطة البيع مع وجود فرق.") : ''}
                </div>

                {props.closeVariancePreview !== 0 ? (
                  <div className="close-shift-auth-row" style={{ gridColumn: '1 / -1' }}>
                    <div className="close-shift-note-col">
                      <Field label={t('cash_drawer.cash_drawer_forms_panel.s119', "اعتماد مدير ثانٍ (عند تجاوز حد التسامح)")}>
                        <input
                          type="text"
                          className="secure-password-field"
                          placeholder={t('cash_drawer.cash_drawer_forms_panel.s120', "كلمة مرور مدير آخر غير من يغلق الوردية")}
                          autoComplete="off"
                          data-lpignore="true"
                          data-1p-ignore="true"
                          data-form-type="other"
                          autoCorrect="off"
                          autoCapitalize="off"
                          spellCheck={false}
                          {...props.closeForm.register('approverSecret')}
                          disabled={props.closeMutation.isPending}
                          style={{ width: '100%' }}
                        />
                      </Field>
                    </div>
                    <div className="close-shift-pin-col">
                      <div className="muted small" style={{ paddingTop: '22px' }}>
                        {t('cash_drawer.cash_drawer_forms_panel.s121', "الفرق فوق حد التسامح يتطلب اعتماد مدير آخر وسبباً لا يقل عن 10 أحرف في ملاحظة الإغلاق.")}
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            )}

            {showOpenTablesOverride ? (
              <div style={{ gridColumn: '1 / -1', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '12px 16px' }}>
                <div style={{ fontWeight: 800, color: '#92400e', marginBottom: '8px' }}>
                  {t('cash_drawer.cash_drawer_forms_panel.s122', "توجد طاولات مفتوحة أو فواتير مسودة في هذه الوردية. للإغلاق رغم ذلك يلزم تجاوز من مدير آخر.")}
                </div>
                <div className="close-shift-auth-row">
                  <div className="close-shift-note-col">
                    <Field label={t('cash_drawer.cash_drawer_forms_panel.s123', "كلمة مرور المدير المعتمد للتجاوز")}>
                      <input
                        type="text"
                        className="secure-password-field"
                        placeholder={t('cash_drawer.cash_drawer_forms_panel.s124', "كلمة مرور مدير آخر غير من يغلق الوردية")}
                        autoComplete="off"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        data-form-type="other"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        {...props.closeForm.register('openTablesOverrideSecret')}
                        disabled={props.closeMutation.isPending}
                        style={{ width: '100%' }}
                      />
                    </Field>
                  </div>
                  <div className="close-shift-pin-col">
                    <Field label={t('cash_drawer.cash_drawer_forms_panel.s125', "سبب التجاوز (10 أحرف على الأقل)")}>
                      <input
                        type="text"
                        placeholder={t('cash_drawer.cash_drawer_forms_panel.s126', "مثال: الطاولة ستنتقل إلى وردية المساء")}
                        {...props.closeForm.register('openTablesOverrideReason')}
                        disabled={props.closeMutation.isPending}
                        style={{ width: '100%' }}
                      />
                    </Field>
                  </div>
                </div>
              </div>
            ) : null}

            <MutationFeedback isError={props.closeMutation.isError} isSuccess={props.closeMutation.isSuccess} error={props.closeMutation.error} errorFallback={t('cash_drawer.cash_drawer_forms_panel.s99', "تعذر إغلاق وردية نقطة البيع")} successText={t('cash_drawer.cash_drawer_forms_panel.s100', "تم إغلاق وردية نقطة البيع بنجاح.")} />
            {props.closeMutation.isSuccess && selectedCloseShift ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => printZReport(selectedCloseShift)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  margin: '8px 0',
                  width: '100%',
                  justifyContent: 'center',
                  fontWeight: 700,
                  background: '#f8fafc',
                  border: '1.5px solid #cbd5e1',
                }}
              >
                <PrinterIcon size={16} color="#170e5e" />
                <span>{t('cash_drawer.cash_drawer_forms_panel.s101', "طباعة تقرير Z النهائي (Z-Report)")}</span>
              </Button>
            ) : null}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px', width: '100%' }}>
              <Button
                type="button"
                variant="secondary"
                onClick={props.onCloseForm}
                style={{ minHeight: '42px', padding: '0 16px', fontWeight: 700, fontSize: '0.9rem', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                {t('common.cancel', 'إلغاء')}
              </Button>
              <SubmitButton
                type="submit"
                isPending={props.closeMutation.isPending}
                disabled={offlinePendingCount !== 0 || !props.closeForm.watch('shiftId') || (!isBlindCloseMode && props.closeVariancePreview !== 0 && !props.closeNoteValue) || !props.closeForm.watch('managerPin')}
                idleText={isBlindCloseMode ? t('cash_drawer.cash_drawer_forms_panel.s102', "إرسال إقرار الإغلاق") : t('cash_drawer.cash_drawer_forms_panel.s103', "إغلاق وردية نقطة البيع")}
                pendingText={t('cash_drawer.cash_drawer_forms_panel.s104', "جارٍ الإغلاق...")}
                style={{ flex: 1, minHeight: '42px', fontSize: '0.95rem', fontWeight: 800 }}
              />
            </div>
          </form>
        </div>
      )}
    </DialogShell>
  );
}
