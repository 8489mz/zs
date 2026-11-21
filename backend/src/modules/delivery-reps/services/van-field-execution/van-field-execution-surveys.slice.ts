import { Kysely } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { AppError } from '../../../../common/errors/app-error';
import { extractAssignedRepIds } from '../../rep-target.engine';
import { TradeSurveyPayload } from './van-field-execution.types';

export class VanFieldExecutionSurveysSlice {
  constructor(
    private readonly db: Kysely<Database>,
  ) {
  }

  async assertTripOwnedByRep(
    tenantId: string,
    tripId: number,
    repId: number,
  ) {
    const trip = await this.db
      .selectFrom('van_sales_trips')
      .select(['id', 'rep_id'])
      .where('id', '=', tripId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!trip) {
      throw new AppError('الرحلة غير موجودة', 'TRIP_NOT_FOUND', 404);
    }
    if (Number((trip as any).rep_id) !== Number(repId)) {
      throw new AppError(
        'هذه الرحلة تخص مندوباً آخر، لا يمكنك تسجيل زيارة عليها',
        'REP_TRIP_NOT_OWNED',
        403,
      );
    }
  }

  /**
   * INV-REP-DRIVER-WRITES-OWNERSHIP (M16/D7): a survey customer is
   * authorized when the rep is assigned to the customer, has served
   * him before (field visit, pre-sale order, or delivered sale), or
   * has an open store visit (check-in) for him — the check-in itself
   * was already gated by H7, so it cannot manufacture access to
   * another rep's customer.
   */
  private async assertSurveyCustomer(
    tenantId: string,
    repId: number,
    customerId: number,
  ): Promise<void> {
    const customer = await this.db
      .selectFrom('customers')
      .select(['id', 'metadata'])
      .where('id', '=', customerId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!customer) {
      throw new AppError('العميل غير مسجل في النظام', 'CUSTOMER_NOT_FOUND', 404);
    }

    const meta = typeof customer.metadata === 'string'
      ? JSON.parse(customer.metadata || '{}')
      : (customer.metadata || {});
    if (extractAssignedRepIds(meta).includes(Number(repId))) return;

    const [fieldVisit, order, sale, storeVisit] = await Promise.all([
      // van_field_visits is not a typed key in Database (same as in
      // VanRoutesService, which reads it through anyDb).
      (this.db as any)
        .selectFrom('van_field_visits')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .where('customer_id', '=', customerId)
        .executeTakeFirst(),
      this.db
        .selectFrom('sales_orders')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .where('customer_id', '=', customerId)
        .executeTakeFirst(),
      this.db
        .selectFrom('sales')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('delivery_rep_id', '=', repId)
        .where('customer_id', '=', customerId)
        .executeTakeFirst(),
      this.db
        .selectFrom('van_store_visits')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .where('customer_id', '=', customerId)
        .executeTakeFirst(),
    ]);
    if (fieldVisit || order || sale || storeVisit) return;

    throw new AppError(
      'العميل غير مسند إليك ولا توجد زيارة مملوكة لك تبرر تسجيل الاستبيان',
      'REP_CUSTOMER_NOT_ASSIGNED',
      403,
    );
  }

  /**
   * 5. Trade Marketing Survey: Records cooler inspection or competitor survey
   */
  async recordTradeSurvey(
    tenantId: string,
    accountId: number,
    repId: number,
    payload: TradeSurveyPayload,
  ) {
    // INV-REP-DRIVER-WRITES-OWNERSHIP (M16/D7): every anchor the
    // caller names must be his own — the visit, the trip, and the
    // customer (assigned, served before, or checked in by him) — or
    // the survey is refused before any row is written.
    if (payload.visitId != null) {
      const visit = await this.db
        .selectFrom('van_store_visits')
        .select(['id', 'rep_id'])
        .where('id', '=', payload.visitId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (!visit) {
        throw new AppError('سجل الزيارة غير موجود', 'VISIT_NOT_FOUND', 404);
      }
      if (Number((visit as any).rep_id) !== Number(repId)) {
        throw new AppError(
          'هذه الزيارة تخص مندوباً آخر، لا يمكنك تسجيل استبيان عليها',
          'REP_VISIT_NOT_OWNED',
          403,
        );
      }
    }
    if (payload.tripId != null) {
      await this.assertTripOwnedByRep(tenantId, payload.tripId, repId);
    }
    await this.assertSurveyCustomer(tenantId, repId, payload.customerId);

    const [survey] = await this.db
      .insertInto('van_trade_marketing_surveys')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        visit_id: payload.visitId ?? null,
        trip_id: payload.tripId ?? null,
        rep_id: repId,
        customer_id: payload.customerId,
        survey_type: payload.surveyType,
        asset_id: payload.assetId || null,
        asset_name: payload.assetName || null,
        asset_condition: payload.assetCondition || null,
        is_pure_company_products: payload.isPureCompanyProducts !== false,
        temperature_celsius: payload.temperatureCelsius != null ? payload.temperatureCelsius : null,
        cleanliness_rating: payload.cleanlinessRating != null ? payload.cleanlinessRating : 5,
        photo_url: payload.photoUrl || null,
        competitor_name: payload.competitorName || null,
        competitor_product: payload.competitorProduct || null,
        competitor_price: payload.competitorPrice != null ? payload.competitorPrice : null,
        competitor_offer_details: payload.competitorOfferDetails || null,
        notes: payload.notes || null,
        metadata: JSON.stringify(payload.metadata || {}),
        created_at: new Date().toISOString(),
      })
      .returningAll()
      .execute();

    return { ok: true, surveyId: survey.id };
  }

  /**
   * 9. Get Trade Marketing Surveys for Supervisor
   */
  async getTradeSurveys(
    tenantId: string,
    filters?: {
      tripId?: number;
      customerId?: number;
      surveyType?: string;
    },
  ) {
    let q = this.db
      .selectFrom('van_trade_marketing_surveys')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (filters?.tripId) q = q.where('trip_id', '=', filters.tripId);
    if (filters?.customerId) q = q.where('customer_id', '=', filters.customerId);
    if (filters?.surveyType) q = q.where('survey_type', '=', filters.surveyType);

    const rows = await q.orderBy('created_at', 'desc').limit(150).execute();

    return {
      ok: true,
      surveys: rows.map((s) => ({
        id: s.id,
        tripId: s.trip_id,
        repId: s.rep_id,
        customerId: s.customer_id,
        surveyType: s.survey_type,
        assetId: s.asset_id,
        assetName: s.asset_name,
        assetCondition: s.asset_condition,
        isPureCompanyProducts: s.is_pure_company_products,
        temperatureCelsius: s.temperature_celsius != null ? Number(s.temperature_celsius) : null,
        cleanlinessRating: s.cleanliness_rating,
        photoUrl: s.photo_url,
        competitorName: s.competitor_name,
        competitorProduct: s.competitor_product,
        competitorPrice: s.competitor_price != null ? Number(s.competitor_price) : null,
        competitorOfferDetails: s.competitor_offer_details,
        notes: s.notes,
        createdAt: s.created_at,
      })),
    };
  }
}
