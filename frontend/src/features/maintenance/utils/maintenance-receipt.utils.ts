import { getGlobalCurrencySymbol } from '@/lib/currencies';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { buildCode128Svg } from '@/lib/barcode';
import { escapeHtml, printHtmlDocument } from '@/lib/browser';
import type { MaintenanceTicket } from '@/types/domain-models/maintenance';
import type { AppSettings } from '@/types/domain';
import { getMaintenanceProfile } from '../constants/maintenance-profiles';

export function printMaintenanceReceipt(ticket: MaintenanceTicket, settings?: AppSettings | null) {
  const barcodeSvg = buildCode128Svg(ticket.ticketNo);
  /* D-M1-1: no discount concept — the final agreed amount is the total. */
  const totalCost = ticket.finalCost || ticket.expectedCost || 0;
  const advancePaid = ticket.advancePayment || 0;
  const netTotal = totalCost;
  const collectedAtDelivery = Math.max(0, netTotal - advancePaid);
  const remainingAmount = ticket.status === 'delivered' ? 0 : Math.max(0, netTotal - advancePaid);
  const dateFormatted = new Date(ticket.receivedAt).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
  const profile = getMaintenanceProfile(settings?.maintenanceProfile);
  const storeName = settings?.storeName || profile.title;
  const phone = settings?.phone || '';
  const address = settings?.address || '';

  const html = `
    <div class="maintenance-receipt-container" style="width: 100%; max-width: 68mm; margin: 0 auto; box-sizing: border-box; font-family: Tahoma, Arial, sans-serif; font-size: 11px; line-height: 1.35; color: #000;">
      <div style="text-align: center; margin-bottom: 6px; border-bottom: 1px dashed #000; padding-bottom: 6px;">
        <h2 style="margin: 0 0 2px; font-size: 15px; font-weight: 800; color: #000;">${escapeHtml(storeName)}</h2>
        ${phone ? `<div style="font-size: 10.5px; font-weight: 500; color: #111;">هاتف: ${escapeHtml(phone)}</div>` : ''}
        ${address ? `<div style="font-size: 9px; font-weight: 400; color: #333;">${escapeHtml(address)}</div>` : ''}
        <div style="margin-top: 4px; display: inline-block; padding: 2px 8px; border: 1px solid #000; border-radius: 4px; font-weight: 700; font-size: 10.5px; color: #000;">
          إيصال استلام جهاز للإصلاح (${escapeHtml(profile.shortTitle)})
        </div>
      </div>

      <div style="text-align: center; margin-bottom: 6px; border-bottom: 1px dashed #000; padding-bottom: 6px;">
        <div style="width: 100%; max-width: 200px; height: 42px; margin: 0 auto; display: block;">${barcodeSvg}</div>
        <div style="font-size: 16px; font-weight: 900; letter-spacing: 1.5px; font-family: monospace; color: #000; margin: 5px 0 2px; padding-top: 2px;">
          ${escapeHtml(ticket.ticketNo)}
        </div>
        <div style="font-size: 9.5px; font-weight: 400; color: #222;">تاريخ الاستلام: ${escapeHtml(dateFormatted)}</div>
      </div>

      <div style="border: 1px solid #000; border-radius: 4px; padding: 5px 6px; margin-bottom: 6px; font-size: 10px; line-height: 1.35; color: #000; box-sizing: border-box;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ccc; padding-bottom: 3px; margin-bottom: 3px;">
          <span>العميل: <strong style="font-weight: 700;">${escapeHtml(ticket.customerName)}</strong></span>
          <span dir="ltr" style="font-weight: 600; font-family: monospace;">${escapeHtml(ticket.customerPhone)}</span>
        </div>
        <div style="font-size: 10.5px; margin-bottom: 2px;">
          الجهاز: <strong style="font-weight: 700;">${escapeHtml(ticket.deviceBrand ? `${ticket.deviceBrand} - ` : '')}${escapeHtml(ticket.deviceModel)}</strong>
        </div>
        ${ticket.serialNumber ? `<div style="font-size: 9.5px; font-family: monospace;" dir="ltr">${escapeHtml(profile.serialLabel)}: ${escapeHtml(ticket.serialNumber)}</div>` : ''}
      </div>

      <div style="border: 1px solid #000; border-radius: 4px; padding: 5px 6px; margin-bottom: 6px; font-size: 10px; color: #000; box-sizing: border-box;">
        <div style="font-weight: 700; text-decoration: underline; margin-bottom: 2px;">العطل المشتكى منه:</div>
        <div style="font-weight: 500;">${escapeHtml(ticket.problemDescription)}</div>
        ${ticket.deviceCondition ? `<div style="font-size: 9px; font-weight: 400; margin-top: 3px; color: #222;">الحالة الظاهرية: ${escapeHtml(ticket.deviceCondition)}</div>` : ''}
      </div>

      <div style="border: 1px solid #000; border-radius: 4px; padding: 5px 6px; margin-bottom: 6px; font-size: 10px; color: #000; box-sizing: border-box;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
          <span>القيمة الإجمالية:</span>
          <span style="font-weight: 700;">${totalCost.toFixed(2)} ${getGlobalCurrencySymbol()}</span>
        </div>
        ${advancePaid > 0 ? `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <span>المدفوع مقدماً (عربون):</span>
            <span style="font-weight: 700;">${advancePaid.toFixed(2)} ${getGlobalCurrencySymbol()}</span>
          </div>
        ` : ''}
        ${ticket.status === 'delivered' ? `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; border-top: 1px dashed #000; padding-top: 2px;">
            <span>المحصل عند الاستلام:</span>
            <span style="font-weight: 700;">${collectedAtDelivery.toFixed(2)} ${getGlobalCurrencySymbol()}</span>
          </div>
        ` : ''}
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; font-weight: 900; border-top: 1px dashed #000; padding-top: 3px; margin-top: 2px;">
          <span>المتبقي:</span>
          <span>${ticket.status === 'delivered' ? `0.00 ${getGlobalCurrencySymbol()} (خالص بالكامل)` : `${remainingAmount.toFixed(2)} ${getGlobalCurrencySymbol()}`}</span>
        </div>
      </div>

      <div style="font-size: 8px; color: #222; line-height: 1.3; margin-bottom: 8px;">
        <strong>شروط الاستلام:</strong><br />
        • المركز غير مسؤول عن الأجهزة المتروكة لأكثر من 30 يوماً من تاريخ الإصلاح.<br />
        • المركز غير مسؤول عن فقدان البيانات (Data Loss) أثناء عمليات الصيانة أو السوفت وير.<br />
        • فترة الضمان على قطع الغيار المستبدلة ${ticket.warrantyDays || 30} يوماً بموجب هذا الإيصال.<br />
        • لا يتم تسليم الجهاز إلا بأصل هذا الإيصال.
      </div>

      <div style="display: flex; justify-content: space-between; border-top: 1px solid #000; padding-top: 6px; font-size: 9px; text-align: center;">
        <div>توقيع المستلم<br /><br />..........</div>
        <div>توقيع العميل<br /><br />..........</div>
      </div>
    </div>
  `;

  printHtmlDocument(`إيصال استلام ${ticket.ticketNo}`, html, {
    pageSize: 'receipt',
    extraStyles: `
      @page { margin: 0; }
      body { margin: 0; padding: 4px 6px; }
      .print-header, .print-footer, .brand-panel, .doc-panel { display: none !important; }
      .print-shell { padding: 0 !important; margin: 0 !important; width: 100% !important; max-width: 100% !important; }
      .print-content { padding: 0 !important; margin: 0 !important; gap: 0 !important; }
    `,
  });
}

