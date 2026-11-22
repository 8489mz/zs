import { useTranslation } from 'react-i18next';
import { useState, useMemo, useRef, useEffect } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { CustomSelect } from '@/shared/ui/custom-select';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  vanSalesApi,
  type DriverWarehouse,
  type DriverAvailableProduct,
  type DriverProductStock,
} from '../api/van-sales.api';
import {
  CheckCircleIcon,
  SearchIcon,
  WarehouseIcon,
  PackageIcon,
  Trash2Icon,
  PlusIcon,
  MinusIcon,
} from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';

interface RequisitionCartItem {
  lineId: string;
  productId: number;
  productName: string;
  barcode: string;
  retailPrice: number;
  unit: string;
  qty: number;
  sourceWarehouseId: number;
  sourceWarehouseName: string;
  availableInWarehouse: number;
  warehouseStocks: DriverProductStock[];
}

interface DriverLoadRequisitionModalProps {
  open: boolean;
  onClose: () => void;
  onRequisitionSubmitted?: (docNo: string) => void;
}

export function DriverLoadRequisitionModal({
  open,
  onClose,
  onRequisitionSubmitted,
}: DriverLoadRequisitionModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // 'all' represents all warehouses with auto-selection; otherwise a specific warehouseId string
  const [selectedWarehouseFilter, setSelectedWarehouseFilter] = useState<string>('all');
  const [cart, setCart] = useState<RequisitionCartItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [notes, setNotes] = useState('');
  const [submittedDocNo, setSubmittedDocNo] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // 1. Fetch available warehouses for the driver
  const { data: warehouses = [], isLoading: isLoadingWarehouses } = useQuery<DriverWarehouse[]>({
    queryKey: ['driver-warehouses'],
    queryFn: vanSalesApi.getWarehouses,
    enabled: open,
    staleTime: 60_000,
  });

  // 2. Fetch available products & stocks (re-fetches when selected warehouse changes)
  const { data: availableProducts = [], isLoading: isLoadingProducts } = useQuery<DriverAvailableProduct[]>({
    queryKey: ['driver-available-products', selectedWarehouseFilter],
    queryFn: () => vanSalesApi.getAvailableProducts(selectedWarehouseFilter),
    enabled: open,
    staleTime: 30_000,
  });

  // Close search dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setIsSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter products by search term
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    return availableProducts
      .filter((p) => {
        const name = (p.name || '').toLowerCase();
        const barcode = (p.barcode || '').toLowerCase();
        const sku = (p.sku || '').toLowerCase();
        return name.includes(q) || barcode.includes(q) || sku.includes(q);
      })
      .slice(0, 10);
  }, [availableProducts, searchQuery]);

  // Handle adding product to cart
  const handleSelectProduct = (product: DriverAvailableProduct) => {
    // If specific warehouse filter is chosen, find stock in that warehouse
    // If 'all', find the warehouse with highest stock
    let targetWhId = 0;
    let targetWhName = '';
    let targetAvail = 0;

    if (selectedWarehouseFilter !== 'all') {
      const whIdNum = Number(selectedWarehouseFilter);
      const whStock = product.warehouseStocks.find((w) => w.warehouseId === whIdNum);
      const whMeta = warehouses.find((w) => w.id === whIdNum);
      targetWhId = whIdNum;
      targetWhName = whStock?.warehouseName || whMeta?.name || `مستودع #${whIdNum}`;
      targetAvail = whStock ? whStock.qty : 0;
    } else {
      // Pick best warehouse from product.warehouseStocks
      if (product.warehouseStocks && product.warehouseStocks.length > 0) {
        const sorted = [...product.warehouseStocks].sort((a, b) => b.qty - a.qty);
        targetWhId = sorted[0].warehouseId;
        targetWhName = sorted[0].warehouseName;
        targetAvail = sorted[0].qty;
      } else {
        const firstWh = warehouses[0];
        targetWhId = firstWh ? firstWh.id : 0;
        targetWhName = firstWh ? firstWh.name : 'المستودع الرئيسي';
        targetAvail = 0;
      }
    }

    // Check if line already exists in cart with this product & warehouse
    const existingIndex = cart.findIndex(
      (item) => item.productId === product.id && item.sourceWarehouseId === targetWhId,
    );

    if (existingIndex >= 0) {
      const updated = [...cart];
      const current = updated[existingIndex];
      const maxAllowed = current.availableInWarehouse > 0 ? current.availableInWarehouse : 9999;
      if (current.qty < maxAllowed) {
        current.qty += 1;
        setCart(updated);
        toast.info(`تم زيادة كمية "${product.name}" إلى ${current.qty}`);
      } else {
        toast.warning(`الكمية المطلوبة وصلت للحد الأقصى المتاح بالمستودع (${maxAllowed} ${product.unit})`);
      }
    } else {
      const newItem: RequisitionCartItem = {
        lineId: `${product.id}-${targetWhId}-${Date.now()}`,
        productId: product.id,
        productName: product.name,
        barcode: product.barcode,
        retailPrice: product.retailPrice,
        unit: product.unit || 'قطعة',
        qty: 1,
        sourceWarehouseId: targetWhId,
        sourceWarehouseName: targetWhName,
        availableInWarehouse: targetAvail,
        warehouseStocks: product.warehouseStocks || [],
      };
      setCart((prev) => [...prev, newItem]);
      toast.success(`تمت إضافة "${product.name}" لطلب التحميل`);
    }

    setSearchQuery('');
    setIsSearchOpen(false);
  };

  // Switch warehouse for an existing cart row (when 'all' warehouses is active)
  const handleChangeItemWarehouse = (lineId: string, newWhId: number) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.lineId !== lineId) return item;
        const matchingStock = item.warehouseStocks.find((w) => w.warehouseId === newWhId);
        const whMeta = warehouses.find((w) => w.id === newWhId);
        const newAvail = matchingStock ? matchingStock.qty : 0;
        return {
          ...item,
          sourceWarehouseId: newWhId,
          sourceWarehouseName: matchingStock?.warehouseName || whMeta?.name || `مستودع #${newWhId}`,
          availableInWarehouse: newAvail,
          qty: newAvail > 0 ? Math.min(item.qty, newAvail) : item.qty,
        };
      }),
    );
  };

  // Update item quantity
  const handleUpdateQty = (lineId: string, newQty: number) => {
    if (newQty <= 0) {
      handleRemoveItem(lineId);
      return;
    }
    setCart((prev) =>
      prev.map((item) => {
        if (item.lineId !== lineId) return item;
        const maxStock = item.availableInWarehouse > 0 ? item.availableInWarehouse : 9999;
        const validQty = Math.min(newQty, maxStock);
        if (newQty > maxStock) {
          toast.warning(`الكمية المتاحة في ${item.sourceWarehouseName} هي ${maxStock} ${item.unit} فقط`);
        }
        return { ...item, qty: validQty };
      }),
    );
  };

  // Remove item from cart
  const handleRemoveItem = (lineId: string) => {
    setCart((prev) => prev.filter((item) => item.lineId !== lineId));
  };

  // Summary statistics
  const summaryStats = useMemo(() => {
    const distinctItems = cart.length;
    const totalUnits = cart.reduce((acc, item) => acc + item.qty, 0);
    const totalEstimatedValue = cart.reduce((acc, item) => acc + item.qty * item.retailPrice, 0);
    return { distinctItems, totalUnits, totalEstimatedValue };
  }, [cart]);

  // Submit requisition mutation
  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!cart.length) {
        throw new Error('يرجى إضافة صنف واحد على الأقل لطلب التحميل');
      }

      // Check header source warehouse: if 'all', use first item's warehouse or 0
      const headerWhId =
        selectedWarehouseFilter !== 'all'
          ? Number(selectedWarehouseFilter)
          : cart[0]?.sourceWarehouseId || undefined;

      const payload = {
        sourceWarehouseId: headerWhId,
        items: cart.map((c) => ({
          productId: c.productId,
          qty: c.qty,
          sourceWarehouseId: c.sourceWarehouseId,
          sourceWarehouseName: c.sourceWarehouseName,
        })),
        notes: notes.trim() || undefined,
      };

      return vanSalesApi.submitLoadRequisition(payload);
    },
    onSuccess: (res) => {
      setSubmittedDocNo(res.docNo);
      setCart([]);
      setNotes('');
      queryClient.invalidateQueries({ queryKey: ['driver-my-requisitions'] });
      onRequisitionSubmitted?.(res.docNo);
      toast.success(`تم إرسال طلب التحميل بنجاح برقم #${res.docNo}`);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل إرسال طلب التحميل للمستودع');
    },
  });

  const handleReset = () => {
    setSubmittedDocNo(null);
    setCart([]);
    setNotes('');
    setSearchQuery('');
    onClose();
  };

  // Warehouse filter options for CustomSelect
  const warehouseOptions = useMemo(() => {
    return [
      {
        value: 'all',
        label: 'كل المخازن (تحديد تلقائي للمستودع الأوفر رصيداً)',
        hint: 'صرف الأصناف من أي مستودع تتوفر به البضاعة',
      },
      ...warehouses.map((w) => ({
        value: String(w.id),
        label: w.name,
        hint: w.code ? `كود: ${w.code}` : undefined,
      })),
    ];
  }, [warehouses]);

  return (
    <StandardDialog
      open={open}
      onClose={handleReset}
      title={t('delivery_reps.driver_load_requisition_modal.s0', "طلب شحن بضاعة (إذن تحميل سيارة)")}
      subtitle={t('delivery_reps.driver_load_requisition_modal.s1', "تحديد أصناف وكميات البضاعة المطلوبة من المستودعات لسيارة التوزيع للمراجعة والاعتماد")}
      maxWidth="840px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }} dir="rtl">
        {submittedDocNo ? (
          <div
            style={{
              textAlign: 'center',
              padding: '28px 18px',
              backgroundColor: '#f0fdf4',
              borderRadius: '12px',
              border: '1px solid #bbf7d0',
            }}
          >
            <div
              style={{
                width: '52px',
                height: '52px',
                backgroundColor: '#dcfce7',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px',
              }}
            >
              <CheckCircleIcon size={30} color="#16a34a" />
            </div>
            <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#15803d', margin: '0 0 6px' }}>
              {t('delivery_reps.driver_load_requisition_modal.s2', "تم إرسال طلب إذن التحميل للمشرف بنجاح!")}
            </h3>
            <p style={{ fontSize: '14px', fontWeight: 800, color: '#166534', margin: '0 0 12px' }}>
              {t('delivery_reps.driver_load_requisition_modal.s3', "رقم الوثيقة: #")}{submittedDocNo}
            </p>
            <div
              style={{
                fontSize: '12.5px',
                color: '#475569',
                backgroundColor: '#ffffff',
                padding: '12px 16px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                maxWidth: '480px',
                margin: '0 auto 20px',
                lineHeight: 1.6,
              }}
            >
              {t('delivery_reps.driver_load_requisition_modal.s4', "طلبك الآن قيد مراجعة وتجهيز المستودع. سيتم إخطارك وبدء الرحلة وتحديث عهدة السيارة فور اعتماد المشرف\n              وصرف البضاعة.")}
            </div>
            <Button
              variant="primary"
              onClick={handleReset}
              style={{
                backgroundColor: '#170e5e',
                color: '#ffffff',
                fontWeight: 700,
                padding: '8px 24px',
                borderRadius: '8px',
              }}
            >
              {t('delivery_reps.driver_load_requisition_modal.s5', "تم والعودة للتطبيق")}
            </Button>
          </div>
        ) : (
          <>
            {/* Top Control Bar: Warehouse Selector & Product Search */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(220px, 1fr) minmax(280px, 1.4fr)',
                gap: '12px',
                alignItems: 'start',
              }}
            >
              {/* Warehouse Scope Selector */}
              <div>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#334155',
                    marginBottom: '5px',
                  }}
                >
                  <WarehouseIcon size={14} color="#170e5e" />
                  <span>{t('delivery_reps.driver_load_requisition_modal.s6', "المستودع المصدر:")}</span>
                </label>
                <CustomSelect
                  value={selectedWarehouseFilter}
                  onChange={(val) => {
                    setSelectedWarehouseFilter(val);
                    // If switching from 'all' to specific warehouse, optionally update cart items to that warehouse
                    if (val !== 'all') {
                      const whId = Number(val);
                      const whMeta = warehouses.find((w) => w.id === whId);
                      setCart((prev) =>
                        prev.map((item) => {
                          const stock = item.warehouseStocks.find((w) => w.warehouseId === whId);
                          return {
                            ...item,
                            sourceWarehouseId: whId,
                            sourceWarehouseName: stock?.warehouseName || whMeta?.name || `مستودع #${whId}`,
                            availableInWarehouse: stock ? stock.qty : 0,
                          };
                        }),
                      );
                    }
                  }}
                  options={warehouseOptions}
                  placeholder={isLoadingWarehouses ? t('delivery_reps.driver_load_requisition_modal.s7', "جارٍ تحميل المستودعات...") : t('delivery_reps.driver_load_requisition_modal.s8', "اختر المستودع")}
                />
              </div>

              {/* Product Live Search & Quick Hold */}
              <div ref={searchContainerRef} style={{ position: 'relative' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#334155',
                    marginBottom: '5px',
                  }}
                >
                  <SearchIcon size={14} color="#170e5e" />
                  <span>{t('delivery_reps.driver_load_requisition_modal.s9', "بحث عن صنف لإضافته للطلب:")}</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setIsSearchOpen(true);
                    }}
                    onFocus={() => setIsSearchOpen(true)}
                    placeholder={t('delivery_reps.driver_load_requisition_modal.s10', "اكتب اسم الصنف أو الباركود...")}
                    style={{
                      width: '100%',
                      height: '38px',
                      backgroundColor: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      padding: '0 32px 0 10px',
                      fontSize: '12.5px',
                      boxSizing: 'border-box',
                      color: '#0f172a',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: '#94a3b8',
                      pointerEvents: 'none',
                    }}
                  >
                    <SearchIcon size={16} />
                  </div>
                </div>

                {/* Dropdown Live Suggestions */}
                {isSearchOpen && searchQuery.trim().length > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      right: 0,
                      left: 0,
                      marginTop: '4px',
                      backgroundColor: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                      maxHeight: '260px',
                      overflowY: 'auto',
                      zIndex: 9999,
                    }}
                  >
                    {isLoadingProducts ? (
                      <div style={{ padding: '16px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
                        {t('delivery_reps.driver_load_requisition_modal.s11', "جارٍ فحص الأرصدة والمستودعات...")}
                      </div>
                    ) : searchResults.length > 0 ? (
                      searchResults.map((product) => {
                        const hasStock = (product.availableQty ?? product.totalStock) > 0;
                        return (
                          <div
                            key={product.id}
                            onClick={() => handleSelectProduct(product)}
                            style={{
                              padding: '10px 12px',
                              borderBottom: '1px solid #f1f5f9',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              backgroundColor: '#ffffff',
                              transition: 'background-color 0.1s ease',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#ffffff')}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxWidth: '65%' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a' }}>
                                  {product.name}
                                </span>
                                {product.barcode && (
                                  <span
                                    style={{
                                      fontSize: '11px',
                                      color: '#64748b',
                                      backgroundColor: '#f1f5f9',
                                      padding: '1px 5px',
                                      borderRadius: '4px',
                                    }}
                                  >
                                    {product.barcode}
                                  </span>
                                )}
                              </div>

                              {/* Warehouse Location Info */}
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
                                {product.warehouseStocks.length > 0 ? (
                                  product.warehouseStocks.map((ws) => (
                                    <span
                                      key={ws.warehouseId}
                                      style={{
                                        fontSize: '10.5px',
                                        color: '#334155',
                                        backgroundColor: '#f8fafc',
                                        border: '1px solid #e2e8f0',
                                        padding: '1px 6px',
                                        borderRadius: '4px',
                                      }}
                                    >
                                      {ws.warehouseName}: <strong>{ws.qty}</strong>
                                    </span>
                                  ))
                                ) : (
                                  <span style={{ fontSize: '10.5px', color: '#ef4444' }}>
                                    {t('delivery_reps.driver_load_requisition_modal.s12', "غير متوفر بالمستودعات حالياً")}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                              <span
                                style={{
                                  fontSize: '11.5px',
                                  fontWeight: 700,
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                  backgroundColor: hasStock ? '#dcfce7' : '#fee2e2',
                                  color: hasStock ? '#15803d' : '#b91c1c',
                                }}
                              >
                                {hasStock ? `المتاح: ${product.availableQty ?? product.totalStock} ${product.unit}` : t('delivery_reps.driver_load_requisition_modal.s13', "نفد الرصيد")}
                              </span>
                              <span style={{ fontSize: '11.5px', color: '#170e5e', fontWeight: 800 }}>
                                {product.retailPrice.toFixed(2)} <CurrencySymbol />
                              </span>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>
                        {t('delivery_reps.driver_load_requisition_modal.s14', "لا توجد أصناف مطابقة للبحث")}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Cart Table / Items Section */}
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '6px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <PackageIcon size={16} color="#170e5e" />
                  <span style={{ fontSize: '13px', fontWeight: 800, color: '#170e5e' }}>
                    {t('delivery_reps.driver_load_requisition_modal.s15', "الأصناف المحددة لطلب التحميل (")}{cart.length})
                  </span>
                </div>
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCart([])}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#ef4444',
                      fontSize: '11.5px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      padding: '2px 6px',
                    }}
                  >
                    {t('delivery_reps.driver_load_requisition_modal.s16', "تفريغ القائمة")}
                  </button>
                )}
              </div>

              {cart.length > 0 ? (
                <div
                  style={{
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    backgroundColor: '#ffffff',
                  }}
                >
                  <div
                    style={{
                      maxHeight: '260px',
                      overflowY: 'auto',
                    }}
                  >
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12.5px' }}>
                      <thead
                        style={{
                          backgroundColor: '#f8fafc',
                          position: 'sticky',
                          top: 0,
                          zIndex: 2,
                          borderBottom: '1px solid #cbd5e1',
                        }}
                      >
                        <tr>
                          <th style={{ padding: '8px 12px', fontWeight: 700, color: '#475569' }}>{t('delivery_reps.driver_load_requisition_modal.s17', "الصنف")}</th>
                          <th style={{ padding: '8px 10px', fontWeight: 700, color: '#475569', minWidth: '150px' }}>
                            {t('delivery_reps.driver_load_requisition_modal.s18', "مستودع الصرف")}
                          </th>
                          <th style={{ padding: '8px 10px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>
                            {t('delivery_reps.driver_load_requisition_modal.s19', "الرصيد المتاح")}
                          </th>
                          <th
                            style={{
                              padding: '8px 10px',
                              fontWeight: 700,
                              color: '#475569',
                              textAlign: 'center',
                              minWidth: '130px',
                            }}
                          >
                            {t('delivery_reps.driver_load_requisition_modal.s20', "الكمية المطلوبة")}
                          </th>
                          <th style={{ padding: '8px 10px', fontWeight: 700, color: '#475569', textAlign: 'left' }}>
                            {t('delivery_reps.driver_load_requisition_modal.s21', "القيمة")}
                          </th>
                          <th style={{ padding: '8px 6px', width: '36px' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {cart.map((item) => {
                          const itemTotal = item.qty * item.retailPrice;
                          const hasMultipleWarehouses = item.warehouseStocks && item.warehouseStocks.length > 1;

                          return (
                            <tr
                              key={item.lineId}
                              style={{
                                borderBottom: '1px solid #f1f5f9',
                                backgroundColor: '#ffffff',
                              }}
                            >
                              {/* Product Info */}
                              <td style={{ padding: '8px 12px' }}>
                                <div style={{ fontWeight: 700, color: '#0f172a' }}>{item.productName}</div>
                                {item.barcode && (
                                  <div style={{ fontSize: '11px', color: '#64748b' }}>{item.barcode}</div>
                                )}
                              </td>

                              {/* Source Warehouse Switcher / Badge */}
                              <td style={{ padding: '8px 10px' }}>
                                {selectedWarehouseFilter === 'all' && hasMultipleWarehouses ? (
                                  <select
                                    value={item.sourceWarehouseId}
                                    onChange={(e) =>
                                      handleChangeItemWarehouse(item.lineId, Number(e.target.value))
                                    }
                                    style={{
                                      width: '100%',
                                      height: '30px',
                                      fontSize: '11.5px',
                                      borderRadius: '6px',
                                      border: '1px solid #cbd5e1',
                                      backgroundColor: '#f8fafc',
                                      padding: '0 6px',
                                      color: '#1e293b',
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {item.warehouseStocks.map((ws) => (
                                      <option key={ws.warehouseId} value={ws.warehouseId}>
                                        {ws.warehouseName} ({ws.qty})
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <div
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      backgroundColor: '#f1f5f9',
                                      padding: '3px 8px',
                                      borderRadius: '6px',
                                      fontSize: '11.5px',
                                      color: '#334155',
                                      fontWeight: 600,
                                    }}
                                  >
                                    <WarehouseIcon size={12} color="#64748b" />
                                    <span>{item.sourceWarehouseName}</span>
                                  </div>
                                )}
                              </td>

                              {/* Available Stock Pill */}
                              <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                <span
                                  style={{
                                    display: 'inline-block',
                                    fontSize: '11.5px',
                                    fontWeight: 700,
                                    padding: '2px 8px',
                                    borderRadius: '6px',
                                    backgroundColor: item.availableInWarehouse > 0 ? '#dcfce7' : '#fee2e2',
                                    color: item.availableInWarehouse > 0 ? '#15803d' : '#b91c1c',
                                  }}
                                >
                                  {item.availableInWarehouse} {item.unit}
                                </span>
                              </td>

                              {/* Quantity Stepper & Direct Input */}
                              <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                <div
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    backgroundColor: '#f8fafc',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '6px',
                                    padding: '2px',
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateQty(item.lineId, item.qty + 1)}
                                    style={{
                                      width: '26px',
                                      height: '26px',
                                      borderRadius: '4px',
                                      border: '1px solid #e2e8f0',
                                      backgroundColor: '#ffffff',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      color: '#334155',
                                    }}
                                    title={t('delivery_reps.driver_load_requisition_modal.s22', "زيادة الكمية")}
                                  >
                                    <PlusIcon size={13} />
                                  </button>
                                  <input
                                    type="number"
                                    min="1"
                                    max={item.availableInWarehouse > 0 ? item.availableInWarehouse : undefined}
                                    value={item.qty}
                                    onChange={(e) => handleUpdateQty(item.lineId, Number(e.target.value) || 0)}
                                    style={{
                                      width: '44px',
                                      height: '26px',
                                      textAlign: 'center',
                                      fontSize: '13px',
                                      fontWeight: 800,
                                      border: 'none',
                                      backgroundColor: 'transparent',
                                      color: '#0f172a',
                                      outline: 'none',
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateQty(item.lineId, item.qty - 1)}
                                    style={{
                                      width: '26px',
                                      height: '26px',
                                      borderRadius: '4px',
                                      border: '1px solid #e2e8f0',
                                      backgroundColor: '#ffffff',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      color: '#334155',
                                    }}
                                    title={t('delivery_reps.driver_load_requisition_modal.s23', "إنقاص الكمية")}
                                  >
                                    <MinusIcon size={13} />
                                  </button>
                                </div>
                              </td>

                              {/* Item Total Value */}
                              <td style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, color: '#170e5e' }}>
                                {itemTotal.toFixed(2)} <CurrencySymbol />
                              </td>

                              {/* Remove Line Action */}
                              <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveItem(item.lineId)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#94a3b8',
                                    cursor: 'pointer',
                                    padding: '4px',
                                    borderRadius: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }}
                                  title={t('delivery_reps.driver_load_requisition_modal.s24', "حذف الصنف")}
                                  onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                                  onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
                                >
                                  <Trash2Icon size={15} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    padding: '28px 16px',
                    textAlign: 'center',
                    backgroundColor: '#f8fafc',
                    borderRadius: '8px',
                    border: '1px dashed #cbd5e1',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <PackageIcon size={28} color="#94a3b8" />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>
                    {t('delivery_reps.driver_load_requisition_modal.s25', "لم يتم إضافة أصناف بعد")}
                  </span>
                  <span style={{ fontSize: '11.5px', color: '#94a3b8' }}>
                    {t('delivery_reps.driver_load_requisition_modal.s26', "ابحث عن الصنف بالاسم أو الباركود أعلاه لإضافته مباشرة وتحديد كميات التحميل")}
                  </span>
                </div>
              )}
            </div>

            {/* Summary Statistics Strip */}
            {cart.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '8px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '10px 14px',
                }}
              >
                <div>
                  <span style={{ display: 'block', fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                    {t('delivery_reps.driver_load_requisition_modal.s27', "عدد الأصناف:")}
                  </span>
                  <span style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
                    {summaryStats.distinctItems} {t('delivery_reps.driver_load_requisition_modal.s28', "صنف")}
                  </span>
                </div>
                <div>
                  <span style={{ display: 'block', fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                    {t('delivery_reps.driver_load_requisition_modal.s29', "إجمالي الوحدات:")}
                  </span>
                  <span style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
                    {summaryStats.totalUnits} {t('delivery_reps.driver_load_requisition_modal.s30', "قطعة")}
                  </span>
                </div>
                <div>
                  <span style={{ display: 'block', fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                    {t('delivery_reps.driver_load_requisition_modal.s31', "إجمالي القيمة التقديرية:")}
                  </span>
                  <span style={{ fontSize: '14px', fontWeight: 800, color: '#170e5e' }}>
                    {summaryStats.totalEstimatedValue.toFixed(2)} <CurrencySymbol />
                  </span>
                </div>
              </div>
            )}

            {/* Warehouse Notes */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: '#334155',
                  marginBottom: '4px',
                }}
              >
                {t('delivery_reps.driver_load_requisition_modal.s32', "ملاحظات إضافية لمشرف المستودع (اختياري):")}
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('delivery_reps.driver_load_requisition_modal.s33', "مثال: يرجى صرف كميات إضافية لتغطية خط سير اليوم...")}
                style={{
                  width: '100%',
                  height: '36px',
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  padding: '0 10px',
                  fontSize: '12px',
                  boxSizing: 'border-box',
                  color: '#0f172a',
                }}
              />
            </div>

            {/* Standard Footer */}
            <StandardDialogFooter>
              <Button variant="secondary" onClick={handleReset} disabled={submitMutation.isPending}>
                {t('delivery_reps.driver_load_requisition_modal.s34', "إلغاء")}
              </Button>
              <Button
                variant="primary"
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending || cart.length === 0}
                style={{
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  fontWeight: 700,
                  padding: '8px 20px',
                  borderRadius: '8px',
                }}
              >
                {submitMutation.isPending
                  ? t('delivery_reps.driver_load_requisition_modal.s35', "جارٍ إرسال الطلب...")
                  : `إرسال طلب التحميل للمشرف (${cart.length} أصناف)`}
              </Button>
            </StandardDialogFooter>
          </>
        )}
      </div>
    </StandardDialog>
  );
}
