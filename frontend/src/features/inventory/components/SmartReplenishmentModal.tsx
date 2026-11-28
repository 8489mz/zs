import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { useInventoryActionCatalog } from '@/features/inventory/hooks/useInventoryActionCatalog';
import { useCreateLocationMutation } from '@/shared/hooks/use-location-mutations';
import {
  inventoryReplenishmentApi,
  ReplenishmentSuggestionItem,
} from '@/features/inventory/api/inventory-replenishment.api';
import { ReplenishmentPickListPrintModal, PickListItem } from './ReplenishmentPickListPrintModal';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { CustomSelect } from '@/shared/ui/custom-select';
import {
  CheckCircleIcon,
  AlertTriangleIcon,
  LightbulbIcon,
  CalendarIcon,
  Trash2Icon,
  RefreshCwIcon,
} from '@/shared/components/icons/AppIcons';

interface SmartReplenishmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  defaultToLocationId?: string;
}

export const SmartReplenishmentModal: React.FC<SmartReplenishmentModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  defaultToLocationId,
}) => {
  const { t } = useTranslation();
  const { locationsQuery } = useInventoryActionCatalog();
  const locations = locationsQuery.data || [];

  const locationOptions = locations.map((loc: any) => ({
    value: String(loc.id),
    label: `${loc.name}${loc.code ? ` (${loc.code})` : ''}`,
  }));

  const [fromLocationId, setFromLocationId] = useState<number | ''>('');
  const [toLocationId, setToLocationId] = useState<number | ''>('');
  const [coverDays, setCoverDays] = useState<number>(2);
  const [note, setNote] = useState<string>('');
  const [carrierName, setCarrierName] = useState<string>('');
  const [editableItems, setEditableItems] = useState<ReplenishmentSuggestionItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  // 1-Click Warehouse Creation
  const createLocationMutation = useCreateLocationMutation((res) => {
    locationsQuery.refetch().then((refetched) => {
      const locs = refetched.data || [];
      if (locs.length > 1) {
        const createdId = res?.locationId ? Number(res.locationId) : null;
        const newWarehouse = createdId ? locs.find((l: any) => Number(l.id) === createdId) : locs.find((l: any) => l.name?.includes('مستودع'));
        if (newWarehouse) {
          setFromLocationId(Number(newWarehouse.id));
        }
      }
    });
  });

  // Print Modal state
  const [printedTransfer, setPrintedTransfer] = useState<{
    docNo: string;
    items: PickListItem[];
    fromName: string;
    toName: string;
    carrierName?: string;
  } | null>(null);

  // Initialize source and destination locations when locations load
  useEffect(() => {
    if (locations.length > 0) {
      let initialFrom = fromLocationId;
      if (!initialFrom) {
        const warehouse =
          locations.find((l: any) => l.name?.includes('مستودع') || l.name?.includes('رئيسي') || l.code?.includes('MAIN')) ||
          locations[0];
        initialFrom = Number(warehouse.id);
        setFromLocationId(initialFrom);
      }

      if (!toLocationId) {
        if (defaultToLocationId && Number(defaultToLocationId) !== Number(initialFrom)) {
          setToLocationId(Number(defaultToLocationId));
        } else {
          // Choose a location different from the source if available
          const other = locations.find((l: any) => Number(l.id) !== Number(initialFrom));
          if (other) {
            setToLocationId(Number(other.id));
          } else {
            setToLocationId(Number(locations[0].id));
          }
        }
      }
    }
  }, [locations, defaultToLocationId, fromLocationId, toLocationId]);

  const isSameLocation = Boolean(fromLocationId && toLocationId && fromLocationId === toLocationId);

  // Query suggestions from backend
  const suggestionsQuery = useQuery({
    queryKey: ['smart-replenishment-suggestions', fromLocationId, toLocationId, coverDays],
    queryFn: () => inventoryReplenishmentApi.getSuggestions(Number(fromLocationId), Number(toLocationId), coverDays),
    enabled: isOpen && Boolean(fromLocationId) && Boolean(toLocationId) && fromLocationId !== toLocationId,
  });

  // Sync query data to local editable state
  useEffect(() => {
    if (suggestionsQuery.data?.items) {
      setEditableItems(suggestionsQuery.data.items);
    } else if (isSameLocation) {
      setEditableItems([]);
    }
  }, [suggestionsQuery.data, isSameLocation]);

  if (!isOpen) return null;

  const handleQtyChange = (productId: number, delta: number) => {
    setEditableItems((prev) =>
      prev.map((it) => {
        if (it.productId === productId) {
          const newQty = Math.max(0, it.suggestedQty + delta);
          const cartonsCount = it.cartonMultiplier && it.cartonMultiplier > 1 ? Math.ceil(newQty / it.cartonMultiplier) : undefined;
          return { ...it, suggestedQty: newQty, cartonsCount };
        }
        return it;
      }),
    );
  };

  const handleQtyInput = (productId: number, val: string) => {
    const parsed = parseInt(val, 10);
    const newQty = isNaN(parsed) ? 0 : Math.max(0, parsed);
    setEditableItems((prev) =>
      prev.map((it) => {
        if (it.productId === productId) {
          const cartonsCount = it.cartonMultiplier && it.cartonMultiplier > 1 ? Math.ceil(newQty / it.cartonMultiplier) : undefined;
          return { ...it, suggestedQty: newQty, cartonsCount };
        }
        return it;
      }),
    );
  };

  const handleRemoveItem = (productId: number) => {
    setEditableItems((prev) => prev.filter((it) => it.productId !== productId));
  };

  const handleApproveAndPrint = async () => {
    if (!fromLocationId || !toLocationId) {
      setStatusMessage({ type: 'error', text: 'يرجى اختيار المخزن المصدر وموقع المحل' });
      return;
    }

    if (fromLocationId === toLocationId) {
      setStatusMessage({ type: 'error', text: 'يجب اختيار مستودع مصدر مختلف عن صالة العرض' });
      return;
    }

    const validItems = editableItems.filter((it) => it.suggestedQty > 0);
    if (!validItems.length) {
      setStatusMessage({ type: 'error', text: 'يجب أن تحتوي القائمة على أصناف بكميات أكبر من صفر' });
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const res = await inventoryReplenishmentApi.execute({
        fromLocationId: Number(fromLocationId),
        toLocationId: Number(toLocationId),
        items: validItems.map((it) => ({ productId: it.productId, qty: it.suggestedQty })),
        note: note || `إذن إمداد أرفف ذكي (تغطية ${coverDays * 24} ساعة)`,
        ...(carrierName.trim() ? { carrierName: carrierName.trim() } : {}),
      });

      const fromLoc = locations.find((l: any) => Number(l.id) === Number(fromLocationId));
      const toLoc = locations.find((l: any) => Number(l.id) === Number(toLocationId));

      setPrintedTransfer({
        docNo: res.docNo,
        items: validItems.map((it) => ({
          productId: it.productId,
          productName: it.productName,
          barcode: it.barcode,
          qty: it.suggestedQty,
          cartonMultiplier: it.cartonMultiplier,
          cartonName: it.cartonName,
          cartonsCount: it.cartonsCount,
          warehouseStock: it.warehouseStock,
        })),
        fromName: fromLoc?.name || 'المستودع الرئيسي',
        toName: toLoc?.name || 'صالة المحل',
        carrierName: carrierName.trim() || undefined,
      });

      setStatusMessage({ type: 'success', text: `تم اعتماد إذن الصرف رقم #${res.docNo} بنجاح!` });
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err?.message || 'تعذر اعتماد إذن الصرف' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeValidItems = editableItems.filter((it) => it.suggestedQty > 0);
  const totalPieces = activeValidItems.reduce((acc, it) => acc + it.suggestedQty, 0);
  const outOfStockCount = editableItems.filter((it) => it.urgency === 'out_of_stock').length;
  const lowStockCount = editableItems.filter((it) => it.urgency === 'low_stock').length;
  const salesReplenishCount = editableItems.filter((it) => it.urgency === 'sales_replenish').length;
  const unavailableInSourceCount = editableItems.filter((it) => it.urgency === 'unavailable_in_source').length;

  return (
    <>
      <StandardDialog
        open={isOpen}
        onClose={onClose}
        title={t('inventory.smart_replenishment_modal.s0', "محرك إمداد الأرفف الذكي وتتبع المخازن")}
        subtitle={`فحص آلي لأرصدة كافة المخازن وتوجيه الصرف للحاجات المتوفرة فعلياً (تغطية ${coverDays * 24} ساعة)`}
        size="xl"
        footerActions={
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '10px' }}>
            <div style={{ flex: 1, minWidth: '180px' }}>
              <input
                type="text"
                placeholder="اسم الناقل / حامل العهدة (اختياري)..."
                value={carrierName}
                onChange={(e) => setCarrierName(e.target.value)}
                style={{
                  width: '100%',
                  height: '36px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  padding: '0 10px',
                  fontSize: '12.5px',
                  color: '#0f172a',
                  outline: 'none',
                }}
              />
            </div>
            <div style={{ flex: 1, minWidth: '180px' }}>
              <input
                type="text"
                placeholder={t('inventory.smart_replenishment_modal.s1', "ملاحظات إذن الصرف (اختياري)...")}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{
                  width: '100%',
                  height: '36px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  padding: '0 10px',
                  fontSize: '12.5px',
                  color: '#0f172a',
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {statusMessage && (
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '4px 10px',
                    borderRadius: '6px',
                    backgroundColor: statusMessage.type === 'error' ? '#fef2f2' : '#f0fdf4',
                    color: statusMessage.type === 'error' ? '#dc2626' : '#16a34a',
                    border: `1px solid ${statusMessage.type === 'error' ? '#fecaca' : '#bbf7d0'}`,
                  }}
                >
                  {statusMessage.text}
                </span>
              )}

              <StandardDialogFooter
                onCancel={onClose}
                cancelLabel={t('inventory.smart_replenishment_modal.s2', "إلغاء")}
                primaryLabel={isSubmitting ? t('inventory.smart_replenishment_modal.s3', "جاري الاعتماد والترحيل...") : t('inventory.smart_replenishment_modal.s4', "اعتماد إذن الصرف وطباعة أمر التحميل")}
                onPrimary={handleApproveAndPrint}
                isPrimaryLoading={isSubmitting}
                isPrimaryDisabled={isSubmitting || activeValidItems.length === 0 || isSameLocation}
              />
            </div>
          </div>
        }
      >
        <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Location & Coverage Controls Bar */}
          <div
            style={{
              padding: '14px 16px',
              backgroundColor: '#f8fafc',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '14px',
              alignItems: 'flex-end',
            }}
          >
            <div>
              <label style={{ display: 'block', fontWeight: 700, fontSize: '12px', color: '#334155', marginBottom: '6px' }}>
                {t('inventory.smart_replenishment_modal.s5', "المستودع المصدر للصرف:")}
              </label>
              <CustomSelect
                value={fromLocationId ? String(fromLocationId) : ''}
                onChange={(val) => setFromLocationId(val ? Number(val) : '')}
                options={locationOptions}
                placeholder={t('inventory.smart_replenishment_modal.s6', "اختر المستودع المصدر")}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontWeight: 700, fontSize: '12px', color: '#334155', marginBottom: '6px' }}>
                {t('inventory.smart_replenishment_modal.s7', "موقع الوجهة (صالة عرض المحل):")}
              </label>
              <CustomSelect
                value={toLocationId ? String(toLocationId) : ''}
                onChange={(val) => setToLocationId(val ? Number(val) : '')}
                options={locationOptions}
                placeholder={t('inventory.smart_replenishment_modal.s8', "اختر موقع الوجهة")}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontWeight: 700, fontSize: '12px', color: '#334155', marginBottom: '6px' }}>
                {t('inventory.smart_replenishment_modal.s9', "فترة تغطية المبيعات:")}
              </label>
              <div style={{ display: 'flex', gap: '6px' }}>
                {[
                  { label: t('inventory.smart_replenishment_modal.s10', "24 ساعة (يوم)"), days: 1 },
                  { label: t('inventory.smart_replenishment_modal.s11', "48 ساعة (يومان)"), days: 2 },
                  { label: t('inventory.smart_replenishment_modal.s12', "72 ساعة (3 أيام)"), days: 3 },
                ].map((opt) => (
                  <button
                    key={opt.days}
                    type="button"
                    onClick={() => setCoverDays(opt.days)}
                    style={{
                      flex: 1,
                      height: '38px',
                      borderRadius: '8px',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: coverDays === opt.days ? 'none' : '1px solid #cbd5e1',
                      backgroundColor: coverDays === opt.days ? '#170e5e' : '#ffffff',
                      color: coverDays === opt.days ? '#ffffff' : '#475569',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Location Conflict Warning */}
          {isSameLocation && (
            <div
              style={{
                margin: '14px 20px 0',
                padding: '16px 20px',
                backgroundColor: '#fffbeb',
                border: '1px solid #fef3c7',
                borderRadius: '10px',
                color: '#b45309',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                fontSize: '12.5px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangleIcon size={18} color="#b45309" />
                <strong style={{ fontSize: '13px' }}>{t('inventory.smart_replenishment_modal.s13', "المستودع المصدر هو نفسه موقع صالة العرض:")}</strong>
              </div>
              <p style={{ margin: 0, fontSize: '12px', lineHeight: 1.5, color: '#92400e' }}>
                {locations.length > 1
                  ? t('inventory.smart_replenishment_modal.s14', "يرجى اختيار موقعين مختلفين من القائمتين بالأعلى (مستودع التخزين وصالة المحل) لبدء التحليل واحتساب كميات النواقص.")
                  : t('inventory.smart_replenishment_modal.s15', "النظام يحتوي حالياً على موقع مخزن واحد فقط (صالة المحل). يتطلب محرك إمداد الأرفف الذكي وجود موقعين على الأقل لتوجيه أذون الصرف ونقل البضاعة من المستودع إلى الصالة.")}
              </p>

              {locations.length <= 1 && (
                <div style={{ marginTop: '4px' }}>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() =>
                      createLocationMutation.mutate({
                        name: t('inventory.smart_replenishment_modal.s16', "المستودع الرئيسي (تخزين)"),
                        code: 'WH-MAIN',
                        locationType: 'internal_warehouse' as const,
                      })
                    }
                    disabled={createLocationMutation.isPending}
                    style={{
                      backgroundColor: '#170e5e',
                      color: '#ffffff',
                      fontWeight: 800,
                      fontSize: '12px',
                      height: '36px',
                      padding: '0 18px',
                      borderRadius: '8px',
                      border: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    <span>
                      {createLocationMutation.isPending
                        ? t('inventory.smart_replenishment_modal.s17', "جاري إنشاء المستودع الرئيسي...")
                        : t('inventory.smart_replenishment_modal.s18', "+ إنشاء مستودع رئيسي بنقرة واحدة لتفعيل الإمداد")}
                    </span>
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Metric Strip */}
          {!isSameLocation && (
            <div
              style={{
                padding: '10px 20px',
                backgroundColor: '#ffffff',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                fontSize: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 800, color: '#334155' }}>{t('inventory.smart_replenishment_modal.s19', "تحليل المنظومة:")}</span>
                <span style={{ backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fee2e2', padding: '3px 8px', borderRadius: '6px', fontWeight: 700, fontSize: '11.5px' }}>
                  {outOfStockCount} {t('inventory.smart_replenishment_modal.s20', "خلص بالمحل")}
                </span>
                <span style={{ backgroundColor: '#fffbeb', color: '#92400e', border: '1px solid #fef3c7', padding: '3px 8px', borderRadius: '6px', fontWeight: 700, fontSize: '11.5px' }}>
                  {lowStockCount} {t('inventory.smart_replenishment_modal.s21', "قرب يخلص")}
                </span>
                <span style={{ backgroundColor: '#eff6ff', color: '#1e40af', border: '1px solid #dbeafe', padding: '3px 8px', borderRadius: '6px', fontWeight: 700, fontSize: '11.5px' }}>
                  {salesReplenishCount} {t('inventory.smart_replenishment_modal.s22', "تعويض مبيعات")}
                </span>
                {unavailableInSourceCount > 0 && (
                  <span style={{ backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', padding: '3px 8px', borderRadius: '6px', fontWeight: 700, fontSize: '11.5px' }}>
                    {unavailableInSourceCount} {t('inventory.smart_replenishment_modal.s23', "غير متوفر بهذا المستودع (متاح ببدائل)")}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>{t('inventory.smart_replenishment_modal.s24', "المطلوب سحبه:")}</span>
                <span style={{ backgroundColor: '#f8fafc', color: '#0f172a', fontWeight: 900, padding: '4px 12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                  {activeValidItems.length} {t('inventory.smart_replenishment_modal.s25', "أصناف |")} {totalPieces} {t('inventory.smart_replenishment_modal.s26', "قطعة")}
                </span>
              </div>
            </div>
          )}

          {/* Table / Content Container */}
          <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, backgroundColor: '#f8fafc' }}>
            {suggestionsQuery.isLoading ? (
              <div style={{ padding: '60px 0', textAlign: 'center', color: '#64748b' }}>
                <RefreshCwIcon size={28} color="#94a3b8" style={{ marginBottom: '8px' }} />
                <p style={{ fontWeight: 700, fontSize: '14px', margin: 0 }}>
                  {t('inventory.smart_replenishment_modal.s27', "جاري احتساب مبيعات الـ")} {coverDays * 24} {t('inventory.smart_replenishment_modal.s28', "ساعة وفحص أرصدة كافة المخازن...")}
                </p>
              </div>
            ) : suggestionsQuery.isError ? (
              <div style={{ padding: '16px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: '8px', fontSize: '13px', fontWeight: 600, textAlign: 'center' }}>
                {t('inventory.smart_replenishment_modal.s29', "تعذر جلب مقترحات الإمداد، تأكد من اتصال السيرفر واختلاف المستودع المصدر عن صالة المحل.")}
              </div>
            ) : isSameLocation ? null : editableItems.length === 0 ? (
              <div style={{ padding: '50px 20px', textAlign: 'center', backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <CheckCircleIcon size={38} color="#16a34a" style={{ margin: '0 auto 10px' }} />
                <h3 style={{ margin: 0, fontWeight: 800, color: '#0f172a', fontSize: '16px' }}>{t('inventory.smart_replenishment_modal.s30', "الأرفف ممتلئة تماماً!")}</h3>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
                  {t('inventory.smart_replenishment_modal.s31', "لا توجد أصناف ناقصة أو مباعة تتطلب تعويضاً من المستودع حالياً في صالة العرض المحددة.")}
                </p>
              </div>
            ) : (
              <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8fafc', color: '#475569', borderBottom: '1px solid #e2e8f0', fontWeight: 800 }}>
                      <th style={{ padding: '10px 12px' }}>{t('inventory.smart_replenishment_modal.s32', "حالة الصنف")}</th>
                      <th style={{ padding: '10px 12px' }}>{t('inventory.smart_replenishment_modal.s33', "اسم الصنف، الباركود، وبدائل المخازن")}</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center' }}>{t('inventory.smart_replenishment_modal.s34', "رصيد المحل")}</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center' }}>{t('inventory.smart_replenishment_modal.s35', "مبيعات")} {coverDays * 24}{t('inventory.smart_replenishment_modal.s36', "س")}</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center' }}>{t('inventory.smart_replenishment_modal.s37', "رصيد المستودع المختار")}</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center', width: '160px' }}>{t('inventory.smart_replenishment_modal.s38', "الكمية المقترحة للصرف")}</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center', width: '60px' }}>{t('inventory.smart_replenishment_modal.s39', "حذف")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editableItems.map((item) => (
                      <tr
                        key={item.productId}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          backgroundColor: item.urgency === 'unavailable_in_source' ? '#f8fafc' : '#ffffff',
                        }}
                      >
                        <td style={{ padding: '10px 12px' }}>
                          {item.urgency === 'unavailable_in_source' && (
                            <span style={{ backgroundColor: '#f1f5f9', color: '#475569', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                              {t('inventory.smart_replenishment_modal.s40', "غير متاح بهذا المخزن")}
                            </span>
                          )}
                          {item.urgency === 'out_of_stock' && (
                            <span style={{ backgroundColor: '#fef2f2', color: '#991b1b', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', border: '1px solid #fee2e2' }}>
                              {t('inventory.smart_replenishment_modal.s41', "خلص بالمحل")}
                            </span>
                          )}
                          {item.urgency === 'low_stock' && (
                            <span style={{ backgroundColor: '#fffbeb', color: '#92400e', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', border: '1px solid #fef3c7' }}>
                              {t('inventory.smart_replenishment_modal.s42', "قرب يخلص")}
                            </span>
                          )}
                          {item.urgency === 'sales_replenish' && (
                            <span style={{ backgroundColor: '#eff6ff', color: '#1e40af', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', border: '1px solid #dbeafe' }}>
                              {t('inventory.smart_replenishment_modal.s43', "تعويض مبيعات")}
                            </span>
                          )}
                        </td>

                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ fontWeight: 800, color: '#0f172a' }}>{item.productName}</div>
                          {item.barcode && (
                            <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace', marginTop: '2px' }}>{item.barcode}</div>
                          )}

                          {/* Multi-Warehouse Alternative Indicator */}
                          {item.warehouseStock <= 0 && item.alternativeLocations && item.alternativeLocations.length > 0 && (
                            <div style={{ fontSize: '10.5px', color: '#065f46', backgroundColor: '#f0fdf4', borderRadius: '6px', padding: '2px 8px', marginTop: '4px', border: '1px solid #bbf7d0', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                              <LightbulbIcon size={12} color="#059669" />
                              <span>{t('inventory.smart_replenishment_modal.s44', "متوفر في مخازن أخرى:")} {item.alternativeLocations.map((a) => `${a.locationName} (${a.qty} ق)`).join(' | ')}</span>
                            </div>
                          )}

                          {item.warehouseStock <= 0 && (!item.alternativeLocations || item.alternativeLocations.length === 0) && (
                            <div style={{ fontSize: '10.5px', color: '#b91c1c', backgroundColor: '#fef2f2', borderRadius: '6px', padding: '2px 8px', marginTop: '4px', border: '1px solid #fecaca', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 700 }}>
                              <AlertTriangleIcon size={12} color="#dc2626" />
                              <span>{t('inventory.smart_replenishment_modal.s45', "نفد من كافة مخازن المؤسسة بالكامل!")}</span>
                            </div>
                          )}

                          {/* Predictive Purchase Deadline */}
                          {item.recommendedPurchaseDeadline && (
                            <div style={{ fontSize: '10.5px', color: '#92400e', backgroundColor: '#fffbeb', borderRadius: '6px', padding: '2px 8px', marginTop: '4px', border: '1px solid #fef3c7', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                              <CalendarIcon size={12} color="#d97706" />
                              <span>{t('inventory.smart_replenishment_modal.s46', "تنبيه شراء: الرصيد يغطي")} {item.daysOfSupplyRemaining} {t('inventory.smart_replenishment_modal.s47', "أيام - يُفضل الشراء قبل")} <b>{item.recommendedPurchaseDeadline}</b></span>
                            </div>
                          )}
                        </td>

                        <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 800, color: '#0f172a' }}>
                          {item.currentShopStock <= 0 ? (
                            <span style={{ color: '#dc2626' }}>0</span>
                          ) : (
                            item.currentShopStock
                          )}
                        </td>

                        <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 800, color: '#170e5e' }}>
                          {item.sold48h > 0 ? `${item.sold48h} ق` : '-'}
                        </td>

                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <span
                            style={{
                              fontWeight: 900,
                              fontSize: '13px',
                              color: item.warehouseStock > 0 ? '#16a34a' : '#ef4444',
                            }}
                          >
                            {item.warehouseStock}
                          </span>
                          {item.totalEnterpriseStock > item.warehouseStock && (
                            <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 500 }}>
                              {t('inventory.smart_replenishment_modal.s48', "(باقي المخازن:")} {item.totalEnterpriseStock - item.warehouseStock})
                            </div>
                          )}
                        </td>

                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          {item.warehouseStock <= 0 ? (
                            <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>
                              {t('inventory.smart_replenishment_modal.s49', "اختر مخزناً آخر للصرف")}
                            </span>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                              <button
                                type="button"
                                onClick={() => handleQtyChange(item.productId, -1)}
                                style={{
                                  width: '28px',
                                  height: '28px',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                  backgroundColor: '#f1f5f9',
                                  color: '#334155',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                              >
                                -
                              </button>
                              <input
                                type="number"
                                min="0"
                                max={item.warehouseStock}
                                value={item.suggestedQty}
                                onChange={(e) => handleQtyInput(item.productId, e.target.value)}
                                style={{
                                  width: '60px',
                                  height: '28px',
                                  textAlign: 'center',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                  fontWeight: 800,
                                  fontSize: '13px',
                                  color: '#0f172a',
                                  backgroundColor: '#ffffff',
                                  outline: 'none',
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => handleQtyChange(item.productId, 1)}
                                style={{
                                  width: '28px',
                                  height: '28px',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                  backgroundColor: '#f1f5f9',
                                  color: '#334155',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                              >
                                +
                              </button>
                            </div>
                          )}
                        </td>

                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.productId)}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              color: '#94a3b8',
                              cursor: 'pointer',
                              padding: '4px',
                            }}
                            title={t('inventory.smart_replenishment_modal.s50', "حذف من هذا الإذن")}
                          >
                            <Trash2Icon size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </StandardDialog>

      {/* Printable Dialog */}
      {printedTransfer && (
        <ReplenishmentPickListPrintModal
          isOpen={Boolean(printedTransfer)}
          onClose={() => {
            setPrintedTransfer(null);
            onClose();
          }}
          docNo={printedTransfer.docNo}
          items={printedTransfer.items}
          fromLocationName={printedTransfer.fromName}
          toLocationName={printedTransfer.toName}
          carrierName={printedTransfer.carrierName}
        />
      )}
    </>
  );
};
