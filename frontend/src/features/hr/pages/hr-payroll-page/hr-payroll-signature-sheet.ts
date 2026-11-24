import { money, payrollPrintHtmlText, statusLabel, text } from '@/features/hr/pages/payroll/hr-payroll.helpers';
import type { HrPayrollRun, HrPayrollRunItem } from '@/types/domain';

export interface PrintPayrollSignatureSheetProps {
  selectedRun: HrPayrollRun | undefined;
  isSelectedRunHourlyOrWeekly: boolean;
  filteredRunItems: HrPayrollRunItem[];
  isEg: boolean;
  summary: { totalNet: number; totalBase: number; totalBaseSalary: number; totalAllowances: number; totalDeductions: number; totalLoanDeduction: number; flaggedCount: number; needsReview: number; itemCount: number; totalEmployees: number; }
}

  export const printPayrollSignatureSheet = ({ selectedRun, isSelectedRunHourlyOrWeekly, filteredRunItems, isEg, summary }: PrintPayrollSignatureSheetProps) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html dir="rtl" lang="ar">
        <head>
          <title>كشف تسليم الرواتب - ${payrollPrintHtmlText(text(selectedRun?.periodMonth))}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
            @page { size: A4 portrait; margin: 10mm 12mm; }
            body { font-family: 'Tajawal', Tahoma, Arial, sans-serif; padding: 0; margin: 0; color: #1e293b; line-height: 1.35; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .header { border-bottom: 2px solid #170e5e; padding-bottom: 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-end; }
            .header-meta { font-size: 11px; color: #475569; }
            .header-center { text-align: center; }
            .header-center h1 { margin: 0; color: #170e5e; font-size: 20px; font-weight: 800; }
            .header-center p { margin: 2px 0 0; color: #64748b; font-size: 12px; font-weight: 500; }
            .table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 12px; }
            .table thead { display: table-header-group; }
            .table tr { page-break-inside: avoid; }
            .table th, .table td { padding: 5px 8px; text-align: right; border: 1px solid #cbd5e1; }
            .table th { background-color: #f8fafc; font-weight: 700; color: #334155; border-bottom: 2px solid #94a3b8; }
            .table tbody tr:nth-child(even) { background-color: #fbfcfd; }
            .footer { margin-top: 18px; display: flex; justify-content: space-between; padding-top: 10px; clear: both; page-break-inside: avoid; }
            .signature-box { text-align: center; width: 30%; }
            .signature-box .title { font-weight: 700; color: #475569; margin-bottom: 25px; font-size: 11.5px; }
            .signature-box .line { border-bottom: 1px solid #94a3b8; width: 80%; margin: 0 auto; }
            .amount { font-family: monospace; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="header-meta" style="text-align: right;">
              <strong style="color: #170e5e; font-size: 13.5px; display: block;">Z-Systems ERP</strong>
              <span style="color: #64748b; font-size: 10.5px;">قطاع الموارد البشرية والمالية</span>
            </div>
            <div class="header-center">
              <h1>${isSelectedRunHourlyOrWeekly ? 'كشف تسليم أجور العاملين' : (isEg ? 'كشف تسليم المرتبات' : 'كشف تسليم الرواتب')}</h1>
              <p>خاص بشهر: ${payrollPrintHtmlText(text(selectedRun?.periodMonth))} | الحالة: ${payrollPrintHtmlText(statusLabel(selectedRun?.status))}</p>
            </div>
            <div class="header-meta" style="text-align: left;">
              <span style="color: #475569; font-size: 10.5px;">تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG')}</span><br>
              <span style="color: #64748b; font-size: 10.5px;">إجمالي القوى العاملة: ${filteredRunItems.length} موظف</span>
            </div>
          </div>
          <table class="table">
            <thead>
              <tr>
                <th style="width: 35px; text-align: center; white-space: nowrap;">م</th>
                <th style="width: 75px; text-align: center; white-space: nowrap;">كود الموظف</th>
                <th style="width: 1%; white-space: nowrap;">اسم الموظف</th>
                <th style="width: 140px; text-align: center; white-space: nowrap;">${isSelectedRunHourlyOrWeekly ? 'صافي الأجر المستحق' : 'صافي الراتب المستحق'}</th>
                <th style="text-align: center;">التوقيع / ملاحظات</th>
              </tr>
            </thead>
            <tbody>
              ${filteredRunItems.map((row, index) => `
                <tr>
                  <td style="text-align: center; color: #64748b; white-space: nowrap;">${index + 1}</td>
                  <td style="text-align: center; color: #64748b; white-space: nowrap;">${payrollPrintHtmlText(text(row.employeeNo))}</td>
                  <td style="font-weight: 600; white-space: nowrap;">${payrollPrintHtmlText(text(row.employeeName))}</td>
                  <td class="amount" style="text-align: center;">${payrollPrintHtmlText(money(row.netPay))}</td>
                  <td></td>
                </tr>
              `).join('')}
              <tr style="background-color: #f1f5f9; font-weight: bold; font-size: 12.5px;">
                <td colspan="3" style="text-align: left; padding: 8px 10px; border: 1px solid #cbd5e1; color: #0f172a; white-space: nowrap;">${isSelectedRunHourlyOrWeekly ? 'إجمالي الأجور المستحقة:' : 'إجمالي الرواتب المستحقة:'}</td>
                <td class="amount" style="padding: 8px 10px; border: 1px solid #cbd5e1; color: #0f172a; font-size: 13px; text-align: center;">${payrollPrintHtmlText(money(summary.totalNet))}</td>
                <td style="border: 1px solid #cbd5e1; background-color: #f8fafc;"></td>
              </tr>
            </tbody>
          </table>
          <div class="footer">
            <div class="signature-box">
              <div class="title">إعداد الموارد البشرية</div>
              <div class="line"></div>
            </div>
            <div class="signature-box">
              <div class="title">اعتماد الإدارة</div>
              <div class="line"></div>
            </div>
            <div class="signature-box">
              <div class="title">توقيع أمين الخزينة</div>
              <div class="line"></div>
            </div>
          </div>
          <div style="margin-top: 18px; border-top: 1px dashed #cbd5e1; padding-top: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 9.5px; color: #64748b; clear: both; page-break-inside: avoid;">
            <span>تم استخراج وتوثيق هذا الكشف آلياً بواسطة منظومة <strong>Z-Systems Cloud ERP</strong> لإدارة وتخطيط الموارد</span>
            <span dir="ltr" style="font-weight: 700; color: #170e5e;">Powered by Z-Systems ERP • www.z-systems.io</span>
          </div>
          <script>
            setTimeout(() => { window.print(); window.close(); }, 500);
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
  };
