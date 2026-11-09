/*
 * I6-B (GROUND FIRST): scalar Number() collapse in the feasibility form.
 *
 * I2-P9 proved the same Number(e.target.value) collapse in the items
 * grid (a typed 0.01 CBM became 1) and fixed it there with
 * parseFeasibilityNumberInput / normalizeFeasibilityNumber. The scalar
 * feasibility-form states (commRate, shippingUsd, etc.) still store
 * Number(e.target.value) straight into number state while rendering
 * value={state}, so the same keystroke collapse is suspected here:
 * typing 48.5 into the FX field should yield 485, because the
 * intermediate "48." parses to 48 and the controlled input re-renders
 * as "48" before the "5" lands.
 *
 * WHAT THIS PINS, driving the REAL ImportProjectsManager with mocked
 * query hooks (same harness as feasibility-preset-picker.spec.tsx):
 * - typing "48.5" into the commercial FX field keeps 48.5 (not 485);
 * - typing "0.01" into the international-shipping field keeps 0.01
 *   (not 1);
 * - the run-feasibility boundary still receives real numbers (the
 *   scalar states normalize to numbers before the engine call).
 * On base both keystroke cases fail (485 / 1) — that failure IS the
 * grounding proof. If they ever pass on base, the package is dropped.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ImportProjectsManager from '@/features/import-sales/ImportProjectsManager';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'ar' },
  }),
}));

// Stable references via hoisted(): the manager syncs partners in an
// effect keyed on the query data, so a fresh array literal per render
// would loop forever. (vi.mock factories run before the module body,
// so these must live in vi.hoisted, not in plain consts.)
const { projectsMock, EMPTY_QUERY, EMPTY_TARIFFS_QUERY, MUTATION } = vi.hoisted(() => {
  const data: any[] = [];
  return {
    projectsMock: vi.fn(),
    EMPTY_DATA: data,
    EMPTY_QUERY: { data, refetch: vi.fn() },
    EMPTY_TARIFFS_QUERY: { data, isLoading: false },
    MUTATION: { mutateAsync: vi.fn() },
  };
});

vi.mock('@/features/import-sales/api/shipments.api', () => ({
  useImportProjectsQuery: () => ({ data: projectsMock(), refetch: vi.fn() }),
  useCreateImportProjectMutation: () => MUTATION,
  useCalculateFeasibilityMutation: () => MUTATION,
  useConvertFeasibilityToProjectMutation: () => MUTATION,
  useUpdateImportProjectMutation: () => MUTATION,
  useCloseProjectMutation: () => MUTATION,
  useApprovalRequestsQuery: () => EMPTY_QUERY,
  useCreateApprovalRequestMutation: () => MUTATION,
  useCustomsTariffsQuery: () => EMPTY_TARIFFS_QUERY,
  useCustomsTariffSectorsQuery: () => EMPTY_QUERY,
  useSectorPresetsQuery: () => EMPTY_QUERY,
  usePartnersQuery: () => EMPTY_QUERY,
}));

vi.mock('@/shared/hooks/use-catalog-queries', () => ({
  useProductsQuery: () => EMPTY_QUERY,
}));

function renderManager() {
  // PageHeader reads the route, so the manager needs a Router.
  return render(
    <MemoryRouter>
      <ImportProjectsManager />
    </MemoryRouter>,
  );
}

async function openFreshFeasibility() {
  projectsMock.mockReturnValue([]);
  const user = userEvent.setup();
  renderManager();
  await user.click(screen.getByRole('button', { name: /محرك دراسة الجدوى والسيناريوهات/ }));
  return user;
}

/**
 * The commercial-FX input has no aria-label and its <label> is not
 * htmlFor-linked, so it is found through its visible label text: the
 * label's parent cell holds exactly one input.
 */
function fxInput(): HTMLInputElement {
  const label = screen.getByText('سعر صرف الدولار التجاري (ج.م)');
  const cell = label.closest('div') as HTMLElement;
  return cell.querySelector('input') as HTMLInputElement;
}

describe('feasibility scalar inputs keep in-progress decimals', () => {
  it('typing 48.5 into the commercial FX field keeps 48.5, not 485', async () => {
    const user = await openFreshFeasibility();
    const input = fxInput();
    expect(input).toHaveValue(50);

    await user.clear(input);
    await user.type(input, '48.5');

    expect(input).toHaveValue(48.5);
  });

  it('typing 0.01 into the shipping field keeps 0.01, not 1', async () => {
    const user = await openFreshFeasibility();
    const input = screen.getByRole('spinbutton', { name: 'الشحن الدولي ($)' });
    expect(input).toHaveValue(0);

    await user.clear(input);
    await user.type(input, '0.01');

    expect(input).toHaveValue(0.01);
  });
});
