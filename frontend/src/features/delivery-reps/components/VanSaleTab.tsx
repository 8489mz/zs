import React, { useState, useEffect, useMemo } from 'react';
import { VanStockItem, vanSalesApi } from '../api/van-sales.api';
import { toast } from '@/shared/components/system-alert';
import { VanCustomerStatementModal } from './VanCustomerStatementModal';
import type { CartItem, CustomerOption } from './van-sale/van-sale-types';
export type { CartItem } from './van-sale/van-sale-types';
import { SaleHeader } from './van-sale/sale-header';
import { SaleCustomerCard } from './van-sale/sale-customer-card';
import { SaleCustomerForm } from './van-sale/sale-customer-form';
import { SaleProducts } from './van-sale/sale-products';
import { SaleCheckout } from './van-sale/sale-checkout';
import { SalePickerDialog } from './van-sale/sale-picker-dialog';



interface VanSaleTabProps {
  customers: CustomerOption[];
  selectedCustomerId: number | '';
  onSelectCustomer: (val: number | '') => void;
  newCustomerName: string;
  onNewCustomerNameChange: (val: string) => void;
  paymentMethod?: 'cash' | 'credit' | 'card' | 'split';
  onPaymentMethodChange?: (val: any) => void;
  cart: CartItem[];
  onUpdateCartQty: (productId: number, delta: number) => void;
  onToggleBonus?: (productId: number) => void;
  onChangeUnit?: (productId: number, unitName: string, multiplier: number) => void;
  // INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: the per-line discount
  // input shows only when the rep may discount and the tenant cap
  // is above zero (cap absent = server default 5).
  canGiveDiscount?: boolean;
  discountCapPercent?: number;
  onLineDiscountChange?: (productId: number, amount: number) => void;
  cartTotal: number;
  onGoToInventory: () => void;
  onSubmitSale: () => void;
  isSubmitting: boolean;
  inventory?: VanStockItem[];
  onAddToCart?: (item: VanStockItem) => void;
  deliveryProofPhoto?: string;
  onDeliveryProofPhotoChange?: (photo: string) => void;
  cartonsCount?: string;
  onCartonsCountChange?: (count: string) => void;
  onGoToSalesHistory?: () => void;
}

