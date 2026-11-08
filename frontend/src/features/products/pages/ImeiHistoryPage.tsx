import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { useAppToolbar } from '@/stores/toolbar-store';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { getMaintenanceProfile } from '@/features/maintenance/constants/maintenance-profiles';
import { productSerialsApi, type ProductSerialItem } from '../api/product-serials.api';
import { maintenanceApi, type MaintenanceListPageResponse } from '@/features/maintenance/api/maintenance.api';
import { tradeInApi, type TradeInListPageResponse } from '@/features/tradein/api/tradein.api';
import type { MaintenanceTicket } from '@/types/domain-models/maintenance';
import type { TradeInTransaction } from '@/types/domain-models/tradein';

// LF-P4: the lookup client returns the item under `item`, and the backend
// already returns the product prices on it — but the shared
// ProductSerialItem type does not declare those price fields, so they
// are read through this local extension (no change to the shared type).
type LookupSerialItem = ProductSerialItem & {
  productRetailPrice?: number | null;
  productWholesalePrice?: number | null;
};

// LF-P4: the backend ticket list returns warrantyEnd per ticket (M2 P5:
// computed at first repair as repaired_at + warranty_days), but the
// shared MaintenanceTicket type does not declare it.
type TicketWithWarranty = MaintenanceTicket & { warrantyEnd?: string | null };

// Premium Minimal Vector SVG Icons (StrokeWidth 1.75)
const Icons = {
  Search: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  Device: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  ),
  Wrench: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  Exchange: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  ),
  Warehouse: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  Package: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  ),
  Cart: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  ),
  Shield: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  Tag: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  ),
  Printer: () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  ),
  Copy: () => (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
};

const statusMap: Record<string, { label: string; bg: string; border: string; color: string }> = {
  in_stock: { label: 'متاح بالمخزن', bg: '#ecfdf5', border: '#a7f3d0', color: '#065f46' },
  sold: { label: 'تم البيع للعميل', bg: '#f0f9ff', border: '#bae6fd', color: '#0369a1' },
  returned: { label: 'مرتجع', bg: '#f8fafc', border: '#e2e8f0', color: '#475569' },
  under_repair: { label: 'قيد الصيانة', bg: '#fffbeb', border: '#fde68a', color: '#92400e' },
  defective: { label: 'معيب / تالف', bg: '#fff1f2', border: '#fecdd3', color: '#9f1239' },
};

