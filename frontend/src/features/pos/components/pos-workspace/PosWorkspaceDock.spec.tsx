/* INV-REST-F4-HOLD-LABEL (T14-E, D-T12-H5): the F4 dock button parks a
 * held draft — it never sends anything to a kitchen — so its label must
 * always read "تعليق F4" (desktop) / "تعليق" (mobile), never the
 * restaurant-module conditional "إرسال للمطبخ F4" / "المطبخ". At base the
 * label switched on settings.restaurantModuleEnabled, so with the module
 * ON the button claimed to send to the kitchen while only holding the
 * draft. The fix drops the conditional; the button's behaviour is
 * unchanged (it still calls onHoldDraft).
 *
 * RED PROOF: on the unfixed tree the first two tests fail — the dock
 * renders "إرسال للمطبخ F4" / "المطبخ" with the restaurant module ON.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PosWorkspaceDock } from './PosWorkspaceDock';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'ar' },
  }),
}));

function renderDock(settings: { restaurantModuleEnabled: boolean }, onHoldDraft = vi.fn()) {
  render(
    <PosWorkspaceDock
      qtySummaries={['1 × صنف']}
      itemsCount={1}
      total={75}
      canOpenCheckout
      checkoutDisabledReason=""
      isPending={false}
      heldDraftsCount={0}
      onFocusSearch={vi.fn()}
      onPrintPreview={vi.fn()}
      onResetDraft={vi.fn()}
      onHoldDraft={onHoldDraft}
      onOpenHeldDrafts={vi.fn()}
      onSubmit={vi.fn()}
      settings={settings}
    />,
  );
  return onHoldDraft;
}

describe('PosWorkspaceDock — F4 hold label (INV-REST-F4-HOLD-LABEL)', () => {
  it('reads "تعليق F4" on desktop with the restaurant module ON', () => {
    renderDock({ restaurantModuleEnabled: true });

    expect(screen.getByText('تعليق F4')).toBeInTheDocument();
    expect(screen.queryByText('إرسال للمطبخ F4')).not.toBeInTheDocument();
  });

  it('reads "تعليق" on mobile with the restaurant module ON', () => {
    renderDock({ restaurantModuleEnabled: true });

    expect(screen.getByText('تعليق')).toBeInTheDocument();
    expect(screen.queryByText('المطبخ')).not.toBeInTheDocument();
  });

  it('reads the same hold label with the restaurant module OFF', () => {
    renderDock({ restaurantModuleEnabled: false });

    expect(screen.getByText('تعليق F4')).toBeInTheDocument();
    expect(screen.getByText('تعليق')).toBeInTheDocument();
  });

  it('still parks the draft on click (behaviour unchanged, no kitchen send)', () => {
    const onHoldDraft = renderDock({ restaurantModuleEnabled: true });

    fireEvent.click(screen.getByText('تعليق F4'));

    expect(onHoldDraft).toHaveBeenCalledTimes(1);
  });
});
