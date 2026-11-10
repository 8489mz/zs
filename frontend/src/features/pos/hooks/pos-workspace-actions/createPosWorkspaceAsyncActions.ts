import type { FormEvent } from 'react';
import type { Customer, Sale } from '@/types/domain';
import { getPostSalePrintHint, getPostSalePrintMode } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import { catalogApi } from '@/lib/api/catalog';
import { buildPosLineKey, isNegativeStockSalesAllowed } from '@/features/pos/lib/pos.domain';
import type { PosWorkspaceActionParams } from '@/features/pos/hooks/usePosWorkspaceActionGroups';
import type { createPosWorkspaceBaseActions } from '@/features/pos/hooks/pos-workspace-actions/createPosWorkspaceBaseActions';
import { extractCreatedEntityId } from '@/lib/api/extract-created-entity-id';
import { storefrontApi } from '@/features/storefront/api/storefront.api';
import { queryClient } from '@/app/providers';
import { getFriendlyApiErrorMessage } from '@/lib/api-error-message';
import { getSubmitSaleErrorMessage } from '@/features/pos/lib/pos-submit-error';
import { buildHeldSnapshot, restoreHeldSnapshot, writeRecalledBranchLocation } from '@/features/pos/lib/pos-held-snapshot';
import { getPosTerminalCode } from '@/features/pos/lib/pos-offline-sync';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { computePaidAmount } from '@/features/pos/lib/pos-paid-amount';
import { printKitchenTicketAuto, shouldAutoPrintKitchenTicket } from '@/lib/pos-printing/kitchen';

function getSaleKey(sale: Sale | null) {
  if (!sale) return '';
  return String(sale.docNo || sale.id || '');
}

interface SubmitOptions {
  fastCash?: boolean;
  managerPin?: string;
  tenderedAmount?: number;
}

function matchesCreatedCustomer(customer: Customer, name: string, phone: string) {
  const customerName = String(customer.name || '').trim();
  const customerPhone = String(customer.phone || '').trim();
  if (phone) return customerName === name && customerPhone === phone;
  return customerName === name;
}

