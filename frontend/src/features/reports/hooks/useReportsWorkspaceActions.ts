import { toast } from '@/shared/components/system-alert';
import { downloadExcelFile, escapeHtml, printHtmlDocument } from '@/lib/browser';
import { formatCurrency } from '@/lib/format';
import { reportsApi, type ReportInventoryRow } from '@/features/reports/api/reports.api';
import type { Customer, ReportSummary } from '@/types/domain';
import { formatPercent, integerFormatter, inventoryStatusLabel } from '@/features/reports/lib/reports-format';

export function useReportsWorkspaceActions({
  report,
  submittedRange,
  rangeDays,
  executiveRows,
  topProducts,
  inventorySearch,
  inventoryFilter,
  deadStockDays,
  balancesSearch,
  balancesFilter,
  locationId,
  locations,
}: {
  report: ReportSummary | null;
  submittedRange: { from: string; to: string };
  rangeDays: number;
  executiveRows: Array<[string, number]>;
  topProducts: Array<{ name?: string; qty?: number; revenue?: number }>;
  inventorySearch: string;
  inventoryFilter: 'all' | 'attention' | 'low' | 'out' | 'dead';
  deadStockDays?: number;
  balancesSearch: string;
  balancesFilter: 'all' | 'high-balance' | 'over-limit';
  locationId?: string;
  locations?: Array<{ id: number | string; name: string }>;
}) {
  const shortDateRange = `${new Date(submittedRange.from).toLocaleDateString('en-GB').replace(/\//g, '-')} إلى ${new Date(submittedRange.to).toLocaleDateString('en-GB').replace(/\//g, '-')}`;
  const todayDate = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');

  const exportLowStock = async () => {
    const effectiveLocationId = locationId && locationId !== 'all' ? locationId : undefined;
    const selectedLocation = locations?.find((l) => String(l.id) === String(effectiveLocationId));
    const locationSuffix = selectedLocation ? ` - ${selectedLocation.name}` : '';
    const rows = await reportsApi.listAllInventory({
      search: inventorySearch,
      filter: inventoryFilter,
      days: deadStockDays,
      locationId: effectiveLocationId,
    });
    const title = inventoryFilter === 'dead'
      ? `المخزون الراكد${locationSuffix} ${todayDate}.xlsx`
      : `أرصدة ونواقص المخزون${locationSuffix} ${todayDate}.xlsx`;
    downloadExcelFile(
      title,
      ['الصنف', 'الرصيد في المخزن', 'الحد الأدنى', 'القسم', 'المورد', 'المخزن', 'الحالة'],
      rows.map((item) => [
        item.name,
        item.stock,
        item.minStock,
        item.category || '',
        item.supplier || '',
        selectedLocation ? selectedLocation.name : (item.topLocationName || ''),
        inventoryStatusLabel(item.status),
      ])
    );
  };

  const exportCustomerBalances = async () => {
    const rows = await reportsApi.listAllCustomerBalances({ search: balancesSearch, filter: balancesFilter });
    downloadExcelFile(`أرصدة العملاء ${todayDate}.xlsx`, ['name', 'phone', 'balance', 'creditLimit'], rows.map((item) => [item.name, item.phone, item.balance, item.creditLimit]));
  };

  const exportExecutiveSummary = () => {
    downloadExcelFile(`التقرير التنفيذي ${shortDateRange}.xlsx`, ['metric', 'value'], executiveRows.map(([metric, value]: [string, number]) => [metric, value]));
  };

  const exportTopProducts = () => {
    downloadExcelFile(`أعلى الأصناف ${shortDateRange}.xlsx`, ['product', 'qty', 'revenue'], topProducts.map((item) => [item.name, item.qty, item.revenue]));
  };

  const printTopProducts = (format: 'A4' | 'receipt' = 'A4') => {
    if (!topProducts.length) return;
    const isReceipt = format === 'receipt';
    printHtmlDocument(`أعلى الأصناف ${shortDateRange}`, `
      <div class="meta-grid">
        <div class="meta-box"><strong>الأيام المغطاة</strong><span>${rangeDays} يوم</span></div>
        <div class="meta-box"><strong>صافي البيع</strong><span>${formatCurrency(report?.sales.netSales || 0)}</span></div>
      </div>
      <table>
        <thead><tr><th>الصنف</th><th style="text-align: center;">الكمية</th><th style="text-align: left;">الإيراد</th></tr></thead>
        <tbody>${topProducts.map((item) => `<tr><td>${escapeHtml(item.name || '—')}</td><td style="text-align: center;">${integerFormatter(item.qty || 0)}</td><td style="text-align: left;">${formatCurrency(item.revenue || 0)}</td></tr>`).join('')}</tbody>
      </table>
      <div class="totals">
        <div><span>إجمالي مبيعات الأصناف المعروضة:</span><strong>${formatCurrency(topProducts.reduce((s, i) => s + (i.revenue || 0), 0))}</strong></div>
      </div>
    `, { subtitle: 'أفضل الأصناف مبيعاً خلال النطاق الحالي', pageSize: isReceipt ? 'receipt' : 'A4' });
  };

  const printExecutiveSummary = (format: 'A4' | 'receipt' = 'A4') => {
    if (!report) return;
    const isReceipt = format === 'receipt';
    printHtmlDocument(`التقرير التنفيذي ${shortDateRange}`, `
      <div class="meta-grid">
        <div class="meta-box"><strong>الفترة</strong><span>${escapeHtml(submittedRange.from)} → ${escapeHtml(submittedRange.to)}</span></div>
        <div class="meta-box"><strong>الأيام المغطاة</strong><span>${rangeDays} يوم</span></div>
        <div class="meta-box"><strong>صافي الخزينة</strong><span>${formatCurrency(report?.treasury.net || 0)}</span></div>
      </div>
      <table>
        <tbody>
          ${executiveRows.map(([metric, value]: [string, number]) => `<tr><th style="text-align: right;">${escapeHtml(metric)}</th><td style="text-align: left; font-weight: 700;">${metric === 'هامش الربح %' ? formatPercent(Number(value || 0)) : formatCurrency(Number(value || 0))}</td></tr>`).join('')}
        </tbody>
      </table>
    `, { subtitle: 'ملخص قيادي موحد من شاشة التقارير', pageSize: isReceipt ? 'receipt' : 'A4', footerHtml: `<div>نطاق التقرير: ${escapeHtml(submittedRange.from)} → ${escapeHtml(submittedRange.to)}</div>` });
  };

  const printInventoryValueReport = async (format: 'A4' | 'receipt' = 'A4') => {
    const effectiveLocationId = locationId && locationId !== 'all' ? locationId : undefined;
    const selectedLocation = locations?.find((l) => String(l.id) === String(effectiveLocationId));
    const locationLabel = selectedLocation ? selectedLocation.name : 'كل المخازن';
    const rows = await reportsApi.listAllInventory({
      search: inventorySearch,
      filter: inventoryFilter,
      locationId: effectiveLocationId,
    });
    if (!rows.length) return;
    
    const isReceipt = format === 'receipt';
    const totalQty = rows.reduce((acc, r) => acc + (r.stock || 0), 0);
    const totalCost = rows.reduce((acc, r) => acc + ((r.stock || 0) * (r.costPrice || 0)), 0);
    const totalRetail = rows.reduce((acc, r) => acc + ((r.stock || 0) * (r.retailPrice || 0)), 0);

    printHtmlDocument(`تقرير جرد وقيمة المخزون - ${locationLabel} ${todayDate}`, `
      <div class="meta-grid">
        <div class="meta-box"><strong>المخزن</strong><span>${escapeHtml(locationLabel)}</span></div>
        <div class="meta-box"><strong>إجمالي الأصناف</strong><span>${rows.length}</span></div>
        <div class="meta-box"><strong>إجمالي الكميات</strong><span>${integerFormatter(totalQty)}</span></div>
        <div class="meta-box"><strong>قيمة التكلفة</strong><span>${formatCurrency(totalCost)}</span></div>
        <div class="meta-box"><strong>القيمة التقديرية</strong><span>${formatCurrency(totalRetail)}</span></div>
      </div>
      <table>
        <thead><tr><th>الصنف</th><th style="text-align: center;">الكمية</th><th style="text-align: left;">التكلفة</th>${!isReceipt ? '<th>القسم</th><th>المورد</th><th>المخزن</th>' : ''}</tr></thead>
        <tbody>${rows.map((item: ReportInventoryRow) => `<tr>
          <td>${escapeHtml(item.name)}</td>
          <td style="text-align: center;">${escapeHtml(String(item.stock))}</td>
          <td style="text-align: left;"><strong>${formatCurrency((item.costPrice || 0) * (item.stock || 0))}</strong></td>
          ${!isReceipt ? `<td>${escapeHtml(item.category || '—')}</td><td>${escapeHtml(item.supplier || '—')}</td><td>${escapeHtml(selectedLocation ? selectedLocation.name : (item.topLocationName || '—'))}</td>` : ''}
        </tr>`).join('')}</tbody>
      </table>
      <div class="totals">
        <div><span>إجمالي قيمة التكلفة:</span><strong>${formatCurrency(totalCost)}</strong></div>
        <div><span>إجمالي قيمة البيع التقديرية:</span><strong>${formatCurrency(totalRetail)}</strong></div>
      </div>
    `, { subtitle: `تقرير تفصيلي لكميات وقيمة البضاعة (${locationLabel})`, pageSize: isReceipt ? 'receipt' : 'A4' });
  };

  const printInventoryMovementsReport = async (locationId: string, detailed: boolean = false, format: 'A4' | 'receipt' = 'A4') => {
    const { inventoryApi } = await import('@/shared/api/inventory.api');
    const allTransfers = await inventoryApi.listAllTransfers(locationId !== 'all' ? { locationId } : {});
    
    const transfers = allTransfers.filter(t => {
      if (!t.date) return false;
      if (t.status === 'cancelled') return false;
      const tTime = new Date(t.date).getTime();
      const fromTime = new Date(submittedRange.from).getTime();
      const toTime = new Date(submittedRange.to).getTime();
      return tTime >= fromTime && tTime <= toTime;
    });

    if (!transfers.length) {
      toast.info('لا توجد حركات في هذه الفترة المحددة.');
      return;
    }

    let locationName = 'كل المخازن والفروع';
    if (locationId !== 'all') {
      const match = transfers.find(t => String(t.fromLocationId) === locationId || String(t.toLocationId) === locationId || String(t.fromBranchId) === locationId || String(t.toBranchId) === locationId);
      if (match) {
        locationName = [String(match.fromLocationId), String(match.fromBranchId)].includes(locationId) 
          ? (match.fromLocationName || match.fromBranchName || 'مخزن') 
          : (match.toLocationName || match.toBranchName || 'مخزن');
      }
    }

    const dateOptions: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'numeric', day: 'numeric' };
    const dateRangeText = `من ${new Date(submittedRange.from).toLocaleDateString('ar-EG', dateOptions)} إلى ${new Date(submittedRange.to).toLocaleDateString('ar-EG', dateOptions)}`;
    const isReceipt = format === 'receipt';

    printHtmlDocument(detailed ? `حركات وعمليات المخزن (تفصيلي) ${shortDateRange}` : `حركات وعمليات المخزن (ملخص) ${shortDateRange}`, `
      <div class="meta-grid">
        <div class="meta-box"><strong>إجمالي الحركات</strong><span>${transfers.length}</span></div>
        <div class="meta-box"><strong>الكمية المحولة</strong><span>${integerFormatter(transfers.reduce((sum, t) => sum + (t.items?.reduce((a, i) => a + (i.qty || 0), 0) || 0), 0))}</span></div>
      </div>
      <table>
        <thead>
          <tr>
            <th>المستند</th>
            <th>من → إلى</th>
            <th style="text-align: center;">الحالة</th>
            <th style="text-align: center;">الكمية</th>
            ${!isReceipt ? '<th>التاريخ</th><th>المُسلّم</th><th>المستلم</th>' : ''}
          </tr>
        </thead>
        <tbody>${transfers.map((t) => {
          const fromLocation = escapeHtml(t.fromLocationName || t.fromBranchName || '—');
          const toLocation = escapeHtml(t.toLocationName || t.toBranchName || '—');
          const totalQty = integerFormatter(t.items?.reduce((sum, item) => sum + (item.qty || 0), 0) || 0);
          const statusText = t.status === 'received' ? 'مستلم' : t.status === 'sent' ? 'مرسل' : 'ملغي';
          
          let rowHtml = `<tr>
            <td><strong>${escapeHtml(t.docNo)}</strong></td>
            <td>${fromLocation} → ${toLocation}</td>
            <td style="text-align: center; font-weight: bold;">${statusText}</td>
            <td style="text-align: center; font-weight: bold;">${totalQty}</td>
            ${!isReceipt ? `<td>${new Date(t.date).toLocaleDateString('ar-EG')}</td><td>${escapeHtml(t.createdBy || '—')}</td><td>${escapeHtml(t.recipientName || '—')}</td>` : ''}
          </tr>`;

          if (detailed && t.items && t.items.length > 0) {
             const itemsDetails = t.items.map(item => `
               <span style="display: inline-block; padding: 1px 4px; margin: 1px;">
                 ${escapeHtml(item.productName)}: <strong>(${item.qty})</strong>
               </span>
             `).join(' • ');
             rowHtml += `<tr><td colspan="${isReceipt ? 4 : 7}" style="padding: 4px 6px; background: rgba(240, 240, 240, 0.5); font-size: 0.9em;">
               <strong>الأصناف:</strong> ${itemsDetails}
             </td></tr>`;
          }
          return rowHtml;
        }).join('')}</tbody>
      </table>
    `, { 
      subtitle: detailed ? 'تقرير تفصيلي لعمليات الصرف والاستلام مضافاً إليه بنود التحويل' : 'تقرير ملخص لعمليات الصرف والاستلام بين المخازن', 
      headerDetailsHtml: `<strong>الموقع:</strong> ${escapeHtml(locationName)} &nbsp; | &nbsp; <strong>${escapeHtml(dateRangeText)}</strong>`,
      pageSize: isReceipt ? 'receipt' : 'A4', 
      layout: isReceipt ? 'standard' : 'centered',
      footerHtml: `<div>${escapeHtml(dateRangeText)} | ${escapeHtml(locationName)}</div>` 
    });
  };

  const printSalesRegisterReport = async (detailed: boolean = false, format: 'A4' | 'receipt' = 'A4') => {
    const { salesApi } = await import('@/features/sales/api/sales.api');
    const { getSalePaymentLabel } = await import('@/features/sales/lib/sales-workspace.helpers');
    const allSales = await salesApi.listAll();
    
    const sales = allSales.rows.filter(s => {
      if (!s.date) return false;
      const sTime = new Date(s.date).getTime();
      const fromTime = new Date(submittedRange.from).getTime();
      const toTime = new Date(submittedRange.to).getTime();
      return sTime >= fromTime && sTime <= toTime;
    });

    if (!sales.length) {
      alert('لا توجد مبيعات في هذه الفترة المحددة.');
      return;
    }

    const dateOptions: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'numeric', day: 'numeric' };
    const dateRangeText = `من ${new Date(submittedRange.from).toLocaleDateString('ar-EG', dateOptions)} إلى ${new Date(submittedRange.to).toLocaleDateString('ar-EG', dateOptions)}`;
    const totalSalesAmount = sales.reduce((sum, s) => sum + (s.total || 0), 0);
    const isReceipt = format === 'receipt';

    printHtmlDocument(detailed ? `سجل المبيعات (تفصيلي) ${shortDateRange}` : `سجل المبيعات (ملخص) ${shortDateRange}`, `
      <div class="meta-grid">
        <div class="meta-box"><strong>عدد الفواتير</strong><span>${sales.length}</span></div>
        <div class="meta-box"><strong>إجمالي المبيعات</strong><span>${formatCurrency(totalSalesAmount)}</span></div>
      </div>
      <table>
        <thead>
          <tr>
            <th>الفاتورة</th>
            <th>العميل</th>
            <th style="text-align: center;">الدفع</th>
            <th style="text-align: left;">الإجمالي</th>
            ${!isReceipt ? '<th style="text-align: center;">الحالة</th><th>التاريخ</th>' : ''}
          </tr>
        </thead>
        <tbody>${sales.map((sale) => {
          let rowHtml = `<tr>
            <td><strong>${escapeHtml(sale.docNo || sale.id)}</strong></td>
            <td>${escapeHtml(sale.customerName || 'عميل نقدي')}</td>
            <td style="text-align: center;">${escapeHtml(getSalePaymentLabel(sale))}</td>
            <td style="text-align: left;"><strong>${formatCurrency(sale.total || 0)}</strong></td>
            ${!isReceipt ? `<td style="text-align: center;">${escapeHtml(sale.status || '')}</td><td>${escapeHtml(sale.date || '')}</td>` : ''}
          </tr>`;

          if (detailed && sale.items && sale.items.length > 0) {
             const itemsDetails = sale.items.map(item => `
               <span style="display: inline-block; padding: 1px 4px; margin: 1px;">
                 ${escapeHtml(item.name || (item as any).productName)} <strong>(${item.qty})</strong> = ${formatCurrency(((item as any).price || 0) * (item.qty || 1))}
               </span>
             `).join(' • ');
             rowHtml += `<tr><td colspan="${isReceipt ? 4 : 6}" style="padding: 4px 6px; background: rgba(240, 240, 240, 0.5); font-size: 0.9em;">
               <strong>بنود الفاتورة:</strong> ${itemsDetails}
             </td></tr>`;
          }
          return rowHtml;
        }).join('')}</tbody>
      </table>
      <div class="totals">
        <div><span>إجمالي المبيعات (${sales.length} فاتورة):</span><strong>${formatCurrency(totalSalesAmount)}</strong></div>
      </div>
    `, { 
      subtitle: detailed ? 'سجل تفصيلي للفواتير شاملاً بيانات الأصناف المباعة' : 'سجل ملخص لعمليات البيع', 
      headerDetailsHtml: `<strong>النطاق:</strong> ${escapeHtml(dateRangeText)}`,
      pageSize: isReceipt ? 'receipt' : 'A4', 
      layout: isReceipt ? 'standard' : 'centered',
      footerHtml: `<div>${escapeHtml(dateRangeText)}</div>` 
    });
  };

  const printPurchasesRegisterReport = async (detailed: boolean = false, format: 'A4' | 'receipt' = 'A4') => {
    const { purchasesApi } = await import('@/features/purchases/api/purchases.api');
    const allPurchases = await purchasesApi.listAll();
    
    const purchases = allPurchases.rows.filter(p => {
      if (!p.date) return false;
      const pTime = new Date(p.date).getTime();
      const fromTime = new Date(submittedRange.from).getTime();
      const toTime = new Date(submittedRange.to).getTime();
      return pTime >= fromTime && pTime <= toTime;
    });

    if (!purchases.length) {
      alert('لا توجد مشتريات في هذه الفترة المحددة.');
      return;
    }

    const dateOptions: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'numeric', day: 'numeric' };
    const dateRangeText = `من ${new Date(submittedRange.from).toLocaleDateString('ar-EG', dateOptions)} إلى ${new Date(submittedRange.to).toLocaleDateString('ar-EG', dateOptions)}`;
    const totalPurchasesAmount = purchases.reduce((sum, p) => sum + (p.total || 0), 0);
    const isReceipt = format === 'receipt';

    printHtmlDocument(detailed ? `سجل المشتريات (تفصيلي) ${shortDateRange}` : `سجل المشتريات (ملخص) ${shortDateRange}`, `
      <div class="meta-grid">
        <div class="meta-box"><strong>عدد الفواتير</strong><span>${purchases.length}</span></div>
        <div class="meta-box"><strong>إجمالي المشتريات</strong><span>${formatCurrency(totalPurchasesAmount)}</span></div>
      </div>
      <table>
        <thead>
          <tr>
            <th>الفاتورة</th>
            <th>المورد</th>
            <th style="text-align: center;">الدفع</th>
            <th style="text-align: left;">الإجمالي</th>
            ${!isReceipt ? '<th style="text-align: center;">الحالة</th><th>التاريخ</th>' : ''}
          </tr>
        </thead>
        <tbody>${purchases.map((purchase) => {
          let rowHtml = `<tr>
            <td><strong>${escapeHtml(purchase.docNo || purchase.id)}</strong></td>
            <td>${escapeHtml(purchase.supplierName || '—')}</td>
            <td style="text-align: center;">${escapeHtml(purchase.paymentType || '')}</td>
            <td style="text-align: left;"><strong>${formatCurrency(purchase.total || 0)}</strong></td>
            ${!isReceipt ? `<td style="text-align: center;">${escapeHtml(purchase.status || '')}</td><td>${escapeHtml(purchase.date || '')}</td>` : ''}
          </tr>`;

          if (detailed && purchase.items && purchase.items.length > 0) {
             const itemsDetails = purchase.items.map(item => `
               <span style="display: inline-block; padding: 1px 4px; margin: 1px;">
                 ${escapeHtml(item.name || (item as any).productName)} <strong>(${item.qty})</strong> = ${formatCurrency(((item as any).price || 0) * (item.qty || 1))}
               </span>
             `).join(' • ');
             rowHtml += `<tr><td colspan="${isReceipt ? 4 : 6}" style="padding: 4px 6px; background: rgba(240, 240, 240, 0.5); font-size: 0.9em;">
               <strong>بنود الفاتورة:</strong> ${itemsDetails}
             </td></tr>`;
          }
          return rowHtml;
        }).join('')}</tbody>
      </table>
      <div class="totals">
        <div><span>إجمالي المشتريات (${purchases.length} فاتورة):</span><strong>${formatCurrency(totalPurchasesAmount)}</strong></div>
      </div>
    `, { 
      subtitle: detailed ? 'سجل تفصيلي لفواتير الشراء شاملاً بيانات الأصناف' : 'سجل ملخص لعمليات الشراء', 
      headerDetailsHtml: `<strong>النطاق:</strong> ${escapeHtml(dateRangeText)}`,
      pageSize: isReceipt ? 'receipt' : 'A4', 
      layout: isReceipt ? 'standard' : 'centered',
      footerHtml: `<div>${escapeHtml(dateRangeText)}</div>` 
    });
  };

  const printCustomerBalances = async (format: 'A4' | 'receipt' = 'A4') => {
    const rows = await reportsApi.listAllCustomerBalances({ search: balancesSearch, filter: balancesFilter });
    if (!rows.length) return;
    const isReceipt = format === 'receipt';
    const totalDebt = rows.reduce((s, c) => s + (c.balance || 0), 0);
    printHtmlDocument(`العملاء الأعلى رصيدًا ${todayDate}`, `
      <div class="meta-grid">
        <div class="meta-box"><strong>عدد العملاء</strong><span>${rows.length}</span></div>
        <div class="meta-box"><strong>إجمالي الأرصدة</strong><span>${formatCurrency(totalDebt)}</span></div>
      </div>
      <table>
        <thead><tr><th>العميل</th><th>الهاتف</th><th style="text-align: left;">الرصيد</th>${!isReceipt ? '<th>حد الائتمان</th>' : ''}</tr></thead>
        <tbody>${rows.map((customer: Customer) => `<tr><td>${escapeHtml(customer.name)}</td><td>${escapeHtml(customer.phone || '—')}</td><td style="text-align: left;"><strong>${formatCurrency(customer.balance || 0)}</strong></td>${!isReceipt ? `<td>${formatCurrency(customer.creditLimit || 0)}</td>` : ''}</tr>`).join('')}</tbody>
      </table>
      <div class="totals">
        <div><span>إجمالي المديونيات المستحقة:</span><strong>${formatCurrency(totalDebt)}</strong></div>
      </div>
    `, { subtitle: 'ذمم العملاء الأعلى ضمن النطاق الحالي', pageSize: isReceipt ? 'receipt' : 'A4' });
  };

  const copyExecutiveSummary = async () => {
    if (!report || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    const lines = [
      `الفترة: ${submittedRange.from} → ${submittedRange.to}`,
      `الأيام المغطاة: ${rangeDays}`,
      ...executiveRows.map(([metric, value]: [string, number]) => `${metric}: ${metric === 'هامش الربح %' ? formatPercent(Number(value || 0)) : formatCurrency(Number(value || 0))}`),
    ];
    await navigator.clipboard.writeText(lines.join('\n'));
  };

  return {
    exportExecutiveSummary,
    printExecutiveSummary,
    copyExecutiveSummary,
    exportTopProducts,
    printTopProducts,
    exportLowStock,
    exportCustomerBalances,
    printCustomerBalances,
    printInventoryValueReport,
    printInventoryMovementsReport,
    printSalesRegisterReport,
    printPurchasesRegisterReport,
  };
}
