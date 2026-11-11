/* eslint-disable max-lines */
import { queryKeys } from '@/app/query-keys';
import { queryClient } from '@/app/providers';
import { DEFAULT_STORE_NAME, useAuthStore } from '@/stores/auth-store';
import type { AppSettings } from '@/types/domain';

export function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadJsonFile(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  triggerDownload(blob, filename);
}



export async function downloadExcelFile(filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  const XLSX = await import('xlsx');
  const worksheetData = [headers, ...rows];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
  
  // Set '@' text format on text cells (and barcode/id columns) so Excel does not convert them to scientific notation
  for (const cellKey of Object.keys(worksheet)) {
    if (cellKey.startsWith('!')) continue;
    const cell = worksheet[cellKey];
    if (cell && (cell.t === 's' || (cell.t === 'n' && typeof cell.v === 'number' && Math.abs(cell.v) >= 1e9 && Math.floor(cell.v) === cell.v))) {
      cell.z = '@';
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
  
  // Set sheet direction to RTL (Right-to-Left) for Arabic
  worksheet['!views'] = [{ rightToLeft: true, RTL: true } as any];
  workbook.Workbook = {
    Views: [{ RTL: true } as any],
    Sheets: [{ name: 'Data', RTL: true } as any],
  } as any;

  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  triggerDownload(blob, filename);
}

export async function parseImportFile(file: File): Promise<Record<string, string>[]> {
  const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
  if (isExcel) {
    const XLSX = await import('xlsx');
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [];
    const worksheet = workbook.Sheets[firstSheetName];

    // Protect numeric identifiers (e.g. barcodes, national IDs, phone numbers) from being
    // degraded into scientific/exponential notation (e.g. "6.22401E+12").
    for (const cellKey of Object.keys(worksheet)) {
      if (cellKey.startsWith('!')) continue;
      const cell = worksheet[cellKey];
      if (!cell || cell.t !== 'n' || typeof cell.v !== 'number' || !Number.isFinite(cell.v)) continue;
      // If it's an integer and either formatted with exponent (E+...) or a large number (>= 1e9)
      if (Math.floor(cell.v) === cell.v) {
        if ((cell.w && /e[+-]?\d+/i.test(cell.w)) || Math.abs(cell.v) >= 1e9) {
          try {
            cell.w = BigInt(Math.round(cell.v)).toString();
          } catch {
            cell.w = cell.v.toLocaleString('fullwide', { useGrouping: false });
          }
        }
      }
    }

    // Convert to array of objects, keeping headers
    const json = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false, dateNF: 'yyyy-mm-dd hh:mm:ss' }) as Record<string, unknown>[];
    // Normalize to string values for consistency with CSV parser
    return json.map(row => {
      const stringifiedRow: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        let str = String(value ?? '').trim();
        if (/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(str)) {
          const num = Number(str);
          if (Number.isFinite(num) && Math.floor(num) === num) {
            try {
              str = BigInt(Math.round(num)).toString();
            } catch {
              str = num.toLocaleString('fullwide', { useGrouping: false });
            }
          }
        }
        stringifiedRow[key] = str;
      }
      return stringifiedRow;
    });
  }

  // Fallback to CSV parsing
  return parseCsvRows(await file.text());
}

export function parseCsvRows(text: string) {
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const parseLine = (line: string) => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];
      if (char === '"' && inQuotes && next === '"') {
        current += '"';
        i += 1;
        continue;
      }
      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    values.push(current.trim());
    return values;
  };

  const headers = parseLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    return headers.reduce<Record<string, string>>((acc, header, index) => {
      if (header) acc[header] = values[index] ?? '';
      return acc;
    }, {});
  }).filter((row) => Object.values(row).some((value) => String(value || '').trim()));
}

function looksLikeHtmlFragment(value: string) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.startsWith('<!doctype')
    || normalized.startsWith('<html')
    || normalized.startsWith('<body')
    || normalized.startsWith('<style')
    || normalized.startsWith('<section')
    || normalized.startsWith('<div')
    || normalized.startsWith('<table')
    || normalized.startsWith('<h1')
    || normalized.startsWith('<h2')
    || normalized.startsWith('<h3');
}

