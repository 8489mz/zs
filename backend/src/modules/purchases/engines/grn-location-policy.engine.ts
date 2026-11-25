import { AppError } from '../../../common/errors/app-error';

/**
 * A positive locationId is an explicit warehouse choice, never a request to
 * silently use the tenant default. Zero/omitted location retains the existing
 * PO-warehouse/default-warehouse resolution for older clients.
 */
export function assertGrnRequestedLocationScope(
  requestedLocationId: number,
  resolved: { id: number } | null | undefined,
): void {
  if (requestedLocationId > 0 && (!resolved || Number(resolved.id) !== requestedLocationId)) {
    throw new AppError(
      'مخزن الاستلام المحدد غير موجود أو لا يتبع المنشأة؛ راجع اختيار المخزن',
      'GRN_LOCATION_NOT_FOUND',
      404,
    );
  }
}
