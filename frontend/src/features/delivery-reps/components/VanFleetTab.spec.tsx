/*
 * New file: frontend/src/features/delivery-reps/components/VanFleetTab.spec.tsx
 *
 * WHAT THIS PINS (INV-VAN-FUEL-VEHICLE-GATE, part of P14): with no
 * vehicle linked to the trip (fleet empty on test10k) the fuel form
 * rendered fully editable — the rep filled odometer 1000, 10 litres,
 * 15.00/litre and only learned at save that it can never succeed
 * ("لم يتم ربط مركبة بهذه الرحلة", VanFleetTab.tsx:44-47). The
 * vehicle check ran only at submit. Separately, with zero fuel logs
 * ever recorded the tab showed no list at all (the recent-logs section
 * renders only when fuelLogs.length > 0, :282) — no empty-state text.
 *
 * WHAT IS DRIVEN (real tab, mocked api): render VanFleetTab directly.
 * - Case 1: no vehicle -> explanation shown, every input + the submit
 *   button disabled (no submit can be attempted).
 * - Case 2: vehicle present -> form editable, submit calls
 *   recordDriverFuelLog with the vehicle id.
 * - Case 3: fuelLogs empty -> the empty-state line renders.
 * - Case 4: one fuel log -> the log renders and no empty-state line.
 *
 * NOT DRIVEN: the backend vehicle check (van-fleet.service.ts:474
 * assertVehicleUsableByRep — untouched backstop, still refuses
 * vehicle-less fuel); vehicle linking itself (fleet assignment, needs
 * a registered vehicle — the fleet is empty). Vehicle-less fuel stays
 * forbidden by design: consumption needs the vehicle's last odometer.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VanFleetTab } from './VanFleetTab';

const { mockRecordFuelLog } = vi.hoisted(() => ({
  mockRecordFuelLog: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'ar' },
  }),
}));

vi.mock('../api/van-sales.api', () => ({
  vanSalesApi: {
    recordDriverFuelLog: mockRecordFuelLog,
  },
}));

vi.mock('@/shared/components/system-alert', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const NO_VEHICLE_EXPLANATION =
  'لا توجد مركبة مربوطة بهذه الرحلة — اطلب من المشرف تسجيل مركبة وربطها بالمندوب قبل تسجيل التفويل';
const EMPTY_STATE = 'لا توجد تفويلات مسجلة بعد';

const vehicle = { id: 5, plate: 'س 1234', model: 'مركبة أسطول', startOdometer: 1000 };

const oneLog: any = {
  id: 1,
  vehicleId: 5,
  plateNumber: 'س 1234',
  odometer: 1100,
  liters: 10,
  pricePerLiter: 15,
  totalCost: 150,
  kmSinceLastFuel: 100,
  consumptionRate: 10,
};

function renderTab(props: any) {
  mockRecordFuelLog.mockResolvedValue({
    ok: true,
    fuelLogId: 1,
    kmSinceLastFuel: 100,
    consumptionRate: 10,
    totalCost: 150,
  });
  render(
    <VanFleetTab
      vehicle={props.vehicle}
      tripId={6}
      maintenanceAlerts={[]}
      fuelLogs={props.fuelLogs ?? []}
      onRefreshFuel={vi.fn()}
    />,
  );
}

describe('VanFleetTab — fuel gating without a vehicle (P14)', () => {
  it('case 1: no vehicle -> explanation shown and the whole fuel form disabled', () => {
    renderTab({ vehicle: undefined, fuelLogs: [] });
    expect(screen.getByText(NO_VEHICLE_EXPLANATION)).toBeTruthy();
    expect(screen.getByPlaceholderText('مثال: 45200')).toBeDisabled();
    expect(screen.getByPlaceholderText('مثال: 40')).toBeDisabled();
    expect(screen.getByPlaceholderText('مثال: 15.50')).toBeDisabled();
    expect(screen.getByPlaceholderText('محطة مصر للبترول / التعاون')).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'حفظ عملية التفويل وحساب الاستهلاك' }),
    ).toBeDisabled();
    expect(mockRecordFuelLog).not.toHaveBeenCalled();
  });

  it('case 2: vehicle present -> form editable and submit records the fuel log for that vehicle', async () => {
    renderTab({ vehicle, fuelLogs: [] });
    expect(screen.queryByText(NO_VEHICLE_EXPLANATION)).toBeNull();
    const odometer = screen.getByPlaceholderText('مثال: 45200');
    const liters = screen.getByPlaceholderText('مثال: 40');
    const price = screen.getByPlaceholderText('مثال: 15.50');
    expect(odometer).not.toBeDisabled();
    expect(liters).not.toBeDisabled();
    expect(price).not.toBeDisabled();
    fireEvent.change(odometer, { target: { value: '1100' } });
    fireEvent.change(liters, { target: { value: '10' } });
    fireEvent.change(price, { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ عملية التفويل وحساب الاستهلاك' }));
    await waitFor(() =>
      expect(mockRecordFuelLog).toHaveBeenCalledWith(
        expect.objectContaining({
          vehicleId: 5,
          tripId: 6,
          odometer: 1100,
          liters: 10,
          pricePerLiter: 15,
        }),
      ),
    );
  });

  it('case 3: no fuel logs -> the empty-state line renders', () => {
    renderTab({ vehicle, fuelLogs: [] });
    expect(screen.getByText(EMPTY_STATE)).toBeTruthy();
  });

  it('case 4: one fuel log -> the log renders and no empty-state line', () => {
    renderTab({ vehicle, fuelLogs: [oneLog] });
    expect(screen.queryByText(EMPTY_STATE)).toBeNull();
    expect(screen.getByText('سجل التفويلات السابقة للمركبة')).toBeTruthy();
  });
});
