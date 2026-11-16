import { escapeHtml, printHtmlDocument } from '@/lib/browser';
import { formatCurrency, formatDate } from '@/lib/format';
import { printSmallReceiptDocument } from '@/lib/small-receipt-printer';
import type { SupplierStatementRow } from '@/features/suppliers/api/supplier-statement.utils';
import type { AppSettings, Supplier } from '@/types/domain';

export interface SupplierStatementSummaryTotals {
  openingBalance: number;
  totalCredits: number;
  totalDebits: number;
  closingBalance: number;
  totalAdvances: number;
  openAdvanceBalance: number;
  liveSupplierBalance: number;
}

export interface SupplierStatementPrintPayload {
  supplier: Supplier;
  rows: SupplierStatementRow[];
  summary: SupplierStatementSummaryTotals;
  periodLabel: string;
  searchQuery?: string;
  settings?: Partial<AppSettings> | null;
}

export interface EffectiveSupplierPosition {
  netBalance: number;
  absAmount: number;
  label: string;
  color: string;
  bg: string;
  border: string;
}

export function resolveEffectiveSupplierPosition(
  closingBalance: number,
  openAdvanceBalance = 0,
): EffectiveSupplierPosition {
  const netBalance = Number(closingBalance || 0) - Math.max(0, Number(openAdvanceBalance || 0));
  if (netBalance > 0.0001) {
    return {
      netBalance,
      absAmount: netBalance,
      label: 'مستحق للمورد',
      color: '#b45309',
      bg: '#fffbeb',
      border: '#fde68a',
    };
  }
  if (netBalance < -0.0001) {
    return {
      netBalance,
      absAmount: Math.abs(netBalance),
      label: openAdvanceBalance > 0 && Math.abs(closingBalance) <= 0.0001
        ? 'لك عند المورد (دفعة مقدمة)'
        : 'لك عند المورد (رصيد فائض)',
      color: '#0369a1',
      bg: '#f0f9ff',
      border: '#bae6fd',
    };
  }
  return {
    netBalance: 0,
    absAmount: 0,
    label: 'الحساب متزن',
    color: '#15803d',
    bg: '#f0fdf4',
    border: '#bbf7d0',
  };
}

function buildSupplierTypeLabel(supplier: Supplier): string {
  return supplier.supplierType === 'freelancer' ? 'فري لانس / مستقل' : 'مورد بضاعة وخدمات';
}

function sanitizePdfFilename(name: string): string {
  const cleaned = String(name || 'supplier')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-');
  return `supplier-statement-${cleaned || 'report'}.pdf`;
}

