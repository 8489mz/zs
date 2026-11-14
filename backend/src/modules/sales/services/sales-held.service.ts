/*
 * Held sales (slice 4 of the sales-write split).
 * Pure move: saveHeldSale, deleteHeldSale, clearHeldSales, unchanged,
 * behind the SalesWriteService delegating facade. The facade owns the
 * stock/pricing helpers; this service receives them bound via
 * HeldSalesDeps, so the moved bodies are byte-identical to the originals.
 */
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { Kysely, sql, type Transaction } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { HeldSaleDto } from '../dto/held-sale.dto';
import { calculateAllowedSaleUnitPrice } from '../helpers/sales-write.helper';
import { SalesAuthorizationService } from './sales-authorization.service';
import { SalesQueryService } from './sales-query.service';

export type HeldSalesDeps = {
  db: Kysely<Database>;
  tx: TransactionHelper;
  audit: AuditService;
  authz: SalesAuthorizationService;
  query: SalesQueryService;
  assertDiscountChangeAllowed: (
    trx: Kysely<Database> | Transaction<Database>,
    auth: AuthContext,
    discount: number,
    managerPin?: string | null,
    subtotal?: number,
  ) => Promise<void>;
  assertUnitPriceChangeAllowed: (
    trx: Kysely<Database> | Transaction<Database>,
    auth: AuthContext,
    providedPrice: number,
    allowedPrice: number,
    productId: number,
    managerPin?: string,
    saleId?: number,
  ) => Promise<void>;
  getCurrentProductOffers: (
    trx: Kysely<Database> | Transaction<Database>,
    productId: number,
    tenantId: string,
  ) => Promise<any[]>;
};

export class HeldSalesService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly audit: AuditService;
  private readonly authz: SalesAuthorizationService;
  private readonly query: SalesQueryService;
  private readonly assertDiscountChangeAllowed: HeldSalesDeps['assertDiscountChangeAllowed'];
  private readonly assertUnitPriceChangeAllowed: HeldSalesDeps['assertUnitPriceChangeAllowed'];
  private readonly getCurrentProductOffers: HeldSalesDeps['getCurrentProductOffers'];

  constructor(deps: HeldSalesDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.audit = deps.audit;
    this.authz = deps.authz;
    this.query = deps.query;
    this.assertDiscountChangeAllowed = deps.assertDiscountChangeAllowed;
    this.assertUnitPriceChangeAllowed = deps.assertUnitPriceChangeAllowed;
    this.getCurrentProductOffers = deps.getCurrentProductOffers;
  }

