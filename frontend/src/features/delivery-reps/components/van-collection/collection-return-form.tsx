import { useTranslation } from 'react-i18next';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import type { CustomerEligibleSale, CustomerEligibleSaleItem, VanStockItem } from '../../api/van-sales.api';
import {RETURN_REASONS, type CustomerOption} from './van-collection-types';
import type { Dispatch, SetStateAction } from 'react';

export interface CollectionReturnFormProps {
  customers: CustomerOption[];
  eligibleSales: CustomerEligibleSale[];
  handleAddSaleItemToReturn: (item: CustomerEligibleSaleItem) => void;
  handleAddStockItemToReturn: (item: VanStockItem) => void;
  handleSubmitReturn: () => Promise<void>;
  handleUpdateReturnQty: (index: number, delta: number) => void;
  inventory: VanStockItem[];
  isLoadingSales: boolean;
  isSubmittingReturn: boolean;
  refundMethod: 'credit' | 'cash';
  resolveUnlinkedUnitPrice: (item: VanStockItem) => number;
  returnCart: Array<{
    productId: number;
    productName: string;
    qty: number;
    unitPrice: number;
    maxQty: number;
    saleItemId?: number;
    unitMultiplier?: number;
    unitName?: string;
  }>;
  returnCustomerId: number | '';
  returnNotes: string;
  returnReason: string;
  selectedSale: CustomerEligibleSale | undefined;
  selectedSaleId: number | '';
  setRefundMethod: Dispatch<SetStateAction<'credit' | 'cash'>>;
  setReturnCart: Dispatch<SetStateAction<Array<{
    productId: number;
    productName: string;
    qty: number;
    unitPrice: number;
    maxQty: number;
    saleItemId?: number;
    unitMultiplier?: number;
    unitName?: string;
  }>>>;
  setReturnCustomerId: Dispatch<SetStateAction<number | ''>>;
  setReturnNotes: Dispatch<SetStateAction<string>>;
  setReturnReason: Dispatch<SetStateAction<string>>;
  setSelectedSaleId: Dispatch<SetStateAction<number | ''>>;
  totalReturnAmount: number;
}

export function CollectionReturnForm({
  customers,
  eligibleSales,
  handleAddSaleItemToReturn,
  handleAddStockItemToReturn,
  handleSubmitReturn,
  handleUpdateReturnQty,
  inventory,
  isLoadingSales,
  isSubmittingReturn,
  refundMethod,
  resolveUnlinkedUnitPrice,
  returnCart,
  returnCustomerId,
  returnNotes,
  returnReason,
  selectedSale,
  selectedSaleId,
  setRefundMethod,
  setReturnCart,
  setReturnCustomerId,
  setReturnNotes,
  setReturnReason,
  setSelectedSaleId,
  totalReturnAmount,
}: CollectionReturnFormProps) {
  const { t } = useTranslation();
  return (
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
            {t('delivery_reps.van_collection_tab.s52', "ربط بالفاتورة الأصلية (إلزامي لفحص صافي الخصم وسعر البند الفعلي):")}
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
                // INV-VAN-RETURN-LINKAGE-PAYMENT-LOCK: there is
                // no empty option anymore — a new return MUST link
                // to an invoice, so clearing the pick is not
                // possible and the unlinked 'credit' default is
                // gone. The rep can still override the refund
                // method manually afterwards (this fires only at
                // pick time). The server still validates the
                // chosen method against the sale's legs at submit.
                if (!val) {
                  setRefundMethod('credit');
                  return;
                }
                const picked = eligibleSales.find((s) => String(s.id) === String(val));
                setRefundMethod(picked?.paymentType === 'credit' ? 'credit' : 'cash');
              }}
              options={[
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
  );
}
