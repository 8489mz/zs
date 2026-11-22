import type { MaritimeJob } from '../../api/maritime-freight.api';
import { escapeHtml, getTrackingQrCode } from './print-helpers';

/**
 * Generates and prints an Inland Trucking Dispatch Waybill / CMR Consignment Note (PDF)
 * for terminal-to-warehouse delivery operations.
 */
export function printTruckingWaybill(
  job: MaritimeJob,
  container?: any,
  companyName = 'منظومة Z-Systems للخدمات اللوجستية والنقل البري',
) {
  const printWindow = window.open('', '_blank', 'width=950,height=1000');
  if (!printWindow) return;

  const waybillNo = `TRK-${escapeHtml(job.job_number)}-${container?.container_number ? container.container_number.slice(-4) : '01'}`;

  const html = `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8" />
        <title>بوليصة نقل بري - ${waybillNo}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 11.5px; color: #0f172a; margin: 0; padding: 20px; line-height: 1.5; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #170e5e; padding-bottom: 12px; margin-bottom: 16px; }
          .brand { font-size: 18px; font-weight: 900; color: #170e5e; }
          .wb-badge { background: #f8fafc; border: 1.5px solid #170e5e; border-radius: 6px; padding: 8px 14px; text-align: right; }

          .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
          .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; }
          .card-title { font-size: 11px; font-weight: 800; color: #170e5e; margin-bottom: 6px; border-bottom: 1px solid #f1f5f9; padding-bottom: 3px; }
          .row { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 11px; }
          .row span:first-child { color: #64748b; font-weight: 600; }
          .row span:last-child { font-weight: 700; color: #0f172a; }

          .cargo-banner { background: #eff6ff; border: 1.5px solid #3b82f6; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
          .cargo-item strong { display: block; font-size: 10px; color: #1e40af; text-transform: uppercase; }
          .cargo-item span { font-size: 14px; font-weight: 800; color: #0f172a; font-family: monospace; }

          .sign-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-top: 35px; text-align: center; }
          .sign-box { border-top: 1px dashed #64748b; padding-top: 8px; font-size: 10.5px; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand">${escapeHtml(companyName)}</div>
            <div style="font-size: 10.5px; color: #64748b;">بوليصة وإذن شحن ونقل بري داخلي (TRUCKING WAYBILL / CMR)</div>
            <div style="font-size: 11px; color: #1e293b; margin-top: 3px;">تاريخ التحميل: <strong>${new Date().toLocaleDateString('ar-EG')}</strong></div>
          </div>
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="wb-badge">
              <div style="font-size: 13px; font-weight: 800; color: #170e5e;">إذن تحميل ونقل بري</div>
              <div style="font-family: monospace; font-size: 13px; font-weight: 800;">${waybillNo}</div>
              <div style="font-size: 9.5px; color: #64748b;">Job: #${escapeHtml(job.job_number)}</div>
            </div>
            <div style="display: flex; flex-direction: column; align-items: center; border: 1px solid #cbd5e1; padding: 4px; border-radius: 6px; background: #ffffff;">
              ${getTrackingQrCode(job.tracking_token || job.job_number, 50)}
              <span style="font-size: 6.5px; font-weight: 700; color: #170e5e; margin-top: 2px;">تتبع الشحنة</span>
            </div>
          </div>
        </div>

        <div class="cargo-banner">
          <div class="cargo-item">
            <strong>رقم الحاوية (Container No):</strong>
            <span>${container?.container_number || 'حاوية الشحنة'}</span>
          </div>
          <div class="cargo-item">
            <strong>المقاس والنوع:</strong>
            <span>${container?.container_type || "40' HC"}</span>
          </div>
          <div class="cargo-item">
            <strong>رقم السيل الملاحي:</strong>
            <span>${container?.seal_number || '—'}</span>
          </div>
          <div class="cargo-item">
            <strong>الوزن الإجمالي:</strong>
            <span>${container?.gross_weight_kg ? Number(container.gross_weight_kg).toLocaleString() + ' KG' : '—'}</span>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card-title">نقطة التحميل والانطلاق (ORIGIN / DISPATCH)</div>
            <div class="row"><span>الموقع:</span><span>ساحة الميناء ومحطة الحاويات</span></div>
            <div class="row"><span>الميناء:</span><span>${escapeHtml(job.pod_name)} (${escapeHtml(job.pod_code)})</span></div>
            <div class="row"><span>الخط الملاحي:</span><span>${escapeHtml(job.shipping_line_name)}</span></div>
            <div class="row"><span>بوليصة الشحن B/L:</span><span>${escapeHtml(job.hbl_number || job.mbl_number || '—')}</span></div>
          </div>

          <div class="card">
            <div class="card-title">نقطة الوصول والتسليم (DESTINATION / CONSIGNEE)</div>
            <div class="row"><span>العميل المستلم:</span><span>${escapeHtml(job.customer_name)}</span></div>
            <div class="row"><span>عنوان المستودع:</span><span>${escapeHtml(job.consignee_details || '—')}</span></div>
            <div class="row"><span>هاتف المستلم:</span><span>${job.customer_phone || '—'}</span></div>
            <div class="row"><span>تعليمات التفريغ:</span><span>تفريغ مباشر وإعادة الحاوية فارغة ونظيفة للساحة</span></div>
          </div>
        </div>

        <div class="card" style="margin-bottom: 20px;">
          <div class="card-title">بيانات الشاحنة والسائق المفوض بالاستلام (TRUCK & DRIVER SPECIFICATION)</div>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; font-size: 11px;">
            <div>رقم لوحة الشاحنة: <strong style="color: #170e5e;">ن ق د ٥٨٢١</strong></div>
            <div>رقم لوحة المقطورة: <strong style="color: #170e5e;">ط ر ب ٩١٣٤</strong></div>
            <div>اسم السائق: <strong>سائق النقل المعتمد</strong></div>
            <div>الرقم القومي / رخصة القيادة: <strong>٢٨٩٠٤١٥٠١٠٢٢٣٣</strong></div>
            <div>رقم هاتف السائق: <strong>٠١٠٩٩٨٨٧٧٦٦</strong></div>
            <div>شركة النقل البري: <strong>أسطول النقل اللوجستي المعتمد</strong></div>
          </div>
        </div>

        <div class="sign-grid">
          <div class="sign-box">
            ضابط التحميل بساحة الميناء<br/>
            <strong>Terminal Dispatch Agent</strong>
          </div>
          <div class="sign-box">
            توقيع واستلام السائق<br/>
            <strong>Driver Signature</strong>
          </div>
          <div class="sign-box">
            أمين مستودع العميل المستلم<br/>
            <strong>Consignee Storekeeper</strong>
          </div>
        </div>
      </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 400);
}
