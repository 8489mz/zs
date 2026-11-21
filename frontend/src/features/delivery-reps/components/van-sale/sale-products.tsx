import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { CheckCircleIcon, PackageIcon, ShoppingCartIcon, SlidersIcon } from '@/shared/components/icons/AppIcons';
import type { CartItem } from './van-sale-types';
import type { VanStockItem } from '../../api/van-sales.api';

export interface SaleProductsProps {
  availableInventory: VanStockItem[];
  cart: CartItem[];
  handleAutoInsertBonuses: () => void;
  handleQuickSelectProduct: (val: string) => void;
  inventorySelectOptions: Array<{ value: string; label: string; hint?: string }>;
  onGoToInventory: () => void;
  onUpdateCartQty: (productId: number, delta: number) => void;
  promoEvaluation: {
    appliedPromotions: any[];
    bonusItemsToAdd: any[];
    totalPromotionalDiscount: number;
    upsellNudges: any[];
  } | null;
  setIsPickerOpen: Dispatch<SetStateAction<boolean>>;
  totalPieces: number;
  canGiveDiscount?: boolean;
  discountCapPercent?: number;
  onAddToCart?: (item: VanStockItem) => void;
  onChangeUnit?: (productId: number, unitName: string, multiplier: number) => void;
  onLineDiscountChange?: (productId: number, amount: number) => void;
  onToggleBonus?: (productId: number) => void;
}

export function SaleProducts({
  availableInventory,
  cart,
  handleAutoInsertBonuses,
  handleQuickSelectProduct,
  inventorySelectOptions,
  onGoToInventory,
  onUpdateCartQty,
  promoEvaluation,
  setIsPickerOpen,
  totalPieces,
  canGiveDiscount,
  discountCapPercent,
  onAddToCart,
  onChangeUnit,
  onLineDiscountChange,
  onToggleBonus,
}: SaleProductsProps) {
  const { t } = useTranslation();
  return (
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
            // INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: the line
            // total is net of the explicit per-line discount.
            const lineTotal = c.isBonus ? 0 : Math.max(0, c.qty * c.unitPrice - (c.lineDiscount || 0));

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

                    {/* INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: per-line discount amount (TOTAL on the line, not per unit). Shown only when the rep may discount and the tenant cap is above zero; the server re-checks the cap — an over-cap value is refused at submit, never silently trimmed here. */}
                    {canGiveDiscount === true && (discountCapPercent ?? 5) > 0 && !c.isBonus && onLineDiscountChange && (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10.5px', fontWeight: 700, color: '#475569' }}>
                        {t('delivery_reps.van_sale_tab.s43', "خصم")}
                        <input
                          type="number"
                          min={0}
                          max={c.qty * c.unitPrice}
                          step="0.5"
                          value={c.lineDiscount || ''}
                          placeholder="0"
                          onChange={(e) => onLineDiscountChange(c.productId, Number(e.target.value) || 0)}
                          style={{ width: '52px', height: '24px', padding: '1px 4px', fontSize: '11px', fontWeight: 700, textAlign: 'center', border: '1px solid #cbd5e1', borderRadius: '5px', backgroundColor: '#ffffff' }}
                        />
                        <CurrencySymbol />
                      </label>
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
  );
}
