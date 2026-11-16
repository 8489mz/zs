import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '@/features/reports/api/reports.api';

/**
 * INV-VAN-PROFIT-REP-REPORTING: standalone net-profit view.
 *
 * The lines come from GET /api/reports/net-profit (one
 * buildCommercialSummary call server-side — this component only
 * renders). The discount line is INFORMATIONAL: revenue is already
 * net of discounts, so it is shown to prove the deduction, not
 * subtracted again. The arithmetic chain is
 * revenue − sales tax − returns (net of tax) − COGS − expenses =
 * net operating profit.
 */
export function NetProfitReportSection({ from, to }: { from?: string; to?: string }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['reports-net-profit', from, to],
    queryFn: () => reportsApi.netProfit(from || '', to || ''),
    enabled: Boolean(from && to),
  });

  const fmt = (v: number | undefined | null) =>
    Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (query.isLoading) {
    return <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>{t('reports.net_profit_report.s0', 'جاري تحميل تقرير صافي الربح...')}</div>;
  }
  if (query.isError || !query.data) {
    return <div style={{ padding: '24px', textAlign: 'center', color: '#dc2626' }}>{t('reports.net_profit_report.s1', 'تعذر تحميل تقرير صافي الربح')}</div>;
  }

  const lines = query.data.lines;
  const rows: Array<{ label: string; value: number; sign: 1 | -1; bold?: boolean; note?: string }> = [
    { label: t('reports.net_profit_report.s2', 'الإيرادات (صافي بعد الخصومات)'), value: lines.revenue, sign: 1 },
    { label: t('reports.net_profit_report.s3', 'ضريبة المبيعات'), value: lines.salesTaxTotal, sign: -1 },
    { label: t('reports.net_profit_report.s4', 'المرتجعات (صافي بعد الضريبة)'), value: lines.returnsNetOfTax, sign: -1 },
    { label: t('reports.net_profit_report.s5', 'منها: خصومات ممنوحة (معلومة فقط — مخصومة داخل الإيرادات)'), value: lines.discountsTotal, sign: 1, note: 'info' },
    { label: t('reports.net_profit_report.s6', 'صافي المبيعات'), value: lines.netSales, sign: 1, bold: true },
    { label: t('reports.net_profit_report.s7', 'تكلفة البضاعة المباعة'), value: lines.cogs, sign: -1 },
    { label: t('reports.net_profit_report.s8', 'مجمل الربح'), value: lines.grossProfit, sign: 1, bold: true },
    { label: t('reports.net_profit_report.s9', 'المصروفات'), value: lines.expensesTotal, sign: -1 },
    { label: t('reports.net_profit_report.s10', 'صافي الربح التشغيلي'), value: lines.netOperatingProfit, sign: 1, bold: true },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '12px', padding: '16px 20px', boxShadow: '0 2px 6px rgba(15, 23, 42, 0.03)' }}>
        <h3 style={{ margin: '0 0 4px', color: '#0f172a', fontSize: '15px', fontWeight: 800 }}>{t('reports.net_profit_report.s11', 'صافي الربح')}</h3>
        <p style={{ margin: 0, color: '#64748b', fontSize: '12px' }}>
          {t('reports.net_profit_report.s12', 'الإيرادات − ضريبة المبيعات − المرتجعات (صافي) − تكلفة البضاعة − المصروفات = صافي الربح التشغيلي.')}
        </p>
        <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column' }}>
          {rows.map((row) => (
            <div
              key={row.label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '9px 4px',
                borderBottom: '1px solid #f1f5f9',
                fontWeight: row.bold ? 800 : 600,
                color: row.note === 'info' ? '#64748b' : '#0f172a',
                fontSize: row.bold ? '14px' : '13px',
                background: row.bold ? '#f8fafc' : 'transparent',
              }}
            >
              <span>{row.label}</span>
              <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {row.sign < 0 && row.value !== 0 ? '− ' : ''}{fmt(row.value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
