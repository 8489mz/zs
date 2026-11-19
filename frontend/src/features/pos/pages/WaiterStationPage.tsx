import { useTranslation } from 'react-i18next';
import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWaiterStation, WaiterCartItem } from '@/features/pos/hooks/useWaiterStation';
import { useIsolatedDisplayLanguage } from '@/features/pos/hooks/useIsolatedDisplayLanguage';
import { formatCurrency } from '@/lib/format';
import {
  SearchIcon,
  CheckCircleIcon,
  ArrowRightIcon,
  BellIcon,
  ShoppingCartIcon,
} from '@/shared/components/icons/AppIcons';
import { WaiterStationTableHeader } from '@/features/pos/components/pos-workspace/waiter-station/WaiterStationTableHeader';
import { WaiterStationTableKpis } from '@/features/pos/components/pos-workspace/waiter-station/WaiterStationTableKpis';
import { WaiterStationServiceCallsBanner } from '@/features/pos/components/pos-workspace/waiter-station/WaiterStationServiceCallsBanner';
import { WaiterStationTablesGrid } from '@/features/pos/components/pos-workspace/waiter-station/WaiterStationTablesGrid';
import { WaiterStationOrderHeader } from '@/features/pos/components/pos-workspace/waiter-station/WaiterStationOrderHeader';
import { WaiterStationMobileTabSwitcher } from '@/features/pos/components/pos-workspace/waiter-station/WaiterStationMobileTabSwitcher';

