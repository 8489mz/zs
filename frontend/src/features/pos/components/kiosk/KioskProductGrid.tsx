// KioskProductGrid — the kiosk menu grid: loading / empty / cards / pager.
// Pure move from SelfOrderingKioskPage (file #10, slice S5): the middle
// column of the menu screen. The facade keeps all state and handlers;
// this component only renders what it is given through props.
import { useTranslation } from 'react-i18next';
import {
  PlusCircleIcon,
  RefreshCwIcon,
  ShoppingBagIcon,
  UtensilsIcon,
} from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';
import type { KioskCartItem } from '@/features/pos/hooks/useSelfOrderingKiosk';

interface KioskProductGridProps {
  isCatalogLoading: boolean;
  products: any[];
  totalPages: number;
  catalogPage: number;
  catalogHasMore: boolean;
  onPageChange: (page: number) => void;
  cart: KioskCartItem[];
  onAddToCart: (product: any) => void;
  onUpdateQty: (lineKey: string, delta: number) => void;
  imageUrlFor: (product: any) => string;
}

          {/* ========================================================= */}
          {/* 2. الوسط: شبكة الوجبات (صورة الوجبة بطلة تأخذ 70% من الكارت) */}
          {/* ========================================================= */}
export function KioskProductGrid({
  isCatalogLoading,
  products,
  totalPages,
  catalogPage,
  catalogHasMore,
  onPageChange,
  cart,
  onAddToCart,
  onUpdateQty,
  imageUrlFor,
}: KioskProductGridProps) {
  const { t: __t } = useTranslation();
  return (
          <main
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              boxSizing: 'border-box',
            }}
          >
            {isCatalogLoading ? (
              <div style={{ textAlign: 'center', padding: '80px 20px', color: '#64748b' }}>
                <div style={{ display: 'inline-block', marginBottom: '12px' }}>
                  <RefreshCwIcon size={28} color="#170e5e" />
                </div>
                <div style={{ fontSize: '15px', fontWeight: 800 }}>{__t('pos.self_ordering_kiosk_page.s47', __t('pos.self_ordering_kiosk_page.s47', "جارٍ تحميل قائمة الأصناف..."))}</div>
              </div>
            ) : products.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '60px 20px',
                  backgroundColor: '#f8fafc',
                  borderRadius: '18px',
                  border: '1px solid #e2e8f0',
                  maxWidth: '400px',
                  margin: '40px auto',
                }}
              >
                <UtensilsIcon size={36} color="#cbd5e1" />
                <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', marginTop: '10px' }}>
                  {__t('pos.self_ordering_kiosk_page.s48', __t('pos.self_ordering_kiosk_page.s48', "لا توجد أصناف في هذا القسم"))}
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                  {__t('pos.self_ordering_kiosk_page.s49', __t('pos.self_ordering_kiosk_page.s49', "جرب اختيار قسم آخر أو إلغاء كلمة البحث"))}
                </div>
              </div>
            ) : (
              <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: '14px',
                  paddingBottom: '20px',
                }}
              >
                {products.map((p: any) => {
                  // INV-REST-KIOSK-MODIFIER-UI (R7-B2): the badge counts
                  // EVERY line of this product (a product with different
                  // extras has several lines). The inline stepper only
                  // appears for a single PLAIN line — with modifier lines
                  // the tap target stays "إضافة", which opens the picker
                  // for a new choice instead of guessing which line a
                  // +/- belongs to.
                  const productLines = cart.filter((i) => i.productId === p.id);
                  const inCartQty = productLines.reduce((sum, i) => sum + i.qty, 0);
                  const singlePlainLine =
                    productLines.length === 1 && !(productLines[0].modifiers?.length)
                      ? productLines[0]
                      : null;
                  const smartImg = imageUrlFor(p);

                  return (
                    <div
                      key={p.id}
                      style={{
                        backgroundColor: '#ffffff',
                        borderRadius: '16px',
                        border: inCartQty > 0 ? '2px solid #170e5e' : '1.5px solid #e2e8f0',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        boxShadow: inCartQty > 0 ? '0 6px 18px rgba(23, 14, 94, 0.08)' : '0 2px 6px rgba(0,0,0,0.03)',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {/* صورة الوجبة البطلة: تشغل النسبة الأكبر (حوالي 70% من الكارت) */}
                      <div
                        style={{
                          height: '165px',
                          position: 'relative',
                          overflow: 'hidden',
                          backgroundColor: '#f1f5f9',
                        }}
                      >
                        {smartImg ? (
                          <img
                            src={smartImg}
                            alt={p.name}
                            loading="lazy"
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                              display: 'block',
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: '100%',
                              height: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: '#f8fafc',
                            }}
                          >
                            <ShoppingBagIcon size={40} color="#cbd5e1" />
                          </div>
                        )}
                        {inCartQty > 0 && (
                          <span
                            style={{
                              position: 'absolute',
                              top: '8px',
                              right: '8px',
                              backgroundColor: '#170e5e',
                              color: '#ffffff',
                              borderRadius: '8px',
                              padding: '2px 8px',
                              fontSize: '11px',
                              fontWeight: 900,
                              boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
                            }}
                          >
                            {inCartQty} {__t('pos.self_ordering_kiosk_page.s50', __t('pos.self_ordering_kiosk_page.s50', "بالسلة"))}
                          </span>
                        )}
                      </div>

                      {/* الجزء السفلي المدمج: اسم الوجبة والسعر وزر الإضافة */}
                      <div
                        style={{
                          padding: '12px 14px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: '8px',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '14.5px',
                            fontWeight: 800,
                            color: '#0f172a',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {p.name}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ fontSize: '16.5px', fontWeight: 900, color: '#170e5e' }}>
                            {formatCurrency(p.price)}
                          </div>

                          {singlePlainLine ? (
                            /* عداد تفاعلي مباشر داخل الكارت: [+] (الكمية) [-] — خط عادي واحد فقط */
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                backgroundColor: '#f8fafc',
                                border: '1.5px solid #170e5e',
                                borderRadius: '8px',
                                overflow: 'hidden',
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => onUpdateQty(singlePlainLine.lineKey, 1)}
                                style={{
                                  width: '30px',
                                  height: '30px',
                                  border: 'none',
                                  backgroundColor: '#170e5e',
                                  color: '#ffffff',
                                  fontSize: '14px',
                                  fontWeight: 900,
                                  cursor: 'pointer',
                                }}
                              >
                                +
                              </button>
                              <span
                                style={{
                                  minWidth: '26px',
                                  textAlign: 'center',
                                  fontWeight: 900,
                                  fontSize: '12.5px',
                                  color: '#0f172a',
                                }}
                              >
                                {inCartQty}
                              </span>
                              <button
                                type="button"
                                onClick={() => onUpdateQty(singlePlainLine.lineKey, -1)}
                                style={{
                                  width: '30px',
                                  height: '30px',
                                  border: 'none',
                                  backgroundColor: '#e2e8f0',
                                  color: '#0f172a',
                                  fontSize: '14px',
                                  fontWeight: 900,
                                  cursor: 'pointer',
                                }}
                              >
                                -
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onAddToCart(p)}
                              style={{
                                height: '34px',
                                padding: '0 14px',
                                borderRadius: '10px',
                                fontSize: '12px',
                                fontWeight: 800,
                                backgroundColor: '#170e5e',
                                color: '#ffffff',
                                border: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                cursor: 'pointer',
                              }}
                            >
                              <PlusCircleIcon size={14} />
                              <span>{__t('pos.self_ordering_kiosk_page.s51', __t('pos.self_ordering_kiosk_page.s51', "إضافة"))}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* INV-REST-KIOSK-MENU-SCALE (T10-B): the pager — the grid
              above renders one server page only, so the customer pages
              through the menu instead of the tab rendering all of it.
              Hidden when the whole menu fits on one page. */}
              {totalPages > 1 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '12px',
                    padding: '12px 0 20px',
                  }}
                >
                  <button
                    type="button"
                    disabled={catalogPage <= 1}
                    onClick={() => onPageChange(Math.max(1, catalogPage - 1))}
                    style={{
                      padding: '9px 18px',
                      borderRadius: '10px',
                      border: '1px solid #e2e8f0',
                      backgroundColor: catalogPage <= 1 ? '#f1f5f9' : '#ffffff',
                      color: catalogPage <= 1 ? '#94a3b8' : '#0f172a',
                      fontSize: '13px',
                      fontWeight: 800,
                      cursor: catalogPage <= 1 ? 'default' : 'pointer',
                    }}
                  >
                    {__t('pos.self_ordering_kiosk_page.s142', 'السابق')}
                  </button>
                  <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#475569' }}>
                    {__t('pos.self_ordering_kiosk_page.s143', 'صفحة')} {catalogPage} {__t('pos.self_ordering_kiosk_page.s144', 'من')} {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={!catalogHasMore && catalogPage >= totalPages}
                    onClick={() => onPageChange(Math.min(totalPages, catalogPage + 1))}
                    style={{
                      padding: '9px 18px',
                      borderRadius: '10px',
                      border: '1px solid #e2e8f0',
                      backgroundColor: !catalogHasMore && catalogPage >= totalPages ? '#f1f5f9' : '#170e5e',
                      color: !catalogHasMore && catalogPage >= totalPages ? '#94a3b8' : '#ffffff',
                      fontSize: '13px',
                      fontWeight: 800,
                      cursor: !catalogHasMore && catalogPage >= totalPages ? 'default' : 'pointer',
                    }}
                  >
                    {__t('pos.self_ordering_kiosk_page.s145', 'التالي')}
                  </button>
                </div>
              )}
              </>
            )}
          </main>
  );
}
