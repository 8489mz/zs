import { AppError } from '../../../common/errors/app-error';

export interface TraceableSerial {
  id: number;
  serial_number: string;
  imei_2: string | null;
  status: string;
}
export interface TraceableBatch {
  id: number;
  quantity: number | string;
  batch_number?: string | null;
}

/** Determine exactly which purchased, still-in-stock serials leave inventory. */
export function selectPurchaseReturnSerials(
  eligible: TraceableSerial[],
  requested: string[] | undefined,
  baseQty: number,
): TraceableSerial[] {
  if (!Number.isSafeInteger(baseQty) || baseQty <= 0) {
    throw new AppError('كمية المرتجع التسلسلي يجب أن تكون عدداً صحيحاً', 'PURCHASE_RETURN_SERIAL_QTY_INVALID', 400);
  }
  const normalized = (requested || []).map((s) =>
    String(s || '')
      .trim()
      .toLowerCase(),
  );
  if (normalized.some((s) => !s) || new Set(normalized).size !== normalized.length) {
    throw new AppError('أرقام السيريال المرسلة فارغة أو مكررة', 'PURCHASE_RETURN_SERIAL_INVALID', 400);
  }
  if (!normalized.length && eligible.length !== baseQty) {
    throw new AppError('حدد السيريالات المرتجعة للمورد', 'PURCHASE_RETURN_SERIALS_REQUIRED', 400);
  }
  const selected = normalized.length
    ? eligible.filter(
        (row) =>
          normalized.includes(row.serial_number.toLowerCase()) ||
          (row.imei_2 != null && normalized.includes(row.imei_2.toLowerCase())),
      )
    : eligible;
  if (
    selected.length !== baseQty ||
    (normalized.length > 0 && normalized.length !== selected.length) ||
    selected.some((row) => row.status !== 'in_stock')
  ) {
    throw new AppError(
      'السيريال غير موجود أو ليس متاحاً في الفاتورة الأصلية',
      'PURCHASE_RETURN_SERIAL_NOT_AVAILABLE',
      409,
    );
  }
  return selected;
}

/** If more than one batch can satisfy the return, force the cashier to choose. */
export function selectPurchaseReturnBatch(
  eligible: TraceableBatch[],
  requestedBatchId: number | undefined,
  baseQty: number,
): TraceableBatch {
  if (!Number.isFinite(baseQty) || baseQty <= 0) {
    throw new AppError('كمية التشغيلة غير صالحة', 'PURCHASE_RETURN_BATCH_QTY_INVALID', 400);
  }
  const candidates = eligible.filter((row) => Number(row.quantity || 0) + 0.000001 >= baseQty);
  const chosen =
    requestedBatchId != null
      ? candidates.find((row) => Number(row.id) === requestedBatchId)
      : candidates.length === 1
        ? candidates[0]
        : undefined;
  if (!chosen) {
    throw new AppError('حدد تشغيلة صحيحة بها رصيد كافٍ للمرتجع', 'PURCHASE_RETURN_BATCH_SELECTION_REQUIRED', 422);
  }
  return chosen;
}
