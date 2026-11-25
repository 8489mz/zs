import { Transaction } from 'kysely';
import { Database } from '../../../../database/database.types';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../accounting-currency';
import { currencyMoneyDigits, MoneyDigits } from '../../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { VanAndDeliveryPostingDeps } from './van-and-delivery-posting.types';

export type PostVanFieldReturnBoundDeps = {
  ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void>;
  readSaleResidualLines: VanAndDeliveryPostingDeps['readSaleResidualLines'];
  salesReturnCogsResidual: VanAndDeliveryPostingDeps['salesReturnCogsResidual'];
  toMoney: VanAndDeliveryPostingDeps['toMoney'];
  addLine: VanAndDeliveryPostingDeps['addLine'];
  getTenantAccountingSettings: VanAndDeliveryPostingDeps['getTenantAccountingSettings'];
  resolveSystemAccountByCode: VanAndDeliveryPostingDeps['resolveSystemAccountByCode'];
  insertPostedJournal: VanAndDeliveryPostingDeps['insertPostedJournal'];
};

export class PostVanFieldReturnSlice {
  constructor(private readonly bound: PostVanFieldReturnBoundDeps) {}

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    return this.bound.ensureTenantFoundation(queryable, auth);
  }

  private async readSaleResidualLines(
    queryable: Transaction<Database>,
    tenantId: string,
    saleId: number,
  ): Promise<
    Array<{
      id: number;
      product_id: number | null;
      qty: number | string;
      cost_price: number | string | null;
      unit_multiplier: number | string | null;
      modifiers: unknown;
    }>
  > {
    return this.bound.readSaleResidualLines(queryable, tenantId, saleId);
  }

  private async salesReturnCogsResidual(
    queryable: Transaction<Database>,
    tenantId: string,
    saleId: number,
    bookDigits: MoneyDigits,
    returnedQtyBySaleItemId: Map<number, number>,
  ): Promise<number> {
    return this.bound.salesReturnCogsResidual(queryable, tenantId, saleId, bookDigits, returnedQtyBySaleItemId);
  }

  private toMoney(value: unknown, digits: MoneyDigits): number {
    return this.bound.toMoney(value, digits);
  }

  private addLine(lines: JournalLineDraft[], next: JournalLineDraft, digits: 2 | 3): void {
    return this.bound.addLine(lines, next, digits);
  }

  private async getTenantAccountingSettings(queryable: DbOrTx, tenantId: string): Promise<any> {
    return this.bound.getTenantAccountingSettings(queryable, tenantId);
  }

  private async resolveSystemAccountByCode(queryable: DbOrTx, tenantId: string, code: string): Promise<number> {
    return this.bound.resolveSystemAccountByCode(queryable, tenantId, code);
  }

  private insertPostedJournal(
    queryable: any,
    params: {
      sourceType: string;
      sourceId: number;
      tenantId: string;
      accountId: string | null;
      entryDate: Date;
      description: string;
      branchId: number | null;
      locationId: number | null;
      createdBy: number | null;
      postedBy: number | null;
      cashFlowCategory?: 'operating' | 'investing' | 'financing' | null;
      lines: JournalLineDraft[];
      reversalOfEntryId?: number | null;
    },
  ): Promise<number> {
    return this.bound.insertPostedJournal(queryable, params);
  }

  /*
   * INV-VAN-FIELD-RETURN-COGS-RESIDUAL-MIRROR: a LINKED field return
   * reverses COGS on the same residual basis the sale posted it — the
   * returned quantity per original sale line is fed through the shared
   * residual grouping (salesReturnCogsResidual) at the FROZEN sale-line
   * costs, with the post-sale remaining quantity reconstructed from the
   * post-restock stock read, so sequential field returns telescope to
   * the posted COGS and a full return nets COGS to zero. The caller
   * supplies the current product cost per item; the mirror ignores it
   * in favour of the frozen cost, because the current cost is what
   * stranded the divergence this mirror closes. Eligibility is
   * deliberately narrow: a linked sale whose every returned item
   * resolves to exactly one sale line (by saleItemId, or by a unique
   * product line), and a non-damaged restock. Anything else — no
   * linked sale, a damaged-location restock, an unresolvable or
   * ambiguous line (including several sale lines at differing frozen
   * costs with no saleItemId to disambiguate), or a missing sale —
   * keeps the legacy plain qty x caller cost computation. A resolved
   * line whose frozen cost is missing or invalid fails closed with
   * VAN_FIELD_RETURN_FROZEN_COST_INVALID instead of silently
   * falling back to the current product cost. A zero frozen cost
   * (prepared composite) contributes nothing, as in the sales-return
   * mirror, and its COGS stays expensed.
   */
  private async vanFieldReturnCogsAmount(
    queryable: DbOrTx,
    tenantId: string,
    params: {
      items: { productId: number; qty: number; costPrice: number; saleItemId?: number | null }[];
      saleId?: number | null;
      isDamaged?: boolean;
    },
    bookDigits: MoneyDigits,
  ): Promise<number> {
    const legacy = params.items.reduce((sum, it) => sum + Number(it.qty || 0) * Number(it.costPrice || 0), 0);
    const saleId = params.saleId ? Number(params.saleId) : 0;
    if (!(saleId > 0) || params.isDamaged) return legacy;
    // The residual grouping reads stock on a transaction handle; the
    // only caller passes the approval transaction, which also carries
    // the restock, so the read and the journal commit or roll back
    // together.
    const trx = queryable as Transaction<Database>;
    const saleItems = await this.readSaleResidualLines(trx, tenantId, saleId);
    if (!saleItems.length) return legacy;
    const byId = new Map(saleItems.map((item) => [Number(item.id), item]));
    const byProduct = new Map<number, typeof saleItems>();
    for (const item of saleItems) {
      const pid = Number(item.product_id || 0);
      if (!byProduct.has(pid)) byProduct.set(pid, []);
      byProduct.get(pid)!.push(item);
    }
    const returnedQtyBySaleItemId = new Map<number, number>();
    for (const item of params.items) {
      const qty = Number(item.qty || 0);
      if (!(qty > 0)) continue;
      const productId = Number(item.productId || 0);
      let line: (typeof saleItems)[number] | undefined;
      if (item.saleItemId != null) {
        line = byId.get(Number(item.saleItemId));
        if (!line || Number(line.product_id || 0) !== productId) return legacy;
      } else {
        const candidates = byProduct.get(productId) || [];
        if (candidates.length !== 1) return legacy;
        line = candidates[0];
      }
      const rawCost = line.cost_price;
      if (rawCost == null) {
        throw new AppError(
          `Frozen sale cost is missing for field-return product ${productId}; refusing to reverse COGS at the current product cost`,
          'VAN_FIELD_RETURN_FROZEN_COST_INVALID',
          400,
        );
      }
      const frozen = Number(rawCost);
      if (!Number.isFinite(frozen) || frozen < 0) {
        throw new AppError(
          `Frozen sale cost is invalid for field-return product ${productId}; refusing to reverse COGS at the current product cost`,
          'VAN_FIELD_RETURN_FROZEN_COST_INVALID',
          400,
        );
      }
      if (frozen === 0) continue;
      returnedQtyBySaleItemId.set(Number(line.id), (returnedQtyBySaleItemId.get(Number(line.id)) || 0) + qty);
    }
    if (returnedQtyBySaleItemId.size === 0) return 0;
    return this.salesReturnCogsResidual(trx, tenantId, saleId, bookDigits, returnedQtyBySaleItemId);
  }

  /**
   * An approved field return reverses the two things the original sale posted: the revenue (net of
   * whatever discount the return price itself already reflects) and the COGS/inventory pair, using
   * the product's actual cost — not the return's unit price, which is a selling price, not a cost.
   * The receivable side always credits the named customer (submitFieldReturn requires one), whether
   * the original sale was cash-via-rep-custody or a real customer credit sale, matching what
   * approveFieldReturn already writes to customers.balance/customer_ledger for every return.
   */
  async postVanFieldReturn(
    queryable: DbOrTx,
    returnId: number,
    params: {
      customerId: number;
      totalAmount: number;
      refundMethod?: 'credit' | 'cash';
      items: { productId: number; qty: number; costPrice: number; saleItemId?: number | null }[];
      branchId: number | null;
      locationId: number | null;
      saleId?: number | null;
      isDamaged?: boolean;
    },
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);

    const amount = toBookMoney(params.totalAmount);
    if (!(amount > 0)) return { posted: false, journalEntryId: null };

    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'van_field_return')
      .where('source_id', '=', returnId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    // INV-VAN-RETURN-METHOD-MATCH: the posting must debit the leg
    // that actually holds the money. The returns service already
    // enforces the match; this re-derives the linked sale's payment
    // type at the money boundary so a mismatched refund can never
    // post even if a future caller passes refundMethod unchecked.
    // A split sale allows either method — its leg bounds are
    // enforced by the returns service, not here.
    if (params.saleId != null) {
      const linkedSale = await queryable
        .selectFrom('sales')
        .select(['payment_type'])
        .where('id', '=', params.saleId)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      const salePayment = String((linkedSale as any)?.payment_type || '').trim();
      const wantsCash = params.refundMethod === 'cash';
      if (!linkedSale || !['cash', 'credit', 'card', 'split', 'instapay', 'vodafone_cash'].includes(salePayment)) {
        throw new AppError(
          `تعذّرت مطابقة طريقة رد المرتجع #${returnId} مع الفاتورة الأصلية — طريقة دفع الفاتورة غير معروفة`,
          'REFUND_METHOD_MISMATCH',
          400,
        );
      }
      if ((salePayment === 'credit' && wantsCash) || (salePayment === 'cash' && !wantsCash)) {
        throw new AppError(
          `طريقة رد المرتجع #${returnId} (${wantsCash ? 'نقدي' : 'كائتمان'}) لا تطابق طريقة دفع الفاتورة الأصلية (${salePayment})`,
          'REFUND_METHOD_MISMATCH',
          400,
        );
      }
      if (salePayment === 'card' || salePayment === 'instapay' || salePayment === 'vodafone_cash') {
        throw new AppError(
          `لا يمكن رد مرتجع #${returnId} على فاتورة مسددة (${salePayment}) نقداً أو كائتمان من عهدة المندوب — المبلغ مستقر في البنك ويتطلب عكساً بنكياً`,
          'REFUND_METHOD_MISMATCH',
          400,
        );
      }
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting van field return ${returnId}`);

    let revenueAccountId = Number(settings.sales_revenue_account_id || 0);
    if (!(revenueAccountId > 0))
      revenueAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '4100');
    let receivableAccountId = Number(settings.customer_receivable_account_id || 0);
    if (!(receivableAccountId > 0))
      receivableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');
    let cogsAccountId = Number(settings.cogs_account_id || 0);
    if (!(cogsAccountId > 0)) cogsAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5100');
    let inventoryAccountId = Number(settings.inventory_account_id || 0);
    if (!(inventoryAccountId > 0))
      inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');

    const branchId = params.branchId;
    const locationId = params.locationId;
    const isCashRefund = params.refundMethod === 'cash';
    const lines: JournalLineDraft[] = [
      {
        accountId: revenueAccountId,
        description: `عكس إيراد مبيعات - مرتجع ميداني #${returnId}`,
        debit: amount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      },
      isCashRefund
        ? {
            accountId: receivableAccountId,
            description: `تخفيض عهدة نقدية مندوب - مرتجع ميداني مسدد نقداً #${returnId}`,
            debit: 0,
            credit: amount,
            partnerType: 'none',
            partnerId: null,
            branchId,
            locationId,
          }
        : {
            accountId: receivableAccountId,
            description: `تخفيض مديونية عميل - مرتجع ميداني #${returnId}`,
            debit: 0,
            credit: amount,
            partnerType: 'customer',
            partnerId: params.customerId,
            branchId,
            locationId,
          },
    ];

    // INV-VAN-FIELD-RETURN-COGS-RESIDUAL-MIRROR: linked returns reverse
    // COGS on the shared residual basis at frozen sale-line costs; every
    // other shape keeps the legacy plain computation (see
    // vanFieldReturnCogsAmount).
    const cogsAmount = toBookMoney(await this.vanFieldReturnCogsAmount(queryable, scope.tenantId, params, bookDigits));
    if (cogsAmount > 0) {
      addBookLine({
        accountId: inventoryAccountId,
        description: `إعادة بضاعة للمخزون - مرتجع ميداني #${returnId}`,
        debit: cogsAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
      addBookLine({
        accountId: cogsAccountId,
        description: `عكس تكلفة البضاعة المباعة - مرتجع ميداني #${returnId}`,
        debit: 0,
        credit: cogsAmount,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'van_field_return',
        sourceId: returnId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد مرتجع ميداني معتمد #${returnId}`,
        branchId,
        locationId,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_race_window_uniq')) {
        const existing2 = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'van_field_return')
          .where('source_id', '=', returnId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing2?.id || 0) };
      }
      throw e;
    }
  }
}
