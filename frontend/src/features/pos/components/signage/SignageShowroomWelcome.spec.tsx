/* INV-REST-SIGNAGE-VERTICAL-TRUTH (T11-E, F7): the zero-offers board
 * must be vertical-aware. At base (1816a953) SignageShowroomWelcome
 * renders one hardcoded showroom board for every tenant — badge
 * 'صالة العرض التفاعلية الذكية', Visa/Mastercard/InstaPay payment
 * copy, 'ضمان معتمد', 'صالة العرض' everywhere — even for a
 * restaurant tenant whose screen should show today's menu and
 * table ordering. Only storeName ever came from tenant settings and
 * the pos.signage.welcome.* keys exist in neither locale file, so
 * every string above is a hardcoded fallback. The "0 offers" count
 * itself is honest (R8-D) and is not changed by this package.
 *
 * These tests pin: a restaurant tenant NEVER sees showroom copy on
 * the board and DOES see the restaurant board (today's menu +
 * order-from-your-phone QR); a retail tenant still sees the
 * showroom board (no regression for the vertical the board was
 * built for).
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SignageShowroomWelcome } from './SignageShowroomWelcome';

const SHOWROOM_STRINGS = [
  'صالة العرض',
  'فيزا',
  'ماستركارد',
  'InstaPay',
  'ضمان معتمد',
  'فحص وتجربة',
];

function renderBoard(props: Record<string, unknown> = {}) {
  const utils = render(
    <SignageShowroomWelcome
      storeName="مطعم الاختبار"
      qrSvgUrl="https://example.invalid/qr.svg"
      theme="dark"
      {...(props as unknown as Parameters<typeof SignageShowroomWelcome>[0])}
    />,
  );
  return utils;
}

describe('SignageShowroomWelcome vertical truth (INV-REST-SIGNAGE-VERTICAL-TRUTH)', () => {
  it('a restaurant tenant never sees showroom copy on the zero-offers board', () => {
    const { container } = renderBoard({ vertical: 'restaurant' });
    const text = container.textContent || '';
    for (const forbidden of SHOWROOM_STRINGS) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('a restaurant tenant sees the restaurant board: today’s menu and order-from-your-phone', () => {
    const { container } = renderBoard({ vertical: 'restaurant' });
    expect(screen.getByText('مطعم الاختبار')).toBeInTheDocument();
    expect(container.textContent).toContain('قائمة اليوم');
    expect(container.textContent).toContain('تصفح القائمة واطلب من هاتفك');
  });

  it('a restaurant tenant is offered the full menu, not the showroom catalogue', () => {
    renderBoard({
      vertical: 'restaurant',
      hasFilterOffers: true,
      onSwitchToAllProducts: vi.fn(),
    });
    expect(screen.getByText('عرض القائمة كاملة')).toBeInTheDocument();
    expect(screen.queryByText('عرض كافة منتجات الصالة')).not.toBeInTheDocument();
  });

  it('a retail tenant still sees the showroom board (no regression)', () => {
    const { container } = renderBoard();
    expect(container.textContent).toContain('صالة العرض التفاعلية الذكية');
    expect(container.textContent).toContain('فيزا');
  });
});
