import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useSearchParams } from 'react-router-dom';
import { invalidateReturnsDomain } from '@/app/query-invalidation';
import { ActionConfirmDialog } from '@/shared/components/action-confirm-dialog';
import { DialogShell } from '@/shared/components/dialog-shell';
import { StatsGrid } from '@/shared/components/stats-grid';
import { Button } from '@/shared/ui/button';
import { returnsApi } from '@/features/returns/api/returns.api';
import { useReturnsPage } from '@/features/returns/hooks/useReturnsPage';
import { catalogApi } from '@/lib/api/catalog';
import { ReturnsSelectedReturnCard } from '@/features/returns/components/ReturnsSelectedReturnCard';
import { ReturnsWorkspaceHeader } from '@/features/returns/components/ReturnsWorkspaceHeader';
import { ReturnsCreateModal } from '@/features/returns/components/ReturnsCreateModal';
import { ReturnsRegisterCard } from '@/features/returns/components/ReturnsRegisterCard';
import { ReturnsAnomalyRadarCard } from '@/features/returns/components/ReturnsAnomalyRadarCard';
import { detectReturnsAnomalies } from '@/features/returns/lib/returns-anomaly-detector';
import {
  createEmptyReturnForm,
  exportReturnsCsv,
  getReturnDateValue,
  printReturnRecord,
  printReturnsRegister,
  ReturnFormState,
  returnTypeLabel,
} from '@/features/returns/lib/returns-workspace.helpers';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Purchase, PurchaseItem, Sale, SaleItem } from '@/types/domain';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { remainingInvoiceLineQuantity, isSelectedReturnQuantityValid } from '@/features/returns/lib/return-remaining-quantity';
import { findReturnInRegisterOrRadar } from '@/features/returns/lib/return-radar-selection';
import { buildReturnRegisterExportQuery } from '@/features/returns/lib/return-register-export-query';
import { mayReleaseReturnIdempotencyKey, wasReturnCommitted } from '@/features/returns/lib/return-submission-recovery';
import { toast } from '@/shared/components/system-alert';
import { useAuthStore } from '@/stores/auth-store';

