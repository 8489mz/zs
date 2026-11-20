import type { VanLoadRequisitionRecord } from '../../api/van-sales.api';
import type { AppSettings } from '@/types/domain';
import { printSmallReceiptDocument } from '@/lib/small-receipt-printer';
import { toast } from '@/shared/components/system-alert';

export interface PrintRequisitionOptions {
  defaultPaperSize: 'a4' | 'receipt';
  settings: AppSettings | undefined;
}

export function printRequisition(
  req: VanLoadRequisitionRecord,
  { defaultPaperSize, settings }: PrintRequisitionOptions,
  preferredFormat?: 'a4' | 'receipt',
) {
    const format = preferredFormat || defaultPaperSize;

    if (format === 'receipt') {
      const storeName = settings?.storeName || settings?.brandName || 'منظومة Z-ERP';
      const items = (req.approvedItems && req.approvedItems.length > 0 ? req.approvedItems : req.requestedItems) || [];
      const totalPieces = items.reduce((sum: number, it: any) => sum + (Number(it.qty) || 0), 0);
      const now = new Date(req.createdAt);
      const dateStr = now.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' });
      const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });

      const statusLabel =
        req.status === 'dispatched' ? 'تم الصرف' : req.status === 'pending' ? 'قيد المراجعة' : 'مرفوض';

      const esc = (s: any) =>
        String(s ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');

      const rowsHtml = items
        .map(
          (it: any, idx: number) => `
          <tr style="border-bottom: 1px dashed #bbb;">
            <td style="text-align: right; padding: 5px 0; font-size: 11px; vertical-align: top;">
              <div style="font-weight: 800; color: #000; line-height: 1.35; margin-bottom: 2px;">
                ${idx + 1}. ${esc(it.productName || 'صنف')}
              </div>
              ${it.barcode ? `<div style="font-size: 9.5px; color: #555; font-family: monospace; letter-spacing: 0.5px;">${esc(it.barcode)}</div>` : ''}
              ${it.packingText ? `<div style="font-size: 10px; font-weight: 700; color: #170e5e; margin-top: 2px;">[ ${esc(it.packingText)} ]</div>` : ''}
            </td>
            <td style="text-align: left; vertical-align: top; padding: 5px 0; white-space: nowrap;">
              <span style="display: inline-block; border: 1.5px solid #000; border-radius: 4px; padding: 2px 6px; font-weight: 900; font-size: 13px; color: #000; background: #fff;">
                ${it.qty} <span style="font-size: 10px; font-weight: 600; color: #333;">${esc(it.unitName || it.unit || 'قطعة')}</span>
              </span>
            </td>
          </tr>
        `,
        )
        .join('');

      const thermalHtml = `
        <div style="font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; direction: rtl; text-align: right; color: #000;">
          <div style="text-align: center; border-bottom: 2px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
            <div style="font-size: 15px; font-weight: 900; color: #000;">${esc(storeName)}</div>
            <div style="font-size: 12px; font-weight: 800; margin-top: 3px;">إذن صرف وتحميل بضاعة</div>
            <div style="font-size: 14px; font-weight: 900; font-family: monospace; margin-top: 4px; direction: ltr; text-align: center;">#${esc(req.docNo)}</div>
            <div style="font-size: 10.5px; color: #444; margin-top: 3px;">${dateStr} - ${timeStr}</div>
          </div>

          <table style="width: 100%; border-collapse: collapse; font-size: 10.5px; line-height: 1.5; margin-bottom: 6px; border-bottom: 1px dashed #000; padding-bottom: 4px;">
            <tr>
              <td style="text-align: right; color: #333; padding: 2px 0;">المندوب:</td>
              <td style="text-align: left; font-weight: 800; color: #000; padding: 2px 0;">${esc(req.repName)}</td>
            </tr>
            <tr>
              <td style="text-align: right; color: #333; padding: 2px 0;">المركبة:</td>
              <td style="text-align: left; font-weight: 800; color: #000; padding: 2px 0;">${esc(req.vehiclePlate || '—')}</td>
            </tr>
            <tr>
              <td style="text-align: right; color: #333; padding: 2px 0;">المستودع المصدر:</td>
              <td style="text-align: left; font-weight: 800; color: #000; padding: 2px 0;">${esc(req.sourceWarehouseName)}</td>
            </tr>
            ${
              req.tripId
                ? `
            <tr>
              <td style="text-align: right; color: #333; padding: 2px 0;">رقم الرحلة:</td>
              <td style="text-align: left; font-weight: 800; color: #000; padding: 2px 0;">#${esc(req.tripId)}</td>
            </tr>`
                : ''
            }
            <tr>
              <td style="text-align: right; color: #333; padding: 2px 0;">حالة الإذن:</td>
              <td style="text-align: left; font-weight: 800; color: #000; padding: 2px 0;">${statusLabel}</td>
            </tr>
          </table>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px;">
            <thead>
              <tr style="border-bottom: 1.5px solid #000;">
                <th style="text-align: right; padding: 3px 0; font-size: 11px;">الصنف والباركود</th>
                <th style="text-align: left; padding: 3px 0; font-size: 11px; width: 65px;">الكمية</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>

          <div style="border-top: 2px dashed #000; border-bottom: 2px dashed #000; padding: 6px 0; margin-bottom: 10px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
              <tr>
                <td style="text-align: right; font-weight: 700; padding: 2px 0;">عدد الأصناف:</td>
                <td style="text-align: left; font-weight: 800; padding: 2px 0;">${items.length} صنف</td>
              </tr>
              <tr>
                <td style="text-align: right; font-weight: 900; font-size: 12.5px; padding: 3px 0;">إجمالي القطع المنصرفة:</td>
                <td style="text-align: left; font-weight: 900; font-size: 13.5px; padding: 3px 0; white-space: nowrap;">${totalPieces} قطعة</td>
              </tr>
            </table>
          </div>

          <table style="width: 100%; border-collapse: collapse; margin-top: 14px; margin-bottom: 12px; font-size: 10.5px;">
            <tr>
              <td style="text-align: center; width: 48%; padding: 0 4px; vertical-align: top;">
                <div style="font-weight: 700; margin-bottom: 26px;">توقيع الصارف (المستودع)</div>
                <div style="border-bottom: 1px dashed #000; width: 85%; margin: 0 auto;"></div>
              </td>
              <td style="width: 4%;"></td>
              <td style="text-align: center; width: 48%; padding: 0 4px; vertical-align: top;">
                <div style="font-weight: 700; margin-bottom: 26px;">توقيع المستلم (المندوب)</div>
                <div style="border-bottom: 1px dashed #000; width: 85%; margin: 0 auto;"></div>
              </td>
            </tr>
          </table>

          <div style="text-align: center; font-size: 9.5px; color: #555; border-top: 1px dotted #ccc; padding-top: 6px;">
            منظومة Z-ERP للتوزيع الميداني
          </div>
        </div>
      `;

      printSmallReceiptDocument(thermalHtml, {
        title: `إذن صرف #${req.docNo}`,
        widthMm: 80,
        marginMm: 2,
        fontSizePx: 11,
      });
      return;
    }

    const printWindow = window.open('', '_blank', 'width=840,height=900');
    if (!printWindow) {
      toast.error('يرجى السماح بالنوافذ المنبثقة للطباعة');
      return;
    }

    const storeName = settings?.storeName || settings?.brandName || 'منظومة Z-ERP';
    const items = (req.approvedItems && req.approvedItems.length > 0 ? req.approvedItems : req.requestedItems) || [];
    const totalPieces = items.reduce((sum: number, it: any) => sum + (Number(it.qty) || 0), 0);
    const dateFormatted = new Date(req.createdAt).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const statusLabel =
      req.status === 'dispatched' ? 'تم الصرف' : req.status === 'pending' ? 'قيد المراجعة' : 'مرفوض';

    const esc = (s: any) =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const rowsHtml = items
      .map(
        (it: any, idx: number) => `
        <tr style="border-bottom: 1px solid #cbd5e1;">
          <td style="padding: 10px 8px; border: 1px solid #94a3b8; text-align: center; font-weight: 700; color: #334155;">${idx + 1}</td>
          <td style="padding: 10px 8px; border: 1px solid #94a3b8; font-family: monospace; text-align: center; font-size: 12px; color: #334155;">${esc(it.barcode || '—')}</td>
          <td style="padding: 10px 12px; border: 1px solid #94a3b8; text-align: right; font-weight: 700; color: #0f172a; line-height: 1.45;">${esc(it.productName || 'صنف')}</td>
          <td style="padding: 10px 8px; border: 1px solid #94a3b8; text-align: center; font-weight: 700; color: #170e5e; font-size: 12px; background: #f8fafc;">${esc(it.packingText || '—')}</td>
          <td style="padding: 10px 8px; border: 1px solid #94a3b8; text-align: center; font-size: 14px; font-weight: 900; color: #0f172a;">${it.qty} ${esc(it.unitName || it.unit || '')}</td>
          <td style="padding: 10px 8px; border: 1px solid #94a3b8; text-align: center; color: #94a3b8;"></td>
        </tr>
      `,
      )
      .join('');

    const html = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8" />
          <title>إذن صرف وتحميل بضاعة - ${req.docNo}</title>
          <style>
            @page {
              size: A4 portrait;
              margin: 12mm 15mm;
            }
            *, *::before, *::after {
              box-sizing: border-box;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            body {
              font-family: 'Cairo', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              direction: rtl;
              color: #0f172a;
              margin: 0;
              padding: 0;
              font-size: 12.5px;
              line-height: 1.5;
              background: #fff;
              -webkit-font-smoothing: antialiased;
            }
            .header-table {
              width: 100%;
              border-bottom: 2.5px solid #170e5e;
              padding-bottom: 12px;
              margin-bottom: 14px;
            }
            .meta-card {
              background: #f8fafc;
              border: 1.5px solid #cbd5e1;
              border-radius: 8px;
              padding: 10px 16px;
              margin-bottom: 16px;
            }
            .meta-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 12px;
            }
            .meta-table td {
              padding: 4px 6px;
              vertical-align: middle;
            }
            .meta-label {
              color: #475569;
              font-weight: 600;
              width: 120px;
            }
            .meta-value {
              color: #0f172a;
              font-weight: 800;
            }
            table.items {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 18px;
            }
            table.items th {
              background: #170e5e !important;
              color: #ffffff !important;
              padding: 10px 8px;
              border: 1px solid #170e5e;
              font-size: 12px;
              font-weight: 800;
              text-align: center;
            }
            table.items td {
              vertical-align: middle;
            }
            .summary-box {
              display: flex;
              justify-content: space-between;
              align-items: center;
              background: #f1f5f9;
              border: 1.5px solid #cbd5e1;
              border-radius: 8px;
              padding: 10px 18px;
              margin-bottom: 28px;
              font-size: 13px;
              font-weight: 700;
              color: #1e293b;
            }
            .summary-box b {
              color: #170e5e;
              font-size: 15px;
            }
            .signatures-grid {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 16px;
              margin-top: 24px;
            }
            .sig-card {
              border: 1px solid #cbd5e1;
              border-radius: 8px;
              padding: 10px 14px;
              background: #fafafa;
              text-align: center;
            }
            .sig-title {
              font-size: 12px;
              font-weight: 800;
              color: #1e293b;
              padding-bottom: 6px;
              border-bottom: 1px dashed #cbd5e1;
            }
            .sig-space {
              height: 48px;
            }
            .sig-footer {
              font-size: 11px;
              font-weight: 600;
              color: #475569;
              border-top: 1px dashed #94a3b8;
              padding-top: 6px;
            }
            .doc-footer {
              margin-top: 20px;
              text-align: center;
              font-size: 10px;
              color: #64748b;
              border-top: 1px dotted #cbd5e1;
              padding-top: 6px;
            }
          </style>
        </head>
        <body>
          <table class="header-table">
            <tr>
              <td style="vertical-align: middle;">
                <div style="font-size: 19px; font-weight: 900; color: #170e5e; line-height: 1.2;">${esc(storeName)}</div>
                <div style="font-size: 12.5px; font-weight: 700; color: #475569; margin-top: 3px;">إذن صرف وتحميل بضاعة لسيارة التوزيع الميداني (Van Sales)</div>
              </td>
              <td style="text-align: left; vertical-align: middle;">
                <div style="font-size: 17px; font-weight: 900; color: #170e5e; font-family: monospace; direction: ltr; text-align: left;">#${esc(req.docNo)}</div>
                <div style="font-size: 11px; color: #64748b; margin-top: 3px;">${dateFormatted}</div>
              </td>
            </tr>
          </table>

          <div class="meta-card">
            <table class="meta-table">
              <tr>
                <td class="meta-label">مندوب التوزيع (السائق):</td>
                <td class="meta-value">${esc(req.repName)}</td>
                <td class="meta-label">المستودع المصدر:</td>
                <td class="meta-value">${esc(req.sourceWarehouseName)}</td>
              </tr>
              <tr>
                <td class="meta-label">رقم لوحة المركبة:</td>
                <td class="meta-value">${esc(req.vehiclePlate || '—')}</td>
                <td class="meta-label">مستودع الفان المتنقل:</td>
                <td class="meta-value">${esc(req.vanLocationName || 'مستودع سيارة المندوب')}</td>
              </tr>
              <tr>
                <td class="meta-label">رقم رحلة التوزيع:</td>
                <td class="meta-value">${req.tripId ? '#' + esc(req.tripId) : '—'}</td>
                <td class="meta-label">حالة الإذن:</td>
                <td class="meta-value">${statusLabel}</td>
              </tr>
            </table>
          </div>

          <table class="items">
            <thead>
              <tr>
                <th style="width: 45px;">م</th>
                <th style="width: 130px;">الباركود</th>
                <th style="text-align: right; padding-right: 14px;">بيان الصنف والمواصفات</th>
                <th style="width: 140px;">بيان التعبئة</th>
                <th style="width: 100px;">الكمية المنصرفة</th>
                <th style="width: 130px;">ملاحظات الفحص والمطابقة</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>

          <div class="summary-box">
            <div>إجمالي عدد البنود: <b>${items.length}</b> صنف</div>
            <div>إجمالي الكمية المنصرفة: <b>${totalPieces}</b> قطعة / وحدة</div>
          </div>

          <div class="signatures-grid">
            <div class="sig-card">
              <div class="sig-title">أمين المستودع (الصارف)</div>
              <div class="sig-space"></div>
              <div class="sig-footer">الاسم والتوقيع: ............................</div>
            </div>
            <div class="sig-card">
              <div class="sig-title">مندوب الفان (المستلم)</div>
              <div class="sig-space"></div>
              <div class="sig-footer">الاسم والتوقيع: ............................</div>
            </div>
            <div class="sig-card">
              <div class="sig-title">مشرف الحركة والاعتماد</div>
              <div class="sig-space"></div>
              <div class="sig-footer">الاعتماد والختم: ............................</div>
            </div>
          </div>

          <div class="doc-footer">
            منظومة Z-ERP لإدارة التوزيع والأسطول الميداني — تم استخراج هذا الإذن آلياً
          </div>

          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
}
