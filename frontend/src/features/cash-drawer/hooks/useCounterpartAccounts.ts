import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { http } from '@/lib/http';
import { isCashBankAccount } from '@/features/accounting';

/** Minimal shape of the accounts-endpoint rows the counterpart picker needs. */
export interface CashBankAccountRow {
  id: string | number;
  code: string;
  nameAr?: string | null;
  nameEn?: string | null;
  accountType?: string | null;
  normalBalance?: string | null;
  isActive?: boolean | null;
  flags?: { isCashBank?: boolean } | null;
}

function httpStatus(error: unknown): number | null {
  const candidate = error as { status?: unknown; response?: { status?: unknown } } | null;
  const raw = candidate?.status ?? candidate?.response?.status;
  return typeof raw === 'number' ? raw : null;
}

/**
 * INV-CASH-DRAWER-COUNTERPART-CASHIER-ACCESS: counterpart accounts
 * for the drawer movement form. Queries the narrow endpoint GET
 * /api/cashier-shifts/counterpart-accounts (cashDrawer permission
 * only — every cashier holds it by default), NOT the full chart
 * GET /api/accounting/accounts (admin-only guard; a cashier got
 * 403 there, which the old `.catch(() => ({ accounts: [] }))`
 * silently turned into "no active cash or bank accounts"). The
 * load failure is surfaced to the caller (loadFailed /
 * loadForbidden) instead of being swallowed into an empty list,
 * so the form can show the real reason. The drawer cash account
 * itself (code 1110) is still excluded here — a transfer from the
 * drawer to itself is not a transfer (the backend rejects it with
 * DRAWER_COUNTERPART_SAME_AS_CASH).
 *
 * Lives in its own file (instead of inline in
 * CashDrawerFormsPanel) because that panel is a file-size-ratchet
 * baseline file at 1679 lines and must not grow — this move
 * net-shrinks it.
 */
export function useCounterpartAccounts(): {
  accounts: CashBankAccountRow[];
  loadFailed: boolean;
  loadForbidden: boolean;
} {
  const { data, isError, error } = useQuery({
    queryKey: ['cash-drawer-counterpart-accounts'],
    queryFn: () => http<{ accounts: CashBankAccountRow[] }>('/api/cashier-shifts/counterpart-accounts'),
  });
  const accounts = useMemo(
    () =>
      (data?.accounts || []).filter(
        (a) =>
          isCashBankAccount(a) && a?.isActive !== false && a?.accountType === 'asset' && a?.normalBalance === 'debit' && String(a?.code || '').trim() !== '1110',
      ),
    [data],
  );
  return {
    accounts,
    loadFailed: isError,
    loadForbidden: isError && httpStatus(error) === 403,
  };
}
