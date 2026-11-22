import type { MaritimeJob } from '../../api/maritime-freight.api';
import { escapeHtml } from './print-helpers';

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