export function buildSupplierStatementA4Body(payload: SupplierStatementPrintPayload): string {
  const { supplier, rows, summary, periodLabel, searchQuery, settings } = payload;
  const storeTitle = String(settings?.storeName || settings?.brandName || 'Z-Systems ERP').trim();
  const storePhone = String(settings?.phone || '').trim();
  const storeAddress = String(settings?.address || '').trim();
  const logoData = String(settings?.logoData || '').trim();
  const position = resolveEffectiveSupplierPosition(summary.closingBalance, summary.openAdvanceBalance);
  const printedAt = formatDate(new Date());

  const rowsHtml = rows.length
    ? rows.map((row, index) => `
      <tr>
        <td style="text-align: center; color: #64748b;">${index + 1}</td>
        <td class="stmt-date-cell">${escapeHtml(formatDate(row.date))}</td>
        <td><span class="stmt-type-pill">${escapeHtml(row.typeLabel)}</span></td>
        <td class="stmt-note-cell">${escapeHtml(row.note || '—')}</td>
        <td class="num-cell" style="color: ${row.debitShown > 0 ? '#0f766e' : '#94a3b8'}; font-weight: ${row.debitShown > 0 ? '700' : '500'};">${row.debitShown > 0 ? escapeHtml(formatCurrency(row.debitShown)) : '—'}</td>
        <td class="num-cell" style="color: ${row.creditShown > 0 ? '#170e5e' : '#94a3b8'}; font-weight: ${row.creditShown > 0 ? '700' : '500'};">${row.creditShown > 0 ? escapeHtml(formatCurrency(row.creditShown)) : '—'}</td>
        <td class="num-cell" style="font-weight: 800; color: ${row.balance > 0.0001 ? '#b45309' : row.balance < -0.0001 ? '#0369a1' : '#15803d'};">${escapeHtml(formatCurrency(row.balance))}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="7" style="text-align: center; padding: 24px; color: #64748b;">لا توجد حركات مسجلة ضمن هذه الفترة.</td></tr>`;

  return `
    <div class="stmt-a4-doc" dir="rtl">
      <div class="stmt-header">
        <div class="stmt-brand">
          ${logoData ? `<img src="${escapeHtml(logoData)}" alt="" class="stmt-logo" />` : ''}
          <div>
            <div class="stmt-store-name">${escapeHtml(storeTitle)}</div>
            <div class="stmt-store-meta">
              ${storePhone ? `<span>هاتف: ${escapeHtml(storePhone)}</span>` : ''}
              ${storePhone && storeAddress ? ' · ' : ''}
              ${storeAddress ? `<span>${escapeHtml(storeAddress)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="stmt-doc-title-box">
          <div class="stmt-doc-badge">كشف حساب مورد</div>
          <div class="stmt-doc-date">تاريخ الإصدار: ${escapeHtml(printedAt)}</div>
        </div>
      </div>

      <div class="stmt-supplier-card">
        <div class="stmt-supplier-grid">
          <div><span class="stmt-lbl">اسم المورد</span><strong>${escapeHtml(supplier.name)}</strong></div>
          <div><span class="stmt-lbl">رقم الهاتف</span><strong>${escapeHtml(supplier.phone || '—')}</strong></div>
          <div><span class="stmt-lbl">تصنيف المورد</span><strong>${escapeHtml(buildSupplierTypeLabel(supplier))}</strong></div>
          <div><span class="stmt-lbl">الفترة الزمنية</span><strong>${escapeHtml(periodLabel)}</strong></div>
          <div><span class="stmt-lbl">مديونية الفواتير (ذمم)</span><strong>${escapeHtml(formatCurrency(summary.liveSupplierBalance))}</strong></div>
          <div><span class="stmt-lbl">صافي الموقف النهائي</span><strong style="color: ${position.color};">${escapeHtml(position.label)}: ${escapeHtml(formatCurrency(position.absAmount))}</strong></div>
        </div>
        ${searchQuery ? `<div class="stmt-filter-note">تصفية البحث النشطة: "${escapeHtml(searchQuery)}" (إجماليات الفترة الكاملة معروضة أدناه)</div>` : ''}
      </div>

      <div class="stmt-kpi-grid">
        <div class="stmt-kpi">
          <span>ما قبل الفترة</span>
          <strong>${escapeHtml(formatCurrency(summary.openingBalance))}</strong>
        </div>
        <div class="stmt-kpi">
          <span>إجمالي المورّد (دائن)</span>
          <strong style="color: #170e5e;">${escapeHtml(formatCurrency(summary.totalCredits))}</strong>
        </div>
        <div class="stmt-kpi">
          <span>إجمالي المسدد (مدين)</span>
          <strong style="color: #0f766e;">${escapeHtml(formatCurrency(summary.totalDebits))}</strong>
        </div>
        <div class="stmt-kpi">
          <span>دفعات مقدمة مفتوحة (لك)</span>
          <strong style="color: #0369a1;">${escapeHtml(formatCurrency(summary.openAdvanceBalance))}</strong>
        </div>
        <div class="stmt-kpi" style="background: ${position.bg}; border-color: ${position.border};">
          <span>${escapeHtml(position.label)}</span>
          <strong style="color: ${position.color};">${escapeHtml(formatCurrency(position.absAmount))}</strong>
        </div>
      </div>

      ${summary.totalAdvances > 0 ? `
        <div class="stmt-advances-note">
          تشمل حركات الفترة دفعات مقدمة / سحبات بإجمالي: <strong>${escapeHtml(formatCurrency(summary.totalAdvances))}</strong>، والرصيد المفتوح غير المسوّى منها حالياً: <strong>${escapeHtml(formatCurrency(summary.openAdvanceBalance))}</strong> (يُخصم تلقائياً من الفواتير القادمة).
        </div>
      ` : ''}

      <table class="stmt-table">
        <colgroup>
          <col style="width: 5%;" />
          <col style="width: 17%;" />
          <col style="width: 17%;" />
          <col style="width: 25%;" />
          <col style="width: 12%;" />
          <col style="width: 12%;" />
          <col style="width: 12%;" />
        </colgroup>
        <thead>
          <tr>
            <th style="text-align: center;">#</th>
            <th>التاريخ والوقت</th>
            <th>نوع الحركة</th>
            <th>المرجع / الملاحظة</th>
            <th>مدين (مسدد)</th>
            <th>دائن (مورَّد)</th>
            <th>رصيد الفواتير</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>
          <tr>
            <td colspan="4" style="text-align: left; font-weight: 800;">إجمالي الحركات المعروضة (${rows.length})</td>
            <td class="num-cell" style="font-weight: 800; color: #0f766e;">${escapeHtml(formatCurrency(summary.totalDebits))}</td>
            <td class="num-cell" style="font-weight: 800; color: #170e5e;">${escapeHtml(formatCurrency(summary.totalCredits))}</td>
            <td class="num-cell" style="font-weight: 800; color: ${position.color};">${escapeHtml(formatCurrency(summary.closingBalance))}</td>
          </tr>
        </tfoot>
      </table>

      ${settings?.invoiceFooter ? `<div class="stmt-footer-note">${escapeHtml(settings.invoiceFooter)}</div>` : ''}
    </div>
  `;
}

export const SUPPLIER_STATEMENT_A4_CSS = `
  .stmt-a4-doc { color: #0f172a; font-family: 'Cairo', 'Tajawal', sans-serif; font-size: 11.5px; width: 100%; box-sizing: border-box; }
  .stmt-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #170e5e; padding-bottom: 10px; margin-bottom: 10px; }
  .stmt-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .stmt-logo { width: 44px; height: 44px; object-fit: contain; border-radius: 8px; border: 1px solid #e2e8f0; padding: 3px; background: #fff; flex-shrink: 0; }
  .stmt-store-name { font-size: 16px; font-weight: 800; color: #170e5e; }
  .stmt-store-meta { font-size: 10.5px; color: #64748b; margin-top: 2px; }
  .stmt-doc-title-box { text-align: left; flex-shrink: 0; }
  .stmt-doc-badge { display: inline-block; background: #170e5e; color: #fff; padding: 4px 12px; border-radius: 6px; font-weight: 800; font-size: 12.5px; }
  .stmt-doc-date { font-size: 10px; color: #64748b; margin-top: 5px; }
  .stmt-supplier-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; box-sizing: border-box; }
  .stmt-supplier-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 12px; }
  .stmt-lbl { display: block; font-size: 10px; color: #64748b; margin-bottom: 2px; }
  .stmt-supplier-grid strong { font-size: 12px; color: #0f172a; word-break: break-word; }
  .stmt-filter-note { margin-top: 8px; padding-top: 6px; border-top: 1px dashed #cbd5e1; font-size: 10.5px; color: #475569; }
  .stmt-kpi-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; margin-bottom: 10px; }
  .stmt-kpi { border: 1px solid #e2e8f0; border-radius: 8px; padding: 7px 8px; background: #fff; min-width: 0; box-sizing: border-box; }
  .stmt-kpi span { display: block; font-size: 9.5px; color: #64748b; margin-bottom: 2px; line-height: 1.3; }
  .stmt-kpi strong { font-size: 12.5px; font-weight: 800; color: #0f172a; font-variant-numeric: tabular-nums; display: block; }
  .stmt-advances-note { background: #f0f9ff; border: 1px solid #bae6fd; color: #0c4a6e; border-radius: 6px; padding: 7px 10px; font-size: 10.5px; margin-bottom: 10px; line-height: 1.45; }
  .stmt-table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 10.5px; box-sizing: border-box; }
  .stmt-table th { background: #f1f5f9; color: #1e293b; font-weight: 800; border: 1px solid #cbd5e1; padding: 6px 5px; text-align: right; line-height: 1.3; word-break: break-word; }
  .stmt-table td { border: 1px solid #e2e8f0; padding: 6px 5px; vertical-align: middle; line-height: 1.35; overflow-wrap: anywhere; }
  .stmt-table tfoot td { background: #f8fafc; border-top: 2px solid #94a3b8; padding: 7px 5px; }
  .stmt-type-pill { display: inline-block; padding: 2px 6px; border-radius: 999px; background: #f1f5f9; color: #1e293b; font-weight: 700; font-size: 9.5px; line-height: 1.3; }
  .stmt-date-cell { font-size: 10px; direction: ltr; text-align: right; }
  .stmt-note-cell { word-break: break-word; }
  .num-cell { text-align: left; direction: ltr; font-variant-numeric: tabular-nums; word-break: normal; }
  .stmt-footer-note { margin-top: 12px; padding-top: 8px; border-top: 1px dashed #cbd5e1; text-align: center; font-size: 10.5px; color: #64748b; }
`;

export function printSupplierStatementA4(payload: SupplierStatementPrintPayload): void {
  const html = buildSupplierStatementA4Body(payload);
  printHtmlDocument(`كشف حساب مورد - ${payload.supplier.name}`, html, {
    pageSize: 'A4',
    orientation: 'portrait',
    extraStyles: SUPPLIER_STATEMENT_A4_CSS,
  });
}

async function waitForImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map((image) => {
    if (image.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => resolve(), { once: true });
    });
  }));
}

export async function exportSupplierStatementPdf(payload: SupplierStatementPrintPayload): Promise<string> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const wrapper = document.createElement('div');
  wrapper.setAttribute('dir', 'rtl');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-99999px';
  wrapper.style.top = '0';
  wrapper.style.width = '820px';
  wrapper.style.background = '#ffffff';
  wrapper.style.padding = '22px';
  wrapper.style.boxSizing = 'border-box';
  wrapper.style.overflow = 'visible';
  wrapper.innerHTML = `<style>${SUPPLIER_STATEMENT_A4_CSS}</style>${buildSupplierStatementA4Body(payload)}`;
  document.body.appendChild(wrapper);

  try {
    await waitForImages(wrapper);
    const renderWidth = Math.max(820, wrapper.scrollWidth || 820);
    const canvas = await html2canvas(wrapper, {
      scale: 2,
      width: renderWidth,
      windowWidth: renderWidth,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    });

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const pageWidthMm = 210;
    const pageHeightMm = 297;
    const marginMm = 8;
    const usableWidthMm = pageWidthMm - (marginMm * 2);
    const usableHeightMm = pageHeightMm - (marginMm * 2);
    const pxPerMm = canvas.width / usableWidthMm;
    const pageHeightPx = Math.max(1, Math.floor(usableHeightMm * pxPerMm));

    let offsetY = 0;
    let pageIndex = 0;
    while (offsetY < canvas.height) {
      const sliceHeight = Math.min(pageHeightPx, canvas.height - offsetY);
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeight;
      const ctx = pageCanvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(canvas, 0, offsetY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
      }
      const sliceHeightMm = sliceHeight / pxPerMm;
      if (pageIndex > 0) pdf.addPage();
      pdf.addImage(pageCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', marginMm, marginMm, usableWidthMm, sliceHeightMm, undefined, 'FAST');
      offsetY += sliceHeight;
      pageIndex += 1;
    }

    const fileName = sanitizePdfFilename(payload.supplier.name);
    pdf.save(fileName);
    return fileName;
  } finally {
    wrapper.remove();
  }
}

export function buildSupplierStatementReceiptHtml(payload: SupplierStatementPrintPayload): string {
  const { supplier, rows, summary, periodLabel, settings } = payload;
  const storeTitle = String(settings?.storeName || settings?.brandName || 'Z-Systems').trim();
  const storePhone = String(settings?.phone || '').trim();
  const position = resolveEffectiveSupplierPosition(summary.closingBalance, summary.openAdvanceBalance);
  const printedAt = formatDate(new Date());

  const movementsHtml = rows.length
    ? rows.map((row) => {
      const movementAmount = row.creditShown > 0
        ? `${formatCurrency(row.creditShown)} دائن`
        : row.debitShown > 0
          ? `${formatCurrency(row.debitShown)} مدين`
          : formatCurrency(0);
      return `
        <div class="rcpt-row">
          <div class="rcpt-row-top">
            <span class="rcpt-type">${escapeHtml(row.typeLabel)}</span>
            <strong class="rcpt-amt">${escapeHtml(movementAmount)}</strong>
          </div>
          <div class="rcpt-row-meta">
            <span style="direction:ltr;">${escapeHtml(formatDate(row.date))}</span>
            <span>رصيد الفواتير: ${escapeHtml(formatCurrency(row.balance))}</span>
          </div>
          ${row.note ? `<div class="rcpt-note">${escapeHtml(row.note)}</div>` : ''}
        </div>
      `;
    }).join('')
    : '<div style="text-align:center; padding:8px 0; color:#475569;">لا توجد حركات في هذه الفترة</div>';

  return `
    <style>
      .rcpt-doc { font-family: 'Cairo', 'Tajawal', sans-serif; direction: rtl; color: #000; }
      .rcpt-head { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 6px; margin-bottom: 6px; }
      .rcpt-store { font-size: 14px; font-weight: 900; }
      .rcpt-title { font-size: 12px; font-weight: 800; margin-top: 2px; }
      .rcpt-meta { font-size: 10px; line-height: 1.45; border-bottom: 1px dashed #000; padding-bottom: 5px; margin-bottom: 5px; }
      .rcpt-meta-row { display: flex; justify-content: space-between; gap: 6px; }
      .rcpt-summary { border: 1px solid #000; padding: 5px; margin-bottom: 6px; font-size: 10.5px; }
      .rcpt-sum-line { display: flex; justify-content: space-between; gap: 4px; margin-bottom: 2px; }
      .rcpt-sum-line.total { border-top: 1px solid #000; padding-top: 3px; margin-top: 3px; font-size: 11px; font-weight: 900; }
      .rcpt-list-title { font-size: 10.5px; font-weight: 800; border-bottom: 1px solid #000; padding-bottom: 2px; margin-bottom: 4px; }
      .rcpt-row { border-bottom: 1px dotted #666; padding: 4px 0; font-size: 10px; }
      .rcpt-row-top { display: flex; justify-content: space-between; gap: 4px; align-items: baseline; }
      .rcpt-type { font-weight: 800; }
      .rcpt-amt { font-variant-numeric: tabular-nums; }
      .rcpt-row-meta { display: flex; justify-content: space-between; gap: 4px; color: #333; font-size: 9.5px; margin-top: 1px; }
      .rcpt-note { font-size: 9.5px; color: #333; margin-top: 1px; word-break: break-word; }
      .rcpt-foot { text-align: center; border-top: 1px dashed #000; margin-top: 7px; padding-top: 5px; font-size: 9.5px; }
    </style>
    <div class="rcpt-doc">
      <div class="rcpt-head">
        <div class="rcpt-store">${escapeHtml(storeTitle)}</div>
        ${storePhone ? `<div style="font-size:10px;">${escapeHtml(storePhone)}</div>` : ''}
        <div class="rcpt-title">كشف حساب مورد (مختصر)</div>
      </div>
      <div class="rcpt-meta">
        <div class="rcpt-meta-row"><span>المورد:</span><strong>${escapeHtml(supplier.name)}</strong></div>
        ${supplier.phone ? `<div class="rcpt-meta-row"><span>الهاتف:</span><span>${escapeHtml(supplier.phone)}</span></div>` : ''}
        <div class="rcpt-meta-row"><span>الفترة:</span><span>${escapeHtml(periodLabel)}</span></div>
        <div class="rcpt-meta-row"><span>التاريخ:</span><span style="direction:ltr;">${escapeHtml(printedAt)}</span></div>
      </div>
      <div class="rcpt-summary">
        <div class="rcpt-sum-line"><span>ما قبل الفترة:</span><span>${escapeHtml(formatCurrency(summary.openingBalance))}</span></div>
        <div class="rcpt-sum-line"><span>إجمالي المورّد (دائن):</span><span>${escapeHtml(formatCurrency(summary.totalCredits))}</span></div>
        <div class="rcpt-sum-line"><span>إجمالي المسدد (مدين):</span><span>${escapeHtml(formatCurrency(summary.totalDebits))}</span></div>
        <div class="rcpt-sum-line"><span>رصيد الفواتير (ذمم):</span><span>${escapeHtml(formatCurrency(summary.closingBalance))}</span></div>
        ${summary.openAdvanceBalance > 0 ? `<div class="rcpt-sum-line"><span>دفعات مقدمة مفتوحة (لك):</span><strong>${escapeHtml(formatCurrency(summary.openAdvanceBalance))}</strong></div>` : ''}
        <div class="rcpt-sum-line total"><span>${escapeHtml(position.label)}:</span><span>${escapeHtml(formatCurrency(position.absAmount))}</span></div>
      </div>
      <div class="rcpt-list-title">تفاصيل الحركات (${rows.length})</div>
      ${movementsHtml}
      <div class="rcpt-foot">
        ${settings?.invoiceFooter ? `<div>${escapeHtml(settings.invoiceFooter)}</div>` : '<div>نهاية كشف الحساب</div>'}
      </div>
    </div>
  `;
}

export function printSupplierStatementReceipt(payload: SupplierStatementPrintPayload): void {
  const receiptWidthMm = payload.settings?.receiptWidthMm === 58 ? 58 : 80;
  const html = buildSupplierStatementReceiptHtml(payload);
  printSmallReceiptDocument(html, {
    title: `ريسيت كشف حساب - ${payload.supplier.name}`,
    widthMm: receiptWidthMm,
    fontSizePx: receiptWidthMm === 58 ? 9.5 : 10.5,
  });
}
