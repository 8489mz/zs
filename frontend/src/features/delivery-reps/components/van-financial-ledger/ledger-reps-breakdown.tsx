import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import type { VanRepFinancialLedgerResponse } from '../../api/van-sales.api';

export interface LedgerRepsBreakdownProps {
  summary: VanRepFinancialLedgerResponse['summary'];
  selectedRepId: string;
  setLinkingRep: Dispatch<SetStateAction<{ repId: number; repName: string; employeeId: number | null } | null>>;
  setSelectedCandidateEmployeeId: Dispatch<SetStateAction<string>>;
  setSelectedRepId: Dispatch<SetStateAction<string>>;
  handleOpenAddBonus: (targetRepId?: string) => void;
}

export function LedgerRepsBreakdown({
  handleOpenAddBonus,
  selectedRepId,
  setLinkingRep,
  setSelectedCandidateEmployeeId,
  setSelectedRepId,
  summary,
}: LedgerRepsBreakdownProps) {
  const { t } = useTranslation();
  return (
    <>
      {!selectedRepId && summary.repsBreakdown.length > 0 && (
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            padding: '10px 14px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
            <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
            <h4 style={{ margin: 0, fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
              {t('delivery_reps.van_financial_ledger_admin_tab.s27', "موقف ذمم وعجوزات مناديب التوزيع (")}{summary.repsBreakdown.length} {t('delivery_reps.van_financial_ledger_admin_tab.s28', "مندوب)")}
            </h4>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: '8px',
            }}
          >
            {summary.repsBreakdown.map((r) => (
              <div
                key={r.repId}
                style={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '8px 12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: '12px', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.repName}
                  </div>
                  <div style={{ fontSize: '10px', color: '#64748b', display: 'flex', gap: '4px', alignItems: 'center', marginTop: '2px' }}>
                    <span>{r.itemsCount} {t('delivery_reps.van_financial_ledger_admin_tab.s29', "حركات")}</span>
                    {r.employeeName ? (
                      <span
                        style={{ color: '#166534', fontWeight: 600, cursor: 'pointer' }}
                        title={t('delivery_reps.van_financial_ledger_admin_tab.s30', "انقر لتعديل ربط موظف HR")}
                        onClick={() => {
                          setLinkingRep({ repId: r.repId, repName: r.repName, employeeId: r.employeeId || null });
                          setSelectedCandidateEmployeeId(r.employeeId ? String(r.employeeId) : '');
                        }}
                      >
                        {t('delivery_reps.van_financial_ledger_admin_tab.s31', "• موظف:")} {r.employeeName}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setLinkingRep({ repId: r.repId, repName: r.repName, employeeId: r.employeeId || null });
                          setSelectedCandidateEmployeeId(r.employeeId ? String(r.employeeId) : '');
                        }}
                        style={{
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          color: '#475569',
                          borderRadius: '4px',
                          padding: '1px 6px',
                          fontSize: '9.5px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                        title={t('delivery_reps.van_financial_ledger_admin_tab.s32', "انقر لربط المندوب بملف موظف HR")}
                      >
                        {t('delivery_reps.van_financial_ledger_admin_tab.s33', "+ ربط بـ HR")}
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ textAlign: 'left', flexShrink: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: 900, color: r.pendingShortages > 0 ? '#b91c1c' : '#166534', fontFamily: 'monospace' }}>
                    {r.pendingShortages > 0 ? `-${Number(r.pendingShortages).toFixed(2)}` : '0.00'} <CurrencySymbol />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px' }}>
                    <button
                      type="button"
                      onClick={() => setSelectedRepId(String(r.repId))}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#170e5e',
                        fontSize: '10px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      {t('delivery_reps.van_financial_ledger_admin_tab.s34', "كشف الحساب ←")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenAddBonus(String(r.repId))}
                      style={{
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        color: '#170e5e',
                        borderRadius: '4px',
                        fontSize: '9.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: '1px 6px',
                      }}
                      title={t('delivery_reps.van_financial_ledger_admin_tab.s35', "قيد مكافأة أو عمولة لهذا المندوب")}
                    >
                      {t('delivery_reps.van_financial_ledger_admin_tab.s36', "+ بونص")}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
