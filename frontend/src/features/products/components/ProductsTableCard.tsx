import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDownIcon, ChevronUpIcon } from '@/shared/components/icons/AppIcons';
import { QueryFeedback } from '@/shared/components/query-feedback';
import type { Product } from '@/types/domain';
import { productsApi } from '@/features/products/api/products.api';
import { guessProductIcon } from '@/features/products/lib/product-smart-matcher';
import { invalidateCatalogDomain } from '@/app/query-invalidation';

import { useProductIconSettings } from '@/shared/components/icons/product-icon-theme';
import {groupProducts, type ProductGroup} from './products-table-card/products-table-card-shared';
import { ProductsTableCardHeader } from './products-table-card/products-table-card-header';
import { ProductsTableCardAutoAssignMessage } from './products-table-card/products-table-card-auto-assign-message';
import { ProductsTableCardToolbar } from './products-table-card/products-table-card-toolbar';
import { ProductsTableCardBulkToolbar } from './products-table-card/products-table-card-bulk-toolbar';
import { ProductsTableCardTable } from './products-table-card/products-table-card-table';
import { ProductsTableCardPagination } from './products-table-card/products-table-card-pagination';
import { ProductsTableCardNoteModal } from './products-table-card/products-table-card-note-modal';
import { ProductsTableCardIconStudioModal } from './products-table-card/products-table-card-icon-studio-modal';
import { ProductsTableCardCardModal } from './products-table-card/products-table-card-card-modal';
import { ProductsTableCardPreviewDialog } from './products-table-card/products-table-card-preview-dialog';

export interface ProductsTableCardProps {
  search: string;
  onSearchChange: (value: string) => void;
  viewFilter: 'all' | 'low' | 'out' | 'offers' | 'special' | 'archived';
  onViewFilterChange: (value: 'all' | 'low' | 'out' | 'offers' | 'special' | 'archived') => void;
  selectedIds: string[];
  onSelectedIdsChange: (value: string[]) => void;
  onClearSelection: () => void;
  onBulkDelete: () => void;
  onToggleArchiveProduct?: (product: Product) => void;
  visibleProducts: Product[];
  selectedProduct: Product | null;
  onSelectProduct: (product: Product | null) => void;
  onDeleteProduct: (product: Product) => void;
  onOpenOfferDialog: (product: Product) => void;
  onOpenBarcodeDialog: (product: Product, mode?: 'scan' | 'generate') => void;
  onOpenPrintDialog: (product: Product) => void;
  onBulkPrintBarcodes?: () => void;
  onOpenSerialsDialog?: (product: Product) => void;
  canDelete: boolean;
  canPrint: boolean;
  onExportCsv: () => void;
  onPrint: () => void;
  categoryNames: Record<string, string>;
  supplierNames: Record<string, string>;
  locationNames: Record<string, string>;
  inventorySaleValue: number;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (value: number) => void;
  onPageSizeChange: (value: number) => void;
  clothingEnabled: boolean;
  mobileStoreEnabled?: boolean;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  onSortChange?: (field: string) => void;
}

