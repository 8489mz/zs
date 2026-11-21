import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { AppError } from '../../../../common/errors/app-error';

export interface VanFleetOilSliceBoundDeps {
  assertVehicleUsableByRep: (tenantId: string, vehicleId: number, repId: number, tripId?: number | null) => Promise<void>;
}

export class VanFleetOilSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly bound: VanFleetOilSliceBoundDeps,
  ) {}

  private get anyDb(): any {
    return this.db as any;
  }

  private async assertVehicleUsableByRep(
    tenantId: string,
    vehicleId: number,
    repId: number,
    tripId?: number | null,
  ): Promise<void> {
    return this.bound.assertVehicleUsableByRep(tenantId, vehicleId, repId, tripId);
  }

  async recordOilChange(
    tenantId: string,
    accountId: string,
    repId: number | null,
    payload: {
      vehicleId: number;
      odometerAtChange: number;
      oilType: string;
      ratedKm: number;
      withFilter: boolean;
      alertKmBefore?: number;
      cost?: number;
      performedBy?: string;
      notes?: string;
    },
  ) {
    if (!payload.vehicleId || payload.vehicleId <= 0) {
      throw new AppError('يرجى تحديد مركبة التوزيع', 'INVALID_VEHICLE', 400);
    }
    const odo = Number(payload.odometerAtChange || 0);
    const rated = Number(payload.ratedKm || 0);
    const alertKm = Number(payload.alertKmBefore ?? 500);

    if (odo <= 0) {
      throw new AppError('يرجى إدخال قراءة عداد السيارة عند تغيير الزيت', 'INVALID_ODOMETER', 400);
    }
    if (rated <= 0) {
      throw new AppError('يرجى إدخال المسافة المقررة للزيت (مثال: 5000 أو 10000 كم)', 'INVALID_RATED_KM', 400);
    }
    if (!payload.oilType?.trim()) {
      throw new AppError('يرجى كتابة نوع الزيت المستخدم', 'INVALID_OIL_TYPE', 400);
    }

    // INV-REP-DRIVER-WRITES-OWNERSHIP (M16/D7): the vehicle must be
    // the caller's own — before completing the previous active
    // oil-change row, before the insert, and before the odometer
    // bump. A refused write completes nothing and moves no odometer.
    // Traced fully: insert into fleet_oil_changes + complete prior
    // active rows for this vehicle + GREATEST odometer bump. There is
    // no trip anchor on this endpoint, so vehicle assignment is the
    // only ownership proof. Staff callers pass repId null.
    if (repId != null) {
      await this.assertVehicleUsableByRep(tenantId, payload.vehicleId, repId);
    }

    const nextDue = odo + rated;

    await this.anyDb
      .updateTable('fleet_oil_changes')
      .set({ status: 'completed' })
      .where('vehicle_id', '=', payload.vehicleId)
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'active')
      .execute();

    const inserted = await this.anyDb
      .insertInto('fleet_oil_changes')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        vehicle_id: payload.vehicleId,
        rep_id: repId || null,
        odometer_at_change: odo,
        oil_type: payload.oilType.trim(),
        rated_km: rated,
        with_filter: payload.withFilter ?? true,
        alert_km_before: alertKm,
        next_due_odometer: nextDue,
        cost: Number(payload.cost || 0),
        performed_by: payload.performedBy || null,
        status: 'active',
        notes: payload.notes || null,
        created_at: sql`NOW()`,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    await this.anyDb
      .updateTable('fleet_vehicles')
      .set({
        current_odometer: sql`GREATEST(coalesce(current_odometer, 0), ${odo})`,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', payload.vehicleId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return {
      ok: true,
      oilChangeId: Number(inserted.id),
      nextDueOdometer: nextDue,
      alertKmBefore: alertKm,
    };
  }

  async listOilChanges(tenantId: string, vehicleId?: number) {
    let query = this.anyDb
      .selectFrom('fleet_oil_changes as foc')
      .innerJoin('fleet_vehicles as fv', 'fv.id', 'foc.vehicle_id')
      .leftJoin('delivery_representatives as dr', 'dr.id', 'foc.rep_id')
      .select([
        'foc.id',
        'foc.vehicle_id as vehicleId',
        'fv.plate_number as plateNumber',
        'fv.model_name as modelName',
        sql<number>`cast(fv.current_odometer as numeric)`.as('currentOdometer'),
        'foc.rep_id as repId',
        sql<string>`coalesce(dr.name, '')`.as('repName'),
        sql<number>`cast(foc.odometer_at_change as numeric)`.as('odometerAtChange'),
        'foc.oil_type as oilType',
        sql<number>`cast(foc.rated_km as numeric)`.as('ratedKm'),
        'foc.with_filter as withFilter',
        sql<number>`cast(foc.alert_km_before as numeric)`.as('alertKmBefore'),
        sql<number>`cast(foc.next_due_odometer as numeric)`.as('nextDueOdometer'),
        sql<number>`cast(foc.cost as numeric)`.as('cost'),
        'foc.performed_by as performedBy',
        'foc.status',
        'foc.notes',
        'foc.created_at as createdAt',
      ])
      .where('foc.tenant_id', '=', tenantId);

    if (vehicleId) {
      query = query.where('foc.vehicle_id', '=', vehicleId);
    }

    const rows = await query.orderBy('foc.created_at', 'desc').limit(200).execute();
    return rows;
  }
}
