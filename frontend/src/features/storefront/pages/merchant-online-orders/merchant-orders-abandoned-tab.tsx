import { useTranslation } from 'react-i18next';
import { MessageSquareIcon, Trash2Icon } from '@/shared/components/icons/AppIcons';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query';
import type { AbandonedCartRecord } from '../../types/storefront.types';

export interface MerchantOrdersAbandonedTabProps {
  abandonedQuery: UseQueryResult<{ ok: boolean; carts: AbandonedCartRecord[] }, Error>;
  formatAmount: (val: number | null | undefined) => string;
  deleteAbandonedMutation: UseMutationResult<{ ok: boolean }, Error, number>;
}

export function MerchantOrdersAbandonedTab({
  abandonedQuery,
  formatAmount,
  deleteAbandonedMutation,
}: MerchantOrdersAbandonedTabProps) {
  const { t } = useTranslation();
  return (
    <div
      className="card"
      style={{
        background: '#ffffff',
        borderRadius: '14px',
        border: '1px solid #e2e8f0',
        padding: '16px',
        boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
            {t('storefront.merchant_online_orders_page.s38', "السلات التي بدأ الزبائن بملئها ولم تكتمل")}
          </h3>
          <span style={{ fontSize: '11.5px', color: '#64748b' }}>
            {t('storefront.merchant_online_orders_page.s39', "تواصل مع هؤلاء الزبائن عبر واتساب مباشرة لتحفيزهم على إتمام الشراء وتقديم خصم تشجيعي")}
          </span>
        </div>
        <span style={{ fontSize: '12px', color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '3px 10px', borderRadius: '6px', fontWeight: 700 }}>
          {t('storefront.merchant_online_orders_page.s40', "استرداد فوري بنقرة واحدة")}
        </span>
      </div>

      {abandonedQuery.isLoading ? (
        <div style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>{t('storefront.merchant_online_orders_page.s41', "جاري تحميل السلات المتروكة...")}</div>
      ) : !abandonedQuery.data?.carts || abandonedQuery.data.carts.length === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
            {t('storefront.merchant_online_orders_page.s42', "لا توجد سلات متروكة حالياً")}
          </div>
          <div style={{ fontSize: '12px' }}>
            {t('storefront.merchant_online_orders_page.s43', "جميع العملاء الذين بدأوا الشراء أكملوا طلباتهم بنجاح")}
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0', color: '#475569', textAlign: 'right' }}>
                <th style={{ padding: '10px 12px' }}>{t('storefront.merchant_online_orders_page.s44', "تاريخ السلة")}</th>
                <th style={{ padding: '10px 12px' }}>{t('storefront.merchant_online_orders_page.s45', "بيانات العميل والهاتف")}</th>
                <th style={{ padding: '10px 12px' }}>{t('storefront.merchant_online_orders_page.s46', "الأصناف في السلة")}</th>
                <th style={{ padding: '10px 12px' }}>{t('storefront.merchant_online_orders_page.s47', "قيمة السلة")}</th>
                <th style={{ padding: '10px 12px' }}>{t('storefront.merchant_online_orders_page.s48', "الحالة")}</th>
                <th style={{ padding: '10px 12px', textAlign: 'center' }}>{t('storefront.merchant_online_orders_page.s49', "إجراءات الاسترداد")}</th>
              </tr>
            </thead>
            <tbody>
              {abandonedQuery.data.carts.map((cart: AbandonedCartRecord) => {
                const phoneClean = cart.customerPhone.replace(/\D/g, '');
                const countryDial = cart.countryCode === 'SA' ? '966' : cart.countryCode === 'AE' ? '971' : '20';
                const fullIntlPhone = phoneClean.startsWith('0') ? `${countryDial}${phoneClean.slice(1)}` : phoneClean;
                const itemsText = cart.items.map((i) => `${i.name} (×${i.quantity})`).join(t('storefront.merchant_online_orders_page.s50', "، "));
                const waMessage = `مرحباً ${cart.customerName || t('storefront.merchant_online_orders_page.s51', "عزيزي العميل")}، لاحظنا اهتمامك بطلب الأصناف التالية من متجرنا: (${itemsText}). هل تود إتمام طلبك الآن وتأكيده؟ يسعدنا مساعدتك وتوصيل طلبك في أسرع وقت!`;
                const waLink = `https://wa.me/${fullIntlPhone}?text=${encodeURIComponent(waMessage)}`;

                return (
                  <tr key={cart.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 12px', color: '#64748b', fontSize: '11.5px', whiteSpace: 'nowrap' }}>
                      {new Date(cart.createdAt).toLocaleString(t('common.locale', 'en-US') === 'en-US' ? 'en-US' : 'ar-EG', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 800, color: '#0f172a' }}>{cart.customerName || t('storefront.merchant_online_orders_page.s52', "عميل المتجر")}</div>
                      <div style={{ fontFamily: 'monospace', direction: 'ltr', textAlign: 'right', fontSize: '12px', color: '#170e5e', fontWeight: 700 }}>
                        {cart.customerPhone} ({cart.countryCode})
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px', maxWidth: '300px' }}>
                      <div style={{ fontSize: '12px', color: '#334155', lineHeight: 1.4 }}>
                        {cart.items.map((i: any, idx: number) => (
                          <span key={idx} style={{ display: 'inline-block', background: '#f1f5f9', padding: '1px 6px', borderRadius: '4px', margin: '2px', fontSize: '11px' }}>
                            {i.name} × {i.quantity}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
                      {formatAmount(cart.subtotal)} {getGlobalCurrencySymbol()}
                    </td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      {cart.recovered ? (
                        <span style={{ fontSize: '11px', color: '#166534', background: '#dcfce7', padding: '2px 7px', borderRadius: '4px', fontWeight: 700 }}>
                          {t('storefront.merchant_online_orders_page.s53', "تم الاسترداد والشراء")}
                        </span>
                      ) : (
                        <span style={{ fontSize: '11px', color: '#c2410c', background: '#ffedd5', padding: '2px 7px', borderRadius: '4px', fontWeight: 700 }}>
                          {t('storefront.merchant_online_orders_page.s54', "متروكة بانتظار المتابعة")}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <a
                          href={waLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '5px 12px',
                            borderRadius: '6px',
                            background: '#16a34a',
                            color: '#ffffff',
                            fontSize: '11.5px',
                            fontWeight: 700,
                            textDecoration: 'none',
                            boxShadow: '0 1px 3px rgba(22,163,74,0.25)',
                          }}
                        >
                          <MessageSquareIcon size={13} />
                          <span>{t('storefront.merchant_online_orders_page.s55', "استرداد عبر واتساب")}</span>
                        </a>
                        <button
                          type="button"
                          onClick={() => deleteAbandonedMutation.mutate(cart.id)}
                          title={t('storefront.merchant_online_orders_page.s56', "حذف من القائمة")}
                          style={{
                            padding: '5px 8px',
                            borderRadius: '6px',
                            border: '1px solid #fecaca',
                            background: '#fef2f2',
                            color: '#dc2626',
                            cursor: 'pointer',
                          }}
                        >
                          <Trash2Icon size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
