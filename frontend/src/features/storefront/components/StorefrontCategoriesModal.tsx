import { useStorefrontLang } from '@/i18n';
import { useState, useMemo, useEffect } from 'react';
import { StorefrontCategory } from '../types/storefront.types';
import { getAutoProductPhoto, generatePremiumProductSvg } from '../lib/storefront-photo-matcher';
import { IconClose, IconSearch, IconShoppingBag } from './StorefrontIcons';
import { DialogShell } from '@/shared/components/dialog-shell';

interface StorefrontCategoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: StorefrontCategory[];
  categoryCounts: Map<number | 'all', number>;
  selectedCategoryId: number | 'all';
  onSelectCategory: (id: number | 'all') => void;
}

export function StorefrontCategoriesModal({
  isOpen,
  onClose,
  categories,
  categoryCounts,
  selectedCategoryId,
  onSelectCategory,
}: StorefrontCategoriesModalProps) {
  const { isEn, dir } = useStorefrontLang();
  const [modalSearch, setModalSearch] = useState('');

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Filter categories by search term
  const displayedCategories = useMemo(() => {
    if (!modalSearch.trim()) return categories;
    const q = modalSearch.trim().toLowerCase();
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, modalSearch]);

  if (!isOpen) return null;

  const totalAllCount = categoryCounts.get('all') || 0;

  const getCategoryPhoto = (cat: StorefrontCategory) => {
    const raw = cat.imageUrl || getAutoProductPhoto(cat.name, cat.name);
    if (raw && !raw.startsWith('data:image/svg')) return raw;
    return generatePremiumProductSvg(cat.name, cat.name);
  };

  const formatCountLabel = (count: number) => {
    if (isEn) {
      return `${count} ${count === 1 ? 'item' : 'items'}`;
    }
    const unit =
      count === 1
        ? 'صنف'
        : count === 2
          ? 'صنفان'
          : count <= 10
            ? 'أصناف'
            : 'صنف';
    return `${count} ${unit}`;
  };

  return (
    <DialogShell
      open={isOpen}
      onClose={onClose}
      width="min(1080px, 95vw)"
      maxHeight="min(88vh, 760px)"
      shellClassName="storefront-cat-modal-shell"
      ariaLabel={isEn ? 'All Store Categories' : 'جميع أقسام وتصنيفات المتجر'}
    >
      <div className="full-bleed storefront-cat-modal-root" dir={dir} style={{ direction: dir }}>
        {/* Top Header Bar: Clean & Integrated */}
        <div className="storefront-cat-modal-header">
          {/* Title Area */}
          <div className="storefront-cat-modal-header-brand" style={{ width: 'auto', minWidth: 'auto' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a', lineHeight: 1.3 }}>
                {isEn ? 'Browse Store Categories' : 'تصفح أقسام المتجر'}
              </h2>
              <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 500 }}>
                {isEn
                  ? `${categories.length} categories available`
                  : `${categories.length} ${categories.length <= 10 ? 'أقسام معتمدة' : 'قسماً معتمداً'}`}
              </span>
            </div>
          </div>

          {/* Quick Filter Search Input */}
          <div className="storefront-cat-modal-search-box">
            <input
              type="text"
              value={modalSearch}
              onChange={(e) => setModalSearch(e.target.value)}
              placeholder={isEn ? 'Search for a category...' : 'ابحث عن اسم القسم أو التصنيف...'}
              style={{
                width: '100%',
                height: '38px',
                padding: isEn ? '6px 12px 6px 36px' : '6px 36px 6px 12px',
                borderRadius: '11px',
                border: '1px solid #e2e8f0',
                fontSize: '12.5px',
                fontWeight: 500,
                color: '#0f172a',
                background: '#f8fafc',
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'all 0.18s ease',
              }}
              onFocus={(e) => {
                e.target.style.borderColor = 'var(--storefront-primary-color, #170e5e)';
                e.target.style.background = '#ffffff';
                e.target.style.boxShadow = '0 0 0 3px rgba(23, 14, 94, 0.08)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#e2e8f0';
                e.target.style.background = '#f8fafc';
                e.target.style.boxShadow = 'none';
              }}
            />
            <span
              style={{
                position: 'absolute',
                top: '50%',
                [isEn ? 'left' : 'right']: '12px',
                transform: 'translateY(-50%)',
                display: 'flex',
                alignItems: 'center',
                pointerEvents: 'none',
              }}
            >
              <IconSearch size={15} color="#64748b" />
            </span>
            {modalSearch.trim() && (
              <button
                type="button"
                onClick={() => setModalSearch('')}
                style={{
                  position: 'absolute',
                  top: '50%',
                  [isEn ? 'right' : 'left']: '8px',
                  transform: 'translateY(-50%)',
                  background: '#e2e8f0',
                  border: 'none',
                  borderRadius: '7px',
                  padding: '2px 8px',
                  color: '#334155',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 600,
                }}
              >
                {isEn ? 'Clear' : 'مسح'}
              </button>
            )}
          </div>

          {/* Close Button: Soft Squircle */}
          <button
            type="button"
            onClick={onClose}
            className="storefront-cat-modal-close-btn"
            title={isEn ? 'Close (Esc)' : 'إغلاق (Esc)'}
          >
            <IconClose size={15} strokeWidth={2.1} />
          </button>
        </div>

        {/* Main Body: Full-Width Panoramic Grid (No Redundant Sidebar) */}
        <div
          className="storefront-cat-modal-content"
          style={{
            flex: 1,
            padding: '20px 24px',
            overflowY: 'auto',
            background: '#ffffff',
            boxSizing: 'border-box',
          }}
        >
          {/* Subtitle Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '16px',
              paddingBottom: '10px',
              borderBottom: '1px solid #f1f5f9',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  width: '3px',
                  height: '14px',
                  backgroundColor: 'var(--storefront-primary-color, #170e5e)',
                  borderRadius: '2px',
                  display: 'inline-block',
                }}
              />
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b' }}>
                {modalSearch.trim()
                  ? (isEn ? `Search results for "${modalSearch}"` : `نتائج البحث عن «${modalSearch}»`)
                  : (isEn ? 'Choose a category to browse products' : 'اختر القسم لتصفح كافة الأصناف والمنتجات')}
              </span>
            </div>

            <span
              style={{
                fontSize: '11.5px',
                color: '#64748b',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                padding: '3px 10px',
                borderRadius: '8px',
                fontWeight: 600,
              }}
            >
              {modalSearch.trim()
                ? `${displayedCategories.length} ${isEn ? 'matching' : 'مطابق'}`
                : (isEn ? `Total ${totalAllCount} items` : `إجمالي ${totalAllCount} صنف`)}
            </span>
          </div>

          {/* Categories Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))',
              gap: '12px',
              alignContent: 'start',
            }}
          >
            {/* Master Card: All Products (Styled consistently with clean enterprise cards) */}
            {!modalSearch.trim() && (
              <div
                onClick={() => {
                  onSelectCategory('all');
                  onClose();
                }}
                className={`storefront-cat-modal-card ${selectedCategoryId === 'all' ? 'selected' : ''}`}
                style={{
                  minHeight: '190px',
                  border: selectedCategoryId === 'all'
                    ? '1.5px solid var(--storefront-primary-color, #170e5e)'
                    : '1px solid #edf1f7',
                  background: selectedCategoryId === 'all' ? '#fbfcfe' : '#ffffff',
                }}
              >
                {/* Master Icon Box */}
                <div
                  className="storefront-cat-modal-card-img-box"
                  style={{
                    background: selectedCategoryId === 'all' ? '#eef2ff' : '#f8fafc',
                    border: selectedCategoryId === 'all' ? '1px solid #c7d2fe' : '1px solid #f1f5f9',
                  }}
                >
                  <IconShoppingBag
                    size={32}
                    color="var(--storefront-primary-color, #170e5e)"
                    strokeWidth={1.9}
                  />
                </div>

                {/* Title */}
                <div
                  style={{
                    textAlign: 'center',
                    padding: '0 4px',
                    minHeight: '36px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span
                    style={{
                      fontSize: '13px',
                      fontWeight: selectedCategoryId === 'all' ? 800 : 700,
                      color: selectedCategoryId === 'all' ? 'var(--storefront-primary-color, #170e5e)' : '#0f172a',
                      lineHeight: 1.35,
                    }}
                  >
                    {isEn ? 'All Products' : 'جميع المنتجات'}
                  </span>
                  <span style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 500, marginTop: '2px' }}>
                    {isEn ? 'Browse entire catalog' : 'تصفح كل أصناف المتجر'}
                  </span>
                </div>

                {/* Count Badge */}
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      color: selectedCategoryId === 'all' ? 'var(--storefront-primary-color, #170e5e)' : '#475569',
                      background: selectedCategoryId === 'all' ? '#eef2ff' : '#f1f5f9',
                      padding: '2px 9px',
                      borderRadius: '7px',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatCountLabel(totalAllCount)}
                  </span>
                </div>
              </div>
            )}

            {/* Individual Category Cards */}
            {displayedCategories.map((cat) => {
              const count = categoryCounts.get(cat.id) || 0;
              const isSelected = selectedCategoryId === cat.id;
              const photoUrl = getCategoryPhoto(cat);

              return (
                <div
                  key={cat.id}
                  onClick={() => {
                    onSelectCategory(cat.id);
                    onClose();
                  }}
                  className={`storefront-cat-modal-card ${isSelected ? 'selected' : ''}`}
                  style={{
                    minHeight: '190px',
                    border: isSelected
                      ? '1.5px solid var(--storefront-primary-color, #170e5e)'
                      : '1px solid #edf1f7',
                    background: isSelected ? '#fbfcfe' : '#ffffff',
                  }}
                >
                  {/* Category Image Box */}
                  <div className="storefront-cat-modal-card-img-box">
                    <img
                      src={photoUrl}
                      alt={cat.name}
                      className="storefront-cat-modal-card-img"
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        e.currentTarget.src = generatePremiumProductSvg(cat.name, cat.name);
                      }}
                    />
                  </div>

                  {/* Category Title: Full 2 lines without clipping */}
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '0 4px',
                      minHeight: '36px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: isSelected ? 800 : 700,
                        color: isSelected ? 'var(--storefront-primary-color, #170e5e)' : '#0f172a',
                        lineHeight: 1.35,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        wordBreak: 'break-word',
                      }}
                      title={cat.name}
                    >
                      {cat.name}
                    </span>
                  </div>

                  {/* Count Badge */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: isSelected ? 'var(--storefront-primary-color, #170e5e)' : '#475569',
                        background: isSelected ? '#eef2ff' : '#f1f5f9',
                        padding: '2px 9px',
                        borderRadius: '7px',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatCountLabel(count)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Empty Search State */}
          {displayedCategories.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: '48px 16px',
                color: '#64748b',
              }}
            >
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '16px',
                  background: '#f1f5f9',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 14px',
                  color: '#94a3b8',
                }}
              >
                <IconSearch size={26} />
              </div>
              <h4 style={{ margin: '0 0 6px', fontSize: '15px', color: '#1e293b', fontWeight: 700 }}>
                {isEn ? 'No categories found' : 'لم يتم العثور على أي أقسام'}
              </h4>
              <p style={{ margin: 0, fontSize: '12.5px', color: '#64748b' }}>
                {isEn
                  ? `No category matches "${modalSearch}". Try a different search term.`
                  : `لا يوجد قسم يطابق «${modalSearch}». جرب البحث بكلمة أخرى.`}
              </p>
            </div>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
