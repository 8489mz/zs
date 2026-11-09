import { escapeHtml, printHtmlDocument } from '@/lib/browser';
import type { Sale, AppSettings } from '@/types/domain';
import { formatDateTime } from '@/lib/pos-printing/shared';
import { resolveItemEnglishName, formatKitchenNote } from '@/features/pos/utils/kitchen-notes.util';
import { kitchenPrintersApi } from '@/features/pos/api/kitchen-printers.api';

/**
 * R4-E I13: the automatic kitchen print belongs to the POST, never to the
 * HOLD. A held draft lives in held_sales, never in sales, so it never
 * appears on the KDS — auto-printing it as "sent to the kitchen" lied in
 * both directions. Single decision for both call sites: only a posted sale
 * in a restaurant with auto-print on prints automatically.
 */
export function shouldAutoPrintKitchenTicket(input: {
  posted: boolean;
  held: boolean;
  restaurantEnabled: boolean;
  autoPrint: boolean;
}): boolean {
  return input.posted && !input.held && input.restaurantEnabled && input.autoPrint;
}

export interface KitchenAutoPrintResult {
  mode: 'network' | 'electron-fallback';
  failed: Array<{ printerName: string; error?: string }>;
}

/**
 * R4-E I12+I13: the post-success auto-print. Tries the network printers
 * first (backend raw-TCP send). Zero matching printers — or an unreachable
 * backend (offline sale) — falls back to the existing Electron/browser
 * print. A configured printer that fails is reported in `failed`, never
 * swallowed: the caller toasts it loudly.
 */
export async function printKitchenTicketAuto(
  sale: Partial<Sale> & {
    cashierName?: string;
    waiterName?: string;
    guestCount?: number;
    isAddon?: boolean;
    orderTypeLabel?: string;
  },
  settings?: Partial<AppSettings> | null,
): Promise<KitchenAutoPrintResult> {
  const saleId = Number((sale as any)?.id || 0);
  if (saleId > 0) {
    try {
      const res = await kitchenPrintersApi.printTicket(saleId);
      const results = Array.isArray(res?.results) ? res.results : [];
      if (results.length > 0) {
        return {
          mode: 'network',
          failed: results
            .filter((r) => !r.ok)
            .map((r) => ({ printerName: r.printerName, error: r.error })),
        };
      }
    } catch {
      // Offline or unreachable backend: fall through to the local print.
    }
  }
  printKitchenTicket(sale, settings);
  return { mode: 'electron-fallback', failed: [] };
}

export function getKitchenTicketStyles() {
  return `
    .print-shell { padding: 1mm; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .print-header { display: none !important; }
    
    /* Detailed Mode Styles */
    .kitchen-title { font-size: 15px; font-weight: 900; text-align: center; margin-bottom: 4px; letter-spacing: 0.5px; border-bottom: 2px dashed #000; padding-bottom: 4px; }
    .kitchen-badge-container { display: flex; justify-content: space-between; align-items: center; margin: 4px 0 6px; border: 2px solid #000; border-radius: 4px; padding: 4px 8px; }
    .kitchen-table-callout { font-size: 17px; font-weight: 900; }
    .kitchen-order-tag { font-size: 14px; font-weight: 800; }
    .addon-banner { background: #000; color: #fff; text-align: center; font-weight: 900; font-size: 12px; padding: 3px 0; margin-bottom: 4px; border-radius: 3px; letter-spacing: 0.5px; }
    .kitchen-meta { font-size: 12px; font-weight: 700; margin-bottom: 6px; border-bottom: 1px solid #000; padding-bottom: 4px; }
    .kitchen-meta-line { display: flex; justify-content: space-between; margin-bottom: 2px; }
    .kitchen-items { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
    .kitchen-items th, .kitchen-items td { padding: 4px 2px; border-bottom: 1px dashed #999; text-align: right; }
    .kitchen-items th { font-weight: 900; font-size: 12px; background: #f0f0f0; border-bottom: 1px solid #000; }
    .kitchen-items td { font-size: 14px; font-weight: 800; line-height: 1.3; }
    .kitchen-items td.qty { text-align: center; font-size: 16px; font-weight: 900; width: 44px; }
    .item-meta-badges { display: inline-flex; gap: 4px; margin-right: 4px; }
    .course-badge { font-size: 10.5px; font-weight: 800; background: #eee; border: 1px solid #666; border-radius: 3px; padding: 1px 4px; }
    .seat-badge { font-size: 10.5px; font-weight: 800; border: 1px dashed #000; border-radius: 3px; padding: 1px 4px; }
    .modifier-line { font-size: 12px; font-weight: 700; margin-top: 2px; padding-right: 10px; color: #222; }
    .note-line { font-size: 12px; font-weight: 800; color: #b91c1c; margin-top: 2px; padding-right: 6px; }
    .kitchen-item-en { font-size: 14.5px; font-weight: 900; line-height: 1.25; direction: ltr; text-align: left; font-family: system-ui, -apple-system, sans-serif; letter-spacing: 0.3px; }
    .kitchen-item-ar { font-size: 11.5px; font-weight: 700; color: #334155; margin-top: 1px; }
    .kitchen-tag-pill { display: inline-block; background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; font-size: 11px; font-weight: 800; border-radius: 3px; padding: 1px 5px; margin-top: 2px; }
    
    /* Mini Mode Styles */
    .mini-ticket { text-align: center; padding: 2px 0; }
    .mini-title { font-size: 26px; font-weight: 900; margin-bottom: 4px; border: 2px solid #000; padding: 3px 14px; border-radius: 6px; display: inline-block; letter-spacing: 0.5px; }
    .mini-meta { font-size: 11.5px; font-weight: 700; color: #111; direction: rtl; }

    body.receipt-mode .print-shell { width: 100%; max-width: 100%; padding-top: 0; margin: 0; box-sizing: border-box; }
  `;
}

