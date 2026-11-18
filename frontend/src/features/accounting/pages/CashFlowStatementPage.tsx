import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/shared/components/page-header';
import { Card } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { formatCurrency, todayLocalDateKey } from '@/lib/format';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { CheckIcon, XIcon, DownloadIcon, PrinterIcon } from '@/shared/components/icons/AppIcons';
import {
  financialReportsApi,
  type CashFlowReportData,
  type CashFlowSection,
} from '@/features/accounting/api/accounting.api';
import { translateUiText } from '@/lib/auto-translator';

export function CashFlowStatementPage() {
  const { t } = useTranslation();
  const currentYear = new Date().getFullYear();
  const defaultDateFrom = `${currentYear}-01-01`;
  const defaultDateTo = todayLocalDateKey();

  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);

  const query = useQuery({
    queryKey: ['cash-flow', dateFrom, dateTo],
    queryFn: () => financialReportsApi.cashFlow({ dateFrom, dateTo }),
  });

  const report: CashFlowReportData | undefined = query.data;

  const setPreset = (preset: 'this_month' | 'this_quarter' | 'this_year' | 'last_year') => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();

    if (preset === 'this_month') {
      const start = todayLocalDateKey(new Date(y, m, 1));
      const end = todayLocalDateKey(new Date(y, m + 1, 0));
      setDateFrom(start);
      setDateTo(end);
    } else if (preset === 'this_quarter') {
      const qStartMonth = Math.floor(m / 3) * 3;
      const start = todayLocalDateKey(new Date(y, qStartMonth, 1));
      const end = todayLocalDateKey(new Date(y, qStartMonth + 3, 0));
      setDateFrom(start);
      setDateTo(end);
    } else if (preset === 'this_year') {
      setDateFrom(`${y}-01-01`);
      setDateTo(`${y}-12-31`);
    } else if (preset === 'last_year') {
      setDateFrom(`${y - 1}-01-01`);
      setDateTo(`${y - 1}-12-31`);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportCsv = () => {
    if (!report) return;
    const lines: string[] = [`البند,المبلغ (${getGlobalCurrencySymbol()}),ملاحظات توضيحية`];

    const addSection = (sec: CashFlowSection) => {
      lines.push(`"--- ${sec.titleAr} ---",,`);
      for (const l of sec.lines) {
        lines.push(`"${l.labelAr}",${l.amount},"${l.note || ''}"`);
      }
      lines.push(`"إجمالي ${sec.titleAr}",${sec.total},""`);
    };

    addSection(report.operatingActivities);
    addSection(report.investingActivities);
    addSection(report.financingActivities);
    if (report.unclassifiedActivities) addSection(report.unclassifiedActivities);
    lines.push(`"صافي التغير في النقدية",${report.netCashFlow},""`);
    lines.push(`"رصيد النقدية أول المدة",${report.beginningCash},""`);
    lines.push(`"رصيد النقدية آخر المدة",${report.endingCash},""`);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(lines.join('\n'));
    const link = document.createElement('a');
    link.setAttribute('href', csvContent);
    link.setAttribute('download', `cash-flow-${dateFrom}-to-${dateTo}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="page-stack page-shell cash-flow-workspace">
      <main className="document-prototype-column" style={{ paddingBottom: '32px' }}>
        <PageHeader
          title={t('accounting.cash_flow_statement_page.s0', "قائمة التدفقات النقدية المعيارية")}
          description={t('accounting.cash_flow_statement_page.s1', "Statement of Cash Flows (IAS 7) — تصنيف حركة السيولة النقدية ومطابقتها التلقائية مع واقع الخزائن والبنوك.")}
          badge={
            report ? (
              <span className="nav-pill">
                {report.isReconciled ? t('accounting.cash_flow_statement_page.s2', "السيولة متطابقة مع البنوك") : t('accounting.cash_flow_statement_page.s3', "يوجد فرق تسوية")}
              </span>
            ) : null
          }
          actions={
            <div className="actions compact-actions">
              <Button type="button" variant="secondary" onClick={handleExportCsv} disabled={!report}>
                <DownloadIcon size={14} style={{ marginInlineEnd: '6px' }} />
                {t('accounting.cash_flow_statement_page.s4', "تصدير CSV")}
              </Button>
              <Button type="button" variant="secondary" onClick={handlePrint} disabled={!report}>
                <PrinterIcon size={14} style={{ marginInlineEnd: '6px' }} />
                {t('accounting.cash_flow_statement_page.s5', "طباعة معتمدة")}
              </Button>
            </div>
          }
        />

      {/* Filter Control Card */}
      <Card style={{ padding: '16px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: '16px' }}>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
                {t('accounting.cash_flow_statement_page.s6', "من تاريخ")}
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                style={{ width: '160px', height: '36px', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0 10px', fontSize: '0.875rem' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
                {t('accounting.cash_flow_statement_page.s7', "إلى تاريخ")}
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                style={{ width: '160px', height: '36px', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0 10px', fontSize: '0.875rem' }}
              />
            </div>

            <Button
              type="button"
              variant="primary"
              onClick={() => void query.refetch()}
              style={{ height: '36px', backgroundColor: '#170e5e', color: '#fff', fontWeight: 700 }}
            >
              {t('accounting.cash_flow_statement_page.s8', "تحديث التقرير")}
            </Button>
          </div>

          {/* Quick Period Presets */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <Button type="button" variant="secondary" onClick={() => setPreset('this_month')} style={{ fontSize: '0.8rem', padding: '4px 10px' }}>
              {t('accounting.cash_flow_statement_page.s9', "هذا الشهر")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setPreset('this_quarter')} style={{ fontSize: '0.8rem', padding: '4px 10px' }}>
              {t('accounting.cash_flow_statement_page.s10', "الربع الحالي")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setPreset('this_year')} style={{ fontSize: '0.8rem', padding: '4px 10px' }}>
              {t('accounting.cash_flow_statement_page.s11', "هذا العام")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setPreset('last_year')} style={{ fontSize: '0.8rem', padding: '4px 10px' }}>
              {t('accounting.cash_flow_statement_page.s12', "العام السابق")}
            </Button>
          </div>
        </div>
      </Card>

      {/* Loading & Error feedback */}
      {query.isLoading && (
        <Card style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
          {t('accounting.cash_flow_statement_page.s13', "جاري احتساب التدفقات النقدية ومطابقة أرصدة الخزائن والبنوك...")}
        </Card>
      )}

      {query.isError && (
        <Card style={{ padding: '24px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: '12px' }}>
          {t('accounting.cash_flow_statement_page.s14', "تعذر احتساب قائمة التدفقات النقدية. يرجى التحقق من اتصال الخادم.")}
        </Card>
      )}

      {report && (
        <>
          {/* Reconciliation Status Card */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 20px',
              borderRadius: '12px',
              marginBottom: '16px',
              backgroundColor: report.isReconciled ? '#f0fdf4' : '#fffbeb',
              border: `1px solid ${report.isReconciled ? '#bbf7d0' : '#fde68a'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: report.isReconciled ? '#16a34a' : '#d97706',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {report.isReconciled ? <CheckIcon size={18} color="#ffffff" /> : <XIcon size={18} color="#ffffff" />}
              </div>
              <div>
                <strong style={{ fontSize: '0.95rem', color: report.isReconciled ? '#166534' : '#92400e' }}>
                  {report.isReconciled
                    ? t('accounting.cash_flow_statement_page.s15', "النقدية متطابقة تماماً مع أرصدة الخزائن والحسابات البنكية الفعلية")
                    : t('accounting.cash_flow_statement_page.s16', "يوجد اختلاف طفيف بين التدفقات المحسوبة وأرصدة البنوك")}
                </strong>
                <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '2px' }}>
                  {t('accounting.cash_flow_statement_page.s17', "رصيد أول المدة (")}{formatCurrency(report.beginningCash)}{t('accounting.cash_flow_statement_page.s18', ") + صافي التدفق (")}{formatCurrency(report.netCashFlow)}{t('accounting.cash_flow_statement_page.s19', ") = رصيد آخر المدة (")}{formatCurrency(report.endingCash)})
                </div>
              </div>
            </div>

            <div style={{ textAlign: 'left' }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{t('accounting.cash_flow_statement_page.s20', "الفترة الزمنية:")}</span>
              <strong style={{ display: 'block', fontSize: '0.85rem', color: '#0f172a' }}>
                {report.dateFrom} ➔ {report.dateTo}
              </strong>
            </div>
          </div>

          {/* 4 Financial Highlight Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            <Card style={{ padding: '16px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b' }}>{t('accounting.cash_flow_statement_page.s21', "التدفقات التشغيلية")}</span>
              <div
                style={{
                  fontSize: '1.3rem',
                  fontWeight: 800,
                  color: report.operatingActivities.total >= 0 ? '#16a34a' : '#dc2626',
                  marginTop: '4px',
                }}
              >
                {formatCurrency(report.operatingActivities.total)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
                {t('accounting.cash_flow_statement_page.s22', "النشاط التجاري والعمليات")}
              </div>
            </Card>

            <Card style={{ padding: '16px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b' }}>{t('accounting.cash_flow_statement_page.s23', "التدفقات الاستثمارية")}</span>
              <div
                style={{
                  fontSize: '1.3rem',
                  fontWeight: 800,
                  color: report.investingActivities.total >= 0 ? '#16a34a' : '#dc2626',
                  marginTop: '4px',
                }}
              >
                {formatCurrency(report.investingActivities.total)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
                {t('accounting.cash_flow_statement_page.s24', "شراء وبيع الأصول والمعدات")}
              </div>
            </Card>

            <Card style={{ padding: '16px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b' }}>{t('accounting.cash_flow_statement_page.s25', "التدفقات التمويلية")}</span>
              <div
                style={{
                  fontSize: '1.3rem',
                  fontWeight: 800,
                  color: report.financingActivities.total >= 0 ? '#16a34a' : '#dc2626',
                  marginTop: '4px',
                }}
              >
                {formatCurrency(report.financingActivities.total)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
                {t('accounting.cash_flow_statement_page.s26', "رأس المال والمسحوبات والقروض")}
              </div>
            </Card>

            <Card style={{ padding: '16px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b' }}>{t('accounting.cash_flow_statement_page.s27', "صافي التغير في النقدية")}</span>
              <div
                style={{
                  fontSize: '1.3rem',
                  fontWeight: 800,
                  color: report.netCashFlow >= 0 ? '#170e5e' : '#dc2626',
                  marginTop: '4px',
                }}
              >
                {formatCurrency(report.netCashFlow)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
                {t('accounting.cash_flow_statement_page.s28', "إجمالي حركة السيولة بالفترة")}
              </div>
            </Card>
          </div>

          {/* Three Standard Sections */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <CashFlowSectionCard section={report.operatingActivities} />
            <CashFlowSectionCard section={report.investingActivities} />
            <CashFlowSectionCard section={report.financingActivities} />
            {report.isClassified === false && (
              <div className="alert alert-warning">{t('accounting.arch02.mixedFlowsWarning', 'توجد تدفقات مختلطة تحتاج توزيعاً محاسبياً قبل اعتماد تصنيف القائمة؛ المبالغ مدرجة ضمن صافي النقدية.')}</div>
            )}
            {report.unclassifiedActivities && report.isClassified === false && <CashFlowSectionCard section={report.unclassifiedActivities} />}

            {/* Reconciliation Box at Bottom */}
            <Card
              style={{
                padding: '20px',
                backgroundColor: '#170e5e',
                color: '#ffffff',
                borderRadius: '12px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '16px',
                alignItems: 'center',
              }}
            >
              <div>
                <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{t('accounting.cash_flow_statement_page.s29', "رصيد النقدية في بداية الفترة")}</span>
                <strong style={{ display: 'block', fontSize: '1.3rem' }}>{formatCurrency(report.beginningCash)}</strong>
              </div>

              <div>
                <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{t('accounting.cash_flow_statement_page.s30', "صافي التغير في النقدية")}</span>
                <strong style={{ display: 'block', fontSize: '1.3rem', color: report.netCashFlow >= 0 ? '#4ade80' : '#f87171' }}>
                  {formatCurrency(report.netCashFlow)}
                </strong>
              </div>

              <div style={{ borderInlineStart: '1px solid #334155', paddingInlineStart: '16px' }}>
                <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{t('accounting.cash_flow_statement_page.s31', "رصيد النقدية في نهاية الفترة (الفعلي)")}</span>
                <strong style={{ display: 'block', fontSize: '1.5rem', color: '#38bdf8' }}>{formatCurrency(report.endingCash)}</strong>
              </div>
            </Card>
          </div>
        </>
      )}
      </main>
    </div>
  );
}