export function ImeiHistoryPage() {
  const { t: __t } = useTranslation();
  const settingsQuery = useSettingsQuery();
  const profile = getMaintenanceProfile(settingsQuery.data?.maintenanceProfile);

  const [searchInput, setSearchInput] = useState('');
  const [activeSerial, setActiveSerial] = useState('');
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [recentLookups, setRecentLookups] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('zm_recent_imei_lookups');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useAppToolbar([{ label: `سجل وتتبع ${profile.shortTitle} والسيريالات` }]);

  const { data: serialItem } = useQuery<LookupSerialItem | null>({
    queryKey: ['imei-history-serial', activeSerial],
    queryFn: () => (activeSerial ? productSerialsApi.lookup(activeSerial) : Promise.resolve(null)),
    enabled: Boolean(activeSerial),
  });

  const { data: maintenanceData } = useQuery<MaintenanceListPageResponse>({
    queryKey: ['imei-history-maintenance', activeSerial],
    queryFn: () =>
      activeSerial
        ? maintenanceApi.list({ q: activeSerial })
        : Promise.resolve({ tickets: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } }),
    enabled: Boolean(activeSerial),
  });

  const { data: tradeinData } = useQuery<TradeInListPageResponse>({
    queryKey: ['imei-history-tradein', activeSerial],
    queryFn: () =>
      activeSerial
        ? tradeInApi.list({ q: activeSerial })
        : Promise.resolve({ transactions: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } }),
    enabled: Boolean(activeSerial),
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q) return;
    performLookup(q);
  };

  const performLookup = (serial: string) => {
    setActiveSerial(serial);
    setSearchInput(serial);
    setRecentLookups((prev) => {
      const updated = [serial, ...prev.filter((s) => s !== serial)].slice(0, 6);
      try {
        localStorage.setItem('zm_recent_imei_lookups', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const handleCopy = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const tickets: MaintenanceTicket[] = maintenanceData?.tickets || [];
  const tradeins: TradeInTransaction[] = tradeinData?.transactions || [];

  // LF-P4: the device's repair warranty is real data for the SAME device,
  // already loaded above (M2 P5 sets warranty_end on the ticket at first
  // repair). Take the latest one; never compute a warranty from thin air.
  const ticketWarrantyEnd =
    tickets
      .map((t) => (t as TicketWithWarranty).warrantyEnd)
      .filter((w): w is string => Boolean(w))
      .sort()
      .at(-1) || null;
  const warrantyEndDate = serialItem?.warrantyEndDate || ticketWarrantyEnd;
  const warrantyFromTicket = !serialItem?.warrantyEndDate && Boolean(ticketWarrantyEnd);
  // LF-P4: the header must never label a device "available in the public
  // record" when no serial row exists — a customer device under repair
  // is not stock. A registered row with no branch/location is an honest
  // "not recorded" (trade-in intake records none; see the backend spec).
  const retailPrice = serialItem?.productRetailPrice ?? null;
  const tradeInPrice = tradeins[0]?.agreedPurchasePrice ?? null;

  return (
    <div className="page-stack page-shell" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        <PageHeader
          title={`سجل وتتبع دورة حياة الأجهزة والسيريالات (${profile.serialLabel})`}
          description={__t('products.imei_history_page.s0', "استعلام شامل وفحص أمني عن أي سيريال أو باركود: تاريخ الشراء، فواتير البيع والعميل، الضمان، سجل الصيانة، وتجارة المستعمل.")}
        />

        {/* Big Search Bar - Calm Neutral Styling */}
        <div style={{ background: '#ffffff', padding: '16px 20px', borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                <Icons.Search />
              </span>
              <input
                type="text"
                dir="ltr"
                autoFocus
                className="purchase-prototype-field-input"
                placeholder={`امسح الباركود بالسكانر أو اكتب ${profile.serialLabel}...`}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                style={{ width: '100%', fontSize: '0.95rem', padding: '9px 36px 9px 12px', fontFamily: 'monospace', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <Button type="submit" variant="primary" style={{ padding: '0 24px', fontSize: '0.9rem', fontWeight: 700 }}>
              {__t('products.imei_history_page.s1', "فحص واستعلام")}
            </Button>
          </form>

          {/* Recent Lookups Quick Tags */}
          {recentLookups.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>{__t('products.imei_history_page.s2', "عمليات بحث حديثة:")}</span>
              {recentLookups.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => performLookup(s)}
                  style={{
                    background: activeSerial === s ? '#ffffff' : '#f8fafc',
                    border: '1px solid',
                    borderColor: activeSerial === s ? '#0f172a' : '#e2e8f0',
                    color: activeSerial === s ? '#0f172a' : '#475569',
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                    padding: '3px 8px',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                    transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Results Area */}
        {activeSerial ? (
          <div className="page-stack" style={{ gap: '14px', marginTop: '14px' }}>
            {/* 1. Device Overview Card */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 20px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>{__t('products.imei_history_page.s3', "بيانات ومواصفات الجهاز المستعلم عنه:")}</div>
                  <h3 style={{ margin: '4px 0 2px', fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>
                    {serialItem?.productName || (tradeins[0] ? `${tradeins[0].deviceBrand ? `${tradeins[0].deviceBrand} ` : ''}${tradeins[0].deviceModel}` : (tickets[0] ? `${tickets[0].deviceBrand ? `${tickets[0].deviceBrand} ` : ''}${tickets[0].deviceModel}` : __t('products.imei_history_page.s4', "جهاز غير مسجل كصنف مباشر")))}
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'monospace', fontSize: '0.85rem', color: '#475569', direction: 'ltr', textAlign: 'right', marginTop: '2px' }}>
                    <span>{profile.serialLabel}: <strong>{activeSerial}</strong></span>
                    <button
                      type="button"
                      onClick={(e) => handleCopy(activeSerial, e)}
                      title={__t('products.imei_history_page.s5', "نسخ السيريال")}
                      style={{ background: 'transparent', border: 'none', padding: 0, color: '#64748b', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
                    >
                      {copiedText === activeSerial ? <span style={{ fontSize: '0.68rem', color: '#16a34a', fontWeight: 700 }}>{__t('products.imei_history_page.s6', "تم النسخ")}</span> : <Icons.Copy />}
                    </button>
                    {serialItem?.imei2 && <span style={{ color: '#64748b', marginInlineStart: '12px' }}>IMEI 2: {serialItem.imei2}</span>}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <Button variant="secondary" onClick={() => window.print()} style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Icons.Printer />
                    <span>{__t('products.imei_history_page.s7', "طباعة تقرير الفحص")}</span>
                  </Button>
                  {serialItem && (
                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: '5px',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        background: statusMap[serialItem.status]?.bg || '#f8fafc',
                        border: `1px solid ${statusMap[serialItem.status]?.border || '#e2e8f0'}`,
                        color: statusMap[serialItem.status]?.color || '#475569',
                      }}
                    >
                      {statusMap[serialItem.status]?.label || serialItem.status}
                    </span>
                  )}
                </div>
              </div>

              {/* LF-P4: a device with no serial row is NOT in stock. Say so
                  plainly instead of the old generic availability label — a
                  customer device under repair must never read as available
                  inventory. */}
              {!serialItem && (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px 12px', marginBottom: '14px', fontSize: '0.85rem', color: '#92400e' }}>
                  <strong>{__t('products.imei_history_page.s40', "هذا الجهاز غير مسجَّل في سجل السيريالات")}</strong>
                  <span>
                    {' — '}
                    {tickets.length > 0
                      ? __t('products.imei_history_page.s41', "جهاز عميل له سجل صيانة — وليس مخزوناً متاحاً للبيع.")
                      : tradeins.length > 0
                        ? __t('products.imei_history_page.s42', "له سجل شراء مستعمل دون تسجيل سيريال.")
                        : __t('products.imei_history_page.s43', "لا توجد بيانات مسجَّلة عن هذا السيريال.")}
                  </span>
                </div>
              )}

              {/* Specs & History Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', fontSize: '0.85rem' }}>
                <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ color: '#64748b', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                    <Icons.Warehouse />
                    <span>{__t('products.imei_history_page.s8', "الموقع الحالي / الفرع:")}</span>
                  </div>
                  <strong style={{ color: '#0f172a' }}>
                    {serialItem
                      ? serialItem.locationName ||
                        serialItem.branchName ||
                        __t('products.imei_history_page.s46', "لم يُسجَّل الموقع / الفرع")
                      : __t('products.imei_history_page.s44', "غير مسجَّل في سجل السيريالات")}
                  </strong>
                  {!serialItem && tickets.length > 0 && (
                    <div style={{ color: '#475569', fontSize: '0.78rem', marginTop: '1px' }}>
                      {__t('products.imei_history_page.s45', "جهاز عميل — ليس مخزوناً متاحاً")}
                    </div>
                  )}
                </div>

                {/* LF-P4: the price the backend already returned but the
                    header never rendered. Retail price when the serial row
                    exists; the trade-in agreed purchase price (labelled as
                    such) only when no serial row exists; never invented. */}
                <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ color: '#64748b', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                    <Icons.Tag />
                    <span>{__t('products.imei_history_page.s47', "سعر البيع (تجزئة):")}</span>
                  </div>
                  {retailPrice != null ? (
                    <strong style={{ color: '#0f172a' }}>
                      {retailPrice.toFixed(2)} <CurrencySymbol />
                    </strong>
                  ) : tradeInPrice != null ? (
                    <>
                      <strong style={{ color: '#0f172a' }}>
                        {tradeInPrice.toFixed(2)} <CurrencySymbol />
                      </strong>
                      <div style={{ color: '#475569', fontSize: '0.78rem', marginTop: '1px' }}>
                        {__t('products.imei_history_page.s48', "سعر الشراء المستعمل (لا يوجد سعر بيع مسجَّل)")}
                      </div>
                    </>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>{__t('products.imei_history_page.s49', "لا يوجد سعر مسجَّل")}</span>
                  )}
                </div>

                <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ color: '#64748b', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                    <Icons.Package />
                    <span>{__t('products.imei_history_page.s10', "فاتورة وتاريخ الشراء:")}</span>
                  </div>
                  <strong style={{ color: '#0f172a' }}>{serialItem?.purchaseDocNo || (tradeins[0] ? `إقرار شراء ${tradeins[0].docNo}` : '—')}</strong>
                  {serialItem?.supplierName && <div style={{ color: '#475569', fontSize: '0.78rem', marginTop: '1px' }}>{__t('products.imei_history_page.s11', "المورد:")} {serialItem.supplierName}</div>}
                  {!serialItem?.supplierName && tradeins[0] && <div style={{ color: '#475569', fontSize: '0.78rem', marginTop: '1px' }}>{__t('products.imei_history_page.s12', "البائع:")} {tradeins[0].sellerName}</div>}
                </div>

                <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ color: '#64748b', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                    <Icons.Cart />
                    <span>{__t('products.imei_history_page.s13', "فاتورة وتاريخ البيع:")}</span>
                  </div>
                  <strong style={{ color: '#0f172a' }}>{serialItem?.saleDocNo || __t('products.imei_history_page.s14', "لم يتم بيعه بعد")}</strong>
                  {serialItem?.customerName && (
                    <div style={{ color: '#475569', fontSize: '0.78rem', marginTop: '1px' }}>
                      {__t('products.imei_history_page.s15', "العميل:")} {serialItem.customerName} {serialItem.customerPhone ? `(${serialItem.customerPhone})` : ''}
                    </div>
                  )}
                </div>

                <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ color: '#64748b', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                    <Icons.Shield />
                    <span>{__t('products.imei_history_page.s16', "موقف الضمان:")}</span>
                  </div>
                  {/* LF-P4: warranty from the serial row when set, else the
                      device's latest repair warranty from its tickets
                      (real data, same device); honest "not recorded" when
                      neither has one — never a computed or assumed date. */}
                  {warrantyEndDate ? (
                    <>
                      <strong style={{ color: new Date(warrantyEndDate) >= new Date() ? '#166534' : '#9f1239' }}>
                        {new Date(warrantyEndDate) >= new Date() ? __t('products.imei_history_page.s17', "ساري حتى: ") : __t('products.imei_history_page.s18', "منتهي في: ")}
                        {new Date(warrantyEndDate).toLocaleDateString('ar-EG')}
                      </strong>
                      {warrantyFromTicket && (
                        <div style={{ color: '#475569', fontSize: '0.78rem', marginTop: '1px' }}>
                          {__t('products.imei_history_page.s50', "ضمان الصيانة (آخر إصلاح)")}
                        </div>
                      )}
                    </>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>{__t('products.imei_history_page.s51', "لا يوجد ضمان مسجَّل")}</span>
                  )}
                </div>
              </div>
            </div>

            {/* 2. Maintenance History */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 20px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
              <h4 style={{ margin: '0 0 10px', fontSize: '0.95rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Icons.Wrench />
                <span>{__t('products.imei_history_page.s19', "سجل عمليات الصيانة لهذا الجهاز (")}{tickets.length})</span>
              </h4>
              {tickets.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: '0.8rem', padding: '12px 0' }}>{__t('products.imei_history_page.s20', "لا توجد سجلات صيانة مسجلة لهذا الجهاز.")}</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem', textAlign: 'right' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.78rem', fontWeight: 700 }}>
                      <th style={{ padding: '8px 12px' }}>{__t('products.imei_history_page.s21', "رقم التذكرة")}</th>
                      <th style={{ padding: '8px 12px' }}>{__t('products.imei_history_page.s22', "العميل")}</th>
                      <th style={{ padding: '8px 12px' }}>{__t('products.imei_history_page.s23', "العطل المشتكى منه")}</th>
                      <th style={{ padding: '8px 12px' }}>{__t('products.imei_history_page.s24', "الحالة")}</th>
                      <th style={{ padding: '8px 12px' }}>{__t('products.imei_history_page.s25', "التكلفة")}</th>
                      <th style={{ padding: '8px 12px' }}>{__t('products.imei_history_page.s26', "التاريخ")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map((t: MaintenanceTicket) => (
                      <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 700, fontFamily: 'monospace', color: '#0f172a' }}>{t.ticketNo}</td>
                        <td style={{ padding: '8px 12px' }}>{t.customerName}</td>
                        <td style={{ padding: '8px 12px' }}>{t.problemDescription}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{ padding: '2px 6px', borderRadius: '4px', background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: '0.75rem', fontWeight: 600 }}>
                            {t.status}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', fontWeight: 700, color: '#0f172a' }}>{(t.finalCost || t.expectedCost).toFixed(2)} <CurrencySymbol /></td>
                        <td style={{ padding: '8px 12px', color: '#64748b' }}>{new Date(t.receivedAt).toLocaleDateString('ar-EG')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* 3. Trade-In History */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 20px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
              <h4 style={{ margin: '0 0 10px', fontSize: '0.95rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Icons.Exchange />
                <span>{__t('products.imei_history_page.s27', "سجلات الشراء المستعمل وعقود التنازل (")}{tradeins.length})</span>
              </h4>
              {tradeins.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: '0.8rem', padding: '12px 0' }}>{__t('products.imei_history_page.s28', "لا توجد عمليات شراء مستعمل مسجلة لهذا السيريال.")}</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem', textAlign: 'right' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.78rem', fontWeight: 700 }}>
                      <th style={{ padding: '8px 12px' }}>{__t('products.imei_history_page.s29', "رقم الإيصال")}</th>
                      <th style={{ padding: '8px 12px' }}>{__t('products.imei_history_page.s30', "البائع")}</th>
                      <th style={{ padding: '8px 12px' }}>{__t('products.imei_history_page.s31', "الرقم القومي")}</th>
                      <th style={{ padding: '8px 12px' }}>{__t('products.imei_history_page.s32', "سعر الشراء")}</th>
                      <th style={{ padding: '8px 12px' }}>{__t('products.imei_history_page.s33', "التاريخ")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tradeins.map((tr: TradeInTransaction) => (
                      <tr key={tr.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 700, fontFamily: 'monospace', color: '#0f172a' }}>{tr.docNo}</td>
                        <td style={{ padding: '8px 12px' }}>{tr.sellerName}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace' }} dir="ltr">{tr.sellerNationalId}</td>
                        <td style={{ padding: '8px 12px', fontWeight: 700, color: '#0f172a' }}>{tr.agreedPurchasePrice.toFixed(2)} <CurrencySymbol /></td>
                        <td style={{ padding: '8px 12px', color: '#64748b' }}>{new Date(tr.createdAt).toLocaleDateString('ar-EG')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : (
          /* Explanatory Empty State Grid - Calm Cards */
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px', marginTop: '16px' }}>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '18px 20px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
              <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', marginBottom: '12px' }}>
                <Icons.Cart />
              </div>
              <h4 style={{ margin: '0 0 6px', fontSize: '0.95rem', fontWeight: 800, color: '#0f172a' }}>{__t('products.imei_history_page.s34', "1. تتبع المخزون وفواتير البيع")}</h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', lineHeight: 1.5 }}>
                {__t('products.imei_history_page.s35', "معرفة فاتورة شراء الجهاز من المورد، تاريخ البيع للعميل، الفرع الحالي، وفترة سريان الضمان الفعلي.")}
              </p>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '18px 20px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
              <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', marginBottom: '12px' }}>
                <Icons.Wrench />
              </div>
              <h4 style={{ margin: '0 0 6px', fontSize: '0.95rem', fontWeight: 800, color: '#0f172a' }}>{__t('products.imei_history_page.s36', "2. أرشيف الصيانة والإصلاح")}</h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', lineHeight: 1.5 }}>
                {__t('products.imei_history_page.s37', "سجل تذاكر الصيانة السابقة للجهاز، الأعطال المشتكى منها، وقطع الغيار المستبدلة وتواريخ استلامه.")}
              </p>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '18px 20px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
              <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', marginBottom: '12px' }}>
                <Icons.Exchange />
              </div>
              <h4 style={{ margin: '0 0 6px', fontSize: '0.95rem', fontWeight: 800, color: '#0f172a' }}>{__t('products.imei_history_page.s38', "3. تجارة المستعمل وعقود التنازل")}</h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', lineHeight: 1.5 }}>
                {__t('products.imei_history_page.s39', "سجل شراء الجهاز كمستعمل (Trade-In)، بيانات البائع الأصلي ورقمه القومي، وعقد التنازل الأمني.")}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
