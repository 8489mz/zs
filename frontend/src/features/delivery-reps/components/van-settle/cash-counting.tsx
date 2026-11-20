import React from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { AlertTriangleIcon, CheckIcon, LockIcon } from '@/shared/components/icons/AppIcons';
import type { TFunction } from 'i18next';

export interface CashCountingProps {
  countedCash: string;
  onCountedCashChange: (val: string) => void;
  perDayDue?: { businessDay: string; due: number }[];
  perDayCash?: Record<string, string>;
  onPerDayCashChange?: (day: string, val: string) => void;
  onFillPerDayWithDue?: () => void;
  perDayMode: boolean;
  cashCollected: number;
  countedNum: number;
  isBlindSettlement: boolean;
  t: TFunction;
}

export const CashCounting: React.FC<CashCountingProps> = ({
  countedCash,
  onCountedCashChange,
  perDayDue,
  perDayCash,
  onPerDayCashChange,
  onFillPerDayWithDue,
  perDayMode,
  cashCollected,
  countedNum,
  isBlindSettlement,
  t,
}) => {
  return (
    <>
        {/* Cash Counting Input - Strict Single Line Header */}
        <div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'nowrap',
              gap: '6px',
              marginBottom: '5px',
            }}
          >
            <label
              htmlFor="counted_physical_cash_input"
              style={{
                fontSize: 'clamp(11px, 3.2vw, 12.5px)',
                fontWeight: 700,
                color: '#1e293b',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                flexShrink: 1,
                minWidth: 0,
              }}
            >
              <span>{t('delivery_reps.van_settle_tab.s27', "الكاش الفعلي للتوريد")}</span>
              <span style={{ color: '#64748b', fontWeight: 600, fontSize: '0.9em' }}>
                ({getGlobalCurrencySymbol()}):
              </span>
            </label>
            {!isBlindSettlement ? (
              <button
                type="button"
                onClick={() => {
                  // INV-VAN-DAILY-SPLIT-SETTLEMENT: in per-day mode the
                  // match button fills every day with its due.
                  if (perDayMode && onFillPerDayWithDue) onFillPerDayWithDue();
                  else onCountedCashChange(String(cashCollected));
                }}
                style={{
                  backgroundColor: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '3px 8px',
                  fontSize: 'clamp(10px, 2.8vw, 11px)',
                  fontWeight: 700,
                  color: '#170e5e',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  boxSizing: 'border-box',
                }}
              >
                {t('delivery_reps.van_settle_tab.s28', "مطابقة (")}{cashCollected.toFixed(2)})
              </button>
            ) : (
              <span
                style={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  padding: '2px 7px',
                  fontSize: 'clamp(9.5px, 2.7vw, 10.5px)',
                  fontWeight: 700,
                  color: '#64748b',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  boxSizing: 'border-box',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <LockIcon size={11} color="#64748b" />
                <span>{t('delivery_reps.van_settle_tab.s29', "جرد إلزامي")}</span>
              </span>
            )}
          </div>
          {/* INV-VAN-DAILY-SPLIT-SETTLEMENT: per-day counted cash */}
          {perDayMode && perDayDue && (
            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {perDayDue.map((day) => (
                <div key={day.businessDay} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#334155', minWidth: '92px', whiteSpace: 'nowrap' }}>
                    {t('delivery_reps.van_settle_tab.s37', "يوم")} {day.businessDay}
                  </span>
                  <span style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap' }}>
                    {t('delivery_reps.van_settle_tab.s38', "مستحق")} {Number(day.due || 0).toFixed(2)} <CurrencySymbol />
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    autoComplete="off"
                    value={perDayCash?.[day.businessDay] ?? ''}
                    onChange={(e) => onPerDayCashChange?.(day.businessDay, e.target.value)}
                    placeholder={t('delivery_reps.van_settle_tab.s39', "المعدود...")}
                    style={{ flex: 1, minWidth: 0, height: '34px', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0 10px', fontSize: '13px', fontWeight: 800, color: '#0f172a', boxSizing: 'border-box', outline: 'none' }}
                  />
                </div>
              ))}
            </div>
          )}
          <input
            id="counted_physical_cash_input"
            name="counted_physical_cash_amount"
            type="number"
            step="0.01"
            inputMode="decimal"
            autoComplete="off"
            data-lpignore="true"
            data-form-type="other"
            value={countedCash}
            onChange={(e) => onCountedCashChange(e.target.value)}
            readOnly={perDayMode}
            placeholder={
              isBlindSettlement
                ? t('delivery_reps.van_settle_tab.s30', "قم بعدّ الأوراق النقدية وأدخل المبلغ الفعلي للتوريد...")
                : t('delivery_reps.van_settle_tab.s31', "أدخل المبلغ بعد العد الفعلي للأوراق النقدية...")
            }
            style={{
              width: '100%',
              height: '38px',
              backgroundColor: '#ffffff',
              border: '1.5px solid #cbd5e1',
              borderRadius: '8px',
              padding: '0 10px',
              fontSize: '14px',
              fontWeight: 800,
              color: '#0f172a',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />

          {/* Reconciliation Match Indicator */}
          {countedCash !== '' && !isNaN(countedNum) && (
            <div
              style={{
                marginTop: '6px',
                padding: '6px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                backgroundColor:
                  countedNum === cashCollected
                    ? '#dcfce7'
                    : countedNum < cashCollected
                    ? '#fee2e2'
                    : '#e0f2fe',
                color:
                  countedNum === cashCollected
                    ? '#15803d'
                    : countedNum < cashCollected
                    ? '#b91c1c'
                    : '#0369a1',
                border: `1px solid ${
                  countedNum === cashCollected
                    ? '#86efac'
                    : countedNum < cashCollected
                    ? '#fca5a5'
                    : '#7dd3fc'
                }`,
              }}
            >
              {countedNum === cashCollected ? (
                <>
                  <CheckIcon size={14} color="#15803d" strokeWidth={2.5} />
                  <span>{t('delivery_reps.van_settle_tab.s32', "الكاش مطابق تماماً للعهدة النقدية بنسبة 100% (لا يوجد عجز).")}</span>
                </>
              ) : countedNum < cashCollected ? (
                <>
                  <AlertTriangleIcon size={14} color="#b91c1c" strokeWidth={2} />
                  <span>
                    {t('delivery_reps.van_settle_tab.s33', "يوجد عجز نقدي بقيمة")} {(cashCollected - countedNum).toFixed(2)} <CurrencySymbol /> {t('delivery_reps.van_settle_tab.s34', "(سيتم تقييده على عهدة المندوب).")}
                  </span>
                </>
              ) : (
                <>
                  <CheckIcon size={14} color="#0369a1" strokeWidth={2} />
                  <span>
                    {t('delivery_reps.van_settle_tab.s35', "يوجد فائض نقدي بقيمة")} {(countedNum - cashCollected).toFixed(2)} <CurrencySymbol /> {t('delivery_reps.van_settle_tab.s36', "(سيتم توريده لحساب المنشأة).")}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
    </>
  );
};
