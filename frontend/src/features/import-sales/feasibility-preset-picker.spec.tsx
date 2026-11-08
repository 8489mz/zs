/*
 * I2-P8: feasibility preset picker.
 *
 * WHAT WAS WRONG (live trial 2026-11-09, problem 8): every new
 * feasibility study opened with 5 forced truck-parts rows ($38,050
 * goods, freight $3,500, clearance 48,000 EGP) — wildly out of scale
 * with the project's own capital — and the grid could never be
 * emptied, because the delete button was hidden on the last
 * remaining row (`items.length > 1` guard), so the last row had to
 * be overwritten in place.
 *
 * WHAT THIS PINS, driving the REAL ImportProjectsManager with
 * mocked query hooks:
 * - a fresh study opens with the preset picker and ZERO forced rows
 *   (0 items, zero costs, empty-state text);
 * - choosing the truck-parts preset fills the exact 5 library rows
 *   ($38,050 goods) and the preset costs (freight 3500, clearance
 *   48000, travel 15000);
 * - choosing the manual start keeps the grid empty with zero costs;
 * - every row — including the last one — has a working delete, so
 *   the grid can be emptied all the way to zero rows;
 * - opening a project with no stored study also opens fresh (picker,
 *   zero rows), never the old forced bundle or another project's
 *   leftovers.
 * The preset content itself is pinned through the real
 * buildTruckPartsPreset() helper (no invented items).
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ImportProjectsManager from '@/features/import-sales/ImportProjectsManager';
import {
  buildTruckPartsPreset,
  EMPTY_FEASIBILITY_COSTS,
  TRUCK_PARTS_PRESET_COSTS,
} from '@/features/import-sales/feasibility-preset';

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
const { projectsMock, EMPTY_DATA, EMPTY_QUERY, EMPTY_TARIFFS_QUERY, MUTATION } = vi.hoisted(() => {
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
  const user = userEvent.setup();
  renderManager();
  await user.click(screen.getByRole('button', { name: /محرك دراسة الجدوى والسيناريوهات/ }));
  return user;
}

describe('feasibility preset content', () => {
  it('is the exact old forced bundle: 5 truck-parts rows totalling $38,050', () => {
    const preset = buildTruckPartsPreset();
    expect(preset.items).toHaveLength(5);
    const goodsTotal = preset.items.reduce((s, it) => s + it.qty * it.factoryPriceUsd, 0);
    expect(goodsTotal).toBe(38050);
    expect(preset.items.map((it) => it.hsCode)).toEqual([
      '8708.30.10',
      '8409.99.10',
      '8708.93.10',
      '8414.80.10',
      '8421.23.10',
    ]);
    expect(preset.costs).toEqual(TRUCK_PARTS_PRESET_COSTS);
    expect(TRUCK_PARTS_PRESET_COSTS.shippingUsd).toBe(3500);
    expect(TRUCK_PARTS_PRESET_COSTS.clearanceEgp).toBe(48000);
    expect(TRUCK_PARTS_PRESET_COSTS.travelEgp).toBe(15000);
    expect(EMPTY_FEASIBILITY_COSTS).toEqual({
      shippingUsd: 0,
      insuranceUsd: 0,
      clearanceEgp: 0,
      transportEgp: 0,
      travelEgp: 0,
    });
  });

  it('returns fresh copies so the form can mutate them safely', () => {
    const first = buildTruckPartsPreset();
    first.items[0].qty = 1;
    first.costs.shippingUsd = 1;
    const second = buildTruckPartsPreset();
    expect(second.items[0].qty).toBe(600);
    expect(second.costs.shippingUsd).toBe(3500);
  });
});

describe('feasibility preset picker', () => {
  it('a fresh study opens with the picker and zero forced rows', async () => {
    projectsMock.mockReturnValue([]);
    const user = await openFreshFeasibility();

    expect(screen.getByText(/ابدأ دراسة الجدوى/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /قالب قطع غيار النقل والتريلات/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /بدء يدوي فارغ/ })).toBeInTheDocument();
    expect(screen.getByText('0 صنف')).toBeInTheDocument();
    expect(screen.getByText(/لا توجد أصناف بعد/)).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: 'حذف الصنف' })).toHaveLength(0);
    expect(screen.getByRole('spinbutton', { name: 'الشحن الدولي ($)' })).toHaveValue(0);
    expect(screen.getByRole('spinbutton', { name: 'تخليص، نافذة، وفحص رقابي (ج.م)' })).toHaveValue(0);
    expect(screen.getByRole('spinbutton', { name: 'مصاريف سفر ومعاينات (ج.م)' })).toHaveValue(0);
    void user;
  });

  it('choosing the truck preset fills the 5 library rows and the preset costs', async () => {
    projectsMock.mockReturnValue([]);
    const user = await openFreshFeasibility();

    await user.click(screen.getByRole('button', { name: /قالب قطع غيار النقل والتريلات/ }));

    expect(screen.queryByText(/ابدأ دراسة الجدوى/)).not.toBeInTheDocument();
    expect(screen.getByText('5 صنف')).toBeInTheDocument();
    expect(screen.getByText('$38,050')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'الشحن الدولي ($)' })).toHaveValue(3500);
    expect(screen.getByRole('spinbutton', { name: 'تخليص، نافذة، وفحص رقابي (ج.م)' })).toHaveValue(48000);
    expect(screen.getByRole('spinbutton', { name: 'مصاريف سفر ومعاينات (ج.م)' })).toHaveValue(15000);
    expect(screen.getAllByRole('button', { name: 'حذف الصنف' })).toHaveLength(5);
  });

  it('choosing the manual start keeps the grid empty with zero costs', async () => {
    projectsMock.mockReturnValue([]);
    const user = await openFreshFeasibility();

    await user.click(screen.getByRole('button', { name: /بدء يدوي فارغ/ }));

    expect(screen.queryByText(/ابدأ دراسة الجدوى/)).not.toBeInTheDocument();
    expect(screen.getByText('0 صنف')).toBeInTheDocument();
    expect(screen.getByText(/لا توجد أصناف بعد/)).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'الشحن الدولي ($)' })).toHaveValue(0);
  });

  it('every row including the last has a working delete, down to zero rows', async () => {
    projectsMock.mockReturnValue([]);
    const user = await openFreshFeasibility();

    await user.click(screen.getByRole('button', { name: /قالب قطع غيار النقل والتريلات/ }));
    expect(screen.getAllByRole('button', { name: 'حذف الصنف' })).toHaveLength(5);

    for (let remaining = 5; remaining > 0; remaining -= 1) {
      const deletes = screen.getAllByRole('button', { name: 'حذف الصنف' });
      expect(deletes).toHaveLength(remaining);
      await user.click(deletes[deletes.length - 1]);
      expect(screen.getByText(`${remaining - 1} صنف`)).toBeInTheDocument();
    }

    expect(screen.queryAllByRole('button', { name: 'حذف الصنف' })).toHaveLength(0);
    expect(screen.getByText(/لا توجد أصناف بعد/)).toBeInTheDocument();
  });

  it('a project with no stored study opens fresh, never with forced rows', async () => {
    projectsMock.mockReturnValue([
      {
        id: 'proj-1',
        project_no: 'IMP-261109-0001',
        title: 'مشروع اختبار بدون دراسة',
        country_origin: 'الصين',
        country_destination: 'مصر',
        budget_currency: 'USD',
        allocated_capital: 100,
        target_roi_percentage: 25,
        shipmentCount: 0,
        status: 'feasibility',
        feasibility_data: null,
      },
    ]);
    const user = userEvent.setup();
    renderManager();

    const row = screen.getByText('IMP-261109-0001').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /دراسة الجدوى/ }));

    expect(screen.getByText(/ابدأ دراسة الجدوى/)).toBeInTheDocument();
    expect(screen.getByText('0 صنف')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'الشحن الدولي ($)' })).toHaveValue(0);
  });
});
