import type { MaritimeJob } from '../../api/maritime-freight.api';
import { escapeHtml, getTrackingQrCode } from './print-helpers';

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
