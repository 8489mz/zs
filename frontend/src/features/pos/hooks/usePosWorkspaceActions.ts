import type { FormEvent } from 'react';
import { removePosItem } from '@/features/pos/lib/pos.domain';
import { computeDraftTotal } from '@/features/pos/lib/pos-workspace.helpers';
import { calcCartLineNetTotal } from '@/features/pos/lib/pos-modifier-totals';
import { getPosTerminalCode } from '@/features/pos/lib/pos-offline-sync';
import type { PosItem, PosPriceType } from '@/features/pos/types/pos.types';
import { posApi } from '@/features/pos/api/pos.api';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import type { Product } from '@/types/domain';
import { toast } from '@/shared/components/system-alert';
import { useAuthStore } from '@/stores/auth-store';
import {
  createPosWorkspaceAsyncActions,
  createPosWorkspaceBaseActions,
  createPosWorkspaceReceiptActions,
  type PosWorkspaceActionParams,
} from '@/features/pos/hooks/usePosWorkspaceActionGroups';

// Track exact 13-digit scale barcodes scanned during the current active shift
// so re-scanning the same weighted sticker triggers a replay warning & audit event.
const seenWeightedBarcodesByShift = new Map<string, Set<string>>();

interface PosWorkspaceActions {
  resetPosDraft: () => void;
  handleAddProduct: (product: Product, unitId?: string, options?: { quantity?: number; isWeighted?: boolean; sourceBarcode?: string }) => boolean;
  handleQuickAddCodeSubmit: (rawCode?: string, productsOverride?: Product[]) => boolean;
  handleQuickCustomerSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  approveDiscountOverride: (password: string) => Promise<unknown>;
  handleSubmit: (options?: { fastCash?: boolean; managerPin?: string; tenderedAmount?: number }) => Promise<boolean>;
  exportHeldDrafts: () => void;
  holdDraft: () => Promise<void>;
  recallDraft: (draftId: string) => Promise<void>;
  deleteDraft: (draftId: string) => Promise<void>;
  clearHeldDrafts: () => Promise<void>;
  reprintLastSale: () => void;
  reprintLastSaleReceipt: () => void;
  printReceiptNow: () => void;
  printDualReceiptNow: () => void;
  printMerchantReceiptNow: () => void;
  printA4Now: () => void;
  printKitchenNow: () => void;
  printBothNow: () => void;
  exportPdfNow: () => void;
  completePostSaleCycle: (message?: string) => void;
  setQty: (lineKey: string, qty: number) => void;
  setItemNote: (lineKey: string, notes: string) => void;
  setLineDiscount: (lineKey: string, discount: number) => void;
  addLineSerial: (lineKey: string, serial: string) => void;
  removeLineSerial: (lineKey: string, serial: string) => void;
  setItemModifiers: (lineKey: string, modifiers: any[]) => void;
  setItemSeat: (lineKey: string, seatNumber?: number) => void;
  removeItem: (lineKey: string) => void;
  fillPaidAmount: () => void;
  setPriceType: (nextPriceType: PosPriceType) => void;
  setPaymentPreset: (preset: 'cash' | 'card' | 'wallet' | 'instapay' | 'credit', options?: { focusBarcode?: boolean }) => void;
  selectCartLine: (lineKey: string) => void;
  changeSelectedQty: (delta: number) => boolean;
  changeLineQtyByDelta: (lineKey: string, delta: number) => boolean;
  editSelectedQty: () => boolean;
  removeSelectedItem: () => boolean;
  selectAdjacentCartLine: (direction: 'next' | 'prev') => boolean;
  printGuestCheckNow: () => void;
  heldDraftSummaries: Array<{ id: string; label: string; total: number; itemsCount: number; savedAt: string; tableNumber?: string; orderType?: 'dine_in' | 'takeaway' | 'delivery'; guestCount?: number; guestCheckPrintedAt?: string | null }>;
}

