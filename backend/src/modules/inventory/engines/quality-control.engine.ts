/**
 * Pure calculation & evaluation engine for Quality Control Inspections & NCR Triggers.
 * Fully isolated from database and framework dependencies.
 */

export type QCTestType = 'pass_fail' | 'measure' | 'checklist';
export type QCInspectionStatus = 'passed' | 'failed' | 'conditional';
export type NCRSeverity = 'minor' | 'major' | 'critical';

export interface QCPointCriteria {
  testType: QCTestType;
  normMeasureMin?: number | null;
  normMeasureMax?: number | null;
  isMandatory?: boolean;
}

export interface QCInspectionInput {
  testType: QCTestType;
  passed?: boolean;
  measuredValue?: number | null;
  inspectedQty: number;
  acceptedQty: number;
  rejectedQty: number;
}

/**
 * Evaluates whether an inspection passes, fails, or is conditional based on test type and tolerance limits
 */
export function evaluateInspectionResult(
  criteria: QCPointCriteria,
  input: QCInspectionInput,
): { status: QCInspectionStatus; reason?: string } {
  const rejected = Math.max(0, Number(input.rejectedQty) || 0);
  const accepted = Math.max(0, Number(input.acceptedQty) || 0);
  const inspected = Math.max(0, Number(input.inspectedQty) || 0);

  if (inspected <= 0) {
    return { status: 'failed', reason: 'كمية الفحص يجب أن تكون أكبر من صفر' };
  }

  // 1. Pass / Fail Evaluation
  if (criteria.testType === 'pass_fail') {
    if (input.passed === false || rejected > 0) {
      if (accepted > 0 && rejected > 0) {
        return {
          status: 'conditional',
          reason: `قبول جزئي مشروط: تم قبول ${accepted} ورفض ${rejected}`,
        };
      }
      return { status: 'failed', reason: 'فشل الفحص البصري / الاختباري لعدم مطابقة المعايير' };
    }
    return { status: 'passed' };
  }

  // 2. Quantitative Measurement Evaluation
  if (criteria.testType === 'measure') {
    if (input.measuredValue === undefined || input.measuredValue === null) {
      return { status: 'failed', reason: 'يجب إدخال القيمة المقاسة للاختبار الكمي' };
    }

    const val = Number(input.measuredValue);
    const min =
      criteria.normMeasureMin !== null && criteria.normMeasureMin !== undefined
        ? Number(criteria.normMeasureMin)
        : -Infinity;
    const max =
      criteria.normMeasureMax !== null && criteria.normMeasureMax !== undefined
        ? Number(criteria.normMeasureMax)
        : Infinity;

    if (val < min || val > max) {
      return {
        status: 'failed',
        reason: `القيمة المقاسة (${val}) خارج حدود التسامح المسموح بها [${min === -Infinity ? '—' : min} - ${max === Infinity ? '—' : max}]`,
      };
    }

    if (rejected > 0) {
      return {
        status: 'conditional',
        reason: `القيمة المقاسة مطابقة ولكن تم استبعاد ${rejected} وحدات تالفة`,
      };
    }

    return { status: 'passed' };
  }

  // 3. Checklist Evaluation
  if (input.passed === false || rejected > inspected * 0.1) {
    return { status: 'failed', reason: 'لم يتم استيفاء قائمة مراجعة الجودة بالكامل' };
  }

  return { status: 'passed' };
}

/**
 * Determines whether a Non-Conformance Report (NCR) must be raised
 */
export function shouldTriggerNCR(status: QCInspectionStatus, rejectedQty: number): boolean {
  return status === 'failed' || Number(rejectedQty) > 0;
}

/**
 * Suggests default NCR severity based on rejection ratio
 */
export function suggestNCRSeverity(rejectedQty: number, inspectedQty: number): NCRSeverity {
  const rejected = Math.max(0, Number(rejectedQty) || 0);
  const total = Math.max(1, Number(inspectedQty) || 1);
  const ratio = rejected / total;

  if (ratio >= 0.5) return 'critical';
  if (ratio >= 0.1) return 'major';
  return 'minor';
}

/**
 * Calculates acceptance rate percentages across an array of inspection records
 */
export function calculateQualityAcceptanceRate(
  inspections: Array<{ inspectedQty: number; acceptedQty: number; rejectedQty: number }>,
): {
  totalInspected: number;
  totalAccepted: number;
  totalRejected: number;
  acceptanceRatePercent: number;
} {
  const totalInspected = inspections.reduce((s, i) => s + (Number(i.inspectedQty) || 0), 0);
  const totalAccepted = inspections.reduce((s, i) => s + (Number(i.acceptedQty) || 0), 0);
  const totalRejected = inspections.reduce((s, i) => s + (Number(i.rejectedQty) || 0), 0);

  const rate = totalInspected > 0 ? (totalAccepted / totalInspected) * 100 : 100;

  return {
    totalInspected: Math.round(totalInspected * 100) / 100,
    totalAccepted: Math.round(totalAccepted * 100) / 100,
    totalRejected: Math.round(totalRejected * 100) / 100,
    acceptanceRatePercent: Math.round(rate * 10) / 10,
  };
}