export function ProductsTableCard(props: ProductsTableCardProps) {
  const { t: __t } = useTranslation();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const iconSettings = useProductIconSettings();
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [activeNoteModal, setActiveNoteModal] = useState<{ productName: string; note: string } | null>(null);
  const [activeCardProduct, setActiveCardProduct] = useState<Product | null>(null);
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);
  const [isStudioOpen, setIsStudioOpen] = useState(false);
  const [autoAssignMsg, setAutoAssignMsg] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null);

  const filteredProducts = useMemo(() => {
    if (!selectedCategoryId) return props.visibleProducts;
    return props.visibleProducts.filter((p) => String(p.categoryId || '') === selectedCategoryId);
  }, [props.visibleProducts, selectedCategoryId]);

  const groupedRows = useMemo(() => groupProducts(filteredProducts), [filteredProducts]);
  const visibleLeafIds = useMemo(() => groupedRows.flatMap((group) => group.children.map((product) => String(product.id))), [groupedRows]);
  const selectedIdSet = useMemo(() => new Set(props.selectedIds), [props.selectedIds]);
  const allVisibleSelected = Boolean(visibleLeafIds.length && visibleLeafIds.every((id) => selectedIdSet.has(id)));
  const someVisibleSelected = Boolean(!allVisibleSelected && visibleLeafIds.some((id) => selectedIdSet.has(id)));
  const totalPages = Math.max(1, Math.ceil((props.totalItems || 0) / props.pageSize));
  const rangeStart = props.totalItems ? ((props.page - 1) * props.pageSize) + 1 : 0;
  const rangeEnd = Math.min(props.page * props.pageSize, props.totalItems || 0);

  function toggleExpand(key: string) {
    setExpandedKeys((current) => current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]);
  }

  function toggleGroupSelection(group: ProductGroup, checked: boolean) {
    const next = new Set(props.selectedIds);
    for (const child of group.children) {
      if (checked) next.add(String(child.id));
      else next.delete(String(child.id));
    }
    props.onSelectedIdsChange(Array.from(next));
  }

  async function handleAutoAssignIcons() {
    try {
      setIsAutoAssigning(true);
      setAutoAssignMsg(null);

      // Fetch all products across entire catalog
      const { products } = await productsApi.listAll();
      const updates: Array<{ id: number; icon: string }> = [];

      for (const p of products) {
        const catName = p.categoryId ? props.categoryNames[String(p.categoryId)] : undefined;
        const guessed = guessProductIcon(p.name, catName);
        if (guessed && (!p.icon || p.icon !== guessed)) {
          updates.push({ id: Number(p.id), icon: guessed });
        }
      }

      if (updates.length === 0) {
        setAutoAssignMsg({
          type: 'info',
          text: 'تم الفحص الذكي: جميع الأصناف مضبوطة ولديها أيقونات متطابقة بالفعل.'
        });
        return;
      }

      const res = await productsApi.bulkUpdateIcons(updates);
      await invalidateCatalogDomain(queryClient, { includeProducts: true });
      setAutoAssignMsg({
        type: 'success',
        text: `تم بنجاح ضبط وتعيين الأيقونات لعدد (${res.updated || updates.length}) صنف تلقائياً!`
      });
    } catch {
      setAutoAssignMsg({
        type: 'error',
        text: 'حدث خطأ أثناء ضبط الأيقونات، يرجى إعادة المحاولة.'
      });
    } finally {
      setIsAutoAssigning(false);
    }
  }

  async function handleClearAllIcons() {
    try {
      setIsAutoAssigning(true);
      setAutoAssignMsg(null);

      const { products } = await productsApi.listAll();
      const updates = products
        .filter((p) => Boolean(p.icon))
        .map((p) => ({ id: Number(p.id), icon: '' }));

      if (updates.length === 0) {
        setAutoAssignMsg({
          type: 'info',
          text: 'جميع الأصناف في النظام خالية من الأيقونات بالفعل.'
        });
        return;
      }

      await productsApi.bulkUpdateIcons(updates);
      await invalidateCatalogDomain(queryClient, { includeProducts: true });
      setAutoAssignMsg({
        type: 'success',
        text: `تم بنجاح إزالة وتفريغ الأيقونات لعدد (${updates.length}) صنف، والعودة للحالة بدون أيقونات!`
      });
    } catch {
      setAutoAssignMsg({
        type: 'error',
        text: 'حدث خطأ أثناء تفريغ الأيقونات، يرجى إعادة المحاولة.'
      });
    } finally {
      setIsAutoAssigning(false);
    }
  }

  function renderSortableTh(field: string, label: string, align: 'start' | 'center' = 'start') {
    const isSorted = props.sortField === field;
    const isAsc = props.sortDirection === 'asc';
    return (
      <th
        style={{
          textAlign: align,
          cursor: props.onSortChange ? 'pointer' : 'default',
          userSelect: 'none',
        }}
        onClick={() => props.onSortChange?.(field)}
        title={props.onSortChange ? `انقر للفرز حسب ${label}` : undefined}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: align === 'center' ? 'center' : 'flex-start',
            gap: '4px',
            color: isSorted ? '#170e5e' : 'inherit',
            fontWeight: isSorted ? 700 : 'inherit',
          }}
        >
          {label}
          {isSorted ? (
            isAsc ? <ChevronUpIcon size={13} color="#170e5e" /> : <ChevronDownIcon size={13} color="#170e5e" />
          ) : (
            <span style={{ opacity: 0.35, display: 'inline-flex' }}>
              <ChevronDownIcon size={11} />
            </span>
          )}
        </span>
      </th>
    );
  }

  return (
    <section className="document-prototype-section workspace-panel">
      <ProductsTableCardHeader
        t={t}
        setIsStudioOpen={setIsStudioOpen}
        __t={__t}
        handleAutoAssignIcons={handleAutoAssignIcons}
        isAutoAssigning={isAutoAssigning}
      />
      <ProductsTableCardAutoAssignMessage
        autoAssignMsg={autoAssignMsg}
        setAutoAssignMsg={setAutoAssignMsg}
      />
      <ProductsTableCardToolbar
        search={props.search}
        onSearchChange={props.onSearchChange}
        __t={__t}
        selectedCategoryId={selectedCategoryId}
        setSelectedCategoryId={setSelectedCategoryId}
        categoryNames={props.categoryNames}
        viewFilter={props.viewFilter}
        onViewFilterChange={props.onViewFilterChange}
        t={t}
        sortField={props.sortField}
        sortDirection={props.sortDirection}
        onSortChange={props.onSortChange}
      />
      <ProductsTableCardBulkToolbar
        selectedIds={props.selectedIds}
        t={t}
        onBulkPrintBarcodes={props.onBulkPrintBarcodes}
        __t={__t}
        onClearSelection={props.onClearSelection}
        onBulkDelete={props.onBulkDelete}
        canDelete={props.canDelete}
      />

      <QueryFeedback
        isLoading={props.isLoading}
        isError={props.isError}
        error={props.error}
        isEmpty={!props.visibleProducts.length}
        loadingText={t('products.loading_products', 'جاري تحميل الأصناف...')}
        emptyTitle={t('products.no_matching_products', 'لا توجد أصناف مطابقة')}
        emptyHint={t('products.no_matching_hint', 'غيّر كلمة البحث أو أضف صنفًا جديدًا من النموذج.')}
      >
        <ProductsTableCardTable
          __t={__t}
          allVisibleSelected={allVisibleSelected}
          someVisibleSelected={someVisibleSelected}
          selectedIds={props.selectedIds}
          visibleLeafIds={visibleLeafIds}
          onSelectedIdsChange={props.onSelectedIdsChange}
          renderSortableTh={renderSortableTh}
          t={t}
          groupedRows={groupedRows}
          expandedKeys={expandedKeys}
          locationNames={props.locationNames}
          selectedProduct={props.selectedProduct}
          onSelectProduct={props.onSelectProduct}
          toggleGroupSelection={toggleGroupSelection}
          iconSettings={iconSettings}
          setPreviewImage={setPreviewImage}
          categoryNames={props.categoryNames}
          supplierNames={props.supplierNames}
          setActiveNoteModal={setActiveNoteModal}
          setActiveCardProduct={setActiveCardProduct}
          toggleExpand={toggleExpand}
        />

        <ProductsTableCardPagination
          page={props.page}
          totalPages={totalPages}
          pageSize={props.pageSize}
          totalItems={props.totalItems}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          onPageChange={props.onPageChange}
          onPageSizeChange={props.onPageSizeChange}
          __t={__t}
        />

        <ProductsTableCardNoteModal
          activeNoteModal={activeNoteModal}
          setActiveNoteModal={setActiveNoteModal}
          __t={__t}
        />

        <ProductsTableCardIconStudioModal
          isStudioOpen={isStudioOpen}
          setIsStudioOpen={setIsStudioOpen}
          handleAutoAssignIcons={handleAutoAssignIcons}
          handleClearAllIcons={handleClearAllIcons}
          isAutoAssigning={isAutoAssigning}
        />
        <ProductsTableCardCardModal
          activeCardProduct={activeCardProduct}
          setActiveCardProduct={setActiveCardProduct}
          categoryNames={props.categoryNames}
          supplierNames={props.supplierNames}
          locationNames={props.locationNames}
          onSelectProduct={props.onSelectProduct}
          onOpenBarcodeDialog={props.onOpenBarcodeDialog}
          onOpenOfferDialog={props.onOpenOfferDialog}
          onOpenSerialsDialog={props.onOpenSerialsDialog}
          onToggleArchiveProduct={props.onToggleArchiveProduct}
          onDeleteProduct={props.onDeleteProduct}
          mobileStoreEnabled={props.mobileStoreEnabled}
        />
        <ProductsTableCardPreviewDialog
          previewImage={previewImage}
          setPreviewImage={setPreviewImage}
          __t={__t}
        />
      </QueryFeedback>
    </section>
  );
}
