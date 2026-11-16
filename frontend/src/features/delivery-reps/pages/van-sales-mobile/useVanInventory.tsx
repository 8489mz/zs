// Inventory for the van sales mobile page — pure move of the inventory
// hook state (stock search, transfer/swap modals, inventory sub-mode,
// filtered inventory), the inventory tab, the requisitions tab, and the
// transfer + damaged-swap modal invocations. The facade calls the hook
// once and passes hook values as props; the tabs take the trip data and
// the sale values as props. Both requisitions renderings move verbatim
// (they are DIFFERENT renderings, not duplicates — no dedup).
import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { vanSalesApi, VanActiveTripResponse, VanLoadRequisitionRecord, VanStockItem } from '@/features/delivery-reps/api/van-sales.api';
import { Button } from '@/shared/ui/button';
import { PackageIcon, RefreshCwIcon } from '@/shared/components/icons/AppIcons';
import { systemConfirm, toast } from '@/shared/components/system-alert';
import { VanInventoryTab } from '@/features/delivery-reps/components/VanInventoryTab';
import { VanTransferModal } from '@/features/delivery-reps/components/VanTransferModal';
import { VanDamagedSwapModal } from '@/features/delivery-reps/components/VanDamagedSwapModal';
import { CartItem } from '@/features/delivery-reps/components/VanSaleTab';

export type VanMobileTabKey = 'cockpit' | 'itinerary' | 'inventory' | 'sale' | 'pre-sales' | 'sales-history' | 'collection' | 'fleet' | 'settle' | 'requisitions';

export interface VanActiveVisit {
  customerId: number;
  customerName: string;
  startedAt: number;
  startedTimeStr?: string;
  latitude?: number;
  longitude?: number;
  visitId?: number;
}

export interface UseVanInventoryDeps {
  data: VanActiveTripResponse | undefined;
}

export function useVanInventory({ data }: UseVanInventoryDeps) {
  const [stockSearch, setStockSearch] = useState('');
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [inventorySubMode, setInventorySubMode] = useState<'stock' | 'requisitions'>('stock');
  const filteredInventory = useMemo(() => {
    if (!data?.inventory) return [];
    if (!stockSearch.trim()) return data.inventory;
    const q = stockSearch.toLowerCase();
    return data.inventory.filter(
      (item) => item.productName.toLowerCase().includes(q) || item.barcode.toLowerCase().includes(q),
    );
  }, [data?.inventory, stockSearch]);

  return {
    stockSearch,
    setStockSearch,
    transferModalOpen,
    setTransferModalOpen,
    swapModalOpen,
    setSwapModalOpen,
    inventorySubMode,
    setInventorySubMode,
    filteredInventory,
  };
}

export interface InventoryTabProps {
  inv: ReturnType<typeof useVanInventory>;
  data: VanActiveTripResponse | undefined;
  myRequisitions: VanLoadRequisitionRecord[];
  peerTransfers: Awaited<ReturnType<typeof vanSalesApi.getDriverTransfers>>;
  cart: CartItem[];
  cartTotal: number;
  addToCart: (item: VanStockItem) => void;
  updateCartQty: (productId: number, delta: number) => void;
  setActiveTab: React.Dispatch<React.SetStateAction<VanMobileTabKey>>;
  queryClient: QueryClient;
  setViewMode: React.Dispatch<React.SetStateAction<'dashboard' | 'new-requisition'>>;
  showAlert: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void;
}

