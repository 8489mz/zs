// KioskOrderTray — the live order tray: header + cart lines + steppers + footer + checkout button.
// Pure move from SelfOrderingKioskPage; the facade keeps all state and mounts
// this component with the cart and its handlers as props.

import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/format';
import { Button } from '@/shared/ui/button';
import { ShoppingBagIcon, Trash2Icon } from '@/shared/components/icons/AppIcons';
import { calcCartLineTotal } from '@/features/pos/lib/pos-modifier-totals';
import type { KioskCartItem } from '@/features/pos/hooks/useSelfOrderingKiosk';

export interface KioskOrderTrayProps {
  cart: KioskCartItem[];
  diningMode: 'dine_in' | 'takeaway' | null;
  totalItemsCount: number;
  totalCartAmount: number;
  onUpdateQty: (lineKey: string, delta: number) => void;
  onRemoveFromCart: (lineKey: string) => void;
  onEditModifiers: (item: KioskCartItem) => void;
  onClearCart: () => void;
  onCheckout: () => void;
}

{/* ========================================================= */}
{/* 3. اليسار: صينية الطلب المباشرة (Live Order Tray - 330px) */}
{/* ========================================================= */}
export function KioskOrderTray({
  cart,
  diningMode,
  totalItemsCount,
  totalCartAmount,
  onUpdateQty,
  onRemoveFromCart,
  onEditModifiers,
  onClearCart,
  onCheckout,
}: KioskOrderTrayProps) {
  const { t: __t } = useTranslation();

  return (
    <aside
      style={{
        width: '330px',
        minWidth: '330px',
        backgroundColor: '#ffffff',
        borderRight: '1.5px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      {/* هيدر الصينية */}
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: '15.5px', fontWeight: 900, color: '#0f172a' }}>
            {__t('pos.self_ordering_kiosk_page.s52', __t('pos.self_ordering_kiosk_page.s52', "صينية طلبك"))}
          </h3>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            {diningMode === 'dine_in' ? __t('pos.self_ordering_kiosk_page.s53', __t('pos.self_ordering_kiosk_page.s53', "تناول بالصالة")) : __t('pos.self_ordering_kiosk_page.s54', __t('pos.self_ordering_kiosk_page.s54', "استلام سفري"))} • {totalItemsCount} {__t('pos.self_ordering_kiosk_page.s55', __t('pos.self_ordering_kiosk_page.s55', "صنف"))}
          </div>
        </div>

        {cart.length > 0 && (
          <button
            type="button"
            onClick={() => onClearCart()}
            style={{
              background: 'none',
              border: 'none',
              color: '#dc2626',
              fontSize: '11.5px',
              fontWeight: 700,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {__t('pos.self_ordering_kiosk_page.s56', __t('pos.self_ordering_kiosk_page.s56', "إفراغ الصينية"))}
          </button>
        )}
      </div>

      {/* قائمة الوجبات في الصينية */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        {cart.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94a3b8',
              textAlign: 'center',
              padding: '30px 10px',
            }}
          >
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '16px',
                backgroundColor: '#f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '10px',
              }}
            >
              <ShoppingBagIcon size={26} color="#94a3b8" />
            </div>
            <div style={{ fontSize: '14px', fontWeight: 800, color: '#475569' }}>
              {__t('pos.self_ordering_kiosk_page.s57', __t('pos.self_ordering_kiosk_page.s57', "صينيتك فارغة حالياً"))}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
              {__t('pos.self_ordering_kiosk_page.s58', __t('pos.self_ordering_kiosk_page.s58', "اختر أصنافك المفضلة من القائمة لتظهر هنا فوراً"))}
            </div>
          </div>
        ) : (
          cart.map((item) => (
            <div
              key={item.lineKey}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px',
                borderRadius: '12px',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                {item.imageUrl && (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '8px',
                      objectFit: 'cover',
                      flexShrink: 0,
                    }}
                  />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 800,
                      color: '#0f172a',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {item.name}
                  </div>
                  {/* INV-REST-KIOSK-MODIFIER-UI (R7-B2): the chosen
                      extras render under their line, and the line
                      price already includes them. */}
                  {(item.modifiers || []).map((mod, modIdx) => (
                    <div key={modIdx} style={{ fontSize: '10.5px', color: '#475569', marginTop: '1px' }}>
                      + {mod.name}{Number(mod.qty || 1) > 1 ? ` ×${mod.qty}` : ''} ({formatCurrency(Number(mod.price || 0) * Number(mod.qty || 1))})
                    </div>
                  ))}
                  <div style={{ fontSize: '11px', color: '#170e5e', fontWeight: 800, marginTop: '2px' }}>
                    {formatCurrency(calcCartLineTotal(item))}
                  </div>
                  {(item.modifiers?.length || 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => onEditModifiers(item)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#170e5e',
                        fontSize: '11px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        padding: '2px 0 0',
                      }}
                    >
                      تعديل الإضافات
                    </button>
                  )}
                </div>
              </div>

              {/* العداد الصارم RTL: [+] (الكمية) [-] وحذف */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    border: '1px solid #cbd5e1',
                    borderRadius: '7px',
                    overflow: 'hidden',
                    backgroundColor: '#ffffff',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onUpdateQty(item.lineKey, 1)}
                    style={{
                      width: '24px',
                      height: '24px',
                      border: 'none',
                      backgroundColor: '#170e5e',
                      color: '#ffffff',
                      fontWeight: 900,
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    +
                  </button>
                  <span
                    style={{
                      minWidth: '24px',
                      textAlign: 'center',
                      fontWeight: 900,
                      fontSize: '11.5px',
                    }}
                  >
                    {item.qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdateQty(item.lineKey, -1)}
                    style={{
                      width: '24px',
                      height: '24px',
                      border: 'none',
                      backgroundColor: '#f1f5f9',
                      color: '#334155',
                      fontWeight: 900,
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    -
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onRemoveFromCart(item.lineKey)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: '3px',
                  }}
                >
                  <Trash2Icon size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* فوتر الصينية وزر الدفع المباشر */}
      <div
        style={{
          padding: '14px 18px',
          borderTop: '1px solid #e2e8f0',
          backgroundColor: '#f8fafc',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ fontSize: '11.5px', color: '#64748b' }}>{__t('pos.self_ordering_kiosk_page.s59', __t('pos.self_ordering_kiosk_page.s59', "عدد الأصناف:"))}</span>
          <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>{totalItemsCount} {__t('pos.self_ordering_kiosk_page.s60', __t('pos.self_ordering_kiosk_page.s60', "صنف"))}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
          }}
        >
          <span style={{ fontSize: '13.5px', fontWeight: 900, color: '#0f172a' }}>{__t('pos.self_ordering_kiosk_page.s61', __t('pos.self_ordering_kiosk_page.s61', "المجموع الإجمالي:"))}</span>
          <span style={{ fontSize: '19px', fontWeight: 900, color: '#170e5e' }}>
            {formatCurrency(totalCartAmount)}
          </span>
        </div>

        <Button
          variant="primary"
          onClick={() => onCheckout()}
          disabled={cart.length === 0}
          style={{
            width: '100%',
            height: '48px',
            borderRadius: '12px',
            backgroundColor: cart.length > 0 ? '#170e5e' : '#cbd5e1',
            fontSize: '14px',
            fontWeight: 900,
            boxShadow: cart.length > 0 ? '0 4px 14px rgba(23, 14, 94, 0.25)' : 'none',
          }}
        >
          {__t('pos.self_ordering_kiosk_page.s62', __t('pos.self_ordering_kiosk_page.s62', "إتمام الطلب والدفع"))}
        </Button>
      </div>
    </aside>
  );
}
