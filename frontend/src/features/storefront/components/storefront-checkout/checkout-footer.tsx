import { useTranslation } from 'react-i18next';
import { useStorefrontLang } from '@/i18n';

/**
 * Checkout footer (file #42 S11) — pure move of the sticky bottom actions
 * bar (cancel + submit) from StorefrontCheckoutModal.tsx (pristine L2337–2402).
 * Props restore the pristine typing exactly (file #39 lesson): no `any[]`.
 * `t` / `isEn` are hook-local via useTranslation() + useStorefrontLang()
 * (the #40 S1/S2 pattern), not props — prep §3's generic "S3–S12 use
 * useTranslation + useStorefrontLang" is CORRECT for S11 (`t` 4x, `isEn` 1x).
 * No icons are used in this span (prep §3 "S11: none" confirmed).
 * Deviations from prep §4 (AST/grep evidence, #41 S1 precedent):
 * - Span is L2337–2402 (66L), NOT prep's L2337–2405 (69L): L2403 `</form>`
 *   + L2404 `</div>` close the form / S2 container and stay in the facade;
 *   L2405 blank stays per the trailing-blank rule.
 * - Prep's prop `onCancel: () => void (handleModalClose)` is WRONG on both
 *   counts: the cancel button calls the component prop `onClose` directly
 *   (L2381); handleModalClose is a different facade handler (L521 calls
 *   onClose() after resetting state) and is NOT used by the footer. The prop
 *   is `onClose: () => void`, same name as the component prop.
 * - Prep's prop list is UNDER-INCLUSIVE: it missed `editingOrderNumber`
 *   (submit-label ternary L2373), `isDineIn` (L2375) and `tableNumber`
 *   (L2376) — all added as props on AST evidence.
 * The span is a section comment + one <div>, i.e. two top-level nodes, so it
 * is wrapped in <>...</> (the S4/S8 fragment pattern); the span itself is
 * untouched, zero re-indentation.
 */
export interface CheckoutFooterProps {
  loading: boolean;
  brandColor: string;
  brandColorContrast: string;
  editingOrderNumber?: string;
  isDineIn: boolean;
  tableNumber?: string | null;
  onClose: () => void;
}

export function CheckoutFooter({
  loading,
  brandColor,
  brandColorContrast,
  editingOrderNumber,
  isDineIn,
  tableNumber,
  onClose,
}: CheckoutFooterProps) {
  const { t } = useTranslation();
  const { isEn } = useStorefrontLang();
  return (
    <>
{/* Sticky Bottom Actions Bar (Always visible & accessible on all screens) */}
<div
  className="storefront-checkout-footer"
  style={{
    borderTop: '1px solid #e2e8f0',
    background: '#ffffff',
    display: 'flex',
    gap: '8px',
    flexShrink: 0,
    boxShadow: '0 -4px 12px rgba(0, 0, 0, 0.04)',
    zIndex: 10,
  }}
>
  <button
    type="submit"
    disabled={loading}
    style={{
      flex: 1,
      height: '40px',
      padding: '0 20px',
      borderRadius: '12px',
      background: brandColor,
      color: brandColorContrast || 'var(--storefront-primary-contrast, #ffffff)',
      fontSize: '13px',
      fontWeight: 700,
      border: `1px solid ${brandColor}`,
      cursor: loading ? 'wait' : 'pointer',
      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'all 0.15s ease',
    }}
  >
    {loading
      ? t('storefront.storefront_checkout_modal.s66', "جاري الحفظ...")
      : editingOrderNumber
      ? t('storefront.storefront_checkout_modal.s67', "حفظ تعديلات الطلب")
      : isDineIn
      ? (isEn ? `Send to Kitchen (Table ${tableNumber || ''})` : `إرسال للمطبخ (طاولة ${tableNumber || ''})`)
      : t('storefront.storefront_checkout_modal.s68', "إرسال وتأكيد الطلب الآن")}
  </button>
  <button
    type="button"
    onClick={onClose}
    disabled={loading}
    style={{
      height: '40px',
      padding: '0 18px',
      borderRadius: '12px',
      border: '1px solid #dadce0',
      background: '#ffffff',
      color: '#1f1f1f',
      fontSize: '13px',
      fontWeight: 600,
      cursor: 'pointer',
      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'all 0.15s ease',
    }}
  >
    {t('storefront.storefront_checkout_modal.s69', "إلغاء")}
  </button>
</div>
    </>
  );
}
