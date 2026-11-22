import { useMutation, useQueryClient } from '@tanstack/react-query';
import { http } from '@/lib/http';

// ==========================================
// RECEIVING INSPECTIONS, LATE EXPENSES & FEASIBILITY CONVERSION
// ==========================================
// ==========================================
// RECEIVING INSPECTIONS, LATE EXPENSES & FEASIBILITY CONVERSION
// ==========================================

// The GRN stage value: a receiving-stage QC row IS the shipment's GRN
// approval. The backend refuses a second receiving row for the same
// shipment and refuses any once the receipt is posted
// (INV-IMPORT-GRN-APPROVAL-POSTED-GATE).
export const GRN_RECEIVING_STAGE = 'receiving';

// The GRN dialog collects inspector/warehouse/notes plus per-item
// damaged quantities, but the backend DTO (CreateQcInspectionDto)
// declares only stage, inspectionDate, inspectorName, sampleSize,
// passedQuantity, failedQuantity, defectNotes, status, projectId and
// shipmentId. The global validation pipe runs with whitelist +
// forbidNonWhitelisted, so sending the dialog shape verbatim failed
// every submit before the service. Map it to exactly the DTO fields:
// the warehouse is the receipt's warehouse (already stored on the
// shipment), the per-item rows collapse into the inspection totals,
// and 'approved' maps to the QC status 'passed'.
export function buildReceivingInspectionPayload(rawDto: any): Record<string, unknown> {
  const items: any[] = Array.isArray(rawDto?.items) ? rawDto.items : [];
  let sampleSize = 0;
  let passedQuantity = 0;
  let failedQuantity = 0;
  for (const item of items) {
    const received = Number(item.receivedQty ?? item.received_quantity ?? item.quantity ?? 0);
    const accepted = Number(item.acceptedQty ?? item.accepted_quantity ?? received);
    const damaged = Number(item.damagedQty ?? item.damaged_quantity ?? 0);
    const shortage = Number(item.shortageQty ?? item.shortage_quantity ?? 0);
    sampleSize += received;
    passedQuantity += Math.max(0, accepted);
    failedQuantity += Math.max(0, damaged + shortage);
  }
  // Local calendar parts, never UTC toISOString: around midnight the
  // UTC date is the previous day in UTC+2.
  const now = new Date();
  const inspectionDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const payload: Record<string, unknown> = {
    stage: GRN_RECEIVING_STAGE,
    inspectionDate,
    status: rawDto?.overallStatus === 'approved' || !rawDto?.overallStatus ? 'passed' : String(rawDto.overallStatus),
  };
  if (rawDto?.shipmentId !== undefined) payload.shipmentId = rawDto.shipmentId;
  if (rawDto?.projectId !== undefined) payload.projectId = rawDto.projectId;
  if (rawDto?.inspectorName) payload.inspectorName = rawDto.inspectorName;
  if (items.length) {
    payload.sampleSize = sampleSize;
    payload.passedQuantity = passedQuantity;
    payload.failedQuantity = failedQuantity;
  }
  const notes = rawDto?.notes ?? rawDto?.defectNotes;
  if (notes) payload.defectNotes = String(notes);
  return payload;
}

// The global http layer maps code VALIDATION_ERROR to the generic
// 'البيانات المدخلة غير صحيحة.' and drops the backend's specific
// field message. The raw payload survives on ApiError.details, so
// read the specific message back out here instead of showing the
// generic text. Backend named errors ([IMPORT_...]) already arrive
// with their specific message as err.message and pass through.
export function receivingInspectionErrorMessage(err: any): string {
  const generic = 'البيانات المدخلة غير صحيحة.';
  const raw = err?.details?.error ?? err?.details ?? {};
  const specific =
    (typeof raw?.message === 'string' ? raw.message : '') ||
    (Array.isArray(raw?.details?.messages) ? String(raw.details.messages[0] || '') : '') ||
    '';
  if (
    specific.trim() &&
    specific.trim() !== generic &&
    specific.trim() !== 'البيانات المرسلة غير صحيحة.'
  ) {
    return specific.trim();
  }
  return err?.message || 'تعذر حفظ محضر الفحص والاستلام';
}

export const useCreateReceivingInspectionMutation = (defaultShipmentId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const shipmentId = dto?.shipmentId || defaultShipmentId;
      return await http<any>('/api/import-sales/qc-inspections', {
        method: 'POST',
        body: JSON.stringify({ ...buildReceivingInspectionPayload(dto), shipmentId }),
      });
    },
    onSuccess: (_data, variables: any) => {
      const shipmentId = variables?.shipmentId || defaultShipmentId;
      if (shipmentId) {
        queryClient.invalidateQueries({ queryKey: ['import-shipments', shipmentId] });
        queryClient.invalidateQueries({ queryKey: ['container-autopsy', shipmentId] });
      }
    },
  });
};

