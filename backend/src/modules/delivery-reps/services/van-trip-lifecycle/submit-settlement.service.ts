import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../../database/kysely';
import { AuditService, AUDIT_EVENT_CODES } from '../../../../core/audit/audit.service';
import { AppError } from '../../../../common/errors/app-error';
import { Database } from '../../../../database/database.types';
import { evaluateOdometerReadings } from '../../van-trip-reconciliation.engine';
import { resolveVanMoneyAuditActor } from '../van-common.util';
import { normalizePerDayCash, sumPerDayCash, type PerDayCashInput } from '../../van-settlement-split.engine';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../../accounting/engines/money-minor-units.engine';
import { computeCashDrawerVariance } from '../../../cash-drawer/helpers/cash-drawer.helper';
import type { VanTripLifecycleDeps } from './van-trip-types';

@Injectable()
export class SubmitSettlementService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly recordSuspicionEvent: VanTripLifecycleDeps['recordSuspicionEvent'],
    private readonly resolveRepLinkedUserId: VanTripLifecycleDeps['resolveRepLinkedUserId'],
  ) {}

  private get anyDb(): any {
    return this.db;
  }

  /**
   * Driver submits daily trip closing report (cash handover, odometer reading, and stock unload request).
   * Status transitions to `submitted_by_rep`, pending supervisor review.
   */
  async submitTripSettlement(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      countedCash: number;
      // INV-VAN-DAILY-SPLIT-SETTLEMENT: the rep's counted cash split
      // per tenant day. When present it must sum to countedCash; it
      // is stored on the trip and the settle step falls back to it
      // when the settler sends no breakdown of his own.
      perDayCash?: PerDayCashInput[];
      endOdometer?: number;
      unloadRemainingToWarehouse: boolean;
      activeVisitCustomerId?: number;
      notes?: string;
    },
  ): Promise<{
    ok: boolean;
    tripId: number;
    expectedCash: number;
    countedCash: number;
    perDayCash?: PerDayCashInput[];
    variance: number;
    distanceKm: number;
    status: 'submitted_by_rep';
    message: string;
  }> {
    const trip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .selectAll()
      .where('vt.id', '=', payload.tripId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.rep_id', '=', repId)
      .where((eb: any) =>
        eb.or([
          eb('vt.status', '=', 'open'),
          eb('vt.settlement_status', '=', 'open'),
          eb('vt.settlement_status', '=', 'submitted_by_rep'),
        ]),
      )
      .executeTakeFirst();

    if (!trip) {
      throw new AppError('الرحلة غير موجودة أو تم تقديم إقرارها بالفعل', 'TRIP_NOT_FOUND', 404);
    }

    const odometerResult = evaluateOdometerReadings({
      startOdometer: trip.start_odometer,
      endOdometer: payload.endOdometer,
    });

    if (!odometerResult.valid) {
      await this.recordSuspicionEvent({
        tenantId,
        accountId,
        repId,
        tripId: payload.tripId,
        eventCode: AUDIT_EVENT_CODES.VAN_SUSPICION_ODOMETER_ROLLBACK,
        severity: 'high',
        titleAr: 'تلاعب في قراءة عداد الكيلومترات عند تقديم إقرار التصفية',
        detailsAr:
          odometerResult.errorMessageAr ||
          `قراءة العداد النهائية (${payload.endOdometer}) غير متسقة مع قراءة البداية (${trip.start_odometer}).`,
        // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): the actor is the
        // rep submitting the statement — his linked login, resolved
        // here; the radar falls back to the same resolution when it
        // is absent, so this is explicit threading, not a new path.
        actorUserId: await this.resolveRepLinkedUserId(this.anyDb, tenantId, repId),
        metadata: {
          startOdometer: trip.start_odometer,
          endOdometer: payload.endOdometer,
        },
      });
      throw new AppError(odometerResult.errorMessageAr!, 'INVALID_ODOMETER', 400);
    }

    const expectedCash = Number(trip.cash_collected || 0);
    const countedCash = Number(payload.countedCash || 0);
    // Cash variance at tenant book digits via the shared drawer helper
    // (was hardcoded toFixed(2)).
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const variance = computeCashDrawerVariance(countedCash, expectedCash, bookDigits);

    // INV-VAN-DAILY-SPLIT-SETTLEMENT: a per-day declaration must sum
    // to the declared total, or the declaration is internally
    // inconsistent. A re-submission replaces the stored breakdown
    // (absent = null), so the settle step never reads a stale one.
    let normalizedPerDayCash: PerDayCashInput[] | null = null;
    if (payload.perDayCash !== undefined) {
      try {
        normalizedPerDayCash = normalizePerDayCash(payload.perDayCash, bookDigits);
      } catch (e: any) {
        throw new AppError('تفصيل النقدية بالأيام غير صالح', String(e?.message || 'SETTLEMENT_PER_DAY_INVALID'), 400);
      }
      if (sumPerDayCash(normalizedPerDayCash, bookDigits) !== roundMoney(countedCash, bookDigits)) {
        throw new AppError('مجموع النقدية بالأيام لا يساوي إجمالي النقدية المعلنة', 'SETTLEMENT_PER_DAY_MISMATCH', 400);
      }
    }

    await this.anyDb
      .updateTable('van_sales_trips')
      .set({
        settlement_status: 'submitted_by_rep',
        submitted_at: sql`NOW()`,
        submitted_per_day_cash: normalizedPerDayCash ? JSON.stringify(normalizedPerDayCash) : null,
        end_odometer: payload.endOdometer !== undefined ? payload.endOdometer : null,
        distance_km: odometerResult.distanceKm,
        variance,
        notes: payload.notes || `إقرار تصفية مقدم من المندوب بانتظار اعتماد المشرف. عجز/زيادة: ${variance}`,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', payload.tripId)
      .where('tenant_id', '=', tenantId)
      .execute();

    // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): the submitted
    // statement is itself a money action (the rep declares the cash
    // he holds); it gets its own audit row naming the submitting
    // rep. Best-effort is wrong here — this method has no
    // transaction, so the row is written right after the update it
    // describes. The function-check guards harnesses that pass a
    // `{}` audit stub.
    if (this.audit && typeof this.audit.log === 'function') {
      const auditActor = await resolveVanMoneyAuditActor(this.anyDb, tenantId, repId);
      await this.audit.log(
        'تقديم إقرار تصفية رحلة',
        `قدّم المندوب ${auditActor.repName} (#${Number(repId)}) إقرار تصفية الرحلة #${Number(payload.tripId)} — متوقع ${expectedCash}، معدود ${countedCash}، فرق ${variance} — بانتظار اعتماد المشرف`,
        { userId: auditActor.userId, tenantId, accountId },
        { eventCode: AUDIT_EVENT_CODES.VAN_TRIP_SETTLEMENT_SUBMITTED },
      );
    }

    // Auto-record / end active visit if rep had an open visit upon submission
    if (payload.activeVisitCustomerId) {
      const custId = Number(payload.activeVisitCustomerId);
      if (custId > 0) {
        const existingVisit = await this.anyDb
          .selectFrom('van_field_visits')
          .select(['id'])
          .where('trip_id', '=', payload.tripId)
          .where('customer_id', '=', custId)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();

        if (!existingVisit) {
          const custSale = await this.anyDb
            .selectFrom('sales')
            .select(['id'])
            .where('van_trip_id', '=', payload.tripId)
            .where('customer_id', '=', custId)
            .where('tenant_id', '=', tenantId)
            .executeTakeFirst();

          await this.anyDb
            .insertInto('van_field_visits')
            .values({
              tenant_id: tenantId,
              account_id: accountId,
              trip_id: payload.tripId,
              rep_id: repId,
              customer_id: custId,
              visit_type: custSale?.id ? 'positive' : 'negative',
              sale_id: custSale?.id ? Number(custSale.id) : null,
              negative_reason: custSale?.id ? null : 'other',
              notes: 'تم إنهاء وتوثيق الزيارة تلقائياً عند تقديم إقرار التصفية',
              visited_at: sql`NOW()`,
              created_at: sql`NOW()`,
            })
            .execute();
        }
      }
    }

    return {
      ok: true,
      tripId: payload.tripId,
      expectedCash,
      countedCash,
      perDayCash: normalizedPerDayCash ?? undefined,
      variance,
      distanceKm: odometerResult.distanceKm,
      status: 'submitted_by_rep',
      message: 'تم تسليم إقرار الرحلة والنقدية بنجاح، وبانتظار اعتماد المشرف وأمين المستودع',
    };
  }
}
