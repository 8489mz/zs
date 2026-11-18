import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { formatCurrencyWithSymbol, todayLocalDateKey } from '@/lib/format';
import {
  PlusIcon,
  RefreshCwIcon,
  DownloadIcon,
  PrinterIcon,
} from '@/shared/components/icons/AppIcons';
import {
  withholdingTaxApi,
  type WithholdingTaxRecord,
  type Form41SummaryResponse,
  type CreateWhtTransactionPayload,
} from '@/features/accounting/api/accounting.api';
import { PageHeader } from '@/shared/components/page-header';
import { StatsGrid } from '@/shared/components/stats-grid';
import { useAppToolbar } from '@/stores/toolbar-store';
import { QUARTERS, WHT_TYPE_LABELS } from '../components/withholding-tax/types';
import { WithholdingTaxTable } from '../components/withholding-tax/WithholdingTaxTable';
import { CreateWhtModal } from '../components/withholding-tax/CreateWhtModal';
import { ExtractWhtModal } from '../components/withholding-tax/ExtractWhtModal';
import { PrintWhtModal } from '../components/withholding-tax/PrintWhtModal';

export function WithholdingTaxPage() {
  const { t: __t } = useTranslation();
  useAppToolbar([{ label: 'المالية والمحاسبة', to: '/accounting' }, { label: 'الخصم والإضافة ن41' }]);
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const initialQ = currentMonth <= 3 ? 'Q1' : currentMonth <= 6 ? 'Q2' : currentMonth <= 9 ? 'Q3' : 'Q4';

  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedQuarter, setSelectedQuarter] = useState<string>(initialQ);
  const [selectedDirection, setSelectedDirection] = useState<'payable' | 'receivable'>('payable');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showExtractModal, setShowExtractModal] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);

  // Form State
  const [newTx, setNewTx] = useState<CreateWhtTransactionPayload>({
    direction: 'payable',
    invoice_number: '',
    invoice_date: todayLocalDateKey(),
    partner_name: '',
    tax_id_number: '',
    file_number: '',
    tax_office_code: '',
    partner_address: '',
    wht_type: 'goods',
    wht_rate: 1,
    base_amount: 0,
    notes: '',
  });

  // Extract Form State
  const [extractDates, setExtractDates] = useState<{
    fromDate: string;
    toDate: string;
    defaultWhtType: 'goods' | 'services' | 'professional';
    defaultWhtRate: number;
  }>({
    fromDate: `${currentYear}-01-01`,
    toDate: todayLocalDateKey(),
    defaultWhtType: 'goods',
    defaultWhtRate: 1,
  });

  // Query
  const reportQuery = useQuery({
    queryKey: ['wht-form41', selectedYear, selectedQuarter, selectedDirection],
    queryFn: () =>
      withholdingTaxApi.getForm41({
        year: selectedYear,
        quarter: selectedQuarter,
        direction: selectedDirection,
      }),
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (payload: CreateWhtTransactionPayload) => withholdingTaxApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wht-form41'] });
      setShowCreateModal(false);
      resetNewTxForm();
    },
  });

  const extractMutation = useMutation({
    mutationFn: () => withholdingTaxApi.extractFromPurchases(extractDates),
    onSuccess: (data) => {
      alert(data.message);
      queryClient.invalidateQueries({ queryKey: ['wht-form41'] });
      setShowExtractModal(false);
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'draft' | 'declared' | 'paid' }) =>
      withholdingTaxApi.updateStatus(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wht-form41'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => withholdingTaxApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wht-form41'] });
    },
  });

  const resetNewTxForm = () => {
    setNewTx({
      direction: selectedDirection,
      invoice_number: '',
      invoice_date: todayLocalDateKey(),
      partner_name: '',
      tax_id_number: '',
      file_number: '',
      tax_office_code: '',
      partner_address: '',
      wht_type: 'goods',
      wht_rate: 1,
      base_amount: 0,
      notes: '',
    });
  };

  const reportData: Form41SummaryResponse | undefined = reportQuery.data;
  const rawList: WithholdingTaxRecord[] = reportData?.transactions || [];

  const filteredTransactions = rawList.filter((t) => {
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const matchPartner = t.partner_name.toLowerCase().includes(q);
      const matchInvoice = t.invoice_number.toLowerCase().includes(q);
      const matchTaxId = t.tax_id_number ? t.tax_id_number.includes(q) : false;
      if (!matchPartner && !matchInvoice && !matchTaxId) return false;
    }
    if (statusFilter !== 'all' && t.status !== statusFilter) {
      return false;
    }
    return true;
  });

  // Export to Egyptian Tax Authority (ETA) Form 41 Standard CSV
  const handleExportEtaCsv = () => {
    if (filteredTransactions.length === 0) return;
    const headers = [
      'مسلسل',
      'اسم الممول / المورد',
      'الرقم الضريبي (9 أرقام)',
      'رقم الملف الضريبي',
      'المأمورية الضريبية',
      'عنوان الممول',
      'رقم الفاتورة',
      'تاريخ الفاتورة',
      'نوع التعامل',
      'نسبة الخصم (%)',
      'القيمة الإجمالية للتعامل (قبل الضريبة)',
      'قيمة الضريبة المخصومة المحصلة',
      'الحالة',
      'ملاحظات',
    ];
    const rows = filteredTransactions.map((t, idx) => [
      idx + 1,
      `"${t.partner_name}"`,
      `"${t.tax_id_number || ''}"`,
      `"${t.file_number || ''}"`,
      `"${t.tax_office_code || ''}"`,
      `"${t.partner_address || ''}"`,
      `"${t.invoice_number}"`,
      t.invoice_date,
      WHT_TYPE_LABELS[t.wht_type]?.label || t.wht_type,
      t.wht_rate,
      t.base_amount,
      t.tax_amount,
      t.status === 'paid' ? 'تم التوريد' : t.status === 'declared' ? 'مقدم بالإقرار' : 'مسودة',
      `"${t.notes || ''}"`,
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ETA_Form41_${selectedYear}_${selectedQuarter}_${selectedDirection}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-stack page-shell withholding-tax-page" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '100px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        <PageHeader
          title={__t('accounting.withholding_tax_page.s0', "ضريبة الخصم والإضافة ونموذج 41 ضرائب")}
          description={__t('accounting.withholding_tax_page.s1', "إعداد واستخراج إقرار نموذج 41 الربع سنوي المعتمد لمصلحة الضرائب المصرية (ETA) وتصدير شيت البوابة الرسمية.")}
          badge={<span className="nav-pill">{reportData?.total_count || 0} {__t('accounting.withholding_tax_page.s2', "معاملة")}</span>}
          actions={(
            <div className="actions compact-actions page-header-actions">
              <Button
                onClick={() => {
                  resetNewTxForm();
                  setShowCreateModal(true);
                }}
                className="btn btn-primary"
                style={{ backgroundColor: '#170e5e', color: '#ffffff', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <PlusIcon size={15} />
                <span>{__t('accounting.withholding_tax_page.s3', "+ إضافة معاملة")}</span>
              </Button>

              {selectedDirection === 'payable' && (
                <Button
                  onClick={() => setShowExtractModal(true)}
                  variant="secondary"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#065f46', borderColor: '#a7f3d0' }}
                >
                  <RefreshCwIcon size={15} />
                  <span>{__t('accounting.withholding_tax_page.s4', "استيراد آلي من المشتريات")}</span>
                </Button>
              )}

              <Button
                onClick={handleExportEtaCsv}
                variant="secondary"
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                title={__t('accounting.withholding_tax_page.s5', "تصدير شيت البوابة الإلكترونية لمصلحة الضرائب")}
              >
                <DownloadIcon size={14} />
                <span>{__t('accounting.withholding_tax_page.s6', "تصدير CSV")}</span>
              </Button>

              <Button
                onClick={() => setShowPrintModal(true)}
                variant="secondary"
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <PrinterIcon size={14} />
                <span>{__t('accounting.withholding_tax_page.s7', "طباعة A4")}</span>
              </Button>

              <Button
                onClick={() => queryClient.invalidateQueries({ queryKey: ['wht-form41'] })}
                variant="secondary"
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                title={__t('accounting.withholding_tax_page.s8', "تحديث البيانات")}
              >
                <RefreshCwIcon size={14} />
                <span>{__t('accounting.withholding_tax_page.s9', "تحديث")}</span>
              </Button>
            </div>
          )}
        />

        {/* Period Selector & Direction Switcher */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
            {/* Direction Tabs */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#f1f5f9', padding: '4px', borderRadius: '10px' }}>
              <button
                type="button"
                onClick={() => setSelectedDirection('payable')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: selectedDirection === 'payable' ? '#ffffff' : 'transparent',
                  color: selectedDirection === 'payable' ? '#170e5e' : '#64748b',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: selectedDirection === 'payable' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                {__t('accounting.withholding_tax_page.s10', "نموذج 41 (خصم من الموردين لتوريده للضرائب)")}
              </button>
              <button
                type="button"
                onClick={() => setSelectedDirection('receivable')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: selectedDirection === 'receivable' ? '#ffffff' : 'transparent',
                  color: selectedDirection === 'receivable' ? '#170e5e' : '#64748b',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: selectedDirection === 'receivable' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                {__t('accounting.withholding_tax_page.s11', "إشعارات الخصم من العملاء (مبالغ مستردة للشركة)")}
              </button>
            </div>

            {/* Quarter & Year Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>{__t('accounting.withholding_tax_page.s12', "السنة الضريبية:")}</span>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  style={{ padding: '6px 12px', backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '12px', fontWeight: 700, color: '#0f172a', outline: 'none' }}
                >
                  {[currentYear + 1, currentYear, currentYear - 1, currentYear - 2].map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: '#f8fafc', padding: '4px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                {QUARTERS.map((q) => {
                  const isActive = selectedQuarter === q.id;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => setSelectedQuarter(q.id)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        border: 'none',
                        backgroundColor: isActive ? '#170e5e' : 'transparent',
                        color: isActive ? '#ffffff' : '#64748b',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      title={q.period}
                    >
                      {q.id}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div style={{ marginBottom: '16px' }}>
          <StatsGrid
            items={[
              {
                key: 'tax',
                label: selectedDirection === 'payable' ? __t('accounting.withholding_tax_page.s13', "إجمالي الضريبة واجبة التوريد") : __t('accounting.withholding_tax_page.s14', "إجمالي مبالغ الخصم المستردة"),
                value: formatCurrencyWithSymbol(reportData?.total_tax_amount || 0),
              },
              {
                key: 'goods',
                label: __t('accounting.withholding_tax_page.s15', "وعاء توريدات السلع (1%)"),
                value: formatCurrencyWithSymbol(reportData?.breakdown.goods.base_amount || 0),
              },
              {
                key: 'services',
                label: __t('accounting.withholding_tax_page.s16', "وعاء الخدمات والمصنعيات (3%)"),
                value: formatCurrencyWithSymbol(reportData?.breakdown.services.base_amount || 0),
              },
              {
                key: 'prof',
                label: __t('accounting.withholding_tax_page.s17', "وعاء المهن الحرة والعمولات (5%)"),
                value: formatCurrencyWithSymbol(reportData?.breakdown.professional.base_amount || 0),
              },
            ]}
          />
        </div>

        {/* Main Workspace Panel & Table */}
        <WithholdingTaxTable
          transactions={filteredTransactions}
          isLoading={reportQuery.isLoading}
          selectedQuarter={selectedQuarter}
          selectedYear={selectedYear}
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          onUpdateStatus={(id, status) => updateStatusMutation.mutate({ id, status })}
          onDelete={(id, invoiceNo) => {
            if (confirm(`هل أنت متأكد من حذف معاملة الفاتورة ${invoiceNo}؟`)) {
              deleteMutation.mutate(id);
            }
          }}
        />
      </main>

      {/* Modals */}
      <CreateWhtModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        newTx={newTx}
        onChange={setNewTx}
        onSubmit={() => createMutation.mutate(newTx)}
        isPending={createMutation.isPending}
      />

      <ExtractWhtModal
        isOpen={showExtractModal}
        onClose={() => setShowExtractModal(false)}
        extractDates={extractDates}
        onChange={setExtractDates}
        onSubmit={() => extractMutation.mutate()}
        isPending={extractMutation.isPending}
      />

      <PrintWhtModal
        isOpen={showPrintModal}
        onClose={() => setShowPrintModal(false)}
        selectedQuarter={selectedQuarter}
        selectedYear={selectedYear}
        reportData={reportData}
        filteredTransactions={filteredTransactions}
      />
    </div>
  );
}
