import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { AppError } from '../../../../common/errors/app-error';
import { FLEET_VEHICLE_STATUSES } from '../van-common.util';

export class VanFleetVehiclesSlice {
  constructor(private readonly db: Kysely<Database>) {}

  get anyDb(): any {
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
  async assertVehicleUsableByRep(
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
        throw new AppError('هذه الرحلة تخص مندوباً آخر، لا يمكنك تسجيل وقود عليها', 'REP_TRIP_NOT_OWNED', 403);
      }
      if ((trip as any).vehicle_id != null && Number((trip as any).vehicle_id) !== Number(vehicleId)) {
        throw new AppError('هذه المركبة ليست مركبة الرحلة المذكورة', 'REP_VEHICLE_NOT_ASSIGNED', 403);
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

    throw new AppError('هذه المركبة ليست مسندة إليك، لا يمكنك تسجيل وقود/زيت عليها', 'REP_VEHICLE_NOT_ASSIGNED', 403);
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
          {
            id: Number(inserted.id),
            van_location_id: Number(loc.id),
            assigned_rep_id: null,
            plate_number: plateNumber,
          },
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
      throw new AppError(`حالة مركبة غير صالحة: "${payload.status}"`, 'INVALID_VEHICLE_STATUS', 400);
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

      const afterReassign =
        payload.assignedRepId !== undefined
          ? await trxAny
              .selectFrom('fleet_vehicles')
              .select(['assigned_rep_id', 'status'])
              .where('id', '=', id)
              .where('tenant_id', '=', tenantId)
              .executeTakeFirstOrThrow()
          : { assigned_rep_id: existing.assigned_rep_id, status: existing.status };

      await trxAny
        .updateTable('fleet_vehicles')
        .set({
          plate_number: payload.plateNumber?.trim() || existing.plate_number,
          model_name: payload.modelName !== undefined ? payload.modelName?.trim() : existing.model_name,
          vehicle_type: payload.vehicleType || existing.vehicle_type,
          vin_chassis: payload.vinChassis !== undefined ? payload.vinChassis?.trim() : existing.vin_chassis,
          branch_id:
            payload.branchId !== undefined ? (payload.branchId ? Number(payload.branchId) : null) : existing.branch_id,
          current_odometer:
            payload.currentOdometer !== undefined ? Number(payload.currentOdometer) : existing.current_odometer,
          fuel_type: payload.fuelType || existing.fuel_type,
          license_expires_at:
            payload.licenseExpiresAt !== undefined ? payload.licenseExpiresAt : existing.license_expires_at,
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
}
