/* R7-B2 (INV-REST-KIOSK-MODIFIER-UI): the customer-facing kiosk picker
 * flow, at the component level. The picker is the piece that did not
 * exist at base — no modifier UI, no mandatory blocking, no running
 * extra total — so every test below fails at base by a missing import,
 * which is the honest red proof. The full SelfOrderingKioskPage is not
 * rendered here (it needs router + auth store + react-query providers);
 * the page's wiring over this picker is thin glue on the pure helpers
 * pinned in useSelfOrderingKiosk.spec.ts (line identity, totals,
 * payload mapping, group validation). */

import type { ComponentProps } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KioskModifierPickerModal } from './KioskModifierPickerModal';
import type { ModifierGroup } from '@/shared/api/addons.api';

const sauceGroup: ModifierGroup = {
  id: 10,
  name: 'الصوص',
  nameEn: 'Sauce',
  selectionType: 'single',
  isMandatory: true,
  minSelections: 1,
  maxSelections: 1,
  displayOrder: 0,
  isActive: true,
  options: [
    { id: 201, groupId: 10, name: 'صوص حار', nameEn: 'Spicy', price: 0, costPrice: 0, isDefault: false, isActive: true, displayOrder: 0, componentProductId: null },
    { id: 202, groupId: 10, name: 'صوص جبنة', nameEn: 'Cheese sauce', price: 10, costPrice: 0, isDefault: false, isActive: true, displayOrder: 1, componentProductId: null },
  ],
};

const extrasGroup: ModifierGroup = {
  id: 11,
  name: 'إضافات',
  nameEn: 'Extras',
  selectionType: 'multiple',
  isMandatory: false,
  minSelections: 0,
  maxSelections: 2,
  displayOrder: 1,
  isActive: true,
  options: [
    { id: 211, groupId: 11, name: 'جبنة إضافية', nameEn: 'Extra cheese', price: 20, costPrice: 0, isDefault: false, isActive: true, displayOrder: 0, componentProductId: null },
    { id: 212, groupId: 11, name: 'بيض', nameEn: 'Egg', price: 15, costPrice: 0, isDefault: false, isActive: true, displayOrder: 1, componentProductId: null },
    { id: 213, groupId: 11, name: 'مشروم', nameEn: 'Mushroom', price: 12, costPrice: 0, isDefault: false, isActive: true, displayOrder: 2, componentProductId: null },
  ],
};

const groups = [sauceGroup, extrasGroup];

function renderPicker(props: Partial<ComponentProps<typeof KioskModifierPickerModal>> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <KioskModifierPickerModal
      open
      onClose={onClose}
      productName="برجر"
      productPrice={100}
      groups={groups}
      onSave={onSave}
      {...props}
    />,
  );
  return { onSave, onClose };
}

