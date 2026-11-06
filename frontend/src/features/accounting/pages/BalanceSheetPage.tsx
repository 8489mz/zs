import { useTranslation } from 'react-i18next';
import { translateUiText } from '@/lib/auto-translator';
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { formatCurrency } from '@/lib/format';
import { CheckIcon, XIcon, DownloadIcon, PrinterIcon } from '@/shared/components/icons/AppIcons';
import { PageHeader } from '@/shared/components/page-header';
import {
  financialReportsApi,
  type BalanceSheetReportData,
  type BalanceSheetSection,
} from '@/features/accounting/api/accounting.api';

export function BalanceSheetPage() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const oneYearAgo = new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().slice(0, 10);

  const [asOfDate, setAsOfDate] = useState(today);
  const [compareMode, setCompareMode] = useState<'none' | 'last_year' | 'custom'>('last_year');
  const [customCompareDate, setCustomCompareDate] = useState(oneYearAgo);

  const effectiveCompareDate = useMemo(() => {
    if (compareMode === 'none') return undefined;
    if (compareMode === 'last_year') {
      const d = new Date(asOfDate);
      d.setFullYear(d.getFullYear() - 1);
      return d.toISOString().slice(0, 10);
    }
    return customCompareDate || undefined;
  }, [compareMode, asOfDate, customCompareDate]);

  const query = useQuery({
    queryKey: ['balance-sheet', asOfDate, effectiveCompareDate],
    queryFn: () => financialReportsApi.balanceSheet({ asOfDate, compareDate: effectiveCompareDate }),
  });

  const report: BalanceSheetReportData | undefined = query.data;

  const handlePrint = () => {
    window.print();
  };

  const handleExportCsv = () => {
    if (!report) return;
    const lines: string[] = ['كود الحساب,اسم الحساب,النوع,المبلغ الحالي,المبلغ المقارن,الفارق,نسبة التغير %'];

    const addSection = (sec: BalanceSheetSection, sectionName: string) => {
      lines.push(`--- ${sectionName} ---,,,,,,`);
      for (const a of sec.accounts) {
        lines.push(
          `"${a.code}","${a.nameAr}","${a.accountGroup}",${a.amount},${a.compareAmount ?? ''},${a.varianceAmount ?? ''},${a.variancePercent ?? ''}%`,
        );
      }
      lines.push(`"إجمالي ${sectionName}","","",${sec.total},${sec.compareTotal ?? ''},${sec.varianceAmount ?? ''},${sec.variancePercent ?? ''}%`);
    };

    addSection(report.assets.currentAssets, 'الأصول المتداولة');
    addSection(report.assets.nonCurrentAssets, 'الأصول غير المتداولة');
    addSection(report.liabilities.currentLiabilities, 'الالتزامات المتداولة');
    addSection(report.liabilities.nonCurrentLiabilities, 'الالتزامات غير المتداولة');
    addSection(report.equity.section, 'حقوق الملكية');

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(lines.join('\n'));
    const link = document.createElement('a');
    link.setAttribute('href', csvContent);
    link.setAttribute('download', `balance-sheet-${asOfDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="page-stack page-shell balance-sheet-page">
      <main className="document-prototype-column" style={{ paddingBottom: '100px' }}>
        <PageHeader
          title={t('accounting.balance_sheet_page.s0', "الميزانية العمومية وقائمة المركز المالي")}
          description={t('accounting.balance_sheet_page.s1', "Statement of Financial Position (IAS 1 / IFRS Standard) مع التحقق المحاسبي الآلي للتوازن")}
          badge={<span className="nav-pill">{t('accounting.balance_sheet_page.s2', "القوائم المالية المعتمدة")}</span>}
          actions={
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button type="button" variant="secondary" onClick={() => navigate('/accounting/trial-balance')}>
                {t('accounting.balance_sheet_page.s37', 'ميزان المراجعة')}
              </Button>
              <Button type="button" variant="secondary" onClick={handleExportCsv} disabled={!report}>
                <DownloadIcon size={14} style={{ marginInlineEnd: '6px' }} />
                {t('accounting.balance_sheet_page.s3', "تصدير CSV")}
              </Button>
              <Button type="button" variant="secondary" onClick={handlePrint} disabled={!report}>
                <PrinterIcon size={14} style={{ marginInlineEnd: '6px' }} />
                {t('accounting.balance_sheet_page.s4', "طباعة معتمدة")}
              </Button>
            </div>
          }
        />

      {/* Filter Control Card */}
      <Card style={{ padding: '16px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', marginBottom: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', alignItems: 'flex-end' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
              {t('accounting.balance_sheet_page.s5', "تاريخ الميزانية (حتى تاريخ)")}
            </label>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              style={{ width: '100%', height: '36px', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0 10px', fontSize: '0.875rem' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
              {t('accounting.balance_sheet_page.s6', "المقارنة مع فترة سابقة")}
            </label>
            <select
              value={compareMode}
              onChange={(e) => setCompareMode(e.target.value as any)}
              style={{ width: '100%', height: '36px', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0 10px', fontSize: '0.875rem' }}
            >
              <option value="none">{t('accounting.balance_sheet_page.s7', "بدون مقارنة")}</option>
              <option value="last_year">{t('accounting.balance_sheet_page.s8', "نفس التاريخ من العام السابق")}</option>
              <option value="custom">{t('accounting.balance_sheet_page.s9', "تاريخ مخصص")}</option>
            </select>
          </div>

          {compareMode === 'custom' && (
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
                {t('accounting.balance_sheet_page.s10', "تاريخ المقارنة المخصص")}
              </label>
              <input
                type="date"
                value={customCompareDate}
                onChange={(e) => setCustomCompareDate(e.target.value)}
                style={{ width: '100%', height: '36px', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0 10px', fontSize: '0.875rem' }}
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <Button
              type="button"
              variant="primary"
              onClick={() => void query.refetch()}
              style={{ height: '36px', backgroundColor: '#170e5e', color: '#fff', fontWeight: 700 }}
            >
              {t('accounting.balance_sheet_page.s11', "تحديث التقرير")}
            </Button>
          </div>
        </div>
      </Card>

      {/* Loading & Error feedback */}
      {query.isLoading && (
        <Card style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
          {t('accounting.balance_sheet_page.s12', "جاري احتساب الميزانية العمومية والتحقق من التوازن المالي...")}
        </Card>
      )}

      {query.isError && (
        <Card style={{ padding: '24px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: '12px' }}>
          {t('accounting.balance_sheet_page.s13', "تعذر احتساب الميزانية العمومية. يرجى التحقق من الاتصال بالخادم.")}
        </Card>
      )}

      {report && (
        <>
          {/* Golden Balance Verification Card */}
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
                    ? t('accounting.balance_sheet_page.s14', "الميزانية العمومية متوازنة محاسبياً بدقة 100%")
                    : `يوجد فارق عدم توازن قدره: ${formatCurrency(Math.abs(report.difference))}`}
                </strong>
                <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '2px' }}>
                  {t('accounting.balance_sheet_page.s15', "معادلة المركز المالي: إجمالي الأصول (")}{formatCurrency(report.assets.totalAssets)}{t('accounting.balance_sheet_page.s16', ") = الخصوم (")}{formatCurrency(report.liabilities.totalLiabilities)}{t('accounting.balance_sheet_page.s17', ") + حقوق الملكية (")}{formatCurrency(report.equity.totalEquity)})
                </div>
              </div>
            </div>

            <div style={{ textAlign: 'left' }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{t('accounting.balance_sheet_page.s18', "حتى تاريخ:")}</span>
              <strong style={{ display: 'block', fontSize: '0.9rem', color: '#0f172a' }}>{report.asOfDate}</strong>
            </div>
          </div>

          {/* 4 Financial Highlight Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            <Card style={{ padding: '16px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b' }}>{t('accounting.balance_sheet_page.s19', "إجمالي الأصول")}</span>
              <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                {formatCurrency(report.assets.totalAssets)}
              </div>
              {report.assets.compareTotalAssets !== undefined && (
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
                  {t('accounting.balance_sheet_page.s20', "مقارنة:")} {formatCurrency(report.assets.compareTotalAssets)}
                </div>
              )}
            </Card>

            <Card style={{ padding: '16px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b' }}>{t('accounting.balance_sheet_page.s21', "إجمالي الالتزامات (الخصوم)")}</span>
              <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#dc2626', marginTop: '4px' }}>
                {formatCurrency(report.liabilities.totalLiabilities)}
              </div>
              {report.liabilities.compareTotalLiabilities !== undefined && (
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
                  {t('accounting.balance_sheet_page.s22', "مقارنة:")} {formatCurrency(report.liabilities.compareTotalLiabilities)}
                </div>
              )}
            </Card>

            <Card style={{ padding: '16px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b' }}>{t('accounting.balance_sheet_page.s23', "صافي أرباح الفترة الحالية")}</span>
              <div
                style={{
                  fontSize: '1.3rem',
                  fontWeight: 800,
                  color: report.equity.currentPeriodNetProfit >= 0 ? '#16a34a' : '#dc2626',
                  marginTop: '4px',
                }}
              >
                {formatCurrency(report.equity.currentPeriodNetProfit)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
                {t('accounting.balance_sheet_page.s24', "منقولة آلياً من قائمة الدخل")}
              </div>
            </Card>

            <Card style={{ padding: '16px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b' }}>{t('accounting.balance_sheet_page.s25', "إجمالي حقوق الملكية")}</span>
              <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#170e5e', marginTop: '4px' }}>
                {formatCurrency(report.equity.totalEquity)}
              </div>
              {report.equity.compareTotalEquity !== undefined && (
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
                  {t('accounting.balance_sheet_page.s26', "مقارنة:")} {formatCurrency(report.equity.compareTotalEquity)}
                </div>
              )}
            </Card>
          </div>

          {/* Symmetrical 2-Column Enterprise Layout */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '20px', alignItems: 'flex-start' }}>
            {/* Column 1: Assets (الأصول) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Current Assets */}
              <SectionCard section={report.assets.currentAssets} hasCompare={effectiveCompareDate !== undefined} />

              {/* Non-Current Assets */}
              <SectionCard section={report.assets.nonCurrentAssets} hasCompare={effectiveCompareDate !== undefined} />

              {/* Total Assets Summary Box */}
              <Card
                style={{
                  padding: '16px 20px',
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  borderRadius: '12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{t('accounting.balance_sheet_page.s27', "المجموع العام")}</span>
                  <strong style={{ display: 'block', fontSize: '1.15rem' }}>{t('accounting.balance_sheet_page.s28', "إجمالي الأصول (Total Assets)")}</strong>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800 }}>{formatCurrency(report.assets.totalAssets)}</div>
                  {report.assets.compareTotalAssets !== undefined && (
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      {t('accounting.balance_sheet_page.s29', "السابق:")} {formatCurrency(report.assets.compareTotalAssets)}
                    </div>
                  )}
                </div>
              </Card>
            </div>

            {/* Column 2: Liabilities & Equity (الخصوم وحقوق الملكية) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Current Liabilities */}
              <SectionCard section={report.liabilities.currentLiabilities} hasCompare={effectiveCompareDate !== undefined} />

              {/* Non-Current Liabilities */}
              <SectionCard section={report.liabilities.nonCurrentLiabilities} hasCompare={effectiveCompareDate !== undefined} />

              {/* Equity Section with Current Period Net Profit */}
              <Card style={{ padding: '0', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: '0.95rem', color: '#0f172a' }}>{report.equity.section.titleAr}</strong>
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{report.equity.section.titleEn}</span>
                </div>

                <div style={{ padding: '12px 16px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <tbody>
                      {report.equity.section.accounts.map((acc) => (
                        <tr key={acc.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 4px', color: '#64748b', width: '80px' }}>{acc.code}</td>
                          <td style={{ padding: '8px 4px', fontWeight: 600, color: '#1e293b' }}>{isEn ? (acc.nameEn || translateUiText(acc.nameAr) || acc.nameAr) : acc.nameAr}</td>
                          <td style={{ padding: '8px 4px', textAlign: 'left', fontWeight: 700, color: '#0f172a' }}>
                            {formatCurrency(acc.amount)}
                          </td>
                          {effectiveCompareDate && (
                            <td style={{ padding: '8px 4px', textAlign: 'left', color: '#64748b', fontSize: '0.8rem' }}>
                              {formatCurrency(acc.compareAmount || 0)}
                            </td>
                          )}
                        </tr>
                      ))}

                      {/* Current period profit row */}
                      <tr style={{ borderBottom: '1px solid #f1f5f9', backgroundColor: '#f8fafc' }}>
                        <td style={{ padding: '8px 4px', color: '#64748b' }}>—</td>
                        <td style={{ padding: '8px 4px', fontWeight: 700, color: report.equity.currentPeriodNetProfit >= 0 ? '#166534' : '#991b1b' }}>
                          {t('accounting.balance_sheet_page.s30', "أرباح / (خسائر) الفترة الحالية من قائمة الدخل")}
                        </td>
                        <td style={{ padding: '8px 4px', textAlign: 'left', fontWeight: 700, color: report.equity.currentPeriodNetProfit >= 0 ? '#166534' : '#991b1b' }}>
                          {formatCurrency(report.equity.currentPeriodNetProfit)}
                        </td>
                        {effectiveCompareDate && (
                          <td style={{ padding: '8px 4px', textAlign: 'left', color: '#64748b', fontSize: '0.8rem' }}>
                            {formatCurrency(report.equity.compareCurrentPeriodNetProfit || 0)}
                          </td>
                        )}
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e8f0', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 700, color: '#334155' }}>{t('accounting.balance_sheet_page.s31', "إجمالي حقوق الملكية")}</span>
                  <strong style={{ fontSize: '1.05rem', color: '#170e5e' }}>{formatCurrency(report.equity.totalEquity)}</strong>
                </div>
              </Card>

              {/* Total Liabilities & Equity Summary Box */}
              <Card
                style={{
                  padding: '16px 20px',
                  backgroundColor: '#0f172a',
                  color: '#ffffff',
                  borderRadius: '12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{t('accounting.balance_sheet_page.s32', "المجموع العام")}</span>
                  <strong style={{ display: 'block', fontSize: '1.15rem' }}>{t('accounting.balance_sheet_page.s33', "إجمالي الخصوم وحقوق الملكية")}</strong>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800 }}>{formatCurrency(report.totalLiabilitiesAndEquity)}</div>
                  {report.compareTotalLiabilitiesAndEquity !== undefined && (
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      {t('accounting.balance_sheet_page.s34', "السابق:")} {formatCurrency(report.compareTotalLiabilitiesAndEquity)}
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
      </main>
    </div>
  );
}

function SectionCard({ section, hasCompare }: { section: BalanceSheetSection; hasCompare: boolean }) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const title = isEn ? (section.titleEn || translateUiText(section.titleAr) || section.titleAr) : section.titleAr;
  const subTitle = isEn ? undefined : section.titleEn;

  return (
    <Card style={{ padding: '0', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: '0.95rem', color: '#0f172a' }}>{title}</strong>
        {subTitle && <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{subTitle}</span>}
      </div>

      <div style={{ padding: '12px 16px' }}>
        {section.accounts.length === 0 ? (
          <div style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
            {t('accounting.balance_sheet_page.s35', "لا توجد أرصدة في هذا القسم")}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <tbody>
              {section.accounts.map((acc) => {
                const accName = isEn ? (acc.nameEn || translateUiText(acc.nameAr) || acc.nameAr) : acc.nameAr;
                return (
                  <tr key={acc.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 4px', color: '#64748b', width: '80px' }}>{acc.code}</td>
                    <td style={{ padding: '8px 4px', fontWeight: 600, color: '#1e293b' }}>{accName}</td>
                    <td style={{ padding: '8px 4px', textAlign: isEn ? 'right' : 'left', fontWeight: 700, color: acc.amount < 0 ? '#dc2626' : '#0f172a' }}>
                      {formatCurrency(acc.amount)}
                    </td>
                    {hasCompare && (
                      <td style={{ padding: '8px 4px', textAlign: isEn ? 'right' : 'left', color: '#64748b', fontSize: '0.8rem' }}>
                        {formatCurrency(acc.compareAmount || 0)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e8f0', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 700, color: '#334155' }}>{t('accounting.balance_sheet_page.s36', "إجمالي")} {title}</span>
        <strong style={{ fontSize: '1.05rem', color: '#0f172a' }}>{formatCurrency(section.total)}</strong>
      </div>
    </Card>
  );
}
