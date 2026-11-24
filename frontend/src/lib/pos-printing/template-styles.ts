export function getInvoiceStyles(compact = false) {
  return `
    .print-shell { padding: ${compact ? '1mm 1.2mm 2.5mm' : '2mm 1.8mm 3mm'}; font-family: 'Cairo', 'Segoe UI', Tahoma, -apple-system, sans-serif; }
    .print-header { display: none !important; }
    .print-title { font-size: ${compact ? '14px' : '19px'}; }
    .print-subtitle { margin-top: 1px; font-size: ${compact ? '9px' : '11px'}; min-height: 0; }
    .print-meta-chip { padding: ${compact ? '4px 8px' : '6px 10px'}; font-size: ${compact ? '9.5px' : '11px'}; }
    .print-content { gap: ${compact ? '0px' : '2px'}; }
    .invoice-card {
      background: #fff;
      padding: ${compact ? '2px 2px' : '3px 3px'};
      break-inside: avoid;
      overflow: hidden;
    }
    .invoice-card.compact { padding: 2px 2px; }
    .invoice-brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: ${compact ? '8px' : '12px'};
      min-height: ${compact ? '44px' : '56px'};
      width: 100%;
    }
    .invoice-logo-wrapper {
      position: relative;
      width: ${compact ? '68px' : '96px'};
      height: ${compact ? '44px' : '56px'};
      min-height: ${compact ? '44px' : '56px'};
      max-width: ${compact ? '68px' : '96px'};
      max-height: ${compact ? '44px' : '56px'};
      flex-shrink: 0;
    }
    .invoice-logo,
    .invoice-logo-fallback {
      position: absolute;
      top: 0; right: 0; bottom: 0; left: 0;
      inset: 0;
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
      border-radius: 0;
      object-fit: contain;
      object-position: center;
      background: transparent;
      display: block; display: grid;
      place-items: center;
      font-weight: 800;
      color: #000;
      overflow: hidden;
    }
    img.invoice-logo {
      /* IE11 has no object-fit: the shared .invoice-logo rule sizes the img
         100%x100%, which stretches it. Auto sizing keeps the aspect ratio
         (capped by the max sizes below); margin:auto centers it inside the
         absolutely-positioned box (top/right/bottom/left: 0). */
      width: auto;
      height: auto;
      max-width: ${compact ? '68px' : '96px'} !important;
      max-height: ${compact ? '44px' : '56px'} !important;
      margin: auto;
    }
    .invoice-brand-copy {
      min-width: 0;
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      justify-content: center;
      text-align: center;
      width: 100%;
    }
    .invoice-brand-copy h2 {
      margin: 0;
      line-height: 1.12;
      color: #000;
      font-weight: 900;
      letter-spacing: -0.3px;
      overflow-wrap: normal;
      word-break: keep-all;
      text-align: center;
      width: 100%;
      font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
    }
    .store-inline-details {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.5px;
      font-size: ${compact ? '8.5px' : '9.5px'};
      color: #000;
      margin-top: 2px;
      font-weight: 600;
      line-height: 1.25;
      text-align: center;
      width: 100%;
    }
    .store-detail-line {
      display: block;
      width: 100%;
      text-align: center;
    }
    .store-phone-line {
      white-space: nowrap;
      font-weight: 700;
    }
    .store-address-line {
      word-break: normal;
      overflow-wrap: break-word;
    }
    .invoice-meta-grid {
      display: flex;
      flex-direction: column;
      gap: ${compact ? '1px' : '2px'};
      width: 100%;
    }
    .meta-line {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      width: 100%;
      padding: ${compact ? '1px 0' : '2px 0'};
      font-size: ${compact ? '9.5px' : '11px'};
      border-bottom: 1px dotted #e2e8f0;
      gap: 6px;
    }
    .meta-line:last-child {
      border-bottom: none;
    }
    .meta-line.meta-document-badge {
      font-weight: 800;
      font-size: ${compact ? '10px' : '11.5px'};
    }
    .meta-line.meta-online-order-badge {
      font-weight: 800;
      font-size: ${compact ? '10.5px' : '12px'};
      background: #f1f5f9;
      padding: ${compact ? '2px 4px' : '3px 6px'};
      border-radius: 4px;
      border: 1px dashed #94a3b8;
      margin: 2px 0;
    }
    .meta-line.meta-online-order-badge .meta-label {
      font-weight: 800;
      color: #000;
    }
    .meta-line.meta-online-order-badge .meta-value {
      font-weight: 900;
      color: #000;
      font-family: monospace, monospace;
      direction: ltr;
    }
    .meta-line.strong {
      font-weight: 800;
      font-size: ${compact ? '10.5px' : '12px'};
      border-bottom: 1px solid #cbd5e1;
      padding: ${compact ? '2px 0' : '4px 0'};
    }
    .meta-label {
      color: #000;
      font-weight: 600;
      flex-shrink: 0;
    }
    .meta-value {
      color: #000;
      text-align: left;
      unicode-bidi: plaintext;
      word-break: break-word;
    }
    .invoice-items-table {
      width: 100%;
      border-collapse: collapse;
      margin: ${compact ? '2px 0' : '4px 0'};
    }
    .invoice-items-table th,
    .invoice-items-table td {
      padding: ${compact ? '2.5px 2px' : '4px 3px'};
      font-size: ${compact ? '9px' : '10.5px'};
      text-align: center;
      color: #000;
      vertical-align: middle;
      border-bottom: 1px dotted #000;
    }
    .invoice-items-table th {
      background: #000;
      color: #fff;
      font-weight: 800;
      border: 1px solid #000;
      text-align: center;
      vertical-align: middle;
      padding: ${compact ? '2.5px 2px' : '4px 3px'};
    }
    .invoice-items-table th.name-th,
    .invoice-items-table td.name-cell {
      text-align: right;
      vertical-align: middle;
      padding-right: ${compact ? '4px' : '6px'};
      padding-inline-start: ${compact ? '4px' : '6px'};
    }
    .invoice-items-table .index-cell,
    .invoice-items-table .index-th { width: 5%; text-align: center; vertical-align: middle; color: #000; }
    .invoice-items-table .name-cell,
    .invoice-items-table .name-th { width: ${compact ? '46%' : '42%'}; font-weight: 700; color: #000; }
    .invoice-items-table .unit-cell,
    .invoice-items-table .unit-th { width: 12%; text-align: center; vertical-align: middle; color: #000; }
    .invoice-items-table .qty-cell,
    .invoice-items-table .qty-th { width: ${compact ? '12%' : '10%'}; text-align: center; vertical-align: middle; font-weight: 700; color: #000; }
    .invoice-items-table .price-cell,
    .invoice-items-table .price-th { width: ${compact ? '18%' : '14%'}; text-align: center; vertical-align: middle; color: #000; }
    .invoice-items-table .total-cell,
    .invoice-items-table .total-th { width: ${compact ? '24%' : '17%'}; text-align: center; vertical-align: middle; font-weight: 800; color: #000; }
    .invoice-totals-card {
      border-top: 1px dashed #000;
      margin-top: ${compact ? '2px' : '4px'};
      padding-top: ${compact ? '2px' : '4px'};
    }
    .invoice-payment-card {
      border-top: 1px dashed #cbd5e1;
      margin-top: ${compact ? '2px' : '4px'};
      padding-top: ${compact ? '2px' : '4px'};
    }
    .section-title {
      font-size: ${compact ? '9px' : '10.5px'};
      font-weight: 800;
      color: #000;
      margin-bottom: 2px;
    }
    .payment-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .payment-chip {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #fff;
      border: 1px solid #000;
      padding: 1px 4px;
      border-radius: 2px;
      font-size: ${compact ? '8.5px' : '10px'};
      width: 100%;
      font-weight: 700;
      color: #000;
    }
    .invoice-barcode-card {
      text-align: center;
      margin-top: ${compact ? '4px' : '6px'};
      padding-top: ${compact ? '2px' : '4px'};
      border-top: 1px dashed #000;
    }
    .invoice-barcode-svg-wrap {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 100%;
      margin: 0 auto;
    }
    .invoice-barcode-svg-wrap svg {
      width: 100% !important;
      max-width: 220px !important;
      height: ${compact ? '26px' : '34px'} !important;
      display: block;
    }
    .print-footer {
      text-align: center;
      margin-top: ${compact ? '4px' : '6px'};
      padding-top: ${compact ? '2px' : '4px'};
      font-size: ${compact ? '8.5px' : '9.5px'};
      color: #000;
      border-top: 1px dashed #cbd5e1;
    }

    /* Boxed Theme */
    .receipt-theme-boxed .invoice-card { border: 1px solid #000; margin-bottom: 3px; border-radius: 3px; padding: 4px 6px; }
    .receipt-theme-boxed .invoice-items-table th { background: #000; color: #fff; }
    .receipt-theme-boxed .meta-line { border-bottom: 1px dashed #000; }
    .receipt-theme-boxed .meta-line:last-child { border-bottom: none; }
    .receipt-theme-boxed .total-line { border-top: 1px solid #000; border-bottom: 1px solid #000; margin-top: 2px; }

    /* Ultra Compact Theme */
    .receipt-theme-ultra-compact .invoice-card { padding: 1px 0; border: none; border-radius: 0; }
    .receipt-theme-ultra-compact .invoice-brand-row { min-height: 0; gap: 4px; }
    .receipt-theme-ultra-compact .invoice-logo-wrapper { width: 44px; height: 28px; min-height: 28px; }
    .receipt-theme-ultra-compact .invoice-brand-copy h2 { font-size: 14px; }
    .receipt-theme-ultra-compact .store-meta-line { display: none; }
    .receipt-theme-ultra-compact .store-inline-details { display: flex; flex-direction: column; align-items: center; gap: 1px; font-size: 8.5px; color: #000; margin-top: 1px; font-weight: 600; text-align: center; }
    .receipt-theme-ultra-compact .store-detail-line { display: block; width: 100%; text-align: center; }
    .receipt-theme-ultra-compact .meta-line { display: inline-flex; align-items: baseline; gap: 3px; white-space: nowrap; border: none; padding: 0; font-size: 10px; break-inside: avoid; }
    .receipt-theme-ultra-compact .meta-line::after { content: " | "; margin: 0 3px; font-weight: normal; font-size: 9px; }
    .receipt-theme-ultra-compact .meta-line:last-child::after { content: ""; margin: 0; }

    body.receipt-mode .print-shell { width: 100%; max-width: 100%; padding-top: 0; margin: 0; box-sizing: border-box; }
    body.receipt-mode .print-header, body.receipt-mode .receipt-header { display: none !important; }
    body.receipt-mode .print-title-wrap { min-width: 0; }
  `;
}
