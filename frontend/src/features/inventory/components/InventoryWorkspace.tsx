import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StockTransferSuccessDialog } from '@/features/inventory/components/StockTransferSuccessDialog';
import { printTransferDocument } from '@/lib/inventory-printing';
import { InventoryWorkspaceHeader } from '@/features/inventory/components/InventoryWorkspaceHeader';
import { InventorySectionTabs } from '@/features/inventory/pages/InventorySectionTabs';
import { StatsGrid } from '@/shared/components/stats-grid';
import { InventoryMovementCard, InventoryStatusCard, StockCountComposerCard, StockCountMonitorCard, TransferMonitorCard, DamagedStockCard } from '@/features/inventory/components/InventoryWorkspaceSections';
import { InventoryPostSessionDialog, InventoryTransferActionDialog } from '@/features/inventory/components/InventoryWorkspaceDialogs';
import { QuickStockAdjustmentDialog } from '@/features/inventory/components/QuickStockAdjustmentDialog';
import { useInventoryWorkspaceController } from '@/features/inventory/hooks/useInventoryWorkspaceController';
import { PlusCircleIcon, LayersIcon } from '@/shared/components/icons/AppIcons';
import type { InventorySectionKey } from '@/features/inventory/pages/inventory.page-config';
import type { Product } from '@/types/domain';

