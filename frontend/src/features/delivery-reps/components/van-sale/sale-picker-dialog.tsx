import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { Button } from '@/shared/ui/button';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { PlusIcon } from '@/shared/components/icons/AppIcons';
import type { CartItem } from './van-sale-types';
import type { VanStockItem } from '../../api/van-sales.api';

export interface SalePickerDialogProps {
  availableInventory: VanStockItem[];
  cart: CartItem[];
  cartTotal: number;
  filteredPickerInventory: VanStockItem[];
  isPickerOpen: boolean;
  lastPricesMap: Record<number, { lastPrice: number; lastSaleDate: string; lastDocNo: string }>;
  onUpdateCartQty: (productId: number, delta: number) => void;
  pickerSearch: string;
  setIsPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPickerSearch: React.Dispatch<React.SetStateAction<string>>;
  totalPieces: number;
  onAddToCart?: (item: VanStockItem) => void;
}

export function SalePickerDialog({
  availableInventory,
  cart,
  cartTotal,
  filteredPickerInventory,
  isPickerOpen,
  lastPricesMap,
  onUpdateCartQty,
  pickerSearch,
  setIsPickerOpen,
  setPickerSearch,
  totalPieces,
  onAddToCart,
}: SalePickerDialogProps) {
  const { t } = useTranslation();
  return (
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
  );
}
