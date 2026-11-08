import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Kysely } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AppError } from '../../common/errors/app-error';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { TransactionHelper } from '../../database/helpers/transaction.helper';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../accounting/accounting-tenant-foundation.service';
import { postMaintenanceJournal } from './maintenance-accounting';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, toMinorUnits } from '../accounting/engines/money-minor-units.engine';
import { valueStockReceipt } from '../accounting/inventory-valuation';
import { applyStockDelta } from '../../common/utils/location-stock-ledger';
import { UpsertMaintenanceTicketDto } from './dto/upsert-maintenance-ticket.dto';
import { UpdateTicketStatusDto, AddTicketPartDto } from './dto/update-ticket-status.dto';
import { normalizeArabicSearch } from '../../common/utils/arabic-search.util';
import { formatDailyDocumentNumber, getDailyDocumentPrefix } from '../../common/utils/document-number.util';

/**
 * Warranty expiry for a repaired ticket: repaired_at + warranty_days.
 * Pure (no DB) so the PGlite spec pins the exact arithmetic the
 * service uses. Days are exact 24h multiples from the repair instant;
 * a non-positive day count means the warranty ends at repair time.
 */
export function computeWarrantyEnd(repairedAt: Date, warrantyDays: number): Date {
  const days = Number.isFinite(warrantyDays) ? Math.max(0, Math.floor(warrantyDays)) : 0;
  return new Date(repairedAt.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Find the sale a device was sold under, by serial / second IMEI.
 * Tenant-scoped, case-insensitive, only SOLD serials (sales-write
 * marks them 'sold' with sale_id); the latest row wins. Returns null
 * silently when nothing matches — the device may come from elsewhere
 * and intake must never fail on it. Takes a Kysely handle so the
 * same query runs inside createTicket's transaction and, in the
 * PGlite spec, directly against a test database.
 */
export async function findSoldSerialSaleId(
  db: Kysely<Database>,
  tenantId: string,
  serial: string,
): Promise<number | null> {
  const needle = serial.trim().toLowerCase();
  if (!needle) return null;
  const row = await db
    .selectFrom('product_serials')
    .select('sale_id')
    .where('tenant_id', '=', tenantId)
    .where('status', '=', 'sold')
    .where((eb) =>
      eb.or([
        sql<boolean>`LOWER(serial_number) = ${needle}`,
        sql<boolean>`LOWER(imei_2) = ${needle}`,
      ]),
    )
    .orderBy('id', 'desc')
    .executeTakeFirst();
  return row?.sale_id ? Number(row.sale_id) : null;
}

/** Financial fields: changing any of them still needs the reversal flow. */
export function isFinancialTicketChange(
  payload: Pick<UpsertMaintenanceTicketDto, 'advancePayment' | 'finalCost' | 'expectedCost' | 'status'>,
  existing: { advance_payment: number; final_cost: number; expected_cost: number; status: string },
): boolean {
  if (payload.advancePayment !== undefined && Number(payload.advancePayment) !== Number(existing.advance_payment)) return true;
  if (payload.finalCost !== undefined && Number(payload.finalCost) !== Number(existing.final_cost)) return true;
  if (payload.expectedCost !== undefined && Number(payload.expectedCost) !== Number(existing.expected_cost)) return true;
  if (payload.status !== undefined && payload.status !== existing.status) return true;
  return false;
}

export type NonFinancialTicketRow = {
  customer_id: number | null;
  customer_name: string;
  customer_phone: string;
  device_brand: string | null;
  device_model: string;
  serial_number: string | null;
  passcode: string | null;
  problem_description: string;
  device_condition: string | null;
  technician_id: number | null;
  technician_name: string | null;
  technician_notes: string | null;
  branch_id: number | null;
  location_id: number | null;
  warranty_days: number;
};

/**
 * Build the updateTicket SET clause for non-financial corrections
 * (D-M2-1). Omitted fields keep their stored values — never null,
 * never a create-time default ('عميل نقدي' / 'جهاز عام' / 30 would
 * silently overwrite real data on a partial edit). Only nullable
 * free-text fields clear, and only on an explicitly sent empty
 * string. Financial keys are never emitted here.
 */
export function buildNonFinancialTicketUpdate(
  payload: UpsertMaintenanceTicketDto,
  existing: NonFinancialTicketRow,
): Record<string, unknown> {
  const clearable = (value: string | undefined, stored: string | null): string | null =>
    value !== undefined ? (value?.trim() ? value.trim() : null) : stored;
  return {
    customer_id: payload.customerId ?? existing.customer_id,
    customer_name: payload.customerName?.trim() || existing.customer_name,
    customer_phone: payload.customerPhone?.trim() || existing.customer_phone,
    device_brand: clearable(payload.deviceBrand, existing.device_brand),
    device_model: payload.deviceModel?.trim() || existing.device_model,
    serial_number: clearable(payload.serialNumber, existing.serial_number),
    passcode: clearable(payload.passcode, existing.passcode),
    problem_description: payload.problemDescription?.trim() || existing.problem_description,
    device_condition: clearable(payload.deviceCondition, existing.device_condition),
    technician_id: payload.technicianId ?? existing.technician_id,
    technician_name: clearable(payload.technicianName, existing.technician_name),
    technician_notes: clearable(payload.technicianNotes, existing.technician_notes),
    branch_id: payload.branchId ?? existing.branch_id,
    location_id: payload.locationId ?? existing.location_id,
    warranty_days: payload.warrantyDays ?? existing.warranty_days,
    updated_at: new Date(),
  };
}

@Injectable()
export class MaintenanceService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly accountingPosting: AccountingPostingService,
    private readonly accountingFoundation: AccountingTenantFoundationService,
  ) {}

  private isExactMaintenanceSettlement(remaining: number, advance: number, total: number, digits: 2 | 3): boolean {
    try {
      return toMinorUnits(remaining, digits) + toMinorUnits(advance, digits) === toMinorUnits(total, digits);
    } catch {
      return false;
    }
  }

  async listTickets(
    auth: AuthContext,
    filters?: {
      status?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const scope = requireTenantScope(auth);
    let baseQuery = this.db
      .selectFrom('maintenance_tickets')
      .where('tenant_id', '=', scope.tenantId);

    if (filters?.status && filters.status !== 'all') {
      baseQuery = baseQuery.where('status', '=', filters.status as any);
    }

    if (filters?.q && filters.q.trim()) {
      const term = `%${normalizeArabicSearch(filters.q)}%`;
      baseQuery = baseQuery.where(sql<boolean>`(
        lower(ticket_no) like ${term}
        OR TRANSLATE(LOWER(COALESCE(customer_name, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}
        OR lower(customer_phone) like ${term}
        OR lower(serial_number) like ${term}
        OR TRANSLATE(LOWER(COALESCE(device_model, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}
      )`);
    }

    const totalRes = await baseQuery
      .select((eb) => eb.fn.count('id').as('count'))
      .executeTakeFirst();
    const total = Number(totalRes?.count || 0);

    const page = Math.max(1, Number(filters?.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(filters?.pageSize || 25)));
    const offset = (page - 1) * pageSize;

    const tickets = await baseQuery
      .selectAll()
      .orderBy('id', 'desc')
      .limit(pageSize)
      .offset(offset)
      .execute();

    return {
      tickets: tickets.map((t) => ({
        id: String(t.id),
        ticketNo: t.ticket_no,
        customerId: t.customer_id ? String(t.customer_id) : null,
        customerName: t.customer_name,
        customerPhone: t.customer_phone,
        deviceBrand: t.device_brand,
        deviceModel: t.device_model,
        serialNumber: t.serial_number,
        passcode: t.passcode ? '******' : null,
        problemDescription: t.problem_description,
        deviceCondition: t.device_condition,
        expectedCost: Number(t.expected_cost),
        finalCost: Number(t.final_cost),
        advancePayment: Number(t.advance_payment),
        status: t.status,
        technicianId: t.technician_id ? String(t.technician_id) : null,
        technicianName: t.technician_name,
        technicianNotes: t.technician_notes,
        branchId: t.branch_id ? String(t.branch_id) : null,
        locationId: t.location_id ? String(t.location_id) : null,
        saleId: t.sale_id ? String(t.sale_id) : null,
        warrantyDays: t.warranty_days,
        warrantyEnd: t.warranty_end ?? null,
        receivedAt: t.received_at,
        repairedAt: t.repaired_at,
        deliveredAt: t.delivered_at,
        createdAt: t.created_at,
      })),
      pagination: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Aggregate KPI counts + outstanding remainder in ONE SQL query —
   * never pull the table (the page used to fetch pageSize 1000 and
   * counted client-side, which silently broke past 100 tickets,
   * review P2-4). Shape is contractual: package 6's frontend is
   * built against it, do not change it. totalRemaining sums
   * max(0, (final_cost || expected_cost) - advance_payment) over
   * open tickets only (delivered / cancelled / unrepairable excluded).
   * A zero final_cost falls back to the estimate, matching the
   * JS `finalCost || expectedCost` the page used to compute.
   */
  async getTicketCounts(auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const result = await sql<{
      received: string;
      inspecting: string;
      in_progress: string;
      waiting_parts: string;
      repaired: string;
      delivered: string;
      unrepairable: string;
      cancelled: string;
      total: string;
      total_remaining: string;
    }>`
      SELECT
        COUNT(*) FILTER (WHERE status = 'received') AS received,
        COUNT(*) FILTER (WHERE status = 'inspecting') AS inspecting,
        COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
        COUNT(*) FILTER (WHERE status = 'waiting_parts') AS waiting_parts,
        COUNT(*) FILTER (WHERE status = 'repaired') AS repaired,
        COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
        COUNT(*) FILTER (WHERE status = 'unrepairable') AS unrepairable,
        COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
        COUNT(*) AS total,
        COALESCE(SUM(CASE
          WHEN status NOT IN ('delivered', 'cancelled', 'unrepairable')
          THEN GREATEST(0, COALESCE(NULLIF(final_cost, 0), expected_cost, 0) - COALESCE(advance_payment, 0))
          ELSE 0
        END), 0) AS total_remaining
      FROM maintenance_tickets
      WHERE tenant_id = ${scope.tenantId}
    `.execute(this.db);
    const row = result.rows[0];
    const counts = {
      received: Number(row?.received || 0),
      inspecting: Number(row?.inspecting || 0),
      in_progress: Number(row?.in_progress || 0),
      waiting_parts: Number(row?.waiting_parts || 0),
      repaired: Number(row?.repaired || 0),
      delivered: Number(row?.delivered || 0),
      unrepairable: Number(row?.unrepairable || 0),
      cancelled: Number(row?.cancelled || 0),
      total: Number(row?.total || 0),
    };
    return { counts, totalRemaining: Number(row?.total_remaining || 0) };
  }

  async getTicket(id: number, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const ticket = await this.db
      .selectFrom('maintenance_tickets')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!ticket) {
      throw new AppError('تذكرة الصيانة غير موجودة', 'TICKET_NOT_FOUND', 404);
    }

    const parts = await this.db
      .selectFrom('maintenance_ticket_parts')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('ticket_id', '=', id)
      .orderBy('id', 'asc')
      .execute();

    // True when the advance was actually refunded (a refund treasury
    // row exists); the detail card must not offer a second refund.
    // Package 7 reads this defensively — a missing row means false.
    const refundRow = await this.db
      .selectFrom('treasury_transactions')
      .select('id')
      .where('tenant_id', '=', scope.tenantId)
      .where('reference_type', '=', 'maintenance_advance_refund')
      .where('reference_id', '=', id)
      .executeTakeFirst();

    return {
      ticket: {
        id: String(ticket.id),
        ticketNo: ticket.ticket_no,
        customerId: ticket.customer_id ? String(ticket.customer_id) : null,
        customerName: ticket.customer_name,
        customerPhone: ticket.customer_phone,
        deviceBrand: ticket.device_brand,
        deviceModel: ticket.device_model,
        serialNumber: ticket.serial_number,
        passcode: ticket.passcode,
        problemDescription: ticket.problem_description,
        deviceCondition: ticket.device_condition,
        expectedCost: Number(ticket.expected_cost),
        finalCost: Number(ticket.final_cost),
        advancePayment: Number(ticket.advance_payment),
        status: ticket.status,
        technicianId: ticket.technician_id ? String(ticket.technician_id) : null,
        technicianName: ticket.technician_name,
        technicianNotes: ticket.technician_notes,
        branchId: ticket.branch_id ? String(ticket.branch_id) : null,
        locationId: ticket.location_id ? String(ticket.location_id) : null,
        saleId: ticket.sale_id ? String(ticket.sale_id) : null,
        warrantyDays: ticket.warranty_days,
        warrantyEnd: ticket.warranty_end ?? null,
        refundedAdvance: Boolean(refundRow),
        receivedAt: ticket.received_at,
        repairedAt: ticket.repaired_at,
        deliveredAt: ticket.delivered_at,
        createdAt: ticket.created_at,
        parts: parts.map((p) => ({
          id: String(p.id),
          ticketId: String(p.ticket_id),
          productId: String(p.product_id),
          productName: p.product_name,
          qty: Number(p.qty),
          unitCost: Number(p.unit_cost),
          unitPrice: Number(p.unit_price),
          totalPrice: Number(p.qty) * Number(p.unit_price),
          locationId: p.location_id ? String(p.location_id) : null,
          createdAt: p.created_at,
        })),
      },
    };
  }

  async createTicket(payload: UpsertMaintenanceTicketDto, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const advance = Number(payload.advancePayment || 0);
    if (!Number.isFinite(advance) || advance < 0 || !Number.isFinite(Number(payload.finalCost ?? payload.expectedCost ?? 0)) ||
        Number(payload.finalCost ?? payload.expectedCost ?? 0) < 0 || payload.status === 'delivered') {
      throw new AppError('Invalid maintenance payment or initial state', 'MAINTENANCE_FINANCIAL_STATE_INVALID', 422);
    }
    // An advance larger than the ticket total can never settle at delivery
    // (delivery requires finalCost >= advance), so intake rejects it now
    // instead of bricking the ticket. The total is the final cost when set,
    // otherwise the estimate; an advance with no estimate at all also rejects.
    const ticketTotal = Number(payload.finalCost ?? payload.expectedCost ?? 0);
    if (advance > ticketTotal) {
      throw new AppError(
        `Maintenance advance ${advance} exceeds ticket total ${ticketTotal}; the advance cannot be larger than the ticket total`,
        'MAINTENANCE_ADVANCE_EXCEEDS_ESTIMATE',
        422,
      );
    }
    const advanceDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    try {
      toMinorUnits(advance, advanceDigits);
      toMinorUnits(Number(payload.finalCost ?? payload.expectedCost ?? 0), advanceDigits);
    } catch {
      throw new AppError('Maintenance amounts exceed tenant currency precision', 'MAINTENANCE_CURRENCY_PRECISION_INVALID', 422);
    }
    const result = await this.tx.runInTransaction(this.db, async (trx) => {
      const tempTicketNo = `TMP-ZM-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

      // Link the ticket to the sale this device was sold under, when
      // the serial matches a SOLD serial (review P2-1: sale_id was a
      // dead column nothing ever wrote). Unknown / unsold serials
      // leave sale_id null silently — the device may come from
      // elsewhere and intake must never fail on it.
      const serial = payload.serialNumber?.trim();
      const saleId = serial ? await findSoldSerialSaleId(trx, scope.tenantId, serial) : null;

      const inserted = await trx
        .insertInto('maintenance_tickets')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          ticket_no: tempTicketNo,
          customer_id: payload.customerId ?? null,
          customer_name: (payload.customerName || (payload as any).name || 'عميل نقدي').trim(),
          customer_phone: (payload.customerPhone || (payload as any).phone || '').trim(),
          device_brand: payload.deviceBrand?.trim() ?? null,
          device_model: (payload.deviceModel || (payload as any).model || 'جهاز عام').trim(),
          serial_number: payload.serialNumber?.trim() ?? null,
          passcode: payload.passcode?.trim() ?? null,
          problem_description: (payload.problemDescription || (payload as any).customerProblem || (payload as any).problem || 'صيانة عامة').trim(),
          device_condition: payload.deviceCondition?.trim() ?? null,
          expected_cost: payload.expectedCost ?? 0,
          final_cost: payload.finalCost ?? payload.expectedCost ?? 0,
          advance_payment: payload.advancePayment ?? 0,
          status: payload.status ?? 'received',
          technician_id: payload.technicianId ?? null,
          technician_name: payload.technicianName?.trim() ?? null,
          technician_notes: payload.technicianNotes?.trim() ?? null,
          branch_id: payload.branchId ?? null,
          location_id: payload.locationId ?? null,
          sale_id: saleId,
          warranty_days: payload.warrantyDays ?? 30,
          received_at: new Date(),
        } as any)
        .returning('id')
        .executeTakeFirst();

      if (!inserted?.id) {
        throw new AppError('تعذر إنشاء تذكرة الصيانة', 'CREATE_TICKET_FAILED', 400);
      }

      const ticketId = Number(inserted.id);
      const ticketNo = formatDailyDocumentNumber('ZM', ticketId);

      await trx
        .updateTable('maintenance_tickets')
        .set({ ticket_no: ticketNo })
        .where('id', '=', ticketId)
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      // If advance payment was made, record cash-in to treasury atomically
      if (payload.advancePayment && Number(payload.advancePayment) > 0) {
        await trx
          .insertInto('treasury_transactions')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            txn_type: 'revenue',
            amount: Number(payload.advancePayment),
            note: `عربون صيانة تذكرة ${ticketNo} - العميل: ${(payload.customerName || '').trim()}`,
            reference_type: 'maintenance_ticket',
            reference_id: ticketId,
            branch_id: payload.branchId ?? null,
            location_id: payload.locationId ?? null,
            created_by: auth.userId ? Number(auth.userId) : null,
          })
          .execute();
        await postMaintenanceJournal(trx, this.accountingFoundation, this.accountingPosting, auth,
          'maintenance_advance', ticketId, payload.branchId ?? null, payload.locationId ?? null, [
            { code: '1110', debit: advance, description: 'Cash received as maintenance customer advance' },
            { code: '2150', credit: advance, description: 'Unearned maintenance customer advance' },
          ]);
      }

      return { id: String(ticketId), ticketNo };
    });

    await this.audit.log('إنشاء تذكرة صيانة', `تم إنشاء تذكرة صيانة ${result.ticketNo} للعميل ${payload.customerName}`, auth);
    return { ok: true, id: result.id, ticketNo: result.ticketNo };
  }

  async updateTicket(id: number, payload: UpsertMaintenanceTicketDto, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const ticketNo = await this.tx.runInTransaction(this.db, async (trx) => {
      const existing = await trx
        .selectFrom('maintenance_tickets')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();

      if (!existing) {
        throw new AppError('تذكرة الصيانة غير موجودة', 'TICKET_NOT_FOUND', 404);
      }

      // D-M2-1: delivered tickets stay FULLY frozen — any edit needs
      // the reversal flow, exactly as before.
      if (existing.status === 'delivered') {
        throw new AppError('Posted maintenance ticket requires settlement document', 'MAINTENANCE_REVERSAL_REQUIRED', 409);
      }
      // Financial fields still require the reversal flow when the
      // payload tries to CHANGE them versus the stored ticket.
      if (isFinancialTicketChange(payload, existing)) {
        throw new AppError('Posted ticket amounts and status require an audited reversal flow', 'MAINTENANCE_REVERSAL_REQUIRED', 409);
      }
      // Non-financial corrections (name/phone, brand/model, serial,
      // problem, condition, technician, branch/location, warrantyDays)
      // are allowed even after an advance was taken or parts issued —
      // the old blanket block made even a phone-number typo
      // unfixable (review P2-2). Omitted fields keep stored values.
      await trx
        .updateTable('maintenance_tickets')
        .set(buildNonFinancialTicketUpdate(payload, existing))
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', id)
        .execute();

      return existing.ticket_no;
    });

    await this.audit.log('تعديل تذكرة صيانة', `تم تحديث بيانات تذكرة الصيانة ${ticketNo}`, auth);
    return { ok: true };
  }

  async updateTicketStatus(id: number, payload: UpdateTicketStatusDto, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const existing = await this.tx.runInTransaction(this.db, async (trx) => {
      const ticket = await trx
        .selectFrom('maintenance_tickets')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();

      if (!ticket) {
        throw new AppError('تذكرة الصيانة غير موجودة', 'TICKET_NOT_FOUND', 404);
      }

      // The ticket row lock serializes delivery retries and cash collection.
      if (ticket.delivered_at && (payload.status !== 'delivered' ||
          payload.finalCost !== undefined || payload.collectedAmount !== undefined)) {
        throw new AppError('Delivered maintenance cannot be revised', 'MAINTENANCE_REVERSAL_REQUIRED', 409);
      }
      if (payload.collectedAmount !== undefined && (!Number.isFinite(Number(payload.collectedAmount)) || Number(payload.collectedAmount) < 0)) {
        throw new AppError('Invalid maintenance collection', 'INVALID_MAINTENANCE_COLLECTION', 400);
      }
      if (payload.finalCost !== undefined && (!Number.isFinite(Number(payload.finalCost)) || Number(payload.finalCost) < 0)) {
        throw new AppError('Invalid maintenance final cost', 'INVALID_MAINTENANCE_COST', 400);
      }
      if (ticket.status === 'delivered' &&
          (payload.status !== 'delivered' ||
           (payload.finalCost !== undefined && Number(payload.finalCost) !== Number(ticket.final_cost)) ||
           (payload.collectedAmount !== undefined && Number(payload.collectedAmount) > 0))) {
        throw new AppError('Delivered maintenance cannot be rebooked without reversal', 'MAINTENANCE_REVERSAL_REQUIRED', 409);
      }
      const terminal = ['cancelled', 'unrepairable'];
      if (terminal.includes(ticket.status) && payload.status !== ticket.status) {
        throw new AppError('Cancelled maintenance cannot be reopened without a new source document',
          'MAINTENANCE_REVERSAL_REQUIRED', 409);
      }
      if (payload.refundAdvance && (!terminal.includes(payload.status) ||
          payload.finalCost !== undefined || payload.collectedAmount !== undefined ||
          Number(ticket.advance_payment || 0) <= 0)) {
        throw new AppError('Explicit cash refund is valid only when cancelling a ticket with an advance',
          'MAINTENANCE_REFUND_STATE_INVALID', 422);
      }
      if (terminal.includes(payload.status) && ticket.status !== payload.status) {
        const part = await trx.selectFrom('maintenance_ticket_parts').select('id')
          .where('tenant_id', '=', scope.tenantId).where('ticket_id', '=', id).executeTakeFirst();
        if (part || (Number(ticket.advance_payment || 0) > 0 && !payload.refundAdvance)) {
          throw new AppError('Return all consumed parts and explicitly refund cash advance before cancellation',
            'MAINTENANCE_REVERSAL_REQUIRED', 409);
        }
      }
      if (payload.refundAdvance && ticket.status === payload.status) {
        // A repeated cancellation is an idempotent acknowledgement only when
        // the first refund was actually committed, not merely a status change.
        const previousRefund = await trx.selectFrom('treasury_transactions').select('id')
          .where('tenant_id', '=', scope.tenantId).where('reference_type', '=', 'maintenance_advance_refund')
          .where('reference_id', '=', id).executeTakeFirst();
        if (!previousRefund) throw new AppError('Historical cancellation has no verified refund',
          'MAINTENANCE_REFUND_RECONCILIATION_REQUIRED', 409);
      }
      const updates: Record<string, any> = {
        status: payload.status,
        updated_at: new Date(),
      };

      if (payload.finalCost !== undefined) {
        updates.final_cost = payload.finalCost;
      }
      if (payload.technicianNotes !== undefined) {
        updates.technician_notes = payload.technicianNotes;
      }
      if (payload.status === 'repaired' && !ticket.repaired_at) {
        // First repair sets the warranty clock: repaired_at +
        // the then-current warranty_days. Editing warrantyDays
        // before repair is picked up automatically (read here, not
        // at intake); a later repair transition never recomputes.
        const repairedAt = new Date();
        updates.repaired_at = repairedAt;
        updates.warranty_end = computeWarrantyEnd(repairedAt, Number(ticket.warranty_days ?? 30));
      }
      if (payload.status === 'delivered' && !ticket.delivered_at) {
        updates.delivered_at = new Date();
      }

      await trx
        .updateTable('maintenance_tickets')
        .set(updates)
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', id)
        .execute();

      // The explicit cash-only cancellation returns a cash advance and reverses
      // its unearned-revenue liability under the same ticket lock and DB transaction.
      // Tickets with issued parts must first use the existing costed return path.
      if (payload.refundAdvance && terminal.includes(payload.status) && ticket.status !== payload.status) {
        const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
        const advance = Number(ticket.advance_payment || 0);
        const sourceReceipt = await trx.selectFrom('treasury_transactions')
          .select(['id', 'amount', 'txn_type'])
          .where('tenant_id', '=', scope.tenantId)
          .where('reference_type', '=', 'maintenance_ticket').where('reference_id', '=', id)
          .execute();
        const sourceJournal = await trx.selectFrom('journal_entries').select('id')
          .where('tenant_id', '=', scope.tenantId).where('source_type', '=', 'maintenance_advance')
          .where('source_id', '=', id).where('status', '=', 'posted')
          .where('reversed_by_entry_id', 'is', null).executeTakeFirst();
        const priorRefund = await trx.selectFrom('treasury_transactions').select('id')
          .where('tenant_id', '=', scope.tenantId)
          .where('reference_type', '=', 'maintenance_advance_refund').where('reference_id', '=', id)
          .executeTakeFirst();
        if (sourceReceipt.length !== 1 || sourceReceipt[0].txn_type !== 'revenue' ||
            toMinorUnits(Number(sourceReceipt[0].amount), digits) !== toMinorUnits(advance, digits) ||
            !sourceJournal || priorRefund) {
          throw new AppError('Cannot refund an unverified or already-refunded maintenance advance',
            'MAINTENANCE_REFUND_RECONCILIATION_REQUIRED', 409);
        }
        await trx.insertInto('treasury_transactions').values({
          tenant_id: scope.tenantId, account_id: scope.accountId,
          txn_type: 'expense', amount: -advance, payment_channel: 'cash',
          note: `رد عربون صيانة تذكرة ${ticket.ticket_no} بعد الإلغاء`,
          reference_type: 'maintenance_advance_refund', reference_id: id,
          branch_id: ticket.branch_id ? Number(ticket.branch_id) : null,
          location_id: ticket.location_id ? Number(ticket.location_id) : null,
          created_by: auth.userId ? Number(auth.userId) : null,
        }).execute();
        await postMaintenanceJournal(trx, this.accountingFoundation, this.accountingPosting, auth,
          'maintenance_advance_refund', id,
          ticket.branch_id ? Number(ticket.branch_id) : null,
          ticket.location_id ? Number(ticket.location_id) : null, [
            { code: '2150', debit: advance, description: 'Refund previously unearned maintenance advance' },
            { code: '1110', credit: advance, description: 'Cash refund of maintenance customer advance' },
          ]);
      }

      // When status changes to delivered, collect remaining balance into treasury
      if (payload.status === 'delivered' && ticket.status !== 'delivered') {
        const finalCost = payload.finalCost !== undefined ? Number(payload.finalCost) : Number(ticket.final_cost || ticket.expected_cost || 0);
        const advance = Number(ticket.advance_payment || 0);
        const remaining = payload.collectedAmount !== undefined
          ? Number(payload.collectedAmount)
          : Math.max(0, finalCost - advance);
        // A final agreed amount below the advance already collected is a
        // distinct, specific failure: the ticket can never settle, and the
        // operator must fix the amount (or refund) instead of seeing the
        // generic exact-settlement message. Checked before the generic
        // settlement check below so the specific code always wins.
        if (finalCost < advance) {
          throw new AppError(
            `Maintenance final cost ${finalCost} is below the advance already collected ${advance}; the final agreed amount cannot be less than the advance`,
            'MAINTENANCE_FINAL_BELOW_ADVANCE',
            422,
          );
        }
        if (!Number.isFinite(finalCost) || !Number.isFinite(advance) ||
            !Number.isFinite(remaining) || finalCost < 0 ||
            remaining < 0 || !this.isExactMaintenanceSettlement(remaining, advance, finalCost, currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId)))) {
          throw new AppError('Maintenance delivery must settle its full balance; refund/credit requires a separate flow',
            'MAINTENANCE_SETTLEMENT_MISMATCH', 422);
        }
        const nonCash = ['card', 'wallet', 'instapay'].includes(payload.paymentMethod || '');
        if (remaining > 0) {
          await trx
            .insertInto('treasury_transactions')
            .values({
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
              txn_type: 'revenue',
              amount: remaining,
              payment_channel: nonCash ? payload.paymentMethod as 'card' | 'wallet' | 'instapay' : 'cash',
              note: `تحصيل صيانة وتسليم جهاز ${ticket.ticket_no} - العميل: ${ticket.customer_name}`,
              reference_type: 'maintenance_ticket',
              reference_id: Number(ticket.id),
              branch_id: ticket.branch_id ? Number(ticket.branch_id) : null,
              location_id: ticket.location_id ? Number(ticket.location_id) : null,
              created_by: auth.userId ? Number(auth.userId) : null,
            })
            .execute();
        }
        if (finalCost > 0) {
          await postMaintenanceJournal(trx, this.accountingFoundation, this.accountingPosting, auth,
            'maintenance_delivery', id,
            ticket.branch_id ? Number(ticket.branch_id) : null,
            ticket.location_id ? Number(ticket.location_id) : null, [
              { code: '2150', debit: advance, description: 'Apply maintenance customer advance' },
              { code: nonCash ? '1120' : '1110', debit: remaining, description: 'Maintenance final settlement' },
              { code: '4200', credit: finalCost, description: 'Earned maintenance service revenue' },
            ]);
        }
      }

      return ticket;
    });

    const statusLabels: Record<string, string> = {
      received: 'تم الاستلام',
      inspecting: 'قيد الفحص والتسعير',
      in_progress: 'قيد الصيانة والإصلاح',
      repaired: 'تم الإصلاح وجاهز للتسليم',
      delivered: 'تم التسليم للعميل',
      unrepairable: 'غير قابل للإصلاح',
      cancelled: 'ملغاة',
      canceled: 'ملغاة',
    };
    const statusLabel = statusLabels[payload.status] || payload.status;
    await this.audit.log('تحديث حالة التذكرة', `تم تغيير حالة التذكرة ${existing.ticket_no} إلى "${statusLabel}"`, auth);
    return { ok: true };
  }

  async addPart(ticketId: number, payload: AddTicketPartDto, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const result = await this.tx.runInTransaction(this.db, async (trx) => {
      const ticket = await trx
        .selectFrom('maintenance_tickets')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', ticketId)
        .forUpdate()
        .executeTakeFirst();

      if (!ticket) {
        throw new AppError('تذكرة الصيانة غير موجودة', 'TICKET_NOT_FOUND', 404);
      }

      const targetLocationId = payload.locationId ?? (ticket.location_id ? Number(ticket.location_id) : null);
      const targetBranchId = ticket.branch_id ? Number(ticket.branch_id) : null;
      const deductQty = Number(payload.qty);

      if (ticket.status === 'delivered' || ticket.status === 'cancelled' || ticket.status === 'unrepairable') {
        throw new AppError('Cannot issue parts to a closed maintenance ticket', 'MAINTENANCE_CLOSED', 409);
      }
      const partRes = await trx
        .insertInto('maintenance_ticket_parts')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          ticket_id: ticketId,
          product_id: payload.productId,
          product_name: payload.productName.trim(),
          qty: deductQty,
          unit_cost: payload.unitCost ?? 0,
          unit_price: payload.unitPrice,
          location_id: targetLocationId,
        })
        .returning('id')
        .executeTakeFirst();

      const stockChange = await applyStockDelta(trx, {
        productId: payload.productId,
        delta: -deductQty,
        branchId: targetBranchId,
        locationId: targetLocationId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        errorCode: 'INSUFFICIENT_STOCK',
        errorMessage: `الرصيد غير كافٍ لصرف قطعة الغيار ${payload.productName.trim()}`,
      });

      const product = await trx.selectFrom('products').select('cost_price')
        .where('tenant_id', '=', scope.tenantId).where('id', '=', payload.productId).executeTakeFirstOrThrow();
      const unitCost = Number(product.cost_price);
      const stockValue = roundMoney(unitCost * deductQty, currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId)));
      if (!Number.isFinite(stockValue) || unitCost < 0) {
        throw new AppError('Maintenance stock cost is invalid', 'MAINTENANCE_STOCK_COST_INVALID', 422);
      }
      await trx.updateTable('maintenance_ticket_parts')
        .set({ unit_cost: unitCost }).where('tenant_id', '=', scope.tenantId)
        .where('id', '=', Number(partRes?.id)).execute();
      const movement = await trx
        .insertInto('stock_movements')
        .values({
          product_id: payload.productId,
          movement_type: 'maintenance_consumption',
          qty: -deductQty,
          before_qty: stockChange.scopeBefore,
          after_qty: stockChange.scopeAfter,
          reason: 'صرف قطعة غيار لتذكرة صيانة',
          note: `تذكرة صيانة #${ticketId} - قطعة: ${payload.productName.trim()}`,
          reference_type: 'maintenance_ticket',
          reference_id: ticketId,
          unit_cost: unitCost,
          total_cost: stockValue,
          branch_id: targetBranchId,
          location_id: targetLocationId,
          created_by: auth.userId ? Number(auth.userId) : null,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        } as any)
        .returning('id').executeTakeFirstOrThrow();
      if (stockValue > 0) {
        await postMaintenanceJournal(trx, this.accountingFoundation, this.accountingPosting, auth,
          'maintenance_part_issue', Number(movement.id), targetBranchId, targetLocationId, [
            { code: '5100', debit: stockValue, description: 'Maintenance part consumption cost' },
            { code: '1140', credit: stockValue, description: 'Inventory consumed on maintenance job' },
          ]);
      }

      let newFinalCost = Number(ticket.final_cost || 0);
      if (newFinalCost === 0 && Number(ticket.expected_cost || 0) === 0) {
        const addedAmount = deductQty * Number(payload.unitPrice);
        newFinalCost = addedAmount;
        await trx
          .updateTable('maintenance_tickets')
          .set({ final_cost: newFinalCost, updated_at: new Date() })
          .where('tenant_id', '=', scope.tenantId)
          .where('id', '=', ticketId)
          .execute();
      }

      return { partId: String(partRes?.id), newFinalCost };
    });

    return { ok: true, partId: result.partId, newFinalCost: result.newFinalCost };
  }

  async removePart(ticketId: number, partId: number, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    await this.tx.runInTransaction(this.db, async (trx) => {
      const ticket = await trx
        .selectFrom('maintenance_tickets')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', ticketId)
        .forUpdate()
        .executeTakeFirst();

      if (!ticket) {
        throw new AppError('تذكرة الصيانة غير موجودة', 'TICKET_NOT_FOUND', 404);
      }

      const part = await trx
        .selectFrom('maintenance_ticket_parts')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('ticket_id', '=', ticketId)
        .where('id', '=', partId)
        .executeTakeFirst();

      if (!part) {
        throw new AppError('قطعة الغيار غير موجودة بالتذكرة', 'PART_NOT_FOUND', 404);
      }
      if (ticket.status === 'delivered') {
        throw new AppError('Delivered maintenance parts require a formal reversal', 'MAINTENANCE_REVERSAL_REQUIRED', 409);
      }

      await trx
        .deleteFrom('maintenance_ticket_parts')
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', partId)
        .execute();

      const returnQty = Number(part.qty);
      const targetLocationId = part.location_id ? Number(part.location_id) : (ticket.location_id ? Number(ticket.location_id) : null);
      const targetBranchId = ticket.branch_id ? Number(ticket.branch_id) : null;

      const stockChange = await applyStockDelta(trx, {
        productId: Number(part.product_id),
        delta: returnQty,
        branchId: targetBranchId,
        locationId: targetLocationId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        allowNegative: true,
      });

      const stockValue = roundMoney(Number(part.unit_cost) * returnQty, currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId)));
      if (!Number.isFinite(stockValue) || Number(part.unit_cost) < 0) {
        throw new AppError('Historical part cost is invalid', 'MAINTENANCE_STOCK_COST_INVALID', 422);
      }
      // A return restores inventory at its historical consumed cost, not the
      // current price of any later purchases; refresh WAC under product lock.
      await valueStockReceipt(trx, scope.tenantId, Number(part.product_id),
        stockChange.globalAfter, returnQty, stockValue);
      const movement = await trx
        .insertInto('stock_movements')
        .values({
          product_id: Number(part.product_id),
          movement_type: 'maintenance_return',
          qty: returnQty,
          before_qty: stockChange.scopeBefore,
          after_qty: stockChange.scopeAfter,
          reason: 'إلغاء صرف قطعة غيار من تذكرة صيانة',
          note: `إلغاء من تذكرة صيانة #${ticketId}`,
          unit_cost: Number(part.unit_cost),
          total_cost: stockValue,
          reference_type: 'maintenance_ticket',
          reference_id: ticketId,
          branch_id: targetBranchId,
          location_id: targetLocationId,
          created_by: auth.userId ? Number(auth.userId) : null,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        } as any)
        .returning('id').executeTakeFirstOrThrow();
      if (stockValue > 0) {
        await postMaintenanceJournal(trx, this.accountingFoundation, this.accountingPosting, auth,
          'maintenance_part_return', Number(movement.id), targetBranchId, targetLocationId, [
            { code: '1140', debit: stockValue, description: 'Returned maintenance spare part inventory' },
            { code: '5100', credit: stockValue, description: 'Reverse maintenance part cost' },
          ]);
      }
    });

    return { ok: true };
  }

  async deleteTicket(id: number, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const partsCount = await this.tx.runInTransaction(this.db, async (trx) => {
      const ticket = await trx
        .selectFrom('maintenance_tickets')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();

      if (!ticket) {
        throw new AppError('تذكرة الصيانة غير موجودة', 'TICKET_NOT_FOUND', 404);
      }

      const historicalMovement = await trx.selectFrom('stock_movements')
        .select('id').where('tenant_id', '=', scope.tenantId)
        .where('reference_type', '=', 'maintenance_ticket').where('reference_id', '=', id).executeTakeFirst();
      const cashMovement = await trx.selectFrom('treasury_transactions')
        .select('id').where('tenant_id', '=', scope.tenantId)
        .where('reference_type', '=', 'maintenance_ticket').where('reference_id', '=', id).executeTakeFirst();
      if (Number(ticket.advance_payment) > 0 || ticket.status === 'delivered' || cashMovement) {
        throw new AppError('لا يمكن حذف تذكرة صيانة مسلّمة أو تم تحصيل مبالغ مالية لها؛ يجب عمل تسوية أو إلغاء مالي', 'MAINTENANCE_REVERSAL_REQUIRED', 409);
      }
      const parts = await trx
        .selectFrom('maintenance_ticket_parts')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('ticket_id', '=', id)
        .execute();

      for (const part of parts) {
        const returnQty = Number(part.qty);
        const targetLocationId = part.location_id ? Number(part.location_id) : (ticket.location_id ? Number(ticket.location_id) : null);
        const targetBranchId = ticket.branch_id ? Number(ticket.branch_id) : null;

        const stockChange = await applyStockDelta(trx, {
          productId: Number(part.product_id),
          delta: returnQty,
          branchId: targetBranchId,
          locationId: targetLocationId,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          allowNegative: true,
        });

        const stockValue = roundMoney(Number(part.unit_cost || 0) * returnQty, currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId)));
        if (stockValue > 0) {
          await valueStockReceipt(trx, scope.tenantId, Number(part.product_id), stockChange.globalAfter, returnQty, stockValue);
        }

        const movement = await trx
          .insertInto('stock_movements')
          .values({
            product_id: Number(part.product_id),
            movement_type: 'maintenance_return',
            qty: returnQty,
            before_qty: stockChange.scopeBefore,
            after_qty: stockChange.scopeAfter,
            unit_cost: Number(part.unit_cost || 0),
            total_cost: stockValue,
            reason: 'إلغاء تذكرة صيانة - إرجاع قطع الغيار للمخزون',
            note: `حذف تذكرة صيانة #${id} - قطعة: ${part.product_name}`,
            reference_type: 'maintenance_ticket',
            reference_id: id,
            branch_id: targetBranchId,
            location_id: targetLocationId,
            created_by: auth.userId ? Number(auth.userId) : null,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          } as any)
          .returning('id')
          .executeTakeFirstOrThrow();

        if (stockValue > 0) {
          await postMaintenanceJournal(trx, this.accountingFoundation, this.accountingPosting, auth,
            'maintenance_part_return', Number(movement.id), targetBranchId, targetLocationId, [
              { code: '1140', debit: stockValue, description: 'Returned maintenance spare part inventory on ticket deletion' },
              { code: '5100', credit: stockValue, description: 'Reverse maintenance part cost on ticket deletion' },
            ]);
        }
      }

      await trx
        .deleteFrom('maintenance_ticket_parts')
        .where('tenant_id', '=', scope.tenantId)
        .where('ticket_id', '=', id)
        .execute();

      await trx
        .deleteFrom('maintenance_tickets')
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', id)
        .execute();

      return parts.length;
    });

    await this.audit.log('حذف تذكرة صيانة', `تم حذف تذكرة الصيانة #${id} واسترجاع ${partsCount} قطعة غيار إلى المخزون`, auth);
    return { ok: true };
  }
}