export function ReturnsWorkspace() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isPurchaseMode = location.pathname.includes('purchase-returns');

  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'register' | 'radar'>('register');
  const [viewFilter, setViewFilter] = useState<'all' | 'sales' | 'purchase' | 'today'>(isPurchaseMode ? 'purchase' : 'all');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [selectedReturnId, setSelectedReturnId] = useState('');
  const [copyFeedback, setCopyFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [confirmReturn, setConfirmReturn] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState<ReturnFormState>(() => createEmptyReturnForm(isPurchaseMode ? 'purchase' : 'sale'));
  const [selectedItems, setSelectedItems] = useState<Record<string, string>>({});
  const [selectedSerials, setSelectedSerials] = useState<Record<string, string>>({});
  const [returnOutcomeUncertain, setReturnOutcomeUncertain] = useState(false);
  // The exact payload and key survive HTTP failures within this mounted workspace.
  // Never generate a new key when a refund may already have committed.
  const returnAttempt = useRef<{ key: string; payload: Record<string, unknown> } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const query = useReturnsPage({ page, pageSize, search, filter: viewFilter, employee: employeeFilter });
  const salesQuery = useQuery({ queryKey: ['sales'], queryFn: catalogApi.listSales });
  const purchasesQuery = useQuery({ queryKey: ['purchases'], queryFn: catalogApi.listPurchases });
  const settingsQuery = useSettingsQuery();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canDirectReturn = user?.role === 'super_admin' || user?.role === 'admin' || Boolean(user?.permissions?.includes('canDirectReturn'));

  const invoiceRows = useMemo(() => {
    const rawSales: Sale[] = Array.isArray(salesQuery.data)
      ? salesQuery.data
      : Array.isArray((salesQuery.data as any)?.rows)
      ? (salesQuery.data as any).rows
      : Array.isArray((salesQuery.data as any)?.sales)
      ? (salesQuery.data as any).sales
      : [];

    const rawPurchases: Purchase[] = Array.isArray(purchasesQuery.data)
      ? purchasesQuery.data
      : Array.isArray((purchasesQuery.data as any)?.rows)
      ? (purchasesQuery.data as any).rows
      : Array.isArray((purchasesQuery.data as any)?.purchases)
      ? (purchasesQuery.data as any).purchases
      : [];

    return form.type === 'sale'
      ? rawSales.filter((sale) => sale.status === 'posted')
      : rawPurchases.filter((purchase) => purchase.status === 'posted');
  }, [form.type, purchasesQuery.data, salesQuery.data]);

  const selectedInvoice = invoiceRows.find((row) => String(row.id) === String(form.invoiceId) || (Boolean(row.docNo) && String(row.docNo).toLowerCase() === String(form.invoiceId).toLowerCase())) as Sale | Purchase | undefined;
  const rows = useMemo(() => query.data?.returns || [], [query.data?.returns]);
  // Radar is independent of the register's page and user-applied filters.
  // Load its full sale-return history only when the radar tab is visited.
  const radarQuery = useQuery({
    queryKey: ['returns', 'radar-all-sales'],
    queryFn: () => returnsApi.listAll({ filter: 'sales' }),
    enabled: activeTab === 'radar',
    staleTime: 30_000,
  });
  const radarRows = useMemo(() => radarQuery.data?.returns || [], [radarQuery.data?.returns]);
  const invoiceItems = useMemo(() => (selectedInvoice?.items || []) as Array<SaleItem | PurchaseItem>, [selectedInvoice?.items]);
  const invoiceReturnQuantitiesQuery = useQuery({
    queryKey: ['returns-invoice-quantities', form.type, selectedInvoice?.id],
    queryFn: () => returnsApi.getInvoiceReturnedQuantities(form.type, selectedInvoice!.id),
    enabled: isCreateOpen && Boolean(selectedInvoice?.id),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const returnedQtyByLine = invoiceReturnQuantitiesQuery.data?.returnedQtyByLine || {};
  const blockedProductIds = invoiceReturnQuantitiesQuery.data?.blockedProductIds || [];
  const returnHistoryReady = Boolean(selectedInvoice && invoiceReturnQuantitiesQuery.isSuccess && !invoiceReturnQuantitiesQuery.isFetching);
  // T10-D: the expected refund comes from the backend relief preview
  // (the same computeSalesReturnRelief createSaleReturn uses), never
  // from a second local copy of the ratio. The preview only exists
  // for sale returns; purchase returns keep the lines total.
  // (selectedReturnItems is declared just above: the preview block
  // reads it, so it must precede this block — TDZ otherwise.)
  const selectedReturnItems = useMemo(() => invoiceItems
    .map((item) => {
      const lineId = String(item.id || item.productId || '');
      const qty = Number(selectedItems[lineId] || 0);
      const baseQty = Number(item.qty || 0);
      const lineTotal = qty > 0 ? qty * (baseQty > 0 ? Number(item.total || 0) / baseQty : 0) : 0;
      return { item, qty, lineTotal };
    })
    .filter((entry) => entry.qty > 0), [invoiceItems, selectedItems]);

  const reliefPreviewItemsKey = selectedReturnItems.map(({ item, qty }) => `${item.id || item.productId}:${qty}`).join(',');
  const reliefPreviewQuery = useQuery({
    queryKey: ['returns-relief-preview', form.type, selectedInvoice?.id, reliefPreviewItemsKey],
    queryFn: () => returnsApi.preview({
      type: form.type,
      invoiceId: Number(selectedInvoice!.id),
      items: selectedReturnItems.map(({ item, qty }) => ({
        productId: Number(item.productId || 0),
        productName: item.name,
        qty,
        saleItemId: form.type === 'sale' ? Number(item.id || 0) : undefined,
        purchaseItemId: form.type === 'purchase' ? Number(item.id || 0) : undefined,
      })),
    }),
    enabled: isCreateOpen && form.type === 'sale' && Boolean(selectedInvoice?.id) && selectedReturnItems.length > 0,
    staleTime: 0,
  });
  const reliefPreview = form.type === 'sale' ? reliefPreviewQuery.data : undefined;
  const isReliefPreviewLoading = Boolean(isCreateOpen && form.type === 'sale' && selectedReturnItems.length > 0 && reliefPreviewQuery.isFetching);
  const settlementNeedsRefundMethod = form.settlementMode === 'refund';
  const canUseCreditSettlement = form.type === 'sale' && Boolean(selectedInvoice && 'customerId' in selectedInvoice && selectedInvoice.customerId);

  const returnQuantitiesValid = selectedReturnItems.length > 0 && selectedReturnItems.every(({ item, qty }) =>
    isSelectedReturnQuantityValid(String(item.id || ''), String(item.productId || ''),
      Number(item.qty || 0), qty, returnedQtyByLine, blockedProductIds, returnHistoryReady));
  const selectedItemsCount = selectedReturnItems.length;
  const selectedQtyTotal = selectedReturnItems.reduce((sum, entry) => sum + Number(entry.qty || 0), 0);
  const linesReturnValue = selectedReturnItems.reduce((sum, entry) => sum + Number(entry.lineTotal || 0), 0);
  // T10-D: with a preview the expected refund is what the backend
  // will actually pay (goods + relief); without one (purchase
  // returns, or before the preview lands) it stays the lines total.
  const expectedReturnValue = reliefPreview ? Number(reliefPreview.refundTotal || 0) : linesReturnValue;
  // Manager approval is required only for a large cash refund; the
  // backend enforces the same threshold authoritatively.
  const largeCashRefundThreshold = Number((settingsQuery.data as any)?.posLargeCashRefundThreshold ?? 500);
  const needsManagerApprovalForReturn = !canDirectReturn && form.settlementMode === 'refund' && form.refundMethod === 'cash' && expectedReturnValue >= largeCashRefundThreshold;

  const summary = query.data?.summary;
  const salesReturns = Number(summary?.salesReturns || 0);
  const purchaseReturns = Number(summary?.purchaseReturns || 0);
  const total = Number(summary?.totalAmount || 0);
  const selectedReturn = findReturnInRegisterOrRadar(selectedReturnId, rows, radarRows);

  useEffect(() => {
    if (selectedReturnId && !findReturnInRegisterOrRadar(selectedReturnId, rows, radarRows)) {
      setSelectedReturnId('');
      setPage(1);
    }
  }, [rows, radarRows, selectedReturnId]);

  useEffect(() => {
    setViewFilter(isPurchaseMode ? 'purchase' : 'all');
    if (returnAttempt.current) return;
    setForm(current => {
      const nextType = isPurchaseMode ? 'purchase' : 'sale';
      if (current.type !== nextType) {
        return { ...createEmptyReturnForm(), type: nextType };
      }
      return current;
    });
    setSelectedItems({});
  }, [isPurchaseMode]);

  useEffect(() => {
    const targetInvoiceId = searchParams.get('invoiceId') || searchParams.get('docNo');
    if (targetInvoiceId) {
      setForm((current) => ({
        ...current,
        type: isPurchaseMode ? 'purchase' : 'sale',
        invoiceId: String(targetInvoiceId),
      }));
      setIsCreateOpen(true);
    }
  }, [searchParams, isPurchaseMode]);

  useEffect(() => {
    if (selectedInvoice && form.invoiceId !== String(selectedInvoice.id)) {
      setForm((current) => ({
        ...current,
        invoiceId: String(selectedInvoice.id),
      }));
    }
  }, [selectedInvoice, form.invoiceId]);

  const createMutation = useMutation({
    mutationFn: async ({ managerPin, reason }: { managerPin?: string; reason: string }) => {
      // A confirmed retry must use its frozen payload; a fresh request must
      // revalidate the complete invoice quantities after any refetch.
      if (!returnAttempt.current && !returnQuantitiesValid) {
        throw new Error('رصيد المرتجع تغير أو لم يتم تأكيده. راجع الكميات قبل الحفظ.');
      }
      if (!returnAttempt.current) {
        const payload = {
          type: form.type,
          invoiceId: Number(selectedInvoice?.id || form.invoiceId),
          items: selectedReturnItems.map(({ item, qty }) => ({
            productId: Number(item.productId || 0),
            productName: item.name,
            qty,
            saleItemId: form.type === 'sale' ? Number(item.id || 0) : undefined,
            serials: form.type === 'sale' ? (selectedSerials[String(item.id || item.productId || '')] || '').split(/[\\s,;]+/).filter(Boolean) : undefined,
            purchaseItemId: form.type === 'purchase' ? Number(item.id || 0) : undefined,
          })),
          settlementMode: form.settlementMode,
          refundMethod: form.refundMethod,
          note: [reason.trim(), String(form.note || '').trim()].filter(Boolean).join(' — '),
          managerPin,
        };
        returnAttempt.current = { key: crypto.randomUUID(), payload };
      }
      const attempt = returnAttempt.current;
      try {
        return await returnsApi.create(attempt.payload, { 'x-idempotency-key': attempt.key });
      } catch (error) {
        let status = 'unknown';
        let documentId: string | null | undefined;
        try {
          const operation = await returnsApi.getReturnOperationStatus(attempt.key);
          status = operation.status;
          documentId = operation.documentId;
        } catch {
          // A missing status response is not proof of no financial posting.
        }
        if (wasReturnCommitted(status, documentId)) {
          return { ok: true, recovered: true };
        }
        const httpStatus = error && typeof error === 'object' && 'status' in error
          ? Number((error as { status?: number }).status) : 0;
        if (mayReleaseReturnIdempotencyKey(httpStatus, status)) {
          returnAttempt.current = null;
          setReturnOutcomeUncertain(false);
          throw error;
        }
        setReturnOutcomeUncertain(true);
        throw new Error('نتيجة المرتجع غير مؤكدة. لا تنشئ مرتجعًا جديدًا؛ أعد تأكيد نفس الطلب للتحقق من حالته');
      }
    },
    onSuccess: async () => {
      returnAttempt.current = null;
      setReturnOutcomeUncertain(false);
      await invalidateReturnsDomain(queryClient);
      await queryClient.invalidateQueries({ queryKey: ['returns-invoice-quantities'] });
      setForm(createEmptyReturnForm(isPurchaseMode ? 'purchase' : 'sale'));
      setSelectedItems({});
      setSelectedSerials({});
      setConfirmReturn(false);
      setIsCreateOpen(false);
    },
  });

  const resetReturnsView = () => {
    setSearch('');
    setViewFilter('all');
    setEmployeeFilter('');
    setSelectedReturnId('');
    setPage(1);
  };

  const resetReturnForm = () => {
    if (returnAttempt.current) {
      toast.warning('يجب التحقق من نتيجة المرتجع السابق قبل مسح الطلب');
      return;
    }
    setForm(createEmptyReturnForm(isPurchaseMode ? 'purchase' : 'sale'));
    setSelectedItems({});
    setSelectedSerials({});
  };

  const updateForm = (updater: (current: ReturnFormState) => ReturnFormState) => {
    if (returnAttempt.current) return;
    setForm((current) => {
      const next = updater(current);
      if (next.type !== current.type || next.invoiceId !== current.invoiceId) {
        setSelectedItems({});
        setSelectedSerials({});
      }
      return next;
    });
  };

  const toggleItem = (itemId: string, checked: boolean) => {
    if (returnAttempt.current) return;
    setSelectedItems((current) => {
      const next = { ...current };
      if (!checked) {
        delete next[itemId];
        return next;
      }
      next[itemId] = next[itemId] || '1';
      return next;
    });
  };

  const setItemQty = (itemId: string, value: string) => {
    if (returnAttempt.current) return;
    const invoiceItem = invoiceItems.find((item) => String(item.id || item.productId || '') === String(itemId));
    if (!invoiceItem) return;
    const productId = String(invoiceItem.productId || '');
    const alreadyReturnedQty = Number(returnedQtyByLine[itemId] || 0);
    const remainingQty = remainingInvoiceLineQuantity(Number(invoiceItem.qty || 0),
      alreadyReturnedQty, returnHistoryReady, blockedProductIds.includes(productId));
    const requestedQty = Number(value || 0);
    if (requestedQty > remainingQty) {
      setSelectedItems((current) => ({ ...current, [itemId]: String(remainingQty) }));
      return;
    }
    setSelectedItems((current) => ({ ...current, [itemId]: value }));
  };

  const copyReturnsSummary = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    const lines = [
      t('returns.summary', 'ملخص المرتجعات'),
      `${t('returns.summary_total', 'إجمالي المرتجعات المطابقة')}: ${summary?.totalItems || 0}`,
      `${t('returns.stats.sales', 'مرتجع بيع')}: ${salesReturns}`,
      `${t('returns.stats.purchase', 'مرتجع شراء')}: ${purchaseReturns}`,
      `${t('returns.stats.amount', 'إجمالي القيمة')}: ${formatCurrency(total)}`
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopyFeedback({ kind: 'success', text: t('returns.copy_summary_success', 'تم نسخ ملخص المرتجعات.') });
    } catch {
      setCopyFeedback({ kind: 'error', text: t('returns.copy_summary_error', 'تعذر نسخ ملخص المرتجعات.') });
    }
  };

  const copySelectedReturn = async () => {
    if (!selectedReturn || typeof navigator === 'undefined' || !navigator.clipboard) return;
    const lines = [
      `${t('returns.col_doc_no', 'المستند')}: ${selectedReturn.docNo || selectedReturn.id}`,
      `${t('returns.col_type', 'النوع')}: ${returnTypeLabel(selectedReturn, t)}`,
      `${t('returns.col_product', 'الصنف')}: ${selectedReturn.productName || '—'}`,
      `${t('returns.col_qty', 'الكمية')}: ${selectedReturn.qty || 0}`,
      `${t('returns.col_total', 'الإجمالي')}: ${formatCurrency(Number(selectedReturn.total || 0))}`,
      `${t('returns.col_date', 'التاريخ')}: ${formatDate(getReturnDateValue(selectedReturn))}`,
      `${t('returns.col_note', 'الملاحظات')}: ${selectedReturn.note || '—'}`
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopyFeedback({ kind: 'success', text: t('returns.copy_selected_success', 'تم نسخ تفاصيل المرتجع المحدد.') });
    } catch {
      setCopyFeedback({ kind: 'error', text: t('returns.copy_selected_error', 'تعذر نسخ تفاصيل المرتجع المحدد.') });
    }
  };

  const printReturns = async () => {
    const payload = await returnsApi.listAll(buildReturnRegisterExportQuery({ search, filter: viewFilter, employee: employeeFilter }));
    printReturnsRegister(payload.returns || [], { totalItems: payload.summary?.totalItems, totalAmount: payload.summary?.totalAmount });
  };

  const handleRegisterSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleFilterChange = (value: 'all' | 'sales' | 'purchase' | 'today') => {
    setViewFilter(value);
    setPage(1);
  };

  const stats = [
    { key: 'total', label: t('returns.stats.total', 'إجمالي المرتجعات'), value: summary?.totalItems || 0 },
    { key: 'sales', label: t('returns.stats.sales', 'مرتجع بيع'), value: salesReturns },
    { key: 'purchase', label: t('returns.stats.purchase', 'مرتجع شراء'), value: purchaseReturns },
    { key: 'amount', label: t('returns.stats.amount', 'إجمالي القيمة'), value: formatCurrency(total) },
  ] as const;

  const anomalySummary = useMemo(() => {
    return detectReturnsAnomalies(radarRows, salesQuery.data || []);
  }, [radarRows, salesQuery.data]);

  return (
    <div className="page-stack page-shell returns-workspace" dir={i18n.dir()}>
      <main className="document-prototype-column" style={{ paddingBottom: '32px' }}>
        <ReturnsWorkspaceHeader
          totalItems={summary?.totalItems || 0}
          salesReturns={salesReturns}
          purchaseReturns={purchaseReturns}
          copyFeedback={copyFeedback}
          onReset={resetReturnsView}
          onCopySummary={copyReturnsSummary}
          onExportCsv={() => exportReturnsCsv({ search, filter: viewFilter, employee: employeeFilter })}
          onPrint={printReturns}
          onOpenCreate={() => setIsCreateOpen(true)}
        />

        {/* Workspace Mode Switcher */}
        <div className="filter-chip-row" style={{ marginBottom: '14px' }}>
          <Button
            variant={activeTab === 'register' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('register')}
          >
            {t('returns.tabs.register', 'سجل المرتجعات')} ({summary?.totalItems || rows.length})
          </Button>
          <Button
            variant={activeTab === 'radar' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('radar')}
          >
            {t('returns.tabs.radar', 'رقابة وتدقيق الشبهات')}
            {radarQuery.isSuccess && anomalySummary.totalSuspectReturnsCount > 0 ? ` (${anomalySummary.totalSuspectReturnsCount})` : ''}
          </Button>
        </div>

        {activeTab === 'register' ? (
          <>
            <StatsGrid items={stats} className="stats-grid compact-grid grid-cols-4" />

            <ReturnsRegisterCard
              search={search}
              viewFilter={viewFilter}
              page={page}
              pageSize={pageSize}
              rows={rows}
              totalItems={summary?.totalItems || rows.length}
              selectedReturnId={selectedReturnId}
              isLoading={query.isLoading}
              onSearchChange={handleRegisterSearchChange}
              onReset={resetReturnsView}
              onFilterChange={handleFilterChange}
              employeeFilter={employeeFilter}
              onEmployeeFilterChange={(value) => { setEmployeeFilter(value); setPage(1); }}
              onSelectReturn={(id) => setSelectedReturnId(id)}
              onPrintReturn={(row) => printReturnRecord(row, settingsQuery.data)}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        ) : (
          radarQuery.isLoading ? (
            <div role="status" className="surface-note">جارٍ تحميل سجل مرتجعات البيع الكامل للتحليل الرقابي...</div>
          ) : radarQuery.isError ? (
            <div role="alert" className="surface-note">
              تعذر تحميل سجل المرتجعات الكامل. لن نعرض نتائج رقابة ناقصة.
              <Button variant="secondary" onClick={() => void radarQuery.refetch()}>إعادة المحاولة</Button>
            </div>
          ) : (
            <ReturnsAnomalyRadarCard
              returns={radarRows}
              sales={salesQuery.data || []}
              onSelectReturn={(id) => setSelectedReturnId(id)}
            />
          )
        )}

        {/* Premium Modal for Creating Return */}
        <ReturnsCreateModal
          isOpen={isCreateOpen}
          onClose={() => {
            if (returnAttempt.current) {
              toast.warning('لا تغلق طلب مرتجع لم تُؤكّد نتيجته؛ أعد المحاولة بنفس المفتاح');
              return;
            }
            setIsCreateOpen(false);
          }}
          form={form}
          invoiceRows={invoiceRows}
          selectedInvoice={selectedInvoice}
          invoiceItems={invoiceItems}
          selectedItems={selectedItems}
          selectedSerials={selectedSerials}
          selectedItemsCount={selectedItemsCount}
          selectedQtyTotal={selectedQtyTotal}
          expectedReturnValue={expectedReturnValue}
          reliefPreview={reliefPreview}
          isReliefPreviewLoading={isReliefPreviewLoading}
          canUseCreditSettlement={canUseCreditSettlement}
          settlementNeedsRefundMethod={settlementNeedsRefundMethod}
          isBusy={createMutation.isPending}
          isError={createMutation.isError}
          isSuccess={createMutation.isSuccess}
          error={createMutation.error}
          onFormChange={updateForm}
          onResetForm={resetReturnForm}
          onToggleItem={toggleItem}
          onSetItemQty={setItemQty}
          onSetSerials={(itemId, value) => { if (!returnAttempt.current) setSelectedSerials((current) => ({ ...current, [itemId]: value })); }}
          onOpenConfirm={() => {
            if ((returnHistoryReady && returnQuantitiesValid) || returnOutcomeUncertain) {
              setConfirmReturn(true);
            }
          }}
          returnedQtyByLine={returnedQtyByLine}
          blockedProductIds={blockedProductIds}
          returnHistoryReady={returnHistoryReady}
          returnQuantitiesValid={returnQuantitiesValid}
          canRetryUnresolved={returnOutcomeUncertain}
        />

        {/* Modal for Viewing Return Details */}
        <DialogShell
          open={Boolean(selectedReturnId && selectedReturn)}
          onClose={() => setSelectedReturnId('')}
          width="min(640px, 95vw)"
          ariaLabel={t('returns.details_title', 'تفاصيل المرتجع')}
          showCloseButton={true}
        >
          <div className="dialog-card">
            <ReturnsSelectedReturnCard
              selectedReturn={selectedReturn}
              onPrint={() => selectedReturn ? printReturnRecord(selectedReturn, settingsQuery.data) : undefined}
              onCopy={() => void copySelectedReturn()}
            />
          </div>
        </DialogShell>
      </main>

      <ActionConfirmDialog
        open={confirmReturn}
        title={form.type === 'sale' ? t('returns.confirm_sale_title', 'تأكيد مرتجع البيع') : t('returns.confirm_purchase_title', 'تأكيد مرتجع الشراء')}
        description={selectedInvoice ? t('returns.confirm_desc', 'سيتم إنشاء مرتجع على الفاتورة {{docNo}} بعدد {{count}} بند بقيمة متوقعة {{amount}}.', { docNo: selectedInvoice.docNo || selectedInvoice.id, count: selectedItemsCount, amount: formatCurrency(expectedReturnValue) }) : t('returns.confirm_desc_empty', 'راجع البيانات قبل حفظ المرتجع.')}
        confirmLabel={form.type === 'sale' ? t('returns.confirm_sale_action', 'تسجيل مرتجع البيع') : t('returns.confirm_purchase_action', 'تسجيل مرتجع الشراء')}
        confirmVariant="danger"
        reasonRequired
        reasonLabel={t('returns.reason_label', 'سبب المرتجع')}
        reasonPlaceholder={t('returns.reason_placeholder', 'اكتب سبب المرتجع')}
        reasonHint={t('returns.reason_hint', 'هذا السبب سيظهر في السجل ويُستخدم للمراجعة لاحقًا.')}
        minReasonLength={1}
        managerPinRequired={needsManagerApprovalForReturn}
        managerPinLabel={t('returns.manager_pin_label', 'رمز اعتماد المشرف / كلمة المرور')}
        managerPinHint={needsManagerApprovalForReturn ? t('returns.manager_pin_hint', 'المرتجع النقدي الكبير يتطلب اعتماد المشرف أو إدخال رمز المدير لإتمام المرتجع.') : undefined}
        isBusy={createMutation.isPending}
        onCancel={() => setConfirmReturn(false)}
        onConfirm={({ reason, managerPin }) => {
          if (!returnAttempt.current && !returnQuantitiesValid) {
            toast.warning('راجع كميات المرتجع بعد تحديث بيانات الفاتورة قبل الاعتماد');
            setConfirmReturn(false);
            return;
          }
          void createMutation.mutate({ reason, managerPin });
        }}
      />
    </div>
  );
}
