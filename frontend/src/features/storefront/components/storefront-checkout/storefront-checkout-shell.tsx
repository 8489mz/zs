import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useStorefrontLang } from '@/i18n';
import { PackageIcon, XIcon } from '@/shared/components/icons/AppIcons';

export interface StorefrontCheckoutShellProps {
  children: ReactNode;
  onClose: () => void;
  onBackdropClose: () => void;
  editingOrderNumber?: string;
}

export function StorefrontCheckoutShell({ children, onClose, onBackdropClose, editingOrderNumber }: StorefrontCheckoutShellProps) {
  const { t } = useTranslation();
  const { isEn, dir } = useStorefrontLang();

  return (
    <div
      className="storefront-checkout-modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(15, 23, 42, 0.48)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        animation: 'sfAppleBackdropIn 0.16s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        pointerEvents: 'auto',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          e.stopPropagation();
          onBackdropClose();
        }
      }}
    >
      <div
        dir={dir}
        className="storefront-checkout-modal-container"
        style={{
          width: '100%',
          maxWidth: '960px',
          maxHeight: 'min(92vh, calc(100dvh - 24px))',
          background: '#ffffff',
          borderRadius: '24px',
          boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          margin: 'auto',
          border: '1px solid #e2e8f0',
          direction: dir,
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          textRendering: 'optimizeLegibility',
          animation: 'sfAppleSpringOpen 0.22s cubic-bezier(0.22, 1, 0.36, 1) forwards',
          pointerEvents: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`
          .storefront-checkout-modal-container {
            width: 100%;
            max-width: 960px;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            text-rendering: optimizeLegibility;
          }
          .storefront-checkout-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            align-items: start;
          }
          .storefront-checkout-col {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          .storefront-checkout-header {
            padding: 12px 18px;
          }
          .storefront-checkout-body {
            padding: 12px 18px;
          }
          .storefront-checkout-footer {
            padding: 10px 18px;
          }
          @media (max-width: 768px) {
            .storefront-checkout-modal-container {
              max-width: 480px !important;
              max-height: calc(100dvh - 12px) !important;
            }
            .storefront-checkout-grid {
              grid-template-columns: 1fr !important;
              gap: 6px !important;
            }
            .storefront-checkout-col {
              gap: 6px !important;
            }
            .storefront-checkout-header {
              padding: 7px 12px !important;
            }
            .storefront-checkout-body {
              padding: 6px 10px !important;
            }
            .storefront-checkout-footer {
              padding: 6px 10px !important;
            }
          }
        `}</style>
        {/* Header */}
        <div
          className="storefront-checkout-header"
          style={{
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#ffffff',
            flexShrink: 0,
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '8px',
                background: '#eef2ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid #e0e7ff',
                flexShrink: 0,
              }}
            >
              <PackageIcon size={16} color="#170e5e" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '3px', height: '12px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
                <h2 style={{ margin: 0, fontSize: '15.5px', fontWeight: 800, color: '#0f172a' }}>
                  {editingOrderNumber
                    ? (isEn ? `Edit Order #${editingOrderNumber}` : `تعديل الطلب #${editingOrderNumber}`)
                    : t('storefront.storefront_checkout_modal.s0', "إتمام وتأكيد الطلب")}
                </h2>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                {editingOrderNumber ? t('storefront.storefront_checkout_modal.s1', "تعديل بيانات وأصناف طلبك قبل اعتماده من المتجر") : t('storefront.storefront_checkout_modal.s2', "الدفع نقداً عند استلام الطلب")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#f0f4f9',
              border: '1px solid #dadce0',
              borderRadius: '12px',
              width: '30px',
              height: '30px',
              aspectRatio: '1 / 1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#1f1f1f',
              padding: 0,
              boxSizing: 'border-box',
              flexShrink: 0,
              transition: 'all 0.16s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#e3e8ee')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#f0f4f9')}
            title={t('storefront.storefront_checkout_modal.s3', "إغلاق (Esc)")}
          >
            <XIcon size={14} color="#1f1f1f" strokeWidth={2.2} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
