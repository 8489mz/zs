// KioskReviewDialog — the checkout dialog: cart summary + table/phone + payment methods + submit.
// Pure move from SelfOrderingKioskPage; the facade keeps all state and mounts
// this component with the dialog state and its handlers as props.

import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/format';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import {
  UtensilsIcon,
  ShoppingBagIcon,
  XIcon,
  Trash2Icon,
  CreditCardIcon,
  QrCodeIcon,
  ReceiptIcon,
  AlertCircleIcon,
} from '@/shared/components/icons/AppIcons';
import { calcCartLineTotal } from '@/features/pos/lib/pos-modifier-totals';
import type { KioskCartItem } from '@/features/pos/hooks/useSelfOrderingKiosk';

export interface KioskReviewDialogProps {
  open: boolean;
  onClose: () => void;
  cart: KioskCartItem[];
  diningMode: 'dine_in' | 'takeaway' | null;
  storeDisplayName: string;
  tableNumber: string;
  onTableNumberChange: (value: string) => void;
  guestPhone: string;
  onGuestPhoneChange: (value: string) => void;
  paymentChoice: 'card_terminal' | 'qr_mobile' | 'cash_counter';
  onPaymentChoiceChange: (choice: 'card_terminal' | 'qr_mobile' | 'cash_counter') => void;
  isSubmitting: boolean;
  orderError: string | null;
  hasRealInstapayPayee: boolean;
  totalItemsCount: number;
  totalCartAmount: number;
  isTableMissing: boolean;
  isTakeawayPhoneMissing: boolean;
  onEditModifiers: (item: KioskCartItem) => void;
  onRemoveFromCart: (lineKey: string) => void;
  onSubmit: () => void;
}

