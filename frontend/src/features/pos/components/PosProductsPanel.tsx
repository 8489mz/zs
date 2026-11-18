import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { StarIcon, PlusIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrencyWithCode } from '@/lib/format';
import { sharedProductsApi } from '@/shared/api/products';
import { buildPosProductGroups, buildRecentGroupKeys, getGroupShelfGroups, type PosGroupShelf, type PosProductGroup } from '@/features/pos/lib/pos-product-groups';
import { isPosModalOpen } from '@/features/pos/lib/pos-keyboard-safety';
import type { Product } from '@/types/domain';
import type { PosCardDensity, PosPriceType, PosProductGroupCardProps } from '@/features/pos/types/pos.types';
import type { PosSaleMode } from '@/features/pos/lib/pos-sale-mode';
import { ProductIcon } from '@/shared/components/icons/product-svg-catalog';
import { ProductIconStudioModal } from '@/shared/components/icons/ProductIconStudioModal';
import { useProductIconSettings } from '@/shared/components/icons/product-icon-theme';
import { getBarcodeLookupCandidates, isInvoiceBarcodeQuery, sanitizeSearchInputLive } from '@/features/pos/lib/pos-barcode-normalizer';
import { isAutoSubmittableWeightedBarcode } from '@/features/pos/lib/weighted-barcode';
import { useScannerBuffer } from '@/features/pos/hooks/useScannerBuffer';
import { CameraBarcodeScannerModal } from '@/shared/components/CameraBarcodeScannerModal';
import { useIsMobile } from '@/shared/hooks/use-is-mobile';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { usePosUiCustomization } from '@/features/pos/hooks/usePosUiCustomization';
import { useCachedT } from '@/features/pos/lib/cached-t';
import { PosCustomizationDialog } from '@/features/pos/components/pos-workspace/PosCustomizationDialog';
import { isNegativeStockSalesAllowed, isServiceProduct } from '@/features/pos/lib/pos.domain';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits } from '@/shared/utils/money';
import { toast } from '@/shared/components/system-alert';
import { PosProductGroupCardGallery } from '@/features/pos/components/pos-products/PosProductGroupCardGallery';
import { InlineGroupPicker } from '@/features/pos/components/pos-products/InlineGroupPicker';
import { PosProductGroupCardComfortable } from '@/features/pos/components/pos-products/PosProductGroupCardComfortable';
import { PosProductGroupCardCompact } from '@/features/pos/components/pos-products/PosProductGroupCardCompact';
import { PosProductsToolbar } from '@/features/pos/components/pos-products/PosProductsToolbar';
import { PosDaypartRow, PosCategoryTiles, PosQuickFilterRow } from '@/features/pos/components/pos-products/PosProductsFilterRows';

interface PosProductsPanelProps {
  search: string;
  onSearchChange: (value: string) => void;
  onSearchSubmitFirstResult: (rawQuery?: string) => boolean;
  priceType: PosPriceType;
  onPriceTypeChange: (value: PosPriceType) => void;
  // INV-VAN-PRICE-LIST-WIRING: true while a customer is selected —
  // the tier toggle is locked and shows the derived tier display-only.
  isPriceTypeLocked?: boolean;
  products: Product[];
  recentProducts: Product[];
  onAddProduct: (product: Product) => void;
  productFilter: 'all' | 'offers' | 'priced' | 'low' | 'recent' | 'raw_materials' | 'services';
  onProductFilterChange: (value: 'all' | 'offers' | 'priced' | 'low' | 'recent' | 'raw_materials' | 'services') => void;
  selectedCategoryId?: string | null;
  onSelectedCategoryIdChange?: (value: string | null) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  posMode: PosSaleMode;
  onOpenNewProduct?: (params: { name?: string; barcode?: string }) => void;
  restaurantModuleEnabled?: boolean;
}

const favoritesStorageKey = 'pos-group-favorites-v2';
const cardDensityStorageKey = 'pos-card-density-preference-v2';
const cardDensityDesktopKey = 'pos-card-density-desktop-v1';
const cardDensityMobileKey = 'pos-card-density-mobile-v1';
const touchModeVisibleStep = 60;

function readCardDensityPreference(fallback: PosCardDensity = 'comfortable', isMobileDevice = false): PosCardDensity {
  if (typeof window === 'undefined') return fallback;
  try {
    const key = isMobileDevice ? cardDensityMobileKey : cardDensityDesktopKey;
    const val = window.localStorage.getItem(key);
    if (val === 'compact' || val === 'comfortable' || val === 'gallery') return val as PosCardDensity;
    if (fallback) return fallback;
    const legacy = window.localStorage.getItem(cardDensityStorageKey) || window.localStorage.getItem('pos-card-density-preference-v1');
    if (legacy === 'compact' || legacy === 'comfortable' || legacy === 'gallery') return legacy as PosCardDensity;
  } catch {}
  return fallback;
}