function CashFlowSectionCard({ section }: { section: CashFlowSection }) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const title = isEn ? (section.titleEn || translateUiText(section.titleAr) || section.titleAr) : section.titleAr;
  const subTitle = isEn ? undefined : section.titleEn;

  return (
    <Card style={{ padding: '0', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong style={{ fontSize: '0.95rem', color: '#0f172a' }}>{title}</strong>
          {subTitle && (
            <span style={{ fontSize: '0.8rem', color: '#64748b', marginInlineStart: '8px' }}>({subTitle})</span>
          )}
        </div>
        <div style={{ fontSize: '1.05rem', fontWeight: 800, color: section.total >= 0 ? '#166534' : '#991b1b' }}>
          {formatCurrency(section.total)}
        </div>
      </div>

      <div style={{ padding: '8px 16px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <tbody>
            {section.lines.map((line, idx) => {
              const label = isEn ? (line.labelEn || translateUiText(line.labelAr) || line.labelAr) : line.labelAr;
              const note = line.note ? (isEn ? ((line as any).noteEn || translateUiText(line.note) || line.note) : line.note) : undefined;
              return (
                <tr key={idx} style={{ borderBottom: idx !== section.lines.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                  <td style={{ padding: '10px 4px', fontWeight: 600, color: '#1e293b' }}>
                    {label}
                    {note && (
                      <div style={{ fontSize: '0.75rem', fontWeight: 400, color: '#64748b', marginTop: '2px' }}>
                        {note}
                      </div>
                    )}
                  </td>
                  <td
                    style={{
                      padding: '10px 4px',
                      textAlign: isEn ? 'right' : 'left',
                      fontWeight: 700,
                      color: line.amount < 0 ? '#dc2626' : line.amount > 0 ? '#16a34a' : '#64748b',
                      width: '180px',
                    }}
                  >
                    {formatCurrency(line.amount)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e8f0', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, color: '#334155' }}>
          {isEn ? `Net Cash Flows from ${section.titleEn || title}` : `${t('accounting.cash_flow_statement_page.s32', 'صافي التدفقات من')} ${title}`}
        </span>
        <strong style={{ fontSize: '1.1rem', color: section.total >= 0 ? '#166534' : '#991b1b' }}>
          {formatCurrency(section.total)}
        </strong>
      </div>
    </Card>
  );
}
