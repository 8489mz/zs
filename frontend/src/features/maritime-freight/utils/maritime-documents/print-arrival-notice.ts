import type { MaritimeJob, MaritimeContainer } from '../../api/maritime-freight.api';
import { escapeHtml, getTrackingQrCode } from './print-helpers';

/**
 * Generates and prints an Arrival Notice & Cargo Manifest for the consignee.
 */
export function printArrivalNotice(job: MaritimeJob, containers: MaritimeContainer[] = [], companyName = 'منظومة Z-Systems للشحن الملاحي') {
  const printWindow = window.open('', '_blank', 'width=950,height=1000');
  if (!printWindow) return;

  const containersList = containers.length > 0 ? containers : (job.containers || []);

  const html = `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8" />
        <title>إشعار وصول شحنة - ${escapeHtml(job.job_number)}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 12px; color: #0f172a; margin: 0; padding: 25px; line-height: 1.6; }
          .header { border-bottom: 2px solid #170e5e; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
          .title { font-size: 20px; font-weight: 900; color: #170e5e; }
          .notice-card { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 15px 20px; margin-bottom: 20px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px; }
          .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; }
          table { width: 100%; border-collapse: collapse; margin-top: 15px; }
          th { background: #f8fafc; border: 1px solid #cbd5e1; padding: 8px; font-size: 11px; text-align: right; }
          td { border: 1px solid #e2e8f0; padding: 8px; font-size: 11px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="title">إشعار وصول شحنة ملاحية (ARRIVAL NOTICE)</div>
            <div style="font-size: 11px; color: #64748b;">${escapeHtml(companyName)} — عمليات الموانئ والتخليص</div>
          </div>
          <div style="display: flex; align-items: center; gap: 14px;">
            <div style="text-align: left; font-weight: 700; color: #170e5e; font-size: 11px;">
              التاريخ: ${new Date().toLocaleDateString('ar-EG')}<br/>
              الملف: #${escapeHtml(job.job_number)}
            </div>
            ${job.tracking_token || job.job_number ? `
            <div style="display: flex; flex-direction: column; align-items: center; border: 1px solid #cbd5e1; padding: 4px; border-radius: 6px; background: #ffffff;">
              ${getTrackingQrCode(job.tracking_token || job.job_number, 52)}
              <span style="font-size: 7px; font-weight: 700; color: #170e5e; margin-top: 2px;">رادار الشحنة</span>
            </div>
            ` : ''}
          </div>
        </div>

        <div class="notice-card">
          السادة / <strong>${escapeHtml(job.customer_name)}</strong> المحترمون،<br/>
          يسعدنا إحاطة سيادتكم بوصول السفينة الناقلة لشحنتكم إلى ميناء الوصول المبين أدناه. يرجى التكرم ببدء تجهيز المستندات وسداد الرسوم لاستلام إذن التسليم الملاحي (D/O).
        </div>

        <div class="grid">
          <div class="card">
            <div>السفينة: <strong>${escapeHtml(job.vessel_name || '—')}</strong></div>
            <div>رقم الرحلة: <strong>${escapeHtml(job.voyage_number || '—')}</strong></div>
            <div>الخط الملاحي: <strong>${escapeHtml(job.shipping_line_name)}</strong></div>
            <div>رقم البوليصة: <strong>${escapeHtml(job.hbl_number || job.mbl_number || '—')}</strong></div>
          </div>
          <div class="card">
            <div>ميناء الشحن: <strong>${escapeHtml(job.pol_name)}</strong></div>
            <div>ميناء الوصول: <strong>${escapeHtml(job.pod_name)}</strong></div>
            <div>موعد الوصول الفعلي/المتوقع: <strong>${job.eta || 'قيد المتابعة'}</strong></div>
            <div>شرط السداد: <strong>${job.payment_term === 'collect' ? 'Freight Collect (تحصيل)' : 'Freight Prepaid (مدفوع مقدماً)'}</strong></div>
          </div>
        </div>

        <h4 style="margin: 15px 0 5px; color: #170e5e;">الحاويات ومواصفات الشحنة (${containersList.length} حاوية):</h4>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>رقم الحاوية</th>
              <th>النوع والمقاس</th>
              <th>رقم السيل</th>
              <th>الوزن الإجمالي</th>
              <th>فترة السماح بالميناء</th>
            </tr>
          </thead>
          <tbody>
            ${containersList.map((c, i) => `
              <tr>
                <td>${i + 1}</td>
                <td style="font-family: monospace; font-weight: bold;">${escapeHtml(c.container_number)}</td>
                <td>${escapeHtml(c.container_type)}</td>
                <td>${escapeHtml(c.seal_number || '—')}</td>
                <td>${Number(c.gross_weight_kg || 0).toLocaleString()} كجم</td>
                <td>${c.free_days || 14} يوم من التفريغ</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div style="margin-top: 35px; border-top: 1px solid #e2e8f0; padding-top: 15px; font-size: 11px; color: #64748b; text-align: center;">
          لأي استفسارات بخصوص إجراءات الإفراج أو سداد النولون يرجى التواصل مع فريق العمليات اللوجستية لدى ${escapeHtml(companyName)}.
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
