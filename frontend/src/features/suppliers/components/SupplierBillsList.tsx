import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { DataTable } from '@/shared/ui/data-table';
import { formatCurrency } from '@/lib/format';
import { queryKeys } from '@/app/query-keys';
import { accountingApi } from '@/features/accounting';
import { supplierBillsApi } from '@/features/suppliers/api/supplier-bills.api';

/* INV-SUPPLIER-PAGE-BILL-STATEMENT: the recorded non-stock bills of
 * one supplier, rendered neatly in the second tab beside/under the form. */
export function SupplierBillsList({ supplierId }: { supplierId: string }) {
  const { t } = useTranslation();
  const billsQuery = useQuery({
    queryKey: queryKeys.supplierBills(supplierId),
    queryFn: () => supplierBillsApi.list(supplierId),
    enabled: Boolean(supplierId),
  });
  const accountsQuery = useQuery({ queryKey: ['accounting-accounts'], queryFn: accountingApi.accounts });
  const accountNames = useMemo(() => {
    const raw = accountsQuery.data as
      | Array<{ id: number | string; code: string | number; name?: string; nameAr?: string; nameEn?: string }>
      | { accounts?: Array<{ id: number | string; code: string | number; name?: string; nameAr?: string; nameEn?: string }> }
      | undefined;
    const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.accounts) ? raw.accounts : [];
    const map = new Map<string, string>();
    for (const account of list) {
      map.set(String(account.id), `${account.code} — ${account.nameAr || account.name || account.nameEn || account.code}`);
    }
    return map;
  }, [accountsQuery.data]);

  const bills = billsQuery.data?.bills || [];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '12px',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        background: '#f8fafc',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          paddingBottom: '8px',
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '3px', height: '14px', borderRadius: '2px', background: '#170e5e', display: 'inline-block' }} />
          <strong style={{ fontSize: '13.5px', color: '#0f172a', fontWeight: 800 }}>
            {t('suppliers.supplier_bills_list.s0', 'سجل الفواتير غير المخزنية')}
          </strong>
        </div>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            color: '#475569',
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            padding: '2px 8px',
            borderRadius: '999px',
          }}
        >
          {bills.length} فاتورة
        </span>
      </div>

      <div
        className="thin-scrollbar"
        style={{
          maxHeight: '290px',
          overflowY: 'auto',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          background: '#ffffff',
        }}
      >
        <DataTable
          ariaLabel={t('suppliers.supplier_bills_list.s1', 'فواتير المورد بدون مخزون')}
          density="compact"
          rows={bills}
          empty={
            <div style={{ textAlign: 'center', padding: '28px 12px', color: '#64748b', fontSize: '12.5px' }}>
              {billsQuery.isLoading
                ? t('suppliers.supplier_bills_list.s2', 'جاري التحميل...')
                : t('suppliers.supplier_bills_list.s3', 'لا توجد فواتير بدون مخزون مسجلة لهذا المورد بعد.')}
            </div>
          }
          columns={[
            {
              key: 'docNo',
              header: t('suppliers.supplier_bills_list.s4', 'الرقم'),
              cell: (bill) => <strong style={{ fontSize: '12px', color: '#170e5e' }}>{bill.docNo}</strong>,
            },
            {
              key: 'billDate',
              header: t('suppliers.supplier_bills_list.s5', 'التاريخ'),
              cell: (bill) => <span style={{ fontSize: '11.5px', color: '#475569', whiteSpace: 'nowrap' }}>{bill.billDate}</span>,
            },
            {
              key: 'lines',
              header: t('suppliers.supplier_bills_list.s6', 'البنود'),
              cell: (bill) => (
                <div style={{ fontSize: '12px', color: '#0f172a' }}>
                  {bill.lines.map((line) => `${line.description} (${accountNames.get(String(line.accountId)) || line.accountId})`).join(' · ')}
                  {bill.note ? <div style={{ fontSize: '11px', color: '#64748b' }}>{bill.note}</div> : null}
                </div>
              ),
            },
            {
              key: 'total',
              header: t('suppliers.supplier_bills_list.s7', 'الإجمالي'),
              className: 'numeric-cell',
              cell: (bill) => <strong style={{ fontSize: '12.5px', color: '#0f172a' }}>{formatCurrency(bill.total)}</strong>,
            },
          ]}
          rowKey={(bill) => bill.id}
        />
      </div>
    </div>
  );
}
