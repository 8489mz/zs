import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { formatCurrency } from '@/lib/format';
import { toast } from '@/shared/components/system-alert';
import {
  PlusIcon,
  Trash2Icon,
  LockIcon,
  PackageIcon,
} from '@/shared/components/icons/AppIcons';
import { OrderItemProductPicker } from './OrderItemProductPicker';
import { useFormDraft } from '@/shared/hooks/use-form-draft';
import { DraftRestoredBanner } from '@/shared/components/DraftRestoredBanner';
import type { Product } from '@/types/domain';
import { getProductPrice } from '@/features/pos';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits } from '@/shared/utils/money';
import type { CreateSalesOrderPayload, SalesOrderItem } from '../api/sales-orders.api';

interface SalesOrderItemFormRow extends SalesOrderItem {
  productId: number;
  productName: string;
  stockOnHand?: number;
  barcode?: string;
}

interface CreateSalesOrderModalProps {
  open: boolean;
  onClose: () => void;
  catalogProducts: Product[];
  onSubmit: (payload: CreateSalesOrderPayload) => void;
  isPending: boolean;
}

export const CreateSalesOrderModal: React.FC<CreateSalesOrderModalProps> = ({
  open,
  onClose,
  catalogProducts,
  onSubmit,
  isPending,
}) => {
  const { t } = useTranslation();
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [reservationExpiresAt, setReservationExpiresAt] = useState('');
  const [autoReserve, setAutoReserve] = useState(true);
  const [notes, setNotes] = useState('');
  const termsConditions = 'يتم حجز الأصناف المحددة بالمخزون لحين استلام العميل وسداد قيمة الفاتورة.';
  const [items, setItems] = useState<SalesOrderItemFormRow[]>([
    { productId: 0, productName: '', unitName: 'قطعة', quantity: 1, unitPrice: 0, discount: 0, total: 0, stockOnHand: 0 },
  ]);

  const draftData = useMemo(() => ({
    customerName,
    customerPhone,
    customerAddress,
    deliveryDate,
    reservationExpiresAt,
    autoReserve,
    notes,
    items,
  }), [customerName, customerPhone, customerAddress, deliveryDate, reservationExpiresAt, autoReserve, notes, items]);

  const resetForm = () => {
    clearDraft();
    setCustomerName('');
    setCustomerPhone('');
    setCustomerAddress('');
    setDeliveryDate('');
    setReservationExpiresAt('');
    setAutoReserve(true);
    setNotes('');
    setItems([
      { productId: 0, productName: '', unitName: 'قطعة', quantity: 1, unitPrice: 0, discount: 0, total: 0, stockOnHand: 0 },
    ]);
  };

  const { clearDraft, isDraftRestored, dismissRestoredNotice } = useFormDraft({
    key: 'z_draft_sales_order',
    data: draftData,
    isEmpty: (d) => {
      const hasHeader = Boolean(d.customerName?.trim() || d.customerPhone?.trim() || d.notes?.trim());
      const hasItems = Array.isArray(d.items) && d.items.some(it => Boolean(it.productId > 0 || it.productName?.trim()));
      return !hasHeader && !hasItems;
    },
    onRestore: (saved) => {
      if (saved.customerName) setCustomerName(saved.customerName);
      if (saved.customerPhone) setCustomerPhone(saved.customerPhone);
      if (saved.customerAddress) setCustomerAddress(saved.customerAddress);
      if (saved.deliveryDate) setDeliveryDate(saved.deliveryDate);
      if (saved.reservationExpiresAt) setReservationExpiresAt(saved.reservationExpiresAt);
      if (typeof saved.autoReserve === 'boolean') setAutoReserve(saved.autoReserve);
      if (saved.notes) setNotes(saved.notes);
      if (Array.isArray(saved.items) && saved.items.length > 0) {
        setItems(saved.items);
      }
    },
  });

  const handleItemChange = (index: number, field: keyof SalesOrderItemFormRow, value: any) => {
    const updated = [...items];
    const item = { ...updated[index], [field]: value };
    const qty = Number(field === 'quantity' ? value : item.quantity) || 0;

    // If quantity changes, re-evaluate active offers on the selected product
    if (field === 'quantity' && item.productId > 0) {
      const foundProd = catalogProducts?.find((p) => Number(p.id) === Number(item.productId));
      if (foundProd && foundProd.offers && foundProd.offers.length > 0) {
        const promoPrice = getProductPrice(foundProd, 'retail', qty || 1, 1, currencyMoneyDigits(getGlobalSystemCurrency()));
        if (promoPrice > 0) {
          item.unitPrice = promoPrice;
        }
      }
    }

    const price = Number(field === 'unitPrice' ? value : item.unitPrice) || 0;
    const discount = Number(field === 'discount' ? value : item.discount) || 0;
    item.total = Math.max(0, qty * price - discount);
    updated[index] = item;
    setItems(updated);
  };

  const handleSelectProduct = (index: number, prod: Product) => {
    const updated = [...items];
    const qty = Number(updated[index]?.quantity) || 1;
    const basePrice = Number(prod.retailPrice || prod.wholesalePrice || 0);
    const promoPrice = prod.offers && prod.offers.length > 0 ? getProductPrice(prod, 'retail', qty, 1, currencyMoneyDigits(getGlobalSystemCurrency())) : basePrice;
    const price = promoPrice > 0 ? promoPrice : basePrice;
    const discount = Number(updated[index]?.discount) || 0;
    const unit = prod.units?.[0]?.name || 'قطعة';
    const stock = Number(prod.stock ?? 0);

    updated[index] = {
      ...updated[index],
      productId: Number(prod.id),
      productName: prod.name,
      unitName: unit,
      unitPrice: price,
      stockOnHand: stock,
      barcode: prod.barcode || '',
      total: Math.max(0, qty * price - discount),
    };
    setItems(updated);
  };

  const handleAddItem = () => {
    setItems([
      ...items,
      {
        productId: 0,
        productName: '',
        unitName: 'قطعة',
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        total: 0,
        stockOnHand: 0,
      },
    ]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const subtotal = items.reduce(
    (sum, it) => sum + Number(it.quantity || 0) * Number(it.unitPrice || 0),
    0
  );
  const totalDiscount = items.reduce((sum, it) => sum + Number(it.discount || 0), 0);
  const totalAmount = Math.max(0, subtotal - totalDiscount);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!customerName.trim()) {
      toast.error('يرجى كتابة اسم العميل');
      return;
    }

    const validItems = items.filter((it) => it.productName.trim() && Number(it.quantity) > 0);
    if (validItems.length === 0) {
      toast.error('يرجى إضافة صنف واحد على الأقل باسم وكمية صحيحة');
      return;
    }

    onSubmit({
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || undefined,
      customerAddress: customerAddress.trim() || undefined,
      deliveryDate: deliveryDate || undefined,
      reservationExpiresAt: reservationExpiresAt || undefined,
      autoReserve,
      subtotal,
      discountAmount: totalDiscount,
      taxAmount: 0,
      totalAmount,
      notes: notes.trim() || undefined,
      termsConditions: termsConditions.trim() || undefined,
      items: validItems.map((it) => ({
        productId: it.productId,
        productName: it.productName.trim(),
        unitName: it.unitName?.trim(),
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        discount: Number(it.discount || 0),
        total: Number(it.total),
        notes: it.notes?.trim(),
      })),
    });
  };

  if (!open) return null;

  return (
    <StandardDialog
      isOpen={open}
      onClose={onClose}
      title={t('sales.create_sales_order_modal.s0', "إنشاء أمر بيع جديد (Sales Order)")}
      subtitle={t('sales.create_sales_order_modal.s1', "حجز المخزون وتثبيت الأسعار والكميات المعتمدة للعميل")}
      maxWidth="940px"
      footer={
        <StandardDialogFooter
          onClose={onClose}
          closeLabel={t('sales.create_sales_order_modal.s2', "إلغاء")}
          primaryButton={{
            label: isPending ? t('sales.create_sales_order_modal.s3', "جاري الحفظ...") : t('sales.create_sales_order_modal.s4', "حفظ أمر البيع وحجز المخزون"),
            onClick: () => handleSubmit(),
            disabled: isPending,
          }}
        />
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <DraftRestoredBanner
            show={isDraftRestored}
            onClear={resetForm}
            onDismiss={dismissRestoredNotice}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
            <div className="field">
              <label className="field-label" style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>
                {t('sales.create_sales_order_modal.s5', "اسم العميل")} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                required
                placeholder={t('sales.create_sales_order_modal.s6', "اسم العميل أو المنشأة...")}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12.5px', backgroundColor: '#f8fafc', boxSizing: 'border-box' }}
              />
            </div>

            <div className="field">
              <label className="field-label" style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>
                {t('sales.create_sales_order_modal.s7', "هاتف العميل")}
              </label>
              <input
                type="text"
                placeholder={t('sales.create_sales_order_modal.s8', "رقم الهاتف للتواصل...")}
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12.5px', backgroundColor: '#f8fafc', boxSizing: 'border-box' }}
              />
            </div>

            <div className="field">
              <label className="field-label" style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>
                {t('sales.create_sales_order_modal.s9', "تاريخ التسليم المتوقع")}
              </label>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12.5px', backgroundColor: '#f8fafc', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
            <div className="field">
              <label className="field-label" style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>
                {t('sales.create_sales_order_modal.s10', "صلاحية حجز المخزون حتى")}
              </label>
              <input
                type="date"
                value={reservationExpiresAt}
                onChange={(e) => setReservationExpiresAt(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12.5px', backgroundColor: '#f8fafc', boxSizing: 'border-box' }}
              />
            </div>

            <div className="field">
              <label className="field-label" style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>
                {t('sales.create_sales_order_modal.s11', "عنوان العميل / موقع التسليم")}
              </label>
              <input
                type="text"
                placeholder={t('sales.create_sales_order_modal.s12', "العنوان التفصيلي...")}
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12.5px', backgroundColor: '#f8fafc', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          {/* Stock Reservation Toggle Option */}
          <div style={{ padding: '12px 16px', backgroundColor: '#eff6ff', borderRadius: '10px', border: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <LockIcon size={16} color="#1d4ed8" />
              <div>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#1e3a8a', display: 'block' }}>
                  {t('sales.create_sales_order_modal.s13', "تفعيل حجز المخزون المؤقت فور الحفظ (Stock Reservation)")}
                </span>
                <span style={{ fontSize: '11px', color: '#1d4ed8' }}>
                  {t('sales.create_sales_order_modal.s14', "يتم زيادة الكمية المحجوزة للمنتجات ومنع بيعها في الكاشير أو المتجر الإلكتروني")}
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={autoReserve}
              onChange={(e) => setAutoReserve(e.target.checked)}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
          </div>

          {/* Items Table */}
          <div style={{ border: '1px solid #cbd5e1', borderRadius: '10px', backgroundColor: '#ffffff' }}>
            <div style={{ backgroundColor: '#f8fafc', padding: '10px 14px', fontWeight: 700, fontSize: '12px', color: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', borderRadius: '10px 10px 0 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <PackageIcon size={15} color="#170e5e" />
                <span>{t('sales.create_sales_order_modal.s15', "أصناف وكميات أمر البيع")}</span>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>({items.length} {t('sales.create_sales_order_modal.s16', "صنف)")}</span>
              </div>
              <button
                type="button"
                onClick={handleAddItem}
                style={{ fontSize: '12px', color: '#170e5e', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <PlusIcon size={14} />
                <span>{t('sales.create_sales_order_modal.s17', "إضافة صنف آخر")}</span>
              </button>
            </div>

            {/* Table Column Headers */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(240px, 1fr) 75px 65px 100px 75px 105px 36px',
                gap: '10px',
                alignItems: 'center',
                backgroundColor: '#f8fafc',
                padding: '9px 12px',
                borderBottom: '1px solid #e2e8f0',
                fontSize: '11.5px',
                fontWeight: 700,
                color: '#475569',
              }}
            >
              <div>{t('sales.create_sales_order_modal.s18', "الصنف / المنتج (بحث فوري)")}</div>
              <div style={{ textAlign: 'center' }}>{t('sales.create_sales_order_modal.s19', "الكمية")}</div>
              <div style={{ textAlign: 'center' }}>{t('sales.create_sales_order_modal.s20', "الوحدة")}</div>
              <div style={{ textAlign: 'center' }}>{t('sales.create_sales_order_modal.s21', "سعر الوحدة")}</div>
              <div style={{ textAlign: 'center' }}>{t('sales.create_sales_order_modal.s22', "الخصم")}</div>
              <div style={{ textAlign: 'center' }}>{t('sales.create_sales_order_modal.s23', "الإجمالي")}</div>
              <div style={{ textAlign: 'center' }} />
            </div>

            <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {items.map((it, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(240px, 1fr) 75px 65px 100px 75px 105px 36px',
                    gap: '10px',
                    alignItems: 'flex-start',
                    backgroundColor: '#ffffff',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <OrderItemProductPicker
                      value={it.productName}
                      selectedProductId={it.productId}
                      stockOnHand={it.stockOnHand}
                      unitName={it.unitName}
                      quantity={it.quantity}
                      products={catalogProducts}
                      onChangeText={(text) => handleItemChange(idx, 'productName', text)}
                      onSelectProduct={(p) => handleSelectProduct(idx, p)}
                    />
                  </div>
                  <div>
                    <input
                      type="number"
                      min="1"
                      placeholder="1"
                      value={it.quantity}
                      onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                      style={{ width: '100%', padding: '7px 6px', backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '12px', textAlign: 'center', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      placeholder={t('sales.create_sales_order_modal.s24', "الوحدة")}
                      value={it.unitName || t('sales.create_sales_order_modal.s25', "قطعة")}
                      onChange={(e) => handleItemChange(idx, 'unitName', e.target.value)}
                      style={{ width: '100%', padding: '7px 6px', backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '11px', textAlign: 'center', boxSizing: 'border-box', color: '#475569' }}
                    />
                  </div>
                  <div>
                    <input
                      type="number"
                      step="0.01"
                      placeholder={t('sales.create_sales_order_modal.s26', "السعر")}
                      value={it.unitPrice}
                      onChange={(e) => handleItemChange(idx, 'unitPrice', e.target.value)}
                      style={{ width: '100%', padding: '7px 6px', backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '12px', textAlign: 'center', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0"
                      value={it.discount}
                      onChange={(e) => handleItemChange(idx, 'discount', e.target.value)}
                      style={{ width: '100%', padding: '7px 6px', backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '12px', textAlign: 'center', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ textAlign: 'center', paddingTop: '8px', fontWeight: 800, fontSize: '12.5px', color: '#170e5e', whiteSpace: 'nowrap' }}>
                    {formatCurrency(Number(it.total))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '4px' }}>
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(idx)}
                      disabled={items.length <= 1}
                      style={{
                        width: '30px',
                        height: '30px',
                        borderRadius: '6px',
                        border: '1px solid #f1f5f9',
                        backgroundColor: '#f8fafc',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: items.length <= 1 ? '#cbd5e1' : '#94a3b8',
                        cursor: items.length <= 1 ? 'not-allowed' : 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      title={t('sales.create_sales_order_modal.s27', "حذف هذا الصنف")}
                    >
                      <Trash2Icon size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Totals Summary */}
          <div style={{ padding: '12px 16px', backgroundColor: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12.5px' }}>
            <div>
              <span style={{ color: '#64748b' }}>{t('sales.create_sales_order_modal.s28', "المجموع قبل الخصم:")} </span>
              <strong style={{ color: '#1e293b' }}>{formatCurrency(subtotal)}</strong>
            </div>
            <div>
              <span style={{ color: '#64748b' }}>{t('sales.create_sales_order_modal.s29', "إجمالي الخصم:")} </span>
              <strong style={{ color: '#dc2626' }}>{formatCurrency(totalDiscount)}</strong>
            </div>
            <div style={{ fontSize: '13.5px', fontWeight: 800, color: '#170e5e' }}>
              <span>{t('sales.create_sales_order_modal.s30', "الصافي المطلوب:")} </span>
              <span>{formatCurrency(totalAmount)}</span>
            </div>
          </div>

        </form>
    </StandardDialog>
  );
};
