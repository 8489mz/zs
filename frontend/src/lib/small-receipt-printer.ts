import { escapeHtml } from '@/lib/browser/escape';

export interface SmallReceiptPrintOptions {
  title?: string;
  widthMm?: number;
  marginMm?: number;
  fontSizePx?: number;
  printDelayMs?: number;
  autoClose?: boolean;
  deviceName?: string;
}

export function getSmallReceiptStyles(options: { widthMm?: number; marginMm?: number; fontSizePx?: number } = {}) {
  const { widthMm = 58, marginMm = 0, fontSizePx = 10.5 } = options;
  const effectiveMaxWidth = widthMm > 65 ? Math.min(widthMm, 74) : widthMm;

  return `
    @page {
      size: ${widthMm}mm auto;
      margin: ${marginMm}mm;
    }
    *, *::before, *::after {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
      font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: ${fontSizePx}px;
      line-height: 1.35;
      direction: rtl;
      text-align: right;
      width: 100%;
      -webkit-font-smoothing: antialiased;
    }
    .thermal-receipt-container {
      width: 100%;
      max-width: ${effectiveMaxWidth}mm;
      margin: 0 auto;
      padding: 2mm 3mm;
      page-break-inside: avoid;
      break-inside: avoid;
      background: #fff;
      color: #000;
      box-sizing: border-box;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 3px 0;
      text-align: right;
      vertical-align: top;
    }
    @media print {
      body {
        margin: 0 !important;
        padding: 0 !important;
      }
      .no-print {
        display: none !important;
      }
    }
  `;
}

export function printSmallReceiptDocument(htmlContent: string, options: SmallReceiptPrintOptions = {}) {
  const {
    title = 'إيصال حراري',
    widthMm = 58,
    marginMm = 0,
    fontSizePx = 10.5,
    printDelayMs = 150,
    autoClose = false,
    deviceName,
  } = options;

  const styles = getSmallReceiptStyles({ widthMm, marginMm, fontSizePx });

  const fullHtml = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>${styles}</style>
  </head>
  <body>
    <div class="thermal-receipt-container">
      ${htmlContent}
    </div>
  </body>
</html>`;

  const trimmedDeviceName = String(deviceName || '').trim();
  if (trimmedDeviceName && typeof window !== 'undefined' && (window as any).electronPrinter?.printHtmlSilent) {
    (window as any).electronPrinter
      .printHtmlSilent({
        html: fullHtml,
        deviceName: trimmedDeviceName,
        pageSize: 'receipt',
        receiptWidthMm: widthMm === 58 ? 58 : 80,
      })
      .catch((err: any) => console.error('Silent receipt test print failed:', err));
    return;
  }

  const printWindow = window.open('', '_blank', `width=${Math.max(380, widthMm * 4)},height=700`);
  if (!printWindow) {
    // Graceful fallback to hidden iframe so printing never fails on mobile/tablet or when popups are blocked
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(fullHtml);
      doc.close();
      window.setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        window.setTimeout(() => {
          if (iframe.parentNode) {
            iframe.parentNode.removeChild(iframe);
          }
        }, 2000);
      }, printDelayMs);
      return;
    }
    throw new Error('المتصفح منع فتح نافذة الطباعة. يرجى السماح بالنوافذ المنبثقة.');
  }

  printWindow.document.open();
  printWindow.document.write(fullHtml);
  printWindow.document.close();
  printWindow.focus();

  if (autoClose) {
    try {
      printWindow.onafterprint = () => {
        window.setTimeout(() => printWindow.close(), 100);
      };
    } catch {}
  }

  window.setTimeout(() => {
    printWindow.print();
    if (autoClose) {
      window.setTimeout(() => printWindow.close(), 300);
    }
  }, printDelayMs);
}
