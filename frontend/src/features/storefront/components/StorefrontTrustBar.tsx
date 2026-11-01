import React from 'react';
import { useStorefrontLang } from '@/i18n';
import type { StorefrontInfo } from '../types/storefront.types';

interface StorefrontTrustBarProps {
  info?: StorefrontInfo;
}

export const StorefrontTrustBar = React.memo(function StorefrontTrustBar(_props: StorefrontTrustBarProps) {
  const { isEn, dir } = useStorefrontLang();

  const trustFeatures = [
    {
      id: 'shipping',
      title: isEn ? 'Fast & Safe Shipping' : 'شحن سريع وآمن',
      subtitle: isEn
        ? 'Express nationwide delivery handled with utmost care to your doorstep'
        : 'توصيل سريع لكافة المحافظات بعناية فائقة حتى باب المنزل',
      icon: (
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.85"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
          <path d="M15 18H9" />
          <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
          <circle cx="17" cy="18" r="2" />
          <circle cx="7" cy="18" r="2" />
        </svg>
      ),
    },
    {
      id: 'cod',
      title: isEn ? 'Cash on Delivery' : 'الدفع عند الاستلام',
      subtitle: isEn
        ? 'Inspect and verify your entire order upon arrival before paying'
        : 'إمكانية معاينة وفحص طلبك بالكامل قبل الدفع بكل اطمئنان',
      icon: (
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.85"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect width="20" height="12" x="2" y="6" rx="2" />
          <circle cx="12" cy="12" r="2.5" />
          <path d="M6 12h.01M18 12h.01" />
        </svg>
      ),
    },
    {
      id: 'quality',
      title: isEn ? '100% Authentic Quality' : 'جودة أصلية 100%',
      subtitle: isEn
        ? 'Carefully curated authentic products for a premium shopping experience'
        : 'نختار لكم أجود المنتجات الأصلية بعناية لتجربة فاخرة ومميزة',
      icon: (
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.85"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      ),
    },
    {
      id: 'returns',
      title: isEn ? 'Flexible Returns & Exchanges' : 'استبدال واسترجاع مرن',
      subtitle: isEn
        ? 'Easy, hassle-free return and exchange policy within 14 days'
        : 'سياسة استبدال واسترجاع سهلة ومرنة خلال 14 يوماً بكل سهولة',
      icon: (
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.85"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M8 16H3v5" />
        </svg>
      ),
    },
  ];

  return (
    <section
      aria-label={isEn ? 'Store Trust & Features' : 'مميزات وثقة المتجر'}
      className="storefront-trust-bar-wrapper"
      dir={dir}
      style={{
        maxWidth: 'var(--storefront-container, 1440px)',
        width: '100%',
        margin: '28px auto 0',
        padding: '0',
        boxSizing: 'border-box',
      }}
    >
      <div className="storefront-trust-banner">
        <div className="storefront-trust-bar-grid">
          {trustFeatures.map((item) => (
            <div key={item.id} className="storefront-trust-feature-item">
              <div className="storefront-trust-icon-wrap" aria-hidden="true">
                {item.icon}
              </div>

              <div className="storefront-trust-text-col">
                <h3 className="storefront-trust-title">{item.title}</h3>
                <p className="storefront-trust-subtitle">{item.subtitle}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .storefront-trust-banner {
          width: 100%;
          border-radius: 18px !important;
          background: #ffffff !important;
          border: 1px solid #e2e8f0 !important;
          padding: 24px 28px !important;
          box-sizing: border-box !important;
          box-shadow: 0 6px 20px -4px rgba(15, 23, 42, 0.04), 0 2px 6px -1px rgba(15, 23, 42, 0.02) !important;
          position: relative;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .storefront-trust-bar-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 20px;
          align-items: stretch;
          justify-items: center;
          width: 100%;
          max-width: 1320px;
          margin: 0 auto;
        }

        .storefront-trust-feature-item {
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: flex-start;
          gap: 13px;
          color: #0f172a;
          position: relative;
          width: 100%;
          padding: 12px 14px;
          border-radius: 14px;
          background: #f8fafc;
          border: 1px solid #f1f5f9;
          box-sizing: border-box;
          transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .storefront-trust-feature-item:hover {
          transform: translateY(-2px);
          border-color: #cbd5e1;
          box-shadow: 0 6px 16px rgba(15, 23, 42, 0.05);
        }

        .storefront-trust-feature-item:hover .storefront-trust-icon-wrap {
          background: var(--storefront-primary-color, #2d68c4);
          color: #ffffff;
          transform: scale(1.04);
        }

        .storefront-trust-icon-wrap {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          border: 1px solid rgba(45, 104, 196, 0.16);
          background: var(--storefront-primary-subtle, #eff6ff);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--storefront-primary-color, #2d68c4);
          flex-shrink: 0;
          transition: all 0.2s ease;
        }

        .storefront-trust-text-col {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          text-align: start;
          min-width: 0;
          flex: 1;
        }

        .storefront-trust-title {
          margin: 0 0 3px !important;
          font-size: 14px !important;
          font-weight: 800 !important;
          color: #0f172a !important;
          line-height: 1.35 !important;
          letter-spacing: -0.1px;
        }

        .storefront-trust-subtitle {
          margin: 0 !important;
          font-size: 11.5px !important;
          font-weight: 500 !important;
          color: #64748b !important;
          line-height: 1.45 !important;
        }

        @media (max-width: 1120px) {
          .storefront-trust-banner {
            padding: 20px 18px !important;
          }
          .storefront-trust-bar-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 14px;
          }
        }

        @media (max-width: 640px) {
          .storefront-trust-bar-wrapper {
            margin: 12px auto 0 !important;
            padding: 0 !important;
            box-sizing: border-box !important;
          }
          .storefront-trust-banner {
            border-radius: 16px !important;
            padding: 12px !important;
          }
          .storefront-trust-bar-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            align-items: stretch !important;
            gap: 8px !important;
          }
          .storefront-trust-feature-item {
            flex-direction: column !important;
            align-items: center !important;
            justify-content: flex-start !important;
            text-align: center !important;
            width: 100% !important;
            min-width: 0 !important;
            gap: 6px !important;
            padding: 10px 8px !important;
            background: #f8fafc !important;
            border: 1px solid #edf1f7 !important;
            border-radius: 12px !important;
            box-sizing: border-box !important;
          }
          .storefront-trust-text-col {
            width: 100% !important;
            max-width: 100% !important;
            align-items: center !important;
            text-align: center !important;
          }
          .storefront-trust-icon-wrap {
            width: 34px !important;
            height: 34px !important;
            border-radius: 10px !important;
          }
          .storefront-trust-icon-wrap svg {
            width: 17px !important;
            height: 17px !important;
          }
          .storefront-trust-title {
            font-size: 12px !important;
            font-weight: 700 !important;
            white-space: normal !important;
            margin-bottom: 2px !important;
            line-height: 1.3 !important;
          }
          .storefront-trust-subtitle {
            font-size: 10px !important;
            line-height: 1.38 !important;
          }
        }
      `}</style>
    </section>
  );
});

