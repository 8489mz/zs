import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { useMemo } from 'react';
import { useFormState, useWatch, type Control, type UseFormReturn } from 'react-hook-form';
import { Button } from '@/shared/ui/button';
import { formatCurrency } from '@/lib/format';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue, type MoneyDigits } from '@/shared/utils/money';
import type { CloseShiftValues } from '@/features/cash-drawer/hooks/useCashDrawerPageController';
import { LockIcon, ChevronIcon, CheckCircleIcon, AlertCircleIcon } from './cash-drawer-form-icons';

// Payment-channel accordion row — main row bar, declared-total error and
// expanded details (KPI strip, match/diff, per-operation amount cards).
// Pure move from CashDrawerFormsPanel; the panel keeps all state.

export type DetailChannel = 'cardDetails' | 'walletDetails' | 'instapayDetails';

export const EMPTY_DETAIL_ROWS: Array<{ amount?: number }> = [];

export function summarizeDetails(rows: Array<{ amount?: number }>, digits: MoneyDigits): number {
  if (!Array.isArray(rows)) return 0;
  return roundMoneyValue(
    rows
      .reduce((sum, row) => {
        const val = Number(row?.amount);
        return sum + (Number.isFinite(val) ? val : 0);
      }, 0),
    digits,
  );
}

