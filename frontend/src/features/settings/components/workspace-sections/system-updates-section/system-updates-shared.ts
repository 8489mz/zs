export function formatGregorianDate(dateInput?: string | number | Date | null, withTime = false): string {
  if (!dateInput) return 'غير محدد';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return 'غير محدد';
  return new Intl.DateTimeFormat('ar-EG', {
    calendar: 'gregory',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: true } : {}),
  }).format(d);
}
