import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Field } from '@/shared/ui/field';
import { DataTable } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Customer, CustomerLedgerEntry, LedgerPagination, LedgerSummary, Supplier, SupplierLedgerEntry } from '@/types/domain';
import { documentDetailsApi } from '@/shared/api/document-details';
import { AccountsInvoiceDetailCard } from '@/features/accounts/components/AccountsInvoiceDetailCard';
import { formatLedgerEntryType } from '@/features/accounts/utils/ledger-format.utils';

type Entry = CustomerLedgerEntry | SupplierLedgerEntry;
type SupportedDocumentType = 'sale' | 'purchase' | 'supplier_payment';
type SelectedLedgerDocument = { key: string; type: SupportedDocumentType; referenceId: string; label: string };

function readEntryText(entry: Entry, keys: string[]) {
  const row = entry as Entry & Record<string, unknown>;
  for (const key of keys) {
    const value = row[key];
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

export function inferDocumentType(entry: Entry): SupportedDocumentType | '' {
  const referenceType = readEntryText(entry, ['reference_type', 'referenceType']).toLowerCase();
  const entryType = readEntryText(entry, ['entry_type', 'entryType', 'type']).toLowerCase();
  /* INV-STATEMENT-PAYMENT-DETAILS: a supplier payment is its own document
   * type, never a purchase. Without this early return the fallthrough
   * below classified it 'purchase' ('supplier_payment'.includes('supplier')),
   * and the payment id was then fed to purchaseById -- which 404s, or
   * silently shows an unrelated invoice when the ids collide. */
  if (referenceType === 'supplier_payment' || entryType === 'supplier_payment') return 'supplier_payment';
  if (referenceType === 'sale' || referenceType === 'purchase') return referenceType;

  const note = readEntryText(entry, ['note', 'description']);
  const docNo = readEntryText(entry, ['doc_no', 'docNo', 'documentNo']);

  if (entryType.includes('purchase') || entryType.includes('supplier') || /(^|\s)P-\d+/i.test(`${docNo} ${note}`) || note.includes('شراء')) {
    return 'purchase';
  }
  if (entryType.includes('sale') || entryType.includes('customer') || /(^|\s)S-\d+/i.test(`${docNo} ${note}`) || note.includes('بيع')) {
    return 'sale';
  }

  return '';
}

function inferDocumentId(entry: Entry, type: SupportedDocumentType | '') {
  const referenceId = readEntryText(entry, ['reference_id', 'referenceId']);
  if (referenceId) return referenceId;

  const docNo = readEntryText(entry, ['doc_no', 'docNo', 'documentNo']);
  const note = readEntryText(entry, ['note', 'description']);
  const haystack = `${docNo} ${note}`;

  if (type === 'sale') {
    const match = haystack.match(/\bS-(\d+)\b/i);
    if (match?.[1]) return match[1];
  }

  if (type === 'purchase') {
    const match = haystack.match(/\bP-(\d+)\b/i);
    if (match?.[1]) return match[1];
  }

  const genericMatch = haystack.match(/#?(\d+)/);
  return genericMatch?.[1] || '';
}

export function getDocumentReference(entry: Entry): SelectedLedgerDocument | null {
  const type = inferDocumentType(entry);
  if (type !== 'sale' && type !== 'purchase' && type !== 'supplier_payment') return null;

  const referenceId = inferDocumentId(entry, type);
  if (!referenceId) return null;

  const docNo = readEntryText(entry, ['doc_no', 'docNo', 'documentNo']);
  const note = readEntryText(entry, ['note', 'description']);
  const label = docNo || note || (type === 'sale' ? `فاتورة بيع #${referenceId}` : type === 'supplier_payment' ? `سند صرف #${referenceId}` : `فاتورة شراء #${referenceId}`);

  return {
    key: `${type}-${referenceId}`,
    type,
    referenceId,
    label,
  };
}

export function LedgerPanel({
  title,
  value,
  onChange,
  options,
  emptyLabel,
  entries,
  search,
  onSearchChange,
  pagination,
  onPageChange,
  onPageSizeChange,
  summary
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<Customer | Supplier>;
  emptyLabel: string;
  entries: Entry[];
  search: string;
  onSearchChange: (value: string) => void;
  pagination?: LedgerPagination | null;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  summary?: LedgerSummary | null;
}) {
  const { t } = useTranslation();
  const selectedOption = useMemo(() => options.find((option) => String(option.id) === String(value)) || null, [options, value]);
  const [selectedDocument, setSelectedDocument] = useState<SelectedLedgerDocument | null>(null);

  useEffect(() => {
    setSelectedDocument(null);
  }, [value, search]);

  const saleDetailQuery = useQuery({
    queryKey: ['accounts-ledger-sale-detail', selectedDocument?.type, selectedDocument?.referenceId],
    queryFn: () => documentDetailsApi.saleById(String(selectedDocument?.referenceId || '')),
    enabled: selectedDocument?.type === 'sale' && Boolean(selectedDocument?.referenceId),
  });

  const purchaseDetailQuery = useQuery({
    queryKey: ['accounts-ledger-purchase-detail', selectedDocument?.type, selectedDocument?.referenceId],
    queryFn: () => documentDetailsApi.purchaseById(String(selectedDocument?.referenceId || '')),
    enabled: selectedDocument?.type === 'purchase' && Boolean(selectedDocument?.referenceId),
  });

  const supplierPaymentDetailQuery = useQuery({
    queryKey: ['accounts-ledger-supplier-payment-detail', selectedDocument?.type, selectedDocument?.referenceId],
    queryFn: () => documentDetailsApi.supplierPaymentById(String(selectedDocument?.referenceId || '')),
    enabled: selectedDocument?.type === 'supplier_payment' && Boolean(selectedDocument?.referenceId),
  });

  function toggleDocument(entry: Entry) {
    const document = getDocumentReference(entry);
    if (!document) return;
    setSelectedDocument((current) => current?.key === document.key ? null : document);
  }

  return (
    <div className="accounts-ledger-inner-content">
      <div className="inline-create-grid">
        <Field label={emptyLabel}>
          <select value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">{emptyLabel}</option>
            {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </Field>
        <Field label={t('accounts.ledger_panel.s0', "بحث داخل الكشف")}>
          <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={t('accounts.ledger_panel.s1', "رقم مستند أو ملاحظة")} disabled={!value} />
        </Field>
      </div>
      {selectedOption ? (
        <div className="stats-grid compact-grid">
          <div className="stat-card"><span>{t('accounts.ledger_panel.s2', "الاسم")}</span><strong>{selectedOption.name}</strong></div>
          <div className="stat-card"><span>{t('accounts.ledger_panel.s3', "عدد القيود")}</span><strong>{summary?.totalItems ?? entries.length}</strong></div>
          <div className="stat-card"><span>{t('accounts.ledger_panel.s4', "إجمالي المدين")}</span><strong>{formatCurrency(summary?.debitTotal || 0)}</strong></div>
          <div className="stat-card"><span>{t('accounts.ledger_panel.s5', "إجمالي الدائن")}</span><strong>{formatCurrency(summary?.creditTotal || 0)}</strong></div>
          <div className="stat-card"><span>{t('accounts.ledger_panel.s6', "آخر رصيد")}</span><strong>{formatCurrency(summary?.lastBalance || 0)}</strong></div>
        </div>
      ) : null}
      <DataTable
        ariaLabel={title}
        density="compact"
        rows={entries}
        empty={<div className="muted small">{value ? t('accounts.ledger_panel.s7', "لا توجد قيود مطابقة لهذا الكشف.") : t('accounts.ledger_panel.s8', "اختر عنصرًا لعرض الكشف.")}</div>}
        columns={[
          { key: 'type', header: t('accounts.ledger_panel.s9', "النوع"), cell: (entry) => formatLedgerEntryType(readEntryText(entry, ['entry_type', 'entryType', 'type']), readEntryText(entry, ['note', 'description'])) },
          { key: 'note', header: t('accounts.ledger_panel.s10', "الملاحظة"), cell: (entry) => readEntryText(entry, ['note', 'description']) || '—' },
          { key: 'date', header: t('accounts.ledger_panel.s11', "التاريخ"), cell: (entry) => formatDate(readEntryText(entry, ['created_at', 'createdAt', 'date'])) },
          { key: 'debit', header: t('accounts.ledger_panel.s12', "مدين"), className: 'numeric-cell', cell: (entry) => formatCurrency(Number((entry as Entry & Record<string, unknown>).debit || 0)) },
          { key: 'credit', header: t('accounts.ledger_panel.s13', "دائن"), className: 'numeric-cell', cell: (entry) => formatCurrency(Number((entry as Entry & Record<string, unknown>).credit || 0)) },
          { key: 'balance', header: t('accounts.ledger_panel.s14', "الرصيد"), className: 'numeric-cell', cell: (entry) => formatCurrency(Number((entry as Entry & Record<string, unknown>).balance_after || (entry as Entry & Record<string, unknown>).balanceAfter || 0)) },
          {
            key: 'document',
            header: t('accounts.ledger_panel.s15', "الفاتورة"),
            cell: (entry) => {
              const document = getDocumentReference(entry);
              if (!document) return <span className="muted small">—</span>;
              return (
                <Button
                  type="button"
                  variant={selectedDocument?.key === document.key ? 'primary' : 'secondary'}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleDocument(entry);
                  }}
                >
                  {selectedDocument?.key === document.key ? t('accounts.ledger_panel.s16', "إخفاء التفاصيل") : t('accounts.ledger_panel.s17', "عرض التفاصيل")}
                </Button>
              );
            },
          },
        ]}
        rowKey={(entry, index) => `${readEntryText(entry, ['id']) || readEntryText(entry, ['doc_no', 'docNo']) || 'doc'}-${readEntryText(entry, ['created_at', 'createdAt', 'date']) || 'date'}-${index}`}
        onRowClick={(entry) => toggleDocument(entry)}
        rowClassName={(entry) => {
          const document = getDocumentReference(entry);
          if (!document) return undefined;
          return selectedDocument?.key === document.key ? 'table-row-selected table-row-clickable' : 'table-row-clickable';
        }}
        rowTitle={(entry) => {
          const document = getDocumentReference(entry);
          if (!document) return undefined;
          return document.type === 'supplier_payment'
            ? t('accounts.ledger_panel.s20', "اضغط لعرض تفاصيل الدفع")
            : t('accounts.ledger_panel.s18', "اضغط لعرض تفاصيل الفاتورة");
        }}
        pagination={value ? {
          page: pagination?.page || 1,
          pageSize: pagination?.pageSize || 10,
          totalItems: pagination?.totalItems || entries.length,
          onPageChange,
          onPageSizeChange,
          itemLabel: t('accounts.ledger_panel.s19', "قيد")
        } : undefined}
      />
      <div className="page-stack" style={{ marginTop: 12 }}>
        <AccountsInvoiceDetailCard
          selectedLabel={selectedDocument?.label || ''}
          documentType={selectedDocument?.type || null}
          isLoading={saleDetailQuery.isLoading || purchaseDetailQuery.isLoading || supplierPaymentDetailQuery.isLoading}
          error={saleDetailQuery.error || purchaseDetailQuery.error || supplierPaymentDetailQuery.error}
          sale={saleDetailQuery.data || null}
          purchase={purchaseDetailQuery.data || null}
          supplierPayment={supplierPaymentDetailQuery.data || null}
        />
      </div>
    </div>
  );
}
