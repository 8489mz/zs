/*
 * Collections + damaged swaps (van-sales split-3 out of VanSalesService).
 * Pure move: the 9 field-collection / damaged-swap / rep-scope methods,
 * unchanged, behind the VanSalesService delegating facade. The facade owns
 * the injected services; this service receives them bound via
 * VanCollectionsAndSwapsDeps, so the moved bodies are byte-identical to
 * the originals. recordFieldCollection itself STAYS in the facade: specs
 * monkey-patch recordFieldCollectionInternal on the facade instance and
 * read the static dedup maps off VanSalesService, so the outer wrapper
 * and its statics are the seam and must not move.
 */
import { Kysely, sql } from '../../../database/kysely';
import { AuditService, AUDIT_EVENT_CODES } from '../../../core/audit/audit.service';
import { AppError } from '../../../common/errors/app-error';
import { Database } from '../../../database/database.types';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { evaluateFieldCardPayment, evaluateDamagedSwap } from '../van-trip-reconciliation.engine';
import { getCustomerRepBalancesMap, fieldCollectionPaymentScope, resolveFieldCollectionChannel, resolveVanMoneyAuditActor } from './van-common.util';
import { extractCoordinatesFromCustomerLocation, evaluateGeofenceCompliance, isValidCoordinatePair, extractAssignedRepIds, loadRepPermissions, resolveIsolatedRepCustomerBalance, validateIsolatedRepCollection } from '../rep-target.engine';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { VanFraudRadarService, RecordVanSuspicionParams } from './van-fraud-radar.service';

export type VanCollectionsAndSwapsDeps = {
  db: Kysely<Database>;
  audit: AuditService;
  accountingPosting: AccountingPostingService;
  vanFraudRadarService: VanFraudRadarService;
  generateDailySequenceNumber: (trxOrDb: any, tableName: string, columnName: string, prefix: string, tenantId: string, date?: Date) => Promise<string>;
  recordSuspicionEvent: (params: RecordVanSuspicionParams) => Promise<void>;
  resolveSystemAuthContext: (tenantId: string, accountId: string, repId?: number | null) => Promise<AuthContext>;
  verifySupervisorPin: (tenantId: string, pinInput?: string | null, repId?: number | null, queryable?: any, accountId?: string | null) => Promise<{ approved: boolean; supervisorId?: number; supervisorName?: string; supervisorRole?: string; approvalMode?: 'pin' | 'account' }>;
  moveVanStock: (trx: Kysely<Database>, params: { productId: number; delta: number; locationId: number; branchId?: number | null; tenantId: string; accountId: string; userId?: number | null; movementType: string; note: string; referenceType: string; referenceId: number; skipGlobalUpdate: boolean; unitCost?: number }) => Promise<{ scopeBefore: number; scopeAfter: number }>;
};

export class VanCollectionsAndSwapsService {
  private readonly db: Kysely<Database>;
  private readonly audit: AuditService;
  private readonly accountingPosting: AccountingPostingService;
  private readonly vanFraudRadarService: VanFraudRadarService;
  private readonly generateDailySequenceNumber: VanCollectionsAndSwapsDeps['generateDailySequenceNumber'];
  private readonly recordSuspicionEvent: VanCollectionsAndSwapsDeps['recordSuspicionEvent'];
  private readonly resolveSystemAuthContext: VanCollectionsAndSwapsDeps['resolveSystemAuthContext'];
  private readonly verifySupervisorPin: VanCollectionsAndSwapsDeps['verifySupervisorPin'];
  private readonly moveVanStock: VanCollectionsAndSwapsDeps['moveVanStock'];

  constructor(deps: VanCollectionsAndSwapsDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.accountingPosting = deps.accountingPosting;
    this.vanFraudRadarService = deps.vanFraudRadarService;
    this.generateDailySequenceNumber = deps.generateDailySequenceNumber;
    this.recordSuspicionEvent = deps.recordSuspicionEvent;
    this.resolveSystemAuthContext = deps.resolveSystemAuthContext;
    this.verifySupervisorPin = deps.verifySupervisorPin;
    this.moveVanStock = deps.moveVanStock;
  }

  private get anyDb(): any {
    return this.db as any;
  }

