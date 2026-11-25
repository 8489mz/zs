import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { AppError } from '../../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../../accounting/engines/money-minor-units.engine';

export interface VanFleetFuelSliceBoundDeps {
  assertVehicleUsableByRep: (
    tenantId: string,
    vehicleId: number,
    repId: number,
    tripId?: number | null,
  ) => Promise<void>;
}

export class VanFleetFuelSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly bound: VanFleetFuelSliceBoundDeps,
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

  async recordFuelLog(
    tenantId: string,
    accountId: string,
    repId: number | null,
    payload: {
      vehicleId: number;
      tripId?: number | null;
      odometer: number;
      liters: number;
      pricePerLiter: number;
      stationName?: string;
      notes?: string;
    },
  ) {
    if (!payload.vehicleId || payload.vehicleId <= 0) {
      throw new AppError('يرجى تحديد مركبة التوزيع', 'INVALID_VEHICLE', 400);
    }
    const odo = Number(payload.odometer || 0);
    const lit = Number(payload.liters || 0);
    const ppl = Number(payload.pricePerLiter || 0);

    if (odo <= 0) {
      throw new AppError('يرجى إدخال قراءة عداد الكيلومترات الصحيحة', 'INVALID_ODOMETER', 400);
    }
    if (lit <= 0) {
      throw new AppError('يرجى إدخال كمية الوقود باللترات', 'INVALID_LITERS', 400);
    }
    if (ppl <= 0) {
      throw new AppError('يرجى إدخال سعر لتر الوقود', 'INVALID_PRICE_PER_LITER', 400);
    }

    // INV-REP-DRIVER-WRITES-OWNERSHIP (M16/D7): the vehicle (and the
    // trip, when one is named) must be the caller's own — before the
    // insert and before the odometer bump. Staff callers pass repId
    // null and skip the check. The oil-change insert is fully traced
    // and gated the same way below.
    if (repId != null) {
      await this.assertVehicleUsableByRep(tenantId, payload.vehicleId, repId, payload.tripId ?? null);
    }

    // Fuel cost is money: round at the tenant's book digits (a 3-decimal
    // tenant keeps its third decimal; the old 2-decimal cut dropped it).
    // consumptionRate below stays 2dp: it is km per litre, not money.
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const totalCost = roundMoney(lit * ppl, moneyDigits);

    const lastFuelLog = await this.anyDb
      .selectFrom('fleet_fuel_logs')
      .select(['odometer'])
      .where('tenant_id', '=', tenantId)
      .where('vehicle_id', '=', payload.vehicleId)
      .orderBy('odometer', 'desc')
      .executeTakeFirst();

    let kmSinceLast = 0;
    let consumptionRate = 0;
    if (lastFuelLog && Number(lastFuelLog.odometer) > 0) {
      const prevOdo = Number(lastFuelLog.odometer);
      if (odo > prevOdo) {
        kmSinceLast = odo - prevOdo;
        consumptionRate = Number((kmSinceLast / lit).toFixed(2));
      }
    }

    const inserted = await this.anyDb
      .insertInto('fleet_fuel_logs')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        vehicle_id: payload.vehicleId,
        trip_id: payload.tripId || null,
        rep_id: repId || null,
        odometer: odo,
        liters: lit,
        price_per_liter: ppl,
        total_cost: totalCost,
        station_name: payload.stationName || null,
        km_since_last_fuel: kmSinceLast,
        consumption_rate: consumptionRate,
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
      fuelLogId: Number(inserted.id),
      kmSinceLastFuel: kmSinceLast,
      consumptionRate,
      totalCost,
    };
  }

  async listFuelLogs(
    tenantId: string,
    filters?: { vehicleId?: number; repId?: number; dateFrom?: string; dateTo?: string },
  ) {
    let query = this.anyDb
      .selectFrom('fleet_fuel_logs as fl')
      .innerJoin('fleet_vehicles as fv', 'fv.id', 'fl.vehicle_id')
      .leftJoin('delivery_representatives as dr', 'dr.id', 'fl.rep_id')
      .select([
        'fl.id',
        'fl.vehicle_id as vehicleId',
        'fv.plate_number as plateNumber',
        'fv.model_name as modelName',
        'fl.trip_id as tripId',
        'fl.rep_id as repId',
        sql<string>`coalesce(dr.name, '')`.as('repName'),
        sql<number>`cast(fl.odometer as numeric)`.as('odometer'),
        sql<number>`cast(fl.liters as numeric)`.as('liters'),
        sql<number>`cast(fl.price_per_liter as numeric)`.as('pricePerLiter'),
        sql<number>`cast(fl.total_cost as numeric)`.as('totalCost'),
        sql<string>`coalesce(fl.station_name, '')`.as('stationName'),
        sql<number>`cast(fl.km_since_last_fuel as numeric)`.as('kmSinceLastFuel'),
        sql<number>`cast(fl.consumption_rate as numeric)`.as('consumptionRate'),
        'fl.notes',
        'fl.created_at as createdAt',
      ])
      .where('fl.tenant_id', '=', tenantId);

    if (filters?.vehicleId) query = query.where('fl.vehicle_id', '=', filters.vehicleId);
    if (filters?.repId) query = query.where('fl.rep_id', '=', filters.repId);
    if (filters?.dateFrom) query = query.where('fl.created_at', '>=', filters.dateFrom);
    if (filters?.dateTo) query = query.where('fl.created_at', '<=', `${filters.dateTo} 23:59:59`);

    const rows = await query.orderBy('fl.created_at', 'desc').limit(200).execute();
    return rows;
  }
}
