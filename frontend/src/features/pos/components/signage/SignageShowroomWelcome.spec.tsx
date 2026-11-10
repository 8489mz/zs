/* INV-REST-SIGNAGE-DYNAMIC (T13-H2): the truly-empty board — no
 * offers AND an empty catalog — is a neutral empty state: store
 * name + a no-offers line + the real QR hub + the switch to the
 * full catalog. At base (6dcf2b60) this board carried invented
 * showroom copy for every tenant (payment methods, warranty,
 * inspection claims) and restaurant copy for restaurant tenants.
 * None of that survives: a datum with no source is omitted, not
 * invented, and the board is identical for every tenant.
 *
 * These tests pin: the store name and the neutral line render; zero
 * hardcoded-variant strings appear; the switch button offers the
 * full catalog under a neutral label; the board does not change
 * with the tenant vertical.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SignageShowroomWelcome } from './SignageShowroomWelcome';

const FORBIDDEN_STRINGS = [
  'صالة العرض',
  'المعرض',
  'فيزا',
  'ماستركارد',
  'InstaPay',
  'ضمان معتمد',
  'فحص وتجربة',
  'معاينة وفحص',
  'تسليم فوري',
  'استلام فوري',
  'دفع إلكتروني آمن',
  'دفع آمن',
  'فاتورة وضمان',
  'قائمة اليوم',
  'قائمة المطعم',
  'أهلاً بكم في مطعمنا',
  'اطلب من طاولتك',
  'صالة وسفري',
  'طازج كل يوم',
  'طازج يومياً',
  'تصفح القائمة واطلب',
  'عرض كافة منتجات الصالة',
  'عرض القائمة كاملة',
  'صالة العرض التفاعلية',
  'وجهتكم الأولى',
  'الصفقات الحصرية',
  'التوصيل الفوري',
  'التوصيل بضغطة واحدة',
  'القسم الرئيسي',
];

function renderBoard(props: Record<string, unknown> = {}) {
  const utils = render(
    <SignageShowroomWelcome
      {...(props as unknown as Parameters<typeof SignageShowroomWelcome>[0])}
      storeName="مطعم الاختبار"
      qrSvgUrl="https://example.invalid/qr.svg"
      theme="dark"
    />,
  );
  return utils;
}

describe('SignageShowroomWelcome empty state (INV-REST-SIGNAGE-DYNAMIC)', () => {
  it('shows the store name and a neutral no-offers line, never invented copy', () => {
    const { container } = renderBoard();
    const text = container.textContent || '';
    for (const forbidden of FORBIDDEN_STRINGS) {
      expect(text).not.toContain(forbidden);
    }
    expect(screen.getByText('مطعم الاختبار')).toBeInTheDocument();
    expect(screen.getByText('لا توجد عروض حالياً')).toBeInTheDocument();
    expect(screen.getByText('لوحة العروض')).toBeInTheDocument();
  });

  it('offers the real catalog under a neutral label, with the neutral QR hub', () => {
    renderBoard({
      hasFilterOffers: true,
      onSwitchToAllProducts: vi.fn(),
    });
    expect(screen.getByText('عرض كل المنتجات')).toBeInTheDocument();
    expect(screen.getByText('تصفح الكتالوج واطلب من هاتفك')).toBeInTheDocument();
    expect(screen.queryByText('عرض كافة منتجات الصالة')).not.toBeInTheDocument();
    expect(screen.queryByText('عرض القائمة كاملة')).not.toBeInTheDocument();
  });

  it('shows no switch button when the offers filter is not active', () => {
    renderBoard();
    expect(screen.queryByText('عرض كل المنتجات')).not.toBeInTheDocument();
  });

  it('is the same board whatever vertical is passed — no variant copy', () => {
    const { container } = renderBoard({ vertical: 'restaurant' });
    const text = container.textContent || '';
    for (const forbidden of FORBIDDEN_STRINGS) {
      expect(text).not.toContain(forbidden);
    }
    expect(screen.getByText('لا توجد عروض حالياً')).toBeInTheDocument();
    expect(screen.getByText('لوحة العروض')).toBeInTheDocument();
  });
});