  async recordFieldCollectionInternal(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      customerId: number;
      amount: number;
      paymentMethod?: 'cash' | 'instapay' | 'vodafone_cash' | 'bank_transfer';
      transferReference?: string;
      transferReceiptUrl?: string;
      supervisorOverridePin?: string;
      notes?: string;
      gpsLat?: number;
      gpsLng?: number;
      clientTxId?: string;
    },
  ) {
    const amount = Number(payload.amount || 0);

    // H9 (D4 + B10): a cash collection is gated on the acting rep's
    // can_collect_cash flag, read on the pool handle before any
    // write. Non-cash channels (instapay / vodafone_cash /
    // bank_transfer — resolved by the same channel rule the posting
    // uses, so an omitted paymentMethod counts as cash) are
    // unaffected: they keep the existing supervisor-PIN + reference
    // evidence gate below. The refusal happens before the trip and
    // customer reads, so a forbidden rep learns nothing about the
    // trip or customer from the attempt.
    if (resolveFieldCollectionChannel(payload.paymentMethod) === 'cash') {
      const repFlags = await loadRepPermissions(this.anyDb, tenantId, repId);
      if (!repFlags.can_collect_cash) {
        await this.recordSuspicionEvent({
          tenantId,
          accountId,
          repId,
          tripId: payload.tripId,
          customerId: payload.customerId,
          eventCode: 'VAN_SUSPICION_CASH_COLLECTION_FLAG',
          severity: 'high',
          titleAr: 'محاولة تحصيل نقدي بدون صلاحية تحصيل نقدي (can_collect_cash مغلقة)',
          detailsAr: `حاول المندوب تحصيل مبلغ نقدي بقيمة ${amount} ج.م رغم أن صلاحية التحصيل النقدي (can_collect_cash) مغلقة له.`,
          attemptedAmount: amount,
        });
        throw new AppError(
          'صلاحية التحصيل النقدي (can_collect_cash) مغلقة لهذا المندوب، فلا يمكنه تحصيل نقدية ميدانياً',
          'REP_CANNOT_COLLECT_CASH',
          403,
        );
      }
    }

    const trip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .leftJoin('stock_locations as van', 'van.id', 'vt.van_location_id')
      .select(['vt.id', 'vt.status', 'vt.settlement_status', 'vt.van_location_id', 'van.branch_id as vanBranchId'])
      .where('vt.id', '=', payload.tripId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.rep_id', '=', repId)
      .executeTakeFirst();

    if (!trip || trip.status !== 'open') throw new AppError('رحلة التوزيع المحددة مغلقة أو تمت تصفيتها، ولا يمكن تسجيل تحصيل جديد عليها', 'INVALID_TRIP', 400);

    const cust = await this.anyDb.selectFrom('customers').select(['id', 'name']).where('id', '=', payload.customerId).where('tenant_id', '=', tenantId).executeTakeFirst();
    if (!cust) throw new AppError('العميل غير موجود', 'CUSTOMER_NOT_FOUND', 404);

    let branchId = trip.vanBranchId ? Number(trip.vanBranchId) : null;
    let vanLocId = trip.van_location_id ? Number(trip.van_location_id) : null;
    let receiptNo = '';
    let finalBalance = 0;
    let repPreviousBalance = 0;
    let repNewBalance = 0;

    // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): the posting identity
    // and the audit actor are resolved here, on the pool handle
    // BEFORE the transaction starts (P2 pattern — same hoist as the
    // field sale above). The posting identity prefers the acting
    // rep's linked login over the tenant's first active user.
    const systemAuth = await this.resolveSystemAuthContext(tenantId, accountId, repId);
    const auditActor = await resolveVanMoneyAuditActor(this.anyDb, tenantId, repId);

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;

      // INV-VAN-TRIP-LOCKED-STATE-RECHECK: the trip read above runs on
      // an unlocked handle, so a trip settled between it and this
      // transaction would still collect cash into a closed trip.
      // Re-read the governing row under lock FIRST, before the
      // customer lock and any other work, and collect only from the
      // locked row's location/branch.
      const lockedTrip = await trxAny
        .selectFrom('van_sales_trips')
        .select(['id', 'van_location_id', 'status'])
        .where('id', '=', payload.tripId)
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .forUpdate()
        .executeTakeFirst();
      if (!lockedTrip || lockedTrip.status !== 'open') {
        throw new AppError('رحلة التوزيع المحددة مغلقة أو تمت تصفيتها، ولا يمكن تسجيل تحصيل جديد عليها', 'INVALID_TRIP', 400);
      }
      vanLocId = lockedTrip.van_location_id ? Number(lockedTrip.van_location_id) : null;
      const lockedVanLocRow = vanLocId
        ? await trxAny
          .selectFrom('stock_locations')
          .select(['branch_id'])
          .where('id', '=', vanLocId)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst()
        : null;
      const lockedBranchId = lockedVanLocRow?.branch_id ? Number(lockedVanLocRow.branch_id) : null;
      branchId = lockedBranchId;

      // INV-VAN-FIELD-NONCASH-EVIDENCE-GATE: a non-cash field
      // collection (instapay / vodafone_cash / bank_transfer) is
      // posted straight to bank 1120 by postVanFieldCollection, so
      // it needs the same evidence as a card sale — supervisor PIN
      // + a transfer reference of at least 3 chars — or it is
      // refused here, inside the same transaction and after the
      // locked-trip recheck above, before any balance moves. Cash
      // collections are untouched: the cash stays in rep custody
      // until settleTrip. The gate is evaluateFieldCardPayment
      // itself, not a second copy of it; only the PIN is verified
      // first (on this transaction handle, never the pool — a pool
      // read inside the open transaction deadlocks on PGlite).
      const isNonCashCollection =
        payload.paymentMethod === 'instapay' ||
        payload.paymentMethod === 'vodafone_cash' ||
        payload.paymentMethod === 'bank_transfer';
      if (isNonCashCollection && amount > 0) {
        let collectionSupervisorApproved = false;
        let collectionSupervisorId: number | null = null;
        let collectionSupervisorName = '';
        if (payload.supervisorOverridePin) {
          const pinVerification = await this.verifySupervisorPin(
            tenantId,
            payload.supervisorOverridePin,
            repId,
            trxAny,
            accountId,
          );
          collectionSupervisorApproved = pinVerification.approved;
          collectionSupervisorId = pinVerification.supervisorId ?? null;
          collectionSupervisorName = pinVerification.supervisorName ?? '';
        }
        const evidenceCheck = evaluateFieldCardPayment({
          totalSaleAmount: amount,
          referenceReason: payload.transferReference || payload.notes,
          supervisorOverride: collectionSupervisorApproved
            ? {
                approved: true,
                supervisorId: collectionSupervisorId || undefined,
                supervisorName: collectionSupervisorName,
                // No invented fallback here: a collection settles a
                // pre-existing customer debt straight to bank 1120,
                // so the reference is the only audit trail tying the
                // bank receipt to the customer — it must be a real
                // transfer reference (or note) of at least 3 chars.
                reason: payload.transferReference || payload.notes || undefined,
              }
            : undefined,
        });
        if (!evidenceCheck.allowed) {
          await this.vanFraudRadarService.recordSuspicionEvent({
            tenantId,
            accountId,
            repId,
            tripId: payload.tripId,
            customerId: payload.customerId,
            customerName: cust.name,
            eventCode: 'VAN_SUSPICION_FAKE_ELECTRONIC_COLLECTION',
            severity: 'critical',
            titleAr: 'محاولة تسجيل تحصيل إلكتروني وهمي بدون اعتماد مشرف أو رقم إيصال',
            detailsAr: `حاول المندوب تسجيل تحصيل بقيمة ${amount} ج.م كدفع إلكتروني (${payload.paymentMethod}) لتجنب مطالبته بتوريد الكاش بالتصفية، دون اعتماد مشرف أو رقم مرجع تحويل.`,
            attemptedAmount: amount,
          });
          throw new AppError(
            evidenceCheck.errorMessageAr || 'التحصيل الإلكتروني في الميدان يتطلب اعتماد المشرف ورقم مرجع التحويل',
            evidenceCheck.reasonCode || 'CARD_PAYMENT_REQUIRES_SUPERVISOR_PIN',
            403,
          );
        }
      }

      const lockedCust = await trxAny
        .selectFrom('customers')
        .select(['id', 'name', 'balance', 'metadata'])
        .where('id', '=', payload.customerId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!lockedCust) {
        throw new AppError('العميل غير موجود', 'CUSTOMER_NOT_FOUND', 404);
      }

      // Security Invariant: Geofence Audit on Collections
      if (payload.gpsLat != null && payload.gpsLng != null) {
        let custMeta: any = {};
        if (typeof lockedCust.metadata === 'string') {
          try { custMeta = JSON.parse(lockedCust.metadata); } catch { custMeta = {}; }
        } else if (lockedCust.metadata && typeof lockedCust.metadata === 'object') {
          custMeta = lockedCust.metadata;
        }
        const custCoords = extractCoordinatesFromCustomerLocation({
          metadata: custMeta,
          locationUrl: (lockedCust as any).location_url || custMeta?.location_url || custMeta?.locationUrl,
        });
        if (custCoords && isValidCoordinatePair(custCoords.lat, custCoords.lng)) {
          const geo = evaluateGeofenceCompliance({
            repLat: Number(payload.gpsLat),
            repLng: Number(payload.gpsLng),
            customerLat: custCoords.lat,
            customerLng: custCoords.lng,
            maxAllowedMeters: 200,
          });
          if (geo.status === 'outside_geofence' || geo.isCompliant === false) {
            await this.vanFraudRadarService.recordSuspicionEvent({
              tenantId,
              accountId,
              repId,
              tripId: payload.tripId,
              customerId: payload.customerId,
              customerName: lockedCust.name,
              eventCode: 'VAN_SUSPICION_GEOFENCE_VIOLATION',
              severity: 'high',
              titleAr: 'تحصيل نقدية خارج النطاق الجغرافي لدكان العميل',
              detailsAr: `قام المندوب بتسجيل سند تحصيل بقيمة ${amount} ج.م للعميل "${lockedCust.name}" وهو يبعد مسافة (${geo.distanceMeters} متر) عن موقع المحل المسجل (المسموح ${geo.maxAllowedMeters}م).`,
              amountInvolved: amount,
              metadata: {
                distanceMeters: geo.distanceMeters,
                maxAllowedMeters: geo.maxAllowedMeters,
                repLat: payload.gpsLat,
                repLng: payload.gpsLng,
                customerLat: custCoords.lat,
                customerLng: custCoords.lng,
              },
            });
          }
        }
      }

      const currentCompanyBalance = Number(lockedCust.balance || 0);
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trxAny, tenantId));
      const repBalancesMap = await getCustomerRepBalancesMap(trxAny, tenantId, {
        customerIds: [payload.customerId],
        customerTotalBalances: { [payload.customerId]: currentCompanyBalance },
        moneyDigits,
      });

      const assignedRepIds = extractAssignedRepIds(lockedCust.metadata);
      const isolated = resolveIsolatedRepCustomerBalance({
        repId: Number(repId),
        breakdown: repBalancesMap.get(payload.customerId),
        assignedRepIds,
        fallbackTotalBalance: currentCompanyBalance,
        moneyDigits,
      });

      const validation = validateIsolatedRepCollection({
        repId: Number(repId),
        collectionAmount: amount,
        repBalance: isolated.repBalance,
        otherRepsBalance: isolated.otherRepsBalance,
        totalCustomerBalance: isolated.totalCustomerBalance,
        moneyDigits,
      });

      if (!validation.allowed) {
        await this.recordSuspicionEvent({
          tenantId,
          accountId,
          repId,
          tripId: payload.tripId,
          customerId: payload.customerId,
          customerName: String(lockedCust.name || cust.name || ''),
          eventCode: AUDIT_EVENT_CODES.VAN_SUSPICION_CROSS_REP_COLLECTION,
          severity: 'high',
          titleAr: 'محاولة تحصيل مديونية تخص مندوباً آخر على عميل مشترك',
          detailsAr:
            validation.errorMessage ||
            `حاول المندوب تحصيل مبلغ (${amount}) من العميل "${lockedCust.name}" بينما رصيده المعزول لدى العميل (${isolated.repBalance}) ومديونية المناديب الآخرين (${isolated.otherRepsBalance}).`,
          amountInvolved: amount,
          metadata: {
            repBalance: isolated.repBalance,
            otherRepsBalance: isolated.otherRepsBalance,
            totalCustomerBalance: isolated.totalCustomerBalance,
            errorCode: validation.errorCode,
          },
        });
        throw new AppError(
          validation.errorMessage || 'لا يمكن تحصيل مديونية تخص مندوباً آخر',
          validation.errorCode || 'REP_ISOLATED_BALANCE_EXCEEDED',
          422,
        );
      }

      repPreviousBalance = validation.repPreviousBalance;
      repNewBalance = validation.repNewBalance;

      const updatedCust = await trxAny
        .updateTable('customers')
        .set({ balance: sql`COALESCE(balance, 0) - ${amount}`, updated_at: sql`NOW()` })
        .where('id', '=', payload.customerId)
        .where('tenant_id', '=', tenantId)
        .returning(['balance'])
        .executeTakeFirst();
      finalBalance = Number(updatedCust?.balance || 0);

      // INV-REP-COLLECTION-TOTAL-BALANCE-CAP (defence in depth): the
      // engine gate above refuses any collection above the customer's
      // total debt, so this must never fire — but the write itself must
      // never commit a negative customer balance even if a future
      // caller reaches it without the gate. Throwing here rolls the
      // whole collection transaction back. The comparison is at book
      // digits so a sub-minor-unit residue in a legacy balance cannot
      // refuse a collection the gate allowed.
      if (roundMoney(finalBalance, moneyDigits) < 0) {
        throw new AppError(
          `لا يمكن تحصيل مبلغ (${amount} ج.م) من العميل "${lockedCust.name}" أكبر من مديونية العميل — الرصيد بعد التحصيل سالب (${finalBalance} ج.م)`,
          'REP_COLLECTION_EXCEEDS_TOTAL_BALANCE',
          422,
        );
      }

      const isInstapayCollection = payload.paymentMethod === 'instapay' || payload.paymentMethod === 'vodafone_cash' || payload.paymentMethod === 'bank_transfer';
      const defaultColNote = isInstapayCollection
        ? `سند تحصيل إلكتروني (${payload.paymentMethod === 'vodafone_cash' ? 'فودافون كاش' : 'إنستاباي/تحويل'}) بواسطة المندوب`
        : `سند تحصيل نقدي ميداني بواسطة المندوب`;

      const insertedPayment = await trxAny
        .insertInto('customer_payments')
        .values({
          customer_id: payload.customerId,
          amount: amount,
          note: payload.notes || defaultColNote,
          transfer_reference: payload.transferReference || null,
          transfer_receipt_url: payload.transferReceiptUrl || null,
          tenant_id: tenantId,
          account_id: accountId,
          ...fieldCollectionPaymentScope({
            tripId: payload.tripId,
            repId,
            paymentMethod: payload.paymentMethod,
            clientTxId: payload.clientTxId,
          }),
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      receiptNo = await this.generateDailySequenceNumber(trxAny, 'customer_payments', 'note', 'COL', tenantId);
      const finalNote = payload.clientTxId
        ? `${payload.notes || defaultColNote} (#${receiptNo}) [tx:${payload.clientTxId}]`
        : payload.notes || `${defaultColNote} (#${receiptNo})`;

      await trxAny
        .updateTable('customer_payments')
        .set({ note: finalNote })
        .where('id', '=', insertedPayment.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      await trxAny
        .insertInto('customer_ledger')
        .values({
          customer_id: payload.customerId,
          entry_type: 'payment',
          amount: -amount,
          balance_after: finalBalance,
          note: finalNote,
          reference_type: 'van_collection',
          reference_id: payload.tripId,
          van_trip_id: payload.tripId,
          gps_lat: payload.gpsLat != null ? Number(payload.gpsLat) : null,
          gps_lng: payload.gpsLng != null ? Number(payload.gpsLng) : null,
          tenant_id: tenantId,
          account_id: accountId,
        })
        .execute();

      if (isInstapayCollection) {
        await trxAny
          .updateTable('van_sales_trips')
          .set({
            total_instapay_collections: sql`total_instapay_collections + ${amount}`,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', payload.tripId)
          .where('tenant_id', '=', tenantId)
          .execute();
      } else {
        await trxAny
          .updateTable('van_sales_trips')
          .set({
            cash_collected: sql`cash_collected + ${amount}`,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', payload.tripId)
          .where('tenant_id', '=', tenantId)
          .execute();
      }

      // The cash just collected is with the rep, not the till, until settleTrip — this only moves
      // the debt off the customer's receivable and into the same pooled bucket postVanTripSettlement
      // later clears against real cash.
      await this.accountingPosting.postVanFieldCollection(
        trx,
        Number(insertedPayment.id),
        { amount, customerId: payload.customerId, branchId, locationId: vanLocId, paymentMethod: payload.paymentMethod || 'cash', transferReference: payload.transferReference },
        systemAuth,
      );

      // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): one audit row per
      // field collection, in this same transaction — a rolled-back
      // collection leaves no audit trace, and a committed one always
      // has one. Replays return before this internal method runs, so
      // a retried collection writes no second row. The actor is the
      // collecting rep's linked login (resolved before the
      // transaction above); a rep with no linked login records
      // created_by null and is named in the details. The
      // function-check guards harnesses that pass a `{}` audit stub.
      if (this.audit && typeof this.audit.logWithExecutor === 'function') {
        await this.audit.logWithExecutor(
          trx,
          'تحصيل ميداني',
          `حصّل المندوب ${auditActor.repName} (#${Number(repId)}) مبلغ ${amount} (${resolveFieldCollectionChannel(payload.paymentMethod)}) من العميل ${cust.name} (#${Number(payload.customerId)}) على الرحلة #${Number(payload.tripId)} — إيصال ${receiptNo}، الرصيد ${repPreviousBalance} ← ${repNewBalance}`,
          { userId: auditActor.userId, tenantId, accountId },
          { eventCode: AUDIT_EVENT_CODES.VAN_FIELD_COLLECTION },
        );
      }
    });

    return {
      ok: true,
      receiptNo,
      amount,
      customerName: cust.name,
      previousBalance: repPreviousBalance,
      newBalance: repNewBalance,
    };
  }

  /**
   * Instant Field Damaged / Broken Goods Swap (استبدال التالف والمعيب الفوري في الميدان).
   * Swaps damaged/crushed/expired goods on the spot from the vehicle.
   * Decrements replacement product stock from van, increments damaged stock in van,
   * calculates any price variance, and updates customer balance if customer has an account.
   */
  async executeDamagedSwap(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      customerId?: number;
      damagedProductId: number;
      damagedQty: number;
      damageReason?: string;
      replacementProductId: number;
      replacementQty: number;
      notes?: string;
      clientTxId?: string;
    },
  ): Promise<{
    ok: boolean;
    swapId: number;
    damagedProductName: string;
    replacementProductName: string;
    damagedQty: number;
    replacementQty: number;
    priceDifference: number;
    messageAr: string;
  }> {
    // INV-VAN-DAMAGED-SWAP-JOURNAL-QUARANTINE: idempotent replay
    // BEFORE the trip-open check — a retry may arrive after the trip
    // closed, and it must return the original swap, not INVALID_TRIP.
    if (payload.clientTxId) {
      const prior = await this.findSwapByClientTxId(this.anyDb, tenantId, payload.tripId, payload.clientTxId);
      if (prior) return this.buildDamagedSwapResult(this.anyDb, tenantId, prior);
    }

    const trip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .select(['vt.id', 'vt.status', 'vt.van_location_id', 'vt.source_warehouse_id'])
      .where('vt.id', '=', payload.tripId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.rep_id', '=', repId)
      .executeTakeFirst();

    if (!trip || trip.status !== 'open') {
      throw new AppError('رحلة التوزيع المحددة مغلقة أو تمت تصفيتها، ولا يمكن تسجيل استبدال عليها', 'INVALID_TRIP', 400);
    }

    // Resolved on the pool handle BEFORE the transaction: the journal
    // posts on the tx handle, and a pool read inside an open PGlite
    // transaction waits forever on the single connection.
    const systemAuth = await this.resolveSystemAuthContext(tenantId, accountId);

    const damagedPid = Number(payload.damagedProductId);
    const replacementPid = Number(payload.replacementProductId);
    const damagedQty = Number(payload.damagedQty || 0);
    const replacementQty = Number(payload.replacementQty || 0);

    if (damagedQty <= 0 || replacementQty <= 0) {
      throw new AppError('كمية التالف وكمية البديل يجب أن تكون أكبر من الصفر', 'INVALID_QUANTITY', 400);
    }

    let createdSwapId = 0;
    let damagedProdName = '';
    let replacementProdName = '';
    let priceDiff = 0;
    // Set inside the transaction when the in-tx replay check finds the
    // original swap (race window between the pre-tx check and this tx).
    let replayedSwap: any = null;

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;
      // Book digits resolved once on THIS transaction handle (D4).
      const bookDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));

      // Lock the trip row FIRST: it serializes concurrent swaps and
      // retries on this trip, so the in-tx idempotency check below
      // cannot race a twin transaction (a FOR UPDATE read that finds
      // zero rows locks nothing — the trip row always exists here).
      const lockedTrip = await trxAny
        .selectFrom('van_sales_trips')
        .select(['id', 'status', 'van_location_id', 'source_warehouse_id'])
        .where('id', '=', payload.tripId)
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .forUpdate()
        .executeTakeFirst();
      if (!lockedTrip || lockedTrip.status !== 'open') {
        throw new AppError('رحلة التوزيع المحددة مغلقة أو تمت تصفيتها، ولا يمكن تسجيل استبدال عليها', 'INVALID_TRIP', 400);
      }
      if (payload.clientTxId) {
        const priorInTx = await this.findSwapByClientTxId(trxAny, tenantId, payload.tripId, payload.clientTxId);
        if (priorInTx) {
          replayedSwap = priorInTx;
          return;
        }
      }
      const vanLocationId = Number(lockedTrip.van_location_id);

      // Canonical Lock Order: sort product IDs ascending to prevent deadlock
      const sortedProductIds = [damagedPid, replacementPid].sort((a, b) => a - b);
      const lockedProds = await trxAny
        .selectFrom('products')
        .select(['id', 'name', 'retail_price', 'wholesale_price', 'cost_price'])
        .where('id', 'in', sortedProductIds)
        .where('tenant_id', '=', tenantId)
        .orderBy('id', 'asc')
        .forUpdate()
        .execute();

      const damagedProd = lockedProds.find((p: any) => Number(p.id) === damagedPid);
      const replacementProd = lockedProds.find((p: any) => Number(p.id) === replacementPid);

      if (!damagedProd) throw new AppError(`الصنف التالف #${damagedPid} غير موجود في النظام`, 'PRODUCT_NOT_FOUND', 404);
      if (!replacementProd) throw new AppError(`الصنف البديل #${replacementPid} غير موجود في النظام`, 'PRODUCT_NOT_FOUND', 404);

      damagedProdName = damagedProd.name || `صنف #${damagedPid}`;
      replacementProdName = replacementProd.name || `صنف #${replacementPid}`;

      // Check current van stock for replacement product
      const vanStockRow = await trxAny
        .selectFrom('product_location_stock')
        .select([sql<number>`cast(coalesce(qty, 0) as numeric)`.as('qty')])
        .where('location_id', '=', vanLocationId)
        .where('product_id', '=', replacementPid)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      const availableVanStock = Number(vanStockRow?.qty || 0);

      const damagedPrice = Number(damagedProd.retail_price || damagedProd.wholesale_price || 0);
      const replacementPrice = Number(replacementProd.retail_price || replacementProd.wholesale_price || 0);

      const evalResult = evaluateDamagedSwap({
        damagedProductId: damagedPid,
        damagedQty,
        damagedUnitPrice: damagedPrice,
        damageReason: payload.damageReason || 'تالف / كسر أثناء التوزيع',
        replacementProductId: replacementPid,
        replacementQty,
        replacementUnitPrice: replacementPrice,
        availableVanStockQty: availableVanStock,
        moneyDigits: bookDigits,
      });

      if (!evalResult.allowed) {
        throw new AppError(evalResult.errorMessageAr || 'تعذر إتمام عملية الاستبدال', evalResult.reasonCode || 'SWAP_REJECTED', 400);
      }

      priceDiff = evalResult.priceDifference;

      // INV-VAN-DAMAGED-SWAP-JOURNAL-QUARANTINE: the damaged qty must
      // NOT return to sellable van stock — mirror the returns path
      // (postVanFieldReturn isDamaged leg / van-returns.service.ts),
      // which routes damaged items to the tenant's damaged location.
      // Fail closed when the tenant has none: silently leaving the
      // damaged qty sellable in the van is worse than refusing the
      // swap. The van itself is never a quarantine target.
      const damagedLoc = await trxAny
        .selectFrom('stock_locations')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('location_type', '=', 'damaged')
        .where('id', '!=', vanLocationId)
        .orderBy('id', 'asc')
        .executeTakeFirst();
      if (!damagedLoc?.id) {
        throw new AppError('لا يوجد موقع تالف مسجّل لهذا النشاط — سجّل موقع مخزون تالف قبل تنفيذ الاستبدال حتى لا يعود التالف مخزوناً قابلاً للبيع', 'SWAP_REJECTED', 400);
      }
      const damagedLocationId = Number(damagedLoc.id);
      const vanLocRow = await trxAny
        .selectFrom('stock_locations')
        .select(['branch_id'])
        .where('id', '=', vanLocationId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      const branchId = vanLocRow?.branch_id ? Number(vanLocRow.branch_id) : null;

      // Deduct replacement stock from van
      await this.moveVanStock(trx, {
        productId: replacementPid,
        delta: -replacementQty,
        locationId: vanLocationId,
        tenantId,
        accountId,
        userId: null,
        movementType: 'van_swap_out',
        note: `استبدال تالف فوري - صرف البديل (${replacementProdName})`,
        referenceType: 'van_sales_trip',
        referenceId: Number(trip.id),
        skipGlobalUpdate: false,
        unitCost: Number(replacementProd.cost_price || 0),
      });

      // Receive damaged stock into the QUARANTINE (damaged) location —
      // never back into the van as sellable stock.
      await this.moveVanStock(trx, {
        productId: damagedPid,
        delta: damagedQty,
        locationId: damagedLocationId,
        tenantId,
        accountId,
        userId: null,
        movementType: 'van_swap_damaged_in',
        note: `استبدال تالف فوري - استلام التالف (${damagedProdName}) إلى موقع التالف [${payload.damageReason || 'كسر/تالف'}]`,
        referenceType: 'van_sales_trip',
        referenceId: Number(trip.id),
        skipGlobalUpdate: false,
        unitCost: Number(damagedProd.cost_price || 0),
      });

      // Record swap row in van_damaged_swaps FIRST: the journal and the
      // ledger row both key on the swap id, never on the trip id.
      const inserted = await trxAny
        .insertInto('van_damaged_swaps')
        .values({
          trip_id: payload.tripId,
          rep_id: repId,
          customer_id: payload.customerId || null,
          damaged_product_id: damagedPid,
          damaged_qty: damagedQty,
          damage_reason: payload.damageReason || 'تالف / كسر أثناء التوزيع',
          replacement_product_id: replacementPid,
          replacement_qty: replacementQty,
          price_difference: priceDiff,
          notes: payload.clientTxId
            ? `${payload.notes || ''} [tx:${payload.clientTxId}]`.trim()
            : payload.notes || null,
          tenant_id: tenantId,
          account_id: accountId,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      createdSwapId = Number(inserted.id);

      // If price difference exists and customer is specified, record difference in customer ledger
      if (priceDiff !== 0 && payload.customerId) {
        const custRecord = await trxAny
          .selectFrom('customers')
          .select(['id', 'balance'])
          .where('id', '=', payload.customerId)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        if (custRecord) {
          const updatedCust = await trxAny
            .updateTable('customers')
            .set({
              balance: sql`coalesce(balance, 0) + ${priceDiff}`,
              updated_at: sql`NOW()`,
            })
            .where('id', '=', payload.customerId)
            .where('tenant_id', '=', tenantId)
            .returning(['balance'])
            .executeTakeFirst();

          await trxAny
            .insertInto('customer_ledger')
            .values({
              customer_id: payload.customerId,
              // 'sale_credit' mislabels this row as a credit sale (trip
              // counters read sale_credit rows as sales); a swap price
              // adjustment is its own kind, and its GL mirror is the
              // 1130 leg of the van_damaged_swap journal below.
              entry_type: 'swap_price_adjustment',
              amount: priceDiff,
              balance_after: Number(updatedCust?.balance || 0),
              note: `فارق سعر استبدال تالف #${createdSwapId}: ${replacementProdName} بدلاً من ${damagedProdName}`,
              reference_type: 'van_swap',
              reference_id: createdSwapId,
              van_trip_id: payload.tripId,
              tenant_id: tenantId,
              account_id: accountId,
            })
            .execute();
        }
      }

      // The balanced GL journal for the whole swap — same transaction
      // as the stock moves, so a failure anywhere rolls everything
      // back together. The journal's 1130 leg mirrors the ledger row
      // above; with no customer there is no receivable leg to mirror.
      await this.accountingPosting.postVanDamagedSwap(
        trx,
        createdSwapId,
        {
          damagedQty,
          damagedUnitCost: Number(damagedProd.cost_price || 0),
          replacementQty,
          replacementUnitCost: Number(replacementProd.cost_price || 0),
          priceDifference: priceDiff,
          customerId: payload.customerId || null,
          branchId,
          locationId: vanLocationId,
          damagedLocationId,
        },
        systemAuth,
      );
    });

    // A twin transaction won the race and this tx replayed: return the
    // original swap, never a second execution.
    if (replayedSwap) {
      return this.buildDamagedSwapResult(this.anyDb, tenantId, replayedSwap);
    }

    return {
      ok: true,
      swapId: createdSwapId,
      damagedProductName: damagedProdName,
      replacementProductName: replacementProdName,
      damagedQty,
      replacementQty,
      priceDifference: priceDiff,
      messageAr: this.damagedSwapMessageAr(damagedQty, damagedProdName, replacementQty, replacementProdName, priceDiff),
    };
  }

  /**
   * Idempotency lookup for damaged swaps. There is no client_tx_id
   * column on van_damaged_swaps (migration 0315 deliberately adds
   * none): the `[tx:clientTxId]` tag in notes is the durable key, the
   * same pattern recordFieldSale uses for sales. `strpos` (not LIKE)
   * makes the match exact — a clientTxId containing LIKE wildcards
   * cannot match a different swap. Callers serialize on the trip row
   * FOR UPDATE before the in-transaction check, so the check is the
   * atomic guard; the swap journal's unique (source_type, source_id)
   * is the second backstop.
   */
  private async findSwapByClientTxId(db: any, tenantId: string, tripId: number, clientTxId: string): Promise<any> {
    const tag = `[tx:${clientTxId}]`;
    return db
      .selectFrom('van_damaged_swaps')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('trip_id', '=', tripId)
      .where(sql<boolean>`strpos(coalesce(notes, ''), ${tag}) > 0`)
      .orderBy('id', 'asc')
      .executeTakeFirst();
  }

  private damagedSwapMessageAr(
    damagedQty: number,
    damagedProdName: string,
    replacementQty: number,
    replacementProdName: string,
    priceDiff: number,
  ): string {
    const diffNote = priceDiff > 0
      ? ` وفارق سعر مستحق على العميل قدره ${priceDiff.toFixed(2)} ج.م`
      : priceDiff < 0
      ? ` وفارق سعر مستحق لصالح العميل قدره ${Math.abs(priceDiff).toFixed(2)} ج.م`
      : ' (استبدال متكافئ 1 لـ 1 بدون فارق سعري)';
    return `تم استبدال ${damagedQty} من (${damagedProdName}) بـ ${replacementQty} من (${replacementProdName}) بنجاح${diffNote}`;
  }

  private async buildDamagedSwapResult(db: any, tenantId: string, row: any): Promise<{
    ok: boolean;
    swapId: number;
    damagedProductName: string;
    replacementProductName: string;
    damagedQty: number;
    replacementQty: number;
    priceDifference: number;
    messageAr: string;
  }> {
    const prodRows = await db
      .selectFrom('products')
      .select(['id', 'name'])
      .where('id', 'in', [Number(row.damaged_product_id), Number(row.replacement_product_id)])
      .where('tenant_id', '=', tenantId)
      .execute();
    const byId = new Map(prodRows.map((p: any) => [Number(p.id), p.name]));
    const damagedQty = Number(row.damaged_qty || 0);
    const replacementQty = Number(row.replacement_qty || 0);
    const priceDifference = Number(row.price_difference || 0);
    const damagedProdName = String(byId.get(Number(row.damaged_product_id)) || `صنف #${Number(row.damaged_product_id)}`);
    const replacementProdName = String(byId.get(Number(row.replacement_product_id)) || `صنف #${Number(row.replacement_product_id)}`);
    return {
      ok: true,
      swapId: Number(row.id),
      damagedProductName: damagedProdName,
      replacementProductName: replacementProdName,
      damagedQty,
      replacementQty,
      priceDifference,
      messageAr: this.damagedSwapMessageAr(damagedQty, damagedProdName, replacementQty, replacementProdName, priceDifference),
    };
  }

  /**
   * INV-DRIVER-PORTAL-REP-SCOPED-READS: rep scoping for driver-portal
   * reads. The trip row owns the read: a rep may only read trip data for
   * trips whose rep_id is his own. Staff callers pass no repId and skip
   * the check (the supervisor view behind a staff session).
   */
  async assertTripOwnedByRep(tenantId: string, tripId: number, repId: number): Promise<void> {
    const trip = await this.anyDb
      .selectFrom('van_sales_trips')
      .select(['id', 'rep_id'])
      .where('id', '=', tripId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!trip) {
      throw new AppError('الرحلة غير موجودة', 'TRIP_NOT_FOUND', 404);
    }
    if (Number((trip as any).rep_id) !== Number(repId)) {
      throw new AppError('غير مصرح لك بالاطلاع على بيانات رحلة مندوب آخر', 'FORBIDDEN', 403);
    }
  }

  /**
   * INV-REP-SCOPED-CUSTOMER-READS (H7/D1+D14): the customer ids this rep
   * has served. One canonical definition, shared by the read scope
   * (getActiveTrip / getDriverTodayItinerary) and the read gate below:
   * a field visit on one of his trips, a pre-sale order assigned to
   * him, or a delivered sale carrying his delivery_rep_id. There is no
   * static customer-to-rep assignment in the schema, so history is the
   * association — plus the explicit metadata assignment, which the
   * callers check separately via extractAssignedRepIds.
   */
  async listRepServedCustomerIds(tenantId: string, repId: number): Promise<Set<number>> {
    const ids = new Set<number>();
    const collect = (rows: any[]): void => {
      for (const row of rows || []) {
        const id = Number((row as any).customer_id ?? (row as any).customerId);
        if (Number.isInteger(id) && id > 0) ids.add(id);
      }
    };
    const [visits, orders, sales] = await Promise.all([
      this.anyDb
        .selectFrom('van_field_visits')
        .select('customer_id')
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .execute(),
      this.anyDb
        .selectFrom('sales_orders')
        .select('customer_id')
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .execute(),
      this.anyDb
        .selectFrom('sales')
        .select('customer_id')
        .where('tenant_id', '=', tenantId)
        .where('delivery_rep_id', '=', repId)
        .execute(),
    ]);
    collect(visits);
    collect(orders);
    collect(sales);
    return ids;
  }

  /**
   * INV-DRIVER-PORTAL-REP-SCOPED-READS: a rep may read a customer's
   * field statement and last sold prices only when the codebase already
   * records him serving that customer: a field visit on one of his
   * trips, a pre-sale order assigned to him, or a delivered sale
   * carrying his delivery_rep_id. There is no static customer-to-rep
   * assignment in the schema, so history is the association. Staff
   * callers pass no repId and skip the check.
   */
  async assertRepServedCustomer(tenantId: string, repId: number, customerId: number): Promise<void> {
    const served = await this.listRepServedCustomerIds(tenantId, repId);
    if (served.has(Number(customerId))) return;
    throw new AppError('غير مصرح لك بالاطلاع على بيانات عميل لا يتبع لك', 'FORBIDDEN', 403);
  }

  async listTripDamagedSwaps(tenantId: string, tripId: number, repId?: number) {
    if (repId != null) {
      await this.assertTripOwnedByRep(tenantId, tripId, repId);
    }
    return this.anyDb
      .selectFrom('van_damaged_swaps as vds')
      .leftJoin('products as dp', 'dp.id', 'vds.damaged_product_id')
      .leftJoin('products as rp', 'rp.id', 'vds.replacement_product_id')
      .leftJoin('customers as c', 'c.id', 'vds.customer_id')
      .select([
        'vds.id',
        'vds.trip_id as tripId',
        'vds.rep_id as repId',
        'vds.customer_id as customerId',
        sql<string>`coalesce(c.name, 'عميل ميداني')`.as('customerName'),
        'vds.damaged_product_id as damagedProductId',
        sql<string>`coalesce(dp.name, 'صنف تالف')`.as('damagedProductName'),
        sql<number>`cast(vds.damaged_qty as numeric)`.as('damagedQty'),
        'vds.damage_reason as damageReason',
        'vds.replacement_product_id as replacementProductId',
        sql<string>`coalesce(rp.name, 'صنف بديل')`.as('replacementProductName'),
        sql<number>`cast(vds.replacement_qty as numeric)`.as('replacementQty'),
        sql<number>`cast(vds.price_difference as numeric)`.as('priceDifference'),
        'vds.notes',
        'vds.created_at as createdAt',
      ])
      .where('vds.trip_id', '=', tripId)
      .where('vds.tenant_id', '=', tenantId)
      .orderBy('vds.id', 'desc')
      .execute();
  }
}
