import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { Button } from '@/shared/ui/button';
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
import { ProductsList } from './van-pre-sales/products-list';
import { CategoriesModal } from './van-pre-sales/categories-modal';
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

      <CategoriesModal
        allCategoriesModalOpen={allCategoriesModalOpen}
        setAllCategoriesModalOpen={setAllCategoriesModalOpen}
        categoryModalSearch={categoryModalSearch}
        setCategoryModalSearch={setCategoryModalSearch}
        selectedCompany={selectedCompany}
        selectedCategory={selectedCategory}
        setSelectedCategory={setSelectedCategory}
        companyCategories={companyCategories}
        catalogProducts={catalogProducts}
      />

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

};
