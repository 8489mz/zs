import i18n from '@/lib/i18n';
import { printPostedSaleReceipt } from '@/lib/pos-printing';
import { formatCurrency } from '@/lib/format';
import type { AppSettings, Sale } from '@/types/domain';

export type SalesViewFilter = 'all' | 'cash' | 'card' | 'credit' | 'wallet' | 'instapay' | 'mixed' | 'cancelled';

export function getSalesViewFilterLabel(filter: SalesViewFilter) {
  switch (filter) {
    case 'cash':
      return i18n.t('sales.9d7a25', 'فواتير نقدي');
    case 'card':
      return i18n.t('sales.b86e13', 'فواتير فيزا');
    case 'credit':
      return i18n.t('sales.e090ca', 'فواتير آجل');
    case 'wallet':
      return i18n.t('sales.03ce01', 'فواتير محفظة إلكترونية');
    case 'instapay':
      return i18n.t('sales.32d24b', 'فواتير InstaPay');
    case 'mixed':
      return i18n.t('sales.e52ef9', 'فواتير مختلطة');
    case 'cancelled':
      return i18n.t('sales.746044', 'فواتير ملغاة');
    default:
      return i18n.t('sales.6d83a1', 'كل الفواتير');
  }
}

export function getSalePaymentLabel(sale?: Sale | null) {
  if (!sale) return '—';
  if (sale.paymentType === 'credit') return i18n.t('pos.credit_label', 'آجل');
  if (sale.paymentChannel === 'mixed') return i18n.t('sales.e52ef9', 'مختلط');
  if (sale.paymentChannel === 'card') return i18n.t('pos.card', 'فيزا');
  if (sale.paymentChannel === 'wallet') return i18n.t('pos.wallet', 'محفظة إلكترونية');
  if (sale.paymentChannel === 'instapay') return i18n.t('pos.instapay', 'InstaPay');
  return i18n.t('pos.cash', 'نقدي');
}

export function printSaleDocument(
  sale: Sale,
  settings?: Partial<AppSettings> | null,
  pageSize: 'a4' | 'receipt' = 'receipt',
) {
  // Register + details prints are reprints of an already-posted sale:
  // mark the receipt as a duplicate copy so it can never pass as the original.
  printPostedSaleReceipt(sale, { pageSize, settings, isReprint: true });
}

export function getSalesNextStep(params: {
  selectedSale?: Sale | null;
  canEditInvoices: boolean;
  totalItems: number;
}) {
  const { selectedSale, canEditInvoices, totalItems } = params;
  if (selectedSale) {
    if (selectedSale.status === 'cancelled') return i18n.t('sales.122027', 'الفاتورة ملغاة. استخدم الطباعة أو راجع السجل فقط.');
    return canEditInvoices
      ? i18n.t('sales.223fce', 'يمكنك الآن إلغاء الفاتورة أو طباعتها من اللوحة اليمنى.')
      : i18n.t('sales.f2a80f', 'الفاتورة محددة. راجع التفاصيل أو اطبعها من اللوحة اليمنى.');
  }
  return totalItems
    ? i18n.t('sales.a79af3', 'اختر فاتورة من الجدول حتى تظهر التفاصيل والإجراءات.')
    : i18n.t('sales.875fb0', 'ابدأ بتخفيف الفلاتر أو افتح الكاشير لإنشاء فاتورة جديدة.');
}

export function buildSalesScopeRows(params: {
  activeFilterLabel: string;
  totalItems: number;
  rangeStart: number;
  rangeEnd: number;
  search: string;
  selectedSale?: Sale | null;
  totalSales: number;
}) {
  const { activeFilterLabel, totalItems, rangeStart, rangeEnd, search, selectedSale, totalSales } = params;
  return [
    { label: 'النطاق الحالي', value: activeFilterLabel },
    { label: 'عدد الفواتير المطابقة', value: `${totalItems}` },
    { label: 'المعروض الآن', value: `${rangeStart}-${rangeEnd}` },
    { label: 'نص البحث', value: search.trim() || 'بدون بحث' },
    { label: 'الفاتورة المحددة', value: selectedSale ? (selectedSale.docNo || selectedSale.id) : 'لا يوجد' },
    { label: 'العميل المحدد', value: selectedSale?.customerName || '—' },
    { label: 'إجمالي النطاق', value: formatCurrency(totalSales || 0) },
  ];
}

export function buildSalesGuidanceCards(params: {
  activeFilterLabel: string;
  salesNextStep: string;
  selectedSale?: Sale | null;
  search: string;
}) {
  const { activeFilterLabel, salesNextStep, selectedSale, search } = params;
  return [
    { key: 'scope', label: 'ما الذي تراه الآن؟', value: activeFilterLabel },
    { key: 'selection', label: 'الإجراء الأنسب الآن', value: salesNextStep },
    { key: 'focus', label: 'التركيز الحالي', value: selectedSale ? `فاتورة ${selectedSale.docNo || selectedSale.id}` : (search.trim() || 'سجل الفواتير بالكامل') },
  ];
}

export function getSaleCancelDescription(sale?: Sale | null) {
  if (!sale) return '';
  return `سيتم إلغاء الفاتورة ${sale.docNo || sale.id} واسترجاع أثرها المحاسبي والمخزني. لا تنفذ هذه العملية بعد وجود مرتجعات أو تسويات لاحقة على العميل.`;
}
