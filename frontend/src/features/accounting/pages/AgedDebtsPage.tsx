import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/shared/components/page-header';
import { Card } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { formatCurrency, todayLocalDateKey } from '@/lib/format';
import { DownloadIcon, PrinterIcon, SearchIcon, ClockIcon } from '@/shared/components/icons/AppIcons';
import {
  financialReportsApi,
  type AgedDebtsSummary,
  type AgedPartnerRow,
} from '@/features/accounting/api/accounting.api';

export function AgedDebtsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'receivables' | 'payables'>('receivables');
  const [asOfDate, setAsOfDate] = useState(() => todayLocalDateKey());
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<'all' | 'critical' | 'high' | 'medium' | 'low' | 'current'>('all');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const receivablesQuery = useQuery({
    queryKey: ['aged-receivables', asOfDate, page, debouncedSearch, riskFilter],
    queryFn: () => financialReportsApi.agedReceivables({ asOfDate, page, search: debouncedSearch, risk: riskFilter }),
    enabled: activeTab === 'receivables',
  });

  const payablesQuery = useQuery({
    queryKey: ['aged-payables', asOfDate, page, debouncedSearch, riskFilter],
    queryFn: () => financialReportsApi.agedPayables({ asOfDate, page, search: debouncedSearch, risk: riskFilter }),
    enabled: activeTab === 'payables',
  });

  const activeQuery = activeTab === 'receivables' ? receivablesQuery : payablesQuery;
  const data: AgedDebtsSummary | undefined = activeQuery.data;

  const filteredPartners = data?.partners || [];

  const handleExportCsv = () => {
    if (!data) return;
    const isRec = activeTab === 'receivables';
    const lines: string[] = [
      `الاسم,الهاتف,إجمالي الرصيد,حالي (غير مستحق),1-30 يوم,31-60 يوم,61-90 يوم,+90 يوم (حرج),أقدم حركة,أيام التأخير,مستوى المخاطرة`,
    ];

    for (const p of filteredPartners) {
      lines.push(
        `"${p.partnerName}","${p.phone || ''}",${p.totalBalance},${p.currentAmount},${p.days1To30},${p.days31To60},${p.days61To90},${p.days91Plus},"${p.oldestInvoiceDate || ''}",${p.oldestInvoiceDays || 0},"${p.riskLevel}"`,
      );
    }

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(lines.join('\n'));
    const link = document.createElement('a');
    link.setAttribute('href', csvContent);
    link.setAttribute('download', `aged-${isRec ? 'receivables' : 'payables'}-${asOfDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getRiskBadge = (level: AgedPartnerRow['riskLevel']) => {
    switch (level) {
      case 'critical':
        return <span style={{ backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700 }}>{t('accounting.aged_debts_page.s0', "حرج (+90)")}</span>;
      case 'high':
        return <span style={{ backgroundColor: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa', padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700 }}>{t('accounting.aged_debts_page.s1', "عالي (61-90)")}</span>;
      case 'medium':
        return <span style={{ backgroundColor: '#fefce8', color: '#854d0e', border: '1px solid #fef08a', padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700 }}>{t('accounting.aged_debts_page.s2', "متوسط (31-60)")}</span>;
      case 'low':
        return <span style={{ backgroundColor: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700 }}>{t('accounting.aged_debts_page.s3', "منخفض (1-30)")}</span>;
      default:
        return <span style={{ backgroundColor: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600 }}>{t('accounting.aged_debts_page.s4', "حالي (ساري)")}</span>;
    }
  };

  return (
    <div className="page-stack page-shell aged-debts-workspace" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '32px' }}>
        <PageHeader
          title={t('accounting.aged_debts_page.s5', "تقرير أعمار الديون التحليلي")}
          description={t('accounting.aged_debts_page.s6', "Aged Partner Balances — تحليل فترات الاستحقاق والتأخير للعملاء والموردين لتعزيز التدفقات والتحصيل.")}
          badge={
            data ? (
              <span className="nav-pill">
                {data.totalPartnersCount} {activeTab === 'receivables' ? t('accounting.aged_debts_page.s7', "عميل") : t('accounting.aged_debts_page.s8', "مورد")}
              </span>
            ) : null
          }
          actions={
            <div className="actions compact-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <a
                href="/accounting/collections"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 12px',
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  borderRadius: '8px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                <ClockIcon size={14} color="#ffffff" />
                <span>{t('accounting.aged_debts_page.s9', "مركز تصعيد التحصيلات (Dunning Hub)")}</span>
              </a>
              <Button type="button" variant="secondary" onClick={handleExportCsv} disabled={!data || data.filteredPartnersCount > data.partners.length}>
                <DownloadIcon size={14} style={{ marginInlineEnd: '6px' }} />
                {t('accounting.aged_debts_page.s10', "تصدير CSV")}
              </Button>
              <Button type="button" variant="secondary" onClick={() => window.print()} disabled={!data || data.filteredPartnersCount > data.partners.length}>
                <PrinterIcon size={14} style={{ marginInlineEnd: '6px' }} />
                {t('accounting.aged_debts_page.s11', "طباعة")}
              </Button>
            </div>
          }
        />

        {/* Main Tabs */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button
            type="button"
            variant={activeTab === 'receivables' ? 'primary' : 'secondary'}
            onClick={() => { setPage(1); setActiveTab('receivables'); }}
          >
            {t('accounting.aged_debts_page.s12', "أعمار ديون العملاء (المدينون - Receivables)")}
          </Button>

          <Button
            type="button"
            variant={activeTab === 'payables' ? 'primary' : 'secondary'}
            onClick={() => { setPage(1); setActiveTab('payables'); }}
          >
            {t('accounting.aged_debts_page.s13', "أعمار ديون الموردين (الدائنون - Payables)")}
          </Button>
        </div>

      {/* Filter and Search Bar */}
      <Card style={{ padding: '16px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', marginBottom: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', alignItems: 'flex-end' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
              {t('accounting.aged_debts_page.s14', "احتساب الأعمار حتى تاريخ")}
            </label>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => { setPage(1); setAsOfDate(e.target.value); }}
              style={{ width: '100%', height: '36px', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0 10px', fontSize: '0.875rem' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
              {t('accounting.aged_debts_page.s15', "البحث بالاسم أو رقم الهاتف")}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder={t('accounting.aged_debts_page.s16', "ابحث...")}
                value={search}
                onChange={(e) => { setPage(1); setSearch(e.target.value); }}
                style={{ width: '100%', height: '36px', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0 32px 0 10px', fontSize: '0.875rem' }}
              />
              <span style={{ position: 'absolute', right: '10px', top: '10px', color: '#94a3b8' }}>
                <SearchIcon size={16} />
              </span>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
              {t('accounting.aged_debts_page.s17', "تصفية حسب شريحة المخاطرة")}
            </label>
            <select
              value={riskFilter}
              onChange={(e) => { setPage(1); setRiskFilter(e.target.value as typeof riskFilter); }}
              style={{ width: '100%', height: '36px', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0 10px', fontSize: '0.875rem' }}
            >
              <option value="all">{t('accounting.aged_debts_page.s18', "كافة الشرائح")}</option>
              <option value="critical">{t('accounting.aged_debts_page.s19', "الحرجة فقط (+90 يوم)")}</option>
              <option value="high">{t('accounting.aged_debts_page.s20', "عالية التأخير (61-90 يوم)")}</option>
              <option value="medium">{t('accounting.aged_debts_page.s21', "متوسطة التأخير (31-60 يوم)")}</option>
              <option value="low">{t('accounting.aged_debts_page.s22', "منخفضة (1-30 يوم)")}</option>
              <option value="current">{t('accounting.aged_debts_page.s23', "الحالية (غير متأخرة)")}</option>
            </select>
          </div>

          <div>
            <Button
              type="button"
              variant="primary"
              onClick={() => void activeQuery.refetch()}
              style={{ height: '36px', width: '100%', backgroundColor: '#170e5e', color: '#fff', fontWeight: 700 }}
            >
              {t('accounting.aged_debts_page.s24', "تحديث البيانات")}
            </Button>
          </div>
        </div>
      </Card>

      {/* Loading & Error feedback */}
      {activeQuery.isLoading && (
        <Card style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
          {t('accounting.aged_debts_page.s25', "جاري احتساب أعمار الديون وتقسيم الشرائح الزمنية...")}
        </Card>
      )}

      {data && (
        <>
          {/* 6 Aging Bucket Highlight Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <Card style={{ padding: '14px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>{t('accounting.aged_debts_page.s26', "إجمالي المديونيات")}</span>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                {formatCurrency(data.totalBalance)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
                {t('accounting.aged_debts_page.s27', "عدد:")} {data.totalPartnersCount} {activeTab === 'receivables' ? t('accounting.aged_debts_page.s28', "عميل") : t('accounting.aged_debts_page.s29', "مورد")}
              </div>
            </Card>

            <Card style={{ padding: '14px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#166534' }}>{t('accounting.aged_debts_page.s30', "حالي (ساري / غير متأخر)")}</span>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#16a34a', marginTop: '4px' }}>
                {formatCurrency(data.totalCurrent)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
                {data.totalBalance > 0 ? `${((data.totalCurrent / data.totalBalance) * 100).toFixed(1)}%` : '0%'}
              </div>
            </Card>

            <Card style={{ padding: '14px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0369a1' }}>{t('accounting.aged_debts_page.s31', "1 - 30 يوماً")}</span>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0284c7', marginTop: '4px' }}>
                {formatCurrency(data.total1To30)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
                {data.totalBalance > 0 ? `${((data.total1To30 / data.totalBalance) * 100).toFixed(1)}%` : '0%'}
              </div>
            </Card>

            <Card style={{ padding: '14px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#854d0e' }}>{t('accounting.aged_debts_page.s32', "31 - 60 يوماً")}</span>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#ca8a04', marginTop: '4px' }}>
                {formatCurrency(data.total31To60)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
                {data.totalBalance > 0 ? `${((data.total31To60 / data.totalBalance) * 100).toFixed(1)}%` : '0%'}
              </div>
            </Card>

            <Card style={{ padding: '14px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#c2410c' }}>{t('accounting.aged_debts_page.s33', "61 - 90 يوماً")}</span>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#ea580c', marginTop: '4px' }}>
                {formatCurrency(data.total61To90)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
                {data.totalBalance > 0 ? `${((data.total61To90 / data.totalBalance) * 100).toFixed(1)}%` : '0%'}
              </div>
            </Card>

            <Card style={{ padding: '14px', backgroundColor: '#fff5f5', border: '1px solid #fecaca', borderRadius: '12px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#991b1b' }}>{t('accounting.aged_debts_page.s34', "+90 يوماً (حرجة / متعثرة)")}</span>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#dc2626', marginTop: '4px' }}>
                {formatCurrency(data.total91Plus)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#991b1b', marginTop: '4px' }}>
                {data.totalBalance > 0 ? `${((data.total91Plus / data.totalBalance) * 100).toFixed(1)}%` : '0%'}
              </div>
            </Card>
          </div>

          {/* Detailed Table */}
          <Card style={{ padding: '0', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', overflowX: 'auto' }}>
            {filteredPartners.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
                {t('accounting.aged_debts_page.s35', "لا توجد مديونيات مطابقة لمعايير البحث الحالية")}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>
                    <th style={{ padding: '12px 14px' }}>{activeTab === 'receivables' ? t('accounting.aged_debts_page.s36', "اسم العميل") : t('accounting.aged_debts_page.s37', "اسم المورد")}</th>
                    <th style={{ padding: '12px 10px', textAlign: 'left' }}>{t('accounting.aged_debts_page.s38', "إجمالي الرصيد")}</th>
                    <th style={{ padding: '12px 10px', textAlign: 'left' }}>{t('accounting.aged_debts_page.s39', "حالي")}</th>
                    <th style={{ padding: '12px 10px', textAlign: 'left' }}>{t('accounting.aged_debts_page.s40', "1-30 يوم")}</th>
                    <th style={{ padding: '12px 10px', textAlign: 'left' }}>{t('accounting.aged_debts_page.s41', "31-60 يوم")}</th>
                    <th style={{ padding: '12px 10px', textAlign: 'left' }}>{t('accounting.aged_debts_page.s42', "61-90 يوم")}</th>
                    <th style={{ padding: '12px 10px', textAlign: 'left', color: '#dc2626' }}>{t('accounting.aged_debts_page.s43', "+90 يوم")}</th>
                    <th style={{ padding: '12px 10px', textAlign: 'center' }}>{t('accounting.aged_debts_page.s44', "أقدم حركة")}</th>
                    <th style={{ padding: '12px 10px', textAlign: 'center' }}>{t('accounting.aged_debts_page.s45', "مستوى المخاطرة")}</th>
                    <th style={{ padding: '12px 14px', textAlign: 'center' }}>{t('accounting.aged_debts_page.s46', "إجراءات التحصيل")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPartners.map((row) => (
                    <tr
                      key={row.partnerId}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        backgroundColor: row.riskLevel === 'critical' ? '#fffdfd' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '12px 14px' }}>
                        <strong style={{ display: 'block', color: '#0f172a' }}>{row.partnerName}</strong>
                        {row.phone && <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{row.phone}</span>}
                      </td>
                      <td style={{ padding: '12px 10px', textAlign: 'left', fontWeight: 800, color: '#0f172a' }}>
                        {formatCurrency(row.totalBalance)}
                      </td>
                      <td style={{ padding: '12px 10px', textAlign: 'left', color: row.currentAmount > 0 ? '#16a34a' : '#94a3b8' }}>
                        {formatCurrency(row.currentAmount)}
                      </td>
                      <td style={{ padding: '12px 10px', textAlign: 'left', color: row.days1To30 > 0 ? '#0284c7' : '#94a3b8' }}>
                        {formatCurrency(row.days1To30)}
                      </td>
                      <td style={{ padding: '12px 10px', textAlign: 'left', color: row.days31To60 > 0 ? '#ca8a04' : '#94a3b8' }}>
                        {formatCurrency(row.days31To60)}
                      </td>
                      <td style={{ padding: '12px 10px', textAlign: 'left', color: row.days61To90 > 0 ? '#ea580c' : '#94a3b8' }}>
                        {formatCurrency(row.days61To90)}
                      </td>
                      <td style={{ padding: '12px 10px', textAlign: 'left', fontWeight: row.days91Plus > 0 ? 800 : 400, color: row.days91Plus > 0 ? '#dc2626' : '#94a3b8' }}>
                        {formatCurrency(row.days91Plus)}
                      </td>
                      <td style={{ padding: '12px 10px', textAlign: 'center', fontSize: '0.78rem', color: '#64748b' }}>
                        {row.oldestInvoiceDate ? (
                          <>
                            <div>{row.oldestInvoiceDate}</div>
                            <span style={{ color: (row.oldestInvoiceDays || 0) > 60 ? '#dc2626' : '#475569' }}>
                              ({row.oldestInvoiceDays} {t('accounting.aged_debts_page.s47', "يوم)")}
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                        {getRiskBadge(row.riskLevel)}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        {activeTab === 'receivables' && row.whatsAppUrl ? (
                          <a
                            href={row.whatsAppUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: '0.78rem',
                              fontWeight: 700,
                              textDecoration: 'none',
                              backgroundColor: '#25D366',
                              color: '#ffffff',
                            }}
                          >
                            {t('accounting.aged_debts_page.s48', "تذكير واتساب")}
                          </a>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          {data && data.filteredPartnersCount > data.pageSize && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', marginTop: 16 }}>
              <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>{t('accounting.aged_debts_page.s49', "السابق")}</Button>
              <span>{t('accounting.aged_debts_page.s50', "صفحة")} {page} {t('accounting.aged_debts_page.s51', "من")} {Math.ceil(data.filteredPartnersCount / data.pageSize)}</span>
              <Button type="button" variant="secondary" disabled={page * data.pageSize >= data.filteredPartnersCount} onClick={() => setPage((current) => current + 1)}>{t('accounting.aged_debts_page.s52', "التالي")}</Button>
            </div>
          )}
        </>
      )}
      </main>
    </div>
  );
}
