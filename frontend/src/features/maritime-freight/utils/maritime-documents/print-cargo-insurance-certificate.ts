import type { MaritimeJob } from '../../api/maritime-freight.api';
import { escapeHtml } from './print-helpers';

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
