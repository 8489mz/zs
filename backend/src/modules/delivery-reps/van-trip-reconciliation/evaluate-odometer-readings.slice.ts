import type { OdometerEvaluationParams, OdometerEvaluationResult } from './van-trip-reconciliation.types';

/**
 * Validates start and end vehicle odometer readings.
 */
export function evaluateOdometerReadings(params: OdometerEvaluationParams): OdometerEvaluationResult {
  const start = params.startOdometer !== null && params.startOdometer !== undefined ? Number(params.startOdometer) : 0;
  const end = params.endOdometer !== null && params.endOdometer !== undefined ? Number(params.endOdometer) : 0;

  if (params.endOdometer !== null && params.endOdometer !== undefined && params.startOdometer !== null && params.startOdometer !== undefined) {
    if (end < start) {
      return {
        valid: false,
        errorMessageAr: `قراءة عداد نهاية الرحلة (${end}) لا يمكن أن تكون أقل من قراءة بداية الرحلة (${start})`,
        startOdometer: start,
        endOdometer: end,
        distanceKm: 0,
      };
    }
  }

  const distanceKm = Number((Math.max(0, end - start)).toFixed(2));

  return {
    valid: true,
    startOdometer: start,
    endOdometer: end,
    distanceKm,
  };
}
