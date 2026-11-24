import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { canAccessPath } from '@/app/router/access';
import { useTranslation } from 'react-i18next';
import type { AuthUser } from '@/types/auth';
import type { NavigateFunction } from 'react-router-dom';

export interface HrPayrollPageHeaderProps {
  t: ReturnType<typeof useTranslation>['t'];
  user: AuthUser | null;
  navigate: NavigateFunction;
  isEg: boolean;
  hasCreatePayrollRun: boolean;
  canManagePayroll: boolean;
  openCreateModal: () => void;
}

export function HrPayrollPageHeader(props: HrPayrollPageHeaderProps) {
  const { t, user, navigate, isEg, hasCreatePayrollRun, canManagePayroll, openCreateModal } = props;
  return (
    <PageHeader
      title={t('hr.hr_payroll_page.s0', "المرتبات")}
      description={
        isEg
          ? 'مسار واضح لدورة القبض: جهّز كشف المرتبات، راجع الحضور والإجازات والسلف، ثم اعتمد عند اكتمال المراجعة.'
          : 'مسار واضح لدورة القبض: جهّز المسير، راجع الحضور والإجازات والسلف، ثم اعتمد عند اكتمال المراجعة.'
      }
      actions={
        <div className="actions compact-actions">
          {hasCreatePayrollRun && canManagePayroll ? <Button onClick={openCreateModal}>{isEg ? 'إنشاء كشف المرتبات' : 'تجهيز مسير الرواتب'}</Button> : null}
          {canAccessPath(user, '/hr/attendance') && <Button variant="secondary" onClick={() => navigate('/hr/attendance')}>{t('hr.hr_payroll_page.s3', "مراجعة الحضور")}</Button>}
          {canAccessPath(user, '/hr/loans') && <Button variant="secondary" onClick={() => navigate('/hr/loans')}>{t('hr.hr_payroll_page.s4', "مراجعة السلف")}</Button>}
          {canAccessPath(user, '/hr/employees') && <Button variant="secondary" onClick={() => navigate('/hr/employees')}>{t('hr.hr_payroll_page.s5', "رجوع للموظفين")}</Button>}
        </div>
      }
    />
  );
}
