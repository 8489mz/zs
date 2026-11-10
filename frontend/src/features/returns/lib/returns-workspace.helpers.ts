import { downloadExcelFile, escapeHtml, printHtmlDocument } from '@/lib/browser';
import { formatCurrency, formatDate } from '@/lib/format';
import { returnsApi } from '@/features/returns/api/returns.api';
import { buildReturnRegisterExportQuery, type ReturnRegisterExportFilters } from './return-register-export-query';
import type { ReturnRecord, AppSettings } from '@/types/domain';
import { buildReceiptDocument } from '@/lib/pos-printing/template';
import { openReceiptDocument } from '@/lib/pos-printing';

export type ReturnFormState = {
  type: 'sale' | 'purchase';
  invoiceId: string;
  settlementMode: 'refund' | 'store_credit';
  refundMethod: 'cash' | 'card';
  note: string;
};

export function createEmptyReturnForm(type: 'sale' | 'purchase' = 'sale'): ReturnFormState {
  return { type, invoiceId: '', settlementMode: 'refund', refundMethod: 'cash', note: '' };
}

export function getReturnTypeValue(row: ReturnRecord) {
  return row.returnType || row.type || 'sale';
}

export function getReturnDateValue(row: ReturnRecord) {
  return row.createdAt || row.date || '';
}

// T11-C: the actual refund a return document paid is the stored
// goods total plus the relief recorded on it. Documents created
// before the relief columns existed carry no refundTotal, so the
// refund is rebuilt from goods + relief; legacy documents with no
// relief at all fall back to the stored goods total.
export function actualReturnRefund(row: ReturnRecord): number {
  if (row.refundTotal !== null && row.refundTotal !== undefined) return Number(row.refundTotal || 0);
  return Number(row.total || 0) + Number(row.tipRelief || 0) + Number(row.courierRelief || 0);
}

export function sumActualReturnRefunds(rows: ReturnRecord[]): number {
  return rows.reduce((sum, row) => sum + actualReturnRefund(row), 0);
}

export function returnTypeLabel(row: ReturnRecord, t?: (key: string, def: string) => string) {
  const isPurchase = getReturnTypeValue(row) === 'purchase';
  if (t) {
    return isPurchase ? t('returns.type.purchase', 'مرتجع شراء') : t('returns.type.sale', 'مرتجع بيع');
  }
  return isPurchase ? 'مرتجع شراء' : 'مرتجع بيع';
}

