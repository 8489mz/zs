import { useTranslation } from 'react-i18next';
import React, { useState, useMemo, useRef } from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { useQuery } from '@tanstack/react-query';
import { vanSalesApi, CustomerEligibleSale, CustomerEligibleSaleItem, VanStockItem } from '../api/van-sales.api';
import {
  CheckCircleIcon,
  SearchIcon,
  PhoneIcon,
  MapPinIcon,
  CreditCardIcon,
  XIcon,
} from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { vanOfflineDb } from '../offline/van-sales-offline.db';

interface CustomerOption {
  id: number;
  name: string;
  phone?: string;
  balance: number;
  creditLimit?: number;
  customerCode?: string;
  route?: string;
  district?: string;
  locationUrl?: string;
  // INV-VAN-UNLINKED-RETURN-PICKER: the sale cart prices wholesale
  // customers at the wholesale price; the unlinked return picker
  // applies the same rule, so it needs the type the page already
  // carries on these objects (customer_type, snake_case from the API).
  customer_type?: string;
}

interface VanCollectionTabProps {
  tripId: number;
  customers: CustomerOption[];
  // INV-VAN-UNLINKED-RETURN-PICKER: the trip's van-stock items, for
  // the unlinked return picker (no invoice selected). The page already
  // holds this list (data.inventory); the tab never had it.
  inventory?: VanStockItem[];
  colCustomerId: number | '';
  onColCustomerChange: (val: number | '') => void;
  colAmount: string;
  onColAmountChange: (val: string) => void;
  onSubmitCollection: () => void;
  isSubmitting: boolean;
  onReturnSuccess?: (docNo: string, amount: number) => void;
  initialSubMode?: 'collection' | 'return';
  initialReturnCustomerId?: number | '';
}

const RETURN_REASONS = [
  { value: 'damaged', label: 'بضاعة تالفة / كسر أثناء التخزين والنقل' },
  { value: 'expired', label: 'اقتراب أو انتهاء تاريخ الصلاحية' },
  { value: 'manufacturing_defect', label: 'عيب صناعة / عيب تعبئة وتغليف' },
  { value: 'stagnant', label: 'بضاعة راكدة / بطيئة الحركة لدى العميل' },
  { value: 'order_mismatch', label: 'خطأ في التوريد أو مقاسات الطلب' },
  { value: 'customer_request', label: 'رغبة العميل / رفض استلام' },
];

