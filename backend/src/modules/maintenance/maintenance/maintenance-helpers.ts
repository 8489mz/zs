import { sql } from 'kysely';
import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { UpsertMaintenanceTicketDto } from '../dto/upsert-maintenance-ticket.dto';
import { AppError } from '../../../common/errors/app-error';

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

export type StoredQuoteFields = {
  diagnosis: string | null;
  quoted_cost: number | null;
  quote_approved_at: Date | null;
  quote_approved_by: number | null;
};

export type QuoteStatusPayload = {
  diagnosis?: string;
  quotedCost?: number;
  approveQuote?: boolean;
};

export type ResolvedQuoteFields = {
  /** SET-clause fragment for the status-update write (only keys the call sent). */
  updates: Record<string, unknown>;
  /** Quoted cost in force after this call (payload wins, else stored). */
  effectiveQuotedCost: number | null;
  /** True when the effective quoted cost is covered by an approval. */
  effectiveApproved: boolean;
};

/**
 * Resolve the diagnosis / quote fields of a status-update call
 * (review P2-5). Pure — no DB — so the PGlite spec pins the exact
 * rules the service enforces inside its transaction (transactional
 * service methods hang on PGlite; see the spec header).
 *
 * - diagnosis is stored in its own column, separate from free-text
 *   technician_notes; an explicitly sent empty string clears it.
 * - quotedCost must be finite and >= 0; it becomes the effective
 *   quoted cost for the gate below.
 * - approveQuote is an EXPLICIT staff-recorded customer approval:
 *   it stamps quote_approved_at = now and quote_approved_by = the
 *   authenticated user. It is never inferred from a status change.
 *   Approving requires a real quoted cost (> 0) in force — there is
 *   nothing to approve on a quick job with no quote — and an
 *   authenticated approver.
 * - A re-quote replaces the amount the old approval covered: the
 *   stored approval only survives when the call sends no new amount
 *   or the same amount. A different amount needs a fresh approval
 *   in the same call (or a later one, before the in_progress move).
 */
export function resolveQuoteFields(
  payload: QuoteStatusPayload,
  stored: StoredQuoteFields,
  approverId: number | null,
  now: Date = new Date(),
): ResolvedQuoteFields {
  if (
    payload.quotedCost !== undefined &&
    (!Number.isFinite(Number(payload.quotedCost)) || Number(payload.quotedCost) < 0)
  ) {
    throw new AppError('Invalid maintenance quoted cost', 'MAINTENANCE_QUOTE_COST_INVALID', 400);
  }
  const updates: Record<string, unknown> = {};
  if (payload.diagnosis !== undefined) {
    updates.diagnosis = payload.diagnosis?.trim() ? payload.diagnosis.trim() : null;
  }
  const effectiveQuotedCost =
    payload.quotedCost !== undefined
      ? Number(payload.quotedCost)
      : stored.quoted_cost === null || stored.quoted_cost === undefined
        ? null
        : Number(stored.quoted_cost);
  if (payload.quotedCost !== undefined) {
    updates.quoted_cost = Number(payload.quotedCost);
  }
  const priorApprovalCovers =
    payload.quotedCost === undefined ||
    Number(payload.quotedCost) === Number(stored.quoted_cost ?? 0);
  let effectiveApproved = priorApprovalCovers && stored.quote_approved_at !== null;
  if (payload.approveQuote === true) {
    if (effectiveQuotedCost === null || effectiveQuotedCost <= 0) {
      throw new AppError(
        'Cannot approve a maintenance quote when no quoted cost exists',
        'MAINTENANCE_QUOTE_APPROVAL_WITHOUT_QUOTE',
        422,
      );
    }
    if (approverId === null || approverId === undefined) {
      throw new AppError(
        'Quote approval requires an authenticated staff user',
        'MAINTENANCE_QUOTE_APPROVAL_INVALID',
        422,
      );
    }
    updates.quote_approved_at = now;
    updates.quote_approved_by = approverId;
    effectiveApproved = true;
  }
  return { updates, effectiveQuotedCost, effectiveApproved };
}

/**
 * Gate the move to 'in_progress' on an approved quote — but only
 * when a quoted cost exists (non-null and > 0). Tickets with no
 * quoted cost (quick jobs) proceed without approval, and a
 * same-status call while already in_progress is not a move and is
 * never gated (it must not strand a legacy ticket, or a cost edit,
 * behind an approval it never needed to start). Throws the specific
 * MAINTENANCE_QUOTE_APPROVAL_REQUIRED (422) — never a generic
 * message — so the operator knows exactly what is missing.
 */
export function assertInProgressQuoteAllowed(
  targetStatus: string,
  previousStatus: string,
  effectiveQuotedCost: number | null,
  effectiveApproved: boolean,
): void {
  if (targetStatus !== 'in_progress' || previousStatus === 'in_progress') return;
  if (effectiveQuotedCost !== null && effectiveQuotedCost > 0 && !effectiveApproved) {
    throw new AppError(
      `Maintenance ticket cannot move to in_progress: quoted cost ${effectiveQuotedCost} has not been approved by the customer`,
      'MAINTENANCE_QUOTE_APPROVAL_REQUIRED',
      422,
    );
  }
}
