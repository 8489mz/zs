import { printPostedSaleReceipt, printKitchenTicket, printGuestCheck } from '@/lib/pos-printing';
import { computeDraftTotal } from '@/features/pos/lib/pos-workspace.helpers';
import { calcCartLineTotal } from '@/features/pos/lib/pos-modifier-totals';
import type { PosWorkspaceActionParams } from '@/features/pos/hooks/usePosWorkspaceActionGroups';

function getSaleKey(params: PosWorkspaceActionParams) {
  return String(params.lastSale?.docNo || params.lastSale?.id || '');
}

export function createPosWorkspaceReceiptActions(params: PosWorkspaceActionParams) {
  function hasFreshLastSale() {
    return Boolean(params.lastSale && params.postSaleSaleKey && getSaleKey(params) === params.postSaleSaleKey);
  }

  function completePostSaleCycle(message = 'جاهز لعميل جديد. امسح الباركود التالي مباشرة.') {
    params.setPostSaleSaleKey('');
    params.setSubmitMessage(message);
    params.requestBarcodeFocus();
  }

  function printLastSaleAs(pageSize: 'receipt' | 'a4') {
    if (!params.lastSale) return false;
    const cashierName = (params.ownOpenShift as any)?.openedByName || params.authUserName || '—';
    printPostedSaleReceipt(params.lastSale, { pageSize, settings: params.settings || null, cashierName });
    params.requestBarcodeFocus();
    return true;
  }

  function reprintLastSale() {
    if (!printLastSaleAs(params.settings?.paperSize === 'receipt' ? 'receipt' : 'a4')) {
      params.setSubmitMessage('لا توجد فاتورة أخيرة لإعادة طباعتها');
      params.requestBarcodeFocus();
    }
  }

  function reprintLastSaleReceipt() {
    if (!printLastSaleAs('receipt')) {
      reprintLastSale();
    }
  }

  function printReceiptNow() {
    if (!hasFreshLastSale() || !params.lastSale) return;
    printLastSaleAs('receipt');
    params.setSubmitMessage('تمت طباعة الريسيت.');
  }

  function printDualReceiptNow() {
    if (!hasFreshLastSale() || !params.lastSale) return;
    const cashierName = (params.ownOpenShift as any)?.openedByName || params.authUserName || '—';
    printPostedSaleReceipt(params.lastSale, { pageSize: 'receipt', settings: params.settings || null, cashierName, copyType: 'dual' });
    params.setSubmitMessage('تمت طباعة نسختي الريسيت (العميل + المحل).');
  }

  function printMerchantReceiptNow() {
    if (!hasFreshLastSale() || !params.lastSale) return;
    const cashierName = (params.ownOpenShift as any)?.openedByName || params.authUserName || '—';
    printPostedSaleReceipt(params.lastSale, { pageSize: 'receipt', settings: params.settings || null, cashierName, copyType: 'merchant' });
    params.setSubmitMessage('تمت طباعة نسخة المحل والدرج.');
  }

  function printA4Now() {
    if (!hasFreshLastSale() || !params.lastSale) return;
    printLastSaleAs('a4');
    params.setSubmitMessage('تم فتح طباعة A4.');
  }

  function printKitchenNow() {
    if (!hasFreshLastSale() || !params.lastSale) return;
    printKitchenTicket(params.lastSale, params.settings);
    params.setSubmitMessage('تم طباعة شيت المطبخ.');
  }

  function printBothNow() {
    if (!hasFreshLastSale() || !params.lastSale) return;
    const sale = params.lastSale;
    printLastSaleAs('receipt');
    setTimeout(() => {
      printKitchenTicket(sale, params.settings);
    }, 400);
    params.setSubmitMessage('تمت طباعة الريسيت وشيت المطبخ.');
  }

  function exportPdfNow() {
    if (!hasFreshLastSale() || !params.lastSale) return;
    const sale = params.lastSale;
    completePostSaleCycle('جارٍ تنزيل ملف PDF بحجم A4. جاهز لعميل جديد.');
    void import('@/lib/pos-printing/pdf')
      .then(({ exportPostedSalePdf }) => exportPostedSalePdf(sale, { settings: params.settings || null }))
      .catch(() => {
        params.setSubmitMessage('تعذر تنزيل PDF. حاول مرة أخرى.');
        params.requestBarcodeFocus();
      });
  }

  function printGuestCheckNow() {
    if (!params.cart.length && !params.tableNumber) {
      params.setSubmitMessage('لا توجد أصناف في السلة لطباعة الشيك');
      return;
    }
    const cashierName = (params.ownOpenShift as any)?.openedByName || params.authUserName || '—';
    const subtotal = params.cart.reduce((sum, item) => {
      return sum + calcCartLineTotal(item);
    }, 0);
    printGuestCheck({
      tableNumber: params.tableNumber || '1',
      items: params.cart,
      subtotal,
      discount: params.totals.discountValue,
      serviceCharge: (params.totals as any).serviceCharge || 0,
      taxAmount: (params.totals as any).taxAmount || 0,
      total: params.totals.total,
      guestCount: params.guestCount || 1,
      customerName: params.quickCustomerName || undefined,
      cashierName,
      branchName: (params.currentBranch as any)?.name,
      locationName: (params.currentLocation as any)?.name,
      settings: params.settings || null,
    });
    params.setGuestCheckPrintedAt?.(new Date().toISOString());
    params.setSubmitMessage('تمت طباعة شيك الطاولة المبدئي بنجاح');
  }

  return {
    reprintLastSale,
    reprintLastSaleReceipt,
    printReceiptNow,
    printDualReceiptNow,
    printMerchantReceiptNow,
    printA4Now,
    printKitchenNow,
    printBothNow,
    exportPdfNow,
    printGuestCheckNow,
    completePostSaleCycle,
    heldDraftSummaries: params.heldDrafts.map((draft, index) => ({
      id: draft.id,
      label: `معلقة ${index + 1} - ${new Date(draft.savedAt).toLocaleString('ar-EG')}`,
      total: computeDraftTotal(draft),
      itemsCount: draft.cart.length,
      savedAt: draft.savedAt,
      tableNumber: draft.tableNumber,
      orderType: draft.orderType as any,
      guestCount: (draft as any).guestCount,
      guestCheckPrintedAt: (draft as any).guestCheckPrintedAt,
    })),
  };
}
