import { Inject, Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { CreateTableReservationDto, UpdateTableReservationStatusDto } from '../dto/table-reservation.dto';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';

/*
 * INV-REST-FLOOR-STATE-TRUTH (R5-D, R-I38): the tenant-local day window.
 * reservation_time is stored from client wall-time input, so a day window
 * built as UTC midnight mis-slices it: a 01:00 Cairo reservation is
 * 23:00Z the previous day and fell outside its own day's UTC window.
 * The window below is local midnight .. next local midnight in the
 * tenant's timezone (same two-pass offset conversion the reports range
 * helper uses), so the day the caller asked for is the tenant's day.
 */
function tenantDayWindow(timezone: string, date: string): { start: Date; endExclusive: Date } {
  const [year, month, day] = date.split('-').map(Number);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const offsetMs = (instant: Date): number => {
    const parts = new Map(formatter.formatToParts(instant).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(
      Number(parts.get('year')),
      Number(parts.get('month')) - 1,
      Number(parts.get('day')),
      Number(parts.get('hour')) % 24,
      Number(parts.get('minute')),
      Number(parts.get('second')),
    );
    return asUtc - instant.getTime();
  };
  const zonedToUtc = (y: number, m: number, d: number): Date => {
    const guess = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
    const first = offsetMs(new Date(guess));
    const corrected = guess - first;
    const second = offsetMs(new Date(corrected));
    return new Date(second !== first ? guess - second : corrected);
  };
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    start: zonedToUtc(year, month, day),
    endExclusive: zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()),
  };
}

