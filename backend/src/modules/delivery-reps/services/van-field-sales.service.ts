import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuditService, AUDIT_EVENT_CODES } from '../../../core/audit/audit.service';
import { AppError } from '../../../common/errors/app-error';
import { Database } from '../../../database/database.types';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { assertBusinessAccountingDate } from '../../accounting/accounting-boundaries';
import { evaluateCreditLimitCheck, evaluateFieldCardPayment } from '../van-trip-reconciliation.engine';
import { normalizeCustomerCode, resolveVanMoneyAuditActor } from './van-common.util';
import {
  extractCoordinatesFromCustomerLocation,
  evaluateGeofenceCompliance,
  isValidCoordinatePair,
  extractAssignedRepIds,
  loadRepPermissions,
} from '../rep-target.engine';
import { VanFraudRadarService } from './van-fraud-radar.service';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { isOfferActive, pickBestApplicableOffer, todayLocalIsoDate } from '../../sales/helpers/sales-write.helper';
import { resolveSaleTaxRate } from '../../sales/engines/sale-tax-rate.engine';
import { computeInvoiceTotals } from '../../../common/utils/invoice-totals';

export interface VanFieldSalesDeps {
  db: Kysely<Database>;
  audit: AuditService;
  accountingPosting: AccountingPostingService;
  vanFraudRadarService: VanFraudRadarService;
  // Bound facade methods (same names as the facade members, so the moved
  // bodies are byte-identical). verifySupervisorPin belongs to slice 1's
  // range; it is bound here exactly as sales-write S3 binds S1/S2 methods —
  // the binding resolves whether the callee is still a real method or
  // already an S1 delegate at merge.
  deductVanSalePharmacyBatches: (...args: any[]) => any;
  generateDailySequenceNumber: (...args: any[]) => any;
  moveVanStock: (...args: any[]) => any;
  resolveSystemAuthContext: (...args: any[]) => any;
  sortItemsByProductId: <T extends { productId: number }>(items: T[]) => T[];
  verifySupervisorPin: (...args: any[]) => any;
}

@Injectable()
export class VanFieldSalesService {
  private readonly db: Kysely<Database>;
  private readonly audit: AuditService;
  private readonly accountingPosting: AccountingPostingService;
  private readonly vanFraudRadarService: VanFraudRadarService;
  private readonly deductVanSalePharmacyBatches: (...args: any[]) => any;
  private readonly generateDailySequenceNumber: (...args: any[]) => any;
  private readonly moveVanStock: (...args: any[]) => any;
  private readonly resolveSystemAuthContext: (...args: any[]) => any;
  private readonly sortItemsByProductId: <T extends { productId: number }>(items: T[]) => T[];
  private readonly verifySupervisorPin: (...args: any[]) => any;

  constructor(deps: VanFieldSalesDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.accountingPosting = deps.accountingPosting;
    this.vanFraudRadarService = deps.vanFraudRadarService;
    this.deductVanSalePharmacyBatches = deps.deductVanSalePharmacyBatches;
    this.generateDailySequenceNumber = deps.generateDailySequenceNumber;
    this.moveVanStock = deps.moveVanStock;
    this.resolveSystemAuthContext = deps.resolveSystemAuthContext;
    this.sortItemsByProductId = deps.sortItemsByProductId;
    this.verifySupervisorPin = deps.verifySupervisorPin;
  }

  private get anyDb(): any {
    return this.db as any;
  }

