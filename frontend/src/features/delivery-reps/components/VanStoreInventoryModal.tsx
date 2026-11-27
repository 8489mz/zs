import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/components/system-alert';
import { vanSalesApi, VanCustomerItineraryItem } from '../api/van-sales.api';
import { PlusCircleIcon, TrashIcon } from '@/shared/components/icons/AppIcons';

interface VanStoreInventoryModalProps {
  customer: VanCustomerItineraryItem | null;
  tripId?: number;
  onClose: () => void;
  onSuccess?: () => void;
}

export const VanStoreInventoryModal: React.FC<VanStoreInventoryModalProps> = ({
  customer,
  tripId,
  onClose,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const [items, setItems] = useState<Array<{ productName: string; qtyOnShelf: number; expiryDate?: string }>>([]);
  const [productNameInput, setProductNameInput] = useState('');
  const [qtyInput, setQtyInput] = useState(1);
  const [expiryInput, setExpiryInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!customer) return null;

  const handleAddItem = () => {
    const name = productNameInput.trim();
    if (!name) {
      toast.warning('يرجى إدخال اسم الصنف المجرود');
      return;
    }
    if (qtyInput <= 0) {
      toast.warning('الكمية يجب أن تكون أكبر من الصفر');
      return;
    }

    setItems([...items, { productName: name, qtyOnShelf: qtyInput, expiryDate: expiryInput || undefined }]);
    setProductNameInput('');
    setQtyInput(1);
    setExpiryInput('');
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (items.length === 0) {
      toast.warning('يرجى إضافة صنف واحد على الأقل أو إغلاق النافذة للمتابعة');
      return;
    }

    setIsSubmitting(true);
    try {
      // Create a fast visit check-in if none active, then attach inventory
      const checkInRes = await vanSalesApi.checkInVisit({
        tripId: tripId || undefined,
        customerId: customer.customerId,
        customerName: customer.customerName,
      });

      await vanSalesApi.recordVisitInventory(checkInRes.visitId, {
        items: items.map((it, idx) => ({
          productId: idx + 1,
          productName: it.productName,
          qtyOnShelf: it.qtyOnShelf,
          expiryDate: it.expiryDate || null,
        })),
      });

      toast.success(`تم حفظ جرد رصيد الرف (${items.length} أصناف) للمحل: ${customer.customerName}`);
      onSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'فشل حفظ جرد الرف');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <StandardDialog
      open={true}
      onClose={onClose}
      title={`جرد رصيد رف العميل (اختياري)`}
      subtitle={`المحل: ${customer.customerName}`}
      badge={t('delivery_reps.van_store_inventory_modal.s0', "جرد الرف")}
      width="min(540px, 96vw)"
      footerActions={
        <StandardDialogFooter
          onClose={onClose}
          cancelText={t('delivery_reps.van_store_inventory_modal.s1', "تخطي وإغلاق")}
          extraActions={
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={isSubmitting || items.length === 0}
              style={{
                backgroundColor: '#170e5e',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '12.5px',
                height: '38px',
              }}
            >
              {isSubmitting ? t('delivery_reps.van_store_inventory_modal.s2', "جاري الحفظ...") : `حفظ جرد الرف (${items.length} أصناف)`}
            </Button>
          }
        />
      }
    >
      <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Helper Note */}
        <div
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '10px 14px',
            fontSize: '11.5px',
            color: '#475569',
            lineHeight: 1.5,
          }}
        >
          {t('delivery_reps.van_store_inventory_modal.s3', "هذه الخطوة")} <b>{t('delivery_reps.van_store_inventory_modal.s4', "اختيارية تماماً")}</b> {t('delivery_reps.van_store_inventory_modal.s5', "لتسهيل حركة المندوب في الشارع. يمكنك تسجيل كميات الأصناف المتبقية لدى التاجر لمعرفة معدل سحب البضاعة، أو الضغط على")} <b>{t('delivery_reps.van_store_inventory_modal.s6', "«تخطي وإغلاق»")}</b> {t('delivery_reps.van_store_inventory_modal.s7', "للانتقال للبيع مباشرة.")}
        </div>

        {/* Add Item Form */}
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
            {t('delivery_reps.van_store_inventory_modal.s8', "إضافة صنف مجرود على الرف:")}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: '8px' }}>
            <div>
              <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                {t('delivery_reps.van_store_inventory_modal.s9', "اسم الصنف أو الباركود")}
              </label>
              <input
                type="text"
                placeholder={t('delivery_reps.van_store_inventory_modal.s10', "أدخل اسم الصنف...")}
                value={productNameInput}
                onChange={(e) => setProductNameInput(e.target.value)}
                style={{
                  width: '100%',
                  height: '34px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: '0 10px',
                  fontSize: '12px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                {t('delivery_reps.van_store_inventory_modal.s11', "الكمية على الرف")}
              </label>
              {/* Strict RTL Stepper: [+] (qty) [-] */}
              <div dir="rtl" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <button
                  type="button"
                  onClick={() => setQtyInput((q) => q + 1)}
                  style={{
                    width: '32px',
                    height: '34px',
                    backgroundColor: '#170e5e',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  +
                </button>
                <input
                  type="number"
                  min="1"
                  value={qtyInput}
                  onChange={(e) => setQtyInput(Math.max(1, Number(e.target.value) || 1))}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: '34px',
                    textAlign: 'center',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    fontWeight: 700,
                    fontSize: '12.5px',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setQtyInput((q) => Math.max(1, q - 1))}
                  style={{
                    width: '32px',
                    height: '34px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  -
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                {t('delivery_reps.van_store_inventory_modal.s12', "تاريخ الصلاحية (اختياري)")}
              </label>
              <input
                type="date"
                value={expiryInput}
                onChange={(e) => setExpiryInput(e.target.value)}
                style={{
                  height: '32px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: '0 8px',
                  fontSize: '11.5px',
                }}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={handleAddItem}
              style={{
                height: '34px',
                fontSize: '12px',
                fontWeight: 700,
                alignSelf: 'flex-end',
                borderColor: '#170e5e',
                color: '#170e5e',
              }}
            >
              <PlusCircleIcon size={14} style={{ marginInlineEnd: '4px' }} />
              {t('delivery_reps.van_store_inventory_modal.s13', "إضافة للقائمة")}
            </Button>
          </div>
        </div>

        {/* Counted Items Table */}
        <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
          {items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '16px', color: '#94a3b8', fontSize: '12px', border: '1px dashed #cbd5e1', borderRadius: '8px' }}>
              {t('delivery_reps.van_store_inventory_modal.s14', "لم تتم إضافة أي أصناف بعد")}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'start' }}>{t('delivery_reps.van_store_inventory_modal.s15', "الصنف")}</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center' }}>{t('delivery_reps.van_store_inventory_modal.s16', "الكمية")}</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center' }}>{t('delivery_reps.van_store_inventory_modal.s17', "الصلاحية")}</th>
                  <th style={{ padding: '8px 10px', width: '36px' }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{it.productName}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, color: '#170e5e' }}>{it.qtyOnShelf}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'center', color: '#64748b' }}>{it.expiryDate || '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(idx)}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </StandardDialog>
  );
};