export function printReturnsRegister(rows: ReturnRecord[], meta?: { totalItems?: number; totalAmount?: number }) {
  const body = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.docNo || row.id)}</td>
      <td>${escapeHtml(returnTypeLabel(row))}</td>
      <td>${escapeHtml(row.productName || '—')}</td>
      <td>${escapeHtml(String(row.qty || 0))}</td>
      <td>${formatCurrency(Number(row.total || 0))}</td>
      <td>${escapeHtml(formatDate(getReturnDateValue(row)))}</td>
    </tr>
  `).join('');
  const total = Number(meta?.totalAmount ?? sumActualReturnRefunds(rows));
  const totalItems = Number(meta?.totalItems ?? rows.length);
  printHtmlDocument('سجل المرتجعات', `
    <h1>سجل المرتجعات</h1>
    <div class="meta">عدد المستندات المطابقة: ${totalItems} · الإجمالي: ${formatCurrency(total)}</div>
    <table>
      <thead><tr><th>المستند</th><th>النوع</th><th>الصنف</th><th>الكمية</th><th>الإجمالي</th><th>التاريخ</th></tr></thead>
      <tbody>${body || '<tr><td colspan="6">لا توجد بيانات</td></tr>'}</tbody>
    </table>
  `);
}

export function printReturnRecord(row: ReturnRecord, settings?: Partial<AppSettings> | null) {
  const isSaleReturn = row.returnType === 'sale' || row.type === 'sale';
  const docLabel = isSaleReturn ? 'إيصال مرتجع مبيعات' : 'إشعار مرتجع مشتريات';
  const partyLabel = row.partyName || row.customerName || row.supplierName || (isSaleReturn ? 'عميل نقدي' : 'مورد');
  const cashierName = row.createdByName || undefined;
  const originalInvoice = row.invoiceDocNo || (row.invoiceId ? (isSaleReturn ? `Z-${row.invoiceId}` : `PO-${row.invoiceId}`) : undefined);
  const refundMethodLabel = row.refundMethod === 'card' ? 'بطاقة / فيزا' : row.settlementMode === 'store_credit' ? 'رصيد عميل (Store Credit)' : 'نقدي (من الدرج)';
  const pageSize = settings?.paperSize === 'receipt' ? 'receipt' : 'a4';

  const document = buildReceiptDocument({
    pageSize,
    settings,
    documentLabel: docLabel,
    documentNumber: row.docNo || (row.id ? `ZR-${row.id}` : '—'),
    referenceInvoice: originalInvoice,
    isReturn: true,
    dateText: formatDate(getReturnDateValue(row)),
    orderType: row.orderType || undefined,
    customerName: partyLabel,
    cashierName,
    paymentText: refundMethodLabel,
    note: row.note || undefined,
    items: row.items && row.items.length > 0 ? row.items.map(item => ({
      name: item.productName || '—',
      qty: Number(item.qty || 0),
      price: Number(item.total || 0) / Math.max(1, Number(item.qty || 1)),
      total: Number(item.total || 0)
    })) : [{
      name: row.productName || '—',
      qty: Number(row.qty || 0),
      price: Number(row.total || 0) / Math.max(1, Number(row.qty || 1)),
      total: Number(row.total || 0),
    }],
    subtotal: Number(row.total || 0),
    discount: 0,
    taxAmount: 0,
    total: Number(row.total || 0),
    paidAmount: Number(row.total || 0),
  });

  openReceiptDocument(
    `${docLabel} ${row.docNo || row.id}`,
    document.html,
    document.compact,
    { pageSize, settings, isReturn: true }
  );
}


export async function exportReturnsCsv(params: ReturnRegisterExportFilters) {
  const payload = await returnsApi.listAll(buildReturnRegisterExportQuery(params));
  const exportRows = payload.returns || [];
  downloadExcelFile('returns-register.xlsx', ['docNo', 'type', 'productName', 'qty', 'total', 'note', 'createdAt'], exportRows.map((row) => [
    row.docNo || '',
    getReturnTypeValue(row),
    row.productName || '',
    row.qty,
    row.total,
    row.note || '',
    getReturnDateValue(row)
  ]));
}

export function printAnomalyReport(summary: import('./returns-anomaly-detector').AnomalyReportSummary) {
  const suspectRows = summary.analyzedRecords.filter((r) => r.riskLevel !== 'low');
  const body = suspectRows.map((row) => `
    <tr>
      <td style="text-align: center;">${escapeHtml(row.returnDocNo)}</td>
      <td style="text-align: center;">${escapeHtml(row.invoiceDocNo)}</td>
      <td style="text-align: right; font-weight: 600;">${escapeHtml(row.record.productName || '—')}</td>
      <td style="text-align: center; font-weight: bold;">${formatCurrency(Number(row.record.total || 0))}</td>
      <td style="text-align: center;">${escapeHtml(row.cashierName)}</td>
      <td style="text-align: center;">${row.timeGapMinutes !== null ? `${row.timeGapMinutes} دقيقة` : '—'}</td>
      <td style="text-align: center; color: ${row.riskLevel === 'high' ? '#dc2626' : '#d97706'}; font-weight: bold;">
        ${row.flags.map((f) => escapeHtml(f.label)).join(' · ')}
      </td>
    </tr>
  `).join('');

  printHtmlDocument('تقرير تدقيق شبهات المرتجعات', `
    <h1>تقرير تدقيق شبهات المرتجعات والكاشير</h1>
    <div class="meta">
      تاريخ الفحص: ${escapeHtml(formatDate(new Date().toISOString()))} · 
      المرتجعات المشبوهة: ${summary.totalSuspectReturnsCount} · 
      المرتجعات الفورية: ${summary.totalRapidReturnsCount} · 
      الكاشيرات تحت الملاحظة: ${summary.highRiskCashiersCount}
    </div>
    <table>
      <thead>
        <tr>
          <th style="width: 80px; text-align: center;">إذن المرتجع</th>
          <th style="width: 80px; text-align: center;">الفاتورة الأصلية</th>
          <th style="text-align: right;">الصنف</th>
          <th style="width: 85px; text-align: center;">المبلغ</th>
          <th style="width: 90px; text-align: center;">الكاشير</th>
          <th style="width: 75px; text-align: center;">فارق الوقت</th>
          <th>مؤشرات الشبهة</th>
        </tr>
      </thead>
      <tbody>${body || '<tr><td colspan="7" style="text-align: center;">لا توجد حركات مشبوهة مرصودة</td></tr>'}</tbody>
    </table>
  `);
}

export function exportAnomalyReportExcel(summary: import('./returns-anomaly-detector').AnomalyReportSummary) {
  const suspectRows = summary.analyzedRecords.filter((r) => r.riskLevel !== 'low');
  const headers = ['إذن المرتجع', 'الفاتورة الأصلية', 'الصنف', 'المبلغ', 'الكاشير', 'فارق الوقت (دقيقة)', 'مستوى الخطورة', 'الأسباب المشبوهة', 'تاريخ المرتجع'];
  downloadExcelFile('returns-anomaly-audit.xlsx', headers, suspectRows.map((row) => [
    row.returnDocNo,
    row.invoiceDocNo,
    row.record.productName || '',
    row.record.total,
    row.cashierName,
    row.timeGapMinutes ?? '',
    row.riskLevel === 'high' ? 'مرتفع' : 'متوسط',
    row.flags.map((f) => f.label).join(' | '),
    formatDate(row.returnDate),
  ]));
}

