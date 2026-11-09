/*
 * I8-A (R1, BLOCKER): PI dialog item picker never binds.
 *
 * WHAT WAS WRONG (live re-test 2026-11-09, item 2a): in the PI dialog
 * the item textbox search showed the suggestion "اختبار صنف استيراد
 * 001", but clicking it (twice, on two different lines) and keyboard
 * selection (ArrowDown+Enter) never bound it — the warning "غير مربوط
 * بصنف حقيقي" persisted and saving was blocked with "البند رقم 1 …
 * غير مربوط بصنف حقيقي". The same click pattern DID bind the item in
 * the shipment add-line dialog, so this was PI-dialog-specific.
 *
 * ROOT CAUSE (grounded, not guessed): SearchableCombobox.selectOption
 * called onSelect(option) and THEN onChange(getLabel(option)). The PI
 * line (and the feasibility grid) clears the derived link in onChange
 * — typing a new name invalidates the old link — and sets it in
 * onSelect. The echo onChange therefore wiped the productId the
 * selection had just set, on every click and every keyboard pick.
 * The shipment dialog survived by accident: its onChange is a bare
 * setSearchTerm that touches no link state. The fix is the call order
 * in the shared combobox (text echo first, selection last), which
 * repairs the PI dialog AND the feasibility grid in one place.
 *
 * WHAT THIS PINS, driving the REAL SearchableCombobox and the REAL
 * ChinaProformasTab with mocked query hooks:
 * - a click on the suggestion binds the real item (link indicator
 *   "مربوط بصنف حقيقي (#7)" appears);
 * - ArrowDown+Enter binds the real item the same way;
 * - typing a different name after a bind still clears the link (the
 *   intended clear-on-type behaviour is preserved, not broken by the
 *   reorder);
 * - in the real PI dialog the bound line saves: the create mutation
 *   carries items[0].productId === 7, so the PI → PO chain unblocks
 *   (re-test 2b is the same root cause — no separate fix).
 * All five fail on base (the echo wipes the link, so the bind never
 * happens — including the third test, which asserts the bind first);
 * the third additionally guards the intended clear-on-type behaviour
 * once the fix is applied.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { SearchableCombobox } from '@/shared/ui/searchable-combobox';
import { ChinaProformasTab } from '@/features/import-sales/components/ChinaProformasTab';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'ar' },
  }),
}));

const queryResult = (overrides: Record<string, unknown> = {}) => ({
  data: [],
  isLoading: false,
  isFetching: false,
  isError: false,
  refetch: vi.fn(),
  ...overrides,
});

const mutationResult = (overrides: Record<string, unknown> = {}) => ({
  mutateAsync: vi.fn().mockResolvedValue({}),
  mutate: vi.fn(),
  isPending: false,
  ...overrides,
});

const {
  useProformaInvoicesQueryMock,
  useApproveProformaInvoiceMutationMock,
  useGenerateInternationalPoMutationMock,
  useCreateProformaInvoiceMutationMock,
  useChinaSuppliersQueryMock,
  useProductsQueryMock,
  toastMock,
} = vi.hoisted(() => ({
  useProformaInvoicesQueryMock: vi.fn(),
  useApproveProformaInvoiceMutationMock: vi.fn(),
  useGenerateInternationalPoMutationMock: vi.fn(),
  useCreateProformaInvoiceMutationMock: vi.fn(),
  useChinaSuppliersQueryMock: vi.fn(),
  useProductsQueryMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('@/features/import-sales/api/shipments.api', () => ({
  useProformaInvoicesQuery: useProformaInvoicesQueryMock,
  useApproveProformaInvoiceMutation: useApproveProformaInvoiceMutationMock,
  useGenerateInternationalPoMutation: useGenerateInternationalPoMutationMock,
  useCreateProformaInvoiceMutation: useCreateProformaInvoiceMutationMock,
  useChinaSuppliersQuery: useChinaSuppliersQueryMock,
}));

vi.mock('@/shared/hooks/use-catalog-queries', () => ({
  useProductsQuery: useProductsQueryMock,
}));

vi.mock('@/shared/components/system-alert', () => ({
  toast: toastMock,
  systemConfirm: vi.fn().mockResolvedValue(true),
}));

// The trial item from the live re-test, and the exact PI-line handler
// pattern copied from ChinaProformasTab: onChange clears the link,
// onSelect sets it.
const TRIAL_PRODUCT = { id: '7', name: 'اختبار صنف استيراد 001', barcode: 'IMP-001' };

function PiLinePickerHarness() {
  const [line, setLine] = useState<{ productName: string; productId: number | '' }>({
    productName: '',
    productId: '',
  });
  return (
    <div>
      <SearchableCombobox
        inline
        placeholder="ابحث عن صنف حقيقي بالاسم أو الكود..."
        value={line.productName}
        onChange={(value) => setLine((prev) => ({ ...prev, productName: value, productId: '' }))}
        options={[TRIAL_PRODUCT]}
        search={(p, q) =>
          (p.name || '').toLowerCase().includes(q.toLowerCase()) ||
          (p.barcode || '').toLowerCase().includes(q.toLowerCase())
        }
        getLabel={(p) => p.name}
        getMeta={(p) => (p.barcode ? `كود: ${p.barcode}` : '')}
        onSelect={(p) => setLine((prev) => ({ ...prev, productId: Number(p.id), productName: p.name }))}
        showIdleHelper={false}
      />
      {line.productId ? (
        <span>مربوط بصنف حقيقي (#{line.productId})</span>
      ) : (
        <span>غير مربوط بصنف حقيقي — اختر الصنف من القائمة</span>
      )}
    </div>
  );
}

function renderScreen(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  }
  return render(ui, { wrapper: Wrapper });
}

function setProformaDefaults() {
  useProformaInvoicesQueryMock.mockReturnValue(queryResult({ data: [] }));
  useChinaSuppliersQueryMock.mockReturnValue(
    queryResult({ data: [{ id: 1, name: 'مورد اختبار 0001' }] }),
  );
  useProductsQueryMock.mockReturnValue(
    queryResult({ data: [{ id: 7, name: 'اختبار صنف استيراد 001', barcode: 'IMP-001' }] }),
  );
  useApproveProformaInvoiceMutationMock.mockReturnValue(mutationResult());
  useGenerateInternationalPoMutationMock.mockReturnValue(mutationResult());
  useCreateProformaInvoiceMutationMock.mockReturnValue(mutationResult());
}

async function openPiDialog() {
  const user = userEvent.setup();
  renderScreen(<ChinaProformasTab />);
  await user.click(screen.getByText('إضافة فاتورة مبدئية (New PI)'));
  const dialog = screen.getByRole('dialog');
  const picker = within(dialog).getByPlaceholderText('ابحث عن صنف حقيقي بالاسم أو الكود...');
  return { user, dialog, picker };
}

describe('I8-A: SearchableCombobox selection binds the PI-line link', () => {
  it('clicking the suggestion binds the real item', async () => {
    const user = userEvent.setup();
    render(<PiLinePickerHarness />);

    const input = screen.getByPlaceholderText('ابحث عن صنف حقيقي بالاسم أو الكود...');
    await user.click(input);
    await user.type(input, 'اختبار');
    await user.click(screen.getByRole('button', { name: /اختبار صنف استيراد 001/ }));

    expect(screen.getByText('مربوط بصنف حقيقي (#7)')).toBeInTheDocument();
    expect(screen.queryByText(/غير مربوط بصنف حقيقي/)).toBeNull();
  });

  it('ArrowDown+Enter binds the real item', async () => {
    const user = userEvent.setup();
    render(<PiLinePickerHarness />);

    const input = screen.getByPlaceholderText('ابحث عن صنف حقيقي بالاسم أو الكود...');
    await user.click(input);
    await user.type(input, 'اختبار');
    await user.keyboard('{ArrowDown}{Enter}');

    expect(screen.getByText('مربوط بصنف حقيقي (#7)')).toBeInTheDocument();
    expect(screen.queryByText(/غير مربوط بصنف حقيقي/)).toBeNull();
  });

  it('typing a different name after a bind still clears the link', async () => {
    const user = userEvent.setup();
    render(<PiLinePickerHarness />);

    const input = screen.getByPlaceholderText('ابحث عن صنف حقيقي بالاسم أو الكود...');
    await user.click(input);
    await user.type(input, 'اختبار');
    await user.click(screen.getByRole('button', { name: /اختبار صنف استيراد 001/ }));
    expect(screen.getByText('مربوط بصنف حقيقي (#7)')).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, 'صنف آخر');
    expect(screen.getByText(/غير مربوط بصنف حقيقي/)).toBeInTheDocument();
  });
});

describe('I8-A: the real PI dialog binds the item and saves it linked', () => {
  beforeEach(() => {
    setProformaDefaults();
  });

  it('click binds the line and the PI saves with productId 7', async () => {
    const createMutate = vi.fn().mockResolvedValue({});
    useCreateProformaInvoiceMutationMock.mockReturnValue(mutationResult({ mutateAsync: createMutate }));
    const { user, dialog, picker } = await openPiDialog();

    await user.click(picker);
    await user.type(picker, 'اختبار');
    await user.click(screen.getByRole('button', { name: /اختبار صنف استيراد 001/ }));

    expect(within(dialog).getByText('مربوط بصنف حقيقي (#7)')).toBeInTheDocument();

    const supplierSelect = within(dialog).getByDisplayValue('-- اختر المصنع / المورد الدولي --') as HTMLSelectElement;
    fireEvent.change(supplierSelect, { target: { value: '1' } });
    fireEvent.change(within(dialog).getByPlaceholderText('مثال: PI-261023-0001'), {
      target: { value: 'PI-TEST-0001' },
    });
    fireEvent.change(within(dialog).getByPlaceholderText('سعر الوحدة ($)'), { target: { value: '10' } });
    await user.click(within(dialog).getByText('حفظ الفاتورة المبدئية'));

    expect(createMutate).toHaveBeenCalledTimes(1);
    const dto = createMutate.mock.calls[0][0];
    expect(dto.items).toHaveLength(1);
    expect(dto.items[0].productId).toBe(7);
    expect(dto.items[0].productName).toBe('اختبار صنف استيراد 001');
    expect(toastMock.success).toHaveBeenCalledWith('تم تسجيل الفاتورة المبدئية (PI) بنجاح');
  });

  it('keyboard selection binds the line in the real PI dialog', async () => {
    const { user, dialog, picker } = await openPiDialog();

    await user.click(picker);
    await user.type(picker, 'اختبار');
    await user.keyboard('{ArrowDown}{Enter}');

    expect(within(dialog).getByText('مربوط بصنف حقيقي (#7)')).toBeInTheDocument();
    expect(within(dialog).queryByText(/غير مربوط بصنف حقيقي/)).toBeNull();
  });
});