describe('KioskModifierPickerModal (R7-B2)', () => {
  it('renders the groups, the per-option prices, and the base price', () => {
    renderPicker();
    expect(screen.getByText('الصوص')).toBeInTheDocument();
    expect(screen.getByText('إضافات')).toBeInTheDocument();
    expect(screen.getByText('جبنة إضافية')).toBeInTheDocument();
    // A priced option shows its surcharge; a free one says so plainly.
    expect(screen.getByText('+20.00')).toBeInTheDocument();
    expect(screen.getByText('مجاناً')).toBeInTheDocument();
    expect(screen.getByText(/السعر الأساسي:/)).toBeInTheDocument();
    // The mandatory group is badged, so the customer knows it must be picked.
    expect(screen.getByText('إلزامي')).toBeInTheDocument();
  });

  it('a mandatory group blocks the add until chosen — and names the group', () => {
    const { onSave } = renderPicker();
    fireEvent.click(screen.getByText('أضف إلى السلة'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('الصوص');
    // Picking the mandatory option unblocks the save.
    fireEvent.click(screen.getByText('صوص حار'));
    fireEvent.click(screen.getByText('أضف إلى السلة'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toHaveLength(1);
    expect(onSave.mock.calls[0][0][0].optionId).toBe(201);
  });

  it('a single-select pick replaces the previous pick in its group', () => {
    const { onSave } = renderPicker();
    fireEvent.click(screen.getByText('صوص حار'));
    fireEvent.click(screen.getByText('صوص جبنة'));
    fireEvent.click(screen.getByText('أضف إلى السلة'));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved).toHaveLength(1);
    expect(saved[0].optionId).toBe(202);
    expect(saved[0].price).toBe(10);
  });

  it('the running extra total includes the picked options, and the save carries them', () => {
    const { onSave } = renderPicker();
    fireEvent.click(screen.getByText('صوص جبنة'));
    fireEvent.click(screen.getByText('جبنة إضافية'));
    // Base 100 + cheese sauce 10 + extra cheese 20 = 130 per unit.
    expect(screen.getByText(/سعر الوحدة:/).textContent).toMatch(/130/);
    fireEvent.click(screen.getByText('أضف إلى السلة'));
    const saved = onSave.mock.calls[0][0];
    expect(saved).toHaveLength(2);
    expect(saved.map((m: any) => m.optionId).sort()).toEqual([202, 211]);
    expect(saved.find((m: any) => m.optionId === 211).price).toBe(20);
    expect(saved.find((m: any) => m.optionId === 211).groupName).toBe('إضافات');
  });

  it('a multi option has a qty stepper: + doubles its surcharge, - at 1 removes it', () => {
    const { onSave } = renderPicker();
    fireEvent.click(screen.getByText('صوص حار'));
    fireEvent.click(screen.getByText('جبنة إضافية'));
    // Extra cheese x2: 100 + 0 + 20x2 = 140 per unit.
    fireEvent.click(screen.getByLabelText('زيادة جبنة إضافية'));
    expect(screen.getByText(/سعر الوحدة:/).textContent).toMatch(/140/);
    fireEvent.click(screen.getByText('أضف إلى السلة'));
    const saved = onSave.mock.calls[0][0];
    expect(saved.find((m: any) => m.optionId === 211).qty).toBe(2);
  });

  it('minus at qty 1 removes the option entirely', () => {
    const { onSave } = renderPicker();
    fireEvent.click(screen.getByText('صوص حار'));
    fireEvent.click(screen.getByText('جبنة إضافية'));
    // 100 + 0 + 20 = 120 with the option picked.
    expect(screen.getByText(/سعر الوحدة:/).textContent).toMatch(/120/);
    fireEvent.click(screen.getByLabelText('إنقاص جبنة إضافية'));
    // Back to base only, and the stepper is gone with the option.
    expect(screen.getByText(/سعر الوحدة:/).textContent).toMatch(/100/);
    expect(screen.queryByLabelText('إنقاص جبنة إضافية')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('أضف إلى السلة'));
    expect(onSave.mock.calls[0][0]).toHaveLength(1);
    expect(onSave.mock.calls[0][0][0].optionId).toBe(201);
  });

  it('the multi max cap is enforced with a specific error, not a silent ignore', () => {
    const { onSave } = renderPicker();
    fireEvent.click(screen.getByText('صوص حار'));
    fireEvent.click(screen.getByText('جبنة إضافية'));
    fireEvent.click(screen.getByText('بيض'));
    fireEvent.click(screen.getByText('مشروم'));
    expect(screen.getByRole('alert')).toHaveTextContent('إضافات');
    // The third pick never landed: the save carries exactly the two allowed.
    fireEvent.click(screen.getByText('أضف إلى السلة'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toHaveLength(3); // sauce + 2 extras
    expect(onSave.mock.calls[0][0].map((m: any) => m.optionId).sort()).toEqual([201, 211, 212]);
  });

  it('editing re-opens with the line picks already selected', () => {
    const { onSave } = renderPicker({
      saveLabel: 'تأكيد التعديل',
      initialModifiers: [
        { productId: 0, optionId: 202, groupId: 10, groupName: 'الصوص', name: 'صوص جبنة', qty: 1, price: 10, costPrice: 0 },
        { productId: 0, optionId: 211, groupId: 11, groupName: 'إضافات', name: 'جبنة إضافية', qty: 2, price: 20, costPrice: 0 },
      ],
    });
    // The pre-picked extras already count: 100 + 10 + 20x2 = 150.
    expect(screen.getByText(/سعر الوحدة:/).textContent).toMatch(/150/);
    expect(screen.getByText('تأكيد التعديل')).toBeInTheDocument();
    fireEvent.click(screen.getByText('تأكيد التعديل'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].find((m: any) => m.optionId === 211).qty).toBe(2);
  });
});
