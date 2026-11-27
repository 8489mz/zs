import { AppError } from '../../../../common/errors/app-error';
import { AccountingPostingService } from '../../../accounting/accounting-posting.service';
import { type MoneyDigits } from '../../../accounting/engines/money-minor-units.engine';
import type { VanRepFinancialLedgerDeps } from './van-rep-financial-ledger.types';

export class RepShortageCustodySlice {
  private readonly accountingPosting: AccountingPostingService;

  constructor(deps: VanRepFinancialLedgerDeps) {
    this.accountingPosting = deps.accountingPosting;
  }

  /**
   * M4 (INV-REP-SHORTAGE-CUSTODY-GUARD): verify that a Dr 1160
   * custody leg actually stands for a pending stock_shortage item
   * before its waiver or cash settlement posts a Cr 1160 reversal.
   *
   * What "stands" means, grounded in postVanTripSettlement: a
   * CHARGED stock shortage books Dr 1160 / Cr 1140 on the trip's
   * van_trip_settlement journal (source_type van_trip_settlement,
   * source_id = trip id, status posted); an UNCHARGED one books
   * Dr 7200 / Cr 1140 instead, so no 1160 leg exists. Migration
   * 0225 backfilled every settled trip with stock variance > 0.01
   * into a PENDING stock_shortage row without recording which leg
   * was booked, so only the trip journal can tell them apart — the
   * linkage that survives is the item's trip_id.
   *
   * The check sums the Dr 1160 legs of the trip's posted settlement
   * journal(s) and subtracts the Cr 1160 legs of any prior waiver /
   * cash-collection reversals for stock_shortage items of the same
   * trip, then requires the net standing custody to cover the item
   * amount within one book-digit unit (10^-bookDigits, the same
   * tolerance the posting service allows between journal sides).
   * A missing trip, a missing journal, an uncharged (Dr 7200) leg,
   * or a leg smaller than the item all fail closed with
   * REP_SHORTAGE_NO_CUSTODY_LEG (422): no journal is posted and no
   * status flips — the row stays pending for manual review. A
   * legitimately charged shortage proceeds exactly as before.
   * Runs inside the caller's transaction, under the item's FOR
   * UPDATE lock, so the journal read sees the same snapshot as the
   * status flip that follows it.
   */
  async assertRepStockShortageCustodyLeg(
    trx: any,
    tenantId: string,
    item: { trip_id?: number | null },
    amount: number,
    bookDigits: MoneyDigits,
  ): Promise<void> {
    const tolerance = 10 ** -bookDigits;
    let standingCustody = 0;
    const tripId = item.trip_id ? Number(item.trip_id) : null;
    if (tripId) {
      const custodyAccountId = await this.accountingPosting.resolveSystemAccountByCode(trx, tenantId, '1160');
      const chargedRows = await trx
        .selectFrom('journal_entry_lines as l')
        .innerJoin('journal_entries as je', 'je.id', 'l.journal_entry_id')
        .select('l.debit as debit')
        .where('je.tenant_id', '=', tenantId)
        .where('je.source_type', '=', 'van_trip_settlement')
        .where('je.source_id', '=', tripId)
        .where('je.status', '=', 'posted')
        .where('l.account_id', '=', custodyAccountId)
        .execute();
      const charged = chargedRows.reduce((sum: number, row: any) => sum + Number(row?.debit || 0), 0);
      // Prior reversals for stock_shortage items of the same trip
      // (each reversal journal's source_id is its settlement item,
      // so the join back to the item recovers the trip): a second
      // pending row for the same trip must not reverse custody that
      // an earlier settle already cleared.
      const reversedRows = await trx
        .selectFrom('journal_entry_lines as l')
        .innerJoin('journal_entries as je', 'je.id', 'l.journal_entry_id')
        .innerJoin('van_rep_financial_settlements as s', 's.id', 'je.source_id')
        .select('l.credit as credit')
        .where('je.tenant_id', '=', tenantId)
        .where('je.source_type', 'in', ['rep_shortage_waiver', 'rep_shortage_cash_collection'])
        .where('je.status', '=', 'posted')
        .where('s.trip_id', '=', tripId)
        .where('s.entry_type', '=', 'stock_shortage')
        .where('l.account_id', '=', custodyAccountId)
        .execute();
      const reversed = reversedRows.reduce((sum: number, row: any) => sum + Number(row?.credit || 0), 0);
      standingCustody = charged - reversed;
    }
    if (standingCustody + tolerance < amount) {
      throw new AppError(
        'العجز المخزني غير محمّل على عهدة المندوب — لا يوجد قيد مدين 1160 قائم لهذا البند، راجع تصفية الرحلة قبل التسوية',
        'REP_SHORTAGE_NO_CUSTODY_LEG',
        422,
      );
    }
  }