export function InventoryWorkspace({ currentSection }: { currentSection: InventorySectionKey }) {
  const { t } = useTranslation();
  const inventory = useInventoryWorkspaceController(currentSection);
  const [selectedInventoryProduct, setSelectedInventoryProduct] = useState<{ product: Product; token: number } | null>(null);
  const [countSubView, setCountSubView] = useState<'create' | 'history'>('create');
  const [searchParams, setSearchParams] = useSearchParams();
  const productId = searchParams.get('productId');
  const locationId = searchParams.get('locationId');

  useEffect(() => {
    if (productId && inventory.products.length > 0) {
      const product = inventory.products.find(p => String(p.id) === productId);
      if (product) {
        setSelectedInventoryProduct({ product, token: Date.now() });
        // Remove productId from URL after selecting it so it doesn't trigger on every re-render
        searchParams.delete('productId');
        setSearchParams(searchParams, { replace: true });
      }
    }
  }, [productId, inventory.products, searchParams, setSearchParams]);

  useEffect(() => {
    if (locationId && inventory.locations.length > 0) {
      const loc = inventory.locations.find((l: any) => String(l.id) === String(locationId));
      if (loc) {
        if (currentSection === 'counts') {
          inventory.setCountForm((current: any) => ({
            ...current,
            locationId: String(loc.id),
            branchId: loc.branchId ? String(loc.branchId) : current.branchId,
          }));
          setCountSubView('create');
        } else if (currentSection === 'overview' || currentSection === 'movements') {
          inventory.setLocationFilter(String(loc.id));
        }
      }
    }
  }, [locationId, inventory.locations, currentSection]);

  return (
    <div className="page-stack page-shell inventory-workspace" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '100px' }}>
      <InventoryWorkspaceHeader
        canPrint={inventory.canPrint}
        hasRows={inventory.hasRows}
        description={inventory.sectionDescription}
        currentSection={currentSection}
        onReset={inventory.resetInventoryView}
        onCopySummary={() => void Promise.resolve(inventory.copyInventorySummary())}
        onExportExcel={() => void Promise.resolve(inventory.sectionExportHandler())}
        onPrintList={() => void Promise.resolve(inventory.sectionPrintHandler())}
        onPrintByCategory={() => void Promise.resolve(inventory.printInventoryByCategoryHandler())}
        onPrintByHighestValue={() => void Promise.resolve(inventory.printInventoryByHighestValueHandler())}
      />

      <InventorySectionTabs currentSection={currentSection} />

      {currentSection !== 'counts' ? (
        <div style={{ marginBottom: '16px' }}>
          <StatsGrid
            items={inventory.sectionSpotlightCards.map((card: { key: string; label: string; value: string | number }) => ({
              key: card.key,
              label: card.label,
              value: card.value,
            }))}
          />
        </div>
      ) : null}

      {inventory.copyFeedback ? <div className={inventory.copyFeedback.kind === 'error' ? 'warning-box' : 'success-box'}>{inventory.copyFeedback.text}</div> : null}

      {currentSection === 'overview' ? (
        <div className="inventory-overview-stack">
          <InventoryStatusCard
            statusFilter={inventory.statusFilter}
            onStatusFilterChange={inventory.setStatusFilter}
            locationFilter={inventory.locationFilter}
            onLocationFilterChange={inventory.setLocationFilter}
            categoryFilter={inventory.categoryFilter}
            onCategoryFilterChange={inventory.setCategoryFilter}
            supplierFilter={inventory.supplierFilter}
            onSupplierFilterChange={inventory.setSupplierFilter}
            locations={inventory.locations}
            categories={inventory.categories}
            suppliers={inventory.suppliers}
            search={inventory.search}
            onSearchChange={inventory.setSearch}
            onReset={inventory.resetInventoryView}
            rows={inventory.rows}
            isLoading={inventory.productsQuery.isLoading}
            isError={inventory.productsQuery.isError}
            error={inventory.productsQuery.error}
            includeSensitivePricing={inventory.canViewSensitivePricing}
            selectedProductId={selectedInventoryProduct?.product.id || ''}
            onProductSelect={(product) => setSelectedInventoryProduct({ product, token: Date.now() })}
          />

          <QuickStockAdjustmentDialog
            open={Boolean(selectedInventoryProduct)}
            onClose={() => setSelectedInventoryProduct(null)}
            product={selectedInventoryProduct?.product || null}
            branches={inventory.branches}
            locations={inventory.locations}
            locationStocks={Array.isArray(inventory.actionCatalog.locationStocksQuery.data) ? inventory.actionCatalog.locationStocksQuery.data : []}
            canManageInventory={inventory.canAdjustInventory}
          />
        </div>
      ) : null}

      {currentSection === 'transfers' ? (
        <>
          <TransferMonitorCard
            isLoading={inventory.transfersQuery.isLoading}
            isError={inventory.transfersQuery.isError}
            error={inventory.transfersQuery.error}
            visibleTransfers={inventory.visibleTransfers}
            pendingTransfersCount={inventory.pendingTransfers}
            transferTotalItems={inventory.transferSummary.totalItems}
            page={inventory.transfersQuery.data?.pagination.page || inventory.transfersPage}
            pageSize={inventory.transfersQuery.data?.pagination.pageSize || inventory.transfersPageSize}
            totalItems={inventory.transfersQuery.data?.pagination.totalItems || inventory.transferSummary.totalItems}
            onPageChange={inventory.setTransfersPage}
            onPageSizeChange={(value) => { inventory.setTransfersPageSize(value); inventory.setTransfersPage(1); }}
            selectedTransfer={inventory.selectedTransfer}
            selectedTransferTotals={inventory.selectedTransferTotals}
            transferFilter={inventory.transferFilter}
            onTransferFilterChange={inventory.setTransferFilter}
            onSelectTransfer={inventory.setSelectedTransferId}
            onCopyTransferDetails={() => void inventory.copyTransferDetails()}
            onPrintTransfer={(transfer, format) => printTransferDocument(transfer, { pageSize: format })}
            onExportTransfers={inventory.exportTransfersExcel}
            onReceiveTransfer={inventory.canAdjustInventory ? (transfer) => inventory.setTransferActionConfirm({ transfers: [transfer], action: 'receive' }) : undefined}
            onCancelTransfer={inventory.canAdjustInventory ? (transfer) => inventory.setTransferActionConfirm({ transfers: [transfer], action: 'cancel' }) : undefined}
            selectedTransferIds={inventory.selectedTransferIds}
            onSelectedTransferIdsChange={inventory.setSelectedTransferIds}
            onReceiveSelectedTransfers={inventory.receiveSelectedTransfers}
            onCancelSelectedTransfers={inventory.cancelSelectedTransfers}
          />

          <StockTransferSuccessDialog
            open={!!inventory.createdTransfer}
            transfer={inventory.createdTransfer}
            onClose={() => inventory.setCreatedTransfer(null)}
            onPrintA4={() => {
              if (inventory.createdTransfer) {
                printTransferDocument(inventory.createdTransfer, { pageSize: 'a4' });
              }
              inventory.setCreatedTransfer(null);
            }}
            onPrintReceipt={() => {
              if (inventory.createdTransfer) {
                printTransferDocument(inventory.createdTransfer, { pageSize: 'receipt' });
              }
              inventory.setCreatedTransfer(null);
            }}
          />
        </>
      ) : null}

      {currentSection === 'counts' ? (
        <div className="stock-count-view-container">
          <div className="stock-count-segmented-nav">
            <button
              type="button"
              className={`stock-count-segmented-btn ${countSubView === 'create' ? 'stock-count-segmented-btn--active' : ''}`}
              onClick={() => setCountSubView('create')}
            >
              <PlusCircleIcon size={16} />
              <span>{t('inventory.inventory_workspace.s0', "بدء جلسة جرد جديدة")}</span>
            </button>
            <button
              type="button"
              className={`stock-count-segmented-btn ${countSubView === 'history' ? 'stock-count-segmented-btn--active' : ''}`}
              onClick={() => {
                inventory.setSelectedSessionId('');
                setCountSubView('history');
              }}
            >
              <LayersIcon size={16} />
              <span>{t('inventory.inventory_workspace.s2', "سجل ومراجعة الجلسات")}</span>
              <span className="stock-count-segmented-badge">
                {inventory.stockCountSummary.totalItems}
              </span>
            </button>
          </div>

          {countSubView === 'create' ? (
            <StockCountComposerCard
              products={inventory.products}
              branches={inventory.branches}
              locations={inventory.locations}
              locationStocks={Array.isArray(inventory.actionCatalog.locationStocksQuery.data) ? inventory.actionCatalog.locationStocksQuery.data : undefined}
              isLoadingCatalog={inventory.actionCatalog.isLoading || inventory.actionCatalog.isError || inventory.actionCatalog.productsQuery.isLoading || inventory.actionCatalog.locationStocksQuery.isLoading}
              form={inventory.countForm}
              items={inventory.countItems}
              canReviewStock={inventory.canAdjustInventory}
              isPending={inventory.createCountMutation.isPending}
              isError={inventory.createCountMutation.isError}
              isSuccess={inventory.createCountMutation.isSuccess}
              error={inventory.createCountMutation.error}
              onFormChange={(patch) => inventory.setCountForm((current) => ({ ...current, ...patch }))}
              onItemsChange={inventory.setCountItems}
              onAddItem={inventory.addCountItem}
              onRemoveItem={(index) => inventory.setCountItems((current) => current.filter((_, currentIndex: number) => currentIndex !== index))}
              onSubmit={(options) => inventory.createCountMutation.mutate(options ?? {})}
            />
          ) : (
            <StockCountMonitorCard
              canReviewStock={inventory.canAdjustInventory}
              isLoading={inventory.stockCountQuery.isLoading || inventory.damagedQuery.isLoading}
              isError={inventory.stockCountQuery.isError || inventory.damagedQuery.isError}
              error={inventory.stockCountQuery.error || inventory.damagedQuery.error}
              stockCountSessions={inventory.stockCountSessions}
              damagedRecords={inventory.damagedRecords}
              sessionTotalItems={inventory.stockCountSummary.totalItems}
              page={inventory.stockCountQuery.data?.pagination.page || inventory.sessionsPage}
              pageSize={inventory.stockCountQuery.data?.pagination.pageSize || inventory.sessionsPageSize}
              totalItems={inventory.stockCountQuery.data?.pagination.totalItems || inventory.stockCountSummary.totalItems}
              onPageChange={inventory.setSessionsPage}
              onPageSizeChange={(value) => { inventory.setSessionsPageSize(value); inventory.setSessionsPage(1); }}
              selectedSession={inventory.selectedSession}
              selectedSessionTotals={inventory.selectedSessionTotals}
              sessionFilter={inventory.sessionFilter}
              postingPin={inventory.postingPin}
              postPending={inventory.postCountMutation.isPending}
              postError={inventory.postCountMutation.error}
              postSuccess={inventory.postCountMutation.isSuccess}
              transferSuccess={inventory.transferActionMutation.isSuccess}
              transferError={inventory.transferActionMutation.error}
              onSessionFilterChange={inventory.setSessionFilter}
              onPostingPinChange={inventory.setPostingPin}
              onSelectSession={inventory.setSelectedSessionId}
              onPostSession={inventory.canAdjustInventory ? (sessionId) => inventory.setPostSessionConfirm({ sessionIds: [sessionId] }) : undefined}
              onDeleteSession={inventory.deleteStockCountHandler}
              deletePending={inventory.deleteCountMutation?.isPending}
              onCopySessionDetails={() => void inventory.copySessionDetails()}
              onPrintCountSessions={inventory.printCountSessionsHandler}
              onPrintDamagedRecords={inventory.printDamagedRecordsHandler}
              onExportDamagedCsv={inventory.exportDamagedExcelHandler}
              onPrintSession={inventory.printStockCountDocument}
              selectedSessionIds={inventory.selectedSessionIds}
              onSelectedSessionIdsChange={inventory.setSelectedSessionIds}
              onPostSelectedSessions={inventory.postSelectedSessions}
              onStartNewCount={() => setCountSubView('create')}
              products={inventory.products}
            />
          )}
        </div>
      ) : null}

      {currentSection === 'damaged' ? (
        <DamagedStockCard
          damagedRecords={inventory.damagedRecords}
          totalItems={inventory.damagedSummary.totalItems}
          page={inventory.damagedQuery.data?.pagination.page || inventory.damagedPage}
          pageSize={inventory.damagedQuery.data?.pagination.pageSize || inventory.damagedPageSize}
          onPageChange={inventory.setDamagedPage}
          onPageSizeChange={(value) => { inventory.setDamagedPageSize(value); inventory.setDamagedPage(1); }}
          onPrintDamagedRecords={() => void inventory.printDamagedRecordsHandler()}
          onExportDamagedCsv={() => void inventory.exportDamagedExcelHandler()}
        />
      ) : null}

      {currentSection === 'movements' ? <InventoryMovementCard /> : null}

      <InventoryTransferActionDialog
        action={inventory.transferActionConfirm}
        isBusy={inventory.transferActionMutation.isPending}
        onCancel={() => inventory.setTransferActionConfirm(null)}
        onConfirm={(receipts, varianceReasons, approvalSecrets) => inventory.confirmTransferAction(receipts, varianceReasons, approvalSecrets)}
      />

      <InventoryPostSessionDialog
        sessions={inventory.postSessionConfirm ? inventory.stockCountSessions.filter((session) => inventory.postSessionConfirm?.sessionIds.includes(String(session.id))) : []}
        isBusy={inventory.postCountMutation.isPending}
        onCancel={() => inventory.setPostSessionConfirm(null)}
        onConfirm={(context) => void inventory.confirmPostSessionAction(context)}
      />
      </main>
    </div>
  );
}
