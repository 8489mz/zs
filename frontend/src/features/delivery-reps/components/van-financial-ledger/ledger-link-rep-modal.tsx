import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/shared/ui/button';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { CustomSelect } from '@/shared/ui/custom-select';
import type { useLedgerMutations } from './use-ledger-mutations';

export interface LedgerLinkRepModalProps {
  autoCreateEmployeeMutation: ReturnType<typeof useLedgerMutations>['autoCreateEmployeeMutation'];
  candidateEmployees: ReturnType<typeof useLedgerMutations>['candidateEmployees'];
  linkRepMutation: ReturnType<typeof useLedgerMutations>['linkRepMutation'];
  linkingRep: { repId: number; repName: string; employeeId: number | null } | null;
  selectedCandidateEmployeeId: string;
  setLinkingRep: Dispatch<SetStateAction<{ repId: number; repName: string; employeeId: number | null } | null>>;
  setSelectedCandidateEmployeeId: Dispatch<SetStateAction<string>>;
}

export function LedgerLinkRepModal({
  autoCreateEmployeeMutation,
  candidateEmployees,
  linkRepMutation,
  linkingRep,
  selectedCandidateEmployeeId,
  setLinkingRep,
  setSelectedCandidateEmployeeId,
}: LedgerLinkRepModalProps) {
  const { t } = useTranslation();
  return (
    linkingRep && (
      <StandardDialog
        isOpen={Boolean(linkingRep)}
        onClose={() => setLinkingRep(null)}
        title={t('delivery_reps.van_financial_ledger_admin_tab.s103', "ربط مندوب التوزيع بملف موظف في الموارد البشرية (HR)")}
        subtitle={`المندوب: ${linkingRep.repName} (معرف #${linkingRep.repId})`}
        width="480px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '8px 0' }}>
          <div
            style={{
              backgroundColor: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '8px',
              padding: '10px 12px',
              fontSize: '12px',
              color: '#1e40af',
              lineHeight: 1.5,
            }}
          >
            {t('delivery_reps.van_financial_ledger_admin_tab.s104', "ربط المندوب بموظف HR يسمح بترحيل أي عجوزات مالية مباشرة كاستقطاعات رسمية في مسير رواتب الموظف، وكذلك صرف العمولات والمكافآت مع الراتب الشهري.")}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#0f172a', marginBottom: '6px' }}>
              {t('delivery_reps.van_financial_ledger_admin_tab.s105', "اختر الموظف المطابق من شجرة الموارد البشرية:")}
            </label>
            <CustomSelect
              value={selectedCandidateEmployeeId}
              onChange={(val) => setSelectedCandidateEmployeeId(val)}
              options={[
                { value: '', label: t('delivery_reps.van_financial_ledger_admin_tab.s106', "-- غير مربوط بأي موظف (فصل الارتباط) --") },
                ...candidateEmployees.map((emp) => ({
                  value: String(emp.id),
                  label: `${emp.displayName} ${emp.employeeNo ? `(كود: ${emp.employeeNo})` : ''} ${emp.nationalId ? `(رقم قومي: ${emp.nationalId})` : ''}`,
                })),
              ]}
              placeholder={t('delivery_reps.van_financial_ledger_admin_tab.s107', "اختر موظف HR")}
            />
          </div>

          {candidateEmployees.length === 0 && (
            <div style={{ fontSize: '11.5px', color: '#b45309', backgroundColor: '#fef3c7', padding: '8px 10px', borderRadius: '6px', border: '1px solid #fde68a' }}>
              {t('delivery_reps.van_financial_ledger_admin_tab.s108', "لا يوجد موظفون متاحون حالياً في دليل الموارد البشرية. يمكنك إنشاء ملف موظف رسمي للمندوب فوراً بالزر أدناه:")}
            </div>
          )}

          <div style={{ paddingTop: '2px' }}>
            <Button
              variant="secondary"
              onClick={() => autoCreateEmployeeMutation.mutate(linkingRep.repId)}
              disabled={autoCreateEmployeeMutation.isPending}
              style={{
                width: '100%',
                height: '36px',
                backgroundColor: '#f8fafc',
                border: '1.5px dashed #6366f1',
                color: '#4338ca',
                fontSize: '12px',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <span>{autoCreateEmployeeMutation.isPending ? t('delivery_reps.van_financial_ledger_admin_tab.s109', "جاري إنشاء ملف الموظف والربط...") : `+ إنشاء ملف موظف جديد في HR للمندوب (${linkingRep.repName}) وربطه فوراً`}</span>
            </Button>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
            <Button
              variant="primary"
              onClick={() =>
                linkRepMutation.mutate({
                  repId: linkingRep.repId,
                  employeeId: selectedCandidateEmployeeId ? Number(selectedCandidateEmployeeId) : null,
                })
              }
              disabled={linkRepMutation.isPending || autoCreateEmployeeMutation.isPending}
              style={{
                flex: 1,
                height: '36px',
                backgroundColor: '#170e5e',
                fontSize: '12.5px',
                fontWeight: 800,
              }}
            >
              {linkRepMutation.isPending ? t('delivery_reps.van_financial_ledger_admin_tab.s110', "جاري الحفظ...") : t('delivery_reps.van_financial_ledger_admin_tab.s111', "حفظ وتحديث الربط")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setLinkingRep(null)}
              style={{ height: '36px' }}
            >
              {t('delivery_reps.van_financial_ledger_admin_tab.s112', "إلغاء")}
            </Button>
          </div>
        </div>
      </StandardDialog>
    )
  );
}