export const InventoryTab: React.FC<InventoryTabProps> = ({
  inv,
  data,
  myRequisitions,
  peerTransfers,
  cart,
  cartTotal,
  addToCart,
  updateCartQty,
  setActiveTab,
  queryClient,
  setViewMode,
  showAlert,
}) => {
  const { t: __t } = useTranslation();
  const {
    stockSearch,
    setStockSearch,
    setTransferModalOpen,
    inventorySubMode,
    setInventorySubMode,
    filteredInventory,
  } = inv;
  return (
    <>
            {/* TAB CONTENT: INVENTORY (بضاعة السيارة & طلبات شحن السيارة) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                {/* Segmented Sub-Header for Stock vs Requisitions */}
                <div
                  style={{
                    display: 'flex',
                    backgroundColor: '#e2e8f0',
                    padding: '3px',
                    borderRadius: '10px',
                    gap: '4px',
                    width: '100%',
                    minWidth: 0,
                    boxSizing: 'border-box',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setInventorySubMode('stock')}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: inventorySubMode === 'stock' ? '#170e5e' : 'transparent',
                      color: inventorySubMode === 'stock' ? '#ffffff' : '#475569',
                      fontWeight: 700,
                      fontSize: '12px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s127', __t('delivery_reps.van_sales_mobile_page.s127', "بضاعة السيارة"))} {data?.inventory?.length ? `(${data.inventory.length})` : '(0)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setInventorySubMode('requisitions')}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: inventorySubMode === 'requisitions' ? '#170e5e' : 'transparent',
                      color: inventorySubMode === 'requisitions' ? '#ffffff' : '#475569',
                      fontWeight: 700,
                      fontSize: '12px',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                    }}
                  >
                    <span>{__t('delivery_reps.van_sales_mobile_page.s128', __t('delivery_reps.van_sales_mobile_page.s128', "طلبات شحن السيارة"))}</span>
                    {myRequisitions.length > 0 && (
                      <span
                        style={{
                          backgroundColor: inventorySubMode === 'requisitions' ? 'rgba(255,255,255,0.25)' : '#cbd5e1',
                          color: inventorySubMode === 'requisitions' ? '#ffffff' : '#1e293b',
                          padding: '1px 6px',
                          borderRadius: '10px',
                          fontSize: '11px',
                          fontWeight: 800,
                        }}
                      >
                        {myRequisitions.length}
                      </span>
                    )}
                  </button>
                </div>

                {inventorySubMode === 'stock' ? (
                  <VanInventoryTab
                    stockSearch={stockSearch}
                    onSearchChange={setStockSearch}
                    filteredInventory={filteredInventory}
                    cart={cart}
                    cartTotal={cartTotal}
                    onAddToCart={(item) => {
                      if (data?.hasActiveTrip) {
                        addToCart(item);
                      } else {
                        toast.info(__t('delivery_reps.van_sales_mobile_page.s129', __t('delivery_reps.van_sales_mobile_page.s129', "يرجى بدء رحلة التوزيع أولاً لإضافة الأصناف للفاتورة")));
                      }
                    }}
                    onUpdateCartQty={updateCartQty}
                    onGoToSale={() => setActiveTab('sale')}
                    onOpenTransferModal={() => setTransferModalOpen(true)}
                    onRequestRequisition={() => setViewMode('new-requisition')}
                    pendingTransfersCount={peerTransfers.filter((t) => t.status === 'pending').length}
                  />
                ) : (
                  <div style={{ backgroundColor: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '14px', width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'nowrap', gap: '8px' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {__t('delivery_reps.van_sales_mobile_page.s130', __t('delivery_reps.van_sales_mobile_page.s130', "طلبات شحن السيارة"))}
                        </h3>
                        <span style={{ fontSize: '10.5px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                          {__t('delivery_reps.van_sales_mobile_page.s131', __t('delivery_reps.van_sales_mobile_page.s131', "صرف بضاعة المستودع إلى سيارة التوزيع"))}
                        </span>
                      </div>
                      <Button
                        variant="primary"
                        onClick={() => setViewMode('new-requisition')}
                        style={{
                          backgroundColor: '#170e5e',
                          color: '#ffffff',
                          fontSize: '11.5px',
                          fontWeight: 800,
                          height: '32px',
                          padding: '0 10px',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                        }}
                      >
                        {__t('delivery_reps.van_sales_mobile_page.s132', __t('delivery_reps.van_sales_mobile_page.s132', "+ طلب شحن جديد"))}
                      </Button>
                    </div>

                    {myRequisitions.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '36px 0', color: '#94a3b8' }}>
                        <PackageIcon size={32} color="#cbd5e1" style={{ margin: '0 auto 8px', display: 'block' }} />
                        <span style={{ fontSize: '12.5px', fontWeight: 600 }}>{__t('delivery_reps.van_sales_mobile_page.s133', __t('delivery_reps.van_sales_mobile_page.s133', "لا توجد طلبات شحن سابقة مسجلة"))}</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {myRequisitions.map((req) => (
                          <div
                            key={req.id}
                            style={{
                              backgroundColor: '#f8fafc',
                              borderRadius: '10px',
                              padding: '12px 14px',
                              border: '1px solid #e2e8f0',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                                {__t('delivery_reps.van_sales_mobile_page.s134', __t('delivery_reps.van_sales_mobile_page.s134', "طلب شحن #"))}{req.docNo}
                              </span>
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 800,
                                  padding: '3px 8px',
                                  borderRadius: '6px',
                                  whiteSpace: 'nowrap',
                                  flexShrink: 0,
                                  backgroundColor:
                                    req.status === 'dispatched'
                                      ? '#dcfce7'
                                      : req.status === 'rejected'
                                      ? '#fee2e2'
                                      : '#fef3c7',
                                  color:
                                    req.status === 'dispatched'
                                      ? '#15803d'
                                      : req.status === 'rejected'
                                      ? '#b91c1c'
                                      : '#b45309',
                                }}
                              >
                                {req.status === 'dispatched'
                                  ? __t('delivery_reps.van_sales_mobile_page.s135', __t('delivery_reps.van_sales_mobile_page.s135', "تم الصرف"))
                                  : req.status === 'rejected'
                                  ? __t('delivery_reps.van_sales_mobile_page.s136', __t('delivery_reps.van_sales_mobile_page.s136', "مرفوض"))
                                  : __t('delivery_reps.van_sales_mobile_page.s137', __t('delivery_reps.van_sales_mobile_page.s137', "قيد المراجعة"))}
                              </span>
                            </div>
                            <div style={{ fontSize: '11.5px', color: '#64748b', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                              <span>{__t('delivery_reps.van_sales_mobile_page.s138', __t('delivery_reps.van_sales_mobile_page.s138', "المستودع المصدر:"))} <strong style={{ color: '#0f172a' }}>{req.sourceWarehouseName}</strong></span>
                              <span>{__t('delivery_reps.van_sales_mobile_page.s139', __t('delivery_reps.van_sales_mobile_page.s139', "الأصناف المطلوبة:"))} <strong style={{ color: '#0f172a' }}>{req.requestedItems.length} {__t('delivery_reps.van_sales_mobile_page.s140', __t('delivery_reps.van_sales_mobile_page.s140', "صنف"))}</strong></span>
                              <span>{__t('delivery_reps.van_sales_mobile_page.s141', __t('delivery_reps.van_sales_mobile_page.s141', "تاريخ الطلب:"))} {new Date(req.createdAt).toLocaleDateString('ar-EG')}</span>
                            </div>
                            {req.rejectionReason && (
                              <div
                                style={{
                                  marginTop: '6px',
                                  padding: '4px 8px',
                                  backgroundColor: '#fef2f2',
                                  border: '1px solid #fee2e2',
                                  borderRadius: '6px',
                                  fontSize: '10.5px',
                                  color: '#b91c1c',
                                  fontWeight: 600,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                                title={req.rejectionReason}
                              >
                                <span style={{ fontWeight: 800, flexShrink: 0 }}>{__t('delivery_reps.van_sales_mobile_page.s142', __t('delivery_reps.van_sales_mobile_page.s142', "سبب الرفض:"))}</span>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {req.rejectionReason}
                                </span>
                              </div>
                            )}

                            {req.status === 'pending' && (
                              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={async () => {
                                    const confirmed = await systemConfirm({
                                      title: __t('delivery_reps.van_sales_mobile_page.s143', __t('delivery_reps.van_sales_mobile_page.s143', "إلغاء طلب إذن التحميل")),
                                      message: `هل تريد إلغاء طلب إذن التحميل #${req.docNo} وإعادة تجهيز أصنافه؟`,
                                      confirmText: __t('delivery_reps.van_sales_mobile_page.s144', __t('delivery_reps.van_sales_mobile_page.s144', "نعم، إلغاء وتجهيز")),
                                      cancelText: __t('delivery_reps.van_sales_mobile_page.s145', __t('delivery_reps.van_sales_mobile_page.s145', "تراجع")),
                                    });
                                    if (!confirmed) return;
                                    try {
                                      await vanSalesApi.cancelMyRequisition(req.id);
                                      queryClient.invalidateQueries({ queryKey: ['driver-my-requisitions'] });
                                      showAlert('success', `تم إلغاء طلب إذن التحميل #${req.docNo} واسترجاع الأصناف بنجاح`);
                                      setViewMode('new-requisition');
                                    } catch (err: any) {
                                      showAlert('error', err?.message || __t('delivery_reps.van_sales_mobile_page.s146', __t('delivery_reps.van_sales_mobile_page.s146', "فشل إلغاء الطلب")));
                                    }
                                  }}
                                  style={{
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    color: '#b45309',
                                    backgroundColor: '#fef3c7',
                                    borderColor: '#fde68a',
                                    padding: '4px 10px',
                                    height: '28px',
                                    borderRadius: '6px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                  }}
                                >
                                  <RefreshCwIcon size={12} />
                                  <span>{__t('delivery_reps.van_sales_mobile_page.s147', __t('delivery_reps.van_sales_mobile_page.s147', "إلغاء الطلب المعلق وتعديل الأصناف"))}</span>
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
    </>
  );
};

export interface RequisitionsTabProps {
  inv: ReturnType<typeof useVanInventory>;
  myRequisitions: VanLoadRequisitionRecord[];
  setActiveTab: React.Dispatch<React.SetStateAction<VanMobileTabKey>>;
  queryClient: QueryClient;
  setViewMode: React.Dispatch<React.SetStateAction<'dashboard' | 'new-requisition'>>;
  showAlert: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void;
}

export const RequisitionsTab: React.FC<RequisitionsTabProps> = ({
  inv,
  myRequisitions,
  setActiveTab,
  queryClient,
  setViewMode,
  showAlert,
}) => {
  const { t: __t } = useTranslation();
  const { setInventorySubMode } = inv;
  return (
    <>
            {/* TAB CONTENT: REQUISITIONS (Direct Link Fallback) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('inventory');
                    setInventorySubMode('stock');
                  }}
                  style={{
                    alignSelf: 'flex-start',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#170e5e',
                    cursor: 'pointer',
                  }}
                >
                  {__t('delivery_reps.van_sales_mobile_page.s149', __t('delivery_reps.van_sales_mobile_page.s149', "← عودة لبضاعة السيارة (المخزون)"))}
                </button>
                <div style={{ backgroundColor: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'nowrap', gap: '8px' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {__t('delivery_reps.van_sales_mobile_page.s150', __t('delivery_reps.van_sales_mobile_page.s150', "طلبات شحن السيارة"))}
                      </h3>
                      <span style={{ fontSize: '10.5px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                        {__t('delivery_reps.van_sales_mobile_page.s151', __t('delivery_reps.van_sales_mobile_page.s151', "صرف بضاعة المستودع إلى سيارة التوزيع"))}
                      </span>
                    </div>
                    <Button
                      variant="primary"
                      onClick={() => setViewMode('new-requisition')}
                      style={{
                        backgroundColor: '#170e5e',
                        color: '#ffffff',
                        fontSize: '11.5px',
                        fontWeight: 800,
                        height: '32px',
                        padding: '0 10px',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {__t('delivery_reps.van_sales_mobile_page.s152', __t('delivery_reps.van_sales_mobile_page.s152', "+ طلب شحن جديد"))}
                    </Button>
                  </div>

                  {myRequisitions.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '36px 0', color: '#94a3b8' }}>
                      <PackageIcon size={32} color="#cbd5e1" style={{ margin: '0 auto 8px', display: 'block' }} />
                      <span style={{ fontSize: '12.5px', fontWeight: 600 }}>{__t('delivery_reps.van_sales_mobile_page.s153', __t('delivery_reps.van_sales_mobile_page.s153', "لا توجد طلبات شحن سابقة مسجلة"))}</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {myRequisitions.map((req) => (
                        <div
                          key={req.id}
                          style={{
                            backgroundColor: '#f8fafc',
                            borderRadius: '10px',
                            padding: '12px 14px',
                            border: '1px solid #e2e8f0',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                              {__t('delivery_reps.van_sales_mobile_page.s154', __t('delivery_reps.van_sales_mobile_page.s154', "طلب شحن #"))}{req.docNo}
                            </span>
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 800,
                                padding: '3px 8px',
                                borderRadius: '6px',
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                                backgroundColor:
                                  req.status === 'dispatched'
                                    ? '#dcfce7'
                                    : req.status === 'rejected'
                                    ? '#fee2e2'
                                    : '#fef3c7',
                                color:
                                  req.status === 'dispatched'
                                    ? '#15803d'
                                    : req.status === 'rejected'
                                    ? '#b91c1c'
                                    : '#b45309',
                              }}
                            >
                              {req.status === 'dispatched'
                                ? __t('delivery_reps.van_sales_mobile_page.s155', __t('delivery_reps.van_sales_mobile_page.s155', "تم الصرف"))
                                : req.status === 'rejected'
                                ? __t('delivery_reps.van_sales_mobile_page.s156', __t('delivery_reps.van_sales_mobile_page.s156', "مرفوض"))
                                : __t('delivery_reps.van_sales_mobile_page.s157', __t('delivery_reps.van_sales_mobile_page.s157', "قيد المراجعة"))}
                            </span>
                          </div>
                          <div style={{ fontSize: '11.5px', color: '#64748b', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                            <span>{__t('delivery_reps.van_sales_mobile_page.s158', __t('delivery_reps.van_sales_mobile_page.s158', "المستودع المصدر:"))} <strong style={{ color: '#0f172a' }}>{req.sourceWarehouseName}</strong></span>
                            <span>{__t('delivery_reps.van_sales_mobile_page.s159', __t('delivery_reps.van_sales_mobile_page.s159', "الأصناف المطلوبة:"))} <strong style={{ color: '#0f172a' }}>{req.requestedItems.length} {__t('delivery_reps.van_sales_mobile_page.s160', __t('delivery_reps.van_sales_mobile_page.s160', "صنف"))}</strong></span>
                            <span>{__t('delivery_reps.van_sales_mobile_page.s161', __t('delivery_reps.van_sales_mobile_page.s161', "تاريخ الطلب:"))} {new Date(req.createdAt).toLocaleDateString('ar-EG')}</span>
                          </div>
                          {req.rejectionReason && (
                            <div
                              style={{
                                marginTop: '6px',
                                padding: '4px 8px',
                                backgroundColor: '#fef2f2',
                                border: '1px solid #fee2e2',
                                borderRadius: '6px',
                                fontSize: '10.5px',
                                color: '#b91c1c',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                              title={req.rejectionReason}
                            >
                              <span style={{ fontWeight: 800, flexShrink: 0 }}>{__t('delivery_reps.van_sales_mobile_page.s162', __t('delivery_reps.van_sales_mobile_page.s162', "سبب الرفض:"))}</span>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {req.rejectionReason}
                              </span>
                            </div>
                          )}

                          {req.status === 'pending' && (
                            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={async () => {
                                  const confirmed = await systemConfirm({
                                    title: __t('delivery_reps.van_sales_mobile_page.s163', __t('delivery_reps.van_sales_mobile_page.s163', "إلغاء طلب إذن التحميل")),
                                    message: `هل تريد إلغاء طلب إذن التحميل #${req.docNo} وإعادة تجهيز أصنافه؟`,
                                    confirmText: __t('delivery_reps.van_sales_mobile_page.s164', __t('delivery_reps.van_sales_mobile_page.s164', "نعم، إلغاء وتجهيز")),
                                    cancelText: __t('delivery_reps.van_sales_mobile_page.s165', __t('delivery_reps.van_sales_mobile_page.s165', "تراجع")),
                                  });
                                  if (!confirmed) return;
                                  try {
                                    await vanSalesApi.cancelMyRequisition(req.id);
                                    queryClient.invalidateQueries({ queryKey: ['driver-my-requisitions'] });
                                    showAlert('success', `تم إلغاء طلب إذن التحميل #${req.docNo} واسترجاع الأصناف بنجاح`);
                                    setViewMode('new-requisition');
                                  } catch (err: any) {
                                    showAlert('error', err?.message || __t('delivery_reps.van_sales_mobile_page.s166', __t('delivery_reps.van_sales_mobile_page.s166', "فشل إلغاء الطلب")));
                                  }
                                }}
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  color: '#b45309',
                                  backgroundColor: '#fef3c7',
                                  borderColor: '#fde68a',
                                  padding: '4px 10px',
                                  height: '28px',
                                  borderRadius: '6px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                <RefreshCwIcon size={12} />
                                <span>{__t('delivery_reps.van_sales_mobile_page.s167', __t('delivery_reps.van_sales_mobile_page.s167', "إلغاء الطلب المعلق وتعديل الأصناف"))}</span>
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
    </>
  );
};

export interface TransferModalProps {
  inv: ReturnType<typeof useVanInventory>;
  data: VanActiveTripResponse | undefined;
  peerReps: Awaited<ReturnType<typeof vanSalesApi.getPeerReps>>;
  peerTransfers: Awaited<ReturnType<typeof vanSalesApi.getDriverTransfers>>;
  refetch: () => void;
  refetchTransfers: () => void;
}

export const TransferModal: React.FC<TransferModalProps> = ({
  inv,
  data,
  peerReps,
  peerTransfers,
  refetch,
  refetchTransfers,
}) => {
  const { transferModalOpen, setTransferModalOpen } = inv;
  return (
    <>
      {/* Street Inter-Van Transfer Modal */}
      {(data?.trip || (data?.inventory && data.inventory.length > 0)) && (
        <VanTransferModal
          open={transferModalOpen}
          onClose={() => setTransferModalOpen(false)}
          inventory={data?.inventory || []}
          peerReps={peerReps}
          transfers={peerTransfers}
          onRefreshTransfers={() => refetchTransfers()}
          onRefreshInventory={() => refetch()}
        />
      )}
    </>
  );
};

export interface DamagedSwapModalProps {
  inv: ReturnType<typeof useVanInventory>;
  data: VanActiveTripResponse | undefined;
  allAvailableCustomers: any[];
  selectedCustomerId: number | '';
  activeVisit: VanActiveVisit | null;
  refetch: () => void;
}

export const DamagedSwapModal: React.FC<DamagedSwapModalProps> = ({
  inv,
  data,
  allAvailableCustomers,
  selectedCustomerId,
  activeVisit,
  refetch,
}) => {
  const { swapModalOpen, setSwapModalOpen } = inv;
  return (
    <>
      {/* Field Damaged / Broken Goods Instant Swap Modal */}
      {data?.trip && swapModalOpen && (
        <VanDamagedSwapModal
          open={swapModalOpen}
          onClose={() => setSwapModalOpen(false)}
          tripId={data.trip.id}
          inventory={data.inventory || []}
          customers={allAvailableCustomers}
          defaultCustomerId={selectedCustomerId ? Number(selectedCustomerId) : (activeVisit?.customerId || null)}
          onSwapSuccess={() => {
            refetch();
          }}
        />
      )}
    </>
  );
};
