import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney as roundBookMoney } from '../accounting/engines/money-minor-units.engine';
import { Injectable } from '@nestjs/common';
import { Kysely, Transaction, sql } from '../../database/kysely';
import { type RawBuilder } from 'kysely';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope, type TenantScope } from '../../core/auth/utils/tenant-boundary';
import { AppError } from '../../common/errors/app-error';
import { normalizeReturnItems } from './helpers/return-payload.helper';
import { buildSaleReturnLine, calculateReturnDocumentTotal } from './helpers/returns-write.helper';
import { Database } from '../../database/database.types';
import { CreateReturnDto } from './dto/create-return.dto';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { authorizeManagerSecret } from '../../common/utils/manager-approval';
import {
  allocateProRata,
  computeConditionalDiscountForfeit,
  type ConditionalDiscountForfeitBreakdown,
  type ConditionalDiscountForfeitResult,
} from './engines/conditional-header-discount-return.engine';
import { allocateInvoiceDiscount } from '../sales/engines/invoice-discount.engine';
import { type ReturnInputItem } from './returns.types';

/**
 * ReturnsReliefService — slice S2 of the returns split.
 * Pure move of the read-only refund computation and the pure relief
 * helpers from ReturnsService. No behavior change: the bodies are
 * byte-identical except for the forced visibility change below; the
 * facade keeps thin delegates with the same names and signatures.
 * This slice reaches the kernel helpers and the posting service
 * only through bound deps — it never imports another slice service.
 * The computation is read-only by construction: it prices the refund
 * the create path would pay without writing a document, a stock
 * move, a journal, or a treasury row. The four helpers are public
 * here (private in the facade) — the facade, a different class,
 * cannot call a private slice method (tsc TS2341); the facade
 * delegates stay private, so the facade public surface is unchanged.
 */

export interface ReturnsReliefDeps {
  db: Kysely<Database>;
  accountingPosting: AccountingPostingService;
  // Bound kernel helpers (stay in the facade; passed bound so the moved
  // bodies stay byte-identical).
  scope: (auth: AuthContext) => TenantScope;
  tenantPredicate: (auth: AuthContext, alias?: string) => RawBuilder<boolean>;
}

@Injectable()
export class ReturnsReliefService {
  private readonly db: Kysely<Database>;
  private readonly accountingPosting: AccountingPostingService;
  private readonly scope: (auth: AuthContext) => TenantScope;
  private readonly tenantPredicate: (auth: AuthContext, alias?: string) => RawBuilder<boolean>;

  constructor(deps: ReturnsReliefDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.scope = deps.scope;
    this.tenantPredicate = deps.tenantPredicate;
  }