async saveHeldSale(payload: HeldSaleDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const heldSaleId = await this.tx.runInTransaction(this.db, async (trx) => {
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const items = (Array.isArray(payload.items) ? payload.items : [])
        .map((item) => ({
          productId: Number(item.productId || 0),
          productName: String(item.name || '').trim(),
          qty: Number(item.qty || 0),
          unitPrice: Number(item.price || 0),
          unitName: String(item.unitName || 'قطعة').trim() || 'قطعة',
          unitMultiplier: Number(item.unitMultiplier || 1) || 1,
          priceType: (item.priceType === 'wholesale' ? 'wholesale' : 'retail') as 'retail' | 'wholesale',
          notes: String(item.notes || '').trim(),
          modifiers: item.modifiers || [],
          seatNumber: item.seatNumber ? Number(item.seatNumber) : undefined,
          course: item.course ? String(item.course).trim() : undefined,
          /* INV-REST-HOLD-RECALL-TRUTH (R5-B): the item fields the old
           * hold dropped. They ride in the modifiers JSON envelope. */
          lineKey: item.lineKey ? String(item.lineKey) : undefined,
          unitId: item.unitId ? String(item.unitId) : undefined,
          serials: Array.isArray(item.serials) ? item.serials.map((entry) => String(entry)) : undefined,
          originalPrice: item.originalPrice != null ? Number(item.originalPrice) : undefined,
          offerDiscount: item.offerDiscount != null ? Number(item.offerDiscount) : undefined,
          /* INV-POS-LINE-DISCOUNT: the per-line discount rides the same
           * R5-B envelope as offerDiscount — a held line keeps its own
           * discount, so recall + submit posts the price the cashier
           * agreed instead of silently re-adding it. */
          lineDiscount: item.lineDiscount != null ? Number(item.lineDiscount) : undefined,
          offerName: item.offerName ? String(item.offerName) : undefined,
          isWeighted: item.isWeighted != null ? Boolean(item.isWeighted) : undefined,
          quantityChunks: Array.isArray(item.quantityChunks) ? item.quantityChunks.map((entry) => Number(entry)) : undefined,
        }))
        .filter((entry) => entry.productId > 0 && entry.qty > 0);

      if (!items.length) throw new AppError('Held draft must include at least one item', 'HELD_DRAFT_ITEMS_REQUIRED', 400);
      /* INV-POS-LINE-DISCOUNT: the hold gate counts line discounts
       * exactly like createSale does — holding a discounted draft is
       * granting the discount, not deferring it. */
      const heldLineDiscountTotal = roundMoney(items.reduce((sum, item) => sum + Number((item as { lineDiscount?: number }).lineDiscount || 0), 0), moneyDigits);
      await this.assertDiscountChangeAllowed(trx, auth, roundMoney(Number(payload.discount || 0) + heldLineDiscountTotal, moneyDigits), payload.managerPin);

      for (const item of items) {
        let finalProductName = item.productName;
        const product = await trx.selectFrom('products as p')
          .leftJoin('manufacturing_boms as b', (join) => join.onRef('b.product_id', '=', 'p.id').on('b.is_active', '=', true))
          .select(['p.id', 'p.retail_price', 'p.wholesale_price', 'b.id as bom_id'])
          .where('p.id', '=', item.productId)
          .where(sql<boolean>`p.tenant_id = ${scope.tenantId}`)
          .where('p.is_active', '=', true)
          .executeTakeFirst();
        
        if (!product) throw new AppError(`Product #${item.productId} not found`, 'PRODUCT_NOT_FOUND', 404);

        if (product.bom_id) {
          const bomLines = await trx.selectFrom('manufacturing_bom_lines as l')
            .innerJoin('products as p', 'p.id', 'l.component_product_id')
            .select('p.name')
            .where('l.bom_id', '=', Number(product.bom_id))
            .execute();
          
          if (bomLines.length > 0) {
            finalProductName = `${item.productName} (${bomLines.map(l => l.name).join(' + ')})`;
          }
        }
        item.productName = finalProductName;

        const activeOffers = await this.getCurrentProductOffers(trx, item.productId, scope.tenantId);
        const allowedUnitPrice = calculateAllowedSaleUnitPrice({
          retailPrice: product.retail_price,
          wholesalePrice: product.wholesale_price,
          priceType: item.priceType,
          offers: activeOffers,
          qty: item.qty,
          moneyDigits,
        });
        await this.assertUnitPriceChangeAllowed(trx, auth, item.unitPrice, allowedUnitPrice, item.productId, payload.managerPin);
      }

      type SalePaymentChannel = 'cash' | 'card' | 'wallet' | 'instapay' | 'mixed' | 'credit';
      const rawRequestedChannel = String(payload.paymentChannel || '').trim();
      const requestedChannel: SalePaymentChannel | '' = (['cash', 'card', 'wallet', 'instapay', 'mixed', 'credit'] as const)
        .includes(rawRequestedChannel as SalePaymentChannel)
        ? (rawRequestedChannel as SalePaymentChannel)
        : '';
      const paymentType = payload.paymentType === 'credit' ? 'credit' : 'cash';
      const cashAmount = paymentType === 'credit' ? 0 : Math.max(0, Number(payload.cashAmount || 0));
      const cardAmount = paymentType === 'credit' ? 0 : Math.max(0, Number(payload.cardAmount || 0));
      const transferAmount = paymentType === 'credit' ? 0 : Math.max(0, Number(payload.transferAmount || 0));
      const paidAmount = paymentType === 'credit'
        ? 0
        : roundMoney(cashAmount + cardAmount + transferAmount, moneyDigits);

      const paymentChannel: 'cash' | 'card' | 'wallet' | 'instapay' | 'mixed' | 'credit' = paymentType === 'credit'
        ? 'credit'
        : (() => {
          if (requestedChannel === 'wallet' || requestedChannel === 'instapay') return requestedChannel;
          const hasCash = cashAmount > 0.0001;
          const hasCard = cardAmount > 0.0001;
          const hasTransfer = transferAmount > 0.0001;

          if ((hasCash && hasCard) || (hasCash && hasTransfer) || (hasCard && hasTransfer)) return 'mixed';
          if (hasCard) return 'card';
          if (hasTransfer) return 'wallet';
          if (requestedChannel === 'card') return 'card';
          return 'cash';
        })();

      const heldTableNumber = String(payload.tableNumber || '').trim();
      // INV-REST-PAID-GATES-2 (R4-D, I42): one open held draft per
      // table. A held row IS the open draft (recall/complete deletes
      // it), so an existing row for the same tenant + table blocks a
      // second hold. The branch is matched when the payload names
      // one; without a branch any open draft on that table blocks.
      if (heldTableNumber) {
        let occupantQuery = trx
          .selectFrom('held_sales')
          .select('id')
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .where('table_number', '=', heldTableNumber);
        if (payload.branchId) {
          occupantQuery = occupantQuery.where('branch_id', '=', Number(payload.branchId));
        }
        const occupant = await occupantQuery.executeTakeFirst();
        if (occupant) {
          throw new AppError(`الطاولة ${heldTableNumber} مشغولة بالفعل بطلب محفوظ.`, 'HELD_DRAFT_TABLE_OCCUPIED', 409);
        }
      }

      const heldInsert = await trx
        .insertInto('held_sales')
        .values({
          customer_id: payload.customerId ? Number(payload.customerId) : null,
          payment_type: paymentType,
          payment_channel: paymentChannel,
          paid_amount: paidAmount,
          cash_amount: cashAmount,
          card_amount: cardAmount,
          discount: Number(payload.discount || 0),
          delivery_fee: Number(payload.deliveryFee || 0),
          note: String(payload.note || '').trim(),
          search: String(payload.search || '').trim(),
          table_number: String(payload.tableNumber || '').trim(),
          order_type: String(payload.orderType || 'takeaway').trim(),
          price_type: payload.priceType === 'wholesale' ? 'wholesale' : 'retail',
          branch_id: payload.branchId ? Number(payload.branchId) : null,
          location_id: payload.locationId ? Number(payload.locationId) : null,
          delivery_rep_id: (payload as any).deliveryRepId ? Number((payload as any).deliveryRepId) : null,
          /* INV-REST-HOLD-RECALL-TRUTH (R5-B): persist the stated
           * collection status whenever the hold names one — the old code
           * stored it only when a rep was set, so a prepaid_online order
           * with no rep yet came back as COD. */
          collection_status: (payload as any).collectionStatus ? String((payload as any).collectionStatus) : null,
          /* INV-REST-HOLD-RECALL-TRUTH (R5-B, 0310 columns): the header
           * fields the old hold dropped. */
          tip_amount: Number(payload.tipAmount || 0),
          loyalty_points_redeemed: Number(payload.loyaltyPointsRedeemed || 0),
          pager_number: payload.pagerNumber ? String(payload.pagerNumber).trim() : null,
          delivery_fee_mode: payload.deliveryFeeMode ? String(payload.deliveryFeeMode) : null,
          online_order_id: payload.onlineOrderId ? Number(payload.onlineOrderId) : null,
          dining_course: payload.diningCourse ? String(payload.diningCourse).trim() : null,
          guest_count: payload.guestCount != null ? Number(payload.guestCount) : null,
          guest_check_printed_at: payload.guestCheckPrintedAt ? String(payload.guestCheckPrintedAt) : null,
          created_by: auth.userId,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      const id = Number(heldInsert.id);
      for (const item of items) {
        const itemModifiers = item.modifiers || [];
        /* INV-REST-HOLD-RECALL-TRUTH (R5-B): the held line fields ride in
         * the existing modifiers JSON envelope (the seat/course precedent
         * below) — no second migration. isWeighted:false and
         * offerDiscount:0 are real values, so presence is tested with
         * != null / length, never truthiness. */
        const heldMeta: Record<string, unknown> = {
          ...(item.lineKey ? { lineKey: item.lineKey } : {}),
          ...(item.unitId ? { unitId: item.unitId } : {}),
          ...(Array.isArray(item.serials) && item.serials.length ? { serials: item.serials } : {}),
          ...(item.originalPrice != null ? { originalPrice: item.originalPrice } : {}),
          ...(item.offerDiscount != null ? { offerDiscount: item.offerDiscount } : {}),
          ...(item.lineDiscount != null ? { lineDiscount: item.lineDiscount } : {}),
          ...(item.offerName ? { offerName: item.offerName } : {}),
          ...(item.isWeighted != null ? { isWeighted: item.isWeighted } : {}),
          ...(Array.isArray(item.quantityChunks) && item.quantityChunks.length ? { quantityChunks: item.quantityChunks } : {}),
        };
        const hasHeldMeta = Object.keys(heldMeta).length > 0;
        const hasExtraMeta = item.seatNumber != null || Boolean(item.course) || hasHeldMeta;
        const finalModifiers = hasExtraMeta
          ? {
              mods: Array.isArray(itemModifiers) ? itemModifiers : [],
              ...(item.seatNumber != null ? { seatNumber: item.seatNumber } : {}),
              ...(item.course ? { course: item.course } : {}),
              ...(hasHeldMeta ? { held: heldMeta } : {}),
            }
          : itemModifiers;

        await trx
          .insertInto('held_sale_items')
          .values({
            held_sale_id: id,
            product_id: item.productId,
            product_name: item.productName,
            qty: item.qty,
            unit_price: item.unitPrice,
            unit_name: item.unitName,
            unit_multiplier: item.unitMultiplier,
            price_type: item.priceType as 'retail' | 'wholesale',
            notes: item.notes || '',
            modifiers: JSON.stringify(finalModifiers),
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          } as any)
          .execute();
      }

      return id;
    });

    await this.audit.log('حفظ فاتورة معلقة', `تم حفظ فاتورة معلقة #${heldSaleId} بواسطة ${auth.username}`, auth);
    return { ok: true, heldSales: (await this.query.listHeldSales(auth)).heldSales };
  }

async deleteHeldSale(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const heldSale = await this.db
      .selectFrom('held_sales')
      .select(['id', 'created_by'])
      .where('id', '=', id)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
    if (!heldSale || !this.authz.canAccessHeldSale(auth, heldSale)) {
      throw new AppError('Held sale not found', 'HELD_SALE_NOT_FOUND', 404);
    }

    await this.db.deleteFrom('held_sales').where('id', '=', id).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
    await this.audit.log('حذف فاتورة معلقة', `تم حذف فاتورة معلقة #${id} بواسطة ${auth.username}`, auth);
    return { ok: true, heldSales: (await this.query.listHeldSales(auth)).heldSales };
  }

async clearHeldSales(auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const canManageHeldSales = this.authz.canManageHeldSales(auth);
    const ownerUserId = this.authz.heldSaleOwnerUserId(auth);
    const result = await this.db
      .deleteFrom('held_sales')
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .$if(!canManageHeldSales, (qb) => qb.where('created_by', '=', ownerUserId ?? -1))
      .execute();
    const deletedCount = Number(result?.[0]?.numDeletedRows ?? NaN);
    const scopeLabel = canManageHeldSales ? 'privileged broader management' : 'own held sales';
    const countLabel = Number.isFinite(deletedCount) ? ` | deletedCount=${deletedCount}` : '';
    await this.audit.log('حذف كل الفواتير المعلقة', `تم حذف كل الفواتير المعلقة بواسطة ${auth.username} | scope=${scopeLabel}${countLabel}`, auth);
    return { ok: true, heldSales: (await this.query.listHeldSales(auth)).heldSales };
  }
}
