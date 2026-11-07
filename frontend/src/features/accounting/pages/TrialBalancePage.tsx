/* Trial balance page (INV-TRIAL-BALANCE-PAGE): the dedicated debit/credit
 * balance page. Every tenant account appears with its posted totals; the
 * balance is proven by total debit = total credit, and zero-balance
 * accounts are shown with 0.00 / 0.00 (documented rule), never hidden.
 */
import { useTranslation } from 'react-i18next';
import { translateUiText } from '@/lib/auto-translator';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { formatCurrency } from '@/lib/format';
import { CheckIcon, XIcon, DownloadIcon, PrinterIcon } from '@/shared/components/icons/AppIcons';
import { PageHeader } from '@/shared/components/page-header';
import { useTrialBalance, type TrialBalanceReportData } from '../hooks/useTrialBalance';

/* Local calendar date (never UTC toISOString: near midnight in UTC+2 the
 * UTC date is the previous day).
 */
function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function TrialBalancePage() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const navigate = useNavigate();
  const [asOfDate, setAsOfDate] = useState(() => localDateString(new Date()));

  const query = useTrialBalance(asOfDate);

  const report: TrialBalanceReportData | undefined = query.data;

  const handlePrint = () => {
    window.print();
  };

  const handleExportCsv = () => {
    if (!report) return;
    const lines: string[] = ['كود الحساب,اسم الحساب,النوع,مدين,دائن'];
    for (const row of report.rows) {
      lines.push(`"${row.code}","${isEn ? row.nameEn || row.nameAr : row.nameAr}","${row.accountType}",${row.debit},${row.credit}`);
    }
    lines.push(`"الإجمالي","","",${report.totalDebit},${report.totalCredit}`);
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(lines.join('\n'));
    const link = document.createElement('a');
    link.setAttribute('href', csvContent);
    link.setAttribute('download', `trial-balance-${asOfDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="page-stack page-shell trial-balance-page">
      <main className="document-prototype-column" style={{ paddingBottom: '100px' }}>
        <PageHeader
          title={t('accounting.trial_balance_page.s0', 'ميزان المراجعة')}
          description={t('accounting.trial_balance_page.s1', 'أرصدة الحسابات مدينة / دائنة من القيود المرحّلة، مع إثبات التوازن (مجموع المدين = مجموع الدائن)')}
          badge={<span className="nav-pill">{t('accounting.trial_balance_page.s2', 'القوائم المالية المعتمدة')}</span>}
          actions={
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button type="button" variant="secondary" onClick={() => navigate('/accounting/balance-sheet')}>
                {t('accounting.trial_balance_page.s3', 'الميزانية العمومية')}
              </Button>
              <Button type="button" variant="secondary" onClick={handleExportCsv} disabled={!report}>
                <DownloadIcon size={14} style={{ marginInlineEnd: '6px' }} />
                {t('accounting.trial_balance_page.s4', 'تصدير CSV')}
              </Button>
              <Button type="button" variant="secondary" onClick={handlePrint} disabled={!report}>
                <PrinterIcon size={14} style={{ marginInlineEnd: '6px' }} />
                {t('accounting.trial_balance_page.s5', 'طباعة معتمدة')}
              </Button>
            </div>
          }
        />

        {/* Filter Control Card */}
        <Card style={{ padding: '16px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', marginBottom: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', alignItems: 'flex-end' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
                {t('accounting.trial_balance_page.s6', 'حتى تاريخ')}
              </label>
              <input
                type="date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                style={{ width: '100%', height: '36px', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0 10px', fontSize: '0.875rem' }}
              />
            </div>
            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
              {t('accounting.trial_balance_page.s7', 'تشمل الحسابات ذات الرصيد صفر (0.00 / 0.00) — القيود المرحّلة فقط تدخل الأرصدة.')}
            </div>
          </div>
        </Card>

        {query.isPending && (
          <Card style={{ padding: '24px', textAlign: 'center', color: '#64748b', borderRadius: '12px' }}>
            {t('accounting.trial_balance_page.s8', 'جارٍ احتساب ميزان المراجعة...')}
          </Card>
        )}

        {query.isError && (
          <Card style={{ padding: '24px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: '12px' }}>
            {t('accounting.trial_balance_page.s9', 'تعذر احتساب ميزان المراجعة. يرجى التحقق من الاتصال بالخادم.')}
          </Card>
        )}

        {report && (
          <>
            {/* Balance Verification Card */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 20px',
                borderRadius: '12px',
                marginBottom: '16px',
                backgroundColor: report.isBalanced ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${report.isBalanced ? '#bbf7d0' : '#fecaca'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: report.isBalanced ? '#16a34a' : '#dc2626',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {report.isBalanced ? <CheckIcon size={18} color="#ffffff" /> : <XIcon size={18} color="#ffffff" />}
                </div>
                <div>
                  <strong style={{ fontSize: '0.95rem', color: report.isBalanced ? '#166534' : '#991b1b' }}>
                    {report.isBalanced
                      ? t('accounting.trial_balance_page.s10', 'ميزان المراجعة متوازن محاسبياً بدقة 100%')
                      : `يوجد فارق عدم توازن قدره: ${formatCurrency(Math.abs(report.difference))}`}
                  </strong>
                  <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '2px' }}>
                    {t('accounting.trial_balance_page.s11', 'مجموع المدين (')}
                    {formatCurrency(report.totalDebit)}
                    {t('accounting.trial_balance_page.s12', ') = مجموع الدائن (')}
                    {formatCurrency(report.totalCredit)}
                    {')'}
                  </div>
                </div>
              </div>

              <div style={{ textAlign: 'left' }}>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{t('accounting.trial_balance_page.s13', 'حتى تاريخ:')}</span>
                <strong style={{ display: 'block', fontSize: '0.9rem', color: '#0f172a' }}>{report.asOfDate}</strong>
              </div>
            </div>

            {/* Totals Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px' }}>
              <Card style={{ padding: '16px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b' }}>{t('accounting.trial_balance_page.s14', 'إجمالي المدين')}</span>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                  {formatCurrency(report.totalDebit)}
                </div>
              </Card>
              <Card style={{ padding: '16px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b' }}>{t('accounting.trial_balance_page.s15', 'إجمالي الدائن')}</span>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                  {formatCurrency(report.totalCredit)}
                </div>
              </Card>
              <Card style={{ padding: '16px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b' }}>{t('accounting.trial_balance_page.s16', 'عدد الحسابات')}</span>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                  {report.rows.length}
                </div>
              </Card>
            </div>

            {/* Rows Table */}
            <Card style={{ padding: '0', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between' }}>
                <strong style={{ fontSize: '0.95rem', color: '#0f172a' }}>{t('accounting.trial_balance_page.s17', 'أرصدة الحسابات')}</strong>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{t('accounting.trial_balance_page.s18', 'مدين / دائن')}</span>
              </div>

              <div style={{ padding: '12px 16px' }}>
                {report.rows.length === 0 ? (
                  <div style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                    {t('accounting.trial_balance_page.s19', 'لا توجد حسابات في دليل الحسابات')}
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: '0.8rem' }}>
                        <th style={{ padding: '8px 4px', textAlign: 'right', width: '80px' }}>{t('accounting.trial_balance_page.s20', 'كود الحساب')}</th>
                        <th style={{ padding: '8px 4px', textAlign: 'right' }}>{t('accounting.trial_balance_page.s21', 'اسم الحساب')}</th>
                        <th style={{ padding: '8px 4px', textAlign: 'left', width: '140px' }}>{t('accounting.trial_balance_page.s22', 'مدين')}</th>
                        <th style={{ padding: '8px 4px', textAlign: 'left', width: '140px' }}>{t('accounting.trial_balance_page.s23', 'دائن')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((row) => {
                        const rowName = isEn ? (row.nameEn || translateUiText(row.nameAr) || row.nameAr) : row.nameAr;
                        return (
                          <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '8px 4px', color: '#64748b', width: '80px' }}>{row.code}</td>
                            <td style={{ padding: '8px 4px', fontWeight: 600, color: '#1e293b' }}>{rowName}</td>
                            <td style={{ padding: '8px 4px', textAlign: 'left', fontWeight: 700, color: '#0f172a' }}>
                              {formatCurrency(row.debit)}
                            </td>
                            <td style={{ padding: '8px 4px', textAlign: 'left', fontWeight: 700, color: '#0f172a' }}>
                              {formatCurrency(row.credit)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e8f0', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: '#334155' }}>{t('accounting.trial_balance_page.s24', 'الإجمالي')}</span>
                <div style={{ display: 'flex', gap: '24px' }}>
                  <strong style={{ fontSize: '1.05rem', color: '#0f172a' }}>{formatCurrency(report.totalDebit)}</strong>
                  <strong style={{ fontSize: '1.05rem', color: '#0f172a' }}>{formatCurrency(report.totalCredit)}</strong>
                </div>
              </div>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