  /* INV-REST-RETURN-RELIEF-TRUTH (T10-D): the return dialog must show
   * the refund the backend will actually pay. The dialog cannot
   * compute relief itself — the ratio and the cumulative cap live in
   * computeSalesReturnRelief — so the preview runs the same pure
   * helpers createSaleReturn uses (buildSaleReturnLine,
   * calculateReturnDocumentTotal, computeSalesReturnRelief) over the
   * selected lines, read-only: no document, no stock move, no
   * journal, no treasury row. Relief exists only on sales; a
   * purchase preview fails closed instead of inventing a figure
   * through the relief path. */
  /* INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT: shared by the preview
   * and the create path so the dialog shows exactly what the create
   * will pay (T10-D). Loads nothing itself — it runs the pure engine
   * over rows the caller already holds. Legacy lines whose net /
   * allocated values were never stored get the same in-memory
   * allocation createSaleReturn backfills on disk, so the preview
   * and the create agree even on pre-allocation sales. */
  computeForfeitForReturn(args: {
    sale: {
      discount: number | string | null;
      total: number | string | null;
      tax_amount: number | string | null;
      prices_include_tax: boolean | null;
    };
    saleItems: Array<{
      id: number | string;
      qty: number | string | null;
      unit_price: number | string | null;
      line_total: number | string | null;
      line_discount?: number | string | null;
      net_line_total?: number | string | null;
      allocated_discount?: number | string | null;
      allocated_tax?: number | string | null;
    }>;
    returnedQtyByLine: Map<number, number>;
    returnedAmountByLine: Map<number, number>;
    items: ReturnInputItem[];
    moneyDigits: 2 | 3;
    requestedGoodsRefund?: number;
  }): ConditionalDiscountForfeitResult {
    const { sale, saleItems, moneyDigits } = args;
    const lines = saleItems.map((line) => ({
      saleItemId: Number(line.id),
      soldQty: Number(line.qty || 0),
      unitPrice: Number(line.unit_price || 0),
      lineTotal: Number(line.line_total || 0),
      lineDiscount: Number(line.line_discount || 0),
      allocatedDiscount: Number(line.allocated_discount || 0),
      allocatedTax: Number(line.allocated_tax || 0),
    }));
    if (lines.some((line, index) => saleItems[index].net_line_total == null)) {
      const allocations = allocateInvoiceDiscount({
        lines: lines.map((line) => ({ lineTotal: line.lineTotal, qty: line.soldQty })),
        invoiceDiscount: Number(sale.discount || 0),
        invoiceTax: Number(sale.tax_amount || 0),
        pricesIncludeTax: Boolean(sale.prices_include_tax),
        digits: moneyDigits,
      });
      for (let index = 0; index < lines.length; index += 1) {
        lines[index].allocatedDiscount = allocations[index].allocatedDiscount;
        lines[index].allocatedTax = allocations[index].allocatedTax;
      }
    }
    let priorGoodsRefunded = 0;
    for (const amount of args.returnedAmountByLine.values()) priorGoodsRefunded += Number(amount || 0);
    return computeConditionalDiscountForfeit({
      lines,
      returns: args.items.map((item) => ({
        saleItemId: Number(item.saleItemId || 0),
        qty: Number(item.qty || 0),
      })),
      priorReturnedQtyByLine: args.returnedQtyByLine,
      headerDiscount: Number(sale.discount || 0),
      invoiceTotal: Number(sale.total || 0),
      priorGoodsRefunded,
      pricesIncludeTax: Boolean(sale.prices_include_tax),
      requestedGoodsRefund: args.requestedGoodsRefund,
      digits: moneyDigits,
    });
  }

  /* INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT: original-mode goodwill.
   *  Raises the pro-rata goods total to the merchant's requested
   *  refund, splitting the extra across the returned lines pro-rata
   *  (same rounding as the forfeit engine) and scaling the tax share
   *  with the total. The requested refund must sit inside [computed,
   *  gross cap] or the call fails closed with the same codes the
   *  engine uses, so both modes validate identically. Returns the
   *  goodwill extra (0 when the request equals the computed total). */
  applyRaisedGoodsTotal(
    lines: Array<{ qty: number; unitTotal: number; lineTotal: number; allocatedTax: number }>,
    proRataTotal: number,
    requested: number,
    cap: number,
    moneyDigits: 2 | 3,
  ): number {
    if (!Number.isFinite(requested) || requested < 0) {
      throw new AppError('المبلغ المسترد المطلوب غير صالح', 'CONDITIONAL_DISCOUNT_FORFEIT_INVALID_INPUT', 400);
    }
    if (requested < proRataTotal - 0.000001) {
      throw new AppError('المبلغ المسترد المطلوب أقل من المبلغ المحسوب', 'GOODWILL_REFUND_BELOW_COMPUTED', 400);
    }
    if (requested > cap + 0.000001) {
      throw new AppError('المبلغ المسترد المطلوب يتجاوز سقف سعر القطع المرتجعة', 'GOODWILL_REFUND_ABOVE_CAP', 400);
    }
    const goodwill = roundBookMoney(requested - proRataTotal, moneyDigits);
    if (goodwill <= 0) return 0;
    const finalTotals = allocateProRata(
      lines.map((line) => line.lineTotal),
      requested,
      moneyDigits,
    );
    const existingTax = lines.reduce((sum, line) => sum + Number(line.allocatedTax || 0), 0);
    const totalTax = proRataTotal > 0 ? roundBookMoney(requested * (existingTax / proRataTotal), moneyDigits) : 0;
    const finalTaxes = allocateProRata(finalTotals, totalTax, moneyDigits);
    lines.forEach((line, index) => {
      line.lineTotal = finalTotals[index];
      line.allocatedTax = finalTaxes[index];
      line.unitTotal = line.qty > 0 ? roundBookMoney(finalTotals[index] / line.qty, moneyDigits) : 0;
    });
    return goodwill;
  }