function normalizeCachedSettings(raw: unknown): Partial<AppSettings> {
  if (!raw || typeof raw !== 'object') return {};
  const candidate = raw as Partial<AppSettings> & { settings?: Partial<AppSettings> };
  if (candidate.settings && typeof candidate.settings === 'object') return candidate.settings;
  return candidate;
}

export function resolvePrintSettings() {
  const cachedSettings = normalizeCachedSettings(queryClient.getQueryData(queryKeys.settings));
  const sessionStoreName = useAuthStore.getState().storeName;
  const resolvedStoreName = String(cachedSettings.storeName || sessionStoreName || DEFAULT_STORE_NAME).trim() || DEFAULT_STORE_NAME;
  return {
    storeName: resolvedStoreName,
    brandName: resolvedStoreName,
    phone: String(cachedSettings.phone || '').trim(),
    address: String(cachedSettings.address || '').trim(),
    invoiceFooter: String(cachedSettings.invoiceFooter || '').trim(),
    logoData: String(cachedSettings.logoData || '').trim(),
    windowsPrinterName: String(cachedSettings.posWindowsPrinterName || '').trim(),
  };
}

function stripLeadingDuplicateHeading(bodyHtml: string, title: string) {
  const normalizedTitle = String(title || '').trim();
  let cleaned = bodyHtml.trim();
  if (normalizedTitle) {
    const escapedTitle = normalizedTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^\\s*<h[12][^>]*>[\\s\\S]*?${escapedTitle}[\\s\\S]*?<\\/h[12]>`, 'i');
    cleaned = cleaned.replace(pattern, '').trim();
  }
  return cleaned;
}

function sanitizePrintText(value: string) {
  return String(value || '')
    .replace(/\bundefined\b/gi, '')
    .replace(/\bnull\b/gi, '')
    .replace(/[\u00A0]/g, ' ')
    .replace(/\s+[·•-]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function buildBrandPanelHtml(branding: ReturnType<typeof resolvePrintSettings>) {
  const identity = branding.brandName || branding.storeName || DEFAULT_STORE_NAME;
  const identityLetter = Array.from(identity)[0] || 'Z';
  const details = [branding.phone, branding.address].filter(Boolean);
  return `
    <section class="brand-panel" aria-label="بيانات النشاط">
      ${branding.logoData
        ? `<img class="brand-logo-image" src="${branding.logoData}" alt="${escapeHtml(identity)}" />`
        : `<div class="brand-logo-fallback">${escapeHtml(identityLetter)}</div>`}
      <div class="brand-copy">
        <div class="brand-name">${escapeHtml(identity)}</div>
        ${details.length ? `<div class="brand-meta">${details.map((item) => `<span>${escapeHtml(item)}</span>`).join('<span class="brand-meta-sep">•</span>')}</div>` : ''}
      </div>
    </section>
  `;
}

export interface PrintDocumentOptions {
  subtitle?: string;
  headerDetailsHtml?: string;
  footerHtml?: string;
  extraStyles?: string;
  pageSize?: 'auto' | 'A4' | 'receipt';
  orientation?: 'portrait' | 'landscape';
  layout?: 'standard' | 'centered';
  printDelayMs?: number;
  autoClose?: boolean;
  documentDirection?: 'rtl' | 'ltr';
  deviceName?: string;
  receiptWidthMm?: 58 | 80;
  hideHeader?: boolean;
}

export function printHtmlDocument(titleOrBody: string, bodyOrTitle: string, options: PrintDocumentOptions = {}) {
  let title = String(titleOrBody || 'مستند للطباعة').trim() || 'مستند للطباعة';
  let bodyHtml = String(bodyOrTitle || '').trim();

  if (looksLikeHtmlFragment(titleOrBody) && !looksLikeHtmlFragment(bodyOrTitle)) {
    title = String(bodyOrTitle || 'مستند للطباعة').trim() || 'مستند للطباعة';
    bodyHtml = String(titleOrBody || '').trim();
  }

  const {
    subtitle = '',
    headerDetailsHtml = '',
    footerHtml = '',
    extraStyles = '',
    pageSize = 'auto',
    orientation = 'portrait',
    layout = 'standard',
    printDelayMs = 260,
    autoClose = false,
    documentDirection = 'rtl',
    deviceName,
    receiptWidthMm = 80,
    hideHeader = false,
  } = options;

  const branding = resolvePrintSettings();
  const safeSubtitle = sanitizePrintText(subtitle);
  const bodyContent = pageSize === 'receipt' ? bodyHtml : stripLeadingDuplicateHeading(bodyHtml, title);
  const bodyHasReceiptHeader = hideHeader || /class=["'][^"']*\b(receipt-header|invoice-card|invoice-store-card|receipt-copy-|receipt-theme-|kitchen-items|kitchen-ticket|cash-drawer-receipt|maintenance-receipt)\b/i.test(bodyContent);
  const bodyHasFooter = /class=["'][^"']*\bprint-footer\b|<footer\b/i.test(bodyContent);
  const effectiveFooter = bodyHasFooter
    ? ''
    : (pageSize === 'receipt' ? sanitizePrintText(footerHtml || branding.invoiceFooter) : sanitizePrintText(footerHtml));
  const printedAt = new Date().toLocaleString('ar-EG');

  const pageRule = pageSize === 'A4'
    ? orientation === 'landscape'
      ? '@page { size: A4 landscape; margin: 8mm; }'
      : '@page { size: A4 portrait; margin: 8mm; }'
    : pageSize === 'receipt'
      ? `@page { size: ${receiptWidthMm === 58 ? 58 : 80}mm auto; margin: 0; }`
      : '@page { size: auto; margin: 8mm; }';

  const html = `<!doctype html>
  <html lang="ar" dir="${documentDirection}">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(title)}</title>
      <style>
        :root {
          --print-text: #0f172a;
          --print-muted: #475569;
          --print-border: #94a3b8;
          --print-surface: #f1f5f9;
          --print-strong: #020617;
          --print-accent: #0284c7;
        }
        /* IE11 fallbacks (the C# bridge renders in IE11 mode): every var(--...) is preceded by its literal value and every display:grid by display:block. IE11 drops the var()/grid line and keeps the fallback; modern browsers use the second line. Do not remove the first line of a pair. */
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #fff; color: #0f172a; color: var(--print-text); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 11.5px; line-height: 1.4; }
        .print-shell { padding: 10px; max-width: 100%; }
        .print-header { display: block; display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 10px; align-items: stretch; margin-bottom: 10px; }
        .print-header.centered-layout { display: block; text-align: center; margin-bottom: 10px; }
        .print-header.centered-layout .doc-panel { min-width: auto; padding: 10px 16px; gap: 4px; }
        .print-header.centered-layout .doc-header-details { margin-top: 2px; padding: 4px 10px; }
        .print-header.centered-layout .doc-meta-chip { margin-top: 2px; }
        .brand-name-centered { font-size: 18px; font-weight: 800; color: #020617; color: var(--print-strong); margin-bottom: 2px; }
        .brand-panel, .doc-panel, .meta-box, .summary-box, .totals, .print-footer {
          border: 1px solid #94a3b8;
          border: 1px solid var(--print-border);
          border-radius: 8px;
          background: rgba(248, 250, 252, 0.85);
        }
        .brand-panel {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 12px;
          padding: 8px 12px;
        }
        .brand-copy { min-width: 0; }
        .brand-name {
          font-size: 15px;
          font-weight: 800;
          color: #020617;
          color: var(--print-strong);
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .brand-meta {
          margin-top: 4px;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 4px 8px;
          color: #475569;
          color: var(--print-muted);
          font-size: 11px;
        }
        .brand-meta-sep { opacity: 0.55; }
        .brand-logo-image, .brand-logo-fallback {
          width: 44px;
          height: 44px;
          border-radius: 8px;
          flex-shrink: 0;
          object-fit: cover;
          border: 1px solid rgba(148, 163, 184, 0.5);
          background: #f1f5f9;
        }
        .brand-logo-fallback {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #0284c7;
          font-size: 18px;
          font-weight: 800;
        }
        .doc-panel {
          padding: 8px 12px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 2px;
        }
        .doc-title { margin: 0; font-size: 16px; line-height: 1.2; font-weight: 800; color: #020617; color: var(--print-strong); }
        .doc-subtitle { color: #475569; color: var(--print-muted); font-size: 11px; }
        .doc-header-details { margin-top: 6px; font-size: 11.5px; color: #020617; color: var(--print-strong); background: #ffffff; padding: 4px 8px; border-radius: 6px; border: 1px solid #94a3b8; border: 1px solid var(--print-border); display: inline-block; }
        .doc-meta-chip { margin-top: 4px; color: #475569; color: var(--print-muted); font-size: 10.5px; }
        .print-content { display: flex; flex-direction: column; gap: 8px; }
        .meta { margin: 0; color: #475569; color: var(--print-muted); font-size: 11px; }
        .section { margin: 0; break-inside: avoid; }
        h1, h2, h3 { margin: 0 0 6px; color: #020617; color: var(--print-strong); }
        h2 { font-size: 13.5px; }
        h3 { font-size: 12.5px; }
        p { margin: 0 0 6px; }
        .meta-grid, .summary-grid {
          display: block; display: grid;
          grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
          gap: 8px;
        }
        .meta-box, .summary-box { padding: 8px 10px; }
        .meta-box strong, .summary-box strong {
          display: block;
          margin-bottom: 4px;
          color: #475569;
          color: var(--print-muted);
          font-size: 11px;
          font-weight: 700;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          table-layout: auto;
          font-size: 11px;
          margin-top: 2px;
        }
        th, td {
          border: 1px solid #94a3b8;
          border: 1px solid var(--print-border);
          padding: 5px 7px;
          text-align: right;
          vertical-align: middle;
          word-break: normal;
          line-height: 1.35;
        }
        th {
          background: #f1f5f9;
          background: var(--print-surface);
          color: #0f172a;
          font-weight: 700;
        }
        tbody tr:nth-child(even) { background: rgba(248, 250, 252, 0.65); }
        .totals {
          margin-top: 2px;
          padding: 7px 9px;
        }
        .totals div {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 4px;
        }
        .totals strong { color: #020617; color: var(--print-strong); }
        .muted { color: #475569; color: var(--print-muted); }
        .text-left { text-align: left; }
        .print-footer {
          margin-top: 6px;
          padding: 6px 8px;
          color: #111;
          font-size: 11px;
        }
        body.receipt-mode {
          font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
          font-size: 11px;
          line-height: 1.25;
          color: #000;
          background: #fff;
          width: 100%;
          max-width: ${receiptWidthMm === 58 ? 58 : 80}mm;
          margin: 0 auto;
        }
        body.receipt-mode .print-shell {
          padding: 2px 2mm 4px;
          width: 100%;
          max-width: ${receiptWidthMm === 58 ? 58 : 80}mm;
          margin: 0 auto;
          box-sizing: border-box;
        }
        body.receipt-mode .receipt-header {
          text-align: center;
          margin-bottom: 6px;
          padding-bottom: 6px;
          border-bottom: 1.5px dashed #000;
        }
        body.receipt-mode table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
          margin: 4px 0;
          table-layout: auto;
        }
        body.receipt-mode th, body.receipt-mode td {
          border: none;
          border-bottom: 1px dashed #666;
          padding: 3px 2px;
          text-align: right;
          font-size: 11px;
          line-height: 1.2;
        }
        body.receipt-mode th {
          border-bottom: 1.5px solid #000;
          font-weight: 800;
          color: #000;
          background: transparent;
        }
        body.receipt-mode tbody tr:nth-child(even) {
          background: transparent;
        }
        body.receipt-mode .meta-grid, body.receipt-mode .summary-grid {
          display: block; display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 3px;
          margin-bottom: 4px;
        }
        body.receipt-mode .meta-box, body.receipt-mode .summary-box {
          border: 1px dashed #888;
          border-radius: 4px;
          padding: 3px 5px;
          background: transparent;
        }
        body.receipt-mode .meta-box strong, body.receipt-mode .summary-box strong {
          display: block;
          font-size: 9.5px;
          color: #333;
          margin-bottom: 1px;
        }
        body.receipt-mode .meta-box span, body.receipt-mode .summary-box span {
          font-size: 11px;
          font-weight: 800;
          color: #000;
        }
        body.receipt-mode .totals {
          border: none;
          border-top: 1.5px solid #000;
          border-bottom: 1.5px solid #000;
          padding: 4px 0;
          margin-top: 6px;
          border-radius: 0;
          background: transparent;
        }
        body.receipt-mode .totals div {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          margin-bottom: 2px;
        }
        body.receipt-mode .print-footer {
          text-align: center;
          border: none;
          border-top: 1px dashed #000;
          padding-top: 4px;
          font-size: 9.5px;
          color: #444;
          margin-top: 6px;
          border-radius: 0;
          background: transparent;
        }
        body.report-mode .print-shell { max-width: 100%; }
        body.report-mode .print-content > *:first-child { margin-top: 0 !important; }
        body.report-mode .print-content > * { min-height: auto !important; }
        body.report-mode .print-content .totals,
        body.report-mode .print-content .summary-box,
        body.report-mode .print-content .meta-box { break-inside: avoid; }
        @media print {
          html, body { height: auto; }
          html, body { margin: 0 !important; padding: 0 !important; }
          .print-shell { padding: 0; }
          body.receipt-mode .print-shell { padding: 0 1mm !important; width: 100% !important; max-width: 100% !important; margin: 0 !important; box-sizing: border-box !important; }
          a { color: inherit; text-decoration: none; }
          .section, .meta-box, .summary-box, .totals, .print-header { break-inside: avoid; }
          table { break-inside: auto; }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
          tr, td, th { break-inside: avoid-page; }
        }
        ${pageRule}
        ${extraStyles}
      </style>
    </head>
    <body class="${pageSize === 'receipt' ? 'receipt-mode' : 'report-mode'}">
      <div class="print-shell">
        ${pageSize === 'receipt' ? (
          bodyHasReceiptHeader ? '' : `
          <div class="receipt-header">
            <div style="font-size: 14px; font-weight: 800; color: #000;">${escapeHtml(branding.brandName || branding.storeName || DEFAULT_STORE_NAME)}</div>
            <div style="font-size: 12.5px; font-weight: 700; margin-top: 2px; color: #000;">${escapeHtml(title)}</div>
            ${safeSubtitle ? `<div style="font-size: 10px; color: #333; margin-top: 1px;">${escapeHtml(safeSubtitle)}</div>` : ''}
            ${headerDetailsHtml ? `<div style="font-size: 9.5px; margin-top: 2px; color: #222;">${headerDetailsHtml}</div>` : ''}
            <div style="font-size: 9.5px; color: #444; margin-top: 2px;">تاريخ الطباعة: ${escapeHtml(printedAt)}</div>
          </div>
        `
        ) : (
          hideHeader ? '' : `
          <div class="print-header ${layout === 'centered' ? 'centered-layout' : ''}">
            ${layout === 'centered' ? '' : buildBrandPanelHtml(branding)}
            <div class="doc-panel">
              ${layout === 'centered' ? `<div class="brand-name-centered">${escapeHtml(branding.brandName || branding.storeName || DEFAULT_STORE_NAME)}</div>` : ''}
              <h1 class="doc-title">${escapeHtml(title)}</h1>
              ${safeSubtitle ? `<div class="doc-subtitle">${escapeHtml(safeSubtitle)}</div>` : ''}
              ${headerDetailsHtml ? `<div class="doc-header-details">${headerDetailsHtml}</div>` : ''}
              <div class="doc-meta-chip">تاريخ الطباعة: ${escapeHtml(printedAt)}</div>
            </div>
          </div>`
        )}
        <div class="print-content">${bodyContent}</div>
        ${effectiveFooter ? `<div class="print-footer">${effectiveFooter}</div>` : ''}
      </div>
    </body>
  </html>`;

  if (deviceName && typeof window !== 'undefined' && (window as any).electronPrinter) {
    (window as any).electronPrinter.printHtmlSilent({ html, deviceName, pageSize, receiptWidthMm })
      .catch((err: any) => console.error('Silent print failed:', err));
    return;
  }

  if (typeof window !== 'undefined' && (window as any).SunmiPrinter?.printReceipt) {
    try {
      const container = document.createElement('div');
      container.innerHTML = bodyContent;
      const text = (container.innerText || container.textContent || '').trim();
      if (text) {
        (window as any).SunmiPrinter.printReceipt(text);
        return;
      }
    } catch (e) {
      console.warn('Sunmi direct bridge fallback failed:', e);
    }
  }

  // Silent Windows print via the local bridge (no browser print dialog).
  // No window.open is used at all: browsers clamp off-screen popup
  // coordinates on-screen, so a tiny window flashed on every sale.
  // The bridge is attempted first (only when a Windows printer name is
  // configured); on ANY bridge failure, or when no printer is configured,
  // the same HTML prints through a hidden in-page iframe, whose
  // contentWindow.print() shows the usual dialog without a popup.
  // print() needs no user activation, so no window has to be opened
  // synchronously before the async bridge attempt.
  const windowsPrinterName = branding.windowsPrinterName;
  const bridgeAttemptPlanned = Boolean(windowsPrinterName);

  const printViaDialog = () => {
    // Remove any print iframe left by an earlier print (autoClose:false
    // keeps it until the next print); at most one stale iframe exists.
    document.querySelectorAll('iframe[data-print-frame="true"]').forEach((el) => el.remove());
    // A hidden iframe (never display:none: some browsers refuse to print
    // one) carries the document; its window shows the print dialog.
    const frame = document.createElement('iframe');
    frame.setAttribute('data-print-frame', 'true');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText =
      'position:absolute;width:0;height:0;border:0;left:0;top:0;visibility:hidden;';
    document.body.appendChild(frame);
    const frameWindow = frame.contentWindow;
    const frameDocument = frame.contentDocument;
    if (!frameWindow || !frameDocument) {
      document.body.removeChild(frame);
      console.warn('Print iframe was unavailable on this platform.');
      return;
    }
    frameDocument.open();
    frameDocument.write(html);
    frameDocument.close();

    let printed = false;
    const finalizePrint = () => {
      if (printed) return;
      printed = true;
      window.setTimeout(() => {
        frameWindow.focus();
        frameWindow.print();
        if (autoClose) {
          // The 220ms delay protects browsers where print() returns before
          // the dialog has captured the document.
          window.setTimeout(() => {
            try { document.body.removeChild(frame); } catch { /* already gone */ }
          }, 220);
        }
      }, Math.max(220, Number(printDelayMs || 0)));
    };

    if (frameDocument.readyState === 'complete') {
      finalizePrint();
    } else {
      frame.addEventListener('load', finalizePrint, { once: true });
      window.setTimeout(finalizePrint, Math.max(400, Number(printDelayMs || 0) + 120));
    }
  };

  if (!bridgeAttemptPlanned) {
    printViaDialog();
    return;
  }

  // Fire-and-forget: the function stays sync (its ~20 callers do not await
  // it). On bridge success nothing is shown and no dialog appears; on ANY
  // bridge failure the hidden iframe prints the dialog way, so a print is
  // never lost.
  void (async () => {
    try {
      const { HardwareBridgeClient } = await import('@/features/pos/lib/hardware-bridge-client');
      if (await HardwareBridgeClient.isAvailable()) {
        const result = await HardwareBridgeClient.printWindows({
          html,
          deviceName: windowsPrinterName,
          pageSize,
          receiptWidthMm,
        });
        if (result?.success) {
          return;
        }
      }
    } catch {
      // Fall through to the dialog below.
    }
    printViaDialog();
  })();
}
