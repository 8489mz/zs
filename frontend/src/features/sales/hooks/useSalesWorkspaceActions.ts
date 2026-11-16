import { downloadExcelFile, escapeHtml, printHtmlDocument } from '@/lib/browser';
import { formatCurrency } from '@/lib/format';
import { salesApi, type SalesListFilter } from '@/features/sales/api/sales.api';
import { getSalePaymentLabel } from '@/features/sales/lib/sales-workspace.helpers';
import type { Sale } from '@/types/domain';

export function useSalesWorkspaceActions(params: {
  search: string;
  viewFilter: SalesListFilter;
  cashierFilter: string;
  dateFrom: string;
  dateTo: string;
  totalItems: number;
  summary?: { totalSales?: number; creditTotal?: number; cancelledCount?: number } | null;
  topCustomers: Array<{ name: string; count: number; total: number }>;
  setPage: (value: number) => void;
  setPageSize: (value: number) => void;
  setSearch: (value: string) => void;
  setViewFilter: (value: SalesListFilter) => void;
  setCashierFilter: (value: string) => void;
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
  setSelectedSaleId: (value: string) => void;
  setSaleToCancel: (value: Sale | null) => void;
}) {
  const { search, viewFilter, cashierFilter, dateFrom, dateTo, totalItems, summary, topCustomers, setPage, setPageSize, setSearch, setViewFilter, setCashierFilter, setDateFrom, setDateTo, setSelectedSaleId, setSaleToCancel } = params;

  async function exportSalesCsv() {
    const result = await salesApi.listAll({ search, filter: viewFilter, cashier: cashierFilter, dateFrom, dateTo });
    downloadExcelFile('sales-register-results.xlsx', ['docNo', 'customer', 'status', 'paymentType', 'total', 'paidAmount', 'date', 'branch', 'location'], result.rows.map((sale) => [
      sale.docNo || sale.id,
      sale.customerName || 'عميل نقدي',
      sale.status || '',
      getSalePaymentLabel(sale),
      sale.total || 0,
      sale.paidAmount || 0,
      sale.date || '',
      sale.branchName || '',
      sale.locationName || ''
    ]));
  }

  function exportTopCustomersCsv() {
    downloadExcelFile('top-customers-sales.xlsx', ['customer', 'invoices', 'total'], topCustomers.map((customer) => [customer.name, customer.count, customer.total]));
  }

  function resetSalesView() {
    setPage(1);
    setPageSize(30);
    setSearch('');
    setViewFilter('all');
    setCashierFilter('all');
    setDateFrom('');
    setDateTo('');
    setSelectedSaleId('');
    setSaleToCancel(null);
  }

  async function copySalesSummary() {
    if (!totalItems || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    const lines = [
      'ملخص المبيعات الحالي',
      `عدد الفواتير: ${totalItems}`,
      `إجمالي المبيعات: ${formatCurrency(summary?.totalSales || 0)}`,
      `مبيعات آجلة: ${formatCurrency(summary?.creditTotal || 0)}`,
      `فواتير ملغاة: ${summary?.cancelledCount || 0}`
    ];
    if (topCustomers.length) {
      lines.push('أعلى العملاء:');
      topCustomers.forEach((customer, index) => {
        lines.push(`${index + 1}. ${customer.name} - ${customer.count} فاتورة - ${formatCurrency(customer.total)}`);
      });
    }
    await navigator.clipboard.writeText(lines.join('\n'));
  }

  function printTopCustomers() {
    if (!topCustomers.length) return;
    printHtmlDocument('أعلى العملاء في المبيعات', `
      <table>
        <thead><tr><th>العميل</th><th>عدد الفواتير</th><th>الإجمالي</th></tr></thead>
        <tbody>${topCustomers.map((customer) => `<tr><td>${escapeHtml(customer.name)}</td><td>${customer.count}</td><td>${formatCurrency(customer.total)}</td></tr>`).join('')}</tbody>
      </table>
    `, {
      subtitle: 'أفضل العملاء وفق النتائج المطابقة لفلاتر شاشة المبيعات',
      pageSize: 'A4',
    });
  }

  async function printSalesRegister() {
    if (!totalItems) return;
    const result = await salesApi.listAll({ search, filter: viewFilter, cashier: cashierFilter });
    printHtmlDocument('سجل المبيعات', `
      <div class="meta-grid">
        <div class="meta-box"><strong>عدد الفواتير</strong><span>${result.rows.length}</span></div>
        <div class="meta-box"><strong>إجمالي المبيعات</strong><span>${formatCurrency(summary?.totalSales || 0)}</span></div>
      </div>
      <table style="border: 1px solid #e2e8f0; border-collapse: collapse;">
        <thead>
          <tr style="background-color: #f8fafc; border-bottom: 2px solid #cbd5e1;">
            <th style="border: 1px solid #e2e8f0; text-align: right;">الفاتورة</th>
            <th style="border: 1px solid #e2e8f0; text-align: right;">العميل</th>
            <th style="border: 1px solid #e2e8f0; text-align: center;">الحالة</th>
            <th style="border: 1px solid #e2e8f0; text-align: center;">الدفع</th>
            <th style="border: 1px solid #e2e8f0; text-align: right;">الإجمالي</th>
            <th style="border: 1px solid #e2e8f0; text-align: right;">التاريخ</th>
          </tr>
        </thead>
        <tbody>${result.rows.map((sale) => {
          const statusColor = sale.status === 'completed' || sale.status === 'paid' ? '#16a34a' : sale.status === 'cancelled' || sale.status === 'refunded' ? '#dc2626' : '#ea580c';
          
          let rowHtml = `<tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="border: 1px solid #e2e8f0;"><strong>${escapeHtml(sale.docNo || sale.id)}</strong></td>
            <td style="border: 1px solid #e2e8f0;">${escapeHtml(sale.customerName || 'عميل نقدي')}</td>
            <td style="border: 1px solid #e2e8f0; text-align: center; color: ${statusColor}; font-weight: bold;">${escapeHtml(sale.status || '')}</td>
            <td style="border: 1px solid #e2e8f0; text-align: center;">${escapeHtml(getSalePaymentLabel(sale))}</td>
            <td style="border: 1px solid #e2e8f0;"><strong>${formatCurrency(sale.total || 0)}</strong></td>
            <td style="border: 1px solid #e2e8f0;">${escapeHtml(sale.date || '')}</td>
          </tr>`;

          if (sale.items && sale.items.length > 0) {
             const itemsDetails = sale.items.map(item => `
               <div style="display: inline-flex; align-items: center; background: #fff; padding: 2px 8px; border-radius: 6px; margin: 2px; font-size: 0.9em; border: 1px solid #cbd5e1; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                 ${escapeHtml(item.name || (item as any).productName)} <strong style="color: #0369a1; padding-right: 6px; font-size: 1.05em; font-weight: 800;">(${item.qty})</strong>
               </div>
             `).join('');
             rowHtml += `<tr><td colspan="6" style="padding: 10px 16px; border-bottom: 2px solid #cbd5e1; background: #f8fafc; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
               <div style="font-weight: 800; margin-bottom: 6px; font-size: 0.9em; color: #475569; display: flex; align-items: center; gap: 4px;">
                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                 تفاصيل الفاتورة:
               </div>
               <div style="display: flex; flex-wrap: wrap; gap: 4px;">${itemsDetails}</div>
             </td></tr>`;
          }
          return rowHtml;
        }).join('')}</tbody>
      </table>
    `, { subtitle: 'نتائج سجل المبيعات الحالية', pageSize: 'A4' });
  }

  return {
    exportSalesCsv,
    exportTopCustomersCsv,
    resetSalesView,
    copySalesSummary,
    printTopCustomers,
    printSalesRegister,
  };
}