export const VanCollectionTab: React.FC<VanCollectionTabProps> = ({
  tripId,
  customers,
  inventory = [],
  colCustomerId,
  onColCustomerChange,
  colAmount,
  onColAmountChange,
  onSubmitCollection,
  isSubmitting,
  onReturnSuccess,
  initialSubMode,
  initialReturnCustomerId,
}) => {
  const { t } = useTranslation();
  const [subMode, setSubMode] = useState<'collection' | 'return'>(initialSubMode || 'collection');

  // Return form state
  const [returnCustomerId, setReturnCustomerId] = useState<number | ''>(initialReturnCustomerId || '');

  React.useEffect(() => {
    if (initialSubMode) {
      setSubMode(initialSubMode);
    }
  }, [initialSubMode]);

  React.useEffect(() => {
    if (initialReturnCustomerId) {
      setReturnCustomerId(initialReturnCustomerId);
    }
  }, [initialReturnCustomerId]);
  const [selectedSaleId, setSelectedSaleId] = useState<number | ''>('');
  const [returnReason, setReturnReason] = useState<string>('damaged');
  const [returnNotes, setReturnNotes] = useState<string>('');
  const [refundMethod, setRefundMethod] = useState<'credit' | 'cash'>('credit');
  const [returnCart, setReturnCart] = useState<Array<{
    productId: number;
    productName: string;
    qty: number;
    unitPrice: number;
    maxQty: number;
    saleItemId?: number;
    // INV-VAN-FIELD-RETURN-CARTON-QTY: the sale unit the qty is in.
    unitMultiplier?: number;
    unitName?: string;
  }>>([]);
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false);
  const [returnResult, setReturnResult] = useState<{ docNo: string; total: number } | null>(null);

  // Collections state & filters
  const [collectionSearch, setCollectionSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'indebted' | 'all'>('indebted');
  const collectionFormRef = useRef<HTMLDivElement>(null);

  // 1. Sort all customers by balance descending (highest positive debt first, then 0, then credit/negative)
  const sortedCustomers = useMemo(() => {
    return [...customers].sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0));
  }, [customers]);

  // 2. Customers with positive balance (debtors)
  const indebtedCustomers = useMemo(() => {
    return sortedCustomers.filter((c) => Number(c.balance || 0) > 0);
  }, [sortedCustomers]);

  const totalIndebtedAmount = useMemo(() => {
    return indebtedCustomers.reduce((sum, c) => sum + Number(c.balance || 0), 0);
  }, [indebtedCustomers]);

  // 3. Fallback: If no customers have debt, show 'all' automatically so page is never empty
  const activeFilterMode = indebtedCustomers.length === 0 ? 'all' : filterMode;
  const baseList = activeFilterMode === 'indebted' ? indebtedCustomers : sortedCustomers;

  const displayCustomers = useMemo(() => {
    if (!collectionSearch.trim()) return baseList;
    const q = collectionSearch.trim().toLowerCase();
    return baseList.filter((c) => {
      const name = (c.name || '').toLowerCase();
      const phone = (c.phone || '').toLowerCase();
      const code = (c.customerCode || '').toLowerCase();
      const route = (c.route || '').toLowerCase();
      const district = (c.district || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || code.includes(q) || route.includes(q) || district.includes(q);
    });
  }, [baseList, collectionSearch]);

  const selectedCustomer = useMemo(() => {
    if (!colCustomerId) return null;
    return customers.find((c) => c.id === Number(colCustomerId)) || null;
  }, [customers, colCustomerId]);

  const handleSelectCustomerForCollection = (c: CustomerOption) => {
    onColCustomerChange(c.id);
    onColAmountChange(String(c.balance > 0 ? c.balance : ''));
    if (collectionFormRef.current) {
      collectionFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Fetch eligible past sales for the selected return customer
  const { data: eligibleSales = [], isLoading: isLoadingSales } = useQuery<CustomerEligibleSale[]>({
    queryKey: ['van-return-eligible-sales', returnCustomerId],
    queryFn: () => vanSalesApi.getCustomerEligibleSales(Number(returnCustomerId)),
    enabled: Boolean(returnCustomerId && subMode === 'return'),
  });

  const selectedSale = eligibleSales.find((s) => s.id === Number(selectedSaleId));

  const handleAddSaleItemToReturn = (item: CustomerEligibleSaleItem) => {
    if (item.remainingReturnableQty <= 0) return;
    const existingIndex = returnCart.findIndex((c) => c.saleItemId === item.saleItemId);
    if (existingIndex >= 0) {
      if (returnCart[existingIndex].qty < item.remainingReturnableQty) {
        const updated = [...returnCart];
        updated[existingIndex].qty += 1;
        setReturnCart(updated);
      }
    } else {
      setReturnCart([
        ...returnCart,
        {
          productId: item.productId,
          productName: item.productName,
          qty: 1,
          unitPrice: item.netUnitPrice, // Net price after discount
          maxQty: item.remainingReturnableQty,
          saleItemId: item.saleItemId,
          unitMultiplier: item.unitMultiplier ?? 1,
          unitName: item.unitName ?? 'قطعة',
        },
      ]);
    }
  };

  // INV-VAN-UNLINKED-RETURN-PICKER: the unlinked return prices exactly
  // like the sale cart (VanSalesMobilePage addToCart) — wholesale price
  // for a wholesale-typed customer when it exists and is > 0, else the
  // retail price. Van-stock qty is in PIECES (P9), so the line carries
  // multiplier 1 and the base unit name.
  const resolveUnlinkedUnitPrice = (item: VanStockItem) => {
    const returnCustomer = customers.find((c) => c.id === Number(returnCustomerId));
    return returnCustomer?.customer_type === 'wholesale' && item.wholesalePrice != null && Number(item.wholesalePrice) > 0
      ? Number(item.wholesalePrice)
      : item.retailPrice;
  };

  const handleAddStockItemToReturn = (item: VanStockItem) => {
    if (item.qty <= 0) return;
    const existingIndex = returnCart.findIndex((c) => c.saleItemId === undefined && c.productId === item.productId);
    if (existingIndex >= 0) {
      if (returnCart[existingIndex].qty < item.qty) {
        const updated = [...returnCart];
        updated[existingIndex].qty += 1;
        setReturnCart(updated);
      }
    } else {
      setReturnCart([
        ...returnCart,
        {
          productId: item.productId,
          productName: item.productName,
          qty: 1,
          unitPrice: resolveUnlinkedUnitPrice(item),
          maxQty: item.qty,
          saleItemId: undefined,
          unitMultiplier: 1,
          unitName: item.stockUnitName || 'قطعة',
        },
      ]);
    }
  };

  const handleUpdateReturnQty = (index: number, delta: number) => {
    const updated = [...returnCart];
    const next = updated[index].qty + delta;
    if (next <= 0) {
      updated.splice(index, 1);
    } else if (next <= updated[index].maxQty) {
      updated[index].qty = next;
    }
    setReturnCart(updated);
  };

  const totalReturnAmount = returnCart.reduce((sum, it) => sum + it.qty * it.unitPrice, 0);

  const handleSubmitReturn = async () => {
    if (!returnCustomerId) {
      toast.warning('يرجى اختيار العميل');
      return;
    }
    if (!returnCart.length) {
      toast.warning('يرجى إضافة صنف واحد على الأقل للمرتجع');
      return;
    }

    const payload = {
      tripId,
      customerId: Number(returnCustomerId),
      saleId: selectedSaleId ? Number(selectedSaleId) : null,
      returnReason: returnReason as any,
      refundMethod,
      items: returnCart.map((c) => ({
        productId: c.productId,
        qty: c.qty,
        unitPrice: c.unitPrice,
        saleItemId: c.saleItemId,
        unitMultiplier: c.unitMultiplier,
        unitName: c.unitName,
      })),
      notes: returnNotes || undefined,
    };

    setIsSubmittingReturn(true);

    // Fast check if offline
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      try {
        const offRes = await vanOfflineDb.recordOfflineReturn(payload);
        setReturnResult({ docNo: offRes.docNo, total: offRes.totalAmount });
        setReturnCart([]);
        setReturnNotes('');
        toast.success(`تم حفظ إذن المرتجع أوفلاين #${offRes.docNo} وسيتم ترحيله للسيرفر تلقائياً.`);
        onReturnSuccess?.(offRes.docNo, offRes.totalAmount);
      } catch (err: any) {
        toast.error(err?.message || 'فشل حفظ إذن المرتجع محلياً');
      } finally {
        setIsSubmittingReturn(false);
      }
      return;
    }

    try {
      const res = await vanSalesApi.submitFieldReturn(payload);
      setReturnResult({ docNo: res.returnDocNo, total: res.totalAmount });
      setReturnCart([]);
      setReturnNotes('');
      toast.success(`تم إرسال إذن المرتجع #${res.returnDocNo} للإدارة بنجاح!`);
      onReturnSuccess?.(res.returnDocNo, res.totalAmount);
    } catch (err: any) {
      const isNetworkErr =
        !err?.status ||
        err?.status === 0 ||
        err?.message?.toLowerCase().includes('failed to fetch');

      if (isNetworkErr) {
        try {
          const offRes = await vanOfflineDb.recordOfflineReturn(payload);
          setReturnResult({ docNo: offRes.docNo, total: offRes.totalAmount });
          setReturnCart([]);
          setReturnNotes('');
          toast.success(`تم حفظ إذن المرتجع أوفلاين #${offRes.docNo} وسيتم ترحيله للسيرفر تلقائياً.`);
          onReturnSuccess?.(offRes.docNo, offRes.totalAmount);
          return;
        } catch (innerErr: any) {
          toast.error(innerErr?.message || 'فشل حفظ إذن المرتجع محلياً');
          return;
        }
      }
      toast.error(err?.message || 'فشل إرسال إذن المرتجع');
    } finally {
      setIsSubmittingReturn(false);
    }
  };

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '14px',
        border: '1px solid #e2e8f0',
        padding: '12px 10px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
      dir="rtl"
    >
      {/* Sub-Tabs: Collection vs Return (1 Horizontal Row) */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: '#f1f5f9',
          padding: '4px',
          borderRadius: '10px',
          gap: '6px',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <button
          type="button"
          onClick={() => { setSubMode('collection'); setReturnResult(null); }}
          style={{
            flex: '1 1 0',
            minWidth: 0,
            height: '34px',
            padding: '0 8px',
            borderRadius: '7px',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: subMode === 'collection' ? '#ffffff' : 'transparent',
            color: subMode === 'collection' ? '#170e5e' : '#64748b',
            fontWeight: 800,
            fontSize: '12px',
            boxShadow: subMode === 'collection' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
            whiteSpace: 'nowrap',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {t('delivery_reps.van_collection_tab.s0', "سند تحصيل نقدية")}
        </button>
        <button
          type="button"
          onClick={() => { setSubMode('return'); setReturnResult(null); }}
          style={{
            flex: '1 1 0',
            minWidth: 0,
            height: '34px',
            padding: '0 8px',
            borderRadius: '7px',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: subMode === 'return' ? '#ffffff' : 'transparent',
            color: subMode === 'return' ? '#170e5e' : '#64748b',
            fontWeight: 800,
            fontSize: '12px',
            boxShadow: subMode === 'return' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
            whiteSpace: 'nowrap',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {t('delivery_reps.van_collection_tab.s1', "إذن مرتجع ميداني")}
        </button>
      </div>

      {subMode === 'collection' ? (
        <>
          {/* 1. Header with Stats KPI Cards */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              borderBottom: '1px solid #f1f5f9',
              paddingBottom: '8px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '3px', height: '13px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
                <h3 style={{ margin: 0, fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
                  {t('delivery_reps.van_collection_tab.s2', "تحصيل مديونيات العملاء")}
                </h3>
              </div>
            </div>

            {/* Compact 1-Row KPI Strip */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '5px 8px',
                textAlign: 'center',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
              }}
            >
              <div style={{ flex: '1 1 0', borderInlineEnd: '1px solid #e2e8f0', padding: '1px 4px' }}>
                <span style={{ fontSize: '9.5px', color: '#64748b', fontWeight: 700, display: 'block' }}>{t('delivery_reps.van_collection_tab.s3', "إجمالي المديونيات")}</span>
                <strong style={{ fontSize: '12px', color: '#0f172a', fontWeight: 900 }}>
                  {totalIndebtedAmount.toFixed(0)} <CurrencySymbol />
                </strong>
              </div>
              <div style={{ flex: '1 1 0', borderInlineEnd: '1px solid #e2e8f0', padding: '1px 4px' }}>
                <span style={{ fontSize: '9.5px', color: '#64748b', fontWeight: 700, display: 'block' }}>{t('delivery_reps.van_collection_tab.s4', "عملاء مدينين")}</span>
                <strong style={{ fontSize: '12px', color: '#170e5e', fontWeight: 900 }}>
                  {indebtedCustomers.length} {indebtedCustomers.length === 1 ? t('delivery_reps.van_collection_tab.s5', "عميل") : indebtedCustomers.length === 2 ? t('delivery_reps.van_collection_tab.s6', "عميلان") : indebtedCustomers.length <= 10 ? t('delivery_reps.van_collection_tab.s7', "عملاء") : t('delivery_reps.van_collection_tab.s8', "عميل")}
                </strong>
              </div>
              <div style={{ flex: '1 1 0', padding: '1px 4px' }}>
                <span style={{ fontSize: '9.5px', color: '#64748b', fontWeight: 700, display: 'block' }}>{t('delivery_reps.van_collection_tab.s9', "إجمالي الخط")}</span>
                <strong style={{ fontSize: '12px', color: '#0f172a', fontWeight: 900 }}>
                  {customers.length} {customers.length === 1 ? t('delivery_reps.van_collection_tab.s10', "عميل") : customers.length === 2 ? t('delivery_reps.van_collection_tab.s11', "عميلان") : customers.length <= 10 ? t('delivery_reps.van_collection_tab.s12', "عملاء") : t('delivery_reps.van_collection_tab.s13', "عميل")}
                </strong>
              </div>
            </div>

            {/* Instant Search Bar */}
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type="text"
                value={collectionSearch}
                onChange={(e) => setCollectionSearch(e.target.value)}
                placeholder={t('delivery_reps.van_collection_tab.s14', "بحث باسم العميل، الكود، الحي، أو الهاتف...")}
                style={{
                  width: '100%',
                  height: '32px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '0 28px 0 8px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  boxSizing: 'border-box',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  right: '8px',
                  transform: 'translateY(-50%)',
                  pointerEvents: 'none',
                  color: '#94a3b8',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <SearchIcon size={13} />
              </div>
              {collectionSearch && (
                <button
                  type="button"
                  onClick={() => setCollectionSearch('')}
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '8px',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: '2px',
                  }}
                >
                  <XIcon size={13} />
                </button>
              )}
            </div>

            {/* Smart Filter Pills */}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setFilterMode('indebted')}
                style={{
                  flex: 1,
                  height: '28px',
                  padding: '0 8px',
                  borderRadius: '6px',
                  border: activeFilterMode === 'indebted' ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                  backgroundColor: activeFilterMode === 'indebted' ? '#170e5e' : '#f8fafc',
                  color: activeFilterMode === 'indebted' ? '#ffffff' : '#475569',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                }}
              >
                <span>{t('delivery_reps.van_collection_tab.s15', "المدينين فقط (")}{indebtedCustomers.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setFilterMode('all')}
                style={{
                  flex: 1,
                  height: '28px',
                  padding: '0 8px',
                  borderRadius: '6px',
                  border: activeFilterMode === 'all' ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                  backgroundColor: activeFilterMode === 'all' ? '#170e5e' : '#f8fafc',
                  color: activeFilterMode === 'all' ? '#ffffff' : '#475569',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                }}
              >
                <span>{t('delivery_reps.van_collection_tab.s16', "كل العملاء (")}{customers.length})</span>
              </button>
            </div>
          </div>

          {/* Focused Active Collection Box (When a customer is selected) */}
          {selectedCustomer && (
            <div
              ref={collectionFormRef}
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #c7d2fe',
                borderTop: '3px solid #170e5e',
                borderRadius: '12px',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                boxShadow: '0 2px 10px rgba(23, 14, 94, 0.06)',
              }}
            >
              {/* Row 1: Customer Info on Right & Debt Card on Left */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', marginBottom: '2px' }}>
                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 900, color: '#0f172a' }}>
                      {selectedCustomer.name}
                    </h4>
                    <span style={{ fontSize: '10px', color: '#475569', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', padding: '1px 5px', borderRadius: '4px', fontFamily: 'monospace', fontWeight: 700 }}>
                      [{selectedCustomer.customerCode?.replace(/^#/, '') || `C-${String(selectedCustomer.id).padStart(4, '0')}`}]
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>
                    {selectedCustomer.district || selectedCustomer.route || t('delivery_reps.van_collection_tab.s17', "الخط العام")}
                    {selectedCustomer.phone ? ` • ${selectedCustomer.phone}` : ''}
                  </div>
                </div>

                {/* Current Debt Box */}
                <div
                  style={{
                    backgroundColor: selectedCustomer.balance > 0 ? '#fef2f2' : selectedCustomer.balance < 0 ? '#eff6ff' : '#f0fdf4',
                    border: `1px solid ${selectedCustomer.balance > 0 ? '#fecaca' : selectedCustomer.balance < 0 ? '#bfdbfe' : '#bbf7d0'}`,
                    borderRadius: '6px',
                    padding: '4px 8px',
                    textAlign: 'left',
                    flexShrink: 0,
                  }}
                >
                  <div style={{ fontSize: '9px', color: selectedCustomer.balance > 0 ? '#991b1b' : selectedCustomer.balance < 0 ? '#1e40af' : '#166534', fontWeight: 700, marginBottom: '1px' }}>
                    {selectedCustomer.balance > 0 ? t('delivery_reps.van_collection_tab.s18', "المديونية الحالية:") : selectedCustomer.balance < 0 ? t('delivery_reps.van_collection_tab.s19', "رصيد دائن:") : t('delivery_reps.van_collection_tab.s20', "حساب خالص:")}
                  </div>
                  <div style={{ fontSize: '13.5px', fontWeight: 900, color: selectedCustomer.balance > 0 ? '#991b1b' : selectedCustomer.balance < 0 ? '#1d4ed8' : '#15803d', whiteSpace: 'nowrap' }}>
                    {selectedCustomer.balance > 0
                      ? `${selectedCustomer.balance.toFixed(2)} `
                      : selectedCustomer.balance < 0
                      ? `${Math.abs(selectedCustomer.balance).toFixed(2)}- `
                      : '0.00 '}
                    <CurrencySymbol />
                  </div>
                </div>
              </div>

              {/* Row 2: Quick Amount Presets (Side by Side strictly 50%/50%) */}
              {selectedCustomer.balance > 0 ? (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => onColAmountChange(String(selectedCustomer.balance))}
                    style={{
                      flex: '1 1 0',
                      minWidth: 0,
                      height: '32px',
                      backgroundColor: colAmount === String(selectedCustomer.balance) ? '#eef2ff' : '#f8fafc',
                      border: colAmount === String(selectedCustomer.balance) ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                      borderRadius: '6px',
                      padding: '0 6px',
                      fontSize: '11px',
                      fontWeight: 800,
                      color: colAmount === String(selectedCustomer.balance) ? '#170e5e' : '#1e293b',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span>{t('delivery_reps.van_collection_tab.s21', "سداد كامل")}</span>
                    <span style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 600 }}>
                      ({selectedCustomer.balance % 1 === 0 ? selectedCustomer.balance.toFixed(0) : selectedCustomer.balance.toFixed(2)})
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onColAmountChange(String((selectedCustomer.balance / 2).toFixed(2)))}
                    style={{
                      flex: '1 1 0',
                      minWidth: 0,
                      height: '32px',
                      backgroundColor: colAmount === String((selectedCustomer.balance / 2).toFixed(2)) ? '#eef2ff' : '#f8fafc',
                      border: colAmount === String((selectedCustomer.balance / 2).toFixed(2)) ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                      borderRadius: '6px',
                      padding: '0 6px',
                      fontSize: '11px',
                      fontWeight: 800,
                      color: colAmount === String((selectedCustomer.balance / 2).toFixed(2)) ? '#170e5e' : '#1e293b',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span>{t('delivery_reps.van_collection_tab.s22', "نصف المبلغ")}</span>
                    <span style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 600 }}>
                      ({(selectedCustomer.balance / 2) % 1 === 0 ? (selectedCustomer.balance / 2).toFixed(0) : (selectedCustomer.balance / 2).toFixed(2)})
                    </span>
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {[100, 200, 500, 1000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => onColAmountChange(String(amt))}
                      style={{
                        flex: 1,
                        minWidth: '60px',
                        height: '30px',
                        backgroundColor: colAmount === String(amt) ? '#eef2ff' : '#f8fafc',
                        border: colAmount === String(amt) ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 700,
                        color: colAmount === String(amt) ? '#170e5e' : '#334155',
                        cursor: 'pointer',
                      }}
                    >
                      {amt} {t('delivery_reps.van_collection_tab.s23', "ج.م")}
                    </button>
                  ))}
                </div>
              )}

              {/* Row 3: Collection Input */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: '#0f172a', marginBottom: '3px' }}>
                  {t('delivery_reps.van_collection_tab.s24', "المبلغ المحصل نقداً الآن (")}{getGlobalCurrencySymbol()}):
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={colAmount}
                  onChange={(e) => onColAmountChange(e.target.value)}
                  placeholder="0.00"
                  style={{
                    width: '100%',
                    height: '36px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    padding: '0 10px',
                    fontSize: '14px',
                    fontWeight: 800,
                    color: '#0f172a',
                    boxSizing: 'border-box',
                    outlineColor: '#170e5e',
                  }}
                />
              </div>

              {/* Row 4: Action Buttons */}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
                <Button
                  variant="primary"
                  onClick={onSubmitCollection}
                  disabled={isSubmitting || !Number(colAmount)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    backgroundColor: '#170e5e',
                    color: '#ffffff',
                    height: '36px',
                    fontSize: '12.5px',
                    fontWeight: 800,
                    padding: '0 12px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    border: 'none',
                    borderRadius: '6px',
                  }}
                >
                  {isSubmitting ? t('delivery_reps.van_collection_tab.s25', "جاري قيد السند...") : t('delivery_reps.van_collection_tab.s26', "إثبات تحصيل النقدية")}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    onColCustomerChange('');
                    onColAmountChange('');
                  }}
                  style={{
                    height: '36px',
                    padding: '0 14px',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    flexShrink: 0,
                    backgroundColor: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    color: '#475569',
                    borderRadius: '6px',
                  }}
                >
                  {t('delivery_reps.van_collection_tab.s27', "إلغاء")}
                </Button>
              </div>
            </div>
          )}

          {/* 4. The Indebted / All Customers Grid */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block', flexShrink: 0 }} />
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
                  {activeFilterMode === 'indebted' ? t('delivery_reps.van_collection_tab.s28', "العملاء المطلوب تحصيلهم") : t('delivery_reps.van_collection_tab.s29', "كافة عملاء خط السير")}
                </span>
                <span
                  style={{
                    fontSize: '10.5px',
                    fontWeight: 800,
                    backgroundColor: '#eef2ff',
                    color: '#170e5e',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    border: '1px solid #c7d2fe',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {displayCustomers.length}
                </span>
              </div>
              <span style={{ fontSize: '10px', color: '#64748b', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {t('delivery_reps.van_collection_tab.s30', "مرتبة بالأعلى مديونية")}
              </span>
            </div>

            {displayCustomers.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '24px 16px',
                  backgroundColor: '#ffffff',
                  borderRadius: '12px',
                  border: '1px dashed #cbd5e1',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                  <CheckCircleIcon size={32} color="#170e5e" />
                </div>
                <h4 style={{ margin: '0 0 4px', fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>
                  {collectionSearch
                    ? t('delivery_reps.van_collection_tab.s31', "لا توجد نتائج مطابقة لبحثك")
                    : activeFilterMode === 'indebted'
                    ? t('delivery_reps.van_collection_tab.s32', "لا توجد أي مديونيات مستحقة على عملاء خط السير حالياً")
                    : t('delivery_reps.van_collection_tab.s33', "لا يوجد عملاء مسجلين بالخط")}
                </h4>
                <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b' }}>
                  {activeFilterMode === 'indebted' && indebtedCustomers.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => setFilterMode('all')}
                      style={{
                        marginTop: '6px',
                        background: '#eef2ff',
                        border: '1px solid #c7d2fe',
                        color: '#170e5e',
                        padding: '4px 12px',
                        borderRadius: '6px',
                        fontSize: '11.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {t('delivery_reps.van_collection_tab.s34', "عرض كل العملاء لتسجيل دفعات نقدية مقدمة")}
                    </button>
                  ) : collectionSearch ? (
                    t('delivery_reps.van_collection_tab.s35', "جرب البحث بكلمة أخرى أو اضغط على إلغاء البحث")
                  ) : null}
                </p>
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: '10px',
                  paddingBottom: '24px',
                }}
              >
                {displayCustomers.map((c, idx) => {
                  const isSelected = selectedCustomer?.id === c.id;
                  const hasDebt = c.balance > 0;
                  const isCredit = c.balance < 0;

                  return (
                    <div
                      key={c.id}
                      style={{
                        backgroundColor: '#ffffff',
                        border: isSelected ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
                        borderRadius: '9px',
                        padding: '8px 10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        boxShadow: isSelected ? '0 2px 8px rgba(23, 14, 94, 0.08)' : '0 1px 2px rgba(0,0,0,0.02)',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {/* Row 1: [#1] Store Name [Code] on Right, Balance on Left */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0, flex: 1 }}>
                          <span
                            style={{
                              background: hasDebt ? '#fee2e2' : '#f1f5f9',
                              color: hasDebt ? '#991b1b' : '#475569',
                              border: hasDebt ? '1px solid #fecaca' : '1px solid #e2e8f0',
                              fontSize: '10px',
                              fontWeight: 800,
                              padding: '1px 5px',
                              borderRadius: '4px',
                              flexShrink: 0,
                            }}
                          >
                            #{idx + 1}
                          </span>
                          <span
                            style={{
                              fontSize: '13px',
                              fontWeight: 800,
                              color: '#0f172a',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              lineHeight: 1.25,
                            }}
                            title={c.name}
                          >
                            {c.name}
                          </span>
                          {c.customerCode && (
                            <span style={{ fontSize: '9.5px', color: '#64748b', fontFamily: 'monospace', fontWeight: 700, backgroundColor: '#f8fafc', padding: '1px 4px', borderRadius: '3px', border: '1px solid #e2e8f0', flexShrink: 0 }}>
                              [{c.customerCode.replace(/^#/, '')}]
                            </span>
                          )}
                        </div>

                        {/* Financial Status on Left */}
                        <div style={{ flexShrink: 0, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 600 }}>
                            {hasDebt ? t('delivery_reps.van_collection_tab.s36', "مطلوب:") : isCredit ? t('delivery_reps.van_collection_tab.s37', "دائن:") : t('delivery_reps.van_collection_tab.s38', "خالص:")}
                          </span>
                          <strong style={{ fontSize: '12.5px', color: hasDebt ? '#991b1b' : isCredit ? '#0369a1' : '#0f172a', fontWeight: 900 }}>
                            {hasDebt
                              ? `${c.balance.toFixed(2)} `
                              : isCredit
                              ? `${Math.abs(c.balance).toFixed(2)}- `
                              : '0.00 '}
                            <CurrencySymbol />
                          </strong>
                        </div>
                      </div>

                      {/* Row 2: Metadata (Route, Phone, Map) on Right, Action Button on Left */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', borderTop: '1px dashed #f1f5f9', paddingTop: '5px' }}>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', fontSize: '10px', minWidth: 0, flex: 1 }}>
                          {c.route && (
                            <span
                              style={{
                                background: '#f8fafc',
                                color: '#475569',
                                border: '1px solid #e2e8f0',
                                fontSize: '10px',
                                fontWeight: 600,
                                padding: '1px 5px',
                                borderRadius: '4px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '2px',
                                maxWidth: '130px',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                              title={c.route}
                            >
                              <MapPinIcon size={9} color="#64748b" />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.route}</span>
                            </span>
                          )}
                          {c.phone && (
                            <a
                              href={`tel:${c.phone}`}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '2px',
                                color: '#475569',
                                textDecoration: 'none',
                                fontSize: '10px',
                                direction: 'ltr',
                                background: '#f8fafc',
                                border: '1px solid #e2e8f0',
                                padding: '1px 5px',
                                borderRadius: '4px',
                                fontWeight: 600,
                              }}
                            >
                              <PhoneIcon size={9} color="#64748b" />
                              <span>{c.phone}</span>
                            </a>
                          )}
                          {c.locationUrl && (
                            <a
                              href={c.locationUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '2px',
                                color: '#475569',
                                fontSize: '10px',
                                textDecoration: 'none',
                                fontWeight: 600,
                                background: '#f8fafc',
                                border: '1px solid #e2e8f0',
                                padding: '1px 5px',
                                borderRadius: '4px',
                              }}
                            >
                              <span>{t('delivery_reps.van_collection_tab.s39', "خريطة ↗")}</span>
                            </a>
                          )}
                        </div>

                        {/* Action Button on Left of Row 2 */}
                        <button
                          type="button"
                          onClick={() => handleSelectCustomerForCollection(c)}
                          style={{
                            height: '27px',
                            padding: '0 9px',
                            border: isSelected ? '1.5px solid #170e5e' : !hasDebt ? '1px solid #cbd5e1' : 'none',
                            borderRadius: '6px',
                            backgroundColor: isSelected ? '#eef2ff' : hasDebt ? '#170e5e' : '#f8fafc',
                            color: isSelected ? '#170e5e' : hasDebt ? '#ffffff' : '#170e5e',
                            fontWeight: 700,
                            fontSize: '10.5px',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                          }}
                        >
                          {isSelected ? (
                            <>
                              <CheckCircleIcon size={12} color="#170e5e" />
                              <span>{t('delivery_reps.van_collection_tab.s40', "محدد أعلاه")}</span>
                            </>
                          ) : hasDebt ? (
                            <>
                              <CreditCardIcon size={12} color="#ffffff" />
                              <span>{t('delivery_reps.van_collection_tab.s41', "تحصيل نقدية")}</span>
                            </>
                          ) : (
                            <>
                              <CreditCardIcon size={12} color="#170e5e" />
                              <span>{t('delivery_reps.van_collection_tab.s42', "+ دفعة نقدية")}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {returnResult ? (
            <div style={{ textAlign: 'center', padding: '24px 16px', backgroundColor: '#f0fdf4', borderRadius: '12px', border: '1px solid #bbf7d0' }}>
              <div style={{ width: '48px', height: '48px', backgroundColor: '#dcfce7', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px' }}>
                <CheckCircleIcon size={28} color="#16a34a" />
              </div>
              <h4 style={{ fontSize: '16px', fontWeight: 800, color: '#15803d', margin: '0 0 6px' }}>
                {t('delivery_reps.van_collection_tab.s43', "تم إرسال إذن المرتجع للإدارة بنجاح!")}
              </h4>
              <p style={{ fontSize: '13px', fontWeight: 700, color: '#166534', margin: '0 0 12px' }}>
                {t('delivery_reps.van_collection_tab.s44', "رقم الإذن: #")}{returnResult.docNo} {t('delivery_reps.van_collection_tab.s45', "| إجمالي القيمة:")} {returnResult.total.toFixed(2)} <CurrencySymbol />
              </p>
              <div style={{ fontSize: '11.5px', color: '#65a30d', backgroundColor: '#ffffff', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d9f99d', maxWidth: '420px', margin: '0 auto 16px', lineHeight: 1.5 }}>
                {t('delivery_reps.van_collection_tab.s46', "ملاحظة رقابية: تم تسجيل إذن المرتجع بحالة (قيد مراجعة الإدارة). لن يتم خصم القيمة من حساب العميل أو زيادة رصيد السيارة إلا بعد اعتماد مشرف المستودع.")}
              </div>
              <Button
                variant="primary"
                onClick={() => setReturnResult(null)}
                style={{ backgroundColor: '#170e5e', color: '#ffffff' }}
              >
                {t('delivery_reps.van_collection_tab.s47', "تسجيل إذن مرتجع جديد")}
              </Button>
            </div>
          ) : (
            <>
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                {t('delivery_reps.van_collection_tab.s48', "تسجيل مرتجع بضاعة ومطابقة سعر الفاتورة الأصلية")}
              </h3>

              {/* 1. Customer Select */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('delivery_reps.van_collection_tab.s49', "اختيار العميل المسترجع منه:")}
                </label>
                <CustomSelect
                  value={returnCustomerId ? String(returnCustomerId) : ''}
                  onChange={(val) => {
                    setReturnCustomerId(val ? Number(val) : '');
                    setSelectedSaleId('');
                    setReturnCart([]);
                  }}
                  options={[
                    { value: '', label: t('delivery_reps.van_collection_tab.s50', "-- اختر العميل --") },
                    ...customers.map((c) => ({
                      value: String(c.id),
                      label: `${c.name} ${c.phone ? `(${c.phone})` : ''}`,
                      hint: `مديونية: ${c.balance.toFixed(2)} ${getGlobalCurrencySymbol()}`,
                    })),
                  ]}
                  placeholder={t('delivery_reps.van_collection_tab.s51', "اختر العميل")}
                />
              </div>

              {/* 2. Original Invoice Linking */}
              {returnCustomerId && (
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('delivery_reps.van_collection_tab.s52', "ربط بالفاتورة الأصلية (لفحص صافي الخصم وسعر البند الفعلي):")}
                  </label>
                  {isLoadingSales ? (
                    <div style={{ fontSize: '12px', color: '#94a3b8' }}>{t('delivery_reps.van_collection_tab.s53', "جاري جلب فواتير العميل السابقة...")}</div>
                  ) : eligibleSales.length === 0 ? (
                    <div style={{ fontSize: '12px', color: '#64748b', backgroundColor: '#f8fafc', padding: '8px 12px', borderRadius: '8px' }}>
                      {t('delivery_reps.van_collection_tab.s54', "لا توجد فواتير مرحلة سابقة لهذا العميل.")}
                    </div>
                  ) : (
                    <CustomSelect
                      value={selectedSaleId ? String(selectedSaleId) : ''}
                      onChange={(val) => {
                        setSelectedSaleId(val ? Number(val) : '');
                        setReturnCart([]);
                      }}
                      options={[
                        { value: '', label: t('delivery_reps.van_collection_tab.s55', "-- اختر فاتورة سابقة (موصى به) --") },
                        ...eligibleSales.map((s) => ({
                          value: String(s.id),
                          label: `فاتورة #${s.docNo} - تاريخ: ${s.createdAt.slice(0, 10)} - إجمالي: ${s.total.toFixed(2)} ${getGlobalCurrencySymbol()}`,
                          hint: s.discount > 0 ? `خصم: ${s.discount}` : undefined,
                        })),
                      ]}
                      placeholder={t('delivery_reps.van_collection_tab.s56', "اختر الفاتورة الأصلية")}
                    />
                  )}
                </div>
              )}

              {/* 3. Items from Selected Sale */}
              {selectedSale && selectedSale.items.length > 0 && (
                <div style={{ backgroundColor: '#f8fafc', borderRadius: '10px', padding: '12px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '12px', fontWeight: 800, color: '#1e293b', display: 'block', marginBottom: '8px' }}>
                    {t('delivery_reps.van_collection_tab.s57', "بنود الفاتورة الأصلية #")}{selectedSale.docNo} {t('delivery_reps.van_collection_tab.s58', "(الأسعار الصافية بعد الخصم):")}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {selectedSale.items.map((it: CustomerEligibleSaleItem) => (
                      <div
                        key={it.saleItemId}
                        style={{
                          backgroundColor: '#ffffff',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: '1px solid #cbd5e1',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '10px',
                        }}
                      >
                        <div>
                          <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a', display: 'block' }}>{it.productName}</span>
                          <span style={{ fontSize: '11px', color: '#64748b' }}>
                            {t('delivery_reps.van_collection_tab.s59', "المباع:")} {it.soldQty} {t('delivery_reps.van_collection_tab.s60', "| المرتجع سابقاً:")} {it.alreadyReturnedQty} {t('delivery_reps.van_collection_tab.s61', "| المتاح للإرجاع:")} {it.remainingReturnableQty}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 800, color: '#059669' }}>
                            {it.netUnitPrice.toFixed(2)} <CurrencySymbol /> {t('delivery_reps.van_collection_tab.s62', "/ ق")}
                          </span>
                          <button
                            type="button"
                            disabled={it.remainingReturnableQty <= 0}
                            onClick={() => handleAddSaleItemToReturn(it)}
                            style={{
                              backgroundColor: it.remainingReturnableQty > 0 ? '#170e5e' : '#cbd5e1',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '6px',
                              padding: '4px 8px',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: it.remainingReturnableQty > 0 ? 'pointer' : 'not-allowed',
                            }}
                          >
                            {t('delivery_reps.van_collection_tab.s63', "+ إضافة")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 3a. Unlinked return — van-stock picker (no invoice selected) */}
              {returnCustomerId && !selectedSale && (
                <div style={{ backgroundColor: '#f8fafc', borderRadius: '10px', padding: '12px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '12px', fontWeight: 800, color: '#1e293b', display: 'block', marginBottom: '8px' }}>
                    {t('delivery_reps.van_collection_tab.s79', "أو إرجاع بدون فاتورة — من بضاعة السيارة:")}
                  </span>
                  {inventory.length === 0 ? (
                    <div style={{ fontSize: '12px', color: '#64748b', backgroundColor: '#ffffff', padding: '8px 12px', borderRadius: '8px' }}>
                      {t('delivery_reps.van_collection_tab.s80', "لا توجد بضاعة محملة في السيارة حالياً.")}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {inventory.map((item) => (
                        <div
                          key={item.productId}
                          style={{
                            backgroundColor: '#ffffff',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid #cbd5e1',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '10px',
                          }}
                        >
                          <div>
                            <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a', display: 'block' }}>{item.productName}</span>
                            <span style={{ fontSize: '11px', color: '#64748b' }}>
                              {t('delivery_reps.van_collection_tab.s81', "المتاح في السيارة:")} {item.qty} {item.stockUnitName || 'قطعة'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 800, color: '#059669' }}>
                              {resolveUnlinkedUnitPrice(item).toFixed(2)} <CurrencySymbol /> {t('delivery_reps.van_collection_tab.s62', "/ ق")}
                            </span>
                            <button
                              type="button"
                              disabled={item.qty <= 0}
                              onClick={() => handleAddStockItemToReturn(item)}
                              style={{
                                backgroundColor: item.qty > 0 ? '#170e5e' : '#cbd5e1',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '6px',
                                padding: '4px 8px',
                                fontSize: '11px',
                                fontWeight: 700,
                                cursor: item.qty > 0 ? 'pointer' : 'not-allowed',
                              }}
                            >
                              {t('delivery_reps.van_collection_tab.s63', "+ إضافة")}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 4. Return Cart */}
              {returnCart.length > 0 && (
                <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '10px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 800, color: '#170e5e', display: 'block', marginBottom: '6px' }}>
                    {t('delivery_reps.van_collection_tab.s64', "أصناف إذن المرتجع المطلوب اعتمادها (")}{returnCart.length}):
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {returnCart.map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          backgroundColor: '#fef2f2',
                          borderRadius: '8px',
                          padding: '8px 12px',
                          border: '1px solid #fecaca',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <div>
                          <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#991b1b', display: 'block' }}>{item.productName}</span>
                          <span style={{ fontSize: '11px', color: '#b91c1c' }}>
                            {t('delivery_reps.van_collection_tab.s65', "سعر الإرجاع:")} {item.unitPrice.toFixed(2)} {getGlobalCurrencySymbol()} {item.saleItemId !== undefined ? t('delivery_reps.van_collection_tab.s66', "(صافي الفاتورة)") : t('delivery_reps.van_collection_tab.s82', "(سعر البيع)")}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <button
                            type="button"
                            onClick={() => handleUpdateReturnQty(idx, 1)}
                            disabled={item.qty >= item.maxQty}
                            style={{
                              width: '28px',
                              height: '28px',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              backgroundColor: item.qty < item.maxQty ? '#ffffff' : '#f1f5f9',
                              cursor: item.qty < item.maxQty ? 'pointer' : 'not-allowed',
                              fontWeight: 800,
                              fontSize: '15px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#1e293b',
                            }}
                          >
                            +
                          </button>
                          <span style={{ fontWeight: 800, fontSize: '13px', minWidth: '24px', textAlign: 'center', color: '#0f172a' }}>{item.qty}</span>
                          <button
                            type="button"
                            onClick={() => handleUpdateReturnQty(idx, -1)}
                            style={{
                              width: '28px',
                              height: '28px',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              backgroundColor: '#ffffff',
                              cursor: 'pointer',
                              fontWeight: 800,
                              fontSize: '15px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#1e293b',
                            }}
                          >
                            −
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', padding: '8px 12px', backgroundColor: '#f1f5f9', borderRadius: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 800, color: '#334155' }}>{t('delivery_reps.van_collection_tab.s67', "إجمالي قيمة المرتجع المطلوب:")}</span>
                    <span style={{ fontSize: '15px', fontWeight: 900, color: '#b91c1c' }}>{totalReturnAmount.toFixed(2)} <CurrencySymbol /></span>
                  </div>
                </div>
              )}

              {/* 5. Method of Refund (Credit vs Cash) */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  {t('delivery_reps.van_collection_tab.s68', "طريقة رد وتسوية قيمة المرتجع للعميل (إلزامي):")}
                </label>
                <div style={{ display: 'flex', flexDirection: 'row', gap: '8px', marginBottom: '10px', width: '100%', boxSizing: 'border-box' }}>
                  <button
                    type="button"
                    onClick={() => setRefundMethod('credit')}
                    style={{
                      flex: '1 1 0',
                      minWidth: 0,
                      padding: '8px 8px',
                      borderRadius: '8px',
                      border: refundMethod === 'credit' ? '2px solid #170e5e' : '1px solid #cbd5e1',
                      backgroundColor: refundMethod === 'credit' ? '#eff6ff' : '#ffffff',
                      color: refundMethod === 'credit' ? '#170e5e' : '#475569',
                      cursor: 'pointer',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: '11.5px', whiteSpace: 'nowrap' }}>{t('delivery_reps.van_collection_tab.s69', "خصم من الحساب (آجل)")}</div>
                    <div style={{ fontSize: '9.5px', color: '#64748b', marginTop: '2px', whiteSpace: 'nowrap' }}>
                      {t('delivery_reps.van_collection_tab.s70', "لا يخصم من كاش السيارة")}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRefundMethod('cash')}
                    style={{
                      flex: '1 1 0',
                      minWidth: 0,
                      padding: '8px 8px',
                      borderRadius: '8px',
                      border: refundMethod === 'cash' ? '2px solid #dc2626' : '1px solid #cbd5e1',
                      backgroundColor: refundMethod === 'cash' ? '#fef2f2' : '#ffffff',
                      color: refundMethod === 'cash' ? '#b91c1c' : '#475569',
                      cursor: 'pointer',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: '11.5px', whiteSpace: 'nowrap' }}>{t('delivery_reps.van_collection_tab.s71', "دفع كاش من السيارة")}</div>
                    <div style={{ fontSize: '9.5px', color: '#dc2626', marginTop: '2px', whiteSpace: 'nowrap' }}>
                      {t('delivery_reps.van_collection_tab.s72', "يخصم من توريد الكاش")}
                    </div>
                  </button>
                </div>
              </div>

              {/* 6. Return Reason Selection */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('delivery_reps.van_collection_tab.s73', "سبب المرتجع (إلزامي):")}
                </label>
                <CustomSelect
                  value={returnReason}
                  onChange={(val) => setReturnReason(val)}
                  options={RETURN_REASONS}
                  placeholder={t('delivery_reps.van_collection_tab.s74', "اختر سبب المرتجع")}
                />
              </div>

              {/* 6. Notes */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('delivery_reps.van_collection_tab.s75', "ملاحظات وتفاصيل إضافية:")}
                </label>
                <input
                  type="text"
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  placeholder={t('delivery_reps.van_collection_tab.s76', "ملاحظات إضافية عن سبب المرتجع...")}
                  style={{ width: '100%', height: '36px', backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0 10px', fontSize: '12px', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ fontSize: '10.5px', color: '#64748b', lineHeight: 1.4, backgroundColor: '#f8fafc', padding: '6px 10px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                {t('delivery_reps.van_collection_tab.s77', "تنبيه رقابي: بمجرد الحفظ، يُقيد المرتجع بحالة (قيد مراجعة المشرف) ولن يتم تسوية الحساب أو إضافة البضاعة للسيارة إلا بعد اعتماد الإدارة.")}
              </div>

              <Button
                variant="primary"
                onClick={handleSubmitReturn}
                disabled={isSubmittingReturn || returnCart.length === 0}
                style={{ backgroundColor: '#dc2626', color: '#ffffff', height: '42px', fontSize: '12.5px', fontWeight: 800 }}
              >
                {isSubmittingReturn ? t('delivery_reps.van_collection_tab.s78', "جاري رفع إذن المرتجع للإدارة...") : `إرسال إذن المرتجع للإدارة (${totalReturnAmount.toFixed(2)} ${getGlobalCurrencySymbol()})`}
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
};
