import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { CustomSelect } from '@/shared/ui/custom-select';
import { referenceDataApi } from '@/services/reference-data.api';
import { goodsReceiptsApi } from '../api/goods-receipts.api';
import { toast } from '@/shared/components/system-alert';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { shouldShowExpiryDateField } from '@/features/products';

export interface GoodsReceiptInitialItem {
  purchaseOrderItemId?: number;
  productId: number;
  productName: string;
  productSku?: string;
  orderedQty: number;
  unitCost: number;
  unitName?: string;
}

interface GoodsReceiptModalProps {
  open: boolean;
  onClose: () => void;
  purchaseOrderId?: number | null;
  poDocNo?: string | null;
  supplierId: number;
  supplierName: string;
  locationId?: number;
  initialItems: GoodsReceiptInitialItem[];
  onSuccess?: () => void;
}

interface LineState {
  purchaseOrderItemId?: number;
  productId: number;
  productName: string;
  orderedQty: number;
  unitCost: number;
  unitName?: string;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  rejectionReason: string;
  batchNumber: string;
  expiryDate: string;
}

export const GoodsReceiptModal: React.FC<GoodsReceiptModalProps> = ({
  open,
  onClose,
  purchaseOrderId,
  poDocNo,
  supplierId,
  supplierName,
  locationId,
  initialItems,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const settingsQuery = useSettingsQuery();
  const showBatchesAndExpiry = shouldShowExpiryDateField({ settings: settingsQuery.data });
  const [deliveryRef, setDeliveryRef] = useState('');
  const [notes, setNotes] = useState('');
  const [freight, setFreight] = useState('');
  const [autoPost, setAutoPost] = useState(true);
  const [lines, setLines] = useState<LineState[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: locations = [] } = useQuery({
    queryKey: ['reference-data', 'locations'],
    queryFn: referenceDataApi.locations,
    staleTime: 60_000,
    enabled: open,
  });

  const [selectedLocationId, setSelectedLocationId] = useState<number | undefined>(locationId);

  useEffect(() => {
    if (open) {
      if (locationId && locations.some((l) => Number(l.id) === Number(locationId))) {
        setSelectedLocationId(Number(locationId));
      } else if (locations.length > 0) {
        const currentValid = locations.some((l) => Number(l.id) === Number(selectedLocationId));
        if (!currentValid) {
          const activeLoc = locations.find((l: any) => l.isActive !== false) || locations[0];
          if (activeLoc) {
            setSelectedLocationId(Number(activeLoc.id));
          }
        }
      }
    }
  }, [open, locationId, locations]);

  useEffect(() => {
    if (open && initialItems.length > 0) {
      setLines(
        initialItems.map((item) => ({
          purchaseOrderItemId: item.purchaseOrderItemId,
          productId: item.productId,
          productName: item.productName,
          orderedQty: item.orderedQty,
          unitCost: item.unitCost,
          unitName: item.unitName,
          receivedQty: item.orderedQty,
          acceptedQty: item.orderedQty,
          rejectedQty: 0,
          rejectionReason: '',
          batchNumber: '',
          expiryDate: '',
        })),
      );
      setDeliveryRef('');
      setNotes('');
      setFreight('');
      setAutoPost(true);
    }
  }, [open, initialItems]);

  if (!open) return null;

  const handleLineChange = (index: number, field: keyof LineState, value: any) => {
    setLines((prev) => {
      const updated = [...prev];
      const line = { ...updated[index], [field]: value };

      if (field === 'receivedQty') {
        const rec = Math.max(0, Number(value) || 0);
        line.receivedQty = rec;
        line.acceptedQty = Math.max(0, rec - line.rejectedQty);
      } else if (field === 'acceptedQty') {
        const acc = Math.max(0, Number(value) || 0);
        line.acceptedQty = acc;
        line.receivedQty = acc + line.rejectedQty;
      } else if (field === 'rejectedQty') {
        const rej = Math.max(0, Number(value) || 0);
        line.rejectedQty = rej;
        line.receivedQty = line.acceptedQty + rej;
      }

      updated[index] = line;
      return updated;
    });
  };

  // INV-SHIPPING-ALLOCATION: freight the merchant pays on this
  // receipt, allocated to item cost at posting time.
  const freightAmount = Math.max(0, Number(freight) || 0);

  const handleSubmit = async () => {
    try {
      setIsSubmitting(true);

      const validLines = lines.filter((l) => l.receivedQty > 0);
      if (validLines.length === 0) {
        toast.warning('يرجى إدخال كمية مستلمة أكبر من الصفر لبند واحد على الأقل.');
        setIsSubmitting(false);
        return;
      }

      for (const l of validLines) {
        if (Math.abs(l.receivedQty - (l.acceptedQty + l.rejectedQty)) > 0.001) {
          toast.error(`بند "${l.productName}": الكمية المستلمة يجب أن تطابق مجموع المقبول والمرفوض.`);
          setIsSubmitting(false);
          return;
        }
        if (l.rejectedQty > 0 && !l.rejectionReason.trim()) {
          toast.warning(`بند "${l.productName}": يرجى ذكر سبب رفض الكمية (${l.rejectedQty}).`);
          setIsSubmitting(false);
          return;
        }
      }

      const finalLocationId = selectedLocationId || (locations.length > 0 ? Number(locations[0].id) : locationId);
      if (!finalLocationId) {
        toast.warning(t('purchases.goods_receipt_modal.select_location', 'يرجى تحديد مخزن الاستلام.'));
        setIsSubmitting(false);
        return;
      }

      const payload = {
        purchaseOrderId: purchaseOrderId || null,
        supplierId,
        locationId: finalLocationId,
        supplierDeliveryNoteRef: deliveryRef.trim() || null,
        notes: notes.trim() || null,
        // INV-SHIPPING-ALLOCATION: freight entered on the receipt is
        // sent only when > 0 — the backend then allocates it to item
        // cost at posting; no freight means no key at all.
        ...(freightAmount > 0 ? { freight: freightAmount } : {}),
        lines: validLines.map((l) => ({
          productId: l.productId,
          purchaseOrderItemId: l.purchaseOrderItemId || null,
          orderedQty: l.orderedQty,
          receivedQty: l.receivedQty,
          acceptedQty: l.acceptedQty,
          rejectedQty: l.rejectedQty,
          rejectionReason: l.rejectionReason.trim() || null,
          batchNumber: l.batchNumber.trim() || null,
          expiryDate: l.expiryDate ? l.expiryDate : null,
          unitCost: l.unitCost,
        })),
      };

      const grn = await goodsReceiptsApi.create(payload);

      if (autoPost && grn?.id) {
        await goodsReceiptsApi.post(grn.id);
        toast.success(`تم إنشاء وترحيل إذن الاستلام (${grn.docNo}) وتغذية المخزن وقيد GRNI بنجاح.`);
      } else {
        toast.success(`تم حفظ إذن الاستلام (${grn.docNo}) كمسودة بنجاح.`);
      }

      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'فشل تسجيل إذن الاستلام المخزني');
    } finally {
      setIsSubmitting(false);
    }
  };

      const totalAcceptedAmount = lines.reduce((sum, l) => sum + l.acceptedQty * l.unitCost, 0);

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={poDocNo ? `إذن استلام مخزني رسمي (GRN) — أمر الشراء #${poDocNo}` : t('purchases.goods_receipt_modal.s0', "إذن استلام مخزني رسمي (GRN)")}
      subtitle={t('purchases.goods_receipt_modal.s1', "إثبات استلام الأصناف بالمستودع، فحص الجودة، وحساب وسيط التوريدات غير المفوترة (GRNI)")}
      maxWidth="min(1080px, 96vw)"
      footerActions={
        <StandardDialogFooter
          onCancel={onClose}
          cancelLabel={t('purchases.goods_receipt_modal.s2', "إلغاء")}
          onSubmit={handleSubmit}
          submitLabel={
            isSubmitting
              ? t('purchases.goods_receipt_modal.s3', "جاري التسجيل...")
              : autoPost
              ? t('purchases.goods_receipt_modal.s4', "تأكيد وترحيل فوري (تغذية المخزن وقيد GRNI)")
              : t('purchases.goods_receipt_modal.s5', "حفظ إذن الاستلام كمسودة")
          }
          isSubmitting={isSubmitting}
        />
      }
    >
      <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
        {/* Info Header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '10px',
            backgroundColor: '#f8fafc',
            padding: '12px 14px',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            fontSize: '12.5px',
          }}
        >
          <div>
            <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('purchases.goods_receipt_modal.s6', "المورد")}</span>
            <strong style={{ color: '#0f172a' }}>{supplierName}</strong>
          </div>
          {poDocNo && (
            <div>
              <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('purchases.goods_receipt_modal.s7', "أمر الشراء المرجعي")}</span>
              <strong style={{ color: '#0284c7' }}>#{poDocNo}</strong>
            </div>
          )}
          <div>
            <span style={{ color: '#64748b', display: 'block', fontSize: '11px', marginBottom: '3px' }}>{t('purchases.goods_receipt_modal.location', "مخزن الاستلام")} *</span>
            <CustomSelect
              value={selectedLocationId ? String(selectedLocationId) : ''}
              onChange={(val) => setSelectedLocationId(val ? Number(val) : undefined)}
              options={locations.map((loc: any) => ({
                value: String(loc.id),
                label: loc.name || `مخزن #${loc.id}`,
              }))}
              placeholder={t('purchases.goods_receipt_modal.select_location_ph', "اختر مخزن الاستلام...")}
              searchable={locations.length > 5}
            />
          </div>
          <div>
            <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('purchases.goods_receipt_modal.s8', "رقم إذن تسليم المورد (DN Ref)")}</span>
            <input
              type="text"
              placeholder={t('purchases.goods_receipt_modal.s9', "مثال: DN-98421")}
              value={deliveryRef}
              onChange={(e) => setDeliveryRef(e.target.value)}
              style={{
                width: '100%',
                padding: '4px 8px',
                fontSize: '12px',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                marginTop: '3px',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('purchases.goods_receipt_modal.freight', "الشحن (يُوزَّع على تكلفة الأصناف)")}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={freight}
              onChange={(e) => setFreight(e.target.value)}
              style={{
                width: '100%',
                padding: '4px 8px',
                fontSize: '12px',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                marginTop: '3px',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{freightAmount > 0 ? t('purchases.goods_receipt_modal.total_with_freight', "الإجمالي المتوقع مع الشحن") : t('purchases.goods_receipt_modal.s10', "قيمة البضاعة المقبولة المتوقعة")}</span>
            <strong style={{ color: '#166534', fontSize: '13px' }}>{(totalAcceptedAmount + freightAmount).toLocaleString()} {t('purchases.goods_receipt_modal.s11', "ج.م")}</strong>
          </div>
        </div>

        {/* Lines Table */}
        <div
          style={{
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            overflow: 'hidden',
            maxHeight: '340px',
            overflowY: 'auto',
          }}
          className="thin-scrollbar"
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '12px',
              textAlign: 'right',
            }}
          >
            <thead
              style={{
                backgroundColor: '#f1f5f9',
                borderBottom: '1px solid #cbd5e1',
                color: '#334155',
                fontWeight: 700,
                position: 'sticky',
                top: 0,
                zIndex: 1,
              }}
            >
              <tr>
                <th style={{ padding: '8px 10px' }}>{t('purchases.goods_receipt_modal.s12', "الصنف")}</th>
                <th style={{ padding: '8px 10px', textAlign: 'center', width: '70px' }}>{t('purchases.goods_receipt_modal.s13', "المطلوب")}</th>
                <th style={{ padding: '8px 10px', textAlign: 'center', width: '80px' }}>{t('purchases.goods_receipt_modal.s14', "المستلم")}</th>
                <th style={{ padding: '8px 10px', textAlign: 'center', width: '80px', color: '#166534' }}>{t('purchases.goods_receipt_modal.s15', "المقبول")}</th>
                <th style={{ padding: '8px 10px', textAlign: 'center', width: '80px', color: '#b91c1c' }}>{t('purchases.goods_receipt_modal.s16', "المرفوض")}</th>
                <th style={{ padding: '8px 10px', width: '140px' }}>{t('purchases.goods_receipt_modal.s17', "سبب الرفض")}</th>
                {showBatchesAndExpiry && (
                  <>
                    <th style={{ padding: '8px 10px', width: '100px' }}>{t('purchases.goods_receipt_modal.s18', "رقم التشغيلة")}</th>
                    <th style={{ padding: '8px 10px', width: '110px' }}>{t('purchases.goods_receipt_modal.s19', "الصلاحية")}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr
                  key={l.productId || idx}
                  style={{
                    borderBottom: '1px solid #f1f5f9',
                    backgroundColor: idx % 2 === 0 ? '#ffffff' : '#fafafa',
                  }}
                >
                  <td style={{ padding: '8px 10px', fontWeight: 600, color: '#0f172a' }}>
                    <div>{l.productName}</div>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>
                      {l.unitCost.toLocaleString()} {t('purchases.goods_receipt_modal.s20', "ج.م /")} {l.unitName || t('purchases.goods_receipt_modal.s21', "قطعة")}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>
                    {l.orderedQty}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      type="number"
                      min="0"
                      value={l.receivedQty}
                      onChange={(e) => handleLineChange(idx, 'receivedQty', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '4px 6px',
                        fontSize: '12px',
                        border: '1px solid #cbd5e1',
                        borderRadius: '5px',
                        textAlign: 'center',
                        fontWeight: 700,
                        boxSizing: 'border-box',
                      }}
                    />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      type="number"
                      min="0"
                      max={l.receivedQty}
                      value={l.acceptedQty}
                      onChange={(e) => handleLineChange(idx, 'acceptedQty', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '4px 6px',
                        fontSize: '12px',
                        border: '1px solid #86efac',
                        backgroundColor: '#f0fdf4',
                        color: '#166534',
                        borderRadius: '5px',
                        textAlign: 'center',
                        fontWeight: 700,
                        boxSizing: 'border-box',
                      }}
                    />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      type="number"
                      min="0"
                      value={l.rejectedQty}
                      onChange={(e) => handleLineChange(idx, 'rejectedQty', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '4px 6px',
                        fontSize: '12px',
                        border: '1px solid #fca5a5',
                        backgroundColor: l.rejectedQty > 0 ? '#fef2f2' : '#ffffff',
                        color: l.rejectedQty > 0 ? '#b91c1c' : '#475569',
                        borderRadius: '5px',
                        textAlign: 'center',
                        fontWeight: 700,
                        boxSizing: 'border-box',
                      }}
                    />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      type="text"
                      placeholder={l.rejectedQty > 0 ? t('purchases.goods_receipt_modal.s22', "سبب الرفض إلزامي") : t('purchases.goods_receipt_modal.s23', "ملاحظات الرفض")}
                      value={l.rejectionReason}
                      onChange={(e) => handleLineChange(idx, 'rejectionReason', e.target.value)}
                      disabled={l.rejectedQty === 0}
                      style={{
                        width: '100%',
                        padding: '4px 6px',
                        fontSize: '11.5px',
                        border: '1px solid #cbd5e1',
                        borderRadius: '5px',
                        boxSizing: 'border-box',
                        opacity: l.rejectedQty === 0 ? 0.5 : 1,
                      }}
                    />
                  </td>
                  {showBatchesAndExpiry && (
                    <>
                      <td style={{ padding: '6px 8px' }}>
                        <input
                          type="text"
                          placeholder="Batch #"
                          value={l.batchNumber}
                          onChange={(e) => handleLineChange(idx, 'batchNumber', e.target.value)}
                          style={{
                            width: '100%',
                            padding: '4px 6px',
                            fontSize: '11.5px',
                            border: '1px solid #cbd5e1',
                            borderRadius: '5px',
                            boxSizing: 'border-box',
                          }}
                        />
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <input
                          type="date"
                          value={l.expiryDate}
                          onChange={(e) => handleLineChange(idx, 'expiryDate', e.target.value)}
                          style={{
                            width: '100%',
                            padding: '4px 4px',
                            fontSize: '11px',
                            border: '1px solid #cbd5e1',
                            borderRadius: '5px',
                            boxSizing: 'border-box',
                          }}
                        />
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Options & Notes */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            padding: '10px 14px',
            backgroundColor: '#f8fafc',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
          }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12.5px',
              fontWeight: 600,
              color: '#1e293b',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={autoPost}
              onChange={(e) => setAutoPost(e.target.checked)}
              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
            />
            <span>{t('purchases.goods_receipt_modal.s24', "ترحيل فوري للمخزن وتوليد قيد GRNI (Dr. مخزون 1140 / Cr. وسيط التوريدات 2125)")}</span>
          </label>

          <div style={{ flex: 1, minWidth: '220px' }}>
            <input
              type="text"
              placeholder={t('purchases.goods_receipt_modal.s25', "ملاحظات إضافية على إذن الاستلام...")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 10px',
                fontSize: '12px',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>
      </div>
    </StandardDialog>
  );
};
