import { Button } from '@/shared/ui/button';
import { CopyIcon, CheckCircleIcon, XCircleIcon } from '@/shared/components/icons/AppIcons';
import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import type { HrEmployee } from '@/types/domain';
import type { UseQueryResult } from '@tanstack/react-query';
import type { NavigateFunction } from 'react-router-dom';

export interface EmployeeSelfServiceTableProps {
  __t: ReturnType<typeof useTranslation>['t'];
  employeesQuery: UseQueryResult<{ employees: HrEmployee[]; summary?: { totalItems?: number | undefined; activeCount?: number | undefined; } | undefined; }, Error>;
  filteredEmployees: HrEmployee[];
  copyUrl: (path: string, label: string) => void;
  setEditingEmployee: Dispatch<SetStateAction<HrEmployee | null>>;
  setPhoneInput: Dispatch<SetStateAction<string>>;
  setPinInput: Dispatch<SetStateAction<string>>;
  setShowEmployeePassword: Dispatch<SetStateAction<boolean>>;
  toggleEmployeeStatus: (emp: HrEmployee) => Promise<void>;
  navigate: NavigateFunction;
}

export function EmployeeSelfServiceTable({ __t, employeesQuery, filteredEmployees, copyUrl, setEditingEmployee, setPhoneInput, setPinInput, setShowEmployeePassword, toggleEmployeeStatus, navigate }: EmployeeSelfServiceTableProps) {
  return (
    <>
    {/* Employees Table */}
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        overflowX: 'auto',
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12.5px' }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
            <th style={{ padding: '10px 12px', fontWeight: 700 }}>{__t('settings.user_management.unified_access_directory_panel.s48', "الموظف")}</th>
            <th style={{ padding: '10px 10px', fontWeight: 700 }}>{__t('settings.user_management.unified_access_directory_panel.s49', "القسم والوظيفة")}</th>
            <th style={{ padding: '10px 10px', fontWeight: 700 }}>{__t('settings.user_management.unified_access_directory_panel.s50', "الموبايل")}</th>
            <th style={{ padding: '10px 10px', fontWeight: 700 }}>{__t('settings.user_management.unified_access_directory_panel.s51', "رمز الـ PIN")}</th>
            <th style={{ padding: '10px 8px', fontWeight: 700 }}>{__t('settings.user_management.unified_access_directory_panel.s52', "البوابات")}</th>
            <th style={{ padding: '10px 8px', fontWeight: 700 }}>{__t('settings.user_management.unified_access_directory_panel.s53', "الحالة")}</th>
            <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap' }}>{__t('settings.user_management.unified_access_directory_panel.s54', "الإجراءات")}</th>
          </tr>
        </thead>
        <tbody>
          {employeesQuery.isLoading ? (
            <tr>
              <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                {__t('settings.user_management.unified_access_directory_panel.s55', "جاري تحميل بيانات الموظفين...")}
              </td>
            </tr>
          ) : filteredEmployees.length === 0 ? (
            <tr>
              <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                {__t('settings.user_management.unified_access_directory_panel.s56', "لا يوجد موظفون مطابقون للفلاتر.")}
              </td>
            </tr>
          ) : (
            filteredEmployees.map((emp) => {
              const isActive = String(emp.status || '') === 'active';
              const phone = emp.mobile || emp.phone;
              const empName = emp.displayName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || __t('settings.user_management.unified_access_directory_panel.s57', "موظف");

              return (
                <tr key={emp.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '13px' }}>{empName}</div>
                    {emp.employeeNo && (
                      <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>
                        {__t('settings.user_management.unified_access_directory_panel.s58', "كود:")} {emp.employeeNo}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '10px 10px' }}>
                    <div style={{ color: '#334155', fontWeight: 600, fontSize: '12px' }}>{emp.departmentName || '—'}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>{emp.jobTitleName || emp.positionName || '—'}</div>
                  </td>
                  <td style={{ padding: '10px 10px', direction: 'ltr', textAlign: 'right', fontFamily: 'monospace', fontSize: '12px' }}>
                    {phone || <span style={{ color: '#dc2626', fontSize: '11px' }}>{__t('settings.user_management.unified_access_directory_panel.s59', "ناقص موبايل")}</span>}
                  </td>
                  <td style={{ padding: '10px 10px' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 7px',
                        background: emp.pinCode || emp.pin_code ? '#f0fdf4' : '#fef2f2',
                        border: `1px solid ${emp.pinCode || emp.pin_code ? '#bbf7d0' : '#fecaca'}`,
                        color: emp.pinCode || emp.pin_code ? '#15803d' : '#b91c1c',
                        borderRadius: '6px',
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        letterSpacing: '1px',
                        fontSize: '11.5px',
                      }}
                    >
                      {emp.pinCode || emp.pin_code ? `•••• (${emp.pinCode || emp.pin_code})` : __t('settings.user_management.unified_access_directory_panel.s60', "لم يعين PIN")}
                    </span>
                  </td>
                  <td style={{ padding: '10px 8px' }}>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      <span
                        onClick={() => copyUrl('/portal', __t('settings.user_management.unified_access_directory_panel.s61', "بوابة الموظف الذاتية"))}
                        title={__t('settings.user_management.unified_access_directory_panel.s62', "انقر لنسخ رابط بوابة الموظف (/portal)")}
                        style={{
                          fontSize: '10.5px',
                          background: '#eff6ff',
                          color: '#1d4ed8',
                          border: '1px solid #dbeafe',
                          borderRadius: '4px',
                          padding: '2px 5px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <CopyIcon size={10} /> {__t('settings.user_management.unified_access_directory_panel.s63', "بوابة")}
                      </span>
                      <span
                        onClick={() => copyUrl('/punch', __t('settings.user_management.unified_access_directory_panel.s64', "بصمة الموبايل الذكية"))}
                        title={__t('settings.user_management.unified_access_directory_panel.s65', "انقر لنسخ رابط بصمة الموبايل (/punch)")}
                        style={{
                          fontSize: '10.5px',
                          background: '#f0fdf4',
                          color: '#15803d',
                          border: '1px solid #dcfce7',
                          borderRadius: '4px',
                          padding: '2px 5px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <CopyIcon size={10} /> {__t('settings.user_management.unified_access_directory_panel.s66', "بصمة")}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '10px 8px' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        padding: '2px 7px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 700,
                        background: isActive ? '#ecfdf5' : '#fef2f2',
                        color: isActive ? '#065f46' : '#991b1b',
                        border: `1px solid ${isActive ? '#a7f3d0' : '#fecaca'}`,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {isActive ? <CheckCircleIcon size={11} /> : <XCircleIcon size={11} />}
                      {isActive ? __t('settings.user_management.unified_access_directory_panel.s67', "نشط") : __t('settings.user_management.unified_access_directory_panel.s68', "موقوف")}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                      <Button
                        variant="secondary"
                        style={{ fontSize: '11px', padding: '3px 8px', whiteSpace: 'nowrap' }}
                        onClick={() => {
                          setEditingEmployee(emp);
                          setPhoneInput(emp.phone || emp.mobile || '');
                          setPinInput('');
                          setShowEmployeePassword(false);
                        }}
                      >
                        {__t('settings.user_management.unified_access_directory_panel.s69', "تعديل كلمة المرور / PIN")}
                      </Button>
                      <Button
                        variant={isActive ? 'danger' : 'secondary'}
                        style={{ fontSize: '11px', padding: '3px 8px', whiteSpace: 'nowrap' }}
                        onClick={() => toggleEmployeeStatus(emp)}
                      >
                        {isActive ? __t('settings.user_management.unified_access_directory_panel.s70', "إيقاف") : __t('settings.user_management.unified_access_directory_panel.s71', "تفعيل")}
                      </Button>
                      <Button
                        variant="secondary"
                        style={{ fontSize: '11px', padding: '3px 8px', color: '#170e5e', fontWeight: 700, whiteSpace: 'nowrap' }}
                        onClick={() => navigate(`/hr/employees/${emp.id}`)}
                        title={__t('settings.user_management.unified_access_directory_panel.s72', "فتح ملف الموظف الكامل في الموارد البشرية")}
                      >
                        {__t('settings.user_management.unified_access_directory_panel.s73', "الملف ↗")}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
    </>
  );
}
