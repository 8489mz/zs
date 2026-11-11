import { printPosDraftPreview } from '@/lib/pos-printing';
import { SINGLE_STORE_MODE } from '@/config/product-scope';
import type { usePosWorkspace } from '@/features/pos/hooks/usePosWorkspace';
import type { AppSettings } from '@/types/domain';

export type PosWorkspaceState = ReturnType<typeof usePosWorkspace>;

export type PosPostSalePrintMode = 'receipt' | 'a4';

export const POS_SHORTCUTS = [
  { key: 'F2', label: 'إتمام البيع والدفع' },
  { key: 'F3', label: 'الطاولات والطلبات المعلقة' },
  { key: 'F4', label: 'تعليق الفاتورة' },
  { key: 'F6', label: 'البحث في الأصناف والباركود' },
  { key: 'F7', label: 'طلب هاتفي وكول سنتر التوصيل' },
  { key: 'F8', label: 'الخدمات السريعة' },
  { key: 'F9', label: 'إعادة طباعة الفواتير' },
  { key: 'F10', label: 'إظهار / إخفاء القائمة الجانبية' },
  { key: 'F12', label: 'طباعة A4' },
  { key: 'Esc', label: 'تفريغ السلة' },
] as const;

export function getSelectedCustomerName(pos: PosWorkspaceState) {
  return (pos.customersQuery.data || []).find((customer) => String(customer.id) === String(pos.customerId))?.name || 'عميل نقدي';
}

export function getPostSalePrintMode(settings?: Partial<AppSettings> | null): PosPostSalePrintMode {
  return settings?.paperSize === 'receipt' ? 'receipt' : 'a4';
}

export function getPostSalePrintLabel(mode: PosPostSalePrintMode) {
  return mode === 'receipt' ? 'ريسيت' : 'A4';
}

export function getPostSalePrintHint(mode: PosPostSalePrintMode) {
  return mode === 'receipt'
    ? 'بعد الحفظ: اطبع الريسيت أو ابدأ عميلًا جديدًا مباشرة.'
    : 'بعد الحفظ: اطبع A4 أو ابدأ عميلًا جديدًا مباشرة.';
}

export function getStartupIssues(pos: PosWorkspaceState) {
  if (pos.isLoading) {
    return [];
  }
  return [
    !pos.hasOperationalSetup ? 'أكمل تعريف المتجر ونقطة التشغيل من الإعدادات قبل استخدام شاشة الكاشير.' : '',
    pos.requiresCashierShift && !pos.ownOpenShift ? 'لا توجد وردية مفتوحة لهذا المستخدم. افتح وردية لبدء البيع.' : '',
  ].filter(Boolean);
}

export function getWorkflowSteps(pos: PosWorkspaceState) {
  return [
    { key: 'pick', title: '1. اختر الأصناف', hint: pos.cart.length ? `${pos.cart.length} عنصر داخل السلة` : 'ابدأ بالبحث أو الباركود' },
    { key: 'review', title: '2. راجع الدفع', hint: pos.paymentType === 'credit' ? 'تحقق من العميل والمديونية' : `المتبقي الآن ${pos.amountDue > 0 ? 'غير مكتمل' : 'مكتمل'}` },
    { key: 'submit', title: '3. أكد الفاتورة', hint: pos.canSubmitSale ? 'جاهزة للإتمام بـ F2' : pos.canSubmitHint || 'أكمل المطلوب أولًا' },
  ];
}

export function getNextStepLabel(pos: PosWorkspaceState) {
  return pos.canSubmitSale
    ? 'كل شيء جاهز. راجع السلة ثم أكد البيع مباشرة.'
    : pos.canSubmitHint || 'ابدأ بإضافة صنف واحد على الأقل إلى السلة.';
}

export function printCurrentPosDraft(pos: PosWorkspaceState, customerName: string, customerPhone?: string, customerAddress?: string) {
  if (!pos.cart.length) return;
  printPosDraftPreview({
    title: 'معاينة فاتورة الكاشير',
    customerName,
    customerPhone,
    customerAddress,
    paymentLabel: pos.paymentType === 'credit'
      ? 'آجل'
      : pos.paymentChannel === 'mixed'
        ? 'مختلط'
        : pos.paymentChannel === 'wallet'
          ? 'محفظة إلكترونية'
          : pos.paymentChannel === 'instapay'
            ? 'InstaPay'
            : pos.paymentChannel === 'card'
              ? 'فيزا'
              : 'نقدي',
    branchName: SINGLE_STORE_MODE ? 'المتجر الرئيسي' : (pos.currentBranch?.name || 'الرئيسي'),
    locationName: pos.currentLocation?.name || 'المخزن الأساسي',
    items: pos.cart,
    /* INV-POS-LINE-DISCOUNT: the receipt template takes the NET
     * subtotal (gross minus per-line discounts) — the backend's
     * stored subtotal for posted sales — and rebuilds the gross by
     * adding the line discounts back. */
    subtotal: pos.totals.netSubTotal ?? pos.totals.subTotal,
    discount: pos.totals.discountValue,
    deliveryFee: pos.totals.deliveryFee,
    taxAmount: pos.totals.taxAmount,
    total: pos.totals.total,
    note: pos.note,
    tableNumber: pos.tableNumber,
    orderType: pos.orderType,
    pageSize: pos.settingsQuery.data?.paperSize === 'receipt' ? 'receipt' : 'a4',
    settings: pos.settingsQuery.data || null,
  });
}
