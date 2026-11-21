import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { AppError } from '../../../../common/errors/app-error';

export class VanFleetDriversSlice {
  constructor(private readonly db: Kysely<Database>) {}

  private get anyDb(): any {
    return this.db as any;
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