{/* ========================================================= */}
{/* نافذة المراجعة والدفع المنبثقة (Checkout Dialog)         */}
{/* ========================================================= */}
{/* ========================================================= */}
{/* نافذة المراجعة والدفع المنبثقة السريعة (3-Second Kiosk Checkout) */}
{/* ========================================================= */}
export function KioskReviewDialog({
  open,
  onClose,
  cart,
  diningMode,
  storeDisplayName,
  tableNumber,
  onTableNumberChange,
  guestPhone,
  onGuestPhoneChange,
  paymentChoice,
  onPaymentChoiceChange,
  isSubmitting,
  orderError,
  hasRealInstapayPayee,
  totalItemsCount,
  totalCartAmount,
  isTableMissing,
  isTakeawayPhoneMissing,
  onEditModifiers,
  onRemoveFromCart,
  onSubmit,
}: KioskReviewDialogProps) {
  const { t: __t } = useTranslation();

  return (
    <DialogShell
      open={open}
      onClose={() => onClose()}
      ariaLabel={__t('pos.self_ordering_kiosk_page.s63', __t('pos.self_ordering_kiosk_page.s63', "تأكيد ودفع الطلب بالكشك"))}
      width="min(520px, 95vw)"
      zIndex={90}
    >
      <div style={{ padding: '22px 24px', direction: 'rtl', fontFamily: 'inherit' }}>
        {/* 1. Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1.5px solid #f1f5f9',
            paddingBottom: '14px',
            marginBottom: '16px',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 900, color: '#0f172a' }}>
              {__t('pos.self_ordering_kiosk_page.s64', __t('pos.self_ordering_kiosk_page.s64', "تأكيد الطلب وطريقة الدفع"))}
            </h3>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '3px' }}>
              {storeDisplayName} {__t('pos.self_ordering_kiosk_page.s65', __t('pos.self_ordering_kiosk_page.s65', "• خطوة أخيرة لاستلام إيصالك"))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onClose()}
            style={{
              background: '#f1f5f9',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              padding: '6px',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <XIcon size={18} />
          </button>
        </div>

        {/* 2. ملخص فوري مدمج بدون تكرار قائمة الوجبات (Executive Order Summary) */}
        <div
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '18px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                backgroundColor: diningMode === 'dine_in' ? '#eff6ff' : '#f0fdf4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {diningMode === 'dine_in' ? (
                <UtensilsIcon size={18} color="#2563eb" />
              ) : (
                <ShoppingBagIcon size={18} color="#16a34a" />
              )}
            </div>
            <div>
              <div style={{ fontSize: '13.5px', fontWeight: 900, color: '#0f172a' }}>
                {diningMode === 'dine_in' ? __t('pos.self_ordering_kiosk_page.s66', __t('pos.self_ordering_kiosk_page.s66', "تناول بالصالة (Dine In)")) : __t('pos.self_ordering_kiosk_page.s67', __t('pos.self_ordering_kiosk_page.s67', "استلام سفري (Takeaway)"))}
              </div>
              <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '1px' }}>
                {__t('pos.self_ordering_kiosk_page.s68', __t('pos.self_ordering_kiosk_page.s68', "إجمالي"))} {totalItemsCount} {__t('pos.self_ordering_kiosk_page.s69', __t('pos.self_ordering_kiosk_page.s69', "صنف في الصينية"))}
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: '11px', color: '#64748b' }}>{__t('pos.self_ordering_kiosk_page.s70', __t('pos.self_ordering_kiosk_page.s70', "المبلغ الإجمالي"))}</div>
            <div style={{ fontSize: '18px', fontWeight: 900, color: '#170e5e' }}>
              {formatCurrency(totalCartAmount)}
            </div>
          </div>
        </div>

        {/* INV-REST-KIOSK-MODIFIER-UI (R7-B2): the review lists every
            line with its chosen extras (name + qty + price) and its
            line total including extras — the customer checks exactly
            what the kitchen will see — with edit / remove per line. */}
        <div style={{ marginBottom: '18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {cart.map((item) => (
            <div
              key={item.lineKey}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                padding: '10px 12px',
                borderRadius: '12px',
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: '13.5px', fontWeight: 900, color: '#0f172a' }}>
                  {item.qty}× {item.name}
                </div>
                {(item.modifiers || []).map((mod, modIdx) => (
                  <div key={modIdx} style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
                    + {mod.name}{Number(mod.qty || 1) > 1 ? ` ×${mod.qty}` : ''} ({formatCurrency(Number(mod.price || 0) * Number(mod.qty || 1))})
                  </div>
                ))}
                {(item.modifiers?.length || 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => onEditModifiers(item)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#170e5e',
                      fontSize: '12px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      padding: '4px 0 0',
                    }}
                  >
                    تعديل الإضافات
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                <span style={{ fontSize: '13.5px', fontWeight: 900, color: '#170e5e' }}>
                  {formatCurrency(calcCartLineTotal(item))}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveFromCart(item.lineKey)}
                  aria-label={`حذف ${item.name}`}
                  style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '3px' }}
                >
                  <Trash2Icon size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* 3. في حالة الصالة فقط: اختيار رقم الطاولة أو جهاز النداء بلمسة سريعة */}
        {diningMode === 'dine_in' && (
          <div style={{ marginBottom: '18px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px',
              }}
            >
              <label
                style={{
                  fontSize: '13px',
                  fontWeight: 900,
                  color: '#0f172a',
                }}
              >
                {__t('pos.self_ordering_kiosk_page.s71', __t('pos.self_ordering_kiosk_page.s71', "رقم الطاولة أو جهاز النداء:"))}
              </label>
              {tableNumber && (
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 800,
                    color: '#16a34a',
                    backgroundColor: '#dcfce7',
                    padding: '2px 8px',
                    borderRadius: '6px',
                  }}
                >
                  {__t('pos.self_ordering_kiosk_page.s72', __t('pos.self_ordering_kiosk_page.s72', "طاولة"))} {tableNumber} {__t('pos.self_ordering_kiosk_page.s73', __t('pos.self_ordering_kiosk_page.s73', "مختارة"))}
                </span>
              )}
            </div>

            {/* شبكة أزرار طاولات لمسية كبيرة وسريعة (1-10) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: '8px',
                marginBottom: '10px',
              }}
            >
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => onTableNumberChange(num)}
                  style={{
                    height: '42px',
                    borderRadius: '10px',
                    border: tableNumber === num ? '2px solid #170e5e' : '1.5px solid #e2e8f0',
                    backgroundColor: tableNumber === num ? '#170e5e' : '#ffffff',
                    color: tableNumber === num ? '#ffffff' : '#1e293b',
                    fontWeight: 900,
                    fontSize: '15px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    boxShadow: tableNumber === num ? '0 3px 10px rgba(23, 14, 94, 0.2)' : 'none',
                  }}
                >
                  {num}
                </button>
              ))}
            </div>

            {/* خانة كتابة رقم طاولة أخرى أو رقم جهاز النداء */}
            <input
              type="text"
              value={tableNumber}
              onChange={(e) => onTableNumberChange(e.target.value)}
              placeholder={__t('pos.self_ordering_kiosk_page.s74', __t('pos.self_ordering_kiosk_page.s74', "أو اكتب رقم طاولة أخرى يدوياً..."))}
              style={{
                width: '100%',
                height: '38px',
                borderRadius: '10px',
                border: '1.5px solid #cbd5e1',
                padding: '0 12px',
                fontSize: '12.5px',
                fontWeight: 700,
                boxSizing: 'border-box',
                outline: 'none',
                backgroundColor: '#ffffff',
              }}
            />
          </div>
        )}

        {/* INV-REST-KIOSK-ORDER-TRUTH: the kiosk collects a real phone.
            Takeaway requires one (the server rejects a takeaway order
            without it); dine-in leaves it optional. There is no
            fallback number anywhere — an empty field sends no phone. */}
        <div style={{ marginBottom: '18px' }}>
          <label
            style={{
              fontSize: '13px',
              fontWeight: 900,
              color: '#0f172a',
              display: 'block',
              marginBottom: '8px',
            }}
          >
            {diningMode === 'takeaway'
              ? __t('pos.self_ordering_kiosk_page.s138', __t('pos.self_ordering_kiosk_page.s138', "رقم الهاتف للاستلام (مطلوب):"))
              : __t('pos.self_ordering_kiosk_page.s139', __t('pos.self_ordering_kiosk_page.s139', "رقم الهاتف (اختياري — للتواصل عند الحاجة):"))}
          </label>
          <input
            type="tel"
            inputMode="tel"
            dir="ltr"
            value={guestPhone}
            onChange={(e) => onGuestPhoneChange(e.target.value)}
            placeholder={__t('pos.self_ordering_kiosk_page.s140', __t('pos.self_ordering_kiosk_page.s140', "مثال: 01012345678"))}
            style={{
              width: '100%',
              height: '38px',
              borderRadius: '10px',
              border: '1.5px solid #cbd5e1',
              padding: '0 12px',
              fontSize: '12.5px',
              fontWeight: 700,
              boxSizing: 'border-box',
              outline: 'none',
              backgroundColor: '#ffffff',
              textAlign: 'right',
            }}
          />
        </div>

        {/* 4. اختيار وسيلة الدفع: 3 خيارات مؤسسية ملموسة */}
        <div style={{ marginBottom: '22px' }}>
          <label
            style={{
              fontSize: '13px',
              fontWeight: 900,
              color: '#0f172a',
              display: 'block',
              marginBottom: '8px',
            }}
          >
            {__t('pos.self_ordering_kiosk_page.s75', __t('pos.self_ordering_kiosk_page.s75', "اختر طريقة الدفع:"))}
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: hasRealInstapayPayee ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)', gap: '10px' }}>
            {/* خيار 1: ماكينة الفيزا بالكشك */}
            <button
              type="button"
              onClick={() => onPaymentChoiceChange('card_terminal')}
              style={{
                padding: '14px 10px',
                borderRadius: '14px',
                border: paymentChoice === 'card_terminal' ? '2.5px solid #170e5e' : '1.5px solid #e2e8f0',
                backgroundColor: paymentChoice === 'card_terminal' ? '#f5f3ff' : '#ffffff',
                cursor: 'pointer',
                textAlign: 'right',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                transition: 'all 0.15s ease',
                boxShadow: paymentChoice === 'card_terminal' ? '0 4px 12px rgba(23, 14, 94, 0.08)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '10px',
                    backgroundColor: paymentChoice === 'card_terminal' ? '#170e5e' : '#f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <CreditCardIcon size={17} color={paymentChoice === 'card_terminal' ? '#ffffff' : '#64748b'} />
                </div>
                {paymentChoice === 'card_terminal' && (
                  <span
                    style={{
                      fontSize: '10.5px',
                      fontWeight: 900,
                      color: '#170e5e',
                      backgroundColor: '#ede9fe',
                      padding: '1px 6px',
                      borderRadius: '5px',
                    }}
                  >
                    {__t('pos.self_ordering_kiosk_page.s76', __t('pos.self_ordering_kiosk_page.s76', "محدد"))}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '12.5px', fontWeight: 900, color: '#0f172a' }}>
                {__t('pos.self_ordering_kiosk_page.s77', __t('pos.self_ordering_kiosk_page.s77', "ماكينة الكشك"))}
              </div>
              <div style={{ fontSize: '10.5px', color: '#64748b', lineHeight: 1.3 }}>
                {__t('pos.self_ordering_kiosk_page.s78', __t('pos.self_ordering_kiosk_page.s78', "تمرير البطاقة أو مدى"))}
              </div>
            </button>

            {/* خيار 2: مسح رمز QR بالهاتف — مخفي دون عنوان إنستاباي حقيقي */}
            {hasRealInstapayPayee && (
            <button
              type="button"
              onClick={() => onPaymentChoiceChange('qr_mobile')}
              style={{
                padding: '14px 10px',
                borderRadius: '14px',
                border: paymentChoice === 'qr_mobile' ? '2.5px solid #170e5e' : '1.5px solid #e2e8f0',
                backgroundColor: paymentChoice === 'qr_mobile' ? '#f5f3ff' : '#ffffff',
                cursor: 'pointer',
                textAlign: 'right',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                transition: 'all 0.15s ease',
                boxShadow: paymentChoice === 'qr_mobile' ? '0 4px 12px rgba(23, 14, 94, 0.08)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '10px',
                    backgroundColor: paymentChoice === 'qr_mobile' ? '#170e5e' : '#f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <QrCodeIcon size={17} color={paymentChoice === 'qr_mobile' ? '#ffffff' : '#64748b'} />
                </div>
                {paymentChoice === 'qr_mobile' && (
                  <span
                    style={{
                      fontSize: '10.5px',
                      fontWeight: 900,
                      color: '#170e5e',
                      backgroundColor: '#ede9fe',
                      padding: '1px 6px',
                      borderRadius: '5px',
                    }}
                  >
                    {__t('pos.self_ordering_kiosk_page.s79', __t('pos.self_ordering_kiosk_page.s79', "محدد"))}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '12.5px', fontWeight: 900, color: '#0f172a' }}>
                {__t('pos.self_ordering_kiosk_page.s80', __t('pos.self_ordering_kiosk_page.s80', "رمز QR بالهاتف"))}
              </div>
              <div style={{ fontSize: '10.5px', color: '#64748b', lineHeight: 1.3 }}>
                {__t('pos.self_ordering_kiosk_page.s81', __t('pos.self_ordering_kiosk_page.s81', "إنستاباي أو المحافظ"))}
              </div>
            </button>
            )}

            {/* خيار 3: دفع عند الكاونتر */}
            <button
              type="button"
              onClick={() => onPaymentChoiceChange('cash_counter')}
              style={{
                padding: '14px 10px',
                borderRadius: '14px',
                border: paymentChoice === 'cash_counter' ? '2.5px solid #170e5e' : '1.5px solid #e2e8f0',
                backgroundColor: paymentChoice === 'cash_counter' ? '#f5f3ff' : '#ffffff',
                cursor: 'pointer',
                textAlign: 'right',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                transition: 'all 0.15s ease',
                boxShadow: paymentChoice === 'cash_counter' ? '0 4px 12px rgba(23, 14, 94, 0.08)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '10px',
                    backgroundColor: paymentChoice === 'cash_counter' ? '#170e5e' : '#f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ReceiptIcon size={17} color={paymentChoice === 'cash_counter' ? '#ffffff' : '#64748b'} />
                </div>
                {paymentChoice === 'cash_counter' && (
                  <span
                    style={{
                      fontSize: '10.5px',
                      fontWeight: 900,
                      color: '#170e5e',
                      backgroundColor: '#ede9fe',
                      padding: '1px 6px',
                      borderRadius: '5px',
                    }}
                  >
                    {__t('pos.self_ordering_kiosk_page.s82', __t('pos.self_ordering_kiosk_page.s82', "محدد"))}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '12.5px', fontWeight: 900, color: '#0f172a' }}>
                {__t('pos.self_ordering_kiosk_page.s83', __t('pos.self_ordering_kiosk_page.s83', "دفع بالكاونتر"))}
              </div>
              <div style={{ fontSize: '10.5px', color: '#64748b', lineHeight: 1.3 }}>
                {__t('pos.self_ordering_kiosk_page.s84', __t('pos.self_ordering_kiosk_page.s84', "تذكرة للكاشير (كاش/فيزا)"))}
              </div>
            </button>
          </div>
        </div>

        {/* INV-REST-KIOSK-NO-FICTION: a failed finalize stays visible here; the button below retries it. */}
        {orderError && (
          <div
            style={{
              display: 'flex',
              gap: '10px',
              alignItems: 'flex-start',
              backgroundColor: '#fef2f2',
              border: '1.5px solid #fecaca',
              borderRadius: '12px',
              padding: '12px 14px',
              marginBottom: '14px',
              textAlign: 'right',
            }}
          >
            <AlertCircleIcon size={20} color="#dc2626" />
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#b91c1c', lineHeight: 1.5 }}>{orderError}</div>
          </div>
        )}

        {/* 5. زر التأكيد النهائي وإصدار التذكرة: Full-width tactile button */}
        <Button
          variant="primary"
          onClick={onSubmit}
          disabled={isSubmitting || isTableMissing || isTakeawayPhoneMissing}
          style={{
            width: '100%',
            height: '52px',
            backgroundColor:
              isTableMissing || isTakeawayPhoneMissing
                ? '#cbd5e1'
                : '#15803d',
            fontSize: '15px',
            fontWeight: 900,
            borderRadius: '14px',
            cursor: isTableMissing || isTakeawayPhoneMissing ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            boxShadow:
              isTableMissing || isTakeawayPhoneMissing
                ? 'none'
                : '0 6px 18px rgba(22, 128, 61, 0.25)',
            border: 'none',
            color: '#ffffff',
          }}
        >
          {isSubmitting ? (
            __t('pos.self_ordering_kiosk_page.s85', __t('pos.self_ordering_kiosk_page.s85', "جارٍ معالجة الطلب..."))
          ) : isTableMissing ? (
            __t('pos.self_ordering_kiosk_page.s86', __t('pos.self_ordering_kiosk_page.s86', "يرجى تحديد رقم طاولتك بالأعلى أولاً"))
          ) : isTakeawayPhoneMissing ? (
            __t('pos.self_ordering_kiosk_page.s141', __t('pos.self_ordering_kiosk_page.s141', "يرجى إدخال رقم هاتف صحيح للاستلام أولاً"))
          ) : paymentChoice === 'card_terminal' ? (
            <span>{__t('pos.self_ordering_kiosk_page.s87', __t('pos.self_ordering_kiosk_page.s87', "المتابعة للدفع بجهاز الكشك •"))} {formatCurrency(totalCartAmount)}</span>
          ) : paymentChoice === 'qr_mobile' ? (
            <span>{__t('pos.self_ordering_kiosk_page.s88', __t('pos.self_ordering_kiosk_page.s88', "عرض رمز QR وسداد الفاتورة •"))} {formatCurrency(totalCartAmount)}</span>
          ) : (
            <span>{__t('pos.self_ordering_kiosk_page.s89', __t('pos.self_ordering_kiosk_page.s89', "طباعة تذكرة وسدادها عند الكاونتر •"))} {formatCurrency(totalCartAmount)}</span>
          )}
        </Button>
      </div>
    </DialogShell>
  );
}
