import { useEffect } from 'react';
import type { StockCountItem, StockTransferItem } from '@/types/domain';
import { useQueryClient } from '@tanstack/react-query';
import { useInventoryActionCatalog } from '@/features/inventory/hooks/useInventoryActionCatalog';
import { useInventoryPage } from '@/features/inventory/hooks/useInventoryPage';
import { useInventoryWorkspaceMutations } from '@/features/inventory/hooks/useInventoryWorkspaceMutations';
import { useInventoryWorkspaceQueries } from '@/features/inventory/hooks/useInventoryWorkspaceQueries';
import { createInventoryWorkspaceSectionActions } from '@/features/inventory/hooks/useInventoryWorkspaceSectionActions';
import { useInventoryWorkspaceSelection } from '@/features/inventory/hooks/useInventoryWorkspaceSelection';
import { useInventoryWorkspaceState } from '@/features/inventory/hooks/useInventoryWorkspaceState';
import { printTransferDocument } from '@/lib/inventory-printing';
import { findProduct, printStockCountDocument } from '@/features/inventory/lib/inventory-documents';
import {
  buildInventorySectionSpotlightCards,
  getInventorySectionDescription,
} from '@/features/inventory/lib/inventory-workspace.helpers';
import type { InventorySectionKey } from '@/features/inventory/pages/inventory.page-config';
import { useHasAnyPermission } from '@/shared/hooks/use-permission';
import { useSettingsQuery, useCategoriesQuery, useSuppliersQuery } from '@/shared/hooks/use-catalog-queries';
import { toast, systemConfirm } from '@/shared/components/system-alert';

