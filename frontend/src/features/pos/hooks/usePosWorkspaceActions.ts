import type { FormEvent } from 'react';
import { removePosItem } from '@/features/pos/lib/pos.domain';
import { computeDraftTotal } from '@/features/pos/lib/pos-workspace.helpers';
import type { PosPriceType } from '@/features/pos/types/pos.types';
import { posApi } from '@/features/pos/api/pos.api';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import type { Product } from '@/types/domain';
import {
  createPosWorkspaceAsyncActions,
  createPosWorkspaceBaseActions,
  createPosWorkspaceReceiptActions,
  type PosWorkspaceActionParams,
} from '@/features/pos/hooks/usePosWorkspaceActionGroups';

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
  /* INV-POS-LINE-DISCOUNT: per-line TOTAL discount (amount) for one
   * cart line. */
  setLineDiscount: (lineKey: string, discount: number) => void;
  addLineSerial: (lineKey: string, serial: string) => void;
  removeLineSerial: (lineKey: string, serial: string) => void;
  setItemModifiers: (lineKey: string, modifiers: any[]) => void;
  setItemSeat: (lineKey: string, seatNumber?: number) => void;
  removeItem: (lineKey: string) => void;
  fillPaidAmount: () => void;
  setPriceType: (nextPriceType: PosPriceType) => void;
  setPaymentPreset: (preset: 'cash' | 'card' | 'wallet' | 'instapay' | 'credit') => void;
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

  function logDraftCancelEvent() {
    if (!params.cart.length) return;
    void posApi.logSecurityEvent({
      eventType: 'draft_cancel',
      total: roundMoneyValue(computeDraftTotal({
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
      }), currencyMoneyDigits(params.settings?.currency || getGlobalSystemCurrency())),
      cartItemsCount: params.cart.length,
      note: 'إلغاء المسودة الحالية من واجهة الكاشير',
    });
  }

  function logCartRemoveEvent(lineKey: string) {
    const removed = params.cart.find((item) => item.lineKey === lineKey);
    if (!removed) return;
    const remainingCart = removePosItem(params.cart, lineKey);
    void posApi.logSecurityEvent({
      eventType: 'cart_remove',
      productId: Number(removed.productId || 0) || undefined,
      productName: removed.name || undefined,
      qty: Number(removed.qty || 0) || undefined,
      total: roundMoneyValue(computeDraftTotal({
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
      }), currencyMoneyDigits(params.settings?.currency || getGlobalSystemCurrency())),
      cartItemsCount: remainingCart.length,
      note: 'حذف عنصر من سلة الكاشير',
    });
  }

  return {
    resetPosDraft: () => {
      logDraftCancelEvent();
      base.resetPosDraft();
    },
    handleAddProduct: base.handleAddProduct,
    handleQuickAddCodeSubmit: base.handleQuickAddCodeSubmit,
    exportHeldDrafts: base.exportHeldDrafts,
    setQty: base.setQty,
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
    changeSelectedQty: base.changeSelectedQty,
    changeLineQtyByDelta: base.changeLineQtyByDelta,
    editSelectedQty: base.editSelectedQty,
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