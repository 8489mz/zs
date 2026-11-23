import { money, text, normalize } from '@/features/hr/pages/payroll/hr-payroll.helpers';
import type { HrPayrollRunItem } from '@/types/domain';

export interface PrintThermalReceiptArgs {
  isHourly: boolean;
  item: HrPayrollRunItem;
  periodMonth?: string;
  canViewSalaryAmounts: boolean;
  hourlyRate: number;
  calculatedHours: number;
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

export function printThermalReceipt({ isHourly, item, periodMonth, canViewSalaryAmounts, hourlyRate, calculatedHours, baseSalary, allowanceAmount, grossPay, deductionAmount, loanDeduction, insuranceDeduction, taxDeduction, totalDeductions, netPay }: PrintThermalReceiptArgs): void {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8" />
          <title>إيصال استلام ${isHourly ? 'أجر' : 'راتب'} - ${text(item.employeeName)} - Z-Systems</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@500;700;800&display=swap');
            @page {
              size: 80mm auto;
              margin: 0;
            }
            *, *::before, *::after {
              box-sizing: border-box;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            html, body {
              font-family: 'Tajawal', 'Cairo', Tahoma, 'Segoe UI', Arial, sans-serif;
              margin: 0;
              padding: 0;
              width: 100%;
              color: #000000;
              background: #ffffff;
              font-size: 11px;
              line-height: 1.35;
              direction: rtl;
              text-align: right;
              -webkit-font-smoothing: antialiased;
            }
            .thermal-container {
              width: 100%;
              max-width: 68mm;
              margin: 0 auto;
              padding: 3mm 1.5mm;
            }
            .thermal-header {
              text-align: center;
              border-bottom: 1.5px dashed #000000;
              padding-bottom: 6px;
              margin-bottom: 6px;
            }
            .brand-title {
              font-size: 14px;
              font-weight: 800;
              margin: 0;
              color: #000000;
              letter-spacing: -0.2px;
            }
            .doc-title {
              font-size: 12.5px;
              font-weight: 800;
              margin: 2px 0;
              color: #000000;
            }
            .meta-text {
              font-size: 10px;
              color: #334155;
              margin-top: 2px;
            }
            .info-table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
              margin-bottom: 6px;
              border-bottom: 1px dashed #000000;
              padding-bottom: 4px;
            }
            .info-table td {
              padding: 2px 0;
              font-size: 10.5px;
              vertical-align: top;
            }
            .info-table .lbl {
              width: 32%;
              color: #475569;
              font-weight: 600;
            }
            .info-table .val {
              width: 68%;
              font-weight: 700;
              color: #000000;
              text-align: left;
              direction: rtl;
              word-break: break-word;
            }
            .section-bar {
              background: #f1f5f9;
              border: 1px solid #cbd5e1;
              border-radius: 3px;
              padding: 3px 6px;
              font-weight: 800;
              font-size: 11px;
              margin: 6px 0 3px;
              display: flex;
              justify-content: space-between;
              align-items: center;
            }
            .section-bar.deduct {
              background: #fef2f2;
              border-color: #fecaca;
              color: #991b1b;
            }
            .items-table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
              margin-bottom: 4px;
            }
            .items-table td {
              padding: 2.5px 1px;
              font-size: 10.5px;
              vertical-align: top;
            }
            .desc-col {
              width: 58%;
              text-align: right;
              word-break: break-word;
              padding-left: 3px;
            }
            .amount-col {
              width: 42%;
              text-align: left;
              white-space: nowrap;
              direction: ltr;
              font-weight: 700;
              font-size: 11px;
            }
            .sub-total-row {
              border-top: 1px dashed #94a3b8;
              font-weight: 800;
            }
            .sub-total-row td {
              padding-top: 4px;
            }
            .net-box {
              border: 2px solid #000000;
              background: #f8fafc;
              border-radius: 6px;
              padding: 6px 4px;
              margin: 8px 0;
              text-align: center;
            }
            .net-label {
              font-size: 11px;
              font-weight: 700;
              color: #334155;
            }
            .net-amount {
              font-size: 18px;
              font-weight: 900;
              color: #000000;
              margin-top: 2px;
              white-space: nowrap;
              direction: ltr;
            }
            .paid-badge {
              background: #f0fdf4;
              border: 1px solid #86efac;
              color: #166534;
              font-size: 10px;
              font-weight: 700;
              text-align: center;
              padding: 3px 4px;
              border-radius: 4px;
              margin: 6px 0;
            }
            .notes-box {
              background: #fffbeb;
              border: 1px dashed #d97706;
              border-radius: 4px;
              padding: 4px 6px;
              margin: 6px 0;
              font-size: 9.5px;
              color: #92400e;
              line-height: 1.4;
            }
            .signatures {
              margin-top: 12px;
              padding-top: 6px;
              border-top: 1px dashed #94a3b8;
            }
            .sig-table {
              width: 100%;
              border-collapse: collapse;
            }
            .sig-table td {
              width: 50%;
              text-align: center;
              font-size: 10px;
              font-weight: 700;
              vertical-align: top;
            }
            .sig-space {
              height: 26px;
              border-bottom: 1px solid #000000;
              margin: 0 6px;
            }
            .thermal-footer {
              margin-top: 8px;
              padding-top: 4px;
              border-top: 1px dashed #cbd5e1;
              text-align: center;
              font-size: 9px;
              color: #64748b;
            }
          </style>
        </head>
        <body>
          <div class="thermal-container">
            <div class="thermal-header">
              <h1 class="brand-title">Z-Systems ERP</h1>
              <div class="doc-title">${isHourly ? 'إيصال استلام أجر (Wage Receipt)' : 'إيصال استلام راتب'}</div>
              <div class="meta-text">مسير: ${text(periodMonth)} • التاريخ: ${new Date().toLocaleDateString('ar-EG')}</div>
            </div>

