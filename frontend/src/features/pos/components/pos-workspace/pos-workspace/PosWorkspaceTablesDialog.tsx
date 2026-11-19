// PosWorkspaceTablesDialog — restaurant tables floor-plan dialog mount.
// Pure move from PosWorkspace.tsx (L758-996); no behavior change.

import type { Dispatch, SetStateAction } from 'react';
import type { usePosWorkspace } from '@/features/pos/hooks/usePosWorkspace';
import { PosTablesFloorPlanDialog } from '@/features/pos/components/pos-workspace/PosTablesFloorPlanDialog';
import { posApi } from '@/features/pos/api/pos.api';
import { applyPosLineTransfer } from '@/features/pos/lib/pos.domain';
import { transferTableOrder } from '@/features/pos/lib/pos-table-transfer';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { calcCartLineTotal } from '@/features/pos/lib/pos-modifier-totals';
import { printGuestCheck } from '@/lib/pos-printing';
import { persistHeldDrafts } from '@/features/pos/lib/pos.persistence';
import { toast } from '@/shared/components/system-alert';

export interface PosWorkspaceTablesDialogProps {
  pos: ReturnType<typeof usePosWorkspace>;
  isRestaurantActive: boolean;
  restaurantTablesOpen: boolean;
  setRestaurantTablesOpen: Dispatch<SetStateAction<boolean>>;
  focusBarcodeEntry: () => void;
  restaurantInitialTab: 'floor' | 'list';
}

