import { Button } from '@/shared/ui/button';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { DataTable } from '@/shared/ui/data-table';
import { PrinterIcon, FileTextIcon } from '@/shared/components/icons/AppIcons';
import { money, normalize, statusLabel, text } from '@/features/hr/pages/payroll/hr-payroll.helpers';
import { useTranslation } from 'react-i18next';
import type { HrPayrollRun, HrPayrollRunItem } from '@/types/domain';
import type { Dispatch, SetStateAction } from 'react';
import type { useHrPayrollRun } from '@/features/hr/hooks/useHr';

export interface HrPayrollRunDetailsProps {
  t: ReturnType<typeof useTranslation>['t'];
  selectedRun: HrPayrollRun | undefined;
  isEg: boolean;
  canViewSalaryAmounts: boolean;
  payrollRunDetails: ReturnType<typeof useHrPayrollRun>;
  filteredRunItems: HrPayrollRunItem[];
  setShowWpsModal: Dispatch<SetStateAction<boolean>>;
  printPayrollSignatureSheet: () => void;
  printDetailedPayrollReport: () => void;
  selectedRunId: string;
  baseCompensationHeader: string;
  canApprovePayroll: boolean;
  setSelectedReviewItem: Dispatch<SetStateAction<HrPayrollRunItem | null>>;
  handleOpenPayItemModal: (item: HrPayrollRunItem) => void;
}

