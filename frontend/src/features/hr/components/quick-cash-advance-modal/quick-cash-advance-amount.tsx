import { money, type WithdrawalBalanceResponse } from './quick-cash-advance-shared';
import { CheckShieldIcon, AlertCircleIcon } from '@/shared/components/icons/AppIcons';
import type { Dispatch, SetStateAction } from 'react';

export interface QuickCashAdvanceAmountProps {
  activeTab: 'advance' | 'payout';
  hasCredit: boolean;
  netAvailable: number;
  setAmount: Dispatch<SetStateAction<string>>;
  maxDirectAdvance: number;
  setActiveTab: Dispatch<SetStateAction<'advance' | 'payout'>>;
  balanceData: WithdrawalBalanceResponse | undefined;
  selectedEmployee: any;
  setNotes: Dispatch<SetStateAction<string>>;
  isPayoutDue: boolean;
  amount: string;
  requiresManagerAuth: boolean;
  parsedAmount: number;
  isDirectAllowed: boolean;
  isAdvanceOverDirectCap: boolean;
  isOverdraft: boolean;
}

export function QuickCashAdvanceAmount({ activeTab, hasCredit, netAvailable, setAmount, maxDirectAdvance, setActiveTab, balanceData, selectedEmployee, setNotes, isPayoutDue, amount, requiresManagerAuth, parsedAmount, isDirectAllowed, isAdvanceOverDirectCap, isOverdraft }: QuickCashAdvanceAmountProps) {
  return (
    <>
    {/* 4. Amount Input & Quick Fill */}
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155' }}>
          {activeTab === 'payout' ? 'صافي المبلغ المراد صرفه وتسويته *' : 'المبلغ المطلوب سحبه / صرفه *'}
        </span>
        {hasCredit && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {activeTab === 'advance' ? (
              <>
                {netAvailable >= 100 && (
                  <button
                    type="button"
                    onClick={() => setAmount(String(Math.floor(netAvailable * 0.25)))}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      color: '#334155',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: '3px 8px',
                      borderRadius: 4,
                    }}
                  >
                    سلفة 25% ({money(Math.floor(netAvailable * 0.25))})
                  </button>
                )}
                {maxDirectAdvance > 0 && (
                  <button
                    type="button"
                    onClick={() => setAmount(String(maxDirectAdvance))}
                    style={{
                      background: '#f0fdf4',
                      border: '1px solid #86efac',
                      color: '#15803d',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: '3px 8px',
                      borderRadius: 4,
                    }}
                  >
                    الحد المباشر 50% ({money(maxDirectAdvance)})
                  </button>
                )}
                {netAvailable > maxDirectAdvance && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('payout');
                      setAmount(String(netAvailable));
                      const empName = balanceData?.employee?.displayName || selectedEmployee?.displayName || 'الموظف';
                      setNotes(`صرف وتصفية مستحقات أجر الفترة (${empName})`);
                    }}
                    style={{
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      color: '#1d4ed8',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: '3px 8px',
                      borderRadius: 4,
                    }}
                    title="الانتقال لتبويب صرف الراتب وتصفية كامل المستحقات"
                  >
                    صرف وتصفية كامل الأجر ({money(netAvailable)}) ←
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={() => setAmount(String(netAvailable))}
                style={{
                  background: isPayoutDue ? '#f0fdf4' : '#fffbeb',
                  border: `1px solid ${isPayoutDue ? '#86efac' : '#fde68a'}`,
                  color: isPayoutDue ? '#15803d' : '#b45309',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: '3px 10px',
                  borderRadius: 4,
                }}
              >
                {isPayoutDue ? 'كامل صافي الأجر المستحق' : 'كامل الصافي [تسوية مبكرة]'} ({money(netAvailable)})
              </button>
            )}
          </div>
        )}
      </div>

      <input
        type="number"
        min="0.01"
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.00"
        required
        style={{
          width: '100%',
          boxSizing: 'border-box',
          fontSize: '0.98rem',
          fontWeight: 700,
          borderColor: requiresManagerAuth && parsedAmount > 0 ? '#f59e0b' : undefined,
        }}
      />

      {/* Real-time Status Helper with reserved fixed height */}
      <div style={{ minHeight: '22px', marginTop: 4, fontSize: '0.76rem', display: 'flex', alignItems: 'center' }}>
        {parsedAmount > 0 && balanceData ? (
          isDirectAllowed ? (
            <span style={{ color: '#15803d', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              <CheckShieldIcon size={14} color="#15803d" />
              {activeTab === 'payout'
                ? `الدورة مكتملة ومستحقة للصرف اليوم (${money(parsedAmount)} ج.م) — صـرف مبـاشر مسمـوح للكاشـير.`
                : `المبلغ ضمن سقف الكاشير المباشر (${money(maxDirectAdvance)} ج.م - 50% من المستحق) — صـرف مبـاشر مسمـوح للكاشـير.`}
            </span>
          ) : (
            <span style={{ color: '#b45309', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <AlertCircleIcon size={14} color="#d97706" />
              {activeTab === 'payout' ? (
                `الصرف قبل موعد الاستحقاق الدوري (القادم: ${balanceData.schedule?.nextPayoutDate} - متبقي ${balanceData.schedule?.daysUntilPayout} يوم) — يتطلب اعتماد المدير (تسوية مبكرة).`
              ) : isAdvanceOverDirectCap && !isOverdraft ? (
                <>
                  <span>السلفة لا تتجاوز 50% من المستحق ({money(maxDirectAdvance)} ج.م). لصرف كامل الرصيد:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('payout');
                      setAmount(String(netAvailable));
                      const empName = balanceData?.employee?.displayName || selectedEmployee?.displayName || 'الموظف';
                      setNotes(`صرف وتصفية مستحقات أجر الفترة (${empName})`);
                    }}
                    style={{
                      background: '#eff6ff',
                      border: '1px solid #93c5fd',
                      color: '#1d4ed8',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: '1px 6px',
                      borderRadius: 4,
                      textDecoration: 'underline',
                    }}
                  >
                    انتقل لتبويب صرف الراتب ←
                  </button>
                </>
              ) : isOverdraft ? (
                `المبلغ يتجاوز كامل رصيد الموظف المستحق بمقدار ${money(parsedAmount - netAvailable)} ج.م (سلفة على المكشوف) — يتطلب اعتماد المدير.`
              ) : (
                'الموظف لا يملك رصيداً مستحقاً حالياً — يتطلب اعتماد المدير.'
              )}
            </span>
          )
        ) : (
          <span style={{ color: '#94a3b8', fontSize: '0.74rem' }}>
            {activeTab === 'payout'
              ? (balanceData?.schedule?.dueStatusText || 'تصفية وصرف مستحقات الراتب نقداً من عهدة الكاشير.')
              : `سقف الصرف المباشر للكاشير: ${maxDirectAdvance > 0 ? `${money(maxDirectAdvance)} ج.م (50%)` : 'حتى 50% من المستحق (بحد أقصى 2,000 ج.م)'}.`}
          </span>
        )}
      </div>
    </div>
    </>
  );
}