export function buildKitchenTicketDocument(
  sale: Partial<Sale> & {
    cashierName?: string;
    waiterName?: string;
    guestCount?: number;
    isAddon?: boolean;
    orderTypeLabel?: string;
  },
  settings?: Partial<AppSettings> | null
) {
  const documentNumber = String(sale.docNo || sale.id || 'طلب معلق');
  const shortOrderMatch = documentNumber.match(/-0*(\d+)$/);
  const shortOrderNo = shortOrderMatch ? shortOrderMatch[1] : (sale.id ? String(sale.id) : documentNumber);
  const dateText = formatDateTime(sale.date || new Date().toISOString(), settings);
  
  if (settings?.posKitchenPrinterMode === 'mini') {
    return `
      <div class="mini-ticket" dir="rtl">
        <div class="mini-title">طلب # ${escapeHtml(shortOrderNo)}</div>
        <div class="mini-meta">${escapeHtml(documentNumber)} &bull; ${escapeHtml(dateText)}</div>
      </div>
    `;
  }

  const orderTypeMap: Record<string, string> = {
    dine_in: 'محلي (داخل المطعم)',
    takeaway: 'سفري / استلام',
    delivery: 'توصيل',
    car_pickup: 'استلام سيارة (Drive-Thru)',
    drive_thru: 'استلام سيارة (Drive-Thru)',
  };
  const courseMap: Record<string, string> = {
    appetizer: 'مقبلات',
    main: 'طبق رئيسي',
    dessert: 'حلويات',
    beverage: 'مشروبات',
  };

  const orderTypeKey = String(sale.orderType || '').toLowerCase();
  const orderTypeLabel = sale.orderTypeLabel || orderTypeMap[orderTypeKey] || (sale.tableNumber ? 'محلي' : 'سفري');
  const staffName = sale.waiterName || sale.createdBy || sale.cashierName || '';
  const items = sale.items || [];
  const kitchenLang = String((settings as any)?.posKitchenLanguage || 'dual').toLowerCase();
  const rawNote = sale.note || '';
  const formattedOrderNote = formatKitchenNote(rawNote, kitchenLang as any);

  const itemsHtml = items.map((item: any) => {
    const englishName = resolveItemEnglishName(item);
    const hasEnglish = Boolean(englishName && englishName !== item.name);

    let modifiersHtml = '';
    if (item.modifiers && Array.isArray(item.modifiers) && item.modifiers.length > 0) {
      modifiersHtml = item.modifiers.map((mod: any) => {
        const modEn = resolveItemEnglishName(mod);
        const modFormatted = kitchenLang === 'en' && modEn ? modEn : (kitchenLang === 'dual' && modEn ? `${mod.name} [${modEn}]` : mod.name);
        return `<div class="modifier-line">+ ${escapeHtml(modFormatted || '')} ${mod.qty > 1 ? `(x${mod.qty})` : ''}</div>`;
      }).join('');
    }

    let itemNoteHtml = '';
    if (item.notes) {
      const formattedItemNote = formatKitchenNote(item.notes, kitchenLang as any);
      itemNoteHtml = `<div class="note-line kitchen-tag-pill">ملاحظة: ${escapeHtml(formattedItemNote)}</div>`;
    }

    const courseName = item.course ? (courseMap[item.course] || item.course) : '';
    const seatLabel = item.seatNumber ? `مقعد ${item.seatNumber}` : '';

    let nameContent = `<span>${escapeHtml(item.name || '')}</span>`;
    if (kitchenLang === 'en' && hasEnglish) {
      nameContent = `
        <div class="kitchen-item-en">${escapeHtml(englishName!)}</div>
        <div class="kitchen-item-ar" style="font-size:10px; color:#64748b;">${escapeHtml(item.name || '')}</div>
      `;
    } else if (kitchenLang === 'dual' && hasEnglish) {
      nameContent = `
        <div class="kitchen-item-en">${escapeHtml(englishName!)}</div>
        <div class="kitchen-item-ar">${escapeHtml(item.name || '')}</div>
      `;
    }

    return `
      <tr>
        <td>
          <div style="display: flex; flex-direction: column; align-items: flex-start; justify-content: center;">
            <div style="display: flex; align-items: baseline; flex-wrap: wrap; width: 100%;">
              ${nameContent}
              ${courseName || seatLabel ? `
                <span class="item-meta-badges">
                  ${courseName ? `<span class="course-badge">${escapeHtml(courseName)}</span>` : ''}
                  ${seatLabel ? `<span class="seat-badge">${escapeHtml(seatLabel)}</span>` : ''}
                </span>
              ` : ''}
            </div>
            ${modifiersHtml}
            ${itemNoteHtml}
          </div>
        </td>
        <td class="qty">${Number(item.qty || 0)}</td>
      </tr>
    `;
  }).join('');

  const tableHeaderCallout = sale.tableNumber ? `طاولة: ${escapeHtml(sale.tableNumber)}` : escapeHtml(orderTypeLabel);

  const html = `
    <div class="kitchen-title" dir="rtl">تذكرة المطبخ (KOT)</div>
    ${sale.isAddon ? `<div class="addon-banner" dir="rtl">[ طلب إضافي - ADD-ON ]</div>` : ''}
    <div class="kitchen-badge-container" dir="rtl">
      <div class="kitchen-table-callout">${tableHeaderCallout}</div>
      <div class="kitchen-order-tag">طلب #${escapeHtml(shortOrderNo)}</div>
    </div>
    <div class="kitchen-meta" dir="rtl">
      <div class="kitchen-meta-line"><span>النوع:</span> <span>${escapeHtml(orderTypeLabel)}</span></div>
      ${staffName ? `<div class="kitchen-meta-line"><span>المسؤول:</span> <span>${escapeHtml(staffName)}</span></div>` : ''}
      ${sale.guestCount && Number(sale.guestCount) > 1 ? `<div class="kitchen-meta-line"><span>عدد الضيوف:</span> <span>${escapeHtml(String(sale.guestCount))}</span></div>` : ''}
      <div class="kitchen-meta-line"><span>التاريخ والوقت:</span> <span>${escapeHtml(dateText)}</span></div>
      ${formattedOrderNote ? `<div class="kitchen-meta-line"><span style="color:#b91c1c; font-weight:800;">ملاحظات الطلب:</span> <span class="kitchen-tag-pill" style="font-size:12px;">${escapeHtml(formattedOrderNote)}</span></div>` : ''}
    </div>
    <table class="kitchen-items" dir="rtl">
      <thead>
        <tr>
          <th>الصنف / الخيارات</th>
          <th style="text-align: center; width: 44px;">الكمية</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml || '<tr><td colspan="2" style="text-align: center;">لا توجد أصناف</td></tr>'}
      </tbody>
    </table>
  `;

  return html;
}

export function printKitchenTicket(
  sale: Partial<Sale> & {
    cashierName?: string;
    waiterName?: string;
    guestCount?: number;
    isAddon?: boolean;
    orderTypeLabel?: string;
  },
  settings?: Partial<AppSettings> | null
) {
  const html = buildKitchenTicketDocument(sale, settings);
  const title = `المطبخ ${sale.docNo || sale.id || 'طلب جديد'}`;
  
  printHtmlDocument(title, html, {
    subtitle: '',
    footerHtml: '',
    pageSize: 'receipt',
    extraStyles: getKitchenTicketStyles(),
    deviceName: settings?.posElectronKitchenPrinter || undefined,
  });
}
