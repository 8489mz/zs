import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWaiterStation, WaiterCartItem } from '@/features/pos/hooks/useWaiterStation';
import { useIsolatedDisplayLanguage } from '@/features/pos/hooks/useIsolatedDisplayLanguage';
import { WaiterStationTableHeader } from '@/features/pos/components/pos-workspace/waiter-station/WaiterStationTableHeader';
import { WaiterStationTableKpis } from '@/features/pos/components/pos-workspace/waiter-station/WaiterStationTableKpis';
import { WaiterStationServiceCallsBanner } from '@/features/pos/components/pos-workspace/waiter-station/WaiterStationServiceCallsBanner';
import { WaiterStationTablesGrid } from '@/features/pos/components/pos-workspace/waiter-station/WaiterStationTablesGrid';
import { WaiterStationOrderHeader } from '@/features/pos/components/pos-workspace/waiter-station/WaiterStationOrderHeader';
import { WaiterStationMobileTabSwitcher } from '@/features/pos/components/pos-workspace/waiter-station/WaiterStationMobileTabSwitcher';
import { WaiterStationMenuColumn } from '@/features/pos/components/pos-workspace/waiter-station/WaiterStationMenuColumn';
import { WaiterStationCartColumn } from '@/features/pos/components/pos-workspace/waiter-station/WaiterStationCartColumn';
import { WaiterStationItemNoteModal } from '@/features/pos/components/pos-workspace/waiter-station/WaiterStationItemNoteModal';

