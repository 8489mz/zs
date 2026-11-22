import type { MaritimeJob, MaritimeContainer } from '../../api/maritime-freight.api';
import { escapeHtml, getTrackingQrCode } from './print-helpers';

/**
 * Generates and prints an official Delivery Order (إذن التسليم الملاحي - D/O)
 * addressed to the Port Terminal & Customs Clearance Authorities.
 */
export function printDeliveryOrder(job: MaritimeJob, containers: MaritimeContainer[] = [], companyName = 'منظومة Z-Systems للشحن الملاحي') {
  const printWindow = window.open('', '_blank', 'width=950,height=1000');
  if (!printWindow) return;

  const containersList = containers.length > 0 ? containers : (job.containers || []);
  const doNumber = `DO-${escapeHtml(job.job_number)}`;

  const containerListHtml = containersList.map((c, i) => `
    <tr>
      <td style="text-align: center;">${i + 1}</td>
      <td style="font-family: monospace; font-weight: 800; color: #170e5e;">${escapeHtml(c.container_number)}</td>
      <td>${escapeHtml(c.container_type)}</td>
      <td style="font-family: monospace;">${escapeHtml(c.seal_number || '—')}</td>
      <td>${c.free_days || 14} يوم</td>
      <td style="font-weight: 700; color: #dc2626;">${c.return_deadline || '—'}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8" />
        <title>إذن تسليم ملاحي - ${doNumber}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 12px; color: #0f172a; margin: 0; padding: 20px; line-height: 1.5; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #170e5e; padding-bottom: 15px; margin-bottom: 20px; }
          .brand { font-size: 20px; font-weight: 900; color: #170e5e; }
          .do-badge { background: #eff6ff; border: 2px solid #3b82f6; border-radius: 8px; padding: 10px 18px; text-align: center; }
          .do-badge h3 { margin: 0; font-size: 16px; color: #1e40af; }
          .do-badge span { font-family: monospace; font-size: 14px; font-weight: 800; }

          .addressee-box { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px 18px; margin-bottom: 20px; }
          .addressee-title { font-weight: 800; font-size: 13px; color: #170e5e; margin-bottom: 6px; }

          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px; }
          .info-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; }
          .info-row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 11.5px; }
          .info-row span:first-child { color: #64748b; font-weight: 600; }
          .info-row span:last-child { font-weight: 700; color: #0f172a; }

          table { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
          th { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 8px 10px; font-size: 11px; font-weight: 800; color: #334155; text-align: right; }
          td { border: 1px solid #e2e8f0; padding: 8px 10px; font-size: 11.5px; }

          .terms-box { border: 1px dashed #f59e0b; background: #fffbeb; padding: 12px 15px; border-radius: 8px; font-size: 11px; color: #92400e; margin-bottom: 25px; line-height: 1.6; }
          .stamp-area { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; text-align: center; margin-top: 30px; }
          .stamp-box { border: 1px dashed #94a3b8; border-radius: 8px; padding: 15px 10px; min-height: 80px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand">${escapeHtml(companyName)}</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">قطاع الشحن الملاحي واللوجستيات والموانئ</div>
            <div style="font-size: 11px; color: #475569; margin-top: 2px;">تاريخ الإصدار: <strong>${new Date().toLocaleDateString('ar-EG')}</strong></div>
          </div>
          <div class="do-badge" style="display: flex; align-items: center; gap: 14px;">
            <div style="text-align: right;">
              <h3 style="margin: 0; font-size: 15px; color: #1e40af;">إذن تسليم ملاحي (DELIVERY ORDER)</h3>
              <span>رقم الإذن: ${doNumber}</span>
              <div style="font-size: 10px; color: #475569; margin-top: 3px;">أمر التشغيل: <strong>${escapeHtml(job.job_number)}</strong></div>
            </div>
            ${job.tracking_token || job.job_number ? `
            <div style="display: flex; flex-direction: column; align-items: center; border: 1px solid #bfdbfe; padding: 4px; border-radius: 6px; background: #ffffff;">
              ${getTrackingQrCode(job.tracking_token || job.job_number, 56)}
              <span style="font-size: 7px; font-weight: 800; color: #1e40af; margin-top: 2px;">تتبع الشحنة</span>
            </div>
            ` : ''}
          </div>
        </div>

        <div class="addressee-box">
          <div class="addressee-title">إلى السادة / هيئة الميناء ومصلحة الجمارك ومحطة الحاويات بميناء (${escapeHtml(job.pod_name)}):</div>
          <div>نرجو التكرم بتسليم الشحنة والحاويات المبينة بياناتها أدناه إلى السادة: <strong>${escapeHtml(job.customer_name)}</strong> أو من ينوب عنهم رسمياً من السادة المستخلصين الجمركيين المعتمدين، وذلك بعد سداد كافة الرسوم الجمركية والمصروفات المينائية المقررة طبقاً للأصول المتبعة.</div>
        </div>

        <div class="info-grid">
          <div class="info-card">
            <div class="info-row"><span>رقم أمر التشغيل (Job No):</span><span>${escapeHtml(job.job_number)}</span></div>
            <div class="info-row"><span>رقم البوليصة الملاحية (B/L):</span><span>${escapeHtml(job.hbl_number || job.mbl_number || '—')}</span></div>
            <div class="info-row"><span>الخط الملاحي الناقل:</span><span>${escapeHtml(job.shipping_line_name)}</span></div>
            <div class="info-row"><span>رقم الحجز (Booking No):</span><span>${escapeHtml(job.booking_number || '—')}</span></div>
          </div>
          <div class="info-card">
            <div class="info-row"><span>اسم السفينة (Vessel):</span><span>${escapeHtml(job.vessel_name || '—')}</span></div>
            <div class="info-row"><span>رقم الرحلة (Voyage):</span><span>${escapeHtml(job.voyage_number || '—')}</span></div>
            <div class="info-row"><span>ميناء الشحن (POL):</span><span>${escapeHtml(job.pol_name)} (${escapeHtml(job.pol_code)})</span></div>
            <div class="info-row"><span>ميناء الوصول (POD):</span><span>${escapeHtml(job.pod_name)} (${escapeHtml(job.pod_code)})</span></div>
          </div>
        </div>

        <h4 style="margin: 0 0 10px; color: #170e5e; font-size: 13px;">بيان الحاويات المفرجة والمصرح بخروجها:</h4>
        <table>
          <thead>
            <tr>
              <th style="width: 30px; text-align: center;">#</th>
              <th>رقم الحاوية (Container No)</th>
              <th>المقاس والنوع</th>
              <th>رقم السيل الملاحي (Seal)</th>
              <th>أيام السماح (Free Days)</th>
              <th>تاريخ مهلة الإرجاع الأخير</th>
            </tr>
          </thead>
          <tbody>
            ${containerListHtml || '<tr><td colspan="6" style="text-align: center; color: #94a3b8;">لا توجد حاويات مسجلة</td></tr>'}
          </tbody>
        </table>

        <div class="terms-box">
          <strong>تنبيه هام بشأن الحاويات الفارغة:</strong><br/>
          يلتزم المستورد أو المستخلص المفوض بإعادة الحاويات فارغة ونظيفة وبحالة سليمة تماماً إلى ساحة الخط الملاحي المعتمدة بالميناء قبل انقضاء تاريخ مهلة الإرجاع الموضح بالجدول أعلاه، تجنباً لاحتساب غرامات الأرضيات والتأخير اليومية المقررة طبقاً للائحة التوكيل الملاحي.
        </div>

        <div class="stamp-area">
          <div class="stamp-box">
            <div style="font-weight: 700; color: #475569;">توقيع وخاتم التوكيل الملاحي / وكيل الشحن</div>
            <div style="margin-top: 35px; font-weight: 800; color: #170e5e;">${escapeHtml(companyName)}</div>
          </div>
          <div class="stamp-box">
            <div style="font-weight: 700; color: #475569;">اعتماد مصلحة الجمارك</div>
          </div>
          <div class="stamp-box">
            <div style="font-weight: 700; color: #475569;">أمن وبوابة خروج الميناء</div>
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
