import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DataTable } from '@/shared/components/data-table';
import { PageHeader } from '@/shared/components/page-header';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { Button } from '@/shared/ui/button';
import { FormSection } from '@/shared/components/form-section';
import { formatCurrency, formatTenantDateKey } from '@/lib/format';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { accountingApi, type JournalEntryDetail, type JournalEntryLine, type JournalEntryListItem } from '@/features/accounting/api/accounting.api';
import { ManualJournalEntryDialog } from '../components/ManualJournalEntryDialog';
import { PlusIcon } from '@/shared/components/icons/AppIcons';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { translateUiText } from '@/lib/auto-translator';

function mapStatusLabel(status: string, isEn?: boolean) {
  if (isEn) {
    if (status === 'posted') return 'Posted';
    if (status === 'draft') return 'Draft';
    if (status === 'cancelled') return 'Cancelled';
    return status || '';
  }
  if (status === 'posted') return 'مرحّل';
  if (status === 'draft') return 'مسودة';
  if (status === 'cancelled') return 'ملغي';
  return status || '';
}

function mapSourceLabel(sourceType: string, isEn?: boolean) {
  if (isEn) {
    if (sourceType === 'sale') return 'Sale';
    if (sourceType === 'sale_edit') return 'Sale Edit';
    if (sourceType === 'sale_edit_reversal') return 'Sale Edit Reversal';
    if (sourceType === 'sale_cancel' || sourceType === 'sale_reversal') return 'Sale Reversal / Cancellation';
    if (sourceType === 'sales_return') return 'Sales Return';
    if (sourceType === 'return') return 'Return';
    if (sourceType === 'purchase') return 'Purchase';
    if (sourceType === 'purchase_cancel' || sourceType === 'purchase_reversal') return 'Purchase Reversal / Cancellation';
    if (sourceType === 'supplier_payment' || sourceType === 'supplier_payment_schedule_settlement') return 'Supplier Payment';
    if (sourceType === 'supplier_payment_reversal') return 'Supplier Payment Reversal';
    if (sourceType === 'customer_payment') return 'Customer Payment';
    if (sourceType === 'customer_payment_reversal') return 'Customer Payment Reversal';
    if (sourceType === 'expense') return 'Expense';
    if (sourceType === 'treasury_expense') return 'Treasury Expense';
    if (sourceType === 'expense_reversal') return 'Expense Reversal';
    if (sourceType === 'opening_balance') return 'Opening Balance';
    if (sourceType === 'manual') return 'Manual';
    return sourceType || '';
  }
  if (sourceType === 'sale') return 'بيع';
  if (sourceType === 'sale_edit') return 'تعديل بيع';
  if (sourceType === 'sale_edit_reversal') return 'عكس تعديل بيع';
  if (sourceType === 'sale_cancel' || sourceType === 'sale_reversal') return 'عكس بيع / إلغاء بيع';
  if (sourceType === 'sales_return') return 'مرتجع بيع';
  if (sourceType === 'return') return 'مرتجع';
  if (sourceType === 'purchase') return 'شراء';
  if (sourceType === 'purchase_cancel' || sourceType === 'purchase_reversal') return 'عكس شراء / إلغاء شراء';
  if (sourceType === 'supplier_payment') return 'سداد مورد';
  if (sourceType === 'supplier_payment_reversal') return 'عكس سداد مورد';
  if (sourceType === 'supplier_payment_schedule_settlement') return 'سداد مورد';
  if (sourceType === 'customer_payment') return 'تحصيل عميل';
  if (sourceType === 'customer_payment_reversal') return 'عكس تحصيل عميل';
  if (sourceType === 'expense') return 'مصروف';
  if (sourceType === 'treasury_expense') return 'مصروف خزنة';
  if (sourceType === 'expense_reversal') return 'عكس مصروف';
  if (sourceType === 'opening_balance') return 'رصيد افتتاحي';
  if (sourceType === 'manual') return 'يدوي';
  return sourceType || '';
}

