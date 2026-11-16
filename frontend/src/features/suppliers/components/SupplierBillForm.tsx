import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { SubmitButton } from '@/shared/components/submit-button';
import { PlusIcon, TrashIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';
import { queryKeys } from '@/app/query-keys';
import { accountingApi } from '@/features/accounting';
import { toast } from '@/shared/components/system-alert';
import {
  buildSupplierBillPayload,
  sumSupplierBillLines,
  supplierBillsApi,
} from '@/features/suppliers/api/supplier-bills.api';

interface DraftLine {
  key: string;
  description: string;
  amount: string;
}

type ChartAccountRow = {
  id: number | string;
  code: string | number;
  name?: string;
  nameAr?: string;
  nameEn?: string;
  accountType?: string;
  isActive?: boolean;
  flags?: { isControlAccount?: boolean };
};

function emptyLine(index: number): DraftLine {
  return { key: `line-${Date.now()}-${index}`, description: '', amount: '' };
}

function resolveDefaultBillAccountId(accounts: ChartAccountRow[], supplierType?: 'supplier' | 'freelancer'): string {
  const activeValid = accounts.filter(
    (account) =>
      account.isActive !== false
      && !account.flags?.isControlAccount
      && (account.accountType === 'expense' || account.accountType === 'asset'),
  );
  const preferredCodes = supplierType === 'freelancer'
    ? ['6200', '6700', '6900']
    : ['6700', '6900', '6200'];
  for (const code of preferredCodes) {
    const found = activeValid.find((account) => String(account.code) === code);
    if (found) return String(found.id);
  }
  const byAnyCode = accounts.find((account) => preferredCodes.includes(String(account.code)) && account.isActive !== false);
  if (byAnyCode) return String(byAnyCode.id);
  return activeValid[0] ? String(activeValid[0].id) : '';
}

/* INV-SUPPLIER-PAGE-BILL-STATEMENT: simplified non-stock bill creation
 * collecting only line description + amount (plus optional bill note),
 * automatically resolving the expense account without exposing a chart
 * picker or dropdown clipping inside the modal. */
export function SupplierBillForm({
  supplierId,
  supplierType,
  onCreated,
}: {
  supplierId: string;
  supplierType?: 'supplier' | 'freelancer';
  onCreated?: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(1)]);
  const [note, setNote] = useState('');
  const [validationError, setValidationError] = useState('');
  const [appliedInfo, setAppliedInfo] = useState('');

  const accountsQuery = useQuery({ queryKey: ['accounting-accounts'], queryFn: accountingApi.accounts });
  const chartAccounts = useMemo<ChartAccountRow[]>(() => {
    const raw = accountsQuery.data as ChartAccountRow[] | { accounts?: ChartAccountRow[] } | undefined;
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.accounts)) return raw.accounts;
    return [];
  }, [accountsQuery.data]);

  const defaultAccountId = useMemo(
    () => resolveDefaultBillAccountId(chartAccounts, supplierType),
    [chartAccounts, supplierType],
  );

  const total = useMemo(
    () => sumSupplierBillLines(lines.map((line) => ({ amount: Number(line.amount || 0) }))),
    [lines],
  );

  const mutation = useMutation({
    mutationFn: async () => {
      setValidationError('');
      setAppliedInfo('');
      if (!defaultAccountId) {
        throw new Error('تعذر تحديد حساب المصروف الافتراضي في شجرة الحسابات');
      }
      const payload = buildSupplierBillPayload(
        supplierId,
        lines.map((line) => ({
          description: line.description,
          accountId: defaultAccountId,
          amount: Number(line.amount || 0),
        })),
        note,
      );
      return supplierBillsApi.create(payload);
    },
    onSuccess: async (result) => {
      setLines([emptyLine(1)]);
      setNote('');
      const applied = Array.isArray(result.appliedAdvances)
        ? result.appliedAdvances.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
        : 0;
      const msg = applied > 0
        ? `تم تسجيل الفاتورة وتطبيق ${formatCurrency(applied)} من الدفعات المقدمة المفتوحة تلقائياً.`
        : 'تم تسجيل الفاتورة بدون مخزون بنجاح.';
      setAppliedInfo(msg);
      toast.success(msg);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.supplierBills(supplierId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.suppliers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.supplierLedger(supplierId) }),
      ]);
      onCreated?.();
    },
  });

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      if (!defaultAccountId) {
        throw new Error('تعذر تحديد حساب المصروف الافتراضي في شجرة الحسابات');
      }
      buildSupplierBillPayload(
        supplierId,
        lines.map((line) => ({
          description: line.description,
          accountId: defaultAccountId,
          amount: Number(line.amount || 0),
        })),
        note,
      );
      setValidationError('');
      mutation.mutate();
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'تحقق من بنود الفاتورة');
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '12px',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        background: '#ffffff',
      }}
    >
      {/* Card Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          paddingBottom: '8px',
          borderBottom: '1px solid #f1f5f9',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '3px', height: '14px', borderRadius: '2px', background: '#170e5e', display: 'inline-block' }} />
          <strong style={{ fontSize: '13.5px', color: '#0f172a', fontWeight: 800 }}>
            {t('suppliers.supplier_bill_form.s0', 'إضافة فاتورة بدون مخزون')}
          </strong>
        </div>
        <span
          style={{
            fontSize: '11.5px',
            fontWeight: 700,
            color: '#170e5e',
            background: '#eef2ff',
            border: '1px solid #c7d2fe',
            padding: '2px 10px',
            borderRadius: '999px',
          }}
        >
          الإجمالي: {formatCurrency(total)}
        </span>
      </div>

      {/* Clean Line Rows: Description + Amount only */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {lines.map((line, index) => (
          <div
            key={line.key}
            style={{
              display: 'grid',
              gridTemplateColumns: lines.length > 1 ? 'minmax(0, 1fr) 130px 34px' : 'minmax(0, 1fr) 140px',
              gap: '8px',
              alignItems: 'end',
              padding: '8px 10px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
            }}
          >
            <Field label={t('suppliers.supplier_bill_form.s1', 'الوصف *')}>
              <input
                value={line.description}
                onChange={(event) => updateLine(line.key, { description: event.target.value })}
                disabled={mutation.isPending}
                style={{ height: '34px', fontSize: '12.5px' }}
              />
            </Field>
            <Field label={t('suppliers.supplier_bill_form.s7', 'المبلغ *')}>
              <input
                type="number"
                step="0.01"
                min="0.01"
                className="no-spin-arrows"
                value={line.amount}
                onChange={(event) => updateLine(line.key, { amount: event.target.value })}
                disabled={mutation.isPending}
                style={{ height: '34px', fontSize: '12.5px' }}
              />
            </Field>
            {lines.length > 1 && (
              <Button
                type="button"
                variant="danger"
                onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                disabled={mutation.isPending}
                title="حذف البند"
                style={{
                  height: '34px',
                  minHeight: '34px',
                  padding: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <TrashIcon size={14} />
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* Add Line + Optional Note */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '8px',
          alignItems: 'center',
        }}
      >
        <Button
          type="button"
          variant="secondary"
          onClick={() => setLines((current) => [...current, emptyLine(current.length + 1)])}
          disabled={mutation.isPending}
          style={{
            minHeight: '34px',
            height: '34px',
            padding: '0 10px',
            fontSize: '12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            fontWeight: 600,
          }}
        >
          <PlusIcon size={13} />
          <span>{t('suppliers.supplier_bill_form.s9', 'إضافة بند')}</span>
        </Button>

        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-label={t('suppliers.supplier_bill_form.s10', 'ملاحظة الفاتورة')}
          placeholder={t('suppliers.supplier_bill_form.s11', 'ملاحظة على الفاتورة')}
          disabled={mutation.isPending}
          style={{
            height: '34px',
            padding: '0 10px',
            fontSize: '12.5px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            background: '#ffffff',
          }}
        />
      </div>

      {validationError && <div className="error-box" style={{ fontSize: '12px', padding: '6px 10px' }}>{validationError}</div>}
      {appliedInfo && <div className="success-box" style={{ fontSize: '12px', padding: '6px 10px' }}>{appliedInfo}</div>}
      <MutationFeedback
        isError={mutation.isError}
        error={mutation.error}
        errorFallback={t('suppliers.supplier_bill_form.s15', 'تعذر تسجيل الفاتورة بدون مخزون')}
        isSuccess={mutation.isSuccess}
        successText={t('suppliers.supplier_bill_form.s12', 'تم تسجيل الفاتورة بدون مخزون بنجاح.')}
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '6px', borderTop: '1px solid #f1f5f9' }}>
        <SubmitButton
          isPending={mutation.isPending}
          isSuccess={mutation.isSuccess}
          pendingText={t('suppliers.supplier_bill_form.s13', 'جاري تسجيل الفاتورة...')}
          idleText={t('suppliers.supplier_bill_form.s14', 'حفظ الفاتورة بدون مخزون')}
          style={{ minHeight: '34px', height: '34px', padding: '0 16px', fontSize: '12.5px', fontWeight: 700 }}
        />
      </div>
    </form>
  );
}
