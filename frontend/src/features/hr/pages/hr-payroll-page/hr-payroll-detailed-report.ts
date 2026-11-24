import { money, normalize, statusLabel, text } from '@/features/hr/pages/payroll/hr-payroll.helpers';
import type { HrPayrollRun, HrPayrollRunItem } from '@/types/domain';

export interface PrintDetailedPayrollReportProps {
  filteredRunItems: HrPayrollRunItem[];
  isSelectedRunHourlyOrWeekly: boolean;
  isEg: boolean;
  selectedRun: HrPayrollRun | undefined;
}

export function printDetailedPayrollReport({ filteredRunItems, isSelectedRunHourlyOrWeekly, isEg, selectedRun }: PrintDetailedPayrollReportProps): void {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const totalBase = filteredRunItems.reduce((acc, row) => acc + Number(row.baseSalary || 0), 0);
    const totalAllowances = filteredRunItems.reduce((acc, row) => acc + Number(row.allowanceAmount || 0), 0);
    const totalGross = filteredRunItems.reduce((acc, row) => acc + Number(row.grossPay || (Number(row.baseSalary || 0) + Number(row.allowanceAmount || 0))), 0);
    const totalAttendanceDeductions = filteredRunItems.reduce((acc, row) => acc + Number(row.deductionAmount || 0), 0);
    const totalLoans = filteredRunItems.reduce((acc, row) => acc + Number(row.loanDeductionAmount || 0), 0);
    const totalAllDeductions = filteredRunItems.reduce((acc, row) => acc + (Number(row.deductionAmount || 0) + Number(row.loanDeductionAmount || 0) + Number((row as any).employeeSocialInsurance || 0) + Number((row as any).incomeTax || 0)), 0);
    const totalNet = filteredRunItems.reduce((acc, row) => acc + Number(row.netPay || 0), 0);

    printWindow.document.write(`
      <html dir="rtl" lang="ar">
        <head>
          <title>${isSelectedRunHourlyOrWeekly ? 'كشف أجور العاملين المالي والتفصيلي' : (isEg ? 'كشف المرتبات المالي والتفصيلي' : 'مسير الرواتب المالي والتفصيلي')} - ${text(selectedRun?.periodMonth)}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');
            @page { size: landscape; margin: 8mm 10mm; }
            body { font-family: 'Tajawal', Tahoma, Arial, sans-serif; padding: 0; margin: 0; color: #1e293b; line-height: 1.25; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .header { border-bottom: 2px solid #170e5e; padding-bottom: 6px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: flex-end; }
            .header-center { text-align: center; }
            .header-center h1 { margin: 0; color: #170e5e; font-size: 18px; font-weight: 800; }
            .header-center p { margin: 2px 0 0; color: #64748b; font-size: 11.5px; font-weight: 500; }
            .header-meta { font-size: 10.5px; color: #475569; }
            .table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 10.5px; }
            .table thead { display: table-header-group; }
            .table tr { page-break-inside: avoid; }
            .table th, .table td { padding: 4px 6px; text-align: right; border: 1px solid #cbd5e1; }
            .table th { background-color: #f1f5f9; font-weight: 700; color: #1e293b; text-align: center; }
            .table th.th-earnings { background-color: #f0fdf4; color: #166534; border-bottom: 2px solid #86efac; }
            .table th.th-deductions { background-color: #fef2f2; color: #991b1b; border-bottom: 2px solid #fca5a5; }
            .table th.th-net { background-color: #eef2ff; color: #312e81; border-bottom: 2px solid #a5b4fc; }
            .table tbody tr:nth-child(even) { background-color: #fafbfc; }
            .amount { font-family: monospace; font-size: 10.5px; font-weight: 600; white-space: nowrap; text-align: center; }
            .amount.pos { color: #166534; }
            .amount.neg { color: #dc2626; }
            .amount.net { font-weight: 800; color: #0f172a; background-color: #f8fafc; }
            .footer { margin-top: 10px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; padding-top: 8px; clear: both; page-break-inside: avoid; }
            .sig-box { text-align: center; }
            .sig-box .title { font-weight: 700; color: #475569; margin-bottom: 22px; font-size: 10.5px; }
            .sig-box .line { border-bottom: 1px solid #94a3b8; width: 75%; margin: 0 auto; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="header-meta">
              <strong>Z-Systems ERP</strong><br>
              قطاع الموارد البشرية والمالية
            </div>
            <div class="header-center">
              <h1>${isSelectedRunHourlyOrWeekly ? 'كشف أجور العاملين المالي والتفصيلي' : (isEg ? 'كشف المرتبات المالي والتفصيلي' : 'مسير الرواتب المالي والتفصيلي')}</h1>
              <p>${isSelectedRunHourlyOrWeekly ? 'كشف استحقاقات واستقطاعات أجور فترة:' : 'كشف استحقاقات واستقطاعات شهر:'} ${text(selectedRun?.periodMonth)} | الحالة: ${statusLabel(selectedRun?.status)}</p>
            </div>
            <div class="header-meta" style="text-align: left;">
              تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG')}<br>
              إجمالي القوى العاملة: ${filteredRunItems.length} موظف
            </div>
          </div>

          <table class="table">
            <thead>
              <tr>
                <th rowspan="2" style="width: 25px;">م</th>
                <th rowspan="2" style="width: 60px;">كود</th>
                <th rowspan="2" style="width: 1%; white-space: nowrap; text-align: right;">اسم الموظف</th>
                <th colspan="3" class="th-earnings">الاستحقاقات المالية (Earnings)</th>
                <th colspan="3" class="th-deductions">الاستقطاعات والجزاءات (Deductions)</th>
                <th rowspan="2" class="th-net" style="width: 110px;">${isSelectedRunHourlyOrWeekly ? 'صافي الأجر المستحق' : 'صافي الراتب المستحق'}</th>
                <th rowspan="2" style="width: 120px;">ملاحظات التدقيق</th>
              </tr>
              <tr>
                <th class="th-earnings" style="width: 90px;">${isSelectedRunHourlyOrWeekly ? 'أجر الساعات' : 'الأساسي'}</th>
                <th class="th-earnings" style="width: 80px;">البدلات/الإضافي</th>
                <th class="th-earnings" style="width: 95px;">إجمالي المستحق</th>
                <th class="th-deductions" style="width: 85px;">تأخير/غياب</th>
                <th class="th-deductions" style="width: 80px;">أقساط سلف</th>
                <th class="th-deductions" style="width: 90px;">إجمالي الخصم</th>
              </tr>
            </thead>
            <tbody>
              ${filteredRunItems.map((row, index) => {
                const bSalary = Number(row.baseSalary || 0);
                const alw = Number(row.allowanceAmount || 0);
                const gross = Number(row.grossPay || (bSalary + alw));
                const attDed = Number(row.deductionAmount || 0);
                const lDed = Number(row.loanDeductionAmount || 0);
                const insDed = Number((row as any).employeeSocialInsurance || 0);
                const taxDed = Number((row as any).incomeTax || 0);
                const totDed = attDed + lDed + insDed + taxDed;
                const net = Number(row.netPay || (gross - totDed));
                const isHourly = normalize(row.compensationType) === 'hourly' || (Number(row.hourlyRate || 0) > 0 && normalize(row.compensationType) !== 'monthly');
                const rate = Number(row.hourlyRate || 0);
                const hours = rate > 0 ? Number((bSalary / rate).toFixed(2)) : 0;
                return `
                  <tr>
                    <td style="text-align: center; color: #64748b;">${index + 1}</td>
                    <td style="text-align: center; color: #64748b; white-space: nowrap;">${text(row.employeeNo)}</td>
                    <td style="font-weight: 600; white-space: nowrap;">${text(row.employeeName)}</td>
                    <td class="amount" style="text-align: center;">
                      <div>${money(bSalary)}</div>
                      ${isHourly && rate > 0 ? `<div style="font-size: 8.5px; color: #166534; font-weight: 700;">${hours > 0 ? `${hours}س × ${money(rate)}/س` : `${money(rate)}/ساعة`}</div>` : ''}
                    </td>
                    <td class="amount pos">${alw > 0 ? money(alw) : '—'}</td>
                    <td class="amount pos" style="font-weight: 700;">${money(gross)}</td>
                    <td class="amount neg">${attDed > 0 ? money(attDed) : '—'}</td>
                    <td class="amount neg">${lDed > 0 ? money(lDed) : '—'}</td>
                    <td class="amount neg" style="font-weight: 700;">${totDed > 0 ? money(totDed) : '—'}</td>
                    <td class="amount net">${money(net)}</td>
                    <td style="font-size: 10.5px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">
                      ${text(row.notes || (Number(row.attendanceAbsentDays || 0) > 0 ? `غياب ${row.attendanceAbsentDays}ي` : ''))}
                    </td>
                  </tr>
                `;
              }).join('')}
              <tr style="background-color: #f1f5f9; font-weight: bold; font-size: 12px; border-top: 2px solid #94a3b8;">
                <td colspan="3" style="text-align: left; padding: 8px 10px; color: #0f172a;">${isSelectedRunHourlyOrWeekly ? 'الإجماليات العامة لكشف الأجور:' : (isEg ? 'الإجماليات العامة لكشف المرتبات:' : 'الإجماليات العامة للمسير:')}</td>
                <td class="amount">${money(totalBase)}</td>
                <td class="amount pos">${money(totalAllowances)}</td>
                <td class="amount pos" style="font-size: 12.5px;">${money(totalGross)}</td>
                <td class="amount neg">${money(totalAttendanceDeductions)}</td>
                <td class="amount neg">${money(totalLoans)}</td>
                <td class="amount neg" style="font-size: 12.5px;">${money(totalAllDeductions)}</td>
                <td class="amount net" style="font-size: 13px; color: #170e5e; background-color: #e0e7ff;">${money(totalNet)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>

          <div class="footer">
            <div class="sig-box">
              <div class="title">إعداد ومراجعة الموارد البشرية</div>
              <div class="line"></div>
            </div>
            <div class="sig-box">
              <div class="title">تدقيق الحسابات والمراجعة الداخلية</div>
              <div class="line"></div>
            </div>
            <div class="sig-box">
              <div class="title">اعتماد المدير المالي (CFO)</div>
              <div class="line"></div>
            </div>
            <div class="sig-box">
              <div class="title">اعتماد الإدارة العامة والتشغيل</div>
              <div class="line"></div>
            </div>
          </div>
          <div style="margin-top: 14px; border-top: 1px dashed #cbd5e1; padding-top: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 9.5px; color: #64748b; clear: both; page-break-inside: avoid;">
            <span>تم استخراج وتوثيق هذا الكشف المالي آلياً بواسطة منظومة <strong>Z-Systems Cloud ERP</strong> لإدارة وتخطيط الموارد المؤسسية</span>
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
}
