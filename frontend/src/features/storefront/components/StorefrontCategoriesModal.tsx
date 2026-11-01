import { useStorefrontLang } from '@/i18n';
import { useState, useMemo, useEffect } from 'react';
import { StorefrontCategory } from '../types/storefront.types';
import { getAutoProductPhoto, generatePremiumProductSvg } from '../lib/storefront-photo-matcher';
import { IconFolder, IconClose, IconSearch, IconShoppingBag } from './StorefrontIcons';
import { DialogShell } from '@/shared/components/dialog-shell';

interface StorefrontCategoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: StorefrontCategory[];
  categoryCounts: Map<number | 'all', number>;
  selectedCategoryId: number | 'all';
  onSelectCategory: (id: number | 'all') => void;
}

function parseCategory(name: string, isEn = false): { group: string; label: string } {
  const defaultGroup = isEn ? 'General Categories' : 'أقسام عامة';
  const defaultLabel = isEn ? 'General' : 'عام';
  if (!name) return { group: defaultGroup, label: defaultLabel };
  const trimmed = name.trim();
  if (trimmed.includes(' - ')) {
    const parts = trimmed.split(' - ').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return { group: parts[0], label: parts.slice(1).join(' - ') };
    }
  }
  if (trimmed.includes(' / ')) {
    const parts = trimmed.split(' / ').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return { group: parts[0], label: parts.slice(1).join(' / ') };
    }
  }
  return { group: defaultGroup, label: trimmed };
}

