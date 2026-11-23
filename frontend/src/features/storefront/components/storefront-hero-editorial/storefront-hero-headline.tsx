import type { StorefrontInfo } from '../../types/storefront.types';

export interface StorefrontHeroHeadlineProps {
  info: StorefrontInfo;
  isEn: boolean;
}

export function StorefrontHeroHeadline(props: StorefrontHeroHeadlineProps) {
  const { info, isEn } = props;
  return (
    <>
    {/* Top Main Headline */}
    <div className="sf-hero-headline-wrap" style={{ maxWidth: '100%', marginBottom: '12px', position: 'relative', zIndex: 5 }}>
      <style>{`
        @keyframes sfHeadlineGlassSweep {
          0% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }
        .sf-hero-glass-headline {
          margin: 0;
          padding: 2px 6px;
          display: inline-block;
          font-size: 20px;
          font-weight: 700;
          line-height: 1.35;
          letter-spacing: -0.01em;
          white-space: nowrap;
          font-family: 'Alexandria', 'Inter', 'Tajawal', 'Cairo', sans-serif;
          color: #132032;
          background-image: linear-gradient(
            112deg,
            #132032 0%,
            #132032 41%,
            color-mix(in srgb, #132032 75%, #ffffff 25%) 46%,
            color-mix(in srgb, #132032 52%, #ffffff 48%) 50%,
            color-mix(in srgb, #132032 75%, #ffffff 25%) 54%,
            #132032 59%,
            #132032 100%
          );
          background-size: 240% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: sfHeadlineGlassSweep 3.4s ease-in-out infinite alternate;
          will-change: background-position;
        }
      `}</style>
      <h1 className="sf-hero-glass-headline" style={{ color: '#132032' }}>
        {info?.heroHeadline?.trim() || (isEn ? 'Top Global Products at the Best Prices' : 'أفضل المنتجات بأحسن سعر')}
      </h1>
      {info?.heroSubtitle?.trim() && (
        <p
          style={{
            margin: '6px auto 0',
            fontSize: '13px',
            fontWeight: 500,
            color: '#64748b',
            lineHeight: 1.5,
            maxWidth: '650px',
          }}
        >
          {info.heroSubtitle.trim()}
        </p>
      )}
    </div>
    </>
  );
}
