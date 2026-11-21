import { useTranslation } from 'react-i18next';
import { Fragment } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { formatCurrency, formatDateOnly } from '@/lib/format';
import { FILTER_OPTIONS } from './supplier-schedule-types';
import type { ScheduleFilter } from './supplier-schedule-types';
import { formatDateTime, statusClass, statusLabel } from './supplier-schedule-helpers';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { EmptyState } from '@/shared/ui/empty-state';
import { Field } from '@/shared/ui/field';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import type { SupplierPaymentScheduleItem } from '@/features/accounts/api/supplier-balance-schedule.api';

export interface SupplierScheduleTabProps {
  canSchedule: boolean;
  createMutation: { mutate: () => void; isPending: boolean; isError: boolean; isSuccess: boolean; error: unknown };
  disabled: boolean;
  expandedRows: Record<string, boolean>;
  filterCounts: Record<ScheduleFilter, number>;
  filteredRows: SupplierPaymentScheduleItem[];
  firstDueDate: string;
  installmentAmount: string;
  installmentCount: string;
  intervalDays: string;
  mode: 'count' | 'amount';
  nextDue: SupplierPaymentScheduleItem | undefined;
  note: string;
  openPaymentDialog: (row: SupplierPaymentScheduleItem) => void;
  roundingStep: string;
  rows: SupplierPaymentScheduleItem[];
  scheduleAmount: string;
  scheduleFilter: ScheduleFilter;
  setFirstDueDate: Dispatch<SetStateAction<string>>;
  setInstallmentAmount: Dispatch<SetStateAction<string>>;
  setInstallmentCount: Dispatch<SetStateAction<string>>;
  setIntervalDays: Dispatch<SetStateAction<string>>;
  setMode: Dispatch<SetStateAction<'count' | 'amount'>>;
  setNote: Dispatch<SetStateAction<string>>;
  setRoundingStep: Dispatch<SetStateAction<string>>;
  setScheduleAmount: Dispatch<SetStateAction<string>>;
  setScheduleFilter: Dispatch<SetStateAction<ScheduleFilter>>;
  setShowAppendForm: Dispatch<SetStateAction<boolean>>;
  settleMutation: { isPending: boolean; isError: boolean; isSuccess: boolean; error: unknown };
  showAppendForm: boolean;
  supplierBalance: number;
  supplierName: string;
  toggleRow: (rowId: string) => void;
  unscheduledBalance: number;
}

