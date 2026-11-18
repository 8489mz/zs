// Filter rows — the daypart, category and quick-filter chip rows under the
// toolbar. Pure move; the panel keeps all state and mounts these components
// inside its own gating conditionals.

import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import type { PosGroupShelf } from '@/features/pos/lib/pos-product-groups';
import type { Product } from '@/types/domain';
import type { PosCardDensity } from '@/features/pos/types/pos.types';

export interface PosDaypartRowProps {
  activeDaypart: 'all' | 'breakfast' | 'lunch' | 'dinner' | 'beverages';
  setActiveDaypart: Dispatch<SetStateAction<'all' | 'breakfast' | 'lunch' | 'dinner' | 'beverages'>>;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
}

export function PosDaypartRow({ activeDaypart, setActiveDaypart, setSelectedIndex }: PosDaypartRowProps) {
  const { t } = useTranslation();
  return (
    <div
      className="filter-chip-row pos-filter-row-compact pos-filter-row-single"
      style={{
        gap: '6px',
        marginTop: '8px',
        display: 'flex',
        flexWrap: 'nowrap',
        overflowX: 'auto',
        paddingBottom: '2px',
      }}
    >
      {[
        { id: 'all', label: t('pos.pos_products_panel.s0', "جميع الوجبات") },
        { id: 'breakfast', label: t('pos.pos_products_panel.s1', "الفطور الصباحي") },
        { id: 'lunch', label: t('pos.pos_products_panel.s2', "وجبات الغداء") },
        { id: 'dinner', label: t('pos.pos_products_panel.s3', "وجبات العشاء") },
        { id: 'beverages', label: t('pos.pos_products_panel.s4', "الحلويات والمشروبات") },
      ].map((dp) => (
        <button
          key={dp.id}
          type="button"
          onClick={() => {
            setActiveDaypart(dp.id as any);
            setSelectedIndex(0);
          }}
          style={{
            padding: '5px 12px',
            fontSize: '12px',
            borderRadius: '7px',
            border: activeDaypart === dp.id ? '1px solid #170e5e' : '1px solid #cbd5e1',
            background: activeDaypart === dp.id ? '#170e5e' : '#ffffff',
            color: activeDaypart === dp.id ? '#ffffff' : '#334155',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            fontWeight: 700,
            boxSizing: 'border-box',
          }}
        >
          {dp.label}
        </button>
      ))}
    </div>
  );
}

export interface PosCategoryTilesProps {
  categories: any[];
  selectedCategoryId: string | null;
  setSelectedCategoryId: ((value: string | null) => void) | Dispatch<SetStateAction<string | null>>;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
  isMobile: boolean;
}

export function PosCategoryTiles({ categories, selectedCategoryId, setSelectedCategoryId, setSelectedIndex, isMobile }: PosCategoryTilesProps) {
  const { t } = useTranslation();
  return (
    <div
      className="filter-chip-row pos-filter-row-compact pos-filter-row-single"
      style={{ gap: '6px', marginTop: isMobile ? '6px' : '10px', display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: '3px' }}
      onWheel={(e) => {
        if (e.deltaY !== 0) {
          e.currentTarget.scrollLeft += e.deltaY;
        }
      }}
    >
      <button
        type="button"
        onClick={() => {
          setSelectedCategoryId(null);
          setSelectedIndex(0);
        }}
        style={{
          padding: isMobile ? '4px 11px' : '6px 14px',
          fontSize: isMobile ? '12px' : '13px',
          borderRadius: '7px',
          border: selectedCategoryId === null ? '1px solid #0f172a' : '1px solid #cbd5e1',
          background: selectedCategoryId === null ? '#0f172a' : '#ffffff',
          color: selectedCategoryId === null ? '#ffffff' : '#334155',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          userSelect: 'none',
          fontWeight: 700,
          transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
        }}
      >
        {t('pos.all_categories', 'كل الأقسام')}
      </button>
      {categories.map(cat => (
        <button
          key={cat.id}
          type="button"
          onClick={() => {
            setSelectedCategoryId(cat.id);
            setSelectedIndex(0);
          }}
          style={{
            padding: isMobile ? '4px 11px' : '6px 14px',
            fontSize: isMobile ? '12px' : '13px',
            borderRadius: '7px',
            border: selectedCategoryId === String(cat.id) ? '1px solid #0f172a' : '1px solid #cbd5e1',
            background: selectedCategoryId === String(cat.id) ? '#0f172a' : '#ffffff',
            color: selectedCategoryId === String(cat.id) ? '#ffffff' : '#334155',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            userSelect: 'none',
            fontWeight: 700,
            transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
          }}
        >
          {cat.name}
        </button>
      ))}
    </div>
  );
}