function readFavoriteKeys() {
  if (typeof window === 'undefined') return [] as string[];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(favoritesStorageKey) || '[]');
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [] as string[];
  }
}

function groupMetaLabel(group: PosProductGroup) {
  if (!group.hasVariants) {
    const directProduct = group.products[0];
    return directProduct?.barcode ? `باركود: ${directProduct.barcode}` : 'إضافة مباشرة';
  }
  const parts: string[] = [];
  if (group.colors.length) {
    const sample = group.colors.slice(0, 3).join('، ');
    const more = group.colors.length > 3 ? '...' : '';
    parts.push(`${group.colors.length} ألوان: ${sample}${more}`);
  }
  if (group.sizes.length) {
    const sample = group.sizes.slice(0, 3).join('، ');
    const more = group.sizes.length > 3 ? '...' : '';
    parts.push(`${group.sizes.length} مقاسات: ${sample}${more}`);
  }
  if (!parts.length) {
    parts.push(`${group.products.length} خيارات`);
  }
  return parts.join(' • ');
}

function focusSearchInput(searchInputRef: RefObject<HTMLInputElement | null>) {
  if (typeof window === 'undefined') return;
  if (window.matchMedia('(pointer: coarse)').matches) return;
  if (isPosModalOpen()) return;
  window.requestAnimationFrame(() => {
    if (isPosModalOpen()) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  });
}

function hasExactCodeMatch(products: Product[], query: string) {
  const candidates = getBarcodeLookupCandidates(query).map((c) => c.toLowerCase());
  if (!candidates.length) return false;
  return candidates.some((candidate) =>
    products.some((product) =>
      product.barcode?.trim().toLowerCase() === candidate ||
      product.sku?.trim().toLowerCase() === candidate ||
      product.units?.some((unit) => unit.barcode?.trim().toLowerCase() === candidate),
    ),
  );
}

// Memoized product-grid card. Every prop is a primitive, a stable ref object,
// or a stable callback, so a card skips re-rendering when the panel
// re-renders for any reason that leaves this card's data unchanged (new
// `products` array identity, search keystrokes, selection moves, another
// card's favorite toggle). The JSX below is the panel's former inline card
// body, moved verbatim; only the closed-over values became props.
function PosProductGroupCardComponent({
  groupKey,
  index,
  title,
  hasVariants,
  variantCount,
  minPrice,
  maxPrice,
  totalStock,
  itemKind,
  imageUrl,
  iconName,
  metaLabel,
  isSelected,
  isFavorite,
  isOutOfStock,
  cardDensity,
  isMobile,
  mobileGridColumns,
  showCardIcon,
  cardRefs,
  onActivate,
  onToggleFavorite,
}: PosProductGroupCardProps) {
  const t = useCachedT();
  const priceLabel = minPrice === maxPrice
    ? formatCurrencyWithCode(minPrice)
    : `${formatCurrencyWithCode(minPrice)} - ${formatCurrencyWithCode(maxPrice)}`;

  if (cardDensity === 'gallery') {
    // Ultra-Clean Seamless Visual Card (Balanced Mobile & Touch Ergonomics)
    return (
      <PosProductGroupCardGallery
        groupKey={groupKey}
        index={index}
        title={title}
        hasVariants={hasVariants}
        variantCount={variantCount}
        minPrice={minPrice}
        maxPrice={maxPrice}
        totalStock={totalStock}
        itemKind={itemKind}
        imageUrl={imageUrl}
        iconName={iconName}
        metaLabel={metaLabel}
        isSelected={isSelected}
        isFavorite={isFavorite}
        isOutOfStock={isOutOfStock}
        cardDensity={cardDensity}
        isMobile={isMobile}
        mobileGridColumns={mobileGridColumns}
        showCardIcon={showCardIcon}
        cardRefs={cardRefs}
        onActivate={onActivate}
        onToggleFavorite={onToggleFavorite}
        priceLabel={priceLabel}
      />
    );
  }

  if (cardDensity === 'comfortable') {
    // Classic Comfortable Card (Default)
    return (
      <PosProductGroupCardComfortable
        groupKey={groupKey}
        index={index}
        title={title}
        hasVariants={hasVariants}
        variantCount={variantCount}
        minPrice={minPrice}
        maxPrice={maxPrice}
        totalStock={totalStock}
        itemKind={itemKind}
        imageUrl={imageUrl}
        iconName={iconName}
        metaLabel={metaLabel}
        isSelected={isSelected}
        isFavorite={isFavorite}
        isOutOfStock={isOutOfStock}
        cardDensity={cardDensity}
        isMobile={isMobile}
        mobileGridColumns={mobileGridColumns}
        showCardIcon={showCardIcon}
        cardRefs={cardRefs}
        onActivate={onActivate}
        onToggleFavorite={onToggleFavorite}
        priceLabel={priceLabel}
      />
    );
  }

  // Refined Soothing Compact Card
  return (
    <PosProductGroupCardCompact
      groupKey={groupKey}
      index={index}
      title={title}
      hasVariants={hasVariants}
      variantCount={variantCount}
      minPrice={minPrice}
      maxPrice={maxPrice}
      totalStock={totalStock}
      itemKind={itemKind}
      imageUrl={imageUrl}
      iconName={iconName}
      metaLabel={metaLabel}
      isSelected={isSelected}
      isFavorite={isFavorite}
      isOutOfStock={isOutOfStock}
      cardDensity={cardDensity}
      isMobile={isMobile}
      mobileGridColumns={mobileGridColumns}
      showCardIcon={showCardIcon}
      cardRefs={cardRefs}
      onActivate={onActivate}
      onToggleFavorite={onToggleFavorite}
      priceLabel={priceLabel}
    />
  );
}

