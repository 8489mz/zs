import {
  addPosItem,
  addSerialToPosLine,
  isNegativeStockSalesAllowed,
  removePosItem,
  removeSerialFromPosLine,
  repriceCartLine,
  updatePosItemQtyWithOptions,
  updatePosItemNotes,
  updatePosItemModifiers,
  updatePosItemSeat,
} from '@/features/pos/lib/pos.domain';
import { buildSaleLineKey, matchProductByCode } from '@/features/pos/lib/pos-workspace.helpers';
import {
  formatWeightedBarcodeQuantity,
  matchProductByWeightedCode,
  parseWeightedBarcode,
} from '@/features/pos/lib/weighted-barcode';
import { parseQuantityPrefixQuery } from '@/features/pos/lib/pos-quantity-prefix';
import {
  exportHeldDraftRows,
  findLineQty,
  getAddProductErrorMessage,
  resetPosDraftState,
  resolveAvailableQty,
  resolveSaleUnit,
  toMoney,
} from '@/features/pos/hooks/pos-workspace-actions/createPosWorkspaceBaseActions.helpers';
import type { PosPriceType } from '@/features/pos/types/pos.types';
import type { Product } from '@/types/domain';
import type { PosWorkspaceActionParams } from '@/features/pos/hooks/usePosWorkspaceActionGroups';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits } from '@/shared/utils/money';

