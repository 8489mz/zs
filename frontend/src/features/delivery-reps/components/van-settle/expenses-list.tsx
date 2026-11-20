import React from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { ReceiptIcon, ClockIcon } from '@/shared/components/icons/AppIcons';
import type { TFunction } from 'react-i18next';
import type { VanSettleTabProps } from './van-settle-types';

export interface ExpensesListProps {
  safeExpenses: NonNullable<VanSettleTabProps['expenses']>;
  formatTime: (iso?: string) => string;
  t: TFunction;
}

export const ExpensesList: React.FC<ExpensesListProps> = ({ safeExpenses = [], formatTime, t }) => {
  return (
    <>
    {/* 4. TRIP OPERATIONAL EXPENSES */}
      {safeExpenses.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8' }}>
          <ReceiptIcon size={28} color="#cbd5e1" style={{ margin: '0 auto 6px', display: 'block' }} />
          <span style={{ fontSize: '12px', fontWeight: 600 }}>{t('delivery_reps.van_settle_tab.s84', "لا توجد مصروفات مسجلة لهذه الرحلة")}</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {safeExpenses.map((exp: any) => (
            <div
              key={exp.id}
              style={{
                backgroundColor: '#f8fafc',
                borderRadius: '10px',
                padding: '10px 12px',
                border: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
                    {exp.expenseType === 'fuel' ? t('delivery_reps.van_settle_tab.s85', "وقود وبنزين") :
                     exp.expenseType === 'toll' ? t('delivery_reps.van_settle_tab.s86', "كارتات وبوابات") :
                     exp.expenseType === 'maintenance' ? t('delivery_reps.van_settle_tab.s87', "صيانة طارئة") :
                     exp.expenseType === 'food_allowance' ? t('delivery_reps.van_settle_tab.s88', "بدل وجبة") : t('delivery_reps.van_settle_tab.s89', "مصروف نثري")}
                  </span>
                  <span style={{ color: '#94a3b8', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <ClockIcon size={12} color="#94a3b8" />
                    {formatTime(exp.createdAt)}
                  </span>
                </div>
                {(exp.notes || exp.description) && (
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '2px' }}>
                    {exp.notes || exp.description}
                  </span>
                )}
              </div>
              <span style={{ fontSize: '14px', fontWeight: 900, color: '#b91c1c' }}>
                -{Number(exp.amount).toFixed(2)} <CurrencySymbol />
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
};