export function printMaintenanceDeviceSticker(ticket: MaintenanceTicket, settings?: AppSettings | null, preset: '50x30' | '50x25' | '40x30' | '60x40' | '80-roll' = '50x30') {
  const barcodeSvg = buildCode128Svg(ticket.ticketNo);
  const dateFormatted = new Date(ticket.receivedAt).toLocaleDateString('ar-EG');
  const storeName = settings?.storeName || 'مركز الصيانة';

  let widthMm = 50;
  let heightMm = 30;
  if (preset === '50x25') { widthMm = 50; heightMm = 25; }
  else if (preset === '40x30') { widthMm = 40; heightMm = 30; }
  else if (preset === '60x40') { widthMm = 60; heightMm = 40; }
  else if (preset === '80-roll') { widthMm = 76; heightMm = 45; }

  const html = `
    <div class="sticker-card">
      <div class="sticker-header">${escapeHtml(storeName)}</div>
      <div class="sticker-barcode">${barcodeSvg}</div>
      <div class="sticker-code">${escapeHtml(ticket.ticketNo)}</div>
      <div class="sticker-body">
        <div class="sticker-row"><b>العميل:</b> ${escapeHtml(ticket.customerName)} (${escapeHtml(ticket.customerPhone)})</div>
        <div class="sticker-row"><b>الجهاز:</b> ${escapeHtml(ticket.deviceBrand ? `${ticket.deviceBrand} - ` : '')}${escapeHtml(ticket.deviceModel)}</div>
        <div class="sticker-row"><b>العطل:</b> ${escapeHtml(ticket.problemDescription)}</div>
      </div>
      <div class="sticker-footer">تاريخ الاستلام: ${escapeHtml(dateFormatted)}</div>
    </div>
  `;

  printHtmlDocument(`ستيكر ${ticket.ticketNo}`, html, {
    pageSize: 'receipt',
    extraStyles: `
      @page { size: ${widthMm}mm ${heightMm}mm; margin: 0 !important; }
      html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; width: ${widthMm}mm !important; height: ${heightMm}mm !important; overflow: hidden !important; }
      .print-header, .print-footer, .brand-panel, .doc-panel { display: none !important; }
      .print-shell { padding: 0 !important; margin: 0 !important; width: 100% !important; max-width: 100% !important; }
      .print-content { padding: 0 !important; margin: 0 !important; gap: 0 !important; }
      .sticker-card {
        width: ${widthMm}mm;
        height: ${heightMm}mm;
        max-width: ${widthMm}mm;
        max-height: ${heightMm}mm;
        box-sizing: border-box;
        padding: 1.2mm 2mm;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        text-align: center;
        font-family: Tahoma, Arial, sans-serif;
        color: #000;
        overflow: hidden;
      }
      .sticker-header {
        font-size: 8px;
        font-weight: 900;
        line-height: 1.1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        border-bottom: 0.5px solid #000;
        padding-bottom: 1px;
      }
      .sticker-barcode {
        width: 100%;
        height: 18px;
        margin: 1px auto 0;
      }
      .sticker-barcode svg {
        width: 100%;
        height: 100%;
        display: block;
      }
      .sticker-code {
        font-size: 11px;
        font-weight: 900;
        font-family: monospace;
        letter-spacing: 1.5px;
        line-height: 1;
        margin: 1px 0;
      }
      .sticker-body {
        text-align: right;
        font-size: 7.5px;
        line-height: 1.25;
        border-top: 0.5px solid #000;
        border-bottom: 0.5px solid #000;
        padding: 1px 0;
      }
      .sticker-row {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sticker-footer {
        font-size: 6.5px;
        color: #000;
        font-weight: 600;
        margin-top: 1px;
      }
    `,
  });
}