export function useInventoryWorkspaceController(currentSection: InventorySectionKey) {
  const queryClient = useQueryClient();
  const state = useInventoryWorkspaceState();
  const { data: categories = [] } = useCategoriesQuery();
  const { data: suppliers = [] } = useSuppliersQuery();
  const { productsQuery, rows, inventory, pagination: inventoryPagination } = useInventoryPage(
    state.search,
    state.statusFilter,
    state.inventoryPage,
    state.inventoryPageSize,
    state.locationFilter,
    state.categoryFilter,
    state.supplierFilter,
  );
  const { transferFilter, sessionFilter, setTransfersPage, setSelectedTransferIds, setSelectedTransferId, setSessionsPage, setSelectedSessionIds, setSelectedSessionId } = state;
  const actionCatalog = useInventoryActionCatalog();
  const products = actionCatalog.productsQuery.data || [];
  const branches = actionCatalog.branchesQuery.data || [];
  const locations = actionCatalog.locationsQuery.data || [];
  const { data: settings } = useSettingsQuery();
  const { transfersQuery, stockCountQuery, damagedQuery, stockMovementsQuery } = useInventoryWorkspaceQueries(state);

  useEffect(() => {
    setTransfersPage(1);
    setSelectedTransferIds([]);
    setSelectedTransferId('');
  }, [transferFilter, setSelectedTransferId, setSelectedTransferIds, setTransfersPage]);

  useEffect(() => {
    setSessionsPage(1);
    setSelectedSessionIds([]);
    setSelectedSessionId('');
  }, [sessionFilter, setSelectedSessionId, setSelectedSessionIds, setSessionsPage]);

  const mutations = useInventoryWorkspaceMutations({
    queryClient,
    transferForm: state.transferForm,
    transferItems: state.transferItems,
    countForm: state.countForm,
    countItems: state.countItems,
    setTransferItems: state.setTransferItems,
    setTransferForm: state.setTransferForm,
    setCountItems: state.setCountItems,
    setCountForm: state.setCountForm,
    setPostingPin: state.setPostingPin,
    setSelectedTransferIds: state.setSelectedTransferIds,
    setSelectedSessionIds: state.setSelectedSessionIds,
    setCreatedTransfer: state.setCreatedTransfer,
  });

  const addTransferItem = () => {
    const product = findProduct(products, state.transferForm.productId);
    const qty = Number(state.transferForm.qty || 0);
    if (!product || !(qty > 0)) return;
    const serials = state.transferForm.serials.split(/[\n,،]+/).map(s => s.trim()).filter(Boolean);
    const lines = state.transferForm.batchAllocations.split(/[\n,،]+/).map(s => s.trim()).filter(Boolean);
    const batchAllocations = lines.map(line => {
      const match = /^(\d+)\s*:\s*(\d+(?:\.\d+)?)$/.exec(line);
      return match ? { batchId: Number(match[1]), qty: Number(match[2]) } : null;
    });
    if ((serials.length > 0 && (serials.length !== qty || new Set(serials.map(s => s.toLowerCase())).size !== serials.length)) ||
        batchAllocations.some(line => !line || !Number.isSafeInteger(line.batchId) || line.batchId <= 0 || line.qty <= 0) ||
        (batchAllocations.length > 0 && Math.abs(batchAllocations.reduce((sum, line) => sum + (line?.qty || 0), 0) - qty) > 0.0001)) {
      state.setCopyFeedback({ kind: 'error', text: 'عدد السيريالات أو توزيع كميات التشغيلات لا يطابق الكمية المراد نقلها' });
      return;
    }
    state.setTransferItems((current: StockTransferItem[]) => [...current, {
      id: `${product.id}-${Date.now()}`, productId: product.id, productName: product.name, qty,
      ...(serials.length ? { serials } : {}),
      ...(batchAllocations.length ? { batchAllocations: batchAllocations as Array<{ batchId: number; qty: number }> } : {}),
    }]);
    state.setTransferForm((current) => ({ ...current, productId: '', qty: '1', serials: '', batchAllocations: '' }));
  };

  const addCountItem = () => {
    const product = findProduct(products, state.countForm.productId);
    const countedQty = Number(state.countForm.countedQty || 0);
    if (!product || !Number.isFinite(countedQty) || countedQty < 0) return;
    const locationId = String(state.countForm.locationId || '');
    const stocks = actionCatalog.locationStocksQuery.data;
    if (!locationId || !Array.isArray(stocks)) {
      toast.warning('حدد مخزن الجرد وتأكد من تحميل أرصدته قبل إضافة الصنف');
      return;
    }
    const snapshot = stocks.find((row) => String(row.productId) === String(product.id) &&
      String(row.locationId) === locationId);
    const expectedQty = Number(snapshot?.qty || 0);
    state.setCountItems((current: StockCountItem[]) => [...current, {
      id: `${product.id}-${Date.now()}`,
      productId: product.id,
      productName: product.name,
      expectedQty,
      countedQty,
      varianceQty: Number((countedQty - expectedQty).toFixed(3)),
      isCounted: true,
      reason: state.countForm.reason,
      note: state.countForm.itemNote,
    }]);
    state.setCountForm((current) => ({ ...current, productId: '', countedQty: '0', itemNote: '' }));
  };

  const visibleTransfers = transfersQuery.data?.rows || [];
  const stockCountSessions = stockCountQuery.data?.rows || [];
  const transferSummary = transfersQuery.data?.summary || { totalItems: 0, sent: 0, received: 0, cancelled: 0, totalQty: 0 };
  const stockCountSummary = stockCountQuery.data?.summary || { totalItems: 0, draft: 0, posted: 0, totalVariance: 0 };
  const damagedRecords = damagedQuery.data?.rows || [];
  const damagedSummary = damagedQuery.data?.summary || { totalItems: 0, totalQty: 0 };
  const stockMovements = stockMovementsQuery.data || [];
  const pendingTransfers = transferSummary.sent || 0;

  const { selectedTransfer, selectedSession, selectedTransferTotals, selectedSessionTotals } = useInventoryWorkspaceSelection({
    visibleTransfers,
    stockCountSessions,
    selectedTransferId: state.selectedTransferId,
    selectedSessionId: state.selectedSessionId,
  });

  const resetInventoryView = () => {
    state.setSearch('');
    state.setStatusFilter('all');
    state.setLocationFilter('');
    state.setCategoryFilter('');
    state.setSupplierFilter('');
    state.setTransferFilter('all');
    state.setSessionFilter('all');
    state.setSelectedTransferId('');
    state.setSelectedSessionId('');
    state.setSelectedTransferIds([]);
    state.setSelectedSessionIds([]);
  };

  const canAdjustInventory = useHasAnyPermission('canAdjustInventory');
  const canPrint = useHasAnyPermission('canPrint');
  const canViewSensitivePricing = useHasAnyPermission(['canViewProfit', 'accounts', 'reports', 'purchases', 'settings', 'canManageSettings']);

  const sectionActions = createInventoryWorkspaceSectionActions({
    currentSection,
    rows,
    inventory,
    transferSummary,
    stockCountSummary,
    damagedSummary,
    stockMovements,
    selectedTransfer,
    selectedTransferTotals,
    selectedSession,
    selectedSessionTotals,
    transferFilter: state.transferFilter,
    sessionFilter: state.sessionFilter,
    setCopyFeedback: state.setCopyFeedback,
    canViewSensitivePricing,
    settings,
    locationFilter: state.locationFilter,
    locations,
  });

  const sectionDescription = getInventorySectionDescription(currentSection);
  const sectionSpotlightCards = buildInventorySectionSpotlightCards({
    currentSection,
    inventory,
    pendingTransfers,
    transferSummary,
    selectedTransfer,
    stockCountSummary,
    damagedSummary,
    damagedRecordsLength: damagedRecords.length,
    stockMovementsLength: stockMovements.length,
    inventoryValue: canViewSensitivePricing ? inventory.inventoryValue : null,
  });

  const hasRows = currentSection === 'overview'
    ? Boolean(rows.length)
    : currentSection === 'transfers'
      ? Boolean(transferSummary.totalItems)
      : currentSection === 'counts'
        ? Boolean(stockCountSummary.totalItems)
        : currentSection === 'damaged'
          ? Boolean(damagedSummary.totalItems)
          : Boolean(stockMovements.length);

  async function confirmTransferAction(receiptItems?: Record<string, Array<{
    itemId: number; receivedQty: number; receivedSerials?: string[];
    batchReceipts?: Array<{ transitBatchId: number; receivedQty: number }>;
  }>>, varianceReasons?: Record<string, string>) {
    if (!state.transferActionConfirm) return;
    await mutations.transferActionMutation.mutateAsync({
      transferIds: state.transferActionConfirm.transfers.map((entry) => String(entry.id)),
      action: state.transferActionConfirm.action,
      receiptItems,
      varianceReasons,
    });
    state.setTransferActionConfirm(null);
  }

  async function confirmPostSessionAction(context?: { managerPin?: string }) {
    if (!state.postSessionConfirm) return;
    const pin = context?.managerPin || state.postingPin;
    try {
      await mutations.postCountMutation.mutateAsync({ sessionIds: state.postSessionConfirm.sessionIds, managerPin: pin });
      state.setPostSessionConfirm(null);
      toast.success('تم اعتماد وترحيل جلسة الجرد وتسوية الفروقات بنجاح.');
    } catch (err: any) {
      toast.error(err?.message || 'تعذر اعتماد وترحيل جلسة الجرد.');
      throw err;
    }
  }

  const receiveSelectedTransfers = canAdjustInventory && state.selectedTransferIds.length
    ? () => {
      const selected = visibleTransfers.filter((transfer) => state.selectedTransferIds.includes(String(transfer.id)) && transfer.status === 'sent');
      if (selected.length) state.setTransferActionConfirm({ transfers: selected, action: 'receive' });
    }
    : undefined;
  const cancelSelectedTransfers = canAdjustInventory && state.selectedTransferIds.length
    ? () => {
      const selected = visibleTransfers.filter((transfer) => state.selectedTransferIds.includes(String(transfer.id)) && transfer.status === 'sent');
      if (selected.length) state.setTransferActionConfirm({ transfers: selected, action: 'cancel' });
    }
    : undefined;
  const postSelectedSessions = canAdjustInventory && state.selectedSessionIds.length
    ? () => {
      const selected = stockCountSessions.filter((session) => state.selectedSessionIds.includes(String(session.id)) && (session.status === 'draft' || session.status === 'posting'));
      if (selected.length) state.setPostSessionConfirm({ sessionIds: selected.map((session) => String(session.id)) });
    }
    : undefined;

  const deleteStockCountHandler = canAdjustInventory
    ? async (sessionId: string, docNo?: string) => {
      const session = stockCountSessions.find((s) => String(s.id) === String(sessionId));
      if (session && session.status !== 'draft' && session.status !== 'posting') {
        toast.error('لا يمكن حذف أو إلغاء جلسة جرد معتمدة ومرحلة إلى المخازن والحسابات.');
        return;
      }

      const code = docNo || session?.docNo || sessionId;
      const confirmed = await systemConfirm({
        title: 'تأكيد إلغاء / حذف مسودة جلسة الجرد',
        message: `هل أنت متأكد من حذف مسودة جلسة الجرد (${code}) نهائياً؟ لن يتم تطبيق أي تعديلات على المخزون أو القيود المحاسبية.`,
        confirmText: 'نعم، حذف المسودة',
        cancelText: 'تراجع',
        variant: 'danger',
      });

      if (!confirmed) return;

      try {
        await mutations.deleteCountMutation.mutateAsync(sessionId);
        if (String(state.selectedSessionId) === String(sessionId)) {
          state.setSelectedSessionId('');
        }
        state.setSelectedSessionIds((prev) => prev.filter((id) => String(id) !== String(sessionId)));
        toast.success('تم حذف مسودة جلسة الجرد بنجاح.');
      } catch (err: any) {
        toast.error(err?.message || 'تعذر حذف مسودة جلسة الجرد.');
      }
    }
    : undefined;

  return {
    search: state.search,
    setSearch: state.setSearch,
    statusFilter: state.statusFilter,
    setStatusFilter: state.setStatusFilter,
    transferFilter: state.transferFilter,
    setTransferFilter: state.setTransferFilter,
    sessionFilter: state.sessionFilter,
    setSessionFilter: state.setSessionFilter,
    productsQuery,
    rows,
    inventory,
    actionCatalog,
    products,
    branches,
    locations,
    transferForm: state.transferForm,
    setTransferForm: state.setTransferForm,
    transferItems: state.transferItems,
    setTransferItems: state.setTransferItems,
    countForm: state.countForm,
    setCountForm: state.setCountForm,
    countItems: state.countItems,
    setCountItems: state.setCountItems,
    postingPin: state.postingPin,
    setPostingPin: state.setPostingPin,
    transferActionConfirm: state.transferActionConfirm,
    setTransferActionConfirm: state.setTransferActionConfirm,
    postSessionConfirm: state.postSessionConfirm,
    setPostSessionConfirm: state.setPostSessionConfirm,
    copyFeedback: state.copyFeedback,
    selectedTransferIds: state.selectedTransferIds,
    setSelectedTransferIds: state.setSelectedTransferIds,
    selectedSessionIds: state.selectedSessionIds,
    setSelectedSessionIds: state.setSelectedSessionIds,
    createdTransfer: state.createdTransfer,
    setCreatedTransfer: state.setCreatedTransfer,
    createTransferMutation: mutations.createTransferMutation,
    transferActionMutation: mutations.transferActionMutation,
    createCountMutation: mutations.createCountMutation,
    postCountMutation: mutations.postCountMutation,
    deleteCountMutation: mutations.deleteCountMutation,
    deleteStockCountHandler,
    addTransferItem,
    addCountItem,
    visibleTransfers,
    transferSummary,
    pendingTransfers,
    stockCountSessions,
    stockCountSummary,
    damagedRecords,
    damagedSummary,
    stockMovements,
    selectedTransfer,
    selectedSession,
    selectedTransferTotals,
    selectedSessionTotals,
    locationFilter: state.locationFilter,
    setLocationFilter: state.setLocationFilter,
    categoryFilter: state.categoryFilter,
    setCategoryFilter: state.setCategoryFilter,
    supplierFilter: state.supplierFilter,
    setSupplierFilter: state.setSupplierFilter,
    categories,
    suppliers,
    resetInventoryView,
    canAdjustInventory,
    canPrint,
    canViewSensitivePricing,
    sectionDescription,
    sectionSpotlightCards,
    hasRows,
    confirmTransferAction,
    confirmPostSessionAction,
    transfersQuery,
    transfersPage: state.transfersPage,
    setTransfersPage: state.setTransfersPage,
    transfersPageSize: state.transfersPageSize,
    setTransfersPageSize: state.setTransfersPageSize,
    setSelectedTransferId: state.setSelectedTransferId,
    printTransferDocument,
    receiveSelectedTransfers,
    cancelSelectedTransfers,
    stockCountQuery,
    damagedQuery,
    sessionsPage: state.sessionsPage,
    setSessionsPage: state.setSessionsPage,
    sessionsPageSize: state.sessionsPageSize,
    setSessionsPageSize: state.setSessionsPageSize,
    setSelectedSessionId: state.setSelectedSessionId,
    printStockCountDocument,
    postSelectedSessions,
    damagedPage: state.damagedPage,
    setDamagedPage: state.setDamagedPage,
    damagedPageSize: state.damagedPageSize,
    setDamagedPageSize: state.setDamagedPageSize,
    inventoryPagination,
    inventoryPage: state.inventoryPage,
    setInventoryPage: state.setInventoryPage,
    inventoryPageSize: state.inventoryPageSize,
    setInventoryPageSize: state.setInventoryPageSize,
    ...sectionActions,
  };
}
