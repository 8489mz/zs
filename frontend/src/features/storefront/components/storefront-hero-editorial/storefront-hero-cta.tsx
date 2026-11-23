import { IconArrowUpRight } from '../StorefrontIcons';

export interface StorefrontHeroCtaProps {
  onSelectDeals: () => void;
  isEn: boolean;
  onOpenCategoriesModal: () => void;
}

export function StorefrontHeroCta(props: StorefrontHeroCtaProps) {
  const { onSelectDeals, isEn, onOpenCategoriesModal } = props;
  return (
    <>
    {/* Bottom CTA Buttons */}
    <div
      className="sf-hero-cta-row"
      style={{
        maxWidth: '640px',
        marginTop: '24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        flexWrap: 'wrap',
        position: 'relative',
        zIndex: 5,
      }}
    >
      <button
        type="button"
        className="sf-hero-btn-primary"
        onClick={onSelectDeals}
        style={{
          height: '36px',
          padding: '0 16px',
          borderRadius: '12px',
          background: 'var(--storefront-primary-color, #2d68c4)',
          color: '#ffffff',
          border: '1px solid var(--storefront-primary-color, #2d68c4)',
          fontSize: '12.5px',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
          transition: 'all 0.16s ease',
        }}
      >
        <span>{isEn ? "Browse Today's Deals" : 'تصفح عروض اليوم'}</span>
        <span style={{ fontSize: '13px', lineHeight: 1 }}>{isEn ? '→' : '←'}</span>
      </button>

      <button
        type="button"
        className="sf-hero-btn-secondary"
        onClick={onOpenCategoriesModal}
        style={{
          height: '36px',
          padding: '0 16px',
          borderRadius: '12px',
          background: '#ffffff',
          color: '#1f1f1f',
          border: '1px solid #dadce0',
          fontSize: '12.5px',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
          transition: 'all 0.16s ease',
        }}
      >
        <span>{isEn ? 'Browse All Categories' : 'تصفح كل الأقسام'}</span>
        <IconArrowUpRight size={14} />
      </button>
    </div>
    </>
  );
}
