/**
 * CreateSaleService — SPLIT 5 of sales-write.service.ts (facade was 4,962
 * lines at the prep base, 2,442 after slices 1-3). Pure move: createSale
 * (~1,578 lines) decomposed into six phases that run inside the SAME
 * transaction, in the SAME order, with the SAME semantics. No behaviour
 * change: no reordering, no changed queries, no changed error paths, no
 * changed rounding.
 *
 * The phases share one CreateSaleContext object (carried through the trx).
 * Each phase destructures what it reads at the top and writes back what it
 * created or reassigned at the bottom; the declaration lines stay verbatim
 * inside the phase body, so every phase body is byte-identical to its
 * original span in the facade except for the added header/footer lines.
 * Phase bodies keep their original 6-space indentation (they ran inside the
 * trx callback); the header/footer lines are written at method-body level.
 * No instance state is kept: the service is a singleton and concurrent
 * sales must never clobber each other.
 *
 * The orchestrator's pre-transaction and post-transaction parts are moved
 * verbatim too; the only change is the final `return id;` of the trx
 * callback, which becomes `return ctx.id;` in the orchestrator.
 */

import { AppError } from '../../../common/errors/app-error';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { ensureUniqueFlowItems } from '../../../common/utils/financial-integrity';
import { normalizeSalePayload } from '../helpers/sales-payload.helper';
import { type SalesOrderConversionRelease, type UpsertSaleDto } from '../dto/upsert-sale.dto';
import { idempotencyStorage } from '../../../core/idempotency/idempotency.context';
import type { SystemApprovedSaleTerms } from './sales-write.service';
import type { CreateSaleDeps, CreateSaleContext } from './create-sale/create-sale-types';
export type { CreateSaleDeps, CreateSaleContext } from './create-sale/create-sale-types';
import { LoadSaleContextService } from './create-sale/load-sale-context';
import { PrepareSaleItemsService } from './create-sale/prepare-sale-items';
import { ComputeTotalsAndGatesService } from './create-sale/compute-totals-and-gates';
import { AllocateTendersAndDeliveryService } from './create-sale/allocate-tenders-and-delivery';
import { InsertSaleAndStockService } from './create-sale/insert-sale-and-stock';
import { FinalizeSaleService } from './create-sale/finalize-sale';
import { resolvePosTripAttribution, type PosTripAttribution } from './create-sale/resolve-pos-trip-attribution';
import { assertPosRepRouteForSale } from './create-sale/assert-pos-rep-route';

export class CreateSaleService {
  private readonly db: CreateSaleDeps['db'];
  private readonly tx: CreateSaleDeps['tx'];
  private readonly audit: CreateSaleDeps['audit'];
  private readonly authz: CreateSaleDeps['authz'];
  private readonly finance: CreateSaleDeps['finance'];
  private readonly query: CreateSaleDeps['query'];
  private readonly accountingPosting: CreateSaleDeps['accountingPosting'];
  private readonly idempotency: CreateSaleDeps['idempotency'];
  private readonly planFeatureService: CreateSaleDeps['planFeatureService'];
  private readonly returnsService: CreateSaleDeps['returnsService'];
  private readonly whatsappService: CreateSaleDeps['whatsappService'];
  private readonly logger: CreateSaleDeps['logger'];
  private readonly transferKdsTicketStateInTrx: CreateSaleDeps['transferKdsTicketStateInTrx'];
  private readonly loadFlatAddonCosts: CreateSaleDeps['loadFlatAddonCosts'];
  private readonly resolveSaleModifierCosts: CreateSaleDeps['resolveSaleModifierCosts'];
  private readonly enforceRestaurantModifierContract: CreateSaleDeps['enforceRestaurantModifierContract'];
  private readonly claimSaleSerials: CreateSaleDeps['claimSaleSerials'];
  private readonly lockSaleStockRows: CreateSaleDeps['lockSaleStockRows'];
  private readonly lockProductRow: CreateSaleDeps['lockProductRow'];
  private readonly buildInsufficientStockError: CreateSaleDeps['buildInsufficientStockError'];
  private readonly shouldLogCheckoutTimings: CreateSaleDeps['shouldLogCheckoutTimings'];
  private readonly assertDiscountChangeAllowed: CreateSaleDeps['assertDiscountChangeAllowed'];
  private readonly assertUnitPriceChangeAllowed: CreateSaleDeps['assertUnitPriceChangeAllowed'];
  private readonly getCurrentProductOffers: CreateSaleDeps['getCurrentProductOffers'];
  private readonly getAllowNegativeStockSales: CreateSaleDeps['getAllowNegativeStockSales'];
  private readonly getTenantSettingsMap: CreateSaleDeps['getTenantSettingsMap'];
  private readonly autoProduceShortfall: CreateSaleDeps['autoProduceShortfall'];
  private readonly recordImportLotShortfalls: CreateSaleDeps['recordImportLotShortfalls'];
  private readonly deductPharmacyBatchesFefo: CreateSaleDeps['deductPharmacyBatchesFefo'];
  private readonly deductInventoryBatchesFefo: CreateSaleDeps['deductInventoryBatchesFefo'];
  private readonly resolveOnlineOrderTerms: CreateSaleDeps['resolveOnlineOrderTerms'];
  private readonly refreshClosedShiftsForBackdatedOfflineSale: CreateSaleDeps['refreshClosedShiftsForBackdatedOfflineSale'];
  private readonly generateSaleDocNo: CreateSaleDeps['generateSaleDocNo'];
  private readonly loadSaleContextService: LoadSaleContextService;
  private readonly prepareSaleItemsService: PrepareSaleItemsService;
  private readonly computeTotalsAndGatesService: ComputeTotalsAndGatesService;
  private readonly allocateTendersAndDeliveryService: AllocateTendersAndDeliveryService;
  private readonly insertSaleAndStockService: InsertSaleAndStockService;
  private readonly finalizeSaleService: FinalizeSaleService;