export function createPosWorkspaceActions(params: PosWorkspaceActionParams): PosWorkspaceActions {
  const base = createPosWorkspaceBaseActions(params);
  const asyncActions = createPosWorkspaceAsyncActions(params, base);
  const receiptActions = createPosWorkspaceReceiptActions(params);
  const bookDigits = currencyMoneyDigits(params.settings?.currency || getGlobalSystemCurrency());
  const branchIdNum = Number(params.branchId || 0) || undefined;
  const terminalCode = getPosTerminalCode();

  function isAdminActor(): boolean {
    const role = useAuthStore.getState().user?.role;
    return role === 'admin' || role === 'super_admin';
  }

  function isWeightedEditLocked(item: PosItem | undefined): boolean {
    if (!item) return false;
    if (params.settings?.antiTheftLockWeightedManualEdit !== true) return false;
    if (isAdminActor()) return false;
    return item.isWeighted === true;
  }

  function toSnapshotItem(item: PosItem, overrideQty?: number, previousQty?: number) {
    const qty = overrideQty !== undefined ? Number(overrideQty) : Number(item.qty || 0);
    const unitPrice = roundMoneyValue(Number(item.price || 0), bookDigits);
    const lineTotal =
      overrideQty !== undefined
        ? roundMoneyValue(qty * unitPrice, bookDigits)
        : roundMoneyValue(calcCartLineNetTotal(item), bookDigits);
    return {
      ...(Number(item.productId || 0) > 0 ? { productId: Number(item.productId) } : {}),
      productName: String(item.name || 'صنف'),
      qty: Number(qty.toFixed(3)),
      ...(previousQty !== undefined ? { previousQty: Number(Number(previousQty).toFixed(3)) } : {}),
      unitName: String(item.unitName || 'قطعة'),
      unitPrice,
      lineTotal,
      ...(Number(item.lineDiscount || 0) > 0 ? { discount: roundMoneyValue(Number(item.lineDiscount), bookDigits) } : {}),
    };
  }

  function logDraftCancelEvent() {
    if (!params.cart.length) return;
    const itemsSnapshot = params.cart.map((item) => toSnapshotItem(item));
    const draftTotal = roundMoneyValue(
      computeDraftTotal({
        cart: params.cart,
        tableNumber: params.tableNumber,
        orderType: params.orderType,
        customerId: params.customerId,
        discount: params.discount,
        deliveryFee: params.deliveryFee,
        paidAmount: params.paidAmount,
        cashAmount: params.cashAmount,
        cardAmount: params.cardAmount,
        transferAmount: params.transferAmount,
        paymentType: params.paymentType,
        paymentChannel: params.paymentChannel,
        note: params.note,
        search: params.search,
        priceType: params.priceType,
        branchId: params.branchId,
        locationId: params.locationId,
      }),
      bookDigits,
    );
    void posApi.logSecurityEvent({
      eventType: 'draft_cancel',
      branchId: branchIdNum,
      terminalCode,
      total: draftTotal,
      cartItemsCount: params.cart.length,
      items: itemsSnapshot,
      note: 'مسح/إلغاء السلة الحالية من واجهة الكاشير',
    });
  }

  function logCartRemoveEvent(lineKey: string, note = 'حذف عنصر من سلة الكاشير') {
    const removed = params.cart.find((item) => item.lineKey === lineKey);
    if (!removed) return;
    const remainingCart = removePosItem(params.cart, lineKey);
    const removedValue = roundMoneyValue(calcCartLineNetTotal(removed), bookDigits);
    const remainingTotal = roundMoneyValue(
      computeDraftTotal({
        cart: remainingCart,
        tableNumber: params.tableNumber,
        orderType: params.orderType,
        customerId: params.customerId,
        discount: params.discount,
        deliveryFee: params.deliveryFee,
        paidAmount: params.paidAmount,
        cashAmount: params.cashAmount,
        cardAmount: params.cardAmount,
        transferAmount: params.transferAmount,
        paymentType: params.paymentType,
        paymentChannel: params.paymentChannel,
        note: params.note,
        search: params.search,
        priceType: params.priceType,
        branchId: params.branchId,
        locationId: params.locationId,
      }),
      bookDigits,
    );
    void posApi.logSecurityEvent({
      eventType: 'cart_remove',
      branchId: branchIdNum,
      terminalCode,
      productId: Number(removed.productId || 0) || undefined,
      productName: removed.name || undefined,
      qty: Number(removed.qty || 0) || undefined,
      unitPrice: roundMoneyValue(Number(removed.price || 0), bookDigits),
      removedValue,
      total: remainingTotal,
      cartItemsCount: remainingCart.length,
      items: [toSnapshotItem(removed)],
      note,
    });
  }

  function logQtyDecreaseEvent(item: PosItem, nextQty: number) {
    const prevQty = Number(item.qty || 0);
    if (!(nextQty < prevQty - 0.0001)) return;
    const deltaQty = Number((prevQty - nextQty).toFixed(3));
    const unitPrice = roundMoneyValue(Number(item.price || 0), bookDigits);
    const removedValue = roundMoneyValue(deltaQty * unitPrice, bookDigits);
    void posApi.logSecurityEvent({
      eventType: 'qty_decrease',
      branchId: branchIdNum,
      terminalCode,
      productId: Number(item.productId || 0) || undefined,
      productName: item.name || undefined,
      qty: nextQty,
      previousQty: prevQty,
      unitPrice,
      removedValue,
      cartItemsCount: params.cart.length,
      items: [toSnapshotItem(item, nextQty, prevQty)],
      note: `تنقيص كمية ${item.name} من ${prevQty} إلى ${nextQty}`,
    });
  }

  function checkAndLogWeightedReplay(product: Product, options?: { quantity?: number; isWeighted?: boolean; sourceBarcode?: string }) {
    const rawBarcode = String(options?.sourceBarcode || '').trim();
    if (!options?.isWeighted || rawBarcode.length < 10) return;
    const shiftKey = String((params.ownOpenShift as any)?.id || 'active_session');
    let seen = seenWeightedBarcodesByShift.get(shiftKey);
    if (!seen) {
      seen = new Set<string>();
      seenWeightedBarcodesByShift.set(shiftKey, seen);
      if (seenWeightedBarcodesByShift.size > 10) {
        const firstKey = seenWeightedBarcodesByShift.keys().next().value;
        if (firstKey) seenWeightedBarcodesByShift.delete(firstKey);
      }
    }
    if (seen.has(rawBarcode)) {
      const qty = Number(options?.quantity || 0);
      const unitPrice = roundMoneyValue(Number(product.retailPrice || 0), bookDigits);
      const lineTotal = roundMoneyValue(qty * unitPrice, bookDigits);
      toast.warning(`تنبيه رقابي: باركود الميزان (${rawBarcode}) تم مسحه مسبقاً في هذه الوردية — تم تسجيل التنبيه.`);
      void posApi.logSecurityEvent({
        eventType: 'weighted_barcode_replay',
        branchId: branchIdNum,
        terminalCode,
        productId: Number(product.id || 0) || undefined,
        productName: product.name || undefined,
        qty: qty > 0 ? qty : undefined,
        unitPrice,
        total: lineTotal,
        sourceBarcode: rawBarcode,
        items: [
          {
            productId: Number(product.id || 0) || undefined,
            productName: String(product.name || 'صنف موزون'),
            qty,
            unitPrice,
            lineTotal,
          },
        ],
        note: `تكرار مسح نفس استيكر الميزان (${rawBarcode}) في نفس الوردية`,
      });
    } else {
      seen.add(rawBarcode);
    }
  }

  function wrappedSetQty(lineKey: string, qty: number) {
    const existing = params.cart.find((item) => item.lineKey === lineKey);
    if (existing && isWeightedEditLocked(existing)) {
      const msg = 'تعديل وزن الصنف الموزون يدوياً مقفول (درع منع السرقة). أعد وزن الصنف على الميزان.';
      params.setSubmitMessage(msg);
      toast.warning(msg);
      return;
    }
    if (existing && qty <= 0) {
      logCartRemoveEvent(lineKey, 'حذف عنصر بتصفير الكمية');
    } else if (existing && qty < Number(existing.qty || 0)) {
      logQtyDecreaseEvent(existing, qty);
    }
    base.setQty(lineKey, qty);
  }

  function wrappedChangeLineQtyByDelta(lineKey: string, delta: number) {
    const existing = params.cart.find((item) => item.lineKey === lineKey);
    if (existing && isWeightedEditLocked(existing)) {
      const msg = 'تعديل وزن الصنف الموزون يدوياً مقفول (درع منع السرقة). أعد وزن الصنف على الميزان.';
      params.setSubmitMessage(msg);
      toast.warning(msg);
      return false;
    }
    if (existing && delta < 0) {
      const hasChunks = existing.isWeighted === true && Array.isArray(existing.quantityChunks) && existing.quantityChunks.length > 0;
      const step = existing.isWeighted === true ? 0.001 : 1;
      const predictedNextQty = hasChunks
        ? existing.quantityChunks!.length <= 1
          ? 0
          : Number(existing.quantityChunks!.slice(0, -1).reduce((s, c) => s + c, 0).toFixed(3))
        : existing.isWeighted === true
          ? Number((Number(existing.qty || 0) - step).toFixed(3))
          : Number(existing.qty || 1) - step;
      if (predictedNextQty <= 0) {
        logCartRemoveEvent(lineKey, 'حذف عنصر عبر زر الإنقاص (-)');
      } else {
        logQtyDecreaseEvent(existing, predictedNextQty);
      }
    }
    return base.changeLineQtyByDelta(lineKey, delta);
  }

  return {
    resetPosDraft: () => {
      logDraftCancelEvent();
      base.resetPosDraft();
    },
    handleAddProduct: (product, unitId, options) => {
      checkAndLogWeightedReplay(product, options);
      return base.handleAddProduct(product, unitId, options);
    },
    handleQuickAddCodeSubmit: base.handleQuickAddCodeSubmit,
    exportHeldDrafts: base.exportHeldDrafts,
    setQty: wrappedSetQty,
    setItemNote: base.setItemNote,
    setLineDiscount: base.setLineDiscount,
    addLineSerial: base.addLineSerial,
    removeLineSerial: base.removeLineSerial,
    setItemModifiers: base.setItemModifiers,
    setItemSeat: base.setItemSeat,
    removeItem: (lineKey: string) => {
      logCartRemoveEvent(lineKey);
      base.removeItem(lineKey);
    },
    fillPaidAmount: base.fillPaidAmount,
    setPriceType: base.applyPriceType,
    setPaymentPreset: base.setPaymentPreset,
    selectCartLine: base.selectCartLine,
    changeSelectedQty: (delta: number) => {
      if (!params.selectedLineKey) return false;
      return wrappedChangeLineQtyByDelta(params.selectedLineKey, delta);
    },
    changeLineQtyByDelta: wrappedChangeLineQtyByDelta,
    editSelectedQty: () => {
      const selectedItem = params.cart.find((item) => item.lineKey === params.selectedLineKey);
      if (selectedItem && isWeightedEditLocked(selectedItem)) {
        const msg = 'تعديل وزن الصنف الموزون يدوياً مقفول (درع منع السرقة).';
        params.setSubmitMessage(msg);
        toast.warning(msg);
        return false;
      }
      const prevQty = selectedItem ? Number(selectedItem.qty || 0) : 0;
      const ok = base.editSelectedQty();
      if (ok && selectedItem) {
        // Notice: base.editSelectedQty updates via setQty on base; capture any decrease safely
        const updated = params.cart.find((item) => item.lineKey === selectedItem.lineKey);
        if (updated && Number(updated.qty || 0) < prevQty) {
          logQtyDecreaseEvent(selectedItem, Number(updated.qty || 0));
        }
      }
      return ok;
    },
    removeSelectedItem: () => {
      if (!params.selectedLineKey) return false;
      logCartRemoveEvent(params.selectedLineKey);
      return base.removeSelectedItem();
    },
    selectAdjacentCartLine: base.selectAdjacentCartLine,
    handleQuickCustomerSubmit: asyncActions.handleQuickCustomerSubmit,
    approveDiscountOverride: asyncActions.approveDiscountOverride,
    handleSubmit: asyncActions.handleSubmit,
    holdDraft: asyncActions.holdDraft,
    recallDraft: asyncActions.recallDraft,
    deleteDraft: asyncActions.deleteDraft,
    clearHeldDrafts: asyncActions.clearHeldDrafts,
    reprintLastSale: receiptActions.reprintLastSale,
    reprintLastSaleReceipt: receiptActions.reprintLastSaleReceipt,
    printReceiptNow: receiptActions.printReceiptNow,
    printDualReceiptNow: receiptActions.printDualReceiptNow,
    printMerchantReceiptNow: receiptActions.printMerchantReceiptNow,
    printA4Now: receiptActions.printA4Now,
    printKitchenNow: receiptActions.printKitchenNow,
    printBothNow: receiptActions.printBothNow,
    exportPdfNow: receiptActions.exportPdfNow,
    printGuestCheckNow: receiptActions.printGuestCheckNow,
    completePostSaleCycle: receiptActions.completePostSaleCycle,
    heldDraftSummaries: receiptActions.heldDraftSummaries,
  };
}

export type { PosWorkspaceActionParams };
