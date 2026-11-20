import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { Button } from '@/shared/ui/button';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { toast } from '@/shared/components/system-alert';
import {
  SearchIcon,
  PlusIcon,
  CheckCircleIcon,
  XIcon,
} from '@/shared/components/icons/AppIcons';
import {
  vanSalesApi,
  PreSalesCatalogItem,
} from '../api/van-sales.api';
import { VanFloatingActionBar } from './VanFloatingActionBar';
import { SubTabsSelector, BookingHeader } from './van-pre-sales/booking-header';
import { VanInvoiceReviewModal } from './VanInvoiceReviewModal';
import { CompactStepper } from './van-pre-sales/compact-stepper';
import { roundMoney } from '../utils/van-money.utils';
import { MyOrdersView } from './van-pre-sales/my-orders-view';
import { CartPanel } from './van-pre-sales/cart-panel';
import { SearchResults } from './van-pre-sales/search-results';
import { CatalogSearchBar } from './van-pre-sales/catalog-search-bar';
import { usePreSalesCartLogic } from './van-pre-sales/cart-logic';
import { calculateItemPrice } from './van-pre-sales/calculate-item-price';
import type { PreSalesCartLine, VanPreSalesTabProps, CompactStepperProps } from './van-pre-sales/van-pre-sales-types';


