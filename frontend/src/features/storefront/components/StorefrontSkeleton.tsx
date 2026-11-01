import { useTranslation } from 'react-i18next';
import { useStorefrontLang } from '@/i18n';
/**
 * First paint of the public storefront while /info and /catalog load.
 *
 * Replaces a centred spinner: a page-shaped placeholder (header, banner, category pills, product grid)
 * tells the shopper the store is there and where things will appear, so the wait feels shorter and
 * nothing jumps when the real content lands. Pure markup — no data, no hooks.
 */
interface StorefrontSkeletonProps {
  brandColor?: string;
  cards?: number;
}

const shimmer: React.CSSProperties = {
  background: 'linear-gradient(90deg, #eef2f7 0%, #f8fafc 40%, #eef2f7 80%)',
  backgroundSize: '200% 100%',
  animation: 'sf-skeleton-shimmer 1.2s ease-in-out infinite',
  borderRadius: '10px',
};

export function StorefrontSkeleton({ brandColor = '#2d68c4', cards = 8 }: StorefrontSkeletonProps) {
  const { t } = useTranslation();
  const { dir } = useStorefrontLang();
  return (
    <div
      dir={dir}
      aria-busy="true"
      aria-label={t('storefront.storefront_skeleton.s0', "جاري تحميل المتجر")}
      style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', flexDirection: 'column', width: '100%', overflowX: 'hidden' }}
    >
      <style>{`@keyframes sf-skeleton-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
        @media (prefers-reduced-motion: reduce) { [data-sf-skeleton] { animation: none !important; } }`}</style>

      {/* Header */}
      <div style={{ background: brandColor, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.25)', flexShrink: 0 }} />
        <div style={{ flex: 1, height: 38, borderRadius: 10, background: 'rgba(255,255,255,0.18)' }} />
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.25)', flexShrink: 0 }} />
      </div>

      <div style={{ maxWidth: 'var(--storefront-container, 1440px)', width: '100%', margin: '0 auto', padding: '16px', boxSizing: 'border-box' }}>
        {/* Banner */}
        <div data-sf-skeleton style={{ ...shimmer, width: '100%', aspectRatio: '3 / 1', minHeight: 120, borderRadius: 14 }} />

        {/* Category pills */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '18px', overflow: 'hidden' }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <div data-sf-skeleton style={{ ...shimmer, width: 58, height: 58, borderRadius: '50%' }} />
              <div data-sf-skeleton style={{ ...shimmer, width: 46, height: 10 }} />
            </div>
          ))}
        </div>

        {/* Product grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: '12px',
            marginTop: '22px',
          }}
        >
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} style={{ background: '#ffffff', border: '1px solid #eef2f7', borderRadius: 14, padding: 10 }}>
              <div data-sf-skeleton style={{ ...shimmer, width: '100%', aspectRatio: '1 / 1' }} />
              <div data-sf-skeleton style={{ ...shimmer, height: 12, marginTop: 10, width: '85%' }} />
              <div data-sf-skeleton style={{ ...shimmer, height: 12, marginTop: 6, width: '55%' }} />
              <div data-sf-skeleton style={{ ...shimmer, height: 34, marginTop: 12 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
