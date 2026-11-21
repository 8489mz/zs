import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { PackageIcon } from '@/shared/components/icons/AppIcons';

export interface VanCheckoutItemsPreviewProps {
  cart?: Array<{ productId: number; name: string; qty: number; unitPrice: number; unitName?: string; isBonus?: boolean; bonusReason?: string; originalPrice?: number }>;
  setShowItemsPreview: Dispatch<SetStateAction<boolean>>;
  t: TFunction;
  cartItemsCount: number;
  cartTotalPieces: number;
  showItemsPreview: boolean;
}

export function VanCheckoutItemsPreview({
  cart,
  setShowItemsPreview,
  t,
  cartItemsCount,
  cartTotalPieces,
  showItemsPreview,
}: VanCheckoutItemsPreviewProps) {
  return (
    <>
      {/* Compact Collapsible Items Preview */}
      {cart && cart.length > 0 && (
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            onClick={() => setShowItemsPreview((prev) => !prev)}
            style={{
              width: '100%',
              padding: '6px 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#f8fafc',
              border: 'none',
              cursor: 'pointer',
              fontSize: '11.5px',
              fontWeight: 700,
              color: '#334155',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <PackageIcon size={14} color="#170e5e" />
              <span>
                {t('delivery_reps.van_sale_checkout_modal.s12', "معاينة الفاتورة:")} <strong>{cartItemsCount} {t('delivery_reps.van_sale_checkout_modal.s13', "أصناف")}</strong> ({cartTotalPieces} {t('delivery_reps.van_sale_checkout_modal.s14', "قطعة)")}
              </span>
            </span>
            <span style={{ color: '#170e5e', fontSize: '11px', fontWeight: 800 }}>
              {showItemsPreview ? t('delivery_reps.van_sale_checkout_modal.s15', "إخفاء ▲") : t('delivery_reps.van_sale_checkout_modal.s16', "عرض الأصناف ▼")}
            </span>
          </button>

          {showItemsPreview && (
            <div style={{ maxHeight: '110px', overflowY: 'auto', borderTop: '1px solid #e2e8f0' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'right' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f1f5f9', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '4px 8px', fontWeight: 700 }}>{t('delivery_reps.van_sale_checkout_modal.s17', "الصنف")}</th>
                    <th style={{ padding: '4px 6px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_sale_checkout_modal.s18', "الكمية")}</th>
                    <th style={{ padding: '4px 6px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_sale_checkout_modal.s19', "السعر")}</th>
                    <th style={{ padding: '4px 8px', fontWeight: 700, textAlign: 'left' }}>{t('delivery_reps.van_sale_checkout_modal.s20', "الإجمالي")}</th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map((item, idx) => (
                    <tr
                      key={`${item.productId}-${idx}`}
                      style={{
                        borderBottom: idx === cart.length - 1 ? 'none' : '1px solid #f1f5f9',
                        backgroundColor: idx % 2 === 1 ? '#fafafa' : '#ffffff',
                      }}
                    >
                      <td style={{ padding: '4px 8px' }}>
                        <span style={{ fontWeight: 800, color: '#0f172a' }}>{item.name}</span>
                        {item.isBonus && (
                          <span
                            style={{
                              marginRight: '4px',
                              fontSize: '9px',
                              backgroundColor: '#dcfce7',
                              color: '#15803d',
                              padding: '1px 4px',
                              borderRadius: '3px',
                              fontWeight: 800,
                            }}
                          >
                            {t('delivery_reps.van_sale_checkout_modal.s21', "هدية")}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'center', fontWeight: 800, color: '#170e5e' }}>
                        {item.qty} {item.unitName || t('delivery_reps.van_sale_checkout_modal.s22', "قطعة")}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'center', color: '#334155' }}>
                        {item.unitPrice.toFixed(2)}
                      </td>
                      <td style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 900, color: '#0f172a' }}>
                        {(item.qty * item.unitPrice).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
