import React, { useState } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import {
  useContainerPreordersQuery,
  useCreateContainerPreorderMutation,
  useConvertPreorderToSaleMutation,
  ShipmentDetails,
} from './api/shipments.api';
import { formatCurrency } from '@/lib/format';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import { useQuery } from '@tanstack/react-query';
import { customersApi } from '@/shared/api/customers.api';
import { http } from '@/lib/http';

interface ContainerPreordersModalProps {
  isOpen: boolean;
  onClose: () => void;
  shipment: ShipmentDetails;
}

export function ContainerPreordersModal({ isOpen, onClose, shipment }: ContainerPreordersModalProps) {
  const { data: preorders = [], refetch } = useContainerPreordersQuery(shipment.id);
  const createPreorderMutation = useCreateContainerPreorderMutation();
  const convertPreorderMutation = useConvertPreorderToSaleMutation();
  const [convertingPreorder, setConvertingPreorder] = useState<any | null>(null);
  const [convertNotes, setConvertNotes] = useState('');

  // INV-IMPORT-FLOATING-RESERVATION (I4-D12): sane defaults derived
  // from the selected B/L item, never hardcoded constants. The old
  // defaults (qty 100 / price 1,500 / deposit 20,000) were impossible
  // for the trial container (B/L capacity 10, goods worth 900 EGP:
  // a 150,000 EGP deal). Qty defaults to 1 (always <= capacity while
  // any capacity remains; submit is disabled at 0). The agreed price
  // defaults to the item's landed cost — the goods' real value — and
  // the user edits it to the agreed price (0 when no landed cost is
  // known, so the required field forces an explicit price). The
  // deposit defaults to 0: a deposit asserts cash actually received,
  // so no non-zero default may invent a payment; the proportionate
  // cap (deposit <= deal total) is enforced on submit and in the
  // service before the insert.
  const defaultUnitPriceFor = (item: any): number => {
    const landed = Number(item?.landed_cost_egp || 0);
    return Number.isFinite(landed) && landed > 0 ? landed : 0;
  };

  const [customerId, setCustomerId] = useState('');
  const [productId, setProductId] = useState(shipment.items[0]?.product_id || '');
  const [quantity, setQuantity] = useState<number>(1);
  const [unitPrice, setUnitPrice] = useState<number>(() => defaultUnitPriceFor(shipment.items[0]));
  const [depositAmount, setDepositAmount] = useState<number>(0);
  const [treasuryAccountId, setTreasuryAccountId] = useState('');
  const [expectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refundPendingId, setRefundPendingId] = useState<string | null>(null);
  const [refundDialogBooking, setRefundDialogBooking] = useState<any | null>(null);
  const [refundAmount, setRefundAmount] = useState<number>(0);
  const [isRefunding, setIsRefunding] = useState(false);

  const openRefundDialog = (booking: any) => {
    const remaining = Number(booking.deposit_amount_egp || 0) - Number(booking.refunded_amount_egp || 0);
    if (remaining <= 0) {
      toast.error('تم رد كامل العربون لهذا الحجز بالفعل');
      return;
    }
    setRefundDialogBooking(booking);
    setRefundAmount(remaining);
  };

  const handleConfirmRefund = async () => {
    if (!refundDialogBooking) return;
    const remaining = Number(refundDialogBooking.deposit_amount_egp || 0) - Number(refundDialogBooking.refunded_amount_egp || 0);
    if (!Number.isFinite(refundAmount) || refundAmount <= 0 || refundAmount > remaining) {
      toast.error('قيمة الرد غير صالحة أو أكبر من العربون غير المسترد');
      return;
    }
    try {
      setIsRefunding(true);
      await http(`/api/import-sales/preorders/${refundDialogBooking.id}/refund`, {
        method: 'POST',
        body: JSON.stringify({ amountEgp: refundAmount, idempotencyKey: crypto.randomUUID() }),
      });
      await refetch();
      toast.success('تم تسجيل رد العربون بالخزينة والأستاذ العام بنجاح');
      setRefundDialogBooking(null);
    } catch (err: any) {
      toast.error('تعذر رد العربون: ' + (err?.message || 'خطأ غير معروف'));
    } finally {
      setIsRefunding(false);
    }
  };

  const handleCancel = async (booking: any) => {
    const confirmed = await systemConfirm({
      title: 'تأكيد إلغاء حجز البضاعة العايمة',
      message: 'هل أنت متأكد من إلغاء حجز البضاعة؟ سيتم تحرير الكمية وإعادتها لسعة البوليصة المتاحة للحاوية.',
    });
    if (!confirmed) return;
    try {
      setRefundPendingId(booking.id);
      await http(`/api/import-sales/preorders/${booking.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'إلغاء بطلب العميل' }),
      });
      await refetch();
      toast.success('تم إلغاء الحجز وتحرير الكمية بنجاح');
    } catch (err: any) {
      toast.error('فشل الإلغاء: ' + (err?.message || 'خطأ غير معروف'));
    } finally {
      setRefundPendingId(null);
    }
  };

  // INV-IMPORT-FLOATING-RESERVATION (I4-D12): the customer list must
  // come through the canonical reader. The old hand-rolled fetch read
  // `res?.items`, but GET /api/customers returns the `{ customers:
  // [...] }` envelope (never a bare array, never `.items`), so the
  // combobox was always empty and the native "Please select an item
  // in the list" validation stopped every confirm. Same read-path
  // family as the I3-D4 quotation picker (a picker bypassing the
  // canonical reader), different mechanism — this modal never
  // converted the id to a number, so D4's fix did not cover it.
  const { data: customers = [] } = useQuery({
    queryKey: ['customers-list'],
    queryFn: () => customersApi.list(),
  });

  // Fetch treasury accounts
  const { data: accountsData } = useQuery({
    queryKey: ['accounts-list'],
    queryFn: () => http<any>('/api/accounting/accounts').catch(() => ({ accounts: [] })),
  });
  // INV-IMPORT-FLOATING-RESERVATION (I4-D12): only cash/bank accounts
  // may receive a deposit — the backend 'bank' role rejects anything
  // with isCashBank false, so offering parent current-asset accounts
  // (e.g. 1100) only produced a rejection. The flag lives under
  // flags.isCashBank on the accounts endpoint (AccountingAccount
  // type) — a top-level a.isCashBank read is always undefined, so
  // the filter must read flags (coordinator follow-through: D7
  // grounded the shape; the agent's top-level read would have
  // offered zero accounts live, same defect as I3-D8's deposit
  // dropdown).
  const treasuryAccounts = (accountsData?.accounts || (Array.isArray(accountsData) ? accountsData : [])).filter(
    (a: any) => a.flags?.isCashBank === true
  );

  if (!isOpen) return null;

  // Selected item capacity on B/L
  const selectedItem = shipment.items.find((i) => String(i.product_id) === String(productId));
  const blCapacity = selectedItem ? Number(selectedItem.quantity) : 0;
  const bookedForProduct = preorders
    .filter((p: any) => String(p.product_id) === String(productId) && p.status !== 'cancelled')
    .reduce((sum: number, p: any) => sum + Number(p.reserved_quantity), 0);
  const remainingCapacity = Math.max(0, blCapacity - bookedForProduct);
  const capacityPercent = blCapacity > 0 ? Math.min(100, (bookedForProduct / blCapacity) * 100) : 0;

  // INV-IMPORT-FLOATING-RESERVATION (I4-D12): a reservation is a
  // PRE-RECEIPT allotment. Once the container has arrived (status
  // 'Arrived', which posts the receipt) or its receipt is posted,
  // the goods are stock, not floating goods: the new-reservation
  // form is not offered. The dialog itself stays openable — the
  // bookings table below and the convert-to-sale action are the
  // post-arrival path for reservations made while floating (the
  // convert button itself is gated on Arrived), so hiding the whole
  // dialog would strand them. The service refuses a post-receipt
  // create fail-closed with the same rule.
  const isFloating = shipment.status !== 'Arrived' && shipment.inventory_receipt?.state !== 'posted';

  const handleProductChange = (nextProductId: string) => {
    setProductId(nextProductId);
    // Re-derive the sane defaults for the newly selected B/L item so a
    // stale qty/price/deposit from the previous item can never leak
    // into this reservation.
    const item = shipment.items.find((i) => String(i.product_id) === String(nextProductId));
    setQuantity(1);
    setUnitPrice(defaultUnitPriceFor(item));
    setDepositAmount(0);
  };

  const handleCreatePreorder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId) {
      toast.error('يرجى اختيار العميل');
      return;
    }
    if (!productId) {
      toast.error('يرجى اختيار الصنف');
      return;
    }
    if (quantity <= 0) {
      toast.error('الكمية يجب أن تكون أكبر من صفر');
      return;
    }
    if (quantity > remainingCapacity) {
      toast.error(`الكمية المطلوبة (${quantity}) تتجاوز السعة المتبقية بالبوليصة (${remainingCapacity})`);
      return;
    }
    // INV-IMPORT-FLOATING-RESERVATION: the deposit is proportionate
    // to the deal — it may never exceed the deal total (the service
    // enforces the same rule before the insert).
    if (!Number.isFinite(depositAmount) || depositAmount < 0 || depositAmount > quantity * unitPrice) {
      toast.error('قيمة العربون يجب أن تكون موجبة ولا تتجاوز إجمالي قيمة الحجز');
      return;
    }

    try {
      setIsSubmitting(true);
      await createPreorderMutation.mutateAsync({
        shipmentId: shipment.id,
        projectId: (shipment as any).project_id || undefined,
        customerId,
        productId,
        reservedQuantity: Number(quantity),
        unitPriceEgp: Number(unitPrice),
        depositAmountEgp: Number(depositAmount),
        depositTreasuryAccountId: treasuryAccountId || undefined,
        expectedDeliveryDate: expectedDate || undefined,
        notes: notes || undefined,
      });
      toast.success('تم تسجيل حجز البضاعة العايمة وتوريد العربون بنجاح');
      setCustomerId('');
      setNotes('');
      refetch();
    } catch (err: any) {
      toast.error('فشل تسجيل الحجز: ' + (err.message || 'خطأ غير معروف'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <StandardDialog
      isOpen={isOpen}
      onClose={onClose}
      title="حجوزات البضاعة العايمة في البحر (In-Transit Container Pre-orders)"
      subtitle={`إدارة حجوزات التجار للسلع قبل وصول الحاوية ${shipment.container_number} وقيد العربون كالتزام`}
      width="1180px"
      compact
    >
      <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Capacity Gauge & Safety Invariant Alert */}
        <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
              متابعة سعة بوليصة الشحن (B/L Capacity Guard) للصنف المختار:
            </span>
            <span style={{ fontSize: 13, fontWeight: 800, color: capacityPercent >= 100 ? '#b91c1c' : '#15803d' }}>
              {bookedForProduct} محجوز / {blCapacity} إجمالي بالبوليصة (المتاح: {remainingCapacity})
            </span>
          </div>
          <div style={{ width: '100%', height: 8, backgroundColor: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={{
                width: `${capacityPercent}%`,
                height: '100%',
                backgroundColor: capacityPercent >= 100 ? '#ef4444' : capacityPercent > 80 ? '#f59e0b' : '#10b981',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 16 }}>
          {/* Booking Form — offered only while the goods are floating (pre-receipt) */}
          {isFloating ? (
          <form
            onSubmit={handleCreatePreorder}
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', borderBottom: '1px solid #f1f5f9', paddingBottom: 6 }}>
              تسجيل حجز مسبق جديد
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 3 }}>
                العميل / التاجر:
              </label>
              <select
                className="input"
                style={{ width: '100%', padding: '6px 8px', fontSize: 12.5 }}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                required
              >
                <option value="">-- اختر العميل --</option>
                {customers.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.phone ? `(${c.phone})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 3 }}>
                الصنف المحجوز من الحاوية:
              </label>
              <select
                className="input"
                style={{ width: '100%', padding: '6px 8px', fontSize: 12.5 }}
                value={productId}
                onChange={(e) => handleProductChange(e.target.value)}
                required
              >
                {shipment.items.map((i) => (
                  <option key={i.id} value={i.product_id}>
                    {i.product_name} (سعة البوليصة: {i.quantity})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 3 }}>
                  الكمية المحجوزة:
                </label>
                <input
                  type="number"
                  className="input"
                  style={{ width: '100%', padding: '6px 8px', fontSize: 12.5 }}
                  value={quantity}
                  max={remainingCapacity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 3 }}>
                  سعر البيع المتفق (ج.م):
                </label>
                <input
                  type="number"
                  className="input"
                  style={{ width: '100%', padding: '6px 8px', fontSize: 12.5 }}
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(Number(e.target.value))}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 3 }}>
                  عربون الحجز المدفوع (ج.م):
                </label>
                <input
                  type="number"
                  className="input"
                  style={{ width: '100%', padding: '6px 8px', fontSize: 12.5 }}
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(Number(e.target.value))}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 3 }}>
                  حساب استلام العربون:
                </label>
                <select
                  className="input"
                  style={{ width: '100%', padding: '6px 8px', fontSize: 12.5 }}
                  value={treasuryAccountId}
                  onChange={(e) => setTreasuryAccountId(e.target.value)}
                >
                  <option value="">-- خزينة / بنك --</option>
                  {treasuryAccounts.map((acc: any) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.nameAr || acc.nameEn || acc.code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 3 }}>
                ملاحظات الاتفاق:
              </label>
              <input
                type="text"
                className="input"
                style={{ width: '100%', padding: '6px 8px', fontSize: 12.5 }}
                value={notes}
                placeholder="مثال: تسليم أرض الميناء أو المستودع الرئيسي"
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                إجمالي قيمة الصفقة: {formatCurrency(quantity * unitPrice)} | المتبقي عند الاستلام:{' '}
                {formatCurrency(Math.max(0, quantity * unitPrice - depositAmount))}
              </div>
              <button
                type="submit"
                disabled={isSubmitting || remainingCapacity <= 0}
                style={{
                  width: '100%',
                  padding: '8px 14px',
                  backgroundColor: remainingCapacity > 0 ? '#170e5e' : '#94a3b8',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: remainingCapacity > 0 ? 'pointer' : 'not-allowed',
                }}
              >
                تأكيد حجز البضاعة وقيد العربون
              </button>
            </div>
          </form>
          ) : (
            <div
              style={{
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: 8,
                padding: 14,
                fontSize: 13,
                fontWeight: 600,
                color: '#166534',
                lineHeight: 1.8,
              }}
            >
              وصلت الحاوية وتم استلامها — توقف تسجيل حجوزات جديدة للبضاعة العايمة.
              <br />
              الحجوزات القائمة أدناه يمكن تحويلها إلى فاتورة بيع بعد الوصول.
            </div>
          )}

          {/* Bookings Table */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ backgroundColor: '#f8fafc', padding: '10px 14px', borderBottom: '1px solid #e2e8f0', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
              سجل الحجوزات القائمة للحاوية ({preorders.length})
            </div>
            {preorders.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                لا توجد حجوزات مسجلة على هذه الحاوية حالياً
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>
                    <th style={{ padding: '8px 10px', color: '#475569', fontWeight: 600 }}>العميل</th>
                    <th style={{ padding: '8px 10px', color: '#475569', fontWeight: 600 }}>الكمية</th>
                    <th style={{ padding: '8px 10px', color: '#475569', fontWeight: 600 }}>سعر البيع</th>
                    <th style={{ padding: '8px 10px', color: '#475569', fontWeight: 600 }}>العربون</th>
                    <th style={{ padding: '8px 10px', color: '#475569', fontWeight: 600 }}>الحالة</th>
                    <th style={{ padding: '8px 10px', color: '#475569', fontWeight: 600 }}>التاريخ</th>
                    <th style={{ padding: '8px 10px', color: '#475569', fontWeight: 600 }}>التحصيل والاسترداد</th>
                  </tr>
                </thead>
                <tbody>
                  {preorders.map((po: any) => {
                    const unitPriceVal = Number(po.agreed_unit_price_egp ?? po.unit_price_egp ?? 0);
                    return (
                      <tr key={po.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 10px', fontWeight: 600, color: '#0f172a' }}>
                          {po.customer_name || `عميل #${po.customer_id}`}
                        </td>
                        <td style={{ padding: '8px 10px', fontWeight: 700 }}>{po.reserved_quantity}</td>
                        <td style={{ padding: '8px 10px' }}>{formatCurrency(unitPriceVal)}</td>
                        <td style={{ padding: '8px 10px', color: '#15803d', fontWeight: 600 }}>
                          {formatCurrency(po.deposit_amount_egp)}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 700,
                              backgroundColor:
                                po.status === 'allocated'
                                  ? '#dcfce7'
                                  : po.status === 'fulfilled'
                                  ? '#e0f2fe'
                                  : '#fef3c7',
                              color:
                                po.status === 'allocated'
                                  ? '#166534'
                                  : po.status === 'fulfilled'
                                  ? '#0369a1'
                                  : '#b45309',
                            }}
                          >
                            {po.status === 'allocated' ? 'مخصصة بالمخزن' : po.status === 'fulfilled' ? 'تم التسليم' : po.status === 'cancelled' ? 'ملغي' : 'محجوز عايم'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px', color: '#64748b' }}>
                          {new Date(po.created_at).toLocaleDateString('ar-EG')}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <div style={{ fontSize: 11, marginBottom: 4 }}>
                            مسترد: {formatCurrency(Number(po.refunded_amount_egp || 0))}
                          </div>
                          {po.status !== 'cancelled' && po.status !== 'invoiced' && po.status !== 'fulfilled' && (
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {shipment.status === 'Arrived' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setConvertingPreorder(po);
                                    setConvertNotes('');
                                  }}
                                  style={{
                                    padding: '3px 8px',
                                    backgroundColor: '#170e5e',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: 4,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                  }}
                                >
                                  تحويل لفاتورة بيع
                                </button>
                              )}
                              {Number(po.deposit_amount_egp || 0) > Number(po.refunded_amount_egp || 0) && (
                                <button
                                  type="button"
                                  onClick={() => openRefundDialog(po)}
                                  disabled={refundPendingId === po.id}
                                  style={{
                                    padding: '3px 8px',
                                    backgroundColor: '#fee2e2',
                                    color: '#b91c1c',
                                    border: '1px solid #fca5a5',
                                    borderRadius: 4,
                                    fontSize: 11,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                  }}
                                >
                                  رد العربون
                                </button>
                              )}
                              {Number(po.deposit_amount_egp || 0) - Number(po.refunded_amount_egp || 0) < 0.01 && (
                                <button
                                  type="button"
                                  onClick={() => handleCancel(po)}
                                  disabled={refundPendingId === po.id}
                                  style={{
                                    padding: '3px 8px',
                                    backgroundColor: '#f1f5f9',
                                    color: '#475569',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: 4,
                                    fontSize: 11,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                  }}
                                >
                                  إلغاء الحجز
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    
      {/* Convert Preorder to Sale Dialog */}
      <StandardDialog
        open={Boolean(convertingPreorder)}
        onClose={() => setConvertingPreorder(null)}
        title="تحويل حجز الحاوية إلى فاتورة مبيعات نظامية"
        subtitle="تسوية العربون المقبوض وخصم الكمية من باتش الحاوية المستلمة وإصدار فاتورة بيع نظامية"
        width="560px"
      >
        {convertingPreorder && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px' }}>
              {(() => {
                const cpPrice = Number(convertingPreorder.agreed_unit_price_egp ?? convertingPreorder.unit_price_egp ?? 0);
                const cpTotal = Number(convertingPreorder.total_price_egp || convertingPreorder.reserved_quantity * cpPrice);
                const netDeposit = Math.max(0, Number(convertingPreorder.deposit_amount_egp || 0) - Number(convertingPreorder.refunded_amount_egp || 0));
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: '12.5px' }}>
                    <div><span style={{ color: '#64748b' }}>العميل:</span> <strong>{convertingPreorder.customer_name || 'عميل حجز'}</strong></div>
                    <div><span style={{ color: '#64748b' }}>الكمية المحجوزة:</span> <strong>{convertingPreorder.reserved_quantity} وحدة</strong></div>
                    <div><span style={{ color: '#64748b' }}>سعر الوحدة:</span> <strong>{formatCurrency(cpPrice)}</strong></div>
                    <div><span style={{ color: '#64748b' }}>إجمالي الفاتورة:</span> <strong>{formatCurrency(cpTotal)}</strong></div>
                    <div><span style={{ color: '#64748b' }}>العربون المسدد (مسوّى):</span> <strong style={{ color: '#166534' }}>{formatCurrency(netDeposit)}</strong></div>
                    <div><span style={{ color: '#64748b' }}>المتبقي للتحصيل:</span> <strong style={{ color: '#170e5e' }}>{formatCurrency(Math.max(0, cpTotal - netDeposit))}</strong></div>
                  </div>
                );
              })()}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                ملاحظات الفاتورة والتسليم:
              </label>
              <input
                type="text"
                value={convertNotes}
                onChange={(e) => setConvertNotes(e.target.value)}
                placeholder="مثال: تسليم المستودع الرئيسي - تمت مطابقة الدفعة المقدمة"
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setConvertingPreorder(null)}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={convertPreorderMutation.isPending}
                onClick={async () => {
                  try {
                    const res = await convertPreorderMutation.mutateAsync({
                      preorderId: convertingPreorder.id,
                      dto: { notes: convertNotes },
                    });
                    toast.success(`تم إصدار فاتورة المبيعات رقم ${res.docNo || res.saleId} وتسوية العربون وخصم المخزون بنجاح`);
                    setConvertingPreorder(null);
                    refetch();
                  } catch (err: any) {
                    toast.error('فشل تحويل الحجز لفاتورة: ' + (err.message || 'خطأ غير معروف'));
                  }
                }}
                style={{ padding: '8px 18px', borderRadius: 6, border: 'none', backgroundColor: '#170e5e', color: '#ffffff', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}
              >
                {convertPreorderMutation.isPending ? 'جاري الإصدار...' : 'تأكيد وإصدار الفاتورة'}
              </button>
            </div>
          </div>
        )}
      </StandardDialog>

    
      {/* Refund Preorder Deposit Dialog */}
      <StandardDialog
        open={Boolean(refundDialogBooking)}
        onClose={() => setRefundDialogBooking(null)}
        title="رد عربون حجز بضاعة عايمة"
        subtitle={`تسجيل رد نقدي أو بنكي للعميل: ${refundDialogBooking?.customer_name || 'عميل حجز'}`}
        width="520px"
        compact
      >
        {refundDialogBooking && (
          <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: '12.5px' }}>
                <div><span style={{ color: '#64748b' }}>العميل:</span> <strong>{refundDialogBooking.customer_name || 'عميل حجز'}</strong></div>
                <div><span style={{ color: '#64748b' }}>الكمية المحجوزة:</span> <strong>{refundDialogBooking.reserved_quantity} وحدة</strong></div>
                <div><span style={{ color: '#64748b' }}>العربون المقبوض:</span> <strong style={{ color: '#166534' }}>{formatCurrency(refundDialogBooking.deposit_amount_egp)}</strong></div>
                <div><span style={{ color: '#64748b' }}>تم رده سابقاً:</span> <strong style={{ color: '#b91c1c' }}>{formatCurrency(refundDialogBooking.refunded_amount_egp || 0)}</strong></div>
                <div style={{ gridColumn: 'span 2', marginTop: 4, paddingTop: 4, borderTop: '1px solid #e2e8f0' }}>
                  <span style={{ color: '#64748b' }}>أقصى مبلغ متاح للرد:</span>{' '}
                  <strong style={{ color: '#170e5e', fontSize: 13 }}>
                    {formatCurrency(Number(refundDialogBooking.deposit_amount_egp || 0) - Number(refundDialogBooking.refunded_amount_egp || 0))}
                  </strong>
                </div>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                المبلغ المطلوب رده (ج.م):
              </label>
              <input
                type="number"
                step="0.01"
                min="1"
                max={Number(refundDialogBooking.deposit_amount_egp || 0) - Number(refundDialogBooking.refunded_amount_egp || 0)}
                value={refundAmount}
                onChange={(e) => setRefundAmount(Number(e.target.value))}
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '13px', fontWeight: 700 }}
              />
              <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#64748b' }}>
                سيتم تلقائياً إصدار إذن صرف خزينة وتسجيل قيد يومية عكسي مدين بالتزام العربون ودائن بحساب النقدية.
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setRefundDialogBooking(null)}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isRefunding || refundAmount <= 0}
                onClick={handleConfirmRefund}
                style={{ padding: '8px 18px', borderRadius: 6, border: 'none', backgroundColor: '#b91c1c', color: '#ffffff', fontSize: '12.5px', fontWeight: 700, cursor: isRefunding ? 'not-allowed' : 'pointer' }}
              >
                {isRefunding ? 'جاري تسجيل الرد...' : 'تأكيد رد العربون وقيد المحاسبة'}
              </button>
            </div>
          </div>
        )}
      </StandardDialog>

    </StandardDialog>
  );
}