  constructor(deps: CreateSaleDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.audit = deps.audit;
    this.authz = deps.authz;
    this.finance = deps.finance;
    this.query = deps.query;
    this.accountingPosting = deps.accountingPosting;
    this.idempotency = deps.idempotency;
    this.planFeatureService = deps.planFeatureService;
    this.returnsService = deps.returnsService;
    this.whatsappService = deps.whatsappService;
    this.logger = deps.logger;
    this.transferKdsTicketStateInTrx = deps.transferKdsTicketStateInTrx;
    this.loadFlatAddonCosts = deps.loadFlatAddonCosts;
    this.resolveSaleModifierCosts = deps.resolveSaleModifierCosts;
    this.enforceRestaurantModifierContract = deps.enforceRestaurantModifierContract;
    this.claimSaleSerials = deps.claimSaleSerials;
    this.lockSaleStockRows = deps.lockSaleStockRows;
    this.lockProductRow = deps.lockProductRow;
    this.buildInsufficientStockError = deps.buildInsufficientStockError;
    this.shouldLogCheckoutTimings = deps.shouldLogCheckoutTimings;
    this.assertDiscountChangeAllowed = deps.assertDiscountChangeAllowed;
    this.assertUnitPriceChangeAllowed = deps.assertUnitPriceChangeAllowed;
    this.getCurrentProductOffers = deps.getCurrentProductOffers;
    this.getAllowNegativeStockSales = deps.getAllowNegativeStockSales;
    this.getTenantSettingsMap = deps.getTenantSettingsMap;
    this.autoProduceShortfall = deps.autoProduceShortfall;
    this.recordImportLotShortfalls = deps.recordImportLotShortfalls;
    this.deductPharmacyBatchesFefo = deps.deductPharmacyBatchesFefo;
    this.deductInventoryBatchesFefo = deps.deductInventoryBatchesFefo;
    this.resolveOnlineOrderTerms = deps.resolveOnlineOrderTerms;
    this.refreshClosedShiftsForBackdatedOfflineSale = deps.refreshClosedShiftsForBackdatedOfflineSale;
    this.generateSaleDocNo = deps.generateSaleDocNo;
    this.loadSaleContextService = new LoadSaleContextService(
      this.lockSaleStockRows,
      this.planFeatureService,
      this.returnsService,
      this.getAllowNegativeStockSales,
      this.enforceRestaurantModifierContract,
    );
    this.prepareSaleItemsService = new PrepareSaleItemsService(
      this.assertUnitPriceChangeAllowed,
      this.buildInsufficientStockError,
    );
    this.computeTotalsAndGatesService = new ComputeTotalsAndGatesService(
      this.getTenantSettingsMap,
      this.assertDiscountChangeAllowed,
      this.authz,
      this.returnsService,
    );
    this.allocateTendersAndDeliveryService = new AllocateTendersAndDeliveryService(this.authz);
    this.insertSaleAndStockService = new InsertSaleAndStockService(
      this.generateSaleDocNo,
      this.lockSaleStockRows,
      this.autoProduceShortfall,
      this.resolveSaleModifierCosts,
      this.planFeatureService,
      this.loadFlatAddonCosts,
      this.claimSaleSerials,
      this.lockProductRow,
      this.buildInsufficientStockError,
      this.deductPharmacyBatchesFefo,
      this.deductInventoryBatchesFefo,
      this.recordImportLotShortfalls,
    );
    this.finalizeSaleService = new FinalizeSaleService(
      this.finance,
      this.accountingPosting,
      this.idempotency,
      this.transferKdsTicketStateInTrx,
      this.refreshClosedShiftsForBackdatedOfflineSale,
    );
  }