export function AccountingJournalEntriesPage() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [shouldAutoScrollToDetails, setShouldAutoScrollToDetails] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const detailsRef = useRef<HTMLDivElement | null>(null);

  const { data: settings } = useSettingsQuery();
  const tenantTimezone = settings?.timezone || 'Africa/Cairo';

  const query = useQuery({
    queryKey: ['accounting', 'journal-entries', page, pageSize],
    queryFn: () => accountingApi.journalEntries({ page, pageSize }),
  });

  const detailQuery = useQuery({
    queryKey: ['accounting', 'journal-entry', selectedEntryId],
    queryFn: () => accountingApi.journalEntry(String(selectedEntryId)),
    enabled: Boolean(selectedEntryId),
  });

  const rows = query.data?.entries || [];
  const pagination = query.data?.pagination || {};
  const totalItems = Number((pagination as { totalItems?: number }).totalItems || rows.length);
  const detailEntry: JournalEntryDetail | null = detailQuery.data?.entry || null;

  useEffect(() => {
    if (!shouldAutoScrollToDetails || !selectedEntryId || detailQuery.isLoading) return;
    detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setShouldAutoScrollToDetails(false);
  }, [detailQuery.isLoading, selectedEntryId, shouldAutoScrollToDetails]);

  function handleSelectEntry(entryId: string) {
    setSelectedEntryId(entryId);
    setShouldAutoScrollToDetails(true);
  }

  const [isReverseOpen, setIsReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState('');
  const [reversing, setReversing] = useState(false);
  const [reverseFeedback, setReverseFeedback] = useState<{ text: string; error?: boolean } | null>(null);

  async function handleReverseSubmit() {
    if (!selectedEntryId || !reverseReason.trim()) return;
    setReversing(true);
    setReverseFeedback(null);
    try {
      const res = await accountingApi.reverseJournalEntry(String(selectedEntryId), reverseReason.trim());
      setReverseFeedback({ text: res.message || 'تم عكس القيد بنجاح' });
      query.refetch();
      detailQuery.refetch();
      setTimeout(() => {
        setIsReverseOpen(false);
        setReverseReason('');
        setReverseFeedback(null);
      }, 1500);
    } catch (err: any) {
      setReverseFeedback({ text: err?.message || 'تعذر عكس القيد اليومي', error: true });
    } finally {
      setReversing(false);
    }
  }

  return (
    <div className="page-stack page-shell" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '100px' }}>
      <PageHeader
        title={t('accounting.accounting_journal_entries_page.s0', "القيود اليومية")}
        description={t('accounting.accounting_journal_entries_page.s1', "استعراض وتتبع قيود اليومية العامة الناتجة عن حركات النظام المالية.")}
        badge={<span className="nav-pill">{t('accounting.accounting_journal_entries_page.s2', "دفتر اليومية العامة")}</span>}
        actions={
          <Button
            type="button"
            variant="primary"
            onClick={() => setIsCreateOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: '#170e5e',
              borderColor: '#170e5e',
              fontWeight: 700,
            }}
          >
            <PlusIcon size={16} />
            {t('accounting.accounting_journal_entries_page.s3', "إنشاء قيد يدوي")}
          </Button>
        }
      />
      <section className="document-prototype-section">
        <div className="section-header-compact-row">
          <h3 className="document-prototype-section-title">{t('accounting.accounting_journal_entries_page.s4', "سجل القيود المسجلة")}</h3>
          <div className="section-header-actions-group">
            <span className="nav-pill" style={{ fontSize: '11px', padding: '2px 8px' }}>{t('accounting.accounting_journal_entries_page.s5', "إجمالي القيود:")} {rows.length}</span>
          </div>
        </div>
        <QueryFeedback
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          isEmpty={!rows.length}
          loadingText={t('accounting.accounting_journal_entries_page.s6', "جاري تحميل القيود اليومية...")}
          errorTitle={t('accounting.accounting_journal_entries_page.s7', "تعذر تحميل القيود اليومية")}
          emptyTitle={t('accounting.accounting_journal_entries_page.s8', "لا توجد قيود يومية")}
        >
          <DataTable<JournalEntryListItem>
            data={rows}
            getRowKey={(row) => row.id}
            onRowClick={(row) => handleSelectEntry(row.id)}
            rowTitle={() => t('accounting.accounting_journal_entries_page.s9', "عرض تفاصيل القيد")}
            defaultSort={{ columnId: 'date', direction: 'desc' }}
            columns={[
              {
                id: 'entryNo',
                header: t('accounting.accounting_journal_entries_page.s10', "رقم القيد"),
                sortable: true,
                sortValue: (row) => Number(row.id || 0),
                render: (row) => (
                  <span
                    style={{
                      fontWeight: 800,
                      fontSize: '11px',
                      color: 'var(--primary, #170c5c)',
                      backgroundColor: 'rgba(99, 102, 241, 0.08)',
                      padding: '2px 6px',
                      borderRadius: '5px',
                      whiteSpace: 'nowrap',
                      display: 'inline-block',
                      fontFamily: 'monospace',
                    }}
                  >
                    {row.entryNo}
                  </span>
                ),
              },
              {
                id: 'date',
                header: t('accounting.accounting_journal_entries_page.s11', "التاريخ"),
                render: (row) => formatTenantDateKey(row.entryDate, tenantTimezone),
                sortable: true,
                sortValue: (row) => row.entryDate,
              },
              {
                id: 'source',
                header: t('accounting.accounting_journal_entries_page.s12', "المصدر"),
                render: (row) => mapSourceLabel(row.sourceType || '', isEn),
                sortable: true,
                sortValue: (row) => mapSourceLabel(row.sourceType || '', isEn),
              },
              {
                id: 'description',
                header: t('accounting.accounting_journal_entries_page.s13', "الوصف"),
                render: (row) => (isEn ? translateUiText(row.description || '') || row.description : row.description) || '',
              },
              {
                id: 'status',
                header: t('accounting.accounting_journal_entries_page.s14', "الحالة"),
                render: (row) => mapStatusLabel(row.status || '', isEn),
                sortable: true,
                sortValue: (row) => mapStatusLabel(row.status || '', isEn),
              },
            ]}
            pagination={{
              page,
              pageSize,
              totalItems,
              onPageChange: setPage,
              onPageSizeChange: (next) => {
                setPageSize(next);
                setPage(1);
              },
              itemLabel: t('accounting.accounting_journal_entries_page.s15', "قيد"),
            }}
          />
        </QueryFeedback>
      </section>

      {selectedEntryId ? (
        <div ref={detailsRef}>
          <FormSection title={t('accounting.accounting_journal_entries_page.s16', "تفاصيل القيد")}>
            <div className="actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setSelectedEntryId(null);
                  setShouldAutoScrollToDetails(false);
                }}
              >
                {t('accounting.accounting_journal_entries_page.s17', "العودة للقيود اليومية")}
              </Button>
              {detailEntry?.canReverse && (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => {
                    setReverseReason('');
                    setReverseFeedback(null);
                    setIsReverseOpen(true);
                  }}
                  style={{
                    backgroundColor: '#dc2626',
                    borderColor: '#dc2626',
                    color: '#fff',
                    fontWeight: 700,
                  }}
                >
                  {t('accounting.accounting_journal_entries_page.s18', "عكس وإلغاء القيد آلياً (Reverse)")}
                </Button>
              )}
            </div>

            <QueryFeedback
              isLoading={detailQuery.isLoading}
              isError={detailQuery.isError}
              error={detailQuery.error}
              isEmpty={!detailEntry}
              loadingText={t('accounting.accounting_journal_entries_page.s19', "جاري تحميل تفاصيل القيد...")}
              errorTitle={t('accounting.accounting_journal_entries_page.s20', "تعذر تحميل تفاصيل القيد")}
              emptyTitle={t('accounting.accounting_journal_entries_page.s21', "لا توجد تفاصيل لهذا القيد")}
            >
              {detailEntry ? (
                <div className="page-stack">
                  <div className="grid-2">
                    <div><strong>{t('accounting.accounting_journal_entries_page.s22', "رقم القيد:")}</strong> {detailEntry.entryNo}</div>
                    <div><strong>{t('accounting.accounting_journal_entries_page.s23', "التاريخ:")}</strong> {formatTenantDateKey(detailEntry.entryDate, tenantTimezone)}</div>
                    <div><strong>{t('accounting.accounting_journal_entries_page.s24', "المصدر:")}</strong> {mapSourceLabel(detailEntry.sourceType || '', isEn)}</div>
                    <div><strong>{t('accounting.accounting_journal_entries_page.s25', "الحالة:")}</strong> {mapStatusLabel(detailEntry.status || '', isEn)}</div>
                    <div><strong>{t('accounting.accounting_journal_entries_page.s26', "الوصف:")}</strong> {(isEn ? translateUiText(detailEntry.description || '') || detailEntry.description : detailEntry.description) || '-'}</div>
                    <div><strong>{t('accounting.accounting_journal_entries_page.s27', "إجمالي المدين:")}</strong> {formatCurrency(Number(detailEntry.totals?.debit || 0))}</div>
                    <div><strong>{t('accounting.accounting_journal_entries_page.s28', "إجمالي الدائن:")}</strong> {formatCurrency(Number(detailEntry.totals?.credit || 0))}</div>
                  </div>

                  <FormSection title={t('accounting.accounting_journal_entries_page.s29', "سطور القيد")}>
                    {detailEntry.lines?.length ? (
                      <DataTable<JournalEntryLine>
                        data={detailEntry.lines}
                        getRowKey={(row) => row.id}
                        columns={[
                          {
                            id: 'account',
                            header: t('accounting.accounting_journal_entries_page.s30', "الحساب"),
                            render: (row) => [
                              row.accountCode,
                              isEn && row.accountNameEn
                                ? row.accountNameEn
                                : isEn
                                  ? translateUiText(row.accountNameAr || '') || row.accountNameAr
                                  : row.accountNameAr || row.accountNameEn || row.accountId,
                            ].filter(Boolean).join(' - '),
                          },
                          {
                            id: 'costCenter',
                            header: t('accounting.accounting_journal_entries_page.s31', "مركز التكلفة"),
                            render: (row) =>
                              row.costCenterName ? (
                                <span
                                  style={{
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    padding: '2px 8px',
                                    borderRadius: '6px',
                                    backgroundColor: 'rgba(23, 14, 94, 0.07)',
                                    color: '#170e5e',
                                  }}
                                >
                                  {[row.costCenterCode, row.costCenterName].filter(Boolean).join(' - ')}
                                </span>
                              ) : (
                                <span style={{ color: '#94a3b8' }}>-</span>
                              ),
                          },
                          { id: 'description', header: t('accounting.accounting_journal_entries_page.s32', "الوصف"), render: (row) => row.description || '-' },
                          { id: 'debit', header: t('accounting.accounting_journal_entries_page.s33', "مدين"), align: 'end', render: (row) => formatCurrency(Number(row.debit || 0)) },
                          { id: 'credit', header: t('accounting.accounting_journal_entries_page.s34', "دائن"), align: 'end', render: (row) => formatCurrency(Number(row.credit || 0)) },
                        ]}
                      />
                    ) : (
                      <div className="muted">{t('accounting.accounting_journal_entries_page.s35', "لا توجد سطور لهذا القيد")}</div>
                    )}
                  </FormSection>
                </div>
              ) : null}
            </QueryFeedback>
          </FormSection>
        </div>
      ) : null}

      <ManualJournalEntryDialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={(entry) => {
          query.refetch();
          handleSelectEntry(String(entry.id));
        }}
      />

      <StandardDialog
        open={isReverseOpen}
        onClose={() => {
          if (!reversing) {
            setIsReverseOpen(false);
            setReverseFeedback(null);
          }
        }}
        title={t('accounting.accounting_journal_entries_page.s36', "عكس وإلغاء القيد المحاسبي آلياً")}
        subtitle={`سيتم إنشاء قيد يومية عكسي يقلب كافة بنود المدين والدائن للقيد رقم ${detailEntry?.entryNo || ''}`}
        width="520px"
        footerActions={
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' }}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsReverseOpen(false)}
              disabled={reversing}
            >
              {t('accounting.accounting_journal_entries_page.s37', "إلغاء")}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleReverseSubmit}
              disabled={reversing || !reverseReason.trim()}
              style={{ backgroundColor: '#dc2626', borderColor: '#dc2626', color: '#fff', fontWeight: 700 }}
            >
              {reversing ? t('accounting.accounting_journal_entries_page.s38', "جاري العكس...") : t('accounting.accounting_journal_entries_page.s39', "تأكيد العكس وترحيل القيد المعكوس")}
            </Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }} dir="rtl">
          {reverseFeedback && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                backgroundColor: reverseFeedback.error ? '#fef2f2' : '#f0fdf4',
                color: reverseFeedback.error ? '#991b1b' : '#166534',
                border: `1px solid ${reverseFeedback.error ? '#fecaca' : '#bbf7d0'}`,
              }}
            >
              {reverseFeedback.text}
            </div>
          )}

          <div style={{ fontSize: '13px', color: '#475569', lineHeight: 1.6 }}>
            {t('accounting.accounting_journal_entries_page.s40', "لا تُحذف القيود المرحلة. يُنشأ قيد عكسي مستقل وتظل حالة القيد الأصلي")} <strong>{t('accounting.accounting_journal_entries_page.s41', "مرحّل (Posted)")}</strong> {t('accounting.accounting_journal_entries_page.s42', "مع ربط القيدين للحفاظ على سجل التدقيق المحاسبي.")}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px', color: '#1e293b' }}>
              {t('accounting.accounting_journal_entries_page.s43', "سبب عكس القيد")} <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <textarea
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              placeholder={t('accounting.accounting_journal_entries_page.s44', "اكتب سبب عكس القيد بالتفصيل (مثل: خطأ في توجيه الحساب أو إلغاء المعاملة)...")}
              rows={3}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
          </div>
        </div>
      </StandardDialog>
      </main>
    </div>
  );
}