  async previewReturnRelief(
    payload: CreateReturnDto,
    auth: AuthContext,
  ): Promise<{
    goodsTotal: number;
    originalGoodsTotal: number;
    tipRelief: number;
    courierRelief: number;
    totalRelief: number;
    refundTotal: number;
    forfeit?: ConditionalDiscountForfeitBreakdown;
  }> {
    if (payload.type !== 'sale')
      throw new AppError('معاينة الاسترداد متاحة لمرتجعات البيع فقط', 'RETURN_TYPE_INVALID', 400);
    const scope = this.scope(auth);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const items = normalizeReturnItems(payload);
    const sale = await this.db
      .selectFrom('sales')
      .selectAll()
      .where('id', '=', Number(payload.invoiceId))
      .where('status', '=', 'posted')
      .where(this.tenantPredicate(auth))
      .executeTakeFirst();
    if (!sale) throw new AppError('Invoice not found', 'INVOICE_NOT_FOUND', 404);
    const saleItems = await this.db
      .selectFrom('sale_items')
      .selectAll()
      .where('sale_id', '=', Number(payload.invoiceId))
      .where(this.tenantPredicate(auth))
      .orderBy('id', 'asc')
      .execute();
    const returnedRows = await this.db
      .selectFrom('return_items as ri')
      .innerJoin('return_documents as rd', (join) =>
        join.onRef('rd.id', '=', 'ri.return_document_id').onRef('rd.tenant_id', '=', 'ri.tenant_id'),
      )
      .select([
        'ri.product_id',
        'ri.sale_item_id',
        (eb) => eb.fn.coalesce(eb.fn.sum<number>('ri.qty'), sql<number>`0`).as('total_qty'),
        (eb) => eb.fn.coalesce(eb.fn.sum<number>('ri.line_total'), sql<number>`0`).as('total_amount'),
        (eb) => eb.fn.coalesce(eb.fn.sum<number>('ri.allocated_tax'), sql<number>`0`).as('total_tax'),
      ])
      .where('rd.return_type', '=', 'sale')
      .where('rd.invoice_id', '=', Number(payload.invoiceId))
      .where(this.tenantPredicate(auth, 'rd'))
      .where(this.tenantPredicate(auth, 'ri'))
      .groupBy(['ri.product_id', 'ri.sale_item_id'])
      .execute();
    const returnedQtyByLine = new Map<number, number>();
    const returnedAmountByLine = new Map<number, number>();
    const returnedTaxByLine = new Map<number, number>();
    for (const r of returnedRows) {
      if (!r.sale_item_id) continue;
      returnedQtyByLine.set(Number(r.sale_item_id), Number(r.total_qty || 0));
      returnedAmountByLine.set(Number(r.sale_item_id), Number(r.total_amount || 0));
      returnedTaxByLine.set(Number(r.sale_item_id), Number(r.total_tax || 0));
    }
    const normalizedLines: Array<{
      productId: number;
      productName: string;
      qty: number;
      unitTotal: number;
      lineTotal: number;
      allocatedTax: number;
      saleItemId?: number;
    }> = [];
    for (const requestItem of [...items].sort((a, b) => a.productId - b.productId)) {
      const matchingLines = saleItems.filter((entry) => Number(entry.product_id) === requestItem.productId);
      if (!requestItem.saleItemId && matchingLines.length > 1) {
        throw new AppError('حدد سطر الفاتورة الأصلي للصنف المتكرر', 'SALE_ITEM_ID_REQUIRED', 400);
      }
      const saleItem = requestItem.saleItemId
        ? matchingLines.find((entry) => Number(entry.id) === requestItem.saleItemId)
        : matchingLines[0];
      if (!saleItem) throw new AppError('Return item not found', 'NOT_FOUND', 404);
      const saleLineId = Number(saleItem.id);
      const product = await this.db
        .selectFrom('products')
        .select(['id', 'stock_qty'])
        .where('id', '=', requestItem.productId)
        .where(this.tenantPredicate(auth))
        .executeTakeFirst();
      if (!product) throw new AppError('Product not found', 'PRODUCT_NOT_FOUND', 404);
      normalizedLines.push({
        ...buildSaleReturnLine(
          saleItem,
          product,
          requestItem,
          {
            qty: returnedQtyByLine.get(saleLineId) || 0,
            amount: returnedAmountByLine.get(saleLineId) || 0,
            tax: returnedTaxByLine.get(saleLineId) || 0,
          },
          moneyDigits,
        ),
        saleItemId: saleLineId,
      });
    }
    const originalGoodsTotal = calculateReturnDocumentTotal(normalizedLines, moneyDigits);
    let goodsTotal = originalGoodsTotal;
    // INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT: the dialog shows BOTH
    // refund modes side by side, so the forfeit is always computed
    // for display when the sale carries a header discount — the
    // merchant chooses per return whether the discount was a bundle
    // deal (forfeit) or a general discount (original). The flag only
    // selects which mode prices this preview (and validates any
    // goodwill against it).
    let forfeit: ConditionalDiscountForfeitResult | null = null;
    if (Number(sale.discount || 0) > 0) {
      forfeit = this.computeForfeitForReturn({
        sale,
        saleItems,
        returnedQtyByLine,
        returnedAmountByLine,
        items,
        moneyDigits,
        requestedGoodsRefund: payload.forfeitHeaderDiscount ? payload.goodwillRefundAmount : undefined,
      });
    }
    if (payload.forfeitHeaderDiscount && forfeit?.applies) {
      const pricedByLine = new Map(forfeit.lines.map((entry) => [entry.saleItemId, entry]));
      for (const line of normalizedLines) {
        const priced = line.saleItemId == null ? undefined : pricedByLine.get(line.saleItemId);
        if (!priced)
          throw new AppError(
            'تعذر تسعير بند المرتجع بعد إلغاء خصم الفاتورة',
            'CONDITIONAL_DISCOUNT_FORFEIT_LINE_MISSING',
            500,
          );
        line.lineTotal = priced.lineTotal;
        line.allocatedTax = priced.allocatedTax;
        line.unitTotal = priced.unitTotal;
      }
      goodsTotal = calculateReturnDocumentTotal(normalizedLines, moneyDigits);
    } else if (payload.goodwillRefundAmount != null) {
      // Original mode: the goodwill extra rides on the pro-rata
      // lines, capped at the returned pieces' gross price — the
      // same cap as the forfeit mode.
      const cap = forfeit?.applies ? forfeit.goodwillCap : originalGoodsTotal;
      this.applyRaisedGoodsTotal(
        normalizedLines,
        originalGoodsTotal,
        Number(payload.goodwillRefundAmount),
        cap,
        moneyDigits,
      );
      goodsTotal = calculateReturnDocumentTotal(normalizedLines, moneyDigits);
    }
    const returnTaxAmount = normalizedLines.reduce((sum, line) => sum + Number(line.allocatedTax || 0), 0);
    const netReturnAmount = Math.max(0, goodsTotal - returnTaxAmount);
    const returnRelief = await this.accountingPosting.computeSalesReturnRelief(
      this.db,
      scope.tenantId,
      sale,
      goodsTotal,
      netReturnAmount,
      null,
    );
    const refundTotal = roundBookMoney(goodsTotal + returnRelief.totalRelief, moneyDigits);
    const forfeitBreakdown: ConditionalDiscountForfeitBreakdown | undefined = forfeit?.applies
      ? {
          applies: forfeit.applies,
          invoiceTotal: forfeit.invoiceTotal,
          priorGoodsRefunded: forfeit.priorGoodsRefunded,
          remainingNetAtOriginal: forfeit.remainingNetAtOriginal,
          computedGoodsRefund: forfeit.computedGoodsRefund,
          forfeitedHeaderDiscount: forfeit.forfeitedHeaderDiscount,
          repricedReturnedTotal: forfeit.repricedReturnedTotal,
          goodwillCap: forfeit.goodwillCap,
          goodwillAmount: forfeit.goodwillAmount,
        }
      : undefined;
    return {
      goodsTotal,
      originalGoodsTotal,
      tipRelief: returnRelief.tipRelief,
      courierRelief: returnRelief.courierRelief,
      totalRelief: returnRelief.totalRelief,
      refundTotal,
      forfeit: forfeitBreakdown,
    };
  }

