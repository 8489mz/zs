import { useTranslation } from 'react-i18next';
import React, { useState, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vanSalesApi, CustomerEligibleSale, CustomerEligibleSaleItem, VanStockItem } from '../api/van-sales.api';
import { toast } from '@/shared/components/system-alert';
import { vanOfflineDb } from '../offline/van-sales-offline.db';
import type { CustomerOption } from './van-collection/van-collection-types';
import { CollectionHeader } from './van-collection/collection-header';
import { CollectionActiveBox } from './van-collection/collection-active-box';
import { CollectionCustomersGrid } from './van-collection/collection-customers-grid';
import { CollectionReturnResult } from './van-collection/collection-return-result';
import { CollectionReturnForm } from './van-collection/collection-return-form';


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
    // INV-VAN-RETURN-LINKAGE-PAYMENT-LOCK: a new van field return must
    // link to its original invoice — unlinked returns are refused by
    // the server (RETURN_REQUIRES_SALE_ID). The picker below has no
    // empty option anymore; this guard covers the offline path, which
    // shares this handler.
    if (!selectedSaleId) {
      toast.warning('يرجى اختيار الفاتورة الأصلية للمرتجع');
      return;
    }
    if (!returnCart.length) {
      toast.warning('يرجى إضافة صنف واحد على الأقل للمرتجع');
      return;
    }

    const payload = {
      tripId,
      customerId: Number(returnCustomerId),
      saleId: Number(selectedSaleId),
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
          <CollectionHeader
            activeFilterMode={activeFilterMode}
            collectionSearch={collectionSearch}
            customers={customers}
            indebtedCustomers={indebtedCustomers}
            setCollectionSearch={setCollectionSearch}
            setFilterMode={setFilterMode}
            totalIndebtedAmount={totalIndebtedAmount}
          />

          {/* Focused Active Collection Box (When a customer is selected) */}
          {selectedCustomer && (
            <CollectionActiveBox
              colAmount={colAmount}
              collectionFormRef={collectionFormRef}
              isSubmitting={isSubmitting}
              onColAmountChange={onColAmountChange}
              onColCustomerChange={onColCustomerChange}
              onSubmitCollection={onSubmitCollection}
              selectedCustomer={selectedCustomer}
            />
          )}

          {/* 4. The Indebted / All Customers Grid */}
          <CollectionCustomersGrid
            activeFilterMode={activeFilterMode}
            collectionSearch={collectionSearch}
            displayCustomers={displayCustomers}
            handleSelectCustomerForCollection={handleSelectCustomerForCollection}
            indebtedCustomers={indebtedCustomers}
            selectedCustomer={selectedCustomer}
            setFilterMode={setFilterMode}
          />
        </>
      ) : (
        <>
          {returnResult ? (
            <CollectionReturnResult
              returnResult={returnResult}
              setReturnResult={setReturnResult}
            />
          ) : (
            <CollectionReturnForm
              customers={customers}
              eligibleSales={eligibleSales}
              handleAddSaleItemToReturn={handleAddSaleItemToReturn}
              handleAddStockItemToReturn={handleAddStockItemToReturn}
              handleSubmitReturn={handleSubmitReturn}
              handleUpdateReturnQty={handleUpdateReturnQty}
              inventory={inventory}
              isLoadingSales={isLoadingSales}
              isSubmittingReturn={isSubmittingReturn}
              refundMethod={refundMethod}
              resolveUnlinkedUnitPrice={resolveUnlinkedUnitPrice}
              returnCart={returnCart}
              returnCustomerId={returnCustomerId}
              returnNotes={returnNotes}
              returnReason={returnReason}
              selectedSale={selectedSale}
              selectedSaleId={selectedSaleId}
              setRefundMethod={setRefundMethod}
              setReturnCart={setReturnCart}
              setReturnCustomerId={setReturnCustomerId}
              setReturnNotes={setReturnNotes}
              setReturnReason={setReturnReason}
              setSelectedSaleId={setSelectedSaleId}
              totalReturnAmount={totalReturnAmount}
            />
          )}
        </>
      )}
    </div>
  );
};
