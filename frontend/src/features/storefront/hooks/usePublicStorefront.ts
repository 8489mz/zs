import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { storefrontApi } from '../api/storefront.api';
import { tableCallsApi } from '@/shared/api/table-calls.api';
import { buildCartProduct } from '../lib/storefront-variant-pricing';
import { calculateCartSubtotal } from '../lib/storefront-cart-pricing';
import type {
  CartItem,
  CreateOnlineOrderResponse,
  StorefrontProduct,
  StorefrontCategory,
  StorefrontInfo,
  OnlineOrderRecord,
} from '../types/storefront.types';

export const ITEMS_PER_PAGE = 24;
const arCollator = new Intl.Collator('ar', { sensitivity: 'base' });

export function usePublicStorefront(cleanSlug: string) {
  // Queries for live Storefront data
  const infoQuery = useQuery({
    queryKey: ['storefront-info', cleanSlug],
    queryFn: () => storefrontApi.getInfo(cleanSlug),
    enabled: Boolean(cleanSlug),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  const catalogQuery = useQuery({
    queryKey: ['storefront-catalog', cleanSlug],
    queryFn: () => storefrontApi.getCatalog(cleanSlug),
    enabled: Boolean(cleanSlug),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  // State
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<number | 'all'>('all');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [onlyDeals, setOnlyDeals] = useState(false);
  const [sortBy, setSortBy] = useState<'featured' | 'price-asc' | 'price-desc' | 'name'>('featured');
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);
  const [isCategoriesModalOpen, setIsCategoriesModalOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isMyOrdersOpen, setIsMyOrdersOpen] = useState(false);
  const [editingOrderNumber, setEditingOrderNumber] = useState<string | undefined>(undefined);
  const [confirmedOrder, setConfirmedOrder] = useState<CreateOnlineOrderResponse | null>(null);
  const [reviewProduct, setReviewProduct] = useState<StorefrontProduct | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [isCallingService, setIsCallingService] = useState(false);

  const handleRequestTableService = useCallback(async (tableNumber: string, callType: 'waiter' | 'bill') => {
    setIsCallingService(true);
    try {
      await tableCallsApi.createCall({
        tableNumber,
        callType,
      }, cleanSlug);
      return true;
    } finally {
      setIsCallingService(false);
    }
  }, [cleanSlug]);

  // Favorites State (Persisted per slug)
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(() => {
    const set = new Set<number>();
    try {
      const saved = localStorage.getItem(`zs_fav_ids_${cleanSlug}`);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr)) {
          arr.forEach((id: number) => set.add(Number(id)));
        }
      }
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('zs_fav_') && !key.startsWith('zs_fav_ids_')) {
          if (localStorage.getItem(key) === 'true') {
            const id = Number(key.replace('zs_fav_', ''));
            if (!isNaN(id)) set.add(id);
          }
        }
      }
    } catch {}
    return set;
  });
  const [onlyFavorites, setOnlyFavorites] = useState(false);

  const handleToggleFavorite = useCallback((productId: number) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
        try { localStorage.removeItem(`zs_fav_${productId}`); } catch {}
      } else {
        next.add(productId);
        try { localStorage.setItem(`zs_fav_${productId}`, 'true'); } catch {}
      }
      try {
        localStorage.setItem(`zs_fav_ids_${cleanSlug}`, JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  }, [cleanSlug]);

  const handleToggleFavorites = useCallback(() => {
    setOnlyFavorites((prev) => {
      const next = !prev;
      if (next) {
        setSelectedCategory('all');
        setOnlyDeals(false);
        setSearchTerm('');
        setTimeout(() => {
          const el = document.getElementById('storefront-products-section');
          if (el) {
            el.scrollIntoView({ behavior: 'smooth' });
          }
        }, 50);
      }
      return next;
    });
  }, []);

  const handleOpenReviewModal = useCallback((product: StorefrontProduct) => {
    setReviewProduct(product);
    setIsReviewModalOpen(true);
  }, []);

  const handleReviewSubmitted = useCallback(() => {
    catalogQuery.refetch();
  }, [catalogQuery]);

  useEffect(() => {
    setVisibleCount(ITEMS_PER_PAGE);
  }, [selectedCategory, searchTerm, onlyDeals, onlyFavorites]);

  // Cart State (Persisted per slug)
  const cartStorageKey = `zs_storefront_cart_${cleanSlug}`;
  const [cartItems, setCartItems] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(cartStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter((item) => item?.product && Number(item.product.price || 0) > 0);
        }
      }
      return [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(cartStorageKey, JSON.stringify(cartItems));
    } catch {}
  }, [cartItems, cartStorageKey]);

  useEffect(() => {
    if (!catalogQuery.data?.products || catalogQuery.data.products.length === 0) return;
    const activeProductMap = new Map<string, StorefrontProduct>();
    for (const p of catalogQuery.data.products as StorefrontProduct[]) {
      activeProductMap.set(String(p.id), p);
    }
    setCartItems((prev) => {
      let changed = false;
      const updated = prev
        .filter((item) => {
          const exists = activeProductMap.has(String(item.product.id));
          if (!exists) changed = true;
          return exists;
        })
        .map((item) => {
          // Re-price from the fresh catalog, keeping the chosen variant (SF-4). A variant that no
          // longer exists drops the line rather than silently falling back to the base price.
          const fresh = buildCartProduct(activeProductMap.get(String(item.product.id))!, item.product.variantName);
          if (!fresh) {
            changed = true;
            return null;
          }
          if (fresh.price !== item.product.price || fresh.name !== item.product.name) {
            changed = true;
            return { ...item, product: fresh };
          }
          return item;
        })
        .filter((item): item is CartItem => item !== null);

      return changed ? updated : prev;
    });
  }, [catalogQuery.data?.products]);

  const cartMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const item of cartItems) {
      map.set(Number(item.product.id), item.quantity);
    }
    return map;
  }, [cartItems]);

  // One cart line per product (the sales engine invoices one row per product): picking a different
  // variant of a product already in the cart switches that line to the new variant.
  const handleAddToCart = useCallback((product: StorefrontProduct, quantity: number = 1) => {
    // Financial Invariant: Unpriced (<= 0) products can NEVER be added to cart
    if (!product || Number(product.price || 0) <= 0) return;
    const addQty = Math.max(1, Math.floor(Number(quantity) || 1));
    setCartItems((prev) => {
      const pNum = Number(product.id);
      const existingIndex = prev.findIndex((i) => Number(i.product.id) === pNum);
      if (existingIndex > -1) {
        const existing = prev[existingIndex];
        const sameVariant = (existing.product.variantName || null) === (product.variantName || null);
        const next = [...prev];
        next[existingIndex] = sameVariant
          ? { ...existing, quantity: existing.quantity + addQty }
          : { product, quantity: addQty };
        return next;
      }
      return [...prev, { product, quantity: addQty }];
    });
  }, []);

  const handleUpdateQuantity = useCallback((productId: number, qty: number) => {
    setCartItems((prev) => {
      const pNum = Number(productId);
      if (qty <= 0) {
        return prev.filter((i) => Number(i.product.id) !== pNum);
      }
      return prev.map((item) =>
        Number(item.product.id) === pNum ? { ...item, quantity: qty } : item
      );
    });
  }, []);

  const handleClearCart = useCallback(() => {
    setCartItems([]);
  }, []);

  const handleGoHome = useCallback(() => {
    setSearchTerm('');
    setSelectedCategory('all');
    setOnlyDeals(false);
    setOnlyFavorites(false);
    setInStockOnly(false);
    setSortBy('featured');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleEditOrder = useCallback((order: OnlineOrderRecord) => {
    const rawProds: StorefrontProduct[] = catalogQuery.data?.products || [];
    const newCart: CartItem[] = [];
    for (const item of order.items) {
      const prod = rawProds.find((p) => Number(p.id) === Number(item.productId));
      const cartProduct = prod ? buildCartProduct(prod, (item as { variantName?: string | null }).variantName) : null;
      if (cartProduct) {
        newCart.push({ product: cartProduct, quantity: item.quantity });
      } else {
        newCart.push({
          product: {
            id: item.productId,
            name: item.name,
            price: item.unitPrice,
            costPrice: 0,
            stockQty: 999,
            unitName: 'قطعة',
            inStock: true,
          } as any,
          quantity: item.quantity,
        });
      }
    }
    setCartItems(newCart);
    setEditingOrderNumber(order.orderNumber);
    setIsCartOpen(true);
  }, [catalogQuery.data?.products]);

  /**
   * "اطلب تاني": refills the cart from a past order at TODAY's catalog prices (the server re-prices at
   * checkout anyway). Items no longer sold, out of stock, or whose size was removed are skipped and
   * reported back so the page can tell the shopper.
   */
  const handleReorder = useCallback((order: OnlineOrderRecord): { added: number; skipped: string[] } => {
    const rawProds: StorefrontProduct[] = catalogQuery.data?.products || [];
    const newCart: CartItem[] = [];
    const skipped: string[] = [];
    for (const item of order.items) {
      const prod = rawProds.find((p) => Number(p.id) === Number(item.productId));
      const cartProduct = prod && prod.inStock !== false && prod.price > 0
        ? buildCartProduct(prod, (item as { variantName?: string | null }).variantName)
        : null;
      if (cartProduct) {
        newCart.push({ product: cartProduct, quantity: Math.max(1, Number(item.quantity) || 1) });
      } else {
        skipped.push(item.name);
      }
    }
    if (newCart.length > 0) {
      setCartItems(newCart);
      setEditingOrderNumber(undefined);
      setIsCartOpen(true);
    }
    return { added: newCart.length, skipped };
  }, [catalogQuery.data?.products]);

  const rawProducts: StorefrontProduct[] = catalogQuery.data?.products || [];
  const categories: StorefrontCategory[] = catalogQuery.data?.categories || [];
  const isSmartDealsOn = Boolean(infoQuery.data?.smartDealsEnabled);

  const dealsProducts = useMemo(() => {
    const realDiscounts = rawProducts.filter((p) => Boolean(p.hasDiscount || p.offerType === 'bogo'));
    if (realDiscounts.length > 0) {
      return realDiscounts;
    }
    if (isSmartDealsOn) {
      return rawProducts.filter((p) => p.price > 0 && p.inStock).slice(0, 8);
    }
    return [];
  }, [rawProducts, isSmartDealsOn]);

  const smartDealProductIds = useMemo(() => {
    return new Set(dealsProducts.map((p) => p.id));
  }, [dealsProducts]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<number | 'all', number>();
    counts.set('all', rawProducts.length);
    for (const p of rawProducts) {
      if (p.categoryId) {
        const cid = Number(p.categoryId);
        counts.set(cid, (counts.get(cid) || 0) + 1);
      }
    }
    return counts;
  }, [rawProducts]);

  const filteredProducts = useMemo(() => {
    let list = [...rawProducts];
    const showOutOfStock = infoQuery.data?.showOutOfStockProducts !== false;
    if (!showOutOfStock) {
      list = list.filter((p) => p.inStock);
    }
    if (selectedCategory !== 'all') {
      list = list.filter((p) => Number(p.categoryId) === Number(selectedCategory));
    }
    if (inStockOnly) {
      list = list.filter((p) => p.inStock);
    }
    if (onlyDeals) {
      list = dealsProducts;
    }
    if (onlyFavorites) {
      list = list.filter((p) => favoriteIds.has(Number(p.id)));
    }
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.barcode.includes(q) ||
          p.categoryName.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      if (sortBy === 'featured') {
        const aScore = (a.inStock ? 2 : 0) + (a.price > 0 ? 1 : 0);
        const bScore = (b.inStock ? 2 : 0) + (b.price > 0 ? 1 : 0);
        if (aScore !== bScore) return bScore - aScore;
        return arCollator.compare(a.name, b.name);
      }
      if (sortBy === 'price-asc') return a.price - b.price;
      if (sortBy === 'price-desc') return b.price - a.price;
      if (sortBy === 'name') return arCollator.compare(a.name, b.name);
      return 0;
    });
    return list;
  }, [rawProducts, selectedCategory, inStockOnly, onlyDeals, onlyFavorites, favoriteIds, dealsProducts, searchTerm, sortBy, infoQuery.data?.showOutOfStockProducts]);

  const topHomepageSections = useMemo(() => {
    const groups: { categoryId: number; categoryName: string; products: StorefrontProduct[]; totalCount: number }[] = [];
    const sortedCats = [...categories].sort(
      (a, b) => (categoryCounts.get(Number(b.id)) || 0) - (categoryCounts.get(Number(a.id)) || 0)
    );
    for (const cat of sortedCats) {
      const catId = Number(cat.id);
      let prods = rawProducts.filter((p) => Number(p.categoryId) === catId);
      if (inStockOnly) {
        prods = prods.filter((p) => p.inStock && p.stockQty > 0);
      }
      if (prods.length > 0) {
        prods.sort((a, b) => {
          const aScore = (a.inStock ? 2 : 0) + (a.price > 0 ? 1 : 0);
          const bScore = (b.inStock ? 2 : 0) + (b.price > 0 ? 1 : 0);
          return bScore - aScore;
        });
        groups.push({
          categoryId: cat.id,
          categoryName: cat.name,
          products: prods.slice(0, 10),
          totalCount: prods.length,
        });
        if (groups.length >= 8) break;
      }
    }
    return groups;
  }, [categories, rawProducts, categoryCounts, inStockOnly]);

  const cartCount = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems]
  );
  const cartTotals = useMemo(
    () => calculateCartSubtotal(cartItems),
    [cartItems]
  );
  const cartSubtotal = cartTotals.subtotal;
  const cartOriginalSubtotal = cartTotals.originalSubtotal;
  const cartSavings = cartTotals.totalSavings;

  const isHomepageMultiRow = selectedCategory === 'all' && !searchTerm.trim() && !onlyDeals && !onlyFavorites;

  const info: StorefrontInfo = infoQuery.data || {
    tenantId: '',
    slug: cleanSlug,
    businessName: '',
    enabled: true,
    title: '',
    bio: '',
    announcement: '',
    bannerUrl: '',
    deliveryFee: 0,
    minOrder: 0,
    whatsappPhone: '',
    currency: 'EGP',
    smartDealsEnabled: false,
  };
  const paginatedProducts = filteredProducts.slice(0, visibleCount);
  const hasMore = visibleCount < filteredProducts.length;

  return {
    infoQuery,
    catalogQuery,
    info,
    searchTerm,
    setSearchTerm,
    selectedCategory,
    setSelectedCategory,
    inStockOnly,
    setInStockOnly,
    onlyDeals,
    setOnlyDeals,
    sortBy,
    setSortBy,
    visibleCount,
    setVisibleCount,
    isCategoriesModalOpen,
    setIsCategoriesModalOpen,
    isCartOpen,
    setIsCartOpen,
    isCheckoutOpen,
    setIsCheckoutOpen,
    isMyOrdersOpen,
    setIsMyOrdersOpen,
    editingOrderNumber,
    setEditingOrderNumber,
    confirmedOrder,
    setConfirmedOrder,
    reviewProduct,
    setReviewProduct,
    isReviewModalOpen,
    setIsReviewModalOpen,
    favoriteIds,
    onlyFavorites,
    setOnlyFavorites,
    handleToggleFavorite,
    handleToggleFavorites,
    handleOpenReviewModal,
    handleReviewSubmitted,
    cartItems,
    cartMap,
    cartCount,
    cartSubtotal,
    cartOriginalSubtotal,
    cartSavings,
    handleAddToCart,
    handleUpdateQuantity,
    handleClearCart,
    handleGoHome,
    handleEditOrder,
    handleReorder,
    rawProducts,
    categories,
    dealsProducts,
    smartDealProductIds,
    categoryCounts,
    filteredProducts,
    topHomepageSections,
    paginatedProducts,
    hasMore,
    isHomepageMultiRow,
    handleRequestTableService,
    isCallingService,
  };
}
