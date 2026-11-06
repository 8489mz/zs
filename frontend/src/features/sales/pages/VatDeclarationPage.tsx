import { useTranslation } from 'react-i18next';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { PageHeader } from '@/shared/components/page-header';
import { StatsGrid } from '@/shared/components/stats-grid';
import { formatCurrency } from '@/lib/format';
import { ApiError } from '@/lib/http';
import { vatDeclarationApi, type VatDeclarationData } from '@/features/sales/api/vat-declaration.api';
import { PrinterIcon } from '@/shared/components/icons/AppIcons';
import { VatPeriodSelector, type PeriodPreset } from '../components/vat-declaration/VatPeriodSelector';
import { VatSalesTable } from '../components/vat-declaration/VatSalesTable';
import { VatPurchasesTable } from '../components/vat-declaration/VatPurchasesTable';
import { VatSummaryBox } from '../components/vat-declaration/VatSummaryBox';

// INV-VAT-DECLARATION-HEADER-ERROR: a failed declaration query must surface
// the server's real error (message + status + code) in the header instead of
// silently showing "-" and empty dates. The 409
// VAT_DECLARATION_TAX_ID_MISSING (no registered tax number) is the common
// case: the server message already says so in Arabic.
function declarationErrorInfo(error: unknown): { message: string; status?: number; code?: string } | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    return { message: error.message, status: error.status, code: error.code };
  }
  if (error instanceof Error) return { message: error.message };
  if (typeof error === 'string' && error.trim()) return { message: error.trim() };
  return null;
}