export const VanPreSalesTab: React.FC<VanPreSalesTabProps> = ({
  customers,
  selectedCustomerId,
  onSelectCustomer,
  repId: _repId,
  repName: _repName,
}) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [activeSubTab, setActiveSubTab] = useState<'new-booking' | 'my-orders'>('new-booking');
  const [paymentTerms, setPaymentTerms] = useState<'cash' | 'credit'>('cash');
  const [searchCatalogQuery, setSearchCatalogQuery] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [bookingNotes, setBookingNotes] = useState('');

  // Browsing by company and category
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [allCategoriesModalOpen, setAllCategoriesModalOpen] = useState(false);
  const [categoryModalSearch, setCategoryModalSearch] = useState('');
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);


  // Cart
  const [cart, setCart] = useState<PreSalesCartLine[]>([]);

  // Fetch Warehouse Catalog
  const {
    data: catalogProducts = [],
    isLoading: isCatalogLoading,
  } = useQuery({
    queryKey: ['van-presales-warehouse-catalog', searchCatalogQuery],
    queryFn: () => vanSalesApi.fetchPreSalesCatalog({ search: searchCatalogQuery.trim() || undefined }),
    staleTime: 30_000,
  });

  // Fetch My Pre-Sales Orders
  const {
    data: myOrders = [],
    isLoading: isMyOrdersLoading,
    refetch: refetchMyOrders,
    isFetching: isMyOrdersFetching,
  } = useQuery({
    queryKey: ['van-presales-my-orders'],
    queryFn: () => vanSalesApi.fetchMyPreSalesOrders(),
    staleTime: 15_000,
  });

  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [hideOutOfStockCompanies, setHideOutOfStockCompanies] = useState(false);

  // Group products by Company (Supplier)
  const companies = useMemo(() => {
    const map = new Map<string, {
      name: string;
      totalProducts: number;
      availableProducts: number;
      categoryMap: Map<string, { id: number | null; name: string; count: number }>;
    }>();

    for (const prod of catalogProducts) {
      const compName = (prod.supplierName || '').trim() || 'الشركة العامة';
      if (!map.has(compName)) {
        map.set(compName, {
          name: compName,
          totalProducts: 0,
          availableProducts: 0,
          categoryMap: new Map(),
        });
      }
      const c = map.get(compName)!;
      c.totalProducts += 1;
      if (prod.warehouseAvailable > 0) {
        c.availableProducts += 1;
      }

      const catName = (prod.categoryName || '').trim() || 'عام';
      const catId = prod.categoryId ?? null;
      if (!c.categoryMap.has(catName)) {
        c.categoryMap.set(catName, { id: catId, name: catName, count: 0 });
      }
      c.categoryMap.get(catName)!.count += 1;
    }

    return Array.from(map.values())
      .map((c) => ({
        name: c.name,
        totalProducts: c.totalProducts,
        availableProducts: c.availableProducts,
        categories: Array.from(c.categoryMap.values()),
      }))
      .sort((a, b) => b.availableProducts - a.availableProducts);
  }, [catalogProducts]);



  // Categories for currently selected company
  const companyCategories = useMemo(() => {
    if (!selectedCompany) return [];
    if (selectedCompany === '__ALL__') {
      const catMap = new Map<string, { id: number | null; name: string; count: number }>();
      for (const p of catalogProducts) {
        const catName = (p.categoryName || '').trim() || 'عام';
        if (!catMap.has(catName)) {
          catMap.set(catName, { id: p.categoryId ?? null, name: catName, count: 0 });
        }
        catMap.get(catName)!.count += 1;
      }
      return Array.from(catMap.values());
    }
    const found = companies.find((c) => c.name === selectedCompany);
    return found ? found.categories : [];
  }, [companies, selectedCompany, catalogProducts]);




  // Selected customer object
  const selectedCustomer = useMemo(() => {
    if (!selectedCustomerId) return null;
    return customers.find((c) => Number(c.id) === Number(selectedCustomerId)) || null;
  }, [customers, selectedCustomerId]);


  const {
    handleUpdateProductUnits,
    handleCartDelta,
    handlePaymentTermsChange,
    cartGrossSubtotal,
    cartNetTotal,
    cartDiscountAmount,
    totalPieces,
  } = usePreSalesCartLogic({ cart, setCart, paymentTerms, setPaymentTerms, catalogProducts });

  // Submit Pre-Sales Booking Mutation
  const createOrderMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCustomerId) {
        throw new Error('يرجى اختيار العميل المطلوب حجز الطلبية له أولاً');
      }
      if (cart.length === 0) {
        throw new Error('سلة الحجز فارغة. أضف أصنافاً أولاً');
      }

      const itemsPayload: Array<{
        productId: number;
        qty: number;
        quantity: number;
        unitName: string;
        unitMultiplier: number;
        unitPrice: number;
      }> = [];

      for (const line of cart) {
        if (line.cartonMultiplier > 1) {
          if (line.cartons > 0) {
            itemsPayload.push({
              productId: line.productId,
              qty: line.cartons,
              quantity: line.cartons,
              unitName: line.packagingUnitName || 'كرتونة',
              unitMultiplier: line.cartonMultiplier,
              unitPrice: line.cartonUnitPrice,
            });
          }
          if (line.pieces > 0) {
            itemsPayload.push({
              productId: line.productId,
              qty: line.pieces,
              quantity: line.pieces,
              unitName: 'قطعة',
              unitMultiplier: 1,
              unitPrice: line.pieceUnitPrice,
            });
          }
        } else {
          itemsPayload.push({
            productId: line.productId,
            qty: line.quantity,
            quantity: line.quantity,
            unitName: line.unitName || 'قطعة',
            unitMultiplier: 1,
            unitPrice: line.pieceUnitPrice,
          });
        }
      }

      return vanSalesApi.createPreSalesOrder({
        customerId: Number(selectedCustomerId),
        paymentMethod: paymentTerms,
        notes: bookingNotes.trim() || undefined,
        deliveryDate: deliveryDate || undefined,
        items: itemsPayload,
      });
    },
    onSuccess: (res) => {
      toast.success(`تم حجز الطلبية رقم #${res.orderNumber} بالمخزن الرئيسي وإرسالها للمشرف للاعتماد!`);
      setCart([]);
      setBookingNotes('');
      setDeliveryDate('');
      setActiveSubTab('my-orders');
      queryClient.invalidateQueries({ queryKey: ['van-presales-warehouse-catalog'] });
      queryClient.invalidateQueries({ queryKey: ['van-presales-my-orders'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'تعذر تسجيل وحجز طلبية المندوب');
    },
  });

  const handleConfirmOrder = () => {
    if (!selectedCustomerId) {
      toast.warning('يرجى اختيار العميل المطلوب حجز الطلبية له أولاً');
      const cartSelect = document.getElementById('cart-customer-select');
      if (cartSelect) {
        cartSelect.focus();
        cartSelect.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    if (cart.length === 0) {
      toast.warning('سلة الحجز فارغة. أضف أصنافاً أولاً');
      return;
    }

    // Open pre-confirmation review modal first
    setIsReviewModalOpen(true);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingBottom: '24px' }}>
      <SubTabsSelector activeSubTab={activeSubTab} setActiveSubTab={setActiveSubTab} myOrders={myOrders} />

      {activeSubTab === 'new-booking' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <BookingHeader customers={customers} selectedCustomerId={selectedCustomerId} onSelectCustomer={onSelectCustomer} paymentTerms={paymentTerms} handlePaymentTermsChange={handlePaymentTermsChange} selectedCustomer={selectedCustomer} />

          <CatalogSearchBar
            searchCatalogQuery={searchCatalogQuery}
            setSearchCatalogQuery={setSearchCatalogQuery}
          />

          <SearchResults
            searchCatalogQuery={searchCatalogQuery}
            setSearchCatalogQuery={setSearchCatalogQuery}
            showOutOfStock={showOutOfStock}
            setShowOutOfStock={setShowOutOfStock}
            hideOutOfStockCompanies={hideOutOfStockCompanies}
            setHideOutOfStockCompanies={setHideOutOfStockCompanies}
            selectedCompany={selectedCompany}
            setSelectedCompany={setSelectedCompany}
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            setAllCategoriesModalOpen={setAllCategoriesModalOpen}
            setCategoryModalSearch={setCategoryModalSearch}
            cart={cart}
            catalogProducts={catalogProducts}
            companies={companies}
            companyCategories={companyCategories}
            renderProductsList={renderProductsList}
          />

          <CartPanel
            cart={cart}
            catalogProducts={catalogProducts}
            paymentTerms={paymentTerms}
            handlePaymentTermsChange={handlePaymentTermsChange}
            handleCartDelta={handleCartDelta}
            handleUpdateProductUnits={handleUpdateProductUnits}
            cartGrossSubtotal={cartGrossSubtotal}
            cartNetTotal={cartNetTotal}
            cartDiscountAmount={cartDiscountAmount}
            totalPieces={totalPieces}
            customers={customers}
            selectedCustomerId={selectedCustomerId}
            onSelectCustomer={onSelectCustomer}
            selectedCustomer={selectedCustomer}
            deliveryDate={deliveryDate}
            setDeliveryDate={setDeliveryDate}
            bookingNotes={bookingNotes}
            setBookingNotes={setBookingNotes}
            createOrderMutation={createOrderMutation}
            handleConfirmOrder={handleConfirmOrder}
          />
        </div>
      ) : (
        <MyOrdersView
          myOrders={myOrders}
          isMyOrdersLoading={isMyOrdersLoading}
          isMyOrdersFetching={isMyOrdersFetching}
          refetchMyOrders={refetchMyOrders}
        />
      )}

      {/* 5. ALL CATEGORIES MODAL (BottomSheet Dialog) */}
      {allCategoriesModalOpen && (
        <StandardDialog
          open={allCategoriesModalOpen}
          onClose={() => setAllCategoriesModalOpen(false)}
          title={t('delivery_reps.van_pre_sales_tab.s81', "اختيار قسم المنتجات")}
          subtitle={`أقسام (${selectedCompany === '__ALL__' ? t('delivery_reps.van_pre_sales_tab.s82', "كافة الشركات") : selectedCompany}) • انقر لاختيار القسم وتصفية الأصناف فوراً`}
          badge={`${companyCategories.length} قسم`}
          width="min(520px, 95vw)"
          compact={true}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} dir="rtl">
            {/* Search Input for categories if more than 5 */}
            {companyCategories.length > 5 && (
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={categoryModalSearch}
                  onChange={(e) => setCategoryModalSearch(e.target.value)}
                  placeholder={t('delivery_reps.van_pre_sales_tab.s83', "ابحث عن قسم...")}
                  style={{
                    width: '100%',
                    height: '34px',
                    padding: '0 32px 0 10px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
                <div style={{ position: 'absolute', right: '9px', top: '9px', pointerEvents: 'none', color: '#94a3b8' }}>
                  <SearchIcon size={14} />
                </div>
                {categoryModalSearch && (
                  <button
                    type="button"
                    onClick={() => setCategoryModalSearch('')}
                    style={{
                      position: 'absolute',
                      left: '8px',
                      top: '8px',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      color: '#94a3b8',
                      padding: 0,
                    }}
                  >
                    <XIcon size={14} />
                  </button>
                )}
              </div>
            )}

            {/* Grid of categories */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(135px, 1fr))',
                gap: '8px',
                maxHeight: '340px',
                overflowY: 'auto',
                padding: '2px',
              }}
            >
              {/* Option: All Categories */}
              <button
                type="button"
                onClick={() => {
                  setSelectedCategory('all');
                  setAllCategoriesModalOpen(false);
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  justifyContent: 'center',
                  gap: '3px',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: selectedCategory === 'all' ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
                  backgroundColor: selectedCategory === 'all' ? '#eef2ff' : '#ffffff',
                  color: selectedCategory === 'all' ? '#170e5e' : '#0f172a',
                  cursor: 'pointer',
                  textAlign: 'right',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span style={{ fontSize: '12px', fontWeight: 800 }}>{t('delivery_reps.van_pre_sales_tab.s84', "كافة الأقسام")}</span>
                  {selectedCategory === 'all' && <CheckCircleIcon size={13} color="#170e5e" />}
                </div>
                <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                  {selectedCompany === '__ALL__' ? catalogProducts.length : catalogProducts.filter((p) => ((p.supplierName || '').trim() || t('delivery_reps.van_pre_sales_tab.s85', "الشركة العامة")) === selectedCompany).length} {t('delivery_reps.van_pre_sales_tab.s86', "صنف")}
                </span>
              </button>

              {/* Company Categories */}
              {companyCategories
                .filter((cat) => !categoryModalSearch.trim() || cat.name.toLowerCase().includes(categoryModalSearch.trim().toLowerCase()))
                .map((cat) => {
                  const isSelected = selectedCategory === cat.name;
                  return (
                    <button
                      key={cat.name}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(cat.name);
                        setAllCategoriesModalOpen(false);
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        justifyContent: 'center',
                        gap: '3px',
                        padding: '10px 12px',
                        borderRadius: '10px',
                        border: isSelected ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
                        backgroundColor: isSelected ? '#eef2ff' : '#ffffff',
                        color: isSelected ? '#170e5e' : '#0f172a',
                        cursor: 'pointer',
                        textAlign: 'right',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <span style={{ fontSize: '12px', fontWeight: isSelected ? 800 : 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {cat.name}
                        </span>
                        {isSelected && <CheckCircleIcon size={13} color="#170e5e" />}
                      </div>
                      <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                        {cat.count} {t('delivery_reps.van_pre_sales_tab.s87', "صنف")}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        </StandardDialog>
      )}

      {/* 6. ORDER PREVIEW & CONFIRMATION MODAL */}
      <VanInvoiceReviewModal
        open={isReviewModalOpen}
        onClose={() => setIsReviewModalOpen(false)}
        onConfirm={() => {
          setIsReviewModalOpen(false);
          createOrderMutation.mutate();
        }}
        isSubmitting={createOrderMutation.isPending}
        customer={customers.find((c) => c.id === selectedCustomerId) || null}
        paymentTerms={paymentTerms}
        deliveryDate={deliveryDate}
        bookingNotes={bookingNotes}
        items={cart.map((line) => ({
          productId: line.productId,
          productName: line.productName,
          unitName: line.unitName,
          cartons: line.cartons,
          pieces: line.pieces,
          totalPieces: line.quantity,
          cartonUnitPrice: line.cartonUnitPrice,
          pieceUnitPrice: line.pieceUnitPrice,
          unitPrice: line.unitPrice,
          subtotal:
            line.cartonMultiplier > 1 && (line.cartons > 0 || line.pieces > 0)
              ? line.cartons * line.cartonUnitPrice + line.pieces * line.pieceUnitPrice
              : line.quantity * line.pieceUnitPrice,
          warehouseAvailable: line.warehouseAvailable,
        }))}
        totalAmount={cartNetTotal}
        subtotal={cartGrossSubtotal}
        totalDiscount={cartDiscountAmount}
        title={t('delivery_reps.van_pre_sales_tab.s88', "معاينة تفاصيل الطلبية قبل الاعتماد النهائي")}
        subtitle={t('delivery_reps.van_pre_sales_tab.s89', "راجع الأصناف والكميات والأسعار بعناية، يمكنك التعديل أو التأكيد النهائي")}
        confirmButtonText={t('delivery_reps.van_pre_sales_tab.s90', "تأكيد نهائي لحجز الطلبية")}
        editButtonText={t('delivery_reps.van_pre_sales_tab.s91', "تعديل الأصناف والكميات")}
      />

      {/* 7. FLOATING ACTION BUTTON (FAB) FOR PRE-SALES */}
      <VanFloatingActionBar
        visible={activeSubTab === 'new-booking' && cart.length > 0}
        itemCount={cart.length}
        actionText={selectedCustomerId ? t('delivery_reps.van_pre_sales_tab.s92', "تأكيد الحجز") : t('delivery_reps.van_pre_sales_tab.s93', "اختر العميل")}
        onAction={() => {
          if (!selectedCustomerId) {
            toast.warning(t('delivery_reps.van_pre_sales_tab.s94', "يرجى اختيار العميل المطلوب حجز الطلبية له أولاً"));
            const el = document.getElementById('cart-customer-select');
            if (el) {
              el.focus();
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          } else {
            setIsReviewModalOpen(true);
          }
        }}
      />
    </div>
  );

  /**
   * Helper function to render a list of products with dual Carton & Piece steppers.
   */
  function renderProductsList(products: PreSalesCatalogItem[]) {
    if (isCatalogLoading) {
      return (
        <div style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '12px', backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          {t('delivery_reps.van_pre_sales_tab.s95', "جاري جلب رصيد المخزن الرئيسي والأسعار...")}
        </div>
      );
    }

    if (products.length === 0) {
      return (
        <div style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '12px', backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          {t('delivery_reps.van_pre_sales_tab.s96', "لا توجد أصناف مطابقة في هذا القسم بالمخزن الرئيسي")}
        </div>
      );
    }

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        {products.map((prod) => {
          const isOutOfStock = prod.warehouseAvailable <= 0;
          const pricing = calculateItemPrice(prod, paymentTerms, 1, 1);
          const mult = prod.packagingUnit?.multiplier || 1;
          const isCartonItem = Boolean(prod.packagingUnit && mult > 1);

          // Get current selected quantities from cart
          const cartItem = cart.find((l) => l.productId === prod.id);
          const currentCartons = cartItem?.cartons || 0;
          const currentPieces = isCartonItem ? (cartItem?.pieces || 0) : (cartItem?.quantity || 0);
          const totalChosen = cartItem?.quantity || 0;

          // Available in cartons breakdown
          const availCartons = isCartonItem ? Math.floor(prod.warehouseAvailable / mult) : 0;
          const availPieces = isCartonItem ? prod.warehouseAvailable % mult : prod.warehouseAvailable;

          const lineTotal = isCartonItem
            ? currentCartons * (pricing.effectivePrice * mult) + currentPieces * pricing.effectivePrice
            : totalChosen * pricing.effectivePrice;

          return (
            <div
              key={prod.id}
              style={{
                border: totalChosen > 0 ? '1.5px solid #a5b4fc' : '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '8px 10px',
                backgroundColor: isOutOfStock && totalChosen === 0 ? '#f8fafc' : totalChosen > 0 ? '#fafbff' : '#ffffff',
                opacity: isOutOfStock && totalChosen === 0 ? 0.65 : 1,
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
                boxShadow: totalChosen > 0 ? '0 1px 4px rgba(99, 102, 241, 0.08)' : '0 1px 2px rgba(0,0,0,0.02)',
              }}
            >
              {/* Row 1: Product Name, Pack Unit Pill, Barcode */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 800, fontSize: '12px', color: '#0f172a', lineHeight: 1.3 }}>
                      {prod.name}
                    </span>
                    {isCartonItem && (
                      <span
                        style={{
                          fontSize: '9.5px',
                          fontWeight: 700,
                          color: '#3730a3',
                          backgroundColor: '#eef2ff',
                          border: '1px solid #c7d2fe',
                          padding: '0.5px 5px',
                          borderRadius: '4px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {prod.packagingUnit?.name || t('delivery_reps.van_pre_sales_tab.s97', "كرتونة")} ({mult}{t('delivery_reps.van_pre_sales_tab.s98', "ق)")}
                      </span>
                    )}
                  </div>

                  {/* Subtitle: Supplier & Category in a tight single line */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#64748b' }}>
                    {selectedCompany === '__ALL__' && prod.supplierName && (
                      <>
                        <span style={{ whiteSpace: 'nowrap' }}>{prod.supplierName}</span>
                        <span>•</span>
                      </>
                    )}
                    {prod.categoryName && <span style={{ whiteSpace: 'nowrap' }}>{prod.categoryName}</span>}
                  </div>
                </div>

                {prod.barcode ? (
                  <span
                    style={{
                      fontSize: '9.5px',
                      color: '#64748b',
                      fontFamily: 'monospace',
                      backgroundColor: '#f1f5f9',
                      border: '1px solid #e2e8f0',
                      padding: '1px 5px',
                      borderRadius: '4px',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    {prod.barcode}
                  </span>
                ) : null}
              </div>

              {/* Row 2: Price & Available Stock (Single Balanced Row) */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                {/* Price block */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                  <span style={{ color: '#170e5e', fontWeight: 900, fontSize: '12.5px' }}>
                    {pricing.effectivePrice.toFixed(2)} <CurrencySymbol />
                    <span style={{ fontSize: '10px', fontWeight: 500, color: '#64748b' }}> {t('delivery_reps.van_pre_sales_tab.s99', "/ ق")}</span>
                  </span>

                  {paymentTerms === 'cash' && pricing.cashDiscountPerUnit > 0 && (
                    <span style={{ fontSize: '10px', color: '#94a3b8', textDecoration: 'line-through' }}>
                      {pricing.listPrice.toFixed(2)}
                    </span>
                  )}

                  {paymentTerms === 'cash' && pricing.cashDiscountPerUnit > 0 && (
                    <span
                      style={{
                        fontSize: '9.5px',
                        fontWeight: 700,
                        color: '#059669',
                        backgroundColor: '#dcfce7',
                        border: '1px solid #86efac',
                        padding: '0.5px 5px',
                        borderRadius: '4px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t('delivery_reps.van_pre_sales_tab.s100', "وفر")} {pricing.cashDiscountPerUnit.toFixed(2)} {t('delivery_reps.van_pre_sales_tab.s101', "كاش")}
                    </span>
                  )}

                  {paymentTerms === 'credit' && (
                    <span style={{ color: '#b45309', fontSize: '9.5px', fontWeight: 700, backgroundColor: '#fef3c7', padding: '1px 5px', borderRadius: '4px' }}>
                      {t('delivery_reps.van_pre_sales_tab.s102', "(سعر الآجل)")}
                    </span>
                  )}

                  {isCartonItem && (
                    <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#4338ca', backgroundColor: '#eef2ff', padding: '1px 5px', borderRadius: '4px' }}>
                      {(pricing.effectivePrice * mult).toFixed(2)} / {prod.packagingUnit?.name || t('delivery_reps.van_pre_sales_tab.s103', "ك")}
                    </span>
                  )}

                  {pricing.consumerPrice ? (
                    <span style={{ fontSize: '10px', color: '#64748b' }}>
                      {t('delivery_reps.van_pre_sales_tab.s104', "(مستهلك:")} {pricing.consumerPrice.toFixed(2)})
                    </span>
                  ) : null}
                </div>

                {/* Stock badge */}
                <div style={{ flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      color: isOutOfStock ? '#b91c1c' : '#047857',
                      backgroundColor: isOutOfStock ? '#fee2e2' : '#f0fdf4',
                      border: `1px solid ${isOutOfStock ? '#fca5a5' : '#bbf7d0'}`,
                      padding: '1.5px 6px',
                      borderRadius: '5px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: isOutOfStock ? '#ef4444' : '#10b981', display: 'inline-block' }} />
                    {isOutOfStock ? (
                      t('delivery_reps.van_pre_sales_tab.s105', "نفد من المخزن")
                    ) : isCartonItem ? (
                      `متاح: ${availCartons} ك ${availPieces > 0 ? `+ ${availPieces} ق` : ''} (${prod.warehouseAvailable} ق)`
                    ) : (
                      `متاح: ${prod.warehouseAvailable} قطعة`
                    )}
                  </span>
                </div>
              </div>

              {/* Row 3: Actions / Steppers (Height 28px - 30px) */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: '3px',
                  borderTop: '1px dashed #f1f5f9',
                  gap: '6px',
                }}
              >
                {isOutOfStock && totalChosen === 0 ? (
                  <span style={{ fontSize: '10.5px', color: '#94a3b8', fontWeight: 600 }}>{t('delivery_reps.van_pre_sales_tab.s106', "الصنف غير متوفر بالمخزن")}</span>
                ) : isCartonItem ? (
                  totalChosen === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                      <button
                        type="button"
                        onClick={() => handleUpdateProductUnits(prod, 1, 0)}
                        style={{
                          flex: 1,
                          height: '28px',
                          borderRadius: '6px',
                          border: 'none',
                          backgroundColor: '#170e5e',
                          color: '#ffffff',
                          fontSize: '11px',
                          fontWeight: 800,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                        }}
                      >
                        <PlusIcon size={12} color="#ffffff" />
                        <span>{t('delivery_reps.van_pre_sales_tab.s107', "+ حجز")} {prod.packagingUnit?.name || t('delivery_reps.van_pre_sales_tab.s108', "كرتونة")} ({mult}{t('delivery_reps.van_pre_sales_tab.s109', "ق)")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateProductUnits(prod, 0, 1)}
                        style={{
                          height: '28px',
                          padding: '0 10px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          backgroundColor: '#f8fafc',
                          color: '#334155',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '3px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <PlusIcon size={11} color="#64748b" />
                        <span>{t('delivery_reps.van_pre_sales_tab.s110', "+ بالقطعة")}</span>
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <CompactStepper
                          value={currentCartons}
                          unitLabel={prod.packagingUnit?.name || t('delivery_reps.van_pre_sales_tab.s111', "كرتونة")}
                          onIncrement={() => handleUpdateProductUnits(prod, currentCartons + 1, currentPieces)}
                          onDecrement={() => handleUpdateProductUnits(prod, Math.max(0, currentCartons - 1), currentPieces)}
                          onChange={(val) => handleUpdateProductUnits(prod, val, currentPieces)}
                          disabledDecrement={currentCartons <= 0}
                          height="27px"
                          inputWidth="30px"
                        />
                        <span style={{ fontWeight: 800, color: '#94a3b8', fontSize: '11px' }}>+</span>
                        <CompactStepper
                          value={currentPieces}
                          unitLabel={t('delivery_reps.van_pre_sales_tab.s112', "قطع")}
                          onIncrement={() => handleUpdateProductUnits(prod, currentCartons, currentPieces + 1)}
                          onDecrement={() => handleUpdateProductUnits(prod, currentCartons, Math.max(0, currentPieces - 1))}
                          onChange={(val) => handleUpdateProductUnits(prod, currentCartons, val)}
                          disabledDecrement={currentPieces <= 0}
                          height="27px"
                          inputWidth="30px"
                        />
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
                        <span style={{ fontWeight: 700, color: '#64748b' }}>
                          ({totalChosen} {t('delivery_reps.van_pre_sales_tab.s113', "ق)")}
                        </span>
                        <span style={{ fontWeight: 800, color: '#170e5e' }}>
                          {lineTotal.toFixed(2)} <CurrencySymbol />
                        </span>
                      </div>
                    </div>
                  )
                ) : (
                  totalChosen === 0 ? (
                    <button
                      type="button"
                      onClick={() => handleUpdateProductUnits(prod, 0, 1)}
                      style={{
                        width: '100%',
                        height: '28px',
                        borderRadius: '6px',
                        border: 'none',
                        backgroundColor: '#170e5e',
                        color: '#ffffff',
                        fontSize: '11px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                      }}
                    >
                      <PlusIcon size={12} color="#ffffff" />
                      <span>{t('delivery_reps.van_pre_sales_tab.s114', "+ إضافة للطلبية")}</span>
                    </button>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                      <span style={{ fontSize: '11px', fontWeight: 800, color: '#170e5e' }}>
                        {t('delivery_reps.van_pre_sales_tab.s115', "القيمة:")} {lineTotal.toFixed(2)} <CurrencySymbol />
                      </span>
                      <CompactStepper
                        value={currentPieces}
                        unitLabel={t('delivery_reps.van_pre_sales_tab.s116', "قطع")}
                        onIncrement={() => handleUpdateProductUnits(prod, 0, currentPieces + 1)}
                        onDecrement={() => handleUpdateProductUnits(prod, 0, Math.max(0, currentPieces - 1))}
                        onChange={(val) => handleUpdateProductUnits(prod, 0, val)}
                        disabledDecrement={currentPieces <= 0}
                        height="27px"
                        inputWidth="34px"
                      />
                    </div>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
};
