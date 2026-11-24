import { normalize } from '@/features/hr/pages/payroll/hr-payroll.helpers';
import type { HrPayrollRun } from '@/types/domain';
import type { PayrollDraft } from '../../components/payroll/CreatePayrollRunModal';
import type { PayrollRunTab } from '../../components/payroll/PayrollRunsTable';

export const initialDraft: PayrollDraft = {
  periodMonth: '',
  payFrequency: 'monthly',
  startDate: '',
  endDate: '',
  notes: '',
};

export function filterRunsByTabAndStatus(runs: HrPayrollRun[], tab: PayrollRunTab, statusFilter: string): HrPayrollRun[] {
  return runs.filter((r) => {
    const isCancelled = normalize(r.status) === 'cancelled' || normalize(r.status) === 'canceled';
    const freq = (r.payFrequency || 'monthly').toLowerCase();

    if (tab === 'cancelled') {
      if (!isCancelled) return false;
    } else if (tab === 'all_active') {
      if (isCancelled) return false;
    } else if (tab === 'monthly') {
      if (isCancelled || freq !== 'monthly') return false;
    } else if (tab === 'biweekly') {
      if (isCancelled || freq !== 'biweekly') return false;
    } else if (tab === 'weekly') {
      if (isCancelled || freq !== 'weekly') return false;
    } else if (tab === 'daily') {
      if (isCancelled || freq !== 'daily') return false;
    }

    if (tab !== 'cancelled' && statusFilter !== 'all' && normalize(r.status) !== statusFilter) {
      return false;
    }

    return true;
  });
}
