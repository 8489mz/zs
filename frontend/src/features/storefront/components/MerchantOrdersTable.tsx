import { useTranslation } from 'react-i18next';
import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { OnlineOrderRecord } from '../types/storefront.types';
import { deliveryRepsApi, type DeliveryRep } from '@/shared/api/delivery-reps.api';
import { toast } from '@/shared/components/system-alert';
import { DialogShell } from '@/shared/components/dialog-shell';
import { CustomSelect } from '@/shared/ui/custom-select';
import {
  PackageIcon,
  TruckIcon,
  CheckIcon,
  MapPinIcon,
  ChevronDownIcon,
} from '@/shared/components/icons/AppIcons';
import {
  shouldShowBostaShipping,
  shouldShowGccShipping,
} from '../lib/order-shipping-destination';
import { isThreeDecimalCurrency, getCurrencySymbol, getGlobalSystemCurrency } from '@/lib/currencies';

interface MerchantOrdersTableProps {
  orders: OnlineOrderRecord[];
  isLoading: boolean;
  onSelectOrder: (order: OnlineOrderRecord) => void;
  onConvertToDelivery: (order: OnlineOrderRecord) => void;
  onShipBosta: (order: OnlineOrderRecord) => void;
  onShipGcc: (order: OnlineOrderRecord) => void;
  onLoadToPos: (orderId: number) => void;
  loadingPosOrderId: number | null;
  onUpdateStatus: (id: number, status: string) => void;
  isUpdatingStatus: boolean;
  isBostaConfigured?: boolean;
  isGccConfigured?: boolean;
}

export function getStatusBadge(status: string, isEn = false) {
  switch (status) {
    case 'pending':
      return { label: isEn ? 'Pending / New' : 'جديد / قيد الانتظار', bg: '#fefce8', text: '#854d0e', border: '#fef08a' };
    case 'confirmed':
      return { label: isEn ? 'Confirmed' : 'تم التأكيد', bg: '#eff6ff', text: '#1e40af', border: '#bfdbfe' };
    case 'processing':
      return { label: isEn ? 'Processing' : 'جاري التجهيز', bg: '#f0f9ff', text: '#0369a1', border: '#bae6fd' };
    case 'shipped':
      return { label: isEn ? 'Out for Delivery' : 'خرج للتوصيل', bg: '#fff7ed', text: '#c2410c', border: '#ffedd5' };
    case 'delivered':
      return { label: isEn ? 'Delivered / Completed' : 'مكتمل / تم التسليم', bg: '#f0fdf4', text: '#15803d', border: '#dcfce7' };
    case 'cancelled':
      return { label: isEn ? 'Cancelled' : 'ملغي', bg: '#fef2f2', text: '#b91c1c', border: '#fee2e2' };
    default:
      return { label: status, bg: '#f8fafc', text: '#475569', border: '#e2e8f0' };
  }
}

function formatOrderTotal(amount: number, orderCurrency?: string | null): string {
  const code = orderCurrency || getGlobalSystemCurrency();
  const decimals = isThreeDecimalCurrency(code) ? 3 : (code === 'EGP' && amount % 1 === 0 ? 0 : 2);
  const symbol = getCurrencySymbol(code);
  return `${amount.toFixed(decimals)} ${symbol}`;
}

/* Resolves the rep already assigned to an order (at conversion) from the
 * active-rep list. The order record carries the rep name/phone but no rep id,
 * so the match is by exact name, tie-broken by phone when several active reps
 * share a name. Returns null when the assigned rep cannot be identified
 * unambiguously (renamed, deactivated, or never assigned) — the merchant then
 * picks a rep explicitly in the dispatch dialog instead of dispatching to a
 * guessed rep. */
