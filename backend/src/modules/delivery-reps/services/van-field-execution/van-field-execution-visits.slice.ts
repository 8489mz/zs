import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { AppError } from '../../../../common/errors/app-error';
import { VanFraudRadarService } from '../van-fraud-radar.service';
import { FmcgVisitExecutionEngine, GeofenceEvaluationResult } from '../../fmcg-visit-execution.engine';
import { extractAssignedRepIds, hasGpsCoordinates, loadRepPermissions } from '../../rep-target.engine';
import {
  CheckInVisitPayload,
  RecordStoreInventoryPayload,
  RecordNoSalePayload,
  CheckOutVisitPayload,
} from './van-field-execution.types';

export class VanFieldExecutionVisitsSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly fraudRadar: VanFraudRadarService,
  ) {}

  /**
   * INV-REP-DRIVER-WRITES-OWNERSHIP (M16/D6+D7): every driver write
   * below verifies the visit / trip / vehicle / customer belongs to
   * the calling rep and refuses with a specific 403 otherwise, before
   * any write. Staff callers pass repId null and skip the ownership
   * check (the supervisor view); the amount-anchoring in
   * checkOutVisit still applies to them. A missing row is a 404; a
   * row owned by another rep is a 403 — never a silent no-op.
   */
  private async assertVisitOwnedByRep(tenantId: string, visitId: number, repId: number) {
    const visit = await this.db
      .selectFrom('van_store_visits')
      .selectAll()
      .where('id', '=', visitId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!visit) {
      throw new AppError('سجل الزيارة غير موجود', 'VISIT_NOT_FOUND', 404);
    }
    if (Number(visit.rep_id) !== Number(repId)) {
      throw new AppError('هذه الزيارة تخص مندوباً آخر، لا يمكنك التعديل عليها', 'REP_VISIT_NOT_OWNED', 403);
    }
    return visit;
  }

  /**
   * 1. Check-In: Initiates a structured store visit with GPS geofencing verification
   */
  async checkInVisit(tenantId: string, accountId: number, repId: number, payload: CheckInVisitPayload) {
    if (!payload.customerId) {
      throw new AppError('معرف العميل مطلوب لتسجيل الزيارة', 'CUSTOMER_ID_REQUIRED', 400);
    }

    // H9 (D4): when the acting rep's require_gps_on_visit flag is on,
    // a check-in without usable GPS coordinates is refused — the same
    // gate as recordFieldVisit, at the other check-in entry point.
    // Runs before the customer and scope reads, so a GPS-less attempt
    // is refused without learning anything about the customer.
    if (!hasGpsCoordinates(payload.latitude, payload.longitude)) {
      const repFlags = await loadRepPermissions(this.db, tenantId, repId);
      if (repFlags.require_gps_on_visit) {
        throw new AppError(
          'إحداثيات GPS مطلوبة لتسجيل الزيارة الميدانية (require_gps_on_visit مفعّل لهذا المندوب) ولم يتم إرسالها',
          'REP_VISIT_GPS_REQUIRED',
          403,
        );
      }
    }

    // Fetch customer GPS and details
    const customer = await this.db
      .selectFrom('customers')
      .select(['id', 'name', 'metadata'])
      .where('id', '=', payload.customerId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!customer) {
      throw new AppError('العميل غير مسجل في النظام', 'CUSTOMER_NOT_FOUND', 404);
    }

    const meta =
      typeof customer.metadata === 'string' ? JSON.parse(customer.metadata || '{}') : customer.metadata || {};

    // INV-REP-SCOPED-CUSTOMER-READS (H7/D5): a check-in is not a free
    // pass to a customer. The rep must be assigned to this customer, or
    // the trip he names must be his own — otherwise one check-in
    // manufactures the visit row that opens another rep's customer
    // reads (field statement, last sold prices). Served history alone
    // does NOT authorize a new check-in, for the same reason. A missing
    // trip fails closed (404); another rep's trip fails with a specific
    // 403 naming the trip. Same codes/messages as the recordFieldVisit
    // gate in VanRoutesService.
    let tripOwned = false;
    if (payload.tripId != null) {
      const trip = await this.db
        .selectFrom('van_sales_trips')
        .select(['id', 'rep_id'])
        .where('id', '=', payload.tripId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (!trip) {
        throw new AppError('الرحلة غير موجودة', 'TRIP_NOT_FOUND', 404);
      }
      if (Number(trip.rep_id) !== Number(repId)) {
        throw new AppError('هذه الرحلة تخص مندوباً آخر، لا يمكنك تسجيل زيارة عليها', 'REP_TRIP_NOT_OWNED', 403);
      }
      tripOwned = true;
    }
    if (!tripOwned && !extractAssignedRepIds(meta).includes(Number(repId))) {
      throw new AppError(
        'العميل غير مسند إليك ولا توجد رحلة مملوكة لك تبرر تسجيل الزيارة',
        'REP_CUSTOMER_NOT_ASSIGNED',
        403,
      );
    }

    const customerLat = meta.latitude ?? meta.gps_lat ?? meta.lat ?? null;
    const customerLng = meta.longitude ?? meta.gps_lng ?? meta.lng ?? null;

    const geofenceResult: GeofenceEvaluationResult = FmcgVisitExecutionEngine.evaluateGeofence(
      customerLat,
      customerLng,
      payload.latitude,
      payload.longitude,
      300,
    );

    // If geofence is violated (more than 300m away), trigger fraud radar suspicion event
    if (!geofenceResult.isValid && !geofenceResult.isUnmappedCustomer) {
      await this.fraudRadar.recordSuspicionEvent({
        tenantId,
        accountId: String(accountId),
        repId,
        tripId: payload.tripId ?? null,
        customerId: payload.customerId,
        customerName: customer.name,
        eventCode: 'VAN_SUSPICION_GEOFENCE_VIOLATION',
        severity: 'high',
        titleAr: 'تسجيل زيارة وهمية خارج النطاق الجغرافي للمحل (Geofence Breach)',
        detailsAr: `قام المندوب بتسجيل وصول للعميل "${customer.name}" على بعد (${geofenceResult.distanceMeters} متر) متجاوزاً النطاق المسموح (300 متر).`,
        attemptedAmount: 0,
        metadata: {
          customerLat,
          customerLng,
          repLat: payload.latitude,
          repLng: payload.longitude,
          distanceMeters: geofenceResult.distanceMeters,
        },
      });
    }

    // Insert visit record
    const [visit] = await this.db
      .insertInto('van_store_visits')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        trip_id: payload.tripId ?? null,
        rep_id: repId,
        customer_id: payload.customerId,
        customer_name: customer.name,
        check_in_at: new Date().toISOString(),
        check_in_lat: payload.latitude != null ? payload.latitude : null,
        check_in_lng: payload.longitude != null ? payload.longitude : null,
        is_geofence_valid: geofenceResult.isValid,
        geofence_distance_meters: geofenceResult.distanceMeters,
        store_inventory: JSON.stringify([]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .returningAll()
      .execute();

    return {
      ok: true,
      visitId: visit.id,
      customerName: customer.name,
      geofence: geofenceResult,
      checkInAt: visit.check_in_at,
    };
  }

  /**
   * 2. Store Shelf Inventory: Records optional shelf stock counts and expiries
   */
  async recordVisitInventory(
    tenantId: string,
    visitId: number,
    payload: RecordStoreInventoryPayload,
    repId?: number | null,
  ) {
    // INV-REP-DRIVER-WRITES-OWNERSHIP (M16/D6): a driver writes shelf
    // stock only on his own visit. Staff callers pass no repId.
    if (repId != null) {
      await this.assertVisitOwnedByRep(tenantId, visitId, repId);
    } else {
      const visit = await this.db
        .selectFrom('van_store_visits')
        .select(['id'])
        .where('id', '=', visitId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!visit) {
        throw new AppError('سجل الزيارة غير موجود', 'VISIT_NOT_FOUND', 404);
      }
    }

    await this.db
      .updateTable('van_store_visits')
      .set({
        store_inventory: JSON.stringify(payload.items || []),
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', visitId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return { ok: true, visitId, itemsCount: (payload.items || []).length };
  }

  /**
   * 3. Reason for No-Sale: Records mandatory reason when visit yielded no transaction
   */
  async recordVisitNoSale(tenantId: string, visitId: number, payload: RecordNoSalePayload, repId?: number | null) {
    if (!payload.noSaleReason) {
      throw new AppError('سبب عدم البيع إلزامي', 'NO_SALE_REASON_REQUIRED', 400);
    }

    // INV-REP-DRIVER-WRITES-OWNERSHIP (M16/D6): a driver records a
    // no-sale only on his own visit. The check also closes the old
    // silent no-op: a missing visit on the driver path is a 404, not
    // an update that touches zero rows. Staff callers pass no repId.
    if (repId != null) {
      await this.assertVisitOwnedByRep(tenantId, visitId, repId);
    }

    await this.db
      .updateTable('van_store_visits')
      .set({
        no_sale_reason: payload.noSaleReason,
        no_sale_notes: payload.noSaleNotes || null,
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', visitId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return { ok: true, visitId, reason: payload.noSaleReason };
  }

  /**
   * 4. Check-Out: Completes visit and computes dwell time
   */
  async checkOutVisit(tenantId: string, visitId: number, payload?: CheckOutVisitPayload, repId?: number | null) {
    // INV-REP-DRIVER-WRITES-OWNERSHIP (M16/D6): a driver checks out
    // only his own visit. Staff callers pass no repId.
    const visit =
      repId != null
        ? await this.assertVisitOwnedByRep(tenantId, visitId, repId)
        : await (async () => {
            const row = await this.db
              .selectFrom('van_store_visits')
              .selectAll()
              .where('id', '=', visitId)
              .where('tenant_id', '=', tenantId)
              .executeTakeFirst();
            if (!row) {
              throw new AppError('سجل الزيارة غير موجود', 'VISIT_NOT_FOUND', 404);
            }
            return row;
          })();

    // INV-REP-DRIVER-WRITES-OWNERSHIP (M16/D6): caller-supplied
    // sale/collection amounts are NEVER trusted as typed. An amount
    // may only be attached when it is anchored in a real record the
    // caller owns — REJECT, never ignore-and-derive silently, so no
    // invented amount can reach the visit KPIs. No shipped UI sends
    // these amounts without a sale (no frontend caller passes
    // saleAmount/collectionAmount to check-out today), so rejecting
    // unanchored amounts narrows nothing in use.
    //  - saleId, when given, must resolve to a sale of this visit's
    //    customer, on this visit's trip when both name one, belonging
    //    to the caller when the sale names a rep (same rule as
    //    recordFieldVisit, H7). A supplied saleAmount must equal that
    //    sale's total within 0.01, and is derived from the sale when
    //    omitted. A saleAmount with no saleId is invented by
    //    definition; a sale claim (hasSale) with no verified sale is
    //    the same.
    //  - collectionAmount, when positive, must equal either the cash
    //    paid on the linked verified sale or the sum of this rep's
    //    field collections for this visit's trip + customer; a
    //    collection claim (hasCollection) with no verifiable amount
    //    is refused the same way.
    let verifiedSale: any = null;
    if (payload?.saleId != null) {
      verifiedSale = await this.db
        .selectFrom('sales')
        .select(['id', 'total', 'paid_amount', 'payment_type', 'customer_id', 'delivery_rep_id', 'van_trip_id'])
        .where('id', '=', payload.saleId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (!verifiedSale) {
        throw new AppError('الفاتورة غير موجودة', 'SALE_NOT_FOUND', 404);
      }
      if (Number(verifiedSale.customer_id) !== Number(visit.customer_id)) {
        throw new AppError('الفاتورة لا تخص هذا العميل', 'VISIT_SALE_CUSTOMER_MISMATCH', 400);
      }
      if (
        verifiedSale.delivery_rep_id != null &&
        repId != null &&
        Number(verifiedSale.delivery_rep_id) !== Number(repId)
      ) {
        throw new AppError('الفاتورة تخص مندوباً آخر، لا يمكنك ربطها بزيارتك', 'REP_SALE_NOT_OWNED', 403);
      }
      if (
        visit.trip_id != null &&
        verifiedSale.van_trip_id != null &&
        Number(verifiedSale.van_trip_id) !== Number(visit.trip_id)
      ) {
        throw new AppError('الفاتورة ليست على رحلة هذه الزيارة', 'REP_SALE_NOT_OWNED', 403);
      }
    }

    const suppliedSaleAmount = payload?.saleAmount;
    if (suppliedSaleAmount != null && verifiedSale == null) {
      throw new AppError('لا يمكن إرفاق مبلغ بيع بلا فاتورة موثقة تخص هذه الزيارة', 'REP_VISIT_SALE_UNVERIFIED', 403);
    }
    if (
      suppliedSaleAmount != null &&
      verifiedSale != null &&
      Math.abs(Number(suppliedSaleAmount) - Number(verifiedSale.total)) > 0.01
    ) {
      throw new AppError('مبلغ البيع المرسل لا يطابق إجمالي الفاتورة المرتبطة', 'REP_VISIT_SALE_AMOUNT_MISMATCH', 403);
    }
    const hasSale =
      verifiedSale != null
        ? true
        : (payload?.hasSale ?? (suppliedSaleAmount != null && Number(suppliedSaleAmount) > 0));
    if (hasSale && verifiedSale == null) {
      throw new AppError(
        'لا يمكن تسجيل بيع على الزيارة بلا فاتورة موثقة تخص هذه الزيارة',
        'REP_VISIT_SALE_UNVERIFIED',
        403,
      );
    }

    const suppliedCollectionAmount = payload?.collectionAmount;
    const saleCashPaid =
      verifiedSale != null && verifiedSale.payment_type === 'cash' ? Number(verifiedSale.paid_amount || 0) : 0;
    let fieldCollectionsSum: number | null = null;
    const readFieldCollectionsSum = async (): Promise<number> => {
      if (fieldCollectionsSum != null) return fieldCollectionsSum;
      if (repId == null || visit.trip_id == null) {
        fieldCollectionsSum = 0;
        return 0;
      }
      const row = await this.db
        .selectFrom('customer_payments')
        .select(sql<number>`coalesce(sum(amount), 0)`.as('total'))
        .where('tenant_id', '=', tenantId)
        .where('van_trip_id', '=', visit.trip_id)
        .where('rep_id', '=', repId)
        .where('customer_id', '=', visit.customer_id)
        .executeTakeFirst();
      fieldCollectionsSum = Number(row?.total || 0);
      return fieldCollectionsSum;
    };
    if (suppliedCollectionAmount != null && Number(suppliedCollectionAmount) > 0) {
      const paymentsSum = await readFieldCollectionsSum();
      if (
        Math.abs(Number(suppliedCollectionAmount) - saleCashPaid) > 0.01 &&
        Math.abs(Number(suppliedCollectionAmount) - paymentsSum) > 0.01
      ) {
        throw new AppError(
          'مبلغ التحصيل المرسل لا يطابق أي تحصيل موثق لهذه الزيارة (فاتورة نقدية أو تحصيل ميداني)',
          'REP_VISIT_COLLECTION_UNVERIFIED',
          403,
        );
      }
    }
    const hasCollection =
      payload?.hasCollection ?? (suppliedCollectionAmount != null && Number(suppliedCollectionAmount) > 0);
    if (hasCollection) {
      const paymentsSum = await readFieldCollectionsSum();
      if (saleCashPaid <= 0 && paymentsSum <= 0) {
        throw new AppError(
          'لا يمكن تسجيل تحصيل على الزيارة بلا مبلغ تحصيل موثق لهذه الزيارة',
          'REP_VISIT_COLLECTION_UNVERIFIED',
          403,
        );
      }
    }

    const checkOutAt = new Date();
    const dwellSeconds = FmcgVisitExecutionEngine.calculateDwellTimeSeconds(visit.check_in_at, checkOutAt);

    const [updated] = await this.db
      .updateTable('van_store_visits')
      .set({
        check_out_at: checkOutAt.toISOString(),
        dwell_time_seconds: dwellSeconds,
        has_sale: hasSale,
        sale_id: verifiedSale != null ? Number(verifiedSale.id) : visit.sale_id,
        sale_amount:
          verifiedSale != null
            ? Number(verifiedSale.total)
            : payload?.saleAmount != null
              ? payload.saleAmount
              : visit.sale_amount,
        has_collection: hasCollection,
        collection_amount: payload?.collectionAmount != null ? payload.collectionAmount : visit.collection_amount,
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', visitId)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .execute();

    return {
      ok: true,
      visitId,
      dwellTimeSeconds: dwellSeconds,
      dwellTimeMinutes: Number((dwellSeconds / 60).toFixed(1)),
      hasSale,
      hasCollection,
    };
  }
}