  /**
   * Receiving shift for a rep shortage cash collection, in the order the
   * drawer truth requires: the settler's own open shift first — the
   * cashier who took the cash is the one whose drawer must grow — then,
   * when the settler holds no shift, the latest open shift on the branch
   * of the trip's van location (the same branch-only fallback granularity
   * the trip-remittance row uses). No open shift anywhere fails closed:
   * cash with no drawer must not settle.
   */
  async resolveRepShortageReceivingShift(
    trx: any,
    params: {
      tenantId: string;
      actorUserId: number | null;
      tripId: number | null;
    },
  ): Promise<{ id: number; branch_id: number | null; location_id: number | null }> {
    if (params.actorUserId && params.actorUserId > 0) {
      const own = await trx
        .selectFrom('cashier_shifts')
        .select(['id', 'branch_id', 'location_id'])
        .where('tenant_id', '=', params.tenantId)
        .where('status', '=', 'open')
        .where('opened_by', '=', params.actorUserId)
        .orderBy('id', 'desc')
        .forUpdate()
        .executeTakeFirst();
      if (own) return own;
    }
    if (params.tripId) {
      const trip = await trx
        .selectFrom('van_sales_trips')
        .select(['van_location_id'])
        .where('id', '=', params.tripId)
        .where('tenant_id', '=', params.tenantId)
        .executeTakeFirst();
      const vanLocationId = trip?.van_location_id ? Number(trip.van_location_id) : 0;
      if (vanLocationId > 0) {
        const location = await trx
          .selectFrom('stock_locations')
          .select(['branch_id'])
          .where('id', '=', vanLocationId)
          .where('tenant_id', '=', params.tenantId)
          .executeTakeFirst();
        const branchId = location?.branch_id ? Number(location.branch_id) : null;
        const branchMatch = (eb: any) =>
          branchId == null ? eb('branch_id', 'is', null) : eb('branch_id', '=', branchId);
        const branchShift = await trx
          .selectFrom('cashier_shifts')
          .select(['id', 'branch_id', 'location_id'])
          .where('tenant_id', '=', params.tenantId)
          .where('status', '=', 'open')
          .where(branchMatch)
          .orderBy('id', 'desc')
          .forUpdate()
          .executeTakeFirst();
        if (branchShift) return branchShift;
      }
    }
    throw new AppError('يجب فتح وردية قبل تحصيل نقدية عجز المندوب', 'OPEN_SHIFT_REQUIRED', 400);
  }

  /**
   * The drawer row for a rep shortage cash collection. It reuses the
   * trip-remittance txn_type on purpose — drawer math keys off the signed
   * amount and the 'مندوب' note, so the row lands in delivery cash-in
   * exactly like every other rep handover — with its own deterministic
   * request key, one per settlement item, under the same partial unique
   * index, so a retried collection collides instead of doubling the
   * shift's expected cash.
   */
  async insertRepShortageCashRow(
    trx: any,
    params: {
      tenantId: string;
      accountId: string;
      settlementItemId: number;
      repName: string;
      amount: number;
      shift: { id: number; branch_id: number | null; location_id: number | null };
      createdBy: number | null;
    },
  ): Promise<void> {
    await trx
      .insertInto('treasury_transactions')
      .values({
        tenant_id: params.tenantId,
        account_id: params.accountId,
        txn_type: 'rep_cash_remittance',
        amount: params.amount,
        note: `توريد نقدية مندوب ${params.repName} - تسوية عجز #${params.settlementItemId}`,
        reference_type: 'cashier_shift',
        reference_id: Number(params.shift.id),
        branch_id: params.shift.branch_id ? Number(params.shift.branch_id) : null,
        location_id: params.shift.location_id ? Number(params.shift.location_id) : null,
        created_by: params.createdBy,
        payment_channel: 'cash',
        request_key: `rep-shortage-cash:${params.settlementItemId}`,
      })
      .execute();
  }
}