export function resolveDispatchRepId(
  order: Pick<OnlineOrderRecord, 'deliveryRepName' | 'deliveryRepPhone'>,
  reps: DeliveryRep[],
): number | null {
  const activeReps = reps.filter((r) => (r as any).is_active !== false && (r as any).isActive !== false);
  const name = (order.deliveryRepName || '').trim();
  if (!name) return null;
  const byName = activeReps.filter((r) => (r.name || '').trim() === name);
  if (byName.length === 0) return null;
  if (byName.length === 1) return byName[0].id;
  const phone = (order.deliveryRepPhone || '').replace(/\D/g, '');
  if (!phone) return null;
  const byPhone = byName.filter((r) => (r.phone || '').replace(/\D/g, '') === phone);
  return byPhone.length === 1 ? byPhone[0].id : null;
}

/* Dispatches one invoiced online order through dispatchOrders (the same
 * endpoint the restaurant dispatcher modal uses), so online_orders.status
 * becomes 'shipped' AND the linked sale's delivery_status becomes
 * 'out_for_delivery' in one backend transaction. The old
 * updateOrderStatus(id, 'shipped') path only flipped the order row and left
 * the courier queue showing the order as pending collection (D-SF-05). */
function MerchantDispatchDialog({ order, onClose }: { order: OnlineOrderRecord; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedRepId, setSelectedRepId] = useState<number | ''>('');

  const repsQuery = useQuery({
    queryKey: ['delivery-reps'],
    queryFn: deliveryRepsApi.list,
    staleTime: 60 * 1000,
  });
  const reps: DeliveryRep[] = (repsQuery.data as any) || [];
  const activeReps = useMemo(
    () => reps.filter((r) => (r as any).is_active !== false && (r as any).isActive !== false),
    [repsQuery.data],
  );
  const resolvedRepId = useMemo(() => resolveDispatchRepId(order, reps), [order, repsQuery.data]);
  // A manual pick wins; otherwise the rep assigned at conversion is pre-selected.
  const effectiveRepId = selectedRepId !== '' ? selectedRepId : resolvedRepId ?? '';

  const dispatchMutation = useMutation({
    mutationFn: (repId: number) =>
      deliveryRepsApi.dispatchOrders({ repId, onlineOrderIds: [order.id] }),
    onSuccess: (data) => {
      toast.success(data?.message || t('storefront.merchant_orders_table.s41', 'تم تسليم الطلب للمندوب'));
      void queryClient.invalidateQueries({ queryKey: ['storefront-admin-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['storefront-admin-orders-counts'] });
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.message || t('storefront.merchant_orders_table.s42', 'تعذر تسليم الطلب للمندوب'));
    },
  });

  const repOptions = [
    { value: '', label: t('storefront.merchant_orders_table.s43', '-- اختر مندوب التوصيل --') },
    ...activeReps.map((r) => ({
      value: String(r.id),
      label: `${r.name}${r.phone ? ' (' + r.phone + ')' : ''}`,
    })),
  ];

  return (
    <DialogShell
      open
      onClose={onClose}
      width="min(500px, 95vw)"
      ariaLabel={`Dispatch order #${order.orderNumber} to courier`}
    >
      <div style={{ padding: '20px 24px', direction: 'rtl' }}>
        <h3 style={{ margin: 0, fontSize: '16.5px', fontWeight: 800, color: '#170e5e' }}>
          {t('storefront.merchant_orders_table.s44', 'تسليم الطلب #')}{order.orderNumber}
        </h3>
        <span style={{ fontSize: '12px', color: '#64748b' }}>
          {t('storefront.merchant_orders_table.s45', 'تسليم الطلب والفاتورة لمندوب التوصيل — تظهر الحالة "خرج للتوصيل" في قائمة التاجر وقائمة المندوب معاً.')}
        </span>

        <div style={{ marginTop: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 700, color: '#1e293b', marginBottom: '8px' }}>
            <TruckIcon size={14} color="#170e5e" />
            <span>{t('storefront.merchant_orders_table.s46', 'مندوب التوصيل:')}</span>
          </label>
          {repsQuery.isLoading ? (
            <div style={{ fontSize: '12.5px', color: '#64748b', padding: '8px 0' }}>
              {t('storefront.merchant_orders_table.s47', 'جاري تحميل قائمة المناديب...')}
            </div>
          ) : repsQuery.isError ? (
            <div style={{ fontSize: '12.5px', color: '#b91c1c', padding: '8px 0' }}>
              {t('storefront.merchant_orders_table.s48', 'تعذر تحميل قائمة المناديب — أغلق النافذة وأعد المحاولة.')}
            </div>
          ) : activeReps.length === 0 ? (
            <div style={{ fontSize: '12.5px', color: '#b91c1c', padding: '8px 0' }}>
              {t('storefront.merchant_orders_table.s49', 'لا يوجد مندوب توصيل نشط — فعّل مندوباً أولاً قبل التسليم.')}
            </div>
          ) : (
            <CustomSelect
              value={effectiveRepId ? String(effectiveRepId) : ''}
              onChange={(val) => setSelectedRepId(val ? Number(val) : '')}
              options={repOptions}
              placeholder={t('storefront.merchant_orders_table.s50', 'اختر مندوب التوصيل...')}
            />
          )}
          <span style={{ display: 'block', fontSize: '11px', color: '#64748b', marginTop: '6px', lineHeight: 1.4 }}>
            {order.deliveryRepName
              ? t('storefront.merchant_orders_table.s51', 'المندوب المعين عند إصدار الفاتورة:') + ` ${order.deliveryRepName}${order.deliveryRepPhone ? ' (' + order.deliveryRepPhone + ')' : ''}`
              : t('storefront.merchant_orders_table.s52', 'لم يتم تعيين مندوب عند إصدار الفاتورة — اختر مندوباً للتسليم.')}
            {resolvedRepId === null && order.deliveryRepName
              ? ' ' + t('storefront.merchant_orders_table.s53', '(تعذر مطابقة المندوب المعين مع قائمة المناديب النشطين — اختر مندوباً يدوياً.)')
              : ''}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '20px' }}>
          <button
            type="button"
            onClick={() => {
              if (effectiveRepId === '') return;
              dispatchMutation.mutate(effectiveRepId);
            }}
            disabled={effectiveRepId === '' || dispatchMutation.isPending || repsQuery.isLoading}
            style={{
              background: '#170e5e',
              color: '#ffffff',
              padding: '11px 16px',
              fontSize: '13.5px',
              fontWeight: 800,
              borderRadius: '9px',
              border: 'none',
              cursor: effectiveRepId === '' || dispatchMutation.isPending ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              boxShadow: '0 2px 5px rgba(23,14,94,0.25)',
              opacity: effectiveRepId === '' || dispatchMutation.isPending ? 0.6 : 1,
            }}
          >
            <TruckIcon size={14} color="#ffffff" />
            <span>{dispatchMutation.isPending ? t('storefront.merchant_orders_table.s54', 'جاري التسليم...') : t('storefront.merchant_orders_table.s55', 'تسليم للمندوب')}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#ffffff',
              border: '1.5px solid #cbd5e1',
              color: '#334155',
              padding: '10px 16px',
              fontSize: '13px',
              fontWeight: 700,
              borderRadius: '9px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span>{t('storefront.merchant_orders_table.s56', 'إلغاء')}</span>
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

function OrderShippingDropdown({
  order,
  isBostaConfigured = false,
  isGccConfigured = false,
  onConvertToDelivery,
  onShipBosta,
  onShipGcc,
}: {
  order: OnlineOrderRecord;
  isBostaConfigured?: boolean;
  isGccConfigured?: boolean;
  onConvertToDelivery: (order: OnlineOrderRecord) => void;
  onShipBosta: (order: OnlineOrderRecord) => void;
  onShipGcc: (order: OnlineOrderRecord) => void;
}) {
  const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);

  const showBosta = shouldShowBostaShipping(order, isBostaConfigured);
  const showGcc = shouldShowGccShipping(order, isGccConfigured);

  // If neither Bosta nor GCC courier is configured/applicable, render direct 1-click button for internal delivery representative!
  if (!showBosta && !showGcc) {
    return (
      <button
        type="button"
        onClick={() => onConvertToDelivery(order)}
        title={t('storefront.merchant_orders_table.s0', "إصدار فاتورة وتعيين مندوب توصيل داخلي")}
        style={{
          width: '100%',
          height: '32px',
          fontSize: '11px',
          fontWeight: 700,
          borderRadius: '7px',
          background: '#170e5e',
          color: '#ffffff',
          border: 'none',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          boxShadow: '0 1px 2px rgba(23,14,94,0.2)',
          boxSizing: 'border-box',
          padding: '0 6px',
        }}
      >
        <TruckIcon size={13} color="#ffffff" />
        <span>{t('storefront.merchant_orders_table.s1', "مندوب دليفري")}</span>
      </button>
    );
  }

  const updateCoords = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const menuWidth = 220;
    let left = rect.right - menuWidth;
    if (left < 10) left = 10;
    if (left + menuWidth > window.innerWidth - 10) {
      left = Math.max(10, window.innerWidth - menuWidth - 10);
    }
    const itemCount = 1 + (showBosta ? 1 : 0) + (showGcc ? 1 : 0);
    const estimatedHeight = 35 + itemCount * 46;
    let top = rect.bottom + 4;
    if (top + estimatedHeight > window.innerHeight) {
      top = Math.max(10, rect.top - estimatedHeight - 4);
    }
    setCoords({ top, left, width: menuWidth });
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOpen) {
      setIsOpen(false);
    } else {
      updateCoords();
      setIsOpen(true);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    const handleScroll = () => {
      setIsOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        title={t('storefront.merchant_orders_table.s2', "تحديد مسار الشحن والتوصيل")}
        style={{
          width: '100%',
          height: '32px',
          fontSize: '11px',
          fontWeight: 700,
          borderRadius: '7px',
          background: '#170e5e',
          color: '#ffffff',
          border: 'none',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          boxShadow: '0 1px 2px rgba(23,14,94,0.2)',
          boxSizing: 'border-box',
          padding: '0 6px',
        }}
      >
        <TruckIcon size={13} color="#ffffff" />
        <span>{t('storefront.merchant_orders_table.s3', "شحن وتوصيل")}</span>
        <ChevronDownIcon
          size={11}
          color="#ffffff"
          style={{
            transform: isOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s ease',
          }}
        />
      </button>

      {isOpen && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            width: coords.width,
            zIndex: 999999,
            background: '#ffffff',
            borderRadius: '10px',
            border: '1px solid #cbd5e1',
            boxShadow: '0 12px 30px -4px rgba(15, 23, 42, 0.18), 0 4px 12px -2px rgba(15, 23, 42, 0.08)',
            padding: '6px',
            direction: 'rtl',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            boxSizing: 'border-box',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontSize: '10.5px', fontWeight: 800, color: '#64748b', padding: '4px 8px 6px', borderBottom: '1px solid #f1f5f9' }}>
            {t('storefront.merchant_orders_table.s4', "توجيه الشحن والتسليم:")}
          </div>

          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              onConvertToDelivery(order);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 10px',
              borderRadius: '7px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'right',
              width: '100%',
              boxSizing: 'border-box',
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '6px',
                background: '#f0f3ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <TruckIcon size={14} color="#170e5e" />
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>{t('storefront.merchant_orders_table.s5', "مندوب دليفري داخلي")}</div>
              <div style={{ fontSize: '10.5px', color: '#64748b' }}>{t('storefront.merchant_orders_table.s6', "إصدار فاتورة وتعيين مندوب")}</div>
            </div>
          </button>

          {showBosta && (
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onShipBosta(order);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 10px',
                borderRadius: '7px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'right',
                width: '100%',
                boxSizing: 'border-box',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#fff1f2')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '6px',
                  background: '#ffe4e6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <PackageIcon size={14} color="#e11d48" />
              </div>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#e11d48' }}>{t('storefront.merchant_orders_table.s7', "شحن بوسطة إكسبريس")}</div>
                <div style={{ fontSize: '10.5px', color: '#64748b' }}>{t('storefront.merchant_orders_table.s8', "توليد بوليصة AWB مصر")}</div>
              </div>
            </button>
          )}

          {showGcc && (
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onShipGcc(order);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 10px',
                borderRadius: '7px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'right',
                width: '100%',
                boxSizing: 'border-box',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#fff7ed')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '6px',
                  background: '#ffedd5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <TruckIcon size={14} color="#ea580c" />
              </div>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#ea580c' }}>{t('storefront.merchant_orders_table.s9', "شحن خليجي (أرامكس / سمسا)")}</div>
                <div style={{ fontSize: '10.5px', color: '#64748b' }}>{t('storefront.merchant_orders_table.s10', "بوليصة دولية للسعودية والخليج")}</div>
              </div>
            </button>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

export function MerchantOrdersTable({
  orders,
  isLoading,
  onSelectOrder,
  onConvertToDelivery,
  onShipBosta,
  onShipGcc,
  onLoadToPos,
  loadingPosOrderId,
  onUpdateStatus,
  isUpdatingStatus,
  isBostaConfigured = false,
  isGccConfigured = false,
}: MerchantOrdersTableProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const [dispatchOrder, setDispatchOrder] = useState<OnlineOrderRecord | null>(null);
  if (isLoading) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: '#64748b' }}>
        {t('storefront.merchant_orders_table.s11', "جاري تحميل الطلبات...")}
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748b' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px', color: '#94a3b8' }}>
          <PackageIcon size={44} />
        </div>
        <h3 style={{ margin: '0 0 6px', fontSize: '16px', fontWeight: 700, color: '#1e293b' }}>
          {t('storefront.merchant_orders_table.s12', "لا توجد طلبات في هذا القسم")}
        </h3>
        <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
          {t('storefront.merchant_orders_table.s13', "عندما يطلب أي عميل من رابط متجرك سيظهر طلبه هنا فوراً مع تنبيه بالبيانات والمخزون.")}
        </p>
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '13px' }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
            <th style={{ padding: '12px 14px', fontWeight: 700, textAlign: 'center' }}>{t('storefront.merchant_orders_table.s14', "رقم الطلب")}</th>
            <th style={{ padding: '12px 14px', fontWeight: 700, textAlign: 'center' }}>{t('storefront.merchant_orders_table.s15', "العميل والهاتف")}</th>
            <th style={{ padding: '12px 14px', fontWeight: 700, textAlign: 'center' }}>{t('storefront.merchant_orders_table.s16', "عنوان التوصيل")}</th>
            <th style={{ padding: '12px 14px', fontWeight: 700, textAlign: 'center' }}>{t('storefront.merchant_orders_table.s17', "الأصناف")}</th>
            <th style={{ padding: '12px 14px', fontWeight: 700, textAlign: 'center' }}>{t('storefront.merchant_orders_table.s18', "الإجمالي")}</th>
            <th style={{ padding: '12px 14px', fontWeight: 700, textAlign: 'center' }}>{t('storefront.merchant_orders_table.s19', "الحالة")}</th>
            <th style={{ padding: '12px 14px', fontWeight: 700, textAlign: 'center', minWidth: isEn ? '364px' : '344px' }}>{t('storefront.merchant_orders_table.s20', "الإجراءات")}</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const badge = getStatusBadge(order.status, isEn);
            const cleanPhone = order.customerPhone.replace(/\D/g, '');
            const waPhone = cleanPhone.startsWith('01') ? `2${cleanPhone}` : cleanPhone;

            return (
              <tr
                key={order.id}
                style={{
                  borderBottom: '1px solid #f1f5f9',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#ffffff')}
              >
                <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', textAlign: 'center', verticalAlign: 'middle' }}>
                  <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '13px', direction: 'ltr', textAlign: 'center' }}>
                    #{order.orderNumber}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', textAlign: 'center' }}>
                    {new Date(order.createdAt).toLocaleDateString(isEn ? 'en-US' : 'ar-EG', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </td>
                <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', textAlign: 'center', verticalAlign: 'middle' }}>
                  <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '13px', textAlign: 'center' }}>{order.customerName}</div>
                  <div style={{ fontSize: '11.5px', color: '#64748b', direction: 'ltr', textAlign: 'center', marginTop: '1px' }}>
                    {order.customerPhone}
                  </div>
                </td>
                <td style={{ padding: '12px 14px', maxWidth: '180px', color: '#334155', textAlign: 'center', verticalAlign: 'middle' }}>
                  <div
                    style={{
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      fontSize: '12.5px',
                      textAlign: 'center',
                    }}
                    title={order.customerAddress === 'استلام ذاتي من الفرع' ? (isEn ? 'Self-pickup from branch' : 'استلام ذاتي من الفرع') : (order.customerAddress || '')}
                  >
                    {order.customerAddress === 'استلام ذاتي من الفرع' ? (isEn ? 'Self-pickup from branch' : 'استلام ذاتي من الفرع') : (order.customerAddress || t('storefront.merchant_orders_table.s21', "غير محدد"))}
                  </div>
                  {order.deliveryZoneName && (
                    <div
                      style={{
                        fontSize: '10.5px',
                        fontWeight: 700,
                        color: '#170e5e',
                        background: '#f0f3ff',
                        border: '1px solid #d8e0fc',
                        borderRadius: '4px',
                        padding: '1px 6px',
                        marginTop: '3px',
                        display: 'inline-block',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <MapPinIcon size={12} color="#170e5e" />
                        <span>{order.deliveryZoneName}</span>
                      </span>
                    </div>
                  )}
                </td>
                <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', textAlign: 'center', verticalAlign: 'middle' }}>
                  <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '12.5px', textAlign: 'center' }}>
                    {order.items.length} {t('storefront.merchant_orders_table.s22', "صنف")}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px', textAlign: 'center' }}>
                    ({order.items.reduce((acc, i) => acc + i.quantity, 0)} {t('storefront.merchant_orders_table.s23', "قطعة)")}
                  </div>
                </td>
                <td style={{ padding: '12px 14px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', fontSize: '13.5px', textAlign: 'center', verticalAlign: 'middle' }}>
                  {formatOrderTotal(order.totalAmount, order.currency)}
                </td>
                <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', textAlign: 'center', verticalAlign: 'middle' }}>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '3px 10px',
                      borderRadius: '999px',
                      background: badge.bg,
                      color: badge.text,
                      border: `1px solid ${badge.border}`,
                      whiteSpace: 'nowrap',
                      display: 'inline-block',
                    }}
                  >
                    {badge.label}
                  </span>
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'center', verticalAlign: 'middle' }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: isEn ? '112px 132px 64px 32px' : '102px 124px 58px 32px',
                      gap: '6px',
                      alignItems: 'center',
                      margin: '0 auto',
                      width: 'fit-content',
                    }}
                  >
                    {/* Col 1: Status / Invoice Badge */}
                    {order.status === 'cancelled' ? (
                      <span
                        style={{
                          width: '100%',
                          height: '32px',
                          fontSize: '11px',
                          fontWeight: 700,
                          borderRadius: '7px',
                          background: '#f8fafc',
                          color: '#64748b',
                          border: '1px solid #e2e8f0',
                          whiteSpace: 'nowrap',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxSizing: 'border-box',
                        }}
                      >
                        {t('storefront.merchant_orders_table.s24', "ملغي من العميل")}
                      </span>
                    ) : order.saleId ? (
                      <span
                        style={{
                          width: '100%',
                          height: '32px',
                          fontSize: '11.5px',
                          fontWeight: 700,
                          borderRadius: '7px',
                          background: '#f8fafc',
                          color: '#1e293b',
                          border: '1px solid #cbd5e1',
                          whiteSpace: 'nowrap',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '3px',
                          boxSizing: 'border-box',
                        }}
                      >
                        <CheckIcon size={13} color="#059669" strokeWidth={2.5} />
                        <span>{t('storefront.merchant_orders_table.s25', "فاتورة #")}{order.saleId}</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onLoadToPos(order.id)}
                        disabled={loadingPosOrderId === order.id}
                        title={t('storefront.merchant_orders_table.s26', "فتح شاشة الكاشير وتنزيل الأصناف والعميل في السلة لتعديلها وإتمام البيع")}
                        style={{
                          width: '100%',
                          height: '32px',
                          fontSize: '11px',
                          fontWeight: 700,
                          borderRadius: '7px',
                          background: '#047857',
                          color: '#ffffff',
                          border: 'none',
                          cursor: loadingPosOrderId === order.id ? 'wait' : 'pointer',
                          whiteSpace: 'nowrap',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 1px 2px rgba(4,120,87,0.2)',
                          boxSizing: 'border-box',
                        }}
                      >
                        <span>{loadingPosOrderId === order.id ? t('storefront.merchant_orders_table.s27', "جاري...") : t('storefront.merchant_orders_table.s28', "بالسلة (POS)")}</span>
                      </button>
                    )}

                    {/* Col 2: Action Button */}
                    {order.status === 'delivered' ? (
                      <div
                        style={{
                          width: '100%',
                          height: '32px',
                          fontSize: '11px',
                          fontWeight: 700,
                          color: '#059669',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '3px',
                          borderRadius: '7px',
                          background: '#f0fdf4',
                          border: '1px solid #dcfce7',
                          boxSizing: 'border-box',
                        }}
                      >
                        <CheckIcon size={13} color="#059669" strokeWidth={2.5} />
                        <span>{t('storefront.merchant_orders_table.s29', "مكتمل")}</span>
                      </div>
                    ) : order.status === 'processing' && order.saleId ? (
                      <button
                        type="button"
                        onClick={() => setDispatchOrder(order)}
                        disabled={isUpdatingStatus}
                        title={t('storefront.merchant_orders_table.s30', "تسليم الأوردر والفاتورة لمندوب التوصيل")}
                        style={{
                          width: '100%',
                          height: '32px',
                          fontSize: '11px',
                          fontWeight: 700,
                          borderRadius: '7px',
                          background: '#170e5e',
                          color: '#ffffff',
                          border: 'none',
                          cursor: isUpdatingStatus ? 'wait' : 'pointer',
                          whiteSpace: 'nowrap',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          boxShadow: '0 1px 2px rgba(23,14,94,0.2)',
                          boxSizing: 'border-box',
                        }}
                      >
                        <TruckIcon size={13} color="#ffffff" />
                        <span>{t('storefront.merchant_orders_table.s31', "تسليم للمندوب")}</span>
                      </button>
                    ) : order.status === 'shipped' ? (
                      <button
                        type="button"
                        onClick={() => onUpdateStatus(order.id, 'delivered')}
                        disabled={isUpdatingStatus}
                        title={t('storefront.merchant_orders_table.s32', "تأكيد تسليم الأوردر للعميل بنجاح")}
                        style={{
                          width: '100%',
                          height: '32px',
                          fontSize: '11px',
                          fontWeight: 700,
                          borderRadius: '7px',
                          background: '#059669',
                          color: '#ffffff',
                          border: 'none',
                          cursor: isUpdatingStatus ? 'wait' : 'pointer',
                          whiteSpace: 'nowrap',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          boxShadow: '0 1px 2px rgba(5,150,105,0.2)',
                          boxSizing: 'border-box',
                        }}
                      >
                        <CheckIcon size={13} color="#ffffff" strokeWidth={2.5} />
                        <span>{t('storefront.merchant_orders_table.s33', "تم التسليم")}</span>
                      </button>
                    ) : order.bostaTrackingNumber ? (
                      <button
                        type="button"
                        onClick={() => window.open(`/api/bosta/awb/${order.bostaDeliveryId || order.bostaTrackingNumber}`, '_blank')}
                        title={t('storefront.merchant_orders_table.s34', "طباعة بوليصة شحن بوسطة AWB")}
                        style={{
                          width: '100%',
                          height: '32px',
                          fontSize: '11px',
                          fontWeight: 700,
                          borderRadius: '7px',
                          background: '#fff1f2',
                          color: '#e11d48',
                          border: '1px solid #fecdd3',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          boxSizing: 'border-box',
                          padding: '0 6px',
                        }}
                      >
                        <PackageIcon size={13} color="#e11d48" />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('storefront.merchant_orders_table.s35', "بوسطة #")}{order.bostaTrackingNumber}</span>
                      </button>
                    ) : (order.gccTrackingNumber || order.gcc_tracking_number) ? (
                      <button
                        type="button"
                        onClick={() => onShipGcc(order)}
                        title={t('storefront.merchant_orders_table.s36', "عرض تتبع وطباعة بوليصة الشحن الخليجي")}
                        style={{
                          width: '100%',
                          height: '32px',
                          fontSize: '11px',
                          fontWeight: 700,
                          borderRadius: '7px',
                          background: (order.gccShippingCarrier || order.gcc_shipping_carrier) === 'aramex' ? '#fef2f2' : '#fff7ed',
                          color: (order.gccShippingCarrier || order.gcc_shipping_carrier) === 'aramex' ? '#dc2626' : '#ea580c',
                          border: `1px solid ${(order.gccShippingCarrier || order.gcc_shipping_carrier) === 'aramex' ? '#fecaca' : '#fed7aa'}`,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          boxSizing: 'border-box',
                          padding: '0 6px',
                        }}
                      >
                        <TruckIcon size={13} color={(order.gccShippingCarrier || order.gcc_shipping_carrier) === 'aramex' ? '#dc2626' : '#ea580c'} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {(order.gccShippingCarrier || order.gcc_shipping_carrier) === 'aramex' ? t('storefront.merchant_orders_table.s37', "أرامكس") : t('storefront.merchant_orders_table.s38', "سمسا")} #{order.gccTrackingNumber || order.gcc_tracking_number}
                        </span>
                      </button>
                    ) : !order.saleId && order.status !== 'cancelled' ? (
                      <OrderShippingDropdown
                        order={order}
                        isBostaConfigured={isBostaConfigured}
                        isGccConfigured={isGccConfigured}
                        onConvertToDelivery={onConvertToDelivery}
                        onShipBosta={onShipBosta}
                        onShipGcc={onShipGcc}
                      />
                    ) : (
                      <div style={{ width: '100%', height: '32px' }} />
                    )}

                    {/* Col 3: Details Button */}
                    <button
                      type="button"
                      onClick={() => onSelectOrder(order)}
                      style={{
                        width: '100%',
                        height: '32px',
                        fontSize: '11.5px',
                        fontWeight: 700,
                        borderRadius: '7px',
                        background: '#ffffff',
                        color: '#334155',
                        border: '1px solid #cbd5e1',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                        transition: 'all 0.15s ease',
                        boxSizing: 'border-box',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#f1f5f9';
                        e.currentTarget.style.borderColor = '#94a3b8';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#ffffff';
                        e.currentTarget.style.borderColor = '#cbd5e1';
                      }}
                    >
                      {t('storefront.merchant_orders_table.s39', "تفاصيل")}
                    </button>

                    {/* Col 4: WhatsApp Button */}
                    {waPhone ? (
                      <a
                        href={`https://wa.me/${waPhone}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t('storefront.merchant_orders_table.s40', "مراسلة العميل واتساب")}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '32px',
                          height: '32px',
                          borderRadius: '7px',
                          background: '#ecfdf5',
                          color: '#059669',
                          border: '1px solid #a7f3d0',
                          textDecoration: 'none',
                          flexShrink: 0,
                          boxShadow: '0 1px 2px rgba(5,150,105,0.1)',
                          boxSizing: 'border-box',
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#25D366';
                          e.currentTarget.style.color = '#ffffff';
                          e.currentTarget.style.borderColor = '#25D366';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = '#ecfdf5';
                          e.currentTarget.style.color = '#059669';
                          e.currentTarget.style.borderColor = '#a7f3d0';
                        }}
                      >
                        <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.181-.076.355.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86.173.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.145.39-.087s1.011.477 1.184.564.289.13.332.202c.043.072.043.419-.101.824z" />
                        </svg>
                      </a>
                    ) : (
                      <div style={{ width: '32px', height: '32px' }} />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {dispatchOrder && (
        <MerchantDispatchDialog order={dispatchOrder} onClose={() => setDispatchOrder(null)} />
      )}
    </div>
  );
}
