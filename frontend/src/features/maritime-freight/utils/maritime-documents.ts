import { MaritimeJob, MaritimeContainer, MaritimeQuotation } from '../api/maritime-freight.api';
import { buildQrSvg } from '@/lib/qrcode';
import { todayLocalDateKey } from '@/lib/format';

export function escapeHtml(str?: string | number | null): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getTrackingQrCode(trackingRef?: string | null, size = 70): string {
  if (!trackingRef || !String(trackingRef).trim()) return '';
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://app.z-systems.com';
  const trackingUrl = `${baseUrl}/public/track/${encodeURIComponent(String(trackingRef).trim())}`;
  return buildQrSvg(trackingUrl, { size, quietZone: 1, color: '#170e5e', bgColor: '#ffffff' });
}

/**
 * Generates and prints a standardized Maritime Bill of Lading (B/L)
 * conforming to FIATA/BIMCO multimodal freight standards.
 */
export function printOceanBillOfLading(job: MaritimeJob, containers: MaritimeContainer[] = [], companyName = 'منظومة Z-Systems للشحن الملاحي') {
  const printWindow = window.open('', '_blank', 'width=950,height=1000');
  if (!printWindow) return;

  const containersList = containers.length > 0 ? containers : (job.containers || []);
  const totalWeight = containersList.reduce((sum, c) => sum + Number(c.gross_weight_kg || 0), 0);
  const totalCbm = containersList.reduce((sum, c) => sum + Number(c.cbm || 0), 0);

  const containerRowsHtml = containersList.map((c, idx) => `
    <tr>
      <td style="text-align: center; font-weight: 700;">${idx + 1}</td>
      <td style="font-weight: 800; font-family: monospace;">${escapeHtml(c.container_number)}</td>
      <td>${escapeHtml(c.container_type)}</td>
      <td style="font-family: monospace;">${escapeHtml(c.seal_number || '—')}</td>
      <td style="text-align: right;">${Number(c.gross_weight_kg || 0).toLocaleString()} KG</td>
      <td style="text-align: right;">${Number(c.cbm || 0).toFixed(2)} CBM</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html dir="ltr" lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Bill of Lading - ${escapeHtml(job.hbl_number || job.job_number)}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #0f172a; margin: 0; padding: 15px; line-height: 1.35; }
          .bl-container { border: 2px solid #0f172a; padding: 0; }
          .bl-header { display: grid; grid-template-columns: 2fr 1fr; border-bottom: 2px solid #0f172a; }
          .bl-title-box { padding: 14px; background: #f8fafc; border-left: 2px solid #0f172a; text-align: center; }
          .bl-title { font-size: 18px; font-weight: 900; letter-spacing: 1px; color: #170e5e; margin: 0 0 4px; }
          .bl-doc-num { font-size: 14px; font-weight: 800; color: #0f172a; font-family: monospace; }
          .bl-forwarder { padding: 14px; }
          .bl-forwarder h2 { margin: 0 0 4px; font-size: 16px; color: #170e5e; }
          
          .grid-2 { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #0f172a; }
          .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; border-bottom: 1px solid #0f172a; }
          .grid-4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; border-bottom: 1px solid #0f172a; }
          
          .cell { padding: 7px 10px; border-right: 1px solid #0f172a; }
          .cell:last-child { border-right: none; }
          .cell-label { font-size: 8.5px; font-weight: 800; text-transform: uppercase; color: #475569; margin-bottom: 2px; }
          .cell-content { font-size: 11px; font-weight: 600; min-height: 28px; }
          
          table.cargo-table { width: 100%; border-collapse: collapse; margin: 0; }
          table.cargo-table th { background: #f1f5f9; border-bottom: 2px solid #0f172a; border-right: 1px solid #cbd5e1; padding: 6px 8px; font-size: 9px; font-weight: 800; text-transform: uppercase; text-align: left; }
          table.cargo-table td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; font-size: 10.5px; }
          table.cargo-table th:last-child, table.cargo-table td:last-child { border-right: none; }
          
          .bl-footer { display: grid; grid-template-columns: 2fr 1fr; border-top: 2px solid #0f172a; font-size: 9px; }
          .legal-notice { padding: 10px; color: #64748b; font-size: 8px; line-height: 1.3; border-right: 1px solid #0f172a; }
          .signature-box { padding: 10px; text-align: center; }
          .sign-line { margin-top: 40px; border-top: 1px dashed #475569; padding-top: 4px; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="bl-container">
          <!-- Header -->
          <div class="bl-header">
            <div class="bl-forwarder">
              <h2>${escapeHtml(companyName)}</h2>
              <div style="color: #475569; font-size: 9.5px;">INTERNATIONAL FREIGHT FORWARDING & LOGISTICS SERVICES</div>
              <div style="margin-top: 4px; font-size: 10px;">Carrier / Ocean Line: <strong>${escapeHtml(job.shipping_line_name)}</strong></div>
            </div>
            <div class="bl-title-box">
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                <div style="flex: 1; text-align: left;">
                  <div class="bl-title">BILL OF LADING</div>
                  <div class="bl-doc-num">B/L NO: ${escapeHtml(job.hbl_number || job.mbl_number || job.job_number)}</div>
                  <div style="font-size: 9px; color: #64748b; margin-top: 4px;">Job Ref: ${escapeHtml(job.job_number)}</div>
                </div>
                ${job.tracking_token || job.hbl_number || job.job_number ? `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px solid #cbd5e1; padding: 4px; border-radius: 4px; background: #ffffff;">
                  ${getTrackingQrCode(job.tracking_token || job.hbl_number || job.job_number, 58)}
                  <span style="font-size: 6.5px; font-weight: 800; color: #170e5e; margin-top: 2px;">LIVE AIS TRACKING</span>
                </div>
                ` : ''}
              </div>
            </div>
          </div>

          <!-- Parties -->
          <div class="grid-2">
            <div class="cell">
              <div class="cell-label">1. SHIPPER / EXPORTER</div>
              <div class="cell-content">${escapeHtml(job.shipper_details || 'AS PER COMMERCIAL INVOICE')}</div>
            </div>
            <div class="cell">
              <div class="cell-label">BOOKING / EXPORT REF NO.</div>
              <div class="cell-content">
                <strong>${escapeHtml(job.booking_number || 'BKG-' + job.job_number)}</strong>
                ${job.mbl_number ? `<div style="font-size: 9.5px; color: #475569;">MBL: ${escapeHtml(job.mbl_number)}</div>` : ''}
                ${job.acid_number ? `<div style="margin-top: 3px; font-size: 8.5px; color: #166534; background: #f0fdf4; border: 1px solid #86efac; border-radius: 2px; padding: 1px 4px; font-family: monospace;">EGYPT ACID: <strong>${escapeHtml(job.acid_number)}</strong></div>` : ''}
              </div>
            </div>
          </div>

          <div class="grid-2">
            <div class="cell">
              <div class="cell-label">2. CONSIGNEE (NAME & COMPLETE ADDRESS)</div>
              <div class="cell-content"><strong>${escapeHtml(job.customer_name)}</strong><br/>${escapeHtml(job.consignee_details || 'TO ORDER')}</div>
            </div>
            <div class="cell">
              <div class="cell-label">3. NOTIFY PARTY / LOCAL CLEARANCE AGENT</div>
              <div class="cell-content">${escapeHtml(job.notify_party || 'SAME AS CONSIGNEE')}</div>
            </div>
          </div>

          <!-- Vessel & Route -->
          <div class="grid-4">
            <div class="cell">
              <div class="cell-label">VESSEL NAME</div>
              <div class="cell-content">${escapeHtml(job.vessel_name || 'TBN (To Be Nominated)')}</div>
            </div>
            <div class="cell">
              <div class="cell-label">VOYAGE NO.</div>
              <div class="cell-content">${escapeHtml(job.voyage_number || '—')}</div>
            </div>
            <div class="cell">
              <div class="cell-label">PORT OF LOADING (POL)</div>
              <div class="cell-content"><strong>${escapeHtml(job.pol_name)}</strong> (${escapeHtml(job.pol_code)})</div>
            </div>
            <div class="cell">
              <div class="cell-label">PORT OF DISCHARGE (POD)</div>
              <div class="cell-content"><strong>${escapeHtml(job.pod_name)}</strong> (${escapeHtml(job.pod_code)})</div>
            </div>
          </div>

          <!-- Cargo and Container Spec -->
          <div style="min-height: 220px; border-bottom: 2px solid #0f172a;">
            <table class="cargo-table">
              <thead>
                <tr>
                  <th style="width: 35px; text-align: center;">Item</th>
                  <th>Container No.</th>
                  <th>Equipment Type</th>
                  <th>Seal No.</th>
                  <th style="text-align: right;">Gross Weight</th>
                  <th style="text-align: right;">Measurement</th>
                </tr>
              </thead>
              <tbody>
                ${containerRowsHtml || '<tr><td colspan="6" style="text-align: center; padding: 25px; color: #94a3b8;">No container equipment registered</td></tr>'}
              </tbody>
            </table>
          </div>

          <!-- Cargo Summary & Terms -->
          <div class="grid-3">
            <div class="cell">
              <div class="cell-label">FREIGHT & CHARGES PAYMENT</div>
              <div class="cell-content" style="text-transform: uppercase; font-weight: 800; color: #170e5e;">
                FREIGHT ${job.payment_term === 'collect' ? 'COLLECT' : 'PREPAID'}
              </div>
            </div>
            <div class="cell">
              <div class="cell-label">NUMBER OF ORIGINAL B/Ls</div>
              <div class="cell-content"><strong>${job.bl_type === 'sea_waybill' ? 'ZERO (SEA WAYBILL)' : 'THREE (3)'}</strong></div>
            </div>
            <div class="cell">
              <div class="cell-label">TOTAL EQUIPMENT & WEIGHT</div>
              <div class="cell-content">
                <strong>${containersList.length} Container(s)</strong> | ${totalWeight.toLocaleString()} KG | ${totalCbm.toFixed(2)} CBM
              </div>
            </div>
          </div>

          <!-- Footer & Signature -->
          <div class="bl-footer">
            <div class="legal-notice">
              Received by the Carrier in apparent good order and condition, unless otherwise noted hereon, the total number of Containers or packages stated above for carriage to the specified destination. In witness whereof, the Carrier has signed the specified number of Bills of Lading, all of this tenor and date, one of which being accomplished, the others to stand void.
            </div>
            <div class="signature-box">
              <div style="font-size: 8.5px; font-weight: 700; color: #475569;">FOR AND ON BEHALF OF THE CARRIER</div>
              <div class="sign-line">${escapeHtml(companyName)}</div>
              <div style="font-size: 8px; color: #94a3b8; margin-top: 3px;">Date: ${new Date().toLocaleDateString('en-GB')}</div>
            </div>
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

/**
 * Generates and prints a formal Carrier Rate Dispute Notice (مذكرة نزاع مالي مع الخط الملاحي)
 * conforming to international freight forwarding rate audit standards.
 */
export function printCarrierDisputeNote(
  job: MaritimeJob,
  invoice: any,
  dispute: any,
  companyName = 'منظومة Z-Systems للشحن الملاحي',
) {
  const printWindow = window.open('', '_blank', 'width=950,height=1000');
  if (!printWindow) return;

  const disputeNo = dispute?.disputeNumber || dispute?.dispute_number || `DISP-${escapeHtml(job.job_number)}`;
  const invNo = invoice?.invoiceNumber || invoice?.invoice_number || '—';
  const carrier = invoice?.carrierName || invoice?.carrier_name || job.shipping_line_name || 'Shipping Line';
  const currency = invoice?.currency || 'USD';
  const invoicedTotal = Number(invoice?.totalInvoicedAmount || invoice?.total_invoiced_amount || 0);
  const contractedTotal = Number(invoice?.contractedAmount || invoice?.contracted_amount || 0);
  const varianceAmount = Number(dispute?.disputedAmount || dispute?.disputed_amount || invoice?.varianceAmount || invoice?.variance_amount || (invoicedTotal - contractedTotal));
  const variancePct = contractedTotal > 0 ? ((varianceAmount / contractedTotal) * 100).toFixed(1) : '0.0';
  const reason = dispute?.disputeReason || dispute?.dispute_reason || 'فروق أسعار عن التعرفة المعتمدة ببطاقة الأسعار المتعاقد عليها';

  const html = `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8" />
        <title>إشعار نزاع مالي - ${escapeHtml(disputeNo)}</title>
        <style>
          @page { size: A4 portrait; margin: 15mm; }
          body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 12px; color: #0f172a; margin: 0; padding: 20px; line-height: 1.5; }
          .dispute-header { border-bottom: 2px solid #170e5e; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-start; }
          .title { font-size: 18px; font-weight: 900; color: #170e5e; margin: 0; }
          .badge-dispute { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; padding: 4px 10px; border-radius: 6px; font-weight: 800; font-size: 11px; }
          .meta-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 16px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; font-size: 11.5px; }
          .meta-item strong { display: block; color: #64748b; font-size: 10px; text-transform: uppercase; margin-bottom: 2px; }
          .meta-item span { font-weight: 700; color: #0f172a; }
          .table-container { margin: 16px 0; }
          table { width: 100%; border-collapse: collapse; text-align: right; font-size: 11.5px; }
          th { background: #170e5e; color: #ffffff; padding: 8px 10px; font-weight: 700; }
          td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
          .overcharge-row { background: #fef2f2; font-weight: 800; color: #b91c1c; }
          .notice-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px; margin: 16px 0; font-size: 11.5px; color: #1e40af; line-height: 1.6; }
          .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 40px; text-align: center; }
          .sign-box { border-top: 1px dashed #94a3b8; padding-top: 8px; font-size: 11px; font-weight: 700; color: #334155; }
        </style>
      </head>
      <body>
        <div class="dispute-header">
          <div>
            <div class="title">إشعار نزاع مالي وتدقيق تعرفة الشحن (Freight Rate Dispute Notice)</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 4px;">صادر من: ${escapeHtml(companyName)} | موجه إلى: <strong>${escapeHtml(carrier)}</strong></div>
          </div>
          <div style="text-align: left;">
            <div class="badge-dispute">مذكرة نزاع رسمي</div>
            <div style="font-family: monospace; font-size: 12px; font-weight: 800; margin-top: 4px;">${escapeHtml(disputeNo)}</div>
          </div>
        </div>

        <div class="meta-box">
          <div class="meta-item">
            <strong>رقم العملية / الشحنة:</strong>
            <span>${escapeHtml(job.job_number)}</span>
          </div>
          <div class="meta-item">
            <strong>رقم بوليصة الشحن MBL:</strong>
            <span style="font-family: monospace;">${escapeHtml(job.mbl_number || '—')}</span>
          </div>
          <div class="meta-item">
            <strong>رقم الحجز الملاحي:</strong>
            <span style="font-family: monospace;">${escapeHtml(job.booking_number || '—')}</span>
          </div>
          <div class="meta-item">
            <strong>السفينة والرحلة:</strong>
            <span>${escapeHtml(job.vessel_name || '—')} ${job.voyage_number ? `(${escapeHtml(job.voyage_number)})` : ''}</span>
          </div>
          <div class="meta-item">
            <strong>مسار الرحلة (POL → POD):</strong>
            <span>${escapeHtml(job.pol_name)} (${escapeHtml(job.pol_code)}) ← ${escapeHtml(job.pod_name)} (${escapeHtml(job.pod_code)})</span>
          </div>
          <div class="meta-item">
            <strong>رقم فاتورة الناقل المتنازع عليها:</strong>
            <span style="font-family: monospace; color: #b91c1c;">${invNo}</span>
          </div>
        </div>

        <h4 style="margin: 14px 0 6px; color: #170e5e; font-size: 13px;">تفاصيل التدقيق المالي ومقارنة التعرفة المتعاقد عليها:</h4>
        <table>
          <thead>
            <tr>
              <th>بيان المقارنة المالية</th>
              <th>التعرفة المتعاقد عليها (Contracted)</th>
              <th>فاتورة الخط الملاحي (Invoiced)</th>
              <th>الفارق المالي (Variance)</th>
              <th>نسبة الزيادة</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>إجمالي النولون والمصروفات البحرية</td>
              <td style="font-weight: 700;">${currency} ${contractedTotal.toLocaleString()}</td>
              <td style="font-weight: 700; color: #b91c1c;">${currency} ${invoicedTotal.toLocaleString()}</td>
              <td style="font-weight: 800; color: #b91c1c;">+${currency} ${varianceAmount.toLocaleString()}</td>
              <td style="font-weight: 800; color: #b91c1c;">+${variancePct}%</td>
            </tr>
            <tr class="overcharge-row">
              <td colspan="3">المبلغ المتنازع عليه والمطلوب استبعاده / إصدار إشعار دائن به:</td>
              <td colspan="2" style="font-size: 13px;">${currency} ${varianceAmount.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>

        <div class="notice-box">
          <strong>سبب النزاع والمطالبة:</strong><br />
          ${escapeHtml(reason)}<br /><br />
          نحيطكم علماً بأنه بموجب الاتفاقية وبطاقة الأسعار المعتمدة بين شركتنا والخط الملاحي، فإن التعرفة المتفق عليها لهذه الشحنة هي <strong>${currency} ${contractedTotal.toLocaleString()}</strong>.
          يرجى التكرم بتعديل الفاتورة أو إصدار إشعار دائن (Credit Note) بمبلغ <strong>${currency} ${varianceAmount.toLocaleString()}</strong> لإتمام عملية الصرف والتسوية المالية دون تأخير.
        </div>

        <div class="sign-grid">
          <div class="sign-box">
            قسم تدقيق الحسابات والتعرفات الملاحية<br />
            <strong>${escapeHtml(companyName)}</strong>
          </div>
          <div class="sign-box">
            اعتماد التوكيل / الخط الملاحي<br />
            <strong>${escapeHtml(carrier)}</strong>
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

/**
 * Generates and prints a standardized IATA Neutral Air Waybill (AWB)
 * conforming to IATA Cargo Services Conference Resolutions.
 */
export function printAirWaybill(job: MaritimeJob, companyName = 'منظومة Z-Systems للشحن والخدمات اللوجستية') {
  const printWindow = window.open('', '_blank', 'width=950,height=1000');
  if (!printWindow) return;

  const awbNumber = job.mawb_number || job.hawb_number || job.job_number;
  const grossWeight = Number(job.gross_weight_kg || 0);
  const chargeableWeight = Number(job.chargeable_weight_kg || job.gross_weight_kg || 0);
  const totalCbm = Number(job.total_cbm || 0);
  const packages = Number(job.package_count || 1);

  const html = `
    <!DOCTYPE html>
    <html dir="ltr" lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Air Waybill - ${awbNumber}</title>
        <style>
          @page { size: A4 portrait; margin: 10mm; }
          body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #0f172a; margin: 0; padding: 12px; line-height: 1.3; }
          .awb-container { border: 2px solid #0f172a; }
          .awb-header { display: grid; grid-template-columns: 2fr 1.2fr; border-bottom: 2px solid #0f172a; }
          .awb-title-box { padding: 12px; background: #f8fafc; border-left: 2px solid #0f172a; text-align: center; }
          .awb-title { font-size: 17px; font-weight: 900; letter-spacing: 1.5px; color: #170e5e; margin: 0 0 4px; }
          .awb-doc-num { font-size: 15px; font-weight: 800; color: #0f172a; font-family: monospace; }
          .awb-forwarder { padding: 12px; }
          .awb-forwarder h2 { margin: 0 0 2px; font-size: 16px; color: #170e5e; }

          .grid-2 { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #0f172a; }
          .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; border-bottom: 1px solid #0f172a; }
          .grid-4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; border-bottom: 1px solid #0f172a; }

          .cell { padding: 6px 10px; border-right: 1px solid #0f172a; }
          .cell:last-child { border-right: none; }
          .cell-label { font-size: 8px; font-weight: 800; text-transform: uppercase; color: #475569; margin-bottom: 2px; }
          .cell-content { font-size: 10.5px; font-weight: 600; min-height: 24px; }

          table.cargo-table { width: 100%; border-collapse: collapse; margin: 0; }
          table.cargo-table th { background: #f1f5f9; border-bottom: 2px solid #0f172a; border-right: 1px solid #cbd5e1; padding: 6px 8px; font-size: 8.5px; font-weight: 800; text-transform: uppercase; text-align: left; }
          table.cargo-table td { padding: 7px 8px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; font-size: 10.5px; }
          table.cargo-table th:last-child, table.cargo-table td:last-child { border-right: none; }

          .awb-footer { display: grid; grid-template-columns: 2fr 1fr; border-top: 2px solid #0f172a; font-size: 8.5px; }
          .legal-notice { padding: 8px 10px; color: #64748b; font-size: 8px; line-height: 1.25; border-right: 1px solid #0f172a; }
          .signature-box { padding: 8px 10px; text-align: center; }
          .sign-line { margin-top: 36px; border-top: 1px dashed #475569; padding-top: 4px; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="awb-container">
          <div class="awb-header">
            <div class="awb-forwarder">
              <h2>${escapeHtml(companyName)}</h2>
              <div style="color: #475569; font-size: 9px;">INTERNATIONAL AIR FREIGHT FORWARDING & LOGISTICS (IATA CARGO AGENT)</div>
              <div style="margin-top: 4px; font-size: 10px;">Air Carrier / Airline: <strong>${escapeHtml(job.shipping_line_name)}</strong></div>
            </div>
            <div class="awb-title-box">
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                <div style="flex: 1; text-align: left;">
                  <div class="awb-title">AIR WAYBILL</div>
                  <div class="awb-doc-num">AWB NO: ${awbNumber}</div>
                  <div style="font-size: 9px; color: #64748b; margin-top: 3px;">Job Ref: ${escapeHtml(job.job_number)}</div>
                </div>
                ${job.tracking_token || job.mawb_number || job.hawb_number || job.job_number ? `
                <div style="display: flex; flex-direction: column; align-items: center; border: 1px solid #cbd5e1; padding: 4px; border-radius: 4px; background: #ffffff;">
                  ${getTrackingQrCode(job.tracking_token || job.mawb_number || job.hawb_number || job.job_number, 56)}
                  <span style="font-size: 6px; font-weight: 800; color: #170e5e; margin-top: 2px;">CARGO iQ TRACKING</span>
                </div>
                ` : ''}
              </div>
            </div>
          </div>

          <div class="grid-2">
            <div class="cell">
              <div class="cell-label">1. SHIPPER'S NAME AND ADDRESS</div>
              <div class="cell-content">${escapeHtml(job.shipper_details || 'AS PER COMMERCIAL INVOICE')}</div>
            </div>
            <div class="cell">
              <div class="cell-label">AIRLINE BOOKING / FLIGHT DETAILS</div>
              <div class="cell-content">
                <strong>Flight: ${escapeHtml(job.flight_number || 'TBA')}</strong> | Date: <strong>${job.flight_date || job.etd || 'TBA'}</strong><br/>
                ${job.hawb_number ? `<span style="font-size: 9px; color: #475569;">HAWB: ${escapeHtml(job.hawb_number)}</span>` : ''}
              </div>
            </div>
          </div>

          <div class="grid-2">
            <div class="cell">
              <div class="cell-label">2. CONSIGNEE'S NAME AND ADDRESS</div>
              <div class="cell-content"><strong>${escapeHtml(job.customer_name)}</strong><br/>${escapeHtml(job.consignee_details || 'DIRECT AIR DELIVERY')}</div>
            </div>
            <div class="cell">
              <div class="cell-label">3. ISSUING CARRIER'S AGENT / NOTIFY PARTY</div>
              <div class="cell-content">${escapeHtml(job.notify_party || companyName)}</div>
            </div>
          </div>

          <div class="grid-4">
            <div class="cell">
              <div class="cell-label">AIRPORT OF DEPARTURE (POL)</div>
              <div class="cell-content"><strong>${escapeHtml(job.pol_name)}</strong><br/><span style="font-family: monospace; font-size: 10px;">IATA: ${escapeHtml(job.pol_code)}</span></div>
            </div>
            <div class="cell">
              <div class="cell-label">AIRPORT OF DESTINATION (POD)</div>
              <div class="cell-content"><strong>${escapeHtml(job.pod_name)}</strong><br/><span style="font-family: monospace; font-size: 10px;">IATA: ${escapeHtml(job.pod_code)}</span></div>
            </div>
            <div class="cell">
              <div class="cell-label">CARGO NATURE / TYPE</div>
              <div class="cell-content"><strong>${job.air_cargo_type || 'General Cargo'}</strong></div>
            </div>
            <div class="cell">
              <div class="cell-label">CHGS CODES / PAYMENT</div>
              <div class="cell-content"><strong>${job.payment_term?.toUpperCase() || 'PREPAID'}</strong></div>
            </div>
          </div>

          <table class="cargo-table">
            <thead>
              <tr>
                <th style="width: 50px;">No. of Pieces</th>
                <th style="width: 100px;">Gross Weight</th>
                <th style="width: 80px;">Rate Class</th>
                <th style="width: 110px;">Chargeable Weight</th>
                <th style="width: 90px;">Volume (CBM)</th>
                <th>Nature and Quantity of Goods (incl. Dimensions)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="font-weight: 700; text-align: center;">${packages} PCS</td>
                <td style="font-weight: 700;">${grossWeight.toLocaleString()} KG</td>
                <td style="text-align: center;">Q (Quantity)</td>
                <td style="font-weight: 800; color: #170e5e;">${chargeableWeight.toLocaleString()} KG</td>
                <td>${totalCbm.toFixed(2)} CBM</td>
                <td>
                  <strong>${escapeHtml(job.notes || 'Air Freight Cargo / General Merchandise')}</strong><br/>
                  <span style="font-size: 9px; color: #64748b;">Handling: Keep Dry | Standard Air Cargo Security Screened</span>
                </td>
              </tr>
            </tbody>
          </table>

          <div class="awb-footer">
            <div class="legal-notice">
              It is agreed that the goods described herein are accepted in apparent good order and condition for carriage SUBJECT TO THE CONDITIONS OF CONTRACT ON THE REVERSE HEREOF. ALL GOODS MAY BE CARRIED BY ANY OTHER MEANS INCLUDING ROAD OR ANY OTHER AIR CARRIER. The Warsaw Convention or the Montreal Convention may be applicable.
            </div>
            <div class="signature-box">
              <div style="font-weight: 700;">${escapeHtml(companyName)}</div>
              <div style="font-size: 8px; color: #64748b;">Signature of Issuing Carrier or its Agent</div>
              <div class="sign-line">Authorized Signatory</div>
            </div>
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

/**
 * Generates and prints a Cargo Insurance Certificate
 * for marine, air, and multimodal cargo policies.
 */
export function printCargoInsuranceCertificate(job: MaritimeJob, insurance: any, companyName = 'منظومة Z-Systems للشحن والتأمين الملاحي') {
  const printWindow = window.open('', '_blank', 'width=900,height=950');
  if (!printWindow) return;

  const coverageLabels: Record<string, string> = {
    all_risks: 'تأمين شامل ضد كافة الأخطار (All Risks)',
    clauses_a: 'شروط مجمع مكتتبي التأمين - أ (Institute Cargo Clauses A)',
    clauses_b: 'شروط مجمع مكتتبي التأمين - ب (Institute Cargo Clauses B)',
    clauses_c: 'شروط مجمع مكتتبي التأمين - ج (Institute Cargo Clauses C)',
  };

  const html = `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8" />
        <title>شهادة تأمين بضائع - ${insurance.policy_number || insurance.policyNumber}</title>
        <style>
          @page { size: A4 portrait; margin: 15mm; }
          body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 12px; color: #0f172a; margin: 0; padding: 20px; line-height: 1.5; }
          .cert-border { border: 3px double #170e5e; padding: 24px; border-radius: 8px; background: #ffffff; }
          .cert-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 20px; }
          .cert-title { font-size: 20px; font-weight: 800; color: #170e5e; margin: 0 0 6px; }
          .policy-badge { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 8px 14px; border-radius: 6px; text-align: left; font-family: monospace; font-weight: 800; font-size: 13px; }
          
          .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
          .field-box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px 12px; border-radius: 6px; }
          .field-label { font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 3px; }
          .field-val { font-size: 13px; font-weight: 700; color: #0f172a; }

          .highlight-card { background: #eff6ff; border: 1.5px solid #3b82f6; border-radius: 8px; padding: 14px; margin-bottom: 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
          .notice-box { background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; padding: 12px; font-size: 11px; color: #92400e; margin-bottom: 24px; line-height: 1.4; }
          
          .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 30px; text-align: center; }
          .sign-box { border-top: 1px dashed #64748b; padding-top: 8px; font-size: 11px; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="cert-border">
          <div class="cert-header">
            <div>
              <div class="cert-title">شهادة تأمين ونقل البضائع الدولية</div>
              <div style="color: #64748b; font-size: 11px;">CARGO TRANSPORT INSURANCE CERTIFICATE</div>
              <div style="font-weight: 700; color: #170e5e; margin-top: 4px;">${escapeHtml(companyName)}</div>
            </div>
            <div class="policy-badge">
              <div style="font-size: 9px; color: #64748b; font-family: sans-serif;">رقم الوثيقة / POLICY NO.</div>
              <div>${insurance.policy_number || insurance.policyNumber}</div>
            </div>
          </div>

          <div class="highlight-card">
            <div>
              <div class="field-label">القيمة الإجمالية المؤمن عليها (INSURED VALUE)</div>
              <div class="field-val" style="font-size: 16px; color: #1d4ed8;">
                ${insurance.currency || 'USD'} ${Number(insurance.insured_value || insurance.insuredValue || 0).toLocaleString()}
              </div>
            </div>
            <div>
              <div class="field-label">قسط التأمين المسدد (PREMIUM PAID)</div>
              <div class="field-val" style="font-size: 16px; color: #047857;">
                ${insurance.currency || 'USD'} ${Number(insurance.premium_amount || insurance.premiumAmount || 0).toLocaleString()}
              </div>
            </div>
          </div>

          <div class="grid-2">
            <div class="field-box">
              <div class="field-label">المؤمَّن له (THE INSURED)</div>
              <div class="field-val">${escapeHtml(job.customer_name)}</div>
            </div>
            <div class="field-box">
              <div class="field-label">شركة التأمين الضامنة (UNDERWRITER)</div>
              <div class="field-val">${insurance.insurance_company || insurance.insuranceCompany}</div>
            </div>
            <div class="field-box">
              <div class="field-label">نوع ونطاق التغطية التأمينية (COVERAGE TYPE)</div>
              <div class="field-val">${coverageLabels[insurance.coverage_type || insurance.coverageType] || insurance.coverage_type || 'All Risks'}</div>
            </div>
            <div class="field-box">
              <div class="field-label">تاريخ السريان / الإصدار (ISSUE DATE)</div>
              <div class="field-val">${insurance.issue_date || insurance.issueDate || '—'}</div>
            </div>
            <div class="field-box">
              <div class="field-label">ميناء/مطار الشحن (ORIGIN)</div>
              <div class="field-val">${escapeHtml(job.pol_name)} (${escapeHtml(job.pol_code)})</div>
            </div>
            <div class="field-box">
              <div class="field-label">ميناء/مطار الوصول (DESTINATION)</div>
              <div class="field-val">${escapeHtml(job.pod_name)} (${escapeHtml(job.pod_code)})</div>
            </div>
            <div class="field-box">
              <div class="field-label">رقم أمر التشغيل / الشحنة (JOB REF)</div>
              <div class="field-val" style="font-family: monospace;">${escapeHtml(job.job_number)}</div>
            </div>
            <div class="field-box">
              <div class="field-label">الناقل / وسيلة النقل (CARRIER / VESSEL / FLIGHT)</div>
              <div class="field-val">${job.flight_number ? `رحلة: ${escapeHtml(job.flight_number)}` : job.vessel_name ? `سفينة: ${escapeHtml(job.vessel_name)}` : escapeHtml(job.shipping_line_name)}</div>
            </div>
          </div>

          <div class="notice-box">
            <strong>إشعار وشروط المطالبة بالتعويض:</strong><br />
            تغطي هذه الوثيقة البضائع الموضحة أعلاه أثناء النقل الدولي من مستودع الشاحن حتى مستودع المستلم النهائي. في حال حدوث أي عجز أو تلف أو هلاك كلي/جزئي للبضائع، يجب إخطار شركة التأمين فوراً وطلب معاينة مشتركة قبل استلام البضاعة أو خلال مهلة لا تتجاوز 3 أيام عمل من تاريخ الوصول.
          </div>

          <div class="sign-grid">
            <div class="sign-box">
              ختم واعتماد وسيط الشحن والتأمين<br />
              <strong>${escapeHtml(companyName)}</strong>
            </div>
            <div class="sign-box">
              اعتماد شركة التأمين<br />
              <strong>${insurance.insurance_company || insurance.insuranceCompany}</strong>
            </div>
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

/**
 * Generates and prints a Transit & Bonded Warehouse Intake / Storage Receipt
 * (إذن استلام وإيداع مستودع بضائع ترانزيت / إيداع جمركي)
 */
export function printWarehouseReceipt(job: MaritimeJob, receipt: any, companyName = 'منظومة Z-Systems للمستودعات اللوجستية') {
  const printWindow = window.open('', '_blank', 'width=900,height=950');
  if (!printWindow) return;

  const html = `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8" />
        <title>إذن استلام وإيداع مستودع - ${receipt.receipt_number || receipt.receiptNumber}</title>
        <style>
          @page { size: A4 portrait; margin: 15mm; }
          body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 12px; color: #0f172a; margin: 0; padding: 20px; line-height: 1.5; }
          .receipt-border { border: 2px solid #0f172a; padding: 24px; border-radius: 8px; background: #ffffff; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 14px; margin-bottom: 20px; }
          .title { font-size: 18px; font-weight: 800; color: #170e5e; margin: 0 0 4px; }
          .receipt-badge { background: #f8fafc; border: 1.5px solid #0f172a; padding: 8px 14px; border-radius: 6px; text-align: center; font-family: monospace; font-weight: 800; font-size: 14px; }

          .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 16px; }
          .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
          .box { background: #f8fafc; border: 1px solid #cbd5e1; padding: 10px 12px; border-radius: 6px; }
          .box-label { font-size: 10px; font-weight: 700; color: #64748b; margin-bottom: 2px; }
          .box-val { font-size: 13px; font-weight: 700; color: #0f172a; }

          .storage-card { background: #f0fdf4; border: 1.5px solid #22c55e; border-radius: 8px; padding: 14px; margin-bottom: 18px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 8px 10px; font-size: 11px; font-weight: 800; text-align: right; }
          td { border: 1px solid #cbd5e1; padding: 8px 10px; font-size: 12px; }

          .sign-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; margin-top: 36px; text-align: center; }
          .sign-box { border-top: 1px dashed #64748b; padding-top: 8px; font-size: 11px; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="receipt-border">
          <div class="header">
            <div>
              <div class="title">إذن استلام وإيداع مستودع لوجستي / جمركي</div>
              <div style="color: #64748b; font-size: 10.5px;">WAREHOUSE INTAKE & STORAGE RECEIPT (MWR)</div>
              <div style="font-weight: 700; color: #170e5e; margin-top: 4px;">${escapeHtml(companyName)}</div>
            </div>
            <div class="receipt-badge">
              <div style="font-size: 9px; color: #64748b; font-family: sans-serif;">رقم الإذن / RECEIPT NO.</div>
              <div>${receipt.receipt_number || receipt.receiptNumber}</div>
            </div>
          </div>

          <div class="storage-card">
            <div>
              <div class="box-label">عدد الطرود / الطبالي</div>
              <div class="box-val" style="color: #15803d; font-size: 16px;">${receipt.package_count || receipt.packageCount || 1} طرد / وحدة</div>
            </div>
            <div>
              <div class="box-label">الوزن الإجمالي الفعلي</div>
              <div class="box-val" style="color: #15803d; font-size: 16px;">${Number(receipt.gross_weight_kg || receipt.grossWeightKg || 0).toLocaleString()} كجم</div>
            </div>
            <div>
              <div class="box-label">الحجم الإجمالي (CBM)</div>
              <div class="box-val" style="color: #15803d; font-size: 16px;">${Number(receipt.cbm || 0).toFixed(2)} م³</div>
            </div>
          </div>

          <div class="grid-3">
            <div class="box">
              <div class="box-label">العميل / صاحب البضاعة</div>
              <div class="box-val">${escapeHtml(job.customer_name)}</div>
            </div>
            <div class="box">
              <div class="box-label">رقم الشحنة / أمر التشغيل</div>
              <div class="box-val" style="font-family: monospace;">${escapeHtml(job.job_number)}</div>
            </div>
            <div class="box">
              <div class="box-label">تاريخ ووقت الاستلام الفعلي</div>
              <div class="box-val">${receipt.received_date || receipt.receivedDate ? new Date(receipt.received_date || receipt.receivedDate).toLocaleString('ar-EG') : '—'}</div>
            </div>
          </div>

          <div class="grid-2">
            <div class="box">
              <div class="box-label">موقع التخزين والرف (BAY / RACK / BIN)</div>
              <div class="box-val" style="color: #170e5e;">${receipt.bay_rack_bin || receipt.bayRackBin || 'ساحة الاستلام والتفتيش العام'}</div>
            </div>
            <div class="box">
              <div class="box-label">حالة البضاعة بالمستودع</div>
              <div class="box-val">${receipt.warehouse_status === 'released' ? 'تم الإفراج والتسليم للعميل' : 'مودعة ومخزنة بالمستودع'}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>ملاحظات الفحص الظاهري والمطابقة</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="min-height: 48px; color: #334155;">
                  ${receipt.notes || 'تم استلام الطرود بحالة ظاهرية سليمة ومطابقة للمستندات المرفقة دون أي عجز أو تلف ملحوظ.'}
                </td>
              </tr>
            </tbody>
          </table>

          <div class="sign-grid">
            <div class="sign-box">
              أمين المستودع المستلم<br />
              <strong>Storekeeper</strong>
            </div>
            <div class="sign-box">
              مندوب النقل / السائق المسلم<br />
              <strong>Carrier / Driver</strong>
            </div>
            <div class="sign-box">
              إدارة العمليات اللوجستية<br />
              <strong>Operations Control</strong>
            </div>
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

/**
 * Generates and prints a Formal Freight Forwarding Quotation & Service Proposal (PDF)
 * conforming to international freight brokerage & forwarding standards.
 */
export function printFreightQuotation(quote: MaritimeQuotation, companyName = 'منظومة Z-Systems للشحن والخدمات اللوجستية') {
  const printWindow = window.open('', '_blank', 'width=950,height=1000');
  if (!printWindow) return;

  const modeLabel = quote.transport_mode === 'air' ? 'شحن جوي دولي (AIR FREIGHT)' : quote.transport_mode === 'road' ? 'شحن بري دولي (LAND FREIGHT)' : 'شحن بحري دولي (OCEAN FREIGHT)';
  const quoteDate = quote.created_at ? new Date(quote.created_at).toLocaleDateString('ar-EG') : new Date().toLocaleDateString('ar-EG');
  const validUntil = quote.valid_until || '14 يوماً من تاريخ الإصدار';

  const html = `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8" />
        <title>عرض سعر شحن - ${escapeHtml(quote.quotation_number)}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 11.5px; color: #0f172a; margin: 0; padding: 20px; line-height: 1.5; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #170e5e; padding-bottom: 14px; margin-bottom: 18px; }
          .brand { font-size: 20px; font-weight: 900; color: #170e5e; }
          .quote-badge { background: #f8fafc; border: 2px solid #170e5e; border-radius: 8px; padding: 10px 16px; text-align: right; }
          .quote-title { margin: 0; font-size: 15px; font-weight: 800; color: #170e5e; }
          .quote-num { font-family: monospace; font-size: 14px; font-weight: 800; color: #0f172a; margin-top: 2px; }

          .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
          .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; background: #ffffff; }
          .card-title { font-size: 11px; font-weight: 800; color: #170e5e; margin-bottom: 8px; border-bottom: 1px solid #f1f5f9; padding-bottom: 4px; }
          .row { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px; }
          .row span:first-child { color: #64748b; font-weight: 600; }
          .row span:last-child { font-weight: 700; color: #0f172a; }

          table { width: 100%; border-collapse: collapse; margin: 16px 0; }
          th { background: #170e5e; color: #ffffff; padding: 8px 10px; font-size: 11px; font-weight: 800; text-align: right; }
          td { border-bottom: 1px solid #e2e8f0; padding: 9px 10px; font-size: 11.5px; }

          .total-box { background: #f0fdf4; border: 1.5px solid #22c55e; border-radius: 8px; padding: 14px 18px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center; }
          .total-val { font-size: 20px; font-weight: 900; color: #15803d; font-family: monospace; }

          .terms-box { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 14px; font-size: 10.5px; color: #475569; line-height: 1.6; margin-bottom: 20px; }
          .terms-box strong { color: #170e5e; }

          .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 30px; text-align: center; }
          .sign-box { border-top: 1px dashed #64748b; padding-top: 8px; font-size: 11px; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand">${escapeHtml(companyName)}</div>
            <div style="font-size: 10.5px; color: #64748b; margin-top: 2px;">قطاع الشحن الدولي وإدارة سلاسل الإمداد اللوجستية</div>
            <div style="font-size: 11px; color: #1e293b; margin-top: 4px;">نوع الخدمة: <strong>${modeLabel}</strong></div>
          </div>
          <div style="display: flex; align-items: center; gap: 14px;">
            <div class="quote-badge">
              <div class="quote-title">عرض سعر شحن رسمي (FREIGHT QUOTATION)</div>
              <div class="quote-num">رقم العرض: ${escapeHtml(quote.quotation_number)}</div>
              <div style="font-size: 10px; color: #64748b; margin-top: 2px;">تاريخ الإصدار: <strong>${quoteDate}</strong> | صالح حتى: <strong>${validUntil}</strong></div>
            </div>
            <div style="display: flex; flex-direction: column; align-items: center; border: 1px solid #cbd5e1; padding: 4px; border-radius: 6px; background: #ffffff;">
              ${getTrackingQrCode(quote.quotation_number, 54)}
              <span style="font-size: 6.5px; font-weight: 800; color: #170e5e; margin-top: 2px;">التحقق من العرض</span>
            </div>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card-title">بيانات العميل والشاحن (Customer Details)</div>
            <div class="row"><span>اسم العميل:</span><span>${escapeHtml(quote.customer_name)}</span></div>
            <div class="row"><span>رقم الهاتف / الجوال:</span><span>${escapeHtml(quote.customer_phone || '—')}</span></div>
            <div class="row"><span>البريد الإلكتروني:</span><span>${quote.customer_email || '—'}</span></div>
            <div class="row"><span>شرط السداد:</span><span>${quote.payment_term === 'collect' ? 'Freight Collect (تحصيل عند الوصول)' : 'Freight Prepaid (مدفوع مقدماً)'}</span></div>
          </div>

          <div class="card">
            <div class="card-title">تفاصيل ومسار الشحن (Freight Specifications)</div>
            <div class="row"><span>وسيلة الشحن:</span><span>${modeLabel}</span></div>
            <div class="row"><span>نوع الشحنة / البضاعة:</span><span>${quote.air_cargo_type || 'بضائع عامة ومعدات تجارية'}</span></div>
            ${quote.package_count ? `<div class="row"><span>عدد الطرود / الوحدات:</span><span>${quote.package_count} طرد</span></div>` : ''}
            ${quote.gross_weight_kg ? `<div class="row"><span>الوزن الإجمالي الفعلي:</span><span>${Number(quote.gross_weight_kg).toLocaleString()} كجم</span></div>` : ''}
            ${quote.chargeable_weight_kg ? `<div class="row"><span>الوزن الخاضع للتحصيل IATA:</span><span>${Number(quote.chargeable_weight_kg).toLocaleString()} كجم</span></div>` : ''}
            ${quote.total_cbm ? `<div class="row"><span>الحجم الإجمالي:</span><span>${Number(quote.total_cbm).toFixed(2)} م³ (CBM)</span></div>` : ''}
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>بيان بند التسعير والخدمة اللوجستية</th>
              <th>العملة الأساسية</th>
              <th style="text-align: left;">القيمة بالعملة المتعاقد عليها</th>
              <th style="text-align: left;">المعادل بالعملة المحلية</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="text-align: center;">1</td>
              <td>
                <strong>نولون الشحن الدولي والمصروفات الملاحية الملحقة</strong><br/>
                <span style="font-size: 10px; color: #64748b;">تشمل النولون الأساسي، رسوم الموانئ والمناولة (THC)، وتكاليف المتابعة الميدانية</span>
              </td>
              <td>${quote.currency || 'USD'}</td>
              <td style="text-align: left; font-weight: 800; font-family: monospace;">${quote.currency || 'USD'} ${Number(quote.final_total).toLocaleString()}</td>
              <td style="text-align: left; font-weight: 800; font-family: monospace;">${Number(quote.final_total_local).toLocaleString()} EGP/SAR</td>
            </tr>
          </tbody>
        </table>

        <div class="total-box">
          <div>
            <div style="font-size: 13px; font-weight: 800; color: #166534;">السعر الإجمالي النهائي المعتمد للعميل (FINAL TOTAL PAYABLE)</div>
            <div style="font-size: 10.5px; color: #15803d; margin-top: 2px;">شامل كافة الرسوم والنولون الموضح أعلاه بناءً على بيانات الاستفسار</div>
          </div>
          <div class="total-val">
            ${quote.currency || 'USD'} ${Number(quote.final_total).toLocaleString()}
            <div style="font-size: 11px; font-weight: 700; color: #166534; text-align: left;">(≈ ${Number(quote.final_total_local).toLocaleString()} بالعملة المحلية)</div>
          </div>
        </div>

        <div class="terms-box">
          <strong>الشروط والأحكام العامة لعرض السعر (Standard Terms & Trading Conditions):</strong><br/>
          1. العرض ساري لمدة <strong>${validUntil}</strong> ويخضع لتوفر الفراغات والمعدات (Subject to space and equipment availability).<br/>
          2. الأسعار لا تشمل الرسوم والضرائب الجمركية المباشرة، غرامات الفحص والمعاينة بالموانئ، أو غرامات الأرضيات ما لم ينص صراحة على خلاف ذلك.<br/>
          3. فترات السماح بالحاويات تحتسب طبقاً للائحة التوكيل الملاحي والخط الناقل المعمول بها.<br/>
          4. للتعميد وتأكيد الحجز، يرجى التوقيع والختم أدناه وإعادة إرسال النسخة عبر البريد الإلكتروني أو الواتساب.
        </div>

        <div class="sign-grid">
          <div class="sign-box">
            مستشار التسعير وعمليات الشحن<br/>
            <strong>${escapeHtml(companyName)}</strong>
          </div>
          <div class="sign-box">
            موافقة واعتماد العميل / الشاحن<br/>
            <strong>${escapeHtml(quote.customer_name)}</strong>
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

/**
 * Generates and prints a Formal Freight Commercial Invoice / Debit Note (PDF)
 * addressed to the importer/customer with full container and banking details.
 */
export function printFreightInvoice(
  job: MaritimeJob,
  options?: { invoiceNumber?: string; notes?: string; amount?: number; companyName?: string; charges?: any[] },
) {
  const printWindow = window.open('', '_blank', 'width=950,height=1000');
  if (!printWindow) return;

  const companyName = options?.companyName || 'منظومة Z-Systems للشحن والخدمات اللوجستية';
  const invNumber = options?.invoiceNumber || `INV-${escapeHtml(job.job_number)}`;
  const totalAmount = Number(options?.amount ?? (Number(job.client_invoiced_total) || 0));
  const charges = options?.charges || [];

  const chargesRowsHtml = charges.length > 0
    ? charges.map((chg, idx) => `
        <tr>
          <td style="text-align: center; font-weight: 700;">${idx + 1}</td>
          <td>
            <strong>${escapeHtml(chg.charge_name_ar || chg.chargeNameAr)}</strong>
            <div style="font-size: 9.5px; color: #64748b;">${escapeHtml(chg.charge_name_en || chg.chargeNameEn || chg.charge_code || chg.chargeCode)}</div>
          </td>
          <td style="text-align: center;">${Number(chg.quantity || 1).toLocaleString()}</td>
          <td style="text-align: right; font-family: monospace;">${Number(chg.unit_rate || chg.sell_amount || 0).toLocaleString()} ${escapeHtml(chg.currency || 'USD')}</td>
          <td style="text-align: center; font-size: 10px; color: #166534;">${Number(chg.tax_rate_percent || 0) > 0 ? `${chg.tax_rate_percent}%` : 'معفى'}</td>
          <td style="text-align: left; font-weight: 800; font-family: monospace; font-size: 12px;">${Number(chg.total_amount || chg.sell_amount || 0).toLocaleString()} ${escapeHtml(chg.currency || 'USD')}</td>
        </tr>
      `).join('')
    : `
        <tr>
          <td style="text-align: center;">1</td>
          <td>
            <strong>نولون الشحن الدولي والرسوم المينائية ومصاريف إذن التسليم</strong><br/>
            <span style="font-size: 10px; color: #64748b;">${options?.notes || `خدمات الشحن واللوجستيات لملف العملية #${escapeHtml(job.job_number)}`}</span>
          </td>
          <td style="text-align: center;">1</td>
          <td style="text-align: right; font-family: monospace;">${totalAmount.toLocaleString()}</td>
          <td style="text-align: center; font-size: 10px; color: #166534;">معفى</td>
          <td style="text-align: left; font-weight: 800; font-family: monospace; font-size: 13px;">${totalAmount.toLocaleString()}</td>
        </tr>
      `;

  const html = `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8" />
        <title>فاتورة شحن ملاحي - ${escapeHtml(invNumber)}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 11.5px; color: #0f172a; margin: 0; padding: 20px; line-height: 1.5; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #170e5e; padding-bottom: 14px; margin-bottom: 18px; }
          .brand { font-size: 20px; font-weight: 900; color: #170e5e; }
          .inv-badge { background: #eff6ff; border: 2px solid #1d4ed8; border-radius: 8px; padding: 10px 16px; text-align: right; }
          .inv-title { margin: 0; font-size: 15px; font-weight: 800; color: #1e40af; }
          .inv-num { font-family: monospace; font-size: 14px; font-weight: 800; color: #0f172a; margin-top: 2px; }

          .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
          .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; background: #ffffff; }
          .card-title { font-size: 11px; font-weight: 800; color: #170e5e; margin-bottom: 8px; border-bottom: 1px solid #f1f5f9; padding-bottom: 4px; }
          .row { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px; }
          .row span:first-child { color: #64748b; font-weight: 600; }
          .row span:last-child { font-weight: 700; color: #0f172a; }

          table { width: 100%; border-collapse: collapse; margin: 16px 0; }
          th { background: #170e5e; color: #ffffff; padding: 8px 10px; font-size: 11px; font-weight: 800; text-align: right; }
          td { border-bottom: 1px solid #e2e8f0; padding: 9px 10px; font-size: 11.5px; }

          .total-box { background: #f8fafc; border: 2px solid #170e5e; border-radius: 8px; padding: 14px 18px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center; }
          .total-val { font-size: 20px; font-weight: 900; color: #170e5e; font-family: monospace; }

          .bank-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; font-size: 11px; }
          .bank-title { font-weight: 800; color: #1e40af; margin-bottom: 6px; }

          .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 30px; text-align: center; }
          .sign-box { border-top: 1px dashed #64748b; padding-top: 8px; font-size: 11px; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand">${escapeHtml(companyName)}</div>
            <div style="font-size: 10.5px; color: #64748b; margin-top: 2px;">قطاع الشحن الدولي والتخليص الجمركي</div>
            <div style="font-size: 11px; color: #1e293b; margin-top: 4px;">تاريخ الاستحقاق: <strong>فوري عند الاستلام</strong></div>
          </div>
          <div style="display: flex; align-items: center; gap: 14px;">
            <div class="inv-badge">
              <div class="inv-title">فاتورة شحن ملاحي (FREIGHT INVOICE)</div>
              <div class="inv-num">رقم الفاتورة: ${escapeHtml(invNumber)}</div>
              <div style="font-size: 10px; color: #64748b; margin-top: 2px;">تاريخ الإصدار: <strong>${new Date().toLocaleDateString('ar-EG')}</strong> | أمر التشغيل: <strong>#${escapeHtml(job.job_number)}</strong></div>
            </div>
            <div style="display: flex; flex-direction: column; align-items: center; border: 1px solid #bfdbfe; padding: 4px; border-radius: 6px; background: #ffffff;">
              ${getTrackingQrCode(job.tracking_token || job.job_number, 54)}
              <span style="font-size: 6.5px; font-weight: 800; color: #1e40af; margin-top: 2px;">تتبع الشحنة</span>
            </div>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card-title">المطلوب من السادة / العميل (BILL TO)</div>
            <div class="row"><span>اسم العميل:</span><span>${escapeHtml(job.customer_name)}</span></div>
            <div class="row"><span>رقم الهاتف:</span><span>${job.customer_phone || '—'}</span></div>
            <div class="row"><span>البريد الإلكتروني:</span><span>${job.customer_email || '—'}</span></div>
            <div class="row"><span>طريقة الدفع:</span><span>${job.payment_term?.toUpperCase() || 'PREPAID'}</span></div>
          </div>

          <div class="card">
            <div class="card-title">بيانات ومسار الشحنة (SHIPMENT DETAILS)</div>
            <div class="row"><span>الخط الملاحي / الناقل:</span><span>${escapeHtml(job.shipping_line_name)}</span></div>
            <div class="row"><span>السفينة / الرحلة:</span><span>${escapeHtml(job.vessel_name || '—')} ${job.voyage_number ? `(${escapeHtml(job.voyage_number)})` : ''}</span></div>
            <div class="row"><span>بوليصة الشحن (B/L):</span><span>${escapeHtml(job.hbl_number || job.mbl_number || '—')}</span></div>
            <div class="row"><span>ميناء الشحن والتفريغ:</span><span>${escapeHtml(job.pol_name)} ➔ ${escapeHtml(job.pod_name)}</span></div>
          </div>
        </div>

        ${job.acid_number ? `
        <div style="background: #f0fdf4; border: 1.5px solid #16a34a; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <span style="font-size: 11.5px; font-weight: 800; color: #166534;">منظومة التسجيل المسبق للشحنات (Egyptian Customs ACI Compliance)</span>
            <div style="font-size: 11px; color: #15803d; margin-top: 2px;">رقم القيد الجمركي المسبق (ACID): <strong style="font-family: monospace; font-size: 13px; letter-spacing: 0.5px;">${escapeHtml(job.acid_number)}</strong></div>
            ${job.foreign_exporter_id ? `<div style="font-size: 10px; color: #475569;">المصدر الأجنبي: <strong>${escapeHtml(job.foreign_exporter_id)}</strong> | الرقم الضريبي للمستورد: <strong>${escapeHtml(job.importer_tax_id || '—')}</strong></div>` : ''}
          </div>
          <div style="font-size: 10px; color: #166534; text-align: left;">
            تاريخ الإصدار: <strong>${job.acid_issue_date || '—'}</strong><br/>
            صالح حتى: <strong>${job.acid_expiry_date || '—'}</strong>
          </div>
        </div>
        ` : ''}

        <table>
          <thead>
            <tr>
              <th style="width: 35px; text-align: center;">#</th>
              <th>بيان الخدمة والمصروفات النولونية</th>
              <th style="width: 60px; text-align: center;">الكمية</th>
              <th style="width: 130px; text-align: right;">سعر الوحدة</th>
              <th style="width: 70px; text-align: center;">الضريبة</th>
              <th style="width: 140px; text-align: left;">المبلغ المستحق</th>
            </tr>
          </thead>
          <tbody>
            ${chargesRowsHtml}
          </tbody>
        </table>

        <div class="total-box">
          <div>
            <div style="font-size: 13px; font-weight: 800; color: #170e5e;">صافي المبلغ الإجمالي المطلوب سداده (TOTAL PAYABLE)</div>
            <div style="font-size: 10.5px; color: #64748b; margin-top: 2px;">شامل كافة المصاريف الملاحية والمحلية المعتمدة</div>
          </div>
          <div class="total-val">
            ${totalAmount.toLocaleString()}
          </div>
        </div>

        <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; font-size: 10.5px; color: #92400e; line-height: 1.45;">
          <strong>شرط تثبيت سعر الصرف (Rate of Exchange - ROE Clause):</strong>
          المبالغ المحررة بالنقد الأجنبي تسدد بالمعادل بالجنيه المصري طبقاً لسعر الصرف المعلن من البنك المركزي المصري بتاريخ سداد الفاتورة أو استلام إذن التسليم (D/O). أي فروق في سعر الصرف يتحملها المستورد.
        </div>

        <div class="bank-box">
          <div class="bank-title">بيانات التحويل البنكي (BANK WIRE DETAILS):</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <div>اسم البنك: <strong>البنك الأهلي التجاري / البنك الأهلي المصري</strong></div>
            <div>اسم المستفيد: <strong>${escapeHtml(companyName)}</strong></div>
            <div>رقم الآيبان (IBAN): <strong style="font-family: monospace;">EG1200030000123456789012345</strong></div>
            <div>سويفت كود (SWIFT): <strong style="font-family: monospace;">NBEGEGCX</strong></div>
          </div>
        </div>

        <div class="sign-grid">
          <div class="sign-box">
            إدارة الحسابات والمالية<br/>
            <strong>Financial Department</strong>
          </div>
          <div class="sign-box">
            استلام ومطابقة العميل<br/>
            <strong>Consignee Acknowledgement</strong>
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

/**
 * Convenience wrapper for printing client invoice from job charges breakdown.
 */
export function printJobChargesInvoice(job: MaritimeJob, charges: any[] = [], companyName?: string) {
  return printFreightInvoice(job, { charges, companyName });
}

/**
 * Generates and prints a Confidential Internal Job Profitability & Cost Center Audit Statement (PDF).
 */
export function printJobProfitabilitySheet(
  job: MaritimeJob,
  ledgerEntries: any[] = [],
  companyName = 'منظومة Z-Systems للشحن الملاحي',
) {
  const printWindow = window.open('', '_blank', 'width=950,height=1000');
  if (!printWindow) return;

  const revenue = Number(job.client_invoiced_total || 0);
  const carrierCost = Number(job.carrier_cost_total || 0);
  const otherCosts = Number(job.other_costs_total || 0);
  const totalCost = carrierCost + otherCosts;
  const netProfit = Number(job.net_profit || (revenue - totalCost));
  const marginPct = revenue > 0 ? ((netProfit / revenue) * 100).toFixed(1) : '0.0';

  const ledgerRowsHtml = ledgerEntries.map((e, idx) => `
    <tr>
      <td style="text-align: center;">${idx + 1}</td>
      <td style="font-family: monospace; font-size: 10px;">${e.entry_no || '—'}</td>
      <td>${e.entry_date ? new Date(e.entry_date).toLocaleDateString('ar-EG') : '—'}</td>
      <td>${e.description || e.account_name || 'حركة قيد محاسبي'}</td>
      <td style="text-align: left; font-family: monospace;">${Number(e.debit || 0).toLocaleString()}</td>
      <td style="text-align: left; font-family: monospace;">${Number(e.credit || 0).toLocaleString()}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8" />
        <title>كشف ربحية الشحنة - ${escapeHtml(job.job_number)}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 11.5px; color: #0f172a; margin: 0; padding: 20px; line-height: 1.5; }
          .header { border-bottom: 2px solid #170e5e; padding-bottom: 12px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: flex-start; }
          .brand { font-size: 18px; font-weight: 900; color: #170e5e; }
          .confidential-badge { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 4px; display: inline-block; margin-top: 4px; }
          
          .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 18px; }
          .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; text-align: center; }
          .kpi-label { font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 4px; }
          .kpi-val { font-size: 18px; font-weight: 900; font-family: monospace; }

          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th { background: #170e5e; color: #ffffff; padding: 7px 10px; font-size: 11px; font-weight: 800; text-align: right; }
          td { border-bottom: 1px solid #e2e8f0; padding: 7px 10px; font-size: 11px; }

          .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 35px; text-align: center; }
          .sign-box { border-top: 1px dashed #64748b; padding-top: 8px; font-size: 11px; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand">${escapeHtml(companyName)}</div>
            <div style="font-size: 11px; color: #475569;">تقرير ربحية أمر التشغيل والتحليل المالي لمركز التكلفة</div>
            <div class="confidential-badge">مستند تحليلي داخلي معتمد - سري للغاية</div>
          </div>
          <div style="text-align: left;">
            <div style="font-size: 14px; font-weight: 800; color: #170e5e; font-family: monospace;">JOB: #${escapeHtml(job.job_number)}</div>
            <div style="font-size: 10px; color: #64748b; margin-top: 2px;">العميل: <strong>${escapeHtml(job.customer_name)}</strong></div>
            <div style="font-size: 10px; color: #64748b;">مركز التكلفة: <strong>${job.cost_center_id || job.job_number}</strong></div>
          </div>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card" style="border-top: 3px solid #170e5e;">
            <div class="kpi-label">إجمالي إيرادات العميل (REVENUE)</div>
            <div class="kpi-val" style="color: #170e5e;">${revenue.toLocaleString()}</div>
          </div>
          <div class="kpi-card" style="border-top: 3px solid #ea580c;">
            <div class="kpi-label">تكاليف الخط والمصروفات (COSTS)</div>
            <div class="kpi-val" style="color: #ea580c;">${totalCost.toLocaleString()}</div>
            <div style="font-size: 9px; color: #64748b; margin-top: 2px;">(خط: ${carrierCost.toLocaleString()} | إضافي: ${otherCosts.toLocaleString()})</div>
          </div>
          <div class="kpi-card" style="border-top: 3px solid #16a34a;">
            <div class="kpi-label">صافي ربح الشحنة (NET MARGIN)</div>
            <div class="kpi-val" style="color: #16a34a;">${netProfit.toLocaleString()}</div>
            <div style="font-size: 10px; font-weight: 800; color: #16a34a; margin-top: 2px;">هامش الربحية: ${marginPct}%</div>
          </div>
        </div>

        <h4 style="margin: 16px 0 8px; color: #170e5e; font-size: 12px;">سجل الحركات وقيود دفتر الأستاذ العام للعملية:</h4>
        <table>
          <thead>
            <tr>
              <th style="width: 30px; text-align: center;">#</th>
              <th>رقم القيد</th>
              <th>تاريخ القيد</th>
              <th>البيان والتوجيه المحاسبي</th>
              <th style="text-align: left;">مدين (Debit)</th>
              <th style="text-align: left;">دائن (Credit)</th>
            </tr>
          </thead>
          <tbody>
            ${ledgerRowsHtml || '<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 20px;">لا توجد قيود مسجلة لهذا الملف حتى الآن</td></tr>'}
          </tbody>
        </table>

        <div class="sign-grid">
          <div class="sign-box">
            مدير العمليات اللوجستية<br/>
            <strong>Operations Director</strong>
          </div>
          <div class="sign-box">
            المدير المالي والمراجعة الداخلية<br/>
            <strong>Financial Controller</strong>
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


/**
 * Generates and prints an official SOLAS Verified Gross Mass (VGM) Certificate
 * conforming to IMO SOLAS Chapter VI Regulation 2 and international maritime safety standards.
 */
export function printSolasVgmCertificate(
  job: MaritimeJob,
  container?: MaritimeContainer,
  vgmDetails?: {
    method?: 'method_1' | 'method_2';
    verifiedGrossMassKg?: number;
    tareWeightKg?: number;
    cargoWeightKg?: number;
    weighingStation?: string;
    scaleId?: string;
    calibrationCertNo?: string;
    signatoryName?: string;
    weighingDate?: string;
  },
  companyName = 'منظومة Z-Systems للشحن الملاحي الدولي',
) {
  const printWindow = window.open('', '_blank', 'width=950,height=1000');
  if (!printWindow) return;

  const targetContainer = container || job.containers?.[0];
  const containerNo = targetContainer?.container_number || 'CONU0000000';
  const containerType = targetContainer?.container_type || "40' HC";
  const sealNo = targetContainer?.seal_number || '—';

  const method = vgmDetails?.method || (targetContainer as any)?.vgm_method || 'method_1';
  const isMethod1 = method === 'method_1';
  const tareWeight = Number(vgmDetails?.tareWeightKg || (targetContainer as any)?.tare_weight_kg || (containerType.includes('20') ? 2250 : 3850));
  const grossWeight = Number(vgmDetails?.verifiedGrossMassKg || (targetContainer as any)?.vgm_weight_kg || targetContainer?.gross_weight_kg || 0);
  const cargoWeight = Number(vgmDetails?.cargoWeightKg || (targetContainer as any)?.cargo_weight_kg || Math.max(0, grossWeight - tareWeight));
  const weighingStation = vgmDetails?.weighingStation || (targetContainer as any)?.weighing_station || 'محطة الميزان المعتمدة بميناء الشحن';
  const scaleId = vgmDetails?.scaleId || (targetContainer as any)?.scale_id || 'CAL-SCALE-01';
  const calibrationCertNo = vgmDetails?.calibrationCertNo || (targetContainer as any)?.calibration_cert_no || 'ISO/IEC-17025-VGM';
  const signatoryName = vgmDetails?.signatoryName || (targetContainer as any)?.vgm_signatory_name || job.customer_name || 'Authorized Signatory';
  const weighingDate = vgmDetails?.weighingDate || (targetContainer as any)?.vgm_weighing_date || todayLocalDateKey();
  const vgmCertNo = `VGM-${escapeHtml(job.job_number)}-${containerNo.slice(-4)}`;

  const html = `
    <!DOCTYPE html>
    <html dir="ltr" lang="en">
      <head>
        <meta charset="utf-8" />
        <title>SOLAS VGM Certificate - ${escapeHtml(vgmCertNo)}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11.5px; color: #0f172a; margin: 0; padding: 20px; line-height: 1.45; }
          .vgm-container { border: 2px solid #170e5e; border-radius: 8px; padding: 20px; }
          .vgm-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #170e5e; padding-bottom: 14px; margin-bottom: 16px; }
          .vgm-title { font-size: 18px; font-weight: 900; color: #170e5e; margin: 0 0 4px; letter-spacing: 0.5px; }
          .vgm-badge { background: #eff6ff; border: 1.5px solid #1d4ed8; padding: 8px 14px; border-radius: 6px; text-align: right; }
          .vgm-badge h4 { margin: 0; font-size: 13px; color: #1e40af; font-family: monospace; }
          
          .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
          .card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; background: #f8fafc; }
          .card-title { font-size: 10px; font-weight: 800; color: #170e5e; text-transform: uppercase; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
          .row { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px; }
          .row span:first-child { color: #64748b; font-weight: 600; }
          .row span:last-child { font-weight: 700; color: #0f172a; }

          .vgm-mass-banner { background: #f0fdf4; border: 2px solid #16a34a; border-radius: 8px; padding: 16px; margin-bottom: 20px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; text-align: center; }
          .mass-item strong { display: block; font-size: 10px; color: #166534; text-transform: uppercase; margin-bottom: 4px; }
          .mass-item .val { font-size: 20px; font-weight: 900; color: #14532d; font-family: monospace; }

          .method-box { background: #eff6ff; border: 1px solid #93c5fd; border-radius: 6px; padding: 12px; margin-bottom: 20px; }
          .method-box strong { color: #1e40af; font-size: 12px; }

          .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; text-align: center; }
          .sign-box { border-top: 1px dashed #64748b; padding-top: 8px; font-size: 10.5px; font-weight: 700; }
          .legal-footer { margin-top: 30px; font-size: 9px; color: #64748b; line-height: 1.4; border-top: 1px solid #e2e8f0; padding-top: 10px; }
        </style>
      </head>
      <body>
        <div class="vgm-container">
          <div class="vgm-header">
            <div>
              <div class="vgm-title">SOLAS VERIFIED GROSS MASS (VGM) CERTIFICATE</div>
              <div style="font-size: 10.5px; color: #475569;">Conforming to IMO SOLAS Convention Chapter VI, Regulation 2 / MSC.1/Circ.1475</div>
              <div style="font-size: 11px; font-weight: 700; color: #170e5e; margin-top: 4px;">${escapeHtml(companyName)}</div>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
              <div class="vgm-badge">
                <div style="font-size: 9px; color: #64748b;">CERTIFICATE NO.</div>
                <h4>${escapeHtml(vgmCertNo)}</h4>
                <div style="font-size: 9px; color: #475569; margin-top: 2px;">Job: #${escapeHtml(job.job_number)}</div>
              </div>
              <div style="border: 1px solid #cbd5e1; padding: 4px; border-radius: 4px; background: #ffffff;">
                ${getTrackingQrCode(job.tracking_token || job.job_number, 52)}
              </div>
            </div>
          </div>

          <div class="vgm-mass-banner">
            <div class="mass-item">
              <strong>Verified Gross Mass (VGM)</strong>
              <div class="val" style="color: #15803d; font-size: 22px;">${grossWeight.toLocaleString()} KG</div>
            </div>
            <div class="mass-item">
              <strong>Container Tare Weight</strong>
              <div class="val" style="color: #0369a1;">${tareWeight.toLocaleString()} KG</div>
            </div>
            <div class="mass-item">
              <strong>Cargo Net Mass</strong>
              <div class="val" style="color: #475569;">${cargoWeight.toLocaleString()} KG</div>
            </div>
          </div>

          <div class="method-box">
            <strong>Verification Method Applied:</strong>
            <div style="margin-top: 4px; font-size: 11px; color: #1e3a8a;">
              ${isMethod1
                ? 'Method 1: Weighing the packed container using calibrated and certified weighing equipment (Weighbridge / Port scale).'
                : 'Method 2: Weighing all packages and cargo items including pallets, dunnage, and securing material, plus the tare mass of the container.'}
            </div>
          </div>

          <div class="grid-2">
            <div class="card">
              <div class="card-title">Container & Vessel Information</div>
              <div class="row"><span>Container Number:</span><span style="font-family: monospace; font-size: 12px; color: #170e5e;">${escapeHtml(containerNo)}</span></div>
              <div class="row"><span>Container Type / Size:</span><span>${escapeHtml(containerType)}</span></div>
              <div class="row"><span>Seal Number:</span><span style="font-family: monospace;">${escapeHtml(sealNo)}</span></div>
              <div class="row"><span>Ocean Carrier / Line:</span><span>${escapeHtml(job.shipping_line_name)}</span></div>
              <div class="row"><span>Vessel / Voyage:</span><span>${escapeHtml(job.vessel_name || 'TBN')} / ${escapeHtml(job.voyage_number || '—')}</span></div>
              <div class="row"><span>B/L or Booking No:</span><span>${escapeHtml(job.hbl_number || job.booking_number || job.job_number)}</span></div>
            </div>

            <div class="card">
              <div class="card-title">Weighing Station & Scale Verification</div>
              <div class="row"><span>Weighing Facility:</span><span>${escapeHtml(weighingStation)}</span></div>
              <div class="row"><span>Scale / Weighbridge ID:</span><span style="font-family: monospace;">${escapeHtml(scaleId)}</span></div>
              <div class="row"><span>Calibration Certificate:</span><span style="font-family: monospace;">${escapeHtml(calibrationCertNo)}</span></div>
              <div class="row"><span>Weighing Date & Time:</span><span>${escapeHtml(weighingDate)}</span></div>
              <div class="row"><span>Port of Loading (POL):</span><span>${escapeHtml(job.pol_name)} (${escapeHtml(job.pol_code)})</span></div>
              <div class="row"><span>Port of Discharge (POD):</span><span>${escapeHtml(job.pod_name)} (${escapeHtml(job.pod_code)})</span></div>
            </div>
          </div>

          <div class="sign-grid">
            <div class="sign-box">
              Shipper / Authorized Representative<br/>
              <strong>${escapeHtml(signatoryName)}</strong>
              <div style="margin-top: 35px; border-top: 1px dashed #475569; padding-top: 4px;">Authorized Signature & Company Stamp</div>
            </div>
            <div class="sign-box">
              Weighbridge Officer / Station Supervisor<br/>
              <strong>Certified Weighing Facility</strong>
              <div style="margin-top: 35px; border-top: 1px dashed #475569; padding-top: 4px;">Scale Operator Signature</div>
            </div>
          </div>

          <div class="legal-footer">
            <strong>Declaration of Compliance:</strong> The undersigned hereby certifies that the gross mass of the container identified above has been determined in accordance with the International Convention for the Safety of Life at Sea (SOLAS), Chapter VI, Regulation 2. It is acknowledged that this document forms the regulatory basis for vessel stowage planning and maritime safety.
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

/**
 * Generates and prints official Shipping Instructions (S/I)
 * submitted by the Freight Forwarder to Ocean Carriers / Airlines before B/L or AWB draft issuance.
 */
export function printShippingInstructions(
  job: MaritimeJob,
  containers: MaritimeContainer[] = [],
  companyName = 'منظومة Z-Systems للشحن الدولي واللوجستيات',
) {
  const printWindow = window.open('', '_blank', 'width=950,height=1000');
  if (!printWindow) return;

  const containersList = containers.length > 0 ? containers : (job.containers || []);
  const totalWeight = containersList.reduce((sum, c) => sum + Number(c.gross_weight_kg || 0), Number(job.gross_weight_kg || 0));
  const totalCbm = containersList.reduce((sum, c) => sum + Number(c.cbm || 0), Number(job.total_cbm || 0));
  const siNo = `SI-${escapeHtml(job.job_number)}`;

  const containerRowsHtml = containersList.map((c, idx) => `
    <tr>
      <td style="text-align: center; font-weight: 700;">${idx + 1}</td>
      <td style="font-weight: 800; font-family: monospace;">${escapeHtml(c.container_number)}</td>
      <td>${escapeHtml(c.container_type)}</td>
      <td style="font-family: monospace;">${escapeHtml(c.seal_number || '—')}</td>
      <td style="text-align: right;">${Number(c.gross_weight_kg || 0).toLocaleString()} KG</td>
      <td style="text-align: right;">${Number(c.cbm || 0).toFixed(2)} CBM</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html dir="ltr" lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Shipping Instructions - ${escapeHtml(siNo)}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #0f172a; margin: 0; padding: 18px; line-height: 1.4; }
          .si-container { border: 2px solid #170e5e; border-radius: 8px; padding: 18px; }
          .si-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #170e5e; padding-bottom: 12px; margin-bottom: 16px; }
          .si-title { font-size: 18px; font-weight: 900; color: #170e5e; margin: 0 0 4px; }
          .si-badge { background: #eff6ff; border: 1.5px solid #1d4ed8; padding: 8px 14px; border-radius: 6px; text-align: right; }
          .si-badge h4 { margin: 0; font-size: 14px; color: #1e40af; font-family: monospace; }

          .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
          .card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; background: #f8fafc; }
          .card-title { font-size: 9.5px; font-weight: 800; color: #170e5e; text-transform: uppercase; margin-bottom: 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; }
          .card-content { font-size: 11px; font-weight: 600; line-height: 1.45; }

          table.cargo-table { width: 100%; border-collapse: collapse; margin: 14px 0; }
          table.cargo-table th { background: #170e5e; color: #ffffff; padding: 6px 8px; font-size: 9px; font-weight: 800; text-transform: uppercase; text-align: left; }
          table.cargo-table td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 10.5px; }

          .terms-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; background: #eff6ff; padding: 10px 14px; border-radius: 6px; border: 1px solid #bfdbfe; }
          .term-item strong { display: block; font-size: 8.5px; color: #1e40af; text-transform: uppercase; }
          .term-item span { font-size: 11.5px; font-weight: 800; color: #0f172a; }

          .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 30px; text-align: center; }
          .sign-box { border-top: 1px dashed #64748b; padding-top: 8px; font-size: 10.5px; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="si-container">
          <div class="si-header">
            <div>
              <div class="si-title">SHIPPING INSTRUCTIONS (S/I)</div>
              <div style="font-size: 10px; color: #64748b;">FREIGHT FORWARDER STANDARD B/L ISSUANCE INSTRUCTIONS</div>
              <div style="font-size: 11px; font-weight: 700; color: #170e5e; margin-top: 3px;">${escapeHtml(companyName)}</div>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
              <div class="si-badge">
                <div style="font-size: 8.5px; color: #64748b;">S/I REFERENCE NO.</div>
                <h4>${escapeHtml(siNo)}</h4>
                <div style="font-size: 9px; color: #475569; margin-top: 2px;">Booking: ${escapeHtml(job.booking_number || '—')}</div>
              </div>
              <div style="border: 1px solid #cbd5e1; padding: 4px; border-radius: 4px; background: #ffffff;">
                ${getTrackingQrCode(job.tracking_token || job.job_number, 50)}
              </div>
            </div>
          </div>

          <div class="terms-grid">
            <div class="term-item">
              <strong>Carrier / Shipping Line</strong>
              <span>${escapeHtml(job.shipping_line_name)}</span>
            </div>
            <div class="term-item">
              <strong>Vessel & Voyage</strong>
              <span>${escapeHtml(job.vessel_name || 'TBN')} / ${escapeHtml(job.voyage_number || '—')}</span>
            </div>
            <div class="term-item">
              <strong>Freight Payment Term</strong>
              <span style="color: #170e5e;">${job.payment_term === 'collect' ? 'FREIGHT COLLECT' : 'FREIGHT PREPAID'}</span>
            </div>
            <div class="term-item">
              <strong>B/L Type Required</strong>
              <span>${job.bl_type === 'sea_waybill' ? 'SEA WAYBILL / EXPRESS' : 'ORIGINAL (3/3)'}</span>
            </div>
          </div>

          <div class="grid-2">
            <div class="card">
              <div class="card-title">1. Shipper / Exporter</div>
              <div class="card-content">${escapeHtml(job.shipper_details || 'AS PER COMMERCIAL INVOICE')}</div>
            </div>
            <div class="card">
              <div class="card-title">2. Consignee</div>
              <div class="card-content">
                <strong>${escapeHtml(job.customer_name)}</strong><br/>
                ${escapeHtml(job.consignee_details || 'TO ORDER')}
              </div>
            </div>
            <div class="card">
              <div class="card-title">3. Notify Party</div>
              <div class="card-content">${escapeHtml(job.notify_party || 'SAME AS CONSIGNEE')}</div>
            </div>
            <div class="card">
              <div class="card-title">4. Routing & Ports</div>
              <div class="card-content">
                POL: <strong>${escapeHtml(job.pol_name)}</strong> (${escapeHtml(job.pol_code)})<br/>
                POD: <strong>${escapeHtml(job.pod_name)}</strong> (${escapeHtml(job.pod_code)})<br/>
                Cut-off Date: ${escapeHtml(job.port_cut_off ? new Date(job.port_cut_off).toLocaleDateString() : '—')}
              </div>
            </div>
          </div>

          <table class="cargo-table">
            <thead>
              <tr>
                <th style="width: 30px; text-align: center;">#</th>
                <th>Container No.</th>
                <th>Type</th>
                <th>Seal No.</th>
                <th style="text-align: right;">Gross Weight</th>
                <th style="text-align: right;">Measurement</th>
              </tr>
            </thead>
            <tbody>
              ${containerRowsHtml || '<tr><td colspan="6" style="text-align: center; padding: 15px; color: #94a3b8;">No containers registered</td></tr>'}
            </tbody>
            <tfoot>
              <tr style="font-weight: 800; background: #f8fafc;">
                <td colspan="4" style="text-align: right; padding: 6px 10px;">Total Weight & Volume:</td>
                <td style="text-align: right; padding: 6px 10px;">${totalWeight.toLocaleString()} KG</td>
                <td style="text-align: right; padding: 6px 10px;">${totalCbm.toFixed(2)} CBM</td>
              </tr>
            </tfoot>
          </table>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px; margin-bottom: 20px; font-size: 10.5px;">
            <strong>Special Instructions & Remarks:</strong>
            <div style="margin-top: 3px; color: #475569;">
              ${escapeHtml(job.notes || 'Please release Draft B/L for shipper verification prior to vessel departure. Clean On Board Bill of Lading required.')}
            </div>
          </div>

          <div class="sign-grid">
            <div class="sign-box">
              Prepared by Forwarder Operations<br/>
              <strong>${escapeHtml(companyName)}</strong>
            </div>
            <div class="sign-box">
              Carrier Booking Confirmation Officer<br/>
              <strong>${escapeHtml(job.shipping_line_name)}</strong>
            </div>
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