const PosProductGroupCard = memo(PosProductGroupCardComponent);

function PosProductsPanelComponent({
  search,
  onSearchChange,
  onSearchSubmitFirstResult,
  priceType,
  onPriceTypeChange,
  isPriceTypeLocked,
  products,
  recentProducts,
  onAddProduct,
  productFilter,
  onProductFilterChange,
  selectedCategoryId: controlledSelectedCategoryId,
  onSelectedCategoryIdChange,
  searchInputRef,
  posMode,
  onOpenNewProduct,
  restaurantModuleEnabled,
}: PosProductsPanelProps) {
  const { t, i18n } = useTranslation();
  const isEn = Boolean(i18n.language && i18n.language.startsWith('en'));
  const isRtl = !isEn;
  // Scanner buffer: detects rapid barcode scanner input and batches it into a single
  // state update instead of triggering re-renders on every character.
  // Uses refs + direct DOM manipulation — ZERO React renders during scanning.
  const settingsQuery = useSettingsQuery();
  const scannerBuffer = useScannerBuffer({
    externalValue: search,
    onFlush: onSearchChange,
    onAutoSubmit: (val) => {
      const trimmed = val.trim();
      if (!trimmed) return false;
      if (hasExactCodeMatch(products, trimmed) || isInvoiceBarcodeQuery(trimmed) || isAutoSubmittableWeightedBarcode(trimmed, settingsQuery.data)) {
        return onSearchSubmitFirstResult(trimmed);
      }
      return false;
    },
    inputRef: searchInputRef,
    sanitize: sanitizeSearchInputLive,
    scanThresholdMs: 65,
    scanFlushMs: 75,
    typeFlushMs: 120,
  });
  const defaultLayoutFromSettings = settingsQuery.data?.posProductCardLayout;
  const { customization, saveCustomization } = usePosUiCustomization();
  const isMobile = useIsMobile(900);

  const allowNegativeStockSales = isNegativeStockSalesAllowed(settingsQuery.data);
  const shouldHideOutOfStock = !allowNegativeStockSales && Boolean(
    customization.hideOutOfStockItems || settingsQuery.data?.posHideOutOfStockItems
  );

  const isOutOfStockGroup = useCallback((group: PosProductGroup) => {
    if (allowNegativeStockSales) return false;
    const first = group.products[0];
    // INV-SERVICE-STOCK-NO-STOCK-CHECK (spice trial D02): the old test
    // read group.itemKind === 'service', but itemKind is only
    // standard|fashion — the service kind lives on the products'
    // itemType — so service groups fell through to totalStock <= 0
    // and the trial's grinding service showed "الصنف نافذ من المخزون".
    // Any member being a service exempts the whole group (a group never
    // mixes a service with a stocked product).
    const isService = group.products.some((entry) => isServiceProduct(entry));
    const hasBom = Boolean(first?.hasBom || (first as any)?.has_bom);
    if (isService || hasBom) return false;
    return typeof group.totalStock === 'number' && group.totalStock <= 0;
  }, [allowNegativeStockSales]);

  const [shelf, setShelf] = useState<PosGroupShelf>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [favoriteKeys, setFavoriteKeys] = useState<string[]>(readFavoriteKeys);
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null);
  const [touchVisibleCount, setTouchVisibleCount] = useState(touchModeVisibleStep);
  const activeLayoutTarget = isMobile
    ? (customization.mobileCardLayout || 'compact')
    : (customization.cardLayout || defaultLayoutFromSettings || 'comfortable');
  const [cardDensity, setCardDensity] = useState<PosCardDensity>(() =>
    readCardDensityPreference(activeLayoutTarget, isMobile)
  );

  const [isMobileKeyboardActive, setIsMobileKeyboardActive] = useState(false);

  const toggleMobileKeyboard = useCallback(() => {
    setIsMobileKeyboardActive((prev) => {
      const next = !prev;
      if (next) {
        setTimeout(() => {
          searchInputRef.current?.focus();
        }, 50);
      } else {
        searchInputRef.current?.blur();
      }
      return next;
    });
  }, [searchInputRef]);
  useEffect(() => {
    const target = isMobile
      ? (customization.mobileCardLayout || 'compact')
      : (customization.cardLayout || defaultLayoutFromSettings || 'comfortable');
    if (target) {
      setCardDensity(target);
    }
  }, [isMobile, customization.mobileCardLayout, customization.cardLayout, defaultLayoutFromSettings]);

  // If price tier toggle is hidden, ensure active price type matches defaultPriceType
  useEffect(() => {
    if (!customization.showPriceTierToggle && priceType !== customization.defaultPriceType) {
      onPriceTypeChange(customization.defaultPriceType);
    }
  }, [customization.showPriceTierToggle, customization.defaultPriceType, priceType, onPriceTypeChange]);

  const lastProductsScrollTopRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (typeof document !== 'undefined') {
        document.body.classList.remove('pos-scroll-hides-nav');
        document.body.classList.remove('mobile-nav-hidden');
      }
    };
  }, []);

  const groupRefs = useRef<Array<HTMLElement | null>>([]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  
  const setCardDensityMode = (mode: PosCardDensity) => {
    setCardDensity(mode);
    if (typeof window !== 'undefined') {
      try {
        const key = isMobile ? cardDensityMobileKey : cardDensityDesktopKey;
        window.localStorage.setItem(key, mode);
        window.localStorage.setItem(cardDensityStorageKey, mode);
      } catch {}
    }
    if (isMobile) {
      void saveCustomization({ mobileCardLayout: mode });
    } else {
      void saveCustomization({ cardLayout: mode });
    }
  };
  
  const categoriesQuery = useQuery({ queryKey: ['pos-categories'], queryFn: sharedProductsApi.categories, staleTime: 300000 });
  const categories: any[] = categoriesQuery.data || [];
  const iconSettings = useProductIconSettings();
  // INV-POS-CATEGORY-TILE-FILTER: the workspace owns the selected category
  // (it drives the server-side catalog lookup); when no controlled value is
  // provided the panel keeps its own local state. The client-side filter
  // below stays as a guard — the server already filtered by category.
  const [localSelectedCategoryId, setLocalSelectedCategoryId] = useState<string | null>(null);
  const selectedCategoryId = controlledSelectedCategoryId !== undefined ? controlledSelectedCategoryId : localSelectedCategoryId;
  const setSelectedCategoryId = onSelectedCategoryIdChange ?? setLocalSelectedCategoryId;
  const [isStudioOpen, setIsStudioOpen] = useState(false);
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);
  const [isCustomizationOpen, setIsCustomizationOpen] = useState(false);

  const handleCameraBarcodeScan = (scannedCode: string) => {
    if (searchInputRef.current) {
      searchInputRef.current.value = scannedCode;
    }
    scannerBuffer.flushNow(scannedCode);
    onSearchSubmitFirstResult(scannedCode);
  };

  const [activeDaypart, setActiveDaypart] = useState<'all' | 'breakfast' | 'lunch' | 'dinner' | 'beverages'>('all');

  const daypartFilteredProducts = useMemo(() => {
    if (!restaurantModuleEnabled || activeDaypart === 'all') {
      return products;
    }
    const kwMap: Record<string, RegExp> = {
      breakfast: /فطور|إفطار|صباح|بيض|فول|بانكيك|شاي|كرواسون|breakfast/i,
      lunch: /غداء|مشويات|شاورما|برجر|بيتزا|أرز|دجاج|لحم|lunch|burger/i,
      dinner: /عشاء|سهرة|سندوتش|فاهيتا|بيتزا|dinner/i,
      beverages: /عصير|مشروب|قهوة|كافيه|لاتيه|حلى|حلويات|آيسكريم|كيك|drink|coffee|dessert/i,
    };
    const reg = kwMap[activeDaypart];
    if (!reg) return products;
    const filtered = products.filter((p) => {
      const targetStr = `${p.name} ${p.categoryName || ''} ${(p as any).description || ''}`;
      return reg.test(targetStr);
    });
    return filtered.length > 0 ? filtered : products;
  }, [restaurantModuleEnabled, activeDaypart, products]);

  const categoryFilteredProducts = useMemo(() => {
    if (!selectedCategoryId) return daypartFilteredProducts;
    return daypartFilteredProducts.filter((p) => String(p.categoryId) === String(selectedCategoryId));
  }, [daypartFilteredProducts, selectedCategoryId]);

  const groupedProducts = useMemo(() => buildPosProductGroups(categoryFilteredProducts, priceType, currencyMoneyDigits(settingsQuery.data?.currency || getGlobalSystemCurrency())), [priceType, categoryFilteredProducts, settingsQuery.data?.currency]);
  const recentGroupKeys = useMemo(
    () => (shelf === 'recent' ? buildRecentGroupKeys(recentProducts, groupedProducts) : []),
    [groupedProducts, recentProducts, shelf]
  );
  const favoriteKeySet = useMemo(() => new Set(favoriteKeys), [favoriteKeys]);
  const deferredSearch = useDeferredValue(search);
  const scannerSearchQuery = deferredSearch.trim();
  const isScannerMode = posMode === 'scanner';
  const isTouchMode = posMode === 'touch';
  const hasBrowseFilter = productFilter !== 'all' || shelf !== 'all';
  const canShowScannerResults = !isScannerMode || isMobile || scannerSearchQuery.length >= 2 || hasBrowseFilter;
  const activeRecentKeys = shelf === 'recent' ? recentGroupKeys : undefined;
  const visibleGroups = useMemo(() => {
    const rawGroups = getGroupShelfGroups({
      groups: groupedProducts,
      shelf,
      favoriteKeys: favoriteKeySet,
      recentKeys: activeRecentKeys || [],
    });
    if (!shouldHideOutOfStock || scannerSearchQuery.length > 0) {
      return rawGroups;
    }
    return rawGroups.filter((group) => !isOutOfStockGroup(group));
  }, [favoriteKeySet, groupedProducts, activeRecentKeys, shelf, shouldHideOutOfStock, scannerSearchQuery, isOutOfStockGroup]);
  const visibleTouchGroupCount = Math.min(touchVisibleCount, visibleGroups.length);
  const displayedGroups = useMemo(
    () => (canShowScannerResults ? visibleGroups.slice(0, visibleTouchGroupCount) : []),
    [canShowScannerResults, visibleGroups, visibleTouchGroupCount]
  );
  const hasMoreTouchGroups = visibleGroups.length > displayedGroups.length;

  useEffect(() => {
    if (!hasMoreTouchGroups || !sentinelRef.current || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setTouchVisibleCount((prev) => prev + touchModeVisibleStep);
        }
      },
      { rootMargin: '250px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMoreTouchGroups]);
  const groupedProductsMap = useMemo(() => new Map(groupedProducts.map((g) => [g.key, g])), [groupedProducts]);
  // Latest-value refs for the stable group-action callbacks below. The grid
  // cards are memoized and receive these callbacks as props, so the callbacks
  // must keep a stable identity across panel re-renders; they read the current
  // search / onAddProduct / group map at click time instead of closing over
  // values that change every render.
  const latestGroupActionRefs = useRef({ search, onAddProduct, groupedProductsMap });
  useEffect(() => {
    latestGroupActionRefs.current = { search, onAddProduct, groupedProductsMap };
  });
  const visibleRecentGroups = useMemo(
    () => recentGroupKeys
      .map((key) => groupedProductsMap.get(key))
      .filter(Boolean)
      .slice(0, 6) as PosProductGroup[],
    [groupedProductsMap, recentGroupKeys],
  );
  const visibleFavoriteGroups = useMemo(
    () => favoriteKeys
      .map((key) => groupedProductsMap.get(key))
      .filter(Boolean)
      .slice(0, 5) as PosProductGroup[],
    [favoriteKeys, groupedProductsMap],
  );
  const selectedGroup = displayedGroups[selectedIndex] || null;
  const openGroup = openGroupKey ? (groupedProductsMap.get(openGroupKey) || null) : null;

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(favoritesStorageKey, JSON.stringify(favoriteKeys));
  }, [favoriteKeys]);

  useEffect(() => {
    setTouchVisibleCount(touchModeVisibleStep);
  }, [isTouchMode, isMobile, productFilter, products, search, shelf]);

  useEffect(() => {
    if (!displayedGroups.length) {
      if (selectedIndex !== 0) setSelectedIndex(0);
      return;
    }
    if (selectedIndex >= displayedGroups.length) setSelectedIndex(0);
  }, [displayedGroups, selectedIndex]);

  useEffect(() => {
    if (!openGroupKey || typeof window === 'undefined') return undefined;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpenGroupKey(null);
      focusSearchInput(searchInputRef);
    };
    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [openGroupKey, searchInputRef]);

  const isKeyboardNavigatingRef = useRef(false);

  useEffect(() => {
    if (!isKeyboardNavigatingRef.current) return;
    isKeyboardNavigatingRef.current = false;
    const handle = window.requestAnimationFrame(() => {
      groupRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => window.cancelAnimationFrame(handle);
  }, [selectedIndex]);

  function moveSelection(nextIndex: number) {
    if (!displayedGroups.length) return;
    const safeIndex = Math.max(0, Math.min(nextIndex, displayedGroups.length - 1));
    isKeyboardNavigatingRef.current = true;
    setSelectedIndex(safeIndex);
  }

  const toggleFavorite = useCallback((groupKey: string) => {
    setFavoriteKeys((current) => (
      current.includes(groupKey)
        ? current.filter((entry) => entry !== groupKey)
        : [groupKey, ...current].slice(0, 20)
    ));
  }, []);

  const activateGroup = useCallback((group: PosProductGroup | null) => {
    if (!group) return false;
    if (isOutOfStockGroup(group)) {
      toast.warning(t('pos.item_out_of_stock_warning', 'الصنف نافذ من المخزون ولا يمكن بيعه حالياً'));
      return false;
    }
    if (group.hasVariants) {
      setOpenGroupKey(group.key);
      return true;
    }
    latestGroupActionRefs.current.onAddProduct(group.products[0]);
    if (latestGroupActionRefs.current.search.trim().length > 0) {
      focusSearchInput(searchInputRef);
    }
    return true;
  }, [isOutOfStockGroup, t]);

  const activateGroupByKey = useCallback((groupKey: string) => {
    return activateGroup(latestGroupActionRefs.current.groupedProductsMap.get(groupKey) || null);
  }, [activateGroup]);

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const currentQuery = event.currentTarget.value || search;
    const pageStep = 8;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(selectedIndex + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(selectedIndex - 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      moveSelection(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      moveSelection(displayedGroups.length - 1);
      return;
    }
    if (event.key === 'PageDown') {
      event.preventDefault();
      moveSelection(selectedIndex + pageStep);
      return;
    }
    if (event.key === 'PageUp') {
      event.preventDefault();
      moveSelection(selectedIndex - pageStep);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (openGroupKey) {
        setOpenGroupKey(null);
        return;
      }
      // Flush scanner buffer immediately then clear
      scannerBuffer.flushNow('');
      onProductFilterChange('all');
      setShelf('all');
      setSelectedCategoryId(null);
      setSelectedIndex(0);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (isMobile) {
        setIsMobileKeyboardActive(false);
        searchInputRef.current?.blur();
      }
      // Flush scanner buffer immediately so parent state is up-to-date
      scannerBuffer.flushNow(currentQuery);
      if (currentQuery.trim()) {
        if (hasExactCodeMatch(products, currentQuery) && onSearchSubmitFirstResult(currentQuery)) {
          setOpenGroupKey(null);
          setSelectedIndex(0);
          return;
        }
        onSearchSubmitFirstResult(currentQuery);
        return;
      }
      if (selectedGroup) activateGroup(selectedGroup);
    }
  }

  return (
    <Card
      className={`workspace-panel pos-products-card pos-products-card-compact pos-products-card-density-compact pos-products-card-mode-${posMode}`.trim()}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden', flex: 1 }}
    >
      <div className="pos-products-static" style={{ flexShrink: 0 }}>

        {(customization.showSearchBar || customization.showPriceTierToggle) && (
          <PosProductsToolbar
            customization={customization}
            search={search}
            scannerBuffer={scannerBuffer}
            handleSearchKeyDown={handleSearchKeyDown}
            isMobile={isMobile}
            isMobileKeyboardActive={isMobileKeyboardActive}
            setIsMobileKeyboardActive={setIsMobileKeyboardActive}
            searchInputRef={searchInputRef}
            priceType={priceType}
            onPriceTypeChange={onPriceTypeChange}
            isPriceTypeLocked={isPriceTypeLocked}
            toggleMobileKeyboard={toggleMobileKeyboard}
            isRtl={isRtl}
            setIsCustomizationOpen={setIsCustomizationOpen}
            setIsCameraScannerOpen={setIsCameraScannerOpen}
          />
        )}

        {restaurantModuleEnabled && (
          <PosDaypartRow
            activeDaypart={activeDaypart}
            setActiveDaypart={setActiveDaypart}
            setSelectedIndex={setSelectedIndex}
          />
        )}

        {customization.showCategories && (isTouchMode || isMobile) && categories.length > 0 && (
          <PosCategoryTiles
            categories={categories}
            selectedCategoryId={selectedCategoryId}
            setSelectedCategoryId={setSelectedCategoryId}
            setSelectedIndex={setSelectedIndex}
            isMobile={isMobile}
          />
        )}

        {customization.showQuickFilters && (isTouchMode || isMobile) && (
          <PosQuickFilterRow
            shelf={shelf}
            setShelf={setShelf}
            productFilter={productFilter}
            onProductFilterChange={onProductFilterChange}
            setSelectedIndex={setSelectedIndex}
            products={products}
            cardDensity={cardDensity}
            setCardDensityMode={setCardDensityMode}
            setIsStudioOpen={setIsStudioOpen}
            isMobile={isMobile}
          />
        )}

        {(isTouchMode || isMobile) && visibleRecentGroups.length ? (
          <div className="pos-quick-picks-row" aria-label={t('pos.pos_products_panel.s15', "وصول سريع")}>
            <span className="muted small">{t('pos.pos_products_panel.s16', "وصول سريع")}</span>
            <div className="pos-quick-picks-buttons">
              {visibleRecentGroups.map((group) => (
                <Button key={group.key} type="button" variant="secondary" onClick={() => activateGroup(group)}>{group.title}</Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div
        className="pos-products-viewport-wrapper"
        style={{
          position: 'relative',
          flex: '1 1 0%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          className="pos-products-scroll"
          onScroll={(e) => {
            if (typeof document === 'undefined') return;
            const currentTop = e.currentTarget.scrollTop;
            const diff = currentTop - lastProductsScrollTopRef.current;

            if (currentTop <= 25) {
              document.body.classList.remove('pos-scroll-hides-nav');
              document.body.classList.remove('mobile-nav-hidden');
            } else if (diff > 10) {
              // Scrolling down: hide bottom nav & dock floating cart
              document.body.classList.add('pos-scroll-hides-nav');
              document.body.classList.add('mobile-nav-hidden');
            } else if (diff < -6) {
              // Scrolling up slightly: reveal bottom nav immediately
              document.body.classList.remove('pos-scroll-hides-nav');
              document.body.classList.remove('mobile-nav-hidden');
            }

            lastProductsScrollTopRef.current = currentTop;
          }}
          style={{
            flex: '1 1 0%',
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            scrollbarWidth: 'none',
            paddingBottom: isMobile ? 'calc(140px + env(safe-area-inset-bottom, 0px))' : '24px',
            msOverflowStyle: 'none',
          }}
        >
        {!canShowScannerResults ? (
          <div className="pos-scanner-ready-panel">
            <div className="pos-scanner-ready-copy">
              <strong>{t('pos.pos_products_panel.s17', "اضرب الباركود أو اكتب أول حرفين للبحث")}</strong>
              <span>{t('pos.pos_products_panel.s18', "تبقى الفاتورة والسلة أمامك، والنتائج ستظهر هنا فقط بعد البحث.")}</span>
            </div>

            {visibleRecentGroups.length ? (
              <div className="pos-scanner-ready-section">
                <span className="muted small">{t('pos.pos_products_panel.s19', "آخر ما تمت إضافته")}</span>
                <div className="pos-scanner-ready-buttons">
                  {visibleRecentGroups.map((group) => (
                    <Button key={group.key} type="button" variant="secondary" onClick={() => activateGroup(group)}>{group.title}</Button>
                  ))}
                </div>
              </div>
            ) : null}

            {visibleFavoriteGroups.length ? (
              <div className="pos-scanner-ready-section">
                <span className="muted small">{t('pos.pos_products_panel.s20', "المفضلة")}</span>
                <div className="pos-scanner-ready-buttons">
                  {visibleFavoriteGroups.map((group) => (
                    <Button key={group.key} type="button" variant="secondary" onClick={() => activateGroup(group)}>{group.title}</Button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {canShowScannerResults && !displayedGroups.length ? (
          <div
            className="surface-note pos-compact-empty"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              padding: '24px 16px',
              textAlign: 'center',
              background: '#f8fafc',
              border: '1px dashed #cbd5e1',
              borderRadius: '10px',
              margin: '12px 0',
            }}
          >
            <div style={{ fontSize: '0.92rem', color: '#64748b' }}>
              {t('pos.pos_products_panel.s21', "لم يتم العثور على أي صنف مطابق لـ")} <strong style={{ color: '#0f172a' }}>"{search}"</strong>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
              {isInvoiceBarcodeQuery(search.trim()) ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onSearchSubmitFirstResult(search.trim())}
                  style={{
                    fontWeight: 700,
                    padding: '8px 18px',
                    background: '#f0f9ff',
                    borderColor: '#0284c7',
                    color: '#0369a1',
                  }}
                >
                  {t('pos.pos_products_panel.s22', "استعراض / إعادة طباعة الفاتورة \"")}{search}"
                </Button>
              ) : null}

              {onOpenNewProduct ? (
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    const query = search.trim();
                    const isBarcode = /^\d{4,}$/.test(query);
                    onOpenNewProduct(isBarcode ? { barcode: query } : { name: query });
                  }}
                  style={{
                    fontWeight: 700,
                    padding: '8px 18px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  }}
                >
                  {t('pos.pos_products_panel.s23', "+ إضافة صنف جديد باسم / باركود \"")}{search}"
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {canShowScannerResults ? (
          <>
            <div
              className={`product-pick-grid pos-product-group-grid ${cardDensity === 'compact' ? 'pos-product-group-grid-density-compact' : ''} ${cardDensity === 'gallery' ? 'pos-product-group-grid-gallery' : ''} ${isMobile && customization.mobileGridColumns === '3' ? 'is-cols-3' : ''}`}
              data-mobile-cols={isMobile ? customization.mobileGridColumns : undefined}
              style={cardDensity === 'gallery' ? {
                display: 'grid',
                gridTemplateColumns: isMobile
                  ? (customization.mobileGridColumns === '3' ? 'repeat(3, minmax(0, 1fr))' : customization.mobileGridColumns === '2' ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(130px, 1fr))')
                  : 'repeat(auto-fill, minmax(155px, 185px))',
                gap: isMobile ? (customization.mobileGridColumns === '3' ? '6px' : '8px') : '12px',
                alignItems: 'stretch',
                paddingBottom: isMobile ? 'calc(140px + env(safe-area-inset-bottom, 0px))' : '24px',
              } : cardDensity === 'compact' ? {
                display: 'grid',
                gridTemplateColumns: isMobile
                  ? (customization.mobileGridColumns === '3' ? 'repeat(3, minmax(0, 1fr))' : customization.mobileGridColumns === '2' ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(130px, 1fr))')
                  : 'repeat(auto-fill, minmax(155px, 185px))',
                gridAutoRows: isMobile ? (customization.mobileGridColumns === '3' ? '106px' : '112px') : '114px',
                gap: isMobile ? (customization.mobileGridColumns === '3' ? '6px' : '8px') : '12px',
                alignItems: 'stretch',
                paddingBottom: isMobile ? 'calc(140px + env(safe-area-inset-bottom, 0px))' : '24px',
              } : (isMobile && customization.mobileGridColumns === '3' ? {
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: '6px',
              } : undefined)}
            >
              {displayedGroups.map((group, index) => (
                <PosProductGroupCard
                  key={group.key}
                  groupKey={group.key}
                  index={index}
                  title={group.title}
                  hasVariants={group.hasVariants}
                  variantCount={group.products.length}
                  minPrice={group.minPrice}
                  maxPrice={group.maxPrice}
                  totalStock={group.totalStock}
                  itemKind={group.itemKind}
                  imageUrl={group.imageUrl}
                  iconName={group.products[0]?.icon}
                  metaLabel={groupMetaLabel(group)}
                  isSelected={isKeyboardNavigatingRef.current && index === selectedIndex}
                  isFavorite={favoriteKeySet.has(group.key)}
                  isOutOfStock={isOutOfStockGroup(group)}
                  cardDensity={cardDensity}
                  isMobile={isMobile}
                  mobileGridColumns={customization.mobileGridColumns}
                  showCardIcon={iconSettings.showIcons}
                  cardRefs={groupRefs}
                  onActivate={activateGroupByKey}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </div>

            {hasMoreTouchGroups ? (
              <div className="pos-touch-show-more-row" ref={sentinelRef}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setTouchVisibleCount((current) => current + touchModeVisibleStep)}
                >
                  {t('pos.pos_products_panel.s34', "عرض المزيد")}
                </Button>
                <span className="muted small">{t('pos.pos_products_panel.s35', "المعروض")} {displayedGroups.length} {t('pos.pos_products_panel.s36', "من")} {visibleGroups.length}</span>
              </div>
            ) : null}
          </>
        ) : null}
        </div>

        {openGroup ? (
          <InlineGroupPicker
            group={openGroup}
            onClose={() => setOpenGroupKey(null)}
            onAddProduct={onAddProduct}
            priceType={priceType}
            searchInputRef={searchInputRef}
            allowNegativeStockSales={allowNegativeStockSales}
            isMobile={isMobile}
            focusSearchInput={focusSearchInput}
          />
        ) : null}

        <ProductIconStudioModal
          open={isStudioOpen}
          onClose={() => setIsStudioOpen(false)}
        />

        <CameraBarcodeScannerModal
          isOpen={isCameraScannerOpen}
          onClose={() => setIsCameraScannerOpen(false)}
          onScan={handleCameraBarcodeScan}
          title={t('pos.pos_products_panel.s37', "مسح باركود الصنف بكاميرا الهاتف")}
          continuous={true}
        />

        <PosCustomizationDialog
          isOpen={isCustomizationOpen}
          onClose={() => setIsCustomizationOpen(false)}
        />
      </div>
    </Card>
  );
}

function arePropsEqual(prev: PosProductsPanelProps, next: PosProductsPanelProps) {
  const recentMatters = prev.productFilter === 'recent' || next.productFilter === 'recent';
  return prev.search === next.search
    && prev.priceType === next.priceType
    && prev.products === next.products
    && (!recentMatters || prev.recentProducts === next.recentProducts)
    && prev.productFilter === next.productFilter
    && prev.posMode === next.posMode
    && prev.onOpenNewProduct === next.onOpenNewProduct;
}

export const PosProductsPanel = memo(PosProductsPanelComponent, arePropsEqual);