  /**
   * Create a sale. The transaction runs the six phases in order; see the
   * phase docs for what each one does. The pre- and post-transaction
   * parts are moved verbatim from the facade.
   */
  async createSale(
    payload: UpsertSaleDto,
    auth: AuthContext,
    approvedTerms?: SystemApprovedSaleTerms,
    conversionRelease?: SalesOrderConversionRelease,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const requestStartedAt = Date.now();

    // Idempotency: check for a previously committed result for this key
    const idemCtx = idempotencyStorage.getStore();
    if (payload.offlineDocNo && !idemCtx?.idempotencyKey) {
      throw new AppError('فاتورة الأوفلاين تتطلب مفتاح منع تكرار ثابتاً', 'OFFLINE_IDEMPOTENCY_REQUIRED', 400);
    }
    if (idemCtx?.idempotencyKey) {
      const cached = await this.idempotency.check(idemCtx.idempotencyKey, scope);
      if (cached) {
        if (cached.response?.sale) return cached.response as Record<string, unknown>;
        if (cached.response?.saleId) {
          const sale = await this.query.getSaleById(Number(cached.response.saleId), auth);
          return { ok: true, sale: sale.sale };
        }
        return cached.response as Record<string, unknown>;
      }
    }

    // O62: a cart loaded from a storefront order carries that order's id. The terms the server fixed
    // at checkout are read here from the order row itself — never from the request — and added to any
    // terms an internal caller already passed (convertToSale).
    const effectiveTerms = payload.onlineOrderId
      ? await this.resolveOnlineOrderTerms(Number(payload.onlineOrderId), scope.tenantId, approvedTerms)
      : approvedTerms;

    const returnedItems = (payload.items || []).filter((item) => Number(item.qty) < 0);
    const isExchange = Boolean(payload.exchangeSaleId);
    if (returnedItems.length && !isExchange)
      throw new AppError('السطور السالبة تتطلب فاتورة أصلية للاستبدال', 'EXCHANGE_SOURCE_REQUIRED', 400);
    if (
      isExchange &&
      (!returnedItems.length ||
        payload.source !== 'pos' ||
        payload.onlineOrderId ||
        payload.offlineDocNo ||
        payload.paymentType === 'credit' ||
        payload.paymentChannel === 'credit' ||
        payload.orderType === 'delivery' ||
        Number(payload.deliveryFee || 0) !== 0 ||
        Number(payload.storeCreditUsed || 0) > 0 ||
        Number(payload.loyaltyPointsRedeemed || 0) > 0 ||
        returnedItems.some(
          (item) => !Number.isInteger(item.originalSaleItemId) || Number(item.originalSaleItemId) <= 0,
        ))
    ) {
      throw new AppError(
        'الاستبدال يتطلب سطور مرتجع مرتبطة بالأصل دون طلب متجر أو خصم نقاط إضافي',
        'EXCHANGE_REQUEST_INVALID',
        400,
      );
    }
    const normalized = normalizeSalePayload(
      isExchange ? { ...payload, items: payload.items.filter((item) => Number(item.qty) >= 0) } : payload,
    );
    if (!normalized.items.length) throw new AppError('Sale must include at least one item', 'SALE_ITEMS_REQUIRED', 400);
    ensureUniqueFlowItems(
      normalized.items,
      'SALE_DUPLICATE_PRODUCT',
      'Sale must not contain duplicate product rows with the same unit and price',
    );

    // F7 (POS-to-trip attribution): resolve the acting rep + active
    // trip BEFORE the transaction opens. A lookup that fails inside
    // the transaction would abort the whole sale (25P02), and the
    // portal hoists such reads for exactly that reason — so any
    // failure here leaves the sale unattributed instead of unposted.
    // For a delivery the explicit payload rep wins (Phase 4 still
    // validates that the rep exists); for a counter sale the acting
    // user's linked rep row is resolved.
    let vanTripAttribution: PosTripAttribution | null = null;
    try {
      vanTripAttribution = await resolvePosTripAttribution(this.db, {
        tenantId: scope.tenantId,
        auth,
        explicitRepId:
          String(normalized.orderType || '').trim() === 'delivery'
            ? Number((payload as any).deliveryRepId || 0) || null
            : null,
      });
    } catch {
      vanTripAttribution = null;
    }

    // F3 (trial problem 3): the route gate for a rep sale. The
    // attribution above resolved the seller's rep + active trip; a
    // rep sale to a customer served by a DIFFERENT rep is refused
    // here, BEFORE the transaction opens, so a refusal writes
    // nothing. A customer with no history anywhere posts (the first
    // sale creates the association) and the rep's own served customer
    // posts; a supervisor PIN (managerPin, the existing override
    // path) approves a genuine off-route sale. Ordinary retail
    // counter sales — no attribution, or no customer on the invoice —
    // never reach the gate.
    if (vanTripAttribution && Number(normalized.customerId) > 0) {
      await assertPosRepRouteForSale(this.db, {
        tenantId: scope.tenantId,
        repId: vanTripAttribution.repId,
        customerId: Number(normalized.customerId),
        managerPin: normalized.managerPin,
        auth,
        authz: this.authz,
      });
    }

    const txStartedAt = Date.now();
    const saleId = await this.tx.runInTransaction(this.db, async (trx) => {
      const ctx = {
        trx,
        scope,
        payload,
        normalized,
        auth,
        approvedTerms,
        conversionRelease,
        idemCtx,
        effectiveTerms,
        returnedItems,
        isExchange,
        vanTripAttribution,
      } as CreateSaleContext;
      await this.loadSaleContext(ctx);
      await this.prepareSaleItems(ctx);
      await this.computeTotalsAndGates(ctx);
      await this.allocateTendersAndDelivery(ctx);
      await this.insertSaleAndStock(ctx);
      await this.finalizeSale(ctx);
      return ctx.id;
    });
    const transactionDurationMs = Date.now() - txStartedAt;

    const postReadsStartedAt = Date.now();
    await this.audit.log('إنشاء فاتورة بيع', `تم إنشاء الفاتورة S-${saleId} بواسطة ${auth.username}`, auth);

    // Non-blocking auto WhatsApp invoice notification
    if (this.whatsappService) {
      void this.whatsappService.sendInvoiceNotification(saleId, auth, { autoOnly: true }).catch((err) => {
        this.logger.warn(`WhatsApp auto-invoice notification failed for sale ${saleId}: ${err?.message || err}`);
      });
    }

    const sale = await this.query.getSaleById(saleId, auth);
    const postTransactionReadsDurationMs = Date.now() - postReadsStartedAt;
    const totalRequestDurationMs = Date.now() - requestStartedAt;

    if (this.shouldLogCheckoutTimings()) {
      this.logger.log(
        `[checkout-timing] saleId=${saleId} items=${normalized.items.length} txMs=${transactionDurationMs} postReadsMs=${postTransactionReadsDurationMs} totalMs=${totalRequestDurationMs}`,
      );
    }

    return { ok: true, sale: sale.sale };
  }

  private async loadSaleContext(ctx: CreateSaleContext): Promise<void> {
    return this.loadSaleContextService.loadSaleContext(ctx);
  }

  private async prepareSaleItems(ctx: CreateSaleContext): Promise<void> {
    return this.prepareSaleItemsService.prepareSaleItems(ctx);
  }

  private async computeTotalsAndGates(ctx: CreateSaleContext): Promise<void> {
    return this.computeTotalsAndGatesService.computeTotalsAndGates(ctx);
  }

  private async allocateTendersAndDelivery(ctx: CreateSaleContext): Promise<void> {
    return this.allocateTendersAndDeliveryService.allocateTendersAndDelivery(ctx);
  }

  private async insertSaleAndStock(ctx: CreateSaleContext): Promise<void> {
    return this.insertSaleAndStockService.insertSaleAndStock(ctx);
  }

  private async finalizeSale(ctx: CreateSaleContext): Promise<void> {
    return this.finalizeSaleService.finalizeSale(ctx);
  }
}
