import { escapeHtml, printHtmlDocument } from '@/lib/browser';
import { resolveBridgePrinter, resolveElectronPrinter } from '@/lib/printer-preferences';
import type { AppSettings } from '@/types/domain';

export interface CupLabelItem {
  productName: string;
  qty: number;
  itemIndex: number;
  totalItems: number;
  orderNumber: string;
  tableNumber?: string;
  customerName?: string;
  orderType?: string;
  notes?: string;
  modifiers?: Array<{ name: string; qty?: number; price?: number }>;
  timestamp?: string;
  branchName?: string;
}

export interface CupLabelOrderParams {
  orderNumber: string;
  tableNumber?: string;
  customerName?: string;
  orderType?: string;
  branchName?: string;
  items: Array<{
    name: string;
    qty: number;
    notes?: string;
    modifiers?: Array<{ name: string; qty?: number; price?: number }>;
  }>;
}

export function getCupLabelStyles() {
  return `
    @page {
      size: 50mm 30mm;
      margin: 0;
    }
    @media print {
      body {
        margin: 0;
        padding: 0;
      }
      .cup-label-page {
        page-break-after: always;
        break-after: page;
      }
    }
    .print-shell {
      padding: 0;
      margin: 0;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .print-header { display: none !important; }

    .cup-label-page {
      width: 50mm;
      height: 30mm;
      max-width: 50mm;
      max-height: 30mm;
      box-sizing: border-box;
      padding: 2.2mm 2.5mm;
      overflow: hidden;
      direction: rtl;
      text-align: right;
      color: #000000;
      display: flex;
      flex-direction: column;
      justifyContent: space-between;
    }

    .cup-label-header {
      display: flex;
      justifyContent: space-between;
      align-items: center;
      border-bottom: 1.5px solid #000;
      padding-bottom: 1mm;
      margin-bottom: 1mm;
    }
    .cup-label-orderno {
      font-size: 14px;
      font-weight: 900;
      letter-spacing: 0.5px;
    }
    .cup-label-target {
      font-size: 10.5px;
      font-weight: 800;
      border: 1px solid #000;
      padding: 0.5mm 1.5mm;
      border-radius: 2px;
    }
    .cup-label-index {
      font-size: 9.5px;
      font-weight: 700;
    }

    .cup-label-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      justifyContent: center;
      overflow: hidden;
    }
    .cup-label-itemname {
      font-size: 12.5px;
      font-weight: 900;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .cup-label-modifiers {
      font-size: 9px;
      font-weight: 700;
      line-height: 1.25;
      color: #222;
      margin-top: 0.5mm;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .cup-label-note {
      font-size: 8.5px;
      font-weight: 600;
      color: #111;
      font-style: italic;
      margin-top: 0.3mm;
    }

    .cup-label-footer {
      display: flex;
      justifyContent: space-between;
      align-items: center;
      border-top: 1px dashed #444;
      padding-top: 0.8mm;
      margin-top: 0.5mm;
      font-size: 8px;
      font-weight: 600;
    }
  `;
}

export function buildSingleCupLabelHtml(item: CupLabelItem): string {
  const shortOrderMatch = String(item.orderNumber).match(/-0*(\d+)$/);
  const displayOrderNo = shortOrderMatch ? `#${shortOrderMatch[1]}` : `#${item.orderNumber}`;

  let targetBadge = 'سفري';
  if (item.tableNumber) {
    targetBadge = `طاولة ${escapeHtml(item.tableNumber)}`;
  } else if (item.orderType === 'dine_in') {
    targetBadge = 'محلي';
  } else if (item.orderType === 'delivery') {
    targetBadge = 'توصيل';
  }

  const modifiersText = item.modifiers && item.modifiers.length > 0
    ? item.modifiers.map((m) => `+ ${m.name}${m.qty && m.qty > 1 ? ` (x${m.qty})` : ''}`).join(' • ')
    : '';

  const timeText = item.timestamp || new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

  return `
    <div class="cup-label-page">
      <div class="cup-label-header">
        <span class="cup-label-orderno">${escapeHtml(displayOrderNo)}</span>
        <span class="cup-label-target">${targetBadge}</span>
        <span class="cup-label-index">${item.itemIndex}/${item.totalItems}</span>
      </div>

      <div class="cup-label-body">
        <div class="cup-label-itemname">${escapeHtml(item.productName)}</div>
        ${modifiersText ? `<div class="cup-label-modifiers">${escapeHtml(modifiersText)}</div>` : ''}
        ${item.notes ? `<div class="cup-label-note">ملاحظة: ${escapeHtml(item.notes)}</div>` : ''}
      </div>

      <div class="cup-label-footer">
        <span>${escapeHtml(item.customerName || item.branchName || 'Z-ERP')}</span>
        <span>${escapeHtml(timeText)}</span>
      </div>
    </div>
  `;
}

export function buildAllCupLabelsDocument(order: CupLabelOrderParams): string {
  // Expand each item by its quantity
  const flatItems: Array<{
    name: string;
    notes?: string;
    modifiers?: Array<{ name: string; qty?: number; price?: number }>;
  }> = [];

  for (const item of order.items) {
    const qty = Math.max(1, Math.round(Number(item.qty || 1)));
    for (let i = 0; i < qty; i++) {
      flatItems.push(item);
    }
  }

  const total = flatItems.length;
  const timeStr = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

  return flatItems
    .map((item, idx) =>
      buildSingleCupLabelHtml({
        productName: item.name,
        qty: 1,
        itemIndex: idx + 1,
        totalItems: total,
        orderNumber: order.orderNumber,
        tableNumber: order.tableNumber,
        customerName: order.customerName,
        orderType: order.orderType,
        notes: item.notes,
        modifiers: item.modifiers,
        timestamp: timeStr,
        branchName: order.branchName,
      })
    )
    .join('');
}

export function printOrderCupLabels(
  order: CupLabelOrderParams,
  settings?: Partial<AppSettings> | null
) {
  const html = buildAllCupLabelsDocument(order);
  const title = `ملصقات الأكواب والعلب - ${order.orderNumber}`;
  const electronPrinter =
    resolveElectronPrinter('barcode', settings) ||
    resolveElectronPrinter('kitchen', settings) ||
    settings?.posElectronKitchenPrinter ||
    undefined;
  const bridgePrinter = resolveBridgePrinter('barcode', settings) || undefined;

  printHtmlDocument(title, html, {
    subtitle: '',
    footerHtml: '',
    pageSize: 'auto',
    pageSizeMm: { widthMm: 50, heightMm: 30 },
    pageMarginMm: 0,
    hideHeader: true,
    extraStyles: getCupLabelStyles(),
    deviceName: electronPrinter,
    windowsPrinterName: bridgePrinter,
    disableWindowsBridge: !bridgePrinter,
  });
}
