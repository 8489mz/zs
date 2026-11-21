import { sql } from 'kysely';
import { Kysely } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { Database } from '../../../database/database.types';
import { normalizeArabicSearch } from '../../../common/utils/arabic-search.util';

export class TicketListingSlice {
  constructor(private readonly db: Kysely<Database>) {}

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
        diagnosis: ticket.diagnosis,
        quotedCost: ticket.quoted_cost === null || ticket.quoted_cost === undefined ? null : Number(ticket.quoted_cost),
        quoteApprovedAt: ticket.quote_approved_at ?? null,
        quoteApprovedBy: ticket.quote_approved_by ?? null,
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
}
