// Delivery custody reclassification + per-rep custody reads (file #46 S6).
// Pure move from sales-returns-posting.service.ts: the four custody
// methods. Bound deps: deliverySettlementBasis (S5, passed bound) and
// ensureTenantFoundation (facade-kept private, passed bound). The
// in-slice this.* calls stay inside this class.

import type { Transaction } from 'kysely';
import { sql } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../../common/errors/app-error';
import { currencyMoneyDigits } from '../../engines/money-minor-units.engine';
import { tenantBaseCurrency } from '../../accounting-currency';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { SalesAndReturnsPostingDeps } from './sales-returns-posting-types';
import type { SalesReturnReliefService } from './sales-return-relief';

export class DeliveryCustodyService {
  constructor(
    private readonly assertTransaction: SalesAndReturnsPostingDeps['assertTransaction'],
    private readonly toMoney: SalesAndReturnsPostingDeps['toMoney'],
    private readonly resolveAccountWithFallback: SalesAndReturnsPostingDeps['resolveAccountWithFallback'],
    private readonly addLine: SalesAndReturnsPostingDeps['addLine'],
    private readonly insertPostedJournal: SalesAndReturnsPostingDeps['insertPostedJournal'],
    private readonly deliverySettlementBasis: SalesReturnReliefService['deliverySettlementBasis'],
    private readonly ensureTenantFoundation: (queryable: DbOrTx, auth: AuthContext) => Promise<void>,
  ) {}

  /**
   * D-SF-02 (INV-SF-COD-CUSTODY-GL) + M12 (INV-REP-CUSTODY-LEDGER): the
   * receivable a courier is carrying moves off the customer the moment
   * the order is dispatched — Dr 1130 partnerType 'rep' + partnerId =
   * the delivery_representatives.id (per-rep custody, so the GL itself
   * carries a balance per rep to reconcile against) / Cr 1130
   * partnerType 'customer'. The caller (dispatchOrders) moves the
   * customer ledger in the same transaction via its own ledger leg;
   * this method posts only the GL half.
   *
   * Decisions (recorded):
   * - partnerType 'rep' (M12, supersedes the old 'none' shape): the
   *   old 'none' debit mixed every rep's custody into one aggregate
   *   1130 balance with no per-rep balance to reconcile against.
   *   Migration 0319 extends the journal_entry_lines CHECK (0110
   *   precedent: DROP + ADD) to include 'rep'; the partner id is a
   *   delivery_representatives.id, validated tenant-scoped in
   *   insertPostedJournal. No sync exemption is needed:
   *   syncPostedPartnerLedger runs only for its 12 listed source
   *   types, and the custody / settle / return source types are not
   *   among them. The van precedent (1130 'none' field cash) is a
   *   different flow and keeps its shape.
   * - The amount is the REMAINING receivable
   *   (deliverySettlementBasis), not the original total: a return
   *   before dispatch already reversed part of it on the customer
   *   leg, and reclassifying the full total would drive the
   *   customer leg negative.
   * - Idempotent on (source_type, source_id): a re-dispatch to
   *   the same rep re-runs this and finds the posted entry.
   * - Fail-closed (not a silent no-op) when the sale is not in
   *   courier custody at call time: the caller just marked it
   *   out_for_delivery, so anything else is a caller bug. A
   *   prepaid / fully-returned sale is a silent no-op instead:
   *   there is no receivable to move.
   */
  async postDeliveryCustodyReclassification(
    queryable: Transaction<Database>,
    saleId: number,
    repId: number,
    auth: AuthContext,
  ): Promise<{
    posted: boolean;
    journalEntryId: number | null;
    amount: number;
    customerId: number | null;
    docNo: string;
  }> {
    this.assertTransaction(queryable, 'postDeliveryCustodyReclassification');
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);

