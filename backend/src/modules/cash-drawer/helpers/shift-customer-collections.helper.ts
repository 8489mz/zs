import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

export type ShiftCustomerCollectionsByChannel = {
  cash: number;
  card: number;
  wallet: number;
  instapay: number;
  cashCount: number;
  cardCount: number;
  walletCount: number;
  instapayCount: number;
};

export type ShiftCollectionWindow = {
  tenantId: string;
  openerId: number;
  createdAt: string | Date | null | undefined;
  closedAt: string | Date | null | undefined;
  branchId: number | string | null | undefined;
  locationId: number | string | null | undefined;
};

/**
 * INV-SHIFT-EXPECTED-PER-METHOD-COLLECTIONS: customer-account receipts
 * (customer_payments) per payment channel, inside one shift's window.
 * The cash-only caller used to be the only consumer, so the old
 * computeShiftCustomerCollections read payment_channel='cash' alone —
 * and the per-method expected totals (card/wallet/instapay) were
 * computed from POS sales only. A cashier who collected a customer
 * InstaPay receipt during the shift then declared it honestly got a
 * false +100 variance at review (live trial shift 0028: POS InstaPay
 * sales 395 + non-POS receipt 100; the system expected 395). Cash was
 * fully reconciled while the electronic channels were sales-only.
 * The window/branch/location predicates mirror the cash-only query
 * exactly (INV-EXPECTED-CASH-SINGLE-WINDOW: created_at is the moment
 * the money moved), so each receipt counts exactly once. 'bank'
 * receipts have no close channel and are excluded, as before.
 */
export async function computeShiftCustomerCollectionsByChannel(
  db: Kysely<Database>,
  window: ShiftCollectionWindow,
  bookDigits: MoneyDigits,
): Promise<ShiftCustomerCollectionsByChannel> {
  const empty: ShiftCustomerCollectionsByChannel = {
    cash: 0,
    card: 0,
    wallet: 0,
    instapay: 0,
    cashCount: 0,
    cardCount: 0,
    walletCount: 0,
    instapayCount: 0,
  };
  const openerId = Number(window.openerId || 0);
  if (!(openerId > 0) || !window.createdAt) return empty;
  const result = await sql<{
    cash_total?: string | number | null;
    card_total?: string | number | null;
    wallet_total?: string | number | null;
    instapay_total?: string | number | null;
    cash_count?: string | number | null;
    card_count?: string | number | null;
    wallet_count?: string | number | null;
    instapay_count?: string | number | null;
  }>`
    select
      coalesce(sum(case when coalesce(cp.payment_channel, 'cash') = 'cash' then cp.amount else 0 end), 0) as cash_total,
      coalesce(sum(case when coalesce(cp.payment_channel, 'cash') = 'card' then cp.amount else 0 end), 0) as card_total,
      coalesce(sum(case when coalesce(cp.payment_channel, 'cash') = 'wallet' then cp.amount else 0 end), 0) as wallet_total,
      coalesce(sum(case when coalesce(cp.payment_channel, 'cash') = 'instapay' then cp.amount else 0 end), 0) as instapay_total,
      coalesce(sum(case when coalesce(cp.payment_channel, 'cash') = 'cash' then 1 else 0 end), 0)::int as cash_count,
      coalesce(sum(case when coalesce(cp.payment_channel, 'cash') = 'card' then 1 else 0 end), 0)::int as card_count,
      coalesce(sum(case when coalesce(cp.payment_channel, 'cash') = 'wallet' then 1 else 0 end), 0)::int as wallet_count,
      coalesce(sum(case when coalesce(cp.payment_channel, 'cash') = 'instapay' then 1 else 0 end), 0)::int as instapay_count
    from customer_payments cp
    where cp.tenant_id = ${window.tenantId} and cp.created_by = ${openerId}
      and cp.created_at >= ${window.createdAt}
      and (${window.closedAt || null}::timestamptz is null or cp.created_at <= ${window.closedAt || null})
      and (${window.branchId || null}::int is null or cp.branch_id is null or cp.branch_id = ${Number(window.branchId || 0) || null})
      and (${window.locationId || null}::int is null or cp.location_id is null or cp.location_id = ${Number(window.locationId || 0) || null})
  `.execute(db);
  const row = result.rows?.[0] || {};
  const toMoney = (value: unknown): number => roundMoney(Number(value || 0), bookDigits);
  return {
    cash: toMoney(row.cash_total),
    card: toMoney(row.card_total),
    wallet: toMoney(row.wallet_total),
    instapay: toMoney(row.instapay_total),
    cashCount: Number(row.cash_count || 0),
    cardCount: Number(row.card_count || 0),
    walletCount: Number(row.wallet_count || 0),
    instapayCount: Number(row.instapay_count || 0),
  };
}