export interface PosQuickFilterRowProps {
  shelf: PosGroupShelf;
  setShelf: Dispatch<SetStateAction<PosGroupShelf>>;
  productFilter: 'all' | 'offers' | 'priced' | 'low' | 'recent' | 'raw_materials' | 'services';
  onProductFilterChange: (value: 'all' | 'offers' | 'priced' | 'low' | 'recent' | 'raw_materials' | 'services') => void;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
  products: Product[];
  cardDensity: PosCardDensity;
  setCardDensityMode: (mode: PosCardDensity) => void;
  setIsStudioOpen: Dispatch<SetStateAction<boolean>>;
  isMobile: boolean;
}

export function PosQuickFilterRow({ shelf, setShelf, productFilter, onProductFilterChange, setSelectedIndex, products, cardDensity, setCardDensityMode, setIsStudioOpen, isMobile }: PosQuickFilterRowProps) {
  const { t } = useTranslation();
  return (
    <div
      className="filter-chip-row pos-filter-row-compact pos-filter-row-single"
      style={{ gap: '6px', marginTop: '6px', display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: '4px' }}
      onWheel={(e) => {
        if (e.deltaY !== 0) {
          e.currentTarget.scrollLeft += e.deltaY;
        }
      }}
    >
      <button
        type="button"
        onClick={() => {
          setShelf('all');
          onProductFilterChange('all');
          setSelectedIndex(0);
        }}
        style={{
          padding: isMobile ? '3.5px 9px' : '5px 12px',
          fontSize: isMobile ? '11.5px' : '12px',
          borderRadius: '6px',
          border: shelf === 'all' && productFilter === 'all' ? '1px solid #0f172a' : '1px solid #cbd5e1',
          background: shelf === 'all' && productFilter === 'all' ? '#0f172a' : '#ffffff',
          color: shelf === 'all' && productFilter === 'all' ? '#ffffff' : '#334155',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          fontWeight: shelf === 'all' && productFilter === 'all' ? 'bold' : '500',
        }}
      >
        {t('common.all', 'الكل')}
      </button>
      <button
        type="button"
        onClick={() => {
          setShelf('favorites');
          onProductFilterChange('all');
          setSelectedIndex(0);
        }}
        style={{
          padding: isMobile ? '3.5px 9px' : '5px 12px',
          fontSize: isMobile ? '11.5px' : '12px',
          borderRadius: '6px',
          border: shelf === 'favorites' ? '1px solid #0f172a' : '1px solid #cbd5e1',
          background: shelf === 'favorites' ? '#0f172a' : '#ffffff',
          color: shelf === 'favorites' ? '#ffffff' : '#334155',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          fontWeight: shelf === 'favorites' ? 'bold' : '500',
        }}
      >
        {t('pos.pos_products_panel.s5', "المفضلة")}
      </button>
      <button
        type="button"
        onClick={() => {
          onProductFilterChange('offers');
          setShelf('all');
          setSelectedIndex(0);
        }}
        style={{
          padding: isMobile ? '3.5px 9px' : '5px 12px',
          fontSize: isMobile ? '11.5px' : '12px',
          borderRadius: '6px',
          border: productFilter === 'offers' ? '1px solid #0f172a' : '1px solid #cbd5e1',
          background: productFilter === 'offers' ? '#0f172a' : '#ffffff',
          color: productFilter === 'offers' ? '#ffffff' : '#334155',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          fontWeight: productFilter === 'offers' ? 'bold' : '500',
        }}
      >
        {t('pos.pos_products_panel.s6', "بعروض")}
      </button>
      <button
        type="button"
        onClick={() => {
          setShelf('recent');
          onProductFilterChange('all');
          setSelectedIndex(0);
        }}
        style={{
          padding: isMobile ? '3.5px 9px' : '5px 12px',
          fontSize: isMobile ? '11.5px' : '12px',
          borderRadius: '6px',
          border: shelf === 'recent' ? '1px solid #0f172a' : '1px solid #cbd5e1',
          background: shelf === 'recent' ? '#0f172a' : '#ffffff',
          color: shelf === 'recent' ? '#ffffff' : '#334155',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          fontWeight: shelf === 'recent' ? 'bold' : '500',
        }}
      >
        {t('pos.pos_products_panel.s7', "آخر استخدام")}
      </button>
      {(productFilter === 'raw_materials' || products.some((p) => p.itemType === 'raw_material')) ? (
        <button
          type="button"
          onClick={() => {
            onProductFilterChange('raw_materials');
            setShelf('all');
            setSelectedIndex(0);
          }}
          style={{
            padding: isMobile ? '3.5px 9px' : '5px 12px',
            fontSize: isMobile ? '11.5px' : '12px',
            borderRadius: '6px',
            border: productFilter === 'raw_materials' ? '1px solid #0f172a' : '1px solid #cbd5e1',
            background: productFilter === 'raw_materials' ? '#0f172a' : '#ffffff',
            color: productFilter === 'raw_materials' ? '#ffffff' : '#334155',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            fontWeight: productFilter === 'raw_materials' ? 'bold' : '500',
          }}
        >
          {t('pos.pos_products_panel.s8', "مواد خام")}
        </button>
      ) : null}

      {/* View Mode Segmented Controls */}
      <div
        style={{
          marginInlineStart: 'auto',
          display: 'inline-flex',
          alignItems: 'center',
          background: '#f8fafc',
          borderRadius: '8px',
          padding: '2px',
          border: '1px solid #cbd5e1',
          gap: '2px',
        }}
      >
        <button
          type="button"
          onClick={() => setCardDensityMode('gallery')}
          style={{
            padding: '3px 8px',
            fontSize: '11px',
            borderRadius: '6px',
            border: 'none',
            background: cardDensity === 'gallery' ? '#170e5e' : 'transparent',
            color: cardDensity === 'gallery' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
          title={t('pos.pos_products_panel.gallery_title', "معرض صور المنتجات (صور فوتوغرافية بارزة)")}
        >
          {t('pos.pos_products_panel.gallery_btn', "معرض الصور")}
        </button>
        <button
          type="button"
          onClick={() => setCardDensityMode('comfortable')}
          style={{
            padding: '3px 8px',
            fontSize: '11px',
            borderRadius: '6px',
            border: 'none',
            background: cardDensity === 'comfortable' ? '#170e5e' : 'transparent',
            color: cardDensity === 'comfortable' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
          title={t('pos.pos_products_panel.comfortable_title', "كروت موسعة اعتيادية")}
        >
          {t('pos.pos_products_panel.comfortable_btn', "كروت موسعة")}
        </button>
        <button
          type="button"
          onClick={() => setCardDensityMode('compact')}
          style={{
            padding: '3px 8px',
            fontSize: '11px',
            borderRadius: '6px',
            border: 'none',
            background: cardDensity === 'compact' ? '#170e5e' : 'transparent',
            color: cardDensity === 'compact' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
          title={t('pos.pos_products_panel.compact_title', "كروت مضغوطة مدمجة")}
        >
          {t('pos.pos_products_panel.compact_btn', "كروت مضغوطة")}
        </button>
      </div>

      {/* Icon Theme Studio Button */}
      <button
        type="button"
        onClick={() => setIsStudioOpen(true)}
        title={t('pos.pos_products_panel.s13', "تخصيص ألوان ومظهر أيقونات الأصناف")}
        style={{
          padding: '4px 9px',
          fontSize: '11px',
          borderRadius: '7px',
          border: '1px solid #cbd5e1',
          background: '#ffffff',
          color: '#334155',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          fontWeight: 700,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <span>{t('pos.pos_products_panel.s14', "الأيقونات")}</span>
      </button>
    </div>
  );
}