export function VatDeclarationPage() {
  const { t } = useTranslation();
  const [country, setCountry] = useState<'EG' | 'SA'>('EG');
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('current_month');
  const [customFrom, setCustomFrom] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]);
  const [customTo, setCustomTo] = useState(new Date().toISOString().split('T')[0]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const dateRange = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();

    if (periodPreset === 'current_month') {
      const from = new Date(year, now.getMonth(), 1).toISOString().split('T')[0];
      const to = new Date(year, now.getMonth() + 1, 0).toISOString().split('T')[0];
      return { from, to };
    }
    if (periodPreset === 'last_month') {
      const from = new Date(year, now.getMonth() - 1, 1).toISOString().split('T')[0];
      const to = new Date(year, now.getMonth(), 0).toISOString().split('T')[0];
      return { from, to };
    }
    if (periodPreset === 'q1') {
      return { from: `${year}-01-01`, to: `${year}-03-31` };
    }
    if (periodPreset === 'q2') {
      return { from: `${year}-04-01`, to: `${year}-06-30` };
    }
    if (periodPreset === 'q3') {
      return { from: `${year}-07-01`, to: `${year}-09-30` };
    }
    if (periodPreset === 'q4') {
      return { from: `${year}-10-01`, to: `${year}-12-31` };
    }
    return { from: customFrom, to: customTo };
  }, [periodPreset, customFrom, customTo]);

  const declarationQuery = useQuery({
    queryKey: ['vat-declaration', country, dateRange.from, dateRange.to],
    queryFn: () =>
      vatDeclarationApi.getDeclaration({
        country,
        from: dateRange.from,
        to: dateRange.to,
      }),
  });

  const data: VatDeclarationData | undefined = declarationQuery.data;

  // The period is the selector's requested range, not server data: it must
  // always display, even when the query fails and there is no `data.period`.
  const periodFrom = data?.period.from ?? dateRange.from;
  const periodTo = data?.period.to ?? dateRange.to;
  const declarationError = declarationQuery.isError
    ? declarationErrorInfo(declarationQuery.error)
    : null;

  const copyToClipboard = (text: string | number, key: string) => {
    navigator.clipboard.writeText(String(text));
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const copyAllSummary = () => {
    if (!data) return;
    const summaryText = `--- إقرار ضريبة القيمة المضافة (${country === 'EG' ? 'مصر نموذج 10' : 'السعودية ZATCA'}) ---
الفترة: من ${data.period.from} إلى ${data.period.to}
المنشأة: ${data.entity.business_name} | الرقم الضريبي: ${data.entity.tax_id}
إجمالي وعاء المبيعات: ${data.output_tax.total_sales_base}
ضريبة المخرجات: ${data.output_tax.total_output_vat}
إجمالي وعاء المشتريات: ${data.input_tax.total_purchases_base}
ضريبة المدخلات المخصومة: ${data.input_tax.total_input_vat}
صافي الضريبة واجبة السداد: ${data.summary.net_vat_due} (${data.summary.status === 'payable' ? 'سداد' : 'استرداد'})
`;
    navigator.clipboard.writeText(summaryText);
    setCopiedKey('all_summary');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const stats = [
    { key: 'sales', label: 'وعاء المبيعات الصافي', value: formatCurrency(data?.output_tax.total_sales_base || 0) },
    { key: 'output', label: 'ضريبة المخرجات المحصلة', value: formatCurrency(data?.output_tax.total_output_vat || 0) },
    { key: 'input', label: 'ضريبة المدخلات المخصومة', value: formatCurrency(data?.input_tax.total_input_vat || 0) },
    {
      key: 'net',
      label: data?.summary.status === 'payable' ? 'صافي الضريبة واجبة السداد' : 'رصيد دائن مرحل',
      value: formatCurrency(Math.abs(data?.summary.net_vat_due || 0)),
    },
  ] as const;

  return (
    <div className="page-stack page-shell vat-declaration-workspace" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '32px' }}>
        <PageHeader
          title={t('sales.vat_declaration_page.s0', "الإقرار الضريبي الرسمي (VAT Declaration)")}
          description={t('sales.vat_declaration_page.s1', "توليد واحتساب أوعية وضريبة القيمة المضافة مطابقة لـ نموذج 10 المصري وهيئة الزكاة والضريبة والجمارك ZATCA.")}
          badge={<span className="nav-pill">{country === 'EG' ? t('sales.vat_declaration_page.s2', "مصر نموذج 10") : t('sales.vat_declaration_page.s3', "السعودية ZATCA")}</span>}
          actions={
            <div className="actions compact-actions">
              <Button
                variant="secondary"
                onClick={copyAllSummary}
              >
                {copiedKey === 'all_summary' ? t('sales.vat_declaration_page.s4', "تم نسخ الملخص") : t('sales.vat_declaration_page.s5', "نسخ الأرقام للتقديم")}
              </Button>
              <Button
                variant="primary"
                onClick={() => window.print()}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <PrinterIcon size={16} color="#ffffff" />
                <span>{t('sales.vat_declaration_page.s6', "طباعة الإقرار (A4)")}</span>
              </Button>
            </div>
          }
        />

        <StatsGrid items={stats} />

        <VatPeriodSelector
          country={country}
          setCountry={setCountry}
          periodPreset={periodPreset}
          setPeriodPreset={setPeriodPreset}
          customFrom={customFrom}
          setCustomFrom={setCustomFrom}
          customTo={customTo}
          setCustomTo={setCustomTo}
        />

        {/* Printable Section */}
        <div
          id="official-vat-declaration-print"
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '24px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          }}
        >
          {/* Official Header */}
          <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: '16px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#0f172a' }}>
                  {country === 'EG'
                    ? t('sales.vat_declaration_page.s7', "جمهورية مصر العربية - مصلحة الضرائب المصرية")
                    : t('sales.vat_declaration_page.s8', "المملكة العربية السعودية - هيئة الزكاة والضريبة والجمارك (ZATCA)")}
                </div>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#475569', marginTop: '2px' }}>
                  {country === 'EG'
                    ? t('sales.vat_declaration_page.s9', "إقرار ضريبة القيمة المضافة (نموذج رقم 10 ض.ق.م)")
                    : t('sales.vat_declaration_page.s10', "إقرار ضريبة القيمة المضافة الدوري")}
                </div>
              </div>
              <div style={{ textAlign: 'left', fontSize: '13px', color: '#475569', lineHeight: '1.6' }}>
                <div><strong>{t('sales.vat_declaration_page.s11', "المنشأة:")}</strong> {data?.entity.business_name || '-'}</div>
                <div><strong>{t('sales.vat_declaration_page.s12', "الرقم الضريبي:")}</strong> <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{data?.entity.tax_id || '-'}</span></div>
                <div><strong>{t('sales.vat_declaration_page.s13', "الفترة الضريبية:")}</strong> {t('sales.vat_declaration_page.s14', "من")} {periodFrom} {t('sales.vat_declaration_page.s15', "إلى")} {periodTo}</div>
                {declarationError && (
                  <div
                    role="alert"
                    style={{
                      marginTop: '8px',
                      backgroundColor: '#fef2f2',
                      border: '1px solid #fecaca',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      fontSize: '12px',
                      color: '#991b1b',
                      lineHeight: 1.6,
                      textAlign: 'right',
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>{t('sales.vat_declaration_page.s16', "تعذر إصدار الإقرار:")}</div>
                    <div>{declarationError.message}</div>
                    {(declarationError.code || declarationError.status != null) && (
                      <div style={{ fontFamily: 'monospace', fontSize: '11px', direction: 'ltr', textAlign: 'left' }}>
                        {declarationError.code}
                        {declarationError.code && declarationError.status != null ? ' · ' : ''}
                        {declarationError.status != null ? String(declarationError.status) : ''}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <VatSalesTable
            data={data}
            country={country}
            copiedKey={copiedKey}
            onCopy={copyToClipboard}
          />

          <VatPurchasesTable
            data={data}
            country={country}
            copiedKey={copiedKey}
            onCopy={copyToClipboard}
          />

          <VatSummaryBox
            data={data}
            country={country}
            copiedKey={copiedKey}
            onCopy={copyToClipboard}
          />
        </div>
      </main>
    </div>
  );
}
