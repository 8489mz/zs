import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';
import { FLEET_VEHICLE_STATUSES } from './van-common.util';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

@Injectable()
export class VanFleetService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private get anyDb(): any {
    return this.db as any;
  }

  /**
   * INV-REP-DRIVER-WRITES-OWNERSHIP (M16/D7): a driver fuel/oil write
   * is allowed only on a vehicle he may use — the vehicle's assigned
   * rep, an active multi-driver shift row (fleet_vehicle_drivers),
   * a supplied trip he owns whose vehicle this is, or one of his open
   * trips that names this vehicle. Same vehicle set M19's
   * getFleetMaintenanceAlerts already uses for reads, extended with
   * the trip anchors a fuel log carries. A missing vehicle is a 404;
   * a vehicle the rep may not use is REP_VEHICLE_NOT_ASSIGNED 403.
   * Staff callers pass repId null and skip the check. The gate runs
   * before the insert AND before the odometer bump, so a refused
   * write moves no cost and no odometer.
   */
  private async assertVehicleUsableByRep(
    tenantId: string,
    vehicleId: number,
    repId: number,
    tripId?: number | null,
  ): Promise<void> {
    const vehicle = await this.anyDb
      .selectFrom('fleet_vehicles')
      .select(['id', 'assigned_rep_id'])
      .where('id', '=', vehicleId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!vehicle) {
      throw new AppError('المركبة غير موجودة', 'VEHICLE_NOT_FOUND', 404);
    }

    // A named trip is checked FIRST: the fuel row carries the trip as
    // well as the vehicle, so owning the vehicle alone must not let a
    // rep attribute his fuel to another rep's trip.
    if (tripId != null) {
      const trip = await this.anyDb
        .selectFrom('van_sales_trips')
        .select(['id', 'rep_id', 'vehicle_id'])
        .where('id', '=', tripId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (!trip) {
        throw new AppError('الرحلة غير موجودة', 'TRIP_NOT_FOUND', 404);
      }
      if (Number((trip as any).rep_id) !== Number(repId)) {
        throw new AppError(
          'هذه الرحلة تخص مندوباً آخر، لا يمكنك تسجيل وقود عليها',
          'REP_TRIP_NOT_OWNED',
          403,
        );
      }
      if ((trip as any).vehicle_id != null && Number((trip as any).vehicle_id) !== Number(vehicleId)) {
        throw new AppError(
          'هذه المركبة ليست مركبة الرحلة المذكورة',
          'REP_VEHICLE_NOT_ASSIGNED',
          403,
        );
      }
      return;
    }

    if (vehicle.assigned_rep_id != null && Number(vehicle.assigned_rep_id) === Number(repId)) return;

    const driven = await this.anyDb
      .selectFrom('fleet_vehicle_drivers')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('vehicle_id', '=', vehicleId)
      .where('rep_id', '=', repId)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (driven) return;

    const ownTrip = await this.anyDb
      .selectFrom('van_sales_trips')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('rep_id', '=', repId)
      .where('vehicle_id', '=', vehicleId)
      .where('status', '=', 'open')
      .executeTakeFirst();
    if (ownTrip) return;

    throw new AppError(
      'هذه المركبة ليست مسندة إليك، لا يمكنك تسجيل وقود/زيت عليها',
      'REP_VEHICLE_NOT_ASSIGNED',
      403,
    );
  }

  /**
   * Fleet Management: List all vehicles registered under the company fleet.
   */
  async listFleetVehicles(tenantId: string) {
    const rows = await this.anyDb
      .selectFrom('fleet_vehicles as fv')
      .leftJoin('delivery_representatives as dr', 'dr.id', 'fv.assigned_rep_id')
      .leftJoin('stock_locations as loc', 'loc.id', 'fv.van_location_id')
      .leftJoin('branches as b', 'b.id', 'fv.branch_id')
      .select([
        'fv.id',
        'fv.plate_number as plateNumber',
        'fv.model_name as modelName',
        'fv.vehicle_type as vehicleType',
        'fv.vin_chassis as vinChassis',
        'fv.van_location_id as vanLocationId',
        sql<string>`coalesce(loc.name, '')`.as('vanLocationName'),
        'fv.branch_id as branchId',
        sql<string>`coalesce(b.name, '')`.as('branchName'),
        sql<number>`cast(coalesce(fv.current_odometer, 0) as numeric)`.as('currentOdometer'),
        'fv.fuel_type as fuelType',
        'fv.license_expires_at as licenseExpiresAt',
        'fv.status',
        'fv.assigned_rep_id as assignedRepId',
        sql<string>`coalesce(dr.name, '')`.as('assignedRepName'),
        sql<string>`coalesce(dr.phone, '')`.as('assignedRepPhone'),
        'fv.notes',
        'fv.created_at as createdAt',
      ])
      .where('fv.tenant_id', '=', tenantId)
      .orderBy('fv.id', 'desc')
      .execute();

    return rows.map((r: any) => ({
      id: Number(r.id),
      plateNumber: String(r.plateNumber || ''),
      modelName: r.modelName || '',
      vehicleType: r.vehicleType || 'van',
      vinChassis: r.vinChassis || '',
      vanLocationId: r.vanLocationId ? Number(r.vanLocationId) : null,
      vanLocationName: r.vanLocationName || '',
      branchId: r.branchId ? Number(r.branchId) : null,
      branchName: r.branchName || '',
      currentOdometer: Number(r.currentOdometer || 0),
      fuelType: r.fuelType || 'gasoline',
      licenseExpiresAt: r.licenseExpiresAt ? String(r.licenseExpiresAt) : null,
      status: r.status || 'available',
      assignedRepId: r.assignedRepId ? Number(r.assignedRepId) : null,
      assignedRepName: r.assignedRepName || '',
      assignedRepPhone: r.assignedRepPhone || '',
      notes: r.notes || '',
      createdAt: String(r.createdAt),
    }));
  }

  /**
   * Single entry point for changing which rep drives a fleet vehicle.
   */
  private async reassignVehicleRep(
    trx: Kysely<Database>,
    tenantId: string,
    vehicle: { id: number; van_location_id: number | null; assigned_rep_id: number | null; plate_number: string },
    newRepId: number | null,
  ): Promise<void> {
    const trxAny = trx as any;
    const currentRepId = vehicle.assigned_rep_id ? Number(vehicle.assigned_rep_id) : null;
    const nextRepId = newRepId ? Number(newRepId) : null;

    if (currentRepId === nextRepId) return; // no-op: same rep already assigned, or both unassigned

    if (nextRepId) {
      const elsewhere = await trxAny
        .selectFrom('fleet_vehicles')
        .select(['id', 'plate_number'])
        .where('tenant_id', '=', tenantId)
        .where('assigned_rep_id', '=', nextRepId)
        .where('id', '!=', vehicle.id)
        .executeTakeFirst();
      if (elsewhere) {
        throw new AppError(
          `هذا المندوب مخصَّص بالفعل للمركبة رقم لوحتها "${elsewhere.plate_number}" — يجب فك ارتباطه بها أولاً`,
          'REP_ALREADY_ASSIGNED_TO_VEHICLE',
          400,
        );
      }
    }

    if (vehicle.van_location_id) {
      const openTrip = await trxAny
        .selectFrom('van_sales_trips')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('van_location_id', '=', Number(vehicle.van_location_id))
        .where('status', '=', 'open')
        .executeTakeFirst();
      if (openTrip) {
        throw new AppError(
          'هذه المركبة عليها رحلة توزيع مفتوحة لم تُصفَّ بعد — يجب تصفية الرحلة الحالية قبل تغيير السائق',
          'VEHICLE_HAS_OPEN_TRIP',
          400,
        );
      }
    }

    if (currentRepId) {
      await trxAny
        .updateTable('delivery_representatives')
        .set({ van_location_id: null, vehicle_plate: null, updated_at: sql`NOW()` })
        .where('id', '=', currentRepId)
        .where('tenant_id', '=', tenantId)
        .execute();
    }

    await trxAny
      .updateTable('fleet_vehicles')
      .set({
        assigned_rep_id: nextRepId,
        status: nextRepId ? 'assigned' : 'available',
        updated_at: sql`NOW()`,
      })
      .where('id', '=', vehicle.id)
      .where('tenant_id', '=', tenantId)
      .execute();

    if (nextRepId) {
      await trxAny
        .updateTable('delivery_representatives')
        .set({
          is_van_rep: true,
          van_location_id: vehicle.van_location_id,
          vehicle_plate: vehicle.plate_number,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', nextRepId)
        .where('tenant_id', '=', tenantId)
        .execute();
    }
  }

  /**
   * Fleet Management: Register a new vehicle and provision its mobile warehouse location.
   */
  async createFleetVehicle(
    tenantId: string,
    accountId: string,
    payload: {
      plateNumber: string;
      modelName?: string;
      vehicleType?: string;
      vinChassis?: string;
      branchId?: number;
      currentOdometer?: number;
      fuelType?: string;
      licenseExpiresAt?: string;
      assignedRepId?: number;
      notes?: string;
    },
  ) {
    const plateNumber = String(payload.plateNumber || '').trim();
    if (!plateNumber) throw new AppError('رقم لوحة المركبة مطلوب', 'PLATE_REQUIRED', 400);

    const locationCode = `VAN-CAR-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const locationName = `سيارة فان (${plateNumber}) - ${payload.modelName || 'أسطول التوزيع'}`;

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;

      const loc = await trxAny
        .insertInto('stock_locations')
        .values({
          name: locationName,
          code: locationCode,
          branch_id: payload.branchId ? Number(payload.branchId) : null,
          location_type: 'van_stock',
          is_active: true,
          tenant_id: tenantId,
          account_id: accountId,
        })
        .returning(['id', 'name'])
        .executeTakeFirstOrThrow();

      const inserted = await trxAny
        .insertInto('fleet_vehicles')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          plate_number: plateNumber,
          model_name: payload.modelName?.trim() || null,
          vehicle_type: payload.vehicleType || 'van',
          vin_chassis: payload.vinChassis?.trim() || null,
          van_location_id: Number(loc.id),
          branch_id: payload.branchId ? Number(payload.branchId) : null,
          current_odometer: Number(payload.currentOdometer || 0),
          fuel_type: payload.fuelType || 'gasoline',
          license_expires_at: payload.licenseExpiresAt || null,
          status: 'available',
          assigned_rep_id: null,
          notes: payload.notes?.trim() || null,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      if (payload.assignedRepId) {
        await this.reassignVehicleRep(
          trx,
          tenantId,
          { id: Number(inserted.id), van_location_id: Number(loc.id), assigned_rep_id: null, plate_number: plateNumber },
          Number(payload.assignedRepId),
        );
      }
    });

    return this.listFleetVehicles(tenantId);
  }

  /**
   * Fleet Management: Update vehicle profile and specifications.
   */
  async updateFleetVehicle(
    tenantId: string,
    accountId: string,
    id: number,
    payload: {
      plateNumber?: string;
      modelName?: string;
      vehicleType?: string;
      vinChassis?: string;
      branchId?: number;
      currentOdometer?: number;
      fuelType?: string;
      licenseExpiresAt?: string;
      status?: string;
      assignedRepId?: number | null;
      notes?: string;
    },
  ) {
    if (payload.status && !FLEET_VEHICLE_STATUSES.includes(payload.status as any)) {
      throw new AppError(
        `حالة مركبة غير صالحة: "${payload.status}"`,
        'INVALID_VEHICLE_STATUS',
        400,
      );
    }

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;

      const existing = await trxAny
        .selectFrom('fleet_vehicles')
        .selectAll()
        .where('id', '=', id)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();
      if (!existing) throw new AppError('المركبة غير موجودة', 'NOT_FOUND', 404);

      if (payload.assignedRepId !== undefined) {
        await this.reassignVehicleRep(
          trx,
          tenantId,
          {
            id: Number(existing.id),
            van_location_id: existing.van_location_id ? Number(existing.van_location_id) : null,
            assigned_rep_id: existing.assigned_rep_id ? Number(existing.assigned_rep_id) : null,
            plate_number: payload.plateNumber?.trim() || existing.plate_number,
          },
          payload.assignedRepId ? Number(payload.assignedRepId) : null,
        );
      }

      const afterReassign = payload.assignedRepId !== undefined
        ? await trxAny.selectFrom('fleet_vehicles').select(['assigned_rep_id', 'status']).where('id', '=', id).where('tenant_id', '=', tenantId).executeTakeFirstOrThrow()
        : { assigned_rep_id: existing.assigned_rep_id, status: existing.status };

      await trxAny
        .updateTable('fleet_vehicles')
        .set({
          plate_number: payload.plateNumber?.trim() || existing.plate_number,
          model_name: payload.modelName !== undefined ? payload.modelName?.trim() : existing.model_name,
          vehicle_type: payload.vehicleType || existing.vehicle_type,
          vin_chassis: payload.vinChassis !== undefined ? payload.vinChassis?.trim() : existing.vin_chassis,
          branch_id: payload.branchId !== undefined ? (payload.branchId ? Number(payload.branchId) : null) : existing.branch_id,
          current_odometer: payload.currentOdometer !== undefined ? Number(payload.currentOdometer) : existing.current_odometer,
          fuel_type: payload.fuelType || existing.fuel_type,
          license_expires_at: payload.licenseExpiresAt !== undefined ? payload.licenseExpiresAt : existing.license_expires_at,
          status: payload.status || afterReassign.status,
          assigned_rep_id: afterReassign.assigned_rep_id,
          notes: payload.notes !== undefined ? payload.notes?.trim() : existing.notes,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', id)
        .where('tenant_id', '=', tenantId)
        .execute();
    });

    return this.listFleetVehicles(tenantId);
  }

  /**
   * Fleet Management: Assign a representative to a vehicle for shifts.
   */
  async assignVehicleRep(tenantId: string, vehicleId: number, repId: number | null, shiftName?: string) {
    void shiftName;

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;
      const vehicle = await trxAny
        .selectFrom('fleet_vehicles')
        .selectAll()
        .where('id', '=', vehicleId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();
      if (!vehicle) throw new AppError('المركبة غير موجودة', 'VEHICLE_NOT_FOUND', 404);

      await this.reassignVehicleRep(
        trx,
        tenantId,
        {
          id: Number(vehicle.id),
          van_location_id: vehicle.van_location_id ? Number(vehicle.van_location_id) : null,
          assigned_rep_id: vehicle.assigned_rep_id ? Number(vehicle.assigned_rep_id) : null,
          plate_number: vehicle.plate_number,
        },
        repId,
      );
    });

    return this.listFleetVehicles(tenantId);
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

  async getFleetMaintenanceAlerts(tenantId: string, vehicleId?: number, repId?: number) {
    // INV-REP-SCOPED-DRIVER-READS (M19/D10): a driver call carries
    // repId and sees alerts only for vehicles assigned to him — either
    // as the vehicle's assigned rep (fleet_vehicles.assigned_rep_id)
    // or as an active driver on it (fleet_vehicle_drivers). An
    // explicitly requested vehicle outside that set is refused with a
    // specific 403. A rep with no vehicle simply gets no alerts.
    // Staff calls (no repId) keep the full-tenant behaviour.
    let repVehicleIds: Set<number> | null = null;
    if (repId != null) {
      const [assigned, driven] = await Promise.all([
        this.anyDb
          .selectFrom('fleet_vehicles')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('assigned_rep_id', '=', repId)
          .execute(),
        this.anyDb
          .selectFrom('fleet_vehicle_drivers')
          .select('vehicle_id')
          .where('tenant_id', '=', tenantId)
          .where('rep_id', '=', repId)
          .where('is_active', '=', true)
          .execute(),
      ]);
      repVehicleIds = new Set<number>();
      for (const row of [...(assigned || []), ...(driven || [])]) {
        const id = Number((row as any).id ?? (row as any).vehicle_id);
        if (Number.isInteger(id) && id > 0) repVehicleIds.add(id);
      }
      if (vehicleId && !repVehicleIds.has(Number(vehicleId))) {
        throw new AppError(
          'هذه المركبة ليست مسندة إليك، لا يمكنك الاطلاع على تنبيهات صيانتها',
          'REP_VEHICLE_NOT_ASSIGNED',
          403,
        );
      }
    }

    let vehicleQuery = this.anyDb
      .selectFrom('fleet_vehicles as fv')
      .leftJoin('delivery_representatives as dr', 'dr.id', 'fv.assigned_rep_id')
      .select([
        'fv.id',
        'fv.plate_number as plateNumber',
        'fv.model_name as modelName',
        sql<number>`cast(fv.current_odometer as numeric)`.as('currentOdometer'),
        'fv.license_expires_at as licenseExpiresAt',
        'fv.status',
        'fv.assigned_rep_id as repId',
        sql<string>`coalesce(dr.name, '')`.as('repName'),
      ])
      .where('fv.tenant_id', '=', tenantId);

    if (vehicleId) {
      vehicleQuery = vehicleQuery.where('fv.id', '=', vehicleId);
    }
    if (repVehicleIds) {
      vehicleQuery = vehicleQuery.where('fv.id', 'in', [...repVehicleIds]);
    }

    const vehicles = await vehicleQuery.execute();
    const alerts: Array<{
      id: string;
      vehicleId: number;
      plateNumber: string;
      repName: string;
      type: 'oil_change' | 'license_expiry';
      severity: 'warning' | 'critical';
      title: string;
      description: string;
      currentValue: string | number;
      thresholdValue: string | number;
      dueDate?: string;
    }> = [];

    const now = new Date();

    for (const v of vehicles) {
      const vId = Number(v.id);
      const currOdo = Number(v.currentOdometer || 0);

      if (v.licenseExpiresAt) {
        const expDate = new Date(v.licenseExpiresAt);
        const diffMs = expDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays <= 0) {
          alerts.push({
            id: `license-exp-${vId}`,
            vehicleId: vId,
            plateNumber: v.plateNumber,
            repName: v.repName,
            type: 'license_expiry',
            severity: 'critical',
            title: `رخصة منتهية للمركبة (${v.plateNumber})`,
            description: `انتهت رخصة المركبة بتاريخ ${v.licenseExpiresAt} (منذ ${Math.abs(diffDays)} يوم).`,
            currentValue: 'منتهية',
            thresholdValue: v.licenseExpiresAt,
            dueDate: v.licenseExpiresAt,
          });
        } else if (diffDays <= 30) {
          alerts.push({
            id: `license-due-${vId}`,
            vehicleId: vId,
            plateNumber: v.plateNumber,
            repName: v.repName,
            type: 'license_expiry',
            severity: 'warning',
            title: `اقتراب انتهاء رخصة المركبة (${v.plateNumber})`,
            description: `متبقي ${diffDays} يوم على انتهاء رخصة المركبة (تاريخ الانتهاء: ${v.licenseExpiresAt}).`,
            currentValue: `${diffDays} يوم متبقي`,
            thresholdValue: v.licenseExpiresAt,
            dueDate: v.licenseExpiresAt,
          });
        }
      }

      const latestOilChange = await this.anyDb
        .selectFrom('fleet_oil_changes')
        .selectAll()
        .where('vehicle_id', '=', vId)
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'active')
        .orderBy('created_at', 'desc')
        .executeTakeFirst();

      if (latestOilChange) {
        const nextDue = Number(latestOilChange.next_due_odometer || 0);
        const alertKm = Number(latestOilChange.alert_km_before || 500);
        const kmRemaining = nextDue - currOdo;

        if (kmRemaining <= 0) {
          alerts.push({
            id: `oil-overdue-${vId}`,
            vehicleId: vId,
            plateNumber: v.plateNumber,
            repName: v.repName,
            type: 'oil_change',
            severity: 'critical',
            title: `تجاوز موعد غيار الزيت (${v.plateNumber})`,
            description: `تجاوزت السيارة موعد غيار الزيت بـ ${Math.abs(kmRemaining)} كم! (العداد الحالي: ${currOdo}، المقرر: ${nextDue} كم - نوع الزيت: ${latestOilChange.oil_type}).`,
            currentValue: currOdo,
            thresholdValue: nextDue,
          });
        } else if (kmRemaining <= alertKm) {
          alerts.push({
            id: `oil-due-${vId}`,
            vehicleId: vId,
            plateNumber: v.plateNumber,
            repName: v.repName,
            type: 'oil_change',
            severity: 'warning',
            title: `اقتراب موعد غيار الزيت (${v.plateNumber})`,
            description: `متبقي ${kmRemaining} كم فقط على موعد غيار الزيت (العداد الحالي: ${currOdo}، المقرر: ${nextDue} كم - نوع الزيت: ${latestOilChange.oil_type}${latestOilChange.with_filter ? ' مع فلتر' : ''}).`,
            currentValue: currOdo,
            thresholdValue: nextDue,
          });
        }
      }
    }

    return { ok: true, alerts };
  }

  async listVehicleDrivers(tenantId: string, vehicleId: number) {
    const rows = await this.anyDb
      .selectFrom('fleet_vehicle_drivers as fvd')
      .innerJoin('delivery_representatives as dr', 'dr.id', 'fvd.rep_id')
      .select([
        'fvd.id',
        'fvd.vehicle_id as vehicleId',
        'fvd.rep_id as repId',
        'dr.name as repName',
        'dr.phone as repPhone',
        'fvd.shift_name as shiftName',
        'fvd.shift_start_time as shiftStartTime',
        'fvd.shift_end_time as shiftEndTime',
        'fvd.is_active as isActive',
        'fvd.notes',
        'fvd.created_at as createdAt',
      ])
      .where('fvd.tenant_id', '=', tenantId)
      .where('fvd.vehicle_id', '=', vehicleId)
      .orderBy('fvd.id', 'asc')
      .execute();

    return rows;
  }

  async assignVehicleDriver(
    tenantId: string,
    accountId: string,
    payload: {
      vehicleId: number;
      repId: number;
      shiftName: string;
      shiftStartTime?: string;
      shiftEndTime?: string;
      notes?: string;
    },
  ) {
    if (!payload.vehicleId || !payload.repId) {
      throw new AppError('يرجى تحديد المركبة والمندوب/السائق', 'INVALID_PARAMS', 400);
    }

    const inserted = await this.anyDb
      .insertInto('fleet_vehicle_drivers')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        vehicle_id: payload.vehicleId,
        rep_id: payload.repId,
        shift_name: payload.shiftName || 'صباحي',
        shift_start_time: payload.shiftStartTime || null,
        shift_end_time: payload.shiftEndTime || null,
        is_active: true,
        notes: payload.notes || null,
        created_at: sql`NOW()`,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    // Sync vehicle info to delivery_representatives
    const vehicle = await this.anyDb
      .selectFrom('fleet_vehicles')
      .select(['id', 'plate_number', 'van_location_id', 'assigned_rep_id'])
      .where('id', '=', payload.vehicleId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (vehicle) {
      await this.anyDb
        .updateTable('delivery_representatives')
        .set({
          vehicle_plate: vehicle.plate_number,
          is_van_rep: true,
          van_location_id: vehicle.van_location_id || undefined,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', payload.repId)
        .where('tenant_id', '=', tenantId)
        .execute();

      if (!vehicle.assigned_rep_id) {
        await this.anyDb
          .updateTable('fleet_vehicles')
          .set({
            assigned_rep_id: payload.repId,
            status: 'assigned',
            updated_at: sql`NOW()`,
          })
          .where('id', '=', payload.vehicleId)
          .where('tenant_id', '=', tenantId)
          .execute();
      }
    }

    return { ok: true, assignmentId: Number(inserted.id) };
  }

  async removeVehicleDriver(tenantId: string, assignmentId: number) {
    const assignment = await this.anyDb
      .selectFrom('fleet_vehicle_drivers')
      .select(['id', 'vehicle_id', 'rep_id'])
      .where('id', '=', assignmentId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    await this.anyDb
      .deleteFrom('fleet_vehicle_drivers')
      .where('id', '=', assignmentId)
      .where('tenant_id', '=', tenantId)
      .execute();

    if (assignment) {
      const otherAssignment = await this.anyDb
        .selectFrom('fleet_vehicle_drivers as fvd')
        .innerJoin('fleet_vehicles as fv', 'fv.id', 'fvd.vehicle_id')
        .select(['fv.plate_number', 'fv.van_location_id'])
        .where('fvd.tenant_id', '=', tenantId)
        .where('fvd.rep_id', '=', assignment.rep_id)
        .where('fvd.is_active', '=', true)
        .orderBy('fvd.id', 'desc')
        .executeTakeFirst();

      if (otherAssignment) {
        await this.anyDb
          .updateTable('delivery_representatives')
          .set({
            vehicle_plate: otherAssignment.plate_number,
            van_location_id: otherAssignment.van_location_id || undefined,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', assignment.rep_id)
          .where('tenant_id', '=', tenantId)
          .execute();
      } else {
        const vehicle = await this.anyDb
          .selectFrom('fleet_vehicles')
          .select(['plate_number', 'assigned_rep_id'])
          .where('id', '=', assignment.vehicle_id)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();

        if (vehicle) {
          await this.anyDb
            .updateTable('delivery_representatives')
            .set({
              vehicle_plate: null,
              updated_at: sql`NOW()`,
            })
            .where('id', '=', assignment.rep_id)
            .where('tenant_id', '=', tenantId)
            .where('vehicle_plate', '=', vehicle.plate_number)
            .execute();

          if (vehicle.assigned_rep_id === assignment.rep_id) {
            const nextDriver = await this.anyDb
              .selectFrom('fleet_vehicle_drivers')
              .select(['rep_id'])
              .where('vehicle_id', '=', assignment.vehicle_id)
              .where('tenant_id', '=', tenantId)
              .where('is_active', '=', true)
              .orderBy('id', 'asc')
              .executeTakeFirst();

            await this.anyDb
              .updateTable('fleet_vehicles')
              .set({
                assigned_rep_id: nextDriver?.rep_id || null,
                status: nextDriver?.rep_id ? 'assigned' : 'available',
                updated_at: sql`NOW()`,
              })
              .where('id', '=', assignment.vehicle_id)
              .where('tenant_id', '=', tenantId)
              .execute();
          }
        }
      }
    }

    return { ok: true };
  }
}
