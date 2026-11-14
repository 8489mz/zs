import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { DataTable } from '@/shared/ui/data-table';
import { formatCurrency } from '@/lib/format';
import { queryKeys } from '@/app/query-keys';
import { accountingApi } from '@/features/accounting';
import { supplierBillsApi } from '@/features/suppliers/api/supplier-bills.api';

export function SupplierBillsList({ supplierId }: { supplierId: string }) {
  const { t } = useTranslation();
  const billsQuery = useQuery({
    queryKey: queryKeys.supplierBills(supplierId),
    queryFn: () => supplierBillsApi.list(supplierId),
  });
  const accountsQuery = useQuery({ queryKey: ['accounting-accounts'], queryFn: accountingApi.accounts });

  const accountNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const account of accountsQuery.data?.accounts || []) {
      map.set(Number(account.id), `${account.code} — ${account.nameAr || account.nameEn || account.code}`);
    }
    return map;
  }, [accountsQuery.data]);

  const bills = billsQuery.data?.bills || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {billsQuery.isError ? (
        <div className="muted small">{t('suppliers.supplier_bills_list.s0', 'تعذر تحميل فواتير المورد بدون مخزون.')}</div>
      ) : null}
      <DataTable
        ariaLabel={t('suppliers.supplier_bills_list.s1', 'فواتير المورد بدون مخزون')}
        density="compact"
        rows={bills}
        empty={<div className="muted small">{billsQuery.isPending ? t('suppliers.supplier_bills_list.s2', 'جارٍ التحميل...') : t('suppliers.supplier_bills_list.s3', 'لا توجد فواتير بدون مخزون لهذا المورد بعد.')}</div>}
        columns={[
          { key: 'docNo', header: t('suppliers.supplier_bills_list.s4', 'رقم الفاتورة'), cell: (bill) => bill.docNo || '—' },
          { key: 'billDate', header: t('suppliers.supplier_bills_list.s5', 'التاريخ'), cell: (bill) => bill.billDate || '—' },
          {
            key: 'lines',
            header: t('suppliers.supplier_bills_list.s6', 'البنود'),
            cell: (bill) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {(bill.lines || []).map((line, index) => (
                  <span key={index} className="small">
                    {line.description} — {accountNames.get(Number(line.accountId)) || `#${line.accountId}`} — {formatCurrency(Number(line.amount || 0))}
                  </span>
                ))}
              </div>
            ),
          },
          { key: 'total', header: t('suppliers.supplier_bills_list.s7', 'الإجمالي'), className: 'numeric-cell', cell: (bill) => formatCurrency(Number(bill.total || 0)) },
        ]}
        rowKey={(bill) => String(bill.id)}
      />
    </div>
  );
}
