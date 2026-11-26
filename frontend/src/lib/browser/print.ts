import { escapeHtml } from './escape';

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

export function printHtmlDocument(titleOrBody: string, bodyOrTitle: string, options: PrintDocumentOptions = {}) {
  let title = String(titleOrBody || 'مستند للطباعة').trim() || 'مستند للطباعة';
  let bodyHtml = String(bodyOrTitle || '').trim();

  if (looksLikeHtmlFragment(titleOrBody) && !looksLikeHtmlFragment(bodyOrTitle)) {
    title = String(bodyOrTitle || 'مستند للطباعة').trim() || 'مستند للطباعة';
    bodyHtml = String(titleOrBody || '').trim();
  }

  const {
    subtitle = '',
    footerHtml = '',
    extraStyles = '',
    pageSize = 'auto',
    orientation = 'portrait',
    printDelayMs = 0,
    autoClose = false,
    documentDirection = 'rtl',
  } = options;

  const printedAt = new Date().toLocaleString('ar-EG');
  const printWindow = window.open('', '_blank', 'width=1120,height=820');
  if (!printWindow) throw new Error('المتصفح منع نافذة الطباعة');

  const pageRule = pageSize === 'A4'
    ? orientation === 'landscape'
      ? '@page { size: A4 landscape; margin: 12mm; }'
      : '@page { size: A4 portrait; margin: 12mm; }'
    : pageSize === 'receipt'
      ? '@page { size: 80mm auto; margin: 4mm; }'
      : '@page { size: auto; margin: 12mm; }';

  const html = `<!doctype html>
  <html lang="ar" dir="${documentDirection}">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(title)}</title>
      <style>${pageRule}${extraStyles}</style>
    </head>
    <body>
      <div class="print-shell">
        <div class="print-header">
          <div class="print-title-wrap">
            <h1 class="print-title">${escapeHtml(title)}</h1>
            ${subtitle ? `<div class="print-subtitle">${escapeHtml(subtitle)}</div>` : ''}
          </div>
          <div class="print-meta-chip">${escapeHtml(printedAt)}</div>
        </div>
        <div class="print-content">${bodyHtml}</div>
        ${footerHtml ? `<div class="print-footer">${footerHtml}</div>` : ''}
      </div>
    </body>
  </html>`;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => {
    printWindow.print();
    if (autoClose) {
      window.setTimeout(() => printWindow.close(), 200);
    }
  }, printDelayMs);
}