    const sale = await queryable
      .selectFrom('sales')
      .select(['customer_id', 'doc_no', 'delivery_status', 'delivery_rep_id', 'branch_id', 'location_id'])
      .where('id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
    if (!sale) throw new AppError('Order not found', 'ORDER_NOT_FOUND', 404);
    const docNo = sale.doc_no || `Z-${saleId}`;
    if (String(sale.delivery_status || '') !== 'out_for_delivery') {
      throw new AppError(
        'Only a dispatched delivery order can move its receivable to courier custody',
        'DELIVERY_CUSTODY_RECLASSIFICATION_INVALID',
        409,
      );
    }
    if (Number(sale.delivery_rep_id || 0) !== Number(repId)) {
      throw new AppError(
        "Order is not in this representative's custody",
        'DELIVERY_CUSTODY_RECLASSIFICATION_INVALID',
        409,
      );
    }
    const customerId = sale.customer_id ? Number(sale.customer_id) : null;

    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'delivery_custody_reclassification')
      .where('source_id', '=', saleId)
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'posted')
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id), amount: 0, customerId, docNo };

    const basis = await this.deliverySettlementBasis(queryable, saleId, auth);
    const amount = toBookMoney(basis.remainingReceivable);
    if (!(amount > 0)) return { posted: false, journalEntryId: null, amount: 0, customerId, docNo };
    if (!customerId) return { posted: false, journalEntryId: null, amount: 0, customerId, docNo };

    const customerAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '1130');
    const branchId = sale.branch_id ? Number(sale.branch_id) : null;
    const locationId = sale.location_id ? Number(sale.location_id) : null;
    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: customerAccountId,
      description: `عهدة نقدية لدى مندوب التوصيل من فاتورة #${docNo}`,
      debit: amount,
      credit: 0,
      partnerType: 'rep',
      partnerId: repId,
      branchId,
      locationId,
    });
    addBookLine({
      accountId: customerAccountId,
      description: `نقل مديونية عميل إلى عهدة مندوب التوصيل للفاتورة #${docNo}`,
      debit: 0,
      credit: amount,
      partnerType: 'customer',
      partnerId: customerId,
      branchId,
      locationId,
    });
    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'delivery_custody_reclassification',
      sourceId: saleId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description: `قيد نقل مديونية فاتورة #${docNo} إلى عهدة مندوب التوصيل`,
      branchId,
      locationId,
      createdBy: auth.userId,
      postedBy: auth.userId,
      lines,
    });
    return { posted: true, journalEntryId: entryId, amount, customerId, docNo };
  }

  /**
   * D-SF-02 (INV-SF-COD-CUSTODY-GL): does this sale already carry a
   * posted custody reclassification? The settle / return / reversal
   * legs credit the custody leg instead of the customer leg exactly
   * when this is true, so a pre-dispatch settle or return keeps the
   * old customer-leg behaviour.
   */
  async hasDeliveryCustodyReclassification(queryable: DbOrTx, saleId: number, auth: AuthContext): Promise<boolean> {
    const scope = requireTenantScope(auth);
    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'delivery_custody_reclassification')
      .where('source_id', '=', saleId)
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'posted')
      .executeTakeFirst();
    return Boolean(existing);
  }

  /**
   * M12 (INV-REP-CUSTODY-LEDGER): the partner identity of the custody
   * debit a dispatch posted for this sale — the leg the settle /
   * return credit must mirror so the per-rep balance clears. Post-M12
   * that is ('rep', repId); an order dispatched before M12 carries
   * the old ('none', null) leg, and mirroring it keeps the
   * transitional order clearing exactly where its debit sits instead
   * of driving the rep balance negative. Falls back to ('none',
   * null) when no reclassification exists or its debit leg cannot be
   * read — the pre-M12 shape.
   */
  async deliveryCustodyPartner(
    queryable: DbOrTx,
    saleId: number,
  ): Promise<{ partnerType: 'rep' | 'none'; partnerId: number | null }> {
    const entry = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'delivery_custody_reclassification')
      .where('source_id', '=', saleId)
      .where('status', '=', 'posted')
      .executeTakeFirst();
    if (!entry) return { partnerType: 'none', partnerId: null };
    const leg = await queryable
      .selectFrom('journal_entry_lines')
      .select(['partner_type', 'partner_id'])
      .where('journal_entry_id', '=', Number(entry.id))
      .where('debit', '>', 0)
      .executeTakeFirst();
    if (!leg) return { partnerType: 'none', partnerId: null };
    const partnerType = String(leg.partner_type || 'none');
    return {
      partnerType: partnerType === 'rep' ? 'rep' : 'none',
      partnerId: partnerType === 'rep' && leg.partner_id != null ? Number(leg.partner_id) : null,
    };
  }

  /**
   * M12 (INV-REP-CUSTODY-LEDGER): the rep's 1130 custody balance
   * straight from the GL — net Dr − Cr over posted lines on the 1130
   * account with partner_type 'rep' and partner_id = repId. This is
   * the per-rep balance getRepSummary / listOrders can reconcile
   * against instead of re-deriving it from sales rows; it is
   * prospective from M12 onward — pre-M12 custody sits on 'none'
   * legs and is not attributed to any rep here (the aggregate 1130
   * balance still reconciles in total). A rep with no custody reads 0.
   */
  async getRepCustodyBalance(queryable: DbOrTx, repId: number, auth: AuthContext): Promise<number> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const customerAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '1130');
    const row = await queryable
      .selectFrom('journal_entry_lines as l')
      .innerJoin('journal_entries as j', (join) =>
        join.onRef('j.id', '=', 'l.journal_entry_id').onRef('j.tenant_id', '=', 'l.tenant_id'),
      )
      .select(sql<number>`coalesce(sum(l.debit - l.credit), 0)`.as('balance'))
      .where('l.tenant_id', '=', scope.tenantId)
      .where('l.account_id', '=', customerAccountId)
      .where(sql<boolean>`l.partner_type = 'rep'`)
      .where('l.partner_id', '=', repId)
      .where('j.status', '=', 'posted')
      .executeTakeFirst();
    return this.toMoney(Number(row?.balance || 0), bookDigits);
  }
}