/** O62: the storefront order the current POS cart was loaded from, if any. */
function readActiveOnlineOrderId(): number {
  try {
    const raw = localStorage.getItem('zs_pos_online_order_id');
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function createPosWorkspaceAsyncActions(
  params: PosWorkspaceActionParams,
  base: ReturnType<typeof createPosWorkspaceBaseActions>,
) {
  async function handleQuickCustomerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = params.quickCustomerName.trim();
    const phone = params.quickCustomerPhone.trim();
    const address = params.quickCustomerAddress.trim();
    if (!name) return;
    try {
      const created = await params.quickCustomerMutation.mutateAsync({
        name,
        phone,
        address,
        balance: 0,
        type: 'cash',
        creditLimit: 0,
      });

      let createdCustomerId = extractCreatedEntityId(created);
      if (!createdCustomerId) {
        const refreshedCustomers = await catalogApi.listCustomers();
        const matchedCustomer = [...refreshedCustomers].reverse().find((customer) => matchesCreatedCustomer(customer, name, phone));
        createdCustomerId = matchedCustomer ? String(matchedCustomer.id) : '';
      }

      params.setQuickCustomerName('');
      params.setQuickCustomerPhone('');
      params.setQuickCustomerAddress('');
      if (createdCustomerId) params.setCustomerId(createdCustomerId);
      params.setPostSaleSaleKey('');
      params.setSubmitMessage(createdCustomerId
        ? 'تم إضافة العميل وتحديده داخل فاتورة الكاشير'
        : 'تم إضافة العميل لكن تعذر تحديده تلقائيًا');
      params.requestBarcodeFocus();
    } catch (error) {
      params.setSubmitMessage(error instanceof Error ? error.message : 'تعذر إضافة العميل');
      params.requestBarcodeFocus();
    }
  }

  async function handleSubmit(options: SubmitOptions = {}): Promise<boolean> {
    if (params.createSale.isPending) return false;
    if (!params.hasOperationalSetup) {
      params.setSubmitMessage('أكمل تعريف المتجر ونقطة التشغيل قبل أول فاتورة.');
      params.requestBarcodeFocus();
      return false;
    }
    if (!params.hasCatalogReady) {
      params.setSubmitMessage('أضف الأصناف أولًا قبل استخدام شاشة الكاشير.');
      params.requestBarcodeFocus();
      return false;
    }
    if (params.requiresCashierShift && !params.ownOpenShift) {
      params.setSubmitMessage('افتح وردية كاشير أولًا قبل تسجيل فاتورة نقدية أو بطاقة.');
      params.requestBarcodeFocus();
      return false;
    }
    if (params.hasZeroPriceLine) {
      params.setSubmitMessage('يوجد صنف بسعر صفر. راجع التسعير قبل إتمام البيع.');
      params.requestBarcodeFocus();
      return false;
    }
    // INV-REST-PAID-GATES-2 (R4-D, I27): the derived gate carries the
    // violation flags the checks above do not (unapproved discount /
    // price, underpaid, zero total, dine-in without a table). Block
    // here with the hint so the cashier sees why; the server enforces
    // the same gates and is the final authority.
    if (!params.canSubmitSale) {
      params.setSubmitMessage(params.canSubmitHint || 'أكمل المطلوب أولًا قبل تأكيد البيع.');
      params.requestBarcodeFocus();
      return false;
    }

    const total = Number(params.totals.total || 0);
    // INV-FE1-FRONTEND-BOOK-DIGITS: paid/change amounts round at the
    // tenant's book digits (settings currency, global fallback).
    const bookDigits = currencyMoneyDigits(params.settings?.currency || getGlobalSystemCurrency());
    const allowNegativeStockSales = isNegativeStockSalesAllowed(params.settings);
    const initialCashAmount = Number(params.cashAmount || 0);
    const initialCardAmount = Number(params.cardAmount || 0);
    const initialTransferAmount = Number(params.transferAmount || 0);
    // INV-REST-PAID-GATES-2 (R4-D, I39): a negative leg is rejected
    // HERE, before the > 0 filter below can silently drop it — a
    // cash −50 + customer used to flip to a zero-paid credit sale.
    if (initialCashAmount < 0 || initialCardAmount < 0 || initialTransferAmount < 0) {
      params.setSubmitMessage('مبالغ الدفع لا يمكن أن تكون سالبة. راجع المبالغ قبل تأكيد البيع.');
      params.requestBarcodeFocus();
      return false;
    }
    // INV-REST-PAID-DEFINITION: the gate paid is the same all-legs sum as
    // the display and the payload — no channel may drop a leg. (Before:
    // wallet/instapay saw transfer only, so cash entered first was invisible
    // to the assume-full-payment checks below.)
    const initialPaidAmount = computePaidAmount(
      { cashAmount: initialCashAmount, cardAmount: initialCardAmount, transferAmount: initialTransferAmount },
      bookDigits,
    );

    // F2 is a fast-cash shortcut only while the current invoice is NOT explicitly credit.
    // If the cashier selected "آجل", the sale must remain credit and must stay attached to the selected customer.
    const forceFastCash = options.fastCash === true && params.paymentType !== 'credit';

    // Smooth negative-stock cashier flow: when below-stock sales are allowed and no amount was typed,
    // treat a normal cash invoice as fully paid instead of blocking it with an underpaid warning.
    // INV-REST-COD-DELIVERY-ONLY (T13-N1): the gate reads the
    // EFFECTIVE collection status — the same value the payload sends
    // below — not the raw UI state. A delivery with no stated status
    // is 'cod' (the courier collects); a non-delivery has no
    // collection status at all, so it can never be a COD delivery
    // however stale the raw state is. (Before: a delivery whose
    // state had lost the status failed this check and the 0-cash
    // COD attempt was blocked by the underpaid gate — Trial 5, J2.)
    const effectiveCollectionStatus = params.orderType === 'delivery'
      ? (params.collectionStatus || 'cod')
      : undefined;
    const isCodDelivery = params.orderType === 'delivery' && effectiveCollectionStatus === 'cod';

    const shouldAssumeFullCashPayment = !forceFastCash
      && !isCodDelivery
      && allowNegativeStockSales
      && params.paymentType !== 'credit'
      && params.paymentChannel === 'cash'
      && initialPaidAmount <= 0.0001
      && total > 0;

    const shouldAssumeFullCardPayment = !forceFastCash
      && !isCodDelivery
      && allowNegativeStockSales
      && params.paymentType !== 'credit'
      && params.paymentChannel === 'card'
      && initialPaidAmount <= 0.0001
      && total > 0;

    const shouldAssumeFullTransferPayment = !forceFastCash
      && !isCodDelivery
      && allowNegativeStockSales
      && params.paymentType !== 'credit'
      && (params.paymentChannel === 'wallet' || params.paymentChannel === 'instapay')
      && initialPaidAmount <= 0.0001
      && total > 0;

    const settleAsCash = forceFastCash || shouldAssumeFullCashPayment;
    const settleAsCard = shouldAssumeFullCardPayment;
    const settleAsTransfer = shouldAssumeFullTransferPayment;

    if (params.hasCreditWithoutCustomer && !settleAsCash) {
      params.setSubmitMessage('اختر عميلًا أولًا لأن البيع الآجل يحتاج حساب عميل.');
      params.requestBarcodeFocus();
      return false;
    }

    const effectivePaymentType = settleAsCash || settleAsCard || settleAsTransfer ? 'cash' : params.paymentType;
    const effectiveCustomerId = String(params.customerId || '').trim();
    const effectiveCashAmount = effectivePaymentType === 'credit'
      ? initialCashAmount
      : (settleAsCash ? total : initialCashAmount);
    const effectiveCardAmount = effectivePaymentType === 'credit'
      ? initialCardAmount
      : (settleAsCard ? total : initialCardAmount);
    const effectiveTransferAmount = effectivePaymentType === 'credit'
      ? initialTransferAmount
      : (settleAsTransfer ? total : initialTransferAmount);

    // INV-REST-PAID-DEFINITION: posted paid is the same all-legs sum as
    // the display and the gate.
    const effectivePaidAmount = computePaidAmount(
      { cashAmount: effectiveCashAmount, cardAmount: effectiveCardAmount, transferAmount: effectiveTransferAmount },
      bookDigits,
    );

    const transferChannel = params.paymentChannel === 'wallet' ? 'wallet' : 'instapay';
    const effectivePaymentChannel = settleAsCash
      ? 'cash'
      : settleAsCard
        ? 'card'
        : settleAsTransfer
          ? transferChannel
          : (effectiveCashAmount > 0 && (effectiveTransferAmount > 0 || effectiveCardAmount > 0))
            ? 'mixed'
            : (effectiveTransferAmount > 0
              ? transferChannel
              : (effectiveCardAmount > 0 ? 'card' : (params.paymentChannel || 'cash')));

    // INV-REST-PAID-GATES-2 (R4-D, I28, D-R4D-1): no silent flip. An
    // underpaid sale with a customer is BLOCKED here — the cashier
    // completes the payment or switches explicitly to the credit
    // preset and re-confirms. (The old code flipped it to credit.)
    // INV-REST-COD-UNPAID-POST-TRUTH (T12-H1): a COD delivery is
    // exempt — the courier collects the unpaid remainder, so an
    // underpaid COD sale with a customer posts unpaid instead of
    // being blocked. Mirrors contracts.ts:165 and the isUnderpaid
    // check below, which both already carry the exemption.
    const isPartialCreditWithCustomer = Boolean(effectiveCustomerId) && effectivePaidAmount < total;
    if (isPartialCreditWithCustomer && effectivePaymentType !== 'credit' && !isCodDelivery) {
      params.setSubmitMessage('المبلغ المدفوع أقل من الإجمالي. أكمل المدفوع أو حوّل العملية إلى آجل صراحةً.');
      params.requestBarcodeFocus();
      return false;
    }
    const isUnderpaid = effectivePaymentType !== 'credit' && !isCodDelivery && effectivePaidAmount < total;

    if (effectivePaymentType === 'credit' && !effectiveCustomerId) {
      params.setSubmitMessage('اختر عميلًا أولًا لأن البيع الآجل يجب أن يسجل على حساب العميل.');
      params.requestBarcodeFocus();
      return false;
    }

    if (isUnderpaid) {
      params.setSubmitMessage('المبلغ المدفوع أقل من المطلوب. أكمل المدفوع أو اختر بيعًا آجلًا.');
      params.requestBarcodeFocus();
      return false;
    }

    if (settleAsCash) {
      params.setPaymentType('cash');
      params.setPaymentChannel('cash');
      params.setCashAmount(total);
      params.setCardAmount(0);
      params.setTransferAmount(0);
    } else if (settleAsCard) {
      params.setPaymentType('cash');
      params.setPaymentChannel('card');
      params.setCashAmount(0);
      params.setCardAmount(total);
      params.setTransferAmount(0);
    } else if (settleAsTransfer) {
      params.setPaymentType('cash');
      params.setCashAmount(0);
      params.setCardAmount(0);
      params.setTransferAmount(total);
    }

    // INV-REST-PAID-GATES-2 (R4-D, I40): when the terminal approved an
    // amount, the final card leg must equal it. This runs on the
    // settled legs, so an assume-full-card fill is checked too.
    const approvedAmount = Number(params.terminalPaymentDetails?.approvedAmount || 0);
    if (params.terminalPaymentDetails?.authCode && approvedAmount > 0 && effectiveCardAmount > 0
      && Math.abs(effectiveCardAmount - approvedAmount) > 0.0001) {
      params.setSubmitMessage('المبلغ المعتمد من ماكينة الدفع لا يطابق مبلغ البطاقة. راجع المبلغ قبل تأكيد البيع.');
      params.requestBarcodeFocus();
      return false;
    }

    params.setPostSaleSaleKey('');

    // INV-REST-COD-COLLECTION-TRUTH (T11-D) + INV-REST-COD-DELIVERY-ONLY
    // (T13-N1): the effective status is computed above, next to the gate,
    // so the gate and the payload can never disagree about what counts as
    // COD. A delivery always states a status ('cod' when unstated);
    // a non-delivery sends no collection status at all.

    const activeOnlineOrderId = readActiveOnlineOrderId();

    try {
      const createdSale = await params.createSale.mutateAsync({
        source: 'pos',
        cart: params.cart,
        customerId: effectiveCustomerId,
        customerPhone: params.quickCustomerPhone,
        customerAddress: params.quickCustomerAddress,
        paymentType: effectivePaymentType,
        paymentChannel: effectivePaymentChannel,
        discount: Number(params.discount || 0),
        loyaltyPointsRedeemed: Number(params.loyaltyPointsRedeemed || 0),
        deliveryFee: params.totals.deliveryFee,
        note: params.note,
        paidAmount: effectivePaidAmount,
        tenderedAmount: (options.tenderedAmount && options.tenderedAmount > 0)
          ? options.tenderedAmount
          : (params.tenderedAmount && params.tenderedAmount > 0 ? params.tenderedAmount : effectiveCashAmount),
        payments: [
          ...(effectiveCashAmount > 0 ? [{ paymentChannel: 'cash' as const, amount: effectiveCashAmount }] : []),
          ...(effectiveCardAmount > 0 ? [{ paymentChannel: 'card' as const, amount: effectiveCardAmount }] : []),
          ...(effectiveTransferAmount > 0 ? [{ paymentChannel: (params.paymentChannel === 'wallet' ? 'wallet' as const : 'instapay' as const), amount: effectiveTransferAmount }] : []),
        ],
        taxRate: params.totals.taxRate,
        pricesIncludeTax: params.totals.pricesIncludeTax,
        expectedTotal: total,
        managerPin: options.managerPin || params.discountApprovalSecret || undefined,
        branchId: params.branchId || (params.currentBranch?.id != null ? String(params.currentBranch.id) : null),
        locationId: params.locationId || (params.currentLocation?.id != null ? String(params.currentLocation.id) : null),
        orderType: params.orderType,
        tableNumber: params.tableNumber,
        diningCourse: params.diningCourse,
        pagerNumber: params.pagerNumber || undefined,
        serviceCharge: params.totals.serviceCharge,
        guestCount: params.guestCount,
        guestCheckPrintedAt: params.guestCheckPrintedAt,
        deliveryRepId: params.deliveryRepId,
        collectionStatus: effectiveCollectionStatus,
        deliveryFeeMode: params.deliveryFeeMode,
        tipAmount: Number(params.tipAmount || 0),
        // O62: tells the server this cart is a storefront order, so it re-approves that order's own
        // coupon discount and line prices instead of treating them as a cashier discount (which asks
        // a cashier without canDiscount for a manager PIN).
        onlineOrderId: activeOnlineOrderId > 0 ? activeOnlineOrderId : undefined,
        terminalId: params.terminalPaymentDetails?.terminalId || undefined,
        // INV-REST-PAID-GATES-2 (R4-D, I24 follow-up): the online
        // submit sends the per-browser terminal code too — R4-B wired
        // it only into the offline-sync path, so without this the
        // attribution worked only for synced offline sales.
        terminalCode: getPosTerminalCode(),
        terminalAuthCode: params.terminalPaymentDetails?.authCode || undefined,
        terminalApprovedAmount: params.terminalPaymentDetails?.approvedAmount || undefined,
        terminalRrn: params.terminalPaymentDetails?.rrn || undefined,
        cardScheme: params.terminalPaymentDetails?.cardScheme || undefined,
        cardLastFour: params.terminalPaymentDetails?.cardLastFour || undefined,
      });
      const rawOnlineNumber = localStorage.getItem('zs_pos_online_order_number');
      const resolvedTendered = (createdSale as any)?.sale?.tenderedAmount
        ?? (createdSale as any)?.tenderedAmount
        ?? ((options.tenderedAmount && options.tenderedAmount > 0) ? options.tenderedAmount : params.tenderedAmount || effectiveCashAmount);
      const hydratedSale: Sale = {
        ...(createdSale as Sale),
        cart: params.cart,
        tenderedAmount: resolvedTendered,
        changeAmount: (createdSale as any)?.sale?.changeAmount
          ?? (createdSale as any)?.changeAmount
          ?? (resolvedTendered > total ? roundMoneyValue(resolvedTendered - total, bookDigits) : 0),
        onlineOrderNumber: rawOnlineNumber || (createdSale as any)?.onlineOrderNumber,
        terminalId: params.terminalPaymentDetails?.terminalId || (createdSale as any)?.terminalId,
        terminalAuthCode: params.terminalPaymentDetails?.authCode || (createdSale as any)?.terminalAuthCode,
        terminalRrn: params.terminalPaymentDetails?.rrn || (createdSale as any)?.terminalRrn,
        cardScheme: params.terminalPaymentDetails?.cardScheme || (createdSale as any)?.cardScheme,
        cardLastFour: params.terminalPaymentDetails?.cardLastFour || (createdSale as any)?.cardLastFour,
        pagerNumber: params.pagerNumber || (createdSale as any)?.pagerNumber || (createdSale as any)?.pager_number,
      } as any;
      params.setLastSale(hydratedSale);
      const createdSaleKey = getSaleKey(hydratedSale);

      // Link online order if this sale originated from an online store order
      try {
        const saleId = Number((createdSale as any)?.id || (createdSale as any)?.sale?.id || (typeof createdSale === 'number' ? createdSale : 0));
        if (activeOnlineOrderId > 0 && saleId > 0) {
          storefrontApi.updateOrderStatus(activeOnlineOrderId, 'processing', saleId)
            .then(() => {
              void queryClient.invalidateQueries({ queryKey: ['storefront-admin-orders'] });
            })
            .catch((err) => {
              console.warn('Failed to link online order to POS sale:', err);
            });
          localStorage.removeItem('zs_pos_online_order_id');
          localStorage.removeItem('zs_pos_online_order_number');
          void queryClient.invalidateQueries({ queryKey: ['storefront-admin-orders'] });
        }
      } catch (err) {
        console.warn('Failed to link online order to POS sale:', err);
      }

      base.resetPosDraft();
      params.setPostSaleSaleKey(createdSaleKey);
      // R4-E I13: the automatic kitchen print lives on the POST, never on
      // the HOLD (a held draft never reaches the KDS). Network printers
      // first; zero matches fall back to the Electron print; a failed
      // configured printer is reported loudly, never as a silent success.
      let kitchenPrintWarning = '';
      if (shouldAutoPrintKitchenTicket({
        posted: true,
        held: false,
        restaurantEnabled: Boolean(params.settings?.restaurantModuleEnabled),
        autoPrint: Boolean(params.settings?.posAutoPrintKitchenReceipt),
      })) {
        const saleId = Number((createdSale as any)?.id || (createdSale as any)?.sale?.id || 0);
        if (saleId > 0) {
          try {
            const autoPrint = await printKitchenTicketAuto(
              { ...hydratedSale, id: saleId, items: params.cart } as any,
              params.settings,
            );
            if (autoPrint.failed.length > 0) {
              kitchenPrintWarning = ` تنبيه: تعذّرت طباعة المطبخ على ${autoPrint.failed.map((f) => f.printerName).join('، ')} — أعد طباعة شيت المطبخ يدويًا.`;
            }
          } catch {
            kitchenPrintWarning = ' تنبيه: تعذّرت طباعة المطبخ تلقائيًا — أعد طباعة شيت المطبخ يدويًا.';
          }
        }
      }
      const postSalePrintMode = getPostSalePrintMode(params.settings || null);
      const isOffline = Boolean((createdSale as any)?.offline);
      const docNo = (createdSale as Sale)?.docNo || (createdSale as any)?.id || '';
      const baseMsg = isOffline
        ? `تم حفظ الفاتورة محلياً (بدون إنترنت): ${docNo}. ستُرحل تلقائياً فور عودة الاتصال.`
        : `تم حفظ فاتورة البيع بنجاح${docNo ? `: ${docNo}` : ''}.`;
      params.setSubmitMessage(`${baseMsg}${kitchenPrintWarning} ${getPostSalePrintHint(postSalePrintMode)}`);
      params.requestBarcodeFocus();
      // T10-A: only a posted sale reports success — the checkout
      // dialog closes on this value, never unconditionally.
      return true;
    } catch (error) {
      params.setSubmitMessage(getSubmitSaleErrorMessage(error));
      params.requestBarcodeFocus();
      return false;
    }
  }

  async function approveDiscountOverride(password: string) {
    const normalized = String(password || '').trim();
    const result = await params.discountAuthorizationMutation.mutateAsync(normalized);
    params.setDiscountApprovalGranted(true);
    params.setDiscountApprovalSecret(normalized);
    params.setSubmitMessage('تم اعتماد الخصم لهذه الفاتورة الحالية');
    return result;
  }

  async function holdDraft() {
    if (!params.cart.length) {
      params.setSubmitMessage('لا يمكن تعليق فاتورة فارغة');
      params.requestBarcodeFocus();
      return;
    }
    try {
      /* INV-REST-HOLD-RECALL-TRUTH (R5-B): the hold sends the single
       * versioned snapshot — every header field and every line field.
       * The old sanitizedItems kept only product/qty/price/names and
       * dropped lineKey / unitId / serials / offer fields, and the
       * payload never sent tip / loyalty / pager / mode / online order /
       * dining / guests / check-printed at all. */
      const snapshot = buildHeldSnapshot({
        cart: params.cart,
        customerId: params.customerId,
        discount: params.discount,
        tipAmount: params.tipAmount,
        loyaltyPointsRedeemed: params.loyaltyPointsRedeemed,
        deliveryFee: params.deliveryFee,
        deliveryFeeMode: params.deliveryFeeMode,
        deliveryRepId: params.deliveryRepId,
        collectionStatus: params.collectionStatus,
        cashAmount: params.cashAmount,
        cardAmount: params.cardAmount,
        transferAmount: params.transferAmount,
        paymentType: params.paymentType,
        paymentChannel: params.paymentChannel,
        note: params.note,
        search: params.search,
        priceType: params.priceType,
        branchId: params.branchId || (params.currentBranch?.id != null ? String(params.currentBranch.id) : ''),
        locationId: params.locationId || (params.currentLocation?.id != null ? String(params.currentLocation.id) : ''),
        orderType: params.orderType,
        tableNumber: params.tableNumber,
        pagerNumber: params.pagerNumber,
        diningCourse: params.diningCourse,
        guestCount: params.guestCount,
        guestCheckPrintedAt: params.guestCheckPrintedAt,
        onlineOrderId: readActiveOnlineOrderId() > 0 ? readActiveOnlineOrderId() : undefined,
      });
      const sanitizedItems = snapshot.cart.map((item) => ({
        productId: Number(item.productId || 0),
        qty: Number(item.qty || 0),
        price: Number(item.price || 0),
        name: String(item.name || '').trim(),
        unitId: item.unitId ? String(item.unitId) : undefined,
        unitName: String(item.unitName || '').trim(),
        unitMultiplier: Number(item.unitMultiplier || 1),
        priceType: item.priceType === 'wholesale' ? 'wholesale' : 'retail',
        notes: String(item.notes || '').trim(),
        modifiers: item.modifiers || [],
        seatNumber: item.seatNumber ? Number(item.seatNumber) : undefined,
        course: item.course || undefined,
        lineKey: item.lineKey || undefined,
        serials: item.serials,
        originalPrice: item.originalPrice,
        offerDiscount: item.offerDiscount,
        offerName: item.offerName,
        isWeighted: item.isWeighted,
        quantityChunks: item.quantityChunks,
      }));
      await params.saveHeldDraftMutation.mutateAsync({
        customerId: snapshot.customerId || null,
        paymentType: snapshot.paymentType,
        discount: snapshot.discount,
        deliveryFee: snapshot.deliveryFee,
        tipAmount: snapshot.tipAmount,
        loyaltyPointsRedeemed: snapshot.loyaltyPointsRedeemed,
        pagerNumber: snapshot.pagerNumber || undefined,
        deliveryFeeMode: snapshot.deliveryFeeMode,
        onlineOrderId: snapshot.onlineOrderId,
        diningCourse: snapshot.diningCourse,
        guestCount: snapshot.guestCount,
        guestCheckPrintedAt: snapshot.guestCheckPrintedAt || undefined,
        note: snapshot.note,
        search: snapshot.search,
        priceType: snapshot.priceType,
        branchId: snapshot.branchId || null,
        locationId: snapshot.locationId || null,
        cashAmount: snapshot.cashAmount,
        cardAmount: snapshot.cardAmount,
        transferAmount: snapshot.transferAmount,
        paymentChannel: snapshot.paymentChannel,
        orderType: snapshot.orderType,
        tableNumber: snapshot.tableNumber,
        deliveryRepId: Number(snapshot.deliveryRepId) > 0 ? Number(snapshot.deliveryRepId) : undefined,
        collectionStatus: snapshot.collectionStatus || 'cod',
        items: sanitizedItems,
      });
      // R4-E I13: no kitchen print here anymore — a held draft never reaches
      // the KDS, so printing it as "sent to the kitchen" lied. The automatic
      // print lives on the POST in handleSubmit.
      base.resetPosDraft();
      const isRestaurant = Boolean(params.settings?.restaurantModuleEnabled);
      const successMessage = isRestaurant
        ? (params.tableNumber ? `تم تعليق طلب طاولة ${params.tableNumber} — لم يُرسل للمطبخ بعد` : 'تم تعليق الطلب — لم يُرسل للمطبخ بعد')
        : 'تم تعليق الفاتورة الحالية ويمكن استرجاعها لاحقًا';
      params.setSubmitMessage(successMessage);
      params.requestBarcodeFocus();
    } catch (error) {
      params.setSubmitMessage(getFriendlyApiErrorMessage(error, 'تعذر حفظ الفاتورة المعلقة'));
      params.requestBarcodeFocus();
      /* INV-REST-HOLD-RECALL-TRUTH (R5-B): a failed auto-hold must abort
       * the recall that follows it — the live cart is unrecoverable once
       * overwritten. The old code swallowed the error and returned
       * normally, so a failed hold still wiped the live cart. */
      throw error;
    }
  }

  async function recallDraft(draftId: string) {
    const draft = params.heldDrafts.find((entry) => entry.id === draftId);
    if (!draft) return;

    /* INV-REST-HOLD-RECALL-TRUTH (R5-B): delete-before-restore. The
     * draft object is already in memory, so deleting first loses
     * nothing — and a failed delete can no longer leave the same order
     * twice (once in the cart, once still held). The old order
     * (setCart, then delete with no try/catch) did exactly that. */
    try {
      await params.deleteHeldDraftMutation.mutateAsync(draftId);
    } catch (error) {
      params.setSubmitMessage(getFriendlyApiErrorMessage(error, 'تعذّر حذف الفاتورة المعلقة — لم يتم الاسترجاع'));
      params.requestBarcodeFocus();
      throw error;
    }

    /* Restore every field from the single versioned snapshot. The
     * lineKey synthesis line below is owned by R5-C: the stored lineKey
     * now flows through restoreHeldSnapshot, and only a missing one is
     * synthesised here via buildPosLineKey. */
    const { cart, header } = restoreHeldSnapshot(draft);
    const restoredCart = cart.map((item: any) => ({
      ...item,
      notes: item.notes || '',
      modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
      seatNumber: item.seatNumber != null ? Number(item.seatNumber) : undefined,
      course: item.course || undefined,
      lineKey: item.lineKey || buildPosLineKey({
        productId: item.productId,
        unitId: item.unitId || item.unitName,
        priceType: item.priceType || 'retail',
        modifiers: item.modifiers,
        seatNumber: item.seatNumber,
        course: item.course,
      })
    }));

    /* M32: restore the draft's branch/location (they are already in the
     * payload). There is no branch setter — the override lives in
     * usePosWorkspace, fed by this write + event. */
    writeRecalledBranchLocation(header.branchId, header.locationId);
    /* The online order id lives in localStorage, and clearDraftSnapshot
     * deletes it on reset — so a recalled storefront order restores it
     * here, or the re-approval it triggers is lost. */
    if (header.onlineOrderId) {
      try {
        localStorage.setItem('zs_pos_online_order_id', String(header.onlineOrderId));
      } catch {
        /* storage unavailable: the order id is lost, the sale still posts. */
      }
    }

    params.setCart(restoredCart);
    params.setCustomerId(header.customerId || '');
    params.setQuickCustomerName(header.quickCustomerName || '');
    params.setQuickCustomerPhone(header.quickCustomerPhone || '');
    params.setQuickCustomerAddress(header.quickCustomerAddress || '');
    params.setDiscount(Number(header.discount || 0));
    params.setDeliveryFee(Number(header.deliveryFee || 0));
    params.setTipAmount?.(Number(header.tipAmount || 0));
    params.setLoyaltyPointsRedeemed?.(Number(header.loyaltyPointsRedeemed || 0));
    params.setPagerNumber?.(header.pagerNumber || '');
    params.setGuestCount?.(Number(header.guestCount || 1));
    params.setGuestCheckPrintedAt?.(header.guestCheckPrintedAt || null);
    params.setDiningCourse?.(header.diningCourse || 'main');
    params.setCashAmount(Number(header.cashAmount || 0));
    params.setCardAmount(Number(header.cardAmount || 0));
    params.setTransferAmount(
      Number(
        header.transferAmount
        || ((header.paymentChannel === 'wallet' || header.paymentChannel === 'instapay')
          ? header.paidAmount || 0
          : 0),
      ),
    );
    params.setPaymentType(header.paymentType);
    params.setPaymentChannel(header.paymentChannel);
    params.setNote(header.note);
    params.setSearch(header.search);
    params.setPriceType(header.priceType);
    params.setOrderType(header.orderType || 'takeaway');
    params.setTableNumber(header.tableNumber || '');
    params.setDeliveryRepId(header.deliveryRepId || '');
    params.setCollectionStatus(header.collectionStatus || 'cod');
    if (header.deliveryFeeMode) {
      params.setDeliveryFeeMode(header.deliveryFeeMode);
    }
    params.setDiscountApprovalGranted(false);
    params.setDiscountApprovalSecret('');
    params.setPostSaleSaleKey('');
    params.setSubmitMessage('تم استرجاع الفاتورة المعلقة');
    params.requestBarcodeFocus();
  }

  return {
    handleQuickCustomerSubmit,
    approveDiscountOverride,
    handleSubmit,
    holdDraft,
    recallDraft,
    deleteDraft: async (draftId: string) => {
      await params.deleteHeldDraftMutation.mutateAsync(draftId);
      params.requestBarcodeFocus();
    },
    clearHeldDrafts: async () => {
      await params.clearHeldDraftsMutation.mutateAsync();
      params.requestBarcodeFocus();
    },
  };
}
