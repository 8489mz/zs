import { Injectable } from '@nestjs/common';
import { sql } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import { bucketTripCashByDay, cashPortionOfSale, type DayBucket } from '../../van-settlement-split.engine';
import { type MoneyDigits } from '../../../accounting/engines/money-minor-units.engine';

@Injectable()
export class SettlementHelpersService {
  constructor() {}

  /**
   * INV-VAN-DAILY-SPLIT-SETTLEMENT: the trip's cash movements
   * bucketed by tenant day, from the rows the caller locks (F3) —
   * never from an unlocked read. Cash portions follow the same
   * accumulation rules as the trip aggregates: cash sale = total,
   * split = total - credit leg, collection = amount, cash refund =
   * -amount. The caller passes its own queryable (the settle
   * transaction handle, or the pool for a read).
   */
  async computeTripDayBuckets(
    queryable: any,
    tenantId: string,
    tripId: number,
    timezone: string,
    bookDigits: MoneyDigits,
  ): Promise<DayBucket[]> {
    const sales = await queryable
      .selectFrom('sales')
      .select(['id', 'created_at', 'total', 'payment_type', 'payment_channel'])
      .where('van_trip_id', '=', tripId)
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
    const splitIds = (sales as Array<Record<string, unknown>>)
      .filter(
        (s) =>
          String(s.payment_type || '').toLowerCase() === 'split' ||
          String(s.payment_channel || '').toLowerCase() === 'mixed',
      )
      .map((s) => Number(s.id));
    const creditOwedBySale = new Map<number, number>();
    if (splitIds.length > 0) {
      const ledgerRows = await queryable
        .selectFrom('customer_ledger')
        .select(['reference_id', sql<number>`cast(coalesce(sum(amount), 0) as numeric)`.as('creditOwed')])
        .where('tenant_id', '=', tenantId)
        .where('reference_type', '=', 'sale')
        .where('entry_type', '=', 'sale_credit')
        .where('reference_id', 'in', splitIds)
        .groupBy('reference_id')
        .execute();
      for (const r of ledgerRows as Array<{ reference_id: unknown; creditOwed: unknown }>) {
        creditOwedBySale.set(Number(r.reference_id), Number(r.creditOwed || 0));
      }
    }
    const payments = await queryable
      .selectFrom('customer_payments')
      .select(['id', 'created_at', 'amount'])
      .where('van_trip_id', '=', tripId)
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
    const refunds = await queryable
      .selectFrom('van_field_returns')
      .select(['id', 'created_at', 'total_amount'])
      .where('trip_id', '=', tripId)
      .where('tenant_id', '=', tenantId)
      .where('refund_method', '=', 'cash')
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
    const rows: Array<{
      kind: 'sale' | 'collection' | 'refund';
      id: number;
      createdAt: Date | string;
      cashAmount: number;
    }> = [];
    for (const s of sales as Array<Record<string, unknown>>) {
      rows.push({
        kind: 'sale',
        id: Number(s.id),
        createdAt: s.created_at as Date | string,
        cashAmount: cashPortionOfSale(
          {
            paymentType: String(s.payment_type || ''),
            paymentChannel: String(s.payment_channel || ''),
            total: Number(s.total || 0),
            creditOwed: creditOwedBySale.get(Number(s.id)) || 0,
          },
          bookDigits,
        ),
      });
    }
    for (const p of payments as Array<Record<string, unknown>>) {
      rows.push({
        kind: 'collection',
        id: Number(p.id),
        createdAt: p.created_at as Date | string,
        cashAmount: Number(p.amount || 0),
      });
    }
    for (const r of refunds as Array<Record<string, unknown>>) {
      rows.push({
        kind: 'refund',
        id: Number(r.id),
        createdAt: r.created_at as Date | string,
        cashAmount: Number(r.total_amount || 0),
      });
    }
    rows.sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return ta - tb || a.id - b.id;
    });
    return bucketTripCashByDay(rows, timezone, bookDigits);
  }

  /**
   * INV-REP-CASH-REMITTANCE-SHIFT: links a settled trip's counted cash
   * to the receiving shift with a single treasury row — no GL journal.
   * The rep's custody is discharged by the same transaction that
   * posts the settlement journal and marks the trip settled, so the
   * row, the journal, and the custody release commit or roll back
   * together; there is no separate custody balance to update. The
   * receiving shift is the settle actor's own open shift on the
   * branch (the PIN supervisor / admin settler is the person the rep
   * hands the cash to); with no actor, the branch's latest open shift
   * receives it — the same branch-only fallback granularity the
   * cross-shift cancel refund uses. No open shift on the branch fails
   * closed: cash with no drawer must not settle. The deterministic
   * request key (one per trip, scoped by the partial unique index on
   * drawer rows) makes a retried handover collide instead of
   * doubling the shift's expected cash. The note carries 'مندوب' so
   * the drawer listing classifies the row as a delivery receipt, as
   * it does for every other rep handover row operators record.
   */
  async insertRepCashRemittanceRow(
    trx: any,
    params: {
      tenantId: string;
      accountId: string;
      tripId: number;
      repName: string;
      amount: number;
      branchId: number | null;
      actorUserId: number;
      createdBy: number | null;
      // INV-VAN-DAILY-SPLIT-SETTLEMENT: the tenant day this handover
      // belongs to. With it the row carries the per-day request key
      // 'rep-remittance:trip:{id}:day:{YYYY-MM-DD}' (same partial
      // unique index, so a retried day collides instead of doubling);
      // without it the legacy per-trip key is kept.
      businessDay?: string;
    },
  ): Promise<void> {
    const { tenantId, accountId, tripId, amount, branchId } = params;
    const branchMatch = (eb: any) => (branchId == null ? eb('branch_id', 'is', null) : eb('branch_id', '=', branchId));
    type ShiftRow = { id: number; branch_id: number | null; location_id: number | null };
    let shift: ShiftRow | undefined;
    if (params.actorUserId > 0) {
      shift = await trx
        .selectFrom('cashier_shifts')
        .select(['id', 'branch_id', 'location_id'])
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'open')
        .where('opened_by', '=', params.actorUserId)
        .where(branchMatch)
        .orderBy('id', 'desc')
        .forUpdate()
        .executeTakeFirst();
    }
    if (!shift) {
      shift = await trx
        .selectFrom('cashier_shifts')
        .select(['id', 'branch_id', 'location_id'])
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'open')
        .where(branchMatch)
        .orderBy('id', 'desc')
        .forUpdate()
        .executeTakeFirst();
    }
    if (!shift) {
      throw new AppError('يجب فتح وردية على الفرع قبل توريد نقدية المندوب', 'OPEN_SHIFT_REQUIRED', 400);
    }
    await trx
      .insertInto('treasury_transactions')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        txn_type: 'rep_cash_remittance',
        amount,
        note: params.businessDay
          ? `توريد نقدية مندوب ${params.repName} - رحلة #${tripId} — يوم ${params.businessDay}`
          : `توريد نقدية مندوب ${params.repName} - رحلة #${tripId}`,
        reference_type: 'cashier_shift',
        reference_id: Number(shift.id),
        branch_id: shift.branch_id ? Number(shift.branch_id) : null,
        location_id: shift.location_id ? Number(shift.location_id) : null,
        created_by: params.createdBy,
        payment_channel: 'cash',
        request_key: params.businessDay
          ? `rep-remittance:trip:${tripId}:day:${params.businessDay}`
          : `rep-remittance:trip:${tripId}`,
      })
      .execute();
  }
}