export function WaiterStationPage() {
  const { currentLang, toggleLanguage } = useIsolatedDisplayLanguage('waiter_ui_lang');
  const { t } = useTranslation();
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
        {(!isMobile || mobileActiveTab === 'menu') && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              borderLeft: isMobile ? 'none' : '1px solid #cbd5e1',
              overflow: 'hidden',
              minWidth: 0,
            }}
          >
          {/* Categories Horizontal Bar */}
          <div
            style={{
              background: '#ffffff',
              borderBottom: '1px solid #e2e8f0',
              padding: '8px 12px',
              display: 'flex',
              gap: '6px',
              overflowX: 'auto',
              whiteSpace: 'nowrap',
            }}
          >
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              style={{
                background: selectedCategory === 'all' ? '#170e5e' : '#f1f5f9',
                color: selectedCategory === 'all' ? '#ffffff' : '#334155',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {t('pos.waiter_station_page.s28', "الكل")}
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                style={{
                  background: selectedCategory === cat ? '#170e5e' : '#f1f5f9',
                  color: selectedCategory === cat ? '#ffffff' : '#334155',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Search bar */}
          <div style={{ padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '6px 10px' }}>
              <SearchIcon size={14} color="#64748b" />
              <input
                type="text"
                placeholder={t('pos.waiter_station_page.s29', "بحث سريع باسم الوجبة أو المشروب...")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ border: 'none', outline: 'none', width: '100%', fontSize: '12.5px' }}
              />
            </div>
          </div>

          {/* Product Items Grid (Adaptive Clamping & Responsive Cell Sizes) */}
          <div
            style={{
              flex: 1,
              padding: isMobile ? '10px' : '14px',
              overflowY: 'auto',
              display: 'grid',
              gridTemplateColumns: isMobile
                ? 'repeat(auto-fill, minmax(130px, 1fr))'
                : 'repeat(auto-fill, minmax(155px, 1fr))',
              gap: isMobile ? '8px' : '12px',
              alignContent: 'start',
            }}
          >
            {filteredProducts.map((p: any) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleAddItem(p)}
                title={p.name}
                style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '10px 10px 8px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  height: '130px',
                  minHeight: '130px',
                  maxHeight: '130px',
                  minWidth: 0,
                  width: '100%',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#170e5e';
                  e.currentTarget.style.boxShadow = '0 3px 8px rgba(23, 14, 94, 0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#e2e8f0';
                  e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.03)';
                }}
              >
                {(p.imageUrl || p.metadata?.imageUrl) ? (
                  <div style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    marginBottom: '4px',
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <img
                      src={p.imageUrl || p.metadata?.imageUrl}
                      alt={p.name}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      loading="lazy"
                    />
                  </div>
                ) : null}
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 800,
                    color: '#0f172a',
                    lineHeight: '1.3',
                    textAlign: 'center',
                    width: '100%',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: (p.imageUrl || p.metadata?.imageUrl) ? 2 : 3,
                    WebkitBoxOrient: 'vertical',
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
                    whiteSpace: 'normal',
                  }}
                >
                  {p.name}
                </div>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 900,
                    color: '#170e5e',
                    marginTop: 'auto',
                    paddingTop: '4px',
                    width: '100%',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    textAlign: 'center',
                  }}
                >
                  {formatCurrency(p.price || p.retail_price || 0)}
                </div>
              </button>
            ))}
          </div>

          {/* Mobile Bottom Floating Cart Bar */}
          {isMobile && cart.length > 0 && (
            <div
              style={{
                background: '#ffffff',
                borderTop: '2px solid #170e5e',
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 -4px 16px rgba(15, 23, 42, 0.08)',
                zIndex: 10,
              }}
            >
              <div>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                  {t('pos.waiter_station_page.s30', "الطلب الحالي (")}{cartItemsCount} {t('pos.waiter_station_page.s31', "أصناف)")}
                </div>
                <div style={{ fontSize: '15px', color: '#170e5e', fontWeight: 900 }}>
                  {formatCurrency(cartTotal)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileActiveTab('cart')}
                style={{
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 16px',
                  fontSize: '12.5px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <ShoppingCartIcon size={14} color="#ffffff" />
                <span>{t('pos.waiter_station_page.s32', "مراجعة السلة (")}{cartItemsCount})</span>
              </button>
            </div>
          )}
        </div>
        )}

        {/* CART COLUMN */}
        {(!isMobile || mobileActiveTab === 'cart') && (
          <div
            style={{
              flex: isMobile ? 1 : undefined,
              width: isMobile ? '100%' : '340px',
              display: 'flex',
              flexDirection: 'column',
              background: '#ffffff',
              overflow: 'hidden',
            }}
          >
          <div
            style={{
              padding: '12px 14px',
              borderBottom: '1px solid #e2e8f0',
              background: '#f8fafc',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
              {t('pos.waiter_station_page.s33', "طلبات الطاولة الجديدة (")}{cartItemsCount})
            </div>
            {isMobile && (
              <button
                type="button"
                onClick={() => setMobileActiveTab('menu')}
                style={{
                  background: '#eef2ff',
                  border: '1px solid #c7d2fe',
                  borderRadius: '6px',
                  padding: '4px 10px',
                  color: '#170e5e',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t('pos.waiter_station_page.s34', "+ إضافة المزيد")}
              </button>
            )}
          </div>

          {/* Cart Items List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {cart.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 10px', color: '#64748b', fontSize: '12px' }}>
                {t('pos.waiter_station_page.s35', "اضغط على الأصناف من القائمة لإضافتها للطلب.")}
              </div>
            ) : (
              cart.map((item) => (
                <div
                  key={item.id}
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    marginBottom: '8px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <div
                      style={{
                        fontSize: '12.5px',
                        fontWeight: 800,
                        color: '#0f172a',
                        wordBreak: 'break-word',
                        overflowWrap: 'anywhere',
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      {item.name}
                    </div>
                    <div style={{ fontSize: '12.5px', fontWeight: 900, color: '#170e5e', whiteSpace: 'nowrap' }}>
                      {formatCurrency(item.price * item.qty)}
                    </div>
                  </div>

                  {item.notes && (
                    <div style={{ fontSize: '11px', color: '#b45309', fontWeight: 600, marginTop: '2px' }}>
                      {t('pos.waiter_station_page.s36', "ملاحظة:")} {item.notes}
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                    {/* RTL Stepper: [+] first, number, [-] last */}
                    <div style={{ display: 'inline-flex', alignItems: 'center', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '4px', height: '26px' }}>
                      <button
                        type="button"
                        onClick={() => handleUpdateQty(item.id, 1)}
                        style={{ width: '26px', height: '100%', border: 'none', background: 'transparent', fontWeight: 800, color: '#170e5e', cursor: 'pointer' }}
                      >
                        +
                      </button>
                      <span style={{ minWidth: '24px', textAlign: 'center', fontSize: '12px', fontWeight: 800 }}>
                        {item.qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUpdateQty(item.id, -1)}
                        style={{ width: '26px', height: '100%', border: 'none', background: 'transparent', fontWeight: 800, color: '#64748b', cursor: 'pointer' }}
                      >
                        -
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveItemNoteModal(item);
                        setItemNoteText(item.notes || '');
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#170e5e',
                        fontSize: '11.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {item.notes ? t('pos.waiter_station_page.s37', "تعديل الملاحظة") : t('pos.waiter_station_page.s38', "+ ملاحظة طبق")}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Cart Footer & Big Kitchen Action Button */}
          <div style={{ padding: '12px 14px', borderTop: '2px solid #e2e8f0', background: '#f8fafc' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#475569' }}>{t('pos.waiter_station_page.s39', "إجمالي الطلب:")}</span>
              <strong style={{ fontSize: '16px', fontWeight: 900, color: '#170e5e' }}>{formatCurrency(cartTotal)}</strong>
            </div>

            <button
              type="button"
              disabled={cart.length === 0 || isSendingToKitchen}
              onClick={handleSendToKitchen}
              style={{
                width: '100%',
                background: cart.length === 0 ? '#94a3b8' : '#170e5e',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '14px',
                fontWeight: 900,
                cursor: cart.length === 0 ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: cart.length > 0 ? '0 4px 12px rgba(23, 14, 94, 0.25)' : 'none',
              }}
            >
              <CheckCircleIcon size={16} color="#ffffff" />
              <span>{isSendingToKitchen ? t('pos.waiter_station_page.s40', "جاري الإرسال...") : t('pos.waiter_station_page.s41', "إرسال الطلب للمطبخ (Send to Kitchen)")}</span>
            </button>
          </div>
        </div>
        )}
      </div>

      {/* Item Note Modal */}
      {activeItemNoteModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div style={{ background: '#ffffff', borderRadius: '12px', padding: '18px', width: '360px', maxWidth: '90vw' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
              {t('pos.waiter_station_page.s42', "ملاحظات تحضير الطبق:")} {activeItemNoteModal.name}
            </h3>
            <textarea
              rows={3}
              placeholder={t('pos.waiter_station_page.s43', "مثال: بدون بصل / صوص جانبي / مستوي جيداً / يقدم مع المقبلات")}
              value={itemNoteText}
              onChange={(e) => setItemNoteText(e.target.value)}
              style={{ width: '100%', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '8px', fontSize: '13px', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
              <button
                type="button"
                onClick={() => setActiveItemNoteModal(null)}
                style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
              >
                {t('pos.waiter_station_page.s44', "إلغاء")}
              </button>
              <button
                type="button"
                onClick={handleSaveItemNote}
                style={{ background: '#170e5e', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '6px 16px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
              >
                {t('pos.waiter_station_page.s45', "تأكيد الملاحظة")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default WaiterStationPage;
