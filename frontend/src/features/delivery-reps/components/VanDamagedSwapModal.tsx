import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { vanSalesApi, VanStockItem } from '../api/van-sales.api';
import { roundMoney } from '../utils/van-money.utils';
import {
  CheckCircleIcon,
  XIcon,
  AlertTriangleIcon,
  PackageIcon,
} from '@/shared/components/icons/AppIcons';

export interface VanDamagedSwapModalProps {
  open: boolean;
  onClose: () => void;
  tripId: number;
  inventory: VanStockItem[];
  customers: Array<{ id: number; name: string; phone?: string }>;
  defaultCustomerId?: number | null;
  onSwapSuccess?: (result: {
    swapId: number;
    damagedProductName: string;
    replacementProductName: string;
    damagedQty: number;
    replacementQty: number;
    priceDifference: number;
    messageAr: string;
  }) => void;
}

const DAMAGE_REASONS = [
  'كسر أو تلف أثناء النقل والتوزيع',
  'انتهاء صلاحية في المحل',
  'عيب تصنيع أو تسريب بالعبوة',
  'تلف بالكرتونة أو الغلاف الخارجي',
  'تلف بسبب الرطوبة أو حرارة الشمس',
];

export const VanDamagedSwapModal: React.FC<VanDamagedSwapModalProps> = ({
  open,
  onClose,
  tripId,
  inventory,
  customers,
  defaultCustomerId,
  onSwapSuccess,
}) => {
  const { t } = useTranslation();
  const [customerId, setCustomerId] = useState<number | undefined>(
    defaultCustomerId ? Number(defaultCustomerId) : undefined,
  );
  const [damagedProductId, setDamagedProductId] = useState<number | undefined>(
    inventory.length > 0 ? inventory[0].productId : undefined,
  );
  const [damagedQty, setDamagedQty] = useState<number>(1);
  const [damageReason, setDamageReason] = useState<string>(DAMAGE_REASONS[0]);
  const [replacementProductId, setReplacementProductId] = useState<number | undefined>(
    inventory.length > 0 ? inventory[0].productId : undefined,
  );
  const [replacementQty, setReplacementQty] = useState<number>(1);
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const damagedProduct = useMemo(
    () => inventory.find((p) => p.productId === damagedProductId),
    [inventory, damagedProductId],
  );

  const replacementProduct = useMemo(
    () => inventory.find((p) => p.productId === replacementProductId),
    [inventory, replacementProductId],
  );

  const damagedUnitPrice = Number(damagedProduct?.retailPrice || damagedProduct?.costPrice || 0);
  const replacementUnitPrice = Number(replacementProduct?.retailPrice || replacementProduct?.costPrice || 0);

  const damagedTotalValue = roundMoney(damagedQty * damagedUnitPrice);
  const replacementTotalValue = roundMoney(replacementQty * replacementUnitPrice);
  const priceDifference = roundMoney(replacementTotalValue - damagedTotalValue);
  const isEvenSwap = Math.abs(priceDifference) < 0.01;

  const availableVanStock = Number(replacementProduct?.qty || 0);
  const isStockInsufficient = replacementQty > availableVanStock;

  const handleExecuteSwap = async () => {
    setErrorMsg('');
    if (!damagedProductId) {
      setErrorMsg('يرجى تحديد الصنف التالف أو المعيب');
      return;
    }
    if (!replacementProductId) {
      setErrorMsg('يرجى تحديد الصنف البديل المصروف من السيارة');
      return;
    }
    if (damagedQty <= 0 || replacementQty <= 0) {
      setErrorMsg('يجب أن تكون كميات الاستبدال أكبر من صفر');
      return;
    }
    if (isStockInsufficient) {
      setErrorMsg(`رصيد السيارة الحالي من (${replacementProduct?.productName}) هو (${availableVanStock}) فقط، ولا يكفي لصرف كمية (${replacementQty})`);
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await vanSalesApi.executeDamagedSwap(tripId, {
        customerId,
        damagedProductId,
        damagedQty,
        damageReason,
        replacementProductId,
        replacementQty,
        notes: notes.trim() || undefined,
      });

      if (res && res.ok) {
        onSwapSuccess?.(res);
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'حدث خطأ أثناء تنفيذ عملية الاستبدال');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('delivery_reps.van_damaged_swap_modal.s0', "استبدال فوري للبضاعة التالفة والمعيبة")}
      subtitle={t('delivery_reps.van_damaged_swap_modal.s1', "صرف بضاعة سليمة من سيارة التوزيع مقابل استلام التالف فورياً مع تسوية الفارق السعري")}
      badge={t('delivery_reps.van_damaged_swap_modal.s2', "استبدال ميداني")}
      compact={true}
      width="min(540px, 96vw)"
      bodyStyle={{ padding: '12px 16px' }}
      footer={
        <div
          dir="rtl"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            gap: '10px',
          }}
        >
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isSubmitting}
            style={{
              height: '38px',
              fontSize: '12.5px',
              fontWeight: 700,
              padding: '0 16px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              color: '#475569',
              borderRadius: '8px',
            }}
          >
            <XIcon size={14} color="#475569" />
            <span>{t('delivery_reps.van_damaged_swap_modal.s3', "إلغاء")}</span>
          </Button>

          <Button
            type="button"
            variant="primary"
            onClick={handleExecuteSwap}
            disabled={isSubmitting || isStockInsufficient}
            style={{
              flex: 1,
              height: '40px',
              backgroundColor: isStockInsufficient ? '#94a3b8' : '#170e5e',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 800,
              padding: '0 18px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              borderRadius: '8px',
              boxShadow: '0 2px 8px rgba(23, 14, 94, 0.25)',
            }}
          >
            <CheckCircleIcon size={15} color="#ffffff" />
            <span>{isSubmitting ? t('delivery_reps.van_damaged_swap_modal.s4', "جاري الاستبدال...") : t('delivery_reps.van_damaged_swap_modal.s5', "تأكيد وصرف الاستبدال الفوري")}</span>
          </Button>
        </div>
      }
    >
      <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* Customer Select */}
        <div>
          <label style={{ fontSize: '11px', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '4px' }}>
            {t('delivery_reps.van_damaged_swap_modal.s6', "العميل / المحل (اختياري لتسجيل الفارق السعري على كشف حسابه):")}
          </label>
          <select
            value={customerId || ''}
            onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : undefined)}
            style={{
              width: '100%',
              height: '34px',
              padding: '0 8px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '12px',
              backgroundColor: '#ffffff',
              boxSizing: 'border-box',
            }}
          >
            <option value="">{t('delivery_reps.van_damaged_swap_modal.s7', "عميل نقدي عام / في الشارع (بدون حساب)")}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.phone ? `(${c.phone})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Section 1: Damaged Product (استلام التالف) */}
        <div
          style={{
            backgroundColor: '#fff1f2',
            border: '1px solid #fecdd3',
            borderRadius: '8px',
            padding: '10px 12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <AlertTriangleIcon size={14} color="#e11d48" />
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#9f1239' }}>{t('delivery_reps.van_damaged_swap_modal.s8', "1. الصنف التالف / المكسور المستلم:")}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px', marginBottom: '8px' }}>
            <div>
              <label style={{ fontSize: '10.5px', color: '#881337', display: 'block', marginBottom: '2px' }}>{t('delivery_reps.van_damaged_swap_modal.s9', "الصنف التالف:")}</label>
              <select
                value={damagedProductId || ''}
                onChange={(e) => {
                  const pid = Number(e.target.value);
                  setDamagedProductId(pid);
                  if (!replacementProductId) setReplacementProductId(pid);
                }}
                style={{
                  width: '100%',
                  height: '32px',
                  padding: '0 6px',
                  borderRadius: '5px',
                  border: '1px solid #fda4af',
                  fontSize: '11.5px',
                  backgroundColor: '#ffffff',
                }}
              >
                {inventory.map((item) => (
                  <option key={item.productId} value={item.productId}>
                    {item.productName} ({item.retailPrice.toFixed(2)} {t('delivery_reps.van_damaged_swap_modal.s10', "ج.م)")}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: '10.5px', color: '#881337', display: 'block', marginBottom: '2px' }}>{t('delivery_reps.van_damaged_swap_modal.s11', "الكمية المستلمة:")}</label>
              {/* RTL Stepper: [+] Right, [-] Left */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <button
                  type="button"
                  onClick={() => setDamagedQty((q) => q + 1)}
                  style={{
                    width: '28px',
                    height: '32px',
                    borderRadius: '4px',
                    border: '1px solid #fda4af',
                    backgroundColor: '#ffffff',
                    fontWeight: 900,
                    cursor: 'pointer',
                    color: '#e11d48',
                  }}
                >
                  +
                </button>
                <input
                  type="number"
                  min="1"
                  value={damagedQty}
                  onChange={(e) => setDamagedQty(Math.max(1, Number(e.target.value) || 1))}
                  style={{
                    width: '42px',
                    height: '32px',
                    textAlign: 'center',
                    borderRadius: '4px',
                    border: '1px solid #fda4af',
                    fontSize: '12px',
                    fontWeight: 800,
                    backgroundColor: '#ffffff',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setDamagedQty((q) => Math.max(1, q - 1))}
                  style={{
                    width: '28px',
                    height: '32px',
                    borderRadius: '4px',
                    border: '1px solid #fda4af',
                    backgroundColor: '#ffffff',
                    fontWeight: 900,
                    cursor: 'pointer',
                    color: '#e11d48',
                  }}
                >
                  -
                </button>
              </div>
            </div>
          </div>

          <div>
            <label style={{ fontSize: '10.5px', color: '#881337', display: 'block', marginBottom: '4px' }}>{t('delivery_reps.van_damaged_swap_modal.s12', "سبب التلف أو الكسر:")}</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {DAMAGE_REASONS.map((reason) => {
                const active = damageReason === reason;
                return (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setDamageReason(reason)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: '5px',
                      fontSize: '10.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: active ? '1.5px solid #e11d48' : '1px solid #fecdd3',
                      backgroundColor: active ? '#ffe4e6' : '#ffffff',
                      color: active ? '#9f1239' : '#475569',
                    }}
                  >
                    {reason}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Section 2: Replacement Product (صرف البديل السليم) */}
        <div
          style={{
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '8px',
            padding: '10px 12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <PackageIcon size={14} color="#16a34a" />
              <span style={{ fontSize: '12px', fontWeight: 800, color: '#166534' }}>{t('delivery_reps.van_damaged_swap_modal.s13', "2. الصنف البديل السليم المنصرف من السيارة:")}</span>
            </div>
            {replacementProduct && (
              <span style={{ fontSize: '11px', fontWeight: 700, color: availableVanStock > 0 ? '#15803d' : '#dc2626' }}>
                {t('delivery_reps.van_damaged_swap_modal.s14', "المتاح بالسيارة:")} {availableVanStock} {t('delivery_reps.van_damaged_swap_modal.s15', "قطعة")}
              </span>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px' }}>
            <div>
              <label style={{ fontSize: '10.5px', color: '#14532d', display: 'block', marginBottom: '2px' }}>{t('delivery_reps.van_damaged_swap_modal.s16', "الصنف البديل:")}</label>
              <select
                value={replacementProductId || ''}
                onChange={(e) => setReplacementProductId(Number(e.target.value))}
                style={{
                  width: '100%',
                  height: '32px',
                  padding: '0 6px',
                  borderRadius: '5px',
                  border: '1px solid #86efac',
                  fontSize: '11.5px',
                  backgroundColor: '#ffffff',
                }}
              >
                {inventory.map((item) => (
                  <option key={item.productId} value={item.productId}>
                    {item.productName} ({item.retailPrice.toFixed(2)} {t('delivery_reps.van_damaged_swap_modal.s17', "ج.م) — متاح:")} {item.qty}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: '10.5px', color: '#14532d', display: 'block', marginBottom: '2px' }}>{t('delivery_reps.van_damaged_swap_modal.s18', "الكمية المصروفة:")}</label>
              {/* RTL Stepper: [+] Right, [-] Left */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <button
                  type="button"
                  onClick={() => setReplacementQty((q) => q + 1)}
                  style={{
                    width: '28px',
                    height: '32px',
                    borderRadius: '4px',
                    border: '1px solid #86efac',
                    backgroundColor: '#ffffff',
                    fontWeight: 900,
                    cursor: 'pointer',
                    color: '#16a34a',
                  }}
                >
                  +
                </button>
                <input
                  type="number"
                  min="1"
                  value={replacementQty}
                  onChange={(e) => setReplacementQty(Math.max(1, Number(e.target.value) || 1))}
                  style={{
                    width: '42px',
                    height: '32px',
                    textAlign: 'center',
                    borderRadius: '4px',
                    border: isStockInsufficient ? '1.5px solid #dc2626' : '1px solid #86efac',
                    fontSize: '12px',
                    fontWeight: 800,
                    backgroundColor: '#ffffff',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setReplacementQty((q) => Math.max(1, q - 1))}
                  style={{
                    width: '28px',
                    height: '32px',
                    borderRadius: '4px',
                    border: '1px solid #86efac',
                    backgroundColor: '#ffffff',
                    fontWeight: 900,
                    cursor: 'pointer',
                    color: '#16a34a',
                  }}
                >
                  -
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Financial Reconciliation & Valuation Card */}
        <div
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <span style={{ fontSize: '10.5px', color: '#64748b', display: 'block' }}>
              {t('delivery_reps.van_damaged_swap_modal.s19', "قيمة التالف (")}{damagedTotalValue.toFixed(2)}{t('delivery_reps.van_damaged_swap_modal.s20', ") ↔ قيمة البديل (")}{replacementTotalValue.toFixed(2)})
            </span>
            <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
              {isEvenSwap
                ? t('delivery_reps.van_damaged_swap_modal.s21', "استبدال متكافئ 1 لـ 1 (بدون فارق سعري)")
                : priceDifference > 0
                ? `فارق مستحق على العميل: +${priceDifference.toFixed(2)} ج.م`
                : `فارق مستحق لصالح العميل: ${priceDifference.toFixed(2)} ج.م`}
            </span>
          </div>

          <div
            style={{
              padding: '4px 8px',
              borderRadius: '5px',
              fontSize: '11px',
              fontWeight: 800,
              backgroundColor: isEvenSwap ? '#ecfdf5' : '#fffbeb',
              color: isEvenSwap ? '#065f46' : '#92400e',
              border: isEvenSwap ? '1px solid #a7f3d0' : '1px solid #fde68a',
            }}
          >
            {isEvenSwap ? t('delivery_reps.van_damaged_swap_modal.s22', "متطابق") : t('delivery_reps.van_damaged_swap_modal.s23', "فارق سعر")}
          </div>
        </div>

        {/* Notes Input */}
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('delivery_reps.van_damaged_swap_modal.s24', "ملاحظات تشغيلية على الاستبدال (اختياري)...")}
          style={{
            width: '100%',
            height: '32px',
            padding: '0 8px',
            borderRadius: '6px',
            border: '1px solid #cbd5e1',
            fontSize: '11.5px',
            backgroundColor: '#ffffff',
            boxSizing: 'border-box',
          }}
        />

        {errorMsg && (
          <div
            style={{
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              padding: '6px 10px',
              borderRadius: '6px',
              fontSize: '11.5px',
              fontWeight: 700,
            }}
          >
            {errorMsg}
          </div>
        )}
      </div>
    </StandardDialog>
  );
};
