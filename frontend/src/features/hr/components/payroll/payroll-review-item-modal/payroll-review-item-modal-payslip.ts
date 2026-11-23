import { money, text } from '@/features/hr/pages/payroll/hr-payroll.helpers';
import type { HrPayrollRunItem } from '@/types/domain';

export interface PrintPayslipArgs {
  item: HrPayrollRunItem;
  periodMonth?: string;
  isHourly: boolean;
  canViewSalaryAmounts: boolean;
  hourlyRate: number;
  calculatedHours: number;
  runIsFinal: boolean;
  baseSalary: number;
  allowanceAmount: number;
  grossPay: number;
  deductionAmount: number;
  loanDeduction: number;
  insuranceDeduction: number;
  taxDeduction: number;
  totalDeductions: number;
  netPay: number;
}

export function printPayslip({ item, periodMonth, isHourly, canViewSalaryAmounts, hourlyRate, calculatedHours, runIsFinal, baseSalary, allowanceAmount, grossPay, deductionAmount, loanDeduction, insuranceDeduction, taxDeduction, totalDeductions, netPay }: PrintPayslipArgs): void {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  printWindow.document.write(`
    <html dir="rtl" lang="ar">
      <head>
        <title>قسيمة استلام راتب - ${text(item.employeeName)} (${periodMonth || ''}) - Z-Systems ERP</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');
          @page { size: A4 portrait; margin: 15mm; }
          body {
            font-family: 'Tajawal', Tahoma, Arial, sans-serif;
            padding: 0;
            margin: 0;
            color: #1e293b;
            line-height: 1.6;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .payslip-container {
            border: 2px solid #170e5e;
            border-radius: 12px;
            padding: 24px;
            max-width: 760px;
            margin: 0 auto;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 16px;
            margin-bottom: 20px;
          }
          .header-info h1 {
            margin: 0;
            color: #170e5e;
            font-size: 22px;
            font-weight: 800;
          }
          .header-info p {
            margin: 4px 0 0;
            color: #64748b;
            font-size: 13px;
          }
          .doc-badge {
            background: #f8fafc;
            border: 1.5px solid #170e5e;
            padding: 8px 16px;
            border-radius: 8px;
            font-weight: 800;
            font-size: 13.5px;
            color: #170e5e;
            text-align: center;
            box-shadow: 0 1px 3px rgba(23,14,94,0.06);
          }
          .employee-card {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 12px 16px;
            margin-bottom: 20px;
            font-size: 12.5px;
          }
          .card-item .label {
            color: #64748b;
            font-size: 11px;
            margin-bottom: 2px;
          }
          .card-item .val {
            font-weight: 700;
            color: #0f172a;
          }
          .columns-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin-bottom: 20px;
          }
          .section-box {
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            overflow: hidden;
          }
          .section-header {
            padding: 8px 12px;
            font-weight: 700;
            font-size: 13px;
            display: flex;
            justify-content: space-between;
            border-bottom: 1px solid #cbd5e1;
          }
          .section-header.earnings {
            background: #f0fdf4;
            color: #166534;
            border-bottom-color: #bbf7d0;
          }
          .section-header.deductions {
            background: #fef2f2;
            color: #991b1b;
            border-bottom-color: #fecdd3;
          }
          .row-item {
            display: flex;
            justify-content: space-between;
            padding: 8px 12px;
            border-bottom: 1px dashed #e2e8f0;
            font-size: 12.5px;
          }
          .row-item:last-child {
            border-bottom: none;
          }
          .row-item.total {
            font-weight: 700;
            background: #fafafa;
            border-top: 1px solid #cbd5e1;
          }
          .net-banner {
            background: #170e5e;
            color: #ffffff;
            border-radius: 8px;
            padding: 14px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
          }
          .net-banner .title {
            font-size: 15px;
            font-weight: 700;
          }
          .net-banner .amount {
            font-size: 24px;
            font-weight: 800;
          }
          .notes-box {
            background: #fffbeb;
            border: 1px solid #fde68a;
            border-radius: 8px;
            padding: 10px 14px;
            font-size: 12px;
            color: #92400e;
            margin-bottom: 24px;
          }
          .signatures {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            text-align: center;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px dashed #cbd5e1;
          }
          .sig-title {
            font-size: 12px;
            font-weight: 700;
            color: #475569;
            margin-bottom: 45px;
          }
          .sig-line {
            border-bottom: 1px solid #94a3b8;
            width: 75%;
            margin: 0 auto;
          }
        </style>
      </head>
      <body>
        <div class="payslip-container">
          <div class="header">
            <div class="header-info">
              <h1>${isHourly ? 'قسيمة استلام أجر (Wage Payslip)' : 'قسيمة استلام راتب (Payslip)'}</h1>
              <p>مسير شهر: ${text(periodMonth)} | تاريخ الإصدار: ${new Date().toLocaleDateString('ar-EG')}</p>
            </div>
            <div class="doc-badge">
              <span style="display: block; font-size: 14px; font-weight: 800; color: #170e5e; letter-spacing: 0.5px;">Z-Systems ERP</span>
              <small style="color: #64748b; font-weight: 600; font-size: 10.5px;">${isHourly ? 'إدارة الموارد البشرية والأجور' : 'إدارة الموارد البشرية والرواتب'}</small>
            </div>
          </div>

          <div class="employee-card" style="grid-template-columns: repeat(${isHourly ? 5 : 4}, 1fr);">
            <div class="card-item">
              <div class="label">اسم الموظف:</div>
              <div class="val">${text(item.employeeName)}</div>
            </div>
            <div class="card-item">
              <div class="label">كود الموظف:</div>
              <div class="val">${text(item.employeeNo)}</div>
            </div>
            <div class="card-item">
              <div class="label">نظام العمل:</div>
              <div class="val">${isHourly ? 'أجر بالساعة/اليوم' : 'راتب شهري تعاقدي'}</div>
            </div>
            ${isHourly ? `
            <div class="card-item">
              <div class="label">أجر الساعة:</div>
              <div class="val" style="color: #166534;">${canViewSalaryAmounts && hourlyRate > 0 ? money(hourlyRate) + ' / س' : '—'}</div>
            </div>
            <div class="card-item">
              <div class="label">ساعات العمل المحتسبة:</div>
              <div class="val" style="color: #1e40af;">${calculatedHours > 0 ? calculatedHours + ' ساعة' : '—'}</div>
            </div>
            ` : `
            <div class="card-item">
              <div class="label">حالة المسير:</div>
              <div class="val">${runIsFinal ? 'معتمد نهائياً' : 'مسودة قيد المراجعة'}</div>
            </div>
            `}
          </div>

          <div class="columns-grid">
            <div class="section-box">
              <div class="section-header earnings">
                <span>الاستحقاقات المالية</span>
                <span>المبلغ (ج.م)</span>
              </div>
              <div class="row-item">
                <span>${isHourly ? 'أجر ساعات العمل المحتسبة' : 'الراتب الأساسي'} ${isHourly && calculatedHours > 0 ? `(${calculatedHours}س × ${money(hourlyRate)}/س)` : ''}</span>
                <span>${canViewSalaryAmounts ? money(baseSalary) : '—'}</span>
              </div>
              <div class="row-item">
                <span>البدلات والمكافآت والإضافي</span>
                <span>${canViewSalaryAmounts ? money(allowanceAmount) : '—'}</span>
              </div>
              <div class="row-item total">
                <span>إجمالي الاستحقاقات (Gross):</span>
                <span style="color: #166534;">${canViewSalaryAmounts ? money(grossPay) : '—'}</span>
              </div>
            </div>

            <div class="section-box">
              <div class="section-header deductions">
                <span>الاستقطاعات والجزاءات</span>
                <span>المبلغ (ج.م)</span>
              </div>
              <div class="row-item">
                <span>جزاءات التأخير والغياب</span>
                <span style="color: #dc2626;">${canViewSalaryAmounts ? money(deductionAmount) : '—'}</span>
              </div>
              <div class="row-item">
                <span>أقساط السلف والمديونيات</span>
                <span style="color: #dc2626;">${canViewSalaryAmounts ? money(loanDeduction) : '—'}</span>
              </div>
              ${insuranceDeduction > 0 ? `
              <div class="row-item">
                <span>تأمينات اجتماعية (حصة الموظف)</span>
                <span style="color: #dc2626;">${canViewSalaryAmounts ? money(insuranceDeduction) : '—'}</span>
              </div>` : ''}
              ${taxDeduction > 0 ? `
              <div class="row-item">
                <span>ضريبة كسب العمل</span>
                <span style="color: #dc2626;">${canViewSalaryAmounts ? money(taxDeduction) : '—'}</span>
              </div>` : ''}
              <div class="row-item total">
                <span>إجمالي الاستقطاعات:</span>
                <span style="color: #dc2626;">${canViewSalaryAmounts ? money(totalDeductions) : '—'}</span>
              </div>
            </div>
          </div>

          <div class="net-banner">
            <div class="title">${isHourly ? 'صافي الأجر المستحق للصرف:' : 'صافي الراتب المستحق للصرف:'}</div>
            <div class="amount">${canViewSalaryAmounts ? money(netPay) : '—'}</div>
          </div>

          ${(item.payrollReviewNotes || item.notes) ? `
          <div class="notes-box">
            <strong>ملاحظات مراجعة الحضور والتدقيق:</strong><br>
            ${text(item.payrollReviewNotes || item.notes)}
          </div>` : ''}

          <div class="signatures">
            <div>
              <div class="sig-title">${isHourly ? 'توقيع العامل / الموظف بالاستلام' : 'توقيع الموظف بالاستلام'}</div>
              <div class="sig-line"></div>
            </div>
            <div>
              <div class="sig-title">إعداد وتدقيق الموارد البشرية</div>
              <div class="sig-line"></div>
            </div>
            <div>
              <div class="sig-title">اعتماد الإدارة المالية</div>
              <div class="sig-line"></div>
            </div>
          </div>

          <div style="margin-top: 24px; border-top: 1px dashed #cbd5e1; padding-top: 8px; display: flex; justify-content: space-between; align-items: center; font-size: 9.5px; color: #64748b; clear: both; page-break-inside: avoid;">
            <span>تم إصدار واعتماد قسيمة ${isHourly ? 'الأجر' : 'الراتب'} إلكترونياً عبر منظومة <strong>Z-Systems Cloud ERP</strong> لإدارة المؤسسات والموارد البشرية</span>
            <span dir="ltr" style="font-weight: 700; color: #170e5e;">Powered by Z-Systems ERP • www.z-systems.io</span>
          </div>
        </div>
        <script>
          setTimeout(() => { window.print(); window.close(); }, 500);
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
}
