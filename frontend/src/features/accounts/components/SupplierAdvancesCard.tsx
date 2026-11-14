/*
 * SupplierAdvancesCard — INV-SUPPLIER-ADVANCE-UI-WIRING.
 *
 * THE GAP (proven live on test10k, re-trial 2026-11-14 08:35): the
 * apply-advance endpoint (POST /api/supplier-payments/:id/apply-advance,
 * #7) existed, but NO UI called it — no apply action was visible in the
 * supplier statement, and a site-wide search for "دفعة مقدمة" found no
 * menu. Advances were also invisible in the statement itself, because
 * (by #7 design) an advance writes no supplier-ledger entry.
 *
 * WHAT THIS CARD DOES: for the selected supplier it lists the OPEN
 * advances (isAdvance, remainingAdvance > 0, fetched server-side by
 * supplier) with the remaining amount per advance, and offers an apply
 * form per advance: amount (defaulting to min(remaining, payable
 * balance)) + an optional purchase-bill id. Applying posts Dr 2110 /
 * Cr 1185 and reduces both the payable and the outstanding advance;
 * no cash moves at apply time. The card refreshes the advances list,
 * the supplier statement and the supplier balances on success.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/app/query-keys';
import { accountsApi, type SupplierAdvanceRow } from '@/features/accounts/api/accounts.api';
import { formatCurrency } from '@/lib/format';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { Field } from '@/shared/ui/field';
import { Button } from '@/shared/ui/button';
import { MutationFeedback } from '@/shared/components/mutation-feedback';

function ApplyAdvanceRow({
  row,
  supplierBalance,
  disabled,
  onApplied,
}: {
  row: SupplierAdvanceRow;
  supplierBalance: number;
  disabled: boolean;
  onApplied: () => void;
}) {
  const { t } = useTranslation();
  const remaining = Number(row.remainingAdvance || 0);
  const defaultAmount = Math.min(remaining, Math.max(0, supplierBalance));
  const [amount, setAmount] = useState(String(defaultAmount > 0 ? defaultAmount : ''));
  const [purchaseId, setPurchaseId] = useState('');
  const mutation = useMutation({
    mutationFn: () => {
      const value = Number(amount || 0);
      if (!(value > 0)) throw new Error('أدخل مبلغ التطبيق أولًا');
      if (value > remaining + 0.0001) throw new Error('المبلغ أكبر من المتبقي من الدفعة المقدمة.');
      const billId = Number(purchaseId || 0);
      return accountsApi.applySupplierAdvance(row.id, {
        amount: value,
        purchaseId: billId > 0 ? billId : undefined,
      });
    },
    onSuccess: () => {
      setAmount('');
      setPurchaseId('');
      onApplied();
    },
  });
  const canApply = !disabled && supplierBalance > 0 && Number(amount || 0) > 0 && !mutation.isPending;

  return (
    <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '12px', marginTop: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', fontSize: '13px' }}>
        <div>
          <strong>{row.docNo}</strong>
          <span className="muted small" style={{ marginInlineStart: '8px' }}>{String(row.date || '').slice(0, 10)}</span>
          {row.note ? <span className="muted small" style={{ marginInlineStart: '8px' }}>{row.note}</span> : null}
        </div>
        <div>
          <span className="muted small">المتبقي: </span>
          <strong>{formatCurrency(remaining)} {getGlobalCurrencySymbol()}</strong>
          <span className="muted small"> (من أصل {formatCurrency(Number(row.amount || 0))} — مُطبق {formatCurrency(Number(row.appliedAmount || 0))})</span>
        </div>
      </div>
      {supplierBalance <= 0 ? (
        <div className="muted small" style={{ marginTop: '8px' }}>
          {t('accounts.supplier_advances_card.s0', "لا يوجد رصيد مستحق حاليًا لهذا المورد — التطبيق يحتاج فاتورة شراء مستحقة.")}
        </div>
      ) : (
        <div className="form-grid" style={{ marginTop: '10px' }}>
          <Field label={`مبلغ التطبيق (${getGlobalCurrencySymbol()})`}>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder={`مثال: ${formatCurrency(defaultAmount)}`}
              disabled={mutation.isPending || disabled}
            />
          </Field>
          <Field label={t('accounts.supplier_advances_card.s1', "رقم فاتورة الشراء (اختياري)")}>
            <input
              type="number"
              min="1"
              step="1"
              value={purchaseId}
              onChange={(event) => setPurchaseId(event.target.value)}
              placeholder={t('accounts.supplier_advances_card.s2', "اتركه فارغًا للتطبيق على الرصيد العام")}
              disabled={mutation.isPending || disabled}
            />
          </Field>
        </div>
      )}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' }}>
        <Button type="button" variant="primary" onClick={() => mutation.mutate()} disabled={!canApply}>
          {mutation.isPending
            ? t('accounts.supplier_advances_card.s3', "جارٍ التطبيق...")
            : t('accounts.supplier_advances_card.s4', "تطبيق على المستحقات")}
        </Button>
        <MutationFeedback
          isError={mutation.isError}
          isSuccess={mutation.isSuccess}
          error={mutation.error}
          errorFallback={t('accounts.supplier_advances_card.s5', "تعذر تطبيق الدفعة المقدمة")}
          successText={t('accounts.supplier_advances_card.s6', "تم تطبيق الدفعة المقدمة على المستحقات.")}
        />
      </div>
    </div>
  );
}

export function SupplierAdvancesCard({
  supplierId,
  supplierName,
  supplierBalance,
  disabled = false,
}: {
  supplierId: string;
  supplierName: string;
  supplierBalance: number;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const advancesQuery = useQuery({
    queryKey: queryKeys.supplierAdvances(supplierId),
    queryFn: () => accountsApi.listSupplierPayments({ supplierId, pageSize: 50 }),
    enabled: Boolean(supplierId),
  });
  if (!supplierId) return null;
  const rows = (advancesQuery.data?.supplierPayments || []).filter(
    (row) => row.isAdvance && Number(row.remainingAdvance || 0) > 0.005,
  );
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.supplierAdvances(supplierId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.supplierLedger(supplierId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.supplierBalances });
  };

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px' }}>
      <strong style={{ display: 'block', marginBottom: '4px', fontSize: '0.94rem', color: '#0f172a' }}>
        {t('accounts.supplier_advances_card.s7', "الدفعات المقدمة المفتوحة")} {supplierName ? `— ${supplierName}` : ''}
      </strong>
      <div className="muted small" style={{ marginBottom: '10px' }}>
        {t('accounts.supplier_advances_card.s8', "دفعات مقدمة لم تُطبق بعد (حساب 1185) — طبّقها على مستحقات المورد؛ لا تتحرك نقدية عند التطبيق.")}
      </div>
      {advancesQuery.isLoading ? (
        <div className="muted small">{t('accounts.supplier_advances_card.s9', "جاري تحميل الدفعات المقدمة...")}</div>
      ) : advancesQuery.isError ? (
        <div className="muted small">{t('accounts.supplier_advances_card.s10', "تعذر تحميل الدفعات المقدمة — أعد تحميل الصفحة وحاول مجددًا.")}</div>
      ) : rows.length === 0 ? (
        <div className="muted small">{t('accounts.supplier_advances_card.s11', "لا توجد دفعات مقدمة مفتوحة لهذا المورد.")}</div>
      ) : (
        rows.map((row) => (
          <ApplyAdvanceRow
            key={row.id}
            row={row}
            supplierBalance={supplierBalance}
            disabled={disabled}
            onApplied={refresh}
          />
        ))
      )}
    </div>
  );
}
