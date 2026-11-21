export const getEntryTypeBadge = (type: string) => {
  switch (type) {
    case 'cash_shortage':
      return { label: 'عجز نقدي (كاش)', bg: '#f8fafc', color: '#991b1b', border: '#fecaca' };
    case 'stock_shortage':
      return { label: 'عجز بضاعة ومخزون', bg: '#f8fafc', color: '#9a3412', border: '#fed7aa' };
    case 'cash_overage':
      return { label: 'فائض نقدي', bg: '#f8fafc', color: '#1e40af', border: '#bfdbfe' };
    case 'commission':
      return { label: 'عمولة مبيعات', bg: '#f8fafc', color: '#065f46', border: '#a7f3d0' };
    case 'bonus':
      return { label: 'مكافأة / بونص تارجت', bg: '#f8fafc', color: '#170e5e', border: '#e2e8f0' };
    case 'cash_reimbursement':
      return { label: 'سداد نقدي بالخزينة', bg: '#f8fafc', color: '#166534', border: '#bbf7d0' };
    default:
      return { label: type, bg: '#f8fafc', color: '#475569', border: '#e2e8f0' };
  }
};

export const getStatusBadge = (status: string, _method?: string | null, voucher?: string | null, isEn: boolean) => {
  switch (status) {
    case 'pending':
      return { label: isEn ? 'Pending & Unsettled' : 'معلق وغير مسدد', bg: '#fef2f2', color: '#991b1b', border: '#fecaca' };
    case 'settled':
      return {
        label: voucher ? (isEn ? `Cash Payment (#${voucher})` : `سداد نقدي (#${voucher})`) : (isEn ? 'Settled in Safe' : 'تم السداد بالخزينة'),
        bg: '#f0fdf4',
        color: '#166534',
        border: '#bbf7d0',
      };
    case 'pushed_to_payroll':
      return { label: isEn ? 'Transferred to Payroll' : 'مرحل لمسير الرواتب', bg: '#f8fafc', color: '#170e5e', border: '#e2e8f0' };
    case 'waived':
      return { label: isEn ? 'Administrative Waiver' : 'إعفاء إداري معتمد', bg: '#f8fafc', color: '#475569', border: '#e2e8f0' };
    default:
      return { label: status, bg: '#f8fafc', color: '#475569', border: '#e2e8f0' };
  }
};
