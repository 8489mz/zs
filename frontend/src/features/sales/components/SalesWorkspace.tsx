import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ActionConfirmDialog } from '@/shared/components/action-confirm-dialog';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { useSalesPage } from '@/features/sales/hooks/useSalesPage';
import { useSaleActions } from '@/features/sales/hooks/useSaleActions';
import { useSalesWorkspaceActions } from '@/features/sales/hooks/useSalesWorkspaceActions';
import { SalesWorkspaceHeader } from '@/features/sales/components/SalesWorkspaceHeader';
import { SalesRegisterCard, type SalesPaymentFilter } from '@/features/sales/components/SalesRegisterCard';
import { SaleDetailCard } from '@/features/sales/components/SaleDetailCard';
import { SaleEditDialog } from '@/features/sales/components/SaleEditDialog';
import {
  getSaleCancelDescription,
  getSalesNextStep,
  getSalesViewFilterLabel,
  printSaleDocument,
} from '@/features/sales/lib/sales-workspace.helpers';
import { useHasAnyPermission } from '@/shared/hooks/use-permission';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { isPosAvailable } from '@/features/pos';
import { userDirectoryApi } from '@/shared/api/user-directory';
import type { Sale } from '@/types/domain';
import { useTranslation } from "react-i18next";

export function SalesWorkspace() {
    const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [viewFilter, setViewFilter] = useState<SalesPaymentFilter>('all');
  const [cashierFilter, setCashierFilter] = useState('all');
  const [selectedSaleId, setSelectedSaleId] = useState('');
  const [saleToCancel, setSaleToCancel] = useState<Sale | null>(null);
  const [saleToEdit, setSaleToEdit] = useState<Sale | null>(null);
  const [editFeedback, setEditFeedback] = useState('');
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);

  const { salesQuery, rows, pagination, summary } = useSalesPage({ page, pageSize, search, filter: viewFilter, cashier: cashierFilter });
  const { saleDetailQuery, cancelMutation, updateMutation } = useSaleActions(selectedSaleId);
  const usersQuery = useQuery({ queryKey: ['sales-cashier-filter-users'], queryFn: userDirectoryApi.users, staleTime: 60_000 });
  const settingsQuery = useSettingsQuery();

  const canPrint = useHasAnyPermission('canPrint');
  const canEditInvoices = useHasAnyPermission('canEditInvoices');
  const selectedSale = saleDetailQuery.data;
  const activeFilterLabel = getSalesViewFilterLabel(viewFilter);
  const totalItems = pagination?.totalItems || 0;
  const topCustomers = summary?.topCustomers || [];
  const currentPage = pagination?.page || page;
  const currentPageSize = pagination?.pageSize || pageSize;
  const rangeStart = pagination?.rangeStart != null && pagination.rangeStart > 0
    ? pagination.rangeStart
    : (totalItems > 0 ? (currentPage - 1) * currentPageSize + 1 : 0);
  const rangeEnd = pagination?.rangeEnd != null && pagination.rangeEnd > 0
    ? pagination.rangeEnd
    : (totalItems > 0 ? Math.min(currentPage * currentPageSize, totalItems) : 0);
  const printSettings = settingsQuery.data || null;
  const cashierOptions = useMemo(() => {
    const userOptions = (usersQuery.data || [])
      .map((user) => {
        const id = String(user.id || '').trim();
        if (!id) return null;
        const role = String(user.role || '').trim();
        const displayName = String(user.name || user.username || t('sales.f1beeb')).trim();
        return { id, label: role ? `${role} — ${displayName}` : displayName };
      })
      .filter((entry): entry is { id: string; label: string } => Boolean(entry));

    if (userOptions.length) return userOptions;

    return (summary?.cashiers || []).map((cashierName) => ({
      id: String(cashierName),
      label: String(cashierName),
    }));
  }, [summary?.cashiers, usersQuery.data]);

  useEffect(() => {
    setPage(1);
  }, [search, viewFilter, cashierFilter]);

  const cancelDescription = getSaleCancelDescription(saleToCancel);
  const totalSales = summary?.totalSales || 0;
  const salesNextStep = useMemo(() => getSalesNextStep({ selectedSale, canEditInvoices, totalItems }), [selectedSale, canEditInvoices, totalItems]);
  const headerDescription = selectedSale
    ? `الفاتورة ${selectedSale.docNo || selectedSale.id} محددة الآن. ${salesNextStep}`
    : t('sales.5fa1e3');

  const {
    exportSalesCsv,
    resetSalesView,
    copySalesSummary,
    printSalesRegister,
  } = useSalesWorkspaceActions({
    search,
    viewFilter,
    cashierFilter,
    totalItems,
    summary,
    topCustomers,
    setPage,
    setPageSize,
    setSearch,
    setViewFilter,
    setCashierFilter,
    setSelectedSaleId,
    setSaleToCancel,
  });

  const handleViewFilterChange = (value: SalesPaymentFilter) => {
    setViewFilter(value);
    setPage(1);
  };

  return (
    <div className="page-stack page-shell sales-workspace" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '32px', maxWidth: '1280px' }}>
        <SalesWorkspaceHeader
          totalItems={totalItems}
          description={headerDescription}
          onCopySummary={copySalesSummary}
          // I5-D1: hide the "فتح الكاشير" entry while settings are still
          // loading (no false entry) and whenever POS is off for this
          // tenant — the button used to link unconditionally to /pos and
          // dead-end on the disabled page.
          showPosButton={Boolean(settingsQuery.data) && isPosAvailable(settingsQuery.data)}
        />
        {editFeedback ? <div className="success-box">{editFeedback}</div> : null}

        <SalesRegisterCard
          search={search}
          viewFilter={viewFilter}
          cashierFilter={cashierFilter}
          cashierOptions={cashierOptions}
          activeFilterLabel={activeFilterLabel}
          totalItems={totalItems}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          totalSales={totalSales}
          selectedSale={selectedSale}
          selectedSaleId={selectedSaleId}
          rows={rows}
          page={pagination?.page || page}
          pageSize={pagination?.pageSize || pageSize}
          totalPages={pagination?.totalPages || 1}
          isLoading={salesQuery.isLoading}
          isError={salesQuery.isError}
          error={salesQuery.error}
          canPrint={canPrint}
          canEditInvoices={canEditInvoices}
          onSearchChange={setSearch}
          onViewFilterChange={handleViewFilterChange}
          onCashierFilterChange={(value) => { setCashierFilter(value); setPage(1); }}
          onReset={resetSalesView}
          onSelectSale={(id) => {
            setSelectedSaleId(id);
            setIsDetailOpen(true);
          }}
          onEditSale={(sale) => {
            if (sale.status === 'cancelled') return;
            setSelectedSaleId(sale.id);
            setSaleToEdit(sale);
            setEditFeedback('');
          }}
          onCancelSale={setSaleToCancel}
          onExportCsv={exportSalesCsv}
          onPrintRegister={printSalesRegister}
          onPrintSale={(sale) => printSaleDocument(sale, printSettings, printSettings?.paperSize === 'receipt' ? 'receipt' : 'a4')}
          onPageChange={setPage}
          onPageSizeChange={(nextPageSize) => { setPageSize(nextPageSize); setPage(1); }}
        />

        {/* Modal for Invoice Details */}
        <StandardDialog
          isOpen={isDetailOpen && Boolean(selectedSaleId)}
          onClose={() => { setIsDetailOpen(false); }}
          title={`${t('sales.invoiceDetails', 'تفاصيل الفاتورة')}: ${selectedSale?.docNo || selectedSale?.id || ''}`}
          subtitle={t('sales.previewInvoiceItems', 'معاينة بنود الفاتورة والمدفوعات والمستندات المرتبطة')}
          maxWidth="960px"
          loading={saleDetailQuery.isLoading}
          loadingText={t('sales.loadingDetails', 'جاري تحميل تفاصيل الفاتورة...')}
        >
          <SaleDetailCard
            sale={selectedSale || undefined}
            isLoading={saleDetailQuery.isLoading}
            onPrint={canPrint && selectedSale ? () => selectedSale ? printSaleDocument(selectedSale, printSettings, printSettings?.paperSize === 'receipt' ? 'receipt' : 'a4') : undefined : undefined}
            onEdit={canEditInvoices && selectedSale && selectedSale.status !== 'cancelled' ? () => {
              setSaleToEdit(selectedSale);
              setEditFeedback('');
              setIsDetailOpen(false);
            } : undefined}
            onCancel={canEditInvoices && selectedSale && selectedSale.status !== 'cancelled' ? () => {
              setSaleToCancel(selectedSale);
              setIsDetailOpen(false);
            } : undefined}
          />
        </StandardDialog>
      </main>

      <SaleEditDialog
        open={Boolean(saleToEdit)}
        sale={selectedSale && saleToEdit && selectedSale.id === saleToEdit.id ? selectedSale : saleToEdit || undefined}
        isBusy={updateMutation.isPending}
        errorMessage={updateMutation.error instanceof Error ? updateMutation.error.message : ''}
        onCancel={() => setSaleToEdit(null)}
        onSave={async (payload) => {
          const activeSale = selectedSale && saleToEdit && selectedSale.id === saleToEdit.id ? selectedSale : saleToEdit;
          if (!activeSale) return;
          await updateMutation.mutateAsync({ sale: activeSale, payload });
          setSaleToEdit(null);
          setEditFeedback(t('sales.9f6aed'));
          setSelectedSaleId(activeSale.id);
        }}
      />

      <ActionConfirmDialog
        open={Boolean(saleToCancel)}
        title={t('sales.d35686')}
        description={cancelDescription}
        confirmLabel={t('sales.5b8465')}
        managerPinRequired
        managerPinLabel={t('sales.manager_pin_label', 'رمز اعتماد المدير أو كلمة مرور المدير')}
        managerPinHint={t('sales.3bec5f')}
        reasonRequired
        reasonLabel={t('sales.06667e')}
        reasonHint={t('sales.e3f046')}
        reasonPlaceholder={t('sales.b8c40f')}
        isBusy={cancelMutation.isPending}
        onCancel={() => setSaleToCancel(null)}
        onConfirm={async ({ managerPin, reason }) => {
          if (!saleToCancel) return;
          await cancelMutation.mutateAsync({ saleId: saleToCancel.id, reason, managerPin });
          setSelectedSaleId(saleToCancel.id);
          setSaleToCancel(null);
        }}
      />
    </div>
  );
}
