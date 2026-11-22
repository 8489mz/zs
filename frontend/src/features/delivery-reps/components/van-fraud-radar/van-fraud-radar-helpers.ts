export const EVENT_CODE_OPTIONS = [
  { value: 'all', label: 'جميع أنواع الشبهات والمخالفات' },
  { value: 'VAN_SUSPICION_PRICE_MANIPULATION', label: 'تلاعب بالأسعار أو البيع بأقل من التكلفة' },
  { value: 'VAN_SUSPICION_UNAUTHORIZED_BONUS', label: 'منح بونص مجاني بدون صلاحية' },
  { value: 'VAN_SUSPICION_CREDIT_BYPASS', label: 'محاولة كسر سقف الائتمان أو البيع الآجل الممنوع' },
  { value: 'VAN_SUSPICION_CROSS_REP_COLLECTION', label: 'محاولة تحصيل مديونية مندوب آخر (عميل مشترك)' },
  { value: 'VAN_SUSPICION_FRAUDULENT_RETURN', label: 'محاولة تمرير مرتجع وهمي أو مكرر أو بسعر مضخم' },
  { value: 'VAN_SUSPICION_FAKE_CARD_PAYMENT', label: 'محاولة تسجيل دفع بطاقة/شبكة وهمي بدون مرجع' },
  { value: 'VAN_SUSPICION_EXPENSE_ABUSE', label: 'تجاوز سقف مصروفات الطريق المعتمدة' },
  { value: 'VAN_SUSPICION_ODOMETER_ROLLBACK', label: 'تلاعب في قراءة عداد الكيلومترات' },
  { value: 'VAN_SUSPICION_GEOFENCE_VIOLATION', label: 'تسجيل زيارة خارج النطاق الجغرافي للعميل (GPS)' },
  { value: 'VAN_SUSPICION_SELF_APPROVAL', label: 'محاولة اعتماد عملية ذاتياً برمز المندوب' },
  { value: 'VAN_SUSPICION_INVALID_PIN', label: 'إدخال رمز اعتماد مشرف غير صحيح (تخمين PIN)' },
  { value: 'VAN_SUSPICION_UNAUTHORIZED_LOAD_OR_SETTLE', label: 'محاولة سحب بضاعة أو تصفية رحلة بدون مشرف' },
  { value: 'VAN_SUSPICION_SETTLEMENT_SHORTAGE', label: 'عجز نقدي أو مخزني فعلي عند تصفية الرحلة' },
];

export const PERIOD_OPTIONS = [
  { value: '7', label: 'آخر 7 أيام' },
  { value: '30', label: 'آخر 30 يوماً' },
  { value: '90', label: 'آخر 90 يوماً' },
];

export function formatMoney(val: number): string {
  return Number(val || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatEventDateTime(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '—', time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: iso, time: '' };
  const dateStr = d.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const timeStr = d.toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return { date: dateStr, time: timeStr };
}

export const EVENT_CODE_META: Record<
  string,
  { label: string; bg: string; color: string; border: string }
> = {
  VAN_SUSPICION_PRICE_MANIPULATION: {
    label: 'تلاعب بالأسعار',
    bg: '#fef2f2',
    color: '#991b1b',
    border: '#fecaca',
  },
  VAN_SUSPICION_UNAUTHORIZED_BONUS: {
    label: 'بونص غير مصرح',
    bg: '#fff7ed',
    color: '#c2410c',
    border: '#fed7aa',
  },
  VAN_SUSPICION_CREDIT_BYPASS: {
    label: 'كسر سقف الائتمان',
    bg: '#fef2f2',
    color: '#b91c1c',
    border: '#fca5a5',
  },
  VAN_SUSPICION_CROSS_REP_COLLECTION: {
    label: 'تحصيل متقاطع',
    bg: '#eff6ff',
    color: '#1d4ed8',
    border: '#bfdbfe',
  },
  VAN_SUSPICION_FRAUDULENT_RETURN: {
    label: 'مرتجع مشبوه',
    bg: '#fdf2f8',
    color: '#be185d',
    border: '#fbcfe8',
  },
  VAN_SUSPICION_FAKE_CARD_PAYMENT: {
    label: 'دفع وهمي بالبطاقة',
    bg: '#f5f3ff',
    color: '#6d28d9',
    border: '#ddd6fe',
  },
  VAN_SUSPICION_EXPENSE_ABUSE: {
    label: 'مصروفات طريق',
    bg: '#fffbeb',
    color: '#b45309',
    border: '#fde68a',
  },
  VAN_SUSPICION_ODOMETER_ROLLBACK: {
    label: 'تلاعب بالعداد',
    bg: '#fef2f2',
    color: '#dc2626',
    border: '#fca5a5',
  },
  VAN_SUSPICION_GEOFENCE_VIOLATION: {
    label: 'خارج النطاق GPS',
    bg: '#ecfeff',
    color: '#0e7490',
    border: '#a5f3fc',
  },
  VAN_SUSPICION_SELF_APPROVAL: {
    label: 'اعتماد ذاتي',
    bg: '#fff1f2',
    color: '#e11d48',
    border: '#fecdd3',
  },
  VAN_SUSPICION_INVALID_PIN: {
    label: 'تخمين رمز PIN',
    bg: '#fff7ed',
    color: '#ea580c',
    border: '#ffedd5',
  },
  VAN_SUSPICION_UNAUTHORIZED_LOAD_OR_SETTLE: {
    label: 'سحب/تصفية غير مصرح',
    bg: '#fef2f2',
    color: '#b91c1c',
    border: '#fecaca',
  },
  VAN_SUSPICION_SETTLEMENT_SHORTAGE: {
    label: 'عجز تصفية رحلة',
    bg: '#fffbeb',
    color: '#b45309',
    border: '#fde68a',
  },
};

export function getEventCodeMeta(code: string) {
  return (
    EVENT_CODE_META[code] || {
      label: 'شبهة تشغيلية',
      bg: '#f1f5f9',
      color: '#475569',
      border: '#cbd5e1',
    }
  );
}