  async executeFieldSaleInternal(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      customerId?: number;
      customerName?: string;
      customerPhone?: string;
      paymentMethod: 'cash' | 'credit' | 'card' | 'split' | 'instapay' | 'vodafone_cash';
      paidAmount?: number;
      transferReference?: string;
      transferReceiptUrl?: string;
      recipientName?: string;
      recipientPhone?: string;
      recipientRole?: string;
      recipientSignature?: string;
      items: {
        productId: number;
        qty: number;
        unitPrice?: number;
        unitName?: string;
        unitMultiplier?: number;
        isBonus?: boolean;
        bonusReason?: string;
        originalPrice?: number;
      }[];
      notes?: string;
      deliveryGpsLat?: number;
      deliveryGpsLng?: number;
      deliveryProofPhoto?: string;
      packagingBreakdown?: { cartonsCount?: number; piecesCount?: number; itemsCount?: number };
      clientTxId?: string;
      supervisorOverridePin?: string;
      supervisorOverrideReason?: string;
      cashDiscountAmount?: number;
    },
  ) {

    const trip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .leftJoin('stock_locations as van', 'van.id', 'vt.van_location_id')
      .select(['vt.id', 'vt.van_location_id', 'vt.status', 'van.branch_id as vanBranchId'])
      .where('vt.id', '=', payload.tripId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.rep_id', '=', repId)
      .executeTakeFirst();

    if (!trip || trip.status !== 'open') {
      throw new AppError('رحلة التوزيع المحددة مغلقة أو غير صالحة', 'INVALID_TRIP', 400);
    }

    let vanLocId = Number(trip.van_location_id);
    let branchId = trip.vanBranchId ? Number(trip.vanBranchId) : null;

    let resolvedCustomerId: number | null = payload.customerId ? Number(payload.customerId) : null;
    let customerName = payload.customerName || 'عميل نقدي ميداني';
    // INV-VAN-FIELD-SALE-WHOLESALE-PRICE: the customer's type drives
    // the price branch below, so it is loaded BEFORE the item loop
    // (the in-transaction customer read is after the loop — too late).
    let customerType: string | null = null;

    const isCreditOrSplit = payload.paymentMethod === 'credit' || payload.paymentMethod === 'split';
    if (isCreditOrSplit && !resolvedCustomerId && !payload.customerName) {
      throw new AppError('البيع الآجل أو المجزأ يتطلب تحديد أو إدخال اسم العميل / المحل', 'CREDIT_REQUIRES_CUSTOMER', 400);
    }

    let isNewCustomer = false;
    if (!resolvedCustomerId && payload.customerName && payload.customerName.trim() && payload.customerName !== 'عميل نقدي ميداني') {
      const existing = await this.anyDb
        .selectFrom('customers')
        .select(['id', 'name', 'metadata', 'customer_type'])
        .where('name', '=', payload.customerName.trim())
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (existing) {
        resolvedCustomerId = Number(existing.id);
        customerName = existing.name;
        customerType = (existing as any).customer_type || null;
      } else {
        isNewCustomer = true;
        customerName = payload.customerName.trim();
      }
    } else if (resolvedCustomerId) {
      const cust = await this.anyDb
        .selectFrom('customers')
        .select(['name', 'metadata', 'customer_type'])
        .where('id', '=', resolvedCustomerId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (!cust) throw new AppError('العميل غير موجود', 'CUSTOMER_NOT_FOUND', 404);
      customerName = cust.name;
      customerType = (cust as any).customer_type || null;

      // Ensure shared customer retains multi-rep link in assigned_rep_ids without overwriting primary rep
      let metaObj: any = {};
      if (typeof cust.metadata === 'string') {
        try { metaObj = JSON.parse(cust.metadata); } catch { metaObj = {}; }
      } else if (cust.metadata && typeof cust.metadata === 'object') {
        metaObj = { ...cust.metadata };
      }
      const existingRepIds = extractAssignedRepIds(metaObj);
      if (!existingRepIds.includes(Number(repId))) {
        const nextRepIds = [...existingRepIds, Number(repId)];
        metaObj.assigned_rep_ids = nextRepIds;
        if (!metaObj.assigned_rep_id) {
          metaObj.assigned_rep_id = Number(repId);
        }
        await this.anyDb
          .updateTable('customers')
          .set({ metadata: JSON.stringify(metaObj) })
          .where('id', '=', resolvedCustomerId)
          .where('tenant_id', '=', tenantId)
          .execute();
      }
    }

    let docNo = '';
    let totalSale = 0;
    let subtotalSale = 0;
    let discountSale = 0;
    let createdSaleId = 0;
    let cashPaid = 0;
    let creditOwed = 0;
    // Hoisted so the return echo below the transaction uses the same
    // helper; assigned inside the callback, on the transaction handle.
    let toBookMoney: (value: unknown) => number = (value) => Number(value ?? 0);

    // H9 (D4): load the acting rep's permission flags ONCE, here on
    // the pool handle BEFORE the transaction starts. The flags are
    // read-only config, and the discount + credit-limit gates below
    // reuse these loaded flags. A flags read must never run inside
    // the open transaction: in Postgres ANY error aborts the
    // transaction, and the catch in loadRepPermissions (a schema
    // without a permissions column) could not un-abort it — the sale
    // would then fail with 25P02 at the next statement, which is
    // exactly what the book-digits spec's 3dp cash-discount case hit
    // before this hoist.
    const repFlags = await loadRepPermissions(this.anyDb, tenantId, repId);

    // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): the posting
    // identity and the audit actor are resolved here, on the pool
    // handle BEFORE the transaction starts (P2 pattern — a pool read
    // inside the open transaction deadlocks on PGlite's single
    // connection, and on Postgres it would read outside the trip
    // lock). The posting identity prefers the acting rep's linked
    // login over the tenant's first active user, and the audit actor
    // is that same linked login (or null, naming the rep in the
    // details, when the rep has no linked login).
    const systemAuth = await this.resolveSystemAuthContext(tenantId, accountId, repId);
    const auditActor = await resolveVanMoneyAuditActor(this.anyDb, tenantId, repId);

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;
      // INV-VAN-TRIP-LOCKED-STATE-RECHECK: the trip read above runs on
      // an unlocked handle, so a trip settled between it and this
      // transaction would still sell from a closed van. Re-read the
      // governing row under lock FIRST, before any other work, and
      // sell only from the locked row's location/branch.
      const lockedTrip = await trxAny
        .selectFrom('van_sales_trips')
        .select(['id', 'van_location_id', 'status'])
        .where('id', '=', payload.tripId)
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .forUpdate()
        .executeTakeFirst();
      if (!lockedTrip || lockedTrip.status !== 'open') {
        throw new AppError('رحلة التوزيع المحددة مغلقة أو غير صالحة', 'INVALID_TRIP', 400);
      }
      // Sell only from the locked row's location/branch, never from the
      // unlocked pre-check snapshot.
      vanLocId = Number(lockedTrip.van_location_id);
      const lockedVanLocRow = await trxAny
        .selectFrom('stock_locations')
        .select(['branch_id'])
        .where('id', '=', vanLocId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      branchId = lockedVanLocRow?.branch_id ? Number(lockedVanLocRow.branch_id) : null;
      await assertBusinessAccountingDate(trx, tenantId, new Date(), true);
      // Book digits resolved once on THIS transaction handle (P2 pattern,
      // fail closed on a base-currency/rate mismatch, P0-1/P0-2/P0-3).
      // Every money derivation below rounds once with this helper; the
      // posting boundary re-rounds idempotently from the stored values.
      const bookDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
      toBookMoney = (value: unknown): number => roundMoney(Number(value ?? 0), bookDigits);
      const saleItemRecords: any[] = [];
      // INV-VAN-FEFO-BATCHES: batch allocations per sale item, in the same
      // order as saleItemRecords (one entry per loop iteration).
      const vanBatchAllocations: Array<Array<{ pharmacyBatchId: number; quantity: number }>> = [];
      const sortedItems = this.sortItemsByProductId(payload.items);
      const productIds = sortedItems.map((it) => Number(it.productId));
      // INV-OFFER-SELECTION-SHARED-POS-VAN: one instant for the whole
      // sale, evaluated in host-local parts — the same clock the POS
      // writer uses (todayLocalIsoDate / `now` defaults). Start/end
      // dates and happy-hour/days-of-week windows are applied by the
      // shared selector below, never pre-filtered here in UTC.
      const saleNow = new Date();
      const offerTodayIso = todayLocalIsoDate(saleNow);

      const rawOffers = productIds.length > 0 ? await trxAny
        .selectFrom('product_offers')
        .select(['product_id', 'offer_type', 'value', 'min_qty', 'start_date', 'end_date', 'bogo_buy_qty', 'bogo_get_qty', 'bogo_discount_percent', 'happy_hour_start', 'happy_hour_end', 'days_of_week'])
        .where('product_id', 'in', productIds)
        .where('tenant_id', '=', tenantId)
        .where('is_active', '=', true)
        .execute() : [];

      const offersByProduct = new Map<number, any[]>();
      for (const off of rawOffers) {
        const pId = Number(off.product_id);
        if (!offersByProduct.has(pId)) offersByProduct.set(pId, []);
        offersByProduct.get(pId)!.push(off);
      }

      // Security Invariant: Pre-resolve supervisor authorization if PIN is provided (with Maker-Checker enforcement)
      let supervisorOverrideApproved = false;
      let overrideSupervisorName = '';
      let overrideSupervisorId: number | null = null;

      if (payload.supervisorOverridePin) {
        const pinVerification = await this.verifySupervisorPin(
          tenantId,
          payload.supervisorOverridePin,
          repId,
          trxAny,
          accountId,
        );
        supervisorOverrideApproved = pinVerification.approved;
        overrideSupervisorId = pinVerification.supervisorId ?? null;
        overrideSupervisorName = pinVerification.supervisorName ?? '';
      }

      // Security Invariant: Transactional Ad-Hoc Customer Creation AFTER PIN Gate
      // Prevents a failed credit attempt from persisting an unapproved customer row that bypasses isNewCustomer on retry
      if (isNewCustomer && !resolvedCustomerId) {
        if (isCreditOrSplit && !supervisorOverrideApproved) {
          await this.vanFraudRadarService.recordSuspicionEvent({
            tenantId,
            accountId,
            repId,
            tripId: payload.tripId,
            customerName,
            eventCode: 'VAN_SUSPICION_CREDIT_BYPASS',
            severity: 'critical',
            titleAr: 'محاولة بيع آجل لعميل جديد غير مسجل مسبقاً بدون اعتماد مشرف (مديونية وهمية)',
            detailsAr: `حاول المندوب فتح حساب آجل لعميل ميداني جديد غير مسجل ("${customerName}") بدون رمز اعتماد المشرف.`,
          });
          throw new AppError(
            `البيع الآجل لعميل جديد ("${customerName}") غير مسجل مسبقاً يتطلب اعتماد المشرف برمز PIN لمنع المديونيات الوهمية`,
            'NEW_CUSTOMER_CREDIT_REQUIRES_SUPERVISOR_PIN',
            403,
          );
        }
        const initMeta = {
          assigned_rep_id: Number(repId),
          assigned_rep_ids: [Number(repId)],
          created_by_rep_id: Number(repId),
        };
        const [newCust] = await trxAny
          .insertInto('customers')
          .values({
            name: customerName,
            phone: payload.customerPhone || null,
            customer_type: 'cash',
            credit_limit: 0,
            metadata: JSON.stringify(initMeta),
            is_active: true,
            tenant_id: tenantId,
            account_id: accountId,
          })
          .returning(['id', 'name'])
          .execute();
        resolvedCustomerId = Number(newCust.id);
        customerName = newCust.name;
      }

      for (const item of sortedItems) {
        const pid = Number(item.productId);
        const inputQty = Number(item.qty || 0);
        if (inputQty <= 0) continue;

        const multiplier = Number((item as any).unitMultiplier || 1);
        const unitName = (item as any).unitName || null;
        const isBonus = Boolean((item as any).isBonus) || (item.unitPrice !== undefined && item.unitPrice !== null && Number(item.unitPrice) === 0);
        const bonusReason = (item as any).bonusReason || (isBonus ? 'بونص ترويجي / عينة مجانية' : null);
        const baseQty = Number((inputQty * multiplier).toFixed(4));

        // CANONICAL LOCK ORDER: Lock products first!
        const prod = await trxAny
          .selectFrom('products')
          .select(['id', 'name', 'cost_price', 'retail_price', 'wholesale_price', 'credit_price', 'consumer_price'])
          .where('id', '=', pid)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        if (!prod) {
          throw new AppError(`الصنف رقم #${pid} غير موجود في النظام`, 'PRODUCT_NOT_FOUND', 404);
        }

        const activeOffers = offersByProduct.get(pid) || [];

        const isCreditSale = payload.paymentMethod === 'credit' || payload.paymentMethod === 'split';
        // INV-VAN-FIELD-SALE-WHOLESALE-PRICE: a wholesale-typed
        // customer is charged products.wholesale_price on both cash and
        // credit sales; wholesale beats credit_price for such a customer
        // (the type defines the price; credit terms affect payment).
        const defaultBasePrice = customerType === 'wholesale' && prod.wholesale_price != null && Number(prod.wholesale_price) > 0
          ? Number(prod.wholesale_price)
          : (isCreditSale && prod.credit_price != null && Number(prod.credit_price) > 0
            ? Number(prod.credit_price)
            : Number(prod.retail_price || 0));

        // Security Invariant: Gated Bonus Items
        // Free bonus items cannot be arbitrarily flipped by the driver unless an active promotion allows it or supervisor PIN is provided
        if (isBonus) {
          // INV-OFFER-SELECTION-SHARED-POS-VAN: the BOGO that
          // authorises a bonus must be active under the shared rule
          // (date range AND happy-hour/days-of-week windows at the
          // sale instant), not merely date-filtered as before.
          const hasActiveBogoOffer = activeOffers.some((o: any) => o.offer_type === 'bogo' && isOfferActive(o, offerTodayIso, saleNow));
          if (!hasActiveBogoOffer && !supervisorOverrideApproved) {
            const attemptedVal = toBookMoney(defaultBasePrice * multiplier * inputQty);
            await this.vanFraudRadarService.recordSuspicionEvent({
              tenantId,
              accountId,
              repId,
              tripId: payload.tripId,
              customerId: resolvedCustomerId,
              customerName,
              eventCode: 'VAN_SUSPICION_UNAUTHORIZED_BONUS',
              severity: 'high',
              titleAr: 'محاولة صرف بونص عيني مجاني بدون عرض ترويجي أو اعتماد مشرف',
              detailsAr: `حاول المندوب صرف ${inputQty} (${unitName || 'قطعة'}) من الصنف "${prod.name || pid}" كبونص مجاني بقيمة ${attemptedVal} ج.م دون وجود عرض BOGO نشط أو PIN مشرف.`,
              attemptedAmount: attemptedVal,
            });
            throw new AppError(
              `صرف الصنف "${prod.name || pid}" كبونص عيني مجاني يتطلب عرضاً ترويجياً نشطاً أو اعتماد المشرف برمز PIN`,
              'BONUS_REQUIRES_SUPERVISOR_PIN',
              403,
            );
          }
        }

        const vanStock = await trxAny
          .selectFrom('product_location_stock')
          .select(['id', 'qty'])
          .where('product_id', '=', pid)
          .where('location_id', '=', vanLocId)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        const currentQty = Number(vanStock?.qty || 0);
        if (currentQty < baseQty) {
          throw new AppError(
            `رصيد سيارة التوزيع لا يكفي للصنف "${prod.name || pid}". المتوفر بالسيارة: ${currentQty} قطعة، المطلوب: ${baseQty} قطعة (${inputQty} ${unitName || 'وحدة'})`,
            'INSUFFICIENT_VAN_STOCK',
            400,
          );
        }

        // O27: name, price and cost must come from this tenant's product, never from a foreign row.
        // A van sale leaves the company for good, so unlike a load it DOES reduce global stock.
        await this.moveVanStock(trx, {
          productId: pid,
          delta: -baseQty,
          locationId: vanLocId,
          tenantId,
          accountId,
          userId: null,
          movementType: 'van_sale',
          note: isBonus ? 'صرف بونص ترويجي من سيارة التوزيع' : 'بيع من سيارة التوزيع',
          referenceType: 'van_sales_trip',
          referenceId: Number(trip?.id || 0),
          skipGlobalUpdate: false,
          unitCost: Number(prod.cost_price || 0),
        });

        // INV-VAN-FEFO-BATCHES: deduct the van's batches earliest-expiry-first;
        // fails closed when the van's valid batches cannot cover the sale.
        vanBatchAllocations.push(
          await this.deductVanSalePharmacyBatches(trx, pid, baseQty, { tenantId, accountId }, vanLocId),
        );

        // The undiscounted unit price at book digits: the single baseline
        // for offer savings and for the original-price fallback below.
        const baseUnitPrice = toBookMoney(defaultBasePrice * multiplier);
        let systemAuthorizedPrice = baseUnitPrice;
        let pricingTierType: 'cash' | 'credit' | 'offer' | 'bonus' | 'wholesale' = isBonus ? 'bonus' : (customerType === 'wholesale' ? 'wholesale' : (isCreditSale ? 'credit' : 'cash'));
        let unitOfferSavings = 0;

        if (isBonus) {
          systemAuthorizedPrice = 0;
          pricingTierType = 'bonus';
        } else {
          // INV-OFFER-SELECTION-SHARED-POS-VAN: the winner is the
          // shared POS selector — lowest adjusted price among offers
          // active at the sale instant, qualified on the SOLD
          // quantity (inputQty), never on base units, never by
          // highest minimum quantity. The per-type price derivation
          // below is unchanged and still computes from the winner.
          const matchingOffer = pickBestApplicableOffer(activeOffers, offerTodayIso, inputQty, baseUnitPrice, saleNow, bookDigits);

          if (matchingOffer) {
            const offerVal = Number(matchingOffer.value || 0);
            if (matchingOffer.offer_type === 'percent' && offerVal > 0) {
              const discountedBase = Math.max(0, toBookMoney(defaultBasePrice * (1 - offerVal / 100)));
              systemAuthorizedPrice = toBookMoney(discountedBase * multiplier);
              pricingTierType = 'offer';
              unitOfferSavings = Math.max(0, toBookMoney(baseUnitPrice - systemAuthorizedPrice));
            } else if (matchingOffer.offer_type === 'fixed' && offerVal > 0) {
              const discountedBase = Math.max(0, toBookMoney(defaultBasePrice - offerVal));
              systemAuthorizedPrice = toBookMoney(discountedBase * multiplier);
              pricingTierType = 'offer';
              unitOfferSavings = Math.max(0, toBookMoney(baseUnitPrice - systemAuthorizedPrice));
            } else if (matchingOffer.offer_type === 'price' && offerVal > 0) {
              systemAuthorizedPrice = toBookMoney(offerVal * multiplier);
              pricingTierType = 'offer';
              unitOfferSavings = Math.max(0, toBookMoney(baseUnitPrice - systemAuthorizedPrice));
            } else if (matchingOffer.offer_type === 'bundle' && offerVal > 0) {
              const minQ = Math.max(1, Number(matchingOffer.min_qty || 1));
              const bundles = Math.floor(inputQty / minQ);
              const rem = inputQty % minQ;
              const bundleTotal = (bundles * offerVal) + (rem * defaultBasePrice);
              systemAuthorizedPrice = toBookMoney((bundleTotal / inputQty) * multiplier);
              pricingTierType = 'offer';
              unitOfferSavings = Math.max(0, toBookMoney(baseUnitPrice - systemAuthorizedPrice));
            } else if (matchingOffer.offer_type === 'bogo') {
              const buyQ = Math.max(1, Number(matchingOffer.bogo_buy_qty || 1));
              const getQ = Math.max(1, Number(matchingOffer.bogo_get_qty || 1));
              const discPct = Math.min(100, Math.max(0, Number(matchingOffer.bogo_discount_percent ?? (offerVal || 100))));
              const cycle = buyQ + getQ;
              if (inputQty >= cycle) {
                const fullCycles = Math.floor(inputQty / cycle);
                const rem = inputQty % cycle;
                const freeUnits = (fullCycles * getQ) + Math.max(0, rem - buyQ);
                const discAmt = freeUnits * defaultBasePrice * (discPct / 100);
                const netTot = Math.max(0, (inputQty * defaultBasePrice) - discAmt);
                systemAuthorizedPrice = toBookMoney((netTot / inputQty) * multiplier);
                pricingTierType = 'offer';
                unitOfferSavings = Math.max(0, toBookMoney(baseUnitPrice - systemAuthorizedPrice));
              }
            }
          }
        }

        let unitPrice = systemAuthorizedPrice;

        // Security Invariant: Price Integrity Guard against Client Tampering
        if (!isBonus && item.unitPrice != null) {
          // The client price is rounded at book digits (a 3dp client price
          // must survive); the 0.05 band itself stays ABSOLUTE: it is a
          // fraud-policy allowance for human price deviation, not a
          // rounding artifact, so it does not shrink to one minor unit
          // at 3dp (see the invariant note; the return guards share it).
          const clientPrice = toBookMoney(item.unitPrice);
          if (Math.abs(clientPrice - systemAuthorizedPrice) <= 0.05) {
            unitPrice = clientPrice;
          } else if (clientPrice < systemAuthorizedPrice - 0.05) {
            // Price is lower than authorized system price — requires supervisor PIN
            if (!supervisorOverrideApproved) {
              const attemptedDiff = toBookMoney((systemAuthorizedPrice - clientPrice) * inputQty);
              await this.vanFraudRadarService.recordSuspicionEvent({
                tenantId,
                accountId,
                repId,
                tripId: payload.tripId,
                customerId: resolvedCustomerId,
                customerName,
                eventCode: 'VAN_SUSPICION_PRICE_MANIPULATION',
                severity: 'critical',
                titleAr: 'محاولة تلاعب وخفض سعر بيع صنف تحت السعر المعتمد بدون PIN مشرف',
                detailsAr: `حاول المندوب بيع الصنف "${prod.name || pid}" بسعر (${clientPrice} ج.م) أقل من السعر المعتمد (${systemAuthorizedPrice} ج.م) بفارق إجمالي (${attemptedDiff} ج.م) بدون اعتماد المشرف.`,
                attemptedAmount: attemptedDiff,
              });
              throw new AppError(
                `سعر البيع المحدد للصنف "${prod.name || pid}" (${clientPrice} ج.م) أقل من السعر المعتمد (${systemAuthorizedPrice} ج.م). تعديل أو خفض الأسعار يتطلب اعتماد المشرف برمز PIN`,
                'PRICE_DISCOUNT_REQUIRES_SUPERVISOR_PIN',
                403,
              );
            }
            unitPrice = clientPrice;
          } else if (pricingTierType === 'wholesale') {
            // INV-VAN-FIELD-SALE-WHOLESALE-PRICE: the server price is
            // authoritative for the wholesale tier — a higher client
            // price (the old frontend still sends retail) must not
            // override the authorized wholesale price.
            unitPrice = systemAuthorizedPrice;
          } else {
            // Higher price accepted
            unitPrice = clientPrice;
          }
        }

        const originalPrice = (item as any).originalPrice
          ? toBookMoney((item as any).originalPrice)
          : (isBonus ? baseUnitPrice : Math.max(unitPrice, baseUnitPrice));
        const lineTotal = toBookMoney(unitPrice * inputQty);
        const lineSubtotal = toBookMoney(originalPrice * inputQty);
        totalSale += lineTotal;
        subtotalSale += lineSubtotal;

        saleItemRecords.push({
          product_id: pid,
          product_name: prod.name || `صنف #${pid}`,
          qty: inputQty,
          unit_price: unitPrice,
          line_total: lineTotal,
          cost_price: Number(prod.cost_price || 0) * multiplier,
          consumer_price: prod.consumer_price != null && Number(prod.consumer_price) > 0 ? Number(prod.consumer_price) * multiplier : null,
          pricing_tier_type: pricingTierType,
          unit_offer_savings: unitOfferSavings,
          unit_name: unitName,
          unit_multiplier: multiplier,
          is_bonus: isBonus,
          bonus_reason: bonusReason,
        });
      }

      if (subtotalSale < totalSale) subtotalSale = totalSale;
      discountSale = toBookMoney(Math.max(0, subtotalSale - totalSale));

      const createdByUserId = systemAuth.userId > 0 ? systemAuth.userId : null;

      const isCash = payload.paymentMethod === 'cash';
      const isCard = payload.paymentMethod === 'card';
      const isCredit = payload.paymentMethod === 'credit';
      const isSplit = payload.paymentMethod === 'split';
      const isInstapay = payload.paymentMethod === 'instapay' || payload.paymentMethod === 'vodafone_cash';

      cashPaid = 0;
      creditOwed = 0;

      if (isCash) {
        // The cash discount is rounded once at book digits, before it
        // touches the totals (the old code took it raw and re-rounded
        // the result at 2dp, so a 3dp discount never survived intact).
        const cashDiscount = Math.max(0, toBookMoney(payload.cashDiscountAmount || 0));
        if (cashDiscount > 0) {
          // H9 (D3 + D4): the cash discount was a second, ungated
          // discount channel for the same sale — the item-price guard
          // above it needs a verified supervisor PIN, but this channel
          // needed nothing. It is now gated on the acting rep's
          // permission flags (loaded before the transaction, above):
          // can_give_discount false refuses ANY cash discount (a
          // supervisor PIN does not override a closed flag — the flag
          // is the control, the PIN alone is not enough); a discount
          // above max_discount_percent of the pre-discount sale total
          // needs the already-verified supervisor PIN. The gate runs
          // even when the discount is >= the total (which the apply
          // below still leaves unapplied, as before) — the attempt
          // itself is refused, not silently swallowed.
          if (!repFlags.can_give_discount) {
            await this.vanFraudRadarService.recordSuspicionEvent({
              tenantId,
              accountId,
              repId,
              tripId: payload.tripId,
              customerId: resolvedCustomerId,
              customerName,
              eventCode: 'VAN_SUSPICION_UNAUTHORIZED_CASH_DISCOUNT',
              severity: 'high',
              titleAr: 'محاولة منح خصم نقدي بدون صلاحية خصم (can_give_discount مغلقة)',
              detailsAr: `حاول المندوب منح خصم نقدي بقيمة ${cashDiscount} ج.م على بيع ميداني رغم أن صلاحية منح الخصم (can_give_discount) مغلقة له.`,
              attemptedAmount: cashDiscount,
            });
            throw new AppError(
              'صلاحية منح الخصم (can_give_discount) مغلقة لهذا المندوب، فلا يمكنه منح خصم نقدي على البيع الميداني',
              'REP_DISCOUNT_NOT_ALLOWED',
              403,
            );
          }
          const discountPercent = totalSale > 0 ? (cashDiscount / totalSale) * 100 : 0;
          if (discountPercent > repFlags.max_discount_percent && !supervisorOverrideApproved) {
            await this.vanFraudRadarService.recordSuspicionEvent({
              tenantId,
              accountId,
              repId,
              tripId: payload.tripId,
              customerId: resolvedCustomerId,
              customerName,
              eventCode: 'VAN_SUSPICION_DISCOUNT_ABOVE_LIMIT',
              severity: 'high',
              titleAr: 'محاولة خصم نقدي فوق الحد المسموح بدون اعتماد مشرف',
              detailsAr: `حاول المندوب منح خصم نقدي بقيمة ${cashDiscount} ج.م (${discountPercent.toFixed(2)}%) متجاوزاً الحد المسموح له (${repFlags.max_discount_percent}%) بدون رمز اعتماد المشرف.`,
              attemptedAmount: cashDiscount,
            });
            throw new AppError(
              `الخصم النقدي (${discountPercent.toFixed(2)}%) يتجاوز الحد الأقصى المسموح لهذا المندوب (max_discount_percent = ${repFlags.max_discount_percent}%) ويتطلب اعتماد المشرف برمز PIN`,
              'CASH_DISCOUNT_ABOVE_LIMIT_REQUIRES_SUPERVISOR_PIN',
              403,
            );
          }
        }
        if (cashDiscount > 0 && cashDiscount < totalSale) {
          totalSale = toBookMoney(totalSale - cashDiscount);
          discountSale = toBookMoney(discountSale + cashDiscount);
        }
        cashPaid = totalSale;
        creditOwed = 0;
      } else if (isCredit) {
        cashPaid = 0;
        creditOwed = totalSale;
      } else if (isCard || isInstapay) {
        cashPaid = 0;
        creditOwed = 0;
      } else if (isSplit) {
        const rawPaid = Number(payload.paidAmount || 0);
        cashPaid = Math.max(0, Math.min(totalSale, toBookMoney(rawPaid)));
        creditOwed = Math.max(0, toBookMoney(totalSale - cashPaid));
      }

      // Enforce customer credit limit and credit block in the field
      let isCreditOverridden = false;
      let creditOverrideUserId: number | null = null;
      let creditOverrideReason: string | null = null;

      // INV-VAN-FIELD-NONCASH-EVIDENCE-GATE: instapay / vodafone_cash
      // settle straight to bank 1120 exactly like a card sale, so
      // they run the same evidence gate — supervisor PIN + a
      // reference of at least 3 chars — or the sale is refused.
      // Before this gate, an instapay sale skipped the check
      // entirely and a rep could mark a debt "instapay arrived"
      // with zero evidence while no cash was ever expected of him.
      if ((isCard || isInstapay) && totalSale > 0) {
        // The card leg below is byte-identical to the pre-existing
        // card contract (reference = reason || notes, approval note
        // as the fallback reference). The instapay leg reads the
        // transfer reference first and has NO invented fallback: an
        // instapay / vodafone_cash sale needs a real reference of at
        // least 3 chars on top of the supervisor PIN, or it is
        // refused with CARD_PAYMENT_REFERENCE_REQUIRED.
        const cardCheck = evaluateFieldCardPayment({
          totalSaleAmount: totalSale,
          referenceReason: isCard
            ? (payload.supervisorOverrideReason || payload.notes)
            : (payload.transferReference || payload.supervisorOverrideReason || payload.notes),
          supervisorOverride: supervisorOverrideApproved
            ? {
                approved: true,
                supervisorId: overrideSupervisorId || undefined,
                supervisorName: overrideSupervisorName,
                reason: isCard
                  ? (payload.supervisorOverrideReason || payload.notes || `إيصال شبكة معتمد من ${overrideSupervisorName}`)
                  : (payload.transferReference || payload.supervisorOverrideReason || payload.notes || undefined),
              }
            : undefined,
        });
        if (!cardCheck.allowed) {
          await this.vanFraudRadarService.recordSuspicionEvent({
            tenantId,
            accountId,
            repId,
            tripId: payload.tripId,
            customerId: resolvedCustomerId,
            customerName,
            eventCode: 'VAN_SUSPICION_FAKE_CARD_PAYMENT',
            severity: 'critical',
            titleAr: 'محاولة تسجيل دفع إلكتروني وهمي بدون اعتماد مشرف أو رقم إيصال',
            detailsAr: `حاول المندوب تسجيل فاتورة بقيمة ${totalSale} ج.م كدفع ${isCard ? 'بالشبكة/الفيزا' : 'إلكتروني (إنستاباي/فودافون كاش)'} لتجنب مطالبته بتوريد الكاش بالتصفية، دون اعتماد مشرف أو رقم إيصال.`,
            attemptedAmount: totalSale,
          });
          throw new AppError(
            cardCheck.errorMessageAr || 'الدفع بالشبكة في الميدان يتطلب اعتماد المشرف ورقم إيصال الشبكة',
            cardCheck.reasonCode || 'CARD_PAYMENT_REQUIRES_SUPERVISOR_PIN',
            403,
          );
        }
        isCreditOverridden = true;
        creditOverrideUserId = overrideSupervisorId;
        creditOverrideReason = `اعتماد دفع شبكة/تحويل بنكي: ${cardCheck.approvedReference || ''}`;
      }

      if ((isCredit || isSplit) && creditOwed > 0 && resolvedCustomerId) {
        // Security Invariant: Phantom Credit Prevention
        // Rep cannot sell on credit to an ad-hoc unregistered customer without supervisor PIN
        if (isNewCustomer && !supervisorOverrideApproved) {
          await this.vanFraudRadarService.recordSuspicionEvent({
            tenantId,
            accountId,
            repId,
            tripId: payload.tripId,
            customerId: resolvedCustomerId,
            customerName,
            eventCode: 'VAN_SUSPICION_CREDIT_BYPASS',
            severity: 'critical',
            titleAr: 'محاولة بيع آجل لعميل جديد غير مسجل مسبقاً بدون اعتماد مشرف',
            detailsAr: `حاول المندوب بيع آجل بقيمة ${creditOwed} ج.م لعميل جديد ("${customerName}") بدون رمز اعتماد المشرف.`,
            attemptedAmount: creditOwed,
          });
          throw new AppError(
            `البيع الآجل لعميل جديد ("${customerName}") غير مسجل مسبقاً يتطلب اعتماد المشرف برمز PIN لمنع المديونيات الوهمية`,
            'NEW_CUSTOMER_CREDIT_REQUIRES_SUPERVISOR_PIN',
            403,
          );
        }

        const custRecord = await trxAny
          .selectFrom('customers')
          .select(['id', 'name', 'balance', 'credit_limit', 'is_credit_blocked', 'credit_block_reason', 'customer_type', 'metadata'])
          .where('id', '=', resolvedCustomerId)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        if (custRecord) {
          let custMeta: any = {};
          if (typeof custRecord.metadata === 'string') {
            try { custMeta = JSON.parse(custRecord.metadata); } catch { custMeta = {}; }
          } else if (custRecord.metadata && typeof custRecord.metadata === 'object') {
            custMeta = custRecord.metadata;
          }
          const isFieldCreatedCustomer = Boolean(custMeta?.created_by_rep_id) || isNewCustomer;

          // Security Invariant: Real-Time Geofence Enforcement Gate on Credit Sales (Anti-Phantom Sidewalk Sales)
          // Strictly prevents rep from booking credit sales while physically outside customer location
          const custCoords = extractCoordinatesFromCustomerLocation({
            metadata: custMeta,
            locationUrl: (custRecord as any).location_url || custMeta?.location_url || custMeta?.locationUrl,
          });

          if (custCoords && isValidCoordinatePair(custCoords.lat, custCoords.lng)) {
            const repLat = payload.deliveryGpsLat != null ? Number(payload.deliveryGpsLat) : null;
            const repLng = payload.deliveryGpsLng != null ? Number(payload.deliveryGpsLng) : null;

            const geo = evaluateGeofenceCompliance({
              repLat,
              repLng,
              customerLat: custCoords.lat,
              customerLng: custCoords.lng,
              maxAllowedMeters: 200,
            });

            if ((geo.status === 'outside_geofence' || geo.isCompliant === false) && !supervisorOverrideApproved) {
              await this.vanFraudRadarService.recordSuspicionEvent({
                tenantId,
                accountId,
                repId,
                tripId: payload.tripId,
                customerId: resolvedCustomerId,
                customerName: custRecord.name || customerName,
                eventCode: 'VAN_SUSPICION_GEOFENCE_VIOLATION',
                severity: 'critical',
                titleAr: 'محاولة بيع آجل خارج النطاق الجغرافي المعتمد لدكان العميل (فواتير رصيف)',
                detailsAr: `حاول المندوب إصدار فاتورة بيع آجل بقيمة ${creditOwed} ج.م للعميل "${custRecord.name || customerName}" وهو يبعد مسافة (${geo.distanceMeters} متر) عن موقع المحل (المسموح ${geo.maxAllowedMeters}م) بدون اعتماد المشرف.`,
                attemptedAmount: creditOwed,
                metadata: {
                  distanceMeters: geo.distanceMeters,
                  maxAllowedMeters: geo.maxAllowedMeters,
                  repLat,
                  repLng,
                  customerLat: custCoords.lat,
                  customerLng: custCoords.lng,
                },
              });
              throw new AppError(
                `أنت خارج النطاق الجغرافي المعتمد لدكان العميل (المسافة: ${geo.distanceMeters} متر، المسموح: ${geo.maxAllowedMeters}م). البيع الآجل خارج الموقع يتطلب اعتماد المشرف برمز PIN لمنع المديونيات وفواتير الرصيف الوهمية.`,
                'OUT_OF_GEOFENCE_REQUIRES_SUPERVISOR_PIN',
                403,
              );
            }
          }

          // Financial Governance: Check for overdue unpaid credit sales past allowed grace period
          const allowedCreditDays = Number(custMeta?.credit_days || custMeta?.credit_terms_days || 30);
          const overdueCutoffDate = new Date();
          overdueCutoffDate.setDate(overdueCutoffDate.getDate() - allowedCreditDays);

          const overdueSales = await trxAny
            .selectFrom('sales')
            .select([
              'id',
              'doc_no',
              'total',
              'paid_amount',
              'created_at',
              sql<number>`cast(total - coalesce(paid_amount, 0) as numeric)`.as('remaining'),
            ])
            .where('tenant_id', '=', tenantId)
            .where('customer_id', '=', resolvedCustomerId)
            .where('payment_type', '=', 'credit')
            .where('status', 'in', ['posted', 'completed'])
            .where(sql`total - coalesce(paid_amount, 0) > 0.05`)
            .where('created_at', '<', overdueCutoffDate)
            .orderBy('created_at', 'asc')
            .execute();

          const hasOverdueInvoices = overdueSales.length > 0;
          let oldestOverdueDays = 0;
          let overdueAmount = 0;
          if (hasOverdueInvoices) {
            const oldest = overdueSales[0];
            const oldestDate = new Date(oldest.created_at);
            oldestOverdueDays = Math.max(0, Math.floor((Date.now() - oldestDate.getTime()) / (1000 * 60 * 60 * 24)));
            overdueAmount = toBookMoney(
              overdueSales.reduce((sum: number, s: any) => sum + Number(s.remaining || 0), 0),
            );
          }

          const creditCheck = evaluateCreditLimitCheck({
            moneyDigits: bookDigits,
            customerId: resolvedCustomerId,
            customerName: custRecord.name || customerName,
            currentBalance: Number(custRecord.balance || 0),
            creditLimit: Number(custRecord.credit_limit || 0),
            isCreditBlocked: Boolean(custRecord.is_credit_blocked),
            creditBlockReason: custRecord.credit_block_reason,
            customerType: custRecord.customer_type,
            isFieldCreatedCustomer,
            requestedCreditAmount: creditOwed,
            hasOverdueInvoices,
            oldestOverdueDays,
            overdueAmount,
            supervisorOverride: supervisorOverrideApproved ? {
              approved: true,
              supervisorId: overrideSupervisorId || undefined,
              supervisorName: overrideSupervisorName,
              reason: payload.supervisorOverrideReason || `اعتماد استثنائي من المشرف ${overrideSupervisorName}`,
            } : undefined,
          });

          if (!creditCheck.allowed) {
            await this.vanFraudRadarService.recordSuspicionEvent({
              tenantId,
              accountId,
              repId,
              tripId: payload.tripId,
              customerId: resolvedCustomerId,
              customerName: custRecord.name || customerName,
              eventCode: 'VAN_SUSPICION_CREDIT_BYPASS',
              severity: 'high',
              titleAr: 'محاولة كسر سقف الائتمان أو البيع الآجل لعميل نقدي/محظور بدون PIN مشرف',
              detailsAr: creditCheck.errorMessageAr || `حاول المندوب بيع آجل بقيمة ${creditOwed} ج.م للعميل "${custRecord.name || customerName}" بالمخالفة لضوابط الائتمان.`,
              attemptedAmount: creditOwed,
            });
            throw new AppError(
              creditCheck.errorMessageAr || 'تم رفض العملية لتجاوز سقف الائتمان للعميل',
              creditCheck.reasonCode || 'CREDIT_LIMIT_REJECTED',
              422,
            );
          }

          // H9 (D4): can_sell_over_credit_limit is the control on
          // selling over the customer's credit limit — a supervisor
          // PIN alone is NOT enough. The engine returns isOverridden
          // whenever a PIN approves an overrun, and exceededAmount > 0
          // exactly for a limit overrun (projected balance above the
          // limit, including a cash-only customer whose limit is 0);
          // a blocked-customer or overdue-invoice override carries
          // exceededAmount 0 and is NOT a limit overrun, so it keeps
          // the existing PIN flow untouched. The flags are the ones
          // loaded before the transaction, above.
          if (creditCheck.isOverridden && Number(creditCheck.exceededAmount || 0) > 0) {
            if (!repFlags.can_sell_over_credit_limit) {
              await this.vanFraudRadarService.recordSuspicionEvent({
                tenantId,
                accountId,
                repId,
                tripId: payload.tripId,
                customerId: resolvedCustomerId,
                customerName: custRecord.name || customerName,
                eventCode: 'VAN_SUSPICION_CREDIT_LIMIT_FLAG',
                severity: 'high',
                titleAr: 'محاولة بيع فوق سقف الائتمان بدون صلاحية تجاوز السقف رغم اعتماد المشرف',
                detailsAr: `حاول المندوب بيع آجل بقيمة ${creditOwed} ج.م للعميل "${custRecord.name || customerName}" متجاوزاً سقف الائتمان بمقدار ${Number(creditCheck.exceededAmount || 0)} ج.م رغم أن صلاحية البيع فوق السقف (can_sell_over_credit_limit) مغلقة له، حتى مع اعتماد المشرف برمز PIN.`,
                attemptedAmount: creditOwed,
              });
              throw new AppError(
                'صلاحية البيع فوق سقف الائتمان (can_sell_over_credit_limit) مغلقة لهذا المندوب، فلا يمكنه البيع فوق سقف ائتمان العميل حتى باعتماد المشرف برمز PIN',
                'REP_CANNOT_SELL_OVER_CREDIT_LIMIT',
                403,
              );
            }
          }

          if (creditCheck.isOverridden) {
            isCreditOverridden = true;
            creditOverrideUserId = overrideSupervisorId;
            creditOverrideReason = creditCheck.overrideReason || null;
          }
        }
      }

      // INV-VAN-SALE-TAX-OPTIONAL: the van sale posts the tenant's
      // configured tax rate, or 0 when the owner never enabled tax
      // on sales (Tax F1: optional per business owner). The driver
      // sends no tax rate, so the configured rate is both the
      // payload and the configured value for resolveSaleTaxRate —
      // an absent or unparseable setting resolves to 0, never a
      // throw. Tax is added ON TOP of the price (prices_include_tax
      // stays false): computeInvoiceTotals on the net base
      // (subtotal - discount, cash discount already applied above)
      // returns the tax and the tax-inclusive total, rounded once
      // at book digits via toBookMoney. Placed here, directly
      // before the insert, so the stored tax_rate/tax_amount, the
      // paid_amount for card/InstaPay (totalSale), the trip totals,
      // the customer balance and postSale (which reads
      // sale.tax_amount only) all consume the same tax-inclusive
      // total. The cash/credit split is topped up by the tax: cash
      // collects the whole tax-inclusive total, credit owes it,
      // and a split sale's unpaid remainder grows by the tax (cash
      // already collected stays as collected). NOTE: the credit
      // limit and card gates above ran on the pre-tax amount; the
      // tax portion is added after them.
      const taxSettingRows = await trxAny
        .selectFrom('settings')
        .select(['key', 'value'])
        .where('tenant_id', '=', tenantId)
        .where('key', 'in', ['taxRate', 'tax_rate'])
        .execute();
      let configuredTaxRate: unknown;
      for (const row of taxSettingRows) {
        const rawValue = (row as any).value;
        let parsedValue: unknown = rawValue;
        try {
          parsedValue = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
        } catch {
          parsedValue = rawValue;
        }
        if ((row as any).key === 'taxRate') {
          configuredTaxRate = parsedValue;
          break;
        }
        if (configuredTaxRate === undefined) configuredTaxRate = parsedValue;
      }
      const vanTaxRate = resolveSaleTaxRate(configuredTaxRate, configuredTaxRate);
      const vanTotals = computeInvoiceTotals(subtotalSale, discountSale, vanTaxRate, false, 0, 0, 0);
      const vanTaxAmount = toBookMoney(vanTotals.taxAmount);
      totalSale = toBookMoney(vanTotals.total);
      if (isCash) cashPaid = totalSale;
      else if (isCredit) creditOwed = totalSale;
      else if (isSplit) creditOwed = toBookMoney(totalSale - cashPaid);

      const tempDocNo = `TMP-VAN-${Date.now()}`;
      const insertedSale = await trxAny
        .insertInto('sales')
        .values({
          doc_no: tempDocNo,
          total: totalSale,
          subtotal: subtotalSale,
          discount: discountSale,
          tax_rate: vanTaxRate,
          tax_amount: vanTaxAmount,
          // Cash/Credit collected in the field sits with the rep (or customer receivable) until settleTrip,
          // whereas verified Card/Bank/InstaPay payments settle directly to Bank via sale_payments.
          paid_amount: (isCard || isInstapay) ? totalSale : 0,
          store_credit_used: 0,
          prices_include_tax: false,
          status: 'posted',
          payment_type: payload.paymentMethod,
          payment_channel: isCash ? 'cash' : (isCard ? 'card' : (isInstapay ? (payload.paymentMethod === 'vodafone_cash' ? 'vodafone_cash' : 'bank_transfer') : (isCredit ? 'credit' : 'mixed'))),
          collection_status: isCash ? 'prepaid_by_rep' : ((isCard || isInstapay) ? 'settled_to_bank' : (isSplit && cashPaid > 0 ? 'prepaid_by_rep' : null)),
          customer_id: resolvedCustomerId,
          branch_id: branchId,
          location_id: vanLocId,
          created_by: createdByUserId,
          delivery_rep_id: repId,
          van_trip_id: payload.tripId,
          sale_origin: 'van_sale',
          is_credit_overridden: isCreditOverridden,
          credit_override_by_user_id: creditOverrideUserId,
          credit_override_reason: creditOverrideReason,
          transfer_reference: payload.transferReference || null,
          transfer_receipt_url: payload.transferReceiptUrl || null,
          recipient_name: payload.recipientName || null,
          recipient_phone: payload.recipientPhone || null,
          recipient_role: payload.recipientRole || null,
          recipient_signature: payload.recipientSignature || null,
          note: payload.clientTxId
            ? `${payload.notes || 'فاتورة بيع ميداني من سيارة المندوب'} [tx:${payload.clientTxId}]`
            : payload.notes || `فاتورة بيع ميداني من سيارة المندوب`,
          delivery_gps_lat: payload.deliveryGpsLat != null ? Number(payload.deliveryGpsLat) : null,
          delivery_gps_lng: payload.deliveryGpsLng != null ? Number(payload.deliveryGpsLng) : null,
          delivery_proof_photo: payload.deliveryProofPhoto || null,
          packaging_breakdown: payload.packagingBreakdown ? JSON.stringify(payload.packagingBreakdown) : null,
          tenant_id: tenantId,
          account_id: accountId,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      createdSaleId = Number(insertedSale.id);
      docNo = await this.generateDailySequenceNumber(trxAny, 'sales', 'doc_no', 'VAN', tenantId);

      await trxAny
        .updateTable('sales')
        .set({ doc_no: docNo })
        .where('id', '=', createdSaleId)
        .where('tenant_id', '=', tenantId)
        .execute();

      if (resolvedCustomerId) {
        await trxAny
          .insertInto('van_field_visits')
          .values({
            tenant_id: tenantId,
            account_id: accountId,
            trip_id: payload.tripId,
            rep_id: repId,
            customer_id: resolvedCustomerId,
            visit_type: 'positive',
            sale_id: createdSaleId,
            gps_lat: payload.deliveryGpsLat != null ? Number(payload.deliveryGpsLat) : null,
            gps_lng: payload.deliveryGpsLng != null ? Number(payload.deliveryGpsLng) : null,
            notes: payload.notes || null,
            visited_at: sql`NOW()`,
            created_at: sql`NOW()`,
          })
          .execute();
      }

      for (let recordIdx = 0; recordIdx < saleItemRecords.length; recordIdx++) {
        const it = saleItemRecords[recordIdx];
        const insertedItem = await trxAny
          .insertInto('sale_items')
          .values({
            sale_id: createdSaleId,
            product_id: it.product_id,
            product_name: it.product_name,
            qty: it.qty,
            unit_price: it.unit_price,
            line_total: it.line_total,
            cost_price: it.cost_price,
            consumer_price: it.consumer_price,
            pricing_tier_type: it.pricing_tier_type,
            unit_offer_savings: it.unit_offer_savings,
            unit_name: it.unit_name || 'قطعة',
            unit_multiplier: it.unit_multiplier || 1,
            is_bonus: Boolean(it.is_bonus),
            bonus_reason: it.bonus_reason || null,
            tenant_id: tenantId,
            account_id: accountId,
          })
          .returning(['id'])
          .executeTakeFirstOrThrow();
        // INV-VAN-FEFO-BATCHES: record which van batches this item consumed,
        // so a later edit/cancel can restore them like a shop sale.
        for (const alloc of vanBatchAllocations[recordIdx] || []) {
          await trxAny
            .insertInto('sale_pharmacy_batch_allocations')
            .values({
              tenant_id: tenantId,
              account_id: accountId,
              sale_id: createdSaleId,
              sale_item_id: Number(insertedItem.id),
              product_id: it.product_id,
              pharmacy_batch_id: alloc.pharmacyBatchId,
              quantity: alloc.quantity,
            })
            .execute();
        }
      }

      if ((isCard || isInstapay) && totalSale > 0) {
        await trxAny
          .insertInto('sale_payments')
          .values({
            sale_id: createdSaleId,
            payment_channel: isCard ? 'card' : (payload.paymentMethod === 'vodafone_cash' ? 'vodafone_cash' : 'bank_transfer'),
            amount: totalSale,
            applied_amount: totalSale,
            tendered_amount: totalSale,
            change_amount: 0,
            card_rrn: (payload.transferReference || payload.supervisorOverrideReason) ? String(payload.transferReference || payload.supervisorOverrideReason).trim().slice(0, 64) : null,
            tenant_id: tenantId,
            account_id: accountId,
          })
          .execute();
      }

      if (isCash) {
        await trxAny
          .updateTable('van_sales_trips')
          .set({
            sales_amount: sql`sales_amount + ${totalSale}`,
            cash_collected: sql`cash_collected + ${totalSale}`,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', payload.tripId)
          .where('tenant_id', '=', tenantId)
          .execute();
      } else if (isInstapay) {
        await trxAny
          .updateTable('van_sales_trips')
          .set({
            sales_amount: sql`sales_amount + ${totalSale}`,
            total_instapay_sales: sql`total_instapay_sales + ${totalSale}`,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', payload.tripId)
          .where('tenant_id', '=', tenantId)
          .execute();
      } else if (isCard) {
        await trxAny
          .updateTable('van_sales_trips')
          .set({
            sales_amount: sql`sales_amount + ${totalSale}`,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', payload.tripId)
          .where('tenant_id', '=', tenantId)
          .execute();
      } else if (isCredit) {
        await trxAny
          .updateTable('van_sales_trips')
          .set({
            sales_amount: sql`sales_amount + ${totalSale}`,
            credit_sales: sql`credit_sales + ${totalSale}`,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', payload.tripId)
          .where('tenant_id', '=', tenantId)
          .execute();

        if (resolvedCustomerId) {
          const updatedCust = await trxAny
            .updateTable('customers')
            .set({ balance: sql`COALESCE(balance, 0) + ${totalSale}`, updated_at: sql`NOW()` })
            .where('id', '=', resolvedCustomerId)
            .where('tenant_id', '=', tenantId)
            .returning(['balance'])
            .executeTakeFirst();
          const balanceAfter = Number(updatedCust?.balance || 0);

          await trxAny
            .insertInto('customer_ledger')
            .values({
              customer_id: resolvedCustomerId,
              entry_type: 'sale_credit',
              amount: totalSale,
              balance_after: balanceAfter,
              note: `فاتورة بيع آجل ميدانية من المندوب (#${docNo})`,
              reference_type: 'sale',
              reference_id: createdSaleId,
              van_trip_id: payload.tripId,
              tenant_id: tenantId,
              account_id: accountId,
            })
            .execute();
        }
      } else if (isSplit) {
        await trxAny
          .updateTable('van_sales_trips')
          .set({
            sales_amount: sql`sales_amount + ${totalSale}`,
            cash_collected: sql`cash_collected + ${cashPaid}`,
            credit_sales: sql`credit_sales + ${creditOwed}`,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', payload.tripId)
          .where('tenant_id', '=', tenantId)
          .execute();

        if (resolvedCustomerId && creditOwed > 0) {
          const updatedCust = await trxAny
            .updateTable('customers')
            .set({ balance: sql`COALESCE(balance, 0) + ${creditOwed}`, updated_at: sql`NOW()` })
            .where('id', '=', resolvedCustomerId)
            .where('tenant_id', '=', tenantId)
            .returning(['balance'])
            .executeTakeFirst();
          const balanceAfter = Number(updatedCust?.balance || 0);

          await trxAny
            .insertInto('customer_ledger')
            .values({
              customer_id: resolvedCustomerId,
              entry_type: 'sale_credit',
              amount: creditOwed,
              balance_after: balanceAfter,
              note: `فاتورة بيع ميدانية مجزأة (#${docNo}) - مسدد نقداً: ${cashPaid.toFixed(2)}، متبقي آجل: ${creditOwed.toFixed(2)}`,
              reference_type: 'sale',
              reference_id: createdSaleId,
              van_trip_id: payload.tripId,
              tenant_id: tenantId,
              account_id: accountId,
            })
            .execute();
        }
      }

      // Post GL journal after customer_ledger so split sales can read their exact credit portion
      // Field stock, rep custody, customer debt and GL either all commit or all roll back.
      await this.accountingPosting.postSale(trx, createdSaleId, systemAuth);
      await this.accountingPosting.clearPostingFailure(trx, { tenantId, accountId }, 'sale', createdSaleId);

      // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): one audit row per
      // field sale, in this same transaction — a rolled-back sale
      // leaves no audit trace, and a committed sale always has one.
      // The actor is the selling rep's linked login (resolved before
      // the transaction above); a rep with no linked login records
      // created_by null and is named in the details. The
      // function-check guards harnesses that pass a `{}` audit stub;
      // in production Nest always injects the real AuditService.
      if (this.audit && typeof this.audit.logWithExecutor === 'function') {
        await this.audit.logWithExecutor(
          trx,
          'بيع ميداني',
          `باع المندوب ${auditActor.repName} (#${Number(repId)}) الفاتورة ${docNo} للعميل ${customerName} بقيمة ${toBookMoney(totalSale)} (${payload.paymentMethod}) — نقداً ${toBookMoney(cashPaid)}، آجل ${toBookMoney(creditOwed)}`,
          { userId: auditActor.userId, tenantId, accountId },
          { eventCode: AUDIT_EVENT_CODES.VAN_FIELD_SALE },
        );
      }
    });

    return {
      ok: true,
      saleId: createdSaleId,
      docNo,
      // Echo the stored book-digits values exactly: re-rounding the
      // return at 2dp would report 100.13 for a stored 100.125 sale.
      total: toBookMoney(totalSale),
      subtotal: toBookMoney(subtotalSale),
      discount: toBookMoney(discountSale),
      paymentMethod: payload.paymentMethod,
      customerName,
      itemsCount: payload.items.length,
      cashPaid,
      creditOwed,
    };
  }

  /**
   * Lists field sales executed by or assigned to a delivery representative,
   * supporting filtering by date scope, customer, payment method, or search query.
   * Includes line items for seamless reprinting on thermal receipts or sharing.
   */
  async listDriverSales(
    tenantId: string,
    repId: number,
    filters?: {
      dateScope?: 'today' | 'yesterday' | 'week' | 'all';
      customerId?: number;
      paymentMethod?: string;
      search?: string;
      tripId?: number;
      limit?: number;
    },
  ) {
    let query = this.anyDb
      .selectFrom('sales as s')
      .leftJoin('customers as c', 'c.id', 's.customer_id')
      .leftJoin('delivery_representatives as dr', 'dr.id', 's.delivery_rep_id')
      .leftJoin('van_sales_trips as vt', 'vt.id', 's.van_trip_id')
      .leftJoin('fleet_vehicles as fv', 'fv.id', 'vt.vehicle_id')
      .select([
        's.id',
        's.doc_no as docNo',
        sql<number>`cast(s.total as numeric)`.as('total'),
        sql<number>`cast(coalesce(s.subtotal, s.total) as numeric)`.as('subtotal'),
        sql<number>`cast(coalesce(s.discount, 0) as numeric)`.as('discount'),
        's.payment_type as paymentMethod',
        's.payment_channel as paymentChannel',
        's.created_at as createdAt',
        's.packaging_breakdown as packagingBreakdown',
        's.delivery_proof_photo as deliveryProofPhoto',
        's.customer_id as customerId',
        'c.name as customerName',
        'c.phone as customerPhone',
        sql<string | null>`null`.as('customerCode'),
        'c.address as customerAddress',
        sql<string>`coalesce(dr.name, '')`.as('repName'),
        sql<string>`coalesce(fv.plate_number, dr.vehicle_plate, '')`.as('vehiclePlate'),
        'vt.id as tripId',
      ])
      .where('s.tenant_id', '=', tenantId)
      .where((eb: any) =>
        eb.or([
          eb('s.delivery_rep_id', '=', repId),
          eb('vt.rep_id', '=', repId),
        ]),
      );

    if (filters?.customerId) {
      query = query.where('s.customer_id', '=', filters.customerId);
    }

    if (filters?.paymentMethod && filters.paymentMethod !== 'all') {
      query = query.where('s.payment_type', '=', filters.paymentMethod);
    }

    if (filters?.tripId) {
      query = query.where('s.van_trip_id', '=', filters.tripId);
    }

    if (filters?.search && filters.search.trim()) {
      const q = `%${filters.search.trim()}%`;
      query = query.where((eb: any) =>
        eb.or([
          eb('s.doc_no', 'ilike', q),
          eb('c.name', 'ilike', q),
          eb('c.phone', 'ilike', q),
        ]),
      );
    }

    if (filters?.dateScope && filters.dateScope !== 'all') {
      const now = new Date();
      if (filters.dateScope === 'today') {
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        query = query.where('s.created_at', '>=', startOfToday);
      } else if (filters.dateScope === 'yesterday') {
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
        query = query.where('s.created_at', '>=', startOfYesterday).where('s.created_at', '<', startOfToday);
      } else if (filters.dateScope === 'week') {
        const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0);
        query = query.where('s.created_at', '>=', startOfWeek);
      }
    }

    const maxLimit = Math.min(Number(filters?.limit || 100), 200);
    const rows = await query.orderBy('s.id', 'desc').limit(maxLimit).execute();

    if (!rows.length) {
      return [];
    }

    const saleIds = rows.map((r: any) => Number(r.id));
    const items = await this.anyDb
      .selectFrom('sale_items as si')
      .select([
        'si.sale_id as saleId',
        'si.product_id as productId',
        'si.product_name as name',
        sql<number>`cast(si.qty as numeric)`.as('qty'),
        sql<number>`cast(si.unit_price as numeric)`.as('unitPrice'),
        sql<number>`cast(si.line_total as numeric)`.as('lineTotal'),
        // INV-VAN-PIECE-COUNT-BASIS: the history fallback counts
        // pieces as qty x unitMultiplier, so the multiplier must be
        // carried with the item (sale_items.qty is in sale units).
        sql<number>`cast(coalesce(si.unit_multiplier, 1) as numeric)`.as('unitMultiplier'),
        sql<number>`cast(si.consumer_price as numeric)`.as('consumerPrice'),
        'si.pricing_tier_type as pricingTierType',
        sql<number>`cast(si.unit_offer_savings as numeric)`.as('unitOfferSavings'),
      ])
      .where('si.tenant_id', '=', tenantId)
      .where('si.sale_id', 'in', saleIds)
      .orderBy('si.id', 'asc')
      .execute();

    const itemsBySaleId = new Map<number, any[]>();
    for (const item of items) {
      const sId = Number(item.saleId);
      if (!itemsBySaleId.has(sId)) {
        itemsBySaleId.set(sId, []);
      }
      itemsBySaleId.get(sId)!.push({
        productId: Number(item.productId),
        name: item.name,
        qty: Number(item.qty),
        unitPrice: Number(item.unitPrice),
        lineTotal: Number(item.lineTotal),
        consumerPrice: item.consumerPrice != null ? Number(item.consumerPrice) : null,
        pricingTierType: item.pricingTierType || null,
        unitOfferSavings: item.unitOfferSavings != null ? Number(item.unitOfferSavings) : 0,
      });
    }

    return rows.map((r: any) => {
      let packagingBreakdown = null;
      if (r.packagingBreakdown) {
        try {
          packagingBreakdown = typeof r.packagingBreakdown === 'string'
            ? JSON.parse(r.packagingBreakdown)
            : r.packagingBreakdown;
        } catch {}
      }

      const saleItems = itemsBySaleId.get(Number(r.id)) || [];

      return {
        id: Number(r.id),
        docNo: r.docNo,
        total: Number(r.total),
        subtotal: Number(r.subtotal),
        discount: Number(r.discount),
        paymentMethod: r.paymentMethod || 'cash',
        createdAt: r.createdAt,
        packagingBreakdown,
        deliveryProofPhoto: r.deliveryProofPhoto || null,
        customerId: r.customerId ? Number(r.customerId) : null,
        customerName: r.customerName || 'عميل نقدي',
        customerPhone: r.customerPhone || null,
        customerCode: r.customerId ? normalizeCustomerCode(r.customerCode, r.customerId) : null,
        customerAddress: r.customerAddress || null,
        repName: r.repName || 'مندوب التوزيع',
        vehiclePlate: r.vehiclePlate || null,
        tripId: r.tripId ? Number(r.tripId) : null,
        itemsCount: saleItems.length,
        items: saleItems,
      };
    });
  }
}
