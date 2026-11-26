import { escapeHtml } from './html';

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

export interface PrintDocumentOptions {
  subtitle?: string;
  footerHtml?: string;
  extraStyles?: string;
  pageSize?: 'auto' | 'A4' | 'receipt';
  orientation?: 'portrait' | 'landscape';
  printDelayMs?: number;
  autoClose?: boolean;
  documentDirection?: 'rtl' | 'ltr';
}

function buildPageRule(pageSize: PrintDocumentOptions['pageSize'], orientation: PrintDocumentOptions['orientation']) {
  return pageSize === 'A4'
    ? orientation === 'landscape'
      ? '@page { size: A4 landscape; margin: 12mm; }'
      : '@page { size: A4 portrait; margin: 12mm; }'
    : pageSize === 'receipt'
      ? '@page { size: 80mm auto; margin: 4mm; }'
      : '@page { size: auto; margin: 12mm; }';
}

function buildPrintHtml({ title, bodyHtml, subtitle, footerHtml, extraStyles, pageSize, documentDirection, printedAt, pageRule }: {
  title: string;
  bodyHtml: string;
  subtitle: string;
  footerHtml: string;
  extraStyles: string;
  pageSize: 'auto' | 'A4' | 'receipt';
  documentDirection: 'rtl' | 'ltr';
  printedAt: string;
  pageRule: string;
}) {
  return `<!doctype html>
  <html lang="ar" dir="${documentDirection}">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(title)}</title>
      <style>
        :root {
          --print-text: #000;
          --print-muted: #000;
          --print-border: #000;
          --print-surface: #fff;
          --print-accent: #170c5c;
        }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #fff; color: var(--print-text); }
        body { font-family: Tahoma, Arial, sans-serif; }
        .print-shell { padding: 24px; max-width: 100%; }
        .print-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 2px solid var(--print-border); }
        .print-title-wrap { min-width: 0; }
        .print-title { margin: 0; font-size: 26px; line-height: 1.25; }
        .print-subtitle { margin-top: 8px; color: var(--print-muted); font-size: 13px; }
        .print-meta-chip { white-space: nowrap; border: 1px solid var(--print-border); border-radius: 8px; padding: 8px 12px; color: var(--print-muted); font-size: 12px; background: #fff; }
        .print-content { display: flex; flex-direction: column; gap: 14px; }
        .print-footer { margin-top: 18px; padding-top: 12px; border-top: 1px dashed var(--print-border); color: var(--print-muted); font-size: 12px; }
        h1, h2, h3 { margin: 0 0 12px; }
        p { margin: 0 0 10px; }
        .meta { margin-bottom: 16px; color: var(--print-muted); }
        .section { margin-bottom: 20px; }
        .meta-grid, .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
        .meta-box, .summary-box { border: 1px solid var(--print-border); border-radius: 8px; padding: 12px; background: rgba(248, 250, 252, 0.52); }
        .meta-box strong, .summary-box strong { display: block; margin-bottom: 6px; color: var(--print-accent); font-size: 12px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th, td { border: 1px solid var(--print-border); padding: 10px; text-align: right; vertical-align: top; }
        th { background: var(--print-surface); color: var(--print-muted); }
        tbody tr:nth-child(even) { background: rgba(248, 250, 252, 0.65); }
        .totals { margin-top: 16px; border: 1px solid var(--print-border); border-radius: 8px; padding: 14px; background: rgba(248, 250, 252, 0.5); }
        .totals div { margin-bottom: 6px; }
        .muted { color: var(--print-muted); }
        .text-left { text-align: left; }
        ${pageRule}
        body.receipt-mode .print-shell { padding: 8px; max-width: 80mm; }
        body.receipt-mode .print-title { font-size: 18px; }
        body.receipt-mode .print-header { gap: 8px; margin-bottom: 10px; padding-bottom: 8px; }
        body.receipt-mode table th, body.receipt-mode table td { padding: 6px; font-size: 12px; }
        body.receipt-mode .meta-grid, body.receipt-mode .summary-grid { grid-template-columns: 1fr; }
        body.receipt-mode .totals { padding: 10px; margin-top: 10px; }
        @media print {
          .print-shell { padding: 0; }
          .print-header { break-inside: avoid; }
          a { color: inherit; text-decoration: none; }
        }
        ${extraStyles}
      </style>
    </head>
    <body class="${pageSize === 'receipt' ? 'receipt-mode' : ''}">
      <div class="print-shell">
        <div class="print-header">
          <div class="print-title-wrap">
            <h1 class="print-title">${escapeHtml(title)}</h1>
            <div class="print-subtitle">${escapeHtml(subtitle)}</div>
          </div>
          <div class="print-meta-chip">تاريخ الطباعة: ${escapeHtml(printedAt)}</div>
        </div>
        <div class="print-content">${bodyHtml}</div>
        ${footerHtml ? `<div class="print-footer">${footerHtml}</div>` : ''}
      </div>
    </body>
  </html>`;
}

export function printHtmlDocument(titleOrBody: string, bodyOrTitle: string, options: PrintDocumentOptions = {}) {
  let title = String(titleOrBody || 'مستند للطباعة').trim() || 'مستند للطباعة';
  let bodyHtml = String(bodyOrTitle || '').trim();

  if (looksLikeHtmlFragment(titleOrBody) && !looksLikeHtmlFragment(bodyOrTitle)) {
    title = String(bodyOrTitle || 'مستند للطباعة').trim() || 'مستند للطباعة';
    bodyHtml = String(titleOrBody || '').trim();
  }

  const { subtitle = '', footerHtml = '', extraStyles = '', pageSize = 'auto', orientation = 'portrait', printDelayMs = 0, autoClose = false, documentDirection = 'rtl' } = options;
  const printedAt = new Date().toLocaleString('ar-EG');
  const printWindow = window.open('', '_blank', 'width=1120,height=820');
  if (!printWindow) throw new Error('المتصفح منع نافذة الطباعة');

  printWindow.document.write(buildPrintHtml({
    title, bodyHtml, subtitle, footerHtml, extraStyles, pageSize, documentDirection, printedAt, pageRule: buildPageRule(pageSize, orientation),
  }));
  printWindow.document.close();
  window.setTimeout(() => {
    printWindow.focus();
    printWindow.print();
    if (autoClose) window.setTimeout(() => printWindow.close(), 180);
  }, Math.max(0, Number(printDelayMs || 0)));
}
