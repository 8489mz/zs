import type { MaritimeJob } from '../../api/maritime-freight.api';
import { escapeHtml } from './print-helpers';

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