function getFamilyIcon(groupName: string, size = 16) {
  const g = groupName.toLowerCase();
  if (g.includes('صوت') || g.includes('سماع') || g.includes('إكسسوار') || g.includes('اكسسوار') || g.includes('شواحن') || g.includes('كابل') || g.includes('audio') || g.includes('headphone')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
      </svg>
    );
  }
  if (g.includes('فلاجشيب') || g.includes('flagship') || g.includes('برو') || g.includes('pro')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    );
  }
  if (g.includes('اقتصادي') || g.includes('توفير') || g.includes('مخفّض') || g.includes('deal')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
        <line x1="7" y1="7" x2="7.01" y2="7" />
      </svg>
    );
  }
  // Default Smartphone
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  );
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
  const [activeGroup, setActiveGroup] = useState<string>('');

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

  // Group categories by family
  const groupedFamilies = useMemo(() => {
    const map = new Map<string, StorefrontCategory[]>();
    for (const cat of categories) {
      const parsed = parseCategory(cat.name, isEn);
      const grp = parsed.group;
      if (!map.has(grp)) {
        map.set(grp, []);
      }
      map.get(grp)!.push(cat);
    }
    return Array.from(map.entries()).map(([groupName, cats]) => {
      const totalCount = cats.reduce((sum, c) => sum + (categoryCounts.get(c.id) || 0), 0);
      return {
        groupName,
        categories: cats,
        totalCount,
      };
    });
  }, [categories, categoryCounts, isEn]);

  // Initialize or keep active group valid
  useEffect(() => {
    if (groupedFamilies.length > 0 && (!activeGroup || !groupedFamilies.some((f) => f.groupName === activeGroup))) {
      setActiveGroup(groupedFamilies[0].groupName);
    }
  }, [groupedFamilies, activeGroup]);

  // Current items to show in the left detail panel
  const displayedCategories = useMemo(() => {
    if (modalSearch.trim()) {
      const q = modalSearch.trim().toLowerCase();
      return categories.filter((c) => c.name.toLowerCase().includes(q));
    }
    const targetGroup = activeGroup || (groupedFamilies[0]?.groupName ?? '');
    const found = groupedFamilies.find((f) => f.groupName === targetGroup);
    return found ? found.categories : categories;
  }, [categories, modalSearch, activeGroup, groupedFamilies]);

  if (!isOpen) return null;

  const totalAllCount = categoryCounts.get('all') || 0;
  const currentFamilyObj = groupedFamilies.find((f) => f.groupName === activeGroup);
  const hasMultipleFamilies = groupedFamilies.length > 1;

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
      width="min(1220px, 95vw)"
      maxHeight="min(88vh, 800px)"
      shellClassName="storefront-cat-modal-shell"
      ariaLabel={isEn ? 'All Store Categories' : 'جميع أقسام وتصنيفات المتجر'}
    >
      <div className="full-bleed storefront-cat-modal-root" dir={dir} style={{ direction: dir }}>
        {/* Top Header Bar: Luxury Rounded & Integrated */}
        <div className="storefront-cat-modal-header">
          {/* Title Area */}
          <div className="storefront-cat-modal-header-brand">
            <div>
              <h2 style={{ margin: 0, fontSize: '14.5px', fontWeight: 700, color: '#0f172a', lineHeight: 1.3, letterSpacing: '-0.1px' }}>
                {isEn ? 'Browse Store Categories' : 'تصفح أقسام المتجر'}
              </h2>
              <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>
                {isEn
                  ? `${categories.length} ${categories.length === 1 ? 'verified category' : 'verified categories'}`
                  : categories.length === 1
                    ? 'قسم وتصنيف معتمد'
                    : categories.length === 2
                      ? 'قسمان وتصنيفان معتمدان'
                      : categories.length <= 10
                        ? `${categories.length} أقسام وتصنيفات معتمدة`
                        : `${categories.length} قسماً وتصنيفاً معتمداً`}
              </span>
            </div>
          </div>

          {/* Quick Filter Search Input */}
          <div className="storefront-cat-modal-search-box">
            <input
              type="text"
              value={modalSearch}
              onChange={(e) => setModalSearch(e.target.value)}
              placeholder={isEn ? 'Search for a category or brand...' : 'ابحث عن اسم القسم أو الماركة...'}
              style={{
                width: '100%',
                height: '36px',
                padding: isEn ? '6px 12px 6px 36px' : '6px 36px 6px 12px',
                borderRadius: '11px',
                border: '1px solid #e2e8f0',
                fontSize: '12px',
                fontWeight: 500,
                color: '#0f172a',
                background: '#f8fafc',
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'all 0.18s ease',
              }}
              onFocus={(e) => {
                e.target.style.borderColor = 'var(--storefront-primary-color, #2d68c4)';
                e.target.style.background = '#ffffff';
                e.target.style.boxShadow = '0 0 0 3px rgba(45, 104, 196, 0.1)';
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
              <IconSearch size={14} color="#64748b" />
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
                  padding: '2px 7px',
                  color: '#334155',
                  cursor: 'pointer',
                  fontSize: '10.5px',
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

        {/* Mobile Horizontal Tabs Row (Visible only on <= 640px) */}
        <div className="storefront-cat-modal-mobile-tabs">
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
              onSelectCategory('all');
              onClose();
            }}
            className={`storefront-cat-modal-chip ${selectedCategoryId === 'all' ? 'active' : ''}`}
            title={isEn ? 'View all store items without filtering' : 'عرض جميع أصناف المتجر بدون فلترة'}
          >
            <IconShoppingBag size={12} strokeWidth={2.2} />
            <span>{isEn ? 'All' : 'الكل'}</span>
            <span className="storefront-cat-modal-chip-badge">{totalAllCount}</span>
          </button>

          {hasMultipleFamilies
            ? groupedFamilies.map((fam) => {
                const isActive = !modalSearch.trim() && activeGroup === fam.groupName;
                return (
                  <button
                    key={fam.groupName}
                    type="button"
                    onClick={(e) => {
                      e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
                      setModalSearch('');
                      setActiveGroup(fam.groupName);
                    }}
                    className={`storefront-cat-modal-chip ${isActive ? 'active' : ''}`}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                      {getFamilyIcon(fam.groupName, 12)}
                    </span>
                    <span>{fam.groupName}</span>
                    <span className="storefront-cat-modal-chip-badge">{fam.categories.length}</span>
                  </button>
                );
              })
            : categories.map((cat) => {
                const isActive = selectedCategoryId === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={(e) => {
                      e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
                      onSelectCategory(cat.id);
                      onClose();
                    }}
                    className={`storefront-cat-modal-chip ${isActive ? 'active' : ''}`}
                  >
                    <span>{cat.name}</span>
                    <span className="storefront-cat-modal-chip-badge">{categoryCounts.get(cat.id) || 0}</span>
                  </button>
                );
              })}
        </div>

        {/* Main Two-Column Split Panel Body */}
        <div className="storefront-cat-modal-body">
          {/* Sidebar: Master Category Navigation with Visual Thumbnails */}
          <div className="storefront-cat-modal-sidebar">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {/* Master Item: All Products Button */}
              <button
                type="button"
                onClick={() => {
                  onSelectCategory('all');
                  onClose();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: '16px',
                  border:
                    selectedCategoryId === 'all'
                      ? '1.5px solid var(--storefront-primary-color, #2d68c4)'
                      : '1px solid #e2e8f0',
                  background:
                    selectedCategoryId === 'all'
                      ? 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)'
                      : '#ffffff',
                  color: '#0f172a',
                  cursor: 'pointer',
                  textAlign: isEn ? 'left' : 'right',
                  transition: 'all 0.18s ease',
                  marginBottom: '4px',
                  boxShadow:
                    selectedCategoryId === 'all'
                      ? '0 4px 14px rgba(45, 104, 196, 0.14)'
                      : '0 2px 6px rgba(15, 23, 42, 0.03)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--storefront-primary-color, #2d68c4)';
                  e.currentTarget.style.transform = isEn ? 'translateX(2px)' : 'translateX(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor =
                    selectedCategoryId === 'all' ? 'var(--storefront-primary-color, #2d68c4)' : '#e2e8f0';
                  e.currentTarget.style.transform = 'translateX(0)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '11px',
                      background: 'var(--storefront-primary-color, #2d68c4)',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      boxShadow: '0 3px 8px rgba(45, 104, 196, 0.28)',
                    }}
                  >
                    <IconShoppingBag size={16} color="#ffffff" strokeWidth={2.2} />
                  </div>
                  <span style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>
                    {isEn ? 'All Products' : 'جميع المنتجات'}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 800,
                    color: 'var(--storefront-primary-color, #2d68c4)',
                    background: '#ffffff',
                    border: '1px solid #bfdbfe',
                    padding: '2px 8px',
                    borderRadius: '8px',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {totalAllCount}
                </span>
              </button>

              {/* Sidebar Section Divider */}
              <div
                style={{
                  fontSize: '11.5px',
                  fontWeight: 800,
                  color: '#64748b',
                  padding: '4px 8px 2px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px',
                }}
              >
                <span
                  style={{
                    width: '4px',
                    height: '12px',
                    backgroundColor: 'var(--storefront-primary-color, #2d68c4)',
                    borderRadius: '4px',
                    display: 'inline-block',
                  }}
                />
                <span>{isEn ? 'Store Categories' : 'فئات وأقسام المتجر'}</span>
              </div>

              {/* Category Families or Categories List with Real Mini Product Thumbnails */}
              {hasMultipleFamilies
                ? groupedFamilies.map((fam) => {
                    const isActive = !modalSearch.trim() && activeGroup === fam.groupName;
                    const repCat = fam.categories[0];
                    const thumbUrl = repCat ? getCategoryPhoto(repCat) : '';
                    return (
                      <button
                        key={fam.groupName}
                        type="button"
                        onClick={() => {
                          setModalSearch('');
                          setActiveGroup(fam.groupName);
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.background = '#ffffff';
                            e.currentTarget.style.borderColor = '#e2e8f0';
                            e.currentTarget.style.transform = isEn ? 'translateX(2px)' : 'translateX(-2px)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.borderColor = 'transparent';
                            e.currentTarget.style.transform = 'translateX(0)';
                          }
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 10px',
                          borderRadius: '14px',
                          border: isActive
                            ? '1.5px solid var(--storefront-primary-color, #2d68c4)'
                            : '1px solid transparent',
                          background: isActive ? '#ffffff' : 'transparent',
                          color: isActive ? 'var(--storefront-primary-color, #2d68c4)' : '#1e293b',
                          cursor: 'pointer',
                          textAlign: isEn ? 'left' : 'right',
                          transition: 'all 0.16s ease',
                          boxShadow: isActive ? '0 4px 12px rgba(15, 23, 42, 0.06)' : 'none',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                          <div
                            style={{
                              width: '34px',
                              height: '34px',
                              borderRadius: '10px',
                              background: '#f4f6fa',
                              border: '1px solid #edf1f7',
                              padding: '3px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                              boxSizing: 'border-box',
                            }}
                          >
                            {thumbUrl ? (
                              <img
                                src={thumbUrl}
                                alt={fam.groupName}
                                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                              />
                            ) : (
                              getFamilyIcon(fam.groupName)
                            )}
                          </div>
                          <span
                            style={{
                              fontSize: '13px',
                              fontWeight: isActive ? 800 : 700,
                              lineHeight: 1.3,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {fam.groupName}
                          </span>
                        </div>

                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 800,
                            padding: '2px 7px',
                            borderRadius: '8px',
                            background: isActive ? '#eff6ff' : '#e2e8f0',
                            color: isActive ? 'var(--storefront-primary-color, #2d68c4)' : '#475569',
                            flexShrink: 0,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {fam.categories.length}
                        </span>
                      </button>
                    );
                  })
                : categories.map((cat) => {
                    const count = categoryCounts.get(cat.id) || 0;
                    const isActive = selectedCategoryId === cat.id;
                    const thumbUrl = getCategoryPhoto(cat);
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => {
                          onSelectCategory(cat.id);
                          onClose();
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.background = '#ffffff';
                            e.currentTarget.style.borderColor = '#e2e8f0';
                            e.currentTarget.style.boxShadow = '0 3px 10px rgba(15, 23, 42, 0.04)';
                            e.currentTarget.style.transform = isEn ? 'translateX(2px)' : 'translateX(-2px)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.borderColor = 'transparent';
                            e.currentTarget.style.boxShadow = 'none';
                            e.currentTarget.style.transform = 'translateX(0)';
                          }
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '7px 10px',
                          borderRadius: '14px',
                          border: isActive
                            ? '1.5px solid var(--storefront-primary-color, #2d68c4)'
                            : '1px solid transparent',
                          background: isActive ? '#ffffff' : 'transparent',
                          color: isActive ? 'var(--storefront-primary-color, #2d68c4)' : '#1e293b',
                          cursor: 'pointer',
                          textAlign: isEn ? 'left' : 'right',
                          transition: 'all 0.16s ease',
                          boxShadow: isActive ? '0 4px 12px rgba(45, 104, 196, 0.1)' : 'none',
                          gap: '8px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                          <div
                            style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '11px',
                              background: '#ffffff',
                              border: isActive ? '1px solid #bfdbfe' : '1px solid #e2e8f0',
                              padding: '3px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                              boxSizing: 'border-box',
                              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
                            }}
                          >
                            <img
                              src={thumbUrl}
                              alt={cat.name}
                              loading="lazy"
                              decoding="async"
                              onError={(e) => {
                                e.currentTarget.src = generatePremiumProductSvg(cat.name, cat.name);
                              }}
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'contain',
                              }}
                            />
                          </div>
                          <span
                            style={{
                              fontSize: '12.5px',
                              fontWeight: isActive ? 800 : 700,
                              lineHeight: 1.35,
                              color: isActive ? 'var(--storefront-primary-color, #2d68c4)' : '#1e293b',
                            }}
                          >
                            {cat.name}
                          </span>
                        </div>

                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 800,
                            padding: '2px 7px',
                            borderRadius: '8px',
                            background: isActive ? '#eff6ff' : '#e2e8f0',
                            color: isActive ? 'var(--storefront-primary-color, #2d68c4)' : '#475569',
                            flexShrink: 0,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
            </div>
          </div>

          {/* Detail Panel: Luxury Squircle Category Cards Grid */}
          <div className="storefront-cat-modal-content">
            {/* Active Group Header Bar */}
            <div className={`storefront-cat-modal-content-header ${!modalSearch.trim() ? 'is-default-header' : ''}`}>
              <div style={{ minWidth: 0 }}>
                <h3
                  style={{
                    margin: 0,
                    fontSize: '14px',
                    fontWeight: 700,
                    color: '#0f172a',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '7px',
                    lineHeight: 1.3,
                  }}
                >
                  <span
                    style={{
                      width: '3.5px',
                      height: '14px',
                      backgroundColor: 'var(--storefront-primary-color, #2d68c4)',
                      borderRadius: '4px',
                      display: 'inline-block',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {modalSearch.trim()
                      ? isEn
                        ? `Search results for "${modalSearch}"`
                        : `نتائج البحث عن «${modalSearch}»`
                      : hasMultipleFamilies
                        ? activeGroup
                        : isEn
                          ? 'Store Categories & Departments'
                          : 'أقسام وتصنيفات المتجر'}
                  </span>
                </h3>
                <span
                  style={{
                    fontSize: '11px',
                    color: '#64748b',
                    fontWeight: 500,
                    marginTop: '2px',
                    display: 'block',
                  }}
                >
                  {modalSearch.trim() ? (
                    isEn
                      ? `Found ${displayedCategories.length} matching ${displayedCategories.length === 1 ? 'category' : 'categories'}`
                      : `تم العثور على ${displayedCategories.length} قسماً مطابقاً للبحث`
                  ) : (
                    <>
                      <span>
                        {isEn ? 'Select a category to browse its products' : 'اختر القسم لتصفح الأصناف المعروضة'}
                      </span>{' '}
                      <span style={{ whiteSpace: 'nowrap' }}>
                        ({displayedCategories.length} {isEn ? 'available)' : 'متاح)'}
                      </span>
                    </>
                  )}
                </span>
              </div>

              {!modalSearch.trim() && currentFamilyObj && (
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#334155',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    padding: '4px 10px',
                    borderRadius: '8px',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {isEn ? `Total ${currentFamilyObj.totalCount} items` : `إجمالي ${currentFamilyObj.totalCount} صنف`}
                </span>
              )}
            </div>

            {/* Grid of Categories - Matching Storefront Quick Tiles & Luxury Product Cards */}
            {displayedCategories.length > 0 ? (
              <div className={`storefront-cat-modal-grid ${displayedCategories.length === 5 ? 'five-cols' : ''}`}>
                {displayedCategories.map((cat) => {
                  const count = categoryCounts.get(cat.id) || 0;
                  const isSelected = selectedCategoryId === cat.id;
                  const parsed = parseCategory(cat.name, isEn);
                  const photoUrl = getCategoryPhoto(cat);

                  return (
                    <div
                      key={cat.id}
                      onClick={() => {
                        onSelectCategory(cat.id);
                        onClose();
                      }}
                      className={`storefront-cat-modal-card ${isSelected ? 'selected' : ''}`}
                    >
                      {/* Category Title: Clean, refined 2-line wrap */}
                      <div
                        style={{
                          width: '100%',
                          textAlign: 'center',
                          paddingInline: '2px',
                        }}
                      >
                        <div
                          className="storefront-cat-modal-card-title"
                          style={{
                            fontSize: '12px',
                            fontWeight: 600,
                            color: isSelected ? 'var(--storefront-primary-color, #2d68c4)' : '#0f172a',
                            lineHeight: 1.32,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            height: '32px',
                            minHeight: '32px',
                            whiteSpace: 'normal',
                            textAlign: 'center',
                            wordBreak: 'break-word',
                          }}
                          title={cat.name}
                        >
                          {parsed.label}
                        </div>

                        {modalSearch.trim() && parsed.group && (
                          <div
                            style={{
                              fontSize: '10px',
                              fontWeight: 500,
                              color: '#64748b',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              marginTop: '2px',
                            }}
                          >
                            {parsed.group}
                          </div>
                        )}
                      </div>

                      {/* Soft Studio Rounded Image Container (Uncropped object-fit: contain) */}
                      <div className="storefront-cat-modal-card-img-box">
                        <img
                          className="storefront-cat-modal-card-img"
                          src={photoUrl}
                          alt={cat.name}
                          loading="lazy"
                          decoding="async"
                          onError={(e) => {
                            e.currentTarget.src = generatePremiumProductSvg(cat.name, cat.name);
                          }}
                        />
                      </div>

                      {/* Bottom Clean Unified Count Badge (Soft Squircle) */}
                      <div style={{ textAlign: 'center', width: '100%' }}>
                        <span
                          className="storefront-cat-modal-card-count"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px',
                            background: isSelected ? 'var(--storefront-primary-color, #2d68c4)' : '#f8fafc',
                            color: isSelected ? '#ffffff' : '#475569',
                            border: `1px solid ${isSelected ? 'var(--storefront-primary-color, #2d68c4)' : '#e2e8f0'}`,
                            fontSize: '10px',
                            fontWeight: 600,
                            lineHeight: 1.25,
                            padding: '2.5px 10px',
                            borderRadius: '7px',
                            whiteSpace: 'nowrap',
                            boxShadow: '0 1px 2px rgba(15, 23, 42, 0.02)',
                          }}
                        >
                          <span>{formatCountLabel(count)}</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: '#64748b',
                  textAlign: 'center',
                  padding: '20px',
                }}
              >
                <IconFolder size={40} color="#cbd5e1" style={{ marginBottom: '10px' }} />
                <div style={{ fontSize: '14.5px', fontWeight: 800, color: '#334155' }}>
                  {isEn ? `No categories match "${modalSearch}"` : `لا توجد أقسام تطابق «${modalSearch}»`}
                </div>
                <div style={{ fontSize: '12px', marginTop: '4px', color: '#94a3b8' }}>
                  {isEn
                    ? 'Please check the spelling or click "Clear" to view all categories.'
                    : 'تأكد من كتابة الكلمة بشكل صحيح أو اضغط على «مسح» للعودة.'}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </DialogShell>
  );
}