            <table class="info-table">
              <tr>
                <td class="lbl">الموظف:</td>
                <td class="val">${text(item.employeeName)}</td>
              </tr>
              <tr>
                <td class="lbl">الكود:</td>
                <td class="val">#${text(item.employeeNo)}</td>
              </tr>
              <tr>
                <td class="lbl">نظام الأجر:</td>
                <td class="val">${isHourly ? 'أجر بالساعة / اليوم' : 'راتب شهري تعاقدي'}</td>
              </tr>
              ${isHourly ? `
              <tr>
                <td class="lbl">أجر الساعة:</td>
                <td class="val" style="color: #166534;"><span style="white-space: nowrap; direction: ltr; display: inline-block;">${canViewSalaryAmounts && hourlyRate > 0 ? money(hourlyRate) + ' / س' : '—'}</span></td>
              </tr>
              <tr>
                <td class="lbl">ساعات العمل:</td>
                <td class="val" style="color: #166534;"><span style="white-space: nowrap;">${calculatedHours > 0 ? calculatedHours + ' ساعة' : '—'}</span></td>
              </tr>
              ` : ''}
            </table>

            <div class="section-bar">
              <span>الاستحقاقات</span>
              <span style="font-size: 10px; color: #475569;">المبلغ</span>
            </div>
            <table class="items-table">
              <tr>
                <td class="desc-col">
                  <div><strong>${isHourly ? 'أجر الساعات (الأساسي)' : 'الأساسي'}</strong></div>
                  ${isHourly && calculatedHours > 0 ? `<div style="font-size: 9.5px; color: #64748b;">(${calculatedHours} ساعة × ${money(hourlyRate)})</div>` : ''}
                </td>
                <td class="amount-col">${canViewSalaryAmounts ? money(baseSalary) : '—'}</td>
              </tr>
              ${allowanceAmount > 0 ? `
              <tr>
                <td class="desc-col">
                  <div>البدلات والإضافي والمكافآت</div>
                </td>
                <td class="amount-col" style="color: #166534;">+${canViewSalaryAmounts ? money(allowanceAmount) : '—'}</td>
              </tr>` : ''}
              <tr class="sub-total-row">
                <td class="desc-col">إجمالي المستحق (Gross):</td>
                <td class="amount-col">${canViewSalaryAmounts ? money(grossPay) : '—'}</td>
              </tr>
            </table>

            <div class="section-bar deduct">
              <span>الاستقطاعات والخصومات</span>
              <span style="font-size: 10px;">المبلغ</span>
            </div>
            <table class="items-table">
              ${deductionAmount > 0 ? `
              <tr>
                <td class="desc-col">تأخير وغياب وحضور</td>
                <td class="amount-col" style="color: #dc2626;">-${canViewSalaryAmounts ? money(deductionAmount) : '—'}</td>
              </tr>` : ''}
              ${loanDeduction > 0 ? `
              <tr>
                <td class="desc-col">أقساط سلف ومديونيات</td>
                <td class="amount-col" style="color: #dc2626;">-${canViewSalaryAmounts ? money(loanDeduction) : '—'}</td>
              </tr>` : ''}
              ${insuranceDeduction > 0 ? `
              <tr>
                <td class="desc-col">تأمينات اجتماعية</td>
                <td class="amount-col" style="color: #dc2626;">-${canViewSalaryAmounts ? money(insuranceDeduction) : '—'}</td>
              </tr>` : ''}
              ${taxDeduction > 0 ? `
              <tr>
                <td class="desc-col">ضريبة كسب العمل</td>
                <td class="amount-col" style="color: #dc2626;">-${canViewSalaryAmounts ? money(taxDeduction) : '—'}</td>
              </tr>` : ''}
              ${totalDeductions === 0 ? `
              <tr>
                <td class="desc-col" style="color: #64748b; font-size: 10px;">لا توجد استقطاعات</td>
                <td class="amount-col" style="color: #64748b;">0.00 ج.م</td>
              </tr>` : ''}
              <tr class="sub-total-row" style="color: #991b1b;">
                <td class="desc-col">إجمالي الاستقطاعات:</td>
                <td class="amount-col" style="color: #dc2626;">-${canViewSalaryAmounts ? money(totalDeductions) : '—'}</td>
              </tr>
            </table>

            <div class="net-box">
              <div class="net-label">${isHourly ? 'صافي الأجر المستحق للصرف' : 'صافي الراتب المستحق للصرف'}</div>
              <div class="net-amount">${canViewSalaryAmounts ? money(netPay) : '—'}</div>
            </div>

            ${normalize(item.status) === 'paid' ? `
            <div class="paid-badge">
              تم الصرف نقداً • مسجل بالمنظومة
            </div>` : ''}

            ${(item.payrollReviewNotes || item.notes) ? `
            <div class="notes-box">
              <strong>ملاحظات:</strong> ${text(item.payrollReviewNotes || item.notes)}
            </div>` : ''}

            <div class="signatures">
              <table class="sig-table">
                <tr>
                  <td>
                    <div>المستلم / الموظف</div>
                    <div class="sig-space"></div>
                  </td>
                  <td>
                    <div>مسؤول الصرف</div>
                    <div class="sig-space"></div>
                  </td>
                </tr>
              </table>
            </div>

            <div class="thermal-footer">
              طُبعت آلياً • منظومة Z-Systems ERP<br>
              www.z-systems.io
            </div>
          </div>

          <script>
            window.addEventListener('load', function() {
              setTimeout(function() {
                window.focus();
                window.print();
              }, 250);
            });
            window.onafterprint = function() {
              try { window.close(); } catch(e) {}
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
}