  // INV-SPIRIT-LARGE-CASH-REFUND: the manager-approval threshold
  // for cash refunds, in tenant currency units. Coordinator-chosen
  // default 500, owner-set via the posLargeCashRefundThreshold
  // setting; 0 means every cash refund needs approval.
  async getLargeCashRefundThreshold(
    auth: AuthContext,
    executor: Kysely<Database> | Transaction<Database> = this.db,
  ): Promise<number> {
    const { tenantId } = requireTenantScope(auth);
    const row = await sql<{
      value?: string;
    }>`select value from settings where key = 'posLargeCashRefundThreshold' and tenant_id = ${tenantId}`.execute(
      executor,
    );
    const raw = String(row.rows?.[0]?.value || '').trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0) return parsed;
      } catch {
        /* fall through to the plain-number parse */
      }
      const plain = Number(raw);
      if (Number.isFinite(plain) && plain >= 0) return plain;
    }
    return 500;
  }

  // INV-RETURNS-MANAGER-PIN-BCRYPT (B1): the manager check is the one
  // shared authorizeManagerSecret — never a local duplicate. The old
  // body compared the typed PIN with `===` against the stored value,
  // but Settings stores the shared manager PIN as a bcrypt hash, so a
  // correct PIN could never match and every non-admin approval failed
  // 403 MANAGER_AUTH_INVALID. The shared helper verifies a bcrypt
  // hash, a legacy plaintext PIN (hashing it in place on first
  // success), or an active admin's login password. The returns error
  // contract is preserved: the helper's 400s are re-thrown as the
  // 403s this path has always returned, with the same codes and
  // messages, and the approval names are unchanged ('رمز المشرف' for
  // a PIN, the admin username for a password). Who needs approval and
  // the admin bypass are untouched — only the comparison moved.
  async verifyManagerAuthorization(trx: Kysely<Database>, secret: string, auth: AuthContext): Promise<string> {
    try {
      const result = await authorizeManagerSecret(trx, auth, secret);
      return result.mode === 'pin' ? 'رمز المشرف' : result.authorizedByName;
    } catch (error) {
      if (error instanceof AppError && error.code === 'MANAGER_AUTH_REQUIRED') {
        throw new AppError('أدخل رمز المشرف أو كلمة المرور لاعتماد المرتجع', 'MANAGER_AUTH_REQUIRED', 403);
      }
      if (error instanceof AppError && error.code === 'MANAGER_AUTH_INVALID') {
        throw new AppError('رمز المشرف أو كلمة المرور غير صحيحة', 'MANAGER_AUTH_INVALID', 403);
      }
      throw error;
    }
  }
}
