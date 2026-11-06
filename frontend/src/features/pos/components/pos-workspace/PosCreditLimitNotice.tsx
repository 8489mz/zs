import { useQuery } from '@tanstack/react-query';
import { posApi } from '@/features/pos/api/pos.api';
import { formatCurrency } from '@/lib/format';

export type CreditLimitPreviewState = 'ok' | 'near' | 'over';

export interface CreditLimitPreview {
  creditLimit: number;
  balance: number;
  amount: number;
  nextBalance: number;
  excess: number;
  remainingAfter: number;
  usagePercent: number;
  state: CreditLimitPreviewState;
}

/**
 * INV-POS-CREDIT-LIMIT: pure preview of what this sale does to the
 * customer's credit position. The 80% "near" band mirrors the cart
 * panel (PosCartMetaForm); the 0.001 tolerance mirrors the backend
 * gate in SalesWriteService, so the dialog warns exactly when the
 * server would reject.
 */
export function getCreditLimitPreview(input: {
  creditLimit: number;
  balance: number;
  amount: number;
}): CreditLimitPreview {
  const creditLimit = Number(input.creditLimit || 0);
  const balance = Number(input.balance || 0);
  const amount = Math.max(0, Number(input.amount || 0));
  const nextBalance = Math.round((balance + amount) * 100) / 100;
  const excess = Math.max(0, Math.round((nextBalance - creditLimit) * 100) / 100);
  const remainingAfter = Math.round((creditLimit - nextBalance) * 100) / 100;
  const usagePercent = creditLimit > 0 ? (nextBalance / creditLimit) * 100 : 0;
  const state: CreditLimitPreviewState =
    creditLimit > 0 && nextBalance > creditLimit + 0.001
      ? 'over'
      : creditLimit > 0 && usagePercent >= 80
        ? 'near'
        : 'ok';
  return { creditLimit, balance, amount, nextBalance, excess, remainingAfter, usagePercent, state };
}

export interface PosCreditLimitNoticeProps {
  customerId: string | number | null | undefined;
  /** Invoice total before this sale's payments. */
  total: number;
  /** Amount already tendered on this sale. */
  paidAmount: number;
}

/**
 * INV-POS-CREDIT-LIMIT: credit-position strip for the checkout
 * dialog, shown above the confirm button whenever this sale adds
 * debt to a customer who has a credit limit. It reuses the same
 * pos-summary query key as the dialog's customer section, so no
 * second network call is made. Warning only — it never blocks
 * confirmation; the backend gate is the one that rejects an
 * over-limit sale.
 */
export function PosCreditLimitNotice({ customerId, total, paidAmount }: PosCreditLimitNoticeProps) {
  const id = String(customerId || '').trim();
  const amount = Math.max(0, Number(total || 0) - Number(paidAmount || 0));
  const summaryQuery = useQuery({
    queryKey: ['posCustomerSummaryCheckout', id],
    queryFn: () => posApi.customerPosSummary(id),
    enabled: Boolean(id) && amount > 0,
    staleTime: 30_000,
  });
  const summary = summaryQuery.data;
  if (!id || amount <= 0) return null;
  if (!summary || Number(summary.creditLimit || 0) <= 0) return null;

  const preview = getCreditLimitPreview({
    creditLimit: Number(summary.creditLimit),
    balance: Number(summary.balance),
    amount,
  });

  const tone =
    preview.state === 'over'
      ? { background: '#fef2f2', border: '#fecaca', color: '#b91c1c' }
      : preview.state === 'near'
        ? { background: '#fffbeb', border: '#fde68a', color: '#92400e' }
        : { background: '#f8fafc', border: '#e2e8f0', color: '#334155' };

  return (
    <div
      role="status"
      aria-label="موضع العميل الائتماني"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        background: tone.background,
        border: `1px solid ${tone.border}`,
        borderRadius: '6px',
        padding: '6px 10px',
        fontSize: '12px',
        color: tone.color,
        boxSizing: 'border-box',
        width: '100%',
      }}
    >
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span>
          حد الائتمان: <strong>{formatCurrency(preview.creditLimit)}</strong>
        </span>
        <span>
          الرصيد الحالي: <strong>{formatCurrency(preview.balance)}</strong>
        </span>
        <span>
          الرصيد بعد البيع: <strong>{formatCurrency(preview.nextBalance)}</strong>
        </span>
        {preview.state !== 'over' ? (
          <span>
            المتاح بعد البيع: <strong>{formatCurrency(preview.remainingAfter)}</strong>
          </span>
        ) : null}
      </div>
      {preview.state === 'over' ? (
        <strong>
          سيتجاوز هذا البيع الحد الائتماني بمقدار {formatCurrency(preview.excess)} — راجع المبلغ أو سدّد جزءًا قبل التأكيد.
        </strong>
      ) : preview.state === 'near' ? (
        <strong>قريب من حد الائتمان — الرصيد بعد البيع يصل إلى {Math.round(preview.usagePercent)}% من الحد.</strong>
      ) : null}
    </div>
  );
}
