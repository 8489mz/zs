import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { type Kysely, sql } from '../../database/kysely';
import { type Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { calculateTrucksRequired } from './engines/road-freight.engine';
import * as crypto from 'crypto';
import { formatDailyDocumentNumber } from '../../common/utils/document-number.util';
import { getTenantTimezone } from '../../common/utils/tenant-timezone.util';
import { CreateInlandTruckingTripDto, UpdateInlandTruckingTripStatusDto } from './dto/inland-trucking.dto';

/**
 * MaritimeFreightTruckingService — slice S16 of the maritime-freight split.
 * Pure move of 3 methods from MaritimeFreightService (inland trucking
 * trips and container dispatch: the trip list, the trip creation, and
 * the trip status update). No behavior change: the bodies are
 * byte-identical; the facade keeps thin delegates with the same names
 * and signatures for all 3 public methods.
 * Deps are db + the BOUND assertRoadProofOfDelivery (S12 — the
 * jobs-core slice owns it; the facade binds its own method on the
 * generation tree, S10 form, and the merge repoints it to the S12
 * slice instance when S12 lands). No mail/WhatsApp, no posting, no
 * kernel, no Logger (S16 is not one of the 6 logger slices). The
 * section banner travels into the slice with the blank below it,
 * exactly as in the pristine file (banner close, blank, then the
 * first method — unlike the pipeline banner, this one HAS a blank
 * between banner and method). Date handling travels verbatim: one
 * bare date construction and three more with arguments, one tenant
 * timezone lookup — pure moves, no UTC-slice normalizer, no instant
 * comparison. Guard: no rounding helpers, no posting, two
 * transactions. The status update calls the bound road-proof check
 * inside its open transaction — that shape is a known hang on the
 * in-memory test database and is recorded as follow-up fix debt, NOT
 * changed here (pure move). The status update is the riskiest
 * unpinned method in this slice.
 */

export interface MaritimeFreightTruckingDeps {
  db: Kysely<Database>;
  // Bound S12 method (same name as the facade member, so the moved body
  // is byte-identical). assertRoadProofOfDelivery has NO explicit return
  // type in the pristine file, so the bound type uses Promise<any>
  // (S14 getJobById precedent). The S12 slice owns it forever; the
  // facade binds its own method on the generation tree (S10 form) and
  // the merge repoints it to the S12 slice instance.
  assertRoadProofOfDelivery: (
    tenantId: string,
    jobId: string,
    bookingNumber: string | null | undefined,
  ) => Promise<any>;
}

@Injectable()
export class MaritimeFreightTruckingService {
  private readonly db: Kysely<Database>;
  private readonly assertRoadProofOfDelivery: (
    tenantId: string,
    jobId: string,
    bookingNumber: string | null | undefined,
  ) => Promise<any>;

  constructor(deps: MaritimeFreightTruckingDeps) {
    this.db = deps.db;
    this.assertRoadProofOfDelivery = deps.assertRoadProofOfDelivery;
  }

  // ==========================================
  // 5. Inland Trucking Trips & Container Dispatch
  // ==========================================

  async listInlandTruckingTrips(auth: AuthContext, jobId?: string | number) {
    const { tenantId } = requireTenantScope(auth);
    let query = this.db.selectFrom('maritime_inland_trucking_trips').selectAll().where('tenant_id', '=', tenantId);

    if (jobId) {
      query = query.where('job_id', '=', String(jobId));
    }

    return await query.orderBy('id', 'desc').execute();
  }

  async createInlandTruckingTrip(auth: AuthContext, dto: CreateInlandTruckingTripDto) {
    const { tenantId } = requireTenantScope(auth);
    const tempTripNumber = `TRIP-TMP-${crypto.randomUUID()}`;

    return await this.db.transaction().execute(async (trx) => {
      const [trip] = await trx
        .insertInto('maritime_inland_trucking_trips')
        .values({
          tenant_id: tenantId,
          job_id: String(dto.jobId),
          trip_number: tempTripNumber,
          container_number: dto.containerNumber || null,
          trucking_company: dto.truckingCompany,
          driver_name: dto.driverName,
          driver_phone: dto.driverPhone || null,
          truck_plate: dto.truckPlate,
          trailer_plate: dto.trailerPlate || null,
          origin_port_terminal: dto.originPortTerminal,
          delivery_destination: dto.deliveryDestination,
          dispatch_date: dto.dispatchDate ? new Date(dto.dispatchDate) : sql`NOW()`,
          delivery_date: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
          trip_status: 'assigned',
          cost_amount: Number(dto.costAmount || 0),
          sell_amount: Number(dto.sellAmount || 0),
          currency: dto.currency || 'EGP',
          notes: dto.notes || null,
        })
        .returningAll()
        .execute();

      const finalTripNumber = formatDailyDocumentNumber(
        'TRIP',
        Number(trip.id),
        new Date(),
        4,
        await getTenantTimezone(trx, tenantId),
      );

      const [updatedTrip] = await trx
        .updateTable('maritime_inland_trucking_trips')
        .set({ trip_number: finalTripNumber })
        .where('id', '=', trip.id)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .execute();

      // If job exists, register milestone on the job
      const job = await trx
        .selectFrom('maritime_jobs')
        .select(['id', 'transport_mode', 'status'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(dto.jobId))
        .executeTakeFirst();

      if (job) {
        if (job.status === 'completed') {
          throw new BadRequestException('أعد فتح الشحنة قبل إضافة رحلة نقل بري جديدة');
        }
        await trx
          .insertInto('maritime_job_milestones')
          .values({
            tenant_id: tenantId,
            job_id: String(job.id),
            milestone_key: 'TRK_ASSIGN',
            milestone_title: `تعيين الشاحنة والسائق للرحلة ${finalTripNumber} (${dto.truckPlate})`,
            location: dto.originPortTerminal,
            notes: `تم تكليف الشاحنة ${dto.truckPlate} والسائق ${dto.driverName} بالتحرك من ${dto.originPortTerminal} إلى ${dto.deliveryDestination}`,
            recorded_by: auth.userId ? Number(auth.userId) : null,
          })
          .execute();

        if (job.transport_mode === 'road') {
          await trx
            .updateTable('maritime_jobs')
            .set({ milestone_status: 'TRK_ASSIGN' })
            .where('id', '=', job.id)
            .where('tenant_id', '=', tenantId)
            .execute();
        }
      }

      return updatedTrip;
    });
  }

  async updateInlandTruckingTripStatus(auth: AuthContext, id: string | number, dto: UpdateInlandTruckingTripStatusDto) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db.transaction().execute(async (trx) => {
      const trip = await trx
        .selectFrom('maritime_inland_trucking_trips')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(id))
        .forUpdate()
        .executeTakeFirst();
      if (!trip) throw new NotFoundException('Inland trucking trip not found');
      const job = await trx
        .selectFrom('maritime_jobs')
        .select(['transport_mode', 'gross_weight_kg', 'total_cbm', 'booking_number'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', trip.job_id)
        .executeTakeFirst();
      if (job?.transport_mode === 'road' && dto.tripStatus === 'in_transit') {
        const assigned = await trx
          .selectFrom('maritime_inland_trucking_trips')
          .select('truck_plate')
          .where('tenant_id', '=', tenantId)
          .where('job_id', '=', trip.job_id)
          .where('trip_status', 'in', ['assigned', 'loading', 'in_transit'])
          .execute();
        try {
          calculateTrucksRequired({
            grossWeightKg: Number(job.gross_weight_kg || 0),
            totalCbm: Number(job.total_cbm || 0),
            assignedTrucks: new Set(assigned.map((row) => row.truck_plate)).size,
          });
        } catch (error: any) {
          throw new BadRequestException(error.message);
        }
      }
      if (job?.transport_mode === 'road' && dto.tripStatus === 'delivered') {
        await this.assertRoadProofOfDelivery(tenantId, trip.job_id, job.booking_number);
      }
      const [updated] = await trx
        .updateTable('maritime_inland_trucking_trips')
        .set({
          trip_status: dto.tripStatus,
          delivery_date: dto.deliveryDate ? new Date(dto.deliveryDate) : undefined,
          notes: dto.notes !== undefined ? dto.notes : undefined,
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(id))
        .returningAll()
        .execute();

      if (!updated) {
        throw new NotFoundException('Inland trucking trip not found');
      }

      // Map trip status to job milestone progression
      const statusMilestoneMap: Record<string, { key: string; title: string }> = {
        loading: {
          key: 'TRK_LOADED',
          title: `إتمام تحميل وتربيط البضاعة بالشاحنة (Cargo Loaded - ${updated.trip_number})`,
        },
        in_transit: {
          key: 'TRK_DISPATCH',
          title: `انطلاق الشاحنة على مسار النقل (Truck In Transit - ${updated.trip_number})`,
        },
        delivered: {
          key: 'TRK_POD',
          title: `وصول الشاحنة وتفريغ وتسليم البضاعة وإثبات التسليم (Delivered & POD - ${updated.trip_number})`,
        },
      };

      const mapping = statusMilestoneMap[dto.tripStatus];
      if (mapping) {
        await trx
          .insertInto('maritime_job_milestones')
          .values({
            tenant_id: tenantId,
            job_id: String(updated.job_id),
            milestone_key: mapping.key,
            milestone_title: mapping.title,
            location: dto.tripStatus === 'delivered' ? updated.delivery_destination : updated.origin_port_terminal,
            notes: dto.notes || `تم تحديث حالة رحلة النقل البري ${updated.trip_number} إلى ${dto.tripStatus}`,
            recorded_by: auth.userId ? Number(auth.userId) : null,
          })
          .execute();

        await trx
          .updateTable('maritime_jobs')
          .set({ milestone_status: mapping.key })
          .where('id', '=', String(updated.job_id))
          .where('tenant_id', '=', tenantId)
          .execute();
      }

      return updated;
    });
  }
}
