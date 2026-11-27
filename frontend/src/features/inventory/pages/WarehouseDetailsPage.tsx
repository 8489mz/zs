import { useTranslation } from 'react-i18next';
import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/shared/components/page-header';
import { FormSection } from '@/shared/components/form-section';
import { StatsGrid } from '@/shared/components/stats-grid';
import { Button } from '@/shared/ui/button';
import { ClipboardIcon, TruckIcon, PlusCircleIcon, LayersIcon } from '@/shared/components/icons/AppIcons';
import { ProductCardModal } from '@/shared/components/ProductCardModal';
import { useInventoryActionCatalog } from '@/features/inventory/hooks/useInventoryActionCatalog';
import { catalogApi } from '@/shared/api/catalog';
import { AssignProductsModal } from '../components/AssignProductsModal';
import { formatCurrency } from '@/lib/format';
import type { Product } from '@/types/domain';

export function WarehouseDetailsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const locationId = Number(id);
  const { locationsQuery, productsQuery, locationStocksQuery } = useInventoryActionCatalog();
  const location = locationsQuery.data?.find((l) => String(l.id) === String(id));

  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [showZeroStock, setShowZeroStock] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [activeCardProduct, setActiveCardProduct] = useState<Product | null>(null);

  const categoriesQuery = useQuery({ queryKey: ['catalogCategories'], queryFn: () => catalogApi.categories() });

  const rawProducts = useMemo(() => productsQuery.data || [], [productsQuery.data]);
  const stocks = useMemo(() => locationStocksQuery.data || [], [locationStocksQuery.data]);
  const categories = useMemo(() => categoriesQuery.data || [], [categoriesQuery.data]);

  const locationProducts = useMemo(() => {
    return rawProducts.map((p: any) => {
      const productStocks = stocks.filter((s: any) => String(s.productId) === String(p.id));
      const stockInThisLocation = productStocks.find((s: any) => String(s.locationId) === String(locationId));
      const sumFromLocations = productStocks.reduce((sum: number, s: any) => sum + Number(s.qty || 0), 0);
      const globalStockFromProduct = Number(p.stock || p.stockQty || 0);
      const globalStockQty = sumFromLocations > 0 ? sumFromLocations : globalStockFromProduct;

      return {
        ...p,
        stockQty: stockInThisLocation ? Number(stockInThisLocation.qty) : 0,
        globalStockQty,
        isAssignedToThisLocation: !!stockInThisLocation,
      };
    });
  }, [rawProducts, stocks, locationId]);

  const stats = useMemo(() => {
    const assigned = locationProducts.filter((p) => p.isAssignedToThisLocation);
    const inStock = assigned.filter((p) => p.stockQty > 0);
    const totalQty = assigned.reduce((sum, p) => sum + p.stockQty, 0);
    const totalVal = assigned.reduce((sum, p) => sum + (p.stockQty * (Number(p.costPrice || p.cost || 0))), 0);

    return [
      { key: 'total_items', label: 'إجمالي الأصناف المسجلة', value: assigned.length },
      { key: 'in_stock_items', label: 'أصناف بها رصيد', value: inStock.length },
      { key: 'total_units', label: 'إجمالي الوحدات بالمخزن', value: totalQty.toLocaleString() },
      { key: 'total_value', label: 'إجمالي القيمة التقديرية', value: formatCurrency(totalVal) },
    ] as const;
  }, [locationProducts]);

  const categoryList = useMemo(() => {
    const categoriesMap = new Map<string, { id: string; name: string; count: number }>();
    categoriesMap.set('all', { id: 'all', name: 'الكل', count: 0 });

    categories.forEach((cat: any) => {
      categoriesMap.set(String(cat.id), { id: String(cat.id), name: cat.name, count: 0 });
    });
    categoriesMap.set('uncategorized', { id: 'uncategorized', name: 'بدون قسم', count: 0 });

    let totalCount = 0;
    locationProducts.forEach((p) => {
      if (!p.isAssignedToThisLocation) return;
      if (!showZeroStock && p.stockQty <= 0) return;

      totalCount++;
      const catId = p.categoryId ? String(p.categoryId) : 'uncategorized';
      const cat = categoriesMap.get(catId);
      if (cat) {
        cat.count++;
      }
    });

    const allCat = categoriesMap.get('all');
    if (allCat) allCat.count = totalCount;

    return Array.from(categoriesMap.values()).filter((c) => c.id === 'all' || c.count > 0);
  }, [locationProducts, categories, showZeroStock]);

  const visibleProducts = useMemo(() => {
    return locationProducts.filter((p) => {
      if (!p.isAssignedToThisLocation) return false;
      if (selectedCategoryId !== 'all') {
        const pCatId = p.categoryId ? String(p.categoryId) : 'uncategorized';
        if (pCatId !== selectedCategoryId) return false;
      }
      if (!showZeroStock && p.stockQty <= 0) return false;
      if (productSearch.trim()) {
        const q = productSearch.trim().toLowerCase();
        const matchesName = p.name?.toLowerCase().includes(q);
        const matchesBarcode = p.barcode?.toLowerCase().includes(q);
        if (!matchesName && !matchesBarcode) return false;
      }
      return true;
    });
  }, [locationProducts, selectedCategoryId, showZeroStock, productSearch]);

  const isLoading = productsQuery.isLoading || locationStocksQuery.isLoading || categoriesQuery.isLoading;

  return (
    <div className="page-stack page-shell warehouse-details-page" dir="rtl">
      <main className="document-prototype-column" style={{ maxWidth: '1280px', paddingBottom: '32px' }}>
      <PageHeader 
        title={`مخزن: ${location?.name || '...'}`} 
        description={`عرض تفصيلي لأرصدة وأقسام ${location?.name || t('inventory.warehouse_details_page.s0', "المخزن")} وقيمتها المالية`} 
        actions={(
          <div className="actions compact-actions page-header-actions">
            <Button 
              variant="primary" 
              onClick={() => navigate(`/inventory/counts?locationId=${locationId}`)}
              style={{ backgroundColor: '#170e5e', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <ClipboardIcon size={15} />
              {t('inventory.warehouse_details_page.start_count', "بدء جرد المخزن")}
            </Button>
            <Button 
              variant="secondary" 
              onClick={() => navigate(`/inventory/issue-order/new?fromLocationId=${locationId}`)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
            >
              <TruckIcon size={15} />
              {t('inventory.warehouse_details_page.new_transfer', "إذن صرف / تحويل")}
            </Button>
            <Button 
              variant="secondary" 
              onClick={() => navigate('/products/new')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <PlusCircleIcon size={15} />
              {t('inventory.warehouse_details_page.new_product', "تكويد صنف جديد")}
            </Button>
            <Button variant="secondary" onClick={() => setIsAssignModalOpen(true)}>
              {t('inventory.warehouse_details_page.s1', "تعيين أصناف للمخزن")}
            </Button>
            <Button variant="secondary" onClick={() => navigate('/inventory/warehouses')}>
              {t('inventory.warehouse_details_page.s2', "العودة للمخازن")}
            </Button>
          </div>
        )}
      />

      <StatsGrid items={stats} className="stats-grid compact-grid grid-cols-4" />

      {/* Categories Filter Tabs */}
      <div
        className="horizontal-scroll-tabs"
        data-horizontal-scroll="true"
        style={{
          display: 'flex',
          gap: '8px',
          overflowX: 'auto',
          padding: '6px 2px 12px 2px',
          scrollbarWidth: 'thin',
        }}
      >
        {categoryList.map((cat) => {
          const isActive = selectedCategoryId === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategoryId(cat.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '20px',
                border: isActive ? '1px solid var(--primary, #170c5c)' : '1px solid var(--border, #e2e8f0)',
                background: isActive ? 'var(--primary, #170c5c)' : '#ffffff',
                color: isActive ? '#ffffff' : '#334155',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                userSelect: 'none',
                transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
                boxShadow: isActive ? '0 2px 6px rgba(23, 12, 92, 0.2)' : '0 1px 3px rgba(0,0,0,0.02)',
              }}
            >
              <span>{cat.name}</span>
              <span style={{
                fontSize: '11px',
                padding: '2px 7px',
                borderRadius: '10px',
                background: isActive ? 'rgba(255,255,255,0.25)' : '#f1f5f9',
                color: isActive ? '#ffffff' : '#64748b',
                fontWeight: 700,
              }}>
                {cat.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search & Filter Bar */}
      <div style={{
        background: '#ffffff',
        border: '1px solid var(--border, #e2e8f0)',
        borderRadius: '12px',
        padding: '12px 18px',
        marginBottom: '16px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        boxShadow: '0 2px 6px rgba(15, 23, 42, 0.02)',
      }}>
        <div style={{ position: 'relative', width: '320px', maxWidth: '100%' }}>
          <input
            type="text"
            placeholder={t('inventory.warehouse_details_page.s3', "بحث باسم الصنف أو الباركود...")}
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid var(--border, #cbd5e1)',
              fontSize: '13px',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', color: '#334155', userSelect: 'none' }}>
            <input 
              type="checkbox" 
              checked={showZeroStock} 
              onChange={(e) => setShowZeroStock(e.target.checked)}
              style={{ width: '15px', height: '15px', accentColor: 'var(--primary, #170c5c)' }}
            />
            {t('inventory.warehouse_details_page.s4', "إظهار الأرصدة الصفرية")}
          </label>
          <span style={{ fontSize: '13px', color: '#64748b' }}>
            {t('inventory.warehouse_details_page.s5', "النتائج:")} <strong style={{ color: '#0f172a' }}>{visibleProducts.length}</strong> {t('inventory.warehouse_details_page.s6', "صنف")}
          </span>
        </div>
      </div>

      {isAssignModalOpen && (
        <AssignProductsModal locationId={locationId} locationName={location?.name} onClose={() => setIsAssignModalOpen(false)} />
      )}

      <FormSection title={t('inventory.warehouse_details_page.s7', "أصناف المخزن")}>
        {isLoading ? (
          <div className="muted small" style={{ padding: 32, textAlign: 'center' }}>{t('inventory.warehouse_details_page.s8', "جاري التحميل...")}</div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid var(--border, #e2e8f0)', borderRadius: '12px', background: '#ffffff', boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)' }}>
            <table style={{ width: '100%', minWidth: '700px', borderCollapse: 'collapse', textAlign: 'right' }}>
              <thead style={{ backgroundColor: 'var(--surface-2, #f8fafc)', borderBottom: '1px solid var(--border, #e2e8f0)' }}>
                <tr>
                  <th style={{ padding: '12px 18px', color: '#475569', fontWeight: 700, fontSize: '13px' }}>{t('inventory.warehouse_details_page.s9', "اسم الصنف")}</th>
                  <th style={{ padding: '12px 18px', color: '#475569', fontWeight: 700, fontSize: '13px' }}>{t('inventory.warehouse_details_page.s10', "الباركود")}</th>
                  <th style={{ padding: '12px 18px', color: '#475569', fontWeight: 700, fontSize: '13px' }}>{t('inventory.warehouse_details_page.s11', "القسم")}</th>
                  <th style={{ padding: '12px 18px', color: '#475569', fontWeight: 700, fontSize: '13px', textAlign: 'center' }}>{t('inventory.warehouse_details_page.s12', "الرصيد في المخزن")}</th>
                  <th style={{ padding: '12px 18px', color: '#475569', fontWeight: 700, fontSize: '13px', textAlign: 'center' }}>{t('inventory.warehouse_details_page.s13', "الرصيد الكلي للنظام")}</th>
                  <th style={{ padding: '12px 18px', color: '#475569', fontWeight: 700, fontSize: '13px', textAlign: 'center' }}>{t('inventory.warehouse_details_page.actions_col', "الإجراءات")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleProducts.map((product: any) => {
                  const isZero = Number(product.stockQty ?? 0) <= 0;
                  const cat = categories.find((c: any) => String(c.id) === String(product.categoryId));
                  const catName = cat ? cat.name : (product.categoryName || t('inventory.warehouse_details_page.s14', "بدون قسم"));

                  return (
                    <tr 
                      key={product.id} 
                      style={{ borderBottom: '1px solid var(--border, #f1f5f9)', transition: 'background 0.15s ease' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ padding: '12px 18px', fontWeight: 600, color: '#0f172a' }}>{product.name}</td>
                      <td style={{ padding: '12px 18px', color: '#64748b', fontFamily: 'monospace', fontSize: '12px' }}>{product.barcode || '—'}</td>
                      <td style={{ padding: '12px 18px' }}>
                        <span style={{ fontSize: '11.5px', padding: '2px 8px', borderRadius: '6px', background: '#f1f5f9', color: '#475569', fontWeight: 600 }}>
                          {catName}
                        </span>
                      </td>
                      <td style={{ padding: '12px 18px', textAlign: 'center' }}>
                        <span style={{
                          fontWeight: 800,
                          fontSize: '13px',
                          padding: '3px 10px',
                          borderRadius: '6px',
                          background: isZero ? '#fee2e2' : '#ecfdf5',
                          color: isZero ? '#dc2626' : '#047857',
                          border: `1px solid ${isZero ? '#fecaca' : '#a7f3d0'}`,
                        }}>
                          {product.stockQty ?? product.qty ?? 0}
                        </span>
                      </td>
                      <td style={{ padding: '12px 18px', textAlign: 'center', fontWeight: 700, color: '#64748b' }}>
                        {product.globalStockQty ?? '—'}
                      </td>
                      <td style={{ padding: '12px 18px', textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => setActiveCardProduct(product)}
                          title={t('inventory.warehouse_details_page.card_history', "كارت حركة ومخزون الصنف")}
                          style={{
                            fontSize: '12px',
                            fontWeight: 700,
                            color: '#170e5e',
                            background: '#eef2ff',
                            border: '1px solid #c7d2fe',
                            borderRadius: '6px',
                            padding: '4px 10px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <LayersIcon size={13} color="#170e5e" />
                          <span>{t('inventory.warehouse_details_page.card_btn', "حركة الصنف")}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {visibleProducts.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: '36px', textAlign: 'center', color: '#94a3b8' }}>
                      {showZeroStock ? t('inventory.warehouse_details_page.s15', "لا توجد أصناف مسجلة في هذا المخزن") : t('inventory.warehouse_details_page.s16', "لا توجد أصناف متاحة برصيد إيجابي")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </FormSection>
      </main>

      {activeCardProduct ? (
        <ProductCardModal
          product={activeCardProduct}
          onClose={() => setActiveCardProduct(null)}
          categoryName={categories.find((c: any) => String(c.id) === String(activeCardProduct.categoryId))?.name}
          locationName={location?.name}
          onEditProduct={() => navigate('/products')}
          onOpenBarcodeDialog={() => {}}
          onOpenOfferDialog={() => {}}
        />
      ) : null}
    </div>
  );
}
