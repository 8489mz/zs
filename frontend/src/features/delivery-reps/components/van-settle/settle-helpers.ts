export const formatTime = (iso?: string) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

export const getPaymentMethodBadge = (method: string) => {
  switch (method) {
    case 'cash':
      return { label: 'نقدي (كاش)', bg: '#dcfce7', color: '#15803d' };
    case 'credit':
      return { label: 'آجل (ذمم)', bg: '#fef3c7', color: '#b45309' };
    case 'split':
      return { label: 'مجزأ (كاش + آجل)', bg: '#e0e7ff', color: '#3730a3' };
    case 'card':
      return { label: 'بطاقة / بنكي', bg: '#f1f5f9', color: '#334155' };
    case 'instapay':
      return { label: 'إنستاباي (بنكي فوري)', bg: '#f5f3ff', color: '#7c3aed' };
    case 'vodafone_cash':
      return { label: 'محفظة إلكترونية (فودافون كاش)', bg: '#fff1f2', color: '#e11d48' };
    default:
      return { label: method, bg: '#f1f5f9', color: '#475569' };
  }
}

export const getReturnStatusBadge = (status: string) => {
  switch (status) {
    case 'approved':
      return { label: 'معتمد ومضاف للسيارة', bg: '#dcfce7', color: '#15803d' };
    case 'pending':
      return { label: 'قيد مراجعة الإدارة', bg: '#fef3c7', color: '#b45309' };
    case 'rejected':
      return { label: 'مرفوض', bg: '#fee2e2', color: '#b91c1c' };
    default:
      return { label: status, bg: '#f1f5f9', color: '#475569' };
  }
}