export function HrPayrollRunDetails({ t, selectedRun, isEg, canViewSalaryAmounts, payrollRunDetails, filteredRunItems, setShowWpsModal, printPayrollSignatureSheet, printDetailedPayrollReport, selectedRunId, baseCompensationHeader, canApprovePayroll, setSelectedReviewItem, handleOpenPayItemModal }: HrPayrollRunDetailsProps) {
  return (
    <>
    {/* Selected Run Details Table */}
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>
          {isEg ? 'تفاصيل ومراجعة موظفي كشف المرتبات' : 'تفاصيل ومراجعة موظفي مسير الرواتب'} {selectedRun ? `(${text(selectedRun.periodMonth)})` : ''}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {selectedRun && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowWpsModal(true)}
              style={{ padding: '2px 10px', fontSize: '0.8rem', background: '#f0fdf4', color: '#166534', borderColor: '#bbf7d0', fontWeight: 600 }}
            >
              {t('hr.hr_payroll_page.s8', "تصدير ملف حماية الأجور (WPS / SIF)")}
            </Button>
          )}
          {selectedRun && (
            <Button
              variant="secondary"
              onClick={() => printPayrollSignatureSheet()}
              style={{ padding: '2px 10px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <PrinterIcon size={14} />
              <span>{t('hr.hr_payroll_page.s9', "كشف التوقيعات (مختصر)")}</span>
            </Button>
          )}
          {selectedRun && (
            <Button
              variant="secondary"
              onClick={() => printDetailedPayrollReport()}
              style={{ padding: '2px 10px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#f8fafc', borderColor: '#cbd5e1' }}
            >
              <FileTextIcon size={14} />
              <span>{isEg ? 'الكشف المالي التفصيلي (A4 أفقي)' : 'المسير المالي التفصيلي (A4 أفقي)'}</span>
            </Button>
          )}
        </div>
      </div>

      {!selectedRunId ? (
        <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
          {t('hr.hr_payroll_page.s10', "اضغط على أي كشف من الجدول أعلاه لعرض وتفصيل رواتب الموظفين الخاصة به.")}
        </div>
      ) : (
        <QueryFeedback
          isLoading={payrollRunDetails.isLoading}
          isError={payrollRunDetails.isError}
          error={payrollRunDetails.error}
          isEmpty={false}
          loadingText={isEg ? 'جارٍ تحميل تفاصيل الكشف...' : 'جارٍ تحميل تفاصيل المسير...'}
          errorTitle={isEg ? 'تعذر تحميل تفاصيل الكشف' : 'تعذر تحميل تفاصيل المسير'}
        >
          {!selectedRun ? (
            <p className="muted">{isEg ? 'تفاصيل الكشف غير متاحة.' : 'تفاصيل المسير غير متاحة.'}</p>
          ) : filteredRunItems.length ? (
            <DataTable
              rows={filteredRunItems}
              rowKey={(row) => String(row.id)}
              density="compact"
              columns={[
                { key: 'employeeNo', header: t('hr.hr_payroll_page.s14', "كود الموظف"), cell: (row) => <span style={{ whiteSpace: 'nowrap' }}>{text(row.employeeNo)}</span> },
                { key: 'employeeName', header: t('hr.hr_payroll_page.s15', "اسم الموظف"), cell: (row) => <span style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{text(row.employeeName)}</span> },
                {
                  key: 'baseSalary',
                  header: baseCompensationHeader,
                  cell: (row) => {
                    if (!canViewSalaryAmounts) return '—';
                    const isHourly = normalize(row.compensationType) === 'hourly' || (Number(row.hourlyRate || 0) > 0 && normalize(row.compensationType) !== 'monthly');
                    const rate = Number(row.hourlyRate || 0);
                    const base = Number(row.baseSalary || 0);
                    const hours = rate > 0 ? Number((base / rate).toFixed(2)) : 0;
                    return (
                      <div>
                        <div style={{ fontWeight: 600 }}>{money(base)}</div>
                        {isHourly && rate > 0 && (
                          <div style={{ fontSize: '0.725rem', color: '#166534', fontWeight: 600 }}>
                            {hours > 0 ? `${hours} س × ${money(rate)}/س` : `${money(rate)}/ساعة`}
                          </div>
                        )}
                      </div>
                    );
                  },
                },
                { key: 'allowanceAmount', header: t('hr.hr_payroll_page.s17', "البدلات والإضافي"), cell: (row) => canViewSalaryAmounts ? money(row.allowanceAmount) : '—' },
                { key: 'deductionAmount', header: t('hr.hr_payroll_page.s18', "الخصومات"), cell: (row) => canViewSalaryAmounts ? money(row.deductionAmount) : '—' },
                { key: 'loanDeductionAmount', header: t('hr.hr_payroll_page.s19', "السلف/الأقساط"), cell: (row) => canViewSalaryAmounts ? money(row.loanDeductionAmount) : '—' },
                {
                  key: 'netPay',
                  header: t('hr.hr_payroll_page.s20', "صافي الراتب"),
                  cell: (row) => canViewSalaryAmounts ? (
                    <span style={{ fontWeight: 700, color: '#15803d' }}>{money(row.netPay)}</span>
                  ) : '—',
                },
                {
                  key: 'status',
                  header: t('hr.hr_payroll_page.s21', "الحالة"),
                  cell: (row) => {
                    const st = normalize(row.status);
                    if (st === 'paid') {
                      return (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            padding: '1px 6px',
                            borderRadius: '10px',
                            fontSize: '0.69rem',
                            fontWeight: 700,
                            background: '#f0fdf4',
                            color: '#166534',
                            border: '1px solid #86efac',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                          تم الصرف
                        </span>
                      );
                    }
                    if (st === 'approved') {
                      return (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            padding: '1px 6px',
                            borderRadius: '10px',
                            fontSize: '0.69rem',
                            fontWeight: 700,
                            background: '#ecfdf5',
                            color: '#065f46',
                            border: '1px solid #a7f3d0',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                          معتمد
                        </span>
                      );
                    }
                    return statusLabel(row.status);
                  },
                },
                {
                  key: 'actions',
                  header: t('hr.hr_payroll_page.s22', "الإجراءات"),
                  cell: (row) => {
                    const isApproved = normalize(row.status) === 'approved';
                    const isRunPayable = selectedRun && ['approved', 'partially_paid'].includes(normalize(selectedRun.status));
                    const canPayThisItem = canApprovePayroll && isApproved && isRunPayable;

                    return (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Button
                          variant="secondary"
                          onClick={() => setSelectedReviewItem(row)}
                          style={{ padding: '2px 8px', fontSize: '0.73rem' }}
                        >
                          {t('hr.hr_payroll_page.s23', "تفاصيل")}
                        </Button>
                        {canPayThisItem && (
                          <Button
                            variant="primary"
                            onClick={() => handleOpenPayItemModal(row)}
                            style={{
                              padding: '2px 8px',
                              fontSize: '0.73rem',
                              fontWeight: 700,
                              background: '#170e5e',
                              color: '#ffffff',
                            }}
                            title="صرف مستحقات هذا الموظف فردياً"
                          >
                            صرف
                          </Button>
                        )}
                      </div>
                    );
                  },
                },
              ]}
            />
          ) : (
            <p className="muted" style={{ padding: '16px', textAlign: 'center' }}>{t('hr.hr_payroll_page.s24', "لا توجد نتائج مطابقة للبحث أو الفلاتر الحالية.")}</p>
          )}
        </QueryFeedback>
      )}
    </div>
    </>
  );
}
