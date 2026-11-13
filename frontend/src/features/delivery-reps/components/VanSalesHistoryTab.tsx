import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { CustomSelect } from '@/shared/ui/custom-select';
import {
  PrinterIcon,
  ReceiptIcon,
  SearchIcon,
  RefreshCwIcon,
  PlusIcon,
  XIcon,
} from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { cleanWhatsAppPhone } from '@/lib/whatsapp';
import { vanSalesApi, DriverSaleHistoryItem } from '../api/van-sales.api';
import {
  printVanSaleThermalReceipt,
  formatVanSaleShareMessage,
  VanSaleReceiptData,
} from '../utils/van-sales-receipt.utils';

interface CustomerOption {
  id: number;
  name: string;
  phone?: string;
  customerCode?: string;
}

interface VanSalesHistoryTabProps {
  tripId?: number;
  customers?: CustomerOption[];
  onViewReceipt: (receiptData: VanSaleReceiptData) => void;
  onGoToNewSale?: () => void;
  storeName?: string;
}

export const VanSalesHistoryTab: React.FC<VanSalesHistoryTabProps> = ({
  tripId,
  customers = [],
  onViewReceipt,
  onGoToNewSale,
  storeName,
}) => {
  const { t } = useTranslation();
  const [dateScope, setDateScope] = useState<'today' | 'yesterday' | 'week' | 'all'>('today');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'cash' | 'credit' | 'card' | 'split'>('all');
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | ''>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [tripOnly, setTripOnly] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  const { data, isLoading, isRefetching, refetch } = useQuery<{ ok: boolean; sales: DriverSaleHistoryItem[] }>({
    queryKey: ['driver-sales-history', dateScope, selectedCustomerId, paymentFilter, searchQuery, tripOnly ? tripId : undefined],
    queryFn: () =>
      vanSalesApi.getDriverSales({
        dateScope,
        customerId: selectedCustomerId ? Number(selectedCustomerId) : undefined,
        paymentMethod: paymentFilter !== 'all' ? paymentFilter : undefined,
        search: searchQuery.trim() || undefined,
        tripId: tripOnly && tripId ? tripId : undefined,
      }),
    staleTime: 15000,
    refetchOnWindowFocus: false,
  });

  const handleRefresh = async () => {
    setIsManualRefreshing(true);
    try {
      const res = await refetch();
      const count = res.data?.sales?.length ?? 0;
      toast.success(`تم تحديث سجل الفواتير بنجاح (${count} فاتورة)`);
    } catch {
      toast.error('تعذر تحديث سجل الفواتير');
    } finally {
      setIsManualRefreshing(false);
    }
  };

  const sales = useMemo(() => data?.sales || [], [data?.sales]);

  // Aggregate metrics for visible sales
  const metrics = useMemo(() => {
    let totalSales = 0;
    let cashSales = 0;
    let creditSales = 0;
    let totalPieces = 0;
    let totalCartons = 0;

    sales.forEach((s) => {
      const amt = Number(s.total || 0);
      totalSales += amt;
      if (s.paymentMethod === 'cash') {
        cashSales += amt;
      } else {
        creditSales += amt;
      }
      if (s.packagingBreakdown) {
        totalPieces += Number(s.packagingBreakdown.piecesCount || 0);
        totalCartons += Number(s.packagingBreakdown.cartonsCount || 0);
      } else if (s.items) {
        totalPieces += s.items.reduce((sum, it) => sum + Number(it.qty || 0) * (Number(it.unitMultiplier || 1)), 0);
      }
    });

    return {
      count: sales.length,
      totalSales,
      cashSales,
      creditSales,
      totalPieces,
      totalCartons,
    };
  }, [sales]);

  const handleReprintReceipt = (sale: DriverSaleHistoryItem) => {
    try {
      const receiptData: VanSaleReceiptData = {
        docNo: sale.docNo,
        saleId: sale.id,
        total: sale.total,
        paymentMethod: sale.paymentMethod,
        paidAmount: sale.paidAmount,
        remainingCredit: sale.remainingCredit,
        customerName: sale.customerName,
        customerPhone: sale.customerPhone || undefined,
        customerCode: sale.customerCode || undefined,
        customerAddress: sale.customerAddress || undefined,
        itemsCount: sale.itemsCount,
        packagingBreakdown: sale.packagingBreakdown || undefined,
        deliveryProofPhoto: sale.deliveryProofPhoto || undefined,
        items: sale.items,
        repName: sale.repName,
        vehiclePlate: sale.vehiclePlate || undefined,
        date: sale.createdAt,
      };

      printVanSaleThermalReceipt(receiptData, { storeName, widthMm: 80 });
      toast.success(`تم إرسال إيصال الفاتورة #${sale.docNo} لطابعة الـ 80 مم`);
    } catch (err: any) {
      toast.error(err?.message || 'تعذر فتح أمر الطباعة الحرارية');
    }
  };

  const handleOpenReceiptModal = (sale: DriverSaleHistoryItem) => {
    const receiptData: VanSaleReceiptData = {
      docNo: sale.docNo,
      saleId: sale.id,
      total: sale.total,
      subtotal: sale.subtotal,
      discount: sale.discount,
      paymentMethod: sale.paymentMethod,
      paidAmount: sale.paidAmount,
      remainingCredit: sale.remainingCredit,
      customerName: sale.customerName,
      customerPhone: sale.customerPhone || undefined,
      customerCode: sale.customerCode || undefined,
      customerAddress: sale.customerAddress || undefined,
      itemsCount: sale.itemsCount,
      packagingBreakdown: sale.packagingBreakdown || undefined,
      deliveryProofPhoto: sale.deliveryProofPhoto || undefined,
      items: sale.items,
      repName: sale.repName,
      vehiclePlate: sale.vehiclePlate || undefined,
      date: sale.createdAt,
    };
    onViewReceipt(receiptData);
  };

  const handleShareWhatsApp = (sale: DriverSaleHistoryItem) => {
    if (!sale.customerPhone) {
      toast.info('رقم هاتف العميل غير مسجل بالفاتورة. يرجى إدخال الرقم في نافذة الإيصال للمشاركة.');
      handleOpenReceiptModal(sale);
      return;
    }
    const receiptData: VanSaleReceiptData = {
      docNo: sale.docNo,
      saleId: sale.id,
      total: sale.total,
      subtotal: sale.subtotal,
      discount: sale.discount,
      paymentMethod: sale.paymentMethod,
      paidAmount: sale.paidAmount,
      remainingCredit: sale.remainingCredit,
      customerName: sale.customerName,
      customerPhone: sale.customerPhone || undefined,
      customerCode: sale.customerCode || undefined,
      customerAddress: sale.customerAddress || undefined,
      itemsCount: sale.itemsCount,
      packagingBreakdown: sale.packagingBreakdown || undefined,
      deliveryProofPhoto: sale.deliveryProofPhoto || undefined,
      items: sale.items,
      repName: sale.repName,
      vehiclePlate: sale.vehiclePlate || undefined,
      date: sale.createdAt,
    };
    const message = formatVanSaleShareMessage(receiptData, { storeName });
    const target = cleanWhatsAppPhone(sale.customerPhone);
    if (!target) {
      handleOpenReceiptModal(sale);
      return;
    }
    window.open(`https://wa.me/${target}?text=${encodeURIComponent(message)}`, '_blank');
    toast.info('تم فتح تطبيق الواتساب لإرسال الإيصال');
  };

  return (
    <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
      {/* 1. HEADER & KPI CARDS (COMPACT SINGLE ROW) */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '10px',
          border: '1px solid #e2e8f0',
          padding: '8px 10px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '6px',
            marginBottom: '6px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
            <ReceiptIcon size={15} color="#170e5e" />
            <h2 style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', margin: 0, whiteSpace: 'nowrap' }}>
              {t('delivery_reps.van_sales_history_tab.s0', "سجل الفواتير")}
            </h2>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 700,
                backgroundColor: '#eef2ff',
                color: '#170e5e',
                padding: '1px 5px',
                borderRadius: '6px',
                whiteSpace: 'nowrap',
              }}
            >
              {metrics.count} {t('delivery_reps.van_sales_history_tab.s1', "فاتورة")}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isLoading || isRefetching || isManualRefreshing}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                padding: '2px 8px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                color: '#475569',
                fontSize: '10.5px',
                fontWeight: 700,
                cursor: 'pointer',
                height: '26px',
              }}
              title={t('delivery_reps.van_sales_history_tab.s2', "تحديث قائمة الفواتير")}
            >
              <RefreshCwIcon size={11} className={isRefetching || isManualRefreshing ? 'spin-icon' : ''} />
              <span>{isManualRefreshing ? t('delivery_reps.van_sales_history_tab.s3', "جاري...") : t('delivery_reps.van_sales_history_tab.s4', "تحديث")}</span>
            </button>

            {onGoToNewSale && (
              <button
                type="button"
                onClick={onGoToNewSale}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  padding: '2px 8px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  height: '26px',
                  whiteSpace: 'nowrap',
                }}
              >
                <PlusIcon size={11} color="#ffffff" />
                <span>{t('delivery_reps.van_sales_history_tab.s5', "+ فاتورة")}</span>
              </button>
            )}
          </div>
        </div>

        {/* METRICS SUMMARY STRIP (EXACTLY 1 COMPACT ROW) */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '6px 4px',
            textAlign: 'center',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ flex: '1 1 0', minWidth: 0, borderInlineEnd: '1px solid #e2e8f0', padding: '2px 4px' }}>
            <div style={{ fontSize: '9.5px', color: '#64748b', fontWeight: 700, marginBottom: '2px' }}>{t('delivery_reps.van_sales_history_tab.s6', "المبيعات")}</div>
            <div style={{ fontSize: '11.5px', fontWeight: 900, color: '#170e5e', whiteSpace: 'nowrap' }}>
              {metrics.totalSales.toFixed(2)} <CurrencySymbol />
            </div>
          </div>

          <div style={{ flex: '1 1 0', minWidth: 0, borderInlineEnd: '1px solid #e2e8f0', padding: '2px 4px' }}>
            <div style={{ fontSize: '9.5px', color: '#166534', fontWeight: 700, marginBottom: '2px' }}>{t('delivery_reps.van_sales_history_tab.s7', "النقدي")}</div>
            <div style={{ fontSize: '11.5px', fontWeight: 900, color: '#166534', whiteSpace: 'nowrap' }}>
              {metrics.cashSales.toFixed(2)} <CurrencySymbol />
            </div>
          </div>

          <div style={{ flex: '1 1 0', minWidth: 0, borderInlineEnd: '1px solid #e2e8f0', padding: '2px 4px' }}>
            <div style={{ fontSize: '9.5px', color: '#1e40af', fontWeight: 700, marginBottom: '2px' }}>{t('delivery_reps.van_sales_history_tab.s8', "الآجل")}</div>
            <div style={{ fontSize: '11.5px', fontWeight: 900, color: '#1e40af', whiteSpace: 'nowrap' }}>
              {metrics.creditSales.toFixed(2)} <CurrencySymbol />
            </div>
          </div>

          <div style={{ flex: '1 1 0', minWidth: 0, padding: '2px 4px' }}>
            <div style={{ fontSize: '9.5px', color: '#86198f', fontWeight: 700, marginBottom: '2px' }}>{t('delivery_reps.van_sales_history_tab.s9', "الطرود")}</div>
            <div style={{ fontSize: '11.5px', fontWeight: 900, color: '#86198f', whiteSpace: 'nowrap' }}>
              {metrics.totalPieces} {t('delivery_reps.van_sales_history_tab.s10', "قطعة")}
            </div>
          </div>
        </div>
      </div>

      {/* 2. FILTERS CONTROL BAR (HIGH DENSITY) */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '10px',
          border: '1px solid #e2e8f0',
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        {/* ROW 1: DATE PERIOD + TRIP CHECKBOX */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', marginInlineEnd: '4px' }}>{t('delivery_reps.van_sales_history_tab.s11', "الفترة:")}</span>
            {[
              { id: 'today', label: t('delivery_reps.van_sales_history_tab.s12', "اليوم") },
              { id: 'yesterday', label: t('delivery_reps.van_sales_history_tab.s13', "أمس") },
              { id: 'week', label: t('delivery_reps.van_sales_history_tab.s14', "آخر 7 أيام") },
              { id: 'all', label: t('delivery_reps.van_sales_history_tab.s15', "الكل") },
            ].map((p) => {
              const active = dateScope === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setDateScope(p.id as any)}
                  style={{
                    padding: '2px 8px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 600,
                    border: '1px solid',
                    borderColor: active ? '#170e5e' : '#cbd5e1',
                    backgroundColor: active ? '#170e5e' : '#f8fafc',
                    color: active ? '#ffffff' : '#334155',
                    cursor: 'pointer',
                    height: '26px',
                    boxSizing: 'border-box',
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {tripId && (
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                fontWeight: 700,
                color: '#170e5e',
                cursor: 'pointer',
                backgroundColor: tripOnly ? '#eef2ff' : 'transparent',
                padding: '2px 6px',
                borderRadius: '4px',
              }}
            >
              <input
                type="checkbox"
                checked={tripOnly}
                onChange={(e) => setTripOnly(e.target.checked)}
                style={{ accentColor: '#170e5e' }}
              />
              <span>{t('delivery_reps.van_sales_history_tab.s16', "رحلة اليوم (#")}{tripId})</span>
            </label>
          )}
        </div>

        {/* ROW 2: PAYMENT METHOD PILLS */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', marginInlineEnd: '4px' }}>{t('delivery_reps.van_sales_history_tab.s17', "الدفع:")}</span>
          {[
            { id: 'all', label: t('delivery_reps.van_sales_history_tab.s18', "الكل") },
            { id: 'cash', label: t('delivery_reps.van_sales_history_tab.s19', "نقدي") },
            { id: 'credit', label: t('delivery_reps.van_sales_history_tab.s20', "آجل") },
            { id: 'split', label: t('delivery_reps.van_sales_history_tab.s21', "دفع مركب") },
            { id: 'card', label: t('delivery_reps.van_sales_history_tab.s22', "شبكة/فيزا") },
          ].map((pm) => {
            const active = paymentFilter === pm.id;
            return (
              <button
                key={pm.id}
                type="button"
                onClick={() => setPaymentFilter(pm.id as any)}
                style={{
                  padding: '2px 8px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  border: '1px solid',
                  borderColor: active ? '#170e5e' : '#cbd5e1',
                  backgroundColor: active ? '#170e5e' : '#f8fafc',
                  color: active ? '#ffffff' : '#334155',
                  cursor: 'pointer',
                  height: '26px',
                  boxSizing: 'border-box',
                }}
              >
                {pm.label}
              </button>
            );
          })}
        </div>

        {/* ROW 3: SEARCH & CUSTOMER COMBOBOX */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('delivery_reps.van_sales_history_tab.s23', "بحث بالفاتورة أو الهاتف...")}
              style={{
                width: '100%',
                height: '32px',
                padding: '0 26px 0 20px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '11.5px',
                boxSizing: 'border-box',
                outline: 'none',
                backgroundColor: '#ffffff',
              }}
            />
            <div
              style={{
                position: 'absolute',
                right: '7px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                pointerEvents: 'none',
              }}
            >
              <SearchIcon size={13} />
            </div>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  left: '6px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <XIcon size={13} />
              </button>
            )}
          </div>

          {customers.length > 0 && (
            <div style={{ width: '130px', flexShrink: 0 }}>
              <CustomSelect
                value={selectedCustomerId ? String(selectedCustomerId) : ''}
                onChange={(val) => setSelectedCustomerId(val ? Number(val) : '')}
                options={[
                  { value: '', label: t('delivery_reps.van_sales_history_tab.s24', "كافة العملاء") },
                  ...customers.map((c) => ({
                    value: String(c.id),
                    label: `${c.name} ${c.customerCode ? `[${c.customerCode.replace(/^#/, '')}]` : ''}`,
                  })),
                ]}
                placeholder={t('delivery_reps.van_sales_history_tab.s25', "كافة العملاء")}
              />
            </div>
          )}
        </div>
      </div>

      {/* 3. INVOICES LIST */}
      {isLoading ? (
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            padding: '28px 16px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              border: '2.5px solid #e2e8f0',
              borderTopColor: '#170e5e',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 10px',
            }}
          />
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>
            {t('delivery_reps.van_sales_history_tab.s26', "جاري جلب سجل الفواتير والمبيعات...")}
          </div>
        </div>
      ) : sales.length === 0 ? (
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            padding: '24px 16px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              backgroundColor: '#f1f5f9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 10px',
              color: '#64748b',
            }}
          >
            <ReceiptIcon size={22} />
          </div>
          <h3 style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>
            {t('delivery_reps.van_sales_history_tab.s27', "لا توجد فواتير بيع مسجلة")}
          </h3>
          <p style={{ fontSize: '11.5px', color: '#64748b', margin: '0 auto 12px', maxWidth: '320px' }}>
            {t('delivery_reps.van_sales_history_tab.s28', "لم يتم العثور على أية فواتير مطابقة لخيارات التصفية المحددة.")}
          </p>
          {onGoToNewSale && (
            <button
              type="button"
              onClick={onGoToNewSale}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: '#170e5e',
                color: '#ffffff',
                fontSize: '11.5px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              <PlusIcon size={13} color="#ffffff" />
              <span>{t('delivery_reps.van_sales_history_tab.s29', "إصدار فاتورة بيع جديدة")}</span>
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {sales.map((sale) => {
            const dateObj = new Date(sale.createdAt);
            const dateStr = dateObj.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' });
            const timeStr = dateObj.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });

            return (
              <div
                key={sale.id}
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  boxSizing: 'border-box',
                }}
              >
                {/* CARD HEADER */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '6px',
                    borderBottom: '1px solid #f1f5f9',
                    paddingBottom: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontWeight: 800,
                        color: '#170e5e',
                        fontSize: '13.5px',
                        letterSpacing: '0.5px',
                      }}
                    >
                      #{sale.docNo}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        backgroundColor:
                          sale.paymentMethod === 'cash'
                            ? '#dcfce7'
                            : sale.paymentMethod === 'card'
                            ? '#e0f2fe'
                            : sale.paymentMethod === 'split'
                            ? '#f5f3ff'
                            : '#dbeafe',
                        color:
                          sale.paymentMethod === 'cash'
                            ? '#166534'
                            : sale.paymentMethod === 'card'
                            ? '#0369a1'
                            : sale.paymentMethod === 'split'
                            ? '#5b21b6'
                            : '#1e40af',
                        padding: '2px 8px',
                        borderRadius: '6px',
                      }}
                    >
                      {sale.paymentMethod === 'cash'
                        ? t('delivery_reps.van_sales_history_tab.s30', "نقدي (مسلم)")
                        : sale.paymentMethod === 'card'
                        ? t('delivery_reps.van_sales_history_tab.s31', "شبكة / فيزا")
                        : sale.paymentMethod === 'split'
                        ? t('delivery_reps.van_sales_history_tab.s32', "دفع مركب")
                        : t('delivery_reps.van_sales_history_tab.s33', "آجل (على الحساب)")}
                    </span>
                  </div>

                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                    {dateStr} - {timeStr}
                  </div>
                </div>

                {/* CARD BODY: CUSTOMER & DETAILS */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                      {sale.customerName}
                      {sale.customerCode && (
                        <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', marginRight: '6px' }}>
                          [{sale.customerCode.replace(/^#/, '')}]
                        </span>
                      )}
                    </div>
                    {sale.customerPhone && (
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                        {t('delivery_reps.van_sales_history_tab.s34', "هاتف:")} {sale.customerPhone}
                      </div>
                    )}
                  </div>

                  {/* TOTAL AMOUNT */}
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>{t('delivery_reps.van_sales_history_tab.s35', "إجمالي الفاتورة")}</div>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#166534', marginTop: '1px' }}>
                      {Number(sale.total || 0).toFixed(2)} <CurrencySymbol />
                    </div>
                  </div>
                </div>

                {/* PACKAGING PILL & ITEMS SUMMARY */}
                <div
                  style={{
                    backgroundColor: '#f8fafc',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    fontSize: '11.5px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    border: '1px solid #f1f5f9',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#475569', fontWeight: 700 }}>
                      {t('delivery_reps.van_sales_history_tab.s36', "محتوى الشحنة:")} {sale.packagingBreakdown?.cartonsCount ? `${sale.packagingBreakdown.cartonsCount} كرتونة | ` : ''}
                      {sale.packagingBreakdown?.piecesCount || sale.items?.reduce((s, it) => s + it.qty * (it.unitMultiplier || 1), 0) || 0} {t('delivery_reps.van_sales_history_tab.s37', "قطعة (")}{sale.itemsCount} {t('delivery_reps.van_sales_history_tab.s38', "صنف)")}
                    </span>
                    {sale.repName && (
                      <span style={{ color: '#64748b', fontSize: '10.5px' }}>
                        {t('delivery_reps.van_sales_history_tab.s39', "المندوب:")} {sale.repName} {sale.vehiclePlate ? `(${sale.vehiclePlate})` : ''}
                      </span>
                    )}
                  </div>

                  {sale.items && sale.items.length > 0 && (
                    <div style={{ color: '#64748b', fontSize: '11px', lineHeight: 1.4, marginTop: '2px' }}>
                      {sale.items.map((it) => `${it.name} × ${it.qty}`).join(t('delivery_reps.van_sales_history_tab.s40', " ، "))}
                    </div>
                  )}
                </div>

                {/* CARD FOOTER ACTIONS */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    gap: '8px',
                    paddingTop: '6px',
                    borderTop: '1px solid #f1f5f9',
                    flexWrap: 'wrap',
                  }}
                >
                  {sale.customerPhone && (
                    <button
                      type="button"
                      onClick={() => handleShareWhatsApp(sale)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '6px 12px',
                        borderRadius: '8px',
                        border: '1px solid #86efac',
                        backgroundColor: '#f0fdf4',
                        color: '#166534',
                        fontSize: '11.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                      title={t('delivery_reps.van_sales_history_tab.s41', "مشاركة تفاصيل الفاتورة عبر واتساب")}
                    >
                      <span>{t('delivery_reps.van_sales_history_tab.s42', "واتساب")}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleOpenReceiptModal(sale)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      backgroundColor: '#ffffff',
                      color: '#334155',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                    title={t('delivery_reps.van_sales_history_tab.s43', "معاينة إيصال الفاتورة التفصيلي")}
                  >
                    <ReceiptIcon size={14} />
                    <span>{t('delivery_reps.van_sales_history_tab.s44', "معاينة الإيصال")}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleReprintReceipt(sale)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 14px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: '#170e5e',
                      color: '#ffffff',
                      fontSize: '12px',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                    title={t('delivery_reps.van_sales_history_tab.s45', "إعادة طباعة الإيصال الحراري 80 مم فورياً")}
                  >
                    <PrinterIcon size={14} color="#ffffff" />
                    <span>{t('delivery_reps.van_sales_history_tab.s46', "إعادة طباعة (80mm)")}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