export interface PaymentChannelRowProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  themeColor: string;
  bgLight: string;
  borderColor: string;
  count: number;
  control: Control<CloseShiftValues>;
  declaredFieldName: 'cardDeclaredTotal' | 'walletDeclaredTotal' | 'instapayDeclaredTotal';
  detailsFieldName: DetailChannel;
  isOpen: boolean;
  onToggle: () => void;
  register: UseFormReturn<CloseShiftValues>['register'];
  setValue: UseFormReturn<CloseShiftValues>['setValue'];
  onApplyTotalToDeclared: (total: number) => void;
  disabled?: boolean;
}
export function PaymentChannelRow(props: PaymentChannelRowProps) {
  const { t } = useTranslation();
  const detailsRows = useWatch({
    control: props.control,
    name: props.detailsFieldName,
  }) || EMPTY_DETAIL_ROWS;

  const rawDeclared = useWatch({
    control: props.control,
    name: props.declaredFieldName,
  });
  const declaredTotal = Number(rawDeclared || 0);

  // The declared total is mandatory whenever the channel has
  // operations: a blank box is NOT a 0.00 declaration. An
  // explicitly entered 0.00 stays acceptable. The server gate is
  // the pin; this rule blocks the submit in the form itself.
  const { errors: closeDeclaredErrors } = useFormState({ control: props.control });
  const declaredTotalError = closeDeclaredErrors[props.declaredFieldName];

  // INV-FE1-FRONTEND-BOOK-DIGITS: drawer detail totals and the
  // match threshold round at the tenant's book digits (global system
  // currency; the match threshold is just under one minor unit).
  const bookDigits = currencyMoneyDigits(getGlobalSystemCurrency());
  const detailsTotal = useMemo(() => summarizeDetails(detailsRows, bookDigits), [detailsRows, bookDigits]);
  const diff = roundMoneyValue(detailsTotal - declaredTotal, bookDigits);
  const isMatch = Math.abs(diff) < 10 ** -bookDigits && detailsTotal > 0 && declaredTotal > 0;
  const isZero = detailsTotal === 0 && declaredTotal === 0;

  return (
    <div
      style={{
        border: `1.5px solid ${props.isOpen ? props.themeColor : props.borderColor}`,
        borderRadius: '10px',
        background: '#ffffff',
        overflow: 'hidden',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
        boxShadow: props.isOpen ? `0 4px 12px -2px ${props.themeColor}20` : '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      {/* Main Row Bar */}
      <div
        style={{
          padding: '12px 16px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          background: props.isOpen ? props.bgLight : '#ffffff',
          borderBottom: props.isOpen ? `1px solid ${props.borderColor}` : 'none',
        }}
      >
        {/* Left: Icon, Title & Locked Count Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: '220px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: props.bgLight,
              border: `1px solid ${props.borderColor}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {props.icon}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>{props.title}</span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: '6px',
                  background: '#f1f5f9',
                  color: '#475569',
                  border: '1px solid #e2e8f0',
                }}
              >
                <LockIcon size={11} color="#64748b" />
                <span>{props.count} {props.count === 1 ? t('cash_drawer.cash_drawer_forms_panel.s0', "عملية") : props.count === 2 ? t('cash_drawer.cash_drawer_forms_panel.s1', "عمليتان") : t('cash_drawer.cash_drawer_forms_panel.s2', "عمليات")}</span>
              </span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{props.subtitle}</div>
          </div>
        </div>

        {/* Right: Declared Amount Input & Expand Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>{t('cash_drawer.cash_drawer_forms_panel.s3', "الإجمالي المعلن:")}</span>
            {props.count > 0 ? (<span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#dc2626' }}>{t('cash_drawer.cash_drawer_forms_panel.s127', "(مطلوب)")}</span>) : null}
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className="no-spin-arrows"
                {...props.register(props.declaredFieldName, {
                  valueAsNumber: true,
                  validate: (value) => (props.count > 0 ? (typeof value === 'number' && Number.isFinite(value) ? true : 'required') : true),
                })}
                disabled={props.disabled}
                onFocus={(e) => e.target.select()}
                aria-invalid={Boolean(declaredTotalError)}
                style={{
                  width: '125px',
                  padding: '6px 30px 6px 10px',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  textAlign: 'center',
                  borderRadius: '6px',
                  border: declaredTotalError ? '1.5px solid #dc2626' : '1.5px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#0f172a',
                  MozAppearance: 'textfield',
                }}
              />
              <span style={{ position: 'absolute', left: '8px', fontSize: '0.75rem', color: '#94a3b8', pointerEvents: 'none' }}><CurrencySymbol /></span>
            </div>
          </div>

          <Button
            type="button"
            variant={props.isOpen ? 'primary' : 'secondary'}
            onClick={props.onToggle}
            disabled={props.disabled}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.82rem',
              padding: '6px 12px',
            }}
          >
            <span>{t('cash_drawer.cash_drawer_forms_panel.s4', "تفاصيل العمليات")}</span>
            <ChevronIcon open={props.isOpen} size={14} />
          </Button>
        </div>
      </div>

      {declaredTotalError ? (
        <div style={{ padding: '8px 16px 12px', fontSize: '0.8rem', fontWeight: 700, color: '#dc2626' }}>
          {t('cash_drawer.cash_drawer_forms_panel.s128', "هذا الإجمالي مطلوب — توجد عمليات في هذه الوسيلة، أدخل الإجمالي المعلن (0.00 مقبول إن كان الصفر هو الفعلي).")}
        </div>
      ) : null}

      {/* Expanded Accordion Details */}
      {props.isOpen && (
        <div style={{ padding: '16px', background: '#fafbfc' }}>
          {/* Summary KPI Strip */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              padding: '10px 14px',
              borderRadius: '8px',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              marginBottom: '14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '0.83rem', color: '#475569' }}>
                {t('cash_drawer.cash_drawer_forms_panel.s5', "مجموع المربعات:")} <strong style={{ color: '#0f172a', fontSize: '0.95rem' }}>{formatCurrency(detailsTotal)}</strong>
              </div>
              <div style={{ fontSize: '0.83rem', color: '#475569' }}>
                {t('cash_drawer.cash_drawer_forms_panel.s6', "المعلن من الماكينة:")} <strong style={{ color: '#0f172a', fontSize: '0.95rem' }}>{formatCurrency(declaredTotal)}</strong>
              </div>
              {isMatch ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: '#dcfce7',
                    color: '#15803d',
                    padding: '3px 8px',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                  }}
                >
                  <CheckCircleIcon size={13} color="#15803d" />
                  <span>{t('cash_drawer.cash_drawer_forms_panel.s7', "متطابق تماماً")}</span>
                </span>
              ) : !isZero ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: '#fee2e2',
                    color: '#b91c1c',
                    padding: '3px 8px',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                  }}
                >
                  <AlertCircleIcon size={13} color="#b91c1c" />
                  <span>{t('cash_drawer.cash_drawer_forms_panel.s8', "فرق:")} {formatCurrency(diff)}</span>
                </span>
              ) : null}
            </div>

            <Button
              type="button"
              variant="secondary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '0.78rem',
                padding: '4px 10px',
              }}
              onClick={() => props.onApplyTotalToDeclared(detailsTotal)}
              disabled={props.disabled || detailsTotal === 0}
            >
              <CheckCircleIcon size={12} color="#0284c7" />
              <span>{t('cash_drawer.cash_drawer_forms_panel.s9', "اعتماد المجموع كإجمالي معلن")}</span>
            </Button>
          </div>

          {/* Numbered Amount Input Cards */}
          {props.count === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#64748b', fontSize: '0.85rem' }}>
              {t('cash_drawer.cash_drawer_forms_panel.s10', "لا توجد عمليات مسجلة لهذه القناة في الوردية الحالية.")}
            </div>
          ) : (
            <div
              style={{
                maxHeight: '340px',
                overflowY: 'auto',
                padding: '4px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(115px, 1fr))',
                gap: '8px',
              }}
            >
              {Array.from({ length: props.count }).map((_, index) => {
                const formattedNum = String(index + 1).padStart(2, '0');
                return (
                  <div
                    key={`${props.detailsFieldName}-${index}`}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      padding: '6px 8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '0.72rem',
                        color: '#64748b',
                        fontWeight: 700,
                      }}
                    >
                      <span>{t('cash_drawer.cash_drawer_forms_panel.s11', "عملية #")}{formattedNum}</span>
                    </div>
                    <input
                      id={`${props.detailsFieldName}-${index}`}
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className="no-spin-arrows"
                      style={{
                        width: '100%',
                        padding: '5px 6px',
                        borderRadius: '5px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.9rem',
                        fontWeight: 700,
                        textAlign: 'center',
                        background: '#f8fafc',
                        MozAppearance: 'textfield',
                      }}
                      {...props.register(`${props.detailsFieldName}.${index}.amount` as const, { valueAsNumber: true })}
                      disabled={props.disabled}
                      onFocus={(e) => e.target.select()}
                      onPaste={(e) => {
                        const text = e.clipboardData.getData('text');
                        if (text && /[\r\n\t, ]/.test(text.trim())) {
                          const numbers = text
                            .trim()
                            .split(/[\r\n\t, ]+/)
                            .map((val) => Number(val))
                            .filter((val) => Number.isFinite(val) && val >= 0);
                          if (numbers.length > 1) {
                            e.preventDefault();
                            numbers.forEach((num, offset) => {
                              const targetIndex = index + offset;
                              if (targetIndex < props.count) {
                                props.setValue(`${props.detailsFieldName}.${targetIndex}.amount` as const, num, { shouldDirty: true });
                              }
                            });
                          }
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const nextInput = document.getElementById(`${props.detailsFieldName}-${index + 1}`);
                          if (nextInput) {
                            nextInput.focus();
                          }
                        }
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
