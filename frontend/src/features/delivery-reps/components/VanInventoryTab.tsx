import { useTranslation } from 'react-i18next';
import React from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { VanStockItem } from '../api/van-sales.api';
import { ShoppingCartIcon, PlusIcon, PackageIcon, SearchIcon } from '@/shared/components/icons/AppIcons';

interface CartItemSummary {
  productId: number;
  qty: number;
}

interface VanInventoryTabProps {
  stockSearch: string;
  onSearchChange: (value: string) => void;
  filteredInventory: VanStockItem[];
  cart?: CartItemSummary[];
  cartTotal?: number;
  onAddToCart: (item: VanStockItem) => void;
  onUpdateCartQty?: (productId: number, delta: number) => void;
  onGoToSale?: () => void;
  onOpenTransferModal?: () => void;
  onRequestRequisition?: () => void;
  pendingTransfersCount?: number;
}

export const VanInventoryTab: React.FC<VanInventoryTabProps> = ({
  stockSearch,
  onSearchChange,
  filteredInventory,
  cart = [],
  cartTotal = 0,
  onAddToCart,
  onUpdateCartQty,
  onGoToSale,
  onOpenTransferModal,
  onRequestRequisition,
  pendingTransfersCount = 0,
}) => {
  const { t } = useTranslation();
  const totalPiecesInCart = cart.reduce((sum, it) => sum + it.qty, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
        <input
          type="text"
          value={stockSearch}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('delivery_reps.van_inventory_tab.s0', "بحث باسم الصنف أو الباركود...")}
          style={{
            flex: 1,
            minWidth: 0,
            height: '36px',
            backgroundColor: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            padding: '0 12px',
            fontSize: '12px',
            boxSizing: 'border-box',
          }}
        />

        {onOpenTransferModal && (
          <button
            type="button"
            onClick={onOpenTransferModal}
            style={{
              height: '36px',
              padding: '0 12px',
              backgroundColor: '#170e5e',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '11.5px',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              whiteSpace: 'nowrap',
            }}
          >
            <span>{t('delivery_reps.van_inventory_tab.s1', "مناقلة سيارات")}</span>
            {pendingTransfersCount > 0 && (
              <span
                style={{
                  backgroundColor: '#dc2626',
                  color: '#ffffff',
                  fontSize: '10.5px',
                  fontWeight: 900,
                  borderRadius: '10px',
                  padding: '1px 5px',
                }}
              >
                {pendingTransfersCount}
              </span>
            )}
          </button>
        )}
      </div>

      {filteredInventory.length === 0 ? (
        stockSearch.trim() ? (
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '14px',
              border: '1px solid #e2e8f0',
              padding: '36px 20px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <div
              style={{
                width: '46px',
                height: '46px',
                borderRadius: '13px',
                backgroundColor: '#f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#64748b',
              }}
            >
              <SearchIcon size={22} color="#64748b" />
            </div>
            <h4 style={{ margin: 0, fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>
              {t('delivery_reps.van_inventory_tab.s2', "لا توجد أصناف مطابقة للبحث")}
            </h4>
            <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b' }}>
              {t('delivery_reps.van_inventory_tab.s3', "لم يتم العثور على أي صنف بالاسم أو الباركود “")}{stockSearch}&rdquo;
            </p>
            <button
              type="button"
              onClick={() => onSearchChange('')}
              style={{
                marginTop: '4px',
                backgroundColor: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '6px 14px',
                fontSize: '11.5px',
                fontWeight: 700,
                color: '#334155',
                cursor: 'pointer',
              }}
            >
              {t('delivery_reps.van_inventory_tab.s4', "مسح البحث")}
            </button>
          </div>
        ) : (
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '14px',
              border: '1px solid #e2e8f0',
              padding: '36px 20px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.03)',
            }}
          >
            <div
              style={{
                width: '54px',
                height: '54px',
                borderRadius: '15px',
                backgroundColor: '#eef2ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#170e5e',
              }}
            >
              <PackageIcon size={26} color="#170e5e" />
            </div>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
                {t('delivery_reps.van_inventory_tab.s5', "لا توجد بضاعة في سيارة التوزيع حالياً")}
              </h4>
              <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', maxWidth: '300px', lineHeight: 1.5 }}>
                {t('delivery_reps.van_inventory_tab.s6', "يمكنك إنشاء إذن شحن وتحميل بضاعة من المستودع الرئيسي للانطلاق وبدء البيع الميداني")}
              </p>
            </div>
            {onRequestRequisition && (
              <button
                type="button"
                onClick={onRequestRequisition}
                style={{
                  marginTop: '4px',
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '9px 18px',
                  fontSize: '12px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 2px 6px rgba(23, 14, 94, 0.2)',
                }}
              >
                <PlusIcon size={14} color="#ffffff" />
                <span>{t('delivery_reps.van_inventory_tab.s7', "+ طلب تحميل بضاعة من المستودع")}</span>
              </button>
            )}
          </div>
        )
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))',
            gap: '8px',
            width: '100%',
            minWidth: 0,
            boxSizing: 'border-box',
          }}
        >
        {filteredInventory.map((item) => {
          const inCartItem = cart.find((c) => c.productId === item.productId);
          const inCartQty = inCartItem ? inCartItem.qty : 0;
          const isMaxReached = inCartQty >= item.qty;

          return (
            <div
              key={item.productId}
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '12px',
                padding: '9px 12px',
                border: inCartQty > 0 ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
                boxShadow: '0 1px 3px rgba(15, 23, 42, 0.03)',
                display: 'flex',
                flexDirection: 'column',
                gap: '7px',
                width: '100%',
                minWidth: 0,
                boxSizing: 'border-box',
                overflow: 'hidden',
                transition: 'border-color 0.2s',
              }}
            >
              {/* Top Row: Product Name + Barcode + In-Cart Badge (Right) & Van Stock Badge (Left) */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flexWrap: 'wrap' }}>
                    <h4
                      style={{
                        margin: 0,
                        fontWeight: 800,
                        fontSize: '12.5px',
                        color: '#0f172a',
                        lineHeight: 1.35,
                        wordBreak: 'break-word',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        minWidth: 0,
                      }}
                      title={item.productName}
                    >
                      {item.productName}
                    </h4>
                    {item.barcode && (
                      <span style={{ fontSize: '10px', color: '#94a3b8', fontFamily: 'monospace', flexShrink: 0 }}>
                        #{item.barcode}
                      </span>
                    )}
                    {inCartQty > 0 && (
                      <span
                        style={{
                          backgroundColor: '#eef2ff',
                          color: '#170e5e',
                          fontSize: '9.5px',
                          fontWeight: 800,
                          padding: '1px 5px',
                          borderRadius: '4px',
                          border: '1px solid #c7d2fe',
                          flexShrink: 0,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t('delivery_reps.van_inventory_tab.s8', "مضاف:")} {inCartQty}
                      </span>
                    )}
                  </div>
                </div>

                <span
                  style={{
                    backgroundColor: '#eef2ff',
                    color: '#170e5e',
                    fontWeight: 800,
                    fontSize: '11px',
                    padding: '2px 7px',
                    borderRadius: '5px',
                    border: '1px solid #c7d2fe',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                  title={t('delivery_reps.van_inventory_tab.s9', "الكمية المحملة داخل سيارة التوزيع")}
                >
                  {t('delivery_reps.van_inventory_tab.s10', "السيارة:")} {item.qty} {item.stockUnitName || item.unitName || t('delivery_reps.van_inventory_tab.s11', "قطعة")}
                </span>
              </div>

              {/* Bottom Row: Price + Main Warehouse Stock (Right) & Stepper / Add Button (Left) */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flexShrink: 1, overflow: 'hidden' }}>
                  <span style={{ fontSize: '12.5px', fontWeight: 900, color: '#170e5e', whiteSpace: 'nowrap' }}>
                    {item.retailPrice.toFixed(2)} <CurrencySymbol />
                  </span>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      color: '#64748b',
                      backgroundColor: '#f1f5f9',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      whiteSpace: 'nowrap',
                      border: '1px solid #e2e8f0',
                    }}
                    title={t('delivery_reps.van_inventory_tab.s12', "الكمية المتاحة حالياً في المستودع الرئيسي")}
                  >
                    {t('delivery_reps.van_inventory_tab.s13', "المستودع:")} {item.mainWarehouseQty ?? 0}
                  </span>
                </div>

                <div style={{ flexShrink: 0 }}>
                  {inCartQty > 0 ? (
                    <div dir="rtl" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <button
                        type="button"
                        onClick={() => onAddToCart(item)}
                        disabled={isMaxReached}
                        style={{
                          width: '28px',
                          height: '26px',
                          minHeight: '26px',
                          maxHeight: '26px',
                          padding: 0,
                          backgroundColor: isMaxReached ? '#f1f5f9' : '#170e5e',
                          border: 'none',
                          borderRadius: '6px',
                          fontWeight: 800,
                          cursor: isMaxReached ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxSizing: 'border-box',
                        }}
                        title={isMaxReached ? t('delivery_reps.van_inventory_tab.s14', "تم بلوغ أقصى كمية بالسيارة") : t('delivery_reps.van_inventory_tab.s15', "زيادة صنف في الفاتورة")}
                      >
                        <span style={{ fontSize: '15px', fontWeight: 800, lineHeight: 1, color: isMaxReached ? '#94a3b8' : '#ffffff' }}>+</span>
                      </button>
                      <span style={{ fontWeight: 800, fontSize: '12.5px', minWidth: '22px', textAlign: 'center', color: '#170e5e', lineHeight: 1 }}>
                        {inCartQty}
                      </span>
                      <button
                        type="button"
                        onClick={() => onUpdateCartQty?.(item.productId, -1)}
                        style={{
                          width: '28px',
                          height: '26px',
                          minHeight: '26px',
                          maxHeight: '26px',
                          padding: 0,
                          backgroundColor: '#ffffff',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          fontWeight: 800,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxSizing: 'border-box',
                        }}
                        title={t('delivery_reps.van_inventory_tab.s16', "إنقاص صنف من الفاتورة")}
                      >
                        <span style={{ fontSize: '15px', fontWeight: 800, lineHeight: 1, color: '#0f172a' }}>−</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onAddToCart(item)}
                      disabled={item.qty <= 0}
                      style={{
                        height: '26px',
                        minHeight: '26px',
                        maxHeight: '26px',
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
                        whiteSpace: 'nowrap',
                        boxSizing: 'border-box',
                      }}
                    >
                      <PlusIcon size={12} color="#ffffff" />
                      <span>{t('delivery_reps.van_inventory_tab.s17', "إضافة")}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    )}

      {/* Floating Bottom Cart Bar - Premium Calm Enterprise Design */}
      {cart.length > 0 && onGoToSale && (
        <div
          style={{
            position: 'sticky',
            bottom: 'calc(58px + env(safe-area-inset-bottom, 0px))',
            zIndex: 30,
            marginTop: '8px',
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            padding: '7px 12px',
            boxShadow: '0 4px 18px rgba(15, 23, 42, 0.12), 0 1px 3px rgba(15, 23, 42, 0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            border: '1.5px solid #170e5e',
            width: '100%',
            minWidth: 0,
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: '#eef2ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                border: '1px solid #c7d2fe',
              }}
            >
              <ShoppingCartIcon size={16} color="#170e5e" />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {t('delivery_reps.van_inventory_tab.s18', "الفاتورة:")} {cart.length} {cart.length === 1 ? t('delivery_reps.van_inventory_tab.s19', "صنف") : cart.length === 2 ? t('delivery_reps.van_inventory_tab.s20', "صنفان") : cart.length <= 10 ? t('delivery_reps.van_inventory_tab.s21', "أصناف") : t('delivery_reps.van_inventory_tab.s22', "صنف")} ({totalPiecesInCart} {totalPiecesInCart === 1 ? t('delivery_reps.van_inventory_tab.s23', "قطعة") : totalPiecesInCart === 2 ? t('delivery_reps.van_inventory_tab.s24', "قطعتان") : totalPiecesInCart <= 10 ? t('delivery_reps.van_inventory_tab.s25', "قطع") : t('delivery_reps.van_inventory_tab.s26', "قطعة")})
              </div>
              <div style={{ fontSize: '12.5px', fontWeight: 900, color: '#170e5e', whiteSpace: 'nowrap', marginTop: '1px' }}>
                {t('delivery_reps.van_inventory_tab.s27', "الإجمالي:")} {cartTotal.toFixed(2)} <CurrencySymbol />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onGoToSale}
            style={{
              backgroundColor: '#170e5e',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              padding: '7px 12px',
              fontSize: '11.5px',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              boxShadow: '0 2px 6px rgba(23, 14, 94, 0.22)',
              transition: 'transform 0.15s ease',
            }}
          >
            <span>{t('delivery_reps.van_inventory_tab.s28', "متابعة الفاتورة")}</span>
            <span style={{ fontSize: '13px' }}>←</span>
          </button>
        </div>
      )}
    </div>
  );
};
