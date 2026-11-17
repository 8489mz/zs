import { type PortalTokenErrorSpec } from '../../core/auth/utils/portal-token';

export const DRIVER_TOKEN_ERRORS: PortalTokenErrorSpec = {
  missing: { message: 'غير مصرح - مطلوب تسجيل الدخول', code: 'UNAUTHORIZED_DRIVER' },
  invalid: { message: 'رمز الدخول غير صالح', code: 'INVALID_DRIVER_TOKEN' },
  signature: { message: 'رمز الدخول غير صالح أو مزور', code: 'INVALID_DRIVER_TOKEN' },
  expired: { message: 'انتهت صلاحية جلسة المندوب، يرجى إعادة تسجيل الدخول', code: 'DRIVER_SESSION_EXPIRED' },
};

/**
 * M14 (INV-DRIVER-TOKEN-PIN-INVALIDATION): نسخة الـPIN مخزنة في
 * `delivery_representatives.metadata.pin_version` (JSONB، موجود منذ
 * الهجرة 0224 — لا حاجة لعمود جديد). كل تغيير PIN يرفعها بمقدار 1،
 * والرمز يحمل النسخة التي صدر تحتها؛ أي رمز نسخته أقدم من المخزنة
 * يُرفض عند التحقق. المندوب الذي لم يغيّر رمزه أبداً نسخته 0، وهي
 * نفس قيمة الرموز القديمة بلا حقل نسخة، فتستمر صالحة حتى أول تغيير.
 */
export function repPinVersion(metadata: unknown): number {
  let parsed: any = metadata;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return 0;
    }
  }
  const raw = Number(parsed?.pin_version ?? 0);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
}

/** يعيد نسخة من بيانات metadata مع ضبط pin_version — دون مسح باقي المفاتيح. */
export function withPinVersion(metadata: unknown, version: number): Record<string, any> {
  return { ...parseMetadata(metadata), pin_version: version };
}

/** يحوّل قيمة metadata (كائن JSONB أو نص JSON أو null) إلى كائن عادي. */
export function parseMetadata(metadata: unknown): Record<string, any> {
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata) || {};
    } catch {
      return {};
    }
  }
  if (metadata && typeof metadata === 'object') return { ...(metadata as Record<string, any>) };
  return {};
}