export function createPosWorkspaceBaseActions(params: PosWorkspaceActionParams) {
  // INV-FE1-FRONTEND-BOOK-DIGITS: cart pricing rounds at the tenant's
  // book digits (settings currency, global system currency fallback).
  const bookDigits = currencyMoneyDigits(params.settings?.currency || getGlobalSystemCurrency());
  function resolveUnitLineKey(product: Product, unitId?: string) {
    const unit = resolveSaleUnit(product, unitId);
    return `${product.id}::${unit?.id || unit?.name || ''}::${params.priceType}`;
  }

  function registerRecentProduct(productId: string) {
    params.setRecentProductIds((current) => {
      if (current[0] === productId) return current;
      return [productId, ...current.filter((id) => id !== productId)].slice(0, 8);
    });
  }

  function selectCartLine(lineKey: string) {
    params.setSelectedLineKey(lineKey);
  }

  function resetPosDraft() {
    resetPosDraftState(params);
  }

  function handleAddProduct(
    product: Product,
    unitId?: string,
    options: { quantity?: number; isWeighted?: boolean; sourceBarcode?: string; serialNumber?: string } = {},
  ) {

    const lineKey = unitId ? resolveUnitLineKey(product, unitId) : buildSaleLineKey(product, params.priceType);
    const allowNegativeStockSales = isNegativeStockSalesAllowed(params.settings) || !!product.hasBom;
    const unit = resolveSaleUnit(product, unitId);
    const isWeighted = options.isWeighted === true;
    const availableQty = allowNegativeStockSales
      ? Number.MAX_SAFE_INTEGER
      : resolveAvailableQty(product, Number(unit?.multiplier || 1), isWeighted);
    const requestedQty = Number(options.quantity ?? 1);
    const currentQty = findLineQty(params.cart, lineKey);

    if (!allowNegativeStockSales && availableQty <= 0) {
      const globalStock = Number((product as any).globalStock || 0);
      const friendlyMessage = globalStock > 0
        ? 'الصنف موجود، لكنه غير متاح في مخزون هذا الفرع.'
        : getAddProductErrorMessage(null, product, { availableQty, currentQty, requestedQty, isWeighted });
      params.setSubmitMessage(friendlyMessage);
      params.setScannerMessage(friendlyMessage);
      params.requestBarcodeFocus();
      return false;
    }

    if (!allowNegativeStockSales && currentQty > 0 && currentQty >= availableQty) {
      const friendlyMessage = getAddProductErrorMessage(null, product, { availableQty, currentQty, requestedQty, isWeighted });
      params.setSubmitMessage(friendlyMessage);
      params.setScannerMessage(friendlyMessage);
      params.requestBarcodeFocus();
      return false;
    }

    try {
      let caughtError: unknown = null;
      params.setCart((currentCart) => {
        try {
          return addPosItem(currentCart, product, {
            priceType: params.priceType,
            digits: bookDigits,
            unitId,
            allowNegativeStockSales,
            quantity: options.quantity,
            isWeighted: options.isWeighted,
            sourceBarcode: options.sourceBarcode,
            serialNumber: options.serialNumber,
          });
        } catch (error) {
          caughtError = error;
          return currentCart;
        }
      });
      if (caughtError) throw caughtError;
      params.setSelectedLineKey(lineKey);
      params.setLastAddedLineKey(lineKey);
      params.setPostSaleSaleKey('');
      registerRecentProduct(String(product.id));
      params.setSearch('');
      params.setQuickAddCode('');
      params.setScannerMessage(`تمت إضافة ${product.name}`);
      params.requestBarcodeFocus();
      return true;
    } catch (error) {
      const message = getAddProductErrorMessage(error, product, { availableQty, currentQty, requestedQty, isWeighted });
      params.setSubmitMessage(message);
      params.setScannerMessage(message);
      params.requestBarcodeFocus();
      return false;
    }
  }

  function handleQuickAddCodeSubmit(rawCode?: string, productsOverride?: Product[]) {
    const raw = String(rawCode ?? params.quickAddCode).trim();
    const parsed = parseQuantityPrefixQuery(raw);
    const code = parsed.cleanQuery || raw;
    const requestedQuantity = parsed.hasPrefix ? parsed.quantity : 1;

    if (parsed.isSuffixQuantityChange) {
      const targetLineKey = params.selectedLineKey || params.lastAddedLineKey || params.cart[0]?.lineKey;
      if (targetLineKey) {
        setQty(targetLineKey, parsed.quantity);
        params.setSearch('');
        params.setQuickAddCode('');
        params.setScannerMessage(`تم تعديل الكمية إلى ${parsed.quantity}.`);
        params.requestBarcodeFocus();
        return true;
      }
    }

    if (parsed.hasPrefix && !parsed.cleanQuery) {
      params.setScannerMessage(`الكمية المحددة: ${parsed.quantity} — اضرب الباركود الآن`);
      params.requestBarcodeFocus();
      return true;
    }

    const result = matchProductByCode(productsOverride || params.products || [], code);
    if (result.status === 'empty') {
      params.setScannerMessage('اكتب الباركود أولًا.');
      params.requestBarcodeFocus();
      return false;
    }
    if (result.status === 'not-found') {
      const weightedBarcode = parseWeightedBarcode(code, params.settings);
      if (weightedBarcode) {
        const weightedResult = matchProductByWeightedCode(productsOverride || params.products || [], weightedBarcode.productCode);
        if (weightedResult.status === 'matched') {
          const product = weightedResult.match.product;
          const unitId = weightedResult.match.kind === 'unit' ? weightedResult.match.unitId : undefined;
          let quantity = weightedBarcode.quantity;
          if (weightedBarcode.priceAmount !== undefined) {
            const unit = resolveSaleUnit(product, unitId);
            const basePrice = params.priceType === 'wholesale' ? Number(product.wholesalePrice) : Number(product.retailPrice);
            const unitPrice = basePrice * Number(unit?.multiplier || 1);
            quantity = Number((weightedBarcode.priceAmount / unitPrice).toFixed(3));
            let previewPrice = 0;
            if (Number.isFinite(quantity) && quantity > 0) {
              try {
                previewPrice = Number(addPosItem([], product, {
                  priceType: params.priceType, digits: bookDigits, unitId, allowNegativeStockSales: true, quantity, isWeighted: true,
                })[0]?.price || 0);
              } catch {
                previewPrice = 0;
              }
            }
            if (!Number.isFinite(quantity) || quantity <= 0 ||
                Math.abs(quantity * unitPrice - weightedBarcode.priceAmount) > 0.01 ||
                Math.abs(quantity * previewPrice - weightedBarcode.priceAmount) > 0.01) {
              params.setScannerMessage('السعر المشفر لا يطابق سعر الصنف الحالي؛ راجع إعدادات الميزان والعروض.');
              params.requestBarcodeFocus();
              return false;
            }
          }
          const added = handleAddProduct(
            product,
            unitId,
            { quantity, isWeighted: true, sourceBarcode: weightedBarcode.rawCode },
          );
          if (!added) return false;
          params.setSearch('');
          params.setQuickAddCode('');
          params.setScannerMessage(`تمت إضافة ${product.name} بكمية ${formatWeightedBarcodeQuantity(quantity)}.`);
          return true;
        }
        if (weightedResult.status === 'ambiguous') {
          params.setScannerMessage(`كود الميزان ${weightedBarcode.productCode} مرتبط بأكثر من صنف أو وحدة. راجع كود الصنف أولًا.`);
          params.requestBarcodeFocus();
          return false;
        }
        params.setScannerMessage(`باركود ميزان: لم يتم العثور على كود الصنف ${weightedBarcode.productCode}.`);
        params.requestBarcodeFocus();
        return false;
      }
      params.setScannerMessage('لا يوجد صنف أو وحدة بهذا الباركود.');
      params.requestBarcodeFocus();
      return false;
    }
    if (result.status === 'ambiguous') {
      params.setScannerMessage('هذا الباركود غير واضح أو مرتبط بأكثر من نتيجة. راجع الصنف أو الوحدة أولًا.');
      params.requestBarcodeFocus();
      return false;
    }
    const added = handleAddProduct(
      result.match.product,
      result.match.kind === 'unit' ? result.match.unitId : undefined,
      { quantity: requestedQuantity },
    );
    if (!added) return false;
    params.setSearch('');
    params.setQuickAddCode('');
    params.setScannerMessage(
      requestedQuantity > 1
        ? `تمت إضافة ${result.match.product.name} (عدد ${requestedQuantity}).`
        : result.match.kind === 'unit' && result.match.unitName
          ? `تمت إضافة ${result.match.product.name} بوحدة ${result.match.unitName}.`
          : `تمت إضافة ${result.match.product.name} إلى السلة.`,
    );
    return true;
  }

  function exportHeldDrafts() {
    exportHeldDraftRows(params);
  }

  function applyPriceType(nextPriceType: PosPriceType) {
    const selectedLine = params.cart.find((item) => item.lineKey === params.selectedLineKey);
    params.setPriceType(nextPriceType);
    params.setCart((current) => current.map((item) => {
      const product = (params.products || []).find((entry) => entry.id === item.productId);
      if (!product) return item;
      return repriceCartLine({
        ...item,
        priceType: nextPriceType,
        lineKey: `${item.productId}::${item.unitId || item.unitName}::${nextPriceType}`,
      }, product, item.qty, bookDigits);
    }));
    if (selectedLine) {
      params.setSelectedLineKey(`${selectedLine.productId}::${selectedLine.unitId || selectedLine.unitName}::${nextPriceType}`);
    }
  }

  function setQty(lineKey: string, qty: number, options: { quantityChunks?: number[] | null } = {}) {
    try {
      const nextCart = updatePosItemQtyWithOptions(params.cart, lineKey, qty, params.products || [], {
        allowNegativeStockSales: isNegativeStockSalesAllowed(params.settings),
        quantityChunks: options.quantityChunks,
        digits: bookDigits,
      });
      params.setSelectedLineKey(lineKey);
      params.setCart(nextCart);
      params.setSubmitMessage('');
      params.setPostSaleSaleKey('');
    } catch (error) {
      params.setSubmitMessage(error instanceof Error ? error.message : 'تعذر تعديل الكمية.');
    }
  }

  function setItemNote(lineKey: string, notes: string) {
    try {
      const nextCart = updatePosItemNotes(params.cart, lineKey, notes);
      params.setSelectedLineKey(lineKey);
      params.setCart(nextCart);
    } catch (error) {
      params.setSubmitMessage('تعذر تعديل الملاحظات.');
    }
  }

  function setItemModifiers(lineKey: string, modifiers: any[]) {
    try {
      const nextCart = updatePosItemModifiers(params.cart, lineKey, modifiers);
      params.setSelectedLineKey(lineKey);
      params.setCart(nextCart);
    } catch (error) {
      params.setSubmitMessage('تعذر تعديل الإضافات.');
    }
  }

  function setItemSeat(lineKey: string, seatNumber?: number) {
    try {
      const nextCart = updatePosItemSeat(params.cart, lineKey, seatNumber);
      params.setSelectedLineKey(lineKey);
      params.setCart(nextCart);
    } catch (error) {
      params.setSubmitMessage('تعذر تعديل رقم المقعد.');
    }
  }

  /* LF-P3: serial entry on a cart line. The pure helper throws a specific
   * message (duplicate, line full, not a serial-tracked line); surfacing it
   * through the submit message keeps the cashier on the cart with the reason
   * in front of them. The live lookup check already ran in the entry UI. */
  function addLineSerial(lineKey: string, serial: string) {
    try {
      const nextCart = addSerialToPosLine(params.cart, lineKey, serial);
      params.setSelectedLineKey(lineKey);
      params.setCart(nextCart);
      params.setSubmitMessage('');
    } catch (error) {
      params.setSubmitMessage(error instanceof Error ? error.message : 'تعذّرت إضافة السيريال.');
      throw error;
    }
  }

  function removeLineSerial(lineKey: string, serial: string) {
    try {
      const nextCart = removeSerialFromPosLine(params.cart, lineKey, serial);
      params.setSelectedLineKey(lineKey);
      params.setCart(nextCart);
    } catch (error) {
      params.setSubmitMessage('تعذّر حذف السيريال.');
    }
  }

  function removeItem(lineKey: string) {
    params.setCart((current) => removePosItem(current, lineKey));
    if (params.selectedLineKey === lineKey) params.setSelectedLineKey('');
    params.setPostSaleSaleKey('');
  }

  function fillPaidAmount() {
    if (params.paymentType === 'credit') return;
    const total = toMoney(params.totals.total);
    if (params.paymentChannel === 'wallet' || params.paymentChannel === 'instapay') {
      params.setCashAmount(0);
      params.setCardAmount(0);
      params.setTransferAmount(total);
      return;
    }
    if (params.paymentChannel === 'card') {
      params.setCashAmount(0);
      params.setCardAmount(total);
      params.setTransferAmount(0);
      return;
    }
    if (params.paymentChannel === 'mixed' && Number(params.cardAmount || 0) > 0) {
      const nextCardAmount = Math.min(total, Math.max(0, toMoney(params.cardAmount)));
      params.setCardAmount(nextCardAmount);
      params.setCashAmount(toMoney(total - nextCardAmount));
      params.setTransferAmount(0);
      return;
    }
    params.setCashAmount(total);
    params.setCardAmount(0);
    params.setTransferAmount(0);
  }

  function setPaymentPreset(preset: 'cash' | 'card' | 'wallet' | 'instapay' | 'credit') {
    params.setSubmitMessage('');
    params.setPostSaleSaleKey('');
    if (preset === 'credit') {
      params.setPaymentType('credit');
      params.setPaymentChannel('credit');
      params.setCashAmount(0);
      params.setCardAmount(0);
      params.setTransferAmount(0);
      params.requestBarcodeFocus();
      return;
    }
    const total = toMoney(params.totals.total);
    params.setPaymentType('cash');

    const currentCash = toMoney(params.cashAmount);
    const currentCard = toMoney(params.cardAmount);
    const currentTransfer = toMoney(params.transferAmount);
    const isCurrentTransfer = params.paymentChannel === 'wallet' || params.paymentChannel === 'instapay';

    if (preset === 'wallet' || preset === 'instapay') {
      params.setPaymentChannel(preset);
      if (isCurrentTransfer) {
        // Switching between electronic sub-channels (Wallet <-> InstaPay):
        // Keep cash and transfer distributions untouched!
        if (currentTransfer === 0 && currentCash === 0 && currentCard === 0) {
          params.setTransferAmount(total);
        }
      } else if (currentCash > 0 && currentCash < total && currentCard === 0) {
        // Cashier entered a cash split first: keep cash and assign remainder to transfer
        params.setTransferAmount(toMoney(Math.max(0, total - currentCash)));
        params.setCardAmount(0);
      } else if (currentTransfer > 0) {
        // Keep existing transfer and cash
        params.setCardAmount(0);
      } else {
        // Full single payment
        params.setCashAmount(0);
        params.setCardAmount(0);
        params.setTransferAmount(total);
      }
    } else if (preset === 'card') {
      params.setPaymentChannel('card');
      params.setCashAmount(0);
      params.setCardAmount(total);
      params.setTransferAmount(0);
    } else {
      // Preset is 'cash'
      params.setPaymentChannel('cash');
      params.setCashAmount(total);
      params.setCardAmount(0);
      params.setTransferAmount(0);
    }
    params.requestBarcodeFocus();
  }

  function changeLineQtyByDelta(lineKey: string, delta: number) {
    const selectedItem = params.cart.find((item) => item.lineKey === lineKey);
    if (!selectedItem) return false;

    if (selectedItem.isWeighted === true && selectedItem.quantityChunks && selectedItem.quantityChunks.length > 0) {
      const chunks = [...selectedItem.quantityChunks];
      if (delta > 0) {
        const lastChunk = chunks[chunks.length - 1] || 0.001;
        chunks.push(lastChunk);
        const nextQty = Number(chunks.reduce((sum, chunk) => sum + chunk, 0).toFixed(3));
        if (!isNegativeStockSalesAllowed(params.settings) && nextQty > selectedItem.stockLimit) {
          params.setSubmitMessage('الكمية المطلوبة أكبر من المخزون المتاح.');
          return false;
        }
        setQty(lineKey, nextQty, { quantityChunks: chunks });
        return true;
      } else if (delta < 0) {
        chunks.pop();
        if (chunks.length === 0) {
          removeItem(lineKey);
          return true;
        }
        const nextQty = Number(chunks.reduce((sum, chunk) => sum + chunk, 0).toFixed(3));
        setQty(lineKey, nextQty, { quantityChunks: chunks });
        return true;
      }
    }

    const step = selectedItem.isWeighted === true ? 0.001 : 1;
    const nextQty = selectedItem.isWeighted === true
      ? Number((Number(selectedItem.qty || 0) + (delta > 0 ? step : -step)).toFixed(3))
      : Number(selectedItem.qty || 1) + (delta > 0 ? step : -step);
    
    if (nextQty <= 0) {
      removeItem(lineKey);
      return true;
    }
    setQty(lineKey, nextQty);
    return true;
  }

  function changeSelectedQty(delta: number) {
    if (!params.selectedLineKey) return false;
    return changeLineQtyByDelta(params.selectedLineKey, delta);
  }

  function editSelectedQty() {
    const selectedItem = params.cart.find((item) => item.lineKey === params.selectedLineKey);
    if (!selectedItem || typeof window === 'undefined') return false;
    const rawValue = window.prompt(`أدخل الكمية الجديدة للصنف: ${selectedItem.name}`, String(selectedItem.qty));
    if (rawValue == null) return false;
    const nextQty = Number(rawValue || 0);
    if (!Number.isFinite(nextQty) || nextQty <= 0) {
      params.setSubmitMessage('الكمية يجب أن تكون أكبر من صفر.');
      return false;
    }
    setQty(selectedItem.lineKey, selectedItem.isWeighted === true ? Number(nextQty.toFixed(3)) : Math.round(nextQty), { quantityChunks: null });
    return true;
  }

  function removeSelectedItem() {
    if (!params.selectedLineKey) return false;
    removeItem(params.selectedLineKey);
    params.requestBarcodeFocus();
    return true;
  }

  function selectAdjacentCartLine(direction: 'next' | 'prev') {
    if (!params.cart.length) return false;
    const currentIndex = params.cart.findIndex((item) => item.lineKey === params.selectedLineKey);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const offset = direction === 'next' ? 1 : -1;
    const nextIndex = (baseIndex + offset + params.cart.length) % params.cart.length;
    params.setSelectedLineKey(params.cart[nextIndex]?.lineKey || '');
    return true;
  }

  return {
    resetPosDraft,
    handleAddProduct,
    handleQuickAddCodeSubmit,
    exportHeldDrafts,
    applyPriceType,
    registerRecentProduct,
    selectCartLine,
    setQty,
    setItemNote,
    setItemModifiers,
    setItemSeat,
    addLineSerial,
    removeLineSerial,
    removeItem,
    fillPaidAmount,
    setPaymentPreset,
    changeLineQtyByDelta,
    changeSelectedQty,
    editSelectedQty,
    removeSelectedItem,
    selectAdjacentCartLine,
  };
}