// The backend route is POST shipments/:shipmentId/late-expense and its
// DTO (ProcessLateExpenseDto) declares lateExpenseAmount, title,
// accountId, note, payableAccountId, supplierId and
// unallocableReason. The dialog historically sent unrelated fields
// (expenseCategory, handlingMethod, treasuryAccountId,
// idempotencyKey) to the plural route; the whitelist validation
// pipe rejected every submit before the service. Map every caller
// shape to exactly the DTO fields. The dialog treasury account is
// deliberately NOT mapped to accountId: the backend reads
// accountId as a COGS-account override, not a payment account,
// and this endpoint posts a payable, never a treasury movement.
// supplierId names the explicit payee; unallocableReason records
// why the expense is genuinely unallocable (clearing path) —
// exactly one of the two must be supplied, never a silent
// default to the goods supplier.
const LATE_EXPENSE_TYPE_TITLES: Record<string, string> = {
  demurrage: 'غرامات تأخير وأرضيات',
  customs_diff: 'فروق تسوية جمركية لاحقة',
  transport: 'نقل ومشال إضافي',
  other: 'مصروفات استيراد أخرى',
};

export function buildLateExpensePayload(rawDto: any): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    lateExpenseAmount: Number(rawDto?.lateExpenseAmount ?? rawDto?.amountEgp ?? rawDto?.amount ?? 0),
    title:
      rawDto?.title ||
      LATE_EXPENSE_TYPE_TITLES[rawDto?.expenseCategory || rawDto?.expenseType] ||
      'Late shipment expense',
  };
  const note = rawDto?.note ?? rawDto?.notes ?? rawDto?.description;
  if (note !== undefined) payload.note = note;
  if (rawDto?.accountId !== undefined) payload.accountId = String(rawDto.accountId);
  if (rawDto?.payableAccountId !== undefined) payload.payableAccountId = Number(rawDto.payableAccountId);
  if (rawDto?.supplierId !== undefined && rawDto?.supplierId !== null && rawDto?.supplierId !== '') payload.supplierId = Number(rawDto.supplierId);
  if (rawDto?.unallocableReason !== undefined && rawDto?.unallocableReason !== null && String(rawDto.unallocableReason).trim() !== '') payload.unallocableReason = String(rawDto.unallocableReason);
  return payload;
}

// The backend returns the split under allocation.lateCogsAdjustmentEgp /
// allocation.lateInventoryAdjustmentEgp. Read only those fields.
export function lateExpenseAllocationSummary(res: any): {
  capitalizedToInventoryEgp: number;
  expensedToCogsEgp: number;
} {
  return {
    capitalizedToInventoryEgp: Number(res?.allocation?.lateInventoryAdjustmentEgp || 0),
    expensedToCogsEgp: Number(res?.allocation?.lateCogsAdjustmentEgp || 0),
  };
}

export const useRecordLateShipmentExpenseMutation = (defaultShipmentId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: any) => {
      const shipmentId = args?.shipmentId || defaultShipmentId;
      const rawDto = args?.dto !== undefined ? args.dto : args;
      return await http<any>(`/api/import-sales/shipments/${shipmentId}/late-expense`, {
        method: 'POST',
        body: JSON.stringify(buildLateExpensePayload(rawDto)),
      });
    },
    onSuccess: (_data, variables: any) => {
      const shipmentId = variables?.shipmentId || defaultShipmentId;
      if (shipmentId) {
        queryClient.invalidateQueries({ queryKey: ['import-shipments', shipmentId] });
        queryClient.invalidateQueries({ queryKey: ['container-autopsy', shipmentId] });
      }
    },
  });
};

export const useConvertFeasibilityToProjectMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      // I1-P2: approval transitions the EXISTING project only. The old
      // fallback silently POSTed to /projects (create) whenever the
      // caller forgot projectId — that is exactly how approving a
      // feasibility study created a second project live (trial problem 2).
      // A convert without a project id now fails closed instead.
      if (!dto?.projectId) {
        throw new Error(
          'projectId is required to convert a feasibility study: approval must transition the existing project, never create a new one. [IMPORT_CONVERT_PROJECT_ID_REQUIRED]',
        );
      }
      return await http<any>(`/api/import-sales/projects/${dto.projectId}/convert-feasibility`, {
        method: 'POST',
        body: JSON.stringify(dto),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-projects'] });
      queryClient.invalidateQueries({ queryKey: ['proforma-invoices'] });
    },
  });
};
