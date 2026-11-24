import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';

export interface HrPayrollApprovalDialogProps {
  t: ReturnType<typeof useTranslation>['t'];
  pendingApprovalAction: { runId: string; type: 'review' | 'approve'; } | null;
  setPendingApprovalAction: Dispatch<SetStateAction<{ runId: string; type: 'review' | 'approve'; } | null>>;
  executeRunAction: (runId: string, type: 'review' | 'approve') => Promise<void>;
}

export function HrPayrollApprovalDialog({ t, pendingApprovalAction, setPendingApprovalAction, executeRunAction }: HrPayrollApprovalDialogProps) {
  return (
    <>
    {pendingApprovalAction && (
      <DialogShell open={true} onClose={() => setPendingApprovalAction(null)} width="600px">
        <div style={{ padding: '24px' }}>
          <h2 style={{ marginTop: 0, color: '#dc2626' }}>{t('hr.hr_payroll_page.s27', "تنبيه: استثناءات معلقة")}</h2>
          <p>{t('hr.hr_payroll_page.s28', "يوجد استثناءات حضور وانصراف معلقة للموظفين بحاجة للمراجعة. هل أنت متأكد من رغبتك بالاستمرار دون معالجتها؟")}</p>
          <div className="actions">
            <Button variant="secondary" onClick={() => setPendingApprovalAction(null)}>{t('hr.hr_payroll_page.s29', "إلغاء ومراجعة الاستثناءات")}</Button>
            <Button variant="danger" onClick={() => executeRunAction(pendingApprovalAction.runId, pendingApprovalAction.type)}>{t('hr.hr_payroll_page.s30', "نعم، تابع الاعتماد")}</Button>
          </div>
        </div>
      </DialogShell>
    )}
    </>
  );
}
