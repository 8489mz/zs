import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useMemo } from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { VanStockItem, vanSalesApi } from '../api/van-sales.api';
import {
  PlusIcon,
  PackageIcon,
  ShoppingCartIcon,
  ReceiptIcon,
  CreditCardIcon,
  FileTextIcon,
  RefreshCwIcon,
  MapPinIcon,
  PhoneIcon,
  CheckCircleIcon,
  SlidersIcon,
} from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { VanCustomerStatementModal } from './VanCustomerStatementModal';

export interface CartItem {
  productId: number;
  name: string;
  qty: number;
  unitPrice: number;
  maxQty: number;
  originalPrice?: number;
  offerBadge?: string;
  unitName?: string;
  unitMultiplier?: number;
  isBonus?: boolean;
  bonusReason?: string;
  availableUnits?: { id: number; name: string; multiplier: number; isBase: boolean }[];
}

interface CustomerOption {
  id: number;
  name: string;
  phone?: string;
  balance: number;
  creditLimit?: number;
  customerCode?: string;
  route?: string;
  locationUrl?: string;
}

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
  const { t } = useTranslation();
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
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: '#f8fafc',
          margin: '-12px -14px 4px -14px',
          padding: '10px 14px',
          borderRadius: '12px 12px 0 0',
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
          <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
            {t('delivery_reps.van_sale_tab.s0', "فاتورة بيع ميداني")}
          </h3>
          {cart.length > 0 && (
            <span style={{ fontSize: '10.5px', backgroundColor: '#eef2ff', color: '#170e5e', border: '1px solid #c7d2fe', padding: '1px 6px', borderRadius: '4px', fontWeight: 800 }}>
              {cart.length} {cart.length === 1 ? t('delivery_reps.van_sale_tab.s1', "صنف") : cart.length === 2 ? t('delivery_reps.van_sale_tab.s2', "صنفان") : cart.length <= 10 ? t('delivery_reps.van_sale_tab.s3', "أصناف") : t('delivery_reps.van_sale_tab.s4', "صنف")}
            </span>
          )}
        </div>
        {onGoToSalesHistory && (
          <button
            type="button"
            onClick={onGoToSalesHistory}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: '6px',
              border: '1px solid #e2e8f0',
              backgroundColor: '#ffffff',
              color: '#170e5e',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            }}
            title={t('delivery_reps.van_sale_tab.s5', "الانتقال لسجل الفواتير السابقة وإعادة الطباعة")}
          >
            <ReceiptIcon size={12} color="#170e5e" />
            <span>{t('delivery_reps.van_sale_tab.s6', "سجل الفواتير")}</span>
          </button>
        )}
      </div>

      {/* Selected Customer Compact Card OR Customer Selection Form */}
      {selectedCustomer ? (
        <div
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
          }}
        >
          {/* Row 1: Customer Name & Code + Quick Actions */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
              <span
                style={{
                  fontSize: '13.5px',
                  fontWeight: 800,
                  color: '#0f172a',
                  lineHeight: 1.25,
                }}
              >
                {selectedCustomer.name}
              </span>
              {selectedCustomer.customerCode && (
                <span style={{ fontSize: '10px', color: '#64748b', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', padding: '1px 5px', borderRadius: '4px', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  [{selectedCustomer.customerCode.replace(/^#/, '')}]
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
              {selectedCustomer.locationUrl && (
                <a
                  href={selectedCustomer.locationUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: '10.5px',
                    color: '#475569',
                    fontWeight: 600,
                    textDecoration: 'none',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    padding: '2px 6px',
                    borderRadius: '5px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                  title={t('delivery_reps.van_sale_tab.s7', "فتح الموقع على خرائط جوجل")}
                >
                  <MapPinIcon size={11} color="#64748b" />
                  <span>{t('delivery_reps.van_sale_tab.s8', "خريطة")}</span>
                  <span>↗</span>
                </a>
              )}
              <button
                type="button"
                onClick={() => onSelectCustomer('')}
                style={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '5px',
                  padding: '2px 7px',
                  fontSize: '10.5px',
                  fontWeight: 600,
                  color: '#475569',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {t('delivery_reps.van_sale_tab.s9', "تغيير العميل")}
              </button>
            </div>
          </div>

          {/* Row 2: Metadata Chips (Debt, Phone, Route, Credit Limit) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#334155', flexWrap: 'wrap' }}>
            <span
              style={{
                backgroundColor: selectedCustomer.balance > 0 ? '#fef2f2' : '#f8fafc',
                color: selectedCustomer.balance > 0 ? '#991b1b' : '#475569',
                border: `1px solid ${selectedCustomer.balance > 0 ? '#fecaca' : '#e2e8f0'}`,
                padding: '2px 7px',
                borderRadius: '5px',
                fontWeight: 700,
                fontSize: '11px',
              }}
            >
              {selectedCustomer.balance > 0 ? t('delivery_reps.van_sale_tab.s10', "المديونية: ") : t('delivery_reps.van_sale_tab.s11', "الحساب: ")}
              <strong>
                {selectedCustomer.balance === 0 ? t('delivery_reps.van_sale_tab.s12', "خالص (0.00)") : selectedCustomer.balance.toFixed(2)}
              </strong> <CurrencySymbol />
            </span>
            {selectedCustomer.phone && (
              <a
                href={`tel:${selectedCustomer.phone}`}
                style={{
                  textDecoration: 'none',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  padding: '2px 7px',
                  borderRadius: '5px',
                  fontSize: '11px',
                  color: '#0f172a',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <PhoneIcon size={11} color="#64748b" />
                <span dir="ltr">{selectedCustomer.phone}</span>
              </a>
            )}
            {selectedCustomer.route && (
              <span
                style={{
                  fontSize: '10.5px',
                  color: '#475569',
                  backgroundColor: '#f1f5f9',
                  border: '1px solid #e2e8f0',
                  padding: '2px 7px',
                  borderRadius: '5px',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <MapPinIcon size={10} color="#64748b" />
                <span>{selectedCustomer.route}</span>
              </span>
            )}
            {selectedCustomer.creditLimit ? (
              <span
                style={{
                  fontSize: '10.5px',
                  color: '#475569',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  padding: '2px 7px',
                  borderRadius: '5px',
                }}
              >
                {t('delivery_reps.van_sale_tab.s13', "سقف الائتمان:")} <strong>{selectedCustomer.creditLimit.toFixed(2)}</strong> <CurrencySymbol />
              </span>
            ) : null}
          </div>

          {/* Row 3: Action Buttons */}
          <div style={{ display: 'flex', gap: '6px', borderTop: '1px solid #e2e8f0', paddingTop: '7px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleLoadSuggestedOrder}
              disabled={isLoadingSuggested}
              style={{
                flex: 1,
                minWidth: '130px',
                height: '32px',
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                color: '#1e293b',
                borderRadius: '6px',
                padding: '0 8px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
              }}
              title={t('delivery_reps.van_sale_tab.s14', "استدعاء تشكيلة الأصناف والكميات التي يشتريها العميل عادة وتنزيلها بالسلة فوراً")}
            >
              <RefreshCwIcon size={12} color="#170e5e" className={isLoadingSuggested ? 'animate-spin' : undefined} />
              <span>{isLoadingSuggested ? t('delivery_reps.van_sale_tab.s15', "جاري التحميل...") : t('delivery_reps.van_sale_tab.s16', "تكرار الطلب المعتاد")}</span>
            </button>

            <button
              type="button"
              onClick={() => setStatementModalOpen(true)}
              style={{
                flex: 1,
                minWidth: '130px',
                height: '32px',
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                color: '#1e293b',
                borderRadius: '6px',
                padding: '0 8px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
              }}
              title={t('delivery_reps.van_sale_tab.s17', "معاينة كشف حساب العميل وطباعته حرارياً أو إرساله بواتساب")}
            >
              <FileTextIcon size={12} color="#170e5e" />
              <span>{t('delivery_reps.van_sale_tab.s18', "كشف حساب ميداني")}</span>
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
              {t('delivery_reps.van_sale_tab.s19', "اختيار المحل / العميل:")}
            </label>
            <CustomSelect
              value=""
              onChange={(val) => onSelectCustomer(val ? Number(val) : '')}
              options={[
                { value: '', label: t('delivery_reps.van_sale_tab.s20', "-- عميل نقدي عام (أو اختر من خط السير) --") },
                ...customers.map((c) => ({
                  value: String(c.id),
                  label: `${c.customerCode ? `[${c.customerCode.replace(/^#/, '')}] ` : ''}${c.name}${c.route ? ` (${c.route})` : ''}`,
                  hint: `مديونية: ${c.balance.toFixed(2)}${c.creditLimit ? ` | سقف: ${c.creditLimit.toFixed(2)}` : ''}`,
                })),
              ]}
              placeholder={t('delivery_reps.van_sale_tab.s21', "اختر المحل / العميل من القائمة")}
            />
          </div>
          <div>
            <input
              type="text"
              value={newCustomerName}
              onChange={(e) => onNewCustomerNameChange(e.target.value)}
              placeholder={t('delivery_reps.van_sale_tab.s22', "أو اكتب اسم محل جديد (عميل فوري نقدي)...")}
              style={{
                width: '100%',
                height: '34px',
                backgroundColor: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '0 10px',
                fontSize: '11.5px',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>
      )}

      {/* Invoice Products Section */}
      <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontWeight: 800, fontSize: '12px', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <ShoppingCartIcon size={14} color="#170e5e" />
            <span>{t('delivery_reps.van_sale_tab.s23', "أصناف الفاتورة:")}</span>
            {cart.length > 0 && (
              <span style={{ fontSize: '10.5px', backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>
                {cart.length} {t('delivery_reps.van_sale_tab.s24', "أصناف (")}{totalPieces} {t('delivery_reps.van_sale_tab.s25', "قطعة)")}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={onGoToInventory}
            style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            title={t('delivery_reps.van_sale_tab.s26', "الانتقال لتبويب جرد ومناقلات السيارة")}
          >
            {t('delivery_reps.van_sale_tab.s27', "صفحة الجرد ↗")}
          </button>
        </div>

        {/* Unified Search & Quick Browse Bar (Height 34px) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <CustomSelect
              value=""
              onChange={handleQuickSelectProduct}
              options={inventorySelectOptions}
              placeholder={t('delivery_reps.van_sale_tab.s28', "ابحث أو اختر صنفاً...")}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setIsPickerOpen(true)}
            style={{
              height: '34px',
              fontSize: '11.5px',
              color: '#170e5e',
              fontWeight: 700,
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              padding: '0 10px',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <PackageIcon size={13} color="#170e5e" />
            <span>{t('delivery_reps.van_sale_tab.s29', "تصفح السيارة (")}{availableInventory.length})</span>
          </Button>
        </div>

        {cart.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px 10px', color: '#94a3b8', fontSize: '12px', border: '1px dashed #cbd5e1', borderRadius: '8px' }}>
            <p style={{ margin: '0 0 6px 0', fontWeight: 600 }}>{t('delivery_reps.van_sale_tab.s30', "السلة فارغة - أضف أصناف الفاتورة للبدء")}</p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsPickerOpen(true)}
              style={{ fontSize: '11.5px', fontWeight: 800, color: '#170e5e', backgroundColor: '#eef2ff', border: '1px solid #c7d2fe', padding: '5px 12px', borderRadius: '6px' }}
            >
              <PackageIcon size={13} color="#170e5e" style={{ marginInlineEnd: '4px' }} />
              {t('delivery_reps.van_sale_tab.s31', "فتح قائمة بضاعة السيارة للاختيار")}
            </Button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Promotions Applied Banner */}
            {promoEvaluation?.appliedPromotions && promoEvaluation.appliedPromotions.length > 0 && (
              <div
                style={{
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: '#166534' }}>
                  <CheckCircleIcon size={14} color="#16a34a" />
                  <span>{t('delivery_reps.van_sale_tab.s32', "عروض ترويجية نشطة مطبقة على السلة:")}</span>
                </div>
                {promoEvaluation.appliedPromotions.map((p: any, idx: number) => (
                  <div key={idx} style={{ fontSize: '11.5px', color: '#14532d', paddingInlineStart: '18px' }}>
                    • {p.description} {p.discountAmount > 0 ? `(وفر ${p.discountAmount} ج.م)` : ''}
                  </div>
                ))}
                {promoEvaluation.bonusItemsToAdd?.length > 0 && onAddToCart && (
                  <button
                    type="button"
                    onClick={handleAutoInsertBonuses}
                    style={{
                      alignSelf: 'flex-start',
                      marginTop: '4px',
                      backgroundColor: '#16a34a',
                      color: '#ffffff',
                      border: 'none',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {t('delivery_reps.van_sale_tab.s33', "+ إدراج البونص الترويجي المجاني بالسلة الآن")}
                  </button>
                )}
              </div>
            )}

            {/* Upsell Nudge Banner */}
            {promoEvaluation?.upsellNudges && promoEvaluation.upsellNudges.length > 0 && (
              <div
                style={{
                  backgroundColor: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <SlidersIcon size={14} color="#b45309" />
                <div style={{ fontSize: '11.5px', color: '#92400e', fontWeight: 600 }}>
                  {promoEvaluation.upsellNudges[0].hintText}
                </div>
              </div>
            )}

            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
            {cart.map((c) => {
              const itemDiscount =
                !c.isBonus && c.originalPrice && c.originalPrice > c.unitPrice
                  ? (c.originalPrice - c.unitPrice) * c.qty
                  : 0;
              const lineTotal = c.isBonus ? 0 : c.qty * c.unitPrice;

              return (
                <div
                  key={c.productId}
                  style={{
                    padding: '9px 11px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    backgroundColor: c.isBonus ? '#f0fdf4' : '#ffffff',
                    borderBottom: '1px solid #f1f5f9',
                  }}
                >
                  {/* Top Row: Item Details (Right) & Line Total (Left) */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h4
                        style={{
                          margin: 0,
                          fontWeight: 800,
                          fontSize: '12.5px',
                          color: '#0f172a',
                          lineHeight: 1.3,
                        }}
                      >
                        {c.name}
                      </h4>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                          {c.unitPrice.toFixed(2)} <CurrencySymbol /> / {c.unitName || t('delivery_reps.van_sale_tab.s34', "قطعة")}
                        </span>
                        {c.originalPrice && c.originalPrice > c.unitPrice && !c.isBonus && (
                          <span style={{ fontSize: '10px', color: '#94a3b8', textDecoration: 'line-through' }}>
                            {c.originalPrice.toFixed(2)}
                          </span>
                        )}
                        {c.offerBadge ? (
                          <span style={{ fontSize: '9px', backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '1px 5px', borderRadius: '4px', fontWeight: 800 }}>
                            {c.offerBadge}
                          </span>
                        ) : itemDiscount > 0 ? (
                          <span style={{ fontSize: '9.5px', backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>
                            {t('delivery_reps.van_sale_tab.s35', "خصم")} {itemDiscount.toFixed(2)} <CurrencySymbol />
                          </span>
                        ) : null}
                        {c.isBonus && (
                          <span style={{ fontSize: '9.5px', color: '#166534', fontWeight: 700, backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: '4px' }}>
                            {t('delivery_reps.van_sale_tab.s36', "بونص عيني مجاني")}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Total Price on Left */}
                    <div style={{ textAlign: 'left', flexShrink: 0 }}>
                      <span style={{ fontSize: '13.5px', fontWeight: 800, color: c.isBonus ? '#166534' : '#0f172a', display: 'block' }}>
                        {lineTotal.toFixed(2)} <CurrencySymbol />
                      </span>
                    </div>
                  </div>

                  {/* Bottom Row: Controls Toolbar - Unit & Bonus on Right, RTL Stepper on Left */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', paddingTop: '4px', borderTop: '1px dashed #f1f5f9' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {c.availableUnits && c.availableUnits.length > 1 && onChangeUnit && (
                        <select
                          value={c.unitName || c.availableUnits[0].name}
                          onChange={(e) => {
                            const selected = c.availableUnits?.find((u) => u.name === e.target.value);
                            if (selected) {
                              onChangeUnit(c.productId, selected.name, selected.multiplier);
                            }
                          }}
                          style={{
                            height: '28px',
                            fontSize: '11px',
                            padding: '0 6px',
                            borderRadius: '5px',
                            border: '1px solid #cbd5e1',
                            backgroundColor: '#f8fafc',
                            color: '#1e293b',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                          title={t('delivery_reps.van_sale_tab.s37', "اختيار وحدة البيع (كرتونة / قطعة)")}
                        >
                          {c.availableUnits.map((u) => (
                            <option key={u.id} value={u.name}>
                              {u.name} {u.multiplier > 1 ? `(${u.multiplier})` : ''}
                            </option>
                          ))}
                        </select>
                      )}

                      {onToggleBonus && (
                        <button
                          type="button"
                          onClick={() => onToggleBonus(c.productId)}
                          style={{
                            height: '28px',
                            fontSize: '10.5px',
                            padding: '0 8px',
                            borderRadius: '5px',
                            border: c.isBonus ? '1px solid #059669' : '1px solid #cbd5e1',
                            backgroundColor: c.isBonus ? '#ecfdf5' : '#ffffff',
                            color: c.isBonus ? '#065f46' : '#64748b',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                          }}
                          title={t('delivery_reps.van_sale_tab.s38', "تحديد الصنف كبونص عيني ترويجي مجاني")}
                        >
                          {c.isBonus ? t('delivery_reps.van_sale_tab.s39', "✓ بونص") : t('delivery_reps.van_sale_tab.s40', "+ بونص")}
                        </button>
                      )}
                    </div>

                    {/* Strict RTL Stepper: [+] (qty) [-] */}
                    <div dir="rtl" style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => onUpdateCartQty(c.productId, 1)}
                        style={{
                          width: '26px',
                          height: '24px',
                          minHeight: '24px',
                          maxHeight: '24px',
                          padding: 0,
                          backgroundColor: '#170e5e',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '5px',
                          fontWeight: 800,
                          fontSize: '14px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxSizing: 'border-box',
                        }}
                        title={t('delivery_reps.van_sale_tab.s41', "زيادة الكمية")}
                      >
                        +
                      </button>
                      <span style={{ fontWeight: 800, fontSize: '12px', width: '22px', textAlign: 'center', color: '#170e5e', lineHeight: 1 }}>
                        {c.qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => onUpdateCartQty(c.productId, -1)}
                        style={{
                          width: '26px',
                          height: '24px',
                          minHeight: '24px',
                          maxHeight: '24px',
                          padding: 0,
                          backgroundColor: '#ffffff',
                          border: '1px solid #cbd5e1',
                          borderRadius: '5px',
                          fontWeight: 800,
                          fontSize: '14px',
                          color: '#0f172a',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxSizing: 'border-box',
                        }}
                        title={t('delivery_reps.van_sale_tab.s42', "إنقاص الكمية")}
                      >
                        -
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>

      {cart.length > 0 && (
        <div
          id="van-sale-checkout-card"
          style={{
            borderTop: '1px solid #f1f5f9',
            paddingTop: '8px',
            paddingBottom: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {/* Unified Compact Summary Strip */}
          <div
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '9px',
              padding: '9px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {/* Row 1: Item counts & Discount badge */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11.5px', color: '#475569' }}>
              <span>
                {t('delivery_reps.van_sale_tab.s43', "عدد البنود:")} <strong style={{ color: '#0f172a' }}>{cart.length} {t('delivery_reps.van_sale_tab.s44', "أصناف")}</strong> ({totalPieces} {t('delivery_reps.van_sale_tab.s45', "قطعة)")}
              </span>
              {cartDiscount > 0 && (
                <span style={{ fontSize: '10.5px', color: '#475569', backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                  {t('delivery_reps.van_sale_tab.s46', "وفرت")} {cartDiscount.toFixed(2)} <CurrencySymbol />
                </span>
              )}
            </div>

            {/* Row 2: Subtotal if discount exists */}
            {cartDiscount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#64748b' }}>
                <span>{t('delivery_reps.van_sale_tab.s47', "المجموع الفرعي (قبل الخصم):")}</span>
                <span style={{ textDecoration: 'line-through' }}>
                  {cartSubtotal.toFixed(2)} <CurrencySymbol />
                </span>
              </div>
            )}

            {/* Row 3: Final Total */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '5px', borderTop: '1px dashed #cbd5e1' }}>
              <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                {t('delivery_reps.van_sale_tab.s48', "إجمالي الفاتورة المطلوب:")}
              </span>
              <span style={{ fontSize: '16px', fontWeight: 900, color: '#170e5e' }}>
                {cartTotal.toFixed(2)} <CurrencySymbol />
              </span>
            </div>
          </div>

          {/* Primary Action Button */}
          <Button
            variant="primary"
            onClick={onSubmitSale}
            disabled={isSubmitting}
            style={{
              backgroundColor: '#170e5e',
              color: '#ffffff',
              height: '42px',
              fontSize: '13.5px',
              fontWeight: 800,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              borderRadius: '8px',
              boxShadow: '0 2px 6px rgba(23, 14, 94, 0.2)',
            }}
          >
            <CreditCardIcon size={16} color="#ffffff" />
            <span>{isSubmitting ? t('delivery_reps.van_sale_tab.s49', "جاري الحفظ والخصم...") : `إتمام البيع والسداد (${cartTotal.toFixed(2)} ج.م)`}</span>
          </Button>
        </div>
      )}

      {/* Quick Item Picker Modal - StandardDialog */}
      <StandardDialog
        open={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        title={t('delivery_reps.van_sale_tab.s50', "بضاعة السيارة المتاحة")}
        subtitle={t('delivery_reps.van_sale_tab.s51', "تحديد كميات الأصناف لإضافتها للفاتورة")}
        badge={`متاح ${availableInventory.length} صنف`}
        width="min(540px, 95vw)"
        compact={true}
        footer={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>
              {t('delivery_reps.van_sale_tab.s52', "السلة:")} <strong style={{ color: '#170e5e' }}>{cart.length} {cart.length === 1 ? t('delivery_reps.van_sale_tab.s53', "صنف") : cart.length === 2 ? t('delivery_reps.van_sale_tab.s54', "صنفان") : cart.length <= 10 ? t('delivery_reps.van_sale_tab.s55', "أصناف") : t('delivery_reps.van_sale_tab.s56', "صنف")}</strong> ({totalPieces} {totalPieces === 1 ? t('delivery_reps.van_sale_tab.s57', "قطعة") : totalPieces === 2 ? t('delivery_reps.van_sale_tab.s58', "قطعتان") : totalPieces <= 10 ? t('delivery_reps.van_sale_tab.s59', "قطع") : t('delivery_reps.van_sale_tab.s60', "قطعة")}{t('delivery_reps.van_sale_tab.s61', ") | الإجمالي:")} <strong style={{ color: '#059669' }}>{cartTotal.toFixed(2)}</strong> <CurrencySymbol />
            </div>
            <Button
              variant="primary"
              onClick={() => setIsPickerOpen(false)}
              style={{ backgroundColor: '#170e5e', color: '#ffffff', fontWeight: 800, fontSize: '12px', padding: '7px 16px', borderRadius: '6px' }}
            >
              {t('delivery_reps.van_sale_tab.s62', "حفظ والعودة للفاتورة (")}{cart.length})
            </Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <input
            type="text"
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            placeholder={t('delivery_reps.van_sale_tab.s63', "بحث باسم الصنف أو الكود أو الباركود...")}
            style={{
              width: '100%',
              height: '34px',
              backgroundColor: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              padding: '0 10px',
              fontSize: '12px',
              boxSizing: 'border-box',
            }}
          />

          <div style={{ maxHeight: 'min(420px, 62vh)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', paddingRight: '2px' }}>
            {filteredPickerInventory.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 10px', color: '#94a3b8', fontSize: '12px' }}>
                {t('delivery_reps.van_sale_tab.s64', "لا توجد أصناف مطابقة في بضاعة السيارة الحالية")}
              </div>
            ) : (
              filteredPickerInventory.map((item) => {
                const inCartItem = cart.find((c) => c.productId === item.productId);
                const inCartQty = inCartItem ? inCartItem.qty : 0;
                const isMax = inCartQty >= item.qty;

                return (
                  <div
                    key={item.productId}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '8px',
                      backgroundColor: inCartQty > 0 ? '#f0fdf4' : '#ffffff',
                      border: inCartQty > 0 ? '1px solid #86efac' : '1px solid #e2e8f0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <h4 style={{ margin: 0, fontSize: '12px', fontWeight: 800, color: '#0f172a', lineHeight: 1.35, paddingBottom: '1px' }}>
                          {item.productName}
                        </h4>
                        {inCartQty > 0 && (
                          <span style={{ fontSize: '10px', backgroundColor: '#dcfce7', color: '#166534', padding: '1px 5px', borderRadius: '4px', fontWeight: 800, whiteSpace: 'nowrap' }}>
                            {t('delivery_reps.van_sale_tab.s65', "بالسلة:")} {inCartQty}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#059669' }}>
                          {item.retailPrice.toFixed(2)} <CurrencySymbol />
                        </span>
                        {item.originalPrice && item.originalPrice > item.retailPrice && (
                          <span style={{ fontSize: '10px', color: '#94a3b8', textDecoration: 'line-through' }}>
                            {item.originalPrice.toFixed(2)} <CurrencySymbol />
                          </span>
                        )}
                        {item.offerBadge && (
                          <span style={{ fontSize: '9px', backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '1px 5px', borderRadius: '4px', fontWeight: 800 }}>
                            {item.offerBadge}
                          </span>
                        )}
                        <span style={{ fontSize: '11px', color: '#64748b' }}>
                          {t('delivery_reps.van_sale_tab.s66', "المتاح:")} {item.qty} {item.stockUnitName || item.unitName || t('delivery_reps.van_sale_tab.s67', "قطعة")}
                        </span>
                        {item.expiryStatus === 'expired' && (
                          <span style={{ fontSize: '9.5px', backgroundColor: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', padding: '1px 5px', borderRadius: '4px', fontWeight: 800 }}>
                            {t('delivery_reps.van_sale_tab.s68', "منتهي الصلاحية (")}{item.earliestExpiryDate})
                          </span>
                        )}
                        {item.expiryStatus === 'near_expiry' && (
                          <span style={{ fontSize: '9.5px', backgroundColor: '#fef3c7', color: '#b45309', border: '1px solid #fde68a', padding: '1px 5px', borderRadius: '4px', fontWeight: 800 }}>
                            {t('delivery_reps.van_sale_tab.s69', "FEFO قريب الانتهاء (")}{item.daysToExpiry} {t('delivery_reps.van_sale_tab.s70', "يوم •")} {item.earliestExpiryDate})
                          </span>
                        )}
                        {item.expiryStatus === 'valid' && item.earliestExpiryDate && (
                          <span style={{ fontSize: '9.5px', backgroundColor: '#f1f5f9', color: '#475569', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
                            {t('delivery_reps.van_sale_tab.s71', "صلاحية:")} {item.earliestExpiryDate}
                          </span>
                        )}
                        {lastPricesMap[item.productId] && (
                          <span
                            style={{
                              fontSize: '9.5px',
                              backgroundColor: '#e0e7ff',
                              color: '#3730a3',
                              border: '1px solid #c7d2fe',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              fontWeight: 700,
                            }}
                            title={`آخر سعر مسجل لهذا العميل (فاتورة ${lastPricesMap[item.productId].lastDocNo || ''})`}
                          >
                            {t('delivery_reps.van_sale_tab.s72', "آخر سعر للعميل:")} {lastPricesMap[item.productId].lastPrice.toFixed(2)} {t('delivery_reps.van_sale_tab.s73', "ج.م (")}{lastPricesMap[item.productId].lastSaleDate})
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                      {inCartQty > 0 ? (
                        <div dir="rtl" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <button
                            type="button"
                            onClick={() => onAddToCart?.(item)}
                            disabled={isMax}
                            style={{
                              width: '26px',
                              height: '24px',
                              minHeight: '24px',
                              maxHeight: '24px',
                              padding: 0,
                              backgroundColor: isMax ? '#f1f5f9' : '#170e5e',
                              border: 'none',
                              borderRadius: '5px',
                              fontWeight: 800,
                              cursor: isMax ? 'not-allowed' : 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              boxSizing: 'border-box',
                            }}
                            title={isMax ? t('delivery_reps.van_sale_tab.s74', "تم بلوغ أقصى كمية بالسيارة") : t('delivery_reps.van_sale_tab.s75', "زيادة صنف")}
                          >
                            <span style={{ fontSize: '14px', fontWeight: 800, lineHeight: 1, color: isMax ? '#94a3b8' : '#ffffff' }}>+</span>
                          </button>
                          <span style={{ fontWeight: 800, fontSize: '12px', minWidth: '20px', textAlign: 'center', color: '#170e5e', lineHeight: 1 }}>
                            {inCartQty}
                          </span>
                          <button
                            type="button"
                            onClick={() => onUpdateCartQty(item.productId, -1)}
                            style={{
                              width: '26px',
                              height: '24px',
                              minHeight: '24px',
                              maxHeight: '24px',
                              padding: 0,
                              backgroundColor: '#ffffff',
                              border: '1px solid #cbd5e1',
                              borderRadius: '5px',
                              fontWeight: 800,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              boxSizing: 'border-box',
                            }}
                            title={t('delivery_reps.van_sale_tab.s76', "إنقاص صنف")}
                          >
                            <span style={{ fontSize: '14px', fontWeight: 800, lineHeight: 1, color: '#0f172a' }}>−</span>
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onAddToCart?.(item)}
                          disabled={item.qty <= 0}
                          style={{
                            height: '28px',
                            fontSize: '11.5px',
                            backgroundColor: item.qty <= 0 ? '#cbd5e1' : '#170e5e',
                            color: '#ffffff',
                            fontWeight: 800,
                            padding: '0 10px',
                            borderRadius: '6px',
                            border: 'none',
                            cursor: item.qty <= 0 ? 'not-allowed' : 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <PlusIcon size={12} color="#ffffff" />
                          <span>{t('delivery_reps.van_sale_tab.s77', "إضافة")}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </StandardDialog>

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
