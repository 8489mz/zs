import { createPortal } from 'react-dom';
import { getGlobalCurrencySymbol, isKuwait, isSaudi } from '@/lib/currencies';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/shared/ui/button';
import { isTerminalApprovalLive } from './pos-terminal-charge-safety';
import { useIsMobile } from '@/shared/hooks/use-is-mobile';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import type { DeliveryRep } from '@/shared/api/delivery-reps.api';

export function PosCheckoutOrderTypeSection({
  pos,
  onDeliverySelected
}: {
  pos: PosWorkspaceState;
  onDeliverySelected?: () => void;
}) {
  const currentSettings = pos.settingsQuery?.data;
  const isRestaurant = currentSettings?.restaurantModuleEnabled === true;
  const isKwdStore = isKuwait(currentSettings);
  const isKsaStore = isSaudi(currentSettings);

  // The pager field is strictly for restaurants in Kuwait/Saudi, or if explicitly enabled by the restaurant
  const showPager = isRestaurant && pos.orderType !== 'delivery' && (isKwdStore || isKsaStore || Boolean(currentSettings?.enableGuestPagers));
  // INV-REST-PAID-GATES-2 (R4-D, I40): the order type drives the
  // service charge, so it is a total-changing input — frozen while a
  // terminal approval is live.
  const isTerminalApproved = isTerminalApprovalLive(pos.terminalPaymentDetails);

  return (
    <div style={{ display: 'flex', gap: '8px', width: '100%', alignItems: 'center', flexShrink: 0 }}>
      <Button
        type="button"
        variant={pos.orderType === 'takeaway' || !pos.orderType ? 'primary' : 'secondary'}
        onClick={() => pos.setOrderType('takeaway')}
        disabled={isTerminalApproved}
        style={{ flex: 1, height: '34px', minHeight: '34px', maxHeight: '34px', fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap', boxSizing: 'border-box' }}
      >
        {isRestaurant ? 'تيك أواي' : 'بيع مباشر (استلام)'}
      </Button>
      <Button 
        type="button" 
        variant={pos.orderType === 'delivery' ? 'primary' : 'secondary'} 
        onClick={() => {
          pos.setOrderType('delivery');
          if (pos.orderType !== 'delivery') {
            onDeliverySelected?.();
          }
        }}
        disabled={isTerminalApproved}
        style={{ flex: 1, height: '34px', minHeight: '34px', maxHeight: '34px', fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap', boxSizing: 'border-box' }}
      >
        دليفري (توصيل)
      </Button>
      {isRestaurant && (
        <Button
          type="button"
          variant={pos.orderType === 'dine_in' ? 'primary' : 'secondary'}
          onClick={() => pos.setOrderType('dine_in')}
          disabled={isTerminalApproved}
          style={{ flex: 1, height: '34px', minHeight: '34px', maxHeight: '34px', fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap', boxSizing: 'border-box' }}
        >
          صالة (طاولات)
        </Button>
      )}
      {showPager && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            padding: '2px 8px',
            height: '38px',
            boxSizing: 'border-box',
          }}
        >
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' }}>البيجر:</span>
          <input
            type="text"
            value={(pos as any).pagerNumber || ''}
            onChange={(e) => (pos as any).setPagerNumber?.(e.target.value)}
            placeholder="رقم البيجر..."
            style={{
              width: '90px',
              height: '28px',
              padding: '0 6px',
              fontSize: '12px',
              fontWeight: 800,
              border: '1px solid #e2e8f0',
              borderRadius: '4px',
              textAlign: 'center',
              background: '#f8fafc',
            }}
          />
        </div>
      )}
    </div>
  );
}

export function PosCheckoutDeliverySection({ pos, deliveryReps, isMobile: isMobileProp }: { pos: PosWorkspaceState, deliveryReps: DeliveryRep[], isMobile?: boolean }) {
  const isMobileHook = useIsMobile(860);
  const isMobile = isMobileProp ?? isMobileHook;
  const currentSettings = pos.settings || pos.settingsQuery?.data;
  const isKwdStore = isKuwait(currentSettings);
  const isKsaStore = isSaudi(currentSettings);
  // INV-REST-PAID-GATES-2 (R4-D, I40): the delivery fee is a
  // total-changing input — frozen while a terminal approval is live.
  const isTerminalApproved = isTerminalApprovalLive(pos.terminalPaymentDetails);

  const deliveryChannels = isKwdStore
    ? [
        { id: 'direct', label: 'مباشر (المحل)' },
        { id: 'talabat', label: 'طلبات Talabat' },
        { id: 'deliveroo', label: 'دليفرو Deliveroo' },
        { id: 'jahez', label: 'جاهز Jahez' },
        { id: 'cari', label: 'كاري Cari' },
      ]
    : isKsaStore
    ? [
        { id: 'direct', label: 'مباشر (المحل)' },
        { id: 'jahez', label: 'جاهز Jahez' },
        { id: 'hungerstation', label: 'هنقرستيشن Hungerstation' },
        { id: 'toyou', label: 'تويو ToYou' },
        { id: 'mrsool', label: 'مرسول Mrsool' },
      ]
    : [
        { id: 'direct', label: 'مباشر (المحل)' },
        { id: 'talabat', label: 'طلبات Talabat' },
      ];

  const [repSearchOpen, setRepSearchOpen] = useState(false);
  const [repSearchQuery, setRepSearchQuery] = useState('');
  const inputContainerRef = useRef<HTMLDivElement | null>(null);
  const dropdownPortalRef = useRef<HTMLDivElement | null>(null);
  const [dropdownCoords, setDropdownCoords] = useState<{ top: number; left: number; width: number } | null>(null);

  const activeReps = deliveryReps.filter((r) => r.is_active);
  const selectedRep = activeReps.find((r) => String(r.id) === String(pos.deliveryRepId));
  const filteredReps = activeReps.filter(r => r.name.toLowerCase().includes(repSearchQuery.toLowerCase()) || r.phone?.includes(repSearchQuery));

  const updateDropdownCoords = useCallback(() => {
    if (!inputContainerRef.current) return;
    const rect = inputContainerRef.current.getBoundingClientRect();
    setDropdownCoords({
      top: Math.round(rect.bottom + 4),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
    });
  }, []);

  useEffect(() => {
    if (!repSearchOpen) {
      setDropdownCoords(null);
      return;
    }
    updateDropdownCoords();
    const handleViewportChange = () => {
      updateDropdownCoords();
    };
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [repSearchOpen, updateDropdownCoords]);

  useEffect(() => {
    if (!repSearchOpen) return;
    const handleDocumentMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        inputContainerRef.current && !inputContainerRef.current.contains(target) &&
        dropdownPortalRef.current && !dropdownPortalRef.current.contains(target)
      ) {
        setRepSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, [repSearchOpen]);

  const handleClearRep = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    pos.setDeliveryRepId('');
    pos.setDeliveryFeeMode('store_fleet');
    setRepSearchQuery('');
    setRepSearchOpen(false);
  };

  const handleSelectRep = (repId: string, repType?: string) => {
    pos.setDeliveryRepId(repId);
    if (repType === 'store_fleet') {
      pos.setDeliveryFeeMode('store_fleet');
    } else if (repType === 'freelance') {
      pos.setDeliveryFeeMode('freelance_courier');
    }
    setRepSearchQuery('');
    setRepSearchOpen(false);
  };

  if (pos.orderType !== 'delivery') return null;

  const isRepRequired = pos.collectionStatus === 'cod';
  const isRepMissing = isRepRequired && !selectedRep;

  return (
    <div
      className="pos-checkout-delivery-card"
      style={{
        display: 'grid',
        gap: '4px',
        background: '#fff',
        padding: '6px 9px',
        borderRadius: '8px',
        border: '1px solid #cbd5e1',
        marginBottom: 0,
        boxSizing: 'border-box',
        flexShrink: 0,
        width: '100%'
      }}
    >
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? 'minmax(0, 1fr) 110px' : 'minmax(0, 2fr) minmax(0, 1fr)',
        gap: '8px',
        alignItems: 'end',
        width: '100%',
        boxSizing: 'border-box'
      }}>
        <div style={{ position: 'relative', minWidth: 0 }}>
          <label className="field" style={{ margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: isRepMissing ? '#dc2626' : '#64748b', marginBottom: '2px', height: '20px', minHeight: '20px', maxHeight: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', whiteSpace: 'nowrap', overflow: 'hidden', boxSizing: 'border-box' }}>
              <span>مندوب التوصيل {isRepRequired ? <span style={{ color: '#dc2626' }}>*</span> : <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '11px' }}>(اختياري)</span>}</span>
              {selectedRep && (
                <button
                  type="button"
                  onMouseDown={handleClearRep}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#ef4444',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: '0 4px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '2px'
                  }}
                  title="مسح المندوب"
                >
                  ✕ إلغاء المندوب
                </button>
              )}
            </span>
            <div ref={inputContainerRef} style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center' }}>
              <input
                placeholder={selectedRep?.name || (isRepRequired ? "-- اختر مندوب التوصيل --" : "-- مندوب التوصيل (اختياري) --")}
                value={repSearchOpen ? repSearchQuery : (selectedRep?.name || '')}
                onFocus={() => {
                  setRepSearchOpen(true);
                  updateDropdownCoords();
                }}
                onClick={() => {
                  setRepSearchOpen(true);
                  updateDropdownCoords();
                }}
                onChange={(e) => {
                  setRepSearchQuery(e.target.value);
                  if (!repSearchOpen) setRepSearchOpen(true);
                  updateDropdownCoords();
                }}
                style={{
                  boxSizing: 'border-box',
                  padding: selectedRep ? '3px 34px 3px 30px' : '3px 30px 3px 10px',
                  height: '32px',
                  width: '100%',
                  minWidth: 0,
                  borderRadius: '6px',
                  border: isRepMissing ? '1.5px solid #ef4444' : '1.5px solid #cbd5e1',
                  background: isRepMissing ? '#fff5f5' : 'white',
                  fontSize: '12.5px',
                  fontWeight: selectedRep && !repSearchOpen ? 800 : 500,
                  color: selectedRep && !repSearchOpen ? '#0f172a' : 'inherit',
                  cursor: 'pointer'
                }}
              />
              {selectedRep && (
                <button
                  type="button"
                  onMouseDown={handleClearRep}
                  style={{
                    position: 'absolute',
                    left: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: '#fee2e2',
                    border: 'none',
                    borderRadius: '50%',
                    width: '22px',
                    height: '22px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#dc2626',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: 900,
                    zIndex: 2
                  }}
                  title="مسح المندوب"
                >
                  ✕
                </button>
              )}
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setRepSearchOpen(prev => {
                    const next = !prev;
                    if (next) updateDropdownCoords();
                    return next;
                  });
                }}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '4px',
                  zIndex: 2
                }}
                title={repSearchOpen ? 'إغلاق القائمة' : 'فتح قائمة المناديب'}
              >
                {repSearchOpen ? '▲' : '▼'}
              </button>
            </div>
          </label>

          {repSearchOpen && dropdownCoords && typeof document !== 'undefined' && createPortal(
            <div 
              ref={dropdownPortalRef}
              style={{ 
                position: 'fixed',
                top: `${dropdownCoords.top}px`,
                left: `${dropdownCoords.left}px`,
                width: `${dropdownCoords.width}px`,
                background: '#ffffff',
                border: '1.5px solid #cbd5e1', 
                borderRadius: '8px',
                zIndex: 100000,
                maxHeight: '230px', 
                overflowY: 'auto',
                boxShadow: '0 12px 32px rgba(15, 23, 42, 0.25), 0 4px 12px rgba(0, 0, 0, 0.1)',
                boxSizing: 'border-box',
              }}
              dir="rtl"
            >
              {selectedRep && (
                <div
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    borderBottom: '1.5px dashed #fecaca',
                    background: '#fff5f5',
                    color: '#dc2626',
                    fontSize: '12px',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                  onMouseDown={handleClearRep}
                >
                  <span>✕ إلغاء تحديد المندوب (حذف)</span>
                  <span style={{ fontSize: '11px', color: '#991b1b', fontWeight: 500 }}>مسح المندوب الحالي</span>
                </div>
              )}

              {filteredReps.length === 0 && (
                <div style={{ padding: '10px 12px', color: '#dc2626', fontSize: '12px', fontWeight: 600 }}>
                  {activeReps.length === 0 ? 'لا يوجد مناديب مسجلين بالنظام' : 'لا توجد نتائج مطابقة'}
                </div>
              )}
              {filteredReps.map(rep => (
                <div 
                  key={rep.id}
                  style={{ 
                    padding: '8px 12px', cursor: 'pointer', 
                    borderBottom: '1px solid #f1f5f9',
                    background: String(rep.id) === String(pos.deliveryRepId) ? '#eff6ff' : '#ffffff',
                    color: String(rep.id) === String(pos.deliveryRepId) ? '#170c5c' : '#334155',
                    fontSize: '13px',
                    fontWeight: String(rep.id) === String(pos.deliveryRepId) ? 800 : 500,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectRep(String(rep.id), (rep as any).rep_type);
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                  onMouseLeave={(e) => {
                    if (String(rep.id) !== String(pos.deliveryRepId)) e.currentTarget.style.background = '#ffffff';
                    else e.currentTarget.style.background = '#eff6ff';
                  }}
                >
                  <div>
                    <span>{rep.name}</span>
                    {rep.phone ? <span style={{ color: '#94a3b8', fontSize: '11px', marginRight: '6px' }}>({rep.phone})</span> : null}
                    {(rep as any).rep_type === 'store_fleet' ? <span style={{ color: '#059669', fontSize: '10px', marginRight: '6px', background: '#ecfdf5', padding: '1px 6px', borderRadius: '4px' }}>أسطول المحل</span> : null}
                  </div>
                  {String(rep.id) === String(pos.deliveryRepId) && (
                    <span style={{ color: '#10b981', fontSize: '12px', fontWeight: 900 }}>✓ محدد</span>
                  )}
                </div>
              ))}
            </div>,
            document.body
          )}
        </div>

        <div className="field" style={{ margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', marginBottom: '2px', height: '20px', minHeight: '20px', maxHeight: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', boxSizing: 'border-box' }}>رسوم التوصيل ({getGlobalCurrencySymbol()})</span>
          <input
            className="no-spin-arrows"
            type="number"
            min="0"
            step="0.01"
            value={pos.deliveryFee === 0 ? '' : pos.deliveryFee}
            onWheel={(e) => e.currentTarget.blur()}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(event) => pos.setDeliveryFee(Number(event.target.value || 0))}
            disabled={isTerminalApproved}
            placeholder="0"
            style={{ boxSizing: 'border-box', padding: '3px 8px', height: '32px', width: '100%', minWidth: 0, borderRadius: '6px', border: '1.5px solid #cbd5e1', fontWeight: 700, fontSize: '13.5px', textAlign: 'center' }}
          />
        </div>
      </div>

      {/* Aggregator / Channel Source Tag Selector */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', minWidth: 0 }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b' }}>
          مصدر طلب التوصيل (قناة الاستلام):
        </span>
        <div
          className="pos-checkout-channels-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexWrap: 'nowrap',
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            paddingBottom: '2px',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          {deliveryChannels.map((channel) => {
            const isSelected = channel.id === 'direct'
              ? !deliveryChannels.filter(c => c.id !== 'direct').some(c => (pos.note || '').includes(c.label.split(' ')[0]))
              : (pos.note || '').includes(channel.label.split(' ')[0]);

            return (
              <button
                key={channel.id}
                type="button"
                className="pos-checkout-channel-btn"
                onClick={() => {
                  const hadPlatformTag = (pos.note || '') !== (pos.note || '').replace(/\[(مصدر|منصة|قناة):[^\]]+\]/g, '') ||
                    deliveryChannels.filter(c => c.id !== 'direct').some(c => (pos.note || '').includes(c.label.split(' ')[0]));
                  let nextNote = (pos.note || '').replace(/\[(مصدر|منصة|قناة):[^\]]+\]/g, '').trim();
                  deliveryChannels.filter(c => c.id !== 'direct').forEach(c => {
                    nextNote = nextNote.replace(new RegExp(`\\[?منصة:?\\s*${c.label.split(' ')[0]}[^\\]]*\\]?`, 'gi'), '').trim();
                  });
                  if (channel.id !== 'direct') {
                    nextNote = `[منصة: ${channel.label}] ${nextNote}`.trim();
                    // Auto-set collection to prepaid_online because customers pay through the aggregator app
                    pos.setCollectionStatus('prepaid_online');
                    pos.setPaymentChannel('wallet');
                    pos.setTransferAmount(Number(pos.totals.total || 0));
                    pos.setCashAmount(0);
                    pos.setCardAmount(0);
                  } else if (hadPlatformTag && pos.collectionStatus === 'prepaid_online') {
                    pos.setCollectionStatus('cod');
                    pos.setPaymentChannel('cash');
                    pos.setTransferAmount(0);
                    pos.setCashAmount(0);
                    pos.setCardAmount(0);
                  }
                  pos.setNote(nextNote);
                }}
                style={{
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                  display: 'inline-flex',
                  alignItems: 'center',
                  height: '28px',
                  padding: isMobile ? '0 8px' : '0 10px',
                  borderRadius: '6px',
                  fontSize: isMobile ? '11px' : '12px',
                  fontWeight: 700,
                  border: isSelected ? '1.5px solid #170e5e' : '1.5px solid #cbd5e1',
                  background: isSelected ? '#170e5e' : '#f8fafc',
                  color: isSelected ? '#ffffff' : '#334155',
                  cursor: 'pointer',
                  transition: 'none',
                  boxSizing: 'border-box',
                }}
              >
                {channel.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: isMobile ? '4px' : '8px', width: '100%', boxSizing: 'border-box' }}>
        {(['cod', 'prepaid_by_rep', 'prepaid_online'] as const).map((status) => (
          <Button
            key={status}
            type="button"
            variant={pos.collectionStatus === status ? 'primary' : 'secondary'}
            onClick={() => {
              pos.setCollectionStatus(status);
              if (status === 'cod') {
                pos.setPaymentChannel('cash');
                pos.setCashAmount(0);
                pos.setCardAmount(0);
                pos.setTransferAmount(0);
              } else if (status === 'prepaid_by_rep') {
                pos.setPaymentChannel('cash');
                pos.setCashAmount(Number(pos.totals.total || 0));
                pos.setCardAmount(0);
                pos.setTransferAmount(0);
              } else if (status === 'prepaid_online') {
                pos.setPaymentChannel('wallet');
                pos.setTransferAmount(Number(pos.totals.total || 0));
                pos.setCashAmount(0);
                pos.setCardAmount(0);
              }
            }}
            style={{
              fontSize: isMobile ? '11px' : '12px',
              padding: isMobile ? '0 2px' : '0 4px',
              height: '32px',
              minHeight: '32px',
              maxHeight: '32px',
              fontWeight: 700,
              textAlign: 'center',
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
              boxSizing: 'border-box',
            }}
          >
            {status === 'cod' ? 'تحصيل من العميل' : status === 'prepaid_by_rep' ? 'خالص من المندوب' : 'خالص أونلاين'}
          </Button>
        ))}
      </div>

      {/* INV-REST-COD-COLLECTION-TRUTH (T11-D): the effective
       * collection status, in words, before confirm — the cashier
       * sees who holds the cash (courier / rep / gateway) instead of
       * discovering it on the posted invoice. An unstated status is
       * COD: the courier collects, nothing is prepaid. */}
      <div
        data-testid="pos-collection-status-summary"
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: '1px',
          width: '100%',
          height: '46px',
          minHeight: '46px',
          maxHeight: '46px',
          overflow: 'hidden',
          boxSizing: 'border-box',
          padding: '4px 8px',
          borderRadius: '6px',
          border: `1px solid ${pos.collectionStatus === 'cod' || !pos.collectionStatus ? '#fde68a' : '#bbf7d0'}`,
          background: pos.collectionStatus === 'cod' || !pos.collectionStatus ? '#fffbeb' : '#f0fdf4',
        }}
      >
        <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#170e5e', lineHeight: 1.2 }}>
          {`التحصيل: ${pos.collectionStatus === 'prepaid_by_rep' ? 'خالص من المندوب' : pos.collectionStatus === 'prepaid_online' ? 'خالص أونلاين' : 'تحصيل من العميل'}`}
        </span>
        <span style={{ fontSize: '10.5px', fontWeight: 600, color: '#475569', lineHeight: 1.25 }}>
          {pos.collectionStatus === 'prepaid_by_rep'
            ? 'المبلغ مع المندوب — لا يُحصَّل من العميل عند التسليم.'
            : pos.collectionStatus === 'prepaid_online'
              ? 'المبلغ مدفوع مسبقاً عبر القناة الإلكترونية — لا يُحصَّل من العميل عند التسليم.'
              : selectedRep
                ? `المندوب ${selectedRep.name} يحصّل المبلغ عند التسليم — لم يُسجَّل أي نقد بعد.`
                : 'المندوب يحصّل المبلغ عند التسليم — لم يُسجَّل أي نقد بعد. اختر المندوب قبل التأكيد.'}
        </span>
      </div>
    </div>
  );
}

