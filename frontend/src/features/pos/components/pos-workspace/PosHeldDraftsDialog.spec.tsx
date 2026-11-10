/* INV-REST-FLOOR-TRANSFER-TRUTH (T10-E, F6): the held-drafts dialog
 * offered only Recall / Delete — a cashier could not rename a held
 * draft's table (e.g. fix a mislabelled split check "2 - شيك 1") except
 * as a side effect of a whole-table transfer. The dialog now offers a
 * per-draft table-number edit wired to onRename.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PosHeldDraftsDialog } from '@/features/pos/components/pos-workspace/PosHeldDraftsDialog';
import type { HeldPosDraftSummary } from '@/features/pos/components/pos-cart-panel/posCartPanel.types';

const draft: HeldPosDraftSummary = {
  id: 'draft-1',
  label: 'عميل نقدي',
  total: 75,
  itemsCount: 2,
  tableNumber: '2',
  orderType: 'dine_in',
};

function renderDialog(onRename: (draftId: string, toTable: string) => Promise<void>) {
  render(
    <PosHeldDraftsDialog
      open
      heldDrafts={[draft]}
      onClose={vi.fn()}
      onRecall={vi.fn().mockResolvedValue(undefined)}
      onDelete={vi.fn().mockResolvedValue(undefined)}
      onClearAll={vi.fn().mockResolvedValue(undefined)}
      onRename={onRename}
      settings={{ restaurantModuleEnabled: true }}
    />,
  );
}

describe('PosHeldDraftsDialog — rename control', () => {
  it('offers a table-number edit and calls onRename with the new table', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    renderDialog(onRename);

    fireEvent.click(screen.getByRole('button', { name: 'تغيير الطاولة' }));
    const input = screen.getByDisplayValue('2');
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));

    await waitFor(() => expect(onRename).toHaveBeenCalledTimes(1));
    expect(onRename).toHaveBeenCalledWith('draft-1', '5');
  });

  it('does not call onRename when the table number is unchanged', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    renderDialog(onRename);

    fireEvent.click(screen.getByRole('button', { name: 'تغيير الطاولة' }));
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));

    await waitFor(() => expect(screen.queryByDisplayValue('2')).not.toBeInTheDocument());
    expect(onRename).not.toHaveBeenCalled();
  });

  it('cancel closes the editor without renaming', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    renderDialog(onRename);

    fireEvent.click(screen.getByRole('button', { name: 'تغيير الطاولة' }));
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }));

    expect(screen.queryByDisplayValue('2')).not.toBeInTheDocument();
    expect(onRename).not.toHaveBeenCalled();
  });

  it('a failed rename shows the error and keeps the editor open', async () => {
    const onRename = vi.fn().mockRejectedValue(new Error('الطاولة 5 مشغولة بالفعل بطلب محفوظ.'));
    renderDialog(onRename);

    fireEvent.click(screen.getByRole('button', { name: 'تغيير الطاولة' }));
    fireEvent.change(screen.getByDisplayValue('2'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));

    await waitFor(() => expect(screen.getByText('الطاولة 5 مشغولة بالفعل بطلب محفوظ.')).toBeInTheDocument());
    expect(screen.getByDisplayValue('5')).toBeInTheDocument();
  });
});
