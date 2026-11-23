import React from 'react';
import type { StorefrontInfo } from '../../types/storefront.types';

export interface StorefrontHeroTickerProps {
  isEn: boolean;
  info: StorefrontInfo;
  dir: 'ltr' | 'rtl';
}

export function StorefrontHeroTicker(props: StorefrontHeroTickerProps) {
  const { isEn, info, dir } = props;
  return (
    <>
    {/* Bottom Hero Continuous Moving Trust & Value Marquee Strip */}
    <div className="sf-hero-ticker-viewport" dir="ltr" aria-label={isEn ? 'Store Features' : 'مميزات المتجر'}>
      <div className="sf-hero-ticker-track">
        {[0, 1].map((copyIdx) => {
          const rawCurr = (info.currency || '').trim().toUpperCase();
          const currLabel =
            !rawCurr || rawCurr === 'EGP' || rawCurr === 'ج.م'
              ? isEn
                ? 'EGP'
                : 'جنيه'
              : info.currency;

          const freeShipPhrase =
            info.freeShippingEnabled && info.freeShippingMinOrder
              ? isEn
                ? { start: 'Free Shipping on Orders Over', bold: `${info.freeShippingMinOrder} ${currLabel}` }
                : { start: 'شحن مجاني للطلبات فوق', bold: `${info.freeShippingMinOrder} ${currLabel}` }
              : isEn
              ? { bold: 'Fast Delivery', end: 'Right to Your Doorstep' }
              : { bold: 'توصيل سريع', end: 'لباب البيت' };

          const tickerPhrases: Array<{ start?: string; bold: string; end?: string }> = isEn
            ? [
                { start: 'Guaranteed Authentic Quality', bold: '100%' },
                freeShipPhrase,
                { bold: 'Secure Payment', end: 'Cash on Delivery, Cards & Wallets' },
                { start: 'Instant WhatsApp Support', bold: '24/7' },
                { bold: '+10,000', end: 'Happy Customers Trust Us' },
                { start: 'Easy Returns & Exchange Within', bold: '14 Days' },
                { bold: 'Careful Packaging', end: 'Safe & Secure Delivery for Every Order' },
                { bold: 'Best Price Guarantee', end: '& Exclusive Daily Deals' },
                { bold: 'Express Shipping', end: 'Direct Delivery to All Governorates' },
              ]
            : [
                { start: 'جودة أصلية مضمونة', bold: '100%' },
                freeShipPhrase,
                { bold: 'دفع آمن', end: 'عند الاستلام أو بالبطاقات والمحافظ' },
                { start: 'خدمة عملاء فورية عبر واتساب', bold: '24/7' },
                { bold: '+10,000', end: 'عميل سعيد يثق بنا' },
                { start: 'استبدال واسترجاع مرن خلال', bold: '14 يوم' },
                { bold: 'تغليف محكم', end: 'وعناية فائقة بكل طلب حتى يصلك' },
                { bold: 'أفضل سعر', end: 'وعروض وخصومات يومية حصرية' },
                { bold: 'توصيل سريع', end: 'شحن مباشر لجميع المحافظات' },
              ];

          return (
            <div
              key={copyIdx}
              style={{
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              {tickerPhrases.map((phrase, idx) => (
                <React.Fragment key={`${copyIdx}-${idx}`}>
                  <div
                    dir={dir}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '0 20px',
                      whiteSpace: 'nowrap',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#1e293b',
                    }}
                  >
                    {phrase.start && <span>{phrase.start}</span>}
                    <span
                      style={{
                        fontWeight: 800,
                        color: 'var(--storefront-primary-color, #170e5e)',
                        fontSize: '13.5px',
                      }}
                    >
                      {phrase.bold}
                    </span>
                    {phrase.end && <span>{phrase.end}</span>}
                  </div>
                  <span
                    aria-hidden="true"
                    style={{
                      color: '#cbd5e1',
                      fontSize: '14px',
                      fontWeight: 300,
                      userSelect: 'none',
                    }}
                  >
                    |
                  </span>
                </React.Fragment>
              ))}
            </div>
          );
        })}
      </div>
    </div>
    </>
  );
}
