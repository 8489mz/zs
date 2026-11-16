// Sale tab for the van sales mobile page — pure move of the cart state,
// the cart handlers and memos, the execute-sale mutation, the sale,
// pre-sales and sales-history tabs, and the checkout and receipt modals.
// The facade calls the hook once and passes hook values as props; the
// tabs and modals take the trip data and the visit and router values
// as props.
import { useTranslation } from 'react-i18next';
import React, { useState, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import { useMutation, type QueryClient } from '@tanstack/react-query';
import { vanSalesApi, VanActiveTripResponse, VanStockItem, VanCustomerItineraryItem } from '@/features/delivery-reps/api/van-sales.api';
import { vanOfflineDb } from '@/features/delivery-reps/offline/van-sales-offline.db';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { Button } from '@/shared/ui/button';
import { ReceiptIcon } from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { VanSaleTab, CartItem } from '@/features/delivery-reps/components/VanSaleTab';
import { VanPreSalesTab } from '@/features/delivery-reps/components/VanPreSalesTab';
import { VanSalesHistoryTab } from '@/features/delivery-reps/components/VanSalesHistoryTab';
import { VanSaleCheckoutModal } from '@/features/delivery-reps/components/VanSaleCheckoutModal';
import { VanSalesReceiptModal } from '@/features/delivery-reps/components/VanSalesReceiptModal';
import { DriverPortalUser } from '@/shared/api/delivery-reps.api';

export type VanMobileTabKey = 'cockpit' | 'itinerary' | 'inventory' | 'sale' | 'pre-sales' | 'sales-history' | 'collection' | 'fleet' | 'settle' | 'requisitions';

export interface UseVanSaleDeps {
  session: { token: string; rep: DriverPortalUser } | null;
  queryClient: QueryClient;
  setPendingSyncCount: Dispatch<SetStateAction<number>>;
  showAlert: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void;
  data: VanActiveTripResponse | undefined;
  itinerary: VanCustomerItineraryItem[];
  activeVisit: {
    customerId: number;
    customerName: string;
    startedAt: number;
    startedTimeStr?: string;
    latitude?: number;
    longitude?: number;
    visitId?: number;
  } | null;
  handleEndVisit: () => void;
}

export function useVanSale({
  session,
  queryClient,
  setPendingSyncCount,
  showAlert,
  data,
  itinerary,
  activeVisit,
  handleEndVisit,
}: UseVanSaleDeps) {
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);

  const [saleNotes, setSaleNotes] = useState('');
  const [deliveryProofPhoto, setDeliveryProofPhoto] = useState('');
  const [cartonsCount, setCartonsCount] = useState('');

  const [selectedCustomerId, setSelectedCustomerId] = useState<number | ''>('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'credit' | 'card' | 'split'>('cash');
  const [cart, setCart] = useState<CartItem[]>([]);

  const [lastSaleReceipt, setLastSaleReceipt] = useState<any | null>(null);

  const [isCheckoutProcessing, setIsCheckoutProcessing] = useState<boolean>(false);
  const isCheckoutProcessingRef = useRef<boolean>(false);
  const pendingAutoShareWhatsAppRef = useRef<boolean>(false);

  const addToCart = (item: VanStockItem) => {
    setCart((prev) => {
      const exists = prev.find((c) => c.productId === item.productId);
      if (exists) {
        if (exists.qty >= item.qty) {
          showAlert('error', `أقصى كمية متوفرة بالسيارة هي ${item.qty}`);
          return prev;
        }
        return prev.map((c) => (c.productId === item.productId ? { ...c, qty: c.qty + 1 } : c));
      }
      const initialUnit = item.availableUnits?.[0];
      // INV-VAN-FIELD-SALE-WHOLESALE-PRICE: wholesale-typed customer
      // starts the cart line at the wholesale price (per piece, like
      // retailPrice); unit changes re-derive it in changeCartItemUnit.
      const startUnitPrice = selectedCustomer?.customer_type === 'wholesale' && item.wholesalePrice != null && Number(item.wholesalePrice) > 0
        ? Number(item.wholesalePrice)
        : item.retailPrice;
      return [
        ...prev,
        {
          productId: item.productId,
          name: item.productName,
          qty: 1,
          unitPrice: startUnitPrice,
          originalPrice: item.originalPrice,
          offerBadge: item.offerBadge,
          maxQty: item.qty,
          unitName: initialUnit?.name || (typeof item.packagingUnit === 'string' ? item.packagingUnit : item.packagingUnit?.name) || 'قطعة',
          unitMultiplier: initialUnit?.multiplier || 1,
          availableUnits: item.availableUnits,
          isBonus: false,
        },
      ];
    });
  };

  const toggleCartItemBonus = (productId: number) => {
    setCart((prev) =>
      prev.map((c) => {
        if (c.productId === productId) {
          const nextBonus = !c.isBonus;
          if (nextBonus) {
            showAlert('info', 'تم تحديد الصنف كبونص مجاني. سيتطلب اعتماد المشرف برمز PIN عند إتمام الفاتورة ما لم يتوفر عرض ترويجي نشط.');
          }
          return {
            ...c,
            isBonus: nextBonus,
            bonusReason: nextBonus ? 'بونص ترويجي ميداني' : undefined,
            unitPrice: nextBonus ? 0 : (c.originalPrice || c.unitPrice),
          };
        }
        return c;
      }),
    );
  };

  const changeCartItemUnit = (productId: number, unitName: string, multiplier: number) => {
    setCart((prev) =>
      prev.map((c) => {
        if (c.productId === productId) {
          const stockItem = data?.inventory?.find((it) => it.productId === productId);
          // INV-VAN-FIELD-SALE-WHOLESALE-PRICE: wholesale-typed
          // customer re-derives the unit price from wholesalePrice,
          // falling back to the retail chain when it is absent/zero.
          const basePrice = selectedCustomer?.customer_type === 'wholesale' && stockItem?.wholesalePrice != null && Number(stockItem.wholesalePrice) > 0
            ? Number(stockItem.wholesalePrice)
            : (stockItem?.retailPrice || c.originalPrice || c.unitPrice);
          const newUnitPrice = c.isBonus ? 0 : basePrice * (multiplier || 1);
          return {
            ...c,
            unitName,
            unitMultiplier: multiplier,
            unitPrice: newUnitPrice,
          };
        }
        return c;
      }),
    );
  };

  const updateCartQty = (productId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.productId === productId) {
            const next = c.qty + delta;
            if (next > c.maxQty) {
              showAlert('error', `أقصى كمية متوفرة هي ${c.maxQty}`);
              return c;
            }
            return { ...c, qty: next };
          }
          return c;
        })
        .filter((c) => c.qty > 0),
    );
  };

  const allAvailableCustomers = useMemo(() => {
    const map = new Map<number, any>();
    if (data?.customers && Array.isArray(data.customers)) {
      for (const c of data.customers) {
        map.set(c.id, c);
      }
    }
    if (itinerary && Array.isArray(itinerary)) {
      for (const it of itinerary) {
        if (!map.has(it.customerId)) {
          map.set(it.customerId, {
            id: it.customerId,
            name: it.customerName,
            phone: it.customerPhone,
            address: it.customerAddress,
            balance: it.balance,
            creditLimit: it.creditLimit,
            customerCode: it.customerCode,
            route: it.route,
            district: it.district || it.route || '',
            locationUrl: it.locationUrl,
          });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [data?.customers, itinerary]);

  // INV-VAN-FIELD-SALE-WHOLESALE-PRICE: the cart prices by the
  // selected customer's type — a wholesale-typed customer is charged
  // the wholesale price, everyone else retail/credit as before.
  const selectedCustomer = useMemo(
    () => (selectedCustomerId === '' ? null : allAvailableCustomers.find((c) => String(c.id) === String(selectedCustomerId)) || null),
    [allAvailableCustomers, selectedCustomerId],
  );

  const cartTotal = useMemo(() => cart.reduce((sum, c) => sum + (c.isBonus ? 0 : c.qty * c.unitPrice), 0), [cart]);

  const cartSubtotal = useMemo(() => {
    return cart.reduce((sum, c) => {
      if (c.isBonus) return sum;
      const orig = (c.originalPrice && c.originalPrice > c.unitPrice) ? c.originalPrice : c.unitPrice;
      return sum + c.qty * orig;
    }, 0);
  }, [cart]);

  const cartDiscount = useMemo(() => {
    return Math.max(0, cartSubtotal - cartTotal);
  }, [cartSubtotal, cartTotal]);

  const executeSaleMutation = useMutation({
    networkMode: 'always',
    mutationFn: async (payload: any) => {
      const isActuallyOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isActuallyOffline) {
        const offRes = await vanOfflineDb.recordOfflineSale({
          tripId: payload.tripId,
          customerId: payload.customerId,
          customerName: payload.customerName,
          items: payload.items,
          paymentMethod: payload.paymentMethod,
          paidAmount: payload.paidAmount,
          notes: payload.notes,
          gpsLat: payload.deliveryGpsLat,
          gpsLng: payload.deliveryGpsLng,
          deliveryProofPhoto: payload.deliveryProofPhoto,
          cartonsCount: payload.packagingBreakdown?.cartonsCount,
        });
        return {
          ok: true,
          saleId: -Date.now(),
          docNo: offRes.docNo,
          total: offRes.total,
          paymentMethod: payload.paymentMethod,
          customerName: payload.customerName || 'عميل نقدي',
          itemsCount: payload.items.length,
          cashPaid: payload.paymentMethod === 'cash' ? offRes.total : Number(payload.paidAmount || 0),
          creditOwed: payload.paymentMethod === 'credit' ? offRes.total : 0,
          isOffline: true,
        };
      }

      try {
        return await vanSalesApi.executeSale(payload);
      } catch (err: any) {
        const isNetworkErr =
          !err?.status ||
          err?.status === 0 ||
          err?.message?.toLowerCase().includes('failed to fetch') ||
          err?.message?.includes('NetworkError');

        if (isNetworkErr) {
          const offRes = await vanOfflineDb.recordOfflineSale({
            tripId: payload.tripId,
            customerId: payload.customerId,
            customerName: payload.customerName,
            items: payload.items,
            paymentMethod: payload.paymentMethod,
            paidAmount: payload.paidAmount,
            notes: payload.notes,
            gpsLat: payload.deliveryGpsLat,
            gpsLng: payload.deliveryGpsLng,
            deliveryProofPhoto: payload.deliveryProofPhoto,
            cartonsCount: payload.packagingBreakdown?.cartonsCount,
          });
          return {
            ok: true,
            saleId: -Date.now(),
            docNo: offRes.docNo,
            total: offRes.total,
            paymentMethod: payload.paymentMethod,
            customerName: payload.customerName || 'عميل نقدي',
            itemsCount: payload.items.length,
            cashPaid: payload.paymentMethod === 'cash' ? offRes.total : Number(payload.paidAmount || 0),
            creditOwed: payload.paymentMethod === 'credit' ? offRes.total : 0,
            isOffline: true,
          };
        }
        throw err;
      }
    },
    onSuccess: (res: any) => {
      vanOfflineDb.getPendingCount().then(setPendingSyncCount);
      const isOff = res?.isOffline;
      if (isOff) {
        toast.success(`تم حفظ الفاتورة أوفلاين #${res.docNo} بمبلغ ${res.total} ${getGlobalCurrencySymbol()} وسيتم ترحيلها آلياً عند عودة الشبكة.`);
      } else {
        showAlert('success', `تم إصدار الفاتورة #${res.docNo} بمبلغ ${res.total} ${getGlobalCurrencySymbol()} بنجاح!`);
      }
      if (activeVisit) {
        const durationMins = Math.max(1, Math.round((Date.now() - activeVisit.startedAt) / 60000));
        toast.success(`تم إتمام زيارة المحل "${activeVisit.customerName}" (استغرقت ${durationMins} دقيقة)`);
        handleEndVisit();
      }
      const matchedCustomer = allAvailableCustomers.find((c) => String(c.id) === String(selectedCustomerId));
      setLastSaleReceipt({
        ...res,
        autoShareWhatsApp: pendingAutoShareWhatsAppRef.current,
        subtotal: res.subtotal ?? cartSubtotal,
        discount: res.discount ?? cartDiscount,
        paidAmount: res.cashPaid,
        remainingCredit: res.creditOwed,
        customerTotalBalance: matchedCustomer?.balance != null ? Number(matchedCustomer.balance) : undefined,
        packagingBreakdown: {
          cartonsCount: Number(cartonsCount) || 0,
          piecesCount: cart.reduce((s, it) => s + it.qty * (it.unitMultiplier || 1), 0),
          itemsCount: cart.length,
        },
        deliveryProofPhoto: deliveryProofPhoto || undefined,
        customerName: res.customerName || matchedCustomer?.name || newCustomerName || 'عميل نقدي',
        customerPhone: matchedCustomer?.phone || '',
        customerCode: matchedCustomer?.customerCode || '',
        customerAddress: matchedCustomer?.address || '',
        items: cart.map((c) => ({
          productId: c.productId,
          name: c.name,
          qty: c.qty,
          unitPrice: c.unitPrice,
          originalPrice: c.originalPrice,
          lineTotal: c.qty * c.unitPrice,
          unitName: c.unitName,
          unitMultiplier: c.unitMultiplier,
          isBonus: c.isBonus,
          bonusReason: c.bonusReason,
        })),
        repName: data?.trip?.repName || (session?.rep as any)?.name || 'مندوب التوزيع',
        vehiclePlate: data?.assignedVehicle?.plateNumber || data?.trip?.vehiclePlate || '',
        warehouseName: data?.trip?.sourceWarehouseName || '',
        date: new Date().toISOString(),
      });
      setCheckoutModalOpen(false);
      setSaleNotes('');
      setDeliveryProofPhoto('');
      setCartonsCount('');
      setCart([]);
      setSelectedCustomerId('');
      setNewCustomerName('');
      queryClient.invalidateQueries({ queryKey: ['van-sales-active-trip'] });
      queryClient.invalidateQueries({ queryKey: ['driver-itinerary'] });
      queryClient.invalidateQueries({ queryKey: ['driver-sales-history'] });
    },
    onError: (err: any) => showAlert('error', err?.message || 'فشل إصدار الفاتورة'),
    onSettled: () => {
      isCheckoutProcessingRef.current = false;
      setIsCheckoutProcessing(false);
    },
  });

  return {
    checkoutModalOpen,
    setCheckoutModalOpen,
    saleNotes,
    setSaleNotes,
    deliveryProofPhoto,
    setDeliveryProofPhoto,
    cartonsCount,
    setCartonsCount,
    selectedCustomerId,
    setSelectedCustomerId,
    newCustomerName,
    setNewCustomerName,
    paymentMethod,
    setPaymentMethod,
    cart,
    setCart,
    lastSaleReceipt,
    setLastSaleReceipt,
    isCheckoutProcessing,
    setIsCheckoutProcessing,
    isCheckoutProcessingRef,
    pendingAutoShareWhatsAppRef,
    addToCart,
    toggleCartItemBonus,
    changeCartItemUnit,
    updateCartQty,
    allAvailableCustomers,
    selectedCustomer,
    cartTotal,
    cartSubtotal,
    cartDiscount,
    executeSaleMutation,
  };
}

export interface SaleTabProps {
  sale: ReturnType<typeof useVanSale>;
  data: VanActiveTripResponse | undefined;
  startTripMutation: { isPending: boolean; mutate: () => void };
  activeVisit: UseVanSaleDeps['activeVisit'];
  handleStartVisit: (customerId: number, customerName: string, onSuccess?: () => void) => Promise<void>;
  session: UseVanSaleDeps['session'];
  showAlert: UseVanSaleDeps['showAlert'];
  setActiveTab: React.Dispatch<React.SetStateAction<VanMobileTabKey>>;
}

export const SaleTab: React.FC<SaleTabProps> = ({
  sale,
  data,
  startTripMutation,
  activeVisit,
  handleStartVisit,
  session,
  showAlert,
  setActiveTab,
}) => {
  const { t: __t } = useTranslation();
  const {
    allAvailableCustomers,
    selectedCustomerId,
    setSelectedCustomerId,
    newCustomerName,
    setNewCustomerName,
    paymentMethod,
    setPaymentMethod,
    cart,
    updateCartQty,
    toggleCartItemBonus,
    changeCartItemUnit,
    cartTotal,
    addToCart,
    deliveryProofPhoto,
    setDeliveryProofPhoto,
    cartonsCount,
    setCartonsCount,
    executeSaleMutation,
    setCheckoutModalOpen,
  } = sale;
  return (
    <>
            {/* TAB CONTENT: SALE */}
              {data?.hasActiveTrip ? (
                <VanSaleTab
                  customers={allAvailableCustomers}
                  selectedCustomerId={selectedCustomerId}
                  onSelectCustomer={(val) => {
                    if (val) {
                      const cust = allAvailableCustomers.find((c) => c.id === Number(val));
                      if (cust && (!activeVisit || activeVisit.customerId !== Number(val))) {
                        handleStartVisit(Number(val), cust.name, () => {
                          setSelectedCustomerId(val);
                          setNewCustomerName('');
                        });
                        return;
                      }
                      setSelectedCustomerId(val);
                      setNewCustomerName('');
                    } else {
                      setSelectedCustomerId('');
                    }
                  }}
                  newCustomerName={newCustomerName}
                  onNewCustomerNameChange={setNewCustomerName}
                  paymentMethod={paymentMethod}
                  onPaymentMethodChange={setPaymentMethod}
                  cart={cart}
                  onUpdateCartQty={updateCartQty}
                  onToggleBonus={toggleCartItemBonus}
                  onChangeUnit={changeCartItemUnit}
                  cartTotal={cartTotal}
                  inventory={data?.inventory || []}
                  onAddToCart={addToCart}
                  deliveryProofPhoto={deliveryProofPhoto}
                  onDeliveryProofPhotoChange={setDeliveryProofPhoto}
                  cartonsCount={cartonsCount}
                  onCartonsCountChange={setCartonsCount}
                  onGoToInventory={() => setActiveTab('inventory')}
                  onGoToSalesHistory={() => setActiveTab('sales-history')}
                  onSubmitSale={() => {
                    if (cart.length === 0) {
                      showAlert('error', __t('delivery_reps.van_sales_mobile_page.s168', __t('delivery_reps.van_sales_mobile_page.s168', "السلة فارغة حالياً. يرجى اختيار صنف واحد على الأقل لإصدار الفاتورة.")));
                      return;
                    }
                    if (selectedCustomerId && (!activeVisit || activeVisit.customerId !== Number(selectedCustomerId))) {
                      const cust = allAvailableCustomers.find((c) => c.id === Number(selectedCustomerId));
                      // INV-VAN-COLLECTION-GUARD-CONTINUATION: the visit is
                      // started with the checkout as its continuation —
                      // discarding it here made the first submit a no-op.
                      // The GPS warning shows only when GPS is actually
                      // mandatory for this rep (flag !== false).
                      if (session?.rep?.permissions?.require_gps_on_visit !== false) {
                        showAlert('warning', `يلزم تفعيل الـ GPS وبدء زيارة العميل "${cust?.name || ''}" أولاً لإصدار الفاتورة.`);
                      }
                      if (cust) {
                        handleStartVisit(Number(selectedCustomerId), cust.name, () => setCheckoutModalOpen(true));
                      }
                      return;
                    }
                    setCheckoutModalOpen(true);
                  }}
                  isSubmitting={executeSaleMutation.isPending}
                />
              ) : (
                <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '36px 20px', textAlign: 'center' }}>
                  <div style={{ width: '56px', height: '56px', backgroundColor: '#eef2ff', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                    <ReceiptIcon size={28} color="#170e5e" />
                  </div>
                  <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>{__t('delivery_reps.van_sales_mobile_page.s169', __t('delivery_reps.van_sales_mobile_page.s169', "نقطة بيع الفاتورة السريعة"))}</h3>
                  <p style={{ fontSize: '12.5px', color: '#64748b', margin: '0 auto 16px', maxWidth: '380px', lineHeight: 1.5 }}>
                    {__t('delivery_reps.van_sales_mobile_page.s170', __t('delivery_reps.van_sales_mobile_page.s170', "لبدء إضافة الأصناف وإصدار الفواتير للعملاء وإرفاق صور التسليم، يرجى بدء رحلة التوزيع أولاً."))}
                  </p>
                  <Button
                    variant="primary"
                    onClick={() => startTripMutation.mutate()}
                    disabled={startTripMutation.isPending}
                    style={{ backgroundColor: '#170e5e', color: '#ffffff', fontSize: '12.5px', fontWeight: 800 }}
                  >
                    {startTripMutation.isPending ? __t('delivery_reps.van_sales_mobile_page.s171', __t('delivery_reps.van_sales_mobile_page.s171', "جاري بدء الرحلة...")) : __t('delivery_reps.van_sales_mobile_page.s172', __t('delivery_reps.van_sales_mobile_page.s172', "بدء رحلة التوزيع الآن"))}
                  </Button>
                </div>
              )}
    </>
  );
};

export interface PreSalesTabProps {
  sale: ReturnType<typeof useVanSale>;
  activeVisit: UseVanSaleDeps['activeVisit'];
  handleStartVisit: (customerId: number, customerName: string, onSuccess?: () => void) => Promise<void>;
  session: UseVanSaleDeps['session'];
}

export const PreSalesTab: React.FC<PreSalesTabProps> = ({
  sale,
  activeVisit,
  handleStartVisit,
  session,
}) => {
  const {
    allAvailableCustomers,
    selectedCustomerId,
    setSelectedCustomerId,
    setNewCustomerName,
  } = sale;
  return (
    <>
            {/* TAB CONTENT: PRE-SALES (Order Booking from Main Warehouse) */}
              <VanPreSalesTab
                customers={allAvailableCustomers}
                selectedCustomerId={selectedCustomerId}
                onSelectCustomer={(val) => {
                  if (val) {
                    const cust = allAvailableCustomers.find((c) => c.id === Number(val));
                    if (cust && (!activeVisit || activeVisit.customerId !== Number(val))) {
                      handleStartVisit(Number(val), cust.name, () => {
                        setSelectedCustomerId(val);
                        setNewCustomerName('');
                      });
                      return;
                    }
                    setSelectedCustomerId(val);
                    setNewCustomerName('');
                  } else {
                    setSelectedCustomerId('');
                  }
                }}
                repId={session!.rep.id}
                repName={session!.rep.name}
              />
    </>
  );
};

export interface SalesHistoryTabProps {
  sale: ReturnType<typeof useVanSale>;
  data: VanActiveTripResponse | undefined;
  setActiveTab: React.Dispatch<React.SetStateAction<VanMobileTabKey>>;
}

export const SalesHistoryTab: React.FC<SalesHistoryTabProps> = ({
  sale,
  data,
  setActiveTab,
}) => {
  const { t: __t } = useTranslation();
  const { allAvailableCustomers, setLastSaleReceipt } = sale;
  return (
    <>
            {/* TAB CONTENT: SALES HISTORY */}
              <VanSalesHistoryTab
                tripId={data?.trip?.id}
                customers={allAvailableCustomers}
                onViewReceipt={(receiptData) => setLastSaleReceipt(receiptData)}
                onGoToNewSale={() => setActiveTab('sale')}
                storeName={data?.trip?.sourceWarehouseName || __t('delivery_reps.van_sales_mobile_page.s173', __t('delivery_reps.van_sales_mobile_page.s173', "مبيعات التوزيع الميداني"))}
              />
    </>
  );
};

export interface SaleCheckoutModalProps {
  sale: ReturnType<typeof useVanSale>;
  data: VanActiveTripResponse | undefined;
  session: UseVanSaleDeps['session'];
}

export const SaleCheckoutModal: React.FC<SaleCheckoutModalProps> = ({
  sale,
  data,
  session,
}) => {
  const {
    checkoutModalOpen,
    setCheckoutModalOpen,
    cart,
    cartTotal,
    cartSubtotal,
    cartDiscount,
    cartonsCount,
    setCartonsCount,
    deliveryProofPhoto,
    setDeliveryProofPhoto,
    saleNotes,
    setSaleNotes,
    isCheckoutProcessing,
    setIsCheckoutProcessing,
    isCheckoutProcessingRef,
    pendingAutoShareWhatsAppRef,
    selectedCustomerId,
    newCustomerName,
    allAvailableCustomers,
    executeSaleMutation,
  } = sale;
  return (
    <>
      {/* Field Sale Checkout & Payment Modal */}
      {data?.trip && checkoutModalOpen && (
        <VanSaleCheckoutModal
          open={checkoutModalOpen}
          onClose={() => setCheckoutModalOpen(false)}
          cart={cart}
          cartTotal={cartTotal}
          cartSubtotal={cartSubtotal}
          cartDiscount={cartDiscount}
          cartItemsCount={cart.length}
          cartTotalPieces={cart.reduce((s, it) => s + it.qty, 0)}
          customer={allAvailableCustomers.find((c) => String(c.id) === String(selectedCustomerId)) || null}
          newCustomerName={newCustomerName}
          cartonsCount={cartonsCount}
          onCartonsCountChange={setCartonsCount}
          deliveryProofPhoto={deliveryProofPhoto}
          onDeliveryProofPhotoChange={setDeliveryProofPhoto}
          notes={saleNotes}
          onNotesChange={setSaleNotes}
          isSubmitting={isCheckoutProcessing || executeSaleMutation.isPending}
          canGiveDiscount={session?.rep?.permissions?.can_give_discount === true}
          onConfirmCheckout={async (checkoutData) => {
            if (isCheckoutProcessingRef.current || executeSaleMutation.isPending) {
              return;
            }
            isCheckoutProcessingRef.current = true;
            setIsCheckoutProcessing(true);
            pendingAutoShareWhatsAppRef.current = Boolean(checkoutData.autoShareWhatsApp);

            const clientTxId = `van_sale_${data.trip!.id}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

            let gpsLat: number | undefined;
            let gpsLng: number | undefined;
            if (typeof navigator !== 'undefined' && navigator.geolocation) {
              try {
                const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
                  navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3500, enableHighAccuracy: true });
                });
                gpsLat = pos.coords.latitude;
                gpsLng = pos.coords.longitude;
              } catch {}
            }

            try {
              executeSaleMutation.mutate({
                tripId: data.trip!.id,
                clientTxId,
                customerId: selectedCustomerId ? Number(selectedCustomerId) : undefined,
                customerName: newCustomerName || undefined,
                paymentMethod: checkoutData.paymentMethod,
                paidAmount: checkoutData.paidAmount,
                cashDiscountAmount: checkoutData.cashDiscountAmount,
                subtotal: cartSubtotal,
                discount: cartDiscount,
                notes: checkoutData.notes,
                deliveryGpsLat: gpsLat,
                deliveryGpsLng: gpsLng,
                deliveryProofPhoto: checkoutData.deliveryProofPhoto || deliveryProofPhoto || undefined,
                supervisorOverridePin: checkoutData.supervisorOverridePin,
                supervisorOverrideReason: checkoutData.supervisorOverrideReason,
                transferReference: checkoutData.transferReference,
                transferReceiptUrl: checkoutData.transferReceiptUrl,
                recipientName: checkoutData.recipientName,
                recipientPhone: checkoutData.recipientPhone,
                recipientRole: checkoutData.recipientRole,
                recipientSignature: checkoutData.recipientSignature,
                packagingBreakdown: checkoutData.cartonsCount
                  ? {
                      cartonsCount: Number(checkoutData.cartonsCount) || 0,
                      piecesCount: cart.reduce((s, it) => s + it.qty * (it.unitMultiplier || 1), 0),
                      itemsCount: cart.length,
                    }
                  : undefined,
                items: cart.map((c) => ({
                  productId: c.productId,
                  qty: c.qty,
                  unitPrice: c.unitPrice,
                  originalPrice: c.originalPrice,
                  unitName: c.unitName,
                  unitMultiplier: c.unitMultiplier,
                  isBonus: c.isBonus,
                  bonusReason: c.bonusReason,
                })),
              });
            } catch (err) {
              isCheckoutProcessingRef.current = false;
              setIsCheckoutProcessing(false);
            }
          }}
        />
      )}
    </>
  );
};

export interface SalesReceiptModalProps {
  sale: ReturnType<typeof useVanSale>;
  data: VanActiveTripResponse | undefined;
}

export const SalesReceiptModal: React.FC<SalesReceiptModalProps> = ({
  sale,
  data,
}) => {
  const { t: __t } = useTranslation();
  const { lastSaleReceipt, setLastSaleReceipt } = sale;
  return (
    <>
      {/* Sale Receipt Modal */}
      {lastSaleReceipt && (
        <VanSalesReceiptModal
          receipt={lastSaleReceipt}
          onClose={() => setLastSaleReceipt(null)}
          storeName={data?.trip?.sourceWarehouseName || __t('delivery_reps.van_sales_mobile_page.s183', __t('delivery_reps.van_sales_mobile_page.s183', "مبيعات التوزيع الميداني"))}
        />
      )}
    </>
  );
};
