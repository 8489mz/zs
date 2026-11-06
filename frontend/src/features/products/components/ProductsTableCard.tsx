import { Fragment, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { ChevronDownIcon, ChevronUpIcon, FileTextIcon, LayersIcon, PrinterIcon, SearchIcon, XIcon } from '@/shared/components/icons/AppIcons';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { PaginationControls } from '@/shared/components/pagination-controls';
import { formatCurrency } from '@/lib/format';
import type { Product } from '@/types/domain';
import { productsApi } from '@/features/products/api/products.api';
import { guessProductIcon } from '@/features/products/lib/product-smart-matcher';
import { invalidateCatalogDomain } from '@/app/query-invalidation';

import { getProductLocationDisplayName } from '../utils/product-location.utils';
import { displayProductName } from '../utils/product-submit.utils';
import { ProductsMatrixView } from './ProductsMatrixView';
import { ProductIcon } from '@/shared/components/icons/product-svg-catalog';
import { ProductIconStudioModal } from '@/shared/components/icons/ProductIconStudioModal';
import { useProductIconSettings } from '@/shared/components/icons/product-icon-theme';
import { ProductCardModal } from './ProductCardModal';

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

type ProductGroup = {
  key: string;
  representative: Product;
  children: Product[];
  grouped: boolean;
};

function variantLabel(product: Product) {
  const primary = String(product.color || '').trim();
  const secondary = String(product.size || '').trim();
  if (primary && secondary) return `${primary} / ${secondary}`;
  return primary || secondary || '—';
}

function deriveBaseName(product: Product) {
  // Display fallback only: an English-only product shows its English name
  // here, but the stored Arabic name stays empty (no write-time copy).
  const raw = displayProductName(product);
  const label = variantLabel(product);
  if (!label || label === '—') return raw;
  const suffix = ` - ${label}`;
  return raw.endsWith(suffix) ? raw.slice(0, -suffix.length).trim() : raw;
}

function groupProducts(products: Product[]): ProductGroup[] {
  const byKey = new Map<string, Product[]>();
  for (const product of products) {
    const styleCode = String(product.styleCode || '').trim();
    const key = styleCode ? `group:${styleCode}` : `single:${product.id}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(product);
  }
  return Array.from(byKey.entries()).map(([key, rows]) => {
    const sorted = [...rows].sort((a, b) => variantLabel(a).localeCompare(variantLabel(b), 'ar'));
    const representative = sorted[0];
    return { key, representative, children: sorted, grouped: key.startsWith('group:') && sorted.length > 1 };
  });
}

function ProductThumbnail({
  imageUrl,
  icon,
  name,
  size = 28,
  onClick,
}: {
  imageUrl?: string | null;
  icon?: string | null;
  name: string;
  size?: number;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const hasImage = Boolean(imageUrl && !imgFailed);

  return (
    <div
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '6px',
        background: hasImage ? '#ffffff' : '#f8fafc',
        color: 'var(--product-icon-color, #2563eb)',
        border: '1px solid #e2e8f0',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
        boxSizing: 'border-box',
        cursor: hasImage && onClick ? 'zoom-in' : 'inherit',
      }}
      onClick={hasImage && onClick ? onClick : undefined}
      title={hasImage ? `معاينة صورة ${name}` : undefined}
    >
      {hasImage ? (
        <img
          src={imageUrl!}
          alt={name}
          loading="lazy"
          decoding="async"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <ProductIcon name={icon || 'box-package'} size={size >= 28 ? 16 : 14} />
      )}
    </div>
  );
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
      <div className="section-header-compact-row">
        <h3 className="document-prototype-section-title">{t('products.current_items_list', 'قائمة الأصناف الحالية')}</h3>
        <div className="section-header-actions-group">
          <Button
            variant="secondary"
            onClick={() => setIsStudioOpen(true)}
            className="section-header-action-btn"
            title={__t('products.products_table_card.s0', "تخصيص ألوان الأيقونات لكل المنظومة أو إلغاء وتفريغ الأيقونات")}
          >
            {t('products.icons_btn', 'الأيقونات')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void handleAutoAssignIcons()}
            disabled={isAutoAssigning}
            className="section-header-action-btn"
            style={{ marginInlineStart: '6px' }}
            title={__t('products.products_table_card.s1', "فحص أسماء الأصناف وتعيين الأيقونات المناسبة لها تلقائياً")}
          >
            {isAutoAssigning ? __t('products.products_table_card.s2', "جارٍ الضبط...") : t('products.smart_assign_btn', 'ضبط ذكي')}
          </Button>
        </div>
      </div>
      <p className="muted small section-header-subtitle">
        {t('products.items_list_desc', 'إدارة وتسعير ومتابعة مخزون المنتجات والأصناف.')}
      </p>
      {autoAssignMsg && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '8px',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '13px',
            fontWeight: 600,
            background: autoAssignMsg.type === 'success' ? '#f0fdf4' : autoAssignMsg.type === 'info' ? '#eff6ff' : '#fef2f2',
            color: autoAssignMsg.type === 'success' ? '#15803d' : autoAssignMsg.type === 'info' ? '#1d4ed8' : '#b91c1c',
            border: `1px solid ${autoAssignMsg.type === 'success' ? '#bbf7d0' : autoAssignMsg.type === 'info' ? '#bfdbfe' : '#fecaca'}`,
          }}
        >
          <span>{autoAssignMsg.text}</span>
          <button
            type="button"
            onClick={() => setAutoAssignMsg(null)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'inherit',
              padding: '0 4px',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <XIcon size={14} />
          </button>
        </div>
      )}
      <div className="products-table-toolbar" style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 320px' }}>
            <input
              type="text"
              value={props.search}
              onChange={(e) => props.onSearchChange(e.target.value)}
              placeholder={__t('products.products_table_card.s3', "ابحث بالاسم أو الباركود أو القسم أو المورد أو الخاصية الفرعية...")}
              className="purchase-prototype-field-input"
              style={{
                width: '100%',
                height: '38px',
                paddingInlineStart: '36px',
                paddingInlineEnd: props.search ? '32px' : '12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                fontSize: '13px',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', insetInlineStart: '10px', color: '#94a3b8', display: 'flex', pointerEvents: 'none' }}>
              <SearchIcon size={16} />
            </div>
            {props.search && (
              <button
                type="button"
                onClick={() => props.onSearchChange('')}
                style={{
                  position: 'absolute',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  insetInlineEnd: '10px',
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                }}
                title={__t('products.products_table_card.s4', "مسح البحث")}
              >
                <XIcon size={14} />
              </button>
            )}
          </div>

          <div className="products-category-select-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <select
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              className="purchase-prototype-field-input"
              style={{
                height: '38px',
                minWidth: '180px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#fff',
                fontWeight: 600,
                fontSize: '12.5px',
                color: '#1e293b',
                boxSizing: 'border-box',
              }}
            >
              <option value="">{__t('products.products_table_card.s5', "كل الأقسام (")}{Object.keys(props.categoryNames).length})</option>
              {Object.entries(props.categoryNames).map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
            {selectedCategoryId && (
              <Button
                variant="secondary"
                onClick={() => setSelectedCategoryId('')}
                style={{ height: '38px', padding: '0 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                title={__t('products.products_table_card.s6', "إلغاء تصفية القسم")}
              >
                <XIcon size={13} />
                <span>{__t('products.products_table_card.s7', "إلغاء")}</span>
              </Button>
            )}
          </div>
        </div>

        <div
          className="filter-chip-row toolbar-chip-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexWrap: 'nowrap',
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
            maxWidth: '100%',
            paddingBottom: '4px',
          }}
        >
          <Button variant={props.viewFilter === 'all' ? 'primary' : 'secondary'} onClick={() => props.onViewFilterChange('all')} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('common.all', 'الكل')}</Button>
          <Button variant={props.viewFilter === 'low' ? 'primary' : 'secondary'} onClick={() => props.onViewFilterChange('low')} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('products.low_stock', 'منخفضة')}</Button>
          <Button variant={props.viewFilter === 'out' ? 'primary' : 'secondary'} onClick={() => props.onViewFilterChange('out')} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('products.out_of_stock', 'نافدة')}</Button>
          <Button variant={props.viewFilter === 'offers' ? 'primary' : 'secondary'} onClick={() => props.onViewFilterChange('offers')} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('products.with_offers', 'بعروض')}</Button>
          <Button variant={props.viewFilter === 'special' ? 'primary' : 'secondary'} onClick={() => props.onViewFilterChange('special')} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('products.special_prices', 'أسعار خاصة')}</Button>
          <Button variant={props.viewFilter === 'archived' ? 'primary' : 'secondary'} onClick={() => props.onViewFilterChange('archived')} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('products.archived', 'المؤرشفة')}</Button>
          {props.sortField ? (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11.5px',
                background: '#eef2ff',
                color: '#170e5e',
                border: '1px solid #c7d2fe',
                padding: '2px 10px',
                borderRadius: '16px',
                fontWeight: 600,
                flexShrink: 0,
                whiteSpace: 'nowrap',
                marginInlineStart: 'auto',
              }}
            >
              <span>
                {__t('products.sorted_by', 'مرتب حسب:')}{' '}
                {props.sortField === 'name'
                  ? t('products.product_col', 'الصنف')
                  : props.sortField === 'stock'
                  ? t('products.stock_col', 'المخزون')
                  : props.sortField === 'price'
                  ? t('products.prices_col', 'الأسعار')
                  : props.sortField === 'barcode'
                  ? t('products.barcode_col', 'الباركود')
                  : props.sortField === 'category'
                  ? t('products.category_supplier_store_col', 'القسم')
                  : props.sortField}{' '}
                ({props.sortDirection === 'desc' ? 'تنازلي' : 'تصاعدي'})
              </span>
              <button
                type="button"
                onClick={() => props.onSortChange?.('')}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#170e5e',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                }}
                title={__t('products.reset_sort_hint', 'إلغاء الفرز والعودة للترتيب الافتراضي')}
              >
                <XIcon size={12} />
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {props.selectedIds.length ? (
        <div className="bulk-toolbar">
          <div className="bulk-toolbar-meta">
            <strong>{t('products.selected_active', 'تحديد نشط:')} {props.selectedIds.length}</strong>
            <span className="muted small">{t('products.selected_hint', 'يمكنك حذف الأصناف المحددة دفعة واحدة أو مسح التحديد الحالي.')}</span>
          </div>
          <div className="actions compact-actions">
            {props.onBulkPrintBarcodes && (
              <Button
                variant="secondary"
                onClick={props.onBulkPrintBarcodes}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}
                title={__t('products.products_table_card.s8', "طباعة ملصقات الباركود واستيكرات الرفوف التموينية للأصناف المحددة")}
              >
                <PrinterIcon size={14} />
                <span>{t('products.print_barcodes_shelf', 'طباعة الباركود والرف')} ({props.selectedIds.length})</span>
              </Button>
            )}
            <Button variant="secondary" onClick={props.onClearSelection}>{t('products.clear_selection', 'مسح التحديد')}</Button>
            <Button variant="danger" onClick={props.onBulkDelete} disabled={!props.canDelete}>{t('products.delete_selected', 'حذف المحدد')}</Button>
          </div>
        </div>
      ) : null}

      <QueryFeedback
        isLoading={props.isLoading}
        isError={props.isError}
        error={props.error}
        isEmpty={!props.visibleProducts.length}
        loadingText={t('products.loading_products', 'جاري تحميل الأصناف...')}
        emptyTitle={t('products.no_matching_products', 'لا توجد أصناف مطابقة')}
        emptyHint={t('products.no_matching_hint', 'غيّر كلمة البحث أو أضف صنفًا جديدًا من النموذج.')}
      >
        <div className="table-wrap table-wrap-sticky table-wrap-compact" style={{ overflowX: 'hidden' }}>
          <table aria-label={__t('products.products_table_card.s9', "قائمة الأصناف")} style={{ tableLayout: 'fixed', width: '100%', minWidth: '100%' }}>
            <colgroup>
              <col style={{ width: '38px' }} />
              <col style={{ width: '25%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '84px' }} />
              <col style={{ width: '114px' }} />
            </colgroup>
            <thead>
              <tr>
                <th className="table-selection-cell">
                  <input
                    type="checkbox"
                    aria-label={__t('products.products_table_card.s10', "تحديد كل الصفوف الظاهرة")}
                    checked={allVisibleSelected}
                    ref={(node) => { if (node) node.indeterminate = someVisibleSelected; }}
                    onChange={(event) => {
                      const next = new Set(props.selectedIds);
                      if (event.target.checked) visibleLeafIds.forEach((id) => next.add(id));
                      else visibleLeafIds.forEach((id) => next.delete(id));
                      props.onSelectedIdsChange(Array.from(next));
                    }}
                  />
                </th>
                {renderSortableTh('name', t('products.product_col', 'الصنف'), 'start')}
                {renderSortableTh('barcode', t('products.barcode_col', 'الباركود'), 'center')}
                <th style={{ textAlign: 'center' }}>{t('products.variants_col', 'المتغيرات')}</th>
                {renderSortableTh('category', t('products.category_supplier_store_col', 'القسم / المورد / المخزن'), 'start')}
                {renderSortableTh('price', t('products.prices_col', 'الأسعار'), 'start')}
                {renderSortableTh('stock', t('products.stock_col', 'المخزون'), 'center')}
                <th style={{ textAlign: 'center' }}>{t('products.notes_col', 'ملاحظات')}</th>
                <th style={{ textAlign: 'center' }}>{t('products.actions_col', 'إجراءات')}</th>
              </tr>
            </thead>
            <tbody>
              {groupedRows.map((group) => {
                const isExpanded = expandedKeys.includes(group.key);
                const groupIds = group.children.map((product) => String(product.id));
                const allSelected = groupIds.every((id) => props.selectedIds.includes(id));
                const someSelected = !allSelected && groupIds.some((id) => props.selectedIds.includes(id));
                const baseName = deriveBaseName(group.representative);
                const totalStock = group.children.reduce((sum, entry) => sum + Number(entry.stock || 0), 0);

                if (!group.grouped) {
                  const product = group.representative;
                  const activeLocationNames = getProductLocationDisplayName(product, props.locationNames);

                  return (
                    <tr key={group.key} className={props.selectedProduct?.id === product.id ? 'table-row-selected' : undefined} onClick={() => props.onSelectProduct(product)} style={{ cursor: 'pointer' }}>
                      <td className="table-selection-cell" onClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" aria-label={`تحديد الصنف ${displayProductName(product)}`} checked={props.selectedIds.includes(String(product.id))} onChange={(event) => toggleGroupSelection(group, event.target.checked)} />
                      </td>
                      <td style={{ textAlign: 'start', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                          {iconSettings.showIcons ? (
                            <ProductThumbnail
                              imageUrl={product.imageUrl}
                              icon={product.icon}
                              name={displayProductName(product)}
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewImage({ url: product.imageUrl!, title: displayProductName(product) });
                              }}
                            />
                          ) : null}
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <strong style={{ color: '#0f172a', fontSize: '0.86rem', lineHeight: 1.35, display: 'block', wordBreak: 'break-word', whiteSpace: 'normal' }}>{displayProductName(product)}</strong>
                              {product.isActive === false ? (
                                <span className="status-badge" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', fontSize: '0.68rem', padding: '1px 5px', whiteSpace: 'nowrap' }}>{__t('products.products_table_card.s11', "مؤرشف")}</span>
                              ) : null}
                            </div>
                            <div className="muted small" style={{ fontSize: '0.74rem', marginTop: '2px', color: '#64748b', lineHeight: 1.3, wordBreak: 'break-word' }}>{(product.units || []).map((unit) => `${unit.name} × ${unit.multiplier || 1}`).join(' / ') || __t('products.products_table_card.s12', "قطعة")}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {product.barcode ? (
                          <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#334155', background: '#f8fafc', padding: '2px 6px', borderRadius: '4px', border: '1px solid #e2e8f0', display: 'inline-block' }}>
                            {product.barcode}
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                        {variantLabel(product) !== '—' ? (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '1px 7px',
                            borderRadius: '4px',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            background: '#f1f5f9',
                            color: '#334155',
                            border: '1px solid #e2e8f0',
                            whiteSpace: 'nowrap',
                          }}>
                            {variantLabel(product)}
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'start', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                        <div style={{ lineHeight: 1.35 }}>
                          <div>{props.categoryNames[product.categoryId] || __t('products.products_table_card.s13', "عام")}</div>
                          {activeLocationNames ? <div className="muted small" style={{ fontSize: '0.74rem' }}>{activeLocationNames}</div> : null}
                          {props.supplierNames[product.supplierId] ? <div className="muted small" style={{ fontSize: '0.74rem' }}>{props.supplierNames[product.supplierId]}</div> : null}
                        </div>
                      </td>
                      <td style={{ textAlign: 'start', whiteSpace: 'nowrap' }}>
                        <div style={{ lineHeight: 1.4 }}>
                          <div>{__t('products.products_table_card.s14', "بيع:")} <strong>{formatCurrency(product.retailPrice)}</strong></div>
                          <div className="muted small" style={{ fontSize: '0.75rem' }}>{__t('products.products_table_card.s15', "شراء:")} {formatCurrency(product.costPrice)}</div>
                          {product.wholesalePrice > 0 ? <div className="muted small" style={{ fontSize: '0.75rem' }}>{__t('products.products_table_card.s16', "جملة:")} {formatCurrency(product.wholesalePrice)}</div> : null}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <span className={product.stock <= product.minStock ? 'low-stock-badge' : 'status-badge status-posted'}>
                          {product.stock}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {product.notes ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveNoteModal({ productName: displayProductName(product), note: product.notes! });
                            }}
                            title={product.notes}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                              padding: '2px 7px',
                              borderRadius: '6px',
                              fontSize: '0.74rem',
                              fontWeight: 700,
                              background: '#eff6ff',
                              color: '#1d4ed8',
                              border: '1px solid #bfdbfe',
                              cursor: 'pointer',
                              boxSizing: 'border-box',
                            }}
                          >
                            <FileTextIcon size={12} />
                            <span>{__t('products.products_table_card.s17', "ملاحظة")}</span>
                          </button>
                        ) : (
                          <span style={{ color: '#cbd5e1' }}>—</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div className="actions compact-actions" onClick={(event) => event.stopPropagation()} style={{ flexWrap: 'nowrap', justifyContent: 'center' }}>
                          <Button
                            variant="secondary"
                            type="button"
                            onClick={() => setActiveCardProduct(product)}
                            title={__t('products.products_table_card.card_btn_title', "عرض كارت الصنف وسجل الحركات التاريخية والمخزون")}
                            style={{
                              fontSize: '0.82rem',
                              fontWeight: 700,
                              color: '#170e5e',
                              borderColor: '#c7d2fe',
                              background: '#eef2ff',
                              padding: '5px 12px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              whiteSpace: 'nowrap',
                              borderRadius: '7px',
                            }}
                          >
                            <LayersIcon size={14} color="#170e5e" />
                            <span>{__t('products.products_table_card.card_btn', "كارت الصنف")}</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                const groupActiveLocationIds = Array.from(new Set(group.children.flatMap(p => p.activeLocationIds || [])));
                const groupActiveLocationNames = getProductLocationDisplayName(
                  { ...group.representative, activeLocationIds: groupActiveLocationIds },
                  props.locationNames
                );

                return (
                  <Fragment key={group.key}>
                    <tr key={group.key} className="products-group-row">
                      <td className="table-selection-cell">
                        <input
                          type="checkbox"
                          aria-label={`تحديد المجموعة ${baseName}`}
                          checked={allSelected}
                          ref={(node) => { if (node) node.indeterminate = someSelected; }}
                          onChange={(event) => toggleGroupSelection(group, event.target.checked)}
                        />
                      </td>
                      <td style={{ textAlign: 'start', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                        <div
                          onClick={() => toggleExpand(group.key)}
                          style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}
                          title={isExpanded ? __t('products.products_table_card.s28', "طي الأصناف الفرعية") : __t('products.products_table_card.s29', "توسيع الأصناف الفرعية")}
                        >
                          {iconSettings.showIcons ? (
                            <ProductThumbnail
                              imageUrl={group.representative.imageUrl || group.children.find((c) => c.imageUrl)?.imageUrl}
                              icon={group.representative.icon}
                              name={baseName}
                              onClick={(e) => {
                                const imgUrl = group.representative.imageUrl || group.children.find((c) => c.imageUrl)?.imageUrl;
                                if (imgUrl) {
                                  e.stopPropagation();
                                  setPreviewImage({ url: imgUrl, title: baseName });
                                }
                              }}
                            />
                          ) : null}
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <strong style={{ color: '#0f172a', fontSize: '0.88rem', lineHeight: 1.35 }}>{baseName}</strong>
                            <div className="muted small" style={{ fontSize: '0.74rem', marginTop: '2px', color: '#64748b', lineHeight: 1.3 }}>
                              {group.children.length} {__t('products.products_table_card.s30', "فرعيات")}{group.representative.styleCode ? ` • كود ${group.representative.styleCode}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <span style={{ color: '#94a3b8' }}>—</span>
                      </td>
                      <td style={{ textAlign: 'center', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'center', alignItems: 'center', maxHeight: '52px', overflow: 'hidden' }}>
                          {group.children.slice(0, 2).map((entry) => (
                            <span
                              key={entry.id}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                background: '#f1f5f9',
                                color: '#334155',
                                border: '1px solid #e2e8f0',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {variantLabel(entry)}
                            </span>
                          ))}
                          {group.children.length > 2 ? (
                            <button
                              type="button"
                              onClick={() => toggleExpand(group.key)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                background: isExpanded ? '#dbeafe' : '#eff6ff',
                                color: '#1e40af',
                                border: '1px solid #bfdbfe',
                                whiteSpace: 'nowrap',
                                cursor: 'pointer',
                              }}
                              title={isExpanded ? __t('products.products_table_card.s31', "إخفاء الفرعيات") : __t('products.products_table_card.s32', "عرض باقي الفرعيات")}
                            >
                              +{group.children.length - 2} {__t('products.products_table_card.s33', "فرعي")} {isExpanded ? '▲' : '▼'}
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td style={{ textAlign: 'start', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                        <div style={{ lineHeight: 1.35 }}>
                          <div>{props.categoryNames[group.representative.categoryId] || __t('products.products_table_card.s34', "عام")}</div>
                          {groupActiveLocationNames ? <div className="muted small" style={{ fontSize: '0.74rem' }}>{groupActiveLocationNames}</div> : null}
                          {props.supplierNames[group.representative.supplierId] ? <div className="muted small" style={{ fontSize: '0.74rem' }}>{props.supplierNames[group.representative.supplierId]}</div> : null}
                        </div>
                      </td>
                      <td style={{ textAlign: 'start', whiteSpace: 'nowrap' }}>
                        <div style={{ lineHeight: 1.4 }}>
                          <div>{__t('products.products_table_card.s35', "بيع:")} <strong>{formatCurrency(group.representative.retailPrice)}</strong></div>
                          <div className="muted small" style={{ fontSize: '0.75rem' }}>{__t('products.products_table_card.s36', "شراء:")} {formatCurrency(group.representative.costPrice)}</div>
                          {group.representative.wholesalePrice > 0 ? <div className="muted small" style={{ fontSize: '0.75rem' }}>{__t('products.products_table_card.s37', "جملة:")} {formatCurrency(group.representative.wholesalePrice)}</div> : null}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <span className={totalStock <= Number(group.representative.minStock || 0) ? 'low-stock-badge' : 'status-badge status-posted'}>
                          {totalStock}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {group.representative.notes ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveNoteModal({ productName: baseName, note: group.representative.notes! });
                            }}
                            title={group.representative.notes}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                              padding: '2px 7px',
                              borderRadius: '6px',
                              fontSize: '0.74rem',
                              fontWeight: 700,
                              background: '#eff6ff',
                              color: '#1d4ed8',
                              border: '1px solid #bfdbfe',
                              cursor: 'pointer',
                              boxSizing: 'border-box',
                            }}
                          >
                            <FileTextIcon size={12} />
                            <span>{__t('products.products_table_card.s38', "ملاحظة")}</span>
                          </button>
                        ) : (
                          <span style={{ color: '#cbd5e1' }}>—</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div className="actions compact-actions" onClick={(event) => event.stopPropagation()} style={{ flexWrap: 'nowrap', justifyContent: 'center' }}>
                          <Button
                            variant="secondary"
                            type="button"
                            onClick={() => setActiveCardProduct(
                              group.grouped
                                ? {
                                    ...group.representative,
                                    name: baseName,
                                    stock: totalStock,
                                    variantsCount: group.children.length,
                                  }
                                : group.representative
                            )}
                            title={__t('products.products_table_card.card_btn_title', "عرض كارت الصنف وسجل الحركات التاريخية والمخزون")}
                            style={{
                              fontSize: '0.82rem',
                              fontWeight: 700,
                              color: '#170e5e',
                              borderColor: '#c7d2fe',
                              background: '#eef2ff',
                              padding: '5px 12px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              whiteSpace: 'nowrap',
                              borderRadius: '7px',
                            }}
                          >
                            <LayersIcon size={14} color="#170e5e" />
                            <span>{__t('products.products_table_card.card_btn', "كارت الصنف")}</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && group.grouped && group.representative.styleCode && group.representative.itemKind === 'fashion' ? (
                      <tr className="products-matrix-row">
                        <td colSpan={9} style={{ padding: 0 }}>
                          <ProductsMatrixView products={group.children} />
                        </td>
                      </tr>
                    ) : null}
                    {isExpanded ? group.children.map((product) => (
                      <tr key={`child-${product.id}`} className={`products-group-child-row ${props.selectedProduct?.id === product.id ? 'table-row-selected' : ''}`} onClick={() => props.onSelectProduct(product)} style={{ cursor: 'pointer' }}>
                        <td className="table-selection-cell" onClick={(event) => event.stopPropagation()}>
                          <input type="checkbox" aria-label={`تحديد الصنف ${displayProductName(product)}`} checked={props.selectedIds.includes(String(product.id))} onChange={(event) => {
                            const next = new Set(props.selectedIds);
                            if (event.target.checked) next.add(String(product.id));
                            else next.delete(String(product.id));
                            props.onSelectedIdsChange(Array.from(next));
                          }} />
                        </td>
                        <td style={{ textAlign: 'start', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                          <div style={{ paddingInlineStart: 18, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {product.imageUrl ? (
                              <ProductThumbnail
                                imageUrl={product.imageUrl}
                                icon={product.icon}
                                name={displayProductName(product)}
                                size={22}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewImage({ url: product.imageUrl!, title: `${displayProductName(product)} (${variantLabel(product)})` });
                                }}
                              />
                            ) : null}
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <strong>{variantLabel(product)}</strong>
                                {product.isActive === false ? (
                                  <span className="status-badge" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', fontSize: '0.68rem', padding: '1px 5px' }}>{__t('products.products_table_card.s57', "مؤرشف")}</span>
                                ) : null}
                              </div>
                              <div className="muted small" style={{ fontSize: '0.74rem', lineHeight: 1.3 }}>{displayProductName(product)}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {product.barcode ? (
                            <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#334155', background: '#f8fafc', padding: '2px 6px', borderRadius: '4px', border: '1px solid #e2e8f0', display: 'inline-block' }}>
                              {product.barcode}
                            </span>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                          {variantLabel(product) !== '—' ? (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              padding: '1px 7px',
                              borderRadius: '4px',
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              background: '#f1f5f9',
                              color: '#334155',
                              border: '1px solid #e2e8f0',
                              whiteSpace: 'nowrap',
                            }}>
                              {variantLabel(product)}
                            </span>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'start', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                          <div style={{ lineHeight: 1.35 }}>
                            <div style={{ fontWeight: 600, color: '#334155', fontSize: '0.8rem' }}>{props.categoryNames[product.categoryId] || __t('products.products_table_card.s58', "عام")}</div>
                            {getProductLocationDisplayName(product, props.locationNames) ? <div className="muted small" style={{ fontSize: '0.74rem', lineHeight: 1.3 }}>{getProductLocationDisplayName(product, props.locationNames)}</div> : null}
                            {props.supplierNames[product.supplierId] ? <div className="muted small" style={{ fontSize: '0.74rem', lineHeight: 1.3 }}>{props.supplierNames[product.supplierId]}</div> : null}
                          </div>
                        </td>
                        <td style={{ textAlign: 'start', whiteSpace: 'nowrap' }}>
                          <div style={{ lineHeight: 1.4 }}>
                            <div>{__t('products.products_table_card.s59', "بيع:")} <strong>{formatCurrency(product.retailPrice)}</strong></div>
                            <div className="muted small" style={{ fontSize: '0.75rem' }}>{__t('products.products_table_card.s60', "شراء:")} {formatCurrency(product.costPrice)}</div>
                            {product.wholesalePrice > 0 ? <div className="muted small" style={{ fontSize: '0.75rem' }}>{__t('products.products_table_card.s61', "جملة:")} {formatCurrency(product.wholesalePrice)}</div> : null}
                          </div>
                        </td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <span className={product.stock <= product.minStock ? 'low-stock-badge' : 'status-badge status-posted'}>
                            {product.stock}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {product.notes ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveNoteModal({ productName: `${baseName} (${variantLabel(product)})`, note: product.notes! });
                              }}
                              title={product.notes}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '4px',
                                padding: '2px 7px',
                                borderRadius: '6px',
                                fontSize: '0.74rem',
                                fontWeight: 700,
                                background: '#eff6ff',
                                color: '#1d4ed8',
                                border: '1px solid #bfdbfe',
                                cursor: 'pointer',
                                boxSizing: 'border-box',
                              }}
                            >
                              <FileTextIcon size={12} />
                              <span>{__t('products.products_table_card.s62', "ملاحظة")}</span>
                            </button>
                          ) : (
                            <span style={{ color: '#cbd5e1' }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <div className="actions compact-actions" onClick={(event) => event.stopPropagation()} style={{ flexWrap: 'nowrap', justifyContent: 'center' }}>
                            <Button
                              variant="secondary"
                              type="button"
                              onClick={() => setActiveCardProduct(product)}
                              title={__t('products.products_table_card.card_btn_title', "عرض كارت الصنف وسجل الحركات التاريخية والمخزون")}
                              style={{
                                fontSize: '0.82rem',
                                fontWeight: 700,
                                color: '#170e5e',
                                borderColor: '#c7d2fe',
                                background: '#eef2ff',
                                padding: '5px 12px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                whiteSpace: 'nowrap',
                                borderRadius: '7px',
                              }}
                            >
                              <LayersIcon size={14} color="#170e5e" />
                              <span>{__t('products.products_table_card.card_btn', "كارت الصنف")}</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <PaginationControls
          page={props.page}
          totalPages={totalPages}
          pageSize={props.pageSize}
          totalItems={props.totalItems}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          onPageChange={props.onPageChange}
          onPageSizeChange={props.onPageSizeChange}
          itemLabel={__t('products.products_table_card.s71', "صنف")}
        />

        {/* Product Note Modal */}
        {activeNoteModal && (
          <StandardDialog
            open={Boolean(activeNoteModal)}
            onClose={() => setActiveNoteModal(null)}
            title={__t('products.products_table_card.s72', "ملاحظات الصنف")}
            subtitle={activeNoteModal.productName}
            maxWidth="480px"
            footerActions={
              <StandardDialogFooter
                cancelText={__t('products.products_table_card.s73', "إغلاق")}
                onCancel={() => setActiveNoteModal(null)}
              />
            }
          >
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px 16px', fontSize: '0.9rem', lineHeight: 1.7, color: '#1e293b', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {activeNoteModal.note}
            </div>
          </StandardDialog>
        )}

        <ProductIconStudioModal
          open={isStudioOpen}
          onClose={() => setIsStudioOpen(false)}
          onBulkAutoAssign={() => void handleAutoAssignIcons()}
          onBulkClearIcons={() => void handleClearAllIcons()}
          isBulkLoading={isAutoAssigning}
        />
        {activeCardProduct ? (
          <ProductCardModal
            product={activeCardProduct}
            onClose={() => setActiveCardProduct(null)}
            categoryName={activeCardProduct.categoryId ? props.categoryNames[String(activeCardProduct.categoryId)] : undefined}
            supplierName={activeCardProduct.supplierId ? props.supplierNames[String(activeCardProduct.supplierId)] : undefined}
            locationName={props.locationNames ? getProductLocationDisplayName(activeCardProduct, props.locationNames) : undefined}
            onEditProduct={(p) => props.onSelectProduct(p)}
            onOpenBarcodeDialog={(p, mode) => props.onOpenBarcodeDialog(p, mode)}
            onOpenOfferDialog={(p) => props.onOpenOfferDialog(p)}
            onOpenSerialsDialog={props.onOpenSerialsDialog}
            onToggleArchiveProduct={props.onToggleArchiveProduct}
            onDeleteProduct={props.onDeleteProduct}
            mobileStoreEnabled={props.mobileStoreEnabled}
          />
        ) : null}
        {previewImage ? (
          <StandardDialog
            open={Boolean(previewImage)}
            onClose={() => setPreviewImage(null)}
            title={previewImage.title}
            subtitle={__t('products.products_table_card.preview_image', "معاينة صورة الصنف")}
            size="sm"
            compact
            footerActions={
              <StandardDialogFooter
                cancelLabel={__t('products.products_table_card.s73', "إغلاق")}
                onCancel={() => setPreviewImage(null)}
              />
            }
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', background: '#f8fafc', borderRadius: '10px', minHeight: '220px' }}>
              <img
                src={previewImage.url}
                alt={previewImage.title}
                style={{
                  maxWidth: '100%',
                  maxHeight: '400px',
                  objectFit: 'contain',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                }}
              />
            </div>
          </StandardDialog>
        ) : null}
      </QueryFeedback>
    </section>
  );
}
