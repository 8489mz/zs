import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { SubmitButton } from '@/shared/components/submit-button';
import { formatCurrency } from '@/lib/format';
import { queryKeys } from '@/app/query-keys';
import { accountingApi } from '@/features/accounting';
import {
  supplierBillsApi,
  buildSupplierBillPayload,
  sumSupplierBillLines,
  type SupplierBillLineInput,
} from '@/features/suppliers/api/supplier-bills.api';

/* INV-SUPPLIER-NONSTOCK-BILL: these are the accounts a bill line may
 * never use (cash/bank, receivable, inventory, the 2110 payable
 * itself, any advance asset, tax accounts). The backend enforces the
 * same blocklist — the picker hides them first so the merchant never
 * picks a line the server will refuse. */
const BLOCKED_ACCOUNT_CODES = new Set([
  '1110', '1120', '1130', '1140', '2110', '1185', '1160', '1165', '1150', '2120', '2126', '2150',
]);

type DraftLine = { description: string; accountId: string; amount: string };

const EMPTY_LINE: DraftLine = { description: '', accountId: '', amount: '' };

export function SupplierBillForm({ supplierId, onCreated }: { supplierId: string; onCreated?: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');

  const accountsQuery = useQuery({ queryKey: ['accounting-accounts'], queryFn: accountingApi.accounts });
  const accountOptions = useMemo(() => {
    const accounts = accountsQuery.data?.accounts || [];
    return accounts
      .filter((account) => account.isActive && !account.isControlAccount)
      .filter((account) => account.accountType === 'expense' || account.accountType === 'asset')
      .filter((account) => !BLOCKED_ACCOUNT_CODES.has(String(account.code)))
      .map((account) => ({
        value: String(account.id),
        label: `${account.code} — ${account.nameAr || account.nameEn || account.code}`,
      }));
  }, [accountsQuery.data]);

  const mutation = useMutation({
    mutationFn: (payload: ReturnType<typeof buildSupplierBillPayload>) => supplierBillsApi.create(payload),
    onSuccess: async (data) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.supplierBills(supplierId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.suppliers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.supplierLedger(supplierId) }),
      ]);
      setLines([{ ...EMPTY_LINE }]);
      setNote('');
      setFormError('');
      onCreated?.();
      return data;
    },
  });

  const numericLines: SupplierBillLineInput[] = lines.map((line) => ({
    description: line.description,
    accountId: line.accountId,
    amount: Number(line.amount || 0),
  }));
  const total = sumSupplierBillLines(numericLines);

  function updateLine(index: number, patch: Partial<DraftLine>): void {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    setFormError('');
    let payload: ReturnType<typeof buildSupplierBillPayload>;
    try {
      payload = buildSupplierBillPayload(supplierId, numericLines, note);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('suppliers.supplier_bill_form.s0', 'تعذر حفظ الفاتورة'));
      return;
    }
    mutation.mutate(payload);
  }

  const appliedTotal = (mutation.data?.appliedAdvances || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);

  return (
    <form className="form-grid" onSubmit={handleSubmit}>
      <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {lines.map((line, index) => (
          <div key={index} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr auto', gap: '8px', alignItems: 'end' }}>
            <Field label={t('suppliers.supplier_bill_form.s1', 'البيان')}>
              <input
                type="text"
                value={line.description}
                disabled={mutation.isPending}
                placeholder={t('suppliers.supplier_bill_form.s2', 'مثال: برنامج محاسبة / كرتونة ورق / كابلات')}
                onChange={(event) => updateLine(index, { description: event.target.value })}
              />
            </Field>
            <Field label={t('suppliers.supplier_bill_form.s3', 'الحساب')}>
              <CustomSelect
                value={line.accountId}
                onChange={(value) => updateLine(index, { accountId: String(value) })}
                options={accountOptions}
                placeholder={accountsQuery.isPending ? t('suppliers.supplier_bill_form.s4', 'جارٍ تحميل الحسابات...') : t('suppliers.supplier_bill_form.s5', 'اختر الحساب...')}
                disabled={mutation.isPending || accountsQuery.isPending}
              />
            </Field>
            <Field label={t('suppliers.supplier_bill_form.s6', 'المبلغ')}>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={line.amount}
                disabled={mutation.isPending}
                placeholder="0.00"
                onChange={(event) => updateLine(index, { amount: event.target.value })}
              />
            </Field>
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending || lines.length <= 1}
              onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
            >
              {t('suppliers.supplier_bill_form.s7', 'حذف')}
            </Button>
          </div>
        ))}
      </div>
      <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={() => setLines((current) => [...current, { ...EMPTY_LINE }])}>
          {t('suppliers.supplier_bill_form.s8', '+ إضافة بند')}
        </Button>
        <strong>{t('suppliers.supplier_bill_form.s9', 'الإجمالي')}: {formatCurrency(total)}</strong>
      </div>
      <Field label={t('suppliers.supplier_bill_form.s10', 'ملاحظات')} className="field-full-span">
        <input type="text" value={note} disabled={mutation.isPending} placeholder={t('suppliers.supplier_bill_form.s11', 'ملاحظة اختيارية على الفاتورة')} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {formError ? <div className="muted small" style={{ gridColumn: '1 / -1', color: '#b91c1c' }}>{formError}</div> : null}
      {mutation.isSuccess && appliedTotal > 0 ? (
        <div className="muted small" style={{ gridColumn: '1 / -1' }}>
          {t('suppliers.supplier_bill_form.s12', 'تم تطبيق دفعة مقدمة بقيمة {{amount}} على هذه الفاتورة.', { amount: formatCurrency(appliedTotal) })}
        </div>
      ) : null}
      <MutationFeedback
        isError={mutation.isError}
        isSuccess={mutation.isSuccess}
        error={mutation.error}
        errorFallback={t('suppliers.supplier_bill_form.s13', 'تعذر حفظ الفاتورة')}
        successText={t('suppliers.supplier_bill_form.s14', 'تم حفظ فاتورة المورد بدون مخزون.')}
      />
      <div className="actions sticky-form-actions">
        <SubmitButton type="submit" isPending={mutation.isPending} idleText={t('suppliers.supplier_bill_form.s15', 'حفظ الفاتورة')} pendingText={t('suppliers.supplier_bill_form.s16', 'جارٍ الحفظ...')} />
      </div>
    </form>
  );
}