export function WaiterStationPage() {
  const { currentLang, toggleLanguage } = useIsolatedDisplayLanguage('waiter_ui_lang');
  const navigate = useNavigate();

  // Authentication State
  const waiterPin = '101';

  // Responsive Device View State (Auto-detect Phone / Tablet / Desktop)
  const [windowWidth, setWindowWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );
  const [mobileActiveTab, setMobileActiveTab] = useState<'menu' | 'cart'>('menu');

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = windowWidth < 860;

  // Active Order State
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [guestCount, setGuestCount] = useState<number>(2);
  const [cart, setCart] = useState<WaiterCartItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeItemNoteModal, setActiveItemNoteModal] = useState<WaiterCartItem | null>(null);
  const [itemNoteText, setItemNoteText] = useState<string>('');

  // Feature Hook (Isolating API and React Query from page file)
  const {
    tablesCount,
    products,
    occupiedTablesMap,
    pendingCalls,
    pendingCallsByTable,
    isOnline,
    offlineQueueCount,
    syncOfflineQueue,
    isSyncingQueue,
    handleResolveCall: resolveCallAction,
    sendToKitchen,
    isSendingToKitchen,
  } = useWaiterStation();

  const handleResolveCall = async (e: React.MouseEvent, callId: number) => {
    e.stopPropagation();
    await resolveCallAction(callId);
  };

  // Extract distinct categories
  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const p of products) {
      if ((p as any).category?.name) cats.add((p as any).category.name);
      else if ((p as any).category_name) cats.add((p as any).category_name);
    }
    return Array.from(cats);
  }, [products]);

  // Filter products by category & search
  const filteredProducts = useMemo(() => {
    return products.filter((p: any) => {
      const matchCat =
        selectedCategory === 'all' ||
        (p.category?.name === selectedCategory || p.category_name === selectedCategory);
      const matchSearch =
        !searchQuery ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(p.sku || '').toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [products, selectedCategory, searchQuery]);

  // Add Item to Waiter Cart
  const handleAddItem = (product: any) => {
    const existingIndex = cart.findIndex((item) => item.productId === product.id && !item.notes);
    if (existingIndex > -1) {
      const updated = [...cart];
      updated[existingIndex].qty += 1;
      setCart(updated);
    } else {
      const newItem: WaiterCartItem = {
        id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        productId: product.id,
        name: product.name,
        price: Number(product.price || product.retail_price || 0),
        qty: 1,
      };
      setCart([...cart, newItem]);
    }
  };

  const handleUpdateQty = (itemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.id === itemId) {
            const nextQty = item.qty + delta;
            return nextQty > 0 ? { ...item, qty: nextQty } : null;
          }
          return item;
        })
        .filter(Boolean) as WaiterCartItem[]
    );
  };

  const handleSaveItemNote = () => {
    if (!activeItemNoteModal) return;
    setCart((prev) =>
      prev.map((item) =>
        item.id === activeItemNoteModal.id ? { ...item, notes: itemNoteText.trim() || undefined } : item
      )
    );
    setActiveItemNoteModal(null);
    setItemNoteText('');
  };

  // Select Table
  const handleSelectTable = (tableNum: string) => {
    setSelectedTable(tableNum);
    setMobileActiveTab('menu');
    const existingDraft = occupiedTablesMap.get(tableNum);
    if (existingDraft && Array.isArray(existingDraft.cart)) {
      setGuestCount(Number(existingDraft.guestCount || 2));
    } else {
      setGuestCount(2);
    }
    setCart([]);
  };

  const handleSendToKitchen = async () => {
    if (!selectedTable || cart.length === 0) return;
    try {
      await sendToKitchen({
        selectedTable,
        guestCount,
        waiterPin,
        cart,
      });
      setSelectedTable(null);
      setCart([]);
    } catch {
      // Handled in hook
    }
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.qty * item.price, 0);
  const cartItemsCount = cart.reduce((sum, item) => sum + item.qty, 0);

  // VIEW 1: TABLE SELECTION (خريطة الطاولات السريعة للويتر)
  if (!selectedTable) {
    return (
      <div
        dir="rtl"
        style={{
          width: '100vw',
          height: '100vh',
          background: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Top Header */}
        <WaiterStationTableHeader
          navigate={navigate}
          isOnline={isOnline}
          offlineQueueCount={offlineQueueCount}
          syncOfflineQueue={syncOfflineQueue}
          isSyncingQueue={isSyncingQueue}
          waiterPin={waiterPin}
          currentLang={currentLang}
          toggleLanguage={toggleLanguage}
        />

        {/* Subheader Executive KPI Summary */}
        <WaiterStationTableKpis
          isMobile={isMobile}
          tablesCount={tablesCount}
          occupiedTablesMap={occupiedTablesMap}
          pendingCalls={pendingCalls}
        />

        {/* Urgent Service Calls Banner */}
        <WaiterStationServiceCallsBanner pendingCalls={pendingCalls} handleResolveCall={handleResolveCall} />

        {/* Tables Grid */}
        <WaiterStationTablesGrid
          isMobile={isMobile}
          tablesCount={tablesCount}
          occupiedTablesMap={occupiedTablesMap}
          pendingCallsByTable={pendingCallsByTable}
          handleSelectTable={handleSelectTable}
        />
      </div>
    );
  }

  // VIEW 2: ACTIVE ORDER TAKING SCREEN (شاشة أخذ الطلب للطاولة المحددة)
  return (
    <div
      dir="rtl"
      style={{
        width: '100vw',
        height: '100vh',
        background: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Top Header */}
      <WaiterStationOrderHeader
        isMobile={isMobile}
        cart={cart}
        setSelectedTable={setSelectedTable}
        setCart={setCart}
        selectedTable={selectedTable}
        isOnline={isOnline}
        offlineQueueCount={offlineQueueCount}
        syncOfflineQueue={syncOfflineQueue}
        isSyncingQueue={isSyncingQueue}
        setGuestCount={setGuestCount}
        guestCount={guestCount}
      />

      {/* Mobile Device Tab Switcher (Phone / Vertical Tablet) */}
      <WaiterStationMobileTabSwitcher isMobile={isMobile} setMobileActiveTab={setMobileActiveTab} mobileActiveTab={mobileActiveTab} filteredProducts={filteredProducts} cartItemsCount={cartItemsCount} cartTotal={cartTotal} />

      {/* Main Body: Adaptive Layout (Mobile Tabbed / Desktop Side-by-Side) */}
      <div
        style={{
          flex: 1,
          display: isMobile ? 'flex' : 'grid',
          flexDirection: isMobile ? 'column' : undefined,
          gridTemplateColumns: isMobile ? undefined : '1fr 340px',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* MENU COLUMN */}
        <WaiterStationMenuColumn
          isMobile={isMobile}
          mobileActiveTab={mobileActiveTab}
          setSelectedCategory={setSelectedCategory}
          selectedCategory={selectedCategory}
          categories={categories}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          filteredProducts={filteredProducts}
          handleAddItem={handleAddItem}
          cart={cart}
          cartItemsCount={cartItemsCount}
          cartTotal={cartTotal}
          setMobileActiveTab={setMobileActiveTab}
        />

        {/* CART COLUMN */}
        <WaiterStationCartColumn
          isMobile={isMobile}
          mobileActiveTab={mobileActiveTab}
          setMobileActiveTab={setMobileActiveTab}
          cartItemsCount={cartItemsCount}
          cart={cart}
          handleUpdateQty={handleUpdateQty}
          setActiveItemNoteModal={setActiveItemNoteModal}
          setItemNoteText={setItemNoteText}
          cartTotal={cartTotal}
          isSendingToKitchen={isSendingToKitchen}
          handleSendToKitchen={handleSendToKitchen}
        />
      </div>

      {/* Item Note Modal */}
      <WaiterStationItemNoteModal activeItemNoteModal={activeItemNoteModal} itemNoteText={itemNoteText} setItemNoteText={setItemNoteText} setActiveItemNoteModal={setActiveItemNoteModal} handleSaveItemNote={handleSaveItemNote} />
    </div>
  );
}
export default WaiterStationPage;