export function PosWorkspaceTablesDialog({
  pos,
  isRestaurantActive,
  restaurantTablesOpen,
  setRestaurantTablesOpen,
  focusBarcodeEntry,
  restaurantInitialTab,
}: PosWorkspaceTablesDialogProps) {
  return (
    <>
      {/* 1. Restaurant Unified Floor & Orders Dialog (Restaurant Mode) */}
      {isRestaurantActive && restaurantTablesOpen && (
        <PosTablesFloorPlanDialog
          open={restaurantTablesOpen}
          onClose={() => {
            setRestaurantTablesOpen(false);
            focusBarcodeEntry();
          }}
          settings={pos.settingsQuery.data}
          currentTableNumber={pos.tableNumber}
          currentCartItemsCount={pos.cart.length}
          currentCartTotal={Number(pos.totals?.total || 0)}
          heldDrafts={pos.heldDraftSummaries || []}
          initialTab={restaurantInitialTab}
          isCurrentCheckPrinted={Boolean(pos.guestCheckPrintedAt)}
          onPrintGuestCheck={async (tableNum, draftId) => {
            if (tableNum === pos.tableNumber && pos.cart.length > 0) {
              pos.printGuestCheckNow();
              toast.success(`تمت طباعة شيك طاولة ${tableNum} بنجاح`);
              return;
            }
            const matchingDraft = pos.heldDrafts.find((d) => String(d.id) === String(draftId) || String(d.tableNumber).trim() === String(tableNum).trim());
            if (matchingDraft) {
              const subtotal = (matchingDraft.cart || []).reduce((sum, item) => {
                return sum + calcCartLineTotal(item);
              }, 0);
              const bookDigits = currencyMoneyDigits(pos.settingsQuery.data?.currency || getGlobalSystemCurrency());
              const discount = roundMoneyValue(Number(matchingDraft.discount || 0), bookDigits);
              const isServiceChargeActive = Boolean(
                (pos.settingsQuery.data as any)?.restaurantServiceChargeEnabled && matchingDraft.orderType === 'dine_in'
              );
              const serviceChargePercent = isServiceChargeActive
                ? Math.max(0, Number((pos.settingsQuery.data as any)?.restaurantServiceChargePercent ?? 0))
                : 0;
              const discounted = Math.max(0, subtotal - discount);
              const serviceCharge = serviceChargePercent > 0
                ? roundMoneyValue((discounted * serviceChargePercent) / 100, bookDigits)
                : 0;
              const taxRate = Number(pos.settingsQuery.data?.taxRate || 0);
              const baseBeforeTax = roundMoneyValue(discounted + serviceCharge, bookDigits);
              let taxAmount = 0;
              let total = 0;
              if (taxRate > 0) {
                if (String(pos.settingsQuery.data?.taxMode || 'exclusive') === 'inclusive') {
                  total = baseBeforeTax;
                  taxAmount = roundMoneyValue(baseBeforeTax - (baseBeforeTax / (1 + taxRate / 100)), bookDigits);
                } else {
                  taxAmount = roundMoneyValue(baseBeforeTax * (taxRate / 100), bookDigits);
                  total = roundMoneyValue(baseBeforeTax + taxAmount, bookDigits);
                }
              } else {
                total = baseBeforeTax;
              }

              printGuestCheck({
                tableNumber: tableNum,
                items: matchingDraft.cart || [],
                subtotal: roundMoneyValue(subtotal, bookDigits),
                discount,
                serviceCharge,
                taxAmount,
                total,
                guestCount: (matchingDraft as any).guestCount || 1,
                customerName: matchingDraft.customerName || matchingDraft.quickCustomerName || undefined,
                branchName: pos.currentBranch?.name,
                locationName: pos.currentLocation?.name,
                settings: pos.settingsQuery.data || null,
              });

              (matchingDraft as any).guestCheckPrintedAt = new Date().toISOString();
              const updatedHeld = pos.heldDrafts.map((d) => d.id === matchingDraft.id ? { ...matchingDraft } : d);
              persistHeldDrafts(updatedHeld);
              void posApi.saveHeldDraft(matchingDraft as any);
              toast.success(`تمت طباعة شيك طاولة ${tableNum} بنجاح`);
            }
          }}
          onSelectTable={async (tableNum) => {
            if (pos.cart.length > 0 && pos.tableNumber && pos.tableNumber !== tableNum) {
              await pos.holdDraft();
            }
            pos.setOrderType('dine_in');
            pos.setTableNumber(tableNum);
            pos.setCustomerId('');
            pos.setQuickCustomerName('');
            pos.setQuickCustomerPhone('');
            pos.setQuickCustomerAddress('');
          }}
          onSeatReservation={async (tableNum, guestCount, guestName) => {
            if (pos.cart.length > 0 && pos.tableNumber && pos.tableNumber !== tableNum) {
              await pos.holdDraft();
            }
            pos.setOrderType('dine_in');
            pos.setTableNumber(tableNum);
            pos.setGuestCount(guestCount || 1);
            if (guestName) {
              pos.setQuickCustomerName(guestName);
            }
            setRestaurantTablesOpen(false);
            toast.success(`تم إجلاس الضيف على طاولة ${tableNum} بعدد ${guestCount} أفراد.`);
          }}
          onRecallDraft={async (draftId) => {
            /* INV-REST-HOLD-RECALL-TRUTH (R5-B): a failed auto-hold
             * aborts the recall — the live cart is unrecoverable once
             * overwritten. holdDraft / recallDraft already report the
             * failure in the submit message. */
            try {
              if (pos.cart.length > 0) {
                await pos.holdDraft();
              }
              await pos.recallDraft(draftId);
            } catch {
              return;
            }
          }}
          onDeleteDraft={async (draftId) => {
            await pos.deleteDraft(draftId);
          }}
          onClearAllDrafts={async () => {
            await pos.clearHeldDrafts();
          }}
          onTransferTable={async (from, to) => {
            // INV-REST-FLOOR-TRANSFER-TRUTH (T10-E, F6): one shared
            // handler — the old inline copy persisted via raw API calls
            // and never invalidated the held-drafts query, so the draft
            // existed on table 5 while every list still showed the
            // pre-transfer snapshot; its fall-through also toasted
            // success while persisting nothing. The handler routes the
            // live-cart save through saveHeldDraftMutation, invalidates
            // + awaits the held-drafts refetch, and reports a missing
            // source as an error instead of a success.
            const outcome = await transferTableOrder({
              from,
              to,
              heldDrafts: pos.heldDrafts,
              tableNumber: pos.tableNumber,
              cart: pos.cart,
              customerId: pos.customerId,
              paymentType: pos.paymentType,
              discount: pos.discount,
              deliveryFee: pos.deliveryFee,
              note: pos.note,
              search: pos.search,
              priceType: pos.priceType,
              branchId: pos.branchId,
              locationId: pos.locationId,
              cashAmount: pos.cashAmount,
              cardAmount: pos.cardAmount,
              transferAmount: pos.transferAmount,
              paymentChannel: pos.paymentChannel,
              orderType: pos.orderType,
              saveHeldDraft: (payload) => pos.saveHeldDraftMutation.mutateAsync(payload),
            });
            if (outcome.status === 'error') {
              pos.setSubmitMessage(outcome.message);
              return;
            }
            if (outcome.status === 'held-saved') {
              pos.setCart([]);
            }
            pos.setTableNumber(to);
            pos.setSubmitMessage(`تم نقل الطلب بنجاح من طاولة ${from} إلى طاولة ${to}.`);
          }}
          rawHeldDrafts={pos.heldDrafts}
          currentCartItems={pos.cart}
          onTransferItems={async (sourceTable, targetTable, transferredItems) => {
            // R-I34: deduct/add match on lineKey (applyPosLineTransfer), never
            // on product + price — a modified line moved onto a target holding
            // the same product plain stays its own line. The moved copies
            // carry their lineKeys through the held-draft re-save below.
            const sourceIsLive = sourceTable === pos.tableNumber;
            const targetIsLive = targetTable === pos.tableNumber;
            const sourceDraft = sourceIsLive
              ? undefined
              : pos.heldDrafts.find((d) => String(d.tableNumber).trim() === String(sourceTable).trim());
            const targetDraft = targetIsLive
              ? undefined
              : pos.heldDrafts.find((d) => String(d.tableNumber).trim() === String(targetTable).trim());

            // 1. Deduct from source (moved = the lines that were actually found).
            const sourceCart = sourceIsLive ? [...pos.cart] : [...(sourceDraft?.cart || [])];
            const deducted = applyPosLineTransfer(sourceCart, [], transferredItems);
            const moved = deducted.target;
            const nextSourceCart = deducted.source;

            // 2. Add to target (same live cart when source and target are live).
            const targetCart = targetIsLive
              ? (sourceIsLive ? nextSourceCart : [...pos.cart])
              : targetDraft
                ? [...targetDraft.cart]
                : [];
            const nextTargetCart = applyPosLineTransfer([], targetCart, moved).target;

            // 3. Persist source.
            let liveCart: typeof pos.cart | null = null;
            if (sourceIsLive) {
              liveCart = targetIsLive ? nextTargetCart : nextSourceCart;
            } else if (sourceDraft) {
              if (nextSourceCart.length === 0) {
                await pos.deleteDraft(sourceDraft.id);
              } else {
                sourceDraft.cart = nextSourceCart;
                await posApi.saveHeldDraft(sourceDraft as any);
              }
            }

            // 4. Persist target.
            if (targetIsLive) {
              liveCart = nextTargetCart;
            } else if (targetDraft) {
              targetDraft.cart = nextTargetCart;
              await posApi.saveHeldDraft(targetDraft as any);
            } else {
              const newDraftId = `draft-${Date.now()}`;
              await posApi.saveHeldDraft({
                id: newDraftId,
                tableNumber: targetTable,
                orderType: 'dine_in',
                cart: nextTargetCart as any,
                discount: 0,
                createdAt: new Date().toISOString(),
              } as any);
            }
            if (liveCart) pos.setCart(liveCart);
            toast.success(`تم نقل ${transferredItems.length} صنف بنجاح من طاولة ${sourceTable} إلى طاولة ${targetTable}`);
          }}
          onMergeTable={async (from, to) => {
            const targetDraft = pos.heldDrafts.find((d) => String(d.tableNumber).trim() === String(to).trim());
            if (targetDraft && targetDraft.cart?.length) {
              // R-I34: merge on lineKey (applyPosLineTransfer), never on
              // product + unit + price — differing modifiers stay separate.
              const mergedCart = applyPosLineTransfer([], [...pos.cart], targetDraft.cart).target;
              pos.setCart(mergedCart);
              await pos.deleteDraft(targetDraft.id);
            }
            pos.setTableNumber(to);
            pos.setSubmitMessage(`تم دمج طلب طاولة ${from} مع طاولة ${to} بنجاح.`);
          }}
        />
      )}
    </>
  );
}