export async function exportMaintenanceReceiptPdf(ticket: MaintenanceTicket, settings?: Partial<AppSettings> | null) {
  const barcodeSvg = buildCode128Svg(ticket.ticketNo);
  /* D-M1-1: no discount concept — the final agreed amount is the total. */
  const totalCost = ticket.finalCost || ticket.expectedCost || 0;
  const advancePaid = ticket.advancePayment || 0;
  const netTotal = totalCost;
  const collectedAtDelivery = Math.max(0, netTotal - advancePaid);
  const remainingAmount = ticket.status === 'delivered' ? 0 : Math.max(0, netTotal - advancePaid);
  const dateFormatted = new Date(ticket.receivedAt).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
  const profile = getMaintenanceProfile(settings?.maintenanceProfile);
  const storeName = settings?.storeName || profile.title;
  const phone = settings?.phone || '';
  const address = settings?.address || '';

  const html = `
    <div style="width: 460px; margin: 0 auto; padding: 24px; background: #ffffff; color: #0f172a; font-family: Tahoma, Arial, sans-serif; direction: rtl; border: 1px solid #cbd5e1; border-radius: 12px; box-sizing: border-box;">
      <div style="text-align: center; border-bottom: 2px dashed #94a3b8; padding-bottom: 14px; margin-bottom: 14px;">
        <h2 style="margin: 0 0 4px; font-size: 22px; font-weight: 900; color: #0f172a;">${escapeHtml(storeName)}</h2>
        ${phone ? `<div style="font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 2px;">هاتف: ${escapeHtml(phone)}</div>` : ''}
        ${address ? `<div style="font-size: 11px; color: #64748b;">${escapeHtml(address)}</div>` : ''}
        <div style="margin-top: 8px; display: inline-block; background: #f1f5f9; border: 1px solid #cbd5e1; color: #0f172a; padding: 4px 14px; border-radius: 6px; font-weight: 800; font-size: 13px;">
          إيصال استلام جهاز للإصلاح (${escapeHtml(profile.shortTitle)})
        </div>
      </div>

      <div style="text-align: center; padding: 6px 0 14px; border-bottom: 2px dashed #94a3b8; margin-bottom: 14px;">
        <div style="width: 240px; height: 48px; margin: 0 auto 6px; display: block;">${barcodeSvg}</div>
        <div style="font-size: 19px; font-weight: 900; letter-spacing: 2px; font-family: monospace; color: #0284c7; margin: 6px 0 3px; padding-top: 2px;">
          ${escapeHtml(ticket.ticketNo)}
        </div>
        <div style="font-size: 11px; color: #64748b; margin-top: 3px; font-weight: 600;">
          تاريخ الاستلام: ${escapeHtml(dateFormatted)}
        </div>
      </div>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; font-size: 12px; line-height: 1.6;">
        <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin-bottom: 5px;">
          <span>العميل: <strong style="font-size: 13px;">${escapeHtml(ticket.customerName)}</strong></span>
          <span dir="ltr"><strong>${escapeHtml(ticket.customerPhone)}</strong></span>
        </div>
        <div style="font-size: 13px; font-weight: 800; margin-bottom: 3px; color: #0f172a;">
          الجهاز: ${escapeHtml(ticket.deviceBrand ? `${ticket.deviceBrand} - ` : '')}${escapeHtml(ticket.deviceModel)}
        </div>
        ${ticket.serialNumber ? `<div style="font-size: 11px; color: #64748b; font-family: monospace;" dir="ltr">${escapeHtml(profile.serialLabel)}: ${escapeHtml(ticket.serialNumber)}</div>` : ''}
      </div>

      <div style="margin-bottom: 14px;">
        <div style="font-weight: 800; color: #dc2626; font-size: 12px; margin-bottom: 3px;">العطل المشتكى منه:</div>
        <div style="background: #fef2f2; border: 1px solid #fee2e2; color: #991b1b; padding: 8px 12px; border-radius: 6px; font-weight: 700; font-size: 12px;">
          ${escapeHtml(ticket.problemDescription)}
        </div>
        ${ticket.deviceCondition ? `<div style="font-size: 11px; color: #475569; margin-top: 5px;">حالة الجهاز الظاهرية: <strong>${escapeHtml(ticket.deviceCondition)}</strong></div>` : ''}
      </div>

      <div style="border-top: 2px dashed #94a3b8; border-bottom: 2px dashed #94a3b8; padding: 10px 0; margin-bottom: 14px; font-size: 12px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span style="color: #64748b;">القيمة الإجمالية:</span>
          <strong style="font-size: 13px;">${totalCost.toFixed(2)} ${getGlobalCurrencySymbol()}</strong>
        </div>
        ${advancePaid > 0 ? `
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px; color: #16a34a;">
            <span>المدفوع مقدماً (عربون):</span>
            <strong style="font-size: 13px;">${advancePaid.toFixed(2)} ${getGlobalCurrencySymbol()}</strong>
          </div>
        ` : ''}
        ${ticket.status === 'delivered' ? `
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px; border-top: 1px dashed #cbd5e1; padding-top: 4px;">
            <span style="color: #64748b;">المحصل عند الاستلام:</span>
            <strong style="font-size: 13px;">${collectedAtDelivery.toFixed(2)} ${getGlobalCurrencySymbol()}</strong>
          </div>
        ` : ''}
        <div style="display: flex; justify-content: space-between; font-size: 15px; font-weight: 900; border-top: 1px dashed #cbd5e1; padding-top: 5px; margin-top: 4px;">
          <span>المتبقي:</span>
          <span style="color: #16a34a;">
            ${ticket.status === 'delivered' ? `0.00 ${getGlobalCurrencySymbol()} (خالص بالكامل)` : `${remainingAmount.toFixed(2)} ${getGlobalCurrencySymbol()}`}
          </span>
        </div>
      </div>

      <div style="font-size: 10px; color: #64748b; line-height: 1.4; margin-bottom: 16px;">
        <strong style="display: block; color: #334155; margin-bottom: 3px;">شروط الاستلام:</strong>
        <div style="padding-right: 4px;">
          • المركز غير مسؤول عن الأجهزة المتروكة لأكثر من 30 يوماً من تاريخ الإصلاح.<br />
          • المركز غير مسؤول عن فقدان البيانات (Data Loss) أثناء عمليات الصيانة أو السوفت وير.<br />
          • فترة الضمان على قطع الغيار المستبدلة ${ticket.warrantyDays || 30} يوماً بموجب هذا الإيصال.<br />
          • لا يتم تسليم الجهاز إلا بأصل هذا الإيصال أو إثبات الشخصية.
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 11px; text-align: center; color: #475569;">
        <div>توقيع المستلم / الفني<br /><br />.............................</div>
        <div>توقيع العميل<br /><br />.............................</div>
      </div>
    </div>
  `;

  const renderRoot = globalThis.document.createElement('div');
  renderRoot.setAttribute('aria-hidden', 'true');
  renderRoot.style.position = 'fixed';
  renderRoot.style.left = '-20000px';
  renderRoot.style.top = '0';
  renderRoot.style.width = '460px';
  renderRoot.style.opacity = '1';
  renderRoot.style.pointerEvents = 'none';
  renderRoot.innerHTML = html;
  globalThis.document.body.appendChild(renderRoot);

  try {
    const canvas = await html2canvas(renderRoot, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
    });

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [80, Math.max(120, (canvas.height * 80) / canvas.width)],
    });

    const pdfWidth = 80;
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdfWidth, pdfHeight);
    pdf.save(`ايصال_صيانة_${ticket.ticketNo}.pdf`);
  } catch (err) {
    console.error('Failed to generate PDF receipt:', err);
  } finally {
    renderRoot.remove();
  }
}