export function SupplierScheduleTab({
  canSchedule,
  createMutation,
  disabled,
  expandedRows,
  filterCounts,
  filteredRows,
  firstDueDate,
  installmentAmount,
  installmentCount,
  intervalDays,
  mode,
  nextDue,
  note,
  openPaymentDialog,
  roundingStep,
  rows,
  scheduleAmount,
  scheduleFilter,
  setFirstDueDate,
  setInstallmentAmount,
  setInstallmentCount,
  setIntervalDays,
  setMode,
  setNote,
  setRoundingStep,
  setScheduleAmount,
  setScheduleFilter,
  setShowAppendForm,
  settleMutation,
  showAppendForm,
  supplierBalance,
  supplierName,
  toggleRow,
  unscheduledBalance,
}: SupplierScheduleTabProps) {
  const { t } = useTranslation();
  return (
    <div>
      {nextDue ? (
        <div className="supplier-schedule-next-payment">
          <div>
            <span>{t('accounts.supplier_balance_schedule_card.s53', "الدفعة القادمة إلى")} {supplierName}</span>
            <strong>{formatCurrency(nextDue.remainingAmount || nextDue.amount)}</strong>
            <small>{t('accounts.supplier_balance_schedule_card.s54', "تستحق في")} {formatDateOnly(nextDue.dueDate)}</small>
          </div>
          <Button type="button" variant="secondary" disabled={disabled || settleMutation.isPending} onClick={() => openPaymentDialog(nextDue)}>{t('accounts.supplier_balance_schedule_card.s55', "تسجيل دفع")}</Button>
        </div>
      ) : null}

      {canSchedule && (!rows.length || showAppendForm) ? (
        <div className="form-grid" style={{ marginTop: 12 }}>
          <Field label={t('accounts.supplier_balance_schedule_card.s56', "المبلغ المراد جدولته")}>
            <input type="number" min="1" max={unscheduledBalance} step="0.01" value={scheduleAmount} onChange={(event) => setScheduleAmount(event.target.value)} placeholder={String(unscheduledBalance || '')} />
          </Field>
          <Field label={t('accounts.supplier_balance_schedule_card.s57', "طريقة التقسيم")}>
            <CustomSelect
              value={mode}
              onChange={(val) => setMode(val as 'count' | 'amount')}
              options={[
                { value: 'count', label: t('accounts.supplier_balance_schedule_card.s58', "حسب عدد الدفعات") },
                { value: 'amount', label: t('accounts.supplier_balance_schedule_card.s59', "حسب مبلغ الدفعة") },
              ]}
            />
          </Field>
          {mode === 'count' ? (
            <Field label={t('accounts.supplier_balance_schedule_card.s60', "عدد الدفعات")}><input type="number" min="1" value={installmentCount} onChange={(event) => setInstallmentCount(event.target.value)} /></Field>
          ) : (
            <Field label={t('accounts.supplier_balance_schedule_card.s61', "مبلغ كل دفعة")}><input type="number" min="1" step="0.01" value={installmentAmount} onChange={(event) => setInstallmentAmount(event.target.value)} /></Field>
          )}
          <Field label={t('accounts.supplier_balance_schedule_card.s62', "تاريخ أول دفعة")}><input type="date" value={firstDueDate} onChange={(event) => setFirstDueDate(event.target.value)} /></Field>
          <Field label={t('accounts.supplier_balance_schedule_card.s63', "تكرار الاستحقاق كل كام يوم")}><input type="number" min="1" value={intervalDays} onChange={(event) => setIntervalDays(event.target.value)} /></Field>
          <Field label={t('accounts.supplier_balance_schedule_card.s64', "تقريب الدفعات لأقرب")}><input type="number" min="1" value={roundingStep} onChange={(event) => setRoundingStep(event.target.value)} /></Field>
          <Field label={t('accounts.supplier_balance_schedule_card.s65', "ملاحظة")}><input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('accounts.supplier_balance_schedule_card.s66', "مثال: اتفاق سداد رصيد المورد")} /></Field>
          <div className="field"><span>{t('accounts.supplier_balance_schedule_card.s67', "إنشاء الجدول")}</span><Button type="button" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>{t('accounts.supplier_balance_schedule_card.s68', "جدولة المستحقات")}</Button></div>
        </div>
      ) : null}

      {canSchedule && rows.length && !showAppendForm ? (
        <div className="surface-note" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{t('accounts.supplier_balance_schedule_card.s69', "يوجد رصيد غير مجدول بقيمة")} {formatCurrency(unscheduledBalance)}{t('accounts.supplier_balance_schedule_card.s70', ". يمكنك إضافته كدفعات إضافية.")}</span>
          <Button type="button" variant="secondary" onClick={() => setShowAppendForm(true)}>{t('accounts.supplier_balance_schedule_card.s71', "إضافة دفعات للرصيد المتبقي")}</Button>
        </div>
      ) : null}

      {!canSchedule && supplierBalance <= 0 ? <div className="surface-note">{t('accounts.supplier_balance_schedule_card.s72', "لا توجد مستحقات موجبة على هذا المورد يمكن جدولتها حاليًا.")}</div> : null}
      {!canSchedule && supplierBalance > 0 && unscheduledBalance <= 0 ? <div className="surface-note">{t('accounts.supplier_balance_schedule_card.s73', "تمت جدولة جميع مستحقات هذا المورد بالكامل.")}</div> : null}

      <MutationFeedback isError={createMutation.isError || settleMutation.isError} isSuccess={createMutation.isSuccess || settleMutation.isSuccess} error={createMutation.error || settleMutation.error} errorFallback={((createMutation.error as any)?.message) || ((settleMutation.error as any)?.message) || t('accounts.supplier_balance_schedule_card.s74', "تعذر تنفيذ عملية جدولة المورد")} successText={t('accounts.supplier_balance_schedule_card.s75', "تم تحديث جدول مستحقات المورد.")} />

      {rows.length ? (
        <div className="supplier-schedule-filter-bar" aria-label={t('accounts.supplier_balance_schedule_card.s76', "فلترة دفعات المورد")} style={{ marginTop: 16 }}>
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`supplier-schedule-filter-chip ${scheduleFilter === option.key ? 'supplier-schedule-filter-chip--active' : ''}`}
              onClick={() => setScheduleFilter(option.key)}
            >
              {option.label}
              <span>{filterCounts[option.key]}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="table-wrap supplier-schedule-table-wrap" style={{ marginTop: 12 }}>
        {filteredRows.length ? (
          <table className="supplier-schedule-table">
            <thead><tr><th>#</th><th>{t('accounts.supplier_balance_schedule_card.s77', "الاستحقاق")}</th><th>{t('accounts.supplier_balance_schedule_card.s78', "المبلغ")}</th><th>{t('accounts.supplier_balance_schedule_card.s79', "المدفوع")}</th><th>{t('accounts.supplier_balance_schedule_card.s80', "المتبقي")}</th><th>{t('accounts.supplier_balance_schedule_card.s81', "الحالة")}</th><th>{t('accounts.supplier_balance_schedule_card.s82', "الإجراء")}</th></tr></thead>
            <tbody>
              {filteredRows.map((row) => {
                const isSettled = row.status === 'paid' || row.status === 'cancelled';
                const payments = row.payments || [];
                const isExpanded = Boolean(expandedRows[row.id]);
                return (
                  <Fragment key={row.id}>
                    <tr
                      className={`supplier-schedule-row ${isExpanded ? 'supplier-schedule-row--expanded' : ''}`}
                      tabIndex={0}
                      onClick={() => toggleRow(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          toggleRow(row.id);
                        }
                      }}
                    >
                      <td>
                        <span className="supplier-schedule-installment-label">{t('accounts.supplier_balance_schedule_card.s83', "دفعة")} {row.installmentNo} {isExpanded ? '▴' : '▾'}</span>
                      </td>
                      <td>{formatDateOnly(row.dueDate)}</td>
                      <td>{formatCurrency(row.amount)}</td>
                      <td className="muted">{formatCurrency(row.paidAmount)}</td>
                      <td><strong>{formatCurrency(row.remainingAmount)}</strong></td>
                      <td><span className={statusClass(row.status)}>{statusLabel(row.status)}</span></td>
                      <td>
                        {isSettled ? (
                          <span className="supplier-schedule-completed-label">{t('accounts.supplier_balance_schedule_card.s84', "مكتملة")}</span>
                        ) : (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={disabled || settleMutation.isPending}
                            onClick={(event) => {
                              event.stopPropagation();
                              openPaymentDialog(row);
                            }}
                          >
                            {t('accounts.supplier_balance_schedule_card.s85', "تسجيل دفع")}
                          </Button>
                        )}
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr className="supplier-schedule-details-row">
                        <td colSpan={7}>
                          <div className="supplier-schedule-details-panel">
                            <div className="supplier-schedule-details-heading">
                              <strong>{t('accounts.supplier_balance_schedule_card.s86', "سجل دفع الدفعة")} {row.installmentNo}</strong>
                              <span>{payments.length ? `${payments.length} عملية` : t('accounts.supplier_balance_schedule_card.s87', "لا يوجد دفع مسجل")}</span>
                            </div>
                            {payments.length ? (
                              <div className="supplier-schedule-payment-log">
                                {payments.map((payment) => (
                                  <div key={payment.id} className="supplier-schedule-payment-log-item">
                                    <strong>{formatCurrency(payment.amount)}</strong>
                                    <span>{formatDateTime(payment.createdAt)}</span>
                                    <span>{t('accounts.supplier_balance_schedule_card.s88', "تم تسجيل الدفع بواسطة المستخدم:")} {payment.createdByName || payment.createdBy || '—'}</span>
                                    {payment.note ? <em>{t('accounts.supplier_balance_schedule_card.s89', "ملاحظة:")} {payment.note}</em> : null}
                                  </div>
                                ))}
                              </div>
                            ) : <div className="muted small">{t('accounts.supplier_balance_schedule_card.s90', "لم يتم تسجيل أي دفع على هذه الدفعة بعد.")}</div>}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        ) : rows.length ? (
          <EmptyState title={t('accounts.supplier_balance_schedule_card.s91', "لا توجد دفعات مطابقة للفلتر")} hint={t('accounts.supplier_balance_schedule_card.s92', "غيّر فلتر الحالة لعرض باقي دفعات المورد.")} />
        ) : (
          <EmptyState title={t('accounts.supplier_balance_schedule_card.s93', "لا يوجد جدول مستحقات لهذا المورد")} hint={t('accounts.supplier_balance_schedule_card.s94', "استخدم نموذج الجدولة لتقسيم رصيد المورد أو جزء منه على دفعات.")} />
        )}
      </div>
    </div>
  );
}
