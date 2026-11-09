/*
 * I5-D1: sales register hides its dead "فتح الكاشير" entry when POS is off
 * (INV-IMPORT-POS-ENTERPRISE-MODE).
 *
 * WHAT WAS WRONG (live trial phase 2, problem 1): the sales register's
 * only sale-creation entry, "فتح الكاشير", linked unconditionally to
 * /pos — on the trial tenant (operation mode "مؤسسة تجارية متقدمة
 * (Enterprise Trading)", POS off by design for its industry vertical)
 * it dead-ended on the disabled POS page. The app shell already hides
 * the POS nav item when POS is off; the register header did not follow
 * that pattern. The fix is one shared rule (pos-availability.ts): the
 * workspace passes showPosButton=false whenever POS is unavailable,
 * and the header renders no /pos link at all in that case.
 *
 * WHAT THIS PINS (the real SalesWorkspaceHeader, prop-driven):
 * - showPosButton=false: no link to /pos at all; the register keeps
 *   its working entries (quotations). THIS case fails on base (the
 *   link was unconditional there). The assertion is on the link href,
 *   not the label: on base the label is the raw key (no fallback),
 *   so a text-only assertion would pass vacuously.
 * - showPosButton=true: "فتح الكاشير" links to /pos. This case also
 *   fails on base (label renders as the raw key without the fallback
 *   this package adds to the same line).
 *
 * This spec lives in the sales feature because the feature-boundary
 * guard forbids a pos-feature spec from importing the sales header.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SalesWorkspaceHeader } from '@/features/sales/components/SalesWorkspaceHeader';

function renderHeader(showPosButton: boolean) {
  return render(
    <MemoryRouter>
      <SalesWorkspaceHeader totalItems={21} description="سجل الفواتير" onCopySummary={() => {}} showPosButton={showPosButton} />
    </MemoryRouter>,
  );
}

describe('I5-D1 sales register hides the POS entry when POS is off', () => {
  it('POS off: no link to /pos at all, working entries stay', () => {
    const { container } = renderHeader(false);

    // Assert on the link itself, not on the label text: on base the link
    // exists unconditionally (its label there is the raw key, so a
    // text-only assertion would pass vacuously).
    expect(container.querySelector('a[href="/pos"]')).toBeNull();
    expect(screen.getByText('عروض الأسعار')).toBeInTheDocument();
  });

  it('POS on: "فتح الكاشير" links to /pos', () => {
    const { container } = renderHeader(true);

    const link = container.querySelector('a[href="/pos"]');
    expect(link).not.toBeNull();
    expect(link).toHaveTextContent('فتح الكاشير');
  });
});