export const VanSaleTab: React.FC<VanSaleTabProps> = ({
  customers,
  selectedCustomerId,
  onSelectCustomer,
  newCustomerName,
  onNewCustomerNameChange,
  paymentMethod: _paymentMethod,
  onPaymentMethodChange: _onPaymentMethodChange,
  cart,
  onUpdateCartQty,
  onToggleBonus,
  onChangeUnit,
  canGiveDiscount,
  discountCapPercent,
  onLineDiscountChange,
  cartTotal,
  onGoToInventory,
  onSubmitSale,
  isSubmitting,
  inventory = [],
  onAddToCart,
  deliveryProofPhoto: _deliveryProofPhoto = '',
  onDeliveryProofPhotoChange: _onDeliveryProofPhotoChange,
  cartonsCount: _cartonsCount = '',
  onCartonsCountChange: _onCartonsCountChange,
  onGoToSalesHistory,
}) => {
  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);
  const totalPieces = cart.reduce((sum, it) => sum + it.qty, 0);

  const cartSubtotal = useMemo(() => {
    return cart.reduce((sum, it) => {
      const orig = it.originalPrice && it.originalPrice > it.unitPrice ? it.originalPrice : it.unitPrice;
      return sum + it.qty * orig;
    }, 0);
  }, [cart]);

  const cartDiscount = useMemo(() => {
    return Math.max(0, cartSubtotal - cartTotal);
  }, [cartSubtotal, cartTotal]);

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [lastPricesMap, setLastPricesMap] = useState<Record<number, { lastPrice: number; lastSaleDate: string; lastDocNo: string }>>({});
  const [isLoadingSuggested, setIsLoadingSuggested] = useState(false);
  const [statementModalOpen, setStatementModalOpen] = useState(false);

  useEffect(() => {
    if (selectedCustomerId) {
      vanSalesApi.getCustomerLastSoldPrices(Number(selectedCustomerId)).then((res) => {
        if (res && res.lastPrices) {
          setLastPricesMap(res.lastPrices);
        }
      }).catch(() => {});
    } else {
      setLastPricesMap({});
    }
  }, [selectedCustomerId]);

  const [promoEvaluation, setPromoEvaluation] = useState<{
    appliedPromotions: any[];
    bonusItemsToAdd: any[];
    totalPromotionalDiscount: number;
    upsellNudges: any[];
  } | null>(null);

  useEffect(() => {
    if (cart.length === 0) {
      setPromoEvaluation(null);
      return;
    }
    const timer = setTimeout(() => {
      vanSalesApi
        .evaluateCartPromotions({
          cartItems: cart.map((c) => ({
            productId: c.productId,
            productName: c.name,
            qty: c.qty,
            unitPrice: c.unitPrice,
            uom: c.unitName,
            multiplier: c.unitMultiplier,
            isBonus: c.isBonus,
          })),
          invoiceSubtotal: cartSubtotal,
          customerType: (selectedCustomer as any)?.customer_type,
        })
        .then((res) => {
          if (res && res.ok) {
            setPromoEvaluation(res);
          }
        })
        .catch(() => {});
    }, 250);

    return () => clearTimeout(timer);
  }, [cart, cartSubtotal, selectedCustomer]);

  const handleAutoInsertBonuses = () => {
    if (!promoEvaluation?.bonusItemsToAdd || !onAddToCart) return;
    let inserted = 0;
    for (const b of promoEvaluation.bonusItemsToAdd) {
      const alreadyBonusInCart = cart.find((c) => c.productId === b.productId && c.isBonus);
      if (!alreadyBonusInCart) {
        const invItem = inventory.find((i) => i.productId === b.productId);
        onAddToCart({
          productId: b.productId,
          productName: b.productName || invItem?.productName || `بونص صنف #${b.productId}`,
          barcode: invItem?.barcode || '',
          qty: invItem?.qty || 999,
          costPrice: invItem?.costPrice || 0,
          retailPrice: 0,
        });
        if (onToggleBonus) {
          setTimeout(() => onToggleBonus(b.productId), 60);
        }
        if (b.qty > 1) {
          setTimeout(() => onUpdateCartQty(b.productId, b.qty - 1), 80);
        }
        inserted++;
      }
    }
    if (inserted > 0) {
      toast.success(`تم إدراج ${inserted} أصناف بونص ترويجي مجاني بالسلة`);
    } else {
      toast.info('تم إدراج البونص الترويجي بالفعل');
    }
  };

  const handleLoadSuggestedOrder = async () => {
    if (!selectedCustomerId) return;
    setIsLoadingSuggested(true);
    try {
      const res = await vanSalesApi.getCustomerSuggestedOrder(Number(selectedCustomerId));
      if (!res || !res.items || res.items.length === 0) {
        toast.info('لا توجد طلبيات سابقة مسجلة لهذا العميل');
        return;
      }
      let addedCount = 0;
      let missingStockCount = 0;
      for (const item of res.items) {
        const invItem = inventory.find((inv) => inv.productId === item.productId);
        if (invItem && invItem.qty > 0 && onAddToCart) {
          const qtyToAdd = Math.min(invItem.qty, item.suggestedQty || 1);
          const alreadyInCart = cart.find((c) => c.productId === item.productId);
          if (!alreadyInCart) {
            onAddToCart(invItem);
            if (qtyToAdd > 1) {
              onUpdateCartQty(item.productId, qtyToAdd - 1);
            }
            addedCount++;
          }
        } else if (!invItem || invItem.qty <= 0) {
          missingStockCount++;
        }
      }
      if (addedCount > 0) {
        toast.success(`تم إدراج ${addedCount} أصناف من الطلب المعتاد للعميل بالسلة بنجاح`);
      }
      if (missingStockCount > 0) {
        toast.warning(`يوجد ${missingStockCount} أصناف من الطلب المعتاد غير متوفرة في سيارة التوزيع حالياً`);
      }
    } catch (err: any) {
      toast.error(err?.message || 'تعذر جلب الطلب المعتاد للعميل');
    } finally {
      setIsLoadingSuggested(false);
    }
  };

  const availableInventory = useMemo(() => {
    return inventory.filter((item) => item.qty > 0);
  }, [inventory]);

  const filteredPickerInventory = useMemo(() => {
    if (!pickerSearch.trim()) return availableInventory;
    const q = pickerSearch.toLowerCase();
    return availableInventory.filter(
      (item) => item.productName.toLowerCase().includes(q) || item.barcode.toLowerCase().includes(q),
    );
  }, [availableInventory, pickerSearch]);

  const inventorySelectOptions = useMemo(() => {
    return [
      { value: '', label: '-- ابحث أو اختر صنفاً من السيارة --' },
      ...availableInventory.map((item) => {
        const inCart = cart.find((c) => c.productId === item.productId);
        const remaining = item.qty - (inCart ? inCart.qty : 0);
        return {
          value: String(item.productId),
          label: `${item.productName} (متاح: ${remaining}) - ${item.retailPrice.toFixed(2)} ج.م`,
          hint: item.barcode ? `باركود: ${item.barcode}` : undefined,
        };
      }),
    ];
  }, [availableInventory, cart]);

  const handleQuickSelectProduct = (val: string) => {
    if (!val) return;
    const item = availableInventory.find((p) => p.productId === Number(val));
    if (item && onAddToCart) {
      onAddToCart(item);
    }
  };

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      <SaleHeader
        cart={cart}
        onGoToSalesHistory={onGoToSalesHistory}
      />

      {/* Selected Customer Compact Card OR Customer Selection Form */}
      {selectedCustomer ? (
        <SaleCustomerCard
          selectedCustomer={selectedCustomer}
          handleLoadSuggestedOrder={handleLoadSuggestedOrder}
          isLoadingSuggested={isLoadingSuggested}
          onSelectCustomer={onSelectCustomer}
          setStatementModalOpen={setStatementModalOpen}
        />
      ) : (
        <SaleCustomerForm
          customers={customers}
          newCustomerName={newCustomerName}
          onNewCustomerNameChange={onNewCustomerNameChange}
          onSelectCustomer={onSelectCustomer}
        />
      )}

      {/* Invoice Products Section */}
      <SaleProducts
        availableInventory={availableInventory}
        cart={cart}
        handleAutoInsertBonuses={handleAutoInsertBonuses}
        handleQuickSelectProduct={handleQuickSelectProduct}
        inventorySelectOptions={inventorySelectOptions}
        onGoToInventory={onGoToInventory}
        onUpdateCartQty={onUpdateCartQty}
        promoEvaluation={promoEvaluation}
        setIsPickerOpen={setIsPickerOpen}
        totalPieces={totalPieces}
        canGiveDiscount={canGiveDiscount}
        discountCapPercent={discountCapPercent}
        onAddToCart={onAddToCart}
        onChangeUnit={onChangeUnit}
        onLineDiscountChange={onLineDiscountChange}
        onToggleBonus={onToggleBonus}
      />

      {cart.length > 0 && (
        <SaleCheckout
          cart={cart}
          cartDiscount={cartDiscount}
          cartSubtotal={cartSubtotal}
          cartTotal={cartTotal}
          isSubmitting={isSubmitting}
          onSubmitSale={onSubmitSale}
          totalPieces={totalPieces}
        />
      )}

      {/* Quick Item Picker Modal - StandardDialog */}
      <SalePickerDialog
        availableInventory={availableInventory}
        cart={cart}
        cartTotal={cartTotal}
        filteredPickerInventory={filteredPickerInventory}
        isPickerOpen={isPickerOpen}
        lastPricesMap={lastPricesMap}
        onUpdateCartQty={onUpdateCartQty}
        pickerSearch={pickerSearch}
        setIsPickerOpen={setIsPickerOpen}
        setPickerSearch={setPickerSearch}
        totalPieces={totalPieces}
        onAddToCart={onAddToCart}
      />

      {/* Field Customer Statement Modal */}
      {selectedCustomerId && (
        <VanCustomerStatementModal
          open={statementModalOpen}
          onClose={() => setStatementModalOpen(false)}
          customerId={Number(selectedCustomerId)}
          customerName={selectedCustomer?.name}
        />
      )}
    </div>
  );
};