@Injectable()
export class TableReservationsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
  ) {}

  async listReservations(tenantId: string, branchId?: number, date?: string, type?: string) {
    let query = this.db
      .selectFrom('restaurant_table_reservations')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (type) {
      query = query.where('reservation_type', '=', type);
    }

    if (branchId) {
      query = query.where('branch_id', '=', branchId);
    }

    if (date) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const timeZone = await getTenantTimezone(this.db, tenantId);
        const { start, endExclusive } = tenantDayWindow(timeZone, date);
        query = query
          .where('reservation_time', '>=', start)
          .where('reservation_time', '<', endExclusive);
      } else {
        const startOfDay = new Date(`${date}T00:00:00.000Z`);
        const endOfDay = new Date(`${date}T23:59:59.999Z`);
        query = query
          .where('reservation_time', '>=', startOfDay)
          .where('reservation_time', '<=', endOfDay);
      }
    }

    return query.orderBy('reservation_time', 'asc').execute();
  }

  /*
   * INV-REST-RESERVATION-NO-OVERLAP (R6-B, I4): exact-instant conflict.
   * A table holds at most one active reservation per instant: same tenant,
   * same branch (null matches null — Kysely '=' never matches a null row,
   * so the null branch gets an explicit IS NULL predicate), same trimmed
   * table_number, same reservation_time instant, status confirmed/seated,
   * and not a waitlist row (waitlist rows hold no table). Cancelled and
   * no_show rows never block. excludeId keeps a row from colliding with
   * itself on updateStatus. Honest limit: this is exact-instant only —
   * 19:00 and 19:30 on one table both pass; a true time-window check
   * needs a duration the data does not have (follow-up, not this package).
   */
  private async assertNoOverlap(
    tenantId: string,
    opts: { branchId: number | null; tableNumber: string; reservationTime: Date; excludeId?: number },
  ): Promise<void> {
    let query = this.db
      .selectFrom('restaurant_table_reservations')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('table_number', '=', opts.tableNumber)
      .where('reservation_time', '=', opts.reservationTime)
      .where('status', 'in', ['confirmed', 'seated'])
      .where(sql<boolean>`(reservation_type IS NULL OR reservation_type <> 'waitlist')`);
    if (opts.branchId === null) {
      query = query.where('branch_id', 'is', null);
    } else {
      query = query.where('branch_id', '=', opts.branchId);
    }
    if (opts.excludeId !== undefined) {
      query = query.where('id', '!=', opts.excludeId);
    }
    const clash = await query.executeTakeFirst();
    if (clash) {
      throw new ConflictException(
        `TABLE_ALREADY_RESERVED: الطاولة ${opts.tableNumber} محجوزة بالفعل في هذا التوقيت (${opts.reservationTime.toISOString()}).`,
      );
    }
  }

  async createReservation(tenantId: string, userId: number, dto: CreateTableReservationDto) {
    const isWaitlist = dto.reservationType === 'waitlist';
    if (!dto.guestName) {
      throw new BadRequestException('اسم الضيف إلزامي.');
    }
    if (!isWaitlist && (!dto.tableNumber || !dto.reservationTime)) {
      throw new BadRequestException('بيانات الحجز غير مكتملة (رقم الطاولة، اسم الضيف، ووقت الحجز إلزامية).');
    }

    const reservationTime = dto.reservationTime ? new Date(dto.reservationTime) : new Date();
    if (isNaN(reservationTime.getTime())) {
      throw new BadRequestException('توقيت الحجز غير صالح.');
    }

    // Same trimmed table number the insert below stores, so ' 5' and '5'
    // cannot double-book. Waitlist rows hold no table and never block.
    const tableNumber = dto.tableNumber ? String(dto.tableNumber).trim() : 'قائمة انتظار';
    const branchId = dto.branchId || null;
    if (!isWaitlist) {
      await this.assertNoOverlap(tenantId, { branchId, tableNumber, reservationTime });
    }

    const [created] = await this.db
      .insertInto('restaurant_table_reservations')
      .values({
        tenant_id: tenantId,
        branch_id: branchId,
        table_number: tableNumber,
        guest_name: String(dto.guestName).trim(),
        guest_phone: dto.guestPhone ? String(dto.guestPhone).trim() : null,
        guest_count: Math.max(1, Number(dto.guestCount || 1)),
        reservation_time: reservationTime,
        status: 'confirmed',
        special_requests: dto.specialRequests ? String(dto.specialRequests).trim() : null,
        reservation_type: dto.reservationType || 'reservation',
        created_by: userId,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returningAll()
      .execute();

    return created;
  }

  async updateStatus(tenantId: string, id: number, dto: UpdateTableReservationStatusDto) {
    const existing = await this.db
      .selectFrom('restaurant_table_reservations')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException('الحجز غير موجود.');
    }

    // INV-REST-RESERVATION-NO-OVERLAP (R6-B): re-check whenever the
    // effective table changes, or when a cancelled/no_show row is
    // re-activated into confirmed/seated. A pure confirmed -> seated on
    // the same table needs no check (self-exclusion covers it in all
    // cases). Moving/cancelling a row never blocks on its own table.
    const effectiveTable = dto.tableNumber ? String(dto.tableNumber).trim() : existing.table_number;
    const tableChanged = dto.tableNumber ? effectiveTable !== existing.table_number : false;
    const newIsActive = dto.status === 'confirmed' || dto.status === 'seated';
    const oldIsActive = existing.status === 'confirmed' || existing.status === 'seated';
    if (tableChanged || (newIsActive && !oldIsActive)) {
      await this.assertNoOverlap(tenantId, {
        branchId: existing.branch_id,
        tableNumber: effectiveTable,
        reservationTime: new Date(existing.reservation_time),
        excludeId: existing.id,
      });
    }

    const [updated] = await this.db
      .updateTable('restaurant_table_reservations')
      .set({
        status: dto.status,
        ...(dto.tableNumber ? { table_number: String(dto.tableNumber).trim() } : {}),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .execute();

    return updated;
  }

  async deleteReservation(tenantId: string, id: number) {
    const existing = await this.db
      .selectFrom('restaurant_table_reservations')
      .select('id')
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException('الحجز غير موجود.');
    }

    await this.db
      .deleteFrom('restaurant_table_reservations')
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .execute();

    return { success: true };
  }
}
