import { sql } from '../../../../database/kysely';
import { AUDIT_EVENT_CODES } from '../../../../core/audit/audit.service';
import { AppError } from '../../../../common/errors/app-error';
import { evaluateFieldCardPayment } from '../../van-trip-reconciliation.engine';
import {
  getCustomerRepBalancesMap,
  fieldCollectionPaymentScope,
  resolveFieldCollectionChannel,
  resolveVanMoneyAuditActor,
} from '../van-common.util';
import {
  extractCoordinatesFromCustomerLocation,
  evaluateGeofenceCompliance,
  isValidCoordinatePair,
  extractAssignedRepIds,
  loadRepPermissions,
  resolveIsolatedRepCustomerBalance,
  validateIsolatedRepCollection,
} from '../../rep-target.engine';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../../accounting/engines/money-minor-units.engine';
import { offlineSaleTimestamps } from '../../../cash-drawer/helpers/cash-drawer.helper';
import { validateVanOfflineCreatedAt } from '../../van-offline-timestamps.helper';
import type { VanCollectionsAndSwapsDeps } from './van-collections-and-swaps.types';

export class RecordFieldCollectionSlice {
  constructor(private readonly deps: VanCollectionsAndSwapsDeps) {}

  private get anyDb(): any {
    return this.deps.db;
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
      // INV-VAN-OFFLINE-TIMESTAMPS: the instant the collection was
      // made offline (outbox createdAt, ISO with offset). Absent on
      // the online path.
      offlineCreatedAt?: string;
    },
  ) {
    const amount = Number(payload.amount || 0);

    // INV-VAN-OFFLINE-TIMESTAMPS: the gate runs first, before any
    // read — a tampered or stale offline stamp fails fast.
    const offlineCreatedAt = validateVanOfflineCreatedAt(payload.offlineCreatedAt);

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
        await this.deps.recordSuspicionEvent({
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

    if (!trip || trip.status !== 'open')
      throw new AppError(
        'رحلة التوزيع المحددة مغلقة أو تمت تصفيتها، ولا يمكن تسجيل تحصيل جديد عليها',
        'INVALID_TRIP',
        400,
      );

    const cust = await this.anyDb
      .selectFrom('customers')
      .select(['id', 'name'])
      .where('id', '=', payload.customerId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
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
    // rep's linked login; F20 (trial problem 38): a rep with no
    // linked login resolves to userId 0 (NULL created_by
    // downstream), never the tenant's first active user.
    const systemAuth = await this.deps.resolveSystemAuthContext(tenantId, accountId, repId);
    const auditActor = await resolveVanMoneyAuditActor(this.anyDb, tenantId, repId);

    await this.deps.db.transaction().execute(async (trx) => {
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
        throw new AppError(
          'رحلة التوزيع المحددة مغلقة أو تمت تصفيتها، ولا يمكن تسجيل تحصيل جديد عليها',
          'INVALID_TRIP',
          400,
        );
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
          const pinVerification = await this.deps.verifySupervisorPin(
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
          await this.deps.vanFraudRadarService.recordSuspicionEvent({
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
          try {
            custMeta = JSON.parse(lockedCust.metadata);
          } catch {
            custMeta = {};
          }
        } else if (lockedCust.metadata && typeof lockedCust.metadata === 'object') {
          custMeta = lockedCust.metadata;
        }
        const custCoords = extractCoordinatesFromCustomerLocation({
          metadata: custMeta,
          locationUrl: lockedCust.location_url || custMeta?.location_url || custMeta?.locationUrl,
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
            await this.deps.vanFraudRadarService.recordSuspicionEvent({
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
        await this.deps.recordSuspicionEvent({
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

      const isInstapayCollection =
        payload.paymentMethod === 'instapay' ||
        payload.paymentMethod === 'vodafone_cash' ||
        payload.paymentMethod === 'bank_transfer';
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
          // INV-VAN-OFFLINE-TIMESTAMPS: an offline collection keeps
          // its original instant as created_at and carries the server
          // receipt instant as received_at. Online: the spread is
          // empty and the column defaults apply.
          ...offlineSaleTimestamps(offlineCreatedAt),
          ...fieldCollectionPaymentScope({
            tripId: payload.tripId,
            repId,
            paymentMethod: payload.paymentMethod,
            clientTxId: payload.clientTxId,
          }),
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      receiptNo = await this.deps.generateDailySequenceNumber(trxAny, 'customer_payments', 'note', 'COL', tenantId);
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
      await this.deps.accountingPosting.postVanFieldCollection(
        trx,
        Number(insertedPayment.id),
        {
          amount,
          customerId: payload.customerId,
          branchId,
          locationId: vanLocId,
          paymentMethod: payload.paymentMethod || 'cash',
          transferReference: payload.transferReference,
        },
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
      if (this.deps.audit && typeof this.deps.audit.logWithExecutor === 'function') {
        await this.deps.audit.logWithExecutor(
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
}
